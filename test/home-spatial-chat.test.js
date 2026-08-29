var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var indexSource = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var appSource = fs.readFileSync(path.join(root, "lib/public/app.js"), "utf8");
var serverSource = fs.readFileSync(path.join(root, "lib/server.js"), "utf8");
var projectsSource = fs.readFileSync(path.join(root, "lib/public/modules/app-projects.js"), "utf8");
var hubSource = fs.readFileSync(path.join(root, "lib/public/modules/app-home-hub.js"), "utf8");
var connectionSource = fs.readFileSync(path.join(root, "lib/public/modules/app-connection.js"), "utf8");
var shellSource = fs.readFileSync(path.join(root, "lib/public/modules/home-shell.js"), "utf8");
var dockSource = fs.readFileSync(path.join(root, "lib/public/modules/home-dock.js"), "utf8");
var dockResizeSource = fs.readFileSync(path.join(root, "lib/public/modules/home-dock-resize.js"), "utf8");
var chatSource = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
var homeSidebarSource = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
var paletteSource = fs.readFileSync(path.join(root, "lib/public/modules/command-palette.js"), "utf8");
var dmSource = fs.readFileSync(path.join(root, "lib/public/modules/app-dm.js"), "utf8");
var cssSource = fs.readFileSync(path.join(root, "lib/public/css/home-hub.css"), "utf8");
var matesCssSource = fs.readFileSync(path.join(root, "lib/public/css/mates.css"), "utf8");
var avatarCssSource = fs.readFileSync(path.join(root, "lib/public/css/avatar-imprints.css"), "utf8");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="whats-new-article"'));

