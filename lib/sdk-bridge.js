const crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var os = require("os");
var net = require("net");
var { execSync, spawn } = require("child_process");
var { resolveOsUserInfo } = require("./os-users");
var usersModule = require("./users");

// Split shell command on operators (&&, ||, ;, |) while respecting quotes
// and parentheses. Returns array of command segments.
function splitShellSegments(cmd) {
  var segments = [];
  var current = "";
  var inSingle = false;
  var inDouble = false;
  var parenDepth = 0;
  var i = 0;
  while (i < cmd.length) {
    var ch = cmd[i];

    // Handle escape
    if (ch === "\\" && i + 1 < cmd.length && !inSingle) {
      current += ch + cmd[i + 1];
      i += 2;
      continue;
    }

    // Quote tracking
    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; i++; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; i++; continue; }

    // Inside quotes: no splitting
    if (inSingle || inDouble) { current += ch; i++; continue; }

    // Parentheses/subshell tracking
    if (ch === "(" || ch === "$" && i + 1 < cmd.length && cmd[i + 1] === "(") {
      parenDepth++;
      current += ch;
      i++;
      continue;
    }
    if (ch === ")" && parenDepth > 0) {
      parenDepth--;
      current += ch;
      i++;
      continue;
    }

    // Inside subshell: no splitting
    if (parenDepth > 0) { current += ch; i++; continue; }

    // Check for operators: &&, ||, ;, |
    if (ch === "&" && i + 1 < cmd.length && cmd[i + 1] === "&") {
      segments.push(current);
      current = "";
      i += 2;
      continue;
    }
    if (ch === "|" && i + 1 < cmd.length && cmd[i + 1] === "|") {
      segments.push(current);
      current = "";
      i += 2;
      continue;
    }
    if (ch === "|") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (ch === ";") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }
  if (current) segments.push(current);
  return segments;
}

// Async message queue for streaming input to SDK
function createMessageQueue() {
  var queue = [];
  var waiting = null;
  var ended = false;
  return {
    push: function(msg) {
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
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise(function(resolve) {
            waiting = resolve;
          });
        },
      };
    },
  };
}

