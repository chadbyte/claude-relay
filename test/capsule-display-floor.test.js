var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-capsule-floor-"));
process.env.CLAY_HOME = testRoot;

var capsuleFloor = require("../lib/capsule-display-floor");
var registry = require("../lib/tools-registry");
var catalog = require("../lib/project-capsule-catalog");
var createMateToolControlMcp = require("../lib/project").createMateToolControlMcp;

test.after(function () { fs.rmSync(testRoot, { recursive: true, force: true }); });

function ctx(userId) {
  return { userId: userId, multiUser: true };
}

var SPARSE_TREE = { type: "stack" };

test("the floor question is the one tool-ui-spec answers, and a sparse tree still counts", function () {
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A" }, SPARSE_TREE), true);
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A" }, { type: "stack", children: [{ type: "row", children: [] }] }), true);
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A", uiTree: SPARSE_TREE }), true);

  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A" }, { type: "iframe" }), false);
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A" }, undefined), false);
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A" }, null), false);
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "broken", error: "Capsule folder failed to load." }, SPARSE_TREE), false);
  assert.strictEqual(capsuleFloor.hasUsableFloor({ name: "No ID" }, SPARSE_TREE), false);
  assert.strictEqual(capsuleFloor.hasUsableFloor(null), false);

  // Manifest-dependent UI rules are still the ui-spec's to enforce.
  var modelSelect = { type: "model-select", id: "model", bind: "model", action: "setModel", props: { label: "Model" } };
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A", runtime: "worker", permissions: ["llm"] }, modelSelect), true);
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A", runtime: "worker" }, modelSelect), false);

  assert.throws(function () { capsuleFloor.assertFloor(undefined, { id: "a", name: "A" }); }, /declarative floor element/);
  assert.throws(function () { capsuleFloor.assertFloor({ type: "iframe" }, { id: "a", name: "A" }); }, /Unknown UI node type/);
  assert.strictEqual(capsuleFloor.assertFloor(SPARSE_TREE, { id: "a", name: "A" }), true);
});

test("the gate reads the Display itself and ignores an asserted floor status", function () {
  // A forged verdict changes nothing in either direction.
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A", displayFloor: { available: true } }, { type: "iframe" }), false);
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A", displayFloor: { available: false } }, SPARSE_TREE), true);
  assert.strictEqual(capsuleFloor.hasUsableFloor({ id: "a", name: "A", displayFloor: { available: true } }), false);

  // And an authored manifest may not carry one at all.
  assert.throws(function () {
    registry.installTool(ctx("floor-claim"), {
      manifest: { id: "claims-floor", name: "Claims Floor", displayFloor: { available: true } },
      uiTree: SPARSE_TREE,
      logicSource: "var tool = { initialState: {}, actions: {} };",
    });
  }, /displayFloor cannot be authored/);
});

test("registration refuses a Capsule whose Display is missing or invalid", function () {
  var user = ctx("floor-install");
  assert.throws(function () {
    registry.installTool(user, {
      manifest: { id: "no-floor", name: "No Floor" },
      logicSource: "var tool = { initialState: {}, actions: {} };",
    });
  }, /must be an object|declarative floor element/);
  assert.throws(function () {
    registry.installTool(user, {
      manifest: { id: "bad-floor", name: "Bad Floor" },
      uiTree: { type: "iframe" },
      logicSource: "var tool = { initialState: {}, actions: {} };",
    });
  }, /Unknown UI node type/);

  // A sparse declarative tree is a floor, so it registers.
  var installed = registry.installTool(user, {
    manifest: { id: "sparse-floor", name: "Sparse Floor" },
    uiTree: SPARSE_TREE,
    logicSource: "var tool = { initialState: {}, actions: {} };",
  });
  assert.strictEqual(installed.manifest.id, "sparse-floor");
  assert.strictEqual(installed.manifest.displayFloor, undefined);

  var revision = registry.getToolSource(user, "sparse-floor").revision;
  assert.throws(function () {
    registry.updateTool(user, "sparse-floor", {
      baseRevision: revision,
      manifest: { id: "sparse-floor", name: "Sparse Floor" },
      uiTree: { type: "iframe" },
      logicSource: "var tool = { initialState: {}, actions: {} };",
    });
  }, /Unknown UI node type/);
});

test("listed manifests carry their own Display without leaking it into a projection", function () {
  var user = ctx("floor-listing");
  registry.installTool(user, {
    manifest: { id: "listed-tool", name: "Listed Tool" },
    uiTree: { type: "stack", children: [{ type: "text", props: { text: "Listed" } }] },
    logicSource: "var tool = { initialState: {}, actions: {} };",
  });
  var listed = registry.listTools(user).filter(function (manifest) { return manifest.id === "listed-tool"; })[0];
  assert.strictEqual(listed.uiTree.type, "stack");
  assert.strictEqual(capsuleFloor.hasUsableFloor(listed), true);
  assert.strictEqual(Object.keys(listed).indexOf("uiTree"), -1);
  assert.strictEqual(JSON.parse(JSON.stringify(listed)).uiTree, undefined);
});

test("Skills go dark when the floor does, in the catalog and in clay_tool_list", async function () {
  var manifests = [
    { id: "grounded", name: "Grounded", description: "Has a floor.", useWhen: "Use freely.", runtime: "worker", uiTree: SPARSE_TREE },
    { id: "floorless", name: "Floorless", description: "Lost its floor.", useWhen: "Never.", runtime: "worker", uiTree: { type: "iframe" } },
    { id: "displayless", name: "Displayless", description: "Never had one.", useWhen: "Never.", runtime: "worker" },
    { id: "unreadable", error: "Capsule requires manifest.json and ui.json." },
  ];
  var prompt = catalog.buildCapsuleCatalogPrompt(manifests);
  assert.match(prompt, /"id":"grounded"/);
  assert.doesNotMatch(prompt, /floorless|displayless|unreadable/);

  var attached = catalog.attachCapsuleCatalog({ isMate: true, listManifests: function () { return manifests; } });
  assert.doesNotMatch(attached.getSystemPrompt({}), /floorless/);
  assert.strictEqual(catalog.buildCapsuleCatalogPrompt(manifests.slice(1)), "");

  var adapter = { createToolServer: function (definition) { return definition; } };
  var server = createMateToolControlMcp(adapter, {
    userId: "default",
    mateId: "mate-folder",
    list: function () { return manifests; },
    control: function () { return {}; },
    source: function () { return {}; },
    install: function () { return {}; },
    update: function () { return {}; },
    remove: function () { return {}; },
  });
  var listTool = server.tools.filter(function (definition) { return definition.name === "clay_tool_list"; })[0];
  var response = await listTool.handler({});
  var listed = JSON.parse(response.content[0].text);
  assert.deepStrictEqual(listed.map(function (entry) { return entry.id; }), ["grounded"]);
  assert.strictEqual(listed[0].uiTree, undefined);
});
