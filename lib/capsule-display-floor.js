// The mandatory declarative floor element of a Capsule's Display set.
//
// A Capsule is Logic, Skills, and Display. Display carries no packaging duty
// towards an agent (no Mate ever reads it), but it does carry the human's
// sovereignty: every Capsule must ship one element the host can always render,
// so the Capsule stays fully operable by hand with no AI in the path. That
// element is the validated declarative tree, and it is the floor.
//
// Two gates follow from that, and they are gates rather than aspirations:
//   1. Registration refuses a Capsule whose Display set lacks the floor.
//   2. Skills go dark when the floor does. A Capsule whose floor is
//      unavailable leaves the catalog and the control surface a Mate sees, at
//      the same moment the human loses it.
//
// The only question either gate asks is the one tool-ui-spec answers: does the
// Capsule have a declarative tree, and does that tree validate? A tree that is
// merely sparse is still a floor. Nothing here reads a stored verdict, because
// a stored verdict is a claim rather than the Display itself; the gate always
// validates the actual tree.

var toolUiSpec = require("./tool-ui-spec");

var FLOOR_ELEMENT = "declarative";

// Fails closed: a scan error, a missing ID, a missing tree, or a tree that
// does not validate all mean the same thing to a Mate, which is no Capsule.
function hasUsableFloor(manifest, uiTree) {
  if (!manifest || manifest.error || !manifest.id) return false;
  var tree = uiTree === undefined ? manifest.uiTree : uiTree;
  if (tree === undefined || tree === null) return false;
  try {
    toolUiSpec.validateUiTreeForManifest(tree, manifest);
    return true;
  } catch (error) {
    return false;
  }
}

function assertFloor(uiTree, manifest) {
  if (uiTree === undefined || uiTree === null) {
    throw new Error("Capsule Display must include the declarative floor element.");
  }
  toolUiSpec.validateUiTreeForManifest(uiTree, manifest);
  return true;
}

module.exports = {
  FLOOR_ELEMENT: FLOOR_ELEMENT,
  hasUsableFloor: hasUsableFloor,
  assertFloor: assertFloor,
};
