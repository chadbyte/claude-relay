var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var indexSource = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var sidebarSource = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
var sheetSource = fs.readFileSync(path.join(root, "lib/public/modules/home-conversations-sheet.js"), "utf8");
var chatSource = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
var surfaceSource = fs.readFileSync(path.join(root, "lib/public/modules/home-surface.js"), "utf8");
var cssSource = fs.readFileSync(path.join(root, "lib/public/css/home-sidebar.css"), "utf8");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="whats-new-article"'));

test("Home sidebar follows the minimal relationship and history order", function () {
  assert.match(homeMarkup, /home-sidebar-brand[\s\S]*home-sidebar-new[\s\S]*home-sidebar-capsules[\s\S]*home-sidebar-mate-label[\s\S]*home-sidebar-recent-label[\s\S]*home-sidebar-all/);
  assert.match(homeMarkup, /id="home-mate-switcher"/);
  assert.match(homeMarkup, /id="home-sidebar-mate-overflow"/);
  assert.doesNotMatch(homeMarkup, /home-mate-chat-actions/);
});

test("Home sidebar shows five recent titles and restores exact conversations", function () {
  assert.match(sidebarSource, /allConversations\(\)\.slice\(0, 5\)/);
  assert.match(sidebarSource, /home-sidebar-recent-title/);
  assert.match(sidebarSource, /openConversationFromSidebar\(conversation\.mateId, conversation\.sessionId\)/);
  assert.match(sidebarSource, /openHomeConversation\(mateId, sessionId\)/);
  assert.match(chatSource, /export function openHomeConversation\(mateId, sessionId\)/);
  assert.match(chatSource, /homeChatSessionId: sessionId/);
});

test("Home requests user-filtered conversation lists for every visible Mate", function () {
  assert.match(sidebarSource, /for \(var i = 0; i < mates\.length; i\+\+\)/);
  assert.match(sidebarSource, /type: "home_mate_sessions_list", mateId: mates\[i\]\.id/);
  assert.match(sidebarSource, /state\.connected !== prev\.connected/);
});

test("All conversations is a searchable custom sheet", function () {
  assert.match(sheetSource, /role", "dialog"/);
  assert.match(sheetSource, /searchInput\.type = "search"/);
  assert.match(sheetSource, /conversation\.title\.toLowerCase/);
  assert.match(sheetSource, /onSelect\(conversation\.mateId, conversation\.sessionId\)/);
  assert.doesNotMatch(sheetSource, /alert\(|confirm\(|prompt\(/);
});

test("All conversations traps focus and restores its opener on every close path", function () {
  assert.match(sheetSource, /sheetOpener = opener \|\| document\.activeElement/);
  assert.match(sheetSource, /document\.removeEventListener\("keydown", handleKeydown, true\)/);
  assert.match(sheetSource, /event\.key !== "Tab"/);
  assert.match(sheetSource, /event\.shiftKey[\s\S]*last\.focus\(\)/);
  assert.match(sheetSource, /!event\.shiftKey[\s\S]*first\.focus\(\)/);
  assert.match(sheetSource, /opener[\s\S]*opener\.focus\(\)/);
  assert.match(sheetSource, /backdrop\.addEventListener\("click", closeSheet\)/);
  assert.match(sheetSource, /close\.addEventListener\("click", closeSheet\)/);
  assert.match(sheetSource, /event\.key === "Escape"[\s\S]*closeSheet\(\)/);
  assert.match(sheetSource, /var onSelect = selectConversation;[\s\S]*closeSheet\(\);[\s\S]*onSelect/);
});

test("complete sidebar collapse persists without an icon rail", function () {
  assert.match(sidebarSource, /updateHomeSurfacePreference\(\{ sidebarCollapsed: collapsed \}\)/);
  assert.match(surfaceSource, /sidebarCollapsed/);
  assert.match(cssSource, /flex: 0 0 240px/);
  assert.match(cssSource, /flex-basis: 232px/);
  assert.match(cssSource, /#home-hub\.home-sidebar-collapsed \.home-sidebar \{ display: none; \}/);
  assert.match(cssSource, /#home-hub\.home-sidebar-collapsed \.home-sidebar-expand \{ display: inline-flex; \}/);
  assert.doesNotMatch(homeMarkup, /home-sidebar-icon-rail/);
});

test("mobile Home sidebar becomes an overlay drawer", function () {
  assert.match(cssSource, /@media \(max-width: 768px\)[\s\S]*\.home-sidebar \{[\s\S]*position: absolute;[\s\S]*width: min\(320px, calc\(100vw - 24px\)\)/);
  assert.match(cssSource, /\.home-sidebar-backdrop \{[\s\S]*display: block;/);
});

test("mobile navigation closes the drawer while Escape stays on Home", function () {
  assert.match(sidebarSource, /window\.matchMedia\("\(max-width: 768px\)"\)\.matches/);
  assert.match(sidebarSource, /openHomeConversation\(mateId, sessionId\);[\s\S]*closeNarrowDrawer\(true\)/);
  assert.match(sidebarSource, /startNewHomeConversation\(\);[\s\S]*closeNarrowDrawer\(true\)/);
  assert.match(sidebarSource, /openHomeConversationsSheet\(openConversationFromSidebar, event\.currentTarget\)/);
  assert.match(sidebarSource, /event\.key !== "Escape"[\s\S]*document\.body\.classList\.contains\("home-active"\)[\s\S]*closeNarrowDrawer\(true\)/);
  assert.doesNotMatch(sidebarSource, /showProject|history\.back|location\./);
});

test("narrow sheet selection moves focus out of the collapsed sidebar", function () {
  assert.match(sidebarSource, /function focusNarrowNavigationTarget\(\)[\s\S]*getElementById\("home-mate-chat-input"\)/);
  assert.match(sidebarSource, /composer && !composer\.disabled && composer\.getClientRects\(\)\.length[\s\S]*composer\.focus\(\);[\s\S]*return;/);
  assert.match(sidebarSource, /getElementById\("home-sidebar-expand"\)[\s\S]*expand\.getClientRects\(\)\.length[\s\S]*expand\.focus\(\)/);
  assert.match(sidebarSource, /function closeNarrowDrawer\(focusConversation\)[\s\S]*setCollapsed\(true\);[\s\S]*focusNarrowNavigationTarget\(\)/);
  assert.match(sheetSource, /var onSelect = selectConversation;[\s\S]*closeSheet\(\);[\s\S]*onSelect/);
});
