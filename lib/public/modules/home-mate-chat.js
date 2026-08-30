// home-mate-chat.js - Embedded conversation surface for the selected mate.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { mateAvatarUrl } from './avatar.js';
import { createAssistantBubble, createUserBubble, renderAssistantBubbleText, finalizeAssistantBubble, disposeChatBubbleTree } from './chat-bubble-renderer.js';
import { openHomeMateProperty, closeHomeMateBackstage } from './home-mate-properties.js';
import { openDebateModal } from './debate.js';
import { openHomeDock } from './home-dock.js';
import { forgetHomeSession, rememberHomeMate, rememberHomeSession } from './home-surface.js';

var messages = [];
var streamingText = "";
var streaming = false;
var bound = false;
var animateSwitch = false;
var chatEl = null;
var stageEl = null;
var messagesEl = null;
var suggestionsEl = null;
var inputEl = null;
var sendBtn = null;
var sessionModelEl = null;
var sessionModelValueEl = null;
var sessionModelChooseEl = null;
var sessionRequestSequence = 0;
var activeSessionRequestId = null;

function sendMessage(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function getMate(mateId) {
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) {
    if (mates[i] && mates[i].id === mateId) return mates[i];
  }
  return null;
}

function getMateName(mate) {
  if (!mate) return "Mate";
  var profile = mate.profile || {};
  return profile.displayName || mate.displayName || mate.name || "Mate";
}

function getMateBio(mate) {
  if (!mate) return "";
  var profile = mate.profile || {};
  return profile.bio || mate.bio || profile.description || mate.description || "";
}

function scrollToBottom() {
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function resizeInput() {
  if (!inputEl) return;
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(108, inputEl.scrollHeight) + "px";
}

function nextSessionRequestId() {
  sessionRequestSequence++;
  return "home-session-" + Date.now() + "-" + sessionRequestSequence;
}

function resetHomeSessionModel(sessionId) {
  activeSessionRequestId = nextSessionRequestId();
  store.set({
    homeChatSessionId: sessionId || null,
    homeChatSessionModel: null,
    homeChatSessionVendor: null,
    homeChatSessionModelLoading: true,
  });
  renderSessionModel();
}

function requestHomeSession(message, sessionId) {
  var requestId = nextSessionRequestId();
  message.requestId = requestId;
  if (!sendMessage(message)) return false;
  activeSessionRequestId = requestId;
  store.set({
    homeChatSessionId: sessionId || null,
    homeChatSessionModel: null,
    homeChatSessionVendor: null,
    homeChatSessionModelLoading: true,
  });
  renderSessionModel();
  return true;
}

function currentSessionModelLabel() {
  if (!store.get('homeChatMateId') || store.get('homeChatSessionModelLoading')) return "Loading model…";
  var model = store.get('homeChatSessionModel');
  if (model) return model;
  return "Choose model";
}

function hasCommittedSessionModel() {
  return !store.get('homeChatSessionModelLoading') && !!store.get('homeChatSessionModel');
}

function renderSessionModel() {
  if (!sessionModelEl || !sessionModelValueEl || !sessionModelChooseEl) return;
  var label = currentSessionModelLabel();
  var needsChoice = label === "Choose model";
  sessionModelValueEl.textContent = needsChoice ? "" : label;
  sessionModelValueEl.classList.toggle("hidden", needsChoice);
  sessionModelChooseEl.classList.toggle("hidden", !needsChoice);
  sessionModelChooseEl.setAttribute("aria-label", "Choose a model for the current Mate. Used for new conversations.");
  sessionModelEl.title = "Model for this conversation: " + label;
  sessionModelEl.setAttribute("aria-label", "Model for this conversation: " + label);
}

function submitMessage() {
  var mateId = store.get('homeChatMateId');
  var text = inputEl ? inputEl.value.trim() : "";
  if (!mateId || !text || streaming || !hasCommittedSessionModel()) return;
  if (!sendMessage({ type: "home_mate_send", mateId: mateId, sessionId: store.get('homeChatSessionId'), requestId: activeSessionRequestId, text: text })) return;
  messages.push({ role: "user", text: text, ts: Date.now() });
  streamingText = "";
  streaming = true;
  inputEl.value = "";
  resizeInput();
  renderHomeChat();
}

function submitSuggestion(text) {
  if (!inputEl || !text) return;
  if (text === "Add a card to the board") openHomeDock("board");
  inputEl.value = text;
  resizeInput();
  submitMessage();
}

export function startNewHomeConversation() {
  var mateId = store.get('homeChatMateId');
  if (!mateId || streaming) return;
  if (!requestHomeSession({ type: "home_mate_new_session", mateId: mateId }, null)) return;
  messages = [];
  streamingText = "";
  streaming = false;
  animateSwitch = true;
  renderHomeChat();
}

function bindComposer() {
  if (bound || !inputEl || !sendBtn) return;
  bound = true;
  inputEl.addEventListener("input", function () {
    resizeInput();
    sendBtn.disabled = streaming || !store.get('homeChatMateId') || !hasCommittedSessionModel() || !inputEl.value.trim();
  });
  inputEl.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submitMessage();
    }
  });
  sendBtn.addEventListener("click", submitMessage);
  sessionModelChooseEl.addEventListener("click", function () { openHomeMateAction("model"); });
  window.addEventListener("clay:home-mate-model-confirmed", function (event) {
    handleHomeMateModelConfirmed(event.detail || {});
  });
}

