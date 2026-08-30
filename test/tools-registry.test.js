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

test("tool install rejects server runtime", function () {
  var serverTool = validTool("unsafe-server");
  serverTool.manifest.runtime = "server";
  assert.throws(function () { registry.installTool(ctx("server-runtime"), serverTool); }, /cannot be installed over WebSocket/);
});
