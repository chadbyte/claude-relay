var z;
try { z = require("zod"); } catch (e) { z = null; }

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error) {
  return {
    content: [{ type: "text", text: "Error: " + (error && error.message ? error.message : String(error)) }],
    isError: true,
  };
}

function run(handler) {
  return Promise.resolve().then(handler).then(textResult).catch(errorResult);
}

function schemas() {
  if (!z) return { list: {}, tool: {}, act: {}, set: {} };
  return {
    list: {},
    tool: { toolId: z.string().min(1).describe("Installed capsule ID.") },
    act: {
      toolId: z.string().min(1),
      actionId: z.string().min(1),
      args: z.record(z.string(), z.any()).optional().describe("Arguments for the tool action."),
    },
    set: {
      toolId: z.string().min(1),
      controlId: z.string().min(1),
      value: z.any().describe("New value for the named control."),
    },
  };
}

function getToolDefs(handlers) {
  var shape = schemas();
  return [
    {
      name: "clay_tool_list",
      description: "List currently installed capsules, their runtimes, and usage skills.",
      inputSchema: shape.list,
      handler: function () { return run(function () { return handlers.list(); }); },
    },
    {
      name: "clay_tool_snapshot",
      description: "Read a capsule's current state, controls, and declarative UI.",
      inputSchema: shape.tool,
      handler: function (args) { return run(function () { return handlers.snapshot(args.toolId); }); },
    },
    {
      name: "clay_tool_act",
      description: "Run a named tool action through the same action path used by the human UI.",
      inputSchema: shape.act,
      handler: function (args) {
        return run(function () { return handlers.act(args.toolId, args.actionId, args.args || {}); });
      },
    },
    {
      name: "clay_tool_set",
      description: "Set an interactive control by ID through the control's normal bound action.",
      inputSchema: shape.set,
      handler: function (args) { return run(function () { return handlers.set(args.toolId, args.controlId, args.value); }); },
    },
  ];
}

module.exports = { getToolDefs: getToolDefs };
