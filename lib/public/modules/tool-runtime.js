// tool-runtime.js - Web Worker host for user-installed tool logic.

import { getWs } from './ws-ref.js';

var ACTION_TIMEOUT_MS = 10000;

function workerProgram(logicSource) {
  return [
    "self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.EventSource = undefined; self.importScripts = undefined;",
    "var tool; var currentState = {}; var storageSeq = 0; var storagePending = Object.create(null); var actionQueue = Promise.resolve();",
    "function storageCall(op, args) {",
    "  return new Promise(function (resolve, reject) {",
    "    storageSeq++; storagePending[storageSeq] = { resolve: resolve, reject: reject };",
    "    self.postMessage({ type: 'storage', op: op, args: args || {}, seq: storageSeq });",
    "  });",
    "}",
    "var api = { storage: {",
    "  list: function () { return storageCall('list', {}); },",
    "  get: function (id) { return storageCall('get', { id: id }); },",
    "  put: function (doc) { return storageCall('put', { doc: doc }); },",
    "  delete: function (id) { return storageCall('delete', { id: id }); },",
    "  query: function (query) { return storageCall('query', { query: query }); }",
    "} };",
    logicSource,
    "if (!tool || !tool.actions || typeof tool.actions !== 'object') throw new Error('logic.js must define var tool with an actions object.');",
    "self.onmessage = function (event) {",
    "  var msg = event.data || {};",
    "  if (msg.type === 'init') {",
    "    currentState = msg.state || tool.initialState || {};",
    "    self.postMessage({ type: 'state', newState: currentState }); return;",
    "  }",
    "  if (msg.type === 'storage_result') {",
    "    var pending = storagePending[msg.seq]; if (!pending) return; delete storagePending[msg.seq];",
    "    if (msg.error) pending.reject(new Error(msg.error)); else pending.resolve(msg.data); return;",
    "  }",
    "  if (msg.type === 'action') {",
    "    var action = tool.actions[msg.name];",
    "    if (typeof action !== 'function') { self.postMessage({ type: 'error', message: 'Unknown action: ' + msg.name }); return; }",
    "    actionQueue = actionQueue.then(function () {",
    "      var actionApi = Object.create(api); actionApi.callerId = msg.callerId || 'user';",
    "      return action(currentState, msg.args || {}, actionApi);",
    "    }).then(function (nextState) {",
    "      if (nextState !== undefined) currentState = nextState;",
    "      self.postMessage({ type: 'state', newState: currentState, actionSeq: msg.actionSeq });",
    "    }).catch(function (error) { self.postMessage({ type: 'error', message: error && error.message ? error.message : String(error), actionSeq: msg.actionSeq }); });",
    "  }",
    "};",
  ].join("\n");
}

export function createToolRuntime(config) {
  var worker = null;
  var state = config.state || null;
  var actionSeq = 0;
  var actionTimeouts = Object.create(null);
  var stopped = false;
  var restartCount = 0;
  var initialActionSent = false;
  var workerGeneration = 0;
  var pendingStorage = Object.create(null);

  function clearActionTimeout() {
    var keys = Object.keys(actionTimeouts);
    for (var i = 0; i < keys.length; i++) clearTimeout(actionTimeouts[keys[i]]);
    actionTimeouts = Object.create(null);
  }

  function clearOneActionTimeout(seq) {
    if (seq === undefined || !actionTimeouts[seq]) return;
    clearTimeout(actionTimeouts[seq]);
    delete actionTimeouts[seq];
  }

  function reportError(message) {
    if (typeof config.onError === "function") config.onError(message);
  }

  function terminateWorker() {
    clearActionTimeout();
    if (worker) worker.terminate();
    worker = null;
    pendingStorage = Object.create(null);
  }

  function restartWorker(message) {
    terminateWorker();
    reportError(message);
    if (stopped) return;
    restartCount++;
    if (restartCount > 3) {
      reportError("Tool worker stopped after repeated failures.");
      return;
    }
    initialActionSent = false;
    setTimeout(function () { if (!stopped) spawnWorker(); }, 100);
  }

  function sendStorageOperation(msg) {
    var ws = getWs();
    if (!ws || ws.readyState !== 1) {
      worker.postMessage({ type: "storage_result", seq: msg.seq, error: "Tool storage is unavailable." });
      return;
    }
    var externalSeq = config.toolId + ":" + workerGeneration + ":" + msg.seq;
    pendingStorage[externalSeq] = msg.seq;
    ws.send(JSON.stringify({ type: "tool_storage_op", toolId: config.toolId, op: msg.op, args: msg.args, seq: externalSeq }));
  }

  function handleWorkerMessage(event) {
    var msg = event.data || {};
    if (msg.type === "state") {
      clearOneActionTimeout(msg.actionSeq);
      if (msg.actionSeq !== undefined) restartCount = 0;
      state = msg.newState || {};
      if (typeof config.onState === "function") config.onState(state);
      if (!initialActionSent && config.initialAction) {
        initialActionSent = true;
        dispatchAction(config.initialAction, {}, "user");
      }
    } else if (msg.type === "storage") {
      sendStorageOperation(msg);
    } else if (msg.type === "error") {
      clearOneActionTimeout(msg.actionSeq);
      restartWorker(msg.message || "Tool worker failed.");
    }
  }

  function spawnWorker() {
    terminateWorker();
    workerGeneration++;
    var blob = new Blob([workerProgram(config.logicSource)], { type: "text/javascript" });
    var url = URL.createObjectURL(blob);
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = handleWorkerMessage;
    worker.onerror = function (event) {
      if (event.preventDefault) event.preventDefault();
      restartWorker(event.message || "Tool worker crashed.");
    };
    worker.postMessage({ type: "init", state: state });
  }

  function dispatchAction(name, args, callerId) {
    if (!worker || stopped) return;
    actionSeq++;
    var currentActionSeq = actionSeq;
    actionTimeouts[currentActionSeq] = setTimeout(function () {
      restartWorker("Action '" + name + "' timed out after 10 seconds.");
    }, ACTION_TIMEOUT_MS);
    worker.postMessage({ type: "action", name: name, args: args || {}, callerId: callerId || "user", actionSeq: currentActionSeq });
  }

  function handleStorageResult(msg) {
    if (!worker) return;
    var localSeq = pendingStorage[msg.seq];
    if (localSeq === undefined) return;
    delete pendingStorage[msg.seq];
    worker.postMessage({ type: "storage_result", seq: localSeq, data: msg.data, error: msg.error });
  }

  function start() {
    stopped = false;
    spawnWorker();
  }

  function stop() {
    stopped = true;
    terminateWorker();
  }

  return { start: start, action: dispatchAction, handleStorageResult: handleStorageResult, stop: stop, getState: function () { return state; } };
}
