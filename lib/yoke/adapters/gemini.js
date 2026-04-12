// YOKE Gemini Adapter
// --------------------
// Implements the YOKE interface using @google/genai SDK.
// This is the ONLY file that imports the Gemini SDK.

// --- SDK loading ---
var _sdkPromise = null;
function loadSDK() {
  if (!_sdkPromise) _sdkPromise = import("@google/genai");
  return _sdkPromise;
}

// --- Event flattening ---
// Converts Gemini streaming chunks into flat objects with a yokeType field.
// Gemini chunks contain candidates[0].content.parts[] with text, thinking, or functionCall.

function flattenChunk(chunk, state) {
  var events = [];
  if (!chunk || !chunk.candidates || !chunk.candidates[0]) {
    return events;
  }

  var candidate = chunk.candidates[0];
  var parts = (candidate.content && candidate.content.parts) || [];

  // First chunk -> turn_start
  if (!state.turnStarted) {
    state.turnStarted = true;
    events.push({ yokeType: "turn_start" });
  }

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];

    // Thinking text
    if (part.thought && part.text) {
      if (!state.thinkingStarted) {
        state.thinkingStarted = true;
        state.blockCounter++;
        state.thinkingBlockId = "blk_" + state.blockCounter;
        events.push({ yokeType: "thinking_start", blockId: state.thinkingBlockId });
      }
      events.push({
        yokeType: "thinking_delta",
        blockId: state.thinkingBlockId,
        text: part.text,
      });
      continue;
    }

    // Regular text
    if (part.text && !part.thought) {
      // If thinking was active, close it
      if (state.thinkingStarted) {
        events.push({ yokeType: "thinking_stop", blockId: state.thinkingBlockId });
        state.thinkingStarted = false;
      }
      if (!state.textStarted) {
        state.textStarted = true;
        state.blockCounter++;
        state.textBlockId = "blk_" + state.blockCounter;
        events.push({ yokeType: "text_start", blockId: state.textBlockId });
      }
      events.push({
        yokeType: "text_delta",
        blockId: state.textBlockId,
        text: part.text,
      });
      continue;
    }

    // Function call
    if (part.functionCall) {
      // Close thinking/text if active
      if (state.thinkingStarted) {
        events.push({ yokeType: "thinking_stop", blockId: state.thinkingBlockId });
        state.thinkingStarted = false;
      }
      state.blockCounter++;
      var toolBlockId = "blk_" + state.blockCounter;
      var toolId = "tool_" + state.toolCounter++;
      events.push({
        yokeType: "tool_start",
        blockId: toolBlockId,
        toolId: toolId,
        toolName: part.functionCall.name,
      });
      events.push({
        yokeType: "tool_executing",
        blockId: toolBlockId,
        toolId: toolId,
        toolName: part.functionCall.name,
        input: part.functionCall.args || {},
      });
      // Store for tool loop
      state.pendingToolCalls.push({
        toolId: toolId,
        blockId: toolBlockId,
        name: part.functionCall.name,
        args: part.functionCall.args || {},
      });
      continue;
    }
  }

  // Usage metadata
  if (chunk.usageMetadata) {
    state.lastUsage = {
      promptTokenCount: chunk.usageMetadata.promptTokenCount || 0,
      candidatesTokenCount: chunk.usageMetadata.candidatesTokenCount || 0,
      totalTokenCount: chunk.usageMetadata.totalTokenCount || 0,
      thoughtsTokenCount: chunk.usageMetadata.thoughtsTokenCount || 0,
    };
  }

  // Finish reason
  if (candidate.finishReason) {
    state.finishReason = candidate.finishReason;
  }

  return events;
}

// --- QueryHandle ---

