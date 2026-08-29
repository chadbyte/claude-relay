var test = require("node:test");
var assert = require("node:assert");
var backgroundTasks = require("../lib/yoke/codex-background-tasks");

test("Codex maps live background terminals to shell tasks", function() {
  var tasks = backgroundTasks.mapTerminals({ terminals: [
    { id: "term-1", command: "npm test" },
    { terminalId: "term-2", name: "Build watch" },
    { id: "term-3", status: "exited", command: "old" },
    { id: "term-4" },
  ] });
  assert.deepStrictEqual(tasks, [
    { task_id: "term-1", task_type: "shell", description: "npm test" },
    { task_id: "term-2", task_type: "shell", description: "Build watch" },
    { task_id: "term-4", task_type: "shell", description: "" },
  ]);
});

test("Codex emits only when background terminal membership changes", function() {
  var state = backgroundTasks.createState();
  var events = [];
  var task = [{ task_id: "term-1", task_type: "shell", description: "npm test" }];
  assert.strictEqual(backgroundTasks.emitIfChanged(state, task, function(event) { events.push(event); }), true);
  assert.strictEqual(backgroundTasks.emitIfChanged(state, task, function(event) { events.push(event); }), false);
  assert.strictEqual(events.length, 1);
});

test("Codex emits an empty set when a background terminal set clears", function() {
  var state = backgroundTasks.createState();
  var events = [];
  backgroundTasks.emitIfChanged(state, [{ task_id: "term-1", task_type: "shell", description: "npm test" }], function(event) { events.push(event); });
  backgroundTasks.emitIfChanged(state, [], function(event) { events.push(event); });
  assert.deepStrictEqual(events[1], { yokeType: "background_tasks_changed", tasks: [] });
});

test("Codex app-server restart emits an empty background-task set", function() {
  var state = backgroundTasks.createState();
  var events = [];
  backgroundTasks.emitReset(state, function(event) { events.push(event); });
  assert.deepStrictEqual(events, [{ yokeType: "background_tasks_changed", tasks: [] }]);
});

test("Codex permanently disables background terminal polling after a list failure", async function() {
  var calls = 0;
  var server = {
    send: function() {
      calls++;
      return Promise.reject(new Error("method not found"));
    },
  };
  var state = backgroundTasks.createState();
  var events = [];
  await backgroundTasks.poll(server, "thread-1", state, function(event) { events.push(event); });
  await backgroundTasks.poll(server, "thread-1", state, function(event) { events.push(event); });
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(events, []);
});
