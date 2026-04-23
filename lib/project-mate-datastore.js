var z = require("zod");
var datastore = require("./mate-datastore");
var FEATURE_ENABLED = false;

function attachMateDatastore(ctx) {
  var cwd = ctx.cwd;
  var isMate = ctx.isMate;
  var send = ctx.send;
  var sendTo = ctx.sendTo;

  function isFeatureAvailable() {
    return FEATURE_ENABLED && datastore.isMateDatastoreAvailable();
  }

  function ensureProjectDatastore() {
    if (!FEATURE_ENABLED) {
      return { ok: false, code: "MATE_DATASTORE_NOT_ALLOWED", message: "Mate datastore is not enabled." };
    }
    if (!isMate) {
      return { ok: false, code: "MATE_DATASTORE_NOT_ALLOWED", message: "Mate datastore is only available in Mate sessions." };
    }
    try {
      return datastore.ensureMateDatastore({ mateDir: cwd });
    } catch (e) {
      return { ok: false, code: "MATE_DATASTORE_UNAVAILABLE", message: e.message || "Mate datastore is unavailable." };
    }
  }

  function getDatastoreWarning(handle) {
    if (!handle || !handle.warning) return null;
    return handle.warning;
  }

  function normalizeParams(input) {
    if (!input) return [];
    if (Array.isArray(input.params)) return input.params;
    return [];
  }

  function normalizeToolResult(result, requestId) {
    var payload = result || { ok: false, code: "MATE_DATASTORE_UNAVAILABLE", message: "Mate datastore is unavailable." };
    if (typeof requestId !== "undefined") payload.requestId = requestId;
    return payload;
  }

  function callToolInternal(toolName, input) {
    var handle = ensureProjectDatastore();
    if (!handle || handle.ok === false) {
      return normalizeToolResult(handle, input && input.requestId);
    }

    var warning = getDatastoreWarning(handle);
    var params = normalizeParams(input);

    if (toolName === "clay_db_query") {
      var queryResult = datastore.runQuery(handle, input.sql, params, { maxRows: 200, maxBytes: 1024 * 1024, includeSizeInfo: true });
      if (warning && queryResult.ok && !queryResult.warning) queryResult.warning = warning;
      return normalizeToolResult(queryResult, input && input.requestId);
    }

    if (toolName === "clay_db_exec") {
      var execResult = datastore.runExec(handle, input.sql, params, { maxBytes: 1024 * 1024, includeSizeInfo: true });
      if (warning && execResult.ok && !execResult.warning) execResult.warning = warning;
      if (execResult.ok) {
        broadcastDbChange({ tool: toolName, sql: input.sql, changes: execResult.changes || 0 });
      }
      return normalizeToolResult(execResult, input && input.requestId);
    }

    if (toolName === "clay_db_tables") {
      var tablesResult = datastore.listSchemaObjects(handle);
      if (warning && tablesResult.ok && !tablesResult.warning) tablesResult.warning = warning;
      return normalizeToolResult(tablesResult, input && input.requestId);
    }

    if (toolName === "clay_db_describe") {
      var describeResult = datastore.describeTable(handle, input.table);
      if (warning && describeResult.ok && !describeResult.warning) describeResult.warning = warning;
      return normalizeToolResult(describeResult, input && input.requestId);
    }

    return normalizeToolResult({ ok: false, code: "MATE_DATASTORE_NOT_ALLOWED", message: "Unknown datastore tool: " + toolName }, input && input.requestId);
  }

  function broadcastDbChange(details) {
    var payload = {
      type: "mate_db_change",
      details: details || {},
    };
    send(payload);
  }

  function handleMateDatastoreMessage(ws, msg) {
    if (msg.type !== "mate_db_tables" && msg.type !== "mate_db_describe" && msg.type !== "mate_db_query" && msg.type !== "mate_db_exec") {
      return false;
    }

    if (!FEATURE_ENABLED) {
      return false;
    }

    if (!isMate) {
      sendTo(ws, {
        type: "mate_db_error",
        requestId: msg.requestId || null,
        code: "MATE_DATASTORE_NOT_ALLOWED",
        message: "Mate datastore is only available in Mate sessions.",
      });
      return true;
    }

    if (msg.type === "mate_db_tables") {
      sendResult(ws, "mate_db_tables_result", callToolInternal("clay_db_tables", msg));
      return true;
    }

    if (msg.type === "mate_db_describe") {
      sendResult(ws, "mate_db_describe_result", callToolInternal("clay_db_describe", msg));
      return true;
    }

    if (msg.type === "mate_db_query") {
      sendResult(ws, "mate_db_query_result", callToolInternal("clay_db_query", msg));
      return true;
    }

    if (msg.type === "mate_db_exec") {
      sendResult(ws, "mate_db_exec_result", callToolInternal("clay_db_exec", msg));
      return true;
    }

    return true;
  }

  function sendResult(ws, type, result) {
    var payload = result || { ok: false, code: "MATE_DATASTORE_UNAVAILABLE", message: "Mate datastore is unavailable." };
    payload.type = type;
    sendTo(ws, payload);
  }

  function getToolDefinitions() {
    if (!isMate || !isFeatureAvailable()) return [];
    return [
      {
        name: "clay_db_query",
        description: "Execute read-only SQL against the current Mate datastore.",
        inputSchema: {
          sql: z.string().min(1).describe("SQL query"),
          params: z.array(z.any()).optional().describe("Positional parameters"),
        },
        handler: function (input) {
          return callToolInternal("clay_db_query", input || {});
        },
      },
      {
        name: "clay_db_exec",
        description: "Execute schema or write SQL against the current Mate datastore.",
        inputSchema: {
          sql: z.string().min(1).describe("SQL statement"),
          params: z.array(z.any()).optional().describe("Positional parameters"),
        },
        handler: function (input) {
          return callToolInternal("clay_db_exec", input || {});
        },
      },
      {
        name: "clay_db_tables",
        description: "List schema objects in the current Mate datastore.",
        inputSchema: undefined,
        handler: function (input) {
          return callToolInternal("clay_db_tables", input || {});
        },
      },
      {
        name: "clay_db_describe",
        description: "Describe a table or view in the current Mate datastore.",
        inputSchema: {
          table: z.string().min(1).describe("Table name"),
        },
        handler: function (input) {
          return callToolInternal("clay_db_describe", input || {});
        },
      },
    ];
  }

  function createMcpServer() {
    var defs = getToolDefinitions();
    if (!defs.length) return null;
    var registered = {};
    for (var i = 0; i < defs.length; i++) {
      registered[defs[i].name] = {
        description: defs[i].description,
        inputSchema: defs[i].inputSchema,
        handler: defs[i].handler,
      };
    }
    return {
      name: "clay-datastore",
      version: "1.0.0",
      instance: {
        _registeredTools: registered,
      },
    };
  }

  function getSessionToolDefinitions() {
    if (!isMate || !isFeatureAvailable()) return null;
    return getToolDefinitions();
  }

  function callMateTool(session, toolName, input) {
    return callToolInternal(toolName, input || {});
  }

  function closeAllDatastores() {
    datastore.closeAllMateDatastores();
  }

  return {
    isFeatureAvailable: isFeatureAvailable,
    handleMateDatastoreMessage: handleMateDatastoreMessage,
    getToolDefinitions: getToolDefinitions,
    createMcpServer: createMcpServer,
    getSessionToolDefinitions: getSessionToolDefinitions,
    callMateTool: callMateTool,
    ensureProjectDatastore: ensureProjectDatastore,
    closeAllDatastores: closeAllDatastores,
  };
}

module.exports = { attachMateDatastore: attachMateDatastore };
