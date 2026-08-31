var test = require("node:test");
var assert = require("node:assert/strict");
var attachSessions = require("../lib/project-sessions").attachSessions;
var attachAskUser = require("../lib/project-ask-user").attachAskUser;
var historyToHomeChat = require("../lib/server-home-chat-events").historyToHomeChat;
var transformEvent = require("../lib/server-home-chat-events").transformEvent;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

function fixture() {
  var recorded = [];
  var manager = {
    currentPermissionMode: "default",
    permissionRequestIndex: {},
    sendAndRecord: function (session, event) { session.history.push(event); recorded.push(event); },
    appendToSessionFile: function () {},
  };
  var sessions = attachSessions({
    cwd: "/tmp/project", slug: "mate-builtin:clay", isMate: true, osUsers: null,
    currentVersion: "test", sm: manager, sdk: { startQuery: function () {}, pushMessage: function () {} }, tm: {}, clients: new Set(),
    send: function () {}, sendTo: function () {}, sendToAdmins: function () {}, sendToSession: function () {}, sendToSessionOthers: function () {},
    opts: {}, usersModule: {}, userPresence: {}, matesModule: {}, getSessionForWs: function () { return null; },
    getLinuxUserForSession: function () {}, ensureProjectAccessForSession: function () {}, getOsUserInfoForWs: function () {},
    hydrateImageRefs: function () {}, onProcessingChanged: function () {}, broadcastPresence: function () {}, adapter: {},
  });
  return { sessions: sessions, recorded: recorded };
}

test("canonical AskUserQuestion response accepts the exact pending tool once", function () {
  var f = fixture();
  var result = null;
  var session = { localId: 1, history: [], pendingAskUser: { "ask-1": { input: { questions: [{ question: "Outcome?" }] }, resolve: function (value) { result = value; } } } };
  assert.equal(f.sessions.respondToAskUser(session, { toolId: "ask-1", answers: { 0: "Decision" } }), true);
  assert.equal(f.sessions.respondToAskUser(session, { toolId: "ask-1", answers: { 0: "Again" } }), false);
  assert.deepEqual(f.recorded, [{ type: "ask_user_answered", toolId: "ask-1", answers: { 0: "Decision" } }]);
  assert.equal(result.behavior, "deny");
  assert.match(result.message, /Decision/);
});

test("MCP AskUserQuestion answer continues canonically without a duplicate Home user bubble", function () {
  var f = fixture();
  var input = { questions: [{ question: "Outcome?", options: [{ label: "Decision" }, { label: "Trade-offs" }] }] };
  var session = { localId: 2, history: [{ type: "tool_executing", id: "ask-mcp", name: "AskUserQuestion", input: input }], pendingAskUser: { "ask-mcp": { mode: "mcp", input: input } }, isProcessing: true };
  assert.equal(f.sessions.respondToAskUser(session, { toolId: "ask-mcp", answers: { 0: "Decision" } }), true);
  var injected = session.history.filter(function (event) { return event.type === "user_message"; });
  assert.equal(injected.length, 1);
  assert.equal(injected[0].askUserAnswer, true);
  var home = historyToHomeChat(session.history, true);
  assert.equal(home.length, 1);
  assert.equal(home[0].role, "question");
  assert.equal(home[0].status, "answered");
});

test("Mate AskUserQuestion MCP records against its query-bound session, never a global active session", async function () {
  var records = [];
  var askUser = attachAskUser({ record: function (session, event) { records.push({ session: session, event: event }); } });
  var adapter = { createToolServer: function (definition) { return definition; } };
  var exact = { localId: 7, history: [], pendingAskUser: {} };
  var unrelated = { localId: 8, history: [], pendingAskUser: {} };
  var server = askUser.createMcpServer(adapter, exact);
  var result = await server.tools[0].handler({ questions: [{ header: "Outcome", question: "What result?", options: [{ label: "Decision", description: "Choose" }, { label: "Trade-offs", description: "Compare" }] }] });
  assert.equal(result.isError, undefined);
  assert.equal(records.length, 1);
  assert.equal(records[0].session, exact);
  assert.equal(records[0].event.name, "AskUserQuestion");
  assert.equal(Object.keys(exact.pendingAskUser).length, 1);
  assert.equal(Object.keys(unrelated.pendingAskUser).length, 0);
  var unbound = askUser.createMcpServer(adapter, null);
  var rejected = await unbound.tools[0].handler({ questions: [{ question: "No session", options: [{ label: "A" }, { label: "B" }] }] });
  assert.equal(rejected.isError, true);
});

