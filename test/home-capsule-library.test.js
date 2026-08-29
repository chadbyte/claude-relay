var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var indexSource = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var appSource = fs.readFileSync(path.join(root, "lib/public/app.js"), "utf8");
var dockSource = fs.readFileSync(path.join(root, "lib/public/modules/home-dock.js"), "utf8");
var resizeSource = fs.readFileSync(path.join(root, "lib/public/modules/home-dock-resize.js"), "utf8");
var sidebarSource = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
var librarySource = fs.readFileSync(path.join(root, "lib/public/modules/home-capsule-library.js"), "utf8");
var toolsSource = fs.readFileSync(path.join(root, "lib/public/modules/home-tools.js"), "utf8");
var chatSource = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
var cssSource = fs.readFileSync(path.join(root, "lib/public/css/home-capsule-library.css"), "utf8");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="whats-new-article"'));

test("Capsules sidebar entry is an accessible Workbench controller", function () {
  assert.match(homeMarkup, /id="home-sidebar-capsules"[^>]*aria-label="Capsules"[^>]*aria-expanded="false"[^>]*aria-controls="home-tool-workbench"/);
  assert.doesNotMatch(homeMarkup, /id="home-sidebar-capsules"[^>]*aria-disabled/);
  assert.match(sidebarSource, /openHomeCapsules/);
  assert.match(sidebarSource, /home-sidebar-capsules"\)\.addEventListener\("click", openCapsulesFromSidebar\)/);
});

test("Capsules resumes the last installed Capsule or opens Library without a fake persisted tool", function () {
  assert.match(dockSource, /export function openHomeCapsules\(\)/);
  assert.match(dockSource, /lastActiveId && toolsById\[lastActiveId\][\s\S]*openHomeDock\(lastActiveId\)/);
  assert.match(dockSource, /openHomeCapsuleLibrary\(\)/);
  assert.match(dockSource, /dockActiveToolId: null,[\s\S]*dockLibraryOpen: true/);
  assert.match(dockSource, /activeToolId: store\.get\('dockActiveToolId'\) \|\| null/);
  assert.doesNotMatch(dockSource, /activeToolId: ["']library["']/);
  assert.match(appSource, /dockActiveToolId: null/);
  assert.match(dockSource, /store\.get\('dockActiveToolId'\) === toolId[\s\S]*dockActiveToolId: null,[\s\S]*persistDock\(\)/);
});

test("complete registry sync clears a stale persisted Capsule and opens Library when needed", function () {
  assert.match(appSource, /homeToolRegistryLoaded: false/);
  assert.match(toolsSource, /var completeSync = !msg\.requestedToolId/);
  assert.match(toolsSource, /if \(completeSync\) \{[\s\S]*previousIds/);
  assert.match(toolsSource, /if \(completeSync\) store\.set\(\{ homeToolRegistryLoaded: true \}\)/);
  assert.match(toolsSource, /if \(completeSync && reconcileDockActiveTool\(\)\) return;/);
  assert.match(dockSource, /export function reconcileDockActiveTool\(\)/);
  assert.match(dockSource, /if \(!activeToolId \|\| toolsById\[activeToolId\]\) return false/);
  assert.match(dockSource, /dockActiveToolId: null,[\s\S]*dockLibraryOpen: store\.get\('dockOpen'\) === true/);
  assert.match(dockSource, /renderDock\(\);[\s\S]*persistDock\(\);[\s\S]*return true/);
});

test("valid saved Capsule IDs and incremental tool responses bypass reconciliation", function () {
  assert.match(dockSource, /toolsById\[activeToolId\]\) return false/);
  assert.match(toolsSource, /var completeSync = !msg\.requestedToolId/);
  assert.doesNotMatch(toolsSource, /if \(msg\.requestedToolId && reconcileDockActiveTool/);
  assert.match(toolsSource, /if \(completeSync && reconcileDockActiveTool\(\)\) return;[\s\S]*renderDock\(\)/);
});

test("dock preference arriving after registry load reconciles its saved Capsule", function () {
  assert.match(dockSource, /export function handleHomeDockState\(msg\)[\s\S]*dockActiveToolId: saved\.activeToolId \|\| null/);
  assert.match(dockSource, /syncDockState\(\);[\s\S]*store\.get\('homeToolRegistryLoaded'\) && reconcileDockActiveTool\(\)/);
  assert.match(dockSource, /reconcileDockActiveTool\(\)\) return;[\s\S]*renderDock\(\)/);
});

test("dock preference does not reconcile against an incomplete registry", function () {
  assert.match(appSource, /homeToolRegistryLoaded: false/);
  assert.match(toolsSource, /export function requestTools\(\)[\s\S]*store\.set\(\{ homeToolRegistryLoaded: false \}\)[\s\S]*type: "tools_list"/);
  assert.match(dockSource, /if \(store\.get\('homeToolRegistryLoaded'\) && reconcileDockActiveTool\(\)\) return;/);
  assert.doesNotMatch(dockSource, /if \(!store\.get\('homeToolRegistryLoaded'\)\) reconcileDockActiveTool/);
  assert.match(toolsSource, /if \(completeSync\) store\.set\(\{ homeToolRegistryLoaded: true \}\)/);
});

test("Capsule Library is a native host surface over shared installed-tool state", function () {
  assert.match(dockSource, /renderHomeCapsuleLibrary\(contentEl, store\.get\('installedTools'\) \|\| \[\], openLibraryCapsule\)/);
  assert.match(toolsSource, /store\.set\(\{ installedTools: tools \}\)/);
  assert.match(librarySource, /definition\.manifest/);
  assert.match(librarySource, /document\.createElement\("ul"\)/);
  assert.match(librarySource, /row\.addEventListener\("click", function \(\) \{ openCapsule\(manifest\.id\); \}\)/);
  assert.doesNotMatch(librarySource, /tool_install|tool_remove|uninstall|localStorage|alert\(|confirm\(|prompt\(/);
});

test("Library selection opens the real registered Capsule and keeps dock tabs", function () {
  assert.match(dockSource, /function openLibraryCapsule\(toolId\)[\s\S]*activateTool\(toolId\)[\s\S]*focusActiveCapsuleTab\(\)/);
  assert.match(dockSource, /for \(var i = 0; i < tools\.length; i\+\+\)[\s\S]*dataset\.dockToolId = tool\.id/);
  assert.match(dockSource, /tab\.addEventListener\("click", function \(\) \{ activateTool\(tool\.id\); \}\)/);
  assert.match(dockSource, /dockLibraryOpen: false/);
});

test("hidden Capsule activity lives on the sidebar instead of conversation Tools", function () {
  assert.match(homeMarkup, /id="home-sidebar-capsules-activity"/);
  assert.doesNotMatch(homeMarkup, /id="home-tools-activity"/);
  assert.match(dockSource, /home-sidebar-capsules-activity/);
  assert.match(dockSource, /activity\.classList\.toggle\("is-active", hasActivity\)/);
  assert.match(dockSource, /dockHasActivity: true, dockActivityToolId: toolId \|\| null/);
  assert.match(dockSource, /dockHasActivity: false/);
});

test("Stage 7 preserves Workbench controls, suggestions, runtime, and durable dock preference", function () {
  assert.match(dockSource, /initHomeDockResize\(\)/);
  assert.match(dockSource, /home-dock-collapse/);
  assert.match(dockSource, /home-dock-focus/);
  assert.match(dockSource, /home-dock-return/);
  assert.match(resizeSource, /home_dock_set|clay:home-dock-width-commit/);
  assert.match(chatSource, /openHomeDock\("board"\)/);
  assert.match(toolsSource, /createToolRuntime/);
  assert.match(toolsSource, /handleToolStorageResult/);
  assert.match(dockSource, /dockOpen: store\.get\('dockOpen'\) === true,[\s\S]*dockWidth: store\.get\('dockWidth'\),[\s\S]*activeToolId:/);
});

test("Capsule Library is responsive and moves focus into visible Workbench content", function () {
  assert.match(librarySource, /aria-labelledby", "home-capsule-library-title"/);
  assert.match(librarySource, /title\.tabIndex = -1/);
  assert.match(librarySource, /row\.setAttribute\("aria-label", "Open " \+ \(manifest\.name \|\| manifest\.id\) \+ " Capsule"\)/);
  assert.match(dockSource, /home-capsule-library-title[\s\S]*title\.focus\(\)/);
  assert.match(dockSource, /home-dock-switcher \.home-dock-tool\.active[\s\S]*activeTab\.focus\(\)/);
  assert.match(cssSource, /@media \(max-width: 768px\)/);
  assert.match(sidebarSource, /openHomeCapsules\(\);[\s\S]*closeNarrowDrawer\(false\)/);
});
