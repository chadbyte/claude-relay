var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var attachHomeChat = require("../lib/server-home-chat").attachHomeChat;
var shouldSuppressHomeResponse = require("../lib/home-response-notifications").shouldSuppressHomeResponse;

function projectsWith(ws) {
  return new Map([["shell", {
    forEachClient: function (fn) { fn(ws); },
  }]]);
}

test("only a visibly presented exact Home Mate session suppresses its response notification", function () {
  var ws = {
    _clayUser: { id: "u1" },
    _homeChatPresented: true,
    _homeChatTap: { mateId: "builtin:clay", mateSlug: "mate-clay", sessionId: 7, sessionReference: "local:7" },
  };
  var projects = projectsWith(ws);
  var session = { localId: 7, cliSessionId: null, ownerId: "u1" };
  assert.equal(shouldSuppressHomeResponse(projects, "mate-clay", session), true);

  ws._homeChatTap.sessionId = 8;
  ws._homeChatTap.sessionReference = "local:8";
  assert.equal(shouldSuppressHomeResponse(projects, "mate-clay", session), false);
  ws._homeChatTap = { mateId: "builtin:clay", mateSlug: "mate-another", sessionId: 7, sessionReference: "local:7" };
  assert.equal(shouldSuppressHomeResponse(projects, "mate-clay", session), false);
  ws._homeChatTap = { mateId: "builtin:clay", mateSlug: "mate-clay", sessionId: 7, sessionReference: "local:7" };
  ws._clayUser.id = "u2";
  assert.equal(shouldSuppressHomeResponse(projects, "mate-clay", session), false);
  ws._clayUser.id = "u1";
  ws._homeChatPresented = false;
  assert.equal(shouldSuppressHomeResponse(projects, "mate-clay", session), false);
});

test("promoted Home session identity remains an exact suppression match", function () {
  var ws = {
    _clayUser: { id: "u1" },
    _homeChatPresented: true,
    _homeChatTap: { mateId: "mate-a", mateSlug: "mate-mate-a", sessionId: 7, sessionReference: "durable-7" },
  };
  var session = { localId: 7, cliSessionId: "durable-7", ownerId: "u1" };
  assert.equal(shouldSuppressHomeResponse(projectsWith(ws), "mate-mate-a", session), true);
  ws._homeChatTap.sessionReference = "another-session";
  assert.equal(shouldSuppressHomeResponse(projectsWith(ws), "mate-mate-a", session), false);
});

test("project context delegates Home presentation on the response WebSocket", function () {
  var projectSource = fs.readFileSync(path.join(__dirname, "../lib/project.js"), "utf8");
  var delegation = projectSource.slice(projectSource.indexOf("// --- DM messages"), projectSource.indexOf("// --- @Mention"));
  assert.match(delegation, /msg\.type === "home_mate_present"/);
  assert.match(delegation, /home_mate_present[\s\S]*opts\.onDmMessage\(ws, msg\)/);
  var handler = attachHomeChat({
    users: { isMultiUser: function () { return true; } },
    mates: {},
    projects: new Map(),
    addProject: function () {},
  });
  var ws = { readyState: 1 };
  assert.equal(handler.handleMessage(ws, { type: "home_mate_present", visible: true }), true);
  assert.equal(ws._homeChatPresented, true);
  ws._clayUser = { id: "u1" };
  ws._homeChatTap = { mateId: "builtin:clay", mateSlug: "mate-clay", sessionId: 7, sessionReference: "local:7" };
  assert.equal(shouldSuppressHomeResponse(projectsWith(ws), "mate-clay", { localId: 7, ownerId: "u1" }), true);
  assert.equal(handler.handleMessage(ws, { type: "home_mate_close" }), true);
  assert.equal(ws._homeChatPresented, false);
});

test("Home reports only visible-document presentation and resyncs lifecycle changes", function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-home-hub.js"), "utf8");
  assert.match(source, /type: "home_mate_present", visible: homeHubVisible && !document\.hidden/);
  assert.match(source, /document\.addEventListener\("visibilitychange", syncHomePresentation\)/);
  assert.match(source, /state\.connected !== prev\.connected && state\.connected && homeHubVisible/);
  assert.match(source, /homeHub\.classList\.remove\("hidden"\);\s*syncHomePresentation\(\)/);
  assert.match(source, /homeHub\.classList\.add\("hidden"\);\s*syncHomePresentation\(\)/);
});