function createGeminiQueryHandle(chat, model, toolHandlers, canUseTool, abortController, adapterOptions) {
  var state = {
    blockCounter: 0,
    toolCounter: 0,
    turnStarted: false,
    thinkingStarted: false,
    thinkingBlockId: null,
    textStarted: false,
    textBlockId: null,
    pendingToolCalls: [],
    lastUsage: null,
    finishReason: null,
    done: false,
    aborted: false,
  };

  // Internal event buffer for the async iterator
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

  // --- Tool execution with canUseTool ---
  async function executeTools(pendingCalls) {
    var responses = [];
    for (var i = 0; i < pendingCalls.length; i++) {
      var tc = pendingCalls[i];

      // Check permission via canUseTool callback
      if (canUseTool) {
        var approval = await canUseTool(tc.name, tc.args, {});
        if (approval && approval.behavior === "deny") {
          pushEvent({
            yokeType: "tool_result",
            toolId: tc.toolId,
            blockId: tc.blockId,
            content: approval.message || "Tool use denied",
            isError: true,
          });
          responses.push({
            functionResponse: {
              name: tc.name,
              response: { error: approval.message || "Tool use denied" },
            },
          });
          continue;
        }
      }

      // Execute tool handler
      var handler = toolHandlers[tc.name];
      if (!handler) {
        pushEvent({
          yokeType: "tool_result",
          toolId: tc.toolId,
          blockId: tc.blockId,
          content: "Unknown tool: " + tc.name,
          isError: true,
        });
        responses.push({
          functionResponse: {
            name: tc.name,
            response: { error: "Unknown tool: " + tc.name },
          },
        });
        continue;
      }

      try {
        var result = await handler(tc.args);
        var resultText = typeof result === "string" ? result : JSON.stringify(result);
        pushEvent({
          yokeType: "tool_result",
          toolId: tc.toolId,
          blockId: tc.blockId,
          content: resultText,
          isError: false,
        });
        responses.push({
          functionResponse: {
            name: tc.name,
            response: { result: result },
          },
        });
      } catch (e) {
        pushEvent({
          yokeType: "tool_result",
          toolId: tc.toolId,
          blockId: tc.blockId,
          content: e.message || String(e),
          isError: true,
        });
        responses.push({
          functionResponse: {
            name: tc.name,
            response: { error: e.message || String(e) },
          },
        });
      }
    }
    return responses;
  }

  // --- Main query loop (runs in background) ---
  async function runQueryLoop(initialMessage) {
    var currentMessage = initialMessage;

    try {
      while (!state.aborted) {
        // Reset per-turn state
        state.turnStarted = false;
        state.thinkingStarted = false;
        state.textStarted = false;
        state.pendingToolCalls = [];
        state.finishReason = null;

        // Send message and stream response
        var streamConfig = {};
        if (adapterOptions && adapterOptions.GEMINI) {
          var go = adapterOptions.GEMINI;
          if (go.temperature != null) streamConfig.temperature = go.temperature;
          if (go.maxOutputTokens != null) streamConfig.maxOutputTokens = go.maxOutputTokens;
          if (go.topP != null) streamConfig.topP = go.topP;
          if (go.topK != null) streamConfig.topK = go.topK;
        }

        var sendParams = { message: currentMessage };
        if (Object.keys(streamConfig).length > 0) sendParams.config = streamConfig;

        var response = await chat.sendMessageStream(sendParams);

        for await (var chunk of response) {
          if (state.aborted) break;
          var events = flattenChunk(chunk, state);
          for (var i = 0; i < events.length; i++) {
            pushEvent(events[i]);
          }
        }

        if (state.aborted) break;

        // Close open blocks
        if (state.thinkingStarted) {
          pushEvent({ yokeType: "thinking_stop", blockId: state.thinkingBlockId });
          state.thinkingStarted = false;
        }

        // Tool calls pending?
        if (state.pendingToolCalls.length > 0) {
          var toolResponses = await executeTools(state.pendingToolCalls);
          if (state.aborted) break;
          // Send tool results back as next message
          currentMessage = toolResponses;
          continue;
        }

        // No tool calls -> this turn is done
        pushEvent({
          yokeType: "result",
          cost: null,
          duration: null,
          usage: state.lastUsage,
          sessionId: null,
          finishReason: state.finishReason,
        });

        // Wait for next message (multi-turn)
        var nextMsg = await waitForMessage();
        if (nextMsg === null) {
          // Message queue ended
          break;
        }
        currentMessage = nextMsg;
      }
    } catch (e) {
      if (!state.aborted) {
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
      var parts = [];
      if (images && images.length > 0) {
        for (var i = 0; i < images.length; i++) {
          parts.push({
            inlineData: {
              mimeType: images[i].mediaType,
              data: images[i].data,
            },
          });
        }
      }
      if (text) parts.push({ text: text });
      pushMessageToQueue(parts.length === 1 && parts[0].text ? text : parts);
    },

    setModel: function(newModel) {
      // Gemini fixes model at Chat creation.
      // To change model, would need to create new Chat with history.
      // For now, store and apply on next query.
      return Promise.resolve();
    },

    setEffort: function(effort) {
      // Stored for next query
      return Promise.resolve();
    },

    setToolPolicy: function(policy) {
      // Gemini uses functionCallingConfig which is set at Chat creation.
      // For now, no mid-session change.
      return Promise.resolve();
    },

    stopTask: function(taskId) {
      // Gemini has no sub-agents
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

    // Start the query loop (called after first pushMessage)
    _startLoop: function(initialMessage) {
      runQueryLoop(initialMessage);
    },
  };

  return handle;
}

// --- Adapter factory ---

function createGeminiAdapter(opts) {
  var _cwd = (opts && opts.cwd) || process.cwd();
  var _cachedModels = [];
  var _ai = null;

  var adapter = {
    vendor: "gemini",

    init: async function(initOpts) {
      var genaiModule = await loadSDK();
      var GoogleGenAI = genaiModule.GoogleGenAI;

      var apiKey = null;
      if (initOpts && initOpts.adapterOptions && initOpts.adapterOptions.GEMINI) {
        apiKey = initOpts.adapterOptions.GEMINI.apiKey;
      }
      apiKey = apiKey || process.env.GEMINI_API_KEY;

      if (!apiKey) {
        throw new Error("[yoke/gemini] No API key. Set GEMINI_API_KEY or pass adapterOptions.GEMINI.apiKey");
      }

      _ai = new GoogleGenAI({ apiKey: apiKey });

      // Hardcoded model list for now. Gemini API model listing requires
      // additional API call that may not be worth the latency on init.
      _cachedModels = [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash",
      ];

      return {
        models: _cachedModels,
        defaultModel: "gemini-2.5-flash",
        skills: [],
        slashCommands: [],
        fastModeState: null,
        capabilities: {
          thinking: true,
          betas: false,
          rewind: false,
          sessionResume: false,
          promptSuggestions: false,
          elicitation: false,
          fileCheckpointing: false,
          contextCompacting: false,
          toolPolicy: ["ask", "allow-all"],
        },
      };
    },

    supportedModels: function() {
      return Promise.resolve(_cachedModels.slice());
    },

    createToolServer: function(def) {
      // Convert YOKE tool definitions to Gemini FunctionDeclaration format.
      // Returns { declarations: [...], handlers: { name: fn } }
      var declarations = [];
      var handlers = {};

      for (var i = 0; i < def.tools.length; i++) {
        var t = def.tools[i];
        declarations.push({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema || undefined,
        });
        if (t.handler) {
          handlers[t.name] = t.handler;
        }
      }

      return {
        _type: "gemini_tool_server",
        name: def.name,
        declarations: declarations,
        handlers: handlers,
      };
    },

    createQuery: async function(queryOpts) {
      if (!_ai) {
        throw new Error("[yoke/gemini] Adapter not initialized. Call init() first.");
      }

      var model = queryOpts.model || "gemini-2.5-flash";
      var ac = queryOpts.abortController || new AbortController();

      // Build chat config
      var chatConfig = {};

      // System prompt
      if (queryOpts.systemPrompt) {
        chatConfig.systemInstruction = queryOpts.systemPrompt;
      }

      // Tools
      var toolHandlers = {};
      if (queryOpts.toolServers) {
        var allDeclarations = [];
        var servers = queryOpts.toolServers;
        // toolServers can be an object { name: server } or array
        if (Array.isArray(servers)) {
          for (var i = 0; i < servers.length; i++) {
            if (servers[i] && servers[i]._type === "gemini_tool_server") {
              allDeclarations = allDeclarations.concat(servers[i].declarations);
              Object.assign(toolHandlers, servers[i].handlers);
            }
          }
        } else if (typeof servers === "object") {
          for (var key in servers) {
            var srv = servers[key];
            if (srv && srv._type === "gemini_tool_server") {
              allDeclarations = allDeclarations.concat(srv.declarations);
              Object.assign(toolHandlers, srv.handlers);
            }
          }
        }
        if (allDeclarations.length > 0) {
          chatConfig.tools = [{ functionDeclarations: allDeclarations }];
        }
      }

      // Thinking config from adapterOptions
      var geminiOpts = (queryOpts.adapterOptions && queryOpts.adapterOptions.GEMINI) || {};
      if (geminiOpts.thinkingConfig) {
        chatConfig.thinkingConfig = geminiOpts.thinkingConfig;
      }

      // Safety settings
      if (geminiOpts.safetySettings) {
        chatConfig.safetySettings = geminiOpts.safetySettings;
      }

      // Temperature, maxOutputTokens, etc.
      if (geminiOpts.temperature != null) chatConfig.temperature = geminiOpts.temperature;
      if (geminiOpts.maxOutputTokens != null) chatConfig.maxOutputTokens = geminiOpts.maxOutputTokens;
      if (geminiOpts.topP != null) chatConfig.topP = geminiOpts.topP;
      if (geminiOpts.topK != null) chatConfig.topK = geminiOpts.topK;

      // Tool policy
      if (queryOpts.toolPolicy === "allow-all" && chatConfig.tools) {
        chatConfig.toolConfig = {
          functionCallingConfig: { mode: "ANY" },
        };
      }

      // Create chat
      var chat = _ai.chats.create({
        model: model,
        config: chatConfig,
      });

      var handle = createGeminiQueryHandle(
        chat, model, toolHandlers,
        queryOpts.canUseTool || null,
        ac,
        queryOpts.adapterOptions
      );

      return handle;
    },

    // Gemini has no session management (stateless chat)
    getSessionInfo: function() { return Promise.resolve(null); },
    listSessions: function() { return Promise.resolve([]); },
    renameSession: function() { return Promise.resolve(); },
    forkSession: function() { return Promise.resolve(null); },
  };

  return adapter;
}

module.exports = {
  createGeminiAdapter: createGeminiAdapter,
};
