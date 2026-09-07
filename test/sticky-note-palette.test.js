var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var baseCss = fs.readFileSync(path.join(root, "lib/public/css/base.css"), "utf8");
var css = fs.readFileSync(path.join(root, "lib/public/css/sticky-notes.css"), "utf8");
var source = fs.readFileSync(path.join(root, "lib/public/modules/sticky-notes.js"), "utf8");
// The index cards moved to the bounded browser pane; the palette follows them.
var browserSource = fs.readFileSync(path.join(root, "lib/public/modules/sticky-notes-browser.js"), "utf8");
// The canvas was split into focused modules; the palette now lives across the
// shared leaf and the card, so assertions read whichever owns each concern.
var sharedSource = fs.readFileSync(path.join(root, "lib/public/modules/sticky-notes-shared.js"), "utf8");
var cardSource = fs.readFileSync(path.join(root, "lib/public/modules/sticky-notes-card.js"), "utf8");
var canvasFamily = source + sharedSource + cardSource;
var notesSource = fs.readFileSync(path.join(root, "lib/notes.js"), "utf8");
var sessionNotesSource = fs.readFileSync(path.join(root, "lib/project-session-notes.js"), "utf8");
var colors = ["yellow", "blue", "green", "pink", "orange", "purple"];

test("sticky notes keep their six persisted color keys and use one shared token palette", function () {
  assert.match(sharedSource, /var NOTE_COLORS = \["purple", "green", "yellow", "blue", "pink", "orange"\];/);
  assert.match(sessionNotesSource, /var NOTE_COLORS = \["purple", "green", "yellow", "blue", "pink", "orange"\];/);
  assert.match(canvasFamily, /el\.dataset\.color = data\.color \|\| "purple"/);
  assert.match(canvasFamily, /dot\.dataset\.color = color/);
  assert.match(browserSource, /card\.dataset\.color = data\.color \|\| "purple"/);
  colors.forEach(function (color) {
    var occurrences = css.match(new RegExp('data-color="' + color + '"', "g")) || [];
    assert.strictEqual(occurrences.length, 1, color + " should have one theme-responsive token mapping");
  });
  assert.match(css, /:is\(\.sticky-note, \.notes-browser-card, \.sticky-note-color-dot\) \{[^}]*--note-surface: color-mix\(in oklch, var\(--note-tone\) 40%, var\(--brand-paper\)\);[^}]*--note-border: color-mix\(in oklch, var\(--note-tone\) 62%, #c7c7c1\);[^}]*--note-ink: color-mix\(in oklch, var\(--note-tone\) 20%, var\(--brand-ink\)\);[^}]*--note-swatch: color-mix\(in srgb, var\(--note-surface\) 58%, transparent\)/);
  assert.match(css, /\.dark-theme :is\(\.sticky-note, \.notes-browser-card, \.sticky-note-color-dot\) \{[^}]*--note-surface: color-mix\(in oklch, var\(--note-tone\) 40%, var\(--brand-ink\)\);[^}]*--note-border: color-mix\(in oklch, var\(--note-tone\) 60%, #393934\);[^}]*--note-ink: color-mix\(in oklch, var\(--note-tone\) 18%, var\(--brand-paper\)\)/);
  assert.match(css, /data-color="purple"\][^}]*--note-tone: var\(--brand-indigo\)/);
  assert.match(css, /data-color="green"\][^}]*--note-tone: var\(--brand-green\)/);
  assert.match(css, /data-color="yellow"\][^}]*--note-tone: var\(--brand-gold\)/);
  assert.match(css, /data-color="blue"\][^}]*--note-tone: var\(--brand-blue\)/);
  assert.match(css, /data-color="pink"\][^}]*--note-tone: var\(--brand-coral\)/);
  assert.match(css, /data-color="orange"\][^}]*--note-tone: var\(--brand-clay\)/);
  assert.doesNotMatch(css, /\.dark-theme :is\(\.sticky-note, \.notes-browser-card, \.sticky-note-color-dot\)\[data-color=/);
});

