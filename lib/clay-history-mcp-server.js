// Compatibility MCP surface for existing builtin Clay prompts. All reads
// delegate to the same exact-owner workspace query binding as clay-workspace.

var z;
try { z = require("zod"); } catch (e) { z = null; }

function field(type, description, optional) {
  if (!z) return {};
  var value = type === "number" ? z.number() : z.string();
  if (description) value = value.describe(description);
  return optional ? value.optional() : value;
}

function result(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

function error(value) {
  return Promise.resolve({ content: [{ type: "text", text: "Error: " + value }], isError: true });
}

function guarded(workspace, method, mapArgs) {
  return function (args) {
    if (!workspace || workspace.isClay !== true || typeof workspace[method] !== "function") {
      return error("Clay history requires an exact session-bound builtin Clay query.");
    }
    try { return result(workspace[method](mapArgs ? mapArgs(args || {}) : (args || {}))); }
    catch (e) { return error(e && e.message ? e.message : String(e)); }
  };
}

function getToolDefs(deps) {
  var workspace = deps && deps.workspace;
  return [
    {
      name: "search_clay_history",
      description: "Search canonical user and assistant text across projects owned by the current user. Returns sanitized snippets and opaque session references.",
      inputSchema: z ? {
        query: field("string", "Search query."),
        projectSlug: field("string", "Optional project slug.", true),
        maxResults: field("number", "Maximum results, from 1 to 50.", true),
      } : {},
      handler: guarded(workspace, "searchWorkspaceHistory", function (args) {
        if (args.projectSlug) return { projectSlug: args.projectSlug, query: args.query, limit: args.maxResults };
        return { query: args.query, limit: args.maxResults };
      }),
    },
    {
      name: "read_session",
      description: "Read canonical user and assistant turns from an owned session. Raw tool payloads and internal prompts are excluded.",
      inputSchema: z ? {
        projectSlug: field("string", "Exact project slug."),
        sessionId: field("string", "Opaque session reference returned by search_clay_history."),
        offset: field("number", "Legacy numeric turn offset.", true),
        limit: field("number", "Maximum turns, from 1 to 50.", true),
      } : {},
      handler: guarded(workspace, "readProjectSession", function (args) {
        var cursor = args.offset > 0 ? Buffer.from(String(Math.floor(args.offset)), "utf8").toString("base64url") : null;
        return { projectSlug: args.projectSlug, sessionRef: args.sessionId, cursor: cursor, limit: args.limit };
      }),
    },
    {
      name: "list_recent_decisions",
      description: "List recent canonical user or assistant turns containing explicit decision language in the owned workspace.",
      inputSchema: z ? {
        projectSlug: field("string", "Optional project slug.", true),
        since: field("string", "Optional earliest ISO date.", true),
        until: field("string", "Optional latest ISO date.", true),
        maxResults: field("number", "Maximum results, from 1 to 50.", true),
      } : {},
      handler: guarded(workspace, "listRecentDecisions", function (args) {
        return { projectSlug: args.projectSlug, since: args.since, until: args.until, limit: args.maxResults };
      }),
    },
  ];
}

module.exports = { getToolDefs: getToolDefs };
