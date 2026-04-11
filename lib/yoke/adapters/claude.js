// YOKE Claude Adapter
// --------------------
// Implements the YOKE interface using @anthropic-ai/claude-agent-sdk.
// This is the ONLY file (besides claude-worker.js) that imports the SDK.

var path = require("path");

// --- SDK loading ---
// Async loader (ESM dynamic import, same pattern as current project.js getSDK)
var _sdkPromise = null;
function loadSDK() {
  if (!_sdkPromise) _sdkPromise = import("@anthropic-ai/claude-agent-sdk");
  return _sdkPromise;
}

// Sync loader (CJS require, for createToolServer which must be synchronous)
var _sdkSync = null;
function loadSDKSync() {
  if (!_sdkSync) {
    try { _sdkSync = require("@anthropic-ai/claude-agent-sdk"); } catch (e) {
      console.error("[yoke/claude] Failed to load SDK synchronously:", e.message);
      return null;
    }
  }
  return _sdkSync;
}

// --- Internal message queue (async iterable for SDK prompt) ---
function createMessageQueue() {
  var queue = [];
  var waiting = null;
  var ended = false;
  return {
    push: function(msg) {
      if (ended) return;
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    end: function() {
      ended = true;
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: undefined, done: true });
      }
    },
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise(function(resolve) { waiting = resolve; });
        },
      };
    },
  };
}

// --- QueryHandle ---
// Wraps a raw SDK query object with the YOKE QueryHandle interface.
// In Phase 3, events are yielded as-is (raw SDK events, no normalization).
function createQueryHandle(rawQuery, messageQueue, abortController) {
  var handle = {
    // Phase 3 backward compat: raw SDK query access for processQueryStream
    _rawQuery: rawQuery,
    _messageQueue: messageQueue,
    _abortController: abortController,

    // Async iterable: yields raw SDK events
    [Symbol.asyncIterator]: function() {
      return rawQuery[Symbol.asyncIterator]();
    },

    pushMessage: function(text, images) {
      var content = [];
      if (images && images.length > 0) {
        for (var i = 0; i < images.length; i++) {
          content.push({
            type: "image",
            source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
          });
        }
      }
      if (text) content.push({ type: "text", text: text });
      messageQueue.push({ type: "user", message: { role: "user", content: content } });
    },

    // Push raw message object (for internal/backward compat use)
    _pushRaw: function(msg) {
      messageQueue.push(msg);
    },

    setModel: function(model) {
      if (rawQuery && typeof rawQuery.setModel === "function") {
        return rawQuery.setModel(model);
      }
      return Promise.resolve();
    },

    setEffort: function(effort) {
      // Claude SDK has no setEffort on active query.
      // Stored at Clay level for next query.
      return Promise.resolve();
    },

    setToolPolicy: function(policy) {
      // Map YOKE policy to Claude permission mode
      if (rawQuery && typeof rawQuery.setPermissionMode === "function") {
        var mode = policy === "allow-all" ? "bypassPermissions" : "default";
        return rawQuery.setPermissionMode(mode);
      }
      return Promise.resolve();
    },

    // Phase 3 backward compat: direct setPermissionMode with Claude-specific modes
    setPermissionMode: function(mode) {
      if (rawQuery && typeof rawQuery.setPermissionMode === "function") {
        return rawQuery.setPermissionMode(mode);
      }
      return Promise.resolve();
    },

    stopTask: function(taskId) {
      if (rawQuery && typeof rawQuery.stopTask === "function") {
        return rawQuery.stopTask(taskId);
      }
      return Promise.resolve();
    },

    getContextUsage: function() {
      if (rawQuery && typeof rawQuery.getContextUsage === "function") {
        return rawQuery.getContextUsage();
      }
      return Promise.resolve(null);
    },

    supportedModels: function() {
      if (rawQuery && typeof rawQuery.supportedModels === "function") {
        return rawQuery.supportedModels();
      }
      return Promise.resolve([]);
    },

    abort: function() {
      if (abortController) {
        try { abortController.abort(); } catch (e) {}
      }
    },

    close: function() {
      try { messageQueue.end(); } catch (e) {}
      if (rawQuery && typeof rawQuery.close === "function") {
        try { rawQuery.close(); } catch (e) {}
      }
    },

    // End the message queue without closing the raw query
    endInput: function() {
      try { messageQueue.end(); } catch (e) {}
    },
  };

  return handle;
}

