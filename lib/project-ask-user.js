var crypto = require("crypto");
var askUserMcp = require("./ask-user-mcp-server");

function attachAskUser(ctx) {
  function getToolDefs(boundSession) {
    return askUserMcp.getToolDefs(function onAsk(input) {
      if (!boundSession) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: this question is not bound to an active session." }], isError: true });
      }
      if (boundSession.loop && boundSession.loop.active && boundSession.loop.role !== "crafting") {
        return Promise.resolve({ content: [{ type: "text", text: "Error: Autonomous mode. Make your own decision." }], isError: true });
      }
      var toolId = "ask_" + Date.now() + "_" + crypto.randomUUID().slice(0, 8);
      if (!boundSession.pendingAskUser) boundSession.pendingAskUser = {};
      boundSession.pendingAskUser[toolId] = { input: input, mode: "mcp", sessionId: boundSession.localId, postedAt: Date.now() };
      ctx.record(boundSession, { type: "tool_executing", id: toolId, name: "AskUserQuestion", input: input });
      return Promise.resolve({
        content: [{ type: "text", text: "The question card has been posted to the user. End this turn now without further commentary; the user's answer will arrive as the next user message, prefixed with \"[Answer to your AskUserQuestion]\" so you can recognize it." }],
      });
    });
  }

  function createMcpServer(adapter, boundSession) {
    var toolDefs = getToolDefs(boundSession);
    return adapter.createToolServer({ name: "clay-ask-user", version: "1.0.0", tools: toolDefs });
  }

  return { createMcpServer: createMcpServer, getToolDefs: getToolDefs };
}

module.exports = { attachAskUser: attachAskUser };
