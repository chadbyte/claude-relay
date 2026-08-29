var test = require("node:test");
var assert = require("node:assert");
var path = require("path");
var pathToFileURL = require("url").pathToFileURL;

var originalWorker = global.Worker;
var originalBlob = global.Blob;
var originalCreateObjectURL = URL.createObjectURL;
var originalRevokeObjectURL = URL.revokeObjectURL;
var workers = [];
var workerSource = "";
var runtimeModule;
var wsRef;

function FakeBlob(parts) {
  workerSource = parts.join("");
}

function FakeWorker() {
  this.messages = [];
  this.terminated = false;
  this.onmessage = null;
  this.onerror = null;
  workers.push(this);
}

FakeWorker.prototype.postMessage = function (message) { this.messages.push(message); };
FakeWorker.prototype.terminate = function () { this.terminated = true; };

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitFor(predicate) {
  for (var i = 0; i < 50; i++) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("Timed out waiting for runtime condition.");
}

test.before(async function () {
  global.Worker = FakeWorker;
  global.Blob = FakeBlob;
  URL.createObjectURL = function () { return "blob:tool-runtime-test"; };
  URL.revokeObjectURL = function () {};
  runtimeModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-runtime.js")).href);
  wsRef = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/ws-ref.js")).href);
});

test.beforeEach(function () {
  workers = [];
  workerSource = "";
  wsRef.setWs(null);
});

test.after(function () {
  wsRef.setWs(null);
  global.Worker = originalWorker;
  global.Blob = originalBlob;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

test("ordinary action errors reject without restarting a healthy worker", async function () {
  var surfaced = [];
  var runtime = runtimeModule.createToolRuntime({
    toolId: "test-tool",
    logicSource: "var tool = { initialState: {}, actions: {} };",
    onError: function (message) { surfaced.push(message); },
  });
  runtime.start();
  var worker = workers[0];
  worker.onmessage({ data: { type: "state", newState: {} } });
  var action = runtime.action("fails", {}, "user");
  var actionMessage = worker.messages.filter(function (message) { return message.type === "action"; })[0];
  worker.onmessage({ data: { type: "error", actionSeq: actionMessage.actionSeq, message: "Expected action failure" } });
  await assert.rejects(action, /Expected action failure/);
  await delay(150);
  assert.strictEqual(workers.length, 1);
  assert.strictEqual(worker.terminated, false);
  assert.deepStrictEqual(surfaced, ["Expected action failure"]);
  assert.match(workerSource, /Unknown action:[^\n]+actionSeq: msg\.actionSeq/);
  runtime.stop();
});

test("a failed initial action still leaves the runtime ready", async function () {
  var runtime = runtimeModule.createToolRuntime({
    toolId: "initial-action-tool",
    logicSource: "var tool = { initialState: { usable: true }, actions: {} };",
    initialAction: "load",
    onError: function () {},
  });
  runtime.start();
  var worker = workers[0];
  var ready = runtime.ready();
  worker.onmessage({ data: { type: "state", newState: { usable: true } } });
  var actionMessage = worker.messages.filter(function (message) { return message.type === "action"; })[0];
  worker.onmessage({ data: { type: "error", actionSeq: actionMessage.actionSeq, message: "Storage rejected load" } });
  assert.deepStrictEqual(await ready, { usable: true });
  assert.strictEqual(workers.length, 1);
  runtime.stop();
});

test("storage and LLM operations wait for a connecting socket", async function () {
  var sent = [];
  var ws = {
    readyState: 0,
    send: function (raw) { sent.push(JSON.parse(raw)); },
  };
  wsRef.setWs(ws);
  var runtime = runtimeModule.createToolRuntime({
    toolId: "waiting-tool",
    logicSource: "var tool = { initialState: {}, actions: {} };",
    allowLlm: true,
    wsWaitMs: 100,
    wsRetryMs: 5,
  });
  runtime.start();
  var worker = workers[0];
  worker.onmessage({ data: { type: "storage", seq: 1, op: "list", args: {} } });
  worker.onmessage({ data: { type: "llm", seq: 2, args: { prompt: "hello" }, callerId: "user" } });
  await delay(15);
  assert.strictEqual(sent.length, 0);
  assert.ok(!worker.messages.some(function (message) { return message.type === "storage_result" || message.type === "llm_result"; }));
  ws.readyState = 1;
  await waitFor(function () { return sent.length === 2; });
  assert.deepStrictEqual(sent.map(function (message) { return message.type; }).sort(), ["tool_llm_op", "tool_storage_op"]);
  runtime.stop();
});
