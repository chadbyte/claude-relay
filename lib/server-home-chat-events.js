// Canonical session event projection for the embedded Home transcript.

function homeDebateQuestions(input) {
  var source = input && Array.isArray(input.questions) && input.questions[0] ? input.questions[0] : null;
  if (!source) return [];
  var question = { header: source.header || "", question: source.question || "", multiSelect: false, options: [] };
  var options = Array.isArray(source.options) ? source.options.slice(0, 6) : [];
  for (var i = 0; i < options.length; i++) question.options.push({ label: options[i].label || "Option", description: options[i].description || "" });
  return [question];
}

var HOME_DEBATE_EVENT_TYPES = {
  debate_started: true, debate_turn: true, debate_activity: true, debate_stream: true,
  debate_turn_done: true, debate_hand_raised: true, debate_comment_queued: true,
  debate_comment_injected: true, debate_conclude_confirm: true, debate_user_floor: true,
  debate_user_floor_done: true, debate_user_resume: true, debate_resumed: true,
  debate_ended: true,
};

function findDebateHeader(messages) {
  for (var i = messages.length - 1; i >= 0; i--) if (messages[i].role === "debate_header") return messages[i];
  return null;
}

function findDebateTurn(messages, event) {
  for (var i = messages.length - 1; i >= 0; i--) {
    var message = messages[i];
    if (message.role !== "debate_turn") continue;
    if (event.turnId && message.turnId === event.turnId) return message;
    if (!event.turnId && message.status === "active" && (!event.mateId || message.mateId === event.mateId)) return message;
  }
  return null;
}

function debateIdentity(source, fallback) {
  var prior = fallback || {};
  return {
    avatarStyle: source.avatarStyle || prior.avatarStyle || "imprint",
    avatarSeed: source.avatarSeed || prior.avatarSeed || source.mateId || "mate",
    avatarColor: source.avatarColor || prior.avatarColor || "",
    avatarCustom: source.avatarCustom || prior.avatarCustom || "",
  };
}

function applyDebateHistoryEvent(messages, event) {
  var header = findDebateHeader(messages);
  if (event.type === "debate_started") {
    messages.push({ role: "debate_header", phase: "live", topic: event.topic || "Debate", format: event.format || "free_discussion", moderatorId: event.moderatorId || null, moderatorName: event.moderatorName || "Clay", panelists: Array.isArray(event.panelists) ? event.panelists : [], round: 1, interaction: null });
    return;
  }
  if (event.type === "debate_turn") {
    messages.push(Object.assign({ role: "debate_turn", turnId: event.turnId || "turn:" + messages.length, mateId: event.mateId || null, mateName: event.mateName || "Mate", speakerRole: event.role || "panelist", round: event.round || 1, text: "", activity: "", status: "active" }, debateIdentity(event)));
    if (header) { header.phase = "live"; header.round = event.round || header.round || 1; header.interaction = null; }
    return;
  }
  var turn = findDebateTurn(messages, event);
  if (event.type === "debate_activity" && turn) turn.activity = event.activity || "Thinking";
  if (event.type === "debate_stream" && turn) turn.text += event.delta || "";
  if (event.type === "debate_turn_done") {
    if (!turn) {
      turn = Object.assign({ role: "debate_turn", turnId: event.turnId || "turn:" + messages.length, mateId: event.mateId || null, mateName: event.mateName || "Mate", speakerRole: event.role || "panelist", round: event.round || 1, text: "", activity: "", status: "active" }, debateIdentity(event));
      messages.push(turn);
    }
    Object.assign(turn, debateIdentity(event, turn));
    turn.text = event.text || turn.text;
    turn.activity = "";
    turn.status = "done";
  }
  if (event.type === "debate_hand_raised" && header) header.handRaised = true;
  if (event.type === "debate_conclude_confirm" && header) header.interaction = "conclude";
  if (event.type === "debate_user_floor" && header) header.interaction = "user_floor";
  if (event.type === "debate_user_floor_done") {
    messages.push({ role: "debate_user", text: event.text || "" });
    if (header) { header.interaction = null; header.handRaised = false; }
  }
  if (event.type === "debate_comment_injected") messages.push({ role: "debate_user", text: event.text || "" });
  if (event.type === "debate_user_resume") messages.push({ role: "debate_user", text: event.text || "" });
  if (event.type === "debate_resumed" && header) { header.phase = "live"; header.interaction = null; header.round = event.round || header.round; }
  if (event.type === "debate_ended" && header) { header.phase = event.reason === "interrupted" ? "interrupted" : "ended"; header.reason = event.reason || "ended"; header.interaction = null; }
}

