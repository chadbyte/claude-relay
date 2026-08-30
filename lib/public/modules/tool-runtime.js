// tool-runtime.js - Web Worker host for user-installed tool logic.

import { getWs } from './ws-ref.js';

var ACTION_TIMEOUT_MS = 10000;
var LLM_ACTION_TIMEOUT_MS = 90000;
var LLM_TIMEOUT_MS = 60000;
var WS_WAIT_MS = 5000;
var WS_RETRY_MS = 250;

function workerProgram(logicSource, allowLlm) {
  return [
    "self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.EventSource = undefined; self.importScripts = undefined;",
    "var tool; var currentState = {}; var storageSeq = 0; var storagePending = Object.create(null); var llmSeq = 0; var llmPending = Object.create(null); var actionQueue = Promise.resolve();",
    "function storageCall(op, args) {",
    "  return new Promise(function (resolve, reject) {",
    "    storageSeq++; storagePending[storageSeq] = { resolve: resolve, reject: reject };",
    "    self.postMessage({ type: 'storage', op: op, args: args || {}, seq: storageSeq });",
    "  });",
    "}",
    "function llmCall(args, callerId) {",
    allowLlm ? "  return new Promise(function (resolve, reject) { llmSeq++; llmPending[llmSeq] = { resolve: resolve, reject: reject }; self.postMessage({ type: 'llm', seq: llmSeq, args: args || {}, callerId: callerId || 'user' }); });" : "  return Promise.reject(new Error('This capsule does not have the llm permission.'));",
    "}",
    "var api = { storage: {",
    "  list: function () { return storageCall('list', {}); },",
    "  get: function (id) { return storageCall('get', { id: id }); },",
    "  put: function (doc) { return storageCall('put', { doc: doc }); },",
    "  delete: function (id) { return storageCall('delete', { id: id }); },",
    "  query: function (query) { return storageCall('query', { query: query }); }",
    "}, llm: { complete: function () { return Promise.reject(new Error('api.llm.complete is only available inside an action.')); } } };",
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
    "  if (msg.type === 'llm_result') {",
    "    var llmRequest = llmPending[msg.seq]; if (!llmRequest) return; delete llmPending[msg.seq];",
    "    if (msg.error) llmRequest.reject(new Error(msg.error)); else llmRequest.resolve(msg.data); return;",
    "  }",
    "  if (msg.type === 'action') {",
    "    var action = tool.actions[msg.name];",
    "    if (typeof action !== 'function') { self.postMessage({ type: 'error', message: 'Unknown action: ' + msg.name, actionSeq: msg.actionSeq }); return; }",
    "    var actionStartState;",
    "    actionQueue = actionQueue.then(function () {",
    "      actionStartState = currentState;",
    "      var actionApi = Object.create(api); actionApi.callerId = msg.callerId || 'user'; actionApi.llm = { complete: function (args) { return llmCall(args, actionApi.callerId); } };",
    "      actionApi.setState = function (nextState) { if (!nextState || typeof nextState !== 'object' || Array.isArray(nextState)) throw new Error('api.setState requires a state object.'); currentState = nextState; self.postMessage({ type: 'state', newState: currentState, actionSeq: msg.actionSeq, intermediate: true }); };",
    "      return action(currentState, msg.args || {}, actionApi);",
    "    }).then(function (nextState) {",
    "      if (nextState !== undefined) currentState = nextState;",
    "      self.postMessage({ type: 'state', newState: currentState, actionSeq: msg.actionSeq });",
    "    }).catch(function (error) { if (actionStartState !== undefined) { currentState = actionStartState; self.postMessage({ type: 'state', newState: currentState, actionSeq: msg.actionSeq, intermediate: true, rollback: true }); } self.postMessage({ type: 'error', message: error && error.message ? error.message : String(error), actionSeq: msg.actionSeq }); });",
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
  var pendingLlm = Object.create(null);
  var pendingActions = Object.create(null);
  var readyWaiters = [];
  var isReady = false;

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

  function rejectActions(message) {
    var keys = Object.keys(pendingActions);
    for (var i = 0; i < keys.length; i++) pendingActions[keys[i]].reject(new Error(message));
    pendingActions = Object.create(null);
  }

  function reportError(message) {
    if (typeof config.onError === "function") config.onError(message);
  }

  function markReady() {
    isReady = true;
    if (readyWaiters.length === 0) return;
    var waiters = readyWaiters;
    readyWaiters = [];
    for (var i = 0; i < waiters.length; i++) waiters[i].resolve(state);
  }

  function terminateWorker() {
    clearActionTimeout();
    if (worker) worker.terminate();
    worker = null;
    pendingStorage = Object.create(null);
    var llmKeys = Object.keys(pendingLlm);
    for (var li = 0; li < llmKeys.length; li++) clearTimeout(pendingLlm[llmKeys[li]].timer);
    pendingLlm = Object.create(null);
  }

  function restartWorker(message) {
    rejectActions(message);
    terminateWorker();
    reportError(message);
    if (stopped) return;
    restartCount++;
    if (restartCount > 3) {
      reportError("Tool worker stopped after repeated failures.");
      var waiters = readyWaiters;
      readyWaiters = [];
      for (var i = 0; i < waiters.length; i++) waiters[i].reject(new Error(message));
      return;
    }
    initialActionSent = false;
    isReady = false;
    setTimeout(function () { if (!stopped) spawnWorker(); }, 100);
  }

  function withReadySocket(startedAt, generation, onReady, onTimeout) {
    if (stopped || generation !== workerGeneration || !worker) return;
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      try {
        onReady(ws);
        return;
      } catch (error) {}
    }
    var waitMs = config.wsWaitMs === undefined ? WS_WAIT_MS : config.wsWaitMs;
    if (Date.now() - startedAt >= waitMs) {
      onTimeout();
      return;
    }
    var retryMs = config.wsRetryMs === undefined ? WS_RETRY_MS : config.wsRetryMs;
    setTimeout(function () { withReadySocket(startedAt, generation, onReady, onTimeout); }, retryMs);
  }

  function sendStorageOperation(msg) {
    var generation = workerGeneration;
    withReadySocket(Date.now(), generation, function (ws) {
      var externalSeq = config.toolId + ":" + generation + ":" + msg.seq;
      pendingStorage[externalSeq] = msg.seq;
      try {
        ws.send(JSON.stringify({ type: "tool_storage_op", toolId: config.toolId, op: msg.op, args: msg.args, seq: externalSeq }));
      } catch (error) {
        delete pendingStorage[externalSeq];
        throw error;
      }
    }, function () {
      if (worker && generation === workerGeneration) {
        worker.postMessage({ type: "storage_result", seq: msg.seq, error: "Tool storage is unavailable after waiting 5 seconds for the connection." });
      }
    });
  }

  function sendLlmOperation(msg) {
    if (!config.allowLlm) {
      worker.postMessage({ type: "llm_result", seq: msg.seq, error: "This capsule does not have the llm permission." });
      return;
    }
    if (typeof config.onLlmRequest === "function") config.onLlmRequest(msg.args && msg.args.model ? msg.args.model : "fast");
    var generation = workerGeneration;
    withReadySocket(Date.now(), generation, function (ws) {
      var requestId = config.toolId + ":llm:" + generation + ":" + msg.seq;
      pendingLlm[requestId] = {
        seq: msg.seq,
        timer: setTimeout(function () {
          if (!pendingLlm[requestId] || !worker) return;
          delete pendingLlm[requestId];
          worker.postMessage({ type: "llm_result", seq: msg.seq, error: "LLM request timed out after 60 seconds." });
        }, LLM_TIMEOUT_MS),
      };
      try {
        ws.send(JSON.stringify({ type: "tool_llm_op", toolId: config.toolId, requestId: requestId, args: msg.args, callerId: msg.callerId || "user" }));
      } catch (error) {
        clearTimeout(pendingLlm[requestId].timer);
        delete pendingLlm[requestId];
        throw error;
      }
    }, function () {
      if (worker && generation === workerGeneration) {
        worker.postMessage({ type: "llm_result", seq: msg.seq, error: "Tool LLM service is unavailable after waiting 5 seconds for the connection." });
      }
    });
  }

  function handleWorkerMessage(event) {
    var msg = event.data || {};
    if (msg.type === "state") {
      restartCount = 0;
      state = msg.newState || {};
      if (typeof config.onState === "function") config.onState(state);
      if (msg.intermediate) return;
      clearOneActionTimeout(msg.actionSeq);
      if (msg.actionSeq !== undefined && pendingActions[msg.actionSeq]) {
        pendingActions[msg.actionSeq].resolve(state);
        delete pendingActions[msg.actionSeq];
      }
      var shouldInitialize = !initialActionSent && config.initialAction;
      if (shouldInitialize) {
        initialActionSent = true;
        dispatchAction(config.initialAction, {}, "user").catch(function () { markReady(); });
      } else {
        markReady();
      }
    } else if (msg.type === "storage") {
      sendStorageOperation(msg);
    } else if (msg.type === "llm") {
      sendLlmOperation(msg);
    } else if (msg.type === "error") {
      clearOneActionTimeout(msg.actionSeq);
      if (msg.actionSeq !== undefined) {
        if (pendingActions[msg.actionSeq]) {
          pendingActions[msg.actionSeq].reject(new Error(msg.message || "Tool action failed."));
          delete pendingActions[msg.actionSeq];
        }
        reportError(msg.message || "Tool action failed.");
        return;
      }
      restartWorker(msg.message || "Tool worker failed.");
    }
  }

  function spawnWorker() {
    terminateWorker();
    workerGeneration++;
    var blob = new Blob([workerProgram(config.logicSource, !!config.allowLlm)], { type: "text/javascript" });
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
    if (!worker || stopped) return Promise.reject(new Error("Tool worker is not running."));
    actionSeq++;
    var currentActionSeq = actionSeq;
    return new Promise(function (resolve, reject) {
      pendingActions[currentActionSeq] = { resolve: resolve, reject: reject };
      var timeoutMs = config.allowLlm ? LLM_ACTION_TIMEOUT_MS : ACTION_TIMEOUT_MS;
      actionTimeouts[currentActionSeq] = setTimeout(function () {
        restartWorker("Action '" + name + "' timed out after " + Math.round(timeoutMs / 1000) + " seconds.");
      }, timeoutMs);
      worker.postMessage({ type: "action", name: name, args: args || {}, callerId: callerId || "user", actionSeq: currentActionSeq });
    });
  }

  function handleStorageResult(msg) {
    if (!worker) return;
    var localSeq = pendingStorage[msg.seq];
    if (localSeq === undefined) return;
    delete pendingStorage[msg.seq];
    worker.postMessage({ type: "storage_result", seq: localSeq, data: msg.data, error: msg.error });
  }

  function handleLlmResult(msg) {
    if (!worker) return;
    var pending = pendingLlm[msg.requestId];
    if (!pending) return;
    clearTimeout(pending.timer);
    delete pendingLlm[msg.requestId];
    worker.postMessage({ type: "llm_result", seq: pending.seq, data: msg.data, error: msg.error });
  }

  function start() {
    stopped = false;
    isReady = false;
    spawnWorker();
  }

  function stop() {
    stopped = true;
    rejectActions("Tool worker stopped.");
    var waiters = readyWaiters;
    readyWaiters = [];
    for (var i = 0; i < waiters.length; i++) waiters[i].reject(new Error("Tool worker stopped."));
    terminateWorker();
  }

  function ready() {
    if (isReady) return Promise.resolve(state);
    return new Promise(function (resolve, reject) { readyWaiters.push({ resolve: resolve, reject: reject }); });
  }

  return { start: start, ready: ready, action: dispatchAction, handleStorageResult: handleStorageResult, handleLlmResult: handleLlmResult, stop: stop, getState: function () { return state; } };
}
