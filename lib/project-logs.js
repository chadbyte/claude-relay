// Project Logs message handling and session-bound MCP wiring.
//
// Every capability here is derived server-side. The WebSocket path binds from
// ws._clayUser plus this project's own slug, and the MCP path binds from the
// exact live session object. Neither accepts identity or project scope from
// the message, so a client cannot widen its own reach by asking.

var logsMcp = require("./project-logs-mcp-server");
var logsStore = require("./project-logs-store");

var LIST_LIMIT = 50;

var SYSTEM_PROMPT_LABEL = "--- Project Logs (durable project record; manage via clay-logs tools) ---";

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  var parsed;
  try {
    parsed = JSON.parse(value);
  } catch (e) {
    throw new Error("Expected a JSON array.");
  }
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array.");
  return parsed;
}

// The tool surface accepts JSON-encoded arrays because MCP shapes are flat
// scalars. The service and store only ever see real arrays.
function coerceToolArgs(args) {
  var out = Object.assign({}, args || {});
  if (out.tags !== undefined) out.tags = parseJsonArray(out.tags);
  if (out.links !== undefined) out.links = parseJsonArray(out.links);
  return out;
}

function attachProjectLogs(ctx) {
  var service = ctx.service;
  var sm = ctx.sm;
  var slug = ctx.projectSlug;
  var isMate = ctx.isMate === true;
  var mateId = ctx.mateId || null;
  var sendTo = ctx.sendTo;
  var getProjectOwnerId = ctx.getProjectOwnerId || function () { return null; };

  // --- Bindings --------------------------------------------------------

  function sessionBinding(session) {
    if (!service) return null;
    if (isMate) {
      if (!mateId) return null;
      if (session && (!sm || !sm.sessions || sm.sessions.get(session.localId) !== session)) return null;
      return service.bindMate({
        projectSlug: slug,
        projectOwnerId: getProjectOwnerId(),
        isMate: true,
        mateId: mateId,
        session: session || null,
      });
    }
    if (!session) return null;
    return service.bindProjectSession({ projectSlug: slug, session: session });
  }

  function userBinding(ws) {
    if (!service || isMate) return null;
    return service.bindUser({ projectSlug: slug, user: (ws && ws._clayUser) || null });
  }

  // --- WebSocket surface -----------------------------------------------

  function fail(ws, requestId, message) {
    sendTo(ws, { type: "project_logs_error", requestId: requestId || null, message: message });
  }

  // Search results carry only ranking metadata, so each hit is resolved to its
  // full entry. The index and the detail view then render identical shapes.
  function listEntries(bound, query) {
    if (query) {
      var hits = bound.searchLogs({ query: query, limit: LIST_LIMIT });
      var resolved = [];
      for (var i = 0; i < hits.results.length; i++) {
        var entry = null;
        try {
          entry = bound.readLog({ ref: hits.results[i].ref });
        } catch (e) {
          entry = null;
        }
        if (entry) resolved.push(entry);
      }
      return resolved;
    }
    return bound.listLogs({ limit: LIST_LIMIT }).entries;
  }

  function handleLogsMessage(ws, msg) {
    if (!msg || typeof msg.type !== "string" || msg.type.indexOf("project_log") !== 0) return false;
    var handled = ["project_logs_list", "project_log_read", "project_log_create", "project_log_update"];
    if (handled.indexOf(msg.type) === -1) return false;

    var requestId = typeof msg.requestId === "string" ? msg.requestId : null;
    if (isMate) {
      fail(ws, requestId, "Project Logs are available in projects, not in Mate conversations.");
      return true;
    }

    var bound = userBinding(ws);
    if (!bound) {
      fail(ws, requestId, "Project Logs are not available for this project.");
      return true;
    }

    try {
      if (msg.type === "project_logs_list") {
        var query = typeof msg.query === "string" ? msg.query.trim() : "";
        sendTo(ws, { type: "project_logs_state", requestId: requestId, entries: listEntries(bound, query) });
        return true;
      }

      if (msg.type === "project_log_read") {
        sendTo(ws, { type: "project_log_entry", requestId: requestId, entry: bound.readLog({ ref: msg.ref }) });
        return true;
      }

      if (msg.type === "project_log_create") {
        var kind = logsStore.LOG_KINDS.indexOf(msg.kind) !== -1 ? msg.kind : "session-note";
        var created = bound.createLog({ kind: kind, title: msg.title, body: msg.body });
        sendTo(ws, { type: "project_log_saved", requestId: requestId, entry: created });
        return true;
      }

      if (msg.type === "project_log_update") {
        var changes = { ref: msg.ref };
        if (typeof msg.title === "string") changes.title = msg.title;
        if (typeof msg.body === "string") changes.body = msg.body;
        if (logsStore.LOG_KINDS.indexOf(msg.kind) !== -1) changes.kind = msg.kind;
        sendTo(ws, { type: "project_log_saved", requestId: requestId, entry: bound.updateLog(changes) });
        return true;
      }
    } catch (e) {
      fail(ws, requestId, (e && e.message) || "Project Logs could not complete the request.");
      return true;
    }

    return false;
  }

  // --- MCP surface ------------------------------------------------------

  function toolHandlers(bound) {
    if (!bound) return null;
    return {
      listLogs: function (args) { return bound.listLogs(args || {}); },
      searchLogs: function (args) { return bound.searchLogs(args || {}); },
      readLog: function (args) { return bound.readLog(args || {}); },
      logHistory: function (args) { return bound.logHistory(args || {}); },
      createLog: function (args) { return bound.createLog(coerceToolArgs(args)); },
      updateLog: function (args) { return bound.updateLog(coerceToolArgs(args)); },
      linkLog: function (args) { return bound.linkLog(coerceToolArgs(args)); },
    };
  }

  // A Mate project advertises tools only when the registry confirms
  // authoritative builtin Clay, and then only the read-only global set.
  function includeGlobal() {
    if (!isMate) return false;
    var projectBound = sessionBinding(null);
    return !!(projectBound && projectBound.isClay === true);
  }

  function getToolDefs(session) {
    if (!service) return [];
    if (isMate && !includeGlobal()) return [];
    var bound = session ? sessionBinding(session) : null;
    if (session && !bound) return [];
    return logsMcp.getToolDefs(toolHandlers(bound), isMate);
  }

  function createMcpServer(adapter, session) {
    if (!service) return null;
    if (isMate && !includeGlobal()) return null;
    if (!isMate && session && !sessionBinding(session)) {
      // A session that cannot bind still gets the fail-closed descriptor
      // rather than a silently missing server.
      return logsMcp.createMcpServer(adapter, null, false);
    }
    var bound = session ? sessionBinding(session) : null;
    return logsMcp.createMcpServer(adapter, toolHandlers(bound), isMate);
  }

  function getDynamicToolDefs(session) {
    return getToolDefs(session).map(function (tool) {
      tool.permissionName = "mcp__clay-logs__" + tool.name;
      return tool;
    });
  }

  function getBridgeTools(session, normalizeSchema) {
    if (!session) return [];
    var defs = getToolDefs(session);
    var tools = [];
    for (var i = 0; i < defs.length; i++) {
      tools.push({
        server: "clay-logs",
        name: defs[i].name,
        description: defs[i].description || defs[i].name,
        inputSchema: normalizeSchema(defs[i].inputSchema),
      });
    }
    return tools;
  }

  function callBridgeTool(session, toolName, args) {
    if (!session) return Promise.reject(new Error("Project Logs require a valid session."));
    var defs = getToolDefs(session);
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].name === toolName) return Promise.resolve(defs[i].handler(args || {}));
    }
    return Promise.reject(new Error("Project Logs tool not found: " + toolName));
  }

  function getSystemPrompt(session) {
    if (isMate || !service) return "";
    if (session && !sessionBinding(session)) return "";
    return SYSTEM_PROMPT_LABEL + "\n" + logsMcp.LOGS_CONTRACT;
  }

  return {
    handleLogsMessage: handleLogsMessage,
    createMcpServer: createMcpServer,
    getToolDefs: getToolDefs,
    getDynamicToolDefs: getDynamicToolDefs,
    getBridgeTools: getBridgeTools,
    callBridgeTool: callBridgeTool,
    getSystemPrompt: getSystemPrompt,
  };
}

module.exports = {
  SYSTEM_PROMPT_LABEL: SYSTEM_PROMPT_LABEL,
  attachProjectLogs: attachProjectLogs,
  coerceToolArgs: coerceToolArgs,
};
