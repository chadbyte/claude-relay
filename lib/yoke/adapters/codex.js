// YOKE Codex Adapter
// -------------------
// Implements the YOKE interface using codex app-server protocol.
// Bidirectional JSON-RPC over stdin/stdout enables interactive approval flows.

var path = require("path");
var fs = require("fs");
var { CodexAppServer } = require("../codex-app-server");

// --- Claude skill discovery ---
// Finds Claude skills in ~/.claude/skills/ and <cwd>/.claude/skills/
// so Codex can recognize $<skill-name> in user input.
function discoverClaudeSkills(cwd) {
  var skills = {};
  var REAL_HOME;
  try { REAL_HOME = require("../../config").REAL_HOME; } catch (e) { REAL_HOME = require("os").homedir(); }
  var dirs = [
    path.join(REAL_HOME, ".claude", "skills"),
    path.join(cwd || "", ".claude", "skills"),
  ];
  for (var d = 0; d < dirs.length; d++) {
    var base = dirs[d];
    if (!base) continue;
    var entries;
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (e) { continue; }
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      var skillMd = path.join(base, entry.name, "SKILL.md");
      try {
        fs.accessSync(skillMd, fs.constants.R_OK);
        // project skills override global skills
        skills[entry.name] = skillMd;
      } catch (e) {}
    }
  }
  return skills;
}

// Parse user text for $<skill-name> references.
// Returns { text, skills: [{ name, path }] }
function parseSkillRefs(text, availableSkills) {
  if (typeof text !== "string") return { text: text, skills: [] };
  var skills = [];
  var seen = {};
  var re = /\$([a-zA-Z0-9_-]+)/g;
  var match;
  while ((match = re.exec(text)) !== null) {
    var name = match[1];
    if (seen[name]) continue;
    if (availableSkills[name]) {
      seen[name] = true;
      skills.push({ name: name, path: availableSkills[name] });
    }
  }
  return { text: text, skills: skills };
}

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

var _uuidCounter = 0;
function generateUuid() {
  var ts = Date.now().toString(36);
  var cnt = (++_uuidCounter).toString(36);
  var rnd = Math.random().toString(36).substring(2, 8);
  return "codex-" + ts + "-" + cnt + "-" + rnd;
}

function waitMs(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

function waitForProcessExit(proc, timeoutMs) {
  return new Promise(function(resolve) {
    if (!proc) {
      resolve(true);
      return;
    }

    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }

    var done = false;
    var timer = null;

    function cleanup() {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      proc.removeListener("exit", onDone);
      proc.removeListener("close", onDone);
    }

    function onDone() {
      cleanup();
      resolve(true);
    }

    proc.once("exit", onDone);
    proc.once("close", onDone);

    timer = setTimeout(function() {
      cleanup();
      resolve(false);
    }, timeoutMs || 5000);
  });
}

function createShutdownError() {
  var err = new Error("Codex adapter is shutting down, retry shortly");
  err.code = "CODEX_ADAPTER_SHUTTING_DOWN";
  return err;
}

function normalizePlanStatus(status) {
  if (status === "inProgress") return "in_progress";
  if (status === "completed") return "completed";
  return "pending";
}

function extractPromptSuggestion(params) {
  if (!params) return "";
  if (typeof params.suggestion === "string") return params.suggestion;
  if (typeof params.promptSuggestion === "string") return params.promptSuggestion;
  if (typeof params.suggestedPrompt === "string") return params.suggestedPrompt;
  if (Array.isArray(params.suggestions) && typeof params.suggestions[0] === "string") return params.suggestions[0];
  if (Array.isArray(params.promptSuggestions) && typeof params.promptSuggestions[0] === "string") return params.promptSuggestions[0];
  if (Array.isArray(params.followUpSuggestions) && typeof params.followUpSuggestions[0] === "string") return params.followUpSuggestions[0];
  return "";
}

