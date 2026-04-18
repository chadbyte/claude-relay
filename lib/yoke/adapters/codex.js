// YOKE Codex Adapter
// -------------------
// Implements the YOKE interface using @openai/codex-sdk.
// This is the ONLY file that imports the Codex SDK.

// --- SDK loading ---
var _sdkPromise = null;
function loadSDK() {
  if (!_sdkPromise) _sdkPromise = import("@openai/codex-sdk");
  return _sdkPromise;
}

// --- Event flattening ---
// Converts Codex ThreadEvent into flat objects with a yokeType field.
//
// Codex events:
//   thread.started  -> { thread_id }
//   turn.started    -> {}
//   turn.completed  -> { usage }
//   turn.failed     -> { error }
//   item.started    -> { item: ThreadItem }
//   item.updated    -> { item: ThreadItem }
//   item.completed  -> { item: ThreadItem }
//   error           -> { message }
//
// ThreadItem types:
//   agent_message      -> text response
//   reasoning          -> thinking
//   command_execution  -> bash/shell
//   file_change        -> file edits
//   mcp_tool_call      -> MCP tool
//   web_search         -> web search
//   todo_list          -> task list
//   error              -> error

function flattenEvent(evt, state) {
  var events = [];

  // DEBUG: log ALL raw events from Codex CLI
  var evtSummary = evt.type;
  if (evt.item) evtSummary += " item.type=" + evt.item.type + " status=" + (evt.item.status || "?");
  if (evt.item && evt.item.tool) evtSummary += " tool=" + evt.item.tool;
  if (evt.item && evt.item.error) evtSummary += " error=" + JSON.stringify(evt.item.error);
  console.log("[yoke/codex] RAW event:", evtSummary);

  if (evt.type === "thread.started") {
    state.threadId = evt.thread_id;
    return events;
  }

  if (evt.type === "turn.started") {
    state.turnStarted = true;
    events.push({ yokeType: "turn_start" });
    return events;
  }

  if (evt.type === "turn.completed") {
    state.lastUsage = evt.usage || null;
    events.push({
      yokeType: "result",
      cost: null,
      duration: null,
      usage: evt.usage ? {
        promptTokenCount: (evt.usage.input_tokens || 0) + (evt.usage.cached_input_tokens || 0),
        candidatesTokenCount: evt.usage.output_tokens || 0,
        totalTokenCount: (evt.usage.input_tokens || 0) + (evt.usage.cached_input_tokens || 0) + (evt.usage.output_tokens || 0),
      } : null,
      sessionId: state.threadId || null,
    });
    return events;
  }

  if (evt.type === "turn.failed") {
    events.push({
      yokeType: "error",
      text: evt.error ? evt.error.message : "Turn failed",
    });
    return events;
  }

  if (evt.type === "error") {
    events.push({
      yokeType: "error",
      text: evt.message || "Unknown error",
    });
    return events;
  }

  // Item events
  if (evt.type === "item.started" || evt.type === "item.updated" || evt.type === "item.completed") {
    var item = evt.item;
    if (!item) return events;

    // Agent message (text response)
    // NOTE: codex exec --json only emits item.completed (no item.started/updated),
    // so we must handle all three event types for text output.
    if (item.type === "agent_message") {
      if (!state.textBlocks[item.id]) {
        state.textBlocks[item.id] = true;
        state.blockCounter++;
        events.push({ yokeType: "text_start", blockId: "blk_" + state.blockCounter });
      }
      if (item.text) {
        var prevLen = state.textLengths[item.id] || 0;
        if (item.text.length > prevLen) {
          events.push({
            yokeType: "text_delta",
            blockId: "blk_" + state.blockCounter,
            text: item.text.substring(prevLen),
          });
          state.textLengths[item.id] = item.text.length;
        }
      }
      return events;
    }

    // Reasoning (thinking)
    // NOTE: codex exec --json may only emit item.completed, so ensure
    // thinking_start is sent before any delta or stop.
    if (item.type === "reasoning") {
      if (!state.thinkingBlocks[item.id]) {
        state.blockCounter++;
        state.thinkingBlocks[item.id] = "blk_" + state.blockCounter;
        events.push({ yokeType: "thinking_start", blockId: "blk_" + state.blockCounter });
      }
      if (item.text) {
        var blockId = state.thinkingBlocks[item.id];
        var prevThinkLen = state.thinkingLengths[item.id] || 0;
        if (item.text.length > prevThinkLen) {
          events.push({
            yokeType: "thinking_delta",
            blockId: blockId,
            text: item.text.substring(prevThinkLen),
          });
          state.thinkingLengths[item.id] = item.text.length;
        }
      }
      if (evt.type === "item.completed") {
        events.push({ yokeType: "thinking_stop", blockId: state.thinkingBlocks[item.id] });
      }
      return events;
    }

    // Command execution (bash/shell)
    // NOTE: codex exec --json may only emit item.completed, so ensure
    // tool_start + tool_executing are sent before tool_result.
    if (item.type === "command_execution") {
      if (!state.toolBlocks[item.id]) {
        state.blockCounter++;
        state.toolBlocks[item.id] = "blk_" + state.blockCounter;
        var toolBlockId = state.toolBlocks[item.id];
        events.push({
          yokeType: "tool_start",
          blockId: toolBlockId,
          toolId: item.id,
          toolName: "Bash",
        });
        events.push({
          yokeType: "tool_executing",
          blockId: toolBlockId,
          toolId: item.id,
          toolName: "Bash",
          input: { command: item.command },
        });
      }
      if (evt.type === "item.completed") {
        events.push({
          yokeType: "tool_result",
          toolId: item.id,
          blockId: state.toolBlocks[item.id],
          content: item.aggregated_output || "",
          isError: item.status === "failed",
        });
      }
      return events;
    }

    // File change
    if (item.type === "file_change") {
      if (!state.toolBlocks[item.id]) {
        state.blockCounter++;
        state.toolBlocks[item.id] = "blk_" + state.blockCounter;
        var fcBlockId = state.toolBlocks[item.id];
        events.push({
          yokeType: "tool_start",
          blockId: fcBlockId,
          toolId: item.id,
          toolName: "Edit",
        });
        var changeDesc = (item.changes || []).map(function(c) { return c.kind + " " + c.path; }).join(", ");
        events.push({
          yokeType: "tool_executing",
          blockId: fcBlockId,
          toolId: item.id,
          toolName: "Edit",
          input: { changes: changeDesc },
        });
      }
      if (evt.type === "item.completed") {
        events.push({
          yokeType: "tool_result",
          toolId: item.id,
          blockId: state.toolBlocks[item.id],
          content: item.status === "completed" ? "Changes applied" : "Changes failed",
          isError: item.status === "failed",
        });
      }
      return events;
    }

    // MCP tool call
    if (item.type === "mcp_tool_call") {
      console.log("[yoke/codex] MCP event:", evt.type, "tool=" + (item.tool || "?"), "status=" + (item.status || "?"), "error=" + (item.error ? JSON.stringify(item.error) : "none"));
      if (!state.toolBlocks[item.id]) {
        state.blockCounter++;
        state.toolBlocks[item.id] = "blk_" + state.blockCounter;
        var mcpBlockId = state.toolBlocks[item.id];
        events.push({
          yokeType: "tool_start",
          blockId: mcpBlockId,
          toolId: item.id,
          toolName: item.tool || "mcp_tool",
        });
        events.push({
          yokeType: "tool_executing",
          blockId: mcpBlockId,
          toolId: item.id,
          toolName: item.tool || "mcp_tool",
          input: item.arguments || {},
        });
      }
      if (evt.type === "item.completed") {
        var resultText = "";
        if (item.result && item.result.content) {
          resultText = item.result.content.map(function(c) { return c.text || ""; }).join("\n");
        }
        if (item.error) resultText = item.error.message;
        events.push({
          yokeType: "tool_result",
          toolId: item.id,
          blockId: state.toolBlocks[item.id],
          content: resultText,
          isError: !!item.error,
        });
      }
      return events;
    }

    // Web search
    if (item.type === "web_search") {
      if (!state.toolBlocks[item.id]) {
        state.blockCounter++;
        state.toolBlocks[item.id] = "blk_" + state.blockCounter;
        events.push({
          yokeType: "tool_start",
          blockId: state.toolBlocks[item.id],
          toolId: item.id,
          toolName: "WebSearch",
        });
      }
      return events;
    }

    // Error item
    if (item.type === "error") {
      events.push({
        yokeType: "error",
        text: item.message || "Unknown error",
      });
      return events;
    }
  }

  // Unknown event type - pass through
  console.log("[yoke/codex] UNHANDLED event:", evt.type, JSON.stringify(evt).substring(0, 200));
  events.push({
    yokeType: "runtime_specific",
    vendor: "codex",
    eventType: evt.type,
    raw: evt,
  });

  return events;
}

