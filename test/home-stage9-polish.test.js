var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

var appSource = source("lib/public/app.js");
var avatarSource = source("lib/public/modules/avatar.js");
var avatarGeneratorSource = source("lib/public/modules/avatar-imprint.js");
var boardSource = source("lib/public/modules/home-board.js");
var boardCssSource = source("lib/public/css/home-board.css");
var builtinSource = source("lib/builtin-mates.js");
var dockSource = source("lib/public/modules/home-dock.js");
var homeCssSource = source("lib/public/css/home-hub.css");
var hubSource = source("lib/public/modules/app-home-hub.js");
var mateCssSource = source("lib/public/css/mates.css");
var iconCssSource = source("lib/public/css/icon-strip.css");
var indexSource = source("lib/public/index.html");
var sheetSource = source("lib/public/modules/home-conversations-sheet.js");
var sidebarSource = source("lib/public/modules/home-sidebar.js");
var styleSource = source("lib/public/style.css");

test("board uses flat drafting lanes and raised cards", function () {
  assert.match(boardCssSource, /\.board-column \{[\s\S]*border: 0;[\s\S]*background: transparent;/);
  assert.match(boardCssSource, /\.board-card \{[\s\S]*border: 1px solid var\(--border-subtle\);[\s\S]*box-shadow:/);
  assert.match(boardCssSource, /\.board-card:focus-visible[\s\S]*outline|\.board-card:focus-visible[\s\S]*box-shadow/);
  assert.match(boardCssSource, /\.board-card:focus-within \.board-card-delete/);
  assert.match(styleSource, /@import url\("css\/home-board\.css"\)/);
  assert.doesNotMatch(homeCssSource, /\.board-card\s*\{|\.board-column\s*\{/);
});

test("board cards and columns expose accessible structure and controls", function () {
  assert.match(boardSource, /element\.setAttribute\("role", "region"\)/);
  assert.match(boardSource, /element\.setAttribute\("aria-label", "Work board"\)/);
  assert.match(boardSource, /role="list" aria-label=/);
  assert.match(boardSource, /draggable="true" tabindex="0" role="listitem"/);
  assert.match(boardSource, /aria-keyshortcuts="Alt\+ArrowLeft Alt\+ArrowRight"/);
  assert.match(boardSource, /class="board-card-delete"[\s\S]*aria-label="Delete /);
  assert.match(boardSource, /textarea class="board-composer-input"[\s\S]*aria-label="Card title"/);
  assert.match(boardSource, /showConfirm\("Delete this card\?"/);
  assert.doesNotMatch(boardSource, /\b(?:alert|confirm|prompt)\s*\(/);
});

test("keyboard card movement and composer cancellation preserve focus", function () {
  assert.match(boardSource, /e\.target !== cardEl/);
  assert.match(boardSource, /e\.altKey[\s\S]*e\.key !== "ArrowLeft"[\s\S]*moveCardByKeyboard/);
  assert.match(boardSource, /focusCardTarget = \{ cardId: cardId, column: targetColumn \}/);
  assert.match(boardSource, /column\.dataset\.column !== focusCardTarget\.column[\s\S]*cards\[i\]\.focus\(\)/);
  assert.match(boardSource, /e\.key === "Escape"[\s\S]*e\.preventDefault\(\)[\s\S]*closeComposer\(composerColumn\)/);
  assert.match(boardSource, /function closeComposer\(focusColumn\)[\s\S]*buttons\[i\]\.focus\(\)/);
});

test("board remains usable in tablet and mobile Workbench widths", function () {
  assert.match(indexSource, /<div class="home-dock-content" id="home-dock-content"><\/div>/);
  assert.match(boardSource, /element\.className = "home-board"/);
  assert.match(boardCssSource, /#home-dock-content:has\(> \.home-board\) \{[\s\S]*container-name: home-board-host;[\s\S]*container-type: inline-size;/);
  assert.doesNotMatch(boardCssSource, /\.home-tool-display:has\(> \.home-board\)/);
  assert.match(boardCssSource, /@container home-board-host \(max-width: 620px\)[\s\S]*grid-template-columns: repeat\(3, minmax\(190px, 1fr\)\)[\s\S]*overflow-x: auto[\s\S]*scroll-snap-type: x proximity/);
  assert.match(boardCssSource, /@media \(max-width: 600px\)[\s\S]*grid-auto-columns: minmax\(min\(82vw, 280px\), 1fr\)[\s\S]*scroll-snap/);
  assert.match(homeCssSource, /@media \(max-width: 768px\)[\s\S]*#home-hub\.dock-split \.home-tool-workbench[\s\S]*width: 100%/);
  assert.match(boardCssSource, /@media \(prefers-reduced-motion: reduce\)/);
});

test("generated avatars use a muted source palette while custom images bypass it", function () {
  assert.match(avatarGeneratorSource, /var MUTED_INDIGO = "#72778f"/);
  assert.match(avatarGeneratorSource, /var MATE_MARK_PALETTE = \[/);
  assert.doesNotMatch(avatarGeneratorSource, /#5857fc|#07e5a3/);
  assert.match(avatarSource, /if \(user && user\.avatarCustom\) return user\.avatarCustom/);
  assert.match(avatarSource, /if \(p\.avatarCustom \|\| mate\.avatarCustom\) return p\.avatarCustom \|\| mate\.avatarCustom/);
  assert.doesNotMatch(mateCssSource + iconCssSource, /filter:\s*(?:saturate|grayscale)/);
});

test("built-in generated Mates declare the same muted identity colors", function () {
  var expected = {
    arch: "#8a806a",
    rush: "#887b91",
    ward: "#6f8382",
    pixel: "#92756d",
    buzz: "#6f7489",
  };
  var keys = Object.keys(expected);
  for (var i = 0; i < keys.length; i++) {
    var pattern = new RegExp('key: "' + keys[i] + '"[\\s\\S]*?avatarColor: "' + expected[keys[i]] + '"');
    assert.match(builtinSource, pattern);
  }
  assert.match(builtinSource, /key: "clay"[\s\S]*avatarCustom: "\/clay-studio-symbol\.png"/);
  assert.match(builtinSource, /key: "ally"[\s\S]*avatarCustom: "\/mates\/ally\.png"/);
});

test("Escape respects overlays and editable controls before changing Workbench state", function () {
  assert.match(dockSource, /if \(hasVisibleEscapeLayer\(\)\) return;[\s\S]*closeHomeBackstage\(\)[\s\S]*hasEditableEscapeTarget\(event\.target\)[\s\S]*if \(!store\.get\('dockFocus'\)\) return/);
  assert.match(dockSource, /target\.matches\('input, textarea, select, \[contenteditable="true"\]'\)/);
  assert.match(dockSource, /target\.closest\('\[contenteditable="true"\]'\)/);
  assert.match(sheetSource, /event\.key === "Escape"[\s\S]*closeSheet\(\)/);
  assert.match(sidebarSource, /event\.key !== "Escape"[\s\S]*closeNarrowDrawer\(true\)/);
  assert.doesNotMatch(sidebarSource + dockSource, /history\.back\(\)|location\.href/);
});

test("popstate and same-tab Home suspension retain their conservative restoration paths", function () {
  assert.match(appSource, /window\.addEventListener\("popstate"[\s\S]*if \(!newSlug\) \{[\s\S]*showHomeHub\(true\);[\s\S]*return;/);
  assert.match(appSource, /if \(isHomeHubVisible\(\)\) hideHomeHub\(\)/);
  assert.match(hubSource, /var resume = homeHubSuspended \|\| homeHubVisible/);
  assert.match(hubSource, /if \(!resume\) \{[\s\S]*requestTools\(\)[\s\S]*requestHomeDockPreference\(\)[\s\S]*renderDock\(\)/);
  assert.match(hubSource, /homeHubSuspended = true/);
  assert.doesNotMatch(hubSource, /hideHomeHub\(\)[\s\S]{0,500}(?:closeHomeChat|closeHomeDock|resetHomeDockFocus)/);
});

test("Stage 9 client changes keep direct dependencies and module limits", function () {
  var modules = [
    "lib/public/modules/home-board.js",
    "lib/public/modules/home-dock.js",
    "lib/public/modules/avatar-imprint.js",
  ];
  for (var i = 0; i < modules.length; i++) {
    var moduleSource = source(modules[i]);
    assert.ok(moduleSource.split("\n").length < 500, modules[i] + " must stay under 500 lines");
    assert.doesNotMatch(moduleSource, /\b(?:const|let)\b|=>|localStorage/);
  }
  assert.match(boardSource, /from '\.\/store\.js'/);
  assert.match(boardSource, /from '\.\/ws-ref\.js'/);
  assert.doesNotMatch(boardSource, /var _ctx|init[A-Z][A-Za-z]+\(ctx\)/);
});
