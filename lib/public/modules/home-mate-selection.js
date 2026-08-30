// Pure Home Mate selection policy shared by rendering and focused tests.

function findMate(mates, mateId) {
  if (!mateId) return null;
  for (var i = 0; i < mates.length; i++) {
    if (mates[i] && mates[i].id === mateId) return mates[i];
  }
  return null;
}

export function resolveHomeMate(mates, currentMateId, preferredMateId) {
  var visibleMates = Array.isArray(mates) ? mates : [];
  var currentMate = findMate(visibleMates, currentMateId);
  if (currentMate) return currentMate;
  var preferredMate = findMate(visibleMates, preferredMateId);
  if (preferredMate) return preferredMate;
  for (var i = 0; i < visibleMates.length; i++) {
    if (visibleMates[i] && visibleMates[i].builtinKey === "clay") return visibleMates[i];
  }
  return null;
}