function ensureDom() {
  if (!chatEl) chatEl = document.getElementById("home-mate-chat");
  if (!stageEl) stageEl = chatEl ? chatEl.querySelector(".home-mate-chat-stage") : null;
  if (!messagesEl) messagesEl = document.getElementById("home-mate-chat-messages");
  if (!suggestionsEl) suggestionsEl = document.getElementById("home-mate-chat-suggestions");
  if (!inputEl) inputEl = document.getElementById("home-mate-chat-input");
  if (!sendBtn) sendBtn = document.getElementById("home-mate-chat-send");
  if (!sessionModelEl) sessionModelEl = document.getElementById("home-mate-chat-session-model");
  if (!sessionModelValueEl) sessionModelValueEl = document.getElementById("home-mate-chat-session-model-value");
  if (!sessionModelChooseEl) sessionModelChooseEl = document.getElementById("home-mate-chat-session-model-choose");
  bindComposer();
  return !!(chatEl && stageEl && messagesEl && suggestionsEl && inputEl && sendBtn);
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  var date = new Date(timestamp);
  return date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0");
}

function appendMessage(message, mate, mateName, finalize) {
  var isUser = message.role === "user";
  var timeText = formatTime(typeof message.ts === "number" ? message.ts : 0);
  var row;
  if (isUser) {
    row = createUserBubble({ text: message.text || "", time: timeText });
  } else {
    row = createAssistantBubble({
      avatarUrl: mateAvatarUrl(mate, 36),
      name: mateName,
      time: timeText,
    });
    if (finalize) finalizeAssistantBubble(row, message.text || "", true);
    else renderAssistantBubbleText(row, message.text || "", false);
  }
  row.classList.add("home-chat-message");
  if (timeText) {
    var time = document.createElement("span");
    time.className = "home-chat-message-time";
    time.textContent = timeText;
    row.title = timeText;
    row.appendChild(time);
  }
  return row;
}

function buildTypingIndicator() {
  var typing = document.createElement("div");
  typing.className = "home-chat-typing";
  typing.setAttribute("aria-label", "Mate is responding");
  typing.innerHTML = "<span></span><span></span><span></span>";
  return typing;
}

function shortBio(mate) {
  var bio = getMateBio(mate).replace(/\s+/g, " ").trim();
  if (!bio) return "Bring an idea, a task, or a question.";
  if (bio.length > 120) return bio.slice(0, 117).trim() + "...";
  return bio;
}

function renderEmptyState(mate, mateName) {
  var empty = document.createElement("div");
  empty.className = "home-mate-chat-empty";
  var brand = document.createElement("div");
  brand.className = "home-mate-chat-brand";
  var symbol = document.createElement("img");
  symbol.src = "/clay-studio-symbol.png";
  symbol.alt = "";
  brand.appendChild(symbol);
  var wordmark = document.createElement("span");
  wordmark.className = "home-sidebar-brand-wordmark home-mate-chat-brand-wordmark";
  wordmark.textContent = "Clay Studio";
  brand.appendChild(wordmark);
  empty.appendChild(brand);
  var greeting = document.createElement("h2");
  greeting.textContent = mate ? "What should we work on, " + mateName + "?" : "Getting Home ready...";
  empty.appendChild(greeting);
  var detail = document.createElement("p");
  detail.textContent = mate ? shortBio(mate) : "Loading your Mate and recent conversation.";
  empty.appendChild(detail);
  messagesEl.appendChild(empty);

  suggestionsEl.innerHTML = "";
  if (!mate) return;
  var suggestions = ["Add a card to the board", "Make me a small tool"];
  for (var i = 0; i < suggestions.length; i++) {
    (function (suggestion) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "home-mate-chat-suggestion";
      chip.textContent = suggestion;
      chip.addEventListener("click", function () { submitSuggestion(suggestion); });
      suggestionsEl.appendChild(chip);
    })(suggestions[i]);
  }
}

