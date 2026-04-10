// app-debate-ui.js - Debate sticky banner, floor/conclude/ended modes, bottom bar, hand raise
// Extracted from app.js (PR-32)

import { refreshIcons, iconHtml } from './icons.js';

var _ctx = null;

// --- Module-owned state ---
var debateStickyState = null;
var debateHandRaiseOpen = false;
var debateFloorMode = false;
var debateConcludeMode = false;
var debateEndedMode = false;

export function initDebateUi(ctx) {
  _ctx = ctx;
}

// --- State accessors ---
export function getDebateStickyState() { return debateStickyState; }
export function setDebateStickyState(v) { debateStickyState = v; }
export function getDebateFloorMode() { return debateFloorMode; }
export function getDebateConcludeMode() { return debateConcludeMode; }
export function getDebateEndedMode() { return debateEndedMode; }

// --- Debate modes ---

export function showDebateConcludeConfirm(msg) {
  showDebateConcludeMode();
}

function showDebateConcludeMode() {
  removeDebateBottomBar();
  debateConcludeMode = true;
  var inputArea = document.getElementById("input-area");
  if (inputArea) {
    inputArea.classList.add("debate-floor-mode");
    inputArea.style.display = "";
  }
  var existingBanner = document.getElementById("debate-floor-banner");
  if (existingBanner) existingBanner.remove();
  var banner = document.createElement("div");
  banner.id = "debate-floor-banner";
  banner.className = "debate-floor-banner";
  banner.innerHTML = iconHtml("check-circle") + " <span>The moderator is ready to conclude</span>" +
    '<button class="debate-floor-done-btn debate-floor-end-btn" id="debate-floor-end-btn">End Debate</button>';
  if (inputArea && inputArea.parentNode) {
    inputArea.parentNode.insertBefore(banner, inputArea);
  }
  refreshIcons();
  var endBtn = document.getElementById("debate-floor-end-btn");
  if (endBtn) {
    endBtn.addEventListener("click", function () {
      var ws = _ctx.getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "debate_conclude_response", action: "end" }));
      }
      exitDebateConcludeMode();
    });
  }
  var inputEl = document.getElementById("input");
  if (inputEl) {
    inputEl._origPlaceholder = inputEl._origPlaceholder || inputEl.placeholder;
    inputEl.placeholder = "Add a direction to continue the debate...";
    inputEl.focus();
  }
  _ctx.scrollToBottom();
}

export function exitDebateConcludeMode() {
  debateConcludeMode = false;
  var inputArea = document.getElementById("input-area");
  if (inputArea) inputArea.classList.remove("debate-floor-mode");
  var banner = document.getElementById("debate-floor-banner");
  if (banner) banner.remove();
  var inputEl = document.getElementById("input");
  if (inputEl && inputEl._origPlaceholder) {
    inputEl.placeholder = inputEl._origPlaceholder;
    delete inputEl._origPlaceholder;
  }
}

export function handleDebateConcludeSend() {
  var text = _ctx.inputEl.value.trim();
  var ws = _ctx.getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "debate_conclude_response", action: "continue", text: text }));
  }
  _ctx.inputEl.value = "";
  exitDebateConcludeMode();
  showDebateBottomBar("live");
}

export function showDebateEndedMode(msg) {
  removeDebateBottomBar();
  debateEndedMode = true;
  var inputArea = document.getElementById("input-area");
  if (inputArea) {
    inputArea.classList.add("debate-floor-mode");
    inputArea.style.display = "";
  }
  var existingBanner = document.getElementById("debate-floor-banner");
  if (existingBanner) existingBanner.remove();
  var banner = document.createElement("div");
  banner.id = "debate-floor-banner";
  banner.className = "debate-floor-banner";
  banner.innerHTML = iconHtml("check-circle") + " <span>Debate ended</span>" +
    '<button class="debate-floor-done-btn" id="debate-ended-resume-btn">Resume</button>' +
    '<button class="debate-floor-done-btn" id="debate-ended-pdf-btn">' + iconHtml("download") + ' PDF</button>';
  if (inputArea && inputArea.parentNode) {
    inputArea.parentNode.insertBefore(banner, inputArea);
  }
  refreshIcons();
  var resumeBtn = document.getElementById("debate-ended-resume-btn");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", function () {
      handleDebateEndedSend();
    });
  }
  var pdfBtn = document.getElementById("debate-ended-pdf-btn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", function () {
      pdfBtn.disabled = true;
      _ctx.exportDebateAsPdf().then(function () { pdfBtn.disabled = false; }).catch(function () { pdfBtn.disabled = false; });
    });
  }
  var inputEl2 = document.getElementById("input");
  if (inputEl2) {
    inputEl2._origPlaceholder = inputEl2._origPlaceholder || inputEl2.placeholder;
    inputEl2.placeholder = "Continue with a new direction...";
  }
  _ctx.scrollToBottom();
}

