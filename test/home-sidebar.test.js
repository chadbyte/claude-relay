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
var wordmarkPath = path.join(root, "lib/public/clay-studio-wordmark.svg");
var fontPath = path.join(root, "lib/public/fonts/source-serif-4/SourceSerif4Caption-Semibold.ttf.woff2");
var fontLicenseSource = fs.readFileSync(path.join(root, "lib/public/fonts/source-serif-4/LICENSE.md"), "utf8");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="whats-new-article"'));

test("Home sidebar follows a continuous action, Mate, and conversation hierarchy", function () {
  assert.match(homeMarkup, /home-sidebar-brand[\s\S]*id="home-sidebar-all"[\s\S]*id="home-sidebar-collapse"[\s\S]*id="home-sidebar-new"[\s\S]*id="home-sidebar-debate"[\s\S]*home-sidebar-mate-label[\s\S]*home-mate-list[\s\S]*home-sidebar-recent-label/);
  assert.doesNotMatch(homeMarkup, /home-sidebar-capsules/);
  assert.doesNotMatch(cssSource, /home-sidebar-activity/);
  assert.match(homeMarkup, /id="home-mate-list"[^>]*role="list"/);
  assert.doesNotMatch(homeMarkup, /id="home-sidebar-(?:model|memory|knowledge|settings)"|All conversations<\/span>/);
  assert.equal((homeMarkup.match(/id="home-sidebar-all"/g) || []).length, 1);
  assert.doesNotMatch(homeMarkup, /home-mate-chat-actions/);
});

