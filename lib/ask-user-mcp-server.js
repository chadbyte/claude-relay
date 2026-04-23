// Ask User MCP Server for Clay
// Provides a mate-only ask_user_questions tool that reuses the existing
// AskUserQuestion UI and ask_user_response flow.

var z;
try { z = require("zod"); } catch (e) { z = null; }

// Returns a Zod "shape" object (property -> zod field) matching what
// Claude SDK's `sdk.tool()` expects. Do NOT wrap in z.object() here —
// the SDK does that internally.
function buildQuestionShape() {
  if (!z) return {};

  var optionSchema = z.object({
    label: z.string(),
    description: z.string().optional(),
    markdown: z.string().optional(),
  }).passthrough();

  var questionSchema = z.object({
    header: z.string().optional(),
    question: z.string(),
    multiSelect: z.boolean().optional(),
    options: z.array(optionSchema).optional(),
  }).passthrough();

  return {
    questions: z.array(questionSchema).min(1).describe("Array of question objects. Each has { header, question, multiSelect, options: [{ label, description, markdown }] }."),
  };
}

function getToolDefs(onAsk) {
  var tools = [];

  tools.push({
    name: "ask_user_questions",
    description: "Ask the user a question using Clay's existing AskUserQuestion UI. This reuses the same question card and answer flow as Claude.",
    inputSchema: buildQuestionShape(),
    handler: function (args) {
      if (!args || !Array.isArray(args.questions) || args.questions.length === 0) {
        return Promise.resolve({
          content: [{ type: "text", text: "Error: questions must be a non-empty array." }],
          isError: true,
        });
      }
      return onAsk(args);
    },
  });

  return tools;
}

module.exports = { getToolDefs: getToolDefs };
