// home-chat-identity.js - Stable speaker identity for ordinary Home conversations.
import { mateAvatarUrl } from './avatar.js';
import { createAssistantBubble, createUserBubble } from './chat-bubble-renderer.js';

export function createHomeOrdinaryBubble(message, mate, mateName, time) {
  var isUser = message && message.role === "user";
  var name = isUser ? "You" : (mateName || "Mate");
  var row = isUser ? createUserBubble({
    text: message.text || "",
  }) : createAssistantBubble({
    name: name,
    avatarUrl: mateAvatarUrl(mate, 34),
    time: time || "",
  });
  row.classList.add("home-chat-message", "home-chat-ordinary-message", isUser ? "home-chat-ordinary-user" : "home-chat-ordinary-mate");
  row.setAttribute("role", "article");
  row.setAttribute("aria-label", "Message from " + name);
  return row;
}

export function createHomeOrdinaryTyping(mate, mateName) {
  var row = createHomeOrdinaryBubble({ role: "assistant", text: "" }, mate, mateName, "");
  row.classList.add("home-chat-ordinary-typing");
  var content = row.querySelector(".md-content");
  if (!content) return row;
  content.className = "home-chat-typing";
  content.setAttribute("role", "status");
  content.setAttribute("aria-label", (mateName || "Mate") + " is responding");
  for (var i = 0; i < 3; i++) {
    var dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    content.appendChild(dot);
  }
  return row;
}

// A Capsule engagement note: a quiet centered system line, not a speech
// bubble, because no one typed it.
export function createCapsuleTurnNote(message) {
  var note = document.createElement("div");
  note.className = "home-capsule-turn-note";
  note.textContent = (message && message.text) || "";
  return note;
}
