var test = require("node:test");
var assert = require("node:assert/strict");
var policy = require("../lib/home-debate-tool-policy");

test("a form-supplied topic unlocks grounded planning without fabricating an initial question", function () {
  var waiting = { homeDebatePlanning: true, history: [] };
  var seeded = { homeDebatePlanning: true, homeDebateInitialTopic: "Local-first storage", history: [] };
  assert.equal(policy.initialToolDecision(waiting, "Read", { file_path: "README.md" }).behavior, "deny");
  assert.equal(policy.initialToolDecision(seeded, "Read", { file_path: "README.md" }), null);
});

test("Mate creation presents the next question before loading skills or context", function () {
  var session = {
    mateCreationMode: true,
    history: [
      { type: "tool_executing", name: "AskUserQuestion", id: "mate_creation_intent_7" },
      { type: "ask_user_answered", toolId: "mate_creation_intent_7", answers: { 0: "A research partner" } },
    ],
  };
  assert.equal(policy.initialToolDecision(session, "Skill", { skill: "clay-mate-interview" }).behavior, "deny");
  assert.equal(policy.initialToolDecision(session, "Bash", { command: "sed -n '1,240p' SKILL.md" }).behavior, "deny");
  assert.equal(policy.initialToolDecision(session, "Read", { file_path: "common-knowledge.json" }).behavior, "deny");
  assert.equal(policy.initialToolDecision(session, "ask_user_questions", { questions: [] }).behavior, "allow");
  session.history.push({ type: "tool_executing", name: "AskUserQuestion", id: "provider-question-1" });
  assert.equal(policy.initialToolDecision(session, "Read", { file_path: "relevant-context.md" }), null);
  assert.equal(policy.initialToolDecision(session, "Skill", { skill: "clay-mate-interview" }).behavior, "deny");
});

test("debate moderator allows non-mutating investigation capabilities", function () {
  assert.equal(policy.debateToolDecision("Read", { file_path: "/tmp/a" }).allowed, true);
  assert.equal(policy.debateToolDecision("WebSearch", { query: "housing policy" }).allowed, true);
  assert.equal(policy.debateToolDecision("Bash", { command: "rg -n housing lib && git status --short" }).allowed, true);
  assert.equal(policy.debateToolDecision("mcp__clay-workspace__search_workspace_history", { query: "housing" }).allowed, true);
  assert.equal(policy.debateToolDecision("Bash", { command: "rg -n housing lib && git status --short" }).action, "Run read-only shell commands (rg, git)");
  assert.equal(policy.debateToolDecision("Read", { file_path: "/private/path" }).action, "Read project files");
});

test("debate moderator blocks system changes and ambiguous capabilities", function () {
  assert.equal(policy.debateToolDecision("Edit", { file_path: "/tmp/a" }).allowed, false);
  assert.equal(policy.debateToolDecision("Write", { file_path: "/tmp/a" }).allowed, false);
  assert.equal(policy.debateToolDecision("Bash", { command: "echo changed > file.txt" }).allowed, false);
  assert.equal(policy.debateToolDecision("Bash", { command: "git status && rm -f file.txt" }).allowed, false);
  assert.equal(policy.debateToolDecision("Bash", { command: "find . -delete" }).allowed, false);
  assert.equal(policy.debateToolDecision("mcp__remote__unknown_tool", {}).allowed, false);
  assert.equal(policy.debateToolDecision("Edit", { file_path: "/private/path" }).reason, "Would modify project files");
  assert.equal(policy.debateToolDecision("Bash", { command: "rm -f private.txt" }).reason, "Command may change the system");
  assert.equal(policy.debateToolDecision("Bash", { command: "private-secret-command --token hidden" }).action, "Run shell commands");
});

test("debate moderator exposes a safe bounded tool label", function () {
  assert.equal(policy.displayToolName("mcp__clay-workspace__search_workspace_history"), "search workspace history");
  assert.equal(policy.displayToolName("Bash"), "Bash");
  assert.ok(policy.displayToolName("x".repeat(100)).length <= 48);
});
