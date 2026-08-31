// Canonical session event projection for the embedded Home transcript.

function homeDebateQuestions(input) {
  var source = input && Array.isArray(input.questions) && input.questions[0] ? input.questions[0] : null;
  if (!source) return [];
  var question = { header: source.header || "", question: source.question || "", multiSelect: false, options: [] };
  var options = Array.isArray(source.options) ? source.options.slice(0, 3) : [];
  for (var i = 0; i < options.length; i++) question.options.push({ label: options[i].label || "Option", description: options[i].description || "" });
  return [question];
}

function historyToHomeChat(history, debateSetupMode) {
  var messages = [];
  var pending = "";
  function flushAssistant() {
    if (!pending) return;
    messages.push({ role: "assistant", text: pending });
    pending = "";
  }
  for (var i = 0; i < history.length; i++) {
    var event = history[i];
    if (!event) continue;
    if (event.type === "user_message" && event.text && event.askUserAnswer !== true) {
      flushAssistant();
      messages.push({ role: "user", text: event.text });
    } else if (event.type === "delta" && typeof event.text === "string") {
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
    if (event.type === "user_message" || event.type === "debate_proposal" || event.type === "debate_proposal_resolved" || (event.type === "tool_executing" && event.name === "AskUserQuestion")) break;
  }
  return text;
}

function transformEvent(event, mateId, session, requestId, stableSessionId) {
  if (!event || typeof event.type !== "string") return null;
  var metadata = { mateId: mateId, sessionId: stableSessionId || null, requestId: requestId || null, model: session && session.model ? session.model : null, vendor: session && session.vendor ? session.vendor : null };
  if (event.type === "delta" && typeof event.text === "string") return Object.assign({ type: "home_mate_delta", text: event.text }, metadata);
  if (event.type === "result" || event.type === "done") return Object.assign({ type: "home_mate_done", text: session ? latestAssistantText(session.history) : "" }, metadata);
  if (event.type === "error") return Object.assign({ type: "home_mate_error", text: event.text || "Unknown error" }, metadata);
  if (event.type === "debate_proposal" && event.proposal) return Object.assign({ type: "home_debate_proposal", proposal: event.proposal }, metadata);
  if (event.type === "debate_proposal_resolved" && event.proposalId) return Object.assign({ type: "home_debate_proposal_resolved", proposalId: event.proposalId, action: event.action || "cancel", error: event.error || "" }, metadata);
  if (session && session.debateSetupMode === true && event.type === "tool_executing" && event.name === "AskUserQuestion" && event.id && event.input) return Object.assign({ type: "home_debate_question", toolId: event.id, questions: homeDebateQuestions(event.input) }, metadata);
  if (session && session.debateSetupMode === true && event.type === "ask_user_answered" && event.toolId) return Object.assign({ type: "home_debate_question_resolved", toolId: event.toolId, status: "answered", answers: event.answers || null }, metadata);
  if (session && session.debateSetupMode === true && event.type === "home_debate_question_expired" && event.toolId) return Object.assign({ type: "home_debate_question_resolved", toolId: event.toolId, status: "expired", error: event.error || "This question expired. Ask Clay to repeat it." }, metadata);
  return null;
}

module.exports = { historyToHomeChat: historyToHomeChat, transformEvent: transformEvent };
