var test = require("node:test");
var assert = require("node:assert/strict");

var attachService = require("../lib/workspace-query-service").attachWorkspaceQueryService;
var attachProjectWorkspace = require("../lib/project-workspace-query").attachProjectWorkspaceQuery;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var managedAllow = require("../lib/claude-hook-installer").CLAY_MANAGED_ALLOW;

function fixture(builtinKey) {
  var session = { localId: 7, cliSessionId: "cli-seven", ownerId: "owner", title: "Bound", history: [] };
  var manager = { sessions: new Map([[7, session]]) };
  var projects = new Map([["mate-source", {
    getStatus: function () { return { title: "Mate", projectOwnerId: "owner", isMate: true, mateId: "mate-id" }; },
    getSessionManager: function () { return manager; },
  }]]);
  var service = attachService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    resolveMate: function () { return { id: "mate-id", createdBy: "owner", builtinKey: builtinKey }; },
  });
  var attached = attachProjectWorkspace({
    service: service,
    sm: manager,
    projectSlug: "mate-source",
    getProjectOwnerId: function () { return "owner"; },
    isMate: true,
    mateId: "mate-id",
  });
  return { attached: attached, session: session };
}

test("project workspace creates a fail-closed static descriptor and exact bound Claude server", async function () {
  var f = fixture("clay");
  var adapter = { createToolServer: function (definition) { return definition; } };
  var staticServer = f.attached.createMcpServer(adapter, null);
  assert.equal(staticServer.name, "clay-workspace");
  assert.equal(staticServer.tools.length, 9);
  var staticResult = await staticServer.tools[0].handler({});
  assert.equal(staticResult.isError, true);
  var staticFollowUp = staticServer.tools.filter(function (tool) { return tool.name === "propose_project_follow_up"; })[0];
  assert.equal((await staticFollowUp.handler({ projectSlug: "target", targetSessionRef: "session:x", title: "No", task: "No" })).isError, true);

  var boundServer = f.attached.createMcpServer(adapter, f.session);
  var result = await boundServer.tools[0].handler({ limit: 10 });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).projects.length, 1);

  var impostor = { localId: 7, ownerId: "owner" };
  var rejectedServer = f.attached.createMcpServer(adapter, impostor);
  var rejected = await rejectedServer.tools[0].handler({});
  assert.equal(rejected.isError, true);
});

test("Codex bridge tool listing and calls retain the exact source session", async function () {
  var f = fixture("clay");
  var normalize = function () { return { type: "object", properties: {} }; };
  var tools = f.attached.getBridgeTools(f.session, normalize);
  assert.equal(tools.length, 9);
  assert.equal(tools[0].server, "clay-workspace");
  var response = await f.attached.callBridgeTool(f.session, "list_projects", { limit: 10 });
  assert.equal(response.isError, undefined);
  await assert.rejects(f.attached.callBridgeTool({ localId: 7, ownerId: "owner" }, "list_projects", {}), /not found/);
});

test("ordinary Mate project boundary exposes common tools but no Clay compatibility or global tools", function () {
  var f = fixture("arch");
  var normalize = function () { return { type: "object" }; };
  var tools = f.attached.getBridgeTools(f.session, normalize);
  assert.deepEqual(tools.map(function (tool) { return tool.name; }), [
    "list_projects", "list_project_sessions", "search_project_history", "read_project_session", "propose_project_assignment", "propose_project_follow_up", "get_assignment_status",
  ]);
  var adapter = { createToolServer: function (definition) { return definition; } };
  var serverTools = f.attached.createMcpServer(adapter, f.session).tools;
  var proposal = serverTools.filter(function (tool) { return tool.name === "propose_project_assignment"; })[0];
  assert.deepEqual(Object.keys(proposal.inputSchema).sort(), ["projectSlug", "task", "title"]);
  assert.equal(Object.prototype.hasOwnProperty.call(proposal.inputSchema, "sessionRef"), false);
  var followUp = serverTools.filter(function (tool) { return tool.name === "propose_project_follow_up"; })[0];
  assert.deepEqual(Object.keys(followUp.inputSchema).sort(), ["projectSlug", "targetSessionRef", "task", "title"]);
  assert.deepEqual(f.attached.getHistoryBridgeTools(f.session, normalize), []);
  assert.equal(f.attached.createHistoryMcpServer({ createToolServer: function (definition) { return definition; } }, f.session), null);
});

test("SDK auto-approves exact workspace reads and proposal posting but not unknown mutations", function () {
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: {}, adapter: { vendor: "claude" }, send: function () {} });
  assert.equal(bridge.checkToolWhitelist("mcp__clay-workspace__list_projects", {}).behavior, "allow");
  assert.equal(bridge.checkToolWhitelist("mcp__clay-workspace__read_project_session", {}).behavior, "allow");
  assert.equal(bridge.checkToolWhitelist("mcp__clay-workspace__propose_project_assignment", {}).behavior, "allow");
  assert.equal(bridge.checkToolWhitelist("mcp__clay-workspace__propose_project_follow_up", {}).behavior, "allow");
  assert.notEqual(managedAllow.indexOf("mcp__clay-workspace__propose_project_follow_up"), -1);
  assert.equal(bridge.checkToolWhitelist("mcp__clay-workspace__get_assignment_status", {}).behavior, "allow");
  assert.equal(bridge.checkToolWhitelist("mcp__clay-workspace__execute_project_assignment", {}), null);
  assert.equal(bridge.checkToolWhitelist("mcp__clay-history__search_clay_history", {}).behavior, "allow");
  assert.equal(bridge.checkToolWhitelist("mcp__other__mutate", {}), null);
});

test("debate, mention, and spawned subprocess sessions do not inherit workspace orchestration", function () {
  var f = fixture("clay");
  f.session.homeDebatePlanning = true;
  assert.deepEqual(f.attached.getBridgeTools(f.session, function () { return {}; }), []);
  delete f.session.homeDebatePlanning;
  f.session._mentionInProgress = true;
  assert.deepEqual(f.attached.getBridgeTools(f.session, function () { return {}; }), []);
  delete f.session._mentionInProgress;
  f.session.spawn = { parentId: 2 };
  assert.deepEqual(f.attached.getBridgeTools(f.session, function () { return {}; }), []);
});
