var test = require("node:test");
var assert = require("node:assert");

var iface = require("../lib/yoke/interface");
var fixtures = require("./helpers/yoke-adapter-fixtures").createFixtures();

var SNAPSHOT_KEYS = [
  "yokeType",
  "blockId",
  "text",
  "toolId",
  "toolName",
  "content",
  "isError",
  "sessionId",
];

function projectEvent(event) {
  var projected = {};
  for (var i = 0; i < SNAPSHOT_KEYS.length; i++) {
    var key = SNAPSHOT_KEYS[i];
    if (event[key] !== undefined) projected[key] = event[key];
  }
  return projected;
}

function normalizeFixture(fixture) {
  var state = fixture.createState();
  var events = [];
  for (var i = 0; i < fixture.rawEvents.length; i++) {
    var normalized = fixture.normalize(fixture.rawEvents[i], state);
    var batch = Array.isArray(normalized) ? normalized : [normalized];
    for (var j = 0; j < batch.length; j++) {
      if (batch[j]) events.push(projectEvent(batch[j]));
    }
  }
  return events;
}

for (var i = 0; i < fixtures.length; i++) {
  (function(fixture) {
    test(fixture.vendor + " adapter satisfies the shared YOKE contract", function() {
      var adapter = fixture.createAdapter();
      var handle = fixture.createHandle();
      iface.validateAdapter(adapter);
      iface.validateQueryHandle(handle);
      handle.close();
      assert.strictEqual(handle.pushMessage("closed handle probe"), false);
    });

    test(fixture.vendor + " protocol snapshot normalizes to stable YOKE events", function() {
      assert.deepStrictEqual(normalizeFixture(fixture), fixture.expectedEvents);
    });

    test(fixture.vendor + " runtime dependency exposes the required surface", async function() {
      await fixture.verifyDependency();
    });
  })(fixtures[i]);
}

test("Claude query handles reject messages after their input queue closes", function() {
  var claudeModule = require("../lib/yoke/adapters/claude");
  var kit = claudeModule.contractTestKit;
  var queue = kit.createMessageQueue();
  var handle = kit.createQueryHandle({
    [Symbol.asyncIterator]: function() {
      return { next: function() { return new Promise(function() {}); } };
    },
    close: function() {},
  }, queue, new AbortController());

  assert.strictEqual(handle.pushMessage("first"), true);
  handle.close();
  assert.strictEqual(handle.pushMessage("must not be dropped silently"), false);
  assert.strictEqual(queue.push({ type: "user" }), false);
});

function assertBackgroundTaskContract(event, expectedTasks) {
  var iface = require("../lib/yoke/interface");
  assert.strictEqual(event.yokeType, "background_tasks_changed");
  assert.deepStrictEqual(event.tasks, expectedTasks);
  for (var i = 0; i < event.tasks.length; i++) {
    assert.ok(iface.BACKGROUND_TASK_TYPES.indexOf(event.tasks[i].task_type) !== -1);
  }
}

test("YOKE background-task producers emit the normalized level-state contract", function() {
  var producers = [{
    name: "Claude",
    normalize: require("../lib/yoke/adapters/claude").contractTestKit.normalizeEvent,
    rawEvent: {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [
        { task_id: "bash-1", task_type: "local_bash", description: "Wait for build" },
        { task_id: "agent-1", task_type: "local_agent", description: "Review changes" },
        { task_id: "unknown-1", task_type: "native_monitor", description: "Check status" },
      ],
    },
    expectedTasks: [
      { task_id: "bash-1", task_type: "shell", description: "Wait for build" },
      { task_id: "agent-1", task_type: "agent", description: "Review changes" },
      { task_id: "unknown-1", task_type: "other", description: "Check status" },
    ],
  }, {
    name: "Codex",
    produce: require("../lib/yoke/codex-background-tasks").mapTerminals,
    rawEvent: {
      terminals: [{ id: "terminal-1", commandLine: "npm test" }],
    },
    expectedTasks: [
      { task_id: "terminal-1", task_type: "shell", description: "npm test" },
    ],
  }];
  for (var i = 0; i < producers.length; i++) {
    var producer = producers[i];
    if (producer.normalize) assertBackgroundTaskContract(producer.normalize(producer.rawEvent), producer.expectedTasks);
    else assertBackgroundTaskContract({ yokeType: "background_tasks_changed", tasks: producer.produce(producer.rawEvent) }, producer.expectedTasks);
  }
});

test("Claude flattens task system events and legacy notifications", function() {
  var normalize = require("../lib/yoke/adapters/claude").contractTestKit.normalizeEvent;
  var notification = normalize({ type: "system", subtype: "task_notification", parent_tool_use_id: "tool-1", task_id: "task-1", status: "stopped", summary: "Stopped" });
  var updated = normalize({ type: "system", subtype: "task_updated", task_id: "task-1", patch: { status: "running" } });
  var legacy = normalize({ type: "task_notification", parent_tool_use_id: "tool-1", task_id: "task-1", status: "stopped" });
  assert.deepStrictEqual(notification, { yokeType: "task_notification", parentToolId: "tool-1", taskId: "task-1", status: "stopped", summary: "Stopped", usage: null });
  assert.deepStrictEqual(updated, { yokeType: "task_updated", task_id: "task-1", patch: { status: "running" } });
  assert.strictEqual(legacy.yokeType, "task_notification");
  assert.strictEqual(legacy.taskId, "task-1");
});

test("Claude worker transport reports closed and failed IPC writes", function() {
  var claudeModule = require("../lib/yoke/adapters/claude");
  var kit = claudeModule.contractTestKit;
  var writes = [];
  var worker = {
    connection: {
      destroyed: false,
      writableEnded: false,
      writable: true,
      write: function(data) { writes.push(data); return false; },
    },
  };

  assert.strictEqual(kit.sendWorkerMessage(worker, { type: "probe" }), true);
  assert.strictEqual(writes.length, 1);

  worker.connection.destroyed = true;
  assert.strictEqual(kit.sendWorkerMessage(worker, { type: "closed" }), false);

  worker.connection.destroyed = false;
  worker.connection.write = function() { throw new Error("closed during write"); };
  assert.strictEqual(kit.sendWorkerMessage(worker, { type: "failed" }), false);
});

test("Claude worker handles reject a message when IPC delivery fails", function() {
  var claudeModule = require("../lib/yoke/adapters/claude");
  var kit = claudeModule.contractTestKit;
  var handler;
  var worker = {
    process: { killed: false, exitCode: null },
    exitPromise: Promise.resolve(),
    send: function() { return false; },
    onMessage: function(fn) { handler = fn; },
  };
  var handle = kit.createWorkerQueryHandle(worker);

  assert.strictEqual(typeof handler, "function");
  assert.strictEqual(handle.pushMessage("must be retried"), false);
});

test("Claude only reuses workers with a live writable IPC connection", function() {
  var claudeModule = require("../lib/yoke/adapters/claude");
  var kit = claudeModule.contractTestKit;
  var worker = {
    ready: true,
    process: { killed: false, exitCode: null },
    connection: { destroyed: false, writableEnded: false, writable: true },
  };

  assert.strictEqual(kit.canReuseWorker(worker), true);
  worker.connection.writableEnded = true;
  assert.strictEqual(kit.canReuseWorker(worker), false);
});
