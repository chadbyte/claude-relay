var test = require("node:test");
var assert = require("node:assert/strict");

var claude = require("../lib/yoke/adapters/claude");
var attachMessageProcessor = require("../lib/sdk-message-processor").attachMessageProcessor;

test("Claude normalizes API retries as structured transient events", function () {
  var normalized = claude.contractTestKit.normalizeEvent({
    type: "system",
    subtype: "api_retry",
    attempt: 2,
    max_retries: 10,
    retry_delay_ms: 4000,
    error_status: 529,
    error: "overloaded",
  });
  assert.deepEqual(normalized, {
    yokeType: "api_retry",
    attempt: 2,
    maxRetries: 10,
    retryDelayMs: 4000,
    error: "overloaded",
    errorStatus: 529,
  });
});

test("repeated overload retries produce one notice and stop after three attempts", function () {
  var transient = [];
  var recorded = [];
  var aborts = 0;
  var processor = attachMessageProcessor({
    sm: {
      sendToSession: function (session, message) { transient.push(message); },
      sendAndRecord: function (session, message) { recorded.push(message); },
      broadcastSessionList: function () {},
    },
    send: function () {},
    onProcessingChanged: function () {},
    getNotificationsModule: function () { return null; },
    shouldSuppressResponseNotification: function () { return true; },
  });
  var session = {
    messageUUIDs: [],
    abortController: { abort: function () { aborts++; } },
  };

  processor.processSDKMessage(session, { yokeType: "api_retry", attempt: 1, error: "overloaded" });
  processor.processSDKMessage(session, { yokeType: "api_retry", attempt: 2, error: "overloaded" });
  processor.processSDKMessage(session, { yokeType: "api_retry", attempt: 3, error: "overloaded" });
  processor.processSDKMessage(session, { yokeType: "api_retry", attempt: 4, error: "overloaded" });
  session.blocks = {};
  session.sentToolResults = {};
  session.pendingPermissions = {};
  session.pendingElicitations = {};
  session.pendingAskUser = {};
  session.activeTaskToolIds = {};
  session.taskIdMap = {};
  session.isProcessing = true;
  processor.processSDKMessage(session, {
    yokeType: "result",
    subtype: "error_during_execution",
    errors: ["overloaded"],
  });

  assert.equal(transient.length, 1, "retry status is not duplicated in the transcript");
  assert.match(transient[0].text, /overloaded/);
  assert.equal(recorded.filter(function (message) { return message.type === "error"; }).length, 1,
    "the bounded failure is reported once even when the SDK returns its terminal error");
  assert.match(recorded[0].text, /after 3 attempts/);
  assert.equal(aborts, 1, "the stuck turn is interrupted exactly once");
});

test("a new overload sequence may be stopped after an earlier one", function () {
  var aborts = 0;
  var processor = attachMessageProcessor({
    sm: {
      sendToSession: function () {},
      sendAndRecord: function () {},
    },
    send: function () {},
    onProcessingChanged: function () {},
    getNotificationsModule: function () { return null; },
    shouldSuppressResponseNotification: function () { return true; },
  });
  var session = {
    messageUUIDs: [],
    _overloadAbortRequested: true,
    abortController: { abort: function () { aborts++; } },
  };

  processor.processSDKMessage(session, { yokeType: "api_retry", attempt: 1, error: "overloaded" });
  processor.processSDKMessage(session, { yokeType: "api_retry", attempt: 3, error: "overloaded" });
  assert.equal(aborts, 1);
});
