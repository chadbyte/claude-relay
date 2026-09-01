// Vendor-aware Mate model chooser hosted by the centered Mate settings dialog.

import { getWs } from './ws-ref.js';

var activeMateId = null;
var activeMateName = "Mate";
var state = null;
var requestId = null;
var selectionRequestId = null;
var selectionModel = null;
var activeSessionId = null;
var requestSequence = 0;

function nextRequestId(prefix) {
  requestSequence++;
  return prefix + "-" + Date.now() + "-" + requestSequence;
}

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function modelValue(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return entry.value || entry.id || "";
}

function modelLabel(entry) {
  if (typeof entry === "string") return entry;
  return entry.displayName || entry.label || entry.name || modelValue(entry) || "Model";
}

function vendorLabel(vendor) {
  var vendors = state && state.vendors ? state.vendors : [];
  for (var i = 0; i < vendors.length; i++) {
    if (vendors[i] && vendors[i].id === vendor) return vendors[i].displayName || vendor;
  }
  return vendor || "Vendor";
}

function findFocusTarget(kind, value) {
  if (kind === "retry") return document.querySelector(".home-mate-settings-dialog .home-mate-model-retry");
  if (kind === "selection-status") return document.querySelector(".home-mate-settings-dialog .home-mate-model-selection-status");
  var selector = kind === "vendor" ? ".home-mate-settings-dialog [data-home-mate-vendor]" : ".home-mate-settings-dialog [data-home-mate-model]";
  var datasetKey = kind === "vendor" ? "homeMateVendor" : "homeMateModel";
  var options = document.querySelectorAll(selector);
  for (var i = 0; i < options.length; i++) {
    if (options[i].dataset[datasetKey] === value) return options[i];
  }
  return null;
}

function rerenderAndFocus(rerender, kind, value) {
  rerender();
  if (!kind) return;
  var target = findFocusTarget(kind, value);
  if (target) target.focus({ preventScroll: true });
}

export function resetHomeMateModelPicker(mateId, mateName, mate, sessionId) {
  activeMateId = mateId;
  activeMateName = mateName || "Mate";
  requestId = null;
  selectionRequestId = null;
  selectionModel = null;
  activeSessionId = sessionId || null;
  state = {
    status: "loading",
    vendor: mate && mate.vendor ? mate.vendor : "",
    model: mate && mate.model ? mate.model : "",
    mateVendor: mate && mate.vendor ? mate.vendor : "",
    mateModel: mate && mate.model ? mate.model : "",
    vendors: [],
    models: [],
    error: "",
  };
}

export function clearHomeMateModelPicker() {
  activeMateId = null;
  activeMateName = "Mate";
  state = null;
  requestId = null;
  selectionRequestId = null;
  selectionModel = null;
  activeSessionId = null;
}

export function requestHomeMateModels(vendor, rerender, focusAfter) {
  if (!activeMateId || !state || selectionRequestId) return;
  var requestedVendor = vendor || state.vendor || state.mateVendor;
  requestId = nextRequestId("home-mate-models");
  state.vendor = requestedVendor;
  state.status = "loading";
  state.models = [];
  state.error = "";
  rerenderAndFocus(rerender, focusAfter ? "vendor" : "", requestedVendor);
  if (send({ type: "home_mate_models_get", mateId: activeMateId, vendor: requestedVendor, requestId: requestId })) return;
  state.status = "error";
  state.error = "Clay is offline. Reconnect and try again.";
  rerenderAndFocus(rerender, "retry", "");
}

function selectMateModel(model, rerender) {
  if (!state || selectionRequestId || !model || !state.vendor) return;
  selectionRequestId = nextRequestId("home-mate-model-set");
  selectionModel = model;
  state.error = "";
  rerenderAndFocus(rerender, "selection-status", "");
  var message = { type: "home_mate_model_set", mateId: activeMateId, vendor: state.vendor, model: model, requestId: selectionRequestId };
  if (activeSessionId) message.sessionId = activeSessionId;
  if (send(message)) return;
  selectionRequestId = null;
  selectionModel = null;
  state.error = "Clay is offline. Reconnect and try again.";
  rerenderAndFocus(rerender, "model", model);
}

function appendHeading(body, text) {
  var heading = document.createElement("h3");
  heading.className = "home-mate-model-section-label";
  heading.textContent = text;
  body.appendChild(heading);
}

function renderVendors(body, rerender) {
  appendHeading(body, "Vendor");
  var list = document.createElement("div");
  list.className = "home-mate-vendor-list";
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "Vendor for " + activeMateName);
  var vendors = state.vendors || [];
  for (var i = 0; i < vendors.length; i++) {
    (function (vendor) {
      if (!vendor || !vendor.id) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "home-mate-vendor-option";
      button.dataset.homeMateVendor = vendor.id;
      button.textContent = vendor.displayName || vendor.id;
      button.setAttribute("aria-pressed", vendor.id === state.vendor ? "true" : "false");
      button.disabled = !!selectionRequestId;
      if (vendor.id === state.mateVendor) button.title = "Current Mate vendor";
      button.addEventListener("click", function () {
        if (vendor.id !== state.vendor) requestHomeMateModels(vendor.id, rerender, true);
      });
      list.appendChild(button);
    })(vendors[i]);
  }
  if (!vendors.length) {
    var waiting = document.createElement("span");
    waiting.className = "home-mate-model-muted";
    waiting.textContent = "Loading available vendors…";
    list.appendChild(waiting);
  }
  body.appendChild(list);
}

