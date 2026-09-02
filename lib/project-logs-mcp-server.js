// SDK-free `clay-logs` MCP tool definitions for Project Logs.
//
// Two disjoint tool sets. Project sessions get project-scoped tools with no
// projectSlug argument at all, because the binding decides the project and a
// tool argument must never be able to widen it. Authoritative builtin Clay
// gets read-only cross-project tools that take an explicit slug and are
// re-authorized per call. Ordinary Mates get neither.

var buildShape = require("./session-spawn-mcp-server").buildShape;
var logsStore = require("./project-logs-store");

var LOGS_CONTRACT =
  "Project Logs are the project's dry, factual record: decisions, investigations, session notes, runbooks, references, incidents, and progress. " +
  "They are a project artifact shared with people and other sessions, not personal memory and not a persona. Write in plain, neutral, third-person terms about the project, never about yourself. " +
  "Default to not writing. Add a log only when the project gains durable value that outlives this session: a decision and the reasoning behind it, an investigation's findings, a runbook, an incident and its resolution, or a factual progress record someone would need weeks from now. " +
  "Do not log conversation summaries, task narration, restatements of the request, completed-work announcements, speculation, or anything the repository and its history already record. " +
  "Prefer updating an existing log over creating a near-duplicate; list or search first when a duplicate is plausible. Every write is attributed and permanently revision-tracked, so keep entries short, concrete, and true.";

var KIND_DESCRIPTION = "Log kind. One of: " + logsStore.LOG_KINDS.join(", ") + ".";
var REF_DESCRIPTION = "Opaque log reference returned by list_logs, search_logs, or create_log.";

