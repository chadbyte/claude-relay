var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var pathToFileURL = require("url").pathToFileURL;

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-tools-registry-test-"));
process.env.CLAY_HOME = testRoot;
var registry = require("../lib/tools-registry");

test.after(function () { fs.rmSync(testRoot, { recursive: true, force: true }); });

function ctx(userId) { return { userId: userId, multiUser: true, linuxUser: null }; }
function validTool(id) {
  return {
    manifest: { id: id, name: "Test Tool", version: 1 },
    logicSource: "var tool = { initialState: {}, actions: {} };\n",
    uiTree: { type: "stack", children: [{ type: "text", props: { text: "Hello" } }] },
  };
}

function userToolIds(userCtx) {
  return registry.listTools(userCtx).filter(function (item) {
    return item.id !== "board" && item.id !== "scratchpad" && item.id !== "translator";
  }).map(function (item) { return item.id; });
}

test("tool registry rejects unsafe IDs and unknown UI nodes", function () {
  assert.throws(function () { registry.installTool(ctx("validation"), validTool("../escape")); }, /lowercase slug/);
  var badUi = validTool("bad-ui");
  badUi.uiTree.children.push({ type: "script" });
  assert.throws(function () { registry.installTool(ctx("validation"), badUi); }, /Unknown UI node type/);
  var badAlias = validTool("bad-alias");
  badAlias.manifest.modelAlias = "quickest";
  assert.throws(function () { registry.installTool(ctx("validation"), badAlias); }, /modelAlias must be fast, standard, or deep/);
});

test("Capsule UI v2 validates semantic presentation and rejects unsafe markup", function () {
  var translator = JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/capsules/translator/ui.json"), "utf8"));
  var scratchpad = JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/capsules/scratchpad/ui.json"), "utf8"));
  assert.strictEqual(registry.validateUiNode(translator), true);
  assert.strictEqual(registry.validateUiNode(scratchpad), true);

  var unsafeStyle = validTool("unsafe-style");
  unsafeStyle.uiTree.props = { style: "position:fixed" };
  assert.throws(function () { registry.installTool(ctx("validation"), unsafeStyle); }, /Unknown UI property 'style'/);
  var unsafeClass = validTool("unsafe-class");
  unsafeClass.uiTree.props = { class: "admin" };
  assert.throws(function () { registry.installTool(ctx("validation"), unsafeClass); }, /Unknown UI property 'class'/);
  assert.throws(function () { registry.validateUiNode({ type: "button", action: "go", props: { label: "Go", variant: "neon" } }); }, /must be one of/);
  assert.throws(function () { registry.validateUiNode({ type: "button", action: "go", props: { label: "Go", icon: "skull-crossbones" } }); }, /allowed Lucide icon/);
  assert.throws(function () { registry.validateUiNode({ type: "stack", children: [{ type: "text", id: "same" }, { type: "text", id: "same" }] }); }, /Duplicate UI node ID/);
  assert.throws(function () { registry.validateUiNode({ type: "input", id: "orphan", bind: "value", props: { label: "Value" } }); }, /requires bind and action/);
  assert.throws(function () { registry.validateUiNode({ type: "input", bind: "value", action: "setValue" }); }, /requires a label or ID/);
  assert.throws(function () { registry.validateUiNode({ type: "icon", props: { icon: "info" } }); }, /requires a label/);
  assert.throws(function () { registry.validateUiNode({ type: "text", bind: "$state.__proto__.polluted" }); }, /safe dot path/);
  assert.strictEqual(registry.validateUiNode({ type: "callout", when: "showError", children: [{ type: "text", bind: "error" }] }), true);
  assert.strictEqual(registry.validateUiNode({ type: "button", action: "remove", when: "$item.awaitingConfirmation", props: { label: "Confirm" } }), true);
  assert.throws(function () { registry.validateUiNode({ type: "text", when: "$state.constructor.visible" }); }, /safe state path/);
  assert.throws(function () { registry.validateUiNode({ type: "button", action: "go", props: { label: "Go", args: { value: "$item.constructor.name" } } }); }, /unsafe state path/);
  assert.throws(function () { registry.validateUiNode({ type: "select", id: "choice", bind: "choice", action: "choose", props: { options: [{ value: {}, label: "Bad" }] } }); }, /option value\/label types/);
  var deep = { type: "stack" };
  var cursor = deep;
  for (var depth = 0; depth < 16; depth++) { cursor.children = [{ type: "stack" }]; cursor = cursor.children[0]; }
  assert.throws(function () { registry.validateUiNode(deep); }, /exceeds depth/);
  var wide = { type: "stack", children: [] };
  for (var wi = 0; wi < 76; wi++) wide.children.push({ type: "stack", children: [{ type: "text" }, { type: "text" }, { type: "text" }, { type: "text" }] });
  assert.throws(function () { registry.validateUiNode(wide); }, /exceeds 300 nodes/);
});

