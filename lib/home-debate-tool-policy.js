function hasTopicAnswer(session) {
  var history = session && Array.isArray(session.history) ? session.history : [];
  var firstQuestionId = null;
  for (var i = 0; i < history.length; i++) {
    var event = history[i];
    if (!firstQuestionId && event && event.type === "tool_executing" && event.name === "AskUserQuestion") firstQuestionId = event.id || null;
    if (firstQuestionId && event && event.type === "ask_user_answered" && event.toolId === firstQuestionId) return true;
  }
  return false;
}

function initialToolDecision(session, toolName, input) {
  if (!session || session.homeDebatePlanning !== true || hasTopicAnswer(session)) return null;
  var isSessionQuestion = toolName === "ask_user_questions" || toolName === "mcp__clay-ask-user__ask_user_questions";
  if (isSessionQuestion || toolName === "Skill") return { behavior: "allow", updatedInput: input };
  if (toolName === "AskUserQuestion") return { behavior: "deny", message: "Use the session-bound ask_user_questions tool for the initial freeform topic question." };
  return { behavior: "deny", message: "Ask for the debate topic before inspecting context or using other tools." };
}

module.exports = { initialToolDecision: initialToolDecision };