export function renderHomeChat() {
  if (!ensureDom()) return;
  var mateId = store.get('homeChatMateId');
  var mate = getMate(mateId);
  var mateName = getMateName(mate);
  var hasConversation = messages.length > 0 || streaming || !!streamingText;
  chatEl.classList.toggle("is-empty", !hasConversation);
  chatEl.classList.toggle("has-conversation", hasConversation);
  disposeChatBubbleTree(messagesEl);
  messagesEl.innerHTML = "";
  suggestionsEl.innerHTML = "";
  if (hasConversation) {
    var transcript = document.createElement("div");
    transcript.className = "home-mate-chat-transcript home-chat-bubble-layout";
    for (var i = 0; i < messages.length; i++) transcript.appendChild(appendMessage(messages[i], mate, mateName, !streaming));
    if (streamingText) {
      transcript.appendChild(appendMessage({ role: "assistant", text: streamingText, ts: Date.now() }, mate, mateName, false));
    } else if (streaming && mate) {
      transcript.appendChild(buildTypingIndicator());
    }
    messagesEl.appendChild(transcript);
  } else {
    renderEmptyState(mate, mateName);
  }

  inputEl.disabled = !mateId || streaming || !hasCommittedSessionModel();
  inputEl.placeholder = mateId ? "Message " + mateName : "Message";
  sendBtn.disabled = !mateId || streaming || !hasCommittedSessionModel() || !inputEl.value.trim();
  renderSessionModel();
  if (animateSwitch) {
    messagesEl.classList.remove("is-switching");
    void messagesEl.offsetWidth;
    messagesEl.classList.add("is-switching");
    animateSwitch = false;
  }
  scrollToBottom();
}

export function openHomeChat(mateId) {
  if (!mateId) return;
  if (store.get('homeChatMateId') && store.get('homeChatMateId') !== mateId) closeHomeMateBackstage();
  var preferredSession = (store.get('homeActiveSessionByMate') || {})[mateId] || null;
  resetHomeSessionModel(preferredSession);
  store.set({ homeChatMateId: mateId });
  rememberHomeMate(mateId);
  messages = [];
  streamingText = "";
  streaming = false;
  animateSwitch = true;
  if (inputEl) inputEl.value = "";
  renderHomeChat();
  if (store.get('homeSurfaceLoaded')) resumeHomeChat();
}

export function openHomeConversation(mateId, sessionId) {
  if (!mateId || !sessionId) return;
  if (store.get('homeChatMateId') && store.get('homeChatMateId') !== mateId) closeHomeMateBackstage();
  resetHomeSessionModel(sessionId);
  store.set({ homeChatMateId: mateId });
  rememberHomeMate(mateId);
  rememberHomeSession(mateId, sessionId);
  messages = [];
  streamingText = "";
  streaming = false;
  animateSwitch = true;
  if (inputEl) inputEl.value = "";
  renderHomeChat();
  if (store.get('homeSurfaceLoaded')) resumeHomeChat();
}

export function openHomeMateAction(kind) {
  var mate = getMate(store.get('homeChatMateId'));
  if (!mate) return false;
  if (kind === "memory" || kind === "knowledge" || kind === "model" || kind === "settings") {
    openHomeMateProperty(kind, mate.id, getMateName(mate));
    return true;
  }
  if (kind !== "debate") return false;
  window.dispatchEvent(new CustomEvent("clay:home-debate"));
  openDebateModal({
    dmContext: messages.map(function (message) {
      return { text: message.text, isMate: message.role === "assistant" };
    }),
  });
  return true;
}

export function resumeHomeChat() {
  var mateId = store.get('homeChatMateId');
  if (!mateId) return;
  sendMessage({ type: "home_mate_sessions_list", mateId: mateId });
  var sessionId = store.get('homeChatSessionId') || (store.get('homeActiveSessionByMate') || {})[mateId];
  if (sessionId) requestHomeSession({ type: "home_mate_session_open", mateId: mateId, sessionId: sessionId }, sessionId);
  else requestHomeSession({ type: "home_mate_open", mateId: mateId }, null);
}

export function closeHomeChat() {
  sendMessage({ type: "home_mate_close" });
  streaming = false;
  streamingText = "";
  renderHomeChat();
}

