var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-tool-control-test-"));
process.env.CLAY_HOME = testRoot;

var serverBoard = require("../lib/server-board");
var serverTools = require("../lib/server-tools");
var getToolDefs = require("../lib/tool-control-mcp-server").getToolDefs;

test.after(function () { fs.rmSync(testRoot, { recursive: true, force: true }); });

function harness(timeoutMs) {
  var sockets = [];
  var projects = new Map();
  var projectClients = new Set();
  var projectContext = {
    clients: projectClients,
    forEachClient: function (visit) {
      for (var i = 0; i < sockets.length; i++) visit(sockets[i]);
    },
  };
  projects.set("home", projectContext);
  var users = {
    isMultiUser: function () { return false; },
    findUserById: function () { return null; },
  };
  var boardHandler = serverBoard.attachBoard({ users: users, projects: projects });
  var toolsHandler = serverTools.attachTools({
    users: users,
    projects: projects,
    boardHandler: boardHandler,
    controlTimeoutMs: timeoutMs || 15000,
  });
  var mateId = "mate_test";
  var handlers = {
    list: function () {
      return toolsHandler.installedManifests("default").map(function (manifest) {
        return { id: manifest.id, name: manifest.name, runtime: manifest.runtime, permissions: manifest.permissions || [], skills: manifest.skills || "" };
      });
    },
    snapshot: function (toolId) {
      return toolsHandler.controlForMate("default", mateId, toolId, "snapshot", {});
    },
    act: function (toolId, actionId, args) {
      return toolsHandler.controlForMate("default", mateId, toolId, "act", { actionId: actionId, args: args });
    },
    set: function (toolId, controlId, value) {
      return toolsHandler.controlForMate("default", mateId, toolId, "set", { controlId: controlId, value: value });
    },
    install: function (input) { return toolsHandler.installForMate("default", input); },
    uninstall: function (toolId) { return toolsHandler.removeForMate("default", toolId); },
  };
  return { sockets: sockets, projectClients: projectClients, projectContext: projectContext, board: boardHandler, tools: toolsHandler, defs: getToolDefs(handlers) };
}

function tool(defs, name) {
  return defs.filter(function (definition) { return definition.name === name; })[0];
}

async function result(definition, args) {
  var response = await definition.handler(args || {});
  return { response: response, value: response.isError ? null : JSON.parse(response.content[0].text) };
}

test("mate tool MCP exposes driving and approved authoring tools with installed skills", async function () {
  var ctx = harness();
  assert.deepStrictEqual(ctx.defs.map(function (definition) { return definition.name; }), [
    "clay_tool_list", "clay_tool_snapshot", "clay_tool_act", "clay_tool_set", "clay_tool_install", "clay_tool_uninstall",
  ]);
  var listed = await result(tool(ctx.defs, "clay_tool_list"), {});
  assert.ok(listed.value.some(function (item) { return item.id === "board" && item.runtime === "server"; }));
  var scratchpad = listed.value.filter(function (item) { return item.id === "scratchpad"; })[0];
  assert.match(scratchpad.skills, /clay_tool_set/);
  var translator = listed.value.filter(function (item) { return item.id === "translator"; })[0];
  assert.deepStrictEqual(translator.permissions, ["llm"]);
});

test("mate capsule install uses registry validation and broadcasts live changes", async function () {
  var ctx = harness();
  var sent = [];
  ctx.sockets.push({ readyState: 1, send: function (payload) { sent.push(JSON.parse(payload)); } });
  var installed = await result(tool(ctx.defs, "clay_tool_install"), {
    manifest: { id: "mate-widget", name: "Mate Widget", runtime: "worker" },
    uiTree: { type: "stack", children: [{ type: "text", props: { text: "Ready" } }] },
    logicSource: "var tool = { initialState: {}, actions: {} };",
  });
  assert.strictEqual(installed.value.manifest.id, "mate-widget");
  assert.strictEqual(sent[0].type, "tool_installed");

  var rejected = await result(tool(ctx.defs, "clay_tool_install"), {
    manifest: { id: "mate-server", name: "Mate Server", runtime: "server" },
    uiTree: { type: "stack" },
    logicSource: "var tool = { initialState: {}, actions: {} };",
  });
  assert.strictEqual(rejected.response.isError, true);
  assert.match(rejected.response.content[0].text, /cannot be installed over WebSocket/);

  var removed = await result(tool(ctx.defs, "clay_tool_uninstall"), { toolId: "mate-widget" });
  assert.strictEqual(removed.value.removed, true);
  assert.strictEqual(sent[1].type, "tool_removed");
});

test("board MCP actions preserve mate done rules and record attribution", async function () {
  var ctx = harness();
  var events = [];
  ctx.sockets.push({
    readyState: 1,
    send: function (payload) { events.push(JSON.parse(payload)); },
  });
  var created = await result(tool(ctx.defs, "clay_tool_act"), {
    toolId: "board",
    actionId: "create",
    args: { title: "Mate-owned card" },
  });
  assert.strictEqual(created.value.result.createdBy, "mate_test");
  assert.strictEqual(events[0].callerId, "mate_test");

  var moved = await result(tool(ctx.defs, "clay_tool_act"), {
    toolId: "board",
    actionId: "move",
    args: { cardId: created.value.result._id, column: "done" },
  });
  assert.strictEqual(moved.response.isError, true);
  assert.match(moved.response.content[0].text, /Only the user can move a card to done/);

  var proposed = await result(tool(ctx.defs, "clay_tool_act"), {
    toolId: "board",
    actionId: "propose_done",
    args: { cardId: created.value.result._id },
  });
  assert.strictEqual(proposed.value.result.pendingDone, true);
  assert.strictEqual(proposed.value.result.createdBy, "mate_test");
});