function textResult(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

function errorResult(error) {
  return Promise.resolve({
    content: [{ type: "text", text: "Error: " + (error && error.message ? error.message : String(error)) }],
    isError: true,
  });
}

// An unbound descriptor exists only so a tool list can be advertised before a
// session is known. Every call against it fails closed.
function handler(bound, method) {
  return function (args) {
    if (!bound || typeof bound[method] !== "function") {
      return errorResult(new Error("Project Logs require an exact session-bound project."));
    }
    try {
      return textResult(bound[method](args || {}));
    } catch (e) {
      return errorResult(e);
    }
  };
}

function projectTools(bound) {
  return [
    {
      name: "list_logs",
      description: LOGS_CONTRACT + " List this project's logs, most recently updated first.",
      inputSchema: buildShape({
        kind: { type: "string", enum: logsStore.LOG_KINDS, description: "Optional kind filter." },
        tag: { type: "string", description: "Optional single tag filter." },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous response." },
        limit: { type: "number", description: "Page size, from 1 to " + logsStore.MAX_PAGE + "." },
      }),
      handler: handler(bound, "listLogs"),
    },
    {
      name: "search_logs",
      description: LOGS_CONTRACT + " Search this project's logs by title, tag, and body text. Use this before writing to avoid duplicating an existing record.",
      inputSchema: buildShape({
        query: { type: "string", description: "Search query." },
        kind: { type: "string", enum: logsStore.LOG_KINDS, description: "Optional kind filter." },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous response." },
        limit: { type: "number", description: "Page size, from 1 to " + logsStore.MAX_PAGE + "." },
      }, ["query"]),
      handler: handler(bound, "searchLogs"),
    },
    {
      name: "read_log",
      description: LOGS_CONTRACT + " Read one log entry in full, including its current authorship.",
      inputSchema: buildShape({ ref: { type: "string", description: REF_DESCRIPTION } }, ["ref"]),
      handler: handler(bound, "readLog"),
    },
    {
      name: "log_history",
      description: LOGS_CONTRACT + " Read the revision and authorship history of one log entry.",
      inputSchema: buildShape({
        ref: { type: "string", description: REF_DESCRIPTION },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous response." },
        limit: { type: "number", description: "Page size, from 1 to " + logsStore.MAX_PAGE + "." },
      }, ["ref"]),
      handler: handler(bound, "logHistory"),
    },
    {
      name: "create_log",
      description: LOGS_CONTRACT + " Create a log entry in this project. Apply the test first: will someone need this fact weeks from now, and is it not already recorded? If the answer is unclear, do not call this tool.",
      inputSchema: buildShape({
        kind: { type: "string", enum: logsStore.LOG_KINDS, description: KIND_DESCRIPTION },
        title: { type: "string", description: "Short factual title, plain text." },
        body: { type: "string", description: "The durable facts, context, and outcome in Markdown. No narration of your own activity." },
        tags: { type: "string", description: "Optional JSON array of short tag strings." },
      }, ["kind", "title"]),
      handler: handler(bound, "createLog"),
    },
    {
      name: "update_log",
      description: LOGS_CONTRACT + " Revise an existing log entry. The previous revision and its author are retained.",
      inputSchema: buildShape({
        ref: { type: "string", description: REF_DESCRIPTION },
        kind: { type: "string", enum: logsStore.LOG_KINDS, description: KIND_DESCRIPTION },
        title: { type: "string", description: "Replacement title." },
        body: { type: "string", description: "Replacement record body in Markdown." },
        tags: { type: "string", description: "Optional JSON array of short tag strings, replacing the current tags." },
      }, ["ref"]),
      handler: handler(bound, "updateLog"),
    },
    {
      name: "link_log",
      description: LOGS_CONTRACT + " Attach related references to a log entry, such as a session reference cited elsewhere in Clay.",
      inputSchema: buildShape({
        ref: { type: "string", description: REF_DESCRIPTION },
        links: { type: "string", description: "JSON array of objects: [{\"ref\":\"session:abc\",\"label\":\"triage\"}]" },
      }, ["ref", "links"]),
      handler: handler(bound, "linkLog"),
    },
  ];
}

function globalTools(bound) {
  return [
    {
      name: "list_project_logs",
      description: LOGS_CONTRACT + " List logs for one project the current user is authorized to see. Read-only, and available only to authoritative builtin Clay.",
      inputSchema: buildShape({
        projectSlug: { type: "string", description: "Exact project slug." },
        kind: { type: "string", enum: logsStore.LOG_KINDS, description: "Optional kind filter." },
        tag: { type: "string", description: "Optional single tag filter." },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous response." },
        limit: { type: "number", description: "Page size, from 1 to " + logsStore.MAX_PAGE + "." },
      }, ["projectSlug"]),
      handler: handler(bound, "listLogs"),
    },
    {
      name: "search_project_logs",
      description: LOGS_CONTRACT + " Search logs for one project the current user is authorized to see. Read-only, and available only to authoritative builtin Clay.",
      inputSchema: buildShape({
        projectSlug: { type: "string", description: "Exact project slug." },
        query: { type: "string", description: "Search query." },
        kind: { type: "string", enum: logsStore.LOG_KINDS, description: "Optional kind filter." },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous response." },
        limit: { type: "number", description: "Page size, from 1 to " + logsStore.MAX_PAGE + "." },
      }, ["projectSlug", "query"]),
      handler: handler(bound, "searchLogs"),
    },
    {
      name: "read_project_log",
      description: LOGS_CONTRACT + " Read one log entry from an authorized project. Read-only, and available only to authoritative builtin Clay.",
      inputSchema: buildShape({
        projectSlug: { type: "string", description: "Exact project slug." },
        ref: { type: "string", description: REF_DESCRIPTION },
      }, ["projectSlug", "ref"]),
      handler: handler(bound, "readLog"),
    },
    {
      name: "project_log_history",
      description: LOGS_CONTRACT + " Read the revision and authorship history of one log entry in an authorized project. Read-only, and available only to authoritative builtin Clay.",
      inputSchema: buildShape({
        projectSlug: { type: "string", description: "Exact project slug." },
        ref: { type: "string", description: REF_DESCRIPTION },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous response." },
        limit: { type: "number", description: "Page size, from 1 to " + logsStore.MAX_PAGE + "." },
      }, ["projectSlug", "ref"]),
      handler: handler(bound, "logHistory"),
    },
  ];
}

// A binding is either project-scoped or Clay's cross-project read view. The
// two sets are never advertised together, so no tool name is duplicated.
function getToolDefs(bound, includeGlobal) {
  return includeGlobal === true ? globalTools(bound) : projectTools(bound);
}

function createMcpServer(adapter, bound, includeGlobal) {
  if (!adapter || typeof adapter.createToolServer !== "function") return null;
  return adapter.createToolServer({
    name: "clay-logs",
    version: "1.0.0",
    tools: getToolDefs(bound, includeGlobal),
  });
}

module.exports = {
  LOGS_CONTRACT: LOGS_CONTRACT,
  getToolDefs: getToolDefs,
  createMcpServer: createMcpServer,
};
