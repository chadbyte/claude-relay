// Durable, server-backed Home conversation selection state.

import { store } from './store.js';
import { getWs } from './ws-ref.js';

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function normalizeSessions(value) {
  var source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  var result = {};
  var keys = Object.keys(source);
  for (var i = 0; i < keys.length; i++) {
    if (typeof source[keys[i]] === "string" && source[keys[i]]) result[keys[i]] = source[keys[i]];
  }
  return result;
}

export function requestHomeSurfacePreference() {
  return send({ type: "home_surface_get" });
}

export function updateHomeSurfacePreference(patch) {
  var state = store.snap();
  var next = {
    activeMateId: state.homeChatMateId || null,
    activeSessionByMate: Object.assign({}, state.homeActiveSessionByMate || {}),
    sidebarCollapsed: state.homeSidebarCollapsed === true,
  };
  if (patch && Object.prototype.hasOwnProperty.call(patch, "activeMateId")) next.activeMateId = patch.activeMateId;
  if (patch && patch.activeSessionByMate) next.activeSessionByMate = Object.assign({}, next.activeSessionByMate, patch.activeSessionByMate);
  if (patch && Object.prototype.hasOwnProperty.call(patch, "sidebarCollapsed")) next.sidebarCollapsed = patch.sidebarCollapsed === true;
  store.set({
    homeActiveSessionByMate: normalizeSessions(next.activeSessionByMate),
    homeSidebarCollapsed: next.sidebarCollapsed,
  });
  var outgoing = {};
  if (patch && Object.prototype.hasOwnProperty.call(patch, "activeMateId")) outgoing.activeMateId = next.activeMateId;
  if (patch && patch.activeSessionByMate) outgoing.activeSessionByMate = patch.activeSessionByMate;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "sidebarCollapsed")) outgoing.sidebarCollapsed = next.sidebarCollapsed;
  send({ type: "home_surface_set", preference: outgoing });
}

export function rememberHomeMate(mateId) {
  if (!mateId) return;
  if (store.get('homePreferredMateId') === mateId) return;
  store.set({ homePreferredMateId: mateId });
  updateHomeSurfacePreference({ activeMateId: mateId });
}

export function rememberHomeSession(mateId, sessionId) {
  if (!mateId || !sessionId) return;
  if ((store.get('homeActiveSessionByMate') || {})[mateId] === sessionId && store.get('homePreferredMateId') === mateId) return;
  var patch = {};
  patch[mateId] = sessionId;
  updateHomeSurfacePreference({ activeMateId: mateId, activeSessionByMate: patch });
}

export function forgetHomeSession(mateId) {
  if (!mateId) return;
  var sessions = Object.assign({}, store.get('homeActiveSessionByMate') || {});
  delete sessions[mateId];
  store.set({ homeActiveSessionByMate: sessions, homeChatSessionId: null });
  var patch = {};
  patch[mateId] = "";
  send({ type: "home_surface_set", preference: { activeSessionByMate: patch } });
}

export function handleHomeSurfaceState(msg) {
  if (msg.error || !msg.preference) return;
  var preference = msg.preference;
  var wasLoaded = store.get('homeSurfaceLoaded');
  var update = {
    homeSurfaceLoaded: true,
    homeActiveSessionByMate: normalizeSessions(preference.activeSessionByMate),
    homeSidebarCollapsed: preference.sidebarCollapsed === true,
  };
  if (!wasLoaded) {
    update.homePreferredMateId = store.get('homePreferredMateId') || preference.activeMateId || store.get('homeChatMateId') || null;
  }
  store.set(update);
}
