export function showToast(message, level, detail) {
  var el = document.createElement("div");
  el.className = "toast";
  if (level) el.classList.add("toast-" + level);
  el.textContent = message;
  if (detail) {
    var detailEl = document.createElement("div");
    detailEl.style.cssText = "font-size:11px;opacity:0.7;margin-top:4px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    detailEl.textContent = detail.split("\n")[0];
    el.appendChild(detailEl);
  }
  document.body.appendChild(el);
  requestAnimationFrame(function () { el.classList.add("visible"); });
  var duration = level === "warn" ? 5000 : 1500;
  setTimeout(function () {
    el.classList.remove("visible");
    setTimeout(function () { el.remove(); }, 300);
  }, duration);
}

var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function copyToClipboard(text) {
  var p;
  if (isIOS) {
    // iOS Safari URL-encodes clipboard text that contains colons via the
    // Clipboard API. Use textarea + execCommand to copy raw text instead.
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    document.execCommand("copy");
    document.body.removeChild(ta);
    p = Promise.resolve();
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    p = navigator.clipboard.writeText(text);
  } else {
    var ta2 = document.createElement("textarea");
    ta2.value = text;
    ta2.style.cssText = "position:fixed;left:-9999px;opacity:0";
    document.body.appendChild(ta2);
    ta2.focus();
    ta2.setSelectionRange(0, ta2.value.length);
    document.execCommand("copy");
    document.body.removeChild(ta2);
    p = Promise.resolve();
  }
  return p.then(function () { showToast("Copied to clipboard"); });
}

export function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
