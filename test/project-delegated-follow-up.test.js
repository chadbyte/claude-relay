var test = require("node:test");
var assert = require("node:assert/strict");
var attachFollowUp = require("../lib/project-delegated-follow-up").attachDelegatedFollowUp;
var sessionRef = require("../lib/workspace-query-service").sessionRef;

function fixture(overrides, options) {
  var session = Object.assign({
    localId: 4,
    cliSessionId: "cli-four",
    ownerId: "u1",
    sessionVisibility: "private",
    title: "Existing work",
    vendor: "claude",
    mode: "gui",
    runtimeMode: null,
    history: [],
    pendingPermissions: {},
    pendingAskUser: {},
    pendingElicitations: {},
    pendingUserDialogs: {},
    isProcessing: false,
  }, overrides || {});
  var activeId = 99;
  var activeSession = { localId: activeId, title: "Visible session" };
  var sends = [];
  var pushes = [];
  var starts = [];
  var manager = {
    sessions: new Map([[4, session], [activeId, activeSession]]),
    sendAndRecord: function (target, event) { target.history.push(event); sends.push(event); },
    broadcastSessionList: function () {},
    getActiveSession: function () { return manager.sessions.get(activeId) || null; },
  };
  var config = options || {};
  var attached = attachFollowUp({
    sm: manager,
    getSdk: function () { return {
      pushMessage: function (target, text) { pushes.push({ target: target, text: text }); if (config.pushError) throw new Error(config.pushError); return config.pushAccepted !== false; },
      startQuery: function (target, text, images, linuxUser) { starts.push({ target: target, text: text, linuxUser: linuxUser }); },
    }; },
    getLinuxUserForSession: function () { return "clay-u1"; },
    onProcessingChanged: function () {},
    isMultiUser: function () { return true; },
    sessionRef: function (target) { return sessionRef("target", target); },
    isPairedSession: function () { return !!config.paired; },
    canResumeVendor: function () { return config.resumable !== false; },
  });
  return { attached: attached, session: session, manager: manager, ref: sessionRef("target", session), sends: sends, pushes: pushes, starts: starts };
}

test("eligible follow-up records one delegated event and resumes without switching or creating", async function () {
  var f = fixture();
  var beforeSize = f.manager.sessions.size;
  var result = await f.attached.dispatchDelegatedFollowUp({ userId: "u1" }, f.ref, "Inspect the fix.", {
    assignmentId: "assignment-1", sourceMateId: "mate-1", sourceProjectSlug: "mate", sourceSessionRef: "source-ref",
  });
  assert.equal(result, f.session);
  assert.equal(f.manager.sessions.size, beforeSize);
  assert.equal(f.manager.getActiveSession().localId, 99);
  assert.equal(f.pushes.length, 1);
  assert.equal(f.starts.length, 0);
  assert.deepEqual(f.sends.map(function (event) { return event.type; }), ["delegated_follow_up"]);
  assert.equal(f.sends[0].text, "Inspect the fix.");
  assert.equal(f.sends.some(function (event) { return event.type === "user_message"; }), false);
});

test("closed query resumes the exact durable session with its target OS user", async function () {
  var f = fixture(null, { pushAccepted: false });
  await f.attached.dispatchDelegatedFollowUp({ userId: "u1" }, f.ref, "Resume exactly.", { assignmentId: "a2" });
  assert.equal(f.pushes.length, 1);
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].target, f.session);
  assert.equal(f.starts[0].linuxUser, "clay-u1");
});

test("dispatch failure preserves the delegated boundary and records an actionable target error", async function () {
  var f = fixture(null, { pushError: "connection closed" });
  await assert.rejects(f.attached.dispatchDelegatedFollowUp({ userId: "u1" }, f.ref, "Try once.", { assignmentId: "a3" }), /connection closed/);
  assert.deepEqual(f.sends.map(function (event) { return event.type; }), ["delegated_follow_up", "error"]);
  assert.equal(f.session.isProcessing, false);
  assert.equal(f.sends.some(function (event) { return event.type === "user_message"; }), false);
});

test("follow-up inspection rejects every unsafe existing-session class", function () {
  var cases = [
    [{ cliSessionId: null }, {}, /durable/],
    [{ sessionVisibility: "shared" }, {}, /private/],
    [{ ownerId: "u2" }, {}, /denied/],
    [{ isProcessing: true }, {}, /idle/],
    [{ _queryStarting: true }, {}, /idle/],
    [{ pendingPermissions: { p: {} } }, {}, /waiting/],
    [{ pendingAskUser: { q: {} } }, {}, /waiting/],
    [{ pendingElicitations: { e: {} } }, {}, /waiting/],
    [{ pendingUserDialogs: { d: {} } }, {}, /waiting/],
    [{ mode: "tui" }, {}, /Terminal/],
    [{ hidden: true }, {}, /unavailable/],
    [{ homeDebatePhase: "live" }, {}, /Debate/],
    [{ loop: { loopId: "l" } }, {}, /Orchestrated/],
    [{ spawn: { parentId: 1 } }, {}, /Orchestrated/],
    [{ handoff: { sourceSessionId: 1 } }, {}, /Orchestrated/],
    [{ assignment: { assignmentId: "old" } }, {}, /Orchestrated/],
    [{ singleTurn: true }, {}, /Orchestrated/],
    [{ permissionMode: "bypassPermissions" }, {}, /Full-access/],
    [{}, { paired: true }, /Orchestrated/],
    [{}, { resumable: false }, /provider/],
  ];
  for (var i = 0; i < cases.length; i++) {
    var f = fixture(cases[i][0], cases[i][1]);
    assert.throws(function () { f.attached.inspectDelegatedFollowUp({ userId: "u1" }, f.ref); }, cases[i][2]);
    assert.equal(f.session.history.length, 0);
  }
});

test("local or fabricated references cannot select an arbitrary session", function () {
  var f = fixture();
  assert.throws(function () { f.attached.inspectDelegatedFollowUp({ userId: "u1" }, "session:fabricated"); }, /not found/);
  assert.throws(function () { f.attached.inspectDelegatedFollowUp({ userId: "u1" }, "4"); }, /opaque/);
});
