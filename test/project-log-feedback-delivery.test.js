var test = require("node:test");
var assert = require("node:assert/strict");
var attachDelivery = require("../lib/project-log-feedback-delivery").attachProjectLogFeedbackDelivery;

function fixture(options) {
  var opts = options || {};
  var session = Object.assign({
    localId: 7,
    cliSessionId: "session-author",
    ownerId: "owner",
    history: [],
    isProcessing: false,
  }, opts.session || {});
  var records = [];
  var statuses = [];
  var starts = [];
  var pushes = [];
  var processingChanges = 0;
  var broadcasts = 0;
  var reviewers = [];
  var deleted = [];
  var sm = {
    sessions: new Map([[session.localId, session]]),
    sendAndRecord: function (target, event) { records.push({ session: target, event: event }); target.history.push(event); },
    sendToSession: function (target, event) { statuses.push({ session: target, event: event }); },
    broadcastSessionList: function () { broadcasts++; },
    createSessionRaw: function (sessionOptions) {
      var reviewer = Object.assign({ localId: 8, history: [], isProcessing: false }, sessionOptions || {});
      reviewers.push(reviewer);
      sm.sessions.set(reviewer.localId, reviewer);
      return reviewer;
    },
    deleteSessionQuiet: function (localId) { deleted.push(localId); sm.sessions.delete(localId); },
  };
  var sdk = {
    pushMessage: function (target, text) { pushes.push({ session: target, text: text }); return opts.pushes === true; },
    startQuery: function (target, text, images, linuxUser) {
      starts.push({ session: target, text: text, images: images, linuxUser: linuxUser });
      return Promise.resolve();
    },
  };
  var delivery = attachDelivery({
    sm: sm,
    getSdk: function () { return opts.noSdk ? null : sdk; },
    onProcessingChanged: function () { processingChanges++; },
    getLinuxUserForSession: function () { return "mapped-user"; },
  });
  function entry(overrides) {
    return Object.assign({
      ref: "log:entry",
      pendingFeedbackCount: 1,
      updatedBy: { type: "session", userId: "owner", sessionKey: "session-author" },
    }, overrides || {});
  }
  return {
    delivery: delivery,
    entry: entry,
    session: session,
    records: records,
    statuses: statuses,
    starts: starts,
    pushes: pushes,
    reviewers: reviewers,
    deleted: deleted,
    processingChanges: function () { return processingChanges; },
    broadcasts: function () { return broadcasts; },
  };
}

test("new feedback wakes the exact live authoring session", function () {
  var f = fixture();
  assert.equal(f.delivery.deliver(f.entry()), true);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].session, f.session);
  assert.equal(f.records[0].event._internal, true);
  assert.equal(f.records[0].event.projectLogFeedback, true);
  assert.match(f.records[0].event.text, /list_log_feedback/);
  assert.match(f.records[0].event.text, /review_log_comment/);
  assert.equal(f.pushes.length, 1);
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].linuxUser, "mapped-user");
  assert.equal(f.statuses[0].event.status, "processing");
  assert.equal(f.processingChanges(), 1);
  assert.equal(f.broadcasts(), 1);
});

test("a busy Driver gets an isolated immediate reviewer", function () {
  var f = fixture({ session: { isProcessing: true }, pushes: true });
  assert.equal(f.delivery.deliver(f.entry()), true);
  assert.equal(f.pushes.length, 0, "feedback does not queue behind the busy turn");
  assert.equal(f.starts.length, 1);
  assert.equal(f.reviewers.length, 1);
  assert.equal(f.starts[0].session, f.reviewers[0]);
  assert.equal(f.reviewers[0].hidden, true);
  assert.equal(f.reviewers[0].singleTurn, true);
  assert.equal(f.reviewers[0].ownerId, f.session.ownerId);
  assert.equal(f.statuses.length, 0);
  assert.equal(f.processingChanges(), 0);
});

test("local authorship survives later durable session promotion", function () {
  var f = fixture();
  assert.equal(f.delivery.findAuthorSession(f.entry({
    updatedBy: { type: "session", userId: "owner", sessionKey: "local:7" },
  })), f.session);
});

test("created authorship remains the fallback after a temporary reviewer update", function () {
  var f = fixture();
  assert.equal(f.delivery.findAuthorSession(f.entry({
    updatedBy: { type: "session", userId: "owner", sessionKey: "deleted-reviewer" },
    createdBy: { type: "session", userId: "owner", sessionKey: "session-author" },
  })), f.session);
});

test("feedback never wakes a guessed, stale, or differently owned session", function () {
  var f = fixture();
  assert.equal(f.delivery.deliver(f.entry({
    updatedBy: { type: "session", userId: "other", sessionKey: "session-author" },
  })), false);
  assert.equal(f.delivery.deliver(f.entry({
    updatedBy: { type: "session", userId: "owner", sessionKey: "missing" },
  })), false);
  f.session.destroying = true;
  assert.equal(f.delivery.deliver(f.entry()), false);
  assert.equal(f.records.length, 0);
});

test("durable pending feedback remains the fallback when delivery is unavailable", function () {
  var f = fixture({ noSdk: true });
  assert.equal(f.delivery.deliver(f.entry()), false);
  assert.equal(f.records.length, 0);
});
