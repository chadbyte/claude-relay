var test = require("node:test");
var assert = require("node:assert");
var hygiene = require("../lib/session-hygiene");

var DAY = 24 * 60 * 60 * 1000;
var NOW = 1700000000000;

function blank(localId, overrides) {
  var s = {
    localId: localId,
    turnCount: 0,
    history: [],
    isProcessing: false,
    queryInstance: null,
    adopted: false,
    bookmarked: false,
    spawn: null,
    loop: null,
    mode: "gui",
    terminalId: null,
    vendor: null,
    ownerId: null,
    createdAt: NOW - 2 * DAY,
    lastActivity: NOW - 2 * DAY,
  };
  return Object.assign(s, overrides || {});
}

function toMap(list) {
  var m = new Map();
  for (var i = 0; i < list.length; i++) m.set(list[i].localId, list[i]);
  return m;
}

test("isBlankSession accepts an untouched GUI session", function () {
  assert.strictEqual(hygiene.isBlankSession(blank(1)), true);
});

test("isBlankSession rejects used, attached, or managed sessions", function () {
  assert.strictEqual(hygiene.isBlankSession(blank(1, { turnCount: 1 })), false);
  assert.strictEqual(hygiene.isBlankSession(blank(1, { history: [{}] })), false);
  assert.strictEqual(hygiene.isBlankSession(blank(1, { isProcessing: true })), false);
  assert.strictEqual(hygiene.isBlankSession(blank(1, { queryInstance: {} })), false);
  assert.strictEqual(hygiene.isBlankSession(blank(1, { adopted: true })), false);
  assert.strictEqual(hygiene.isBlankSession(blank(1, { bookmarked: true })), false);
  assert.strictEqual(hygiene.isBlankSession(blank(1, { spawn: { parentId: 9 } })), false);
  assert.strictEqual(hygiene.isBlankSession(blank(1, { loop: { loopId: "x" } })), false);
  assert.strictEqual(hygiene.isBlankSession(blank(1, {
    sessionProvenance: { kind: "worker", parentSessionOriginId: "driver-origin", generation: 1 },
  })), false);
  assert.strictEqual(hygiene.isBlankSession(blank(1, { mode: "tui" })), false);
  assert.strictEqual(hygiene.isBlankSession(blank(1, { terminalId: 3 })), false);
});

test("findReusableBlankSession prefers exact vendor match over vendor-less", function () {
  var sessions = toMap([
    blank(1, { vendor: null, createdAt: NOW - 3 * DAY }),
    blank(2, { vendor: "claude", createdAt: NOW - 2 * DAY }),
  ]);
  var found = hygiene.findReusableBlankSession(sessions, { vendor: "claude" });
  assert.strictEqual(found.localId, 2);
});

test("findReusableBlankSession falls back to the newest vendor-less blank", function () {
  var sessions = toMap([
    blank(1, { vendor: "kiro" }),
    blank(2, { vendor: null, createdAt: NOW - 3 * DAY }),
    blank(3, { vendor: null, createdAt: NOW - DAY }),
  ]);
  var found = hygiene.findReusableBlankSession(sessions, { vendor: "claude" });
  assert.strictEqual(found.localId, 3);
});

test("findReusableBlankSession enforces ownership and returns null when nothing fits", function () {
  var sessions = toMap([
    blank(1, { ownerId: "u1", vendor: "claude" }),
    blank(2, { turnCount: 4, vendor: "claude" }),
  ]);
  assert.strictEqual(hygiene.findReusableBlankSession(sessions, { vendor: "claude", ownerId: "u2" }), null);
  assert.strictEqual(hygiene.findReusableBlankSession(sessions, { vendor: "claude", ownerId: "u1" }).localId, 1);
});

test("an untouched Split Worker is neither reusable nor stale blank-session cleanup", function () {
  var worker = blank(1, {
    vendor: "codex",
    sessionProvenance: { kind: "worker", parentSessionOriginId: "driver-origin", generation: 1 },
  });
  var sessions = toMap([worker]);
  assert.strictEqual(hygiene.findReusableBlankSession(sessions, { vendor: "codex" }), null);
  assert.deepStrictEqual(hygiene.collectStaleBlankSessions(sessions, null, NOW), []);
});

test("collectStaleBlankSessions keeps young blanks and the active session", function () {
  var sessions = toMap([
    blank(1),                                              // stale
    blank(2, { lastActivity: NOW - DAY / 2 }),             // recently touched
    blank(3),                                              // stale but active
    blank(4, { turnCount: 2 }),                            // not blank
  ]);
  assert.deepStrictEqual(hygiene.collectStaleBlankSessions(sessions, 3, NOW), [1]);
});

test("isClaudeWarmupTranscript accepts the interruption record added on abort", function () {
  var events = [
    { type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
    { type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
  ];
  assert.strictEqual(hygiene.isClaudeWarmupTranscript(events), true);
});

test("isClaudeWarmupTranscript rejects real conversations", function () {
  var assistantReply = [
    { type: "user", message: { role: "user", content: "hi" } },
    { type: "assistant", message: { role: "assistant", content: [] } },
  ];
  var secondPrompt = [
    { type: "user", message: { role: "user", content: "hi" } },
    { type: "user", message: { role: "user", content: "please help" } },
  ];
  assert.strictEqual(hygiene.isClaudeWarmupTranscript(assistantReply), false);
  assert.strictEqual(hygiene.isClaudeWarmupTranscript(secondPrompt), false);
});
