// Compact provider/model status for LLM-enabled Capsule surfaces.

import { getWs } from './ws-ref.js';

var surfaces = [];
var requestCounter = 0;
var activeRequests = Object.create(null);
var states = Object.create(null);

function safeAlias(alias) {
  return alias === "fast" || alias === "deep" ? alias : "standard";
}

function isAlias(alias) {
  return alias === "fast" || alias === "standard" || alias === "deep";
}

export function initialToolLlmAlias(manifest) {
  return manifest && isAlias(manifest.modelAlias) ? manifest.modelAlias : null;
}

export function toolLlmDisplayValue(modelState) {
  var ready = modelState && modelState.status === "ready" && modelState.vendorName && modelState.modelName;
  return ready ? modelState.vendorName + " · " + modelState.modelName : "No model configured";
}

export function bindToolLlmHelp(button, help) {
  button.addEventListener("click", function () {
    var expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", expanded ? "false" : "true");
    help.classList.toggle("hidden", expanded);
  });
}

function currentSurfaces() {
  surfaces = surfaces.filter(function (surface) { return !!surface.root; });
  return surfaces;
}

function renderSurface(surface) {
  if (!surface.alias) {
    surface.value.textContent = "Selected when Capsule runs";
    surface.value.title = "The concrete model is selected when this Capsule requests an LLM capability.";
    surface.error.classList.add("hidden");
    surface.retry.classList.add("hidden");
    return;
  }
  var state = states[surface.alias] || { status: "loading", vendorName: "", modelName: "", error: "" };
  var ready = state.status === "ready" && state.vendorName && state.modelName;
  surface.value.textContent = toolLlmDisplayValue(state);
  surface.value.title = ready ? "Capsule " + surface.alias + " model: " + state.vendorName + " · " + state.modelName : "No configured Capsule model";
  surface.error.textContent = state.error || "";
  surface.error.classList.toggle("hidden", !state.error);
  surface.retry.classList.toggle("hidden", ready);
  surface.retry.disabled = state.status === "loading";
  surface.retry.textContent = state.status === "loading" ? "Checking…" : "Retry";
}

function renderAlias(alias) {
  var current = currentSurfaces();
  for (var i = 0; i < current.length; i++) {
    if (current[i].alias === alias) renderSurface(current[i]);
  }
}

export function requestToolLlmConfiguration(alias) {
  alias = safeAlias(alias);
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    states[alias] = { status: "error", vendorName: "", modelName: "", error: "Connect to Clay to check the Capsule model." };
    renderAlias(alias);
    return;
  }
  requestCounter++;
  activeRequests[alias] = "tool-llm-config-" + requestCounter;
  states[alias] = { status: "loading", vendorName: "", modelName: "", error: "" };
  renderAlias(alias);
  ws.send(JSON.stringify({ type: "tool_llm_config_get", requestId: activeRequests[alias], alias: alias }));
}

export function handleToolLlmConfigState(msg) {
  var alias = safeAlias(msg.alias);
  if (msg.requestId && activeRequests[alias] && msg.requestId !== activeRequests[alias]) return;
  activeRequests[alias] = null;
  states[alias] = {
    status: msg.status === "ready" ? "ready" : "error",
    vendorName: msg.vendorName || msg.vendor || "",
    modelName: msg.modelName || msg.model || "",
    error: msg.error || "",
  };
  renderAlias(alias);
}

export function createToolLlmStatus(alias) {
  alias = isAlias(alias) ? alias : null;
  var root = document.createElement("section");
  root.className = "tool-llm-status";
  root.setAttribute("aria-label", "Capsule model status");
  var identity = document.createElement("div");
  identity.className = "tool-llm-identity";
  var label = document.createElement("span");
  label.className = "tool-llm-label";
  label.textContent = "Model";
  var value = document.createElement("span");
  value.className = "tool-llm-value";
  value.setAttribute("aria-live", "polite");
  identity.appendChild(label);
  identity.appendChild(value);
  var actions = document.createElement("div");
  actions.className = "tool-llm-actions";
  var retry = document.createElement("button");
  retry.type = "button";
  retry.className = "tool-llm-action hidden";
  retry.addEventListener("click", function () {
    if (surface.alias) requestToolLlmConfiguration(surface.alias);
  });
  var helpButton = document.createElement("button");
  helpButton.type = "button";
  helpButton.className = "tool-llm-action";
  helpButton.textContent = "Setup help";
  helpButton.setAttribute("aria-expanded", "false");
  var helpId = "tool-llm-help-" + (++requestCounter);
  helpButton.setAttribute("aria-controls", helpId);
  var help = document.createElement("p");
  help.id = helpId;
  help.className = "tool-llm-help hidden";
  help.textContent = "Capsules use model providers already installed and signed in on this Clay host. Sign in with the provider's CLI, then choose Retry. API-key BYOK setup is not available in Home yet.";
  bindToolLlmHelp(helpButton, help);
  var error = document.createElement("p");
  error.className = "tool-llm-error hidden";
  actions.appendChild(retry);
  actions.appendChild(helpButton);
  root.appendChild(identity);
  root.appendChild(actions);
  root.appendChild(error);
  root.appendChild(help);
  var surface = { root: root, alias: alias, value: value, retry: retry, error: error };
  surfaces.push(surface);
  renderSurface(surface);
  if (alias) requestToolLlmConfiguration(alias);
  return {
    element: root,
    setAlias: function (nextAlias) {
      if (!isAlias(nextAlias)) return;
      surface.alias = nextAlias;
      renderSurface(surface);
      requestToolLlmConfiguration(nextAlias);
    },
  };
}