test("home markup uses the selected-mate switcher and unified chat stage", function () {
  assert.match(indexSource, /id="home-mate-switcher"/);
  assert.match(indexSource, /class="home-mate-chat-stage"/);
  assert.match(indexSource, /id="home-mate-chat-suggestions"/);
  assert.match(homeMarkup, /class="home-mate-chat-controls"[\s\S]*id="home-tools-btn"/);
  assert.match(homeMarkup, /id="home-tools-btn"[\s\S]*id="home-minimize-btn"/);
  assert.doesNotMatch(indexSource, /id="home-bar"|id="home-projects-btn"|id="home-search-btn"/);
  assert.doesNotMatch(cssSource, /#home-bar|\.home-bar-|\.home-projects-|#home-projects-btn/);
  assert.doesNotMatch(homeMarkup, /notif-center-btn|user-settings-btn|home-bar/);
  assert.doesNotMatch(indexSource, /id="home-hub-mates"/);
});

test("home minimizes and resumes without resetting its mounted work", function () {
  assert.match(hubSource, /homeHubSuspended/);
  assert.match(hubSource, /export function minimizeHomeHub\(\)/);
  assert.match(hubSource, /route = "\/p\/" \+ slug \+ "\/"/);
  assert.match(hubSource, /if \(!resume\) \{[\s\S]*requestTools\(\)[\s\S]*renderDock\(\)/);
  assert.doesNotMatch(hubSource, /resetHomeDockFocus|closeHomeChat/);
  assert.match(connectionSource, /resumeHomeChat\(\)/);
  assert.match(chatSource, /export function resumeHomeChat\(\)/);
});

test("home shell only toggles reversible project chrome", function () {
  assert.match(shellSource, /classList\.add\("home-active"\)/);
  assert.match(shellSource, /classList\.remove\("home-active"\)/);
  assert.doesNotMatch(shellSource, /getCachedProjects|openAddProjectModal|switchProject|home-project|home-bar|notif-center-btn|user-settings-btn/);
  assert.match(cssSource, /body\.home-active #top-bar,[\s\S]*body\.home-active #icon-strip,[\s\S]*body\.home-active #sidebar-column/);
  assert.match(cssSource, /body\.home-active \.title-bar-content/);
  assert.match(appSource, /if \(!newSlug\) \{\s*showHomeHub\(true\);\s*return;/);
  assert.match(appSource, /if \(!slugMatch\) \{\s*showHomeHub\(true\);/);
  assert.match(appSource, /document\.body\.dataset\.homeProjectSlug/);
  assert.match(serverSource, /data-home-project-slug/);
  assert.doesNotMatch(indexSource, /home-hub-close/);
  assert.doesNotMatch(hubSource, /hubCloseBtn/);
  assert.doesNotMatch(appSource, /isHomeHubVisible\(\) && store\.get\('currentSlug'\)/);
});

test("Cmd+K remains a global project exit from a direct home load", function () {
  assert.match(paletteSource, /document\.addEventListener\("keydown"[\s\S]*\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === "k"/);
  assert.match(paletteSource, /fetch\("\/api\/palette\/search"/);
  assert.match(paletteSource, /ctx\.projectList \? ctx\.projectList\(\) : \[\]/);
  assert.match(paletteSource, /cmd-palette-group-label">Projects/);
  assert.match(paletteSource, /entry\.type === "project"[\s\S]*ctx\.switchProject\(entry\.data\.slug\)/);
  assert.match(projectsSource, /if \(isHomeHubVisible\(\)\) \{[\s\S]*hideHomeHub\(\)/);
  assert.match(serverSource, /Root path — render home while keeping the last accessible project connected/);
  assert.match(serverSource, /Fall back to first accessible project/);
  assert.match(serverSource, /data-home-project-slug/);
});

test("home dock exposes conversation, split, and focused tool states", function () {
  assert.match(indexSource, /id="home-tools-btn"/);
  assert.match(indexSource, /id="home-dock-divider"/);
  assert.match(indexSource, /Return to conversation/);
  assert.match(dockSource, /dock-split/);
  assert.match(dockSource, /dock-focus/);
  assert.match(dockSource, /dockOpen: false/);
  assert.match(dockSource, /home_dock_get/);
  assert.match(dockSource, /home_dock_set/);
  assert.match(dockSource, /window\.innerWidth <= 768[\s\S]*closeHomeDock\(\)/);
  assert.match(dockResizeSource, /available - 504/);
  assert.match(dockResizeSource, /window\.innerWidth \* 0\.58/);
  assert.match(dockResizeSource, /workbench\.getBoundingClientRect\(\)/);
  assert.match(dockResizeSource, /pointerOffset/);
  assert.match(cssSource, /\.home-tool-workbench \{[\s\S]*border: 1px solid var\(--border\);[\s\S]*border-radius: 12px;[\s\S]*box-shadow:/);
  assert.match(cssSource, /@keyframes home-workbench-in/);
  assert.match(cssSource, /#home-hub\.dock-split \.home-dock-divider::after \{[\s\S]*background: transparent;/);
  assert.match(cssSource, /@media \(max-width: 768px\) \{[\s\S]*#home-hub\.dock-split \.home-conversation-region,[\s\S]*display: none;/);
  assert.match(cssSource, /#home-hub\.dock-split,[\s\S]*padding: var\(--safe-top\) 0 calc\(56px \+ var\(--safe-bottom, 0px\)\)/);
  assert.doesNotMatch(cssSource, /flex: 0 0 52vh|flex: 0 0 62vh/);
  assert.doesNotMatch(indexSource + cssSource, /hub-split|hub-pane-board|home-app-frame/);
  assert.doesNotMatch(dockSource, /localStorage/);
});

test("board suggestion opens the dock without replacing its message send", function () {
  assert.match(chatSource, /text === "Add a card to the board"\) openHomeDock\("board"\)/);
  assert.match(chatSource, /submitMessage\(\)/);
});

test("home mate switcher preserves management and status affordances", function () {
  assert.match(hubSource, /home-mate-switcher-row-bio/);
  assert.match(hubSource, /home-mate-switcher-presence/);
  assert.match(hubSource, /home-mate-switcher-unread/);
  assert.match(hubSource, /home-mate-switcher-mention/);
  assert.match(hubSource, /showMateCtxMenu/);
  assert.match(hubSource, /openMateWizard/);
});

test("home surface no longer propagates mate colors", function () {
  var homeSource = hubSource + chatSource + cssSource;
  assert.doesNotMatch(homeSource, /--home-mate-color|--mate-color|avatarColor/);
});

test("legacy home mate rail selectors are gone from client styles", function () {
  var styleSource = cssSource + matesCssSource + avatarCssSource;
  assert.doesNotMatch(styleSource, /home-hub-mates|home-hub-mate-|home-mate-tooltip|home-mate-hover/);
});

test("home chat diverges from shared human DM rendering", function () {
  assert.doesNotMatch(chatSource, /dm-render\.js|buildDmMessage|buildDmTypingIndicator/);
  assert.match(chatSource, /home-chat-message-assistant/);
  assert.match(chatSource, /home-chat-message-user/);
  assert.match(chatSource, /home-chat-typing/);
  assert.match(dmSource, /from ['"]\.\/dm-render\.js['"]/);
});

test("empty home chat renders contextual greeting and working suggestions", function () {
  assert.match(chatSource, /What should we work on,/);
  assert.match(chatSource, /shortBio\(mate\)/);
  assert.match(chatSource, /Add a card to the board/);
  assert.match(chatSource, /Make me a small tool/);
  assert.match(chatSource, /submitSuggestion\(suggestion\)/);
});

test("Mate and new-conversation actions live in the Home sidebar", function () {
  assert.match(homeMarkup, /id="home-sidebar-new"/);
  assert.match(homeMarkup, /id="home-sidebar-mate-overflow"/);
  assert.doesNotMatch(homeMarkup, /id="home-mate-chat-actions"/);
  assert.match(homeSidebarSource, /startNewHomeConversation/);
  assert.match(homeSidebarSource, /openHomeMateActions/);
  assert.match(chatSource, /"Memory"/);
  assert.match(chatSource, /"Knowledge"/);
  assert.match(chatSource, /"Start debate"/);
});

test("home chat CSS centers the transcript and keeps one composer surface", function () {
  assert.match(cssSource, /\.home-mate-chat-transcript\s*\{[\s\S]*?width: min\(720px, 100%\)/);
  assert.match(cssSource, /\.home-chat-message-user \.home-chat-message-content\s*\{[\s\S]*?max-width: 75%/);
  assert.match(cssSource, /\.home-mate-chat-composer\s*\{[\s\S]*?border-radius: 22px/);
  assert.match(cssSource, /\.home-mate-chat\.is-empty \.home-mate-chat-stage/);
  assert.match(cssSource, /\.home-mate-chat\.is-empty \.home-mate-chat-stage\s*\{[\s\S]*?padding-bottom: 18%/);
  assert.match(cssSource, /#home-hub\s*\{[\s\S]*?padding: calc\(14px \+ var\(--safe-top\)\) 24px 24px/);
});

test("home app imports the renamed switcher renderer", function () {
  assert.match(appSource, /renderHomeMateSwitcher/);
  assert.doesNotMatch(appSource, /renderHomeHubMates/);
});
