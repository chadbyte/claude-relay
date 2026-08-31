// Transient launch presentation for a new Home debate-planning conversation.

var pendingRequestId = null;

export function beginHomeDebateLaunch(requestId) {
  pendingRequestId = requestId || null;
}

export function resetHomeDebateLaunch() {
  pendingRequestId = null;
}

export function settleHomeDebateLaunch(msg) {
  if (!pendingRequestId || !msg || msg.requestId !== pendingRequestId) return false;
  pendingRequestId = null;
  return true;
}

export function syncHomeDebateLaunchHistory(msg) {
  if (!msg) return false;
  var hasMessages = Array.isArray(msg.messages) && msg.messages.length > 0;
  if (msg.debatePlanning === true && !hasMessages) {
    pendingRequestId = msg.requestId || "restored-debate-planning";
    return true;
  }
  return settleHomeDebateLaunch(msg);
}

export function isHomeDebateLaunching() {
  return !!pendingRequestId;
}

export function createHomeDebateLaunchRow() {
  var row = document.createElement("div");
  row.className = "home-debate-preparing";
  row.setAttribute("role", "status");
  row.setAttribute("aria-live", "polite");
  var label = document.createElement("span");
  label.className = "home-debate-preparing-label";
  label.textContent = "Preparing debate…";
  row.appendChild(label);
  var dots = document.createElement("span");
  dots.className = "home-debate-preparing-dots";
  dots.setAttribute("aria-hidden", "true");
  for (var i = 0; i < 3; i++) dots.appendChild(document.createElement("span"));
  row.appendChild(dots);
  return row;
}
