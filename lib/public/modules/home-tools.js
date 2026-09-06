// home-tools.js - Installed tool registration, rendering, and runtime glue.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { registerDockTool, unregisterDockTool, renderDock, pulseDockTool, markDockToolChanged, reconcileDockActiveTool } from './home-dock.js';
import { renderToolUi, disposeToolUi, getControlCatalog } from './tool-renderer.js';
import { createToolRuntime } from './tool-runtime.js';
import { showToast } from './utils.js';
import { createToolLlmStatus, initialToolLlmAlias } from './tool-llm-status.js';
import { isToolModelAlias, shouldInjectToolLlmStatus } from './tool-ui-tree.js';
import { mountCapsuleHostControls, disposeCapsuleHostControls, handleToolSourceState as applyToolSourceState, handleToolMateAccessState as applyToolMateAccessState } from './home-capsule-source.js';
import { mountRichDisplay, pushFrameState, pushFrameEvent, disposeFrame } from './home-tool-frame.js';
import { openHomeConversation } from './home-mate-chat.js';

var definitions = Object.create(null);
var runtimes = Object.create(null);
var registeredIds = Object.create(null);
var errorSurfaces = Object.create(null);
var displays = Object.create(null);
var llmStatuses = Object.create(null);
var serverStates = Object.create(null);
var serverEventSeqs = Object.create(null);

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
  disposeFrame(toolId);
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

// Server-runtime Capsules hold their Logic on the server, so the human's click
// travels the same act pipeline a Mate's clay_tool_act call travels. The
// browser only renders the state Logic hands back.
function sendServerControl(toolId, request) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    showRuntimeError(toolId, "The connection to the server is not available.");
    return;
  }
  ws.send(JSON.stringify({
    type: "tool_server_control",
    toolId: toolId,
    kind: request.kind,
    actionId: request.actionId || null,
    args: request.args || {},
  }));
}

function renderServerState(toolId, state) {
  var definition = definitions[toolId];
  var display = displays[toolId];
  if (!definition || !display) return;
  renderToolUi(toolId, definition.uiTree, state || {}, function (actionName, args) {
    sendServerControl(toolId, { kind: "act", actionId: actionName, args: args });
  }, display);
}

// Applies a server-runtime Capsule state if it is not older than what is
// already rendered. States carry the Logic's monotonic eventSeq, so a slow
// snapshot response can never roll the Display back behind a pushed event.
function applyServerState(toolId, state) {
  state = state || {};
  // A successful read or event clears any stale refusal either way.
  var surface = errorSurfaces[toolId];
  if (surface) surface.classList.add("hidden");
  var seq = Number.isInteger(state.eventSeq) ? state.eventSeq : null;
  var lastSeq = serverEventSeqs[toolId];
  if (seq !== null && lastSeq !== undefined && seq <= lastSeq) return false;
  if (seq !== null) serverEventSeqs[toolId] = seq;
  serverStates[toolId] = state;
  renderServerState(toolId, state);
  return true;
}

// Brief host-side attribution when the other seat acts: the Display flashes
// and the dock icon pulses, so a watching human can tell the change was the
// Mate operating the same interface. The meaning itself stays in state; this
// is only the host pointing at it.
function flashRemoteAct(toolId) {
  pulseDockTool(toolId);
  var display = displays[toolId];
  if (!display) return;
  display.classList.remove("capsule-remote-act");
  void display.offsetWidth;
  display.classList.add("capsule-remote-act");
  setTimeout(function () { display.classList.remove("capsule-remote-act"); }, 900);
}

// A Capsule game session push. An explicit game start ("start") navigates the
// home board into the Mate's game session so starting a game visibly opens
// the table; ordinary turn engagements never yank the user away from the board.
export function handleCapsuleGameSession(msg) {
  if (!msg || msg.kind !== "start" || !msg.mateId || !msg.sessionId) return;
  openHomeConversation(msg.mateId, msg.sessionId);
}

export function handleToolServerState(msg) {
  if (!msg || !msg.toolId) return;
  if (msg.ok === false) {
    showRuntimeError(msg.toolId, msg.error || "The Capsule action failed.");
    return;
  }
  if (applyServerState(msg.toolId, msg.state)) pushFrameState(msg.toolId, msg.state || {});
}

// The push half of the shared-interface effect: Logic changed, no matter whose
// act changed it, so every open Display for this user re-renders. Events are
// applied one by one in seq order, so consecutive acts replay as steps rather
// than collapsing into a final state. The rich frame receives the full causal
// event so it can animate and attribute the transition.
export function handleToolServerEvent(msg) {
  if (!msg || !msg.toolId || !msg.event || !msg.event.next) return;
  if (!applyServerState(msg.toolId, msg.event.next)) return;
  pushFrameEvent(msg.toolId, msg.event);
  if (msg.event.actor && msg.event.actor !== "user") flashRemoteAct(msg.toolId);
}

// Mounts the additive rich element above the floor. The floor is rendered
// first and stays a click away behind the toggle, and any frame failure
// (no URL, load error, never ready) falls back to the floor silently: the
// rich element may enrich the Capsule, never gate it.
function mountServerFrame(toolId, root, floorEl) {
  var frameWrap = document.createElement("div");
  frameWrap.className = "home-tool-frame-wrap hidden";
  frameWrap.dataset.capsuleRuntimeSurface = "true";
  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "home-tool-frame-toggle hidden";
  toggle.dataset.capsuleRuntimeSurface = "true";
  var showingFrame = false;
  function setView(rich) {
    showingFrame = rich;
    frameWrap.classList.toggle("hidden", !rich);
    floorEl.classList.toggle("hidden", rich);
    toggle.textContent = rich ? "Standard controls" : "Rich view";
  }
  toggle.addEventListener("click", function () { setView(!showingFrame); });
  root.appendChild(frameWrap);
  root.appendChild(toggle);
  mountRichDisplay({
    toolId: toolId,
    container: frameWrap,
    onAct: function (actionId, args) {
      sendServerControl(toolId, { kind: "act", actionId: actionId, args: args });
    },
    onReady: function () {
      toggle.classList.remove("hidden");
      setView(true);
    },
    onUnavailable: function () {
      toggle.classList.add("hidden");
      setView(false);
    },
  });
  pushFrameState(toolId, serverStates[toolId] || {});
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
    if (definition.hasRichDisplay) mountServerFrame(toolId, root, serverDisplay);
    root.appendChild(serverDisplay);
    displays[toolId] = serverDisplay;
    renderServerState(toolId, serverStates[toolId] || {});
    sendServerControl(toolId, { kind: "snapshot" });
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
  delete serverStates[msg.toolId];
  delete serverEventSeqs[msg.toolId];
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