test("live notes, browser cards, and picker swatches consume the shared palette", function () {
  assert.match(css, /\.sticky-note \{[^}]*border: 1px solid color-mix\(in srgb, var\(--note-border\) calc\(var\(--note-opacity, 0\.64\) \* 100%\), transparent\);[^}]*background: color-mix\(in srgb, var\(--note-surface\) calc\(var\(--note-opacity, 0\.64\) \* 100%\), transparent\);[^}]*color: var\(--note-ink\);/);
  assert.match(css, /\.sticky-note \.sticky-note-header button \{ color: var\(--note-ink\); \}/);
  assert.match(css, /\.sticky-note \.sticky-note-header button:hover \{[^}]*var\(--note-ink\)/);
  assert.match(css, /\.sticky-note \.sticky-note-body \{ color: var\(--note-ink\); \}/);
  assert.match(css, /\.sticky-note \.sticky-note-body \{ opacity: max\(0\.78, var\(--note-opacity, 0\.64\)\); \}/);
  assert.match(css, /\.sticky-note-opacity-slider \{ accent-color: var\(--note-ink\); \}/);
  assert.match(css, /\.sticky-note-color-dot \{ background: var\(--note-swatch\); \}/);
  assert.match(css, /\.sticky-note-color-dot \{[^}]*box-shadow: inset 0 0 0 1px color-mix\(in srgb, var\(--note-border\) 68%, transparent\)/);
  assert.match(css, /\.notes-browser-card \{[^}]*border: 1px solid var\(--note-border\);[^}]*background: var\(--note-surface\);[^}]*color: var\(--note-ink\);/);
  assert.match(css, /\.notes-browser-card-title \{ color: var\(--note-ink\); \}/);
  assert.match(css, /\.notes-browser-card-body \{ color: var\(--note-ink\); \}/);
});

test("transparent live notes avoid backdrop repaint while preserving a readable content floor", function () {
  var liveRule = css.slice(css.indexOf(".sticky-note {"), css.indexOf(".sticky-note:hover"));
  assert.doesNotMatch(liveRule, /backdrop-filter/);
  assert.match(css, /\.sticky-note \{[^}]*overflow: hidden;/);
  assert.match(css, /border: 1px solid color-mix\(in srgb, var\(--note-border\) calc\(var\(--note-opacity, 0\.64\) \* 100%\), transparent\)/);
  assert.match(css, /background: color-mix\(in srgb, var\(--note-surface\) calc\(var\(--note-opacity, 0\.64\) \* 100%\), transparent\)/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\) \{[\s\S]*\.sticky-note \{[\s\S]*border-color: var\(--note-border\);[\s\S]*background: var\(--note-surface\);/);
  assert.doesNotMatch(css, /\.notes-browser-card \{[^}]*backdrop-filter/);
  assert.doesNotMatch(css, /\.sticky-note-color-picker \{[^}]*backdrop-filter/);
  assert.match(canvasFamily, /opacitySlider\.min = "20"/);
  assert.match(canvasFamily, /opacitySlider\.max = "100"/);
  assert.match(canvasFamily, /typeof data\.opacity === "number" \? data\.opacity : 0\.64/);
  assert.match(canvasFamily, /opacity: 0\.64/);
  assert.match(notesSource, /opacity: typeof data\.opacity === "number" \? data\.opacity : 0\.64/);
});

test("new notes default to Clay indigo without migrating persisted keys", function () {
  assert.match(canvasFamily, /color: "purple"/);
  assert.match(notesSource, /color: data\.color \|\| "purple"/);
  assert.match(sessionNotesSource, /color: color \|\| "purple"/);
});

test("the old saturated palette is absent and the new palette is editor-skin independent", function () {
  var oldPalette = ["fff9c4", "efd74e", "bbdefb", "64b5f6", "c8e6c9", "66bb6a", "f8bbd0", "f06292", "ffe0b2", "ffa726", "e1bee7", "ab47bc", "3a7bd5", "c44a72"];
  oldPalette.forEach(function (hex) {
    assert.doesNotMatch(css.toLowerCase(), new RegExp("#" + hex));
  });
  assert.doesNotMatch(css, /--note-(?:surface|border|ink|swatch):[^;}]*var\(--(?:bg|bg-alt|border|text|accent|accent2|success|warning|error|link)\)/);
  assert.match(css, /var\(--brand-indigo\)/);
  assert.match(css, /var\(--brand-green\)/);
  assert.match(css, /var\(--brand-paper\)/);
  assert.match(css, /var\(--brand-ink\)/);
  assert.match(baseCss, /--brand-indigo: #5857fc/);
  assert.match(baseCss, /--brand-green: #07e5a3/);
  assert.match(baseCss, /--brand-gold: #e0b45b/);
  assert.match(baseCss, /--brand-blue: #8aa7ff/);
  assert.match(baseCss, /--brand-coral: #ff7479/);
  assert.match(baseCss, /--brand-clay: #d69a7d/);
});