test("tool_install rejects a server-runtime manifest over WebSocket", async function () {
  var ctx = harness();
  var sent = [];
  var ws = { readyState: 1, send: function (payload) { sent.push(JSON.parse(payload)); } };
  ctx.tools.handleMessage(ws, {
    type: "tool_install",
    manifest: { id: "unsafe-server", name: "Unsafe", runtime: "server" },
    logicSource: "var tool = { initialState: {}, actions: {} };",
    uiTree: { type: "stack" },
  });
  for (var i = 0; i < 50 && sent.length === 0; i++) {
    await new Promise(function (resolve) { setTimeout(resolve, 5); });
  }
  assert.strictEqual(sent[0].type, "tools_error");
  assert.match(sent[0].message, /cannot be installed over WebSocket/);
});

test("server LLM bridge rejects capsules without llm permission", async function () {
  var ctx = harness();
  ctx.tools.installedManifests("default");
  var sent = [];
  var ws = { readyState: 1, send: function (payload) { sent.push(JSON.parse(payload)); } };
  ctx.tools.handleMessage(ws, {
    type: "tool_llm_op",
    toolId: "scratchpad",
    requestId: "llm-1",
    args: { prompt: "hello", model: "fast" },
  });
  for (var i = 0; i < 50 && sent.length === 0; i++) await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.strictEqual(sent[0].type, "tools_error");
  assert.strictEqual(sent[0].requestId, "llm-1");
  assert.match(sent[0].message, /does not have the llm permission/);
});

test("server LLM bridge uses one concrete configured vendor model", async function () {
  var ctx = harness();
  ctx.tools.installedManifests("default");
  var sent = [];
  var calls = [];
  var ws = { readyState: 1, send: function (payload) { sent.push(JSON.parse(payload)); } };
  ctx.projectClients.add(ws);
  ctx.projectContext.completeToolLlm = function (socket, args) {
    calls.push({ socket: socket, args: args });
    return Promise.resolve("Hello");
  };
  ctx.tools.handleMessage(ws, {
    type: "tool_llm_op",
    toolId: "translator",
    requestId: "llm-configured",
    args: { prompt: "안녕", model: "fast" },
  });
  for (var i = 0; i < 50 && sent.length === 0; i++) await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].socket, ws);
  assert.strictEqual(calls[0].args.model, "fast");
  assert.deepStrictEqual(sent[0], { type: "tool_llm_result", toolId: "translator", requestId: "llm-configured", data: "Hello" });
});

test("Capsule model configuration is correlated and does not expose credentials", async function () {
  var ctx = harness();
  var sent = [];
  var ws = { readyState: 1, send: function (payload) { sent.push(JSON.parse(payload)); } };
  ctx.projectClients.add(ws);
  var aliases = [];
  ctx.projectContext.getToolLlmConfig = function (_ws, alias) {
    aliases.push(alias);
    return Promise.resolve({ status: "ready", vendor: "claude", vendorName: "Claude", model: "fable", modelName: "Fable", error: "" });
  };
  assert.strictEqual(ctx.tools.handleMessage(ws, { type: "tool_llm_config_get", requestId: "config-1", alias: "deep" }), true);
  for (var i = 0; i < 50 && sent.length === 0; i++) await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.deepStrictEqual(sent[0], {
    type: "tool_llm_config_state",
    requestId: "config-1",
    alias: "deep",
    status: "ready",
    vendor: "claude",
    vendorName: "Claude",
    model: "fable",
    modelName: "Fable",
    error: "",
  });
  assert.deepStrictEqual(aliases, ["deep"]);
  assert.strictEqual(JSON.stringify(sent[0]).indexOf("API_KEY"), -1);
});

test("storage failures reply on the correlated tool_storage_result channel", async function () {
  var ctx = harness();
  ctx.tools.installedManifests("default");
  var sent = [];
  var ws = { readyState: 1, send: function (payload) { sent.push(JSON.parse(payload)); } };
  ctx.tools.handleMessage(ws, {
    type: "tool_storage_op",
    toolId: "scratchpad",
    op: "unknown-op",
    seq: "scratchpad:1:7",
    args: {},
  });
  for (var i = 0; i < 50 && sent.length === 0; i++) await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.strictEqual(sent[0].type, "tool_storage_result");
  assert.strictEqual(sent[0].seq, "scratchpad:1:7");
  assert.match(sent[0].error, /Unknown storage operation/);
  assert.ok(!sent.some(function (message) { return message.type === "tools_error"; }));
});

test("browser tool control fails clearly without an open home screen", async function () {
  var ctx = harness();
  ctx.tools.installedManifests("default");
  var snapshot = await result(tool(ctx.defs, "clay_tool_snapshot"), { toolId: "scratchpad" });
  assert.strictEqual(snapshot.response.isError, true);
  assert.match(snapshot.response.content[0].text, /home screen is not open/);
});

test("browser tool control correlates caller responses and times out", async function () {
  var ctx = harness(20);
  ctx.tools.installedManifests("default");
  var sent = [];
  var ws = {
    readyState: 1,
    _homeChatTap: { openedAt: Date.now() },
    send: function (payload) { sent.push(JSON.parse(payload)); },
  };
  ctx.sockets.push(ws);
  var pending = ctx.tools.controlForMate("default", "mate_test", "scratchpad", "snapshot", {});
  assert.strictEqual(sent[0].callerId, "mate_test");
  ctx.tools.handleMessage(ws, {
    type: "tool_control_response",
    requestId: sent[0].requestId,
    data: { state: { items: [] } },
  });
  assert.deepStrictEqual(await pending, { state: { items: [] } });

  var timedOut = ctx.tools.controlForMate("default", "mate_test", "scratchpad", "snapshot", {});
  await assert.rejects(timedOut, /timed out/);
});
