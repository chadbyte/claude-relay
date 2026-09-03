var test = require("node:test");
var assert = require("node:assert/strict");
var attachSessions = require("../lib/project-sessions").attachSessions;

test("the human Stop path establishes the pair barrier before aborting", function () {
  var order = [];
  var session = {
    localId: 2,
    isProcessing: true,
    abortController: { abort: function () { order.push("abort"); } },
  };
  var attached = attachSessions({
    sm: { sessions: new Map([[2, session]]) },
    sdk: {},
    clients: new Set(),
    opts: {},
    usersModule: { isMultiUser: function () { return false; } },
    getSessionForWs: function () { return session; },
    onHumanPairStop: function (stopped) { assert.equal(stopped, session); order.push("barrier"); },
  });

  assert.equal(attached.handleSessionsMessage({}, { type: "stop" }), true);
  assert.deepEqual(order, ["barrier", "abort"]);
  assert.equal(session.taskStopRequested, true);
});

test("Stop also catches a Worker while its query is still starting", function () {
  var stopped = false;
  var session = {
    localId: 2,
    isProcessing: false,
    _queryStarting: true,
    abortController: { abort: function () { stopped = true; } },
  };
  var attached = attachSessions({
    sm: { sessions: new Map([[2, session]]) },
    sdk: {},
    clients: new Set(),
    opts: {},
    usersModule: { isMultiUser: function () { return false; } },
    getSessionForWs: function () { return session; },
    onHumanPairStop: function () {},
  });

  attached.handleSessionsMessage({}, { type: "stop" });
  assert.equal(stopped, true);
  assert.equal(session.taskStopRequested, true);
});