function flattenEvent(notification, state) {
  var events = [];
  var method = notification.method;
  var params = notification.params || {};


  if (method === "thread/started") {
    state.threadId = params.thread ? params.thread.id : (params.threadId || null);
    return events;
  }

  if (method === "turn/started") {
    state.turnStarted = true;
    var userUuid = generateUuid();
    events.push({ yokeType: "turn_start", uuid: userUuid, messageType: "user" });
    return events;
  }

  if (method === "turn/completed") {
    var usage = params.usage || null;
    var turnStatus = params.status || (params.turn && params.turn.status) || null;
    state.lastUsage = usage;
    // Emit interrupted status so UI shows "stopped" message
    if (turnStatus === "interrupted" || state.aborted) {
      events.push({ yokeType: "interrupted" });
    }
    var inputTokens = state.lastInputTokens || (usage ? (usage.input_tokens || 0) + (usage.cached_input_tokens || 0) : 0);
    var outputTokens = usage ? (usage.output_tokens || 0) : 0;
    var cachedTokens = usage ? (usage.cached_input_tokens || 0) : 0;
    var hasTokenData = inputTokens > 0 || outputTokens > 0;
    var resultModelUsage = {};
    resultModelUsage[state.model] = { contextWindow: null };
    var assistantUuid = generateUuid();
    events.push({
      yokeType: "result",
      uuid: assistantUuid,
      messageType: "assistant",
      cost: null,
      duration: null,
      usage: hasTokenData ? {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cachedTokens,
        cache_creation_input_tokens: 0,
      } : null,
      modelUsage: resultModelUsage,
      sessionId: state.threadId || null,
      lastStreamInputTokens: state.lastInputTokens || null,
    });
    state.lastInputTokens = null;
    return events;
  }

  if (method === "turn/plan/updated") {
    events.push({
      yokeType: "plan_updated",
      turnId: params.turnId || null,
      explanation: params.explanation || "",
      title: "Plan",
      plan: Array.isArray(params.plan) ? params.plan.map(function(step) {
        return {
          step: step && step.step ? step.step : "",
          status: normalizePlanStatus(step && step.status),
        };
      }) : [],
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

  // Rate limits from Codex account
  if (method === "account/rateLimits/updated") {
    var rl = params.rateLimits;
    if (rl) {
      var windows = [
        { key: "primary", type: "five_hour" },
        { key: "secondary", type: "seven_day" },
      ];
      for (var wi = 0; wi < windows.length; wi++) {
        var w = rl[windows[wi].key];
        if (!w) continue;
        var utilization = (w.usedPercent || 0) / 100;
        var status = "allowed";
        if (w.usedPercent >= 100) status = "rejected";
        else if (w.usedPercent >= 80) status = "allowed_warning";
        events.push({
          yokeType: "rate_limit",
          rateLimitInfo: {
            status: status,
            resetsAt: w.resetsAt || null,
            rateLimitType: windows[wi].type,
            utilization: utilization,
            isUsingOverage: false,
          },
        });
      }
    }
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
      // Track cumulative streamed length so item/completed doesn't re-send the full text
      if (deltaItemId) {
        state.textLengths[deltaItemId] = (state.textLengths[deltaItemId] || 0) + params.delta.length;
      }
    }
    return events;
  }

  if (method === "item/plan/delta") {
    var planDeltaItemId = params.itemId || params.id;
    var nextPlanText = (state.planTexts[planDeltaItemId] || "") + (params.delta || "");
    if (planDeltaItemId) state.planTexts[planDeltaItemId] = nextPlanText;
    if (nextPlanText) {
      events.push({
        yokeType: "plan_content",
        content: nextPlanText,
        itemId: planDeltaItemId || null,
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

    if (item.type === "plan") {
      if (typeof item.text === "string") {
        state.planTexts[item.id] = item.text;
        events.push({
          yokeType: "plan_content",
          content: item.text,
          itemId: item.id,
          final: evtPhase === "completed",
        });
      }
      return events;
    }

    if (item.type === "contextCompaction" || item.type === "context_compaction") {
      events.push({
        yokeType: "status",
        status: evtPhase === "completed" ? "processing" : "compacting",
      });
      return events;
    }

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
      // Codex reasoning items may expose plain text via `text`, a short
      // `summary`, or nested `content` parts. Prefer whichever is present;
      // many turns arrive with only encrypted reasoning and no readable
      // text at all, in which case the UI will hide the expand affordance.
      var reasoningText = "";
      if (typeof item.text === "string" && item.text.length > 0) {
        reasoningText = item.text;
      } else if (typeof item.summary === "string" && item.summary.length > 0) {
        reasoningText = item.summary;
      } else if (Array.isArray(item.content)) {
        var parts = [];
        for (var rpi = 0; rpi < item.content.length; rpi++) {
          var rp = item.content[rpi];
          if (rp && typeof rp.text === "string") parts.push(rp.text);
        }
        reasoningText = parts.join("\n");
      }
      if (reasoningText) {
        var thinkBlockId = state.thinkingBlocks[item.id];
        var prevThinkLen = state.thinkingLengths[item.id] || 0;
        if (reasoningText.length > prevThinkLen) {
          events.push({
            yokeType: "thinking_delta",
            blockId: thinkBlockId,
            text: reasoningText.substring(prevThinkLen),
          });
          state.thinkingLengths[item.id] = reasoningText.length;
        }
      }
      if (evtPhase === "completed") {
        events.push({ yokeType: "thinking_stop", blockId: state.thinkingBlocks[item.id] });
      }
      return events;
    }

    // Command execution (bash/shell)
    if (item.type === "commandExecution" || item.type === "command_execution") {
      var commandText = item.command || state.commandInputs[item.id] || "";
      if (commandText) state.commandInputs[item.id] = commandText;
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
          input: { command: commandText },
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
      var changes = item.changes || [];
      var changeDesc = changes.map(function(c) { return c.kind + " " + c.path; }).join(", ");
      var primaryPath = changes.length === 1 ? (changes[0].path || "") : "";
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
        events.push({
          yokeType: "tool_executing",
          blockId: fcBlockId,
          toolId: item.id,
          toolName: "Edit",
          input: {
            changes: changeDesc,
            file_path: primaryPath || undefined,
          },
        });
      }
      if (evtPhase === "completed") {
        var diffText = changes.map(function(c) {
          return c && c.diff ? c.diff : "";
        }).filter(Boolean).join("\n\n");
        events.push({
          yokeType: "tool_result",
          toolId: item.id,
          blockId: state.toolBlocks[item.id],
          content: diffText || (item.status === "completed" ? "Changes applied" : "Changes failed"),
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

  // Token usage update - track input tokens for context bar
  if (method === "thread/tokenUsage/updated") {
    var tu = params.tokenUsage;
    if (tu && tu.total) {
      state.lastInputTokens = tu.total.inputTokens || 0;
    }
    return events;
  }

  var promptSuggestion = extractPromptSuggestion(params);
  if (promptSuggestion) {
    events.push({
      yokeType: "prompt_suggestion",
      suggestion: promptSuggestion,
    });
    return events;
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
  var onElicitation = queryOpts.onElicitation || null;
  var onFinished = queryOpts.onFinished || null;

  // Check if the query was cancelled (either via handle.abort() or direct signal abort)
  function isCancelled() {
    return state.aborted || (abortController && abortController.signal && abortController.signal.aborted);
  }

  var state = {
    blockCounter: 0,
    threadId: null,
    turnStarted: false,
    lastUsage: null,
    lastInputTokens: null, // from thread/tokenUsage/updated
    done: false,
    aborted: false,
    loopStarted: false,
    model: queryOpts.model || "gpt-5.4",
    // Track incremental text deltas
    textBlocks: {},     // itemId -> true (text_start sent)
    textLengths: {},    // itemId -> last sent length
    thinkingBlocks: {}, // itemId -> blockId
    thinkingLengths: {}, // itemId -> last sent length
    toolBlocks: {},     // itemId -> blockId (for tool_start dedup)
    commandInputs: {},  // itemId -> command captured from approval/start events
    planTexts: {},      // itemId -> streamed plan text
  };

  // Internal event buffer for async iterator
  var eventBuffer = [];
  var eventWaiting = null;
  var iteratorDone = false;
  var finishedNotified = false;

  function notifyFinished() {
    if (finishedNotified) return;
    finishedNotified = true;
    if (typeof onFinished === "function") {
      try {
        onFinished();
      } catch (e) {
        console.error("[yoke/codex] onFinished error:", e.message || e);
      }
    }
  }

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
    notifyFinished();
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
    var method = msg.method;
    var params = msg.params || {};

    // Ignore events from other threads (app-server is shared across sessions)
    if (params.threadId && state.threadId && params.threadId !== state.threadId) return;

    // After abort, only let turn-ending events through
    if (isCancelled() && method !== "turn/completed" && method !== "turn/failed" && method !== "serverRequest/resolved" && method !== "thread/status/changed") return;

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
      if (cmdParams.itemId && cmdParams.command) {
        state.commandInputs[cmdParams.itemId] = cmdParams.command;
      }
      if (canUseTool) {
        canUseTool("Bash", { command: cmdParams.command }, {}).then(function(decision) {
          var approved = isApproved(decision);
          // Response must be wrapped in { decision: ... } object per app-server protocol
          appServer.respond(msg.id, { decision: approved ? "accept" : "decline" });
        }).catch(function(err) {
          console.error("[yoke/codex] canUseTool error:", err.message);
          appServer.respond(msg.id, { decision: "decline" });
        });
      } else {
        appServer.respond(msg.id, { decision: "accept" });
      }
      return;
    }

    // File change approval request
    if (method === "item/fileChange/requestApproval") {
      var fcParams = msg.params || {};
      if (canUseTool) {
        var changeInfo = (fcParams.changes || []).map(function(c) { return c.kind + " " + c.path; }).join(", ");
        canUseTool("Edit", { changes: changeInfo, path: fcParams.path }, {}).then(function(decision) {
          appServer.respond(msg.id, { decision: isApproved(decision) ? "accept" : "decline" });
        }).catch(function(err) {
          console.error("[yoke/codex] canUseTool error:", err.message);
          appServer.respond(msg.id, { decision: "decline" });
        });
      } else {
        appServer.respond(msg.id, { decision: "accept" });
      }
      return;
    }

    // MCP tool approval / elicitation (app-server uses mcpServer/elicitation/request)
    if (method === "item/tool/requestUserInput" || method === "mcpServer/elicitation/request") {
      var mcpParams = msg.params || {};
      var mcpMeta = mcpParams._meta || {};
      console.log("[yoke/codex] MCP approval request:", (mcpMeta.tool || "?"), "server=" + (mcpParams.serverName || "?"));
      if (onElicitation) {
        var request = {
          serverName: mcpParams.serverName || (mcpMeta.tool || "Tool"),
          message: mcpParams.message || mcpParams.prompt || "",
          mode: mcpParams.url ? "url" : "form",
          url: mcpParams.url || null,
          elicitationId: mcpParams.elicitationId || null,
          requestedSchema: mcpParams.requestedSchema || null,
        };
        if (!request.requestedSchema && Array.isArray(mcpParams.questions) && mcpParams.questions.length > 0) {
          var schema = { type: "object", properties: {}, required: [] };
          for (var qi = 0; qi < mcpParams.questions.length; qi++) {
            var q = mcpParams.questions[qi];
            var qid = q.id || ("question_" + (qi + 1));
            schema.required.push(qid);
            if (Array.isArray(q.options) && q.options.length > 0) {
              schema.properties[qid] = {
                type: "string",
                description: q.question || q.prompt || qid,
                enum: q.options.map(function(opt) { return opt && (opt.value || opt.label) ? (opt.value || opt.label) : ""; }).filter(Boolean),
              };
            } else {
              schema.properties[qid] = {
                type: "string",
                description: q.question || q.prompt || qid,
              };
            }
          }
          request.requestedSchema = schema;
        }
        onElicitation(request, {
          signal: { addEventListener: function() {} },
        }).then(function(result) {
          appServer.respond(msg.id, result || { action: "reject" });
        }).catch(function(err) {
          console.error("[yoke/codex] elicitation_response send failed:", err.message || err);
          appServer.respond(msg.id, { action: "reject" });
        });
      } else if (canUseTool) {
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
    // Prepend system prompt (project instructions from YOKE layer) to first message.
    // initialMessage may be a string (text-only) or an array of content items
    // (e.g. [{ type: "text", text: "..." }, ...] when images/attachments are present).
    // Naive string concatenation on an array coerces it via toString(), producing
    // "[object Object]" inside the prompt, so we must branch on the shape.
    var currentMessage;
    if (!systemPrompt) {
      currentMessage = initialMessage;
    } else if (typeof initialMessage === "string") {
      currentMessage = systemPrompt + "\n\n" + initialMessage;
    } else if (Array.isArray(initialMessage)) {
      // Prepend systemPrompt to the first text item; if none exists, insert one.
      var cloned = initialMessage.slice();
      var injected = false;
      for (var i = 0; i < cloned.length; i++) {
        if (cloned[i] && cloned[i].type === "text") {
          cloned[i] = {
            type: "text",
            text: systemPrompt + "\n\n" + (cloned[i].text || ""),
          };
          injected = true;
          break;
        }
      }
      if (!injected) {
        cloned.unshift({ type: "text", text: systemPrompt });
      }
      currentMessage = cloned;
    } else {
      currentMessage = initialMessage;
    }

    try {
      // Set event handler on app-server
      appServer.eventHandler = handleServerEvent;

      // Start or resume thread
      var threadParams = {
        model: queryOpts.model || "gpt-5.4",
        sandbox: queryOpts.sandboxMode || "workspace-write",
        approvalPolicy: queryOpts.approvalPolicy || "on-failure",
        cwd: queryOpts.cwd,
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
          sandbox: threadParams.sandbox,
          approvalPolicy: threadParams.approvalPolicy,
          cwd: threadParams.cwd,
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
        state.commandInputs = {};
        state.planTexts = {};

        // Start turn
        var turnPromise = new Promise(function(resolve) { turnResolve = resolve; });

        var input;
        if (typeof currentMessage === "string") {
          input = [{ type: "text", text: currentMessage }];
        } else {
          input = currentMessage;
        }

        // Detect $<skill-name> references (Claude skills) and inject skill input items
        var availableSkills = discoverClaudeSkills(queryOpts.cwd);
        var skillItemsToInject = [];
        var injected = {};
        for (var ii = 0; ii < input.length; ii++) {
          if (input[ii].type === "text" && input[ii].text) {
            var parsed = parseSkillRefs(input[ii].text, availableSkills);
            for (var si = 0; si < parsed.skills.length; si++) {
              if (!injected[parsed.skills[si].name]) {
                injected[parsed.skills[si].name] = true;
                skillItemsToInject.push({ type: "skill", name: parsed.skills[si].name, path: parsed.skills[si].path });
              }
            }
          }
        }
        if (skillItemsToInject.length > 0) {
          console.log("[yoke/codex] injecting Claude skills:", skillItemsToInject.map(function(s) { return s.name; }).join(", "));
          input = input.concat(skillItemsToInject);
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
      console.log("[yoke/codex] handle.abort() called, threadId=" + state.threadId + " already aborted=" + state.aborted);
      state.aborted = true;
      // Send turn/interrupt to stop the server-side turn
      if (state.threadId && appServer.started) {
        appServer.send("turn/interrupt", { threadId: state.threadId }, 5000).catch(function() {});
      }
      // End iterator immediately. sdk-bridge's post-loop code checks
      // session.taskStopRequested and sends the interrupted message + done.
      // This matches Claude's abort pattern.
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

  // Listen for external abort (sdk-bridge's stopTask calls session.abortController.abort())
  if (abortController && abortController.signal) {
    abortController.signal.addEventListener("abort", function() {
      if (!state.aborted) handle.abort();
    }, { once: true });
  }

  return handle;
}

// --- Adapter factory ---

function createCodexAdapter(opts) {
  var _cwd = (opts && opts.cwd) || process.cwd();
  var _slug = (opts && opts.slug) || "";
  var _defaultInitOpts = Object.assign({}, opts || {});
  var _cachedModels = [];
  var _appServer = null;
  var _initPromise = null;
  var _shutdownPromise = null;
  var _refCount = 0;
  var _lastActiveAt = Date.now();
  var _shuttingDown = false;
  var _activeQueries = [];

  function updateLastActiveAt() {
    _lastActiveAt = Date.now();
  }

  function registerActiveQuery(entry) {
    _activeQueries.push(entry);
  }

  function removeActiveQuery(entry) {
    var next = [];
    for (var i = 0; i < _activeQueries.length; i++) {
      if (_activeQueries[i] !== entry) next.push(_activeQueries[i]);
    }
    _activeQueries = next;
  }

  function decrementRefCount() {
    if (_refCount > 0) {
      _refCount--;
    } else {
      console.error("[yoke/codex] refCount negative, bug!");
      _refCount = 0;
    }
    updateLastActiveAt();
  }

  function buildReadyResponse(skillNames) {
    return {
      models: _cachedModels,
      defaultModel: "gpt-5.4",
      skills: skillNames || [],
      slashCommands: skillNames || [],
      fastModeState: null,
      capabilities: {
        thinking: true,
        betas: false,
        rewind: false,
        sessionResume: true,
        promptSuggestions: true,
        elicitation: true,
        fileCheckpointing: false,
        contextCompacting: false,
        toolPolicy: ["ask", "allow-all"],
      },
    };
  }

  function clearRuntimeState() {
    _appServer = null;
    _initPromise = null;
    _cachedModels = [];
    _refCount = 0;
    _activeQueries = [];
    updateLastActiveAt();
  }

  function waitForRefCount(targetCount, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 5000);
    return new Promise(function(resolve) {
      function tick() {
        if (_refCount <= targetCount) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(tick, 50);
      }
      tick();
    });
  }

  function stopAppServer(deadlineMs) {
    var proc = _appServer && _appServer.proc ? _appServer.proc : null;
    if (!_appServer) return Promise.resolve(true);
    try {
      _appServer.stop();
    } catch (e) {
      console.error("[yoke/codex] App-server stop error:", e.message || e);
    }
    if (!proc) return Promise.resolve(true);
    var remaining = (typeof deadlineMs === "number") ? Math.max(0, deadlineMs - Date.now()) : 5000;
    return waitForProcessExit(proc, remaining).then(function(exited) {
      if (!exited) {
        try {
          proc.kill("SIGKILL");
        } catch (e) {}
      }
      return exited;
    });
  }

  function beginShutdown(force, idleMs) {
    if (_shutdownPromise) return _shutdownPromise;
    if (_shuttingDown) return null;

    _shuttingDown = true;

    _shutdownPromise = (async function() {
      var deadline = Date.now() + 5000;
      var shouldAbort = !!force;

      if (_initPromise) {
        try {
          await Promise.race([
            _initPromise.catch(function() { return null; }),
            waitMs(Math.max(0, deadline - Date.now())),
          ]);
        } catch (e) {}
      }

      if (shouldAbort && _activeQueries.length > 0) {
        var active = _activeQueries.slice();
        for (var i = 0; i < active.length; i++) {
          try {
            if (active[i] && active[i].abort) active[i].abort();
          } catch (e) {}
        }
        await waitForRefCount(0, Math.max(0, deadline - Date.now()));
      }

      if (_appServer) {
        await stopAppServer(deadline);
      }

      clearRuntimeState();
      _shuttingDown = false;
      _shutdownPromise = null;
      return true;
    })().catch(function(err) {
      clearRuntimeState();
      _shuttingDown = false;
      _shutdownPromise = null;
      throw err;
    });

    return _shutdownPromise;
  }

  var adapter = {
    vendor: "codex",

    init: function(initOpts) {
      if (_shuttingDown) {
        return Promise.reject(createShutdownError());
      }

      var effectiveInitOpts = Object.assign({}, _defaultInitOpts, initOpts || {});

      // Already initialized - return cached result
      if (_appServer && _appServer.started && _cachedModels.length > 0) {
        return Promise.resolve(buildReadyResponse([]));
      }

      // Deduplicate concurrent init calls
      if (_initPromise) return _initPromise;

      _initPromise = (async function() {
        var serverOpts = { cwd: _cwd };

        // Extract adapter options
        if (effectiveInitOpts && effectiveInitOpts.adapterOptions && effectiveInitOpts.adapterOptions.CODEX) {
          var co = effectiveInitOpts.adapterOptions.CODEX;
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
        var clayPort = effectiveInitOpts.clayPort || process.env.CLAY_PORT || 2633;
        var clayTls = effectiveInitOpts.clayTls || false;
        var clayAuthToken = effectiveInitOpts.clayAuthToken || "";
        var claySlug = effectiveInitOpts.slug || _slug || "";
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

        if (_shuttingDown) {
          await stopAppServer(Date.now() + 1000);
          throw createShutdownError();
        }

        console.log("[codex] App-server initialized, models: gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2");

        _cachedModels = [
          "gpt-5.4",
          "gpt-5.4-mini",
          "gpt-5.3-codex",
          "gpt-5.3-codex-spark",
          "gpt-5.2",
        ];

        // Discover skills: built-in Codex skills + Claude skills
        var skillNames = [];
        try {
          var REAL_HOME;
          try { REAL_HOME = require("../../config").REAL_HOME; } catch (e) { REAL_HOME = require("os").homedir(); }
          var claudeSkillsDir = require("path").join(REAL_HOME, ".claude", "skills");
          var extraRoots = _cwd ? [{ cwd: _cwd, extraUserRoots: [claudeSkillsDir] }] : [];
          var skillsResult = await _appServer.send("skills/list", {
            cwds: _cwd ? [_cwd] : [],
            forceReload: true,
            perCwdExtraUserRoots: extraRoots,
          }, 10000).catch(function(e) {
            console.error("[codex] skills/list failed:", e.message);
            return null;
          });
          // Response shape: { data: [{ cwd, skills: [{ name, ... }] }] }
          if (skillsResult && skillsResult.data) {
            for (var di = 0; di < skillsResult.data.length; di++) {
              var entry = skillsResult.data[di];
              if (!entry.skills) continue;
              for (var sk = 0; sk < entry.skills.length; sk++) {
                if (entry.skills[sk].name && skillNames.indexOf(entry.skills[sk].name) === -1) {
                  skillNames.push(entry.skills[sk].name);
                }
              }
            }
          }
          // Also discover Claude skills directly as fallback
          var claudeSkills = discoverClaudeSkills(_cwd);
          var claudeSkillNames = Object.keys(claudeSkills);
          for (var csn = 0; csn < claudeSkillNames.length; csn++) {
            if (skillNames.indexOf(claudeSkillNames[csn]) === -1) skillNames.push(claudeSkillNames[csn]);
          }
          console.log("[codex] Discovered skills:", skillNames.length, "(" + skillNames.slice(0, 5).join(", ") + (skillNames.length > 5 ? "..." : "") + ")");
        } catch (e) {
          console.error("[codex] Failed to discover skills:", e.message);
        }

        if (_shuttingDown) {
          await stopAppServer(Date.now() + 1000);
          throw createShutdownError();
        }

        _initPromise = null;
        updateLastActiveAt();

        return buildReadyResponse(skillNames);
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
      if (_shuttingDown) {
        throw createShutdownError();
      }

      if (!_appServer || !_appServer.started) {
        await adapter.init(queryOpts || {});
      }

      if (_shuttingDown) {
        throw createShutdownError();
      }

      if (!_appServer || !_appServer.started) {
        throw new Error("[yoke/codex] Adapter not initialized. Call init() first.");
      }

      var model = queryOpts.model || "gpt-5.4";
      var ac = queryOpts.abortController || new AbortController();
      var activeEntry = {
        abort: function() {
          try {
            ac.abort();
          } catch (e) {}
        },
      };

      // Map YOKE options to Codex thread options
      var codexOpts = (queryOpts.adapterOptions && queryOpts.adapterOptions.CODEX) || {};

      var handleOpts = {
        model: model,
        cwd: queryOpts.cwd || _cwd,
        systemPrompt: queryOpts.systemPrompt || "",
        abortController: ac,
        canUseTool: queryOpts.canUseTool || null,
        onElicitation: queryOpts.onElicitation || null,
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

      _refCount++;
      registerActiveQuery(activeEntry);

      var handle;
      try {
        handleOpts.onFinished = function() {
          removeActiveQuery(activeEntry);
          decrementRefCount();
        };
        handle = createCodexQueryHandle(_appServer, handleOpts);
      } catch (e) {
        removeActiveQuery(activeEntry);
        decrementRefCount();
        throw e;
      }

      activeEntry.handle = handle;
      activeEntry.abort = function() {
        try {
          if (handle && typeof handle.abort === "function") {
            handle.abort();
          } else {
            ac.abort();
          }
        } catch (e) {}
      };

      return handle;
    },

    // --- Title generation ---
    generateTitle: async function(messages, opts) {
      var systemPrompt = "You are a title generator. Output only a short title (3-8 words). No quotes, no punctuation at the end, no explanation.";
      var prompt = "Below is a conversation between a user and an AI assistant. Generate a short, descriptive title (3-8 words) that captures the main topic. Reply with ONLY the title, nothing else.\n\n";
      for (var i = 0; i < messages.length; i++) {
        prompt += "User message " + (i + 1) + ": " + messages[i] + "\n";
      }
      var ac = new AbortController();
      var handle = await adapter.createQuery({
        cwd: (opts && opts.cwd) || _cwd,
        systemPrompt: systemPrompt,
        model: "gpt-5.4-mini",
        abortController: ac,
        canUseTool: function() { return Promise.resolve({ behavior: "deny", message: "No tools." }); },
      });
      handle.pushMessage(prompt);
      var title = "";
      var streamed = false;
      try {
        for await (var msg of handle) {
          if (msg.yokeType === "text_delta" && msg.text) {
            streamed = true;
            title += msg.text;
          } else if (msg.yokeType === "message" && msg.messageRole === "assistant" && !streamed && msg.content) {
            var content = msg.content;
            if (Array.isArray(content)) {
              for (var ci = 0; ci < content.length; ci++) {
                if (content[ci].type === "text" && content[ci].text) {
                  title += content[ci].text;
                }
              }
            }
          } else if (msg.yokeType === "result") {
            break;
          }
        }
      } finally {
        handle.close();
      }
      return title.replace(/[\r\n]+/g, " ").replace(/^["'\s]+|["'\s.]+$/g, "").trim();
    },

    // Codex has session persistence via thread IDs
    getSessionInfo: function(sessionId) {
      return Promise.resolve(null);
    },
    listSessions: function() { return Promise.resolve([]); },
    renameSession: function() { return Promise.resolve(); },
    forkSession: function(threadId, opts) {
      if (!_appServer || !_appServer.started) return Promise.resolve(null);
      return _appServer.send("thread/fork", { threadId: threadId }, 30000).then(function(result) {
        var newThreadId = (result && result.thread) ? result.thread.id : null;
        if (!newThreadId) throw new Error("thread/fork did not return a new thread id");
        return { sessionId: newThreadId };
      });
    },
    rollbackThread: function(threadId, numTurns) {
      if (!_appServer || !_appServer.started) return Promise.resolve(null);
      return _appServer.send("thread/rollback", { threadId: threadId, numTurns: numTurns }, 30000);
    },

    // Shutdown the app-server process
    shutdown: function() {
      return beginShutdown(true);
    },

    shutdownIfIdle: function(idleMs) {
      if (_shuttingDown || _shutdownPromise) return Promise.resolve(false);
      if (_initPromise) return Promise.resolve(false);
      if (!_appServer) return Promise.resolve(false);
      if (_refCount > 0) return Promise.resolve(false);
      if (Date.now() - _lastActiveAt < (idleMs || 0)) return Promise.resolve(false);
      return beginShutdown(false).then(function() {
        console.log("[yoke/codex] Reclaimed idle adapter for project " + (_slug || _cwd));
        return true;
      });
    },
  };

  return adapter;
}

module.exports = {
  createCodexAdapter: createCodexAdapter,
};
