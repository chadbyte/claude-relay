var spawnSync = require("child_process").spawnSync;
var yoke = require("./yoke");

var MAX_CONTEXT_CHARS = 36000;
var MAX_TURNS = 12;
var MAX_USER_CHARS = 5000;
var MAX_ASSISTANT_CHARS = 9000;
var MAX_GIT_CHARS = 5000;
var MAX_TRANSCRIPT_CHARS = 24000;

function trimText(value, limit) {
  var text = typeof value === "string" ? value.trim() : "";
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n[truncated]";
}

function recentTurns(history) {
  var turns = [];
  var current = null;
  history = Array.isArray(history) ? history : [];
  for (var i = 0; i < history.length; i++) {
    var entry = history[i];
    if (!entry) continue;
    if (entry.type === "user_message" || (entry.type === "handoff_context" && entry.request)) {
      current = { user: trimText(entry.text || entry.request, MAX_USER_CHARS), assistant: "" };
      turns.push(current);
    } else if (entry.type === "delta" && entry.text) {
      if (!current) {
        current = { user: "", assistant: "" };
        turns.push(current);
      }
      current.assistant += entry.text;
      if (current.assistant.length > MAX_ASSISTANT_CHARS) {
        current.assistant = current.assistant.slice(-MAX_ASSISTANT_CHARS);
      }
    }
  }
  return turns.slice(-MAX_TURNS);
}

function latestUserRequest(history) {
  var turns = recentTurns(history);
  for (var i = turns.length - 1; i >= 0; i--) {
    if (turns[i].user) return turns[i].user;
  }
  return "";
}

function gitCommand(cwd, args) {
  var result = spawnSync("git", args, {
    cwd: cwd,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) return "";
  return trimText(result.stdout, MAX_GIT_CHARS);
}

function repositoryState(cwd) {
  var status = gitCommand(cwd, ["status", "--short", "--branch"]);
  var lines = [];
  lines.push("Working tree:\n" + (status || "clean"));
  return lines.join("\n\n");
}

function transcriptText(turns) {
  var sections = [];
  for (var i = 0; i < turns.length; i++) {
    var turn = turns[i];
    var parts = ["Turn " + (i + 1)];
    if (turn.user) parts.push("USER:\n" + turn.user);
    if (turn.assistant) parts.push("ASSISTANT:\n" + trimText(turn.assistant, MAX_ASSISTANT_CHARS));
    sections.push(parts.join("\n\n"));
  }
  while (sections.length > 1 && sections.join("\n\n---\n\n").length > MAX_TRANSCRIPT_CHARS) {
    sections.shift();
  }
  return sections.join("\n\n---\n\n");
}

function buildHandoffContext(options) {
  var source = options.source;
  var targetVendor = options.targetVendor;
  var sourceVendor = source.vendor || "claude";
  var sourceName = (yoke.getVendorInfo(sourceVendor) || {}).displayName || sourceVendor;
  var targetName = (yoke.getVendorInfo(targetVendor) || {}).displayName || targetVendor;
  var turns = recentTurns(source.history);
  var latestUser = latestUserRequest(source.history);
  var parts = [
    "[Clay session handoff]",
    "You are continuing work from another Clay coding-agent session. This is a snapshot, not a native conversation resume. Verify the current filesystem state before acting.",
    "Source agent: " + sourceName,
    "Target agent: " + targetName,
    "Source session: " + (source.title || "Untitled session") + " (#" + source.localId + ")",
  ];
  if (latestUser) parts.push("Current user request, verbatim:\n" + latestUser);
  parts.push("Repository state at handoff:\n" + repositoryState(options.cwd));
  parts.push("Recent conversation:\n" + transcriptText(turns));
  if (options.sourceReadTool) {
    parts.push("The snapshot above is partial. The read_handoff_source tool from the clay-handoff MCP server can read the full original session, including summarized tool calls and older turns. Call it when the snapshot leaves a question open.");
  }
  parts.push("Continue from the unresolved work above. Preserve the user's decisions and constraints, inspect the actual files before making assumptions, and proceed without asking the user to repeat context.");
  return trimText(parts.join("\n\n"), MAX_CONTEXT_CHARS);
}

module.exports = {
  MAX_CONTEXT_CHARS: MAX_CONTEXT_CHARS,
  buildHandoffContext: buildHandoffContext,
  latestUserRequest: latestUserRequest,
  recentTurns: recentTurns,
  repositoryState: repositoryState,
};
