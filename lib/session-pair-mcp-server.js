// Partner-control tools for sessions that belong to a split group.

var buildShape = require("./session-spawn-mcp-server").buildShape;

function getToolDefs(handlers) {
  return [
    {
      name: "send_to_partner",
      description: "Delegate one concrete task to the Worker. If this session has no pair yet, Clay creates a real Worker session and opens it visibly in the right pane before starting the task. A completed turn does not end the Worker session: reuse the same Worker for follow-up implementation and corrections instead of taking over its work. Detached completions are pushed back automatically. A delegated turn cannot delegate back, so keep orchestration one hop deep.",
      inputSchema: buildShape({
        message: { type: "string", description: "The complete task or question for the partner." },
        wait: { type: "boolean", description: "Wait for the partner's turn to finish. Defaults to true." },
        timeoutSeconds: { type: "number", description: "Maximum wait in seconds, from 1 to 900. Defaults to 300." },
        workerVendor: { type: "string", description: "Optional Worker vendor to use only when creating a new pair. Defaults to a suitable installed vendor." },
        workerModel: { type: "string", description: "Optional Worker model to use only when creating a new pair." },
        workerEffort: { type: "string", description: "Optional Worker reasoning effort to use only when creating a new pair." },
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
    {
      name: "interrupt_partner",
      description: "Interrupt the Worker's current task. Use this when the task is going in the wrong direction, needs to be reprioritized, or must stop before the next instruction. The Worker returns any partial result to you for review.",
      inputSchema: buildShape({}),
      handler: function (args) { return handlers.interrupt(args || {}); },
    },
    {
      name: "close_partner",
      description: "Close the visible Worker pane and dissolve the Driver/Worker pair while preserving both session histories. If the Worker is still running, Clay interrupts it before closing the pair.",
      inputSchema: buildShape({}),
      handler: function (args) { return handlers.close(args || {}); },
    },
  ];
}

module.exports = { getToolDefs: getToolDefs };
