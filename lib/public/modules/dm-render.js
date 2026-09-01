// dm-render.js - Shared DOM builders for DM-style messages and typing state.

export function buildDmMessage(msg, options) {
  options = options || {};
  var container = options.container || null;
  var timestamp = typeof msg.ts === "number" ? msg.ts : 0;
  var date = new Date(timestamp);
  var timeStr = date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0");
  var previous = container ? container.lastElementChild : null;
  var compact = false;
  if (previous && previous.dataset.from === String(msg.from || "")) {
    var previousTimestamp = parseInt(previous.dataset.ts || "0", 10);
    if (timestamp - previousTimestamp < 300000) compact = true;
  }

  var row = document.createElement("div");
  row.className = "dm-msg" + (compact ? " dm-msg-compact" : "");
  row.dataset.from = msg.from || "";
  row.dataset.ts = timestamp;

  if (compact) {
    var hoverTime = document.createElement("span");
    hoverTime.className = "dm-msg-hover-time";
    hoverTime.textContent = timeStr;
    row.appendChild(hoverTime);

    var compactBody = document.createElement("div");
    compactBody.className = "dm-msg-body";
    compactBody.textContent = msg.text || "";
    row.appendChild(compactBody);
    return row;
  }

  var avatar = document.createElement("img");
  avatar.className = "dm-msg-avatar";
  avatar.src = options.avatarUrl || "";
  avatar.alt = "";
  row.appendChild(avatar);

  var content = document.createElement("div");
  content.className = "dm-msg-content";

  var header = document.createElement("div");
  header.className = "dm-msg-header";

  var name = document.createElement("span");
  name.className = "dm-msg-name";
  name.textContent = options.displayName || (options.isMe ? "Me" : "User");
  header.appendChild(name);

  var time = document.createElement("span");
  time.className = "dm-msg-time";
  time.textContent = timeStr;
  header.appendChild(time);
  content.appendChild(header);

  var body = document.createElement("div");
  body.className = "dm-msg-body";
  body.textContent = msg.text || "";
  content.appendChild(body);
  row.appendChild(content);
  return row;
}

export function buildDmTypingIndicator(options) {
  options = options || {};
  var row = document.createElement("div");
  if (options.id) row.id = options.id;
  row.className = "dm-msg dm-typing-indicator";

  var avatar = document.createElement("img");
  avatar.className = "dm-msg-avatar";
  avatar.src = options.avatarUrl || "";
  avatar.alt = "";
  row.appendChild(avatar);

  var dots = document.createElement("div");
  dots.className = "dm-typing-dots";
  dots.innerHTML = "<span></span><span></span><span></span>";
  row.appendChild(dots);
  return row;
}
