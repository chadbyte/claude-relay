var test = require("node:test");
var assert = require("node:assert/strict");
var events = require("../lib/server-home-chat-events");

test("Home history restores one assignment card at its latest durable status", function () {
  var proposed = { assignmentId: "a1", status: "proposed", title: "Audit", projectSlug: "alpha" };
  var completed = { assignmentId: "a1", status: "completed", title: "Audit", projectSlug: "alpha", resultSummary: "Done" };
  var messages = events.historyToHomeChat([
    { type: "user_message", text: "Please delegate this." },
    { type: "project_assignment_proposal", assignment: proposed },
    { type: "project_assignment_status", assignment: { assignmentId: "a1", status: "running", title: "Audit" } },
    { type: "project_assignment_status", assignment: completed },
  ], false);
  assert.deepEqual(messages.map(function (message) { return message.role; }), ["user", "assignment"]);
  assert.equal(messages[1].assignment.status, "completed");
  assert.equal(messages[1].assignment.resultSummary, "Done");
});

test("Home history preserves follow-up delivery and exact target identity", function () {
  var assignment = {
    assignmentId: "follow-1", delivery: "follow_up", targetSessionRef: "session:opaque-target",
    targetSessionTitle: "Existing work", status: "proposed", title: "Continue",
  };
  var history = events.historyToHomeChat([{ type: "project_assignment_proposal", assignment: assignment }], false);
  assert.equal(history.length, 1);
  assert.equal(history[0].assignment.delivery, "follow_up");
  assert.equal(history[0].assignment.targetSessionRef, "session:opaque-target");
});

test("Home live projection carries exact session metadata for proposal and status", function () {
  var session = { model: "sonnet", vendor: "claude" };
  var proposal = events.transformEvent({ type: "project_assignment_proposal", assignment: { assignmentId: "a1", status: "proposed" } }, "builtin:clay", session, "req-1", "cli-1");
  var status = events.transformEvent({ type: "project_assignment_status", assignment: { assignmentId: "a1", status: "running" } }, "builtin:clay", session, "req-1", "cli-1");
  assert.equal(proposal.type, "home_project_assignment_proposal");
  assert.equal(status.type, "home_project_assignment_status");
  assert.equal(proposal.mateId, "builtin:clay");
  assert.equal(proposal.sessionId, "cli-1");
  assert.equal(proposal.requestId, "req-1");
});