function appendLoadState(body, rerender) {
  var loadState = document.createElement("div");
  loadState.className = "home-mate-model-state";
  if (state.status === "loading") {
    loadState.classList.add("home-mate-model-loading");
    loadState.setAttribute("role", "status");
    loadState.dataset.homeModelFocus = "catalog-status";
    loadState.tabIndex = -1;
    loadState.textContent = "Loading " + vendorLabel(state.vendor) + " models…";
  } else {
    if (state.status === "error") loadState.setAttribute("role", "alert");
    loadState.textContent = state.error || "No models are available for this vendor.";
    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "home-mate-model-retry";
    retry.dataset.homeModelFocus = "catalog-status";
    retry.textContent = "Try again";
    retry.addEventListener("click", function () { requestHomeMateModels(state.vendor, rerender, false); });
    loadState.appendChild(retry);
  }
  body.appendChild(loadState);
}

function renderModels(body, rerender) {
  appendHeading(body, "Model");
  if (state.status !== "ready") {
    appendLoadState(body, rerender);
    return;
  }
  var list = document.createElement("div");
  list.className = "home-mate-model-list";
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "Models from " + vendorLabel(state.vendor) + " for " + activeMateName);
  var models = state.models || [];
  for (var i = 0; i < models.length; i++) {
    (function (entry) {
      var value = modelValue(entry);
      if (!value) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "home-mate-model-option";
      button.dataset.homeMateModel = value;
      button.setAttribute("aria-pressed", state.vendor === state.mateVendor && value === state.mateModel ? "true" : "false");
      button.disabled = !!selectionRequestId;
      var label = document.createElement("span");
      label.textContent = modelLabel(entry);
      var id = document.createElement("small");
      id.textContent = value;
      button.appendChild(label);
      button.appendChild(id);
      button.addEventListener("click", function () { selectMateModel(value, rerender); });
      list.appendChild(button);
    })(models[i]);
  }
  body.appendChild(list);
  var status = document.createElement("div");
  status.className = "home-mate-model-selection-status";
  status.setAttribute("aria-live", "polite");
  if (selectionRequestId) {
    status.dataset.homeMateModel = selectionModel;
    status.tabIndex = -1;
  }
  status.textContent = selectionRequestId ? "Saving vendor and model…" : (state.error || "");
  body.appendChild(status);
}

export function renderHomeMateModelPicker(body, rerender) {
  var note = document.createElement("p");
  note.className = "home-mate-model-note";
  note.textContent = activeSessionId ? "Used for this draft and future new conversations. Conversations with activity keep their committed vendor and model." : "Used for new conversations. Existing conversations keep their current vendor and model.";
  body.appendChild(note);
  if (!state) return;
  if (state.mateVendor && state.mateModel) {
    var current = document.createElement("p");
    current.className = "home-mate-model-current";
    current.textContent = "Current · " + vendorLabel(state.mateVendor) + " · " + state.mateModel;
    body.appendChild(current);
  }
  renderVendors(body, rerender);
  renderModels(body, rerender);
}

export function applyHomeMateModelsState(msg) {
  if (!state || msg.mateId !== activeMateId || msg.requestId !== requestId) return false;
  state.status = msg.status || "empty";
  state.vendor = msg.vendor || state.vendor;
  state.model = msg.model || "";
  state.mateVendor = msg.mateVendor || state.mateVendor;
  state.mateModel = msg.mateModel || state.mateModel;
  state.vendors = Array.isArray(msg.vendors) ? msg.vendors : state.vendors;
  state.models = Array.isArray(msg.models) ? msg.models : [];
  state.error = msg.error || "";
  return true;
}

export function applyHomeMateModelResult(msg) {
  if (!state || msg.mateId !== activeMateId || msg.requestId !== selectionRequestId) return false;
  selectionRequestId = null;
  selectionModel = null;
  if (!msg.ok) {
    state.error = msg.error || "Could not save this vendor and model.";
    return true;
  }
  state.mateVendor = msg.vendor || state.vendor;
  state.mateModel = msg.model || state.model;
  state.model = state.mateModel;
  state.error = msg.requestedSessionId && !msg.sessionApplied ? (msg.sessionReason || "Mate default updated. This conversation keeps its committed model.") : "";
  window.dispatchEvent(new CustomEvent("clay:home-mate-model-confirmed", { detail: {
    mateId: msg.mateId,
    vendor: state.mateVendor,
    model: state.mateModel,
    requestedSessionId: msg.requestedSessionId || null,
    sessionId: msg.sessionId || null,
    sessionApplied: msg.sessionApplied === true,
    sessionVendor: msg.sessionVendor || null,
    sessionModel: msg.sessionModel || null,
  } }));
  return true;
}