test("planning SDK query binds the canonical Codex fallback and projects its invoked question to Home", async function () {
  var captured = [];
  var projected = [];
  var manager = {
    defaultVendor: "codex",
    currentPermissionMode: "default",
    capabilitiesByVendor: { codex: {} },
    modelsByVendor: { codex: [] },
    permissionRequestIndex: {},
    saveSessionFile: function () {},
    broadcastSessionList: function () {},
    sendToSession: function () {},
    sendAndRecord: function (session, event) {
      session.history.push(event);
      var message = transformEvent(event, "builtin:clay", session, "plan-sdk", "local:31");
      if (message) projected.push(message);
    },
  };
  var askUser = attachAskUser({ record: manager.sendAndRecord });
  var handle = {
    pushMessage: function () { return true; },
    close: function () {},
    [Symbol.asyncIterator]: function () { return { next: function () { return new Promise(function () {}); } }; },
  };
  var adapter = {
    vendor: "codex",
    createQuery: function (options) { captured.push(options); return Promise.resolve(handle); },
  };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: manager,
    adapter: adapter,
    adapters: { codex: adapter },
    send: function () {},
    getSessionToolDefs: function (session) { return session.debateSetupMode === true ? askUser.getToolDefs(session) : []; },
  });
  var session = { localId: 31, ownerId: "owner-a", vendor: "codex", model: "gpt-test", debateSetupMode: true, history: [], pendingAskUser: {}, isProcessing: false };
  await bridge.startQuery(session, "hidden debate setup");
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].dynamicTools.map(function (tool) { return tool.name; }), ["ask_user_questions"]);
  var input = { questions: [{ header: "Direction", question: "What should the debate decide?", options: [{ label: "Choose", description: "Reach a decision" }, { label: "Explore", description: "Map trade-offs" }] }] };
  var permission = await captured[0].canUseTool("ask_user_questions", input, { toolUseID: "dynamic-call" });
  assert.equal(permission.behavior, "allow");
  await captured[0].callDynamicTool("ask_user_questions", input);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].type, "home_debate_question");
  assert.equal(projected[0].requestId, "plan-sdk");
  assert.equal(projected[0].sessionId, "local:31");
  assert.equal(projected[0].questions[0].question, "What should the debate decide?");
});

test("native AskUserQuestion callback remains available for Claude-style planning queries", async function () {
  var captured = [];
  var manager = {
    defaultVendor: "claude", currentPermissionMode: "default", permissionRequestIndex: {},
    capabilitiesByVendor: { claude: {} }, modelsByVendor: { claude: [] },
    saveSessionFile: function () {}, broadcastSessionList: function () {}, sendToSession: function () {}, sendAndRecord: function () {},
  };
  var handle = { pushMessage: function () { return true; }, close: function () {}, [Symbol.asyncIterator]: function () { return { next: function () { return new Promise(function () {}); } }; } };
  var adapter = { vendor: "claude", createQuery: function (options) { captured.push(options); return Promise.resolve(handle); } };
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: manager, adapter: adapter, adapters: { claude: adapter }, send: function () {} });
  var session = { localId: 32, vendor: "claude", model: "sonnet", debateSetupMode: true, history: [], pendingAskUser: {}, isProcessing: false };
  await bridge.startQuery(session, "hidden debate setup");
  var pending = captured[0].canUseTool("AskUserQuestion", { questions: [] }, { toolUseID: "native-ask" });
  assert.ok(session.pendingAskUser["native-ask"]);
  session.pendingAskUser["native-ask"].resolve({ behavior: "deny", message: "answered" });
  assert.equal((await pending).message, "answered");
});
