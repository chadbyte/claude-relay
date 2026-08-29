var test = require("node:test");
var assert = require("node:assert/strict");
var attachHomeSurfacePreferences = require("../lib/users-home-surface-preferences").attachHomeSurfacePreferences;
var attachHomePreferences = require("../lib/server-home-preferences").attachHomePreferences;

function harness() {
  var data = { users: [{ id: "u1" }, { id: "u2" }] };
  var saves = 0;
  var preferences = attachHomeSurfacePreferences({
    loadUsers: function () { return data; },
    saveUsers: function (next) { data = next; saves++; },
  });
  return { preferences: preferences, getSaves: function () { return saves; } };
}

test("Home surface preferences default to no durable conversation selection", function () {
  var fixture = harness();
  assert.deepStrictEqual(fixture.preferences.getHomeSurfacePreference("u1"), {
    activeMateId: null,
    activeSessionByMate: {},
    sidebarCollapsed: false,
  });
});

test("Home surface preferences preserve exact sessions per Mate across partial updates", function () {
  var fixture = harness();
  fixture.preferences.setHomeSurfacePreference("u1", {
    activeMateId: "mate-a",
    activeSessionByMate: { "mate-a": "session-a" },
  });
  var result = fixture.preferences.setHomeSurfacePreference("u1", {
    activeMateId: "mate-b",
    activeSessionByMate: { "mate-b": "session-b" },
    sidebarCollapsed: true,
  });
  assert.deepStrictEqual(result.preference, {
    activeMateId: "mate-b",
    activeSessionByMate: { "mate-a": "session-a", "mate-b": "session-b" },
    sidebarCollapsed: true,
  });
  assert.deepStrictEqual(fixture.preferences.getHomeSurfacePreference("u2").activeSessionByMate, {});
  assert.strictEqual(fixture.getSaves(), 2);
});

test("Home surface preferences discard malformed identifiers and session references", function () {
  var fixture = harness();
  var result = fixture.preferences.setHomeSurfacePreference("u1", {
    activeMateId: "../mate",
    activeSessionByMate: { "mate-a": "valid-session", "../mate": "bad", "mate-b": "\n" },
    sidebarCollapsed: "yes",
  });
  assert.deepStrictEqual(result.preference, {
    activeMateId: null,
    activeSessionByMate: { "mate-a": "valid-session" },
    sidebarCollapsed: false,
  });
});

test("Home surface WebSocket requests roundtrip only to the requesting client", function () {
  var fixture = harness();
  var messages = [];
  var ws = { _clayUser: { id: "u1" }, send: function (value) { messages.push(JSON.parse(value)); } };
  var handler = attachHomePreferences({
    users: {
      isMultiUser: function () { return true; },
      getHomeSurfacePreference: fixture.preferences.getHomeSurfacePreference,
      setHomeSurfacePreference: fixture.preferences.setHomeSurfacePreference,
    },
    projects: new Map(),
  });
  assert.strictEqual(handler.handleMessage(ws, {
    type: "home_surface_set",
    preference: { activeMateId: "mate-a", activeSessionByMate: { "mate-a": "session-a" } },
  }), true);
  assert.deepStrictEqual(messages[0].preference.activeSessionByMate, { "mate-a": "session-a" });
  messages.length = 0;
  handler.handleMessage(ws, { type: "home_surface_get" });
  assert.strictEqual(messages[0].preference.activeMateId, "mate-a");
});
