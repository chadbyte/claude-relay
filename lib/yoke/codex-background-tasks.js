function terminalList(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result.terminals)) return result.terminals;
  if (Array.isArray(result.backgroundTerminals)) return result.backgroundTerminals;
  if (Array.isArray(result.items)) return result.items;
  return [];
}

function isLiveTerminal(terminal) {
  var status = String((terminal && (terminal.status || terminal.state)) || "").toLowerCase();
  return status !== "exited" && status !== "terminated" && status !== "completed" && status !== "failed";
}

function mapTerminals(result) {
  var terminals = terminalList(result);
  var tasks = [];
  for (var i = 0; i < terminals.length; i++) {
    var terminal = terminals[i] || {};
    var taskId = terminal.id || terminal.terminalId || terminal.taskId || "";
    if (!taskId || !isLiveTerminal(terminal)) continue;
    tasks.push({
      task_id: String(taskId),
      task_type: "shell",
      description: terminal.commandLine || terminal.command || terminal.name || "",
    });
  }
  return tasks;
}

function taskIds(tasks) {
  var ids = {};
  for (var i = 0; i < tasks.length; i++) ids[tasks[i].task_id] = true;
  return ids;
}

function sameMembership(first, second) {
  var firstKeys = Object.keys(first || {});
  var secondKeys = Object.keys(second || {});
  if (firstKeys.length !== secondKeys.length) return false;
  for (var i = 0; i < firstKeys.length; i++) {
    if (!second[firstKeys[i]]) return false;
  }
  return true;
}

function createState() {
  return { taskIds: null };
}

function emitIfChanged(state, tasks, pushEvent) {
  var ids = taskIds(tasks);
  if (state.taskIds === null && tasks.length === 0) {
    state.taskIds = ids;
    return false;
  }
  if (state.taskIds && sameMembership(state.taskIds, ids)) return false;
  state.taskIds = ids;
  pushEvent({ yokeType: "background_tasks_changed", tasks: tasks });
  return true;
}

function poll(appServer, threadId, state, pushEvent) {
  if (!appServer || !threadId || appServer._clayBackgroundTasksPollingDisabled) return Promise.resolve(false);
  return appServer.send("thread/backgroundTerminals/list", { threadId: threadId }).then(function(result) {
    return emitIfChanged(state, mapTerminals(result), pushEvent);
  }).catch(function() {
    appServer._clayBackgroundTasksPollingDisabled = true;
    return false;
  });
}

function emitReset(state, pushEvent) {
  state.taskIds = {};
  pushEvent({ yokeType: "background_tasks_changed", tasks: [] });
}

module.exports = {
  createState: createState,
  mapTerminals: mapTerminals,
  emitIfChanged: emitIfChanged,
  poll: poll,
  emitReset: emitReset,
};