test("tool install, list, get, and remove roundtrip", function () {
  var userCtx = ctx("roundtrip");
  var installed = registry.installTool(userCtx, validTool("roundtrip-tool"));
  assert.strictEqual(installed.manifest.id, "roundtrip-tool");
  assert.deepStrictEqual(userToolIds(userCtx), ["roundtrip-tool"]);
  assert.match(registry.getTool(userCtx, "roundtrip-tool").logicSource, /initialState/);
  assert.strictEqual(registry.removeTool(userCtx, "roundtrip-tool"), true);
  assert.strictEqual(registry.getTool(userCtx, "roundtrip-tool"), null);
});

test("tool registry isolates users", function () {
  registry.installTool(ctx("first-user"), validTool("private-tool"));
  assert.deepStrictEqual(userToolIds(ctx("first-user")), ["private-tool"]);
  assert.deepStrictEqual(userToolIds(ctx("second-user")), []);
});

test("registry scans dropped folders, reports invalid folders, and sees deletion", function () {
  var userCtx = ctx("folder-scan");
  registry.listTools(userCtx);
  var root = registry.resolveToolsRoot(userCtx);
  var dropped = path.join(root, "dropped-tool");
  fs.mkdirSync(dropped, { recursive: true });
  fs.writeFileSync(path.join(dropped, "manifest.json"), JSON.stringify({ id: "dropped-tool", name: "Dropped" }));
  fs.writeFileSync(path.join(dropped, "logic.js"), validTool("dropped-tool").logicSource);
  fs.writeFileSync(path.join(dropped, "ui.json"), JSON.stringify(validTool("dropped-tool").uiTree));
  assert.ok(registry.listTools(userCtx).some(function (item) { return item.id === "dropped-tool" && !item.error; }));

  var invalid = path.join(root, "broken-tool");
  fs.mkdirSync(invalid, { recursive: true });
  fs.writeFileSync(path.join(invalid, "manifest.json"), "{not json");
  fs.writeFileSync(path.join(invalid, "ui.json"), JSON.stringify({ type: "stack" }));
  var broken = registry.listTools(userCtx).filter(function (item) { return item.id === "broken-tool"; })[0];
  assert.ok(broken.error);

  fs.rmSync(dropped, { recursive: true, force: true });
  assert.ok(!registry.listTools(userCtx).some(function (item) { return item.id === "dropped-tool"; }));
});

test("built-in capsule folders seed once and user deletion stays durable", function () {
  var userCtx = ctx("builtin-seed");
  var first = registry.listTools(userCtx);
  assert.ok(first.some(function (item) { return item.id === "board" && item.runtime === "server"; }));
  assert.ok(first.some(function (item) { return item.id === "scratchpad" && item.runtime === "worker"; }));
  var translator = registry.getTool(userCtx, "translator");
  assert.ok(translator);
  assert.deepStrictEqual(translator.manifest.permissions, ["llm"]);
  assert.strictEqual(translator.manifest.modelAlias, "fast");
  assert.match(translator.logicSource, /api\.llm\.complete/);
  registry.removeTool(userCtx, "scratchpad");
  assert.ok(!registry.listTools(userCtx).some(function (item) { return item.id === "scratchpad"; }));
});

