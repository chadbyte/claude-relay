var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

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

test("tool registry rejects unsafe IDs and unknown UI nodes", function () {
  assert.throws(function () { registry.installTool(ctx("validation"), validTool("../escape")); }, /lowercase slug/);
  var badUi = validTool("bad-ui");
  badUi.uiTree.children.push({ type: "script" });
  assert.throws(function () { registry.installTool(ctx("validation"), badUi); }, /Unknown UI node type/);
});

test("tool install, list, get, and remove roundtrip", function () {
  var userCtx = ctx("roundtrip");
  var installed = registry.installTool(userCtx, validTool("roundtrip-tool"));
  assert.strictEqual(installed.manifest.id, "roundtrip-tool");
  assert.deepStrictEqual(registry.listTools(userCtx).map(function (item) { return item.id; }), ["roundtrip-tool"]);
  assert.match(registry.getTool(userCtx, "roundtrip-tool").logicSource, /initialState/);
  assert.strictEqual(registry.removeTool(userCtx, "roundtrip-tool"), true);
  assert.strictEqual(registry.getTool(userCtx, "roundtrip-tool"), null);
});

test("tool registry isolates users", function () {
  registry.installTool(ctx("first-user"), validTool("private-tool"));
  assert.strictEqual(registry.listTools(ctx("first-user")).length, 1);
  assert.strictEqual(registry.listTools(ctx("second-user")).length, 0);
});