function applyAssignmentHistoryEvent(messages, event) {
  var assignment = event && event.assignment;
  if (!assignment || !assignment.assignmentId) return;
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assignment" || !messages[i].assignment || messages[i].assignment.assignmentId !== assignment.assignmentId) continue;
    messages[i] = { role: "assignment", assignment: assignment };
    return;
  }
  messages.push({ role: "assignment", assignment: assignment });
}

function historyToHomeChat(history, debateSetupMode) {
  var messages = [];
  var pending = "";
  function flushAssistant() {
    if (!pending) return;
    if (debateSetupMode !== true) messages.push({ role: "assistant", text: pending });
    pending = "";
  }
  for (var i = 0; i < history.length; i++) {
    var event = history[i];
    if (!event) continue;
    if (event.type === "project_assignment_proposal" || event.type === "project_assignment_status") {
      flushAssistant();
      applyAssignmentHistoryEvent(messages, event);
      continue;
    }
    if (debateSetupMode === true && HOME_DEBATE_EVENT_TYPES[event.type]) {
      flushAssistant();
      applyDebateHistoryEvent(messages, event);
      continue;
    }
    if (event.type === "user_message" && event.text && event.askUserAnswer !== true && debateSetupMode !== true) {
      flushAssistant();
      messages.push({ role: "user", text: event.text });
    } else if (event.type === "delta" && typeof event.text === "string" && debateSetupMode !== true) {
      pending += event.text;
    } else if (event.type === "result" || event.type === "done") {
      flushAssistant();
    } else if (event.type === "error" && event.text) {
      flushAssistant();
      messages.push({ role: "assistant", text: "[error] " + event.text });
    } else if (event.type === "debate_proposal" && event.proposal) {
      flushAssistant();
      messages.push({ role: "proposal", proposal: event.proposal, status: "pending" });
    } else if (event.type === "debate_proposal_resolved" && event.proposalId) {
      for (var j = messages.length - 1; j >= 0; j--) {
        if (messages[j].role === "proposal" && messages[j].proposal && messages[j].proposal.proposalId === event.proposalId) {
          messages[j].status = event.action === "start" ? "started" : (event.action === "cancel" ? "cancelled" : "pending");
          messages[j].error = event.action === "error" ? (event.error || "The debate could not be started.") : "";
          break;
        }
      }
    } else if (debateSetupMode === true && event.type === "tool_executing" && event.name === "AskUserQuestion" && event.id && event.input) {
      flushAssistant();
      messages.push({ role: "question", toolId: event.id, questions: homeDebateQuestions(event.input), status: "pending", error: "" });
    } else if ((event.type === "ask_user_answered" || event.type === "home_debate_question_expired") && event.toolId) {
      for (var k = messages.length - 1; k >= 0; k--) {
        if (messages[k].role === "question" && messages[k].toolId === event.toolId) {
          messages[k].status = event.type === "ask_user_answered" ? "answered" : "expired";
          messages[k].answers = event.answers || null;
          messages[k].error = event.error || "";
          break;
        }
      }
    }
  }
  flushAssistant();
  return messages;
}