test("old shipped Translator metadata is hydrated in memory without upgrading custom content", async function () {
  var shippedCtx = ctx("builtin-metadata-hydration");
  registry.listTools(shippedCtx);
  var shippedRoot = registry.resolveToolsRoot(shippedCtx);
  var manifestPath = path.join(shippedRoot, "translator", "manifest.json");
  var oldManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  delete oldManifest.modelAlias;
  fs.writeFileSync(manifestPath, JSON.stringify(oldManifest, null, 2) + "\n", "utf8");

  var hydrated = registry.getTool(shippedCtx, "translator");
  var status = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-llm-status.js")).href);
  assert.strictEqual(hydrated.manifest.modelAlias, "fast");
  assert.strictEqual(status.initialToolLlmAlias(hydrated.manifest), "fast");
  assert.strictEqual(JSON.parse(fs.readFileSync(manifestPath, "utf8")).modelAlias, undefined);

  var customCtx = ctx("custom-translator-metadata");
  registry.listTools(customCtx);
  var customRoot = registry.resolveToolsRoot(customCtx);
  var customManifestPath = path.join(customRoot, "translator", "manifest.json");
  var customManifest = JSON.parse(fs.readFileSync(customManifestPath, "utf8"));
  delete customManifest.modelAlias;
  fs.writeFileSync(customManifestPath, JSON.stringify(customManifest, null, 2) + "\n", "utf8");
  fs.appendFileSync(path.join(customRoot, "translator", "logic.js"), "\n// User-customized behavior.\n", "utf8");
  var custom = registry.getTool(customCtx, "translator");
  assert.strictEqual(custom.manifest.modelAlias, undefined);
  assert.strictEqual(status.initialToolLlmAlias(custom.manifest), null);
});

test("v2 seed migration adds translator without restoring deleted older capsules", function () {
  var userCtx = ctx("builtin-upgrade");
  var root = registry.resolveToolsRoot(userCtx);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, ".capsules-v1"), "board\nscratchpad\n");
  var listed = registry.listTools(userCtx);
  assert.ok(listed.some(function (item) { return item.id === "translator"; }));
  assert.ok(!listed.some(function (item) { return item.id === "board"; }));
  assert.ok(!listed.some(function (item) { return item.id === "scratchpad"; }));
});

test("v3 seed upgrades only untouched shipped v1 UIs and preserves deletions/customizations", function () {
  var userCtx = ctx("builtin-ui-v2-upgrade");
  var root = registry.resolveToolsRoot(userCtx);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, ".capsules-v2"), "board\nscratchpad\ntranslator\n");
  fs.cpSync(path.join(__dirname, "../lib/capsules/translator"), path.join(root, "translator"), { recursive: true });
  fs.cpSync(path.join(__dirname, "../lib/capsules/scratchpad"), path.join(root, "scratchpad"), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "fixtures/translator-ui-v1.json"), path.join(root, "translator/ui.json"));
  fs.copyFileSync(path.join(__dirname, "fixtures/scratchpad-ui-v1.json"), path.join(root, "scratchpad/ui.json"));
  var customScratchpad = JSON.parse(fs.readFileSync(path.join(root, "scratchpad/ui.json"), "utf8"));
  customScratchpad.children[0].props.text = "My private scratchpad";
  fs.writeFileSync(path.join(root, "scratchpad/ui.json"), JSON.stringify(customScratchpad, null, 2) + "\n");

  registry.listTools(userCtx);
  var upgraded = JSON.parse(fs.readFileSync(path.join(root, "translator/ui.json"), "utf8"));
  assert.strictEqual(upgraded.children[0].children[1].props.role, "display");
  assert.match(fs.readFileSync(path.join(root, "scratchpad/ui.json"), "utf8"), /My private scratchpad/);
  assert.strictEqual(fs.existsSync(path.join(root, "board")), false);
  assert.strictEqual(fs.existsSync(path.join(root, ".capsules-v3")), true);
});

test("tool install rejects server runtime", function () {
  var serverTool = validTool("unsafe-server");
  serverTool.manifest.runtime = "server";
  assert.throws(function () { registry.installTool(ctx("server-runtime"), serverTool); }, /cannot be installed over WebSocket/);
});
