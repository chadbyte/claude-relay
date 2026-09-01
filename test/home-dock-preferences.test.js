var test = require("node:test");
var assert = require("node:assert/strict");
var attachHomeDockPreferences = require("../lib/users-home-dock-preferences").attachHomeDockPreferences;
var attachHomePreferences = require("../lib/server-home-preferences").attachHomePreferences;

function harness() {
  var data = { users: [{ id: "u1" }, { id: "u2" }] };
  var saves = 0;
  var preferences = attachHomeDockPreferences({
    loadUsers: function () { return data; },
    saveUsers: function (next) { data = next; saves++; },
  });
  return { preferences: preferences, getData: function () { return data; }, getSaves: function () { return saves; } };
}

test("home dock preferences default to the closed conversation state", function () {
  var fixture = harness();
  assert.deepStrictEqual(fixture.preferences.getHomeDockPreference("u1"), {
    dockOpen: false,
    dockFocus: false,
    dockWidth: null,
    activeToolId: null,
  });
});

test("home dock preferences roundtrip per user and preserve partial updates", function () {
  var fixture = harness();
  var first = fixture.preferences.setHomeDockPreference("u1", {
    dockOpen: true,
    dockFocus: true,
    dockWidth: 612.4,
    activeToolId: "board",
  });
  assert.deepStrictEqual(first.preference, { dockOpen: true, dockFocus: true, dockWidth: 612, activeToolId: "board" });
  var second = fixture.preferences.setHomeDockPreference("u1", { dockOpen: false });
  assert.deepStrictEqual(second.preference, { dockOpen: false, dockFocus: false, dockWidth: 612, activeToolId: "board" });
  assert.deepStrictEqual(fixture.preferences.getHomeDockPreference("u2"), { dockOpen: false, dockFocus: false, dockWidth: null, activeToolId: null });
  assert.strictEqual(fixture.getSaves(), 2);
});

test("home dock preferences normalize unsafe values", function () {
  var fixture = harness();
  var result = fixture.preferences.setHomeDockPreference("u1", {
    dockOpen: "yes",
    dockWidth: 9000,
    activeToolId: "../../board",
  });
  assert.deepStrictEqual(result.preference, { dockOpen: false, dockFocus: false, dockWidth: 1600, activeToolId: null });
});

test("home dock WebSocket messages roundtrip and broadcast only to the same user", function () {
  var fixture = harness();
  var ownerMessages = [];
  var secondOwnerMessages = [];
  var otherMessages = [];
  var owner = { _clayUser: { id: "u1" }, send: function (value) { ownerMessages.push(JSON.parse(value)); } };
  var secondOwner = { _clayUser: { id: "u1" }, send: function (value) { secondOwnerMessages.push(JSON.parse(value)); } };
  var other = { _clayUser: { id: "u2" }, send: function (value) { otherMessages.push(JSON.parse(value)); } };
  var handler = attachHomePreferences({
    users: {
      isMultiUser: function () { return true; },
      getHomeDockPreference: fixture.preferences.getHomeDockPreference,
      setHomeDockPreference: fixture.preferences.setHomeDockPreference,
    },
    projects: new Map([["one", {
      forEachClient: function (visit) { visit(owner); visit(secondOwner); visit(other); },
    }]]),
  });

  assert.strictEqual(handler.handleMessage(owner, {
    type: "home_dock_set",
    preference: { dockOpen: true, dockFocus: true, dockWidth: 640, activeToolId: "board" },
  }), true);
  assert.deepStrictEqual(ownerMessages[0].preference, { dockOpen: true, dockFocus: true, dockWidth: 640, activeToolId: "board" });
  assert.deepStrictEqual(secondOwnerMessages[0].preference, ownerMessages[0].preference);
  assert.strictEqual(otherMessages.length, 0);

  ownerMessages.length = 0;
  assert.strictEqual(handler.handleMessage(owner, { type: "home_dock_get" }), true);
  assert.deepStrictEqual(ownerMessages[0], {
    type: "home_dock_state",
    preference: { dockOpen: true, dockFocus: true, dockWidth: 640, activeToolId: "board" },
  });
});
