var z;
try { z = require("zod"); } catch (e) { z = null; }
var toolUiSpec = require("./tool-ui-spec");

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
  if (!z) return { list: {}, tool: {}, act: {}, set: {}, install: {}, uninstall: {} };
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
    install: {
      manifest: z.record(z.string(), z.any()),
      uiTree: z.record(z.string(), z.any()),
      logicSource: z.string().min(1),
    },
    uninstall: { toolId: z.string().min(1).describe("Installed worker capsule ID to remove.") },
  };
}

var INSTALL_DESCRIPTION = [
  "Install or replace a user-owned worker capsule. This requires user approval.",
  "manifest: {id: lowercase-slug, name, lucideIcon?, runtime:'worker', permissions?:['llm'], initialAction?, skills?: markdown}.",
  toolUiSpec.authoringDescription(),
  "logicSource must define: var tool = { initialState: {...}, actions: { name: function (state, args, api) { ... return newState; } } }. Async actions may call api.setState(nextState) to publish intermediate busy/progress UI state before returning the complete final state. An uncaught action error restores the pre-action UI state; catch errors and return an explicit final state to show inline error feedback. Actions may use api.storage.list/get/put/delete/query, api.llm.complete({system?,prompt,model?}) when manifest permissions includes llm, and api.callerId. model is only fast|standard|deep. No DOM, imports, network globals, or vendor model names.",
].join(" ");

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
    {
      name: "clay_tool_install",
      description: INSTALL_DESCRIPTION,
      inputSchema: shape.install,
      handler: function (args) {
        return run(function () { return handlers.install({ manifest: args.manifest, uiTree: args.uiTree, logicSource: args.logicSource }); });
      },
    },
    {
      name: "clay_tool_uninstall",
      description: "Remove a user-owned capsule folder and its data. This requires user approval.",
      inputSchema: shape.uninstall,
      handler: function (args) { return run(function () { return handlers.uninstall(args.toolId); }); },
    },
  ];
}

module.exports = { INSTALL_DESCRIPTION: INSTALL_DESCRIPTION, getToolDefs: getToolDefs };
