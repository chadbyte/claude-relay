var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-project-tool-boundary-"));
process.env.CLAY_HOME = testRoot;
var createMateToolControlMcp = require("../lib/project").createMateToolControlMcp;
var serverTools = require("../lib/server-tools");

test.after(function () { fs.rmSync(testRoot, { recursive: true, force: true }); });

function namedTool(server, name) {
  return server.tools.filter(function (definition) { return definition.name === name; })[0];
}

async function valueFrom(definition, input) {
  var response = await definition.handler(input || {});
  assert.notStrictEqual(response.isError, true, response.content[0].text);
  return JSON.parse(response.content[0].text);
}

test("project Mate MCP boundary routes source and authoring signatures without Mate-ID shifting", async function () {
  var users = { isMultiUser: function () { return false; }, findUserById: function () { return null; } };
  var projects = new Map();
  projects.set("home", { forEachClient: function () {} });
  var tools = serverTools.attachTools({ users: users, projects: projects });
  tools.installForMate("default", {
    manifest: { id: "boundary-source", name: "Boundary Source", runtime: "worker" },
    uiTree: { type: "stack", children: [{ type: "text", props: { text: "Boundary" } }] },
    logicSource: "var tool = { initialState: { boundary: true }, actions: {} };",
  });
  tools.setMateAccess("default", "boundary-source", true);

  var calls = [];
  var adapter = { createToolServer: function (definition) { return { name: definition.name, tools: definition.tools }; } };
  var server = createMateToolControlMcp(adapter, {
    userId: "default",
    mateId: "mate-project-folder",
    list: function (userId) { calls.push(["list", userId]); return tools.installedManifests(userId); },
    control: function () { return {}; },
    source: function (userId, toolId) { calls.push(["source", userId, toolId]); return tools.sourceForMate(userId, toolId); },
    install: function (userId, input) { calls.push(["install", userId, input.manifest.id]); return { installed: input.manifest.id }; },
    update: function (userId, toolId, input) { calls.push(["update", userId, toolId, input.baseRevision]); return { updated: toolId }; },
    remove: function (userId, toolId) { calls.push(["remove", userId, toolId]); return { removed: toolId }; },
  });

  var source = await valueFrom(namedTool(server, "clay_tool_source"), { toolId: "boundary-source" });
  assert.strictEqual(source.manifest.id, "boundary-source");
  assert.match(source.logicSource, /boundary: true/);
  assert.deepStrictEqual(calls[0], ["source", "default", "boundary-source"]);

  await valueFrom(namedTool(server, "clay_tool_install"), {
    manifest: { id: "install-id", name: "Install" }, uiTree: { type: "stack" }, logicSource: "var tool = { initialState: {}, actions: {} };",
  });
  await valueFrom(namedTool(server, "clay_tool_update"), {
    toolId: "update-id", baseRevision: "revision-1", manifest: { id: "update-id", name: "Update" },
    uiTree: { type: "stack" }, logicSource: "var tool = { initialState: {}, actions: {} };",
  });
  await valueFrom(namedTool(server, "clay_tool_uninstall"), { toolId: "remove-id" });
  assert.deepStrictEqual(calls.slice(1), [
    ["install", "default", "install-id"],
    ["update", "default", "update-id", "revision-1"],
    ["remove", "default", "remove-id"],
  ]);
});
