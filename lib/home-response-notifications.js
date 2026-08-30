// Exact Home presentation checks for Mate response notifications.

function sessionReference(session) {
  return session && (session.cliSessionId || (session.localId != null ? "local:" + session.localId : null));
}

function shouldSuppressHomeResponse(projects, slug, session) {
  if (!projects || !session || typeof slug !== "string" || slug.indexOf("mate-") !== 0) return false;
  var reference = sessionReference(session);
  var matched = false;
  projects.forEach(function (ctx) {
    if (matched || !ctx || typeof ctx.forEachClient !== "function") return;
    ctx.forEachClient(function (ws) {
      if (matched || !ws || !ws._homeChatPresented) return;
      if (session.ownerId && (!ws._clayUser || ws._clayUser.id !== session.ownerId)) return;
      var tap = ws._homeChatTap;
      if (!tap || tap.mateSlug !== slug) return;
      var localMatch = tap.sessionId === session.localId;
      var referenceMatch = !!reference && tap.sessionReference === reference;
      if (localMatch && referenceMatch) matched = true;
    });
  });
  return matched;
}

module.exports = { shouldSuppressHomeResponse: shouldSuppressHomeResponse };