function createSDKBridge(opts) {
  var cwd = opts.cwd;
  var slug = opts.slug || "";
  var sm = opts.sessionManager;   // session manager instance
  var send = opts.send;           // broadcast to all clients
  var pushModule = opts.pushModule;
  var getSDK = opts.getSDK;
  var mateDisplayName = opts.mateDisplayName || "";
  var isMate = opts.isMate || (slug.indexOf("mate-") === 0);
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var onProcessingChanged = opts.onProcessingChanged || function () {};
  var onTurnDone = opts.onTurnDone || null;

  // --- Skill discovery helpers ---

  function discoverSkillDirs() {
    var skills = {};
    var dirs = [
      path.join(require("./config").REAL_HOME, ".claude", "skills"),
      path.join(cwd, ".claude", "skills"),
    ];
    for (var d = 0; d < dirs.length; d++) {
      var base = dirs[d];
      var entries;
      try {
        entries = fs.readdirSync(base, { withFileTypes: true });
      } catch (e) {
        continue; // directory doesn't exist
      }
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        var skillDir = path.join(base, entry.name);
        var skillMd = path.join(skillDir, "SKILL.md");
        try {
          fs.accessSync(skillMd, fs.constants.R_OK);
          // project skills override global skills with same name
          skills[entry.name] = skillDir;
        } catch (e) {
          // no SKILL.md, skip
        }
      }
    }
    return skills;
  }

  function mergeSkills(sdkSkills, fsSkills) {
    var merged = new Set();
    if (Array.isArray(sdkSkills)) {
      for (var i = 0; i < sdkSkills.length; i++) {
        merged.add(sdkSkills[i]);
      }
    }
    var fsNames = Object.keys(fsSkills);
    for (var i = 0; i < fsNames.length; i++) {
      merged.add(fsNames[i]);
    }
    return merged;
  }

  function sendAndRecord(session, obj) {
    sm.sendAndRecord(session, obj);
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
          try { input = JSON.parse(block.inputJson); } catch {}
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
      session.isProcessing = false;
      session.rateLimitResetsAt = null; // clear on success
      onProcessingChanged();
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
      // Detect "Not logged in · Please run /login" from SDK.
      // This is a short canned response with zero cost, not actual AI output.
      var previewTrimmed = (session.responsePreview || "").trim();
      var isZeroCost = !parsed.total_cost_usd || parsed.total_cost_usd === 0;
      var isLoginPrompt = isZeroCost && previewTrimmed.length < 100
        && /not logged in/i.test(previewTrimmed) && /\/login/i.test(previewTrimmed);
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

  // --- Sub-agent message processing ---

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
    // user messages with parent_tool_use_id contain tool_results — skip silently
  }

  // --- MCP elicitation ---

  function handleElicitation(session, request, opts) {
    // Ralph Loop: auto-reject elicitation in autonomous mode
    if (session.loop && session.loop.active && session.loop.role !== "crafting") {
      return Promise.resolve({ action: "reject" });
    }

    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      if (!session.pendingElicitations) session.pendingElicitations = {};
      session.pendingElicitations[requestId] = {
        resolve: resolve,
        request: request,
      };
      sendAndRecord(session, {
        type: "elicitation_request",
        requestId: requestId,
        serverName: request.serverName,
        message: request.message,
        mode: request.mode || "form",
        url: request.url || null,
        elicitationId: request.elicitationId || null,
        requestedSchema: request.requestedSchema || null,
      });

      if (pushModule) {
        pushModule.sendPush({
          type: "elicitation",
          slug: slug,
          title: (request.serverName || "MCP Server") + " needs input",
          body: request.message || "Waiting for your response",
          tag: "claude-elicitation",
        });
      }

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          delete session.pendingElicitations[requestId];
          resolve({ action: "reject" });
        });
      }
    });
  }

  // --- Worker process management (OS-level multi-user) ---

  var WORKER_SCRIPT = path.join(__dirname, "sdk-worker.js");

  // Ensure the package directory tree is world-readable so OS-level users
  // can access the worker script and its dependencies (the install path
  // may be under /root/.npm/_npx/ which defaults to 700)
  (function ensurePackageReadable() {
    try {
      // Walk up from __dirname to find the package root (where node_modules lives)
      var pkgDir = path.join(__dirname, "..");
      // Open read+execute on each ancestor directory up to and including the
      // npx cache entry so that non-root users can traverse the path
      var dir = pkgDir;
      var dirs = [];
      while (dir !== path.dirname(dir)) {
        dirs.push(dir);
        dir = path.dirname(dir);
      }
      // Open o+rx on each ancestor so non-root users can traverse the path
      // (e.g. /root/.npm/_npx/.../node_modules/clay-server needs /root to be o+x)
      for (var di = 0; di < dirs.length; di++) {
        try {
          var st = fs.statSync(dirs[di]);
          // Add o+x (traverse) to all ancestors, o+rx to npm cache dirs
          var isNpmDir = dirs[di].indexOf(".npm") !== -1 || dirs[di].indexOf("node_modules") !== -1;
          var needed = isNpmDir ? 0o005 : 0o001; // rx for npm dirs, just x for ancestors like /root
          if ((st.mode & needed) !== needed) {
            fs.chmodSync(dirs[di], st.mode | needed);
          }
        } catch (e) {}
      }
      // Recursively make the package AND hoisted dependencies readable.
      // npm/npx may hoist deps (e.g. @anthropic-ai/claude-agent-sdk) to the
      // parent node_modules/ instead of inside clay-server/node_modules/.
      var { execSync: chmodExec } = require("child_process");
      // Find the top-level node_modules that contains clay-server
      var topNodeModules = path.join(pkgDir, "..");
      if (path.basename(topNodeModules) === "node_modules") {
        chmodExec("chmod -R o+rX " + JSON.stringify(topNodeModules), { stdio: "ignore", timeout: 15000 });
      } else {
        chmodExec("chmod -R o+rX " + JSON.stringify(pkgDir), { stdio: "ignore", timeout: 5000 });
      }
    } catch (e) {}
  })();

  // resolveLinuxUser delegates to shared os-users utility
  function resolveLinuxUser(username) {
    return resolveOsUserInfo(username);
  }

  /**
   * Spawn an SDK worker process running as the given Linux user.
   * Returns a worker handle with send/kill/event methods.
   */
  function spawnWorker(linuxUser) {
    var userInfo = resolveLinuxUser(linuxUser);
    var socketId = crypto.randomUUID();
    var socketPath = path.join(os.tmpdir(), "clay-worker-" + socketId + ".sock");

    var worker = {
      process: null,
      connection: null,
      socketPath: socketPath,
      server: null,
      messageHandlers: [],
      ready: false,
      readyPromise: null,
      _readyResolve: null,
      buffer: "",
    };

    worker.readyPromise = new Promise(function(resolve) {
      worker._readyResolve = resolve;
    });

    // Resolves when the worker process actually exits.
    // Used to prevent spawning a new worker before the old one finishes
    // flushing SDK session state to disk (race condition on resume).
    worker.exitPromise = new Promise(function(resolve) {
      worker._exitResolve = resolve;
    });

    // Create Unix socket server
    var spawnT0 = Date.now();
    worker.server = net.createServer(function(connection) {
      console.log("[PERF] spawnWorker: socket connection accepted +" + (Date.now() - spawnT0) + "ms");
      worker.connection = connection;
      connection.on("data", function(chunk) {
        worker.buffer += chunk.toString();
        var lines = worker.buffer.split("\n");
        worker.buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          try {
            var msg = JSON.parse(lines[i]);
            if (msg.type === "ready") {
              console.log("[PERF] spawnWorker: 'ready' IPC received +" + (Date.now() - spawnT0) + "ms");
              worker.ready = true;
              if (worker._readyResolve) {
                worker._readyResolve();
                worker._readyResolve = null;
              }
            }
            for (var h = 0; h < worker.messageHandlers.length; h++) {
              worker.messageHandlers[h](msg);
            }
          } catch (e) {
            console.error("[sdk-bridge] Failed to parse worker message:", e.message);
          }
        }
      });
      connection.on("error", function(err) {
        console.error("[sdk-bridge] Worker connection error:", err.message);
      });
    });

    worker.server.listen(socketPath, function() {
      console.log("[PERF] spawnWorker: socket listen ready +" + (Date.now() - spawnT0) + "ms");
      // Set socket permissions so the target user can connect
      try { fs.chmodSync(socketPath, 0o777); } catch (e) {}

      // Spawn worker process as the target Linux user.
      // Build a minimal, isolated env (no daemon env leakage).
      var workerEnv = require("./build-user-env").buildUserEnv({
        uid: userInfo.uid,
        gid: userInfo.gid,
        home: userInfo.home,
        user: linuxUser,
        shell: userInfo.shell || "/bin/bash",
      });

      console.log("[sdk-bridge] Spawning worker: uid=" + userInfo.uid + " gid=" + userInfo.gid + " cwd=" + cwd + " socket=" + socketPath);
      console.log("[sdk-bridge] Worker script: " + WORKER_SCRIPT);
      console.log("[sdk-bridge] Node: " + process.execPath);
      worker.process = spawn(process.execPath, [WORKER_SCRIPT, socketPath], {
        uid: userInfo.uid,
        gid: userInfo.gid,
        env: workerEnv,
        cwd: cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      worker.process.stdout.on("data", function(data) {
        console.log("[sdk-worker:" + linuxUser + "] " + data.toString().trim());
      });
      worker._stderrBuf = "";
      worker.process.stderr.on("data", function(data) {
        var text = data.toString().trim();
        worker._stderrBuf += text + "\n";
        console.error("[sdk-worker:" + linuxUser + "] " + text);
      });

      worker.process.on("exit", function(code, signal) {
        console.log("[sdk-bridge] Worker for " + linuxUser + " exited (code=" + code + ", signal=" + signal + ")" + (worker._stderrBuf ? " stderr: " + worker._stderrBuf.trim() : ""));
        // Reject readyPromise if worker dies before becoming ready
        if (!worker.ready && worker._readyResolve) {
          worker._readyResolve = null;
          // Let the readyPromise hang; the query_error handler will clean up
        }
        // Notify message handlers about unexpected exit so sessions don't hang.
        // Always dispatch a fallback query_error. The handler is idempotent:
        // it checks isProcessing before taking action, and cleanupSessionWorker
        // guards against stale workers. This covers all exit cases including
        // signal kills (code=null) and normal exits where the IPC query_error
        // was lost due to connection timing.
        console.log("[sdk-bridge] Exit handler: pid=" + (worker.process ? worker.process.pid : "?") + " ready=" + worker.ready + " _queryEnded=" + worker._queryEnded + " _abortSent=" + worker._abortSent + " handlers=" + worker.messageHandlers.length);
        if (code === 0 && !worker.ready) {
          // Worker exited cleanly before sending "ready"
          for (var h = 0; h < worker.messageHandlers.length; h++) {
            worker.messageHandlers[h]({
              type: "query_error",
              error: "Worker exited before ready (code=0). stderr: " + (worker._stderrBuf || "(none)"),
              exitCode: 0,
              stderr: worker._stderrBuf || null,
            });
          }
        } else if (code !== 0 || code === null || signal) {
          // Worker crashed, was killed by signal, or exited abnormally
          var stderrText = worker._stderrBuf || "";
          var exitReason = signal
            ? "Worker killed by " + signal
            : (stderrText || "Worker exited with code " + code);
          for (var h = 0; h < worker.messageHandlers.length; h++) {
            worker.messageHandlers[h]({
              type: "query_error",
              error: exitReason,
              exitCode: code,
              stderr: stderrText || null,
            });
          }
        } else if (worker.messageHandlers.length > 0) {
          // Normal exit (code=0, ready=true). Dispatch fallback in case the
          // IPC query_done/query_error was lost (e.g. connection closed early).
          var fallbackMsg = worker._abortSent
            ? "Worker aborted"
            : "Worker exited before query completed";
          for (var h = 0; h < worker.messageHandlers.length; h++) {
            worker.messageHandlers[h]({
              type: "query_error",
              error: fallbackMsg,
              exitCode: 0,
              stderr: worker._stderrBuf || null,
              _fallback: true,
            });
          }
        }
        cleanupWorker(worker);
        if (worker._exitResolve) {
          worker._exitResolve();
          worker._exitResolve = null;
        }
      });
    });

    worker.send = function(msg) {
      if (!worker.connection || worker.connection.destroyed) return;
      try {
        worker.connection.write(JSON.stringify(msg) + "\n");
      } catch (e) {
        console.error("[sdk-bridge] Failed to send to worker:", e.message);
      }
    };

    worker.onMessage = function(handler) {
      worker.messageHandlers.push(handler);
    };

    worker.kill = function() {
      console.log("[sdk-bridge] worker.kill() called, pid=" + (worker.process ? worker.process.pid : "?") + " stack=" + new Error().stack.split("\n").slice(1, 4).join(" | "));
      worker.send({ type: "shutdown" });
      // Force kill after 5 seconds if still alive (gives SDK time to save session)
      setTimeout(function() {
        if (worker.process && !worker.process.killed) {
          try { worker.process.kill("SIGKILL"); } catch (e) {}
        }
      }, 5000);
      // Don't call cleanupWorker here. Let the exit handler do it after
      // the worker has had time to save SDK session state to disk.
      // Closing the connection prematurely causes the worker to exit
      // before the SDK can flush its session file, leading to "no
      // conversation found" errors on resume (OS multi-user mode).
    };

    return worker;
  }

  function cleanupWorker(worker) {
    console.log("[sdk-bridge] cleanupWorker() called, pid=" + (worker.process ? worker.process.pid : "?") + " stack=" + new Error().stack.split("\n").slice(1, 4).join(" | "));
    if (worker._abortTimeout) { clearTimeout(worker._abortTimeout); worker._abortTimeout = null; }
    if (worker.connection && !worker.connection.destroyed) {
      try { worker.connection.end(); } catch (e) {}
    }
    if (worker.server) {
      try { worker.server.close(); } catch (e) {}
    }
    // Remove socket file
    try { fs.unlinkSync(worker.socketPath); } catch (e) {}
    worker.ready = false;
  }

  /**
   * Start a query via a worker process running as the target Linux user.
   * Mirrors the in-process startQuery flow but delegates SDK execution to the worker.
   */
  async function startQueryViaWorker(session, text, images, linuxUser) {
    var t0 = session._queryStartTs || Date.now();
    function perf(label) { console.log("[PERF] sdk-bridge: " + label + " +" + (Date.now() - t0) + "ms"); }
    perf("startQueryViaWorker entered");

    // Wait for the previous worker to fully exit before spawning a new one.
    // Without this, the new worker may try to resume the SDK session file
    // while the old worker is still flushing it to disk (800ms grace period),
    // causing "no conversation found" and losing all prior context.
    if (session._workerExitPromise) {
      perf("waiting for old worker exit");
      var exitWait = session._workerExitPromise;
      session._workerExitPromise = null;
      await Promise.race([
        exitWait,
        new Promise(function(resolve) { setTimeout(resolve, 3000); }),
      ]);
      perf("old worker exit wait done");
    }

    // Reuse existing worker if alive, otherwise spawn a new one.
    // Spawn FIRST so the worker starts booting while we do dir setup below.
    var worker;
    var reusingWorker = false;
    if (session.worker && session.worker.ready && session.worker.process && !session.worker.process.killed) {
      worker = session.worker;
      reusingWorker = true;
      // Clear old message handlers so they don't fire for the new query
      worker.messageHandlers = [];
      worker._queryEnded = false;
      worker._abortSent = false;
      perf("reusing existing worker pid=" + (worker.process ? worker.process.pid : "?"));
    } else {
      try {
        perf("spawning new worker");
        worker = spawnWorker(linuxUser);
        perf("spawnWorker returned");
        session.worker = worker;
      } catch (e) {
        session.isProcessing = false;
        onProcessingChanged();
        sendAndRecord(session, { type: "error", text: "Failed to spawn worker for " + linuxUser + ": " + (e.message || e) });
        sendAndRecord(session, { type: "done", code: 1 });
        sm.broadcastSessionList();
        return;
      }
    }

    // Ensure the linux user's .claude project directory exists and is writable,
    // then pre-copy CLI session file if needed. This runs while the worker is
    // booting (readyPromise pending), so it adds no extra latency.
    perf("dir setup start");
    if (linuxUser) {
      try {
        var configMod = require("./config");
        var osUsersMod = require("./os-users");
        var originalHome = configMod.REAL_HOME || require("os").homedir();
        var linuxUserHome = osUsersMod.getLinuxUserHome(linuxUser);
        var uid = osUsersMod.getLinuxUserUid(linuxUser);
        if (originalHome !== linuxUserHome && uid != null) {
          var projectSlug = (cwd || "").replace(/\//g, "-");
          var dstDir = path.join(linuxUserHome, ".claude", "projects", projectSlug);
          // Create and chown the project directory once
          if (!fs.existsSync(dstDir)) {
            fs.mkdirSync(dstDir, { recursive: true });
            try { require("child_process").execSync("chown -R " + uid + " " + JSON.stringify(path.join(linuxUserHome, ".claude"))); } catch (e2) {}
          } else {
            try {
              var dirStat = fs.statSync(dstDir);
              if (dirStat.uid !== uid) {
                require("child_process").execSync("chown " + uid + " " + JSON.stringify(dstDir));
              }
            } catch (e2) {}
          }
          // Pre-copy CLI session file so the worker can resume the conversation
          if (session.cliSessionId) {
            var sessionFileName = session.cliSessionId + ".jsonl";
            var srcFile = path.join(originalHome, ".claude", "projects", projectSlug, sessionFileName);
            var dstFile = path.join(dstDir, sessionFileName);
            if (fs.existsSync(srcFile) && !fs.existsSync(dstFile)) {
              fs.copyFileSync(srcFile, dstFile);
              try { require("child_process").execSync("chown " + uid + " " + JSON.stringify(dstFile)); } catch (e2) {}
              console.log("[sdk-bridge] Pre-copied CLI session " + session.cliSessionId + " to " + linuxUser);
            }
          }
        }
      } catch (copyErr) {
        console.log("[sdk-bridge] Dir setup / session pre-copy skipped:", copyErr.message);
      }
    }
    perf("dir setup done");

    session.messageQueue = "worker"; // sentinel: messages go via worker IPC
    session.blocks = {};
    session.sentToolResults = {};
    session.activeTaskToolIds = {};
    session.pendingElicitations = {};
    session.streamedText = false;
    session.responsePreview = "";
    session.abortController = { abort: function() {
      console.log("[sdk-bridge] ABORT sent to worker pid=" + (worker.process ? worker.process.pid : "?"));
      worker._abortSent = true;
      try { worker.send({ type: "abort" }); } catch (e) {}
      // If the worker doesn't finish within 5s (e.g. subagent stuck), force-kill it.
      // The worker exit handler will dispatch a fallback query_error and send done.
      if (worker._abortTimeout) clearTimeout(worker._abortTimeout);
      worker._abortTimeout = setTimeout(function() {
        if (worker.process && !worker.process.killed && session.isProcessing) {
          console.log("[sdk-bridge] Abort timeout: force-killing worker pid=" + (worker.process ? worker.process.pid : "?"));
          try { worker.process.kill("SIGKILL"); } catch (e) {}
        }
      }, 5000);
    } };

    // Build initial user message content
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }

    var initialMessage = {
      type: "user",
      message: { role: "user", content: content },
    };

    // Build serializable query options (no callbacks, no AbortController)
    var queryOptions = {
      cwd: cwd,
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      enableFileCheckpointing: true,
      extraArgs: { "replay-user-messages": null },
      promptSuggestions: true,
      agentProgressSummaries: true,
    };

    if (sm.currentModel) queryOptions.model = sm.currentModel;
    if (sm.currentEffort) queryOptions.effort = sm.currentEffort;
    if (sm.currentBetas && sm.currentBetas.length > 0) queryOptions.betas = sm.currentBetas;
    if (sm.currentThinking === "disabled") {
      queryOptions.thinking = { type: "disabled" };
    } else if (sm.currentThinking === "budget" && sm.currentThinkingBudget) {
      queryOptions.thinking = { type: "enabled", budgetTokens: sm.currentThinkingBudget };
    }

    if (dangerouslySkipPermissions) {
      queryOptions.allowDangerouslySkipPermissions = true;
    }
    var modeToApply = session.acceptEditsAfterStart ? "acceptEdits" : sm.currentPermissionMode;
    if (session.acceptEditsAfterStart) delete session.acceptEditsAfterStart;
    if (modeToApply && modeToApply !== "default") {
      queryOptions.permissionMode = modeToApply;
    }

    if (session.cliSessionId) {
      queryOptions.resume = session.cliSessionId;
      if (session.lastRewindUuid) {
        queryOptions.resumeSessionAt = session.lastRewindUuid;
        delete session.lastRewindUuid;
        // Persist the deletion so server restarts don't re-use a stale UUID
        sm.saveSessionFile(session);
      }
    }

    // Set up message handler for worker events
    var firstEventLogged = false;
    worker.onMessage(function(msg) {
      if (!firstEventLogged && msg.type === "sdk_event") {
        firstEventLogged = true;
        perf("FIRST sdk_event received (type=" + (msg.event && msg.event.type || "?") + ")");
      }
      switch (msg.type) {
        case "sdk_event":
          processSDKMessage(session, msg.event);
          break;

        case "permission_request":
          handleCanUseTool(session, msg.toolName, msg.input, {
            toolUseID: msg.toolUseId,
            decisionReason: msg.decisionReason,
            signal: session.abortController ? { addEventListener: function() {} } : undefined,
          }).then(function(result) {
            worker.send({ type: "permission_response", requestId: msg.requestId, result: result });
          }).catch(function(e) {
            console.error("[sdk-bridge] permission_response send failed:", e.message || e);
          });
          break;

        case "ask_user_request":
          // Delegate to the daemon's AskUserQuestion handling
          handleCanUseTool(session, "AskUserQuestion", msg.input, {
            toolUseID: msg.toolUseId,
            signal: session.abortController ? { addEventListener: function() {} } : undefined,
          }).then(function(result) {
            worker.send({ type: "ask_user_response", toolUseId: msg.toolUseId, result: result });
          }).catch(function(e) {
            console.error("[sdk-bridge] ask_user_response send failed:", e.message || e);
          });
          break;

        case "elicitation_request":
          handleElicitation(session, {
            serverName: msg.serverName,
            message: msg.message,
            mode: msg.mode,
            url: msg.url,
            elicitationId: msg.elicitationId,
            requestedSchema: msg.requestedSchema,
          }, {
            signal: session.abortController ? { addEventListener: function() {} } : undefined,
          }).then(function(result) {
            worker.send({ type: "elicitation_response", requestId: msg.requestId, result: result });
          }).catch(function(e) {
            console.error("[sdk-bridge] elicitation_response send failed:", e.message || e);
          });
          break;

        case "query_done":
          console.log("[sdk-bridge] IPC query_done received, pid=" + (worker.process ? worker.process.pid : "?"));
          // Mark that we received a proper IPC completion, so the exit
          // handler fallback knows not to double-process.
          worker._queryEnded = true;
          // Stream ended normally
          if (session.isProcessing && session.taskStopRequested) {
            session.isProcessing = false;
            onProcessingChanged();
            sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
            sendAndRecord(session, { type: "done", code: 0 });
            sm.broadcastSessionList();
          }
          cleanupSessionWorker(session, worker);
          if (session.onQueryComplete) {
            try { session.onQueryComplete(session); } catch (err) {
              console.error("[sdk-bridge] onQueryComplete error:", err.message || err);
            }
          }
          break;

        case "query_error": {
          console.log("[sdk-bridge] IPC query_error received, pid=" + (worker.process ? worker.process.pid : "?") + " _fallback=" + !!msg._fallback + " _queryEnded=" + worker._queryEnded + " error=" + (msg.error || "").substring(0, 100));
          // Skip fallback errors from exit handler if we already handled the real one
          if (msg._fallback && worker._queryEnded) break;
          // Mark that we received a proper IPC completion
          worker._queryEnded = true;
          // Check session-not-found before isProcessing gate (it can arrive after processing is cleared)
          var qerrLower = (msg.error || "").toLowerCase();
          // Only match the exact SDK error, not generic worker stderr
          var isSessionNotFound = qerrLower.indexOf("no conversation found with session id") !== -1;
          if (isSessionNotFound) {
            // Clear stale cliSessionId so next message starts a fresh
            // conversation in the same UI session.
            session.cliSessionId = null;
          }
          if (session.isProcessing) {
            session.isProcessing = false;
            onProcessingChanged();
            var isAbort = (msg.error && (msg.error.indexOf("AbortError") !== -1 || msg.error.indexOf("aborted") !== -1))
              || session.taskStopRequested;
            if (isAbort) {
              if (!session.destroying) {
                sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
                sendAndRecord(session, { type: "done", code: 0 });
              }
            } else if (session.destroying) {
              console.log("[sdk-bridge] Suppressing worker error during shutdown for session " + session.localId);
            } else {
              var errDetail = msg.error || "Unknown error";
              if (msg.stderr) errDetail += "\nstderr: " + msg.stderr;
              if (msg.exitCode != null) errDetail += " (exitCode: " + msg.exitCode + ")";
              console.error("[sdk-bridge] Worker query error for session " + session.localId + ":", errDetail);

              var errLower = errDetail.toLowerCase();
              var isContextOverflow = errLower.indexOf("prompt is too long") !== -1
                || errLower.indexOf("context_length") !== -1
                || errLower.indexOf("maximum context length") !== -1;
              var isAuthError = errLower.indexOf("not logged in") !== -1
                || errLower.indexOf("unauthenticated") !== -1
                || errLower.indexOf("authentication") !== -1
                || errLower.indexOf("sign in") !== -1
                || errLower.indexOf("log in") !== -1
                || errLower.indexOf("please login") !== -1;
              if (isContextOverflow) {
                sendAndRecord(session, { type: "context_overflow", text: "Conversation too long to continue." });
              } else if (isAuthError) {
                var authUser = session.ownerId ? usersModule.findUserById(session.ownerId) : null;
                var authLinuxUser = authUser && authUser.linuxUser ? authUser.linuxUser : null;
                // Determine if auto-login (auto terminal + claude) is safe:
                // - Single-user mode: always ok
                // - Multi-user + OS user isolation (linuxUser set): ok (isolated)
                // - Multi-user + admin role: ok (they own the shared account)
                // - Multi-user + regular user (no linuxUser): not ok (shared account)
                var canAutoLogin = !usersModule.isMultiUser()
                  || !!authLinuxUser
                  || (authUser && authUser.role === "admin");
                sendAndRecord(session, {
                  type: "auth_required",
                  text: "Claude Code is not logged in.",
                  linuxUser: authLinuxUser,
                  canAutoLogin: canAutoLogin,
                });
              } else {
                var errText = msg.error || "Unknown error";
                // When stderr is empty, fall back to worker stderr buffer (covers hook failures at session start)
                if (!msg.stderr && worker._stderrBuf) {
                  errText += "\n" + worker._stderrBuf.trim();
                }
                sendAndRecord(session, { type: "error", text: "Claude process error: " + errText });
              }
              sendAndRecord(session, { type: "done", code: 1 });
              if (pushModule) {
                pushModule.sendPush({
                  type: "error",
                  slug: slug,
                  title: (mateDisplayName || "Claude") + ": Connection Lost",
                  body: (mateDisplayName || "Claude") + " process disconnected: " + (msg.error || "unknown error"),
                  tag: "claude-error",
                });
              }
            }
            sm.broadcastSessionList();
          }
          cleanupSessionWorker(session, worker);
          // Auto-continue on rate limit (scheduler sessions, or user setting)
          var workerDidScheduleAC = false;
          var workerACEnabled = session.onQueryComplete || (typeof opts.getAutoContinueSetting === "function" && opts.getAutoContinueSetting(session));
          if (session.rateLimitResetsAt && session.rateLimitResetsAt > Date.now()
              && workerACEnabled && !session.destroying) {
            var wacResetsAt = session.rateLimitResetsAt;
            session.rateLimitResetsAt = null;
            session.rateLimitAutoContinuePending = true;
            workerDidScheduleAC = true;
            console.log("[sdk-bridge] Rate limited (worker), scheduling auto-continue via scheduleMessage for session " + session.localId);
            if (typeof opts.scheduleMessage === "function") {
              opts.scheduleMessage(session, "continue", wacResetsAt);
            }
          }
          if (session.onQueryComplete && !workerDidScheduleAC) {
            try { session.onQueryComplete(session); } catch (err) {
              console.error("[sdk-bridge] onQueryComplete error:", err.message || err);
            }
          }
          break;
        }

        case "model_changed":
          sm.currentModel = msg.model;
          send({ type: "model_info", model: msg.model, models: sm.availableModels || [] });
          send({ type: "config_state", model: sm.currentModel, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
          break;

        case "effort_changed":
          sm.currentEffort = msg.effort;
          send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
          break;

        case "permission_mode_changed":
          sm.currentPermissionMode = msg.mode;
          send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
          break;

        case "worker_error":
          send({ type: "error", text: msg.error });
          break;
      }
    });

    // Wait for worker to be ready, then send query
    if (!reusingWorker) {
      perf("awaiting readyPromise");
      try {
        await worker.readyPromise;
        perf("readyPromise resolved");
      } catch (e) {
        session.isProcessing = false;
        onProcessingChanged();
        sendAndRecord(session, { type: "error", text: "Worker failed to connect: " + (e.message || e) });
        sendAndRecord(session, { type: "done", code: 1 });
        sm.broadcastSessionList();
        killSessionWorker(session);
        return;
      }
    }

    perf("sending query_start to worker");
    worker.send({
      type: "query_start",
      prompt: initialMessage,
      options: queryOptions,
      singleTurn: !!session.singleTurn,
      originalHome: require("./config").REAL_HOME || null,
      projectPath: session.cwd || null,
      _perfT0: t0,
    });
    perf("query_start sent");
  }

  function cleanupSessionWorker(session, fromWorker) {
    console.log("[sdk-bridge] cleanupSessionWorker() called, localId=" + session.localId +
      " fromWorkerPid=" + (fromWorker && fromWorker.process ? fromWorker.process.pid : "none") +
      " currentWorkerPid=" + (session.worker && session.worker.process ? session.worker.process.pid : "none") +
      " stack=" + new Error().stack.split("\n").slice(1, 4).join(" | "));
    // If called from a specific worker's exit/error handler, only cleanup if
    // that worker is still the session's current worker. Prevents stale
    // worker exit events from killing a newer worker.
    if (fromWorker && session.worker && session.worker !== fromWorker) {
      console.log("[sdk-bridge] cleanupSessionWorker: stale worker guard triggered, skipping");
      return;
    }
    session.queryInstance = null;
    session.messageQueue = null;
    session.abortController = null;
    session.taskStopRequested = false;
    session.pendingPermissions = {};
    session.pendingAskUser = {};
    session.pendingElicitations = {};
    // Keep the worker alive between queries so the SDK can maintain session
    // state in memory. Killing the worker after each query forces resume from
    // disk, but the SDK may not save the session file on abort, causing
    // "no conversation found" and losing all conversation history.
    // The worker is only killed when the UI session is destroyed or on error.
  }

  // Force-kill the worker and remove it from the session.
  // Used when the session is destroyed or on unrecoverable errors.
  function killSessionWorker(session) {
    if (session.worker) {
      session._workerExitPromise = session.worker.exitPromise;
      session.worker.kill();
      session.worker = null;
    }
  }

  /**
   * Run warmup via a worker process for a specific Linux user.
   */
  async function warmupViaWorker(linuxUser) {
    var worker;
    try {
      worker = spawnWorker(linuxUser);
    } catch (e) {
      send({ type: "error", text: "Failed to spawn warmup worker for " + linuxUser + ": " + (e.message || e) });
      return;
    }

    var warmupDone = false;

    worker.onMessage(function(msg) {
      if (msg.type === "warmup_done" && !warmupDone) {
        warmupDone = true;
        var result = msg.result || {};
        var fsSkills = discoverSkillDirs();
        sm.skillNames = mergeSkills(result.skills, fsSkills);
        if (result.slashCommands) {
          var seen = new Set();
          var combined = [];
          var all = result.slashCommands.concat(Array.from(sm.skillNames));
          for (var k = 0; k < all.length; k++) {
            if (!seen.has(all[k])) {
              seen.add(all[k]);
              combined.push(all[k]);
            }
          }
          sm.slashCommands = combined;
          send({ type: "slash_commands", commands: sm.slashCommands });
        }
        if (result.model) {
          sm.currentModel = sm._savedDefaultModel || result.model;
        }
        sm.availableModels = result.models || [];
        send({ type: "model_info", model: sm.currentModel || "", models: sm.availableModels || [] });
        worker.kill();
      } else if (msg.type === "warmup_error" && !warmupDone) {
        warmupDone = true;
        send({ type: "error", text: msg.error || "Warmup failed" });
        worker.kill();
      }
    });

    try {
      await worker.readyPromise;
    } catch (e) {
      send({ type: "error", text: "Warmup worker failed to connect: " + (e.message || e) });
      cleanupWorker(worker);
      return;
    }

    var warmupOptions = { cwd: cwd, settingSources: ["user", "project", "local"] };
    if (dangerouslySkipPermissions) {
      warmupOptions.permissionMode = "bypassPermissions";
      warmupOptions.allowDangerouslySkipPermissions = true;
    }
    worker.send({ type: "warmup", options: warmupOptions });
  }

  // --- SDK query lifecycle ---

  function handleCanUseTool(session, toolName, input, opts) {
    // Ralph Loop execution: auto-approve all tools, deny interactive ones.
    // Crafting sessions are interactive — user and Claude collaborate to build PROMPT.md / JUDGE.md.
    if (session.loop && session.loop.active && session.loop.role !== "crafting") {
      if (toolName === "AskUserQuestion") {
        return Promise.resolve({ behavior: "deny", message: "Autonomous mode. Make your own decision." });
      }
      if (toolName === "EnterPlanMode") {
        return Promise.resolve({ behavior: "deny", message: "Do not enter plan mode. Execute directly." });
      }
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // Auto-approve read-only tools for ALL sessions.
    // These tools only inspect files and fetch data — no side effects.
    var readOnlyTools = { Read: true, Glob: true, Grep: true, WebFetch: true, WebSearch: true };
    if (readOnlyTools[toolName]) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // Auto-approve safe Bash commands (read-only, non-destructive)
    // Applies to ALL sessions (mates and regular projects alike).
    // These are purely read-only commands that cannot modify files, install
    // packages, or change system state. Functionally equivalent to the
    // Read/Glob/Grep built-in tools which are already auto-approved.
    if (toolName === "Bash" && input && input.command) {
      var cmd = input.command.trim();
      var safeBashCommands = {
        // Navigation (harmless on its own, checked in compound commands below)
        cd: true, pushd: true, popd: true,
        // File/dir inspection
        ls: true, cat: true, head: true, tail: true, wc: true, file: true,
        stat: true, find: true, tree: true, du: true, df: true,
        readlink: true, realpath: true, basename: true, dirname: true,
        // Search
        grep: true, rg: true, ag: true, ack: true, fgrep: true, egrep: true,
        // Lookup
        which: true, type: true, whereis: true, command: true, hash: true,
        // Environment/system info
        echo: true, printf: true, env: true, printenv: true, pwd: true,
        whoami: true, id: true, groups: true,
        date: true, uname: true, hostname: true, uptime: true, arch: true,
        nproc: true, free: true, lsb_release: true, sw_vers: true,
        locale: true, timedatectl: true,
        // Version checks (--version only, but first-word check is sufficient
        // since these never take destructive subcommands as first arg)
        git: true, node: true, npm: true, npx: true, python: true, python3: true, pip: true,
        dotnet: true, ruby: true, java: true, javac: true,
        rustc: true, cargo: true, gcc: true, clang: true, cmake: true,
        go: true, deno: true, bun: true,
        // Text processing (pure stdin/stdout, no side effects)
        jq: true, yq: true, sort: true, uniq: true, cut: true, tr: true,
        awk: true, sed: true, paste: true, column: true, fold: true,
        rev: true, tac: true, nl: true, expand: true, unexpand: true,
        fmt: true, pr: true, csplit: true, comm: true, join: true,
        // Comparison/hashing
        diff: true, cmp: true, md5sum: true, sha256sum: true, sha1sum: true,
        shasum: true, cksum: true, sum: true, b2sum: true, base64: true,
        xxd: true, od: true, hexdump: true,
        // Misc read-only
        test: true, true: true, false: true, seq: true, yes: true,
        sleep: true, tee: true, xargs: true, time: true,
        man: true, help: true, info: true, apropos: true,
        cal: true, bc: true, expr: true, factor: true,
        lsof: true, ps: true, top: true, htop: true, pgrep: true,
        netstat: true, ss: true, ifconfig: true, ip: true, dig: true,
        nslookup: true, host: true, ping: true, traceroute: true,
        curl: true, wget: true, http: true,
      };
      // Split compound commands on operators (&&, ||, ;, |) while respecting
      // quoted strings and subshells so that e.g. grep -E "(a|b)" is not split
      var segments = splitShellSegments(cmd);
      var allSafe = true;
      for (var si = 0; si < segments.length; si++) {
        var seg = segments[si].trim();
        if (!seg) continue;
        // Strip leading env assignments (FOO=bar cmd) and sudo
        var firstWord = seg.replace(/^(?:\w+=\S*\s+)*/, "").split(/\s/)[0];
        if (firstWord === "sudo") {
          firstWord = seg.replace(/^(?:\w+=\S*\s+)*sudo\s+(?:-\S+\s+)*/, "").split(/\s/)[0];
        }
        if (!safeBashCommands[firstWord]) { allSafe = false; break; }
      }
      if (allSafe) {
        return Promise.resolve({ behavior: "allow", updatedInput: input });
      }
    }

    // AskUserQuestion: wait for user answers via WebSocket
    if (toolName === "AskUserQuestion") {
      return new Promise(function(resolve) {
        session.pendingAskUser[opts.toolUseID] = {
          resolve: resolve,
          input: input,
        };
        if (opts.signal) {
          opts.signal.addEventListener("abort", function() {
            delete session.pendingAskUser[opts.toolUseID];
            sendAndRecord(session, { type: "ask_user_answered", toolId: opts.toolUseID });
            resolve({ behavior: "deny", message: "Cancelled" });
          });
        }
      });
    }

    // Auto-approve if tool was previously allowed for session
    if (session.allowedTools && session.allowedTools[toolName]) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // Regular tool permission request: send to client and wait
    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      session.pendingPermissions[requestId] = {
        resolve: resolve,
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
      };

      var permMsg = {
        type: "permission_request",
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
      };
      sendAndRecord(session, permMsg);
      onProcessingChanged(); // update cross-project permission badge

      if (pushModule) {
        pushModule.sendPush({
          type: "permission_request",
          slug: slug,
          requestId: requestId,
          title: permissionPushTitle(toolName, input),
          body: permissionPushBody(toolName, input),
        });
      }

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          delete session.pendingPermissions[requestId];
          sendAndRecord(session, { type: "permission_cancel", requestId: requestId });
          onProcessingChanged(); // update cross-project permission badge
          resolve({ behavior: "deny", message: "Request cancelled" });
        });
      }
    });
  }

  /**
   * Detect running Claude Code CLI processes that may conflict with our SDK queries.
   * Only returns processes whose cwd matches our project directory.
   * Returns an array of { pid, command } for each conflicting process found.
   */
  function findConflictingClaude() {
    try {
      var output = execSync("ps ax -o pid,command 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      var lines = output.trim().split("\n");
      var candidates = [];
      for (var i = 1; i < lines.length; i++) { // skip header
        var line = lines[i].trim();
        var m = line.match(/^(\d+)\s+(.+)/);
        if (!m) continue;
        var pid = parseInt(m[1], 10);
        var cmd = m[2];
        // Skip our own process
        if (pid === process.pid) continue;
        // Skip node processes (our daemon, dev watchers, etc.)
        if (/\bnode\b/.test(cmd.split(/\s/)[0])) continue;
        // Match actual claude binary (e.g. /Users/x/.claude/local/claude, /usr/local/bin/claude)
        if (/\/claude(\s|$)/.test(cmd) || /^claude(\s|$)/.test(cmd)) {
          candidates.push({ pid: pid, command: cmd.substring(0, 200) });
        }
      }

      // Filter to only processes whose cwd matches our project
      var results = [];
      for (var j = 0; j < candidates.length; j++) {
        var c = candidates[j];
        try {
          // Use /proc/<pid>/cwd symlink (always available on Linux, no lsof dependency)
          var procCwd = fs.readlinkSync("/proc/" + c.pid + "/cwd");
          if (procCwd === cwd) {
            results.push(c);
          }
        } catch (e) {
          // /proc read failed — include as candidate anyway (conservative)
          results.push(c);
        }
      }
      return results;
    } catch (e) {
      return [];
    }
  }

  /**
   * Verify that a PID is actually a claude binary process (not arbitrary).
   */
  function isClaudeProcess(pid) {
    try {
      var output = execSync("ps -p " + pid + " -o command= 2>/dev/null", { encoding: "utf8", timeout: 3000 }).trim();
      return /\/claude(\s|$)/.test(output) || /^claude(\s|$)/.test(output);
    } catch (e) {
      return false;
    }
  }

  async function processQueryStream(session) {
    // Capture references at start so we only clean up OUR resources in finally,
    // not resources from a newer query that may have been created after an abort.
    var myQueryInstance = session.queryInstance;
    var myMessageQueue = session.messageQueue;
    var myAbortController = session.abortController;
    try {
      for await (var msg of myQueryInstance) {
        processSDKMessage(session, msg);
      }
      // Stream ended normally after a task stop — no "result" message was sent,
      // so the session is still marked as processing. Send interrupted feedback.
      if (session.isProcessing && session.taskStopRequested) {
        session.isProcessing = false;
        onProcessingChanged();
        sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
        sendAndRecord(session, { type: "done", code: 0 });
        sm.broadcastSessionList();
      }
    } catch (err) {
      if (session.isProcessing) {
        session.isProcessing = false;
        onProcessingChanged();
        if (err.name === "AbortError" || (myAbortController && myAbortController.signal.aborted) || session.taskStopRequested) {
          if (!session.destroying) {
            sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
            sendAndRecord(session, { type: "done", code: 0 });
          }
        } else if (session.destroying) {
          // Suppress error messages during shutdown
          console.log("[sdk-bridge] Suppressing stream error during shutdown for session " + session.localId);
        } else {
          var errDetail = err.message || String(err);
          if (err.stderr) errDetail += "\nstderr: " + err.stderr;
          if (err.exitCode != null) errDetail += " (exitCode: " + err.exitCode + ")";
          console.error("[sdk-bridge] Query stream error for session " + session.localId + ":", errDetail);
          console.error("[sdk-bridge] Stack:", err.stack || "(no stack)");

          // Check for conflicting Claude processes only on exit code 1
          var isExitCode1 = err.exitCode === 1 || (err.message && err.message.indexOf("exited with code 1") !== -1);
          var conflicts = isExitCode1 ? findConflictingClaude() : [];
          if (conflicts.length > 0) {
            console.error("[sdk-bridge] Found " + conflicts.length + " conflicting Claude process(es):", conflicts.map(function(c) { return "PID " + c.pid; }).join(", "));
            sendAndRecord(session, {
              type: "process_conflict",
              text: "Another Claude Code process is already running in this project.",
              processes: conflicts,
            });
          } else {
            var errLower = errDetail.toLowerCase();
            var isContextOverflow = errLower.indexOf("prompt is too long") !== -1
              || errLower.indexOf("context_length") !== -1
              || errLower.indexOf("maximum context length") !== -1;
            var isAuthError = errLower.indexOf("not logged in") !== -1
              || errLower.indexOf("unauthenticated") !== -1
              || errLower.indexOf("authentication") !== -1
              || errLower.indexOf("sign in") !== -1
              || errLower.indexOf("log in") !== -1
              || errLower.indexOf("please login") !== -1;
            if (isContextOverflow) {
              sendAndRecord(session, {
                type: "context_overflow",
                text: "Conversation too long to continue.",
              });
            } else if (isAuthError) {
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
            } else {
              sendAndRecord(session, { type: "error", text: "Claude process error: " + err.message });
            }
          }
          sendAndRecord(session, { type: "done", code: 1 });
          if (pushModule) {
            pushModule.sendPush({
              type: "error",
              slug: slug,
              title: (mateDisplayName || "Claude") + ": Connection Lost",
              body: (mateDisplayName || "Claude") + " process disconnected: " + (err.message || "unknown error"),
              tag: "claude-error",
            });
          }
        }
        sm.broadcastSessionList();
      }
    } finally {
      // Close the SDK query to terminate the underlying claude child process.
      // Without this, the process stays alive indefinitely (single-user mode).
      // Only clean up if the session still references OUR resources.
      // A rewind + new startQuery may have already replaced these with
      // a newer query — clobbering them would kill the new query.
      if (session.queryInstance === myQueryInstance) {
        try {
          if (typeof session.queryInstance.close === "function") {
            session.queryInstance.close();
          }
        } catch (e) {}
        session.queryInstance = null;
      }
      if (session.messageQueue === myMessageQueue) session.messageQueue = null;
      if (session.abortController === myAbortController) session.abortController = null;
      session.taskStopRequested = false;
      session.pendingPermissions = {};
      session.pendingAskUser = {};
      session.pendingElicitations = {};

      // Auto-continue on rate limit (scheduler sessions, or user setting)
      var didScheduleAutoContinue = false;
      var acEnabled = session.onQueryComplete || (typeof opts.getAutoContinueSetting === "function" && opts.getAutoContinueSetting(session));
      if (session.rateLimitResetsAt && session.rateLimitResetsAt > Date.now()
          && acEnabled && !session.destroying) {
        var acResetsAt = session.rateLimitResetsAt;
        session.rateLimitResetsAt = null;
        session.rateLimitAutoContinuePending = true;
        didScheduleAutoContinue = true;
        console.log("[sdk-bridge] Rate limited, scheduling auto-continue via scheduleMessage for session " + session.localId);
        if (typeof opts.scheduleMessage === "function") {
          opts.scheduleMessage(session, "continue", acResetsAt);
        }
      }

      // Ralph Loop: notify completion so loop orchestrator can proceed
      if (session.onQueryComplete && !didScheduleAutoContinue) {
        console.log("[sdk-bridge] Calling onQueryComplete for session " + session.localId + " (title: " + (session.title || "?") + ")");
        try {
          session.onQueryComplete(session);
        } catch (err) {
          console.error("[sdk-bridge] onQueryComplete error:", err.message || err);
        }
      }
    }
  }

  async function getOrCreateRewindQuery(session) {
    if (session.queryInstance) return { query: session.queryInstance, isTemp: false, cleanup: function() {} };

    var sdk;
    try {
      sdk = await getSDK();
    } catch (e) {
      sendAndRecord(session, { type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      throw e;
    }
    var mq = createMessageQueue();

    var tempQuery = sdk.query({
      prompt: mq,
      options: {
        cwd: cwd,
        settingSources: ["user", "project", "local"],
        enableFileCheckpointing: true,
        resume: session.cliSessionId,
      },
    });

    // Drain messages in background (stream stays alive until mq.end())
    (async function() {
      try { for await (var msg of tempQuery) {} } catch(e) {}
    })();

    return {
      query: tempQuery,
      isTemp: true,
      cleanup: function() { try { mq.end(); } catch(e) {} },
    };
  }

  async function startQuery(session, text, images, linuxUser) {
    // Remember linuxUser for auto-continue after rate limit
    session.lastLinuxUser = linuxUser || null;
    // OS-level isolation: delegate to worker process if linuxUser is set
    if (linuxUser) {
      return startQueryViaWorker(session, text, images, linuxUser);
    }

    var sdk;
    try {
      sdk = await getSDK();
    } catch (e) {
      session.isProcessing = false;
      onProcessingChanged();
      sendAndRecord(session, { type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      return;
    }

    session.messageQueue = createMessageQueue();
    session.blocks = {};
    session.sentToolResults = {};
    session.activeTaskToolIds = {};
    session.pendingElicitations = {};
    session.streamedText = false;
    session.responsePreview = "";

    // Build initial user message
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }

    session.messageQueue.push({
      type: "user",
      message: { role: "user", content: content },
    });

    session.abortController = new AbortController();

    var queryOptions = {
      cwd: cwd,
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      enableFileCheckpointing: true,
      extraArgs: { "replay-user-messages": null },
      abortController: session.abortController,
      promptSuggestions: true,
      agentProgressSummaries: true,
      canUseTool: function(toolName, input, toolOpts) {
        return handleCanUseTool(session, toolName, input, toolOpts);
      },
      onElicitation: function(request, elicitOpts) {
        return handleElicitation(session, request, elicitOpts);
      },
    };

    if (sm.currentModel) {
      queryOptions.model = sm.currentModel;
    }

    if (sm.currentEffort) {
      queryOptions.effort = sm.currentEffort;
    }

    if (sm.currentBetas && sm.currentBetas.length > 0) {
      queryOptions.betas = sm.currentBetas;
    }

    if (sm.currentThinking === "disabled") {
      queryOptions.thinking = { type: "disabled" };
    } else if (sm.currentThinking === "budget" && sm.currentThinkingBudget) {
      queryOptions.thinking = { type: "enabled", budgetTokens: sm.currentThinkingBudget };
    }

    if (dangerouslySkipPermissions) {
      queryOptions.allowDangerouslySkipPermissions = true;
    }
    // Pass permissionMode in queryOptions at creation time to avoid race condition
    var modeToApply = session.acceptEditsAfterStart ? "acceptEdits" : sm.currentPermissionMode;
    if (session.acceptEditsAfterStart) delete session.acceptEditsAfterStart;
    if (modeToApply && modeToApply !== "default") {
      queryOptions.permissionMode = modeToApply;
    }

    if (session.cliSessionId) {
      queryOptions.resume = session.cliSessionId;
      if (session.lastRewindUuid) {
        queryOptions.resumeSessionAt = session.lastRewindUuid;
        delete session.lastRewindUuid;
        // Persist the deletion so server restarts don't re-use a stale UUID
        sm.saveSessionFile(session);
      }
    }

    try {
      session.queryInstance = sdk.query({
        prompt: session.messageQueue,
        options: queryOptions,
      });
    } catch (e) {
      console.error("[sdk-bridge] Failed to create query for session " + session.localId + ":", e.message || e);
      console.error("[sdk-bridge] cliSessionId:", session.cliSessionId, "resume:", !!queryOptions.resume);
      console.error("[sdk-bridge] Stack:", e.stack || "(no stack)");
      session.isProcessing = false;
      onProcessingChanged();
      session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
      sendAndRecord(session, { type: "error", text: "Failed to start query: " + (e.message || e) });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      return;
    }

    // For single-turn sessions (Ralph Loop), end the message queue so the SDK
    // query finishes after processing the one message. Without this, the query
    // stream stays open forever waiting for more messages, and onQueryComplete
    // never fires.
    if (session.singleTurn) {
      session.messageQueue.end();
    }

    session.streamPromise = processQueryStream(session).catch(function(err) {
    });
  }

  function pushMessage(session, text, images) {
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }
    var userMsg = {
      type: "user",
      message: { role: "user", content: content },
    };
    // Route through worker if active, otherwise direct to message queue
    if (session.worker) {
      session.worker.send({ type: "push_message", content: userMsg });
    } else {
      session.messageQueue.push(userMsg);
    }
  }

  function permissionPushTitle(toolName, input) {
    if (!input) return "Claude wants to use " + toolName;
    var file = input.file_path ? input.file_path.split(/[/\\]/).pop() : "";
    switch (toolName) {
      case "Bash": return "Claude wants to run a command";
      case "Edit": return "Claude wants to edit " + (file || "a file");
      case "Write": return "Claude wants to write " + (file || "a file");
      case "Read": return "Claude wants to read " + (file || "a file");
      case "Grep": return "Claude wants to search files";
      case "Glob": return "Claude wants to find files";
      case "WebFetch": return "Claude wants to fetch a URL";
      case "WebSearch": return "Claude wants to search the web";
      case "Task": return "Claude wants to launch an agent";
      default: return "Claude wants to use " + toolName;
    }
  }

  function permissionPushBody(toolName, input) {
    if (!input) return "";
    var text = "";
    if (toolName === "Bash" && input.command) {
      text = input.command;
    } else if (toolName === "Edit" && input.file_path) {
      text = input.file_path.split(/[/\\]/).pop() + ": " + (input.old_string || "").substring(0, 40) + " \u2192 " + (input.new_string || "").substring(0, 40);
    } else if (toolName === "Write" && input.file_path) {
      text = input.file_path;
    } else if (input.file_path) {
      text = input.file_path;
    } else if (input.command) {
      text = input.command;
    } else if (input.url) {
      text = input.url;
    } else if (input.query) {
      text = input.query;
    } else if (input.pattern) {
      text = input.pattern;
    } else if (input.description) {
      text = input.description;
    }
    if (text.length > 120) text = text.substring(0, 120) + "...";
    return text;
  }

  // SDK warmup: grab slash_commands, model, and available models from SDK init
  async function warmup(linuxUser) {
    // OS-level isolation: delegate warmup to worker process
    if (linuxUser) {
      return warmupViaWorker(linuxUser);
    }

    try {
      var sdk = await getSDK();
      var ac = new AbortController();
      var mq = createMessageQueue();
      mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
      mq.end();
      var warmupOptions = { cwd: cwd, settingSources: ["user", "project", "local"], abortController: ac };
      if (dangerouslySkipPermissions) {
        warmupOptions.permissionMode = "bypassPermissions";
        warmupOptions.allowDangerouslySkipPermissions = true;
      }
      var stream = sdk.query({
        prompt: mq,
        options: warmupOptions,
      });
      for await (var msg of stream) {
        if (msg.type === "system" && msg.subtype === "init") {
          var fsSkills = discoverSkillDirs();
          sm.skillNames = mergeSkills(msg.skills, fsSkills);
          if (msg.slash_commands) {
            // Union: SDK slash_commands + merged skills (deduplicated)
            var seen = new Set();
            var combined = [];
            var all = msg.slash_commands.concat(Array.from(sm.skillNames));
            for (var k = 0; k < all.length; k++) {
              if (!seen.has(all[k])) {
                seen.add(all[k]);
                combined.push(all[k]);
              }
            }
            sm.slashCommands = combined;
            send({ type: "slash_commands", commands: sm.slashCommands });
          }
          if (msg.model) {
            sm.currentModel = msg.model;
          }
          // Fetch available models before aborting
          try {
            var models = await stream.supportedModels();
            sm.availableModels = models || [];
          } catch (e) {}
          send({ type: "model_info", model: sm.currentModel || "", models: sm.availableModels || [] });
          ac.abort();
          break;
        }
      }
    } catch (e) {
      if (e && e.name !== "AbortError" && !(e.message && e.message.indexOf("aborted") !== -1)) {
        send({ type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      }
    }
  }

  async function setModel(session, model) {
    if (session.worker) {
      session.worker.send({ type: "set_model", model: model });
      return;
    }
    if (!session.queryInstance) {
      // No active query — just store the model for next startQuery
      sm.currentModel = model;
      send({ type: "model_info", model: model, models: sm.availableModels || [] });
      send({ type: "config_state", model: sm.currentModel, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return;
    }
    try {
      await session.queryInstance.setModel(model);
      sm.currentModel = model;
      send({ type: "model_info", model: model, models: sm.availableModels || [] });
      send({ type: "config_state", model: sm.currentModel, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
    } catch (e) {
      send({ type: "error", text: "Failed to switch model: " + (e.message || e) });
    }
  }

  async function setEffort(session, effort) {
    if (session.worker) {
      session.worker.send({ type: "set_effort", effort: effort });
      return;
    }
    if (!session.queryInstance) {
      sm.currentEffort = effort;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
      return;
    }
    // SDK Query interface has no setEffort method.
    // Store the effort level — it will be applied via queryOptions.effort on the next query.
    sm.currentEffort = effort;
    send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
  }

  async function setPermissionMode(session, mode) {
    if (session.worker) {
      session.worker.send({ type: "set_permission_mode", mode: mode });
      return;
    }
    if (!session.queryInstance) {
      // No active query — just store the mode for next startQuery
      sm.currentPermissionMode = mode;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return;
    }
    try {
      await session.queryInstance.setPermissionMode(mode);
      sm.currentPermissionMode = mode;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
    } catch (e) {
      send({ type: "error", text: "Failed to set permission mode: " + (e.message || e) });
    }
  }

  async function stopTask(taskId) {
    var session = sm.getActiveSession();
    if (!session) return;
    session.taskStopRequested = true;
    if (session.worker) {
      session.worker.send({ type: "stop_task", taskId: taskId });
      return;
    }
    if (!session.queryInstance) return;
    try {
      await session.queryInstance.stopTask(taskId);
    } catch (e) {
      console.error("[sdk-bridge] stopTask error:", e.message);
    }
    // SDK stopTask doesn't reliably stop the sub-agent, so abort the entire
    // session as a fallback to ensure the process actually stops.
    if (session.abortController) {
      session.abortController.abort();
    }
  }

  // --- @Mention: persistent read-only session for a mentioned Mate ---
  // Creates a mention session that can be reused across multiple mentions
  // within a conversation flow (session continuity).
  async function createMentionSession(opts) {
    // opts: { claudeMd, initialContext, initialMessage, onDelta, onDone, onError, onActivity }
    var sdk;
    try {
      sdk = await getSDK();
    } catch (e) {
      opts.onError("Failed to load Claude SDK: " + (e.message || e));
      return null;
    }

    var mq = createMessageQueue();
    var abortController = new AbortController();

    // Current response callbacks (swapped on each pushMessage)
    var currentOnDelta = opts.onDelta;
    var currentOnDone = opts.onDone;
    var currentOnError = opts.onError;
    var currentOnActivity = opts.onActivity || null;
    var responseFullText = "";
    var responseStreamedText = false;
    var mentionBlocks = {};
    var alive = true;

    var query;
    try {
      var mentionQueryOptions = {
          cwd: cwd,
          systemPrompt: opts.claudeMd,
          settingSources: ["user"],
          includePartialMessages: true,
          abortController: abortController,
          canUseTool: opts.canUseTool || function (toolName, input) {
            var allowed = { Read: true, Glob: true, Grep: true, WebFetch: true, WebSearch: true };
            if (allowed[toolName]) {
              return Promise.resolve({ behavior: "allow", updatedInput: input });
            }
            return Promise.resolve({
              behavior: "deny",
              message: "Read-only access. You cannot make changes via @mention.",
            });
          },
        };
      if (opts.model) mentionQueryOptions.model = opts.model;
      query = sdk.query({
        prompt: mq,
        options: mentionQueryOptions,
      });
    } catch (e) {
      opts.onError("Failed to create mention query: " + (e.message || e));
      return null;
    }

    // Push the initial message (context + question, with optional images)
    var initialPrompt = opts.initialContext + "\n\n" + opts.initialMessage;
    var initialContent = [];
    if (opts.initialImages && opts.initialImages.length > 0) {
      for (var ii = 0; ii < opts.initialImages.length; ii++) {
        initialContent.push({
          type: "image",
          source: { type: "base64", media_type: opts.initialImages[ii].mediaType, data: opts.initialImages[ii].data },
        });
      }
    }
    initialContent.push({ type: "text", text: initialPrompt });
    mq.push({
      type: "user",
      message: { role: "user", content: initialContent },
    });

    // Background stream processing loop
    (async function () {
      try {
        for await (var sdkMsg of query) {
          if (sdkMsg.type === "stream_event" && sdkMsg.event) {
            var evt = sdkMsg.event;

            // Track content blocks for activity reporting
            if (evt.type === "content_block_start") {
              var block = evt.content_block;
              var idx = evt.index;
              if (block.type === "thinking") {
                mentionBlocks[idx] = { type: "thinking" };
                if (currentOnActivity) currentOnActivity("thinking");
              } else if (block.type === "tool_use") {
                mentionBlocks[idx] = { type: "tool_use", name: block.name, inputJson: "" };
                var toolLabel = block.name;
                if (toolLabel === "Read") toolLabel = "Reading file...";
                else if (toolLabel === "Grep") toolLabel = "Searching code...";
                else if (toolLabel === "Glob") toolLabel = "Finding files...";
                if (currentOnActivity) currentOnActivity(toolLabel);
              } else if (block.type === "text") {
                mentionBlocks[idx] = { type: "text" };
              }
            }

            if (evt.type === "content_block_delta" && evt.delta) {
              if (evt.delta.type === "text_delta" && typeof evt.delta.text === "string") {
                responseStreamedText = true;
                responseFullText += evt.delta.text;
                if (currentOnActivity) currentOnActivity(null); // clear activity on text
                if (currentOnDelta) currentOnDelta(evt.delta.text);
              } else if (evt.delta.type === "input_json_delta" && mentionBlocks[evt.index]) {
                mentionBlocks[evt.index].inputJson += evt.delta.partial_json;
              }
            }

            if (evt.type === "content_block_stop") {
              var blk = mentionBlocks[evt.index];
              if (blk && blk.type === "tool_use") {
                // Show what file is being read
                var toolInput = {};
                try { toolInput = JSON.parse(blk.inputJson); } catch (e) {}
                if (blk.name === "Read" && toolInput.file_path) {
                  var fname = toolInput.file_path.split(/[/\\]/).pop();
                  if (currentOnActivity) currentOnActivity("Reading " + fname + "...");
                } else if (blk.name === "Grep" && toolInput.pattern) {
                  if (currentOnActivity) currentOnActivity("Searching: " + toolInput.pattern.substring(0, 30) + "...");
                } else if (blk.name === "Glob" && toolInput.pattern) {
                  if (currentOnActivity) currentOnActivity("Finding: " + toolInput.pattern.substring(0, 30) + "...");
                }
              }
              delete mentionBlocks[evt.index];
            }

          } else if (sdkMsg.type === "assistant" && !responseStreamedText && sdkMsg.message && sdkMsg.message.content) {
            // Fallback: if text was not streamed via deltas, extract from assistant message
            var content = sdkMsg.message.content;
            if (Array.isArray(content)) {
              for (var ci = 0; ci < content.length; ci++) {
                if (content[ci].type === "text" && content[ci].text) {
                  responseFullText += content[ci].text;
                  if (currentOnDelta) currentOnDelta(content[ci].text);
                }
              }
            }
          } else if (sdkMsg.type === "result") {
            // One response complete. Signal done and reset for next message.
            if (currentOnActivity) currentOnActivity(null);
            var doneRef = currentOnDone;
            if (doneRef) {
              doneRef(responseFullText);
            }
            // Only reset if pushMessage was not called during onDone
            // (pushMessage swaps callbacks and resets state itself)
            if (currentOnDone === doneRef) {
              currentOnDelta = null;
              currentOnDone = null;
              currentOnError = null;
              currentOnActivity = null;
              mentionBlocks = {};
              responseFullText = "";
              responseStreamedText = false;
            }
          }
        }
      } catch (err) {
        if (currentOnError) {
          if (err.name === "AbortError" || (abortController && abortController.signal.aborted)) {
            currentOnError("Mention query was cancelled.");
          } else {
            currentOnError(err.message || String(err));
          }
        }
      }
      alive = false;
    })();

    return {
      // Push a follow-up message to the existing mention session
      pushMessage: function (text, callbacks, images) {
        currentOnDelta = callbacks.onDelta;
        currentOnDone = callbacks.onDone;
        currentOnError = callbacks.onError;
        currentOnActivity = callbacks.onActivity || null;
        mentionBlocks = {};
        responseFullText = "";
        responseStreamedText = false;
        var content = [];
        if (images && images.length > 0) {
          for (var pi = 0; pi < images.length; pi++) {
            content.push({
              type: "image",
              source: { type: "base64", media_type: images[pi].mediaType, data: images[pi].data },
            });
          }
        }
        content.push({ type: "text", text: text });
        mq.push({
          type: "user",
          message: { role: "user", content: content },
        });
      },
      abort: function () {
        try { abortController.abort(); } catch (e) {}
      },
      close: function () {
        alive = false;
        try { mq.end(); } catch (e) {}
      },
      isAlive: function () { return alive; },
    };
  }

  return {
    createMessageQueue: createMessageQueue,
    processSDKMessage: processSDKMessage,
    handleCanUseTool: handleCanUseTool,
    handleElicitation: handleElicitation,
    processQueryStream: processQueryStream,
    getOrCreateRewindQuery: getOrCreateRewindQuery,
    startQuery: startQuery,
    pushMessage: pushMessage,
    setModel: setModel,
    setEffort: setEffort,
    setPermissionMode: setPermissionMode,
    isClaudeProcess: isClaudeProcess,
    permissionPushTitle: permissionPushTitle,
    permissionPushBody: permissionPushBody,
    warmup: warmup,
    stopTask: stopTask,
    createMentionSession: createMentionSession,
  };
}

module.exports = { createSDKBridge, createMessageQueue };
