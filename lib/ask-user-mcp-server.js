// Ask User MCP Server for Clay
// Provides a mate-only ask_user_questions tool that reuses the existing
// AskUserQuestion UI and ask_user_response flow.

var z;
try { z = require("zod"); } catch (e) { z = null; }

// Returns a Zod "shape" object (property -> zod field) matching what
// Claude SDK's `sdk.tool()` expects. Do NOT wrap in z.object() here —
// the SDK does that internally.
//
// The schema is deliberately tight: options are required (2-6), each with
// a label and a short description. This pushes Codex (which treats the
// schema as a loose hint) toward producing well-structured multiple-choice
// cards instead of a bare "Other..." text field.
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
    options: z.array(optionSchema).min(2).max(6)
      .describe("Concrete options. Preferred count is 4; acceptable range is 2-6. FOUR is the target. Do NOT default to 3 out of habit. If you can only think of 3, push yourself: add a scope variant, edge case, or 'combined' option as the 4th. Only drop below 4 when the answer space is genuinely narrower (e.g. yes/no/unsure). Never include an 'Other' option yourself (the UI renders one automatically)."),
  }).passthrough();

  return {
    questions: z.array(questionSchema).min(1).max(3)
      .describe("One to three question objects to show together as a card. Prefer ONE focused question per call."),
  };
}

var TOOL_DESCRIPTION = [
  "Ask the user a structured multiple-choice question. Renders as a card with a header, the question, 2-6 clickable option buttons, and an always-present 'Other...' free-text field.",
  "",
  "WHEN TO USE:",
  "- Interviewing the user at mate setup, or whenever you need to narrow scope before acting.",
  "- Any branching decision where 2-6 concrete choices cover most of the space.",
  "",
  "REQUIRED STRUCTURE (all fields matter, do not skip):",
  "- header: short section label, like 'FIRST THINGS FIRST' or 'SCOPE'. Gives context.",
  "- question: one specific question in natural tone. Avoid generic 'how can I help?'.",
  "- options: ALWAYS provide FOUR options by default. Acceptable range is 4-6; only drop to 3 if the answer space is genuinely binary-plus-one (rare). Each option has a short label (1-6 words) AND a one-line description giving a concrete example or scope. The UI already renders an 'Other...' text field, so you never need to include an 'Other' option yourself.",
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
  "- Asking a vague question with no options and relying on the Other field.",
  "- Options with only labels and no descriptions.",
  "- Defaulting to exactly 3 options out of habit. Aim for 4.",
  "- More than one question per call unless they are tightly related.",
  "- Single-option 'questions' (use a plain message instead).",
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
      // Defensive structural check only: zod already enforces min 2.
      // We do NOT reject on "only 3 options" — that's a soft preference
      // expressed via the tool description, not a hard validation rule.
      for (var i = 0; i < args.questions.length; i++) {
        var q = args.questions[i];
        if (!q || !Array.isArray(q.options) || q.options.length < 2) {
          return Promise.resolve({
            content: [{
              type: "text",
              text: "Error: question " + (i + 1) + " must include at least 2 options. "
                + "Provide concrete { label, description } choices (4 preferred). "
                + "The UI already shows an 'Other...' free-text field, so never add an 'Other' option yourself.",
            }],
            isError: true,
          });
        }
      }
      return onAsk(args);
    },
  });

  return tools;
}

module.exports = { getToolDefs: getToolDefs };
