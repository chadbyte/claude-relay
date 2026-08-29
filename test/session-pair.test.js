var test = require("node:test");
var assert = require("node:assert");
var pairModule = require("../lib/project-session-pair");

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

function fixture(configured, options) {
  options = options || {};
  var driver = { localId: 1, ownerId: null, title: "Planner", vendor: "claude", history: [], isProcessing: false };
  var worker = { localId: 2, ownerId: null, title: "Builder", vendor: "codex", history: [], isProcessing: false };
  var sessions = new Map([[1, driver], [2, worker]]);
  var group = { id: "sg_pair", members: [1, 2] };
  if (configured) group.pair = { driverId: 1, workerId: 2 };
  var events = [];
  var starts = [];
  var driverPushes = [];
  var attached;
  var sm = {
    sessions: sessions,
    installedVendors: ["claude", "codex"],
    modelsByVendor: {},
    capabilitiesByVendor: {},
    sendAndRecord: function (session, message) { session.history.push(message); },
    sendToSession: function () {},
    broadcastSessionList: function () {},
  };
  var sdk = {
    pushMessage: function (session, text) {
      if (session === driver) {
        driverPushes.push(text);
        return options.driverPushAccepted !== false;
      }
      return false;
    },
    startQuery: function (session, text) {
      starts.push({ session: session, text: text });
      if (session !== worker) return Promise.resolve();
      delete session._lastTurnInterrupted;
      setTimeout(function () {
        if (options.workerError) {
          session.history.push({ type: "error", text: options.workerError });
        } else if (options.workerInterrupted) {
          session.history.push({ type: "delta", text: "Partial implementation" });
          session.history.push({ type: "info", text: "Interrupted · What should Claude do instead?" });
          session.history.push({ type: "done", code: 0 });
          session._lastTurnInterrupted = true;
        } else {
          session.history.push({ type: "delta", text: "Partner result" });
        }
        session.isProcessing = false;
        if (options.autoTurnDone !== false && !options.workerInterrupted) attached.handleTurnDone(session);
      }, options.workerDelay || 20);
      return Promise.resolve();
    },
  };
  attached = pairModule.attachSessionPair({
    sm: sm,
    splitStore: { groupForMember: function (id) { return group.members.indexOf(id) === -1 ? null : group; }, create: function () {} },
    getSdk: function () { return sdk; },
    send: function (message) { events.push(message); },
    sendTo: function () {},
    usersModule: { isMultiUser: function () { return false; } },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
  });
  return { attached: attached, driver: driver, worker: worker, group: group, events: events, starts: starts, driverPushes: driverPushes };
}

test("configured pairs expose partner tools only to the Driver", function () {
  var f = fixture(true);
  assert.deepStrictEqual(f.attached.getToolDefs(f.driver).map(function (tool) { return tool.name; }), ["send_to_partner", "read_partner"]);
  assert.deepStrictEqual(f.attached.getToolDefs(f.worker), []);
  assert.match(f.attached.getSystemPrompt(f.driver), /Driver/);
  assert.match(f.attached.getSystemPrompt(f.driver), /completed Worker turn leaves the Worker session available/);
  assert.match(f.attached.getSystemPrompt(f.driver), /create a replacement with spawn_sessions/);
  assert.match(f.attached.getToolDefs(f.driver)[0].description, /reuse the same Worker for follow-up implementation/);
  assert.strictEqual(f.attached.getSystemPrompt(f.worker), "");
});

test("ad-hoc splits expose partner tools to both sessions", function () {
  var f = fixture(false);
  assert.strictEqual(f.attached.getToolDefs(f.driver).length, 2);
  assert.strictEqual(f.attached.getToolDefs(f.worker).length, 2);
});

test("send_to_partner records attribution and returns the response", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", timeoutSeconds: 2 }));
  assert.deepStrictEqual(result, { status: "complete", response: "Partner result" });
  assert.strictEqual(f.worker.history[0].delegated, true);
  assert.strictEqual(f.worker.history[0].delegatedBy, 1);
  assert.strictEqual(f.worker.history[0].delegatedByTitle, "Planner");
  assert.strictEqual(f.starts[0].text, "Inspect the tests");
  assert.deepStrictEqual(f.events.map(function (event) { return event.active; }), [true, false]);
  assert.strictEqual(f.worker._delegatedBy, undefined);
  assert.deepStrictEqual(f.driverPushes, []);
});

