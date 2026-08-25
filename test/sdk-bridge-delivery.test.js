var test = require("node:test");
var assert = require("node:assert");

var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

function createBridge(sessionManager, onProcessingChanged) {
  return createSDKBridge({
    cwd: process.cwd(),
    sessionManager: sessionManager || {},
    adapter: { vendor: "codex" },
    send: function () {},
    onProcessingChanged: onProcessingChanged || function () {},
  });
}

function createEndingHandle(events, beforeDone) {
  var index = 0;
  return {
    pushMessage: function() { return true; },
    close: function() {},
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (index < events.length) {
            var event = events[index++];
            return Promise.resolve({ value: event, done: false });
          }
          if (beforeDone) beforeDone();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

test("pushMessage retires a query handle that rejects delivery", function() {
  var bridge = createBridge();
  var closeCount = 0;
  var query = {
    pushMessage: function() { return false; },
    close: function() { closeCount++; },
  };
  var session = {
    localId: 7,
    queryInstance: query,
    abortController: { signal: {} },
    messageQueue: {},
  };

  assert.strictEqual(bridge.pushMessage(session, "hello"), false);
  assert.strictEqual(closeCount, 1);
  assert.strictEqual(session.queryInstance, null);
  assert.strictEqual(session.abortController, null);
  assert.strictEqual(session.messageQueue, null);
});

test("mention sessions preserve the mapped Linux user", async function() {
  var capturedOptions = null;
  var handle = createEndingHandle([]);
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {},
    adapter: {
      vendor: "codex",
      createQuery: function(options) {
        capturedOptions = options;
        return Promise.resolve(handle);
      },
    },
    send: function() {},
  });

  var mentionSession = await bridge.createMentionSession({
    linuxUser: "clay-alice",
    claudeMd: "",
    initialContext: "context",
    initialMessage: "question",
    onDelta: function() {},
    onDone: function() {},
    onError: function() {},
  });

  assert.ok(mentionSession);
  assert.strictEqual(capturedOptions.linuxUser, "clay-alice");
});

test("pushMessage retires a query handle that throws during delivery", function() {
  var bridge = createBridge();
  var query = {
    pushMessage: function() { throw new Error("closed input"); },
    close: function() {},
  };
  var session = { localId: 8, queryInstance: query };

  assert.strictEqual(bridge.pushMessage(session, "hello"), false);
  assert.strictEqual(session.queryInstance, null);
});

test("rejected delivery does not clear resources from a replacement query", function() {
  var bridge = createBridge();
  var replacementQuery = { pushMessage: function() { return true; } };
  var replacementAbortController = { signal: {} };
  var replacementMessageQueue = {};
  var session = {
    localId: 9,
    abortController: { signal: {} },
    messageQueue: {},
  };
  var originalQuery = {
    pushMessage: function() {
      session.queryInstance = replacementQuery;
      session.abortController = replacementAbortController;
      session.messageQueue = replacementMessageQueue;
      return false;
    },
    close: function() {},
  };
  session.queryInstance = originalQuery;

  assert.strictEqual(bridge.pushMessage(session, "hello"), false);
  assert.strictEqual(session.queryInstance, replacementQuery);
  assert.strictEqual(session.abortController, replacementAbortController);
  assert.strictEqual(session.messageQueue, replacementMessageQueue);
});

test("adapter errors finish a result-less stream instead of leaving it processing", async function() {
  var recorded = [];
  var broadcasts = 0;
  var bridge = createBridge({
    sendAndRecord: function(session, msg) { recorded.push(msg); },
    sendToSession: function() {},
    broadcastSessionList: function() { broadcasts++; },
  });
  var handle = createEndingHandle([{ yokeType: "error", text: "turn failed" }]);
  var session = {
    localId: 10,
    vendor: "codex",
    queryInstance: handle,
    isProcessing: true,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };

  await bridge.processQueryStream(session);

  assert.strictEqual(session.isProcessing, false);
  assert.strictEqual(recorded.filter(function(msg) { return msg.type === "error"; }).length, 1);
  assert.strictEqual(recorded[recorded.length - 1].type, "done");
  assert.strictEqual(recorded[recorded.length - 1].code, 1);
  assert.strictEqual(broadcasts, 1);
});

