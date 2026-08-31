// Durable Home main-stage selection shared by chat and debate archive controllers.

import { store } from './store.js';
import { updateHomeSurfacePreference } from './home-surface.js';

export function setHomeSubSurface(surface, persist) {
  var next = surface === "debates" ? "debates" : "chat";
  if (store.get('homeSubSurface') === next) return false;
  store.set({ homeSubSurface: next });
  if (persist !== false) updateHomeSurfacePreference({ subSurface: next });
  return true;
}

export function isHomeDebatesSurface() {
  return store.get('homeSubSurface') === "debates";
}
