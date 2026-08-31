// Server-owned Home debate planning. The initiation turn is deliberately not
// recorded as a user message; only Clay's visible interview enters history.

var PLANNING_TITLE = "Debate planning";
var INITIATION_MARKER = "home_debate_planning_started";
var INITIATION_PROMPT = [
  "/clay-debate-setup",
  "You are planning a debate with the user in a normal Clay Studio Home conversation.",
  "Follow the clay-debate-setup skill, inspect the available teammates and relevant context, and use the user's spoken language.",
  "Use the canonical AskUserQuestion interaction for every user-facing question or interaction. Ask exactly one focused question at a time with 2-3 useful options; the card supplies an Other free-form answer.",
  "When the native AskUserQuestion tool is callable, use it. Otherwise call the exact session-bound ask_user_questions tool (shown under clay-ask-user on MCP-capable hosts); it is the canonical AskUserQuestion fallback for this Home conversation.",
  "Do not claim the question tool is unavailable without calling the available native or session-bound fallback. If a real tool call fails, stop so Clay Studio can surface the actionable error.",
  "Never ask the user a question in ordinary assistant chat text and never expose a project setup UI.",
  "Do not write a brief file. When the brief is complete, end only by calling propose_debate. Do not start the debate by any other path.",
].join("\n");

