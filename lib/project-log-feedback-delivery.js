// Deliver new Project Log comments to the exact live session responsible for
// the canonical entry. Comments remain durable in the ledger when that session
// is gone; this module never guesses another session or creates one.

function attachProjectLogFeedbackDelivery(ctx) {
  var sm = ctx.sm;
  var getSdk = ctx.getSdk;
  var onProcessingChanged = ctx.onProcessingChanged || function () {};
  var getLinuxUserForSession = ctx.getLinuxUserForSession || function () { return null; };

  function findAuthorSession(entry) {
    var author = entry && entry.updatedBy;
    if (!author || author.type !== "session" || !author.sessionKey) return null;
    var match = null;
    sm.sessions.forEach(function (session) {
      if (match || !session || session.destroying || session.hidden) return;
      if (session.cliSessionId !== author.sessionKey && "local:" + session.localId !== author.sessionKey) return;
      if ((session.ownerId || null) !== (author.userId || null)) return;
      if (sm.sessions.get(session.localId) !== session) return;
      match = session;
    });
    return match;
  }

  function feedbackPrompt(entry) {
    return "[Project Log feedback]\n" +
      "A user added a comment to " + entry.ref + ". Review the pending feedback now with list_log_feedback, " +
      "then resolve this specific comment through review_log_comment. Apply supported corrections to the canonical " +
      "entry; otherwise clarify or decline with a concise reason. Do not treat this internal notification as user " +
      "chat or answer it only in the conversation.\n" +
      "[End Project Log feedback]";
  }

  function deliver(entry) {
    if (!entry || !entry.ref || !entry.pendingFeedbackCount) return false;
    var session = findAuthorSession(entry);
    var sdk = getSdk();
    if (!session || !sdk) return false;
    var text = feedbackPrompt(entry);
    sm.sendAndRecord(session, {
      type: "user_message",
      text: text,
      _internal: true,
      projectLogFeedback: true,
      projectLogRef: entry.ref,
    });
    session.lastActivity = Date.now();
    if (!session.isProcessing) {
      session.isProcessing = true;
      session.sentToolResults = {};
      onProcessingChanged();
      sm.sendToSession(session, { type: "status", status: "processing" });
    }
    if (!sdk.pushMessage(session, text)) {
      session._queryStartTs = Date.now();
      Promise.resolve(sdk.startQuery(session, text, null, getLinuxUserForSession(session))).catch(function (error) {
        session.isProcessing = false;
        sm.sendAndRecord(session, {
          type: "error",
          text: "Could not deliver Project Log feedback: " + (error.message || String(error)),
          _internal: true,
        });
        onProcessingChanged();
      });
    }
    sm.broadcastSessionList();
    return true;
  }

  return {
    deliver: deliver,
    findAuthorSession: findAuthorSession,
  };
}

module.exports = { attachProjectLogFeedbackDelivery: attachProjectLogFeedbackDelivery };
