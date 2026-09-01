// Mate-neutral Capsule creation entry contract for Home surfaces.

import { store } from './store.js';
import { findHomeMate } from './home-mate-selection.js';

export var HOME_CAPSULE_CREATION_EVENT = "clay:home-capsule-create";

export function normalizeCapsuleDescription(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, 4000);
}

export function resolveCapsuleCreationMate(mates, currentMateId) {
  var visible = (Array.isArray(mates) ? mates : []).filter(function (mate) {
    return !!mate && !mate.archived;
  });
  return findHomeMate(visible, currentMateId);
}

export function requestHomeCapsuleCreation(value) {
  var description = normalizeCapsuleDescription(value);
  if (!description || !store.get('homeSurfaceLoaded')) return false;
  var mate = resolveCapsuleCreationMate(
    store.get('cachedMatesList') || [],
    store.get('homeChatMateId')
  );
  if (!mate) return false;
  var detail = { mateId: mate.id, description: description, accepted: false };
  window.dispatchEvent(new CustomEvent(HOME_CAPSULE_CREATION_EVENT, { detail: detail }));
  return detail.accepted === true;
}