test("Home sidebar uses locally bundled Source Serif live text for Clay Studio", function () {
  assert.match(homeMarkup, /home-sidebar-brand[^>]*>[\s\S]*home-sidebar-brand-wordmark">Clay Studio<\/span>/);
  assert.match(homeMarkup, /id="home-sidebar-mate-label"[^>]*>Mates<\/div>/);
  assert.match(homeMarkup, /id="home-mate-list"/);
  assert.match(homeMarkup, /id="home-sidebar-expand"[^>]*title="Show sidebar"[^>]*aria-label="Show Home sidebar"[^>]*aria-describedby="home-sidebar-expand-brand-label"[\s\S]*id="home-sidebar-expand-brand-label" class="home-sidebar-brand-wordmark home-sidebar-expand-wordmark">Clay Studio<\/span>/);
  assert.match(indexSource, /rel="preload" href="\/fonts\/source-serif-4\/SourceSerif4Caption-Semibold\.ttf\.woff2" as="font" type="font\/woff2" crossorigin/);
  assert.equal(fs.statSync(fontPath).size, 77024);
  assert.match(fontLicenseSource, /Copyright 2014 - 2023 Adobe/);
  assert.match(fontLicenseSource, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(cssSource, /\.home-sidebar-brand \{[\s\S]*color: var\(--text\);/);
  assert.match(cssSource, /@font-face \{[\s\S]*font-family: "Source Serif 4";[\s\S]*url\("\/fonts\/source-serif-4\/SourceSerif4Caption-Semibold\.ttf\.woff2"\) format\("woff2"\);[\s\S]*font-weight: 600;[\s\S]*font-display: swap;/);
  assert.match(cssSource, /\.home-sidebar-brand-wordmark \{[\s\S]*font-family: "Source Serif 4", Georgia, serif;[\s\S]*font-size: 17px;[\s\S]*font-weight: 600;[\s\S]*font-synthesis: none;/);
  assert.match(cssSource, /\.home-sidebar-expand-wordmark \{[\s\S]*flex: 0 0 auto;[\s\S]*font-size: 15px;/);
  assert.doesNotMatch(cssSource, /\.home-sidebar-brand-row \{[^}]*border-bottom:/);
  assert.doesNotMatch(cssSource, /\.home-sidebar-(?:mate-section|recents|new) \{[^}]*border-(?:top|bottom):/);
  assert.match(cssSource, /\.home-mate-list-row\.is-active \{[\s\S]*background: rgba\(var\(--overlay-rgb\), 0\.055\);[\s\S]*color: var\(--text\);/);
  assert.doesNotMatch(cssSource, /\.home-mate-list-row\.is-active \{[^}]*box-shadow/);
  assert.match(cssSource, /\.home-mate-list-row:focus-visible \{[\s\S]*outline: 2px solid var\(--accent\)/);
  assert.doesNotMatch(homeMarkup + cssSource, /clay-studio-wordmark\.svg|mask-image/);
  assert.doesNotMatch(cssSource, /url\([^)]*https?:/);
  assert.equal(fs.existsSync(wordmarkPath), true);
});

test("desktop Home sidebar boundary reaches the frame edges without mobile bleed", function () {
  assert.match(cssSource, /@media \(min-width: 769px\) \{[\s\S]*\.home-sidebar::after \{[\s\S]*top: -100vh;[\s\S]*right: -1px;[\s\S]*bottom: -100vh;[\s\S]*background: var\(--border-subtle\);/);
  assert.doesNotMatch(cssSource.slice(cssSource.indexOf("@media (max-width: 768px)")), /home-sidebar::after/);
  assert.match(cssSource, /@media \(max-width: 768px\)[\s\S]*\.home-sidebar \{[\s\S]*border: 1px solid var\(--border-subtle\);[\s\S]*border-radius: 12px;/);
});

test("Home sidebar presents a global Mate-attributed conversation archive", function () {
  var allConversationsSource = sidebarSource.slice(sidebarSource.indexOf("function allConversations"), sidebarSource.indexOf("function renderRecentConversations"));
  assert.match(homeMarkup, /id="home-sidebar-recent-label"[^>]*>Conversations<\/div>/);
  assert.match(sidebarSource, /allConversations\(\)\.slice\(0, 5\)/);
  assert.match(allConversationsSource, /var mates = visibleMates\(\)/);
  assert.match(allConversationsSource, /mateName: mateNames\[mateIds\[j\]\]/);
  assert.match(allConversationsSource, /result\.sort\(function \(a, b\) \{ return b\.lastActivity - a\.lastActivity; \}\)/);
  assert.doesNotMatch(allConversationsSource, /homeChatMateId|homeChatSessionId/);
  assert.match(sidebarSource, /home-sidebar-recent-copy/);
  assert.match(sidebarSource, /home-sidebar-recent-title/);
  assert.match(sidebarSource, /home-sidebar-recent-mate/);
  assert.match(sidebarSource, /conversation\.mateId === activeMateId && conversation\.sessionId === activeSessionId/);
  assert.match(sidebarSource, /openConversationFromSidebar\(conversation\.mateId, conversation\.sessionId\)/);
  assert.match(sidebarSource, /openHomeConversation\(mateId, sessionId\)/);
  assert.match(chatSource, /export function openHomeConversation\(mateId, sessionId\)/);
  assert.match(chatSource, /homeChatSessionId: sessionId/);
  assert.match(cssSource, /\.home-sidebar-recents \{[\s\S]*margin: 18px 4px 0;[\s\S]*padding: 0;/);
  assert.doesNotMatch(cssSource, /\.home-sidebar-recents \{[^}]*border-top:/);
  assert.match(cssSource, /\.home-sidebar-recent-mate \{[\s\S]*color: var\(--text-dimmer\);[\s\S]*font-size: 9px/);
});

test("Home requests user-filtered conversation lists for every visible Mate", function () {
  assert.match(sidebarSource, /for \(var i = 0; i < mates\.length; i\+\+\)/);
  assert.match(sidebarSource, /type: "home_mate_sessions_list", mateId: mates\[i\]\.id/);
  assert.match(sidebarSource, /state\.connected !== prev\.connected/);
});

test("All conversations is a searchable custom sheet", function () {
  assert.match(homeMarkup, /home-sidebar-brand-actions[\s\S]*id="home-sidebar-all"[^>]*title="Search conversations"[^>]*aria-label="Search conversations"[\s\S]*id="home-sidebar-collapse"/);
  assert.match(sidebarSource, /home-sidebar-all"\)\.addEventListener\("click", openAllConversations\)/);
  assert.match(sidebarSource, /openHomeConversationsSheet\(openConversationFromSidebar, event\.currentTarget\)/);
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
  assert.match(sidebarSource, /export function closeHomeSidebarAfterSelection\(\)[\s\S]*closeNarrowDrawer\(true\)/);
  assert.match(sidebarSource, /function openMateActionFromSidebar\(kind\)[\s\S]*openHomeMateAction\(kind\)[\s\S]*closeNarrowDrawer\(false\)/);
  assert.match(sidebarSource, /openHomeConversationsSheet\(openConversationFromSidebar, event\.currentTarget\)/);
  assert.match(sidebarSource, /event\.key !== "Escape"[\s\S]*document\.body\.classList\.contains\("home-active"\)[\s\S]*closeNarrowDrawer\(true\)/);
  assert.doesNotMatch(sidebarSource, /showProject|history\.back|location\./);
});

test("active Mate visibility scrolls only the Mate list and preserves keyboard focus", function () {
  var hubSource = fs.readFileSync(path.join(root, "lib/public/modules/app-home-hub.js"), "utf8");
  assert.match(hubSource, /var lastRenderedMateId = null/);
  assert.match(hubSource, /var selectionChanged = activeMateId !== lastRenderedMateId/);
  assert.match(hubSource, /function keepMateRowVisible\(list, row\)[\s\S]*list\.getBoundingClientRect\(\)[\s\S]*row\.getBoundingClientRect\(\)[\s\S]*list\.scrollTop -=[\s\S]*list\.scrollTop \+=/);
  assert.doesNotMatch(hubSource, /scrollIntoView/);
  assert.match(hubSource, /focusedRow\.focus\(\{ preventScroll: true \}\)/);
  assert.match(hubSource, /keepMateRowVisible\(list, selectionChanged \? activeRow : focusedRow \|\| activeRow\)/);
  assert.match(hubSource, /lastRenderedMateId = activeMateId/);
  assert.match(hubSource, /state\.homeSidebarCollapsed !== prev\.homeSidebarCollapsed && !state\.homeSidebarCollapsed[\s\S]*requestAnimationFrame\(renderHomeMateSwitcher\)/);
  assert.match(hubSource, /function selectHomeMate\(mateId\)[\s\S]*openHomeChat\(mateId\)/);
});

test("narrow sheet selection moves focus out of the collapsed sidebar", function () {
  assert.match(sidebarSource, /function focusNarrowNavigationTarget\(\)[\s\S]*getElementById\("home-mate-chat-input"\)/);
  assert.match(sidebarSource, /composer && !composer\.disabled && composer\.getClientRects\(\)\.length[\s\S]*composer\.focus\(\);[\s\S]*return;/);
  assert.match(sidebarSource, /getElementById\("home-sidebar-expand"\)[\s\S]*expand\.getClientRects\(\)\.length[\s\S]*expand\.focus\(\)/);
  assert.match(sidebarSource, /function closeNarrowDrawer\(focusConversation\)[\s\S]*setCollapsed\(true\);[\s\S]*focusNarrowNavigationTarget\(\)/);
  assert.match(sheetSource, /var onSelect = selectConversation;[\s\S]*closeSheet\(\);[\s\S]*onSelect/);
});