// --- Adapter factory ---

function createClaudeAdapter(opts) {
  var _cwd = (opts && opts.cwd) || process.cwd();
  var _cachedModels = [];

  // Path to the worker script (for OS-level user isolation)
  var workerScriptPath = path.join(__dirname, "claude-worker.js");

  var adapter = {
    vendor: "claude",

    // Path to worker script (sdk-bridge uses this to spawn worker processes)
    workerScriptPath: workerScriptPath,

    /**
     * Initialize the adapter. Performs SDK warmup to discover models, skills, etc.
     *
     * @param {object} initOpts
     * @param {string} [initOpts.cwd]
     * @param {boolean} [initOpts.dangerouslySkipPermissions]
     * @returns {Promise<{ models, defaultModel, skills, slashCommands, fastModeState, capabilities }>}
     */
    init: async function(initOpts) {
      var sdk = await loadSDK();
      var ac = new AbortController();
      var mq = createMessageQueue();
      mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
      mq.end();

      var warmupOptions = {
        cwd: (initOpts && initOpts.cwd) || _cwd,
        settingSources: ["user", "project", "local"],
        abortController: ac,
      };

      if (initOpts && initOpts.dangerouslySkipPermissions) {
        warmupOptions.permissionMode = "bypassPermissions";
        warmupOptions.allowDangerouslySkipPermissions = true;
      }

      var result = {
        models: [],
        defaultModel: "",
        skills: [],
        slashCommands: [],
        fastModeState: null,
        capabilities: {
          thinking: true,
          betas: true,
          rewind: true,
          sessionResume: true,
          promptSuggestions: true,
          elicitation: true,
          fileCheckpointing: true,
          contextCompacting: true,
          toolPolicy: ["ask", "allow-all"],
        },
      };

      try {
        var stream = sdk.query({ prompt: mq, options: warmupOptions });

        for await (var msg of stream) {
          if (msg.type === "system" && msg.subtype === "init") {
            result.skills = msg.skills || [];
            result.defaultModel = msg.model || "";
            result.slashCommands = msg.slash_commands || [];
            result.fastModeState = msg.fast_mode_state || null;

            try {
              var models = await stream.supportedModels();
              result.models = models || [];
              _cachedModels = result.models;
            } catch (e) {
              // supportedModels may fail, models list will be empty
            }

            ac.abort();
            break;
          }
        }
      } catch (e) {
        if (e && e.name !== "AbortError" && !(e.message && e.message.indexOf("aborted") !== -1)) {
          throw e;
        }
      }

      return result;
    },

    /**
     * Return cached list of supported models.
     * @returns {Promise<string[]>}
     */
    supportedModels: function() {
      return Promise.resolve(_cachedModels.slice());
    },

    /**
     * Create a tool server from runtime-agnostic definitions.
     * Synchronous because MCP servers are created during project setup.
     *
     * @param {object} def
     * @param {string} def.name
     * @param {string} def.version
     * @param {Array} def.tools - [{ name, description, inputSchema, handler }]
     * @returns {object|null} Opaque MCP server config
     */
    createToolServer: function(def) {
      var sdk = loadSDKSync();
      if (!sdk || !sdk.createSdkMcpServer || !sdk.tool) {
        console.error("[yoke/claude] SDK not available for createToolServer");
        return null;
      }

      var sdkTools = [];
      for (var i = 0; i < def.tools.length; i++) {
        var t = def.tools[i];
        sdkTools.push(sdk.tool(t.name, t.description, t.inputSchema, t.handler));
      }
      return sdk.createSdkMcpServer({
        name: def.name,
        version: def.version,
        tools: sdkTools,
      });
    },

    /**
     * Create a new query. Returns a QueryHandle (async iterable + control methods).
     *
     * The caller must push the first message via handle.pushMessage() or handle._pushRaw()
     * and then iterate the handle for events.
     *
     * @param {object} queryOpts
     * @param {string}   [queryOpts.cwd]
     * @param {string}   [queryOpts.systemPrompt]
     * @param {string}   [queryOpts.model]
     * @param {string}   [queryOpts.effort]
     * @param {object}   [queryOpts.toolServers]  - mcpServers config object
     * @param {Function} [queryOpts.canUseTool]
     * @param {Function} [queryOpts.onElicitation]
     * @param {string}   [queryOpts.resumeSessionId]
     * @param {AbortController} [queryOpts.abortController] - Phase 3: pass full controller
     * @param {object}   [queryOpts.adapterOptions] - { CLAUDE: { ... } }
     * @returns {Promise<QueryHandle>}
     */
    createQuery: async function(queryOpts) {
      var sdk = await loadSDK();
      var mq = createMessageQueue();
      var ac = queryOpts.abortController || new AbortController();

      // Build SDK-specific options
      var sdkOptions = {
        cwd: queryOpts.cwd || _cwd,
        abortController: ac,
      };

      // YOKE standard options -> SDK options
      if (queryOpts.systemPrompt) sdkOptions.systemPrompt = queryOpts.systemPrompt;
      if (queryOpts.model) sdkOptions.model = queryOpts.model;
      if (queryOpts.effort) sdkOptions.effort = queryOpts.effort;
      if (queryOpts.toolServers) sdkOptions.mcpServers = queryOpts.toolServers;
      if (queryOpts.canUseTool) sdkOptions.canUseTool = queryOpts.canUseTool;
      if (queryOpts.onElicitation) sdkOptions.onElicitation = queryOpts.onElicitation;
      if (queryOpts.resumeSessionId) sdkOptions.resume = queryOpts.resumeSessionId;

      // Claude-specific options from adapterOptions.CLAUDE
      var co = (queryOpts.adapterOptions && queryOpts.adapterOptions.CLAUDE) || {};
      if (co.settingSources) sdkOptions.settingSources = co.settingSources;
      if (co.includePartialMessages != null) sdkOptions.includePartialMessages = co.includePartialMessages;
      if (co.enableFileCheckpointing != null) sdkOptions.enableFileCheckpointing = co.enableFileCheckpointing;
      if (co.extraArgs) sdkOptions.extraArgs = co.extraArgs;
      if (co.promptSuggestions != null) sdkOptions.promptSuggestions = co.promptSuggestions;
      if (co.agentProgressSummaries != null) sdkOptions.agentProgressSummaries = co.agentProgressSummaries;
      if (co.thinking) sdkOptions.thinking = co.thinking;
      if (co.betas && co.betas.length > 0) sdkOptions.betas = co.betas;
      if (co.permissionMode) sdkOptions.permissionMode = co.permissionMode;
      if (co.allowDangerouslySkipPermissions) sdkOptions.allowDangerouslySkipPermissions = true;
      if (co.resumeSessionAt) sdkOptions.resumeSessionAt = co.resumeSessionAt;

      var rawQuery = sdk.query({ prompt: mq, options: sdkOptions });
      return createQueryHandle(rawQuery, mq, ac);
    },

    // --- Session management ---
    // These delegate to SDK module-level functions.

    getSessionInfo: function(sessionId, sessionOpts) {
      return loadSDK().then(function(sdk) {
        return sdk.getSessionInfo(sessionId, sessionOpts);
      });
    },

    listSessions: function(sessionOpts) {
      return loadSDK().then(function(sdk) {
        return sdk.listSessions(sessionOpts);
      });
    },

    renameSession: function(sessionId, title, sessionOpts) {
      return loadSDK().then(function(sdk) {
        return sdk.renameSession(sessionId, title, sessionOpts);
      });
    },

    forkSession: function(sessionId, sessionOpts) {
      return loadSDK().then(function(sdk) {
        return sdk.forkSession(sessionId, sessionOpts);
      });
    },

    // --- Internal (Phase 3 transition) ---
    // These are NOT part of the YOKE interface. They exist to support
    // incremental migration and will be removed in later phases.

    /**
     * Get the raw SDK module (async). Used by sdk-message-processor.js during transition.
     * @returns {Promise<object>}
     */
    _loadSDK: loadSDK,
  };

  return adapter;
}

module.exports = {
  createClaudeAdapter: createClaudeAdapter,
  createMessageQueue: createMessageQueue,
};
