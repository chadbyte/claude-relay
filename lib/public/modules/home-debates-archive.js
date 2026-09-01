// Full-stage Home archive for durable debate planning and live sessions.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { openHomeConversation, openHomeMateAction } from './home-mate-chat.js';
import { setHomeSubSurface, isHomeDebatesSurface } from './home-sub-surface.js';

var initialized = false;
var requestSequence = 0;
var topicSubmitting = false;

function element(id) {
  return document.getElementById(id);
}

function focusHeading() {
  var heading = element("home-debates-title");
  if (!heading || heading.getClientRects && !heading.getClientRects().length) return;
  heading.focus({ preventScroll: true });
}

function queueHeadingFocus() {
  if (typeof requestAnimationFrame !== "function") {
    focusHeading();
    return;
  }
  requestAnimationFrame(function () { requestAnimationFrame(focusHeading); });
}

function phaseLabel(phase) {
  if (phase === "live") return "Live";
  if (phase === "ended") return "Ended";
  if (phase === "interrupted") return "Interrupted";
  return "Planning";
}

function formatLabel(format) {
  if (!format) return "";
  return format.replace(/[_-]+/g, " ").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
}

function dateLabel(value) {
  if (typeof value !== "number" || !isFinite(value) || value <= 0) return "Date unavailable";
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)); }
  catch (error) { return new Date(value).toLocaleDateString(); }
}

function participantsLabel(participants) {
  var source = Array.isArray(participants) ? participants : [];
  var names = [];
  for (var i = 0; i < source.length; i++) if (source[i] && source[i].name) names.push(source[i].name);
  return names.length ? names.join(", ") : "Panel not selected";
}

function setArchiveOwnership(open) {
  var archive = element("home-debates-archive");
  var chat = element("home-mate-chat");
  var messages = element("home-mate-chat-messages");
  var composer = document.querySelector(".home-mate-chat-composer-frame");
  var suggestions = element("home-mate-chat-suggestions");
  var debateButton = element("home-sidebar-debate");
  if (archive) archive.hidden = !open;
  if (chat) chat.classList.toggle("home-debates-open", open);
  if (messages) messages.hidden = open;
  if (composer) composer.hidden = open;
  if (suggestions) suggestions.hidden = open;
  if (debateButton) {
    debateButton.setAttribute("aria-pressed", String(open));
    if (open) debateButton.setAttribute("aria-current", "page");
    else debateButton.removeAttribute("aria-current");
  }
}

function emptyState(title, detail, retry) {
  var wrap = document.createElement("div");
  wrap.className = "home-debates-empty";
  var icon = document.createElement("i");
  icon.dataset.lucide = retry ? "circle-alert" : "messages-square";
  icon.setAttribute("aria-hidden", "true");
  var heading = document.createElement("h2");
  heading.textContent = title;
  var copy = document.createElement("p");
  copy.textContent = detail;
  wrap.appendChild(icon);
  wrap.appendChild(heading);
  wrap.appendChild(copy);
  if (retry) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "home-debates-retry";
    button.textContent = "Retry";
    button.addEventListener("click", requestHomeDebates);
    wrap.appendChild(button);
  }
  return wrap;
}

function createDebateRow(debate) {
  var row = document.createElement("button");
  row.type = "button";
  row.className = "home-debates-row";
  var phase = phaseLabel(debate.phase);
  var date = dateLabel(debate.lastActivity);
  var participants = participantsLabel(debate.participants);
  row.setAttribute("aria-label", (debate.topic || debate.title || "Debate") + ", " + phase + ", " + participants + ", " + date);

  var body = document.createElement("span");
  body.className = "home-debates-row-body";
  var title = document.createElement("span");
  title.className = "home-debates-row-title";
  title.textContent = debate.topic || debate.title || "Debate planning";
  var panel = document.createElement("span");
  panel.className = "home-debates-row-panel";
  panel.textContent = participants;
  body.appendChild(title);
  body.appendChild(panel);

  var meta = document.createElement("span");
  meta.className = "home-debates-row-meta";
  var state = document.createElement("span");
  state.className = "home-debates-phase is-" + debate.phase;
  state.textContent = phase;
  var details = document.createElement("span");
  var detailParts = [];
  if (debate.format) detailParts.push(formatLabel(debate.format));
  if (debate.round) detailParts.push("Round " + debate.round);
  detailParts.push(date);
  details.textContent = detailParts.join(" · ");
  meta.appendChild(state);
  meta.appendChild(details);

  var arrow = document.createElement("i");
  arrow.dataset.lucide = "chevron-right";
  arrow.setAttribute("aria-hidden", "true");
  row.appendChild(body);
  row.appendChild(meta);
  row.appendChild(arrow);
  row.addEventListener("click", function () {
    setHomeSubSurface("chat");
    openHomeConversation(debate.mateId, debate.sessionId);
  });
  return row;
}

