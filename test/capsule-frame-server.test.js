var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var http = require("node:http");
var os = require("node:os");
var path = require("node:path");

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-capsule-frame-"));
process.env.CLAY_HOME = testRoot;

var registry = require("../lib/tools-registry");
var frameServerModule = require("../lib/capsule-frame-server");
var serverTools = require("../lib/server-tools");
var catalog = require("../lib/project-capsule-catalog");

var openServers = [];

test.after(async function () {
  for (var i = 0; i < openServers.length; i++) await openServers[i].close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function newFrameServer() {
  var server = frameServerModule.createCapsuleFrameServer({});
  openServers.push(server);
  return server;
}

function request(port, requestPath) {
  return new Promise(function (resolve, reject) {
    http.get({ host: "127.0.0.1", port: port, path: requestPath }, function (response) {
      var body = "";
      response.setEncoding("utf8");
      response.on("data", function (chunk) { body += chunk; });
      response.once("end", function () { resolve({ status: response.statusCode, headers: response.headers, body: body }); });
    }).once("error", reject);
  });
}

function ctxFor(userId) {
  var ctx = { userId: userId, multiUser: true };
  registry.listTools(ctx);
  return ctx;
}

test("the frame URL is one-time, and the shell carries a no-network nonce-only CSP", async function () {
  var ctx = ctxFor("frame-user");
  var frameServer = newFrameServer();
  var frame = await frameServer.issueFrameUrl(ctx, "pig");
  assert.strictEqual(frame.secure, false);
  assert.match(frame.path, /^\/capsule\/\?t=[0-9a-f]{48}$/);

  var shell = await request(frame.port, frame.path);
  assert.strictEqual(shell.status, 200);
  var csp = shell.headers["content-security-policy"];
  assert.match(csp, /(^|; )default-src 'none'/);
  assert.match(csp, /script-src 'nonce-[^']+'/);
  assert.match(csp, /base-uri 'none'/);
  // No connect-src at all: with default-src 'none' the frame cannot reach the
  // network, and no directive may quietly widen that.
  assert.strictEqual(csp.indexOf("connect-src"), -1);
  assert.strictEqual(csp.indexOf("cdn.jsdelivr.net"), -1);
  assert.strictEqual(csp.indexOf("esm.sh"), -1);
  assert.strictEqual(shell.headers["x-content-type-options"], "nosniff");
  assert.match(shell.body, /window\.ClayCapsule/);
  assert.match(shell.body, /sandbox|display\.js\?t=/);

  // The shell half of the token is spent.
  var replay = await request(frame.port, frame.path);
  assert.strictEqual(replay.status, 403);

  // The display half still serves the Capsule's own bundle, exactly once.
  var token = frame.path.split("t=")[1];
  var display = await request(frame.port, "/capsule/display.js?t=" + token);
  assert.strictEqual(display.status, 200);
  assert.match(display.headers["content-type"], /text\/javascript/);
  assert.match(display.body, /ClayCapsule/);
  var displayReplay = await request(frame.port, "/capsule/display.js?t=" + token);
  assert.strictEqual(displayReplay.status, 403);

  var junk = await request(frame.port, "/capsule/?t=" + "0".repeat(48));
  assert.strictEqual(junk.status, 403);
  var elsewhere = await request(frame.port, "/anything");
  assert.strictEqual(elsewhere.status, 404);
});

test("a Capsule without a rich element gets no frame URL", async function () {
  var ctx = ctxFor("frame-user");
  var frameServer = newFrameServer();
  await assert.rejects(function () {
    return frameServer.issueFrameUrl(ctx, "tictactoe");
  }, /no rich Display/);
});

test("the rich element is invisible to the Mate surface: catalog, list, and Logic are unchanged by it", async function () {
  // Two users, same shipped Capsules; one loses the rich element entirely.
  var withRich = ctxFor("frame-rich");
  var withoutRich = ctxFor("frame-bare");
  fs.rmSync(path.join(registry.resolveToolsRoot(withoutRich), "pig", "display.js"));

  var richTool = registry.getTool(withRich, "pig");
  var bareTool = registry.getTool(withoutRich, "pig");
  assert.strictEqual(richTool.hasRichDisplay, true);
  assert.strictEqual(bareTool.hasRichDisplay, false);
  // The manifest carries no trace of Display richness, so nothing about it
  // can reach a prompt or an MCP listing.
  assert.deepStrictEqual(richTool.manifest, bareTool.manifest);
  assert.strictEqual(JSON.stringify(richTool.manifest).indexOf("display"), -1);

  var richCatalog = catalog.buildCapsuleCatalogPrompt(registry.listTools(withRich));
  var bareCatalog = catalog.buildCapsuleCatalogPrompt(registry.listTools(withoutRich));
  assert.strictEqual(richCatalog, bareCatalog);

  // Same snapshot, same act behavior, through the same Mate pipeline: the
  // strongest available evidence that Display and Logic are separate layers.
  var tools = serverTools.attachTools({
    users: { isMultiUser: function () { return true; }, findUserById: function (id) { return { id: id }; } },
    projects: new Map(),
  });
  var richView = await tools.controlForMate("frame-rich", "mate-a", "pig", "snapshot", {});
  var bareView = await tools.controlForMate("frame-bare", "mate-b", "pig", "snapshot", {});
  assert.deepStrictEqual(richView, bareView);
  await assert.rejects(function () {
    return tools.controlForMate("frame-rich", "mate-a", "pig", "act", { actionId: "roll", args: {} });
  }, /out of turn/);
  await assert.rejects(function () {
    return tools.controlForMate("frame-bare", "mate-b", "pig", "act", { actionId: "roll", args: {} });
  }, /out of turn/);
});

test("the tool_frame_url message mints a URL over the socket, and refuses a floor-only Capsule", async function () {
  var sent = [];
  var socket = { readyState: 1, _clayUser: { id: "frame-ws" }, send: function (payload) { sent.push(JSON.parse(payload)); } };
  var frameServer = newFrameServer();
  var tools = serverTools.attachTools({
    users: { isMultiUser: function () { return true; }, findUserById: function (id) { return { id: id }; } },
    projects: new Map(),
    frameServer: frameServer,
  });
  ctxFor("frame-ws");

  assert.strictEqual(tools.handleMessage(socket, { type: "tool_frame_url", toolId: "pig", requestId: "f-1" }), true);
  for (var i = 0; i < 100 && sent.length === 0; i++) await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].type, "tool_frame_url_state");
  assert.strictEqual(sent[0].ok, true);
  assert.strictEqual(sent[0].requestId, "f-1");
  assert.ok(sent[0].frame.port > 0);
  assert.match(sent[0].frame.path, /^\/capsule\/\?t=/);

  sent.length = 0;
  assert.strictEqual(tools.handleMessage(socket, { type: "tool_frame_url", toolId: "tictactoe", requestId: "f-2" }), true);
  for (var j = 0; j < 100 && sent.length === 0; j++) await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.strictEqual(sent[0].ok, false);
  assert.match(sent[0].error, /no rich Display/);
});