function attachHomeDebatePlanning(ctx) {
  function hasInitiated(session) {
    var history = session && Array.isArray(session.history) ? session.history : [];
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i] && history[i].type === "home_debate_planning_start_failed") return false;
      if (history[i] && history[i].type === INITIATION_MARKER) return true;
    }
    return false;
  }

  function markInitiated(manager, session) {
    manager.sendAndRecord(session, { type: INITIATION_MARKER, internal: true });
  }

  async function initiate(ws, found, userId, session, msg) {
    if (hasInitiated(session) || session.isProcessing) return;
    if (!session.model || !session.vendor) {
      var resolved = await ctx.homeModels.resolveMateModel(ws, found, userId);
      session.vendor = resolved.vendor;
      session.model = resolved.model;
    }
    var manager = found.ctx.getSessionManager();
    if (!manager || typeof manager.sendAndRecord !== "function") {
      var unavailable = new Error("Conversation history is unavailable.");
      unavailable.code = "model_unavailable";
      throw unavailable;
    }
    if (typeof manager.saveSessionFile === "function") manager.saveSessionFile(session);
    ctx.setupTap(ws, found, session.localId, msg.requestId || null);
    ctx.sendHistory(ws, found, session, msg.requestId || null);
    markInitiated(manager, session);
    session.isProcessing = true;
    session.sentToolResults = {};
    try {
      found.ctx.sdk.startQuery(session, INITIATION_PROMPT, null, null);
    } catch (error) {
      session.isProcessing = false;
      try { manager.sendAndRecord(session, { type: "home_debate_planning_start_failed", internal: true }); } catch (recordError) {}
      error.sessionId = ctx.sessionReference(session);
      throw error;
    }
  }

  function resume(ws, found, userId, session, msg) {
    ctx.setupTap(ws, found, session.localId, msg.requestId || null);
    ctx.sendHistory(ws, found, session, msg.requestId || null);
    initiate(ws, found, userId, session, msg).catch(function (error) {
      ctx.sendModelError(ws, found, msg, error, ctx.sessionReference(session));
    });
  }

  function start(ws, userId, msg) {
    var found = ctx.findMateProject(userId, null, true);
    if (!found || !found.mate || found.mate.builtinKey !== "clay") {
      ctx.sendError(ws, null, "Clay is not available.", msg.requestId || null, null, "mate_unavailable");
      return;
    }
    var manager = found.ctx.getSessionManager();
    if (!manager || !found.ctx.sdk) {
      ctx.sendError(ws, found.mate.id, "Clay conversation is unavailable.", msg.requestId || null, null, "session_unavailable");
      return;
    }
    var requested = msg.sessionId ? ctx.resolveHomeSession(found, userId, msg.sessionId) : null;
    if (requested && requested.debateSetupMode === true) {
      resume(ws, found, userId, requested, msg);
      return;
    }
    var requestId = msg.requestId || null;
    if (!ws._homeDebatePlanningRequests) ws._homeDebatePlanningRequests = {};
    var priorLocalId = requestId ? ws._homeDebatePlanningRequests[requestId] : null;
    var prior = priorLocalId ? manager.sessions.get(priorLocalId) : null;
    if (prior && prior.debateSetupMode === true) {
      resume(ws, found, userId, prior, msg);
      return;
    }
    var session = manager.createSession({ ownerId: userId }, null);
    session.title = PLANNING_TITLE;
    session.titleManuallySet = true;
    session.debateSetupMode = true;
    if (requestId) ws._homeDebatePlanningRequests[requestId] = session.localId;
    ctx.setupTap(ws, found, session.localId, msg.requestId || null);
    ctx.sendHistory(ws, found, session, msg.requestId || null);
    ctx.sendSessionList(ws, found, userId);
    initiate(ws, found, userId, session, msg).catch(function (error) {
      ctx.sendModelError(ws, found, msg, error, ctx.sessionReference(session));
    });
  }

  function respond(ws, userId, msg) {
    var found = ctx.findMateProject(userId, null, true);
    var session = found ? ctx.resolveHomeSession(found, userId, msg.sessionId) : null;
    var tap = ws._homeChatTap;
    var correlated = tap && session && tap.mateId === found.mate.id && tap.sessionId === session.localId && (!msg.requestId || !tap.requestId || msg.requestId === tap.requestId);
    if (!found || !session || !correlated || session.debateSetupMode !== true || !msg.proposalId) {
      ctx.sendError(ws, found && found.mate ? found.mate.id : null, "Debate proposal is not available.", msg.requestId || null, msg.sessionId || null, "proposal_not_found");
      return;
    }
    if (typeof found.ctx.handleHomeDebateProposalResponse !== "function") {
      ctx.sendError(ws, found.mate.id, "The debate engine is unavailable.", msg.requestId || null, msg.sessionId, "proposal_unavailable");
      return;
    }
    var handled = found.ctx.handleHomeDebateProposalResponse(ws, {
      type: "debate_proposal_response",
      proposalId: msg.proposalId,
      action: msg.action === "start" ? "start" : "cancel",
    }, session);
    if (!handled) {
      var manager = found.ctx.getSessionManager();
      var text = "This debate proposal is no longer active. Ask Clay to prepare it again.";
      if (manager && typeof manager.sendAndRecord === "function") manager.sendAndRecord(session, { type: "debate_proposal_resolved", proposalId: msg.proposalId, action: "error", error: text });
      ctx.sendError(ws, found.mate.id, text, msg.requestId || null, msg.sessionId, "proposal_not_found");
    }
  }

  function respondToQuestion(ws, userId, msg) {
    var found = ctx.findMateProject(userId, null, true);
    var session = found ? ctx.resolveHomeSession(found, userId, msg.sessionId) : null;
    var tap = ws._homeChatTap;
    var correlated = tap && session && found.mate.builtinKey === "clay" && tap.mateId === found.mate.id && tap.sessionId === session.localId && (tap.requestId || null) === (msg.requestId || null);
    var pending = session && session.pendingAskUser ? session.pendingAskUser[msg.toolId] : null;
    if (!found || !session || !correlated || session.debateSetupMode !== true || !msg.toolId) {
      ctx.sendError(ws, found && found.mate ? found.mate.id : null, "This debate question is not available.", msg.requestId || null, msg.sessionId || null, "question_not_found");
      return;
    }
    var history = Array.isArray(session.history) ? session.history : [];
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i] && history[i].type === "ask_user_answered" && history[i].toolId === msg.toolId) {
        ctx.sendError(ws, found.mate.id, "This debate question was already answered.", msg.requestId || null, msg.sessionId, "question_answered", { toolId: msg.toolId });
        return;
      }
    }
    if (!pending || typeof found.ctx.handleHomeAskUserResponse !== "function") {
      var manager = found.ctx.getSessionManager();
      var text = "This question expired after the conversation was restored. Ask Clay to repeat it.";
      if (manager && typeof manager.sendAndRecord === "function") manager.sendAndRecord(session, { type: "home_debate_question_expired", toolId: msg.toolId, error: text });
      ctx.sendError(ws, found.mate.id, text, msg.requestId || null, msg.sessionId, "question_expired");
      return;
    }
    var answers = {};
    var inputQuestions = pending.input && Array.isArray(pending.input.questions) ? pending.input.questions : [];
    for (var j = 0; j < inputQuestions.length; j++) {
      var value = msg.answers && msg.answers[j];
      if (typeof value === "string" && value.trim()) answers[j] = value.trim().slice(0, 2000);
    }
    if (!Object.keys(answers).length) {
      ctx.sendError(ws, found.mate.id, "Choose an option or enter another answer.", msg.requestId || null, msg.sessionId, "question_answer_required", { toolId: msg.toolId });
      return;
    }
    if (!found.ctx.handleHomeAskUserResponse({ type: "ask_user_response", toolId: msg.toolId, answers: answers }, session)) {
      ctx.sendError(ws, found.mate.id, "This debate question was already answered.", msg.requestId || null, msg.sessionId, "question_answered", { toolId: msg.toolId });
    }
  }

  return { start: start, resume: resume, respond: respond, respondToQuestion: respondToQuestion };
}

module.exports = {
  attachHomeDebatePlanning: attachHomeDebatePlanning,
  INITIATION_PROMPT: INITIATION_PROMPT,
};
