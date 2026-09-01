// Pure correlation and transcript helpers for the Home conversation stream.

export function isOwnedHomeSessionMessage(active, msg) {
  if (!msg || msg.mateId !== active.mateId) return false;
  if (msg.requestId && msg.requestId !== active.requestId) return false;
  if (active.sessionId && msg.sessionId && msg.sessionId !== active.sessionId) return false;
  return true;
}

export function resolveHomeSessionIdentity(active, msg) {
  if (!msg || msg.mateId !== active.mateId) return null;
  if (msg.requestId && msg.requestId !== active.requestId) return null;
  if (!msg.previousSessionId || !msg.sessionId) return null;
  if (active.sessionId !== msg.previousSessionId) return null;
  return msg.sessionId;
}

export function appendHomeStreamText(current, incoming) {
  return current + (typeof incoming === "string" ? incoming : "");
}

export function finalizeHomeAssistant(messages, streamingText, finalText, timestamp) {
  var text = typeof finalText === "string" && finalText ? finalText : streamingText;
  if (!text) return messages;
  var last = messages.length ? messages[messages.length - 1] : null;
  if (last && last.role === "assistant" && last.text === text) return messages;
  var next = messages.slice();
  if (last && last.role === "assistant" && text.indexOf(last.text) === 0) {
    next[next.length - 1] = { role: "assistant", text: text, ts: timestamp };
    return next;
  }
  next.push({ role: "assistant", text: text, ts: timestamp });
  return next;
}
