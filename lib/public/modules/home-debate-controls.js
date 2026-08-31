import { store } from './store.js';
import { getWs } from './ws-ref.js';

var slotEl = null;
var normalComposerEl = null;
var modelEl = null;
var controlEl = null;
var controlMode = null;
var currentState = null;
var currentRequestId = null;
var startNewDebate = null;
var inputEl = null;
var primaryEl = null;
var secondaryEl = null;
var activityEl = null;
var handEl = null;
var stopEl = null;
var composing = false;

function textElement(tag, className, text) {
  var element = document.createElement(tag);
  element.className = className;
  element.textContent = text || "";
  return element;
}

function findHeader(messages) {
  for (var i = (messages || []).length - 1; i >= 0; i--) if (messages[i] && messages[i].role === "debate_header") return messages[i];
  return null;
}

function findActiveTurn(messages) {
  for (var i = (messages || []).length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === "debate_turn" && messages[i].status === "active") return messages[i];
  }
  return null;
}

export function homeDebateControlState(messages) {
  var header = findHeader(messages);
  if (!header || ["live", "ended", "interrupted"].indexOf(header.phase) === -1) return null;
  var mode = header.phase === "live" ? (header.interaction || "default") : "terminal";
  return { mode: mode, header: header, turn: findActiveTurn(messages), phase: header.phase };
}

function ensureElements() {
  var nextSlot = document.getElementById("home-debate-controls-slot");
  if (slotEl === nextSlot) return !!slotEl;
  slotEl = nextSlot;
  normalComposerEl = document.getElementById("home-mate-chat-composer");
  modelEl = document.getElementById("home-mate-chat-session-model");
  controlEl = null;
  controlMode = null;
  return !!slotEl;
}

function clearControls() {
  if (slotEl) slotEl.innerHTML = "";
  controlEl = null;
  controlMode = null;
  currentState = null;
  inputEl = null;
  primaryEl = null;
  secondaryEl = null;
  activityEl = null;
  handEl = null;
  stopEl = null;
  composing = false;
}

function setSpecialMode(active) {
  if (normalComposerEl) normalComposerEl.hidden = active;
  if (modelEl) modelEl.hidden = active;
  if (slotEl) slotEl.hidden = !active;
}

function sendControl(action, data) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1 || !currentState) return false;
  ws.send(JSON.stringify({
    type: "home_debate_control",
    action: action,
    mateId: store.get('homeChatMateId'),
    sessionId: store.get('homeChatSessionId'),
    requestId: currentRequestId,
    text: data && data.text ? data.text : "",
    response: data && data.response ? data.response : null,
  }));
  return true;
}

function button(label, className) {
  var element = textElement("button", className, label);
  element.type = "button";
  return element;
}

function dots() {
  var group = document.createElement("span");
  group.className = "home-debate-control-dots";
  group.setAttribute("aria-hidden", "true");
  for (var i = 0; i < 3; i++) group.appendChild(document.createElement("i"));
  return group;
}

function activityLabel(state) {
  if (!state.turn) return state.header.handRaised ? "Your hand is raised" : "Debate is live";
  var name = state.turn.mateName || "Mate";
  var activity = state.turn.activity || (state.turn.text ? "speaking" : "preparing");
  return name + " is " + activity.toLowerCase();
}

function lockSubmission(label) {
  if (inputEl) inputEl.disabled = true;
  if (primaryEl) { primaryEl.disabled = true; primaryEl.textContent = label; }
  if (secondaryEl) secondaryEl.disabled = true;
}

function submitInput(action, response) {
  var text = inputEl ? inputEl.value.trim() : "";
  if (action === "user_floor" && !text) return false;
  if (!sendControl(action, { text: text, response: response })) return false;
  lockSubmission(action === "user_floor" ? "Sending…" : "Continuing…");
  return true;
}

function bindInput(submit) {
  inputEl.addEventListener("compositionstart", function () { composing = true; });
  inputEl.addEventListener("compositionend", function () { composing = false; });
  inputEl.addEventListener("input", function () {
    if (controlMode === "user_floor" && primaryEl) primaryEl.disabled = !inputEl.value.trim();
  });
  inputEl.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || composing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  });
}

function focusInputOnce() {
  var target = inputEl;
  if (!target) return;
  var focus = function () {
    if (target === inputEl && !target.disabled && target.isConnected !== false) target.focus({ preventScroll: true });
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus);
  else focus();
}

