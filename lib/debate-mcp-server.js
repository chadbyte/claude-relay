// Debate MCP Server for Clay
// Provides the propose_debate tool definition.
// SDK-free: returns runtime-agnostic tool definitions for YOKE adapter.
//
// Usage:
//   var debateMcp = require("./debate-mcp-server");
//   var toolDefs = debateMcp.getToolDefs(onPropose);
//   var mcpConfig = adapter.createToolServer({ name: "clay-debate", version: "1.0.0", tools: toolDefs });

var z;
try { z = require("zod"); } catch (e) { z = null; }

function buildShape(props, required) {
  if (!z) return {};
  var shape = {};
  var keys = Object.keys(props);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var p = props[k];
    var field;
    if (p.type === "number") field = z.number();
    else if (p.type === "boolean") field = z.boolean();
    else if (p.enum) field = z.enum(p.enum);
    else field = z.string();
    if (p.description) field = field.describe(p.description);
    if (!required || required.indexOf(k) === -1) field = field.optional();
    shape[k] = field;
  }
  return shape;
}

// onPropose(briefData) -> Promise<{action: "start"|"cancel"}>
// The returned Promise blocks the tool until the user approves or cancels.
function getToolDefs(onPropose) {
  var tools = [];

  tools.push({
    name: "propose_debate",
    description: "Propose a structured debate among Clay Mates. The user will see an inline approval card. The tool blocks until the user approves or cancels.",
    inputSchema: buildShape({
      topic: { type: "string", description: "The debate topic" },
      format: { type: "string", description: "Debate format, e.g. free_discussion (default)" },
      context: { type: "string", description: "Key context from the conversation that panelists should know" },
      specialRequests: { type: "string", description: "Special instructions for the debate, or empty" },
      panelists: { type: "string", description: "JSON array of panelist objects: [{\"mateId\": \"<UUID>\", \"role\": \"perspective\", \"brief\": \"guidance\"}]" },
    }, ["topic", "panelists"]),
    handler: function (args) {
      var panelists;
      try {
        panelists = JSON.parse(args.panelists);
      } catch (e) {
        return Promise.resolve({
          content: [{ type: "text", text: "Error: panelists must be a valid JSON array. Got: " + (args.panelists || "").substring(0, 100) }],
        });
      }

      var briefData = {
        topic: args.topic || "Untitled debate",
        format: args.format || "free_discussion",
        context: args.context || "",
        specialRequests: args.specialRequests || null,
        panelists: panelists,
      };

      return onPropose(briefData).then(function (result) {
        if (result && result.action === "start") {
          return { content: [{ type: "text", text: "Debate approved and started. Topic: " + briefData.topic }] };
        }
        return { content: [{ type: "text", text: "Debate proposal was cancelled by the user." }] };
      });
    }
  });

  return tools;
}

module.exports = { getToolDefs: getToolDefs };
