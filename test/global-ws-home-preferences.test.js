var test = require("node:test");
var assert = require("node:assert/strict");
var attachGlobalWs = require("../lib/server-global-ws").attachGlobalWs;
var attachHomePreferences = require("../lib/server-home-preferences").attachHomePreferences;

test("slugless WebSocket serves Home preferences during new-user bootstrap", function () {
  var messages = [];
  var ws = {
    _clayUser: { id: "new-user" },
    send: function (value) { messages.push(JSON.parse(value)); },
  };
  var preferences = attachHomePreferences({
    users: {
      isMultiUser: function () { return true; },
      getHomeSurfacePreference: function () {
        return { surface: null, sidebarCollapsed: false };
      },
      getHomeDockPreference: function () {
        return { dockOpen: false, dockFocus: false, dockWidth: null, activeToolId: null };
      },
    },
    projects: new Map(),
  });
  var globalWs = attachGlobalWs({
    onHomePreferenceMessage: preferences.handleMessage,
  });

  globalWs.handleMessage(ws, { type: "home_surface_get" });
  globalWs.handleMessage(ws, { type: "home_dock_get" });

  assert.deepStrictEqual(messages, [
    {
      type: "home_surface_state",
      preference: { surface: null, sidebarCollapsed: false },
    },
    {
      type: "home_dock_state",
      preference: { dockOpen: false, dockFocus: false, dockWidth: null, activeToolId: null },
    },
  ]);
});

test("slugless WebSocket routes Mate and Home requests without an ordinary project", function () {
  var routed = [];
  var globalWs = attachGlobalWs({
    onAppMessage: function (ws, msg) {
      if (msg.type !== "mate_list" && msg.type !== "home_debates_list") return false;
      routed.push({ userId: ws._clayUser.id, type: msg.type });
      return true;
    },
  });
  var ws = { _clayUser: { id: "new-user" } };

  globalWs.handleMessage(ws, { type: "mate_list" });
  globalWs.handleMessage(ws, { type: "home_debates_list" });

  assert.deepStrictEqual(routed, [
    { userId: "new-user", type: "mate_list" },
    { userId: "new-user", type: "home_debates_list" },
  ]);
});
