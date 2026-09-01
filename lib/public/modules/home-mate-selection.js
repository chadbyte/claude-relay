// Pure Home Mate selection policy shared by rendering and focused tests.

export function findHomeMate(mates, mateId) {
  if (!mateId) return null;
  for (var i = 0; i < mates.length; i++) {
    if (mates[i] && mates[i].id === mateId) return mates[i];
  }
  return null;
}

export function resolveHomeMate(mates, currentMateId, preferredMateId) {
  var visibleMates = Array.isArray(mates) ? mates : [];
  var currentMate = findHomeMate(visibleMates, currentMateId);
  if (currentMate) return currentMate;
  var preferredMate = findHomeMate(visibleMates, preferredMateId);
  if (preferredMate) return preferredMate;
  for (var i = 0; i < visibleMates.length; i++) {
    if (visibleMates[i] && visibleMates[i].builtinKey === "clay") return visibleMates[i];
  }
  return null;
}

export function getHomeMateName(mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  return profile.displayName || (mate && (mate.displayName || mate.name)) || "Mate";
}

export function getHomeMateBio(mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  return mate ? profile.bio || mate.bio || profile.description || mate.description || "" : "";
}

export function getHomeMateShortBio(mate) {
  var bio = getHomeMateBio(mate).replace(/\s+/g, " ").trim();
  if (!bio) return "Bring an idea, a task, or a question.";
  if (bio.length > 120) return bio.slice(0, 117).trim() + "...";
  return bio;
}