export function renderHomeDebatesArchive() {
  var open = isHomeDebatesSurface();
  setArchiveOwnership(open);
  if (!open) return;
  var list = element("home-debates-list");
  var summary = element("home-debates-summary");
  var topicForm = element("home-debates-topic-form");
  if (topicForm) topicForm.hidden = !store.get('homeDebateTopicFormOpen');
  if (!list || !summary) return;
  list.innerHTML = "";
  var status = store.get('homeDebatesStatus') || "idle";
  var debates = store.get('homeDebates') || [];
  if (status === "loading" || status === "idle") {
    summary.textContent = "Loading debates…";
    list.appendChild(emptyState("Gathering your debates", "Planning sessions and completed debates will appear here.", false));
  } else if (status === "error") {
    summary.textContent = "Debates could not be loaded.";
    list.appendChild(emptyState("Could not load debates", store.get('homeDebatesError') || "Try again when the connection is available.", true));
  } else if (!debates.length) {
    summary.textContent = "No debates yet";
    list.appendChild(emptyState("Your debate archive is empty", "Start a debate when you want Clay to assemble a panel.", false));
  } else {
    summary.textContent = debates.length + (debates.length === 1 ? " debate" : " debates");
    for (var i = 0; i < debates.length; i++) list.appendChild(createDebateRow(debates[i]));
  }
  refreshIcons();
}

export function requestHomeDebates() {
  var ws = getWs();
  requestSequence += 1;
  var requestId = "home-debates:" + requestSequence;
  if (!ws || ws.readyState !== 1) {
    store.set({ homeDebatesStatus: "error", homeDebatesRequestId: requestId, homeDebatesError: "Reconnect to load your debates." });
    renderHomeDebatesArchive();
    return false;
  }
  store.set({ homeDebatesStatus: "loading", homeDebatesRequestId: requestId, homeDebatesError: "" });
  renderHomeDebatesArchive();
  ws.send(JSON.stringify({ type: "home_debates_list", requestId: requestId }));
  return true;
}

export function openHomeDebatesArchive() {
  setHomeSubSurface("debates");
  renderHomeDebatesArchive();
  requestHomeDebates();
  queueHeadingFocus();
}

export function restoreHomeDebatesArchive() {
  if (!isHomeDebatesSurface()) return false;
  renderHomeDebatesArchive();
  requestHomeDebates();
  return true;
}

export function handleHomeDebatesState(msg) {
  if (!msg) return;
  var activeRequestId = store.get('homeDebatesRequestId');
  if (msg.requestId && activeRequestId && msg.requestId !== activeRequestId) return;
  var debates = Array.isArray(msg.debates) ? msg.debates : [];
  store.set({
    homeDebatesStatus: msg.status === "error" || msg.error ? "error" : "ready",
    homeDebates: debates,
    homeDebatesError: msg.error || "",
  });
  renderHomeDebatesArchive();
}

function focusTopic() {
  var input = element("home-debates-topic");
  if (input) input.focus({ preventScroll: true });
}

function startNewDebate() {
  var status = element("home-debates-topic-status");
  if (status) status.textContent = "Press Ctrl or Command + Enter to start.";
  store.set({ homeDebateTopicFormOpen: true });
  renderHomeDebatesArchive();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusTopic);
  else focusTopic();
}

function cancelNewDebate() {
  if (topicSubmitting) return;
  store.set({ homeDebateTopicFormOpen: false });
  renderHomeDebatesArchive();
  var button = element("home-debates-new");
  if (button) button.focus({ preventScroll: true });
}

function submitNewDebate(event) {
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  if (topicSubmitting) return;
  var input = element("home-debates-topic");
  var status = element("home-debates-topic-status");
  var topic = input && typeof input.value === "string" ? input.value.trim() : "";
  if (!topic) {
    if (status) status.textContent = "Enter a topic to start the debate.";
    if (input) input.focus({ preventScroll: true });
    return;
  }
  topicSubmitting = true;
  if (status) status.textContent = "Starting debate…";
  var started = openHomeMateAction("debate", topic.slice(0, 1000));
  topicSubmitting = false;
  if (!started) {
    if (status) status.textContent = "Clay is not available right now. Try again.";
    return;
  }
  if (input) input.value = "";
  store.set({ homeDebateTopicFormOpen: false });
}

function handleTopicKeydown(event) {
  if (!event || event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submitNewDebate(event);
}

export function initHomeDebatesArchive() {
  if (initialized) return;
  initialized = true;
  element("home-debates-new").addEventListener("click", startNewDebate);
  element("home-debates-topic-form").addEventListener("submit", submitNewDebate);
  element("home-debates-topic-cancel").addEventListener("click", cancelNewDebate);
  element("home-debates-topic").addEventListener("keydown", handleTopicKeydown);
  store.subscribe(function (state, previous) {
    if (state.homeSubSurface !== previous.homeSubSurface) renderHomeDebatesArchive();
    if (state.homeDebateTopicFormOpen !== previous.homeDebateTopicFormOpen) renderHomeDebatesArchive();
    if (state.connected !== previous.connected && state.connected && state.homeSubSurface === "debates") requestHomeDebates();
  });
  renderHomeDebatesArchive();
}