function buildDefault(state) {
  var context = document.createElement("div");
  context.className = "home-debate-control-context";
  context.appendChild(dots());
  activityEl = textElement("span", "home-debate-control-activity", activityLabel(state));
  activityEl.setAttribute("role", "status");
  activityEl.setAttribute("aria-live", "polite");
  context.appendChild(activityEl);
  controlEl.appendChild(context);
  var actions = document.createElement("div");
  actions.className = "home-debate-control-actions";
  handEl = button(state.header.handRaised ? "Hand raised" : "Raise hand", "home-debate-control-secondary");
  handEl.setAttribute("aria-pressed", state.header.handRaised ? "true" : "false");
  handEl.disabled = state.header.handRaised === true;
  handEl.addEventListener("click", function () {
    if (!sendControl("hand_raise")) return;
    handEl.disabled = true;
    handEl.textContent = "Raising hand…";
  });
  stopEl = button("Stop", "home-debate-control-stop");
  stopEl.addEventListener("click", function () {
    if (!sendControl("stop")) return;
    stopEl.disabled = true;
    stopEl.textContent = "Stopping…";
  });
  actions.appendChild(handEl);
  actions.appendChild(stopEl);
  controlEl.appendChild(actions);
}

function buildInputMode(state) {
  var isFloor = state.mode === "user_floor";
  var heading = textElement("div", "home-debate-control-heading", isFloor ? "You have the floor" : "The moderator is ready to conclude");
  heading.id = "home-debate-control-heading";
  controlEl.appendChild(heading);
  inputEl = document.createElement("textarea");
  inputEl.rows = 2;
  inputEl.placeholder = isFloor ? "Share your thoughts with the panel" : "Add an optional direction to continue";
  inputEl.setAttribute("aria-labelledby", heading.id);
  controlEl.appendChild(inputEl);
  var actions = document.createElement("div");
  actions.className = "home-debate-control-actions";
  if (isFloor) {
    primaryEl = button("Send", "home-debate-control-primary");
    primaryEl.disabled = true;
    primaryEl.addEventListener("click", function () { submitInput("user_floor"); });
    secondaryEl = button("Pass", "home-debate-control-secondary");
    secondaryEl.addEventListener("click", function () {
      if (!sendControl("user_floor", { text: "(The user passed without speaking)" })) return;
      lockSubmission("Sending…");
    });
  } else {
    primaryEl = button("Continue", "home-debate-control-primary");
    primaryEl.addEventListener("click", function () { submitInput("conclude", "continue"); });
    secondaryEl = button("End debate", "home-debate-control-stop");
    secondaryEl.addEventListener("click", function () {
      if (!sendControl("conclude", { response: "end" })) return;
      lockSubmission("Ending…");
    });
  }
  actions.appendChild(primaryEl);
  actions.appendChild(secondaryEl);
  controlEl.appendChild(actions);
  bindInput(function () { submitInput(isFloor ? "user_floor" : "conclude", isFloor ? null : "continue"); });
  focusInputOnce();
}

function terminalLabel(state) {
  if (state.phase === "interrupted") return "Debate interrupted when Clay restarted";
  if (state.header.reason === "error") return "The debate stopped after an error";
  if (state.header.reason === "stopped" || state.header.reason === "user_stopped") return "Debate stopped";
  return "Debate ended";
}

function buildTerminal(state) {
  var status = textElement("div", "home-debate-control-terminal-status", terminalLabel(state));
  status.setAttribute("role", "status");
  controlEl.appendChild(status);
  if (typeof startNewDebate === "function") {
    var again = button("Start another debate", "home-debate-control-secondary");
    again.addEventListener("click", function () { startNewDebate(); });
    controlEl.appendChild(again);
  }
}

function buildControls(state) {
  slotEl.innerHTML = "";
  controlEl = document.createElement("section");
  controlEl.className = "home-debate-control-surface home-debate-control-" + state.mode;
  controlEl.setAttribute("role", state.mode === "default" ? "toolbar" : "region");
  controlEl.setAttribute("aria-label", state.mode === "terminal" ? "Debate status" : "Live debate controls");
  slotEl.appendChild(controlEl);
  if (state.mode === "default") buildDefault(state);
  else if (state.mode === "user_floor" || state.mode === "conclude") buildInputMode(state);
  else buildTerminal(state);
  controlMode = state.mode;
}

function updateControls(state) {
  if (state.mode !== "default") return;
  var label = activityLabel(state);
  if (activityEl && activityEl.textContent !== label) activityEl.textContent = label;
  if (state.header.handRaised && handEl) {
    handEl.textContent = "Hand raised";
    handEl.disabled = true;
    handEl.setAttribute("aria-pressed", "true");
  }
}

export function renderHomeDebateControls(messages, requestId, onStartNewDebate) {
  if (!ensureElements()) return false;
  var state = homeDebateControlState(messages);
  currentRequestId = requestId || null;
  startNewDebate = onStartNewDebate || null;
  if (!state) {
    setSpecialMode(false);
    clearControls();
    return false;
  }
  currentState = state;
  setSpecialMode(true);
  if (!controlEl || controlMode !== state.mode) buildControls(state);
  else updateControls(state);
  return true;
}
