// app-misc.js - Modals (image, paste, confirm), force PIN, PWA install, extension bridge
// Extracted from app.js (PR-34)

import { refreshIcons, iconHtml } from './icons.js';
import { escapeHtml, copyToClipboard } from './utils.js';

var _ctx = null;

// --- Module-owned state ---
var confirmCallback = null;
var _extRequestCallbacks = {};

export function initMisc(ctx) {
  _ctx = ctx;

  // --- Confirm modal listeners ---
  var confirmModal = _ctx.$("confirm-modal");
  var confirmOk = _ctx.$("confirm-ok");
  var confirmCancel = _ctx.$("confirm-cancel");

  confirmOk.addEventListener("click", function () {
    if (confirmCallback) confirmCallback();
    hideConfirm();
  });

  confirmCancel.addEventListener("click", hideConfirm);
  confirmModal.querySelector(".confirm-backdrop").addEventListener("click", hideConfirm);

  // --- PWA install prompt ---
  (function () {
    var installPill = document.getElementById("pwa-install-pill");
    var modal = document.getElementById("pwa-install-modal");
    var confirmBtn = document.getElementById("pwa-modal-confirm");
    var cancelBtn = document.getElementById("pwa-modal-cancel");
    if (!installPill || !modal) return;

    // Already standalone -- never show
    if (document.documentElement.classList.contains("pwa-standalone")) return;

    // Show pill on mobile browsers (the primary target for PWA install)
    var isMobile = /Mobi|Android|iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isMobile) {
      installPill.classList.remove("hidden");
    }

    // Also show on desktop if beforeinstallprompt fires
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      installPill.classList.remove("hidden");
    });

    function openModal() {
      modal.classList.remove("hidden");
      lucide.createIcons({ nodes: [modal] });
    }

    function closeModal() {
      modal.classList.add("hidden");
    }

    installPill.addEventListener("click", openModal);
    cancelBtn.addEventListener("click", closeModal);
    modal.querySelector(".pwa-modal-backdrop").addEventListener("click", closeModal);

    confirmBtn.addEventListener("click", function () {
      // Builtin cert (*.d.clay.studio): open PWA setup guide
      if (location.hostname.endsWith(".d.clay.studio")) {
        closeModal();
        location.href = "/pwa";
        return;
      }
      // mkcert / other: redirect to onboarding setup page
      var port = parseInt(location.port, 10);
      var setupUrl;
      if (!port) {
        // Standard port (443/80), behind a reverse proxy with real cert
        setupUrl = location.protocol + "//" + location.hostname + "/setup";
      } else {
        // Non-standard port, Clay serving directly with onboarding server on port+1
        setupUrl = "http://" + location.hostname + ":" + (port + 1) + "/setup";
      }
      location.href = setupUrl;
    });

    // Hide after install
    window.addEventListener("appinstalled", function () {
      installPill.classList.add("hidden");
      closeModal();
    });
  })();

  // --- Extension bridge window message listener ---
  window.addEventListener("message", function(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "clay-chrome-extension") return;
    var msg = event.data.payload;

    if (msg.type === "clay_ext_tab_list") {
      _ctx.updateBrowserTabList(msg.tabs);
      // Also inform server about tab list
      var ws = _ctx.getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "browser_tab_list",
          tabs: msg.tabs
        }));
      }
    }
    if (msg.type === "clay_ext_result") {
      handleExtensionResult(msg.requestId, msg.result);
    }
  });
}

export function showImageModal(src) {
  var modal = _ctx.$("image-modal");
  var img = _ctx.$("image-modal-img");
  if (!modal || !img) return;
  img.src = src;
  modal.classList.remove("hidden");
  refreshIcons(modal);
}

export function closeImageModal() {
  var modal = _ctx.$("image-modal");
  if (modal) modal.classList.add("hidden");
}

export function showPasteModal(text) {
  var modal = _ctx.$("paste-modal");
  var body = _ctx.$("paste-modal-body");
  if (!modal || !body) return;
  body.textContent = text;
  modal.classList.remove("hidden");
}

export function closePasteModal() {
  var modal = _ctx.$("paste-modal");
  if (modal) modal.classList.add("hidden");
}

export function showConfirm(text, onConfirm, okLabel, destructive) {
  var confirmText = _ctx.$("confirm-text");
  var confirmOk = _ctx.$("confirm-ok");
  var confirmModal = _ctx.$("confirm-modal");
  confirmText.textContent = text;
  confirmCallback = onConfirm;
  confirmOk.textContent = okLabel || "Delete";
  confirmOk.className = "confirm-btn " + (destructive === false ? "confirm-ok" : "confirm-delete");
  confirmModal.classList.remove("hidden");
}

export function hideConfirm() {
  var confirmModal = _ctx.$("confirm-modal");
  confirmModal.classList.add("hidden");
  confirmCallback = null;
}

