var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var read = function (relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); };
var indexSource = read("lib/public/index.html");
var appSource = read("lib/public/app.js");
var chatSource = read("lib/public/modules/home-mate-chat.js");
var dockSource = read("lib/public/modules/home-dock.js");
var propertiesSource = read("lib/public/modules/home-mate-properties.js");
var managementSource = read("lib/public/modules/mate-management.js");
var sidebarMatesSource = read("lib/public/modules/sidebar-mates.js");
var sidebarPresenceSource = read("lib/public/modules/sidebar-presence.js");
var sidebarSource = read("lib/public/modules/home-sidebar.js");
var messagesSource = read("lib/public/modules/app-messages.js");
var messageRouterSource = read("lib/public/modules/app-message-router.js");
var connectionSource = read("lib/public/modules/app-connection.js");
var serverSource = read("lib/server-home-chat.js");
var cssSource = read("lib/public/css/home-mate-backstage.css");
var hubCssSource = read("lib/public/css/home-hub.css");
var styleSource = read("lib/public/style.css");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="whats-new-article"'));

test("first-depth selected Mate actions open backstage and keep Debate coherent", function () {
  assert.match(chatSource, /export function openHomeMateAction\(kind\)/);
  assert.match(chatSource, /kind === "memory" \|\| kind === "knowledge" \|\| kind === "model" \|\| kind === "settings"[\s\S]*openHomeMateProperty\(kind, mate\.id, getMateName\(mate\)\)/);
  assert.match(chatSource, /window\.dispatchEvent\(new CustomEvent\("clay:home-debate"\)\)/);
  assert.match(chatSource, /openDebateModal\(\{[\s\S]*dmContext: messages\.map/);
  assert.doesNotMatch(chatSource + homeMarkup, /home-mate-actions-menu|role="menuitem"|home-sidebar-mate-overflow/);
  assert.match(sidebarSource, /openMateActionFromSidebar\("memory"\)/);
  assert.match(sidebarSource, /openMateActionFromSidebar\("knowledge"\)/);
  assert.match(sidebarSource, /openMateActionFromSidebar\("model"\)/);
  assert.match(sidebarSource, /openMateActionFromSidebar\("settings"\)/);
  assert.match(sidebarSource, /openMateActionFromSidebar\("debate"\)/);
});

test("Mate action triggers keep their surfaces hosted by Workbench", function () {
  assert.match(propertiesSource, /openHomeBackstage\(\{ label: kindLabel\(kind\), render: renderBackstage, onClose: clearActiveState \}\)/);
  assert.match(dockSource, /backstageView\.render\(contentEl, closeHomeBackstage\)/);
  assert.match(appSource, /dockBackstageOpen: false/);
  assert.match(homeMarkup, />Memory<\/span>[\s\S]*>Knowledge<\/span>[\s\S]*>Mate settings<\/span>/);
  assert.doesNotMatch(sidebarSource, /openHomeMateProperty|home_mate_memory|home_mate_knowledge/);
  assert.doesNotMatch(propertiesSource, /document\.body\.appendChild|home-mate-property-overlay/);
});

test("ephemeral backstage state preserves the real Capsule preference and tabs", function () {
  assert.match(dockSource, /function preference\(\)[\s\S]*dockOpen:[\s\S]*dockWidth:[\s\S]*activeToolId: store\.get\('dockActiveToolId'\) \|\| null/);
  assert.match(dockSource, /export function openHomeBackstage\(view\)[\s\S]*dockOpen: true,[\s\S]*dockFocus: false,[\s\S]*dockBackstageOpen: true/);
  assert.doesNotMatch(dockSource, /openHomeBackstage\(view\)[\s\S]{0,300}dockActiveToolId:/);
  assert.match(dockSource, /for \(var i = 0; i < tools\.length; i\+\+\)[\s\S]*dataset\.dockToolId = tool\.id/);
  assert.doesNotMatch(propertiesSource, /registerDockTool|dockActiveToolId|activeToolId|toolId/);
  assert.doesNotMatch(propertiesSource + dockSource, /["'](?:memory|knowledge|settings)-capsule["']/);
});

test("backstage immediately preserves Library when no active Capsule exists", function () {
  assert.match(dockSource, /var backstageReturnTarget = null/);
  assert.match(dockSource, /var activeId = store\.get\('dockActiveToolId'\)/);
  assert.match(dockSource, /activeId && toolsById\[activeId\][\s\S]*\{ type: "library" \}/);
  assert.match(dockSource, /dockLibraryOpen: backstageReturnTarget\.type === "library"/);
  assert.match(dockSource, /var returnTarget = backstageReturnTarget[\s\S]*dockLibraryOpen: !returnToCapsule/);
  assert.match(dockSource, /if \(!returnToCapsule\)[\s\S]*home-capsule-library-title[\s\S]*libraryTitle\.focus\(\)/);
});

test("backstage returns to its valid active Capsule without changing persistence", function () {
  assert.match(dockSource, /\{ type: "capsule", toolId: activeId \}/);
  assert.match(dockSource, /returnTarget\.type === "capsule" && toolsById\[returnTarget\.toolId\]/);
  assert.match(dockSource, /dockActiveToolId: returnToCapsule \? returnTarget\.toolId : store\.get\('dockActiveToolId'\)/);
  assert.match(dockSource, /setDockState\(\{[\s\S]*dockLibraryOpen: !returnToCapsule,[\s\S]*dockBackstageOpen: false,[\s\S]*\}, false\)/);
  assert.match(dockSource, /focusActiveCapsuleTab\(\)/);
});

test("Escape unwinds only a topmost backstage layer", function () {
  assert.match(dockSource, /\[role="dialog"\], \[role="menu"\], \.profile-popover, \.project-ctx-menu/);
  assert.match(dockSource, /if \(hasVisibleEscapeLayer\(\)\) return;[\s\S]*dockBackstageOpen'[\s\S]*closeHomeBackstage\(\)[\s\S]*if \(!store\.get\('dockFocus'\)\) return;[\s\S]*returnHomeDockToSplit\(\)/);
  assert.match(dockSource, /dockOpen'\) && store\.get\('dockBackstageOpen'\) && backstageView\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)/);
});

test("Memory and Knowledge reuse the existing owned read-only protocols", function () {
  assert.match(propertiesSource, /type: "home_mate_memory_list", mateId: mateId/);
  assert.match(propertiesSource, /type: "home_mate_knowledge_list", mateId: mateId/);
  assert.match(messagesSource, /case "home_mate_memory_state":[\s\S]*handleHomeMateMemoryState\(msg\)/);
  assert.match(messagesSource, /case "home_mate_knowledge_state":[\s\S]*handleHomeMateKnowledgeState\(msg\)/);
  assert.match(serverSource, /findMateProject\(userId, msg\.mateId, true\)/);
  assert.match(serverSource, /msg\.type === "home_mate_memory_list"[\s\S]*found\.ctx\.getMemoryState\(\)/);
  assert.match(serverSource, /msg\.type === "home_mate_knowledge_list"[\s\S]*found\.ctx\.listKnowledgeFiles\(\)/);
  assert.doesNotMatch(propertiesSource, /home_mate_(memory|knowledge)_(save|update|delete|create)/);
});

test("Mate model backstage is correlated, server-confirmed, and accessible", function () {
  assert.match(propertiesSource, /type: "home_mate_models_get", mateId: activeMateId, requestId: modelRequestId/);
  assert.match(propertiesSource, /type: "home_mate_model_set", mateId: activeMateId, vendor: modelState\.vendor, model: model, requestId: modelSelectionRequestId/);
  assert.match(propertiesSource, /msg\.requestId !== modelRequestId/);
  assert.match(propertiesSource, /msg\.requestId !== modelSelectionRequestId/);
  assert.match(propertiesSource, /Used for new conversations\. Existing conversations keep their current model\./);
  assert.match(propertiesSource, /status === "loading"[\s\S]*Loading models/);
  assert.match(propertiesSource, /status === "error" \|\| modelState\.status === "empty"/);
  assert.match(propertiesSource, /role", "alert"/);
  assert.match(propertiesSource, /aria-pressed/);
  assert.match(propertiesSource, /aria-live", "polite"/);
  assert.match(propertiesSource, /focusedModel[\s\S]*focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(messagesSource, /home_mate_models_state|home_mate_model_result|handleHomeMateModelsState|handleHomeMateModelResult/);
  assert.match(connectionSource, /import \{ processMessage \} from '\.\/app-message-router\.js'/);
  assert.match(messageRouterSource, /msg\.type === "home_mate_models_state"[\s\S]*handleHomeMateModelsState\(msg\);[\s\S]*return true/);
  assert.match(messageRouterSource, /msg\.type === "home_mate_model_result"[\s\S]*handleHomeMateModelResult\(msg\);[\s\S]*return true/);
  assert.match(messageRouterSource, /if \(handleHomeModelMessage\(msg\)\) return;[\s\S]*processAppMessage\(msg\)/);
  assert.equal((messageRouterSource.match(/home_mate_models_state/g) || []).length, 1);
  assert.equal((messageRouterSource.match(/home_mate_model_result/g) || []).length, 1);
  assert.equal((messageRouterSource.match(/handleHomeMateModelsState\(msg\)/g) || []).length, 1);
  assert.equal((messageRouterSource.match(/handleHomeMateModelResult\(msg\)/g) || []).length, 1);
});

test("late backstage responses cannot replace another Mate or section", function () {
  assert.match(propertiesSource, /activeKind !== "memory" \|\| msg\.mateId !== activeMateId/);
  assert.match(propertiesSource, /activeKind !== "knowledge" \|\| msg\.mateId !== activeMateId/);
  assert.match(chatSource, /homeChatMateId'\) !== mateId\) closeHomeMateBackstage\(\)/);
  assert.match(dockSource, /function clearBackstageView\(\)[\s\S]*previous\.onClose\(\)/);
  assert.match(dockSource, /function activateTool\(toolId\) \{[\s\S]*clearBackstageView\(\)/);
  assert.match(dockSource, /export function closeHomeDock\(\) \{[\s\S]*clearBackstageView\(\)/);
  assert.match(propertiesSource, /function refreshActiveBody\(\)[\s\S]*\.home-mate-backstage-body/);
  assert.match(propertiesSource, /memoryState = \{[\s\S]*refreshActiveBody\(\)/);
  assert.doesNotMatch(propertiesSource, /handleHomeMateMemoryState\(msg\)[\s\S]{0,240}renderBackstage/);
});

test("Home settings reuse project Mate management and custom confirmation", function () {
  assert.match(propertiesSource, /editMateProfile\(edit, mate\)/);
  assert.match(propertiesSource, /confirmMateRemoval\(remove, mate, closeHomeMateBackstage\)/);
  assert.match(sidebarMatesSource, /from '\.\/mate-management\.js'/);
  assert.match(sidebarMatesSource, /showMateManagementMenu\(anchorEl, mate/);
  assert.match(sidebarMatesSource, /closeUserCtxMenu\(\)[\s\S]*closeMateManagementMenu\(\)/);
  assert.match(managementSource, /editMateProfile\(anchorEl, mate\)/);
  assert.match(managementSource, /confirmMateRemoval\(anchorEl, mate, options\.onRemoved\)/);
  assert.match(managementSource, /showMateProfilePopover\(anchorEl, mate/);
  assert.match(managementSource, /showConfirm\(/);
  assert.match(managementSource, /type: "mate_update"/);
  assert.match(managementSource, /type: "mate_delete"/);
  assert.doesNotMatch(propertiesSource + managementSource, /\b(?:alert|confirm|prompt)\s*\(/);
});

test("backstage has explicit return, close lifecycle, and focus handoff", function () {
  assert.match(propertiesSource, /Return to Workbench/);
  assert.match(propertiesSource, /data-home-backstage-focus/);
  assert.match(dockSource, /data-home-backstage-focus[\s\S]*focusTarget\.focus\(\)/);
  assert.match(dockSource, /export function closeHomeBackstage\(\)[\s\S]*home-capsule-library-title[\s\S]*libraryTitle\.focus\(\)[\s\S]*focusActiveCapsuleTab\(\)/);
  assert.match(dockSource, /home-dock-collapse"\)\.addEventListener\("click", closeHomeDock\)/);
  assert.match(dockSource, /homeControl[\s\S]*homeControl\.focus\(\)/);
  assert.match(propertiesSource, /aria-labelledby", "home-mate-backstage-title"/);
  assert.match(propertiesSource, /aria-label", "Mate backstage sections"/);
  assert.match(propertiesSource, /aria-current", "page"/);
});

test("mobile backstage uses full-screen Workbench and closes the navigation drawer", function () {
  assert.match(hubCssSource, /@media \(max-width: 768px\)[\s\S]*#home-hub\.dock-split \.home-tool-workbench[\s\S]*width: 100%[\s\S]*border: 0/);
  assert.match(cssSource, /@media \(max-width: 768px\)[\s\S]*\.home-mate-backstage[\s\S]*width: 100%/);
  assert.match(propertiesSource, /matchMedia\("\(max-width: 768px\)"\)/);
  assert.match(propertiesSource, /updateHomeSurfacePreference\(\{ sidebarCollapsed: true \}\)/);
  assert.match(styleSource, /@import url\("css\/home-mate-backstage\.css"\)/);
});

test("Stage 8 client modules follow dependency and size constraints", function () {
  var files = [
    "lib/public/modules/home-dock.js",
    "lib/public/modules/home-mate-chat.js",
    "lib/public/modules/home-mate-properties.js",
    "lib/public/modules/mate-management.js",
    "lib/public/modules/sidebar-mates.js",
    "lib/public/modules/sidebar-presence.js",
  ];
  for (var i = 0; i < files.length; i++) {
    var source = read(files[i]);
    assert.ok(source.split("\n").length < 500, files[i] + " must remain under 500 lines");
    assert.doesNotMatch(source, /\b(?:const|let)\b|=>|localStorage/);
  }
  assert.match(propertiesSource, /from '\.\/store\.js'/);
  assert.match(propertiesSource, /from '\.\/ws-ref\.js'/);
  assert.doesNotMatch(propertiesSource, /init[A-Z][A-Za-z]+\(ctx\)|var _ctx/);
  assert.match(sidebarPresenceSource, /export function renderSidebarPresence/);
});
