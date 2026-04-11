var usersModule = require("./users");

function attachMessageProcessor(ctx) {
  var sm = ctx.sm;
  var send = ctx.send;
  var slug = ctx.slug;
  var isMate = ctx.isMate;
  var mateDisplayName = ctx.mateDisplayName;
  var pushModule = ctx.pushModule;
  var getSDK = ctx.getSDK;
  var onProcessingChanged = ctx.onProcessingChanged;
  var onTurnDone = ctx.onTurnDone;
  var opts = ctx.opts;
  var discoverSkillDirs = ctx.discoverSkillDirs;
  var mergeSkills = ctx.mergeSkills;

  function sendAndRecord(session, obj) {
    sm.sendAndRecord(session, obj);
  }

  function sendToSession(session, obj) {
    sm.sendToSession(session, obj);
  }

  function toolActivityTextForSubagent(name, input) {
    if (name === "Bash" && input && input.description) return input.description;
    if (name === "Read" && input && input.file_path) return "Reading " + input.file_path.split("/").pop();
    if (name === "Edit" && input && input.file_path) return "Editing " + input.file_path.split("/").pop();
    if (name === "Write" && input && input.file_path) return "Writing " + input.file_path.split("/").pop();
    if (name === "Grep" && input && input.pattern) return "Searching for " + input.pattern;
    if (name === "Glob" && input && input.pattern) return "Finding " + input.pattern;
    if (name === "WebSearch" && input && input.query) return "Searching: " + input.query;
    if (name === "WebFetch") return "Fetching URL...";
    if (name === "Task" && input && input.description) return input.description;
    return "Running " + name + "...";
  }

  function processSubagentMessage(session, parsed) {
    var parentId = parsed.parent_tool_use_id;
    var content = parsed.message.content;
    if (!Array.isArray(content)) return;

    if (parsed.type === "assistant") {
      // Extract tool_use blocks from sub-agent assistant messages
      for (var i = 0; i < content.length; i++) {
        var block = content[i];
        if (block.type === "tool_use") {
          var activityText = toolActivityTextForSubagent(block.name, block.input);
          sendAndRecord(session, {
            type: "subagent_tool",
            parentToolId: parentId,
            toolName: block.name,
            toolId: block.id,
            text: activityText,
          });
        } else if (block.type === "thinking") {
          sendAndRecord(session, {
            type: "subagent_activity",
            parentToolId: parentId,
            text: "Thinking...",
          });
        } else if (block.type === "text" && block.text) {
          sendAndRecord(session, {
            type: "subagent_activity",
            parentToolId: parentId,
            text: "Writing response...",
          });
        }
      }
    }
    // user messages with parent_tool_use_id contain tool_results -- skip silently
  }

  function processSDKMessage(session, parsed) {
    // Timing: log key SDK milestones relative to query start
    if (session._queryStartTs) {
      var _elapsed = Date.now() - session._queryStartTs;
      if (parsed.type === "system" && parsed.subtype === "init") {
        console.log("[PERF] processSDKMessage: system/init +" + _elapsed + "ms");
      }
      if (parsed.type === "stream_event" && parsed.event) {
        if (parsed.event.type === "message_start") {
          console.log("[PERF] processSDKMessage: message_start (API response begun) +" + _elapsed + "ms");
        }
        if (parsed.event.type === "content_block_delta" && !session._firstTextLogged) {
          session._firstTextLogged = true;
          console.log("[PERF] processSDKMessage: FIRST content_block_delta (visible text) +" + _elapsed + "ms");
        }
      }
      if (parsed.type === "result") {
        console.log("[PERF] processSDKMessage: result +" + _elapsed + "ms");
      }
    }

    // Extract session_id from any message that carries it
    if (parsed.session_id && !session.cliSessionId) {
      session.cliSessionId = parsed.session_id;
      sm.saveSessionFile(session);
      sendAndRecord(session, { type: "session_id", cliSessionId: session.cliSessionId });
    } else if (parsed.session_id) {
      session.cliSessionId = parsed.session_id;
    }

    // Capture message UUIDs for rewind support
    if (parsed.uuid) {
      if (parsed.type === "user" && !parsed.parent_tool_use_id) {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "user", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "user" });
      } else if (parsed.type === "assistant") {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "assistant", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "assistant" });
      }
    }

    // Cache slash_commands and model from CLI init message
    if (parsed.type === "system" && parsed.subtype === "init") {
      var fsSkills = discoverSkillDirs();
      sm.skillNames = mergeSkills(parsed.skills, fsSkills);
      if (parsed.slash_commands) {
        // Union: SDK slash_commands + merged skills (deduplicated)
        var seen = new Set();
        var combined = [];
        var all = parsed.slash_commands.concat(Array.from(sm.skillNames));
        for (var k = 0; k < all.length; k++) {
          if (!seen.has(all[k])) {
            seen.add(all[k]);
            combined.push(all[k]);
          }
        }
        sm.slashCommands = combined;
        send({ type: "slash_commands", commands: sm.slashCommands });
      }
      if (parsed.model) {
        sm.currentModel = sm._savedDefaultModel || parsed.model;
        send({ type: "model_info", model: sm.currentModel, models: sm.availableModels || [] });
      }
      if (parsed.fast_mode_state) {
        sendAndRecord(session, { type: "fast_mode_state", state: parsed.fast_mode_state });
      }
    }

    if (parsed.type === "stream_event" && parsed.event) {
      var evt = parsed.event;

      if (evt.type === "message_start" && evt.message && evt.message.usage) {
        var u = evt.message.usage;
        session.lastStreamInputTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
      }

      if (evt.type === "content_block_start") {
        var block = evt.content_block;
        var idx = evt.index;

        if (block.type === "tool_use") {
          session.blocks[idx] = { type: "tool_use", id: block.id, name: block.name, inputJson: "" };
          sendAndRecord(session, { type: "tool_start", id: block.id, name: block.name });
        } else if (block.type === "thinking") {
          session.blocks[idx] = { type: "thinking", thinkingText: "", startTime: Date.now() };
          sendAndRecord(session, { type: "thinking_start" });
        } else if (block.type === "text") {
          session.blocks[idx] = { type: "text" };
        }
      }

      if (evt.type === "content_block_delta" && evt.delta) {
        var idx = evt.index;

        if (evt.delta.type === "text_delta" && typeof evt.delta.text === "string") {
          session.streamedText = true;
          if (session.responsePreview.length < 200) {
            session.responsePreview += evt.delta.text;
          }
          // Accumulate text for mate DM response
          if (typeof session._mateDmResponseText === "string") {
            session._mateDmResponseText += evt.delta.text;
          }
          sendAndRecord(session, { type: "delta", text: evt.delta.text });
        } else if (evt.delta.type === "input_json_delta" && session.blocks[idx]) {
          session.blocks[idx].inputJson += evt.delta.partial_json;
        } else if (evt.delta.type === "thinking_delta" && session.blocks[idx]) {
          session.blocks[idx].thinkingText += evt.delta.thinking;
          sendAndRecord(session, { type: "thinking_delta", text: evt.delta.thinking });
        }
      }

      if (evt.type === "content_block_stop") {
        var idx = evt.index;
        var block = session.blocks[idx];

        if (block && block.type === "tool_use") {
          var input = {};
          try { input = JSON.parse(block.inputJson); } catch (e) {}
          sendAndRecord(session, { type: "tool_executing", id: block.id, name: block.name, input: input });

          // Track active Task tools for sub-agent done detection
          if (block.name === "Task") {
            if (!session.activeTaskToolIds) session.activeTaskToolIds = {};
            session.activeTaskToolIds[block.id] = true;
          }

          if (pushModule && block.name === "AskUserQuestion" && input.questions) {
            var q = input.questions[0];
            pushModule.sendPush({
              type: "ask_user",
              slug: slug,
              title: (mateDisplayName || "Claude") + " has a question",
              body: q ? q.question : "Waiting for your response",
              tag: "claude-ask",
            });
          }
        } else if (block && block.type === "thinking") {
          var duration = block.startTime ? (Date.now() - block.startTime) / 1000 : 0;
          sendAndRecord(session, { type: "thinking_stop", duration: duration });
        }

        delete session.blocks[idx];
      }

    } else if ((parsed.type === "assistant" || parsed.type === "user") && parsed.message && parsed.message.content) {
      // Sub-agent messages: extract tool_use blocks for activity display
      if (parsed.parent_tool_use_id) {
        processSubagentMessage(session, parsed);
        return;
      }

      var content = parsed.message.content;

      // Fallback: if assistant text wasn't streamed via deltas, send it now
      if (parsed.type === "assistant" && !session.streamedText && Array.isArray(content)) {
        var assistantText = content
          .filter(function(c) { return c.type === "text"; })
          .map(function(c) { return c.text; })
          .join("");
        if (assistantText) {
          if (session.responsePreview.length < 200) {
            session.responsePreview += assistantText;
          }
          sendAndRecord(session, { type: "delta", text: assistantText });
        }
      }

      // Check for local slash command output in user messages
      if (parsed.type === "user") {
        var fullText = "";
        if (typeof content === "string") {
          fullText = content;
        } else if (Array.isArray(content)) {
          fullText = content
            .filter(function(c) { return c.type === "text"; })
            .map(function(c) { return c.text; })
            .join("\n");
        }
        if (fullText.indexOf("local-command-stdout") !== -1) {
          var m = fullText.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
          if (m) {
            sendAndRecord(session, { type: "slash_command_result", text: m[1].trim() });
          }
        }
      }

      if (Array.isArray(content)) {
        for (var i = 0; i < content.length; i++) {
          var block = content[i];
          if (block.type === "tool_result" && !session.sentToolResults[block.tool_use_id]) {
            // Clear active Task tool when its result arrives
            if (session.activeTaskToolIds && session.activeTaskToolIds[block.tool_use_id]) {
              sendAndRecord(session, {
                type: "subagent_done",
                parentToolId: block.tool_use_id,
              });
              delete session.activeTaskToolIds[block.tool_use_id];
            }
            var resultText = "";
            var resultImages = [];
            if (typeof block.content === "string") {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = block.content
                .filter(function(c) { return c.type === "text"; })
                .map(function(c) { return c.text; })
                .join("\n");
              for (var ri = 0; ri < block.content.length; ri++) {
                var rc = block.content[ri];
                if (rc.type === "image" && rc.source) {
                  resultImages.push({
                    mediaType: rc.source.media_type,
                    data: rc.source.data,
                  });
                }
              }
            }
            session.sentToolResults[block.tool_use_id] = true;
            var toolResultMsg = {
              type: "tool_result",
              id: block.tool_use_id,
              content: resultText,
              is_error: block.is_error || false,
            };
            if (resultImages.length > 0) toolResultMsg.images = resultImages;
            sendAndRecord(session, toolResultMsg);
          }
        }
      }

    } else if (parsed.type === "result") {
      session.blocks = {};
      session.sentToolResults = {};
      session.pendingPermissions = {};
      session.pendingElicitations = {};
      // Record ask_user_answered for any leftover pending questions so replay pairs correctly
      var leftoverAskIds = Object.keys(session.pendingAskUser);
      for (var lai = 0; lai < leftoverAskIds.length; lai++) {
        sendAndRecord(session, { type: "ask_user_answered", toolId: leftoverAskIds[lai] });
      }
      session.pendingAskUser = {};
      session.activeTaskToolIds = {};
      session.taskIdMap = {};
      // Only clear rateLimitResetsAt on genuine success (non-zero cost).
      // When rate-limited, the SDK sends result with zero cost right after
      // rate_limit_event; clearing here would prevent auto-continue scheduling.
      if (parsed.total_cost_usd && parsed.total_cost_usd > 0) {
        session.rateLimitResetsAt = null;
      }
      console.log("[sdk-bridge] result handler: session " + session.localId + " cost=" + parsed.total_cost_usd + " rateLimitResetsAt=" + session.rateLimitResetsAt);

      // Handle SDK execution errors: show the error to the user instead of
      // silently swallowing it. These have subtype "error_during_execution".
      if (parsed.subtype === "error_during_execution") {
        var execErrors = parsed.errors || [];
        var execError = execErrors.length > 0
          ? execErrors.join("; ")
          : "Unknown SDK error";
        if (parsed.terminal_reason) execError += " (reason: " + parsed.terminal_reason + ")";
        console.error("[sdk-bridge] Execution error for session " + session.localId + ": " + execError);
        session.isProcessing = false;
        onProcessingChanged();
        sendAndRecord(session, { type: "error", text: "Claude error: " + execError });
        sendAndRecord(session, { type: "done", code: 1 });
        sm.broadcastSessionList();
        return;
      }

      session.isProcessing = false;
      onProcessingChanged();
      // Detect "Not logged in" scenario early for the check below
      var previewTrimmed = (session.responsePreview || "").trim();
      var isZeroCost = !parsed.total_cost_usd || parsed.total_cost_usd === 0;
      var isLoginPrompt = isZeroCost && previewTrimmed.length < 100
        && /not logged in/i.test(previewTrimmed) && /\/login/i.test(previewTrimmed);
      // Fetch rich context usage breakdown (fire-and-forget, non-blocking)
      if (session.queryInstance && typeof session.queryInstance.getContextUsage === "function") {
        session.queryInstance.getContextUsage().then(function(ctxUsage) {
          session.lastContextUsage = ctxUsage;
          sendToSession(session, { type: "context_usage", data: ctxUsage });
        }).catch(function(e) {
          console.error("[sdk-bridge] getContextUsage failed (non-fatal):", e.message || e);
        });
      }
      var lastStreamInput = session.lastStreamInputTokens || null;
      session.lastStreamInputTokens = null;
      sendAndRecord(session, {
        type: "result",
        cost: parsed.total_cost_usd,
        duration: parsed.duration_ms,
        usage: parsed.usage || null,
        modelUsage: parsed.modelUsage || null,
        sessionId: parsed.session_id,
        lastStreamInputTokens: lastStreamInput,
      });
      if (parsed.fast_mode_state) {
        sendAndRecord(session, { type: "fast_mode_state", state: parsed.fast_mode_state });
      }
      // Detect "Not logged in / Please run /login" from SDK.
      // This is a short canned response with zero cost, not actual AI output.
      if (isLoginPrompt) {
        var authUser = session.ownerId ? usersModule.findUserById(session.ownerId) : null;
        var authLinuxUser = authUser && authUser.linuxUser ? authUser.linuxUser : null;
        var canAutoLogin = !usersModule.isMultiUser()
          || !!authLinuxUser
          || (authUser && authUser.role === "admin");
        sendAndRecord(session, {
          type: "auth_required",
          text: "Claude Code is not logged in.",
          linuxUser: authLinuxUser,
          canAutoLogin: canAutoLogin,
        });
        // Reset CLI session so next query starts fresh with new auth
        session.cliSessionId = null;
      }
      sendAndRecord(session, { type: "done", code: 0 });
      if (pushModule) {
        var preview = (session.responsePreview || "").replace(/\s+/g, " ").trim();
        if (preview.length > 140) preview = preview.substring(0, 140) + "...";
        pushModule.sendPush({
          type: "done",
          slug: slug,
          title: mateDisplayName ? (mateDisplayName + " responded") : (session.title || "Claude"),
          body: preview || "Response ready",
          tag: "claude-done",
        });
      }
      // Reset for next turn in the same query
      session.lastActivityAt = Date.now();
      var donePreview = session.responsePreview || "";
      session.responsePreview = "";
      session.streamedText = false;
      sm.broadcastSessionList();
      if (onTurnDone) {
        try { onTurnDone(session, donePreview); } catch (e) {}
      }

    } else if (parsed.type === "system" && parsed.subtype === "status") {
      if (parsed.status === "compacting") {
        sendAndRecord(session, { type: "compacting", active: true });
      } else if (session.compacting) {
        sendAndRecord(session, { type: "compacting", active: false });
      }
      session.compacting = parsed.status === "compacting";

    } else if (parsed.type === "system" && parsed.subtype === "task_started") {
      var parentId = parsed.tool_use_id;
      if (parentId) {
        if (!session.taskIdMap) session.taskIdMap = {};
        session.taskIdMap[parentId] = parsed.task_id;
        sendAndRecord(session, {
          type: "task_started",
          parentToolId: parentId,
          taskId: parsed.task_id,
          description: parsed.description || "",
        });
      }

    } else if (parsed.type === "system" && parsed.subtype === "task_progress") {
      var parentId = parsed.tool_use_id;
      if (parentId) {
        sendAndRecord(session, {
          type: "task_progress",
          parentToolId: parentId,
          taskId: parsed.task_id,
          usage: parsed.usage || null,
          lastToolName: parsed.last_tool_name || null,
          description: parsed.description || "",
          summary: parsed.summary || null,
        });
      }

    } else if (parsed.type === "tool_progress") {
      // Sub-agent tool_progress: forward as activity update
      var parentId = parsed.parent_tool_use_id;
      if (parentId) {
        sendAndRecord(session, {
          type: "subagent_activity",
          parentToolId: parentId,
          text: parsed.content || "",
        });
      }

    } else if (parsed.type === "task_notification") {
      var parentId = parsed.parent_tool_use_id;
      if (parentId) {
        sendAndRecord(session, {
          type: "subagent_done",
          parentToolId: parentId,
          status: parsed.status || "completed",
          summary: parsed.summary || "",
          usage: parsed.usage || null,
        });
      }
      if (session.taskIdMap) {
        for (var k in session.taskIdMap) {
          if (session.taskIdMap[k] === parsed.task_id) {
            delete session.taskIdMap[k];
            break;
          }
        }
      }

    } else if (parsed.type === "rate_limit_event" && parsed.rate_limit_info) {
      var info = parsed.rate_limit_info;
      console.log("[sdk-bridge] rate_limit_event for session " + session.localId + ": status=" + info.status + " resetsAt=" + info.resetsAt + " isUsingOverage=" + info.isUsingOverage + " isProcessing=" + session.isProcessing);

      // Broadcast reset time for top-bar usage link
      if (info.rateLimitType && info.resetsAt) {
        send({
          type: "rate_limit_usage",
          rateLimitType: info.rateLimitType,
          resetsAt: info.resetsAt * 1000,
          status: info.status,
        });
      }

      // Warning/rejection handling (existing behavior)
      if (info.status === "allowed_warning" || info.status === "rejected") {
        sendAndRecord(session, {
          type: "rate_limit",
          status: info.status,
          resetsAt: info.resetsAt ? info.resetsAt * 1000 : null,
          rateLimitType: info.rateLimitType || null,
          utilization: info.utilization || null,
          isUsingOverage: info.isUsingOverage || false,
        });
        // Track rejection for auto-continue / scheduled message support
        if (info.status === "rejected" && info.resetsAt) {
          session.rateLimitResetsAt = info.resetsAt * 1000;

          // Schedule auto-continue immediately on rejection (don't wait for
          // query completion which has timing issues with worker/non-worker paths).
          if (!session.scheduledMessage && !session.destroying) {
            var acEnabled = session.onQueryComplete ||
              (typeof opts.getAutoContinueSetting === "function" && opts.getAutoContinueSetting(session));
            console.log("[sdk-bridge] rate_limit rejected: acEnabled=" + acEnabled + " overage=" + !!info.isUsingOverage + " session=" + session.localId);
            if (acEnabled) {
              session.rateLimitAutoContinuePending = true;
              if (info.isUsingOverage) {
                // Extra usage available: send continue immediately (5s delay for query to finish)
                console.log("[sdk-bridge] Overage available, sending immediate continue for session " + session.localId);
                session.rateLimitResetsAt = null;
                if (typeof opts.scheduleMessage === "function") {
                  opts.scheduleMessage(session, "continue", Date.now());
                }
              } else {
                // No overage: schedule after rate limit resets
                var acResetsAt = session.rateLimitResetsAt;
                session.rateLimitResetsAt = null;
                console.log("[sdk-bridge] Scheduling auto-continue on rate limit rejection for session " + session.localId);
                if (typeof opts.scheduleMessage === "function") {
                  opts.scheduleMessage(session, "continue", acResetsAt);
                }
              }
            }
          }
        }
      }

    } else if (parsed.type === "prompt_suggestion") {
      sendAndRecord(session, {
        type: "prompt_suggestion",
        suggestion: parsed.suggestion || "",
      });

    } else if (parsed.type === "system") {
      // Catch-all for unhandled system subtypes (e.g. hook-block errors).
      // Extract any error text and surface it in the UI.
      var sysText = parsed.error || parsed.message || parsed.text || "";
      if (!sysText && Array.isArray(parsed.content)) {
        sysText = parsed.content
          .filter(function(c) { return c.type === "text"; })
          .map(function(c) { return c.text; })
          .join("\n");
      }
      if (sysText) {
        console.log("[sdk-bridge] Unhandled system message (subtype=" + (parsed.subtype || "none") + "): " + sysText.substring(0, 200));
        sendAndRecord(session, { type: "error", text: sysText });
      }
    } else if (parsed.type && parsed.type !== "user") {
    }
  }

  return {
    processSDKMessage: processSDKMessage,
    sendAndRecord: sendAndRecord,
    sendToSession: sendToSession,
    processSubagentMessage: processSubagentMessage,
    toolActivityTextForSubagent: toolActivityTextForSubagent,
  };
}

module.exports = { attachMessageProcessor: attachMessageProcessor };