// --- QueryHandle ---

function createCodexQueryHandle(thread, abortController, systemPrompt) {
  // Check if the query was cancelled (either via handle.abort() or direct signal abort)
  function isCancelled() {
    return state.aborted || (abortController && abortController.signal && abortController.signal.aborted);
  }

  var state = {
    blockCounter: 0,
    threadId: null,
    turnStarted: false,
    lastUsage: null,
    done: false,
    aborted: false,
    loopStarted: false,
    // Track incremental text deltas
    textBlocks: {},     // itemId -> true (text_start sent)
    textLengths: {},    // itemId -> last sent length
    thinkingBlocks: {}, // itemId -> blockId
    thinkingLengths: {}, // itemId -> last sent length
    toolBlocks: {},     // itemId -> blockId (for tool_start dedup)
  };

  // Internal event buffer for async iterator
  var eventBuffer = [];
  var eventWaiting = null;
  var iteratorDone = false;

  function pushEvent(evt) {
    if (iteratorDone) return;
    if (eventWaiting) {
      var resolve = eventWaiting;
      eventWaiting = null;
      resolve({ value: evt, done: false });
    } else {
      eventBuffer.push(evt);
    }
  }

  function endIterator() {
    iteratorDone = true;
    if (eventWaiting) {
      var resolve = eventWaiting;
      eventWaiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  // Message queue for multi-turn
  var messageQueue = [];
  var messageWaiting = null;
  var messageQueueEnded = false;

  function pushMessageToQueue(msg) {
    if (messageQueueEnded) return;
    if (messageWaiting) {
      var resolve = messageWaiting;
      messageWaiting = null;
      resolve(msg);
    } else {
      messageQueue.push(msg);
    }
  }

  function waitForMessage() {
    if (messageQueue.length > 0) return Promise.resolve(messageQueue.shift());
    if (messageQueueEnded) return Promise.resolve(null);
    return new Promise(function(resolve) { messageWaiting = resolve; });
  }

  // --- Main query loop ---
  async function runQueryLoop(initialMessage) {
    // Prepend system prompt (project instructions from YOKE layer) to first message
    var currentMessage = systemPrompt
      ? systemPrompt + "\n\n" + initialMessage
      : initialMessage;

    try {
      while (!isCancelled()) {
        // Reset per-turn state
        state.turnStarted = false;
        state.textBlocks = {};
        state.textLengths = {};
        state.thinkingBlocks = {};
        state.thinkingLengths = {};
        state.toolBlocks = {};

        var ac = abortController || new AbortController();
        var streamResult = await thread.runStreamed(currentMessage, {
          signal: ac.signal,
        });

        for await (var evt of streamResult.events) {
          if (isCancelled()) break;
          var flatEvents = flattenEvent(evt, state);
          for (var i = 0; i < flatEvents.length; i++) {
            pushEvent(flatEvents[i]);
          }
        }

        if (isCancelled()) break;

        // Wait for next message (multi-turn)
        var nextMsg = await waitForMessage();
        if (nextMsg === null) break;
        currentMessage = nextMsg;
      }
    } catch (e) {
      // Suppress AbortError when the user stopped the query.
      // session.abortController.abort() signals the controller directly
      // without going through handle.abort(), so also check the signal.
      if (!isCancelled() && e.name !== "AbortError") {
        console.error("[yoke/codex] runQueryLoop error:", e.message || e);
        console.error("[yoke/codex] stack:", e.stack || "(no stack)");
        pushEvent({
          yokeType: "error",
          text: e.message || String(e),
        });
      }
    }

    state.done = true;
    endIterator();
  }

  var handle = {
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (eventBuffer.length > 0) {
            return Promise.resolve({ value: eventBuffer.shift(), done: false });
          }
          if (iteratorDone) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise(function(resolve) { eventWaiting = resolve; });
        },
      };
    },

    pushMessage: function(text, images) {
      var input;
      if (images && images.length > 0) {
        input = [];
        for (var i = 0; i < images.length; i++) {
          // Codex supports local_image with path, not base64
          // For now, text-only
        }
        input.push({ type: "text", text: text || "" });
      } else {
        input = text || "";
      }

      if (!state.loopStarted) {
        state.loopStarted = true;
        runQueryLoop(input);
      } else {
        pushMessageToQueue(input);
      }
    },

    setModel: function(model) {
      // Model is set at thread creation. Cannot change mid-thread.
      return Promise.resolve();
    },

    setEffort: function(effort) {
      // Stored for next thread
      return Promise.resolve();
    },

    setToolPolicy: function(policy) {
      // Codex uses approvalPolicy at thread creation
      return Promise.resolve();
    },

    stopTask: function(taskId) {
      // Codex doesn't expose sub-task stopping
      return Promise.resolve();
    },

    getContextUsage: function() {
      return Promise.resolve(state.lastUsage);
    },

    abort: function() {
      state.aborted = true;
      if (abortController) {
        try { abortController.abort(); } catch (e) {}
      }
      endIterator();
    },

    close: function() {
      messageQueueEnded = true;
      if (messageWaiting) {
        var resolve = messageWaiting;
        messageWaiting = null;
        resolve(null);
      }
      endIterator();
    },

    endInput: function() {
      messageQueueEnded = true;
      if (messageWaiting) {
        var resolve = messageWaiting;
        messageWaiting = null;
        resolve(null);
      }
    },
  };

  return handle;
}

