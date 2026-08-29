// Partner-control tools for sessions that belong to a split group.

var buildShape = require("./session-spawn-mcp-server").buildShape;

function getToolDefs(handlers) {
  return [
    {
      name: "send_to_partner",
      description: "Delegate one concrete task to the other session in this split. The partner works visibly in its own pane. A completed turn does not end the Worker session: reuse the same Worker for follow-up implementation and corrections instead of taking over its work. Detached completions are pushed back automatically. A delegated turn cannot delegate back, so keep orchestration one hop deep.",
      inputSchema: buildShape({
        message: { type: "string", description: "The complete task or question for the partner." },
        wait: { type: "boolean", description: "Wait for the partner's turn to finish. Defaults to true." },
        timeoutSeconds: { type: "number", description: "Maximum wait in seconds, from 1 to 900. Defaults to 300." },
      }, ["message"]),
      handler: function (args) { return handlers.send(args || {}); },
    },
    {
      name: "read_partner",
      description: "Read the partner's current status and recent conversation turns. Use this for an interim check after a non-waiting delegation or timeout; completed results are pushed automatically.",
      inputSchema: buildShape({
        lastTurns: { type: "number", description: "Number of recent user-message-delimited turns, from 1 to 5. Defaults to 1." },
      }),
      handler: function (args) { return handlers.read(args || {}); },
    },
  ];
}

module.exports = { getToolDefs: getToolDefs };
