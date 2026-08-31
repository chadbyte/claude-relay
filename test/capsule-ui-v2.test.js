var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");

function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }

function walk(node, visit) {
  visit(node);
  var children = node.children || [];
  for (var i = 0; i < children.length; i++) walk(children[i], visit);
}

test("shipped Translator and Scratchpad demonstrate UI v2 without changing control contracts", function () {
  var translator = JSON.parse(read("lib/capsules/translator/ui.json"));
  var scratchpad = JSON.parse(read("lib/capsules/scratchpad/ui.json"));
  var translatorIds = [];
  var scratchpadIds = [];
  var translatorTypes = [];
  walk(translator, function (node) { if (node.id) translatorIds.push(node.id); translatorTypes.push(node.type); });
  walk(scratchpad, function (node) { if (node.id) scratchpadIds.push(node.id); });
  assert.deepStrictEqual(translatorIds.sort(), ["source-text", "translate", "translation-direction", "translation-model"]);
  assert.deepStrictEqual(scratchpadIds.sort(), ["add-note", "scratch-input"]);
  assert.ok(translatorTypes.indexOf("section") !== -1);
  assert.ok(translatorTypes.indexOf("model-select") !== -1);
  assert.ok(translatorTypes.indexOf("divider") === -1);
  assert.strictEqual(translator.children[0].children[1].props.role, "display");
  assert.strictEqual(translator.children[1].props.variant, "raised");
  assert.strictEqual(translator.children[2].props.variant, "output");
  assert.strictEqual(scratchpad.children[1].children[0].children[1].props.variant, "primary");
});

test("Capsule UI stylesheet is isolated, themed, accessible, and responsive", function () {
  var entry = read("lib/public/style.css");
  var css = read("lib/public/css/capsule-ui.css");
  var oldHomeCss = read("lib/public/css/home-hub.css");
  assert.match(entry, /css\/capsule-ui\.css/);
  assert.match(css, /\.home-tool-display[\s\S]*font-family: inherit/);
  assert.match(css, /\.tool-heading--role-display[\s\S]*font-family: inherit/);
  assert.match(css, /\.tool-text--role-output[\s\S]*font-family: inherit/);
  assert.match(css, /\.tool-button--variant-primary[\s\S]*background: var\(--accent\)/);
  assert.match(css, /\.tool-button--variant-primary:hover[^}]*background: var\(--accent-hover\)/);
  assert.match(css, /\.tool-button--variant-secondary[^}]*var\(--accent-bg\)/);
  assert.match(css, /\.tool-card--variant-output[\s\S]*background: var\(--accent-bg\)/);
  assert.match(css, /\.tool-badge--tone-info[^}]*var\(--accent2-bg\)/);
  assert.match(css, /\.tool-badge--tone-success[^}]*var\(--success-12\)/);
  assert.match(css, /\.tool-badge--tone-warning[^}]*var\(--warning-bg\)/);
  assert.match(css, /\.tool-badge--tone-danger[^}]*var\(--error-12\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /Source Serif|Georgia|--capsule-|#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(css, /#b96842|#71371f|#39788c|#39775a|#9a6a22|#df8d65|#ffd4bf|#76b7ca|#72b891|#d6a657/i);
  assert.doesNotMatch(css, /\.dark-theme \.home-tool-display/);
  assert.doesNotMatch(oldHomeCss, /\.tool-stack\s*\{/);
  assert.ok(css.split("\n").length < 500);
});

test("renderer keeps semantic mapping and text-only content boundaries", function () {
  var renderer = read("lib/public/modules/tool-renderer.js");
  var semantics = read("lib/public/modules/tool-renderer-semantics.js");
  assert.match(renderer, /textContent = String/);
  assert.match(renderer, /appendToolIcon/);
  assert.match(renderer, /aria-describedby/);
  assert.match(renderer, /disabled = resolvedBoolean/);
  assert.match(renderer, /bindToolTextInput/);
  assert.doesNotMatch(renderer + semantics, /\.style\.|insertAdjacentHTML|props\.(?:class|style|html)/);
  assert.strictEqual((renderer.match(/innerHTML\s*=/g) || []).length, 1);
});
