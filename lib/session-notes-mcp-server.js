// Sticky-note memory tools for project sessions.

var buildShape = require("./session-spawn-mcp-server").buildShape;

var MEMORY_CONTRACT =
  "The sticky-note board persists across sessions and is a user-facing artifact shared with people and Clay agents, not private agent scratch space. " +
  "Default to not writing. Create a note proactively only when the user explicitly asks to remember or track something, or when all of these are true: it will remain useful after the current task and session, it is not already adequately recorded in the repository or another note, and the user would likely be glad to find it on the board a week later. " +
  "Good notes capture an unresolved commitment, durable product decision, user preference, constraint, or handoff that will materially change future work. " +
  "Important exception for deferred defects: while doing code or technical work, actively create a sticky note when you discover a concrete defect, regression risk, security issue, or data-loss risk that is outside the current session goal and will remain unfixed when the turn ends. Do not wait for the user to ask. Include the observable evidence, affected component, likely impact, and a clear next action. Check active notes first when a duplicate is plausible. Do not create defect notes for speculation, general cleanup ideas, or problems you fixed in the current session. " +
  "Important exception for deferred proposals: when you propose work (a fix, follow-up, improvement, or next step) and the user defers it rather than declining it (\"let's do that later\", \"next time\", \"after this\"), actively create a sticky note before the topic moves on. Do not wait to be asked. Capture what was proposed, why it mattered, and the agreed timing if any. Deferred agreements scroll out of chat history quickly and are hard to track; the board is where they survive. If the user declines the idea outright, do not write a note. " +
  "Never create a note merely because work is important, lengthy, spans agents or restarts, or might help another agent. Do not record completed work, implementation details, test results, investigation logs, transient blockers, conversation summaries, or announcements of your own activity. When uncertain, do not write. " +
  "Updates are visible too: update only when durable state materially changes, and remove a note created by your session when it stops being useful instead of turning it into a completion log. Put a concise plain-text title on the first line, stay focused on one topic, and include only the context needed for future action.";

function getToolDefs(handlers) {
  return [
    {
      name: "list_notes",
      description: MEMORY_CONTRACT + " List the active notes before writing when you need to avoid duplicates or inspect full memory beyond the injected summary.",
      inputSchema: buildShape({}),
      handler: function (args) { return handlers.list(args || {}); },
    },
    {
      name: "write_note",
      description: MEMORY_CONTRACT + " Create a new note, or update an existing note by id. Before creating, apply this test: would the user likely choose to keep this visible on their board next week? If the answer is unclear, do not call this tool. The 20000-character limit is an abuse guard, not a target.",
      inputSchema: buildShape({
        id: { type: "string", description: "Existing note id to update. Omit to create a note." },
        text: { type: "string", description: "User-facing sticky-note text with a concise title on the first line and only durable, action-relevant context below it." },
        color: { type: "string", enum: ["yellow", "blue", "green", "pink", "orange", "purple"], description: "Optional sticky-note color." },
      }, ["text"]),
      handler: function (args) { return handlers.write(args || {}); },
    },
    {
      name: "remove_note",
      description: MEMORY_CONTRACT + " Remove a note created by this same session when it is no longer true. Notes created by users or other sessions cannot be removed.",
      inputSchema: buildShape({
        id: { type: "string", description: "Id of the note to remove." },
      }, ["id"]),
      handler: function (args) { return handlers.remove(args || {}); },
    },
  ];
}

module.exports = {
  MEMORY_CONTRACT: MEMORY_CONTRACT,
  getToolDefs: getToolDefs,
};
