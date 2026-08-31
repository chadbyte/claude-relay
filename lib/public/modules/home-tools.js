// home-tools.js - Installed tool registration, rendering, and runtime glue.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { registerDockTool, unregisterDockTool, renderDock, pulseDockTool, markDockToolChanged, reconcileDockActiveTool } from './home-dock.js';
import { renderToolUi, disposeToolUi, getControlCatalog } from './tool-renderer.js';
import { createToolRuntime } from './tool-runtime.js';
import { showToast } from './utils.js';
import { requestBoard } from './home-board.js';
import { createToolLlmStatus, initialToolLlmAlias } from './tool-llm-status.js';
import { isToolModelAlias, shouldInjectToolLlmStatus } from './tool-ui-tree.js';
import { mountCapsuleHostControls, disposeCapsuleHostControls, handleToolSourceState as applyToolSourceState, handleToolMateAccessState as applyToolMateAccessState } from './home-capsule-source.js';

var definitions = Object.create(null);
var runtimes = Object.create(null);
var registeredIds = Object.create(null);
var errorSurfaces = Object.create(null);
var displays = Object.create(null);
var llmStatuses = Object.create(null);

export function requestTools() {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    store.set({ homeToolRegistryLoaded: false });
    ws.send(JSON.stringify({ type: "tools_list" }));
  }
}

function stopRuntime(toolId) {
  if (runtimes[toolId]) runtimes[toolId].stop();
  if (llmStatuses[toolId]) llmStatuses[toolId].dispose();
  if (displays[toolId]) disposeToolUi(displays[toolId]);
  delete runtimes[toolId];
  delete errorSurfaces[toolId];
  delete displays[toolId];
  delete llmStatuses[toolId];
  disposeCapsuleHostControls(toolId);
}

function showRuntimeError(toolId, message) {
  var surface = errorSurfaces[toolId];
  if (!surface) return;
  surface.textContent = message;
  surface.classList.remove("hidden");
}

function renderRuntimeState(toolId, state) {
  var definition = definitions[toolId];
  var display = displays[toolId];
  if (!definition || !display || !runtimes[toolId]) return;
  renderToolUi(toolId, definition.uiTree, state, function (actionName, args) {
    runtimes[toolId].action(actionName, args, "user").catch(function () {});
  }, display);
}

function ensureRuntime(toolId) {
  if (runtimes[toolId]) return runtimes[toolId];
  var definition = definitions[toolId];
  if (!definition) throw new Error("Tool is not installed on this home screen.");
  if (definition.manifest.runtime === "server") throw new Error("Server-runtime capsules do not run in a browser worker.");
  displays[toolId] = document.createElement("div");
  displays[toolId].className = "home-tool-display";
  var runtime = createToolRuntime({
    toolId: toolId,
    logicSource: definition.logicSource,
    initialAction: definition.manifest.initialAction || null,
    allowLlm: (definition.manifest.permissions || []).indexOf("llm") !== -1,
    onLlmRequest: function (alias) {
      if (llmStatuses[toolId]) llmStatuses[toolId].setAlias(alias);
    },
    onState: function (state) {
      var error = errorSurfaces[toolId];
      if (error) error.classList.add("hidden");
      renderRuntimeState(toolId, state);
    },
    onError: function (message) { showRuntimeError(toolId, message); },
  });
  runtimes[toolId] = runtime;
  runtime.start();
  return runtime;
}

function mountTool(toolId, contentEl, chromeEl) {
  var definition = definitions[toolId];
  if (!definition) return;
  var root = document.createElement("div");
  root.className = "home-tool-root";
  mountCapsuleHostControls(toolId, definition, chromeEl, root);
  var permissions = definition.manifest.permissions || [];
  if (permissions.indexOf("llm") !== -1 && shouldInjectToolLlmStatus(definition)) {
    if (llmStatuses[toolId]) llmStatuses[toolId].dispose();
    llmStatuses[toolId] = createToolLlmStatus(initialToolLlmAlias(definition.manifest));
    llmStatuses[toolId].element.dataset.capsuleRuntimeSurface = "true";
    root.appendChild(llmStatuses[toolId].element);
  }
  var error = document.createElement("div");
  error.className = "home-tool-error hidden";
  error.dataset.capsuleRuntimeSurface = "true";
  root.appendChild(error);
  contentEl.appendChild(root);
  errorSurfaces[toolId] = error;
  if (definition.manifest.runtime === "server") {
    var serverDisplay = document.createElement("div");
    serverDisplay.className = "home-tool-display";
    serverDisplay.dataset.capsuleRuntimeSurface = "true";
    root.appendChild(serverDisplay);
    renderToolUi(toolId, definition.uiTree, {}, function () {}, serverDisplay);
    return;
  }
  var runtime = ensureRuntime(toolId);
  displays[toolId].dataset.capsuleRuntimeSurface = "true";
  root.appendChild(displays[toolId]);
  if (runtime.getState() !== null) renderRuntimeState(toolId, runtime.getState());
}

function registerDefinition(definition) {
  if (!definition || !definition.manifest || !definition.manifest.id) return;
  var toolId = definition.manifest.id;
  definitions[toolId] = definition;
  registeredIds[toolId] = true;
  var dockTool = {
    id: toolId,
    name: definition.manifest.name,
    lucideIcon: definition.manifest.lucideIcon || "box",
    render: function (contentEl, chromeEl) { mountTool(toolId, contentEl, chromeEl); },
    onChromeHide: function () { disposeCapsuleHostControls(toolId); },
    onHide: function () { stopRuntime(toolId); },
  };
  if (definition.manifest.runtime === "server" && definition.uiTree.type === "board") {
    dockTool.onShow = function () { requestBoard(); };
  }
  registerDockTool(dockTool);
}

