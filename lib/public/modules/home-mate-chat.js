// home-mate-chat.js - Embedded conversation surface for the selected mate.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { userAvatarUrl, mateAvatarUrl } from './avatar.js';
import { buildDmMessage, buildDmTypingIndicator } from './dm-render.js';

var messages = [];
var streamingText = "";
var streaming = false;
var bound = false;
var animateSwitch = false;
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

function getMateBio(mate) {
  if (!mate) return "";
  var profile = mate.profile || {};
  return profile.bio || mate.bio || profile.description || mate.description || "";
}

function getMyUser() {
  var users = store.get('cachedAllUsers') || [];
  var myUserId = store.get('myUserId');
  for (var i = 0; i < users.length; i++) {
    if (users[i] && users[i].id === myUserId) return users[i];
  }
  return null;
}

function scrollToBottom() {
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function resizeInput() {
  if (!inputEl) return;
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(108, inputEl.scrollHeight) + "px";
}

function submitMessage() {
  var mateId = store.get('homeChatMateId');
  var text = inputEl ? inputEl.value.trim() : "";
  if (!mateId || !text || streaming) return;
  if (!sendMessage({ type: "home_mate_send", mateId: mateId, text: text })) return;
  messages.push({ role: "user", text: text, ts: Date.now() });
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
  animateSwitch = true;
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

function renderHeader(mate, mateName) {
  headerEl.innerHTML = "";
  var identity = document.createElement("div");
  identity.className = "home-mate-chat-identity";
  if (mate) {
    var avatar = document.createElement("img");
    avatar.className = "home-mate-chat-avatar";
    avatar.src = mateAvatarUrl(mate, 40);
    avatar.alt = "";
    identity.appendChild(avatar);
  }
  var copy = document.createElement("div");
  copy.className = "home-mate-chat-identity-copy";
  var name = document.createElement("span");
  name.className = "home-mate-chat-title";
  name.textContent = mate ? mateName : "Select a mate";
  copy.appendChild(name);
  var bioText = getMateBio(mate);
  if (bioText) {
    var bio = document.createElement("span");
    bio.className = "home-mate-chat-bio";
    bio.textContent = bioText;
    copy.appendChild(bio);
  }
  identity.appendChild(copy);
  headerEl.appendChild(identity);

  if (mate) {
    var newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = "home-mate-chat-new";
    newButton.textContent = "New chat";
    newButton.disabled = streaming;
    newButton.addEventListener("click", startNewChat);
    headerEl.appendChild(newButton);
  }
}

function appendMessage(message, mate, mateName) {
  var isUser = message.role === "user";
  var myUser = getMyUser();
  var myUserId = store.get('myUserId') || "home-user";
  var row = buildDmMessage({
    from: isUser ? myUserId : (mate ? mate.id : "home-mate"),
    text: message.text || "",
    ts: typeof message.ts === "number" ? message.ts : 0,
  }, {
    container: messagesEl,
    isMe: isUser,
    avatarUrl: isUser
      ? userAvatarUrl(myUser || { id: myUserId }, 36)
      : (mate ? mateAvatarUrl(mate, 36) : ""),
    displayName: isUser
      ? ((myUser && myUser.displayName) || "Me")
      : mateName,
  });
  messagesEl.appendChild(row);
}

export function renderHomeChat() {
  if (!ensureDom()) return;
  var mateId = store.get('homeChatMateId');
  var mate = getMate(mateId);
  var mateName = getMateName(mate);
  var profile = mate ? (mate.profile || {}) : {};
  var mateColor = profile.avatarColor || (mate && mate.avatarColor) || "";
  if (mateColor) chatEl.style.setProperty("--mate-color", mateColor);
  else chatEl.style.removeProperty("--mate-color");

  renderHeader(mate, mateName);
  messagesEl.innerHTML = "";
  for (var i = 0; i < messages.length; i++) appendMessage(messages[i], mate, mateName);
  if (streamingText) {
    appendMessage({ role: "assistant", text: streamingText, ts: Date.now() }, mate, mateName);
  } else if (streaming && mate) {
    messagesEl.appendChild(buildDmTypingIndicator({ avatarUrl: mateAvatarUrl(mate, 36) }));
  }
  if (!mateId || (!messages.length && !streaming)) {
    var empty = document.createElement("div");
    empty.className = "home-mate-chat-empty";
    empty.textContent = mateId ? "Start a conversation with " + mateName + "." : "Choose a mate to start chatting.";
    messagesEl.appendChild(empty);
  }

  inputEl.disabled = !mateId || streaming;
  inputEl.placeholder = mateId ? "Message " + mateName : "Message";
  sendBtn.disabled = !mateId || streaming || !inputEl.value.trim();
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
  store.set({ homeChatMateId: mateId });
  messages = [];
  streamingText = "";
  streaming = false;
  animateSwitch = true;
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
    return { role: message.role, text: message.text, ts: message.ts || 0 };
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
  if (streamingText) messages.push({ role: "assistant", text: streamingText, ts: Date.now() });
  streamingText = "";
  streaming = false;
  renderHomeChat();
}

export function handleHomeMateError(msg) {
  if (msg.mateId !== store.get('homeChatMateId')) return;
  if (streamingText) messages.push({ role: "assistant", text: streamingText, ts: Date.now() });
  streamingText = "";
  streaming = false;
  messages.push({ role: "assistant", text: msg.text || "Chat unavailable.", ts: Date.now() });
  renderHomeChat();
}
