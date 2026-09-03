// Leaf helpers shared by every sticky-note module.
//
// This module imports nothing from the other sticky-note modules, so the canvas,
// the card, and the editor can all depend on it without depending on each other.
// Keep it that way: anything added here must stay dependency-neutral.

import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { getTitle } from './sticky-note-markdown.js';

export var NOTE_COLORS = ["purple", "green", "yellow", "blue", "pink", "orange"];

// The debounce timers live here because both the card and the editor schedule
// writes, and a note must never have two competing pending writes.
var updateTimers = {};
var textTimers = {};

// A note is closed when its lifecycle says so. Legacy notes carry no state and
// used `hidden` for the same meaning, so both are honoured.
export function isClosedNote(data) {
  if (!data) return false;
  if (data.state === "closed") return true;
  if (data.state === "open") return false;
  return data.hidden === true;
}

// --- Canvas geometry ---

export function getContainerBounds() {
  var c = document.getElementById("sticky-notes-container");
  if (!c || c.clientWidth === 0 || c.clientHeight === 0) return null;
  return { w: c.clientWidth, h: c.clientHeight };
}

export function clampPos(x, y, noteW, noteH) {
  var b = getContainerBounds();
  if (!b) return { x: x, y: y };
  return {
    x: Math.max(0, Math.min(x, b.w - noteW)),
    y: Math.max(0, Math.min(y, b.h - noteH)),
  };
}

export function clampSize(x, y, w, h) {
  var b = getContainerBounds();
  if (!b) return { w: w, h: h };
  return {
    w: Math.min(w, b.w - x),
    h: Math.min(h, b.h - y),
  };
}


// --- WebSocket and debounced persistence ---

export function send(obj) {
  var ws = getWs();
  if (!ws || !store.get('connected')) return;
  ws.send(JSON.stringify(obj));
}

export function debouncedUpdate(id, changes, delay) {
  clearTimeout(updateTimers[id]);
  updateTimers[id] = setTimeout(function () {
    changes.type = "note_update";
    changes.id = id;
    send(changes);
  }, delay || 300);
}

export function debouncedTextUpdate(id, text) {
  clearTimeout(textTimers[id]);
  textTimers[id] = setTimeout(function () {
    send({ type: "note_update", id: id, text: text });
  }, 500);
}

export function syncTitle(noteEl, text) {
  var spacer = noteEl.querySelector(".sticky-note-spacer");
  if (spacer) spacer.textContent = getTitle(text) || "Untitled";
}


// Drop any pending writes for a note this client no longer has.
export function clearNoteTimers(id) {
  clearTimeout(updateTimers[id]);
  clearTimeout(textTimers[id]);
  delete updateTimers[id];
  delete textTimers[id];
}
