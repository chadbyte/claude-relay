// home-mate-chat.js - Embedded conversation surface for the selected mate.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { openHomeMateProperty } from './home-mate-properties.js';
import { openDebateModal } from './debate.js';
import { openHomeDock } from './home-dock.js';

var messages = [];
var streamingText = "";
var streaming = false;
var bound = false;
var animateSwitch = false;
var chatEl = null;
var actionsEl = null;
var stageEl = null;
var messagesEl = null;
var suggestionsEl = null;
var inputEl = null;
var sendBtn = null;
var actionsMenu = null;
var actionsMenuAnchor = null;

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

function submitSuggestion(text) {
  if (!inputEl || !text) return;
  if (text === "Add a card to the board") openHomeDock("board");
  inputEl.value = text;
  resizeInput();
  submitMessage();
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
  if (!actionsEl) actionsEl = document.getElementById("home-mate-chat-actions");
  if (!stageEl) stageEl = chatEl ? chatEl.querySelector(".home-mate-chat-stage") : null;
  if (!messagesEl) messagesEl = document.getElementById("home-mate-chat-messages");
  if (!suggestionsEl) suggestionsEl = document.getElementById("home-mate-chat-suggestions");
  if (!inputEl) inputEl = document.getElementById("home-mate-chat-input");
  if (!sendBtn) sendBtn = document.getElementById("home-mate-chat-send");
  bindComposer();
  return !!(chatEl && actionsEl && stageEl && messagesEl && suggestionsEl && inputEl && sendBtn);
}

function closeActionsMenu() {
  if (actionsMenu) {
    actionsMenu.remove();
    actionsMenu = null;
  }
  if (actionsMenuAnchor) actionsMenuAnchor.setAttribute("aria-expanded", "false");
  actionsMenuAnchor = null;
  document.removeEventListener("click", handleActionsMenuOutside, true);
  document.removeEventListener("keydown", handleActionsMenuKeydown);
}

function handleActionsMenuOutside(event) {
  if (!actionsMenu || actionsMenu.contains(event.target)) return;
  if (actionsMenuAnchor && actionsMenuAnchor.contains(event.target)) return;
  closeActionsMenu();
}

function handleActionsMenuKeydown(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  var anchor = actionsMenuAnchor;
  closeActionsMenu();
  if (anchor) anchor.focus();
}

function positionActionsMenu(anchor, menu) {
  var rect = anchor.getBoundingClientRect();
  var menuRect = menu.getBoundingClientRect();
  menu.style.left = Math.max(12, rect.right - menuRect.width) + "px";
  menu.style.top = (rect.bottom + 8) + "px";
  if (rect.bottom + 8 + menuRect.height > window.innerHeight - 12) {
    menu.style.top = Math.max(12, rect.top - menuRect.height - 8) + "px";
  }
}

function addActionsMenuItem(menu, icon, label, onClick) {
  var item = document.createElement("button");
  item.type = "button";
  item.className = "home-mate-actions-menu-item";
  item.innerHTML = iconHtml(icon) + "<span></span>";
  item.querySelector("span").textContent = label;
  item.addEventListener("click", function () {
    closeActionsMenu();
    onClick();
  });
  menu.appendChild(item);
}

function showActionsMenu(anchor, mate, mateName) {
  closeActionsMenu();
  var menu = document.createElement("div");
  menu.className = "home-mate-actions-menu";
  menu.setAttribute("role", "menu");
  addActionsMenuItem(menu, "brain", "Memory", function () {
    openHomeMateProperty("memory", mate.id, mateName);
  });
  addActionsMenuItem(menu, "book-open", "Knowledge", function () {
    openHomeMateProperty("knowledge", mate.id, mateName);
  });
  addActionsMenuItem(menu, "mic", "Start debate", function () {
    window.dispatchEvent(new CustomEvent("clay:home-debate"));
    openDebateModal({
      dmContext: messages.map(function (message) {
        return { text: message.text, isMate: message.role === "assistant" };
      }),
    });
  });
  document.body.appendChild(menu);
  actionsMenu = menu;
  actionsMenuAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  refreshIcons();
  requestAnimationFrame(function () { positionActionsMenu(anchor, menu); });
  setTimeout(function () {
    document.addEventListener("click", handleActionsMenuOutside, true);
    document.addEventListener("keydown", handleActionsMenuKeydown);
  }, 0);
}

function renderActions(mate, mateName) {
  closeActionsMenu();
  actionsEl.innerHTML = "";
  if (!mate) return;
  var newButton = document.createElement("button");
  newButton.type = "button";
  newButton.className = "home-mate-chat-new";
  newButton.textContent = "New chat";
  newButton.disabled = streaming;
  newButton.addEventListener("click", startNewChat);
  actionsEl.appendChild(newButton);

  var overflow = document.createElement("button");
  overflow.type = "button";
  overflow.className = "home-mate-chat-overflow";
  overflow.setAttribute("aria-label", "Mate actions");
  overflow.setAttribute("aria-haspopup", "menu");
  overflow.setAttribute("aria-expanded", "false");
  overflow.innerHTML = iconHtml("more-horizontal");
  overflow.addEventListener("click", function () {
    if (actionsMenu) closeActionsMenu();
    else showActionsMenu(overflow, mate, mateName);
  });
  actionsEl.appendChild(overflow);
  refreshIcons();
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  var date = new Date(timestamp);
  return date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0");
}

function appendMessage(message) {
  var isUser = message.role === "user";
  var row = document.createElement("div");
  row.className = "home-chat-message " + (isUser ? "home-chat-message-user" : "home-chat-message-assistant");
  var content = document.createElement("div");
  content.className = "home-chat-message-content";
  content.textContent = message.text || "";
  row.appendChild(content);
  var timeText = formatTime(typeof message.ts === "number" ? message.ts : 0);
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
  var greeting = document.createElement("h2");
  greeting.textContent = mate ? "What should we work on, " + mateName + "?" : "Choose a mate to begin.";
  empty.appendChild(greeting);
  var detail = document.createElement("p");
  detail.textContent = mate ? shortBio(mate) : "Select someone to start a conversation.";
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
  renderActions(mate, mateName);
  messagesEl.innerHTML = "";
  suggestionsEl.innerHTML = "";
  if (hasConversation) {
    var transcript = document.createElement("div");
    transcript.className = "home-mate-chat-transcript";
    for (var i = 0; i < messages.length; i++) transcript.appendChild(appendMessage(messages[i]));
    if (streamingText) {
      transcript.appendChild(appendMessage({ role: "assistant", text: streamingText, ts: Date.now() }));
    } else if (streaming && mate) {
      transcript.appendChild(buildTypingIndicator());
    }
    messagesEl.appendChild(transcript);
  } else {
    renderEmptyState(mate, mateName);
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
  closeActionsMenu();
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
