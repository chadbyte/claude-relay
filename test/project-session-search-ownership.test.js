var test = require("node:test");
var assert = require("node:assert/strict");

var attachSessions = require("../lib/project-sessions").attachSessions;

function fixture() {
  var sessions = new Map([
    [1, { localId: 1, ownerId: "u1", sessionVisibility: "private", title: "Owned needle", history: [{ type: "user_message", text: "owned content needle" }] }],
    [2, { localId: 2, ownerId: "u2", sessionVisibility: "private", title: "Private foreign needle", history: [{ type: "user_message", text: "PRIVATE_FOREIGN_NEEDLE" }] }],
    [3, { localId: 3, ownerId: "u2", sessionVisibility: "shared", title: "Shared needle", history: [{ type: "user_message", text: "shared content needle" }] }],
    [4, { localId: 4, ownerId: null, title: "Legacy needle", history: [{ type: "user_message", text: "legacy content needle" }] }],
  ]);
  var responses = [];
  var sm = {
    sessions: sessions,
    searchSessions: function (query, canInclude) {
      var out = [];
      sessions.forEach(function (session) {
        if (canInclude && !canInclude(session)) return;
        if (session.title.toLowerCase().indexOf(query.toLowerCase()) !== -1) out.push({ id: session.localId, title: session.title });
      });
      return out;
    },
    searchSessionContent: function (localId) { return { hits: [{ historyIndex: 0, snippet: sessions.get(localId).history[0].text }], total: 1 }; },
  };
  var users = {
    isMultiUser: function () { return true; },
    canAccessSession: function (userId, session) {
      if (!session.ownerId) return userId === "admin";
      if (session.ownerId === userId) return true;
      return session.sessionVisibility !== "private";
    },
  };
  var attached = attachSessions({
    sm: sm,
    sdk: {},
    clients: new Set(),
    opts: {},
    usersModule: users,
    getProjectAccess: function () { return { visibility: "public", ownerId: "u2" }; },
    getSessionForWs: function () { return sessions.get(1); },
    sendTo: function (ws, message) { responses.push(message); },
  });
  return { attached: attached, responses: responses };
}

test("project session search applies session access and rejects arbitrary private content IDs", function () {
  var f = fixture();
  var ws = { _clayUser: { id: "u1", role: "member" } };
  f.attached.handleSessionsMessage(ws, { type: "search_sessions", query: "needle" });
  assert.deepEqual(f.responses[0].results.map(function (item) { return item.id; }), [1, 3]);

  f.attached.handleSessionsMessage(ws, { type: "search_session_content", id: 2, query: "needle" });
  assert.deepEqual(f.responses[1], { type: "search_content_results", query: "needle", sessionId: 2, hits: [], total: 0 });
  assert.doesNotMatch(JSON.stringify(f.responses[1]), /PRIVATE_FOREIGN_NEEDLE/);

  f.attached.handleSessionsMessage(ws, { type: "search_session_content", id: 3, query: "needle" });
  assert.equal(f.responses[2].total, 1);
  assert.match(f.responses[2].hits[0].snippet, /shared content/);
});

test("project session search keeps legacy ownerless access admin-only in multi-user mode", function () {
  var f = fixture();
  var ws = { _clayUser: { id: "admin", role: "admin" } };
  f.attached.handleSessionsMessage(ws, { type: "search_session_content", id: 4, query: "needle" });
  assert.equal(f.responses[0].total, 1);
  assert.match(f.responses[0].hits[0].snippet, /legacy content/);
});
