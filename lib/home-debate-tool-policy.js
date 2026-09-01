var splitShellSegments = require("./sdk-skill-discovery").splitShellSegments;
var isSafeBashSegment = require("./safe-bash-commands").isSafeBashSegment;

function hasTopicAnswer(session) {
  if (session && typeof session.homeDebateInitialTopic === "string" && session.homeDebateInitialTopic.trim()) return true;
  var history = session && Array.isArray(session.history) ? session.history : [];
  var firstQuestionId = null;
  for (var i = 0; i < history.length; i++) {
    var event = history[i];
    if (!firstQuestionId && event && event.type === "tool_executing" && event.name === "AskUserQuestion") firstQuestionId = event.id || null;
    if (firstQuestionId && event && event.type === "ask_user_answered" && event.toolId === firstQuestionId) return true;
  }
  return false;
}

function initialToolDecision(session, toolName, input) {
  if (!session || session.homeDebatePlanning !== true || hasTopicAnswer(session)) return null;
  var isSessionQuestion = toolName === "ask_user_questions" || toolName === "mcp__clay-ask-user__ask_user_questions";
  if (isSessionQuestion || toolName === "Skill") return { behavior: "allow", updatedInput: input };
  if (toolName === "AskUserQuestion") return { behavior: "deny", message: "Use the session-bound ask_user_questions tool for the initial freeform topic question." };
  return { behavior: "deny", message: "Ask for the debate topic before inspecting context or using other tools." };
}

var NON_MUTATING_TOOLS = {
  Read: true,
  Glob: true,
  Grep: true,
  WebFetch: true,
  WebSearch: true,
  Skill: true,
  TodoRead: true,
  TaskOutput: true,
  ListMcpResources: true,
  ReadMcpResource: true,
};

var NON_MUTATING_MCP_TOOLS = {
  "mcp__clay-workspace__list_projects": true,
  "mcp__clay-workspace__list_project_sessions": true,
  "mcp__clay-workspace__search_project_history": true,
  "mcp__clay-workspace__read_project_session": true,
  "mcp__clay-workspace__search_workspace_history": true,
  "mcp__clay-workspace__list_workspace_activity": true,
  "mcp__clay-workspace__get_assignment_status": true,
};

function safeBash(input) {
  if (!input || typeof input.command !== "string" || !input.command.trim()) return false;
  var command = input.command.trim();
  if (/[<>`]/.test(command) || /\$\(/.test(command) || /(^|\s)sudo(\s|$)/.test(command)) return false;
  var segments = splitShellSegments(command);
  if (!segments.length) return false;
  for (var i = 0; i < segments.length; i++) {
    if (!isSafeBashSegment(segments[i])) return false;
    var segment = segments[i].trim();
    var commandName = segment.replace(/^(?:\w+=\S*\s+)*/, "").split(/\s+/)[0];
    if ({ env: true, command: true, time: true, tee: true, xargs: true, wget: true, http: true }[commandName]) return false;
    if (commandName === "find" && /\s-(?:delete|exec|execdir|ok|okdir)(?:\s|$)/.test(segment)) return false;
    if (commandName === "sed" && /\s-(?:[^\s]*i[^\s]*|file)(?:\s|$)/.test(segment)) return false;
    if (commandName === "awk" && /\bsystem\s*\(/.test(segment)) return false;
    if (commandName === "curl" && /\s(?:-o|-O|-T|-d|-F|--output|--remote-name|--upload-file|--request|--data|--form|-X)(?:\s|=|$)/.test(segment)) return false;
  }
  return true;
}

var DISPLAYABLE_COMMANDS = {
  rg: true, grep: true, git: true, find: true, ls: true, pwd: true, wc: true, head: true, tail: true,
  sed: true, awk: true, sort: true, uniq: true, diff: true, stat: true, file: true, tree: true, curl: true,
  rm: true, mv: true, cp: true, mkdir: true, touch: true, chmod: true, chown: true, npm: true, node: true,
};

function shellCommandNames(input) {
  if (!input || typeof input.command !== "string") return [];
  var segments = splitShellSegments(input.command.trim());
  var names = [];
  for (var i = 0; i < segments.length && names.length < 3; i++) {
    var name = segments[i].trim().replace(/^(?:\w+=\S*\s+)*/, "").split(/\s+/)[0] || "";
    name = name.split("/").pop().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 24);
    if (DISPLAYABLE_COMMANDS[name] && names.indexOf(name) === -1) names.push(name);
  }
  return names;
}

function toolAction(toolName, input, allowed) {
  if (toolName === "Bash") {
    var names = shellCommandNames(input);
    return (allowed ? "Run read-only shell commands" : "Run shell commands") + (names.length ? " (" + names.join(", ") + ")" : "");
  }
  if (toolName === "Read") return "Read project files";
  if (toolName === "Glob") return "Find project files";
  if (toolName === "Grep") return "Search project text";
  if (toolName === "WebSearch") return "Search the web";
  if (toolName === "WebFetch") return "Read a web page";
  if (toolName === "Edit" || toolName === "NotebookEdit") return "Edit a project file";
  if (toolName === "Write") return "Write a project file";
  if (toolName.indexOf("search_workspace_history") !== -1) return "Search workspace history";
  if (toolName.indexOf("read_project_session") !== -1) return "Read a project session";
  if (toolName.indexOf("list_project_sessions") !== -1) return "List project sessions";
  if (toolName.indexOf("list_projects") !== -1) return "List projects";
  return "Use " + displayToolName(toolName);
}

function decisionReason(toolName, allowed) {
  if (allowed) return "Read-only investigation";
  if (toolName === "Edit" || toolName === "Write" || toolName === "NotebookEdit") return "Would modify project files";
  if (toolName === "Bash") return "Command may change the system";
  return "Not verified as read-only";
}

function auditCommand(toolName, input) {
  if (toolName !== "Bash" || !input || typeof input.command !== "string") return { command: "", truncated: false };
  var clean = input.command.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return { command: clean.slice(0, 4000), truncated: clean.length > 4000 };
}

function debateToolDecision(toolName, input) {
  toolName = typeof toolName === "string" ? toolName : "";
  var allowed = NON_MUTATING_TOOLS[toolName] === true;
  if (toolName === "Bash") allowed = safeBash(input);
  if (NON_MUTATING_MCP_TOOLS[toolName] === true || toolName.indexOf("mcp__clay-history__") === 0) allowed = true;
  var audit = auditCommand(toolName, input);
  return {
    allowed: allowed,
    behavior: allowed ? "allow" : "deny",
    updatedInput: allowed ? input : undefined,
    message: allowed ? undefined : "The moderator blocked this tool because debate participants may not change the system.",
    action: toolAction(toolName, input, allowed),
    reason: decisionReason(toolName, allowed),
    command: audit.command,
    commandTruncated: audit.truncated,
  };
}

function displayToolName(toolName) {
  var name = typeof toolName === "string" ? toolName : "Tool";
  if (name.indexOf("mcp__") === 0) name = name.substring(name.lastIndexOf("__") + 2);
  name = name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!name) return "Tool";
  return name.length > 48 ? name.slice(0, 45).trim() + "..." : name;
}

module.exports = {
  initialToolDecision: initialToolDecision,
  debateToolDecision: debateToolDecision,
  displayToolName: displayToolName,
};