export function handleHomeMateHistory(msg) {
  if (!isCurrentSessionMessage(msg)) return;
  store.set({
    homeChatSessionId: msg.sessionId || null,
    homeChatSessionModel: typeof msg.model === "string" && msg.model ? msg.model : null,
    homeChatSessionVendor: typeof msg.vendor === "string" && msg.vendor ? msg.vendor : null,
    homeChatSessionModelLoading: false,
  });
  if (msg.sessionId) rememberHomeSession(msg.mateId, msg.sessionId);
  messages = (msg.messages || []).filter(function (message) {
    return message && (message.role === "user" || message.role === "assistant") && typeof message.text === "string";
  }).map(function (message) {
    return { role: message.role, text: message.text, ts: message.ts || 0 };
  });
  streamingText = "";
  streaming = false;
  renderHomeChat();
}

export function handleHomeMateDelta(msg) {
  if (!isCurrentSessionMessage(msg)) return;
  if (msg.sessionId && msg.sessionId !== store.get('homeChatSessionId')) {
    store.set({ homeChatSessionId: msg.sessionId });
    rememberHomeSession(msg.mateId, msg.sessionId);
  }
  updateHomeSessionMetadata(msg);
  streaming = true;
  updateSessionProcessing(msg.mateId, msg.sessionId, true);
  streamingText += typeof msg.text === "string" ? msg.text : "";
  renderHomeChat();
}

export function handleHomeMateDone(msg) {
  if (!isCurrentSessionMessage(msg)) return;
  if (msg.sessionId && msg.sessionId !== store.get('homeChatSessionId')) {
    store.set({ homeChatSessionId: msg.sessionId });
    rememberHomeSession(msg.mateId, msg.sessionId);
  }
  updateHomeSessionMetadata(msg);
  if (streamingText) messages.push({ role: "assistant", text: streamingText, ts: Date.now() });
  streamingText = "";
  streaming = false;
  updateSessionProcessing(msg.mateId, msg.sessionId, false);
  renderHomeChat();
}

export function handleHomeMateError(msg) {
  if (!isCurrentSessionMessage(msg)) return;
  if (msg.code === "session_not_found") {
    forgetHomeSession(msg.mateId);
    requestHomeSession({ type: "home_mate_open", mateId: msg.mateId }, null);
    return;
  }
  if (msg.code === "model_unavailable") {
    store.set({ homeChatSessionModel: null, homeChatSessionModelLoading: false });
  }
  if (streamingText) messages.push({ role: "assistant", text: streamingText, ts: Date.now() });
  streamingText = "";
  streaming = false;
  messages.push({ role: "assistant", text: msg.text || "Chat unavailable.", ts: Date.now() });
  renderHomeChat();
}

export function handleHomeMateModelConfirmed(msg) {
  if (!msg || msg.mateId !== store.get('homeChatMateId')) return;
  if (store.get('homeChatSessionModel')) return;
  resumeHomeChat();
}

function isCurrentSessionMessage(msg) {
  if (!msg || msg.mateId !== store.get('homeChatMateId')) return false;
  if (msg.requestId && msg.requestId !== activeSessionRequestId) return false;
  var sessionId = store.get('homeChatSessionId');
  if (sessionId && msg.sessionId && msg.sessionId !== sessionId) return false;
  return true;
}

function updateHomeSessionMetadata(msg) {
  var update = {};
  if (Object.prototype.hasOwnProperty.call(msg, "model")) {
    update.homeChatSessionModel = typeof msg.model === "string" && msg.model ? msg.model : null;
    update.homeChatSessionModelLoading = false;
  }
  if (Object.prototype.hasOwnProperty.call(msg, "vendor")) {
    update.homeChatSessionVendor = typeof msg.vendor === "string" && msg.vendor ? msg.vendor : null;
  }
  if (Object.keys(update).length) store.set(update);
}

export function handleHomeMateSessionsState(msg) {
  if (!msg.mateId) return;
  var sessions = Object.assign({}, store.get('homeMateSessions') || {});
  sessions[msg.mateId] = Array.isArray(msg.sessions) ? msg.sessions : [];
  store.set({ homeMateSessions: sessions });
}

function updateSessionProcessing(mateId, sessionId, processing) {
  if (!mateId || !sessionId) return;
  var byMate = Object.assign({}, store.get('homeMateSessions') || {});
  var sessions = Array.isArray(byMate[mateId]) ? byMate[mateId].slice() : [];
  var changed = false;
  for (var i = 0; i < sessions.length; i++) {
    if (!sessions[i] || sessions[i].id !== sessionId || sessions[i].isProcessing === processing) continue;
    sessions[i] = Object.assign({}, sessions[i], { isProcessing: processing });
    changed = true;
  }
  if (!changed) return;
  byMate[mateId] = sessions;
  store.set({ homeMateSessions: byMate });
}