export function exitDebateEndedMode() {
  debateEndedMode = false;
  var inputArea = document.getElementById("input-area");
  if (inputArea) inputArea.classList.remove("debate-floor-mode");
  var banner = document.getElementById("debate-floor-banner");
  if (banner) banner.remove();
  var inputEl2 = document.getElementById("input");
  if (inputEl2 && inputEl2._origPlaceholder) {
    inputEl2.placeholder = inputEl2._origPlaceholder;
    delete inputEl2._origPlaceholder;
  }
}

function handleDebateEndedSend() {
  var text = _ctx.inputEl.value.trim();
  var ws = _ctx.getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "debate_conclude_response", action: "continue", text: text }));
  }
  _ctx.inputEl.value = "";
  exitDebateEndedMode();
}

export function showDebateUserFloor(msg) {
  removeDebateBottomBar();
  debateFloorMode = true;
  var inputArea = document.getElementById("input-area");
  if (inputArea) {
    inputArea.classList.add("debate-floor-mode");
    inputArea.style.display = "";
  }
  var existingBanner = document.getElementById("debate-floor-banner");
  if (existingBanner) existingBanner.remove();
  var banner = document.createElement("div");
  banner.id = "debate-floor-banner";
  banner.className = "debate-floor-banner";
  banner.innerHTML = iconHtml("mic") + " <span>You have the floor</span>" +
    '<button class="debate-floor-done-btn" id="debate-floor-done-btn">Pass</button>';
  if (inputArea && inputArea.parentNode) {
    inputArea.parentNode.insertBefore(banner, inputArea);
  }
  refreshIcons();
  var doneBtn = document.getElementById("debate-floor-done-btn");
  if (doneBtn) {
    doneBtn.addEventListener("click", function () {
      var ws = _ctx.getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "debate_user_floor_response", text: "(The user passed without speaking)" }));
      }
      exitDebateFloorMode();
      showDebateBottomBar("live");
    });
  }
  var inputEl = document.getElementById("input");
  if (inputEl) {
    inputEl._origPlaceholder = inputEl.placeholder;
    inputEl.placeholder = "Share your thoughts with the panel...";
    inputEl.focus();
  }
  _ctx.scrollToBottom();
}

export function exitDebateFloorMode() {
  debateFloorMode = false;
  var inputArea = document.getElementById("input-area");
  if (inputArea) inputArea.classList.remove("debate-floor-mode");
  var banner = document.getElementById("debate-floor-banner");
  if (banner) banner.remove();
  var inputEl = document.getElementById("input");
  if (inputEl && inputEl._origPlaceholder) {
    inputEl.placeholder = inputEl._origPlaceholder;
    delete inputEl._origPlaceholder;
  }
}

export function handleDebateFloorSend() {
  var text = _ctx.inputEl.value.trim();
  if (!text) return;
  var ws = _ctx.getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "debate_user_floor_response", text: text }));
  }
  _ctx.inputEl.value = "";
  exitDebateFloorMode();
  showDebateBottomBar("live");
}

export function renderDebateUserFloorDone(msg) {
  var messagesEl = _ctx.messagesEl;
  if (!messagesEl) return;
  var el = document.createElement("div");
  el.className = "debate-user-comment";
  var label = document.createElement("span");
  label.className = "debate-comment-label";
  label.innerHTML = iconHtml("mic") + " User:";
  var textEl = document.createElement("div");
  textEl.className = "debate-comment-text";
  textEl.textContent = msg.text || "";
  el.appendChild(label);
  el.appendChild(textEl);
  messagesEl.appendChild(el);
  refreshIcons();
  _ctx.scrollToBottom();
}

// --- Debate sticky banner ---

export function showDebateSticky(phase, msg) {
  if (phase === "ended" || phase === "hide") {
    debateStickyState = null;
  } else {
    debateStickyState = { phase: phase, msg: msg };
  }

  var stickyEl = document.getElementById("debate-sticky");
  if (stickyEl) { stickyEl.classList.add("hidden"); stickyEl.innerHTML = ""; }

  var oldBadges = document.querySelectorAll(".debate-header-badge");
  for (var i = 0; i < oldBadges.length; i++) oldBadges[i].remove();

  if (phase === "ended" || phase === "hide") {
    debateHandRaiseOpen = false;
    removeDebateBottomBar();
    return;
  }

  if (phase === "live") {
    debateHandRaiseOpen = false;
    showDebateBottomBar("live");
  }

  var headerTitle = document.getElementById("header-title");
  if (!headerTitle) return;

  if (phase === "preparing") {
    var badge = document.createElement("span");
    badge.className = "debate-header-badge preparing";
    badge.textContent = "Setting up\u2026";
    headerTitle.after(badge);
  } else if (phase === "live") {
    var liveBadge = document.createElement("span");
    liveBadge.className = "debate-header-badge live";
    liveBadge.textContent = "Live";
    headerTitle.after(liveBadge);

    var roundBadge = document.createElement("span");
    roundBadge.className = "debate-header-badge round";
    roundBadge.id = "debate-header-round";
    roundBadge.textContent = "R" + ((msg && msg.round) || 1);
    liveBadge.after(roundBadge);
  }
}

