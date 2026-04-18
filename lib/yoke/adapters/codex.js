// YOKE Codex Adapter
// -------------------
// Implements the YOKE interface using codex app-server protocol.
// Bidirectional JSON-RPC over stdin/stdout enables interactive approval flows.

var { CodexAppServer } = require("../codex-app-server");

// --- Event flattening ---
// Converts app-server JSON-RPC notifications into flat objects with a yokeType field.
//
// App-server events use slash notation (item/started) and camelCase item types.
// We normalize to the same YOKE event format used by the rest of the system.
//
// Server -> Client notifications:
//   thread/started     -> { params: { thread } }
//   turn/started       -> { params: {} }
//   turn/completed     -> { params: { usage } }
//   turn/failed        -> { params: { error } }
//   item/started       -> { params: { item } }
//   item/updated       -> { params: { item } }
//   item/completed     -> { params: { item } }
//   item/agentMessage/delta -> { params: { itemId, delta } }
//
// Item types (camelCase in app-server):
//   agentMessage       -> text response
//   reasoning          -> thinking
//   commandExecution   -> bash/shell
//   fileChange         -> file edits
//   mcpToolCall        -> MCP tool
//   webSearch          -> web search
//   error              -> error

function flattenEvent(notification, state) {
  var events = [];
  var method = notification.method;
  var params = notification.params || {};

  // DEBUG: log ALL raw events from Codex app-server
  var evtSummary = method;
  if (params.item) evtSummary += " item.type=" + params.item.type + " status=" + (params.item.status || "?");
  if (params.item && params.item.tool) evtSummary += " tool=" + params.item.tool;
  if (params.item && params.item.error) evtSummary += " error=" + JSON.stringify(params.item.error);
  console.log("[yoke/codex] RAW event:", evtSummary);

  if (method === "thread/started") {
    state.threadId = params.thread ? params.thread.id : (params.threadId || null);
    return events;
  }

  if (method === "turn/started") {
    state.turnStarted = true;
    events.push({ yokeType: "turn_start" });
    return events;
  }

  if (method === "turn/completed") {
    var usage = params.usage || null;
    state.lastUsage = usage;
    events.push({
      yokeType: "result",
      cost: null,
      duration: null,
      usage: usage ? {
        promptTokenCount: (usage.input_tokens || 0) + (usage.cached_input_tokens || 0),
        candidatesTokenCount: usage.output_tokens || 0,
        totalTokenCount: (usage.input_tokens || 0) + (usage.cached_input_tokens || 0) + (usage.output_tokens || 0),
      } : null,
      sessionId: state.threadId || null,
    });
    return events;
  }

  if (method === "turn/failed") {
    events.push({
      yokeType: "error",
      text: params.error ? params.error.message : "Turn failed",
    });
    return events;
  }

  // Streaming text delta (app-server specific, not present in exec mode)
  if (method === "item/agentMessage/delta") {
    var deltaItemId = params.itemId || params.id;
    if (deltaItemId && !state.textBlocks[deltaItemId]) {
      state.textBlocks[deltaItemId] = true;
      state.blockCounter++;
      events.push({ yokeType: "text_start", blockId: "blk_" + state.blockCounter });
    }
    if (params.delta) {
      events.push({
        yokeType: "text_delta",
        blockId: "blk_" + state.blockCounter,
        text: params.delta,
      });
    }
    return events;
  }

  // serverRequest/resolved - confirmation that an approval was processed
  if (method === "serverRequest/resolved") {
    return events; // no-op, approval already handled
  }

  // Item events
  if (method === "item/started" || method === "item/updated" || method === "item/completed") {
    var item = params.item;
    if (!item) return events;

    var evtPhase = method.split("/")[1]; // "started", "updated", "completed"

    // Agent message (text response)
    if (item.type === "agentMessage" || item.type === "agent_message") {
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
    if (item.type === "reasoning") {
      if (!state.thinkingBlocks[item.id]) {
        state.blockCounter++;
        state.thinkingBlocks[item.id] = "blk_" + state.blockCounter;
        events.push({ yokeType: "thinking_start", blockId: "blk_" + state.blockCounter });
      }
      if (item.text) {
        var thinkBlockId = state.thinkingBlocks[item.id];
        var prevThinkLen = state.thinkingLengths[item.id] || 0;
        if (item.text.length > prevThinkLen) {
          events.push({
            yokeType: "thinking_delta",
            blockId: thinkBlockId,
            text: item.text.substring(prevThinkLen),
          });
          state.thinkingLengths[item.id] = item.text.length;
        }
      }
      if (evtPhase === "completed") {
        events.push({ yokeType: "thinking_stop", blockId: state.thinkingBlocks[item.id] });
      }
      return events;
    }

    // Command execution (bash/shell)
    if (item.type === "commandExecution" || item.type === "command_execution") {
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
      if (evtPhase === "completed") {
        events.push({
          yokeType: "tool_result",
          toolId: item.id,
          blockId: state.toolBlocks[item.id],
          content: item.aggregated_output || item.output || "",
          isError: item.status === "failed",
        });
      }
      return events;
    }

    // File change
    if (item.type === "fileChange" || item.type === "file_change") {
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
      if (evtPhase === "completed") {
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
    if (item.type === "mcpToolCall" || item.type === "mcp_tool_call") {
      console.log("[yoke/codex] MCP event:", method, "tool=" + (item.tool || "?"), "status=" + (item.status || "?"), "error=" + (item.error ? JSON.stringify(item.error) : "none"));
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
      if (evtPhase === "completed") {
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
    if (item.type === "webSearch" || item.type === "web_search") {
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
  console.log("[yoke/codex] UNHANDLED event:", method, JSON.stringify(params).substring(0, 200));
  events.push({
    yokeType: "runtime_specific",
    vendor: "codex",
    eventType: method,
    raw: params,
  });

  return events;
}

// --- QueryHandle ---

function createCodexQueryHandle(appServer, queryOpts) {
  var abortController = queryOpts.abortController;
  var systemPrompt = queryOpts.systemPrompt || "";
  var canUseTool = queryOpts.canUseTool || null;

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

  // Track whether this turn is still active (waiting for turn/completed or turn/failed)
  var turnResolve = null;

  // --- App-server event handler ---
  function handleServerEvent(msg) {
    if (isCancelled()) return;

    var method = msg.method;

    // --- Approval helper ---
    // canUseTool returns { behavior: "allow"|"deny", updatedInput } or truthy/falsy
    function isApproved(decision) {
      if (!decision) return false;
      if (decision === true) return true;
      if (decision.behavior === "allow") return true;
      return false;
    }

    // Command approval request
    if (method === "item/commandExecution/requestApproval") {
      var cmdParams = msg.params || {};
      if (canUseTool) {
        canUseTool("Bash", { command: cmdParams.command }, {}).then(function(decision) {
          appServer.respond(msg.id, isApproved(decision) ? "accept" : "decline");
        }).catch(function(err) {
          console.error("[yoke/codex] canUseTool error:", err.message);
          appServer.respond(msg.id, "decline");
        });
      } else {
        appServer.respond(msg.id, "accept");
      }
      return;
    }

    // File change approval request
    if (method === "item/fileChange/requestApproval") {
      var fcParams = msg.params || {};
      if (canUseTool) {
        var changeInfo = (fcParams.changes || []).map(function(c) { return c.kind + " " + c.path; }).join(", ");
        canUseTool("Edit", { changes: changeInfo, path: fcParams.path }, {}).then(function(decision) {
          appServer.respond(msg.id, isApproved(decision) ? "accept" : "decline");
        }).catch(function(err) {
          console.error("[yoke/codex] canUseTool error:", err.message);
          appServer.respond(msg.id, "decline");
        });
      } else {
        appServer.respond(msg.id, "accept");
      }
      return;
    }

    // MCP tool approval / elicitation (app-server uses mcpServer/elicitation/request)
    if (method === "item/tool/requestUserInput" || method === "mcpServer/elicitation/request") {
      var mcpParams = msg.params || {};
      var mcpMeta = mcpParams._meta || {};
      console.log("[yoke/codex] MCP approval request:", (mcpMeta.tool || "?"), "server=" + (mcpParams.serverName || "?"));
      if (canUseTool) {
        canUseTool("mcp__" + (mcpParams.serverName || "unknown") + "__" + (mcpMeta.tool || "call"), mcpParams, {}).then(function(decision) {
          appServer.respond(msg.id, { action: isApproved(decision) ? "accept" : "decline" });
        }).catch(function(err) {
          console.error("[yoke/codex] MCP canUseTool error:", err.message);
          appServer.respond(msg.id, { action: "decline" });
        });
      } else {
        appServer.respond(msg.id, { action: "accept" });
      }
      return;
    }

    // Regular events: flatten and push to iterator
    var yokeEvents = flattenEvent(msg, state);
    for (var i = 0; i < yokeEvents.length; i++) {
      pushEvent(yokeEvents[i]);
    }

    // Resolve turn promise when turn ends
    if (method === "turn/completed" || method === "turn/failed") {
      if (turnResolve) {
        var resolve = turnResolve;
        turnResolve = null;
        resolve();
      }
    }
  }

  // --- Main query loop ---
  async function runQueryLoop(initialMessage) {
    // Prepend system prompt (project instructions from YOKE layer) to first message
    var currentMessage = systemPrompt
      ? systemPrompt + "\n\n" + initialMessage
      : initialMessage;

    try {
      // Set event handler on app-server
      appServer.eventHandler = handleServerEvent;

      // Start or resume thread
      var threadParams = {
        model: queryOpts.model || "gpt-5.4",
        sandboxMode: queryOpts.sandboxMode || "workspace-write",
        approvalPolicy: queryOpts.approvalPolicy || "on-failure",
        workingDirectory: queryOpts.cwd,
        skipGitRepoCheck: true,
      };
      if (queryOpts.modelReasoningEffort) {
        threadParams.modelReasoningEffort = queryOpts.modelReasoningEffort;
      }
      if (queryOpts.webSearchMode) {
        threadParams.webSearchMode = queryOpts.webSearchMode;
      }

      var threadResult;
      if (queryOpts.resumeSessionId) {
        threadResult = await appServer.send("thread/resume", {
          threadId: queryOpts.resumeSessionId,
          model: threadParams.model,
        }, 60000);
      } else {
        threadResult = await appServer.send("thread/start", threadParams, 60000);
      }

      if (threadResult && threadResult.thread) {
        state.threadId = threadResult.thread.id;
      }

      while (!isCancelled()) {
        // Reset per-turn state
        state.turnStarted = false;
        state.textBlocks = {};
        state.textLengths = {};
        state.thinkingBlocks = {};
        state.thinkingLengths = {};
        state.toolBlocks = {};

        // Start turn
        var turnPromise = new Promise(function(resolve) { turnResolve = resolve; });

        var input;
        if (typeof currentMessage === "string") {
          input = [{ type: "text", text: currentMessage }];
        } else {
          input = currentMessage;
        }

        await appServer.send("turn/start", {
          threadId: state.threadId,
          input: input,
        }, 60000);

        // Wait for turn to complete
        await turnPromise;

        if (isCancelled()) break;

        // Wait for next message (multi-turn)
        var nextMsg = await waitForMessage();
        if (nextMsg === null) break;
        currentMessage = nextMsg;
      }
    } catch (e) {
      // Suppress AbortError when the user stopped the query.
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
      // Send turn/interrupt to app-server
      if (state.threadId && appServer.started) {
        try {
          appServer.notify("turn/interrupt", { threadId: state.threadId });
        } catch (e) {}
      }
      if (abortController) {
        try { abortController.abort(); } catch (e) {}
      }
      // Resolve any waiting turn promise
      if (turnResolve) {
        var resolve = turnResolve;
        turnResolve = null;
        resolve();
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
  var _appServer = null;
  var _initPromise = null;
  var _initOpts = null; // stored for query-time access

  var adapter = {
    vendor: "codex",

    init: function(initOpts) {
      // Already initialized - return cached result
      if (_appServer && _appServer.started && _cachedModels.length > 0) {
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
            elicitation: true,
            fileCheckpointing: false,
            contextCompacting: false,
            toolPolicy: ["ask", "allow-all"],
          },
        });
      }

      // Deduplicate concurrent init calls
      if (_initPromise) return _initPromise;

      _initPromise = (async function() {
        _initOpts = initOpts;

        var serverOpts = { cwd: _cwd };

        // Extract adapter options
        if (initOpts && initOpts.adapterOptions && initOpts.adapterOptions.CODEX) {
          var co = initOpts.adapterOptions.CODEX;
          if (co.apiKey) serverOpts.env = Object.assign({}, serverOpts.env || {}, { OPENAI_API_KEY: co.apiKey });
          if (co.baseUrl) serverOpts.env = Object.assign({}, serverOpts.env || {}, { OPENAI_BASE_URL: co.baseUrl });
          if (co.config) serverOpts.config = co.config;
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
          serverOpts.config = Object.assign({}, serverOpts.config || {}, {
            mcp_servers: mcpServerConfig,
          });
          console.log("[codex] MCP servers configured:", Object.keys(mcpServerConfig).join(", "));
          try {
            var names = Object.keys(mcpServerConfig);
            for (var di = 0; di < names.length; di++) {
              var sc = mcpServerConfig[names[di]];
              console.log("[codex] MCP server '" + names[di] + "': command=" + sc.command + " args=" + JSON.stringify(sc.args));
            }
          } catch (e) {}
        }

        // Spawn and initialize app-server
        _appServer = new CodexAppServer(null, serverOpts);
        await _appServer.start();

        await _appServer.send("initialize", {
          clientInfo: { name: "clay", title: "Clay", version: "1.0.0" },
          capabilities: { experimentalApi: true },
        });
        _appServer.notify("initialized", {});

        console.log("[codex] App-server initialized, models: gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2");

        _cachedModels = [
          "gpt-5.4",
          "gpt-5.4-mini",
          "gpt-5.3-codex",
          "gpt-5.3-codex-spark",
          "gpt-5.2",
        ];

        _initPromise = null;

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
            elicitation: true,
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
      console.log("[yoke/codex] createToolServer skipped: Codex handles tools internally");
      return null;
    },

    createQuery: async function(queryOpts) {
      if (!_appServer || !_appServer.started) {
        throw new Error("[yoke/codex] Adapter not initialized. Call init() first.");
      }

      var model = queryOpts.model || "gpt-5.4";
      var ac = queryOpts.abortController || new AbortController();

      // Map YOKE options to Codex thread options
      var codexOpts = (queryOpts.adapterOptions && queryOpts.adapterOptions.CODEX) || {};

      var handleOpts = {
        model: model,
        cwd: queryOpts.cwd || _cwd,
        systemPrompt: queryOpts.systemPrompt || "",
        abortController: ac,
        canUseTool: queryOpts.canUseTool || null,
        resumeSessionId: queryOpts.resumeSessionId || null,
      };

      // Reasoning effort
      if (queryOpts.effort || codexOpts.modelReasoningEffort) {
        handleOpts.modelReasoningEffort = codexOpts.modelReasoningEffort || queryOpts.effort || "medium";
      }

      // Tool policy -> approval mode
      if (queryOpts.toolPolicy === "allow-all") {
        handleOpts.approvalPolicy = "never";
      } else {
        handleOpts.approvalPolicy = codexOpts.approvalPolicy || "on-failure";
      }

      // Sandbox mode
      handleOpts.sandboxMode = codexOpts.sandboxMode || "workspace-write";

      // Web search
      if (codexOpts.webSearchMode && codexOpts.webSearchMode !== "disabled") {
        handleOpts.webSearchMode = codexOpts.webSearchMode;
      }

      console.log("[yoke/codex] createQuery: model=" + model + " approval=" + handleOpts.approvalPolicy + " sandbox=" + handleOpts.sandboxMode);

      var handle = createCodexQueryHandle(_appServer, handleOpts);
      return handle;
    },

    // Codex has session persistence via thread IDs
    getSessionInfo: function(sessionId) {
      return Promise.resolve(null);
    },
    listSessions: function() { return Promise.resolve([]); },
    renameSession: function() { return Promise.resolve(); },
    forkSession: function() { return Promise.resolve(null); },

    // Shutdown the app-server process
    shutdown: function() {
      if (_appServer) {
        _appServer.stop();
        _appServer = null;
      }
    },
  };

  return adapter;
}

module.exports = {
  createCodexAdapter: createCodexAdapter,
};
