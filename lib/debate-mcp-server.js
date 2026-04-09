// Debate MCP Server for Clay (in-process SDK version)
// Provides the propose_debate tool so mates can propose debates
// via the SDK tool system instead of writing files to disk.
//
// Usage:
//   var debateMcp = require("./debate-mcp-server");
//   var mcpConfig = debateMcp.create(onPropose);
//   // Pass mcpConfig to sdk-bridge opts.mcpServers

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
function create(onPropose) {
  var sdk;
  try { sdk = require("@anthropic-ai/claude-agent-sdk"); } catch (e) {
    console.error("[debate-mcp] Failed to load SDK:", e.message);
    return null;
  }

  var createSdkMcpServer = sdk.createSdkMcpServer;
  var tool = sdk.tool;
  if (!createSdkMcpServer || !tool) {
    console.error("[debate-mcp] SDK missing createSdkMcpServer or tool helper");
    return null;
  }

  var tools = [];

  tools.push(tool(
    "propose_debate",
    "Propose a structured debate among Clay Mates. The user will see an inline approval card. The tool blocks until the user approves or cancels.",
    buildShape({
      topic: { type: "string", description: "The debate topic" },
      format: { type: "string", description: "Debate format, e.g. free_discussion (default)" },
      context: { type: "string", description: "Key context from the conversation that panelists should know" },
      specialRequests: { type: "string", description: "Special instructions for the debate, or empty" },
      panelists: { type: "string", description: "JSON array of panelist objects: [{\"mateId\": \"<UUID>\", \"role\": \"perspective\", \"brief\": \"guidance\"}]" },
    }, ["topic", "panelists"]),
    function (args) {
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
  ));

  return createSdkMcpServer({
    name: "clay-debate",
    version: "1.0.0",
    tools: tools,
  });
}

module.exports = { create: create };
