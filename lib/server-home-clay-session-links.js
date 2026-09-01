// Resolve rendered Mate session references through an exact owner-bound source session.

function attachHomeClaySessionLinks(ctx) {
  function resolve(ws, msg) {
    var tap = msg.surface === "search" ? ws._searchClayTap : ws._homeChatTap;
    var sourceProject = tap && tap.mateSlug ? ctx.projects.get(tap.mateSlug) : null;
    var sourceManager = sourceProject && sourceProject.getSessionManager ? sourceProject.getSessionManager() : null;
    var sourceSession = sourceManager && tap ? sourceManager.sessions.get(tap.sessionId) : null;
    var bound = ctx.workspaceQueryService && sourceSession
      ? ctx.workspaceQueryService.bindProjectSession({ projectSlug: tap.mateSlug, session: sourceSession })
      : null;
    var payload = { type: "home_clay_session_target", requestId: msg.requestId || null, sessionRef: msg.sessionRef || null, status: "error" };
    try {
      if (!bound) throw new Error("The source conversation is no longer available.");
      payload.target = bound.resolveSessionNavigation({ sessionRef: msg.sessionRef });
      payload.status = "ready";
    } catch (error) {
      payload.error = error.message || "Session not available.";
    }
    ctx.sendMessage(ws, payload);
  }

  return { resolve: resolve };
}

module.exports = { attachHomeClaySessionLinks: attachHomeClaySessionLinks };
