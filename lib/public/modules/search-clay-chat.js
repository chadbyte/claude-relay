// Compact Clay conversation hosted inside the global search drawer.
import { getWs } from './ws-ref.js';
import { showHomeHub } from './app-home-hub.js';
import { openHomeConversation } from './home-mate-chat.js';
import { refreshIcons } from './icons.js';
import { renderMarkdown } from './markdown.js';

var state = null;
var hostEl = null;
var backHandler = null;
var closeHandler = null;
var sequence = 0;
var progressTimer = null;

function send(payload) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function requestId() {
  sequence++;
  return "search-clay-" + Date.now() + "-" + sequence;
}

function stopProgressTimer() {
  if (!progressTimer) return;
  clearInterval(progressTimer);
  progressTimer = null;
}

function startProgressTimer() {
  if (progressTimer) return;
  progressTimer = setInterval(function () { if (state && state.processing) updateProgressDom(); else stopProgressTimer(); }, 1000);
}

function progressCopy() {
  var elapsed = state && state.startedAt ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) : 0;
  var label = state && state.step ? "Considering what was found" : "Understanding what to look for";
  if (state.activity === "searching") label = state.step > 1 ? "Checking another lead" : "Searching your conversations";
  else if (state.activity === "reviewing") label = "Reviewing what Clay found";
  else if (state.activity === "reconsidering") label = "Trying another search route";
  else if (elapsed >= 12) label = "Following related context";
  else if (elapsed >= 4) label = "Searching your conversations";
  var detail = (state.step ? "Search pass " + state.step + " · " : "") + elapsed + "s";
  return { label: label, detail: detail };
}

function updateProgressDom() {
  if (!hostEl) return;
  var progress = progressCopy();
  var label = hostEl.querySelector(".search-clay-pending-copy strong");
  var detail = hostEl.querySelector(".search-clay-pending-copy small");
  if (label) label.textContent = progress.label;
  if (detail) detail.textContent = progress.detail;
}

function button(icon, label, title, handler) {
  var el = document.createElement("button");
  el.type = "button";
  el.className = "search-clay-icon-button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.innerHTML = '<i data-lucide="' + icon + '" aria-hidden="true"></i><span>' + label + '</span>';
  el.addEventListener("click", handler);
  return el;
}

function renderMessage(message) {
  var row = document.createElement("div");
  row.className = "search-clay-message " + (message.role === "user" ? "is-user" : "is-clay");
  var label = document.createElement("div");
  label.className = "search-clay-message-label";
  label.textContent = message.role === "user" ? "You" : "Clay";
  row.appendChild(label);
  var body = document.createElement("div");
  body.className = "search-clay-message-body";
  if (message.role === "user") body.textContent = message.text || "";
  else body.innerHTML = renderMarkdown(message.text || "");
  row.appendChild(body);
  return row;
}

function submit(input, sendButton) {
  var text = input.value.trim();
  if (!state || !text || state.processing || !state.sessionId) return;
  if (!send({ type: "home_mate_send", mateId: state.mateId, sessionId: state.sessionId, requestId: state.requestId, text: text })) return;
  state.messages.push({ role: "user", text: text });
  state.processing = true;
  state.stream = "";
  state.activity = "thinking";
  state.step = 0;
  state.startedAt = Date.now();
  startProgressTimer();
  input.value = "";
  sendButton.disabled = true;
  render();
}

function expand() {
  if (!state || !state.mateId || !state.sessionId) return;
  var mateId = state.mateId;
  var sessionId = state.sessionId;
  if (closeHandler) closeHandler();
  showHomeHub();
  openHomeConversation(mateId, sessionId);
}

