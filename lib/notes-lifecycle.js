// Sticky Note lifecycle.
//
// A note is an attention item, so "done" must never mean "gone". Completing a
// note closes it: the record stays, stays queryable, and stays reversible. Only
// its place on the active canvas changes.
//
// Legacy notes carry no state field. They project as open, with one exception:
// the older `hidden: true` flag already meant "taken off the canvas and hidden
// from agents", which is exactly what closed means, so those project as closed.
// The original `hidden` value is preserved rather than rewritten, and no
// closedAt is invented for a note that never recorded one.
//
// Projection is applied when notes are loaded, so nothing on disk is rewritten
// just by reading. The normalized fields reach the file the next time that note
// is written for some other reason.

var STATE_OPEN = "open";
var STATE_CLOSED = "closed";
var STATES = [STATE_OPEN, STATE_CLOSED];

function isState(value) {
  return STATES.indexOf(value) !== -1;
}

// The state a note is in, derived rather than trusted: an unknown or missing
// value falls back to the legacy flag and then to open.
function stateOf(note) {
  if (!note) return STATE_OPEN;
  if (isState(note.state)) return note.state;
  return note.hidden === true ? STATE_CLOSED : STATE_OPEN;
}

function isOpen(note) {
  return stateOf(note) === STATE_OPEN;
}

function isClosed(note) {
  return stateOf(note) === STATE_CLOSED;
}

// Normalize one note in place. Returns true when anything changed, so a caller
// can decide whether the migration is worth persisting.
function normalize(note) {
  if (!note || typeof note !== "object") return false;
  var changed = false;
  var state = stateOf(note);
  if (note.state !== state) {
    note.state = state;
    changed = true;
  }
  if (note.closedAt === undefined) {
    // A legacy hidden note has no recorded close time and none is invented.
    note.closedAt = null;
    changed = true;
  }
  if (note.closedBy === undefined) {
    note.closedBy = null;
    changed = true;
  }
  // Keep the legacy flag consistent with the state so an old client that only
  // understands `hidden` still takes a closed note off its canvas.
  var hidden = state === STATE_CLOSED;
  if (note.hidden !== hidden) {
    note.hidden = hidden;
    changed = true;
  }
  return changed;
}

function normalizeAll(notes) {
  var list = Array.isArray(notes) ? notes : [];
  var changed = false;
  for (var i = 0; i < list.length; i++) {
    if (normalize(list[i])) changed = true;
  }
  return { notes: list, changed: changed };
}

function openNotes(notes) {
  return (notes || []).filter(function (note) { return note && isOpen(note); });
}

function closedNotes(notes) {
  return (notes || []).filter(function (note) { return note && isClosed(note); });
}

// Actors are always built from server-bound context. Nothing here reads a
// caller-supplied identity, so a payload cannot claim to be someone else.
function sessionActor(session) {
  if (!session) return null;
  return {
    type: "session",
    sessionId: session.localId !== undefined && session.localId !== null ? session.localId : null,
    vendor: session.vendor || null,
  };
}

function userActor(user) {
  return {
    type: "user",
    userId: (user && user.id) || null,
    displayName: (user && (user.displayName || user.username)) || null,
  };
}

// Apply the close transition. Idempotent: closing an already-closed note keeps
// the original closedAt and actor rather than restamping it, so the record of
// when it was actually completed survives repeated calls.
function applyClose(note, actor, now) {
  if (!note) return false;
  normalize(note);
  if (isClosed(note)) return false;
  note.state = STATE_CLOSED;
  note.hidden = true;
  note.closedAt = typeof now === "number" ? now : Date.now();
  note.closedBy = actor || null;
  return true;
}

// Apply the reopen transition. Idempotent in the same way, and it clears the
// close provenance because the note is live again.
function applyReopen(note) {
  if (!note) return false;
  normalize(note);
  if (isOpen(note)) return false;
  note.state = STATE_OPEN;
  note.hidden = false;
  note.closedAt = null;
  note.closedBy = null;
  return true;
}

module.exports = {
  STATE_OPEN: STATE_OPEN,
  STATE_CLOSED: STATE_CLOSED,
  STATES: STATES,
  isState: isState,
  stateOf: stateOf,
  isOpen: isOpen,
  isClosed: isClosed,
  normalize: normalize,
  normalizeAll: normalizeAll,
  openNotes: openNotes,
  closedNotes: closedNotes,
  sessionActor: sessionActor,
  userActor: userActor,
  applyClose: applyClose,
  applyReopen: applyReopen,
};
