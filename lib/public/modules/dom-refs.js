// dom-refs.js - Shared DOM element references
// Lazy-cached getElementById lookups for elements used across multiple modules.
// Same pattern as ws-ref.js: infrastructure singleton, not state.

var _cache = {};

function ref(id) {
  if (!_cache[id]) _cache[id] = document.getElementById(id);
  return _cache[id];
}

export function getMessagesEl() { return ref("messages"); }
export function getInputEl() { return ref("input"); }
export function getSendBtn() { return ref("send-btn"); }
export function getSessionListEl() { return ref("session-list"); }

export function getStatusDot() {
  return document.querySelector("#icon-strip-projects .icon-strip-item.active .icon-strip-status") ||
         document.querySelector("#icon-strip-projects .icon-strip-wt-item.active .icon-strip-status") ||
         document.querySelector("#icon-strip-users .icon-strip-mate.active .icon-strip-status");
}
