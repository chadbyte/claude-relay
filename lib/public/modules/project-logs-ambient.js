// Ambient discovery for Project Logs.
//
// The ledger accumulates alongside the work, so it should be reachable without
// being hidden and noticeable without interrupting. Two affordances:
//
//   - a slim handle on the right workbench edge that previews the pane on
//     hover or focus, and pins it open on any meaningful interaction
//   - a restrained unread marker on the toolbar button and the handle when the
//     Project Driver revises the ledger
//
// A preview is explicitly not an open: it closes itself when the pointer
// leaves and never survives an Escape. Nothing here opens the pane on its own,
// and an update never opens anything at all.

import { store } from './store.js';

var handle = null;
var closeTimer = null;
var hoverCapable = false;

// Long enough to cross the gap from handle to panel without losing the
// preview, short enough not to feel stuck.
var CLOSE_DELAY_MS = 420;

// Callbacks supplied by project-logs.js so this module never talks to the
// WebSocket or decides navigation.
var hooks = { reveal: null, hide: null, pin: null, isOpen: null, isPinned: null };

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    return false;
  }
}

// Hover preview is only offered to a device that genuinely hovers. Touch keeps
// the explicit toolbar and navigation behaviour with no hover dependency.
function detectHoverCapable() {
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch (e) {
    return false;
  }
}

function cancelClose() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function scheduleClose() {
  cancelClose();
  closeTimer = setTimeout(function () {
    closeTimer = null;
    // A pinned pane is a real open and is never closed by the pointer leaving.
    if (store.get('projectLogsPinned')) return;
    if (!store.get('projectLogsPreview')) return;
    hidePreview();
  }, CLOSE_DELAY_MS);
}

export function showPreview() {
  if (!hooks.reveal) return;
  if (store.get('projectLogsPinned') || store.get('projectLogsOpen')) return;
  cancelClose();
  if (store.get('projectLogsPreview')) return;
  store.set({ projectLogsPreview: true });
  hooks.reveal();
  syncHandle();
}

export function hidePreview() {
  cancelClose();
  if (!store.get('projectLogsPreview')) return;
  store.set({ projectLogsPreview: false });
  if (hooks.hide) hooks.hide();
  syncHandle();
}

// Any meaningful interaction turns a preview into a real open.
export function pinFromPreview() {
  cancelClose();
  if (!hooks.pin) return;
  store.set({ projectLogsPreview: false });
  hooks.pin();
  syncHandle();
}

// The handle only exists while the pane is closed; a visible pane is its own
// affordance.
function syncHandle() {
  if (!handle) return;
  var open = !!(store.get('projectLogsOpen') || store.get('projectLogsPreview'));
  handle.classList.toggle("hidden", open);
  var unread = store.get('projectLogsUnread') || 0;
  handle.classList.toggle("has-unread", unread > 0);
  handle.setAttribute("aria-label", unread > 0
    ? "Open Project Logs, " + unread + (unread === 1 ? " new entry" : " new entries")
    : "Open Project Logs");
  handle.title = handle.getAttribute("aria-label");
}

// The toolbar button carries the same unread state, so the cue is visible
// wherever the user is looking.
function syncToolbar() {
  var button = document.getElementById("project-logs-btn");
  if (!button) return;
  var unread = store.get('projectLogsUnread') || 0;
  button.classList.toggle("project-logs-unread", unread > 0);
  var badge = document.getElementById("project-logs-count");
  if (badge) {
    badge.textContent = unread > 0 ? String(unread) : "";
    badge.classList.toggle("hidden", unread < 1);
  }
}

export function syncAmbient() {
  syncHandle();
  syncToolbar();
}

// A canonical revision arrived. Mark it, never open anything.
//
// Deduped by the server-derived reference plus revision number, so a replayed
// or duplicated frame cannot inflate the count or re-trigger the flourish.
export function noteCanonicalUpdate(msg) {
  if (!msg || !msg.ref || !msg.revision) return false;
  var seen = store.get('projectLogsSeenRevisions') || {};
  var key = msg.ref;
  if (seen[key] >= msg.revision) return false;
  var next = Object.assign({}, seen);
  next[key] = msg.revision;

  // An update while the pane is open is already visible, so it is acknowledged
  // rather than counted.
  var visible = !!(store.get('projectLogsOpen') || store.get('projectLogsPinned'));
  store.set({
    projectLogsSeenRevisions: next,
    projectLogsUnread: visible ? 0 : (store.get('projectLogsUnread') || 0) + 1,
  });
  syncAmbient();
  if (!visible) flourish();
  return true;
}

// A single restrained pulse on the two ambient surfaces. Never the whole
// screen, and nothing at all when the user asked for reduced motion.
function flourish() {
  if (prefersReducedMotion()) return;
  var targets = [handle, document.getElementById("project-logs-btn")];
  for (var i = 0; i < targets.length; i++) {
    var target = targets[i];
    if (!target) continue;
    target.classList.remove("project-logs-pulse");
    // Force a reflow so the animation restarts rather than being ignored.
    void target.offsetWidth;
    target.classList.add("project-logs-pulse");
  }
}

export function acknowledgeUpdates() {
  if (!store.get('projectLogsUnread')) {
    syncAmbient();
    return;
  }
  store.set({ projectLogsUnread: 0 });
  var targets = [handle, document.getElementById("project-logs-btn")];
  for (var i = 0; i < targets.length; i++) {
    if (targets[i]) targets[i].classList.remove("project-logs-pulse");
  }
  syncAmbient();
}

export function resetAmbient() {
  cancelClose();
  store.set({
    projectLogsUnread: 0,
    projectLogsSeenRevisions: {},
    projectLogsPreview: false,
    projectLogsPinned: false,
  });
  syncAmbient();
}

// Called by project-logs.js when the pane itself is entered or left, so moving
// from the handle into the panel keeps the preview alive.
export function bindPanelHover(panel) {
  if (!hoverCapable || !panel) return;
  panel.addEventListener("pointerenter", cancelClose);
  panel.addEventListener("pointerleave", function () {
    if (store.get('projectLogsPreview')) scheduleClose();
  });
}

export function initProjectLogsAmbient(callbacks) {
  hooks = callbacks || hooks;
  hoverCapable = detectHoverCapable();

  var main = document.getElementById("main-panels");
  if (!main) return;

  handle = document.createElement("button");
  handle.id = "project-logs-handle";
  handle.type = "button";
  handle.className = "project-logs-handle";
  handle.setAttribute("aria-label", "Open Project Logs");
  handle.title = "Open Project Logs";
  handle.innerHTML = '<span class="project-logs-handle-notch" aria-hidden="true"></span>';
  main.appendChild(handle);

  // Click and keyboard both pin, so the handle is a real control and not a
  // hover-only affordance.
  handle.addEventListener("click", function () {
    if (store.get('projectLogsOpen')) return;
    pinFromPreview();
  });
  handle.addEventListener("focus", function () {
    if (!store.get('projectLogsOpen')) showPreview();
  });
  handle.addEventListener("blur", function () {
    if (store.get('projectLogsPreview') && !store.get('projectLogsPinned')) scheduleClose();
  });

  if (hoverCapable) {
    handle.addEventListener("pointerenter", showPreview);
    handle.addEventListener("pointerleave", scheduleClose);
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (store.get('projectLogsPreview')) hidePreview();
  });

  syncAmbient();
}
