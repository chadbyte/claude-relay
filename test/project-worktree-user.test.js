var test = require("node:test");
var assert = require("node:assert/strict");
var attachSessions = require("../lib/project-sessions").attachSessions;

function fixture(onCreateWorktree) {
  var sent = [];
  var attached = attachSessions({
    cwd: "/tmp/project",
    slug: "project-one",
    sm: {},
    sdk: {},
    clients: new Set(),
    opts: {},
    usersModule: {},
    send: function () {},
    sendTo: function (ws, message) { sent.push(message); },
    onCreateWorktree: onCreateWorktree,
  });
  return { attached: attached, sent: sent };
}

test("worktree creation forwards the authenticated user to the daemon", function () {
  var actor = { id: "user-one", linuxUser: "clay-user-one" };
  var received = null;
  var f = fixture(function () {
    received = Array.prototype.slice.call(arguments);
    return { ok: true, slug: "project-one--feature-one" };
  });

  assert.equal(f.attached.handleSessionsMessage({ _clayUser: actor }, {
    type: "create_worktree",
    branch: "feature-one",
    dirName: "feature-one",
  }), true);
  assert.equal(received[4], actor);
  assert.equal(f.sent[0].ok, true);
});

test("worktree creation rejects an escaping directory before reaching Git", function () {
  var called = false;
  var f = fixture(function () { called = true; });

  assert.equal(f.attached.handleSessionsMessage({ _clayUser: { id: "user-one" } }, {
    type: "create_worktree",
    branch: "feature-one",
    dirName: "../feature-one",
  }), true);
  assert.equal(called, false);
  assert.equal(f.sent[0].ok, false);
  assert.equal(f.sent[0].error, "Invalid worktree directory name");
});
