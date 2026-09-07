var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var attachExperimentalPreferences = require("../lib/users-experimental-preferences").attachExperimentalPreferences;
var serverTools = require("../lib/server-tools");
var attachSettings = require("../lib/server-settings").attachSettings;

function preferenceHarness() {
  var data = { users: [{ id: "u1" }, { id: "u2", capsulesEnabled: true }] };
  var saves = 0;
  var preferences = attachExperimentalPreferences({
    loadUsers: function () { return data; },
    saveUsers: function (next) { data = next; saves++; },
  });
  return { preferences: preferences, data: function () { return data; }, saves: function () { return saves; } };
}

test("Capsules default off and persist independently per user", function () {
  var fixture = preferenceHarness();
  assert.strictEqual(fixture.preferences.getCapsulesEnabled("u1"), false);
  assert.strictEqual(fixture.preferences.getCapsulesEnabled("u2"), true);
  assert.deepStrictEqual(fixture.preferences.setCapsulesEnabled("u1", true), { ok: true, capsulesEnabled: true });
  assert.strictEqual(fixture.preferences.getCapsulesEnabled("u1"), true);
  assert.strictEqual(fixture.preferences.getCapsulesEnabled("u2"), true);
  assert.strictEqual(fixture.saves(), 1);
});

test("disabled Capsules expose an empty browser catalog and reject direct operations", function () {
  var messages = [];
  var tools = serverTools.attachTools({
    users: { isMultiUser: function () { return false; } },
    projects: new Map(),
    isCapsulesEnabled: function () { return false; },
  });
  var ws = { send: function (payload) { messages.push(JSON.parse(payload)); } };
  assert.strictEqual(tools.handleMessage(ws, { type: "tools_list" }), true);
  assert.deepStrictEqual(messages, [{ type: "tools_state", tools: [] }]);
  assert.deepStrictEqual(tools.installedManifests("default"), []);
  assert.throws(function () {
    tools.controlForMate("default", "mate", "pig", "snapshot", {});
  }, /disabled in User Settings/);
});

test("the multi-user setting route persists the opt-in and refreshes Mate catalogs", function () {
  var saved = null;
  var refreshed = null;
  var user = { id: "u1", profile: { name: "One" } };
  var settings = attachSettings({
    users: {
      isMultiUser: function () { return true; },
      setCapsulesEnabled: function (userId, enabled) {
        saved = { userId: userId, enabled: enabled };
        return { ok: true, capsulesEnabled: enabled };
      },
    },
    mates: {},
    getMultiUserFromReq: function () { return user; },
    projects: new Map(),
    opts: {},
    CONFIG_DIR: "/tmp",
    onCapsulesPreferenceChanged: function (userId) { refreshed = userId; },
  });
  var response = { status: null, body: null, writeHead: function (status) { this.status = status; }, end: function (body) { this.body = JSON.parse(body); } };
  var request = {
    method: "PUT",
    on: function (event, callback) {
      if (event === "data") callback(JSON.stringify({ enabled: true }));
      if (event === "end") callback();
    },
  };
  assert.strictEqual(settings.handleRequest(request, response, "/api/user/capsules-enabled"), true);
  assert.deepStrictEqual(saved, { userId: "u1", enabled: true });
  assert.strictEqual(refreshed, "u1");
  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(response.body, { ok: true, capsulesEnabled: true });
});

test("User Settings presents Capsules as an opt-in experimental feature", function () {
  var root = path.join(__dirname, "..");
  var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var client = fs.readFileSync(path.join(root, "lib/public/modules/capsule-preference.js"), "utf8");
  var server = fs.readFileSync(path.join(root, "lib/server-settings.js"), "utf8");
  assert.match(html, /<body class="capsules-disabled">/);
  assert.match(html, /data-section="us-experimental"/);
  assert.match(html, /id="us-capsules-enabled"/);
  assert.match(client, /fetch\('\/api\/user\/capsules-enabled'/);
  assert.match(server, /profile\.capsulesEnabled = users\.getCapsulesEnabled\(mu\.id\)/);
  assert.match(server, /dc\.capsulesEnabled === true/);
});