// --- Debate bottom bar ---

export function showDebateBottomBar(mode, msg) {
  removeDebateBottomBar();

  var inputArea = document.getElementById("input-area");
  if (!inputArea || !inputArea.parentNode) return;

  var bar = document.createElement("div");
  bar.id = "debate-bottom-bar";
  bar.className = "debate-bottom-bar";

  if (mode === "live") {
    bar.innerHTML =
      '<div class="debate-bottom-inner">' +
        '<button class="debate-bottom-hand" id="debate-bottom-hand">' + iconHtml("hand") + ' Raise hand</button>' +
        '<span class="debate-bottom-waiting hidden" id="debate-bottom-waiting">' + iconHtml("loader") + ' You will get the floor after the current speaker</span>' +
        '<button class="debate-bottom-stop" id="debate-bottom-stop">' + iconHtml("square") + ' Stop</button>' +
      '</div>';

    inputArea.parentNode.insertBefore(bar, inputArea);
    inputArea.style.display = "none";
    refreshIcons();

    if (debateHandRaiseOpen) {
      var handBtn = document.getElementById("debate-bottom-hand");
      var waitingEl = document.getElementById("debate-bottom-waiting");
      if (handBtn) { handBtn.classList.add("raised"); handBtn.classList.add("hidden"); }
      if (waitingEl) waitingEl.classList.remove("hidden");
    }

    document.getElementById("debate-bottom-hand").addEventListener("click", function () {
      toggleDebateHandRaise();
    });
    document.getElementById("debate-bottom-stop").addEventListener("click", function () {
      var ws = _ctx.getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "debate_stop" }));
        var stopBtn = document.getElementById("debate-bottom-stop");
        if (stopBtn) {
          stopBtn.disabled = true;
          stopBtn.innerHTML = iconHtml("loader") + " Stopping...";
          refreshIcons();
        }
        var waitingEl2 = document.getElementById("debate-bottom-waiting");
        if (waitingEl2) {
          waitingEl2.textContent = "Stopping after current turn...";
          waitingEl2.classList.remove("hidden");
        }
      }
    });
  }
}

export function debateAutoResize(textarea, maxRows) {
  textarea.style.height = "auto";
  var lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
  var maxHeight = lineHeight * maxRows;
  var newHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = newHeight + "px";
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

export function removeDebateBottomBar() {
  var existing = document.getElementById("debate-bottom-bar");
  if (existing) existing.remove();
  var handBar = document.getElementById("debate-hand-raise-bar");
  if (handBar) handBar.remove();
  debateHandRaiseOpen = false;
  if (debateFloorMode) exitDebateFloorMode();
  if (debateConcludeMode) exitDebateConcludeMode();
  if (debateEndedMode) exitDebateEndedMode();
  var inputArea = document.getElementById("input-area");
  if (inputArea) inputArea.style.display = "";
}

function toggleDebateHandRaise(forceState) {
  var raise = typeof forceState === "boolean" ? forceState : !debateHandRaiseOpen;
  debateHandRaiseOpen = raise;

  var handBtn = document.getElementById("debate-bottom-hand");
  var waitingEl = document.getElementById("debate-bottom-waiting");
  if (raise) {
    if (handBtn) { handBtn.classList.add("raised"); handBtn.classList.add("hidden"); }
    if (waitingEl) waitingEl.classList.remove("hidden");
  } else {
    if (handBtn) { handBtn.classList.remove("raised"); handBtn.classList.remove("hidden"); }
    if (waitingEl) waitingEl.classList.add("hidden");
  }

  var ws = _ctx.getWs();
  if (raise && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "debate_hand_raise" }));
  }
}

export function sendDebateStickyComment() {
  var commentInput = document.getElementById("debate-sticky-comment");
  if (!commentInput) return;
  var text = commentInput.value.trim();
  if (!text) return;
  var ws = _ctx.getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "debate_comment", text: text }));
  }
  toggleDebateHandRaise(false);
}

export function updateDebateRound(round) {
  var roundEl = document.getElementById("debate-header-round");
  if (roundEl) roundEl.textContent = "R" + round;
}
