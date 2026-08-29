var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var indexSource = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var appSource = fs.readFileSync(path.join(root, "lib/public/app.js"), "utf8");
var serverSource = fs.readFileSync(path.join(root, "lib/server.js"), "utf8");
var hubSource = fs.readFileSync(path.join(root, "lib/public/modules/app-home-hub.js"), "utf8");
var shellSource = fs.readFileSync(path.join(root, "lib/public/modules/home-shell.js"), "utf8");
var chatSource = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
var dmSource = fs.readFileSync(path.join(root, "lib/public/modules/app-dm.js"), "utf8");
var cssSource = fs.readFileSync(path.join(root, "lib/public/css/home-hub.css"), "utf8");
var matesCssSource = fs.readFileSync(path.join(root, "lib/public/css/mates.css"), "utf8");
var avatarCssSource = fs.readFileSync(path.join(root, "lib/public/css/avatar-imprints.css"), "utf8");

test("home markup uses the selected-mate switcher and unified chat stage", function () {
  assert.match(indexSource, /id="home-bar"/);
  assert.match(indexSource, /id="home-projects-btn"/);
  assert.match(indexSource, /id="home-mate-switcher"/);
  assert.match(indexSource, /class="home-mate-chat-stage"/);
  assert.match(indexSource, /id="home-mate-chat-suggestions"/);
  assert.doesNotMatch(indexSource, /id="home-hub-mates"/);
});

test("home shell toggles reversible chrome and projects chooser affordances", function () {
  assert.match(shellSource, /classList\.add\("home-active"\)/);
  assert.match(shellSource, /classList\.remove\("home-active"\)/);
  assert.match(shellSource, /Resume /);
  assert.match(shellSource, /home-projects-filter/);
  assert.match(shellSource, /home-project-row-dot/);
  assert.match(shellSource, /openAddProjectModal\(\)/);
  assert.match(shellSource, /\["notif-center-btn", "user-settings-btn"\]/);
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

test("home chat actions are consolidated into a labeled overflow menu", function () {
  assert.match(chatSource, /aria-label", "Mate actions"/);
  assert.match(chatSource, /"Memory"/);
  assert.match(chatSource, /"Knowledge"/);
  assert.match(chatSource, /"Start debate"/);
  assert.match(chatSource, /newButton\.textContent = "New chat"/);
});

test("home chat CSS centers the transcript and keeps one composer surface", function () {
  assert.match(cssSource, /\.home-mate-chat-transcript\s*\{[\s\S]*?width: min\(720px, 100%\)/);
  assert.match(cssSource, /\.home-chat-message-user \.home-chat-message-content\s*\{[\s\S]*?max-width: 75%/);
  assert.match(cssSource, /\.home-mate-chat-composer\s*\{[\s\S]*?border-radius: 22px/);
  assert.match(cssSource, /\.home-mate-chat\.is-empty \.home-mate-chat-stage/);
});

test("home app imports the renamed switcher renderer", function () {
  assert.match(appSource, /renderHomeMateSwitcher/);
  assert.doesNotMatch(appSource, /renderHomeHubMates/);
});
