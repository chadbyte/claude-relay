export function showToast(message) {
  var el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(function () { el.classList.add("visible"); });
  setTimeout(function () {
    el.classList.remove("visible");
    setTimeout(function () { el.remove(); }, 300);
  }, 1500);
}

export function copyToClipboard(text) {
  var p;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    p = navigator.clipboard.writeText(text);
  } else {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    p = Promise.resolve();
  }
  return p.then(function () { showToast("Copied to clipboard"); });
}

export function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
