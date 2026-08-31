// Ask User MCP Server for Clay
// Provides a mate-only ask_user_questions tool that reuses the existing
// AskUserQuestion UI and ask_user_response flow.

var z;
try { z = require("zod"); } catch (e) { z = null; }

// Returns a Zod "shape" object (property -> zod field) matching what
// Claude SDK's `sdk.tool()` expects. Do NOT wrap in z.object() here —
// the SDK does that internally.
//
// The schema supports either a freeform question (zero options) or a
// structured choice (2-6 options). Exactly one option is never meaningful.
function buildQuestionShape() {
  if (!z) return {};

  var optionSchema = z.object({
    label: z.string().min(1).max(60)
      .describe("Short button label, 1-6 words. Shown as the primary option text."),
    description: z.string().min(1).max(160)
      .describe("One-line clarifier shown under the label. Concrete example or scope."),
    markdown: z.string().optional()
      .describe("Optional longer markdown body shown on expand. Use sparingly."),
  }).passthrough();

  var questionSchema = z.object({
    header: z.string().min(1).max(40)
      .describe("Short ALL-CAPS-ish section header above the question (e.g. 'FIRST THINGS FIRST', 'SCOPE'). Gives the user context for this step."),
    question: z.string().min(1)
      .describe("The actual question in natural spoken tone. Be specific, not generic."),
    multiSelect: z.boolean().optional()
      .describe("Set true only when multiple answers genuinely make sense. Default false."),
    options: z.array(optionSchema).max(6).refine(function (options) { return options.length === 0 || options.length >= 2; }, "Use zero options for freeform, or 2-6 options for a structured choice.")
      .describe("Use [] for an open-ended freeform answer. Otherwise provide 2-6 concrete choices. Never provide exactly one option or add an Other option; structured UIs supply Other automatically."),
  }).passthrough();

  return {
    questions: z.array(questionSchema).min(1).max(3)
      .describe("One to three question objects to show together as a card. Prefer ONE focused question per call."),
  };
}

var TOOL_DESCRIPTION = [
  "Ask the user one or more questions as safe interaction cards.",
  "",
  "WHEN TO USE:",
  "- Interviewing the user at mate setup, or whenever you need to narrow scope before acting.",
  "- Open-ended discovery where the user must answer freely: pass options: [].",
  "- Branching decisions where 2-6 concrete choices cover most of the space.",
  "",
  "REQUIRED STRUCTURE (all fields matter, do not skip):",
  "- header: short section label, like 'FIRST THINGS FIRST' or 'SCOPE'. Gives context.",
  "- question: one specific question in natural tone. Avoid generic 'how can I help?'.",
  "- options: use [] for a genuinely open-ended question. Otherwise provide 2-6 choices with a short label and description. Never provide exactly one option. Structured UIs render an Other field automatically.",
  "- multiSelect: omit or false unless multiple answers clearly apply.",
  "",
  "ON OPTION COUNT (IMPORTANT):",
  "- Default to 4 options. Not 3. Models tend to gravitate to 3 because it feels tidy; resist that.",
  "- If you're about to produce 3 options, stop and think: is there a fourth axis you're missing? A scope variant? A 'both' or 'neither'? A more niche case? Add it.",
  "- 3 is only acceptable when the fourth option would be truly degenerate (e.g. yes/no/unsure).",
  "- 5 or 6 is fine when the space is wide; don't cram.",
  "",
  "GOOD EXAMPLE:",
  '  { header: "FIRST THINGS FIRST",',
  '    question: "\'Language\' is broad, what do you actually want help with?",',
  '    options: [',
  '      { label: "A new language from scratch", description: "Pick up a language you don\'t speak yet (e.g. Japanese, Spanish)" },',
  '      { label: "Sharpen English",             description: "Level up your English, writing, speaking, nuance, executive communication" },',
  '      { label: "Sharpen Korean",              description: "Polish your Korean, writing style, formal register, etc." },',
  '      { label: "Teach me how to teach",       description: "Help you teach language to others, like Elyse or team members" }',
  "    ] }",
  "",
  "BAD EXAMPLES (do not do this):",
  "- Using a freeform card when concrete choices would help the user decide.",
  "- Options with only labels and no descriptions.",
  "- Defaulting to exactly 3 options out of habit. Aim for 4.",
  "- More than one question per call unless they are tightly related.",
  "- Single-option questions. Use zero options for freeform or at least two real choices.",
].join("\n");

function getToolDefs(onAsk) {
  var tools = [];

  tools.push({
    name: "ask_user_questions",
    description: TOOL_DESCRIPTION,
    inputSchema: buildQuestionShape(),
    handler: function (args) {
      if (!args || !Array.isArray(args.questions) || args.questions.length === 0) {
        return Promise.resolve({
          content: [{ type: "text", text: "Error: questions must be a non-empty array." }],
          isError: true,
        });
      }
      // Defensive check for adapters that do not execute the Zod schema.
      for (var i = 0; i < args.questions.length; i++) {
        var q = args.questions[i];
        var optionCount = q && Array.isArray(q.options) ? q.options.length : 0;
        if (!q || optionCount === 1 || optionCount > 6) {
          return Promise.resolve({
            content: [{
              type: "text", text: "Error: question " + (i + 1) + " must use zero options for freeform, or 2-6 options for a structured choice.",
            }],
            isError: true,
          });
        }
        if (!Array.isArray(q.options)) q.options = [];
      }
      return onAsk(args);
    },
  });

  return tools;
}

module.exports = { getToolDefs: getToolDefs };