function latestAssistantText(history) {
  var text = "";
  for (var i = (history || []).length - 1; i >= 0; i--) {
    var event = history[i];
    if (!event) continue;
    if (event.type === "delta" && typeof event.text === "string") text = event.text + text;
    if (event.type === "user_message" || event.type === "debate_proposal" || event.type === "debate_proposal_resolved" || event.type === "project_assignment_proposal" || event.type === "project_assignment_status" || (event.type === "tool_executing" && event.name === "AskUserQuestion")) break;
  }
  return text;
}

function transformEvent(event, mateId, session, requestId, stableSessionId) {
  if (!event || typeof event.type !== "string") return null;
  var metadata = { mateId: mateId, sessionId: stableSessionId || null, requestId: requestId || null, model: session && session.model ? session.model : null, vendor: session && session.vendor ? session.vendor : null };
  if ((event.type === "project_assignment_proposal" || event.type === "project_assignment_status") && event.assignment) {
    return Object.assign({
      type: event.type === "project_assignment_proposal" ? "home_project_assignment_proposal" : "home_project_assignment_status",
      assignment: event.assignment,
    }, metadata);
  }
  if (session && session.homeDebatePlanning === true && HOME_DEBATE_EVENT_TYPES[event.type]) {
    var live = { type: "home_debate_event", eventType: event.type };
    var fields = ["turnId", "topic", "format", "moderatorId", "moderatorName", "panelists", "mateName", "role", "round", "activity", "delta", "text", "reason", "action", "avatarStyle", "avatarSeed", "avatarColor", "avatarCustom"];
    for (var fi = 0; fi < fields.length; fi++) if (Object.prototype.hasOwnProperty.call(event, fields[fi])) live[fields[fi]] = event[fields[fi]];
    if (event.mateId) live.speakerMateId = event.mateId;
    return Object.assign(live, metadata);
  }
  if (session && session.debateSetupMode === true && session.homeDebatePhase !== "live") {
    if (event.type === "delta") return null;
    if (event.type === "result" || event.type === "done") return Object.assign({ type: "home_mate_done", text: "" }, metadata);
  }
  if (session && session.homeDebatePlanning === true && session.homeDebatePhase === "live" && (event.type === "delta" || event.type === "result" || event.type === "done" || event.type === "error")) {
    return null;
  }
  if (event.type === "delta" && typeof event.text === "string") return Object.assign({ type: "home_mate_delta", text: event.text }, metadata);
  if (event.type === "result" || event.type === "done") return Object.assign({ type: "home_mate_done", text: session ? latestAssistantText(session.history) : "" }, metadata);
  if (event.type === "error") return Object.assign({ type: "home_mate_error", text: event.text || "Unknown error" }, metadata);
  if (event.type === "debate_proposal" && event.proposal) {
    return Object.assign({ type: "home_debate_proposal", proposal: event.proposal }, metadata);
  }
  if (event.type === "debate_proposal_resolved" && event.proposalId) return Object.assign({ type: "home_debate_proposal_resolved", proposalId: event.proposalId, action: event.action || "cancel", error: event.error || "" }, metadata);
  if (session && session.debateSetupMode === true && event.type === "tool_executing" && event.name === "AskUserQuestion" && event.id && event.input) {
    return Object.assign({ type: "home_debate_question", toolId: event.id, questions: homeDebateQuestions(event.input) }, metadata);
  }
  if (session && session.debateSetupMode === true && event.type === "ask_user_answered" && event.toolId) return Object.assign({ type: "home_debate_question_resolved", toolId: event.toolId, status: "answered", answers: event.answers || null }, metadata);
  if (session && session.debateSetupMode === true && event.type === "home_debate_question_expired" && event.toolId) return Object.assign({ type: "home_debate_question_resolved", toolId: event.toolId, status: "expired", error: event.error || "This question expired. Ask Clay to repeat it." }, metadata);
  return null;
}

module.exports = { historyToHomeChat: historyToHomeChat, transformEvent: transformEvent };
