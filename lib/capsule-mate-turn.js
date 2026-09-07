// Bridges Capsule engagement events to the opponent Mate's session.
//
// This module knows no game. A Capsule's Logic declares on its causal event
// when the Mate should be engaged (`event.engage = {kind}`): "turn" asks the
// Mate to read the state and act, "start" asks it to acknowledge a fresh
// game without acting. The bridge only carries that declaration: it finds the
// opponent Mate's project and delivers a prompt through it, so the Capsule
// round-trips for every game alike: the human plays on the Display, the Mate
// wakes up, reads the state over clay_tool_snapshot, and acts through the
// same clay_tool_act pipeline. The prompt carries words only; it grants no
// authority the Mate does not already have, and a lost prompt costs a
// reminder, never the game. Only human-caused events engage, whatever Logic
// declares, so a Mate can never wake itself.
//
// The opponent is the Mate that last acted on this Capsule for this user.
// Before any Mate has acted, the built-in host Mate (Clay) takes the seat, so
// a fresh game is playable with zero setup.

function attachCapsuleMateTurn(deps) {
  var users = deps.users;
  var findMateProject = deps.findMateProject || null;
  var broadcastToUser = deps.broadcastToUser || null;
  var opponents = Object.create(null);
  var nudgedSeqs = Object.create(null);

  function keyFor(userId, toolId) {
    return String(userId) + "\u0000" + String(toolId);
  }

  // Called when a Mate acts on a Capsule: that Mate holds the opponent seat
  // for this user's game from then on.
  function rememberOpponent(userId, toolId, mateId) {
    if (typeof mateId === "string" && mateId) opponents[keyFor(userId, toolId)] = mateId;
  }

  function turnPrompt(manifest) {
    return "Capsule turn: it is your seat's turn in the \"" + manifest.name + "\" Capsule (toolId \"" + manifest.id + "\"). "
      + "Read the game with clay_tool_snapshot, decide your move, and take your turn with clay_tool_act. "
      + "Keep playing until the turn passes away from your seat, and say your reasoning in one or two short sentences as you play. "
      + "If an act is refused, read the snapshot again instead of retrying blindly.";
  }

  function startPrompt(manifest) {
    return "Capsule game: the user just started a new game of \"" + manifest.name + "\" (toolId \"" + manifest.id + "\") against you. "
      + "The user moves first. Reply with one short line of table talk, and do not call clay_tool_act now: "
      + "you will be woken in this session whenever it is your turn.";
  }

  // Fire-and-forget from the act pipeline: delivers a Logic-declared
  // engagement exactly once per event, and only for human-caused events.
  function maybeNudge(userId, manifest, actor, event) {
    if (!findMateProject || !manifest || !event) return Promise.resolve(null);
    if (actor !== "human") return Promise.resolve(null);
    var kind = event.engage && (event.engage.kind === "turn" || event.engage.kind === "start") ? event.engage.kind : null;
    if (!kind) return Promise.resolve(null);
    var key = keyFor(userId, manifest.id);
    if (nudgedSeqs[key] !== undefined && event.seq <= nudgedSeqs[key]) return Promise.resolve(null);
    nudgedSeqs[key] = event.seq;
    return Promise.resolve().then(function () {
      var mateId = opponents[key] || null;
      // The mates registry keys single-user data off a null userId, exactly
      // like the home chat surface does.
      var mateUserId = users.isMultiUser() ? userId : null;
      var found = findMateProject(mateUserId, mateId, true);
      if (!found && mateId) found = findMateProject(mateUserId, null, true);
      if (!found || !found.ctx || typeof found.ctx.deliverCapsuleTurn !== "function") {
        console.error("[capsules] No Mate project could take the '" + manifest.id + "' turn; is a Mate installed?");
        return null;
      }
      var principal = { userId: users.isMultiUser() ? userId : null };
      var mateId = found.mate && found.mate.id ? found.mate.id : null;
      return found.ctx.deliverCapsuleTurn(principal, {
        toolId: manifest.id,
        toolName: manifest.name,
        kind: kind,
        text: kind === "turn" ? turnPrompt(manifest) : startPrompt(manifest),
      }).then(function (delivered) {
        // An explicit game start navigates the user's home board into the
        // Mate's game session, so starting a game visibly opens the table.
        if (broadcastToUser && delivered && delivered.reference && mateId) {
          broadcastToUser(userId, {
            type: "capsule_game_session",
            toolId: manifest.id,
            toolName: manifest.name,
            mateId: mateId,
            sessionId: delivered.reference,
            kind: kind,
            created: !!delivered.created,
          });
        }
        return delivered;
      });
    }).catch(function (error) {
      console.error("[capsules] Could not deliver the Mate's turn:", error && error.message ? error.message : error);
      return null;
    });
  }

  return {
    rememberOpponent: rememberOpponent,
    maybeNudge: maybeNudge,
  };
}

module.exports = { attachCapsuleMateTurn: attachCapsuleMateTurn };