test("Codex writer conflicts surface a recoverable session error", async function() {
  var recorded = [];
  var bridge = createBridge({
    sendAndRecord: function(session, msg) { recorded.push(msg); },
    sendToSession: function() {},
    broadcastSessionList: function() {},
  });
  var handle = createEndingHandle([{
    yokeType: "error",
    text: "thread-store conflict: thread abc already has an active writer",
  }]);
  var session = {
    localId: 14,
    vendor: "codex",
    queryInstance: handle,
    isProcessing: true,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };

  await bridge.processQueryStream(session);

  var conflicts = recorded.filter(function(msg) { return msg.type === "session_writer_conflict"; });
  assert.strictEqual(conflicts.length, 1);
  assert.match(conflicts[0].text, /another Clay or Codex process/);
  assert.strictEqual(recorded.filter(function(msg) { return msg.type === "error"; }).length, 0);
  assert.strictEqual(recorded[recorded.length - 1].type, "done");
  assert.strictEqual(session.isProcessing, false);
});

test("an old stream ending cannot stop its replacement query", async function() {
  var recorded = [];
  var replacement = { pushMessage: function() { return true; } };
  var session;
  var handle = createEndingHandle([], function() {
    session.queryInstance = replacement;
  });
  var bridge = createBridge({
    sendAndRecord: function(activeSession, msg) { recorded.push(msg); },
    sendToSession: function() {},
    broadcastSessionList: function() {},
  });
  session = {
    localId: 11,
    vendor: "codex",
    queryInstance: handle,
    isProcessing: true,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
  };

  await bridge.processQueryStream(session);

  assert.strictEqual(session.isProcessing, true);
  assert.strictEqual(session.queryInstance, replacement);
  assert.strictEqual(recorded.length, 0);
});

test("accepted pushes track turns queued behind the active turn", function() {
  var bridge = createBridge();
  var session = {
    localId: 12,
    queryInstance: { pushMessage: function() { return true; } },
    _awaitingTurnResult: true,
    _queuedTurnCount: 0,
  };

  assert.strictEqual(bridge.pushMessage(session, "follow up"), true);
  assert.strictEqual(session._awaitingTurnResult, true);
  assert.strictEqual(session._queuedTurnCount, 1);
});

test("a result keeps processing active while a queued turn continues", function() {
  var recorded = [];
  var direct = [];
  var processingChanges = 0;
  var bridge = createBridge({
    sendAndRecord: function(session, msg) { recorded.push(msg); },
    sendToSession: function(session, msg) { direct.push(msg); },
    broadcastSessionList: function() {},
  }, function() { processingChanges++; });
  var session = {
    localId: 13,
    isProcessing: true,
    _awaitingTurnResult: true,
    _queuedTurnCount: 1,
    pendingAskUser: {},
    pendingPermissions: {},
    pendingElicitations: {},
    activeTaskToolIds: {},
    taskIdMap: {},
    responsePreview: "first reply",
    history: [],
    turnCount: 0,
  };

  bridge.processSDKMessage(session, { yokeType: "result", cost: 1, duration: 10 });

  assert.strictEqual(session.isProcessing, true);
  assert.strictEqual(session._awaitingTurnResult, true);
  assert.strictEqual(session._queuedTurnCount, 0);
  assert.strictEqual(processingChanges, 0);
  assert.deepStrictEqual(direct[direct.length - 1], { type: "status", status: "processing" });

  bridge.processSDKMessage(session, { yokeType: "result", cost: 1, duration: 10 });

  assert.strictEqual(session.isProcessing, false);
  assert.strictEqual(session._awaitingTurnResult, false);
  assert.strictEqual(processingChanges, 1);
  assert.strictEqual(recorded[recorded.length - 1].type, "done");
});
