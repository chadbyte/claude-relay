var test = require("node:test");
var assert = require("node:assert/strict");
var attachHomeChat = require("../lib/server-home-chat").attachHomeChat;

function fixture(options) {
  var opts = options || {};
  var sessions = new Map([
    [1, { localId: 1, cliSessionId: "session-old", ownerId: "u1", title: "Older", lastActivity: 10, history: [] }],
    [2, { localId: 2, cliSessionId: "session-new", ownerId: "u1", title: "Newer", lastActivity: 30, history: [{ type: "user_message", text: "Hello" }] }],
    [3, { localId: 3, cliSessionId: "session-other", ownerId: "u2", title: "Other user's chat", lastActivity: 40, history: [] }],
    [4, { localId: 4, cliSessionId: "session-hidden", ownerId: "u1", title: "Hidden", lastActivity: 50, hidden: true, history: [] }],
    [5, { localId: 5, cliSessionId: "session-single", title: "Single-user chat", lastActivity: 20, history: [] }],
  ]);
  var subscribed = null;
  var manager = {
    sessions: sessions,
    subscribeSession: function (id) {
      subscribed = id;
      return function () {};
    },
    createSession: function () { throw new Error("unexpected session creation"); },
  };
  var project = {
    getSessionManager: function () { return manager; },
    getMemoryState: function () { return { entries: [], summary: "" }; },
    listKnowledgeFiles: function () { return []; },
  };
  var handler = attachHomeChat({
    users: { isMultiUser: function () { return opts.singleUser !== true; } },
    mates: {
      buildMateCtx: function () { return {}; },
      getAllMates: function () { return [{ id: "mate-a", name: "A", vendor: "claude" }]; },
      getMateDir: function () { return "/tmp/mate-a"; },
    },
    projects: new Map([["mate-mate-a", project]]),
    addProject: function () {},
  });
  var messages = [];
  var ws = {
    readyState: 1,
    _clayUser: opts.unauthenticated ? null : { id: "u1" },
    send: function (value) { messages.push(JSON.parse(value)); },
  };
  return { handler: handler, ws: ws, messages: messages, getSubscribed: function () { return subscribed; } };
}

test("Mate conversation list includes only the requesting user's visible sessions", function () {
  var f = fixture();
  assert.strictEqual(f.handler.handleMessage(f.ws, { type: "home_mate_sessions_list", mateId: "mate-a" }), true);
  assert.deepStrictEqual(f.messages[0], {
    type: "home_mate_sessions_state",
    mateId: "mate-a",
    sessions: [
      { id: "session-new", title: "Newer", lastActivity: 30, isProcessing: false },
      { id: "session-old", title: "Older", lastActivity: 10, isProcessing: false },
    ],
  });
});

test("Explicit Mate conversation open restores the exact requested session", function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-old" });
  assert.strictEqual(f.getSubscribed(), 1);
  assert.strictEqual(f.messages[0].type, "home_mate_history");
  assert.strictEqual(f.messages[0].sessionId, "session-old");
});

test("Explicit Mate conversation open rejects another user's session", function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "session-other" });
  assert.strictEqual(f.getSubscribed(), null);
  assert.strictEqual(f.messages[0].type, "home_mate_error");
  assert.strictEqual(f.messages[0].code, "session_not_found");
});

test("single-user Mate conversation lists include only ownerless sessions", function () {
  var f = fixture({ singleUser: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_sessions_list", mateId: "mate-a" });
  assert.deepStrictEqual(f.messages[0].sessions, [
    { id: "session-single", title: "Single-user chat", lastActivity: 20, isProcessing: false },
  ]);
});

test("unauthenticated multi-user Mate conversation requests reveal no sessions", function () {
  var f = fixture({ unauthenticated: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_sessions_list", mateId: "mate-a" });
  assert.strictEqual(f.messages[0].type, "home_mate_error");
  assert.strictEqual(f.messages[0].text, "Not authenticated.");
});
