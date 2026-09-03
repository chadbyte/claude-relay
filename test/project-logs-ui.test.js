var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
function source(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

// The tool registry lives in tool-palette-order.js; tool-palette.js owns the DOM.
var paletteSource = source("lib/public/modules/tool-palette-order.js");
var logsSource = source("lib/public/modules/project-logs.js");
var renderSource = source("lib/public/modules/project-logs-render.js");
var ambientSource = source("lib/public/modules/project-logs-ambient.js");
var appSource = source("lib/public/app.js");
var messagesSource = source("lib/public/modules/app-messages.js");
var mobileSource = source("lib/public/modules/sidebar-mobile.js");
var css = source("lib/public/css/project-logs.css");
var filebrowserCss = source("lib/public/css/filebrowser.css");

test("Project Logs occupies the project tool slot on desktop and mobile", function () {
  assert.match(paletteSource, /id: "project-logs-btn",\s+icon: "notebook-tabs",\s+label: "Logs"/);
  assert.match(mobileSource, /icon: "notebook-tabs", label: "Logs", action: "project-logs"/);
});

test("there is no canonical create or edit UI anywhere in the client", function () {
  var combined = logsSource + renderSource;
  // The ledger is authored by agent sessions, so the client must not offer or
  // send any canonical mutation.
  assert.equal(/project_log_create|project_log_update/.test(combined), false,
    "the client never sends a canonical mutation message");
  assert.equal(/New log|Create the first log|Save log/.test(combined), false, "no create affordance");
  assert.equal(/project-log-title-input|project-log-kind-input|project-log-content-input/.test(combined), false,
    "no entry editor fields");
  assert.equal(/renderEditor|project-log-edit\b/.test(combined), false, "no editor at all");
  assert.equal(/project-logs-new/.test(combined + css), false, "no create button styling either");

  // Commenting is the only mutation the client performs.
  assert.match(logsSource, /type: "project_log_comment", requestId: requestId, ref: ref, body: body/);
  assert.match(renderSource, /handlers\.onComment\(entry\.ref, value, status, input\)/);
});

test("the client uses store state, direct imports, and correlated requests", function () {
  assert.match(logsSource, /import \{ store \} from '\.\/store\.js'/);
  assert.match(logsSource, /import \{ getWs \} from '\.\/ws-ref\.js'/);
  assert.match(logsSource, /projectLogsListRequestId/);
  assert.match(logsSource, /projectLogsReadRequestId/);
  assert.match(logsSource, /projectLogsCommentRequestId/);
  assert.match(appSource, /projectLogsView: 'list'/);
  assert.match(appSource, /projectLogsCategory: ''/);
  assert.match(appSource, /projectLogsCommentRequestId: null/);
  assert.match(messagesSource, /case "project_log_commented":[\s\S]*handleProjectLogCommented\(msg\)/);
  assert.equal(/project_log_saved/.test(messagesSource), false, "the retired response is no longer routed");
  [["project-logs.js", logsSource], ["project-logs-render.js", renderSource]].forEach(function (pair) {
    assert.equal(/=>/.test(pair[1]), false, "no arrow functions in " + pair[0]);
    assert.equal(/^\s*(const|let)\s/m.test(pair[1]), false, "var only in " + pair[0]);
    assert.equal(/localStorage|alert\(|confirm\(|prompt\(/.test(pair[1]), false, "no storage or native dialogs in " + pair[0]);
  });
});

test("Logs is one navigation stack, not a master/detail split", function () {
  // Two sibling regions in the pane, one visible at a time.
  assert.match(logsSource, /id="project-logs-list"/);
  assert.match(logsSource, /id="project-logs-detail"/);
  assert.equal(/project-logs-layout|project-logs-index/.test(logsSource + css), false,
    "the two-column frame is gone");
  assert.equal(/grid-template-columns/.test(css), false, "no split columns remain");

  var showList = logsSource.slice(logsSource.indexOf("function showList()"), logsSource.indexOf("function showDetail("));
  assert.match(showList, /detailEl\.classList\.add\("hidden"\)/);
  assert.match(showList, /listEl\.classList\.remove\("hidden"\)/);
  assert.match(showList, /backBtn\.classList\.add\("hidden"\)/);

  var showDetail = logsSource.slice(logsSource.indexOf("function showDetail(entry)"), logsSource.indexOf("// --- Requests"));
  assert.match(showDetail, /listEl\.classList\.add\("hidden"\)/);
  assert.match(showDetail, /detailEl\.classList\.remove\("hidden"\)/);
  assert.match(showDetail, /backBtn\.classList\.remove\("hidden"\)/);
});

test("Back returns to the list preserving query, filter, and scroll", function () {
  assert.match(logsSource, /id="project-logs-back"/);
  assert.match(logsSource, /backBtn\.addEventListener\("click", function \(\) \{ pinOnInteraction\(\); showList\(\); \}\)/,
    "Back returns to the list and commits a preview on the way");
  // Scroll is captured on the way in and restored on the way back.
  assert.match(logsSource, /store\.set\(\{ projectLogsListScroll: listEl\.scrollTop/);
  assert.match(logsSource, /listEl\.scrollTop = store\.get\('projectLogsListScroll'\) \|\| 0;/);
  // The list is re-shown rather than re-requested, so the search box and the
  // category select keep their values.
  var showList = logsSource.slice(logsSource.indexOf("function showList()"), logsSource.indexOf("function showDetail("));
  assert.equal(/requestList\(\)/.test(showList), false, "returning does not refetch and reset the query");
  assert.equal(/searchEl\.value = /.test(logsSource), false, "the query is never cleared");
});

test("detail renders Markdown through the shared renderer and shows the record metadata", function () {
  assert.match(renderSource, /import \{ renderMarkdown, highlightCodeBlocks \} from '\.\/markdown\.js'/);
  assert.match(renderSource, /markdown\.innerHTML = renderMarkdown\(entry\.body \|\| ""\)/);
  assert.match(renderSource, /highlightCodeBlocks\(markdown\)/);
  // Category, priority, revision, agent author and time, then the summary.
  assert.match(renderSource, /chip\.dataset\.category = entry\.category \|\| entry\.kind/);
  assert.match(renderSource, /flag\.dataset\.priority = entry\.priority/);
  assert.match(renderSource, /"Revision " \+ \(entry\.revisions \|\| 1\)/);
  assert.match(renderSource, /authorLine\(entry\)/);
  assert.match(renderSource, /setText\(header, "\.project-log-doc-summary", entry\.summary \|\| ""\)/);
});

test("a canonical entry is attributed to the Project Driver, not the account owner", function () {
  var authorFn = renderSource.slice(renderSource.indexOf("function authorLine(entry)"), renderSource.indexOf("function vendorLabel("));

  // The server keeps full blame on the author object, but a session-authored
  // record must not read as if the human owner wrote it.
  assert.match(authorFn, /if \(actor\.type === "session"\)/);
  assert.match(authorFn, /"Project Driver \(" \+ vendorLabel\(actor\.vendor\) \+ "\)" : "Project Driver"/);
  assert.equal(/actorLabel\(actor\)[\s\S]*actor\.type === "session"/.test(authorFn), false,
    "the owner display name is never used for a session-authored entry");

  // The vendor is title-cased, so it reads as "Project Driver (Claude)".
  assert.match(renderSource, /function vendorLabel\(vendor\)/);
  assert.match(renderSource, /vendor\.charAt\(0\)\.toUpperCase\(\) \+ vendor\.slice\(1\)/);

  // A human comment is still attributed to the human.
  var comments = renderSource.slice(renderSource.indexOf("function renderComments("), renderSource.indexOf("export function renderDetail"));
  assert.match(comments, /actorLabel\(comment\.author\)/);
  assert.equal(/authorLine/.test(comments), false, "a comment never borrows the canonical byline");
  assert.match(renderSource, /source\.displayName \|\| source\.userName \|\| source\.userId/,
    "actorLabel still prefers a human display name");

  // Both the ledger row and the detail byline use the canonical author line.
  assert.match(renderSource, /var parts = \[authorLine\(entry\), relativeTime/);
  assert.match(renderSource, /authorLine\(entry\),\s*\n\s*formatTime/);
});

test("the ledger row reveals history without opening the record", function () {
  var row = renderSource.slice(renderSource.indexOf("function renderRow("), renderSource.indexOf("export function renderList"));
  assert.match(row, /categoryLabel\(entry\.category \|\| entry\.kind\)/, "category chip");
  assert.match(row, /entry\.priority && entry\.priority !== "normal"/, "priority only when it matters");
  assert.match(row, /entry\.title \|\| "Untitled log"/);
  assert.match(row, /summary\.textContent = entry\.summary/);
  assert.match(row, /parts\.push\("v" \+ entry\.revisions\)/, "revision count");
  assert.match(row, /entry\.commentCount \+ \(entry\.commentCount === 1 \? " comment" : " comments"\)/);
  assert.match(row, /relativeTime\(entry\.updatedAt \|\| entry\.createdAt\)/);
  assert.equal(/entry\.body/.test(row), false, "a row never renders the record body");
});

test("category labels are project-defined and rendered safely", function () {
  // No label table and no per-category CSS: the vocabulary is not known at
  // build time, so nothing may be hard-coded against it.
  assert.equal(/CATEGORY_LABELS\s*=/.test(renderSource), false, "no exhaustive label map");
  assert.equal(/data-category="/.test(css), false, "no per-category CSS selectors");
  assert.equal(/\.project-log-chip\.[a-z]/.test(css), false, "no exhaustive chip classes");
  assert.match(css, /Categories are project-defined/, "the neutral styling is deliberate");

  // Priority keeps the only stable colour, because urgency is a fixed scale.
  assert.match(css, /\.project-log-priority\[data-priority="urgent"\]/);
  assert.match(css, /\.project-log-priority\[data-priority="important"\]/);

  // Any label is de-slugged for display and reaches the DOM as text, never markup.
  assert.match(renderSource, /export function categoryLabel\(value\)/);
  // Any script, not just Latin: labels are only ever de-slugged for display.
  assert.equal(/[a-z]\.charCodeAt|\/\[a-z\]\//.test(renderSource), false,
    "the client makes no ASCII assumption about a category label");
  assert.match(renderSource, /chip\.textContent = categoryLabel\(entry\.category \|\| entry\.kind\)/);
  assert.match(renderSource, /option\.textContent = categoryLabel\(categories\[i\]\)/);
  assert.equal(/innerHTML\s*=\s*[^;]*categoryLabel/.test(renderSource), false,
    "a category is never interpolated into markup");
  // The chip is length-bounded so a long label cannot break the row.
  assert.match(css, /\.project-log-chip \{[^}]*text-overflow: ellipsis/s);
});

test("category filtering is a compact control, not a dashboard", function () {
  assert.match(renderSource, /export function renderFilter\(container, categories, selected, onChange\)/);
  assert.match(renderSource, /select\.className = "project-logs-filter"/);
  assert.match(renderSource, /all\.textContent = "All categories"/);
  assert.match(logsSource, /renderFilter\(filterEl, msg\.categories, store\.get\('projectLogsCategory'\), applyFilter\)/);
  assert.match(logsSource, /category: store\.get\('projectLogsCategory'\) \|\| ""/);
  assert.match(css, /\.project-logs-filter \{/);
  // Server-provided vocabulary, not a hard-coded client list.
  assert.match(logsSource, /Array\.isArray\(msg\.categories\)/);
  assert.equal(/"decision"|"security"|"operations"|"incident"/.test(logsSource + renderSource), false,
    "the client hard-codes no category name at all");
});

test("the discussion section shows attributed comments and a composer", function () {
  var comments = renderSource.slice(renderSource.indexOf("function renderComments("), renderSource.indexOf("export function renderDetail"));
  assert.match(comments, /"Discussion \(" \+ comments\.length \+ "\)"/);
  assert.match(comments, /actorLabel\(comment\.author\) \+ " · " \+ relativeTime\(comment\.at\)/);
  assert.match(comments, /body\.textContent = comment\.body \|\| ""/);

  assert.match(renderSource, /id="project-log-comment-input"/);
  assert.match(renderSource, /A comment cannot be empty\./);
  assert.match(logsSource, /statusEl\.textContent = "Logs are unavailable while disconnected\."/);
  // A posted comment refreshes both the open record and the ledger counts.
  var handler = logsSource.slice(logsSource.indexOf("export function handleProjectLogCommented"));
  assert.match(handler, /showDetail\(msg\.entry\)/);
  assert.match(handler, /requestList\(\)/);
});

test("the bounded right workbench pane is preserved", function () {
  assert.match(logsSource, /document\.getElementById\("main-panels"\)/);
  assert.match(logsSource, /panels\.appendChild\(panel\)/);
  assert.doesNotMatch(logsSource, /getElementById\("messages"\)|getElementById\("input-area"\)|title-bar-content/);

  assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*#project-logs-panel \{[\s\S]*width: 50%;[\s\S]*max-width: 720px;[\s\S]*min-width: 360px;/);
  assert.match(css, /animation: workbench-panel-in/);
  assert.match(filebrowserCss, /@keyframes workbench-panel-in/);
  assert.match(css, /#project-logs-panel\.project-logs-wide \{[\s\S]*width: 70%;/);
  assert.match(css, /#project-logs-panel\.panel-fullscreen \{[\s\S]*width: 100%;/);
  assert.match(css, /@media \(max-width: 1023px\) \{[\s\S]*#project-logs-panel \{[\s\S]*position: fixed;[\s\S]*z-index: 300;/);
  assert.match(css, /padding-top: var\(--safe-top\);/);

  // Still claims the single right slot and still closes cleanly.
  assert.match(logsSource, /try \{ closeFileViewer\(\); \} catch \(e\) \{\}/);
  assert.match(logsSource, /try \{ closeTerminal\(\); \} catch \(e\) \{\}/);
  assert.match(logsSource, /applyWindowState\(store\.get\('projectLogsWide'\), false\)/);
});

test("switching project resets the ledger view completely", function () {
  var init = logsSource.slice(logsSource.indexOf("export function initProjectLogs"));
  assert.match(init, /if \(state\.currentSlug === previous\.currentSlug\) return;/);
  assert.match(init, /closeProjectLogs\(\);/);
  assert.match(init, /projectLogsView: "list"/);
  assert.match(init, /projectLogsCategory: ""/);
  assert.match(init, /projectLogsListScroll: 0/);
  assert.match(init, /projectLogsCommentRequestId: null/);
});

test("comment status and the Project Driver response are shown under each comment", function () {
  var comments = renderSource.slice(renderSource.indexOf("function renderComments("), renderSource.indexOf("// A compact, read-only record"));

  // Every state a comment can be in has an honest label.
  assert.match(renderSource, /"pending": "Awaiting Project Driver review"/);
  assert.match(renderSource, /"clarification-needed": "Project Driver asked a question"/);
  assert.match(renderSource, /"incorporated": "Incorporated"/);
  assert.match(renderSource, /"declined": "Declined"/);

  assert.match(comments, /badge\.dataset\.status = status/);
  assert.match(comments, /badge\.textContent = COMMENT_STATUS_LABELS\[status\] \|\| status/);
  assert.match(comments, /var status = comment\.status \|\| "pending"/, "an unreviewed comment reads as pending");

  // The Driver's answer sits beneath the comment it answers.
  assert.match(comments, /comment\.review && comment\.review\.response/);
  assert.match(comments, /responseBody\.textContent = comment\.review\.response/);
  assert.match(comments, /parts\.push\("revision " \+ comment\.review\.revision\)/);
  assert.match(comments, /var parts = \["Project Driver"\]/);
  // Rendered as text, never markup.
  assert.equal(/innerHTML[^;]*comment\.review/.test(comments), false);
  assert.match(css, /\.project-log-comment-status-badge\[data-status="incorporated"\]/);
  assert.match(css, /\.project-log-comment-response \{/);
});

test("posting a comment settles to Awaiting review rather than Posting", function () {
  assert.match(logsSource, /statusEl\.textContent = "Posting\.\.\."/);
  assert.match(logsSource, /store\.set\(\{ projectLogsCommentStatusEl: statusEl \}\)/);
  var handler = logsSource.slice(logsSource.indexOf("export function handleProjectLogCommented"));
  assert.match(handler, /pendingStatus\.textContent = "Awaiting Project Driver review"/);
  assert.match(handler, /store\.set\(\{ projectLogsCommentStatusEl: null \}\)/);
  assert.match(appSource, /projectLogsCommentStatusEl: null/);
});

test("the version history is a read-only timeline with no revert control", function () {
  var history = renderSource.slice(renderSource.indexOf("function renderHistory("), renderSource.indexOf("function historyVerb("));
  assert.match(history, /"Version history \(" \+ history\.length \+ "\)"/);
  assert.match(history, /if \(history\.length < 2\) return null;/, "a single-revision entry needs no timeline");
  assert.match(history, /label\.textContent = "v" \+ revision\.revision/);
  assert.match(history, /revision\.changed\.join\(", "\)/);
  assert.match(history, /reason\.textContent = revision\.reason/);
  assert.match(renderSource, /revision\.revertedFrom \? "Reverted to v" \+ revision\.revertedFrom/);
  assert.match(renderSource, /if \(revision\.op === "incorporate"\) return "Incorporated a comment"/);

  // Restoring a revision is the Driver's decision, so there is no control here.
  assert.equal(/revert_log|project_log_revert|Revert<|onRevert/.test(renderSource + logsSource), false,
    "the client never offers or sends a revert");
  assert.equal(/review_log_comment|project_log_review/.test(renderSource + logsSource), false,
    "nor a review");
  // Metadata only: the timeline never renders a body.
  assert.equal(/revision\.snapshot|revision\.body/.test(history), false);
  assert.match(css, /\.project-log-history \{/);
});


// --- Ambient discovery ----------------------------------------------------

test("the edge handle is a real accessible control, not a hover-only affordance", function () {
  assert.match(ambientSource, /handle = document\.createElement\("button"\)/);
  assert.match(ambientSource, /handle\.type = "button"/);
  assert.match(ambientSource, /handle\.setAttribute\("aria-label", "Open Project Logs"\)/);
  assert.match(ambientSource, /handle\.title = handle\.getAttribute\("aria-label"\)/);
  assert.match(ambientSource, /handle\.addEventListener\("click", function/, "click works without hover");
  assert.match(ambientSource, /handle\.addEventListener\("focus", function/, "so does keyboard focus");
  // The unread state is announced, not only drawn.
  assert.match(ambientSource, /" new entry" : " new entries"/);
  assert.match(css, /\.project-logs-handle:focus-visible \{ outline: 2px solid var\(--accent\)/);
  // Slim, on the right boundary, desktop only.
  assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*\.project-logs-handle \{[\s\S]*right: 0;/);
  assert.match(css, /@media \(max-width: 1023px\) \{\s*\n\s*\.project-logs-handle \{ display: none; \}/);
});

test("hover preview reveals without opening, and any interaction pins", function () {
  // Hover is only wired where a real pointer exists.
  assert.match(ambientSource, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(ambientSource, /if \(hoverCapable\) \{\s*\n\s*handle\.addEventListener\("pointerenter", showPreview\);/);
  assert.match(ambientSource, /handle\.addEventListener\("pointerleave", scheduleClose\)/);

  // Moving from the handle into the panel keeps it revealed.
  assert.match(ambientSource, /export function bindPanelHover\(panel\)/);
  assert.match(ambientSource, /panel\.addEventListener\("pointerenter", cancelClose\)/);
  assert.match(logsSource, /bindPanelHover\(panel\)/);

  // A forgiving delay, and a pinned pane is never closed by the pointer.
  assert.match(ambientSource, /var CLOSE_DELAY_MS = (\d+);/);
  var delay = Number(/var CLOSE_DELAY_MS = (\d+);/.exec(ambientSource)[1]);
  assert.ok(delay >= 250 && delay <= 800, "the delay is forgiving but not sticky, got " + delay);
  assert.match(ambientSource, /if \(store\.get\('projectLogsPinned'\)\) return;/);

  // Escape closes a preview.
  assert.match(ambientSource, /if \(event\.key !== "Escape"\) return;[\s\S]*hidePreview\(\)/);

  // Meaningful interactions commit the preview.
  assert.match(logsSource, /function pinOnInteraction\(\)/);
  assert.match(logsSource, /searchEl\.addEventListener\("focus", pinOnInteraction\)/);
  assert.match(logsSource, /panel\.addEventListener\("pointerdown", pinOnInteraction\)/);
  assert.match(logsSource, /function applyFilter\(category\) \{\s*\n\s*pinOnInteraction\(\);/);
  assert.match(logsSource, /function submitComment\(ref, body, statusEl, inputEl\) \{\s*\n\s*pinOnInteraction\(\);/);
  // A preview is visually distinct from a committed open.
  assert.match(css, /#project-logs-panel\.project-logs-previewing \{/);
});

test("an update marks the ambient cues and never opens the pane", function () {
  var handler = logsSource.slice(logsSource.indexOf("export function handleProjectLogUpdated"));
  handler = handler.slice(0, handler.indexOf("export function handleProjectLogsError"));
  assert.match(handler, /noteCanonicalUpdate\(msg\)/);
  assert.equal(/openProjectLogs|revealPreview|showDetail|pinFromPreview|focus\(/.test(handler), false,
    "an update never opens, reveals, or steals focus");
  // The list only refreshes when it is already the visible surface.
  assert.match(handler, /if \(store\.get\('projectLogsOpen'\) && store\.get\('projectLogsView'\) !== "detail"\) requestList\(\)/);

  // Both surfaces carry the marker.
  assert.match(ambientSource, /handle\.classList\.toggle\("has-unread", unread > 0\)/);
  assert.match(ambientSource, /button\.classList\.toggle\("project-logs-unread", unread > 0\)/);
  assert.match(paletteSource, /id: "project-logs-btn"[\s\S]*countId: "project-logs-count"/);
  assert.match(css, /\.project-logs-handle\.has-unread \.project-logs-handle-notch \{ background: var\(--accent\)/);

  // No OS notification, sound, modal, or focus theft anywhere in the client.
  assert.equal(/new Notification|Audio\(|\.play\(\)|alert\(|confirm\(/.test(logsSource + ambientSource), false);
});

test("updates are deduped by ref and revision so replays do not re-pulse", function () {
  assert.match(ambientSource, /var seen = store\.get\('projectLogsSeenRevisions'\) \|\| \{\}/);
  assert.match(ambientSource, /if \(seen\[key\] >= msg\.revision\) return false;/);
  assert.match(ambientSource, /if \(!msg \|\| !msg\.ref \|\| !msg\.revision\) return false;/);
  // An update while the pane is open is acknowledged, not counted.
  assert.match(ambientSource, /projectLogsUnread: visible \? 0 :/);
  assert.match(ambientSource, /if \(!visible\) flourish\(\)/);
  assert.match(appSource, /projectLogsSeenRevisions: \{\}/);
  assert.equal(/localStorage|sessionStorage/.test(ambientSource), false, "no client-side persistence");
});

test("reduced motion keeps the static marker and drops the flourish", function () {
  assert.match(ambientSource, /function prefersReducedMotion\(\)/);
  assert.match(ambientSource, /if \(prefersReducedMotion\(\)\) return;/);
  var flourish = ambientSource.slice(ambientSource.indexOf("function flourish()"));
  flourish = flourish.slice(0, flourish.indexOf("export function acknowledgeUpdates"));
  assert.equal(/document\.body|#app|main-panels/.test(flourish), false, "nothing whole-screen is animated");

  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.project-logs-pulse \{ animation: none; \}/);
  // The static unread colour is outside the motion query, so it survives.
  // There is more than one reduced-motion block, so target the one that owns
  // the pulse and read only as far as its closing brace.
  var pulseRule = css.indexOf(".project-logs-pulse { animation: none; }");
  assert.notEqual(pulseRule, -1);
  var blockStart = css.lastIndexOf("@media (prefers-reduced-motion: reduce)", pulseRule);
  var block = css.slice(blockStart, css.indexOf("}", css.indexOf(".project-logs-handle-notch { transition: none; }", blockStart)) + 1);
  assert.match(block, /\.project-logs-pulse \{ animation: none; \}/);
  assert.equal(/has-unread|background: var\(--accent\)/.test(block), false,
    "the unread marker is never inside the reduced-motion block");
});

test("opening acknowledges, and project switch resets without animating", function () {
  var open = logsSource.slice(logsSource.indexOf("export function openProjectLogs"));
  open = open.slice(0, open.indexOf("export function closeProjectLogs"));
  assert.match(open, /acknowledgeUpdates\(\)/);
  assert.match(open, /projectLogsPinned: true, projectLogsPreview: false/);
  assert.match(open, /panel\.classList\.remove\("project-logs-previewing"\)/);

  var init = logsSource.slice(logsSource.indexOf("export function initProjectLogs"));
  assert.match(init, /resetAmbient\(\)/);
  assert.match(ambientSource, /export function resetAmbient\(\)[\s\S]*projectLogsUnread: 0[\s\S]*projectLogsSeenRevisions: \{\}/);
  // Acknowledgement is server-free: no preference write, no storage.
  assert.equal(/fetch\(|localStorage/.test(ambientSource), false);
});