function syncStore() {
  var tools = [];
  var ids = Object.keys(definitions);
  for (var i = 0; i < ids.length; i++) tools.push(definitions[ids[i]]);
  store.set({ installedTools: tools });
}

export function handleToolsState(msg) {
  var completeSync = !msg.requestedToolId;
  var incoming = msg.tools || [];
  var validIncoming = [];
  var scanErrors = [];
  for (var ei = 0; ei < incoming.length; ei++) {
    if (incoming[ei] && incoming[ei].error) scanErrors.push(incoming[ei]);
    else if (incoming[ei] && incoming[ei].manifest) validIncoming.push(incoming[ei]);
  }
  incoming = validIncoming;
  store.set({ toolScanErrors: scanErrors });
  if (scanErrors.length > 0) showToast("One or more capsule folders could not be loaded.", "error");
  if (completeSync) {
    var previousIds = Object.keys(registeredIds);
    var incomingIds = Object.create(null);
    for (var ii = 0; ii < incoming.length; ii++) incomingIds[incoming[ii].manifest.id] = true;
    for (var pi = 0; pi < previousIds.length; pi++) {
      if (incomingIds[previousIds[pi]]) continue;
      stopRuntime(previousIds[pi]);
      delete definitions[previousIds[pi]];
      delete registeredIds[previousIds[pi]];
      unregisterDockTool(previousIds[pi]);
    }
  }
  for (var i = 0; i < incoming.length; i++) registerDefinition(incoming[i]);
  syncStore();
  if (completeSync) store.set({ homeToolRegistryLoaded: true });
  if (completeSync && reconcileDockActiveTool()) return;
  renderDock();
}

export function handleToolInstalled(msg) {
  if (msg.tool && msg.tool.manifest && definitions[msg.tool.manifest.id]) stopRuntime(msg.tool.manifest.id);
  registerDefinition(msg.tool);
  syncStore();
  renderDock();
  markDockToolChanged(msg.tool && msg.tool.manifest ? msg.tool.manifest.id : null);
}

export function handleToolSourceState(msg) {
  applyToolSourceState(msg);
}

export function handleToolMateAccessState(msg) {
  if (msg.ok && msg.metadata && definitions[msg.toolId]) {
    definitions[msg.toolId].metadata = msg.metadata;
    syncStore();
  }
  applyToolMateAccessState(msg);
}

export function handleToolRemoved(msg) {
  stopRuntime(msg.toolId);
  delete definitions[msg.toolId];
  delete registeredIds[msg.toolId];
  unregisterDockTool(msg.toolId);
  syncStore();
  renderDock();
}

export function handleToolStorageResult(msg) {
  if (runtimes[msg.toolId]) runtimes[msg.toolId].handleStorageResult(msg);
}

export function handleToolLlmResult(msg) {
  if (runtimes[msg.toolId]) runtimes[msg.toolId].handleLlmResult(msg);
}

export function handleToolsError(msg) {
  if (msg.toolId && msg.requestId && runtimes[msg.toolId]) {
    runtimes[msg.toolId].handleLlmResult({ requestId: msg.requestId, error: msg.message });
    return;
  }
  if (msg.toolId && msg.seq !== undefined && runtimes[msg.toolId]) {
    runtimes[msg.toolId].handleStorageResult({ seq: msg.seq, error: msg.message });
    return;
  }
  if (msg.toolId) showRuntimeError(msg.toolId, msg.message || "Tool operation failed.");
  else showToast(msg.message || "Tool operation failed.", "error");
}

export function getToolRuntimeState(toolId) {
  return runtimes[toolId] ? runtimes[toolId].getState() : null;
}

function replyControl(requestId, data, error) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    type: "tool_control_response",
    requestId: requestId,
    data: data || null,
    error: error || null,
  }));
}

export function handleToolControlRequest(msg) {
  Promise.resolve().then(async function () {
    var definition = definitions[msg.toolId];
    if (!definition) throw new Error("Tool is not installed on this home screen.");
    var runtime = ensureRuntime(msg.toolId);
    await runtime.ready();
    var payload = msg.payload || {};
    var state;
    if (msg.kind === "snapshot") {
      state = runtime.getState();
    } else if (msg.kind === "act") {
      state = await runtime.action(payload.actionId, payload.args || {}, msg.callerId);
      pulseDockTool(msg.toolId);
    } else if (msg.kind === "set") {
      var control = getControlCatalog(msg.toolId)[payload.controlId];
      if (!control) throw new Error("Unknown control '" + payload.controlId + "'.");
      if (!control.action) throw new Error("Control '" + payload.controlId + "' does not expose an action.");
      if (control.type === "model-select" && !isToolModelAlias(payload.value)) {
        throw new Error("Model controls accept only fast, standard, or deep.");
      }
      state = await runtime.action(control.action, {
        value: payload.value,
        controlId: payload.controlId,
        bind: control.bind,
      }, msg.callerId);
      pulseDockTool(msg.toolId);
    } else {
      throw new Error("Unknown tool control request kind '" + msg.kind + "'.");
    }
    replyControl(msg.requestId, {
      state: state,
      controls: getControlCatalog(msg.toolId),
      ui: definition.uiTree,
    }, null);
  }).catch(function (error) {
    replyControl(msg.requestId, null, error && error.message ? error.message : "Tool control failed.");
  });
}