// --- Adapter factory ---

function createCodexAdapter(opts) {
  var _cwd = (opts && opts.cwd) || process.cwd();
  var _cachedModels = [];
  var _codex = null;
  var _initPromise = null;

  var adapter = {
    vendor: "codex",

    init: function(initOpts) {
      // Already initialized - return cached result
      if (_codex && _cachedModels.length > 0) {
        return Promise.resolve({
          models: _cachedModels,
          defaultModel: "gpt-5.4",
          skills: [],
          slashCommands: [],
          fastModeState: null,
          capabilities: {
            thinking: true,
            betas: false,
            rewind: false,
            sessionResume: true,
            promptSuggestions: false,
            elicitation: false,
            fileCheckpointing: false,
            contextCompacting: false,
            toolPolicy: ["ask", "allow-all"],
          },
        });
      }

      // Deduplicate concurrent init calls — return existing promise if in-flight
      if (_initPromise) return _initPromise;

      _initPromise = (async function() {
        var codexModule = await loadSDK();
        var Codex = codexModule.Codex;

        var codexOpts = {};
        if (initOpts && initOpts.adapterOptions && initOpts.adapterOptions.CODEX) {
          var co = initOpts.adapterOptions.CODEX;
          if (co.apiKey) codexOpts.apiKey = co.apiKey;
          if (co.baseUrl) codexOpts.baseUrl = co.baseUrl;
          if (co.config) codexOpts.config = co.config;
        }

        // Track 1: Read local MCP server definitions from ~/.clay/mcp.json
        // and inject into Codex config so Codex manages them natively.
        var mcpServerConfig = {};
        try {
          var mcpLocal = require("../../mcp-local");
          var localMcpServers = mcpLocal.readMergedServers();
          var mcpNames = Object.keys(localMcpServers);
          for (var mi = 0; mi < mcpNames.length; mi++) {
            var ms = localMcpServers[mcpNames[mi]];
            if (ms.command) {
              mcpServerConfig[mcpNames[mi]] = { command: ms.command, args: ms.args || [] };
              if (ms.env && Object.keys(ms.env).length > 0) {
                mcpServerConfig[mcpNames[mi]].env = ms.env;
              }
            }
          }
        } catch (e) {
          console.error("[codex] Failed to read local MCP config:", e.message);
        }

        // Track 2: Add clay-tools bridge server for in-app + remote MCP tools.
        // The bridge is a stdio MCP server that proxies tool calls back to Clay.
        var bridgePath = require("path").join(__dirname, "..", "mcp-bridge-server.js");
        var clayPort = (initOpts && initOpts.clayPort) || process.env.CLAY_PORT || 2633;
        var clayTls = (initOpts && initOpts.clayTls) || false;
        var clayAuthToken = (initOpts && initOpts.clayAuthToken) || "";
        var claySlug = (initOpts && initOpts.slug) || "";
        try {
          if (require("fs").existsSync(bridgePath)) {
            var bridgeArgs = [bridgePath, "--port", String(clayPort), "--slug", claySlug];
            if (clayTls) bridgeArgs.push("--tls");
            var bridgeEnv = {};
            if (clayAuthToken) bridgeEnv.CLAY_AUTH_TOKEN = clayAuthToken;
            mcpServerConfig["clay-tools"] = {
              command: process.execPath,
              args: bridgeArgs,
              env: Object.keys(bridgeEnv).length > 0 ? bridgeEnv : undefined,
            };
          }
        } catch (e) {
          console.error("[codex] Failed to configure clay-tools bridge:", e.message);
        }

        if (Object.keys(mcpServerConfig).length > 0) {
          codexOpts.config = Object.assign({}, codexOpts.config || {}, {
            mcp_servers: mcpServerConfig,
          });
          console.log("[codex] MCP servers configured:", Object.keys(mcpServerConfig).join(", "));
          // Debug: show serialized config that will be passed to Codex CLI
          try {
            var names = Object.keys(mcpServerConfig);
            for (var di = 0; di < names.length; di++) {
              var sc = mcpServerConfig[names[di]];
              console.log("[codex] MCP server '" + names[di] + "': command=" + sc.command + " args=" + JSON.stringify(sc.args));
            }
          } catch (e) {}
        }

        _codex = new Codex(codexOpts);
        console.log("[codex] Initialized, models: gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2");

        _cachedModels = [
          "gpt-5.4",
          "gpt-5.4-mini",
          "gpt-5.3-codex",
          "gpt-5.3-codex-spark",
          "gpt-5.2",
        ];

        _initPromise = null; // clear so future calls hit the fast path above

        return {
          models: _cachedModels,
          defaultModel: "gpt-5.4",
          skills: [],
          slashCommands: [],
          fastModeState: null,
          capabilities: {
            thinking: true,
            betas: false,
            rewind: false,
            sessionResume: true,
            promptSuggestions: false,
            elicitation: false,
            fileCheckpointing: false,
            contextCompacting: false,
            toolPolicy: ["ask", "allow-all"],
          },
        };
      })();

      return _initPromise;
    },

    supportedModels: function() {
      return Promise.resolve(_cachedModels.slice());
    },

    createToolServer: function(def) {
      // Codex handles tools internally (file ops, bash, etc.)
      // MCP tools are configured via Codex config, not SDK.
      // Return null -- Codex doesn't need external tool servers.
      console.log("[yoke/codex] createToolServer skipped: Codex handles tools internally");
      return null;
    },

    createQuery: async function(queryOpts) {
      if (!_codex) {
        throw new Error("[yoke/codex] Adapter not initialized. Call init() first.");
      }

      var model = queryOpts.model || "gpt-5.4";
      var ac = queryOpts.abortController || new AbortController();

      // Build thread options
      var threadOpts = {
        model: model,
        workingDirectory: queryOpts.cwd || _cwd,
        skipGitRepoCheck: true,
      };

      // Map YOKE options to Codex ThreadOptions
      var codexOpts = (queryOpts.adapterOptions && queryOpts.adapterOptions.CODEX) || {};

      // Reasoning effort
      if (queryOpts.effort || codexOpts.modelReasoningEffort) {
        threadOpts.modelReasoningEffort = codexOpts.modelReasoningEffort || queryOpts.effort || "medium";
      }

      // Tool policy -> approval mode
      if (queryOpts.toolPolicy === "allow-all") {
        threadOpts.approvalPolicy = "never";
      } else {
        threadOpts.approvalPolicy = codexOpts.approvalPolicy || "on-failure";
      }

      // Sandbox mode
      if (codexOpts.sandboxMode) {
        threadOpts.sandboxMode = codexOpts.sandboxMode;
      } else {
        threadOpts.sandboxMode = "workspace-write";
      }

      // Web search
      if (codexOpts.webSearchMode && codexOpts.webSearchMode !== "disabled") {
        threadOpts.webSearchMode = codexOpts.webSearchMode;
      }

      // Resume or start
      var thread;
      if (queryOpts.resumeSessionId) {
        thread = _codex.resumeThread(queryOpts.resumeSessionId, threadOpts);
      } else {
        thread = _codex.startThread(threadOpts);
      }

      console.log("[yoke/codex] createQuery: model=" + model + " approval=" + threadOpts.approvalPolicy + " sandbox=" + threadOpts.sandboxMode);

      var handle = createCodexQueryHandle(thread, ac, queryOpts.systemPrompt || "");
      return handle;
    },

    // Codex has session persistence via thread IDs
    getSessionInfo: function(sessionId) {
      // Codex stores sessions in ~/.codex/sessions
      // No programmatic API to query session info
      return Promise.resolve(null);
    },
    listSessions: function() { return Promise.resolve([]); },
    renameSession: function() { return Promise.resolve(); },
    forkSession: function() { return Promise.resolve(null); },
  };

  return adapter;
}

module.exports = {
  createCodexAdapter: createCodexAdapter,
};
