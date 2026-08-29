import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { showToast } from './utils.js';

var defaultPlaceholder = "";

function getInput() {
  return document.getElementById("input");
}

function appendToMessages(element) {
  var messages = document.getElementById("messages");
  if (!messages) return;
  messages.appendChild(element);
  requestAnimationFrame(function () { messages.scrollTop = messages.scrollHeight; });
}

function setMode(active) {
  var input = getInput();
  var button = document.getElementById("shell-command-btn");
  var row = document.getElementById("input-row");
  store.set({ shellCommandMode: active });
  if (button) {
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (row) row.classList.toggle("shell-command-mode", active);
  if (input) {
    if (!defaultPlaceholder) defaultPlaceholder = input.placeholder;
    input.placeholder = active ? "Run a shell command in this project…" : defaultPlaceholder;
    input.focus();
  }
}

export function isShellCommandMode() {
  return !!store.get("shellCommandMode");
}

export function toggleShellCommandMode() {
  if (store.get("shellCommandRunning")) return;
  var target = store.get("dmTargetUser");
  if (store.get("dmMode") && target && !target.isMate) {
    showToast("Shell commands are available in agent sessions, not user DMs.", "error");
    return;
  }
  setMode(!isShellCommandMode());
}

function renderPendingCommand(requestId, command) {
  var card = document.createElement("div");
  card.className = "shell-command-card running";
  card.dataset.requestId = requestId;
  card.innerHTML =
    '<div class="shell-command-header">' +
      '<span class="shell-command-icon">' + iconHtml("square-terminal") + '</span>' +
      '<code></code><span class="shell-command-status">Running…</span>' +
    '</div>' +
    '<pre class="shell-command-output">Waiting for output…</pre>';
  card.querySelector("code").textContent = "$ " + command;
  appendToMessages(card);
  refreshIcons();
}

export function submitShellCommand(command) {
  command = String(command || "").trim();
  if (!command || store.get("shellCommandRunning")) return false;
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    showToast("Not connected — command not run.", "error");
    return false;
  }

  var requestId = "shell_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
  store.set({ shellCommandRunning: true, pendingShellCommandId: requestId });
  var input = getInput();
  if (input) {
    input.disabled = true;
    input.placeholder = "Running command…";
  }
  renderPendingCommand(requestId, command);
  ws.send(JSON.stringify({ type: "shell_command", requestId: requestId, command: command }));
  return true;
}

export function handleShellCommandResult(msg) {
  var cards = document.querySelectorAll(".shell-command-card[data-request-id]");
  var card = null;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].dataset.requestId === (msg.requestId || "")) {
      card = cards[i];
      break;
    }
  }
  if (card) {
    var status = card.querySelector(".shell-command-status");
    var output = card.querySelector(".shell-command-output");
    card.classList.remove("running");
    if (msg.error) {
      card.classList.add("error");
      if (status) status.textContent = "Failed";
      if (output) output.textContent = msg.error;
    } else {
      card.classList.toggle("error", msg.exitCode !== 0);
      if (status) status.textContent = msg.timedOut ? "Timed out" : "Exit " + (msg.exitCode == null ? "—" : msg.exitCode);
      if (output) output.textContent = msg.output || "(no output)";
    }
  }

  store.set({ shellCommandRunning: false, pendingShellCommandId: null });
  var input = getInput();
  if (input) input.disabled = false;
  if (msg.error) {
    setMode(true);
  } else {
    setMode(false);
  }
  var messages = document.getElementById("messages");
  if (messages) requestAnimationFrame(function () { messages.scrollTop = messages.scrollHeight; });
}

export function initShellCommand() {
  var button = document.getElementById("shell-command-btn");
  var mobileButton = document.getElementById("input-more-shell");
  if (button) button.addEventListener("click", toggleShellCommandMode);
  if (mobileButton) {
    mobileButton.addEventListener("click", function () {
      var sheet = document.getElementById("input-more-sheet");
      if (sheet) {
        sheet.classList.remove("open");
        setTimeout(function () { sheet.classList.add("hidden"); }, 250);
      }
      toggleShellCommandMode();
    });
  }
  store.subscribe(function (state, previous) {
    if (previous.connected && !state.connected && state.shellCommandRunning) {
      resetShellCommand();
    }
  });
}

export function resetShellCommand() {
  store.set({ shellCommandMode: false, shellCommandRunning: false, pendingShellCommandId: null });
  var input = getInput();
  if (input) input.disabled = false;
  setMode(false);
}