export function showForceChangePinOverlay() {
  var ov = document.createElement("div");
  ov.id = "force-change-pin-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:var(--bg,#0e0e10);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column";
  ov.innerHTML = '<div style="width:100%;max-width:380px;padding:24px;text-align:center">' +
    '<h2 style="margin:0 0 8px;color:var(--text,#fff);font-size:22px">Set your new PIN</h2>' +
    '<p style="margin:0 0 24px;color:var(--text-secondary,#aaa);font-size:14px">Your temporary PIN has expired. Please set a new 6-digit PIN to continue.</p>' +
    '<div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px" id="fcp-boxes">' +
    '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
    '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
    '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
    '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
    '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
    '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
    '</div>' +
    '<button id="fcp-save" disabled style="width:100%;padding:12px;border:none;border-radius:10px;background:var(--accent,#7c3aed);color:#fff;font-size:15px;font-weight:600;cursor:pointer;opacity:0.5">Save PIN</button>' +
    '<div id="fcp-err" style="margin-top:12px;color:#ef4444;font-size:13px"></div>' +
    '</div>';
  document.body.appendChild(ov);

  var boxes = ov.querySelectorAll(".fcp-digit");
  var saveBtn = ov.querySelector("#fcp-save");
  var errEl = ov.querySelector("#fcp-err");
  var pinValues = ["", "", "", "", "", ""];

  function setDigit(idx, v) {
    pinValues[idx] = v;
    boxes[idx].value = v ? "\u2022" : "";
    boxes[idx].classList.toggle("filled", v.length > 0);
  }

  function getPin() {
    return pinValues.join("");
  }

  function updateBtn() {
    var ready = getPin().length === 6;
    saveBtn.disabled = !ready;
    saveBtn.style.opacity = ready ? "1" : "0.5";
  }

  for (var i = 0; i < boxes.length; i++) {
    (function (idx) {
      boxes[idx].addEventListener("input", function () {
        var raw = this.value.replace(/[^0-9]/g, "");
        if (!raw) { setDigit(idx, ""); updateBtn(); return; }
        var v = raw.charAt(raw.length - 1);
        setDigit(idx, v);
        if (v && idx < 5) boxes[idx + 1].focus();
        updateBtn();
      });
      boxes[idx].addEventListener("keydown", function (e) {
        if (e.key === "Backspace") {
          if (!pinValues[idx] && idx > 0) {
            setDigit(idx - 1, "");
            boxes[idx - 1].focus();
          } else {
            setDigit(idx, "");
          }
          updateBtn();
        }
        if (e.key === "ArrowLeft" && idx > 0) boxes[idx - 1].focus();
        if (e.key === "ArrowRight" && idx < 5) boxes[idx + 1].focus();
        if (e.key === "Enter" && !saveBtn.disabled) doSave();
        e.stopPropagation();
      });
      boxes[idx].addEventListener("keyup", function (e) { e.stopPropagation(); });
      boxes[idx].addEventListener("keypress", function (e) { e.stopPropagation(); });
      boxes[idx].addEventListener("paste", function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData("text").replace(/[^0-9]/g, "").substring(0, 6);
        for (var j = 0; j < text.length && (idx + j) < 6; j++) {
          setDigit(idx + j, text.charAt(j));
        }
        if (text.length > 0) {
          var focusIdx = Math.min(idx + text.length, 5);
          boxes[focusIdx].focus();
        }
        updateBtn();
      });
      boxes[idx].addEventListener("focus", function () { this.select(); });
    })(i);
  }
  boxes[0].focus();

  function doSave() {
    var pin = getPin();
    if (pin.length !== 6) return;
    saveBtn.disabled = true;
    saveBtn.style.opacity = "0.5";
    errEl.textContent = "";
    fetch("/api/user/pin", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPin: pin }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        ov.remove();
        return;
      }
      errEl.textContent = d.error || "Failed to save PIN";
      saveBtn.disabled = false;
      saveBtn.style.opacity = "1";
    }).catch(function () {
      errEl.textContent = "Connection error";
      saveBtn.disabled = false;
      saveBtn.style.opacity = "1";
    });
  }
  saveBtn.addEventListener("click", doSave);
}

export function sendExtensionCommand(command, args, requestId) {
  window.postMessage({
    source: "clay-page",
    payload: {
      type: "clay_ext_command",
      command: command,
      args: args,
      requestId: requestId
    }
  }, "*");
}

export function handleExtensionResult(requestId, result) {
  // Check local callback first (for server-initiated requests)
  var cb = _extRequestCallbacks[requestId];
  if (cb) {
    delete _extRequestCallbacks[requestId];
    cb(result);
    return;
  }
  // Forward to server
  var ws = _ctx.getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: "extension_result",
      requestId: requestId,
      result: result
    }));
  }
}