test("a detached delegated turn pushes its result to the Driver once", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", wait: false }));
  assert.strictEqual(result.status, "running");
  await new Promise(function (resolve) { setTimeout(resolve, 50); });

  assert.strictEqual(f.driverPushes.length, 1);
  assert.match(f.driverPushes[0], /Worker result:\nPartner result/);
  assert.strictEqual(f.driver.history.length, 1);
  assert.strictEqual(f.driver.history[0]._internal, true);
  assert.strictEqual(f.driver.history[0].partnerResult, true);
  assert.deepStrictEqual(f.events.map(function (event) { return event.active; }), [true, false]);
});

test("a detached result starts a fresh Driver query when push is rejected", async function () {
  var f = fixture(true, { driverPushAccepted: false });
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 50); });

  var driverStarts = f.starts.filter(function (start) { return start.session === f.driver; });
  assert.strictEqual(driverStarts.length, 1);
  assert.match(driverStarts[0].text, /Worker result:\nPartner result/);
});

test("the detached monitor delivers failures even when no normal turn-done event arrives", async function () {
  var f = fixture(true, { autoTurnDone: false, workerError: "Worker crashed" });
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 550); });

  assert.strictEqual(f.driverPushes.length, 1);
  assert.match(f.driverPushes[0], /Worker error:\nWorker crashed/);
  assert.strictEqual(f.worker._pairDelegation, undefined);
});

test("waiting for an interrupted Worker returns its partial response and interrupted status", async function () {
  var f = fixture(true, { workerInterrupted: true });
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", timeoutSeconds: 2 }));
  assert.deepStrictEqual(result, { status: "interrupted", response: "Partial implementation" });
  assert.deepStrictEqual(f.driverPushes, []);
});

test("the detached monitor reports interruption as partial, not completion", async function () {
  var f = fixture(true, { workerInterrupted: true });
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  await new Promise(function (resolve) { setTimeout(resolve, 550); });

  assert.strictEqual(f.driverPushes.length, 1);
  assert.match(f.driverPushes[0], /Worker execution interrupted/);
  assert.match(f.driverPushes[0], /PARTIAL/);
  assert.doesNotMatch(f.driverPushes[0], /completed/);
});

test("a new Worker turn clears an earlier interrupted state", async function () {
  var f = fixture(true);
  f.worker._lastTurnInterrupted = true;
  var tool = f.attached.getToolDefs(f.driver)[0];
  var result = parseToolResult(await tool.handler({ message: "Inspect the tests", timeoutSeconds: 2 }));
  assert.deepStrictEqual(result, { status: "complete", response: "Partner result" });
});

test("a user-started Worker turn never pushes to the Driver", function () {
  var f = fixture(true);
  f.worker.history.push({ type: "user_message", text: "User request" });
  f.worker.history.push({ type: "delta", text: "User-requested result" });

  assert.strictEqual(f.attached.handleTurnDone(f.worker), false);
  assert.deepStrictEqual(f.driverPushes, []);
  assert.deepStrictEqual(f.driver.history, []);
});

test("a role change invalidates a detached Worker completion", async function () {
  var f = fixture(true);
  var tool = f.attached.getToolDefs(f.driver)[0];
  await tool.handler({ message: "Inspect the tests", wait: false });
  f.group.pair = { driverId: 2, workerId: 1 };
  await new Promise(function (resolve) { setTimeout(resolve, 50); });

  assert.deepStrictEqual(f.driverPushes, []);
  assert.deepStrictEqual(f.driver.history, []);
  assert.strictEqual(f.worker._pairDelegation, undefined);
});

test("a delegated session cannot delegate back", async function () {
  var f = fixture(false);
  f.worker._delegatedBy = 1;
  var tool = f.attached.getToolDefs(f.worker)[0];
  var result = await tool.handler({ message: "Send this back" });
  assert.strictEqual(result.isError, true);
  assert.match(result.content[0].text, /cannot delegate/);
});

test("recentTurns returns user-delimited partner turns with capped selection", function () {
  var session = { history: [
    { type: "user_message", text: "First" }, { type: "delta", text: "One" },
    { type: "user_message", text: "Second", delegated: true }, { type: "delta", text: "Two" },
  ] };
  assert.deepStrictEqual(pairModule.recentTurns(session, 1), [{ user: "Second", delegated: true, response: "Two" }]);
});
