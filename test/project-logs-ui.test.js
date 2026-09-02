var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var paletteSource = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette.js"), "utf8");
var logsSource = fs.readFileSync(path.join(root, "lib/public/modules/project-logs.js"), "utf8");
var appSource = fs.readFileSync(path.join(root, "lib/public/app.js"), "utf8");
var messagesSource = fs.readFileSync(path.join(root, "lib/public/modules/app-messages.js"), "utf8");
var mobileSource = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-mobile.js"), "utf8");
var css = fs.readFileSync(path.join(root, "lib/public/css/project-logs.css"), "utf8");
var filebrowserCss = fs.readFileSync(path.join(root, "lib/public/css/filebrowser.css"), "utf8");

test("Project Logs occupies the project tool slot on desktop and mobile", function () {
  assert.match(paletteSource, /id: "project-logs-btn",\s+icon: "notebook-tabs",\s+label: "Logs"/);
  assert.doesNotMatch(paletteSource, /id: "scheduler-btn"/);
  assert.match(mobileSource, /icon: "notebook-tabs", label: "Logs", action: "project-logs"/);
  assert.match(mobileSource, /targetId = "project-logs-btn"/);
});

test("Project Logs uses store state, direct imports, and correlated WebSocket requests", function () {
  assert.match(logsSource, /import \{ store \} from '\.\/store\.js'/);
  assert.match(logsSource, /import \{ getWs \} from '\.\/ws-ref\.js'/);
  assert.match(logsSource, /projectLogsListRequestId/);
  assert.match(logsSource, /projectLogsReadRequestId/);
  assert.match(logsSource, /projectLogsSaveRequestId/);
  assert.match(logsSource, /var LOG_KINDS = \["decision", "investigation", "session-note", "runbook", "reference", "incident", "progress"\]/);
  assert.match(logsSource, /kind: kind\.value, title: titleValue, body: contentValue/);
  assert.doesNotMatch(logsSource, /localStorage|sessionStorage|alert\(|confirm\(|prompt\(|initProjectLogs\(ctx\)|var _ctx/);
  // Client style rules: var only, no arrow functions.
  assert.doesNotMatch(logsSource, /\bconst\s|\blet\s|=>/);
});

test("Project Logs initializes after the tool palette and routes server responses", function () {
  assert.ok(appSource.indexOf("initToolPalettes();") < appSource.indexOf("initProjectLogs();"));
  assert.match(messagesSource, /case "project_logs_state":[\s\S]*handleProjectLogsState\(msg\)/);
  assert.match(messagesSource, /case "project_log_entry":[\s\S]*handleProjectLogEntry\(msg\)/);
  assert.match(messagesSource, /case "project_log_saved":[\s\S]*handleProjectLogSaved\(msg\)/);
  assert.match(messagesSource, /case "project_logs_error":[\s\S]*handleProjectLogsError\(msg\)/);
  // Window state is declared in the store like every other mutable UI value.
  assert.match(appSource, /projectLogsWide: false/);
  assert.match(appSource, /projectLogsFullscreen: false/);
});

test("Project Logs mounts as a workbench window beside the conversation", function () {
  // Sibling of #app inside #main-panels, exactly like the document viewer and
  // the terminal, rather than a child of #app that covers it.
  assert.match(logsSource, /document\.getElementById\("main-panels"\)/);
  assert.match(logsSource, /panels\.appendChild\(panel\)/);
  assert.doesNotMatch(logsSource, /getElementById\("app"\)/);
  assert.doesNotMatch(logsSource, /app\.appendChild\(panel\)/);
});

test("opening and closing Logs never hides chat, composer, or title bar", function () {
  // The old fullscreen replacement hid these three; the workbench window must
  // leave every one of them mounted and visible.
  assert.doesNotMatch(logsSource, /getElementById\("messages"\)/);
  assert.doesNotMatch(logsSource, /getElementById\("input-area"\)/);
  assert.doesNotMatch(logsSource, /title-bar-content/);
  assert.doesNotMatch(logsSource, /messages\.classList/);
  assert.doesNotMatch(logsSource, /input\.classList/);

  // Toggle behaviour is preserved.
  assert.match(logsSource, /if \(store\.get\('projectLogsOpen'\)\) closeProjectLogs\(\);\s*\n\s*else openProjectLogs\(\);/);
  assert.match(logsSource, /export function openProjectLogs/);
  assert.match(logsSource, /export function closeProjectLogs/);
  assert.match(logsSource, /panel\.classList\.remove\("hidden"\)/);
  assert.match(logsSource, /panel\.classList\.add\("hidden"\)/);
  // The active state on the tool button still tracks the panel.
  assert.match(logsSource, /button\.classList\.add\("active"\)/);
  assert.match(logsSource, /button\.classList\.remove\("active"\)/);
});

test("opening Logs claims the single right workbench slot", function () {
  // Both are closed through their own module's exported lifecycle function,
  // not by reaching into their DOM.
  assert.match(logsSource, /import \{ closeFileViewer \} from '\.\/filebrowser\.js'/);
  assert.match(logsSource, /import \{ closeTerminal \} from '\.\/terminal\.js'/);
  assert.match(logsSource, /try \{ closeFileViewer\(\); \} catch \(e\) \{\}/);
  assert.match(logsSource, /try \{ closeTerminal\(\); \} catch \(e\) \{\}/);

  // Both calls sit inside openProjectLogs, before the panel is revealed.
  var open = logsSource.slice(logsSource.indexOf("export function openProjectLogs"));
  open = open.slice(0, open.indexOf("export function closeProjectLogs"));
  assert.ok(open.indexOf("closeFileViewer()") !== -1, "the file viewer is closed on open");
  assert.ok(open.indexOf("closeTerminal()") !== -1, "the terminal is closed on open");
  assert.ok(open.indexOf("closeFileViewer()") < open.indexOf('panel.classList.remove("hidden")'));
  assert.ok(open.indexOf("closeTerminal()") < open.indexOf('panel.classList.remove("hidden")'));

  // Closing Logs must not close the other tools; only opening claims the slot.
  var close = logsSource.slice(logsSource.indexOf("export function closeProjectLogs"));
  close = close.slice(0, close.indexOf("export function handleProjectLogsState"));
  assert.equal(close.indexOf("closeFileViewer"), -1);
  assert.equal(close.indexOf("closeTerminal"), -1);

  // The reverse direction is already wired on the other tools' buttons.
  assert.match(appSource, /fileBrowserBtn\.addEventListener\("click", function \(\) \{ closeProjectLogs\(\);/);
  assert.match(appSource, /terminalSidebarBtn\.addEventListener\("click", function \(\) \{ closeProjectLogs\(\);/);

  // These functions are hoisted declarations, so the import cycle they close is
  // safe: neither is invoked during module evaluation.
  var filebrowserSource = fs.readFileSync(path.join(root, "lib/public/modules/filebrowser.js"), "utf8");
  var terminalSource = fs.readFileSync(path.join(root, "lib/public/modules/terminal.js"), "utf8");
  assert.match(filebrowserSource, /export function closeFileViewer\(\)/);
  assert.match(terminalSource, /export function closeTerminal\(\)/);
  var topLevel = logsSource.slice(0, logsSource.indexOf("function nextRequestId"));
  assert.equal(/closeFileViewer\(\)|closeTerminal\(\)/.test(topLevel), false,
    "neither is called at module evaluation time");
});

test("Logs reuses the shared panel window controls rather than a new system", function () {
  assert.match(logsSource, /id="project-logs-wide"/);
  assert.match(logsSource, /id="project-logs-fullscreen"/);
  assert.match(logsSource, /id="project-logs-close"/);
  assert.match(logsSource, /aria-pressed="false"/);
  // panel-fullscreen is the existing shared class that already hides #app and
  // the title bar at desktop widths; Logs must use it, not reimplement it.
  assert.match(logsSource, /classList\.toggle\("panel-fullscreen"/);
  assert.match(filebrowserCss, /#main-panels:has\(\.panel-fullscreen:not\(\.hidden\)\) > #app \{ display: none; \}/);
  assert.match(filebrowserCss, /#main-column:has\(\.panel-fullscreen:not\(\.hidden\)\) > \.title-bar-content \{ display: none; \}/);

  // Fullscreen is dropped on close and on project switch, so a reopen is always
  // a bounded pane that leaves the conversation visible.
  assert.match(logsSource, /applyWindowState\(store\.get\('projectLogsWide'\), false\)/);
  assert.match(logsSource, /applyWindowState\(false, false\)/);
});

test("Logs is a bounded, resizable right pane on desktop and an overlay on mobile", function () {
  // Desktop: same geometry contract as #file-viewer and #terminal-container.
  assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*#project-logs-panel \{[\s\S]*width: 50%;[\s\S]*max-width: 720px;[\s\S]*min-width: 360px;/);
  assert.match(css, /#project-logs-panel \{[\s\S]*align-self: center;[\s\S]*flex-shrink: 0;/);
  assert.match(css, /animation: workbench-panel-in/);
  assert.match(filebrowserCss, /@keyframes workbench-panel-in/);

  // Resizable through the same width steps the other tools expose.
  assert.match(css, /#project-logs-panel\.project-logs-wide \{[\s\S]*width: 70%;[\s\S]*max-width: 1200px;/);
  assert.match(css, /#project-logs-panel\.panel-fullscreen \{[\s\S]*width: 100%;[\s\S]*max-width: none;/);

  // Mobile: full overlay with safe-area padding, and no meaningless size controls.
  assert.match(css, /@media \(max-width: 1023px\) \{[\s\S]*#project-logs-panel \{[\s\S]*position: fixed;[\s\S]*z-index: 300;/);
  assert.match(css, /padding-top: var\(--safe-top\);/);
  assert.match(css, /#project-logs-wide,\s*\n\s*#project-logs-fullscreen \{ display: none; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*#project-logs-panel \{ animation: none; \}/);

  // The old absolutely positioned overlay-on-#app geometry is gone.
  assert.doesNotMatch(css, /\.project-logs-panel \{[\s\S]*position: absolute;[\s\S]*inset: 0;/);
});

test("panel-relative layout keeps the ledger readable inside a narrow window", function () {
  // Index column is narrower in the bounded pane and widens when there is room.
  assert.match(css, /\.project-logs-layout \{[^}]*grid-template-columns: 220px minmax\(0, 1fr\)/s);
  assert.match(css, /#project-logs-panel\.project-logs-wide \.project-logs-layout,\s*\n#project-logs-panel\.panel-fullscreen \.project-logs-layout \{ grid-template-columns: 280px minmax\(0, 1fr\); \}/);
  // Document padding is panel-relative, not viewport-relative, except fullscreen.
  assert.match(css, /\.project-log-document \{[^}]*padding: 26px 24px/s);
  assert.match(css, /#project-logs-panel\.panel-fullscreen \.project-log-document,[\s\S]*padding: clamp\(28px, 5vw, 64px\)/);

  // The editor height must resolve to 220px bounded and 340px fullscreen. Both
  // selectors have the same specificity for the base rule, so declaration order
  // decides: assert the effective value, not merely that both strings exist.
  var textareaRules = [];
  var ruleRe = /([^{}]+)\{([^}]*)\}/g;
  var match;
  while ((match = ruleRe.exec(css))) {
    var selector = match[1].trim();
    if (selector.indexOf(".project-log-editor textarea") === -1) continue;
    var height = /min-height:\s*(\d+)px/.exec(match[2]);
    if (height) textareaRules.push({ selector: selector, minHeight: Number(height[1]), at: match.index });
  }
  assert.equal(textareaRules.length, 2, "exactly one bounded rule and one fullscreen override");

  var bounded = textareaRules.filter(function (rule) { return rule.selector.indexOf("panel-fullscreen") === -1; });
  var fullscreen = textareaRules.filter(function (rule) { return rule.selector.indexOf("panel-fullscreen") !== -1; });
  assert.equal(bounded.length, 1);
  assert.equal(fullscreen.length, 1);
  assert.equal(bounded[0].minHeight, 220, "the bounded pane resolves to 220px");
  assert.equal(fullscreen[0].minHeight, 340, "fullscreen resolves to 340px");
  assert.ok(bounded[0].at < fullscreen[0].at,
    "the fullscreen override is declared after the base rule so it wins the cascade");
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.project-log-row\.active/);
  assert.match(css, /\.project-log-markdown/);
});

test("markdown rendering, the editor, and project-switch reset are preserved", function () {
  assert.match(logsSource, /import \{ renderMarkdown, highlightCodeBlocks \} from '\.\/markdown\.js'/);
  assert.match(logsSource, /markdown\.innerHTML = renderMarkdown\(entry\.content \|\| entry\.body \|\| ""\)/);
  assert.match(logsSource, /highlightCodeBlocks\(markdown\)/);

  assert.match(logsSource, /project-log-title-input/);
  assert.match(logsSource, /project-log-kind-input/);
  assert.match(logsSource, /project-log-content-input/);
  assert.match(logsSource, /type: existing \? "project_log_update" : "project_log_create"/);
  assert.match(logsSource, /Title and record are required\./);
  assert.match(logsSource, /Logs are unavailable while disconnected\./);

  // Switching project closes the panel and clears every correlated request id.
  assert.match(logsSource, /if \(state\.currentSlug === previous\.currentSlug\) return;[\s\S]*closeProjectLogs\(\);[\s\S]*projectLogsEntries: \[\][\s\S]*projectLogsSaveRequestId: null/);
});
