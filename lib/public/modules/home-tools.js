// home-tools.js - Installed tool registration, rendering, and runtime glue.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { registerDockTool, unregisterDockTool, renderDock } from './home-dock.js';
import { renderToolUi } from './tool-renderer.js';
import { createToolRuntime } from './tool-runtime.js';
import { showToast } from './utils.js';

var definitions = Object.create(null);
var runtimes = Object.create(null);
var registeredIds = Object.create(null);
var errorSurfaces = Object.create(null);

export function requestTools() {
  var ws = getWs();
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "tools_list" }));
}

function stopRuntime(toolId) {
  if (runtimes[toolId]) runtimes[toolId].stop();
  delete runtimes[toolId];
  delete errorSurfaces[toolId];
}

function showRuntimeError(toolId, message) {
  var surface = errorSurfaces[toolId];
  if (!surface) return;
  surface.textContent = message;
  surface.classList.remove("hidden");
}

function mountTool(toolId, contentEl) {
  stopRuntime(toolId);
  var definition = definitions[toolId];
  if (!definition) return;
  var root = document.createElement("div");
  root.className = "home-tool-root";
  var error = document.createElement("div");
  error.className = "home-tool-error hidden";
  var display = document.createElement("div");
  display.className = "home-tool-display";
  root.appendChild(error);
  root.appendChild(display);
  contentEl.appendChild(root);
  errorSurfaces[toolId] = error;

  var runtime = createToolRuntime({
    toolId: toolId,
    logicSource: definition.logicSource,
    initialAction: definition.manifest.initialAction || null,
    onState: function (state) {
      error.classList.add("hidden");
      renderToolUi(toolId, definition.uiTree, state, function (actionName, args) {
        runtime.action(actionName, args, "user");
      }, display);
    },
    onError: function (message) { showRuntimeError(toolId, message); },
  });
  runtimes[toolId] = runtime;
  runtime.start();
}

function registerDefinition(definition) {
  if (!definition || !definition.manifest || !definition.manifest.id) return;
  var toolId = definition.manifest.id;
  definitions[toolId] = definition;
  registeredIds[toolId] = true;
  registerDockTool({
    id: toolId,
    name: definition.manifest.name,
    lucideIcon: definition.manifest.lucideIcon || "box",
    render: function (contentEl) { mountTool(toolId, contentEl); },
    onHide: function () { stopRuntime(toolId); },
  });
}

function syncStore() {
  var tools = [];
  var ids = Object.keys(definitions);
  for (var i = 0; i < ids.length; i++) tools.push(definitions[ids[i]]);
  store.set({ installedTools: tools });
}

export function handleToolsState(msg) {
  var incoming = msg.tools || [];
  if (!msg.requestedToolId) {
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
  renderDock();
}

export function handleToolInstalled(msg) {
  registerDefinition(msg.tool);
  syncStore();
  renderDock();
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

export function handleToolsError(msg) {
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
