// Session-bound access to the source of a Clay session handoff.

var buildShape = require("./session-spawn-mcp-server").buildShape;

var TOOL_DESCRIPTION =
  "This session was continued from another agent's session via a context snapshot. " +
  "That snapshot omitted tool calls and older turns. Read the original Clay session record directly, including user messages, assistant text, and summarized tool calls, regardless of which vendor produced it.";

function getToolDefs(handlers) {
  return [
    {
      name: "read_handoff_source",
      description: TOOL_DESCRIPTION,
      inputSchema: buildShape({
        offset: {
          type: "number",
          description: "Skip the first N history entries. Omit to return the last limit entries.",
        },
        limit: {
          type: "number",
          description: "Maximum history entries to return. Defaults to 30 and is capped at 100.",
        },
        sourceSessionId: {
          type: "string",
          description: "Source session in this session's handoff chain. Omit to read the immediate source.",
        },
      }),
      handler: function (args) { return handlers.read(args || {}); },
    },
  ];
}

module.exports = {
  TOOL_DESCRIPTION: TOOL_DESCRIPTION,
  getToolDefs: getToolDefs,
};
