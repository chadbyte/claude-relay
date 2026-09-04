// Driver capability for a visible Driver/Split Worker pair.
//
// Model and vendor choice belongs to the user. A session does not need to
// clear a model-tier threshold to coordinate a Split Worker; runtime catalog
// validation belongs to session-pair-factory.js and applies equally to every
// requested role. The only session-level exclusion here is structural: an
// embedded terminal has no project chat surface on which to host the Driver
// controls or the paired pane.

var sessionProvenance = require("./session-provenance");

function evaluateDriverSession(session) {
  if (!session) {
    return { ok: false, error: "No session was bound to this request." };
  }
  if (session.mode === "tui") {
    return {
      ok: false,
      error: "An embedded terminal session cannot take the Driver role.",
    };
  }
  if (sessionProvenance.isWorker(session)) {
    return {
      ok: false,
      error: "A Split Worker session cannot take the Driver role.",
    };
  }
  return { ok: true, error: null };
}

function isEligibleDriverSession(session) {
  return evaluateDriverSession(session).ok;
}

module.exports = {
  evaluateDriverSession: evaluateDriverSession,
  isEligibleDriverSession: isEligibleDriverSession,
};
