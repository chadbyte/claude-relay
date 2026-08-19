// home-mate-chat.js - Embedded conversation surface for the selected mate.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './utils.js';

var messages = [];
var streamingText = "";
var streaming = false;
var bound = false;
var chatEl = null;
var headerEl = null;
var messagesEl = null;
var inputEl = null;
var sendBtn = null;

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

function scrollToBottom() {
  if (!messagesEl) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function resizeInput() {
  if (!inputEl) return;
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(96, inputEl.scrollHeight) + "px";
}

function submitMessage() {
  var mateId = store.get('homeChatMateId');
  var text = inputEl ? inputEl.value.trim() : "";
  if (!mateId || !text || streaming) return;
  if (!sendMessage({ type: "home_mate_send", mateId: mateId, text: text })) return;

  messages.push({ role: "user", text: text });
  streamingText = "";
  streaming = true;
  inputEl.value = "";
  resizeInput();
  renderHomeChat();
}

function startNewChat() {
  var mateId = store.get('homeChatMateId');
  if (!mateId || streaming) return;
  if (!sendMessage({ type: "home_mate_new_session", mateId: mateId })) return;
  messages = [];
  streamingText = "";
  streaming = false;
  renderHomeChat();
}

function bindComposer() {
  if (bound || !inputEl || !sendBtn) return;
  bound = true;
  inputEl.addEventListener("input", function () {
    resizeInput();
    sendBtn.disabled = streaming || !store.get('homeChatMateId') || !inputEl.value.trim();
  });
  inputEl.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submitMessage();
    }
  });
  sendBtn.addEventListener("click", submitMessage);
}

function ensureDom() {
  if (!chatEl) chatEl = document.getElementById("home-mate-chat");
  if (!headerEl) headerEl = document.getElementById("home-mate-chat-header");
  if (!messagesEl) messagesEl = document.getElementById("home-mate-chat-messages");
  if (!inputEl) inputEl = document.getElementById("home-mate-chat-input");
  if (!sendBtn) sendBtn = document.getElementById("home-mate-chat-send");
  bindComposer();
  return !!(chatEl && headerEl && messagesEl && inputEl && sendBtn);
}

function bubbleHtml(message) {
  var role = message.role === "user" ? "user" : "assistant";
  return '<div class="home-mate-chat-row home-mate-chat-row-' + role + '">'
    + '<div class="home-mate-chat-bubble home-mate-chat-bubble-' + role + '">'
    + escapeHtml(message.text || "").replace(/\n/g, "<br>")
    + '</div></div>';
}

export function renderHomeChat() {
  if (!ensureDom()) return;
  var mateId = store.get('homeChatMateId');
  var mate = getMate(mateId);
  var mateName = getMateName(mate);

  if (!mateId) {
    headerEl.innerHTML = '<span class="home-mate-chat-title">Select a mate</span>';
    messagesEl.innerHTML = '<div class="home-mate-chat-empty">Choose a mate to start chatting.</div>';
  } else {
    headerEl.innerHTML = '<span class="home-mate-chat-title">' + escapeHtml(mateName) + '</span>'
      + '<button type="button" class="home-mate-chat-new"' + (streaming ? ' disabled' : '') + '>New chat</button>';
    var html = messages.map(bubbleHtml).join("");
    if (streamingText) {
      html += bubbleHtml({ role: "assistant", text: streamingText });
    }
    if (streaming) {
      html += '<div class="home-mate-chat-streaming" aria-label="Mate is responding"><span></span><span></span><span></span></div>';
    }
    if (!html) html = '<div class="home-mate-chat-empty">Start a conversation with ' + escapeHtml(mateName) + '.</div>';
    messagesEl.innerHTML = html;
    var newButton = headerEl.querySelector(".home-mate-chat-new");
    if (newButton) newButton.addEventListener("click", startNewChat);
  }

  inputEl.disabled = !mateId || streaming;
  inputEl.placeholder = mateId ? "Message " + mateName : "Message";
  sendBtn.disabled = !mateId || streaming || !inputEl.value.trim();
  chatEl.classList.toggle("is-streaming", streaming);
  scrollToBottom();
}

export function openHomeChat(mateId) {
  if (!mateId) return;
  store.set({ homeChatMateId: mateId });
  messages = [];
  streamingText = "";
  streaming = false;
  if (inputEl) inputEl.value = "";
  renderHomeChat();
  sendMessage({ type: "home_mate_open", mateId: mateId });
}

export function closeHomeChat() {
  sendMessage({ type: "home_mate_close" });
  streaming = false;
  streamingText = "";
  renderHomeChat();
}

export function handleHomeMateHistory(msg) {
  if (msg.mateId !== store.get('homeChatMateId')) return;
  messages = (msg.messages || []).filter(function (message) {
    return message && (message.role === "user" || message.role === "assistant") && typeof message.text === "string";
  }).map(function (message) {
    return { role: message.role, text: message.text };
  });
  streamingText = "";
  streaming = false;
  renderHomeChat();
}

export function handleHomeMateDelta(msg) {
  if (msg.mateId !== store.get('homeChatMateId')) return;
  streaming = true;
  streamingText += typeof msg.text === "string" ? msg.text : "";
  renderHomeChat();
}

export function handleHomeMateDone(msg) {
  if (msg.mateId !== store.get('homeChatMateId')) return;
  if (streamingText) messages.push({ role: "assistant", text: streamingText });
  streamingText = "";
  streaming = false;
  renderHomeChat();
}

export function handleHomeMateError(msg) {
  if (msg.mateId !== store.get('homeChatMateId')) return;
  if (streamingText) messages.push({ role: "assistant", text: streamingText });
  streamingText = "";
  streaming = false;
  messages.push({ role: "assistant", text: msg.text || "Chat unavailable." });
  renderHomeChat();
}