function render() {
  if (!hostEl || !state) return;
  var previousTranscript = hostEl.querySelector(".search-clay-transcript");
  var previousTop = previousTranscript ? previousTranscript.scrollTop : 0;
  var follow = !previousTranscript || previousTranscript.scrollHeight - previousTranscript.scrollTop - previousTranscript.clientHeight < 40;
  hostEl.innerHTML = "";
  var shell = document.createElement("section");
  shell.className = "search-clay-chat";
  shell.setAttribute("aria-label", "Chat with Clay");
  var header = document.createElement("header");
  header.className = "search-clay-header";
  var identity = document.createElement("div");
  identity.className = "search-clay-identity";
  identity.innerHTML = '<img src="/clay-studio-symbol.png" width="22" height="22" alt=""><span><strong>Clay</strong><small>Workspace search</small></span>';
  header.appendChild(identity);
  var actions = document.createElement("div");
  actions.className = "search-clay-header-actions";
  actions.appendChild(button("search", "Search", "Back to search", function () { detachSearchClayChat(); if (backHandler) backHandler(); }));
  var expandButton = button("maximize-2", "Expand", "Open this conversation in Home", expand);
  expandButton.disabled = !state.sessionId;
  actions.appendChild(expandButton);
  header.appendChild(actions);
  shell.appendChild(header);
  var transcript = document.createElement("div");
  transcript.className = "search-clay-transcript";
  transcript.setAttribute("aria-live", "polite");
  for (var i = 0; i < state.messages.length; i++) transcript.appendChild(renderMessage(state.messages[i]));
  if (state.stream) transcript.appendChild(renderMessage({ role: "assistant", text: state.stream }));
  if (state.processing && !state.stream) {
    var progress = progressCopy();
    var pending = document.createElement("div");
    pending.className = "search-clay-pending";
    pending.setAttribute("role", "status");
    var pendingCopy = document.createElement("span");
    pendingCopy.className = "search-clay-pending-copy";
    var pendingLabel = document.createElement("strong");
    pendingLabel.textContent = progress.label;
    var pendingDetail = document.createElement("small");
    pendingDetail.textContent = progress.detail;
    pendingCopy.appendChild(pendingLabel);
    pendingCopy.appendChild(pendingDetail);
    pending.appendChild(pendingCopy);
    var dots = document.createElement("span");
    dots.className = "search-clay-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.innerHTML = "<i></i><i></i><i></i>";
    pending.appendChild(dots);
    transcript.appendChild(pending);
  }
  shell.appendChild(transcript);
  var composer = document.createElement("div");
  composer.className = "search-clay-composer";
  var input = document.createElement("textarea");
  input.rows = 1;
  input.placeholder = state.sessionId ? "Ask a follow-up…" : "Starting Clay…";
  input.disabled = !state.sessionId || state.processing;
  input.setAttribute("aria-label", "Message Clay");
  var sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.className = "search-clay-send";
  sendButton.setAttribute("aria-label", "Send to Clay");
  sendButton.innerHTML = '<i data-lucide="arrow-up" aria-hidden="true"></i>';
  sendButton.disabled = true;
  input.addEventListener("input", function () { sendButton.disabled = state.processing || !input.value.trim(); });
  input.addEventListener("keydown", function (event) { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(input, sendButton); } });
  sendButton.addEventListener("click", function () { submit(input, sendButton); });
  composer.appendChild(input);
  composer.appendChild(sendButton);
  shell.appendChild(composer);
  hostEl.appendChild(shell);
  refreshIcons();
  transcript.scrollTop = follow ? transcript.scrollHeight : previousTop;
}

export function startSearchClayChat(query, host, onBack, onClose) {
  var clean = typeof query === "string" ? query.trim().slice(0, 12000) : "";
  if (!clean) return false;
  hostEl = host;
  backHandler = onBack;
  closeHandler = onClose;
  state = { requestId: requestId(), mateId: null, sessionId: null, messages: [{ role: "user", text: clean }], stream: "", processing: true, activity: "thinking", step: 0, startedAt: Date.now() };
  startProgressTimer();
  render();
  if (!send({ type: "home_clay_ask", requestId: state.requestId, text: clean })) {
    state.processing = false;
    stopProgressTimer();
    state.messages.push({ role: "assistant", text: "Clay is offline. Reconnect and try again." });
    render();
  }
  return true;
}

export function attachSearchClayChat(host, onBack, onClose) {
  if (!state) return false;
  hostEl = host;
  backHandler = onBack;
  closeHandler = onClose;
  render();
  return true;
}

export function detachSearchClayChat() { hostEl = null; }

export function handleSearchClayMessage(msg) {
  if (!state || !msg || msg.requestId !== state.requestId) return false;
  if (msg.mateId) state.mateId = msg.mateId;
  if (msg.type === "home_mate_session_identity" && msg.sessionId) state.sessionId = msg.sessionId;
  if (msg.type === "home_clay_activity") {
    state.activity = msg.phase || state.activity;
    state.step = typeof msg.step === "number" ? msg.step : state.step;
  } else if (msg.type === "home_mate_history") {
    state.sessionId = msg.sessionId || state.sessionId;
    state.messages = Array.isArray(msg.messages) ? msg.messages.filter(function (item) { return item && (item.role === "user" || item.role === "assistant"); }).map(function (item) { return { role: item.role, text: item.text || "" }; }) : state.messages;
    state.processing = msg.isProcessing === true;
    if (state.processing) startProgressTimer();
    state.stream = "";
  } else if (msg.type === "home_mate_delta") {
    state.sessionId = msg.sessionId || state.sessionId;
    state.processing = true;
    state.stream += msg.text || "";
  } else if (msg.type === "home_mate_done") {
    if (state.stream || msg.text) state.messages.push({ role: "assistant", text: state.stream || msg.text || "" });
    state.stream = "";
    state.processing = false;
    stopProgressTimer();
  } else if (msg.type === "home_mate_error") {
    state.stream = "";
    state.processing = false;
    stopProgressTimer();
    state.messages.push({ role: "assistant", text: msg.text || "Clay could not complete that search." });
  }
  render();
  return true;
}
