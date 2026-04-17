const crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var { execSync } = require("child_process");
var usersModule = require("./users");
var { splitShellSegments, attachSkillDiscovery } = require("./sdk-skill-discovery");
var { createMessageQueue } = require("./sdk-message-queue");
var { attachMessageProcessor } = require("./sdk-message-processor");

// Extract serializable tool descriptors from MCP server instances.
// Used for IPC to worker processes (McpSdkServerConfigWithInstance is not serializable).
function extractMcpDescriptors(mcpServers) {
  if (!mcpServers) return null;
  var toJSONSchema;
  try { toJSONSchema = require("zod").toJSONSchema; } catch (e) { return null; }
  var descriptors = [];
  var names = Object.keys(mcpServers);
  for (var i = 0; i < names.length; i++) {
    var serverName = names[i];
    var server = mcpServers[serverName];
    if (!server || !server.instance || !server.instance._registeredTools) continue;
    var tools = [];
    var toolNames = Object.keys(server.instance._registeredTools);
    for (var j = 0; j < toolNames.length; j++) {
      var toolName = toolNames[j];
      var toolDef = server.instance._registeredTools[toolName];
      var inputSchema = { type: "object", properties: {} };
      try {
        if (toolDef.inputSchema) inputSchema = toJSONSchema(toolDef.inputSchema);
      } catch (e) { /* fallback to empty schema */ }
      tools.push({
        name: toolName,
        description: toolDef.description || toolName,
        inputSchema: inputSchema,
      });
    }
    if (tools.length > 0) descriptors.push({ serverName: serverName, tools: tools });
  }
  return descriptors.length > 0 ? descriptors : null;
}

// Call an MCP tool handler by server name and tool name.
// Returns a promise that resolves with the tool result.
function callMcpToolHandler(mcpServers, serverName, toolName, args) {
  if (!mcpServers || !mcpServers[serverName]) {
    return Promise.reject(new Error("MCP server not found: " + serverName));
  }
  var server = mcpServers[serverName];
  if (!server.instance || !server.instance._registeredTools || !server.instance._registeredTools[toolName]) {
    return Promise.reject(new Error("MCP tool not found: " + serverName + "/" + toolName));
  }
  var handler = server.instance._registeredTools[toolName].handler;
  if (typeof handler !== "function") {
    return Promise.reject(new Error("MCP tool handler not a function: " + serverName + "/" + toolName));
  }
  try {
    return Promise.resolve(handler(args));
  } catch (e) {
    return Promise.reject(e);
  }
}

// Merge in-process MCP servers with remote (extension-bridged) MCP servers.
// Returns the merged object, or null if no servers exist.
function mergeMcpServers(localServers, getRemoteFn) {
  var merged = {};
  var hasAny = false;
  if (localServers) {
    var lk = Object.keys(localServers);
    for (var i = 0; i < lk.length; i++) {
      merged[lk[i]] = localServers[lk[i]];
      hasAny = true;
    }
  }
  if (typeof getRemoteFn === "function") {
    var remote = getRemoteFn();
    if (remote) {
      var rk = Object.keys(remote);
      for (var j = 0; j < rk.length; j++) {
        merged[rk[j]] = remote[rk[j]];
        hasAny = true;
      }
    }
  }
  return hasAny ? merged : null;
}

function createSDKBridge(opts) {
  var cwd = opts.cwd;
  var slug = opts.slug || "";
  var sm = opts.sessionManager;   // session manager instance
  var send = opts.send;           // broadcast to all clients
  var pushModule = opts.pushModule;
  var getNotificationsModule = opts.getNotificationsModule || function () { return null; };
  var adapter = opts.adapter;
  var adapters = opts.adapters || {};
  var mateDisplayName = opts.mateDisplayName || "";
  var isMate = opts.isMate || (slug.indexOf("mate-") === 0);
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var mcpServers = opts.mcpServers || null;
  var getRemoteMcpServers = opts.getRemoteMcpServers || null;
  var onProcessingChanged = opts.onProcessingChanged || function () {};
  var onTurnDone = opts.onTurnDone || null;

  // --- Idle session reaper ---
  // In single-user (in-process) mode, each session's Claude child process stays
  // alive between turns because the messageQueue push-stream is never ended.
  // Without a reaper, processes accumulate indefinitely as users switch between
  // sessions and projects. This reaper ends the messageQueue for sessions that
  // have been idle for IDLE_TIMEOUT_MS, allowing processQueryStream's finally
  // block to clean up the child process. Session state on disk is preserved —
  // the next startQuery() call resumes with a fresh process.
  var IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  var IDLE_CHECK_INTERVAL_MS = 60 * 1000; // check every 60 seconds
  var _idleReaperTimer = null;

  function startIdleReaper() {
    if (_idleReaperTimer) return;
    _idleReaperTimer = setInterval(function () {
      var now = Date.now();
      sm.sessions.forEach(function (session) {
        // Skip sessions that are actively processing, have no query,
        // or are single-turn (Ralph Loop — managed by onQueryComplete).
        if (session.isProcessing) return;
        if (!session.queryInstance) return;
        if (session.singleTurn) return;
        if (session.destroying) return;

        var lastActivity = session.lastActivityAt || 0;
        if (now - lastActivity > IDLE_TIMEOUT_MS) {
          console.log("[sdk-bridge] Reaping idle session " + session.localId +
            " (idle " + Math.round((now - lastActivity) / 60000) + "min)" +
            (session.title ? " title=" + JSON.stringify(session.title) : ""));
          // End the query so the for-await loop in processQueryStream
          // exits naturally, triggering the finally block cleanup.
          // Works for both in-process (messageQueue.end) and worker (handle.close) paths.
          if (session.queryInstance && typeof session.queryInstance.close === "function") {
            try { session.queryInstance.close(); } catch (e) {}
          } else if (session.messageQueue && typeof session.messageQueue.end === "function") {
            try { session.messageQueue.end(); } catch (e) {}
          }
        }
      });
    }, IDLE_CHECK_INTERVAL_MS);
    // Don't prevent process exit
    if (_idleReaperTimer.unref) _idleReaperTimer.unref();
  }

  function stopIdleReaper() {
    if (_idleReaperTimer) {
      clearInterval(_idleReaperTimer);
      _idleReaperTimer = null;
    }
  }

  // --- Skill discovery (extracted to sdk-skill-discovery.js) ---
  var skills = attachSkillDiscovery({ cwd: cwd });
  var discoverSkillDirs = skills.discoverSkillDirs;
  var mergeSkills = skills.mergeSkills;

  // --- Message processing (extracted to sdk-message-processor.js) ---
  var msgProcessor = attachMessageProcessor({
    sm: sm,
    send: send,
    slug: slug,
    isMate: isMate,
    mateDisplayName: mateDisplayName,
    pushModule: pushModule,
    getNotificationsModule: getNotificationsModule,
    adapter: adapter,
    onProcessingChanged: onProcessingChanged,
    onTurnDone: onTurnDone,
    opts: opts,
    discoverSkillDirs: discoverSkillDirs,
    mergeSkills: mergeSkills,
  });
  var processSDKMessage = msgProcessor.processSDKMessage;
  var sendAndRecord = msgProcessor.sendAndRecord;
  var sendToSession = msgProcessor.sendToSession;

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


  // --- Linux user project directory setup ---
  // Ensures the linux user's .claude project directory exists and is writable,
  // then pre-copies CLI session file if needed. Called before starting a query
  // so the worker can resume from the correct session file.
  function ensureLinuxUserProjectDir(linuxUser, session) {
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

  // --- SDK query lifecycle ---

  // Check if a tool should be auto-approved based on whitelist rules.
  // Returns { behavior: "allow", updatedInput } if whitelisted, or null if not.
  // Shared by handleCanUseTool and mate mention canUseTool handlers.
  function checkToolWhitelist(toolName, input) {
    // Auto-approve read-only tools for ALL sessions.
    // These tools only inspect files and fetch data — no side effects.
    var readOnlyTools = { Read: true, Glob: true, Grep: true, WebFetch: true, WebSearch: true };
    if (readOnlyTools[toolName]) {
      return { behavior: "allow", updatedInput: input };
    }

    // Auto-approve safe browser MCP tools.
    // Only watch/unwatch: user explicitly chose which tab to share.
    // Everything else (screenshot, read_page, list_tabs, etc.) can expose
    // content from tabs the user didn't intend to share, so require approval.
    var safeBrowserTools = { browser_watch_tab: true, browser_unwatch_tab: true };
    if (toolName.indexOf("mcp__") === 0 && toolName.indexOf("__browser_") !== -1) {
      var mcpToolName = toolName.substring(toolName.lastIndexOf("__") + 2);
      if (safeBrowserTools[mcpToolName]) {
        return { behavior: "allow", updatedInput: input };
      }
    }

    // Auto-approve debate MCP tools (propose_debate).
    // These are user-facing tools that show inline approval cards,
    // so the permission prompt is redundant.
    if (toolName.indexOf("mcp__clay-debate__") === 0) {
      return { behavior: "allow", updatedInput: input };
    }

    // Auto-approve read-only email MCP tools.
    // These only read data from accounts the user explicitly checked.
    // Write operations (send, reply, mark_read) still require permission.
    var safeEmailTools = {
      clay_read_email: true,
      clay_read_email_body: true,
      clay_search_email: true,
      clay_list_labels: true,
    };
    if (toolName.indexOf("mcp__clay-email__") === 0) {
      var emailToolName = toolName.substring(toolName.lastIndexOf("__") + 2);
      if (safeEmailTools[emailToolName]) {
        return { behavior: "allow", updatedInput: input };
      }
    }

    // Auto-approve remote MCP tools that the user explicitly enabled in project settings.
    // These are user-owned local MCP servers, so no additional permission prompt needed.
    if (toolName.indexOf("mcp__") === 0 && getRemoteMcpServers) {
      var _rmcp = getRemoteMcpServers();
      if (_rmcp) {
        var _mcpParts = toolName.split("__");
        var _mcpServerName = _mcpParts.length >= 2 ? _mcpParts[1] : "";
        if (_rmcp[_mcpServerName]) {
          return { behavior: "allow", updatedInput: input };
        }
      }
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
        return { behavior: "allow", updatedInput: input };
      }
    }

    return null; // Not whitelisted
  }

  function handleCanUseTool(session, toolName, input, opts) {
    // Full-auto mode: auto-approve everything except AskUserQuestion
    // (which still needs to go through the user interaction flow).
    if (sm.currentPermissionMode === "bypassPermissions" && toolName !== "AskUserQuestion") {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

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

    // Check shared whitelist (read-only tools, safe browser tools, safe bash commands)
    var whitelisted = checkToolWhitelist(toolName, input);
    if (whitelisted) {
      return Promise.resolve(whitelisted);
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
      sm.permissionRequestIndex[requestId] = session.localId;
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

      var _nm = getNotificationsModule();
      if (_nm) {
        _nm.notify("permission_request", {
          title: permissionPushTitle(toolName, input),
          body: permissionPushBody(toolName, input),
          slug: slug,
          sessionId: session.localId,
          ownerId: session.ownerId || null,
          requestId: requestId,
          toolName: toolName,
          toolInput: input,
        });
      }

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          delete session.pendingPermissions[requestId];
          delete sm.permissionRequestIndex[requestId];
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
    var myAbortController = session.abortController;
    console.log("[sdk-bridge] processQueryStream: starting for-await loop, vendor=" + (session.vendor || adapter.vendor));
    try {
      for await (var msg of myQueryInstance) {
        console.log("[sdk-bridge] processQueryStream: received event yokeType=" + (msg && msg.yokeType) + " type=" + (msg && msg.type) + (msg && msg.text ? " text=" + msg.text.substring(0, 200) : ""));
        // Handle worker meta events (context_usage, model_changed, etc.)
        if (msg && msg.type === "_worker_meta") {
          var metaData = msg.data || {};
          switch (msg.subtype) {
            case "context_usage":
              session.lastContextUsage = metaData.data;
              sendToSession(session, { type: "context_usage", data: metaData.data });
              break;
            case "model_changed":
              sm.currentModel = metaData.model;
              send({ type: "model_info", model: metaData.model, models: sm.availableModels || [], vendor: adapter.vendor });
              send({ type: "config_state", model: sm.currentModel, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
              break;
            case "effort_changed":
              sm.currentEffort = metaData.effort;
              send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
              break;
            case "permission_mode_changed":
              sm.currentPermissionMode = metaData.mode;
              send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
              break;
            case "worker_error":
              send({ type: "error", text: metaData.error });
              break;
          }
          continue;
        }
        processSDKMessage(session, msg);
      }
      // (getContextUsage moved to processSDKMessage result handler -- fire-and-forget)
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
      session.messageQueue = null;
      if (session.abortController === myAbortController) session.abortController = null;
      session.taskStopRequested = false;
      session.pendingPermissions = {};
      session.pendingAskUser = {};
      session.pendingElicitations = {};

      // Auto-continue on rate limit (scheduler sessions, or user setting)
      // Mark session as done processing so the late rate_limit_event handler
      // can detect the race condition and schedule auto-continue itself.
      session.isProcessing = false;

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
      } else if (acEnabled && !session.destroying) {
        // Log why auto-continue was not scheduled (for debugging)
        console.log("[sdk-bridge] Query done, auto-continue enabled but not scheduled: rateLimitResetsAt=" +
          session.rateLimitResetsAt + " (will rely on late rate_limit_event handler)");
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

    var handle;
    try {
      handle = await adapter.createQuery({
        cwd: cwd,
        resumeSessionId: session.cliSessionId,
        adapterOptions: {
          CLAUDE: {
            settingSources: ["user", "project", "local"],
            enableFileCheckpointing: true,
          },
        },
      });
    } catch (e) {
      sendAndRecord(session, { type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      throw e;
    }

    // Drain messages in background (stream stays alive until close)
    (async function() {
      try { for await (var msg of handle) {} } catch(e) {}
    })();

    return {
      query: handle,
      isTemp: true,
      cleanup: function() { try { handle.close(); } catch(e) {} },
    };
  }

  async function startQuery(session, text, images, linuxUser) {
    // Select adapter based on session vendor (fallback to default)
    var sessionAdapter = (session.vendor && adapters[session.vendor]) || adapter;
    console.log("[sdk-bridge] startQuery: vendor=" + sessionAdapter.vendor + " session=" + session.localId + " text=" + (text || "").substring(0, 50));
    // Remember linuxUser for auto-continue after rate limit
    session.lastLinuxUser = linuxUser || null;

    var t0 = session._queryStartTs || Date.now();

    // Wait for previous worker to fully exit before spawning a new one.
    // Without this, the new worker may try to resume the SDK session file
    // while the old worker is still flushing it to disk, causing
    // "no conversation found" and losing all prior context.
    // Harmless if null (no previous worker).
    if (session._workerExitPromise) {
      var exitWait = session._workerExitPromise;
      session._workerExitPromise = null;
      await Promise.race([
        exitWait,
        new Promise(function(resolve) { setTimeout(resolve, 3000); }),
      ]);
    }

    // Ensure Linux user project directory exists (runs in parallel with worker boot)
    if (linuxUser) {
      ensureLinuxUserProjectDir(linuxUser, session);
    }

    session.blocks = {};
    session.sentToolResults = {};
    session.activeTaskToolIds = {};
    session.pendingElicitations = {};
    session.streamedText = false;
    session.responsePreview = "";

    // For in-process path, create AbortController. For worker path, the adapter
    // handles abort internally and exposes it via handle.abort().
    if (!linuxUser) {
      session.abortController = new AbortController();
    }

    // Build Claude-specific adapter options
    var claudeOpts = {
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      enableFileCheckpointing: true,
      extraArgs: { "replay-user-messages": null },
      promptSuggestions: true,
      agentProgressSummaries: true,
    };

    // Per-loop settings override global defaults when present
    var ls = session.loopSettings || {};

    if (sm.currentBetas && sm.currentBetas.length > 0) {
      claudeOpts.betas = sm.currentBetas;
    }
    var thinkingMode = ls.thinking || sm.currentThinking;
    if (thinkingMode === "disabled") {
      claudeOpts.thinking = { type: "disabled" };
    } else if (thinkingMode === "budget") {
      var budgetTokens = ls.thinkingBudget || sm.currentThinkingBudget;
      if (budgetTokens) claudeOpts.thinking = { type: "enabled", budgetTokens: budgetTokens };
    }

    if (ls.permissionMode) {
      session._loopPermissionMode = ls.permissionMode;
    }

    // Pass through any extra SDK settings from LOOP.json
    if (ls.disableAllHooks !== undefined) {
      claudeOpts.settings = Object.assign({}, claudeOpts.settings || {}, { disableAllHooks: ls.disableAllHooks });
    }

    if (dangerouslySkipPermissions) {
      claudeOpts.allowDangerouslySkipPermissions = true;
    }
    var modeToApply = session._loopPermissionMode || (session.acceptEditsAfterStart ? "acceptEdits" : sm.currentPermissionMode);
    if (session.acceptEditsAfterStart) delete session.acceptEditsAfterStart;
    if (modeToApply && modeToApply !== "default") {
      claudeOpts.permissionMode = modeToApply;
    }
    if (session.cliSessionId && session.lastRewindUuid) {
      claudeOpts.resumeSessionAt = session.lastRewindUuid;
      delete session.lastRewindUuid;
      sm.saveSessionFile(session);
    }

    // Pass linuxUser to adapter for worker-based queries
    if (linuxUser) {
      claudeOpts.linuxUser = linuxUser;
      claudeOpts.singleTurn = !!session.singleTurn;
      claudeOpts.originalHome = require("./config").REAL_HOME || null;
      claudeOpts.projectPath = session.cwd || null;
      claudeOpts._perfT0 = t0;
      // Pass previous worker state for reuse
      if (session._adapterWorkerState) {
        claudeOpts._workerState = session._adapterWorkerState;
        session._adapterWorkerState = null;
      }
    }

    // Use vendor-specific model: if session vendor differs from default, use that vendor's default model
    var queryModel = ls.model || sm.currentModel || undefined;
    if (session.vendor && session.vendor !== (adapter && adapter.vendor)) {
      var vendorModels = (sm.modelsByVendor && sm.modelsByVendor[session.vendor]) || [];
      if (vendorModels.length > 0 && queryModel && vendorModels.indexOf(queryModel) === -1) {
        queryModel = vendorModels[0];
      }
    }

    var queryOpts = {
      cwd: cwd,
      model: queryModel,
      effort: ls.effort || sm.currentEffort || undefined,
      toolServers: mcpServers || undefined,
      resumeSessionId: session.cliSessionId || undefined,
      abortController: linuxUser ? undefined : session.abortController,
      canUseTool: function(toolName, input, toolOpts) {
        return handleCanUseTool(session, toolName, input, toolOpts);
      },
      onElicitation: function(request, elicitOpts) {
        return handleElicitation(session, request, elicitOpts);
      },
      adapterOptions: { CLAUDE: claudeOpts },
    };

    var handle;
    console.log("[sdk-bridge] calling adapter.createQuery... vendor=" + sessionAdapter.vendor);
    try {
      handle = await sessionAdapter.createQuery(queryOpts);
      console.log("[sdk-bridge] createQuery returned handle, vendor=" + sessionAdapter.vendor);
    } catch (e) {
      console.error("[sdk-bridge] Failed to create query for session " + session.localId + ":", e.message || e);
      console.error("[sdk-bridge] cliSessionId:", session.cliSessionId, "resume:", !!session.cliSessionId);
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

    // Store adapter worker state for reuse on next query
    if (handle._adapterState) {
      session._adapterWorkerState = handle._adapterState;
      // Keep session.worker reference for external code (sessions.js, project.js)
      // that needs to kill the worker on session destroy.
      if (handle._adapterState.worker) {
        session.worker = handle._adapterState.worker;
      }
    }

    // For worker path, create an abortController wrapper that delegates to handle.abort()
    if (linuxUser) {
      session.abortController = {
        abort: function() { handle.abort(); },
        signal: { aborted: false, addEventListener: function() {} },
      };
    }

    // Store QueryHandle on session for iteration and control.
    session.queryInstance = handle;

    // Push initial user message through the QueryHandle
    console.log("[sdk-bridge] pushing initial message via handle.pushMessage...");
    handle.pushMessage(text, images);
    console.log("[sdk-bridge] pushMessage done, starting processQueryStream...");

    // For single-turn sessions (Ralph Loop), end the message queue so the SDK
    // query finishes after processing the one message. Without this, the query
    // stream stays open forever waiting for more messages, and onQueryComplete
    // never fires.
    if (session.singleTurn) {
      handle.endInput();
    }

    session.lastActivityAt = Date.now();
    session.streamPromise = processQueryStream(session).catch(function(err) {
    });
  }

  function pushMessage(session, text, images) {
    session.lastActivityAt = Date.now();
    // Route through QueryHandle (works for both in-process and worker paths)
    if (session.queryInstance && typeof session.queryInstance.pushMessage === "function") {
      session.queryInstance.pushMessage(text, images);
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

  // SDK warmup: initialize all available adapters and collect models.
  // The default adapter is initialized first for slash_commands and skills.
  // Passes linuxUser to adapter for worker-based warmup when OS isolation is needed.
  async function warmup(linuxUser) {
    var defaultVendor = adapter ? adapter.vendor : "claude";
    console.log("[sdk-bridge] warmup: default=" + defaultVendor + " adapters=" + Object.keys(adapters).join(",") + " linuxUser=" + (linuxUser || "none"));

    // Initialize default adapter first (provides skills, slash commands, etc.)
    if (adapter) {
      try {
        var result = await adapter.init({
          cwd: cwd,
          dangerouslySkipPermissions: dangerouslySkipPermissions,
          linuxUser: linuxUser || undefined,
        });

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
        if (result.defaultModel) {
          sm.currentModel = sm._savedDefaultModel || result.defaultModel;
        }
        sm.availableModels = result.models || [];
        // Store per-vendor models
        sm.modelsByVendor = sm.modelsByVendor || {};
        sm.modelsByVendor[defaultVendor] = result.models || [];
      } catch (e) {
        if (e && e.name !== "AbortError" && !(e.message && e.message.indexOf("aborted") !== -1)) {
          send({ type: "error", text: "Failed to load " + defaultVendor + " SDK: " + (e.message || e) });
        }
      }
    }

    // Initialize other adapters in parallel (fire-and-forget for models)
    var otherVendors = Object.keys(adapters).filter(function(v) { return v !== defaultVendor; });
    for (var i = 0; i < otherVendors.length; i++) {
      (function(v) {
        adapters[v].init({ cwd: cwd }).then(function(r) {
          sm.modelsByVendor = sm.modelsByVendor || {};
          sm.modelsByVendor[v] = r.models || [];
          console.log("[sdk-bridge] warmup: " + v + " initialized, models=" + (r.models || []).join(","));
        }).catch(function(e) {
          console.error("[sdk-bridge] warmup: " + v + " init failed:", e.message || e);
        });
      })(otherVendors[i]);
    }

    // Send initial state to client
    send({
      type: "model_info",
      model: sm.currentModel || "",
      models: sm.availableModels || [],
      vendor: defaultVendor,
      availableVendors: Object.keys(adapters),
    });
  }

  async function setModel(session, model) {
    var sessionVendor = session.vendor || (adapter && adapter.vendor) || "claude";
    if (!session.queryInstance) {
      // No active query — just store the model for next startQuery
      sm.currentModel = model;
      send({ type: "model_info", model: model, models: sm.availableModels || [], vendor: sessionVendor });
      send({ type: "config_state", model: sm.currentModel, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return;
    }
    try {
      await session.queryInstance.setModel(model);
      sm.currentModel = model;
      send({ type: "model_info", model: model, models: sm.availableModels || [], vendor: sessionVendor });
      send({ type: "config_state", model: sm.currentModel, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
    } catch (e) {
      send({ type: "error", text: "Failed to switch model: " + (e.message || e) });
    }
  }

  async function setEffort(session, effort) {
    if (!session.queryInstance) {
      sm.currentEffort = effort;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
      return;
    }
    // Route through QueryHandle (works for both in-process and worker paths)
    if (typeof session.queryInstance.setEffort === "function") {
      await session.queryInstance.setEffort(effort);
    }
    sm.currentEffort = effort;
    send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [] });
  }

  async function setPermissionMode(session, mode) {
    if (!session.queryInstance) {
      // No active query — just store the mode for next startQuery
      sm.currentPermissionMode = mode;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return;
    }
    try {
      // Route through QueryHandle (works for both in-process and worker paths)
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
    if (!session.queryInstance) return;
    try {
      // Route through QueryHandle (works for both in-process and worker paths)
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

    var handle;
    try {
      handle = await adapter.createQuery({
        cwd: cwd,
        systemPrompt: opts.claudeMd,
        model: opts.model || undefined,
        toolServers: (opts.includeMcpServers && mcpServers) ? mcpServers : undefined,
        abortController: abortController,
        canUseTool: opts.canUseTool || function (toolName, input) {
          var whitelisted = checkToolWhitelist(toolName, input);
          if (whitelisted) {
            return Promise.resolve(whitelisted);
          }
          return Promise.resolve({
            behavior: "deny",
            message: "Read-only access. You cannot make changes via @mention.",
          });
        },
        adapterOptions: {
          CLAUDE: {
            settingSources: ["user"],
            includePartialMessages: true,
          },
        },
      });
    } catch (e) {
      opts.onError("Failed to create mention query: " + (e.message || e));
      return null;
    }
    var query = handle;

    // Push the initial message (context + question, with optional images)
    var initialPrompt = opts.initialContext + "\n\n" + opts.initialMessage;
    handle.pushMessage(initialPrompt, opts.initialImages || null);

    // Background stream processing loop (consumes flattened yokeType events)
    (async function () {
      try {
        for await (var msg of query) {
          // Track content blocks for activity reporting
          if (msg.yokeType === "thinking_start") {
            mentionBlocks[msg.blockId] = { type: "thinking" };
            if (currentOnActivity) currentOnActivity("thinking");
          } else if (msg.yokeType === "tool_start") {
            mentionBlocks[msg.blockId] = { type: "tool_use", name: msg.toolName, inputJson: "" };
            var toolLabel = msg.toolName;
            if (toolLabel === "Read") toolLabel = "Reading file...";
            else if (toolLabel === "Grep") toolLabel = "Searching code...";
            else if (toolLabel === "Glob") toolLabel = "Finding files...";
            if (currentOnActivity) currentOnActivity(toolLabel);
          } else if (msg.yokeType === "text_start") {
            mentionBlocks[msg.blockId] = { type: "text" };

          } else if (msg.yokeType === "text_delta" && typeof msg.text === "string") {
            responseStreamedText = true;
            responseFullText += msg.text;
            if (currentOnActivity) currentOnActivity(null);
            if (currentOnDelta) currentOnDelta(msg.text);
          } else if (msg.yokeType === "tool_input_delta" && mentionBlocks[msg.blockId]) {
            mentionBlocks[msg.blockId].inputJson += msg.partialJson;

          } else if (msg.yokeType === "block_stop") {
            var blk = mentionBlocks[msg.blockId];
            if (blk && blk.type === "tool_use") {
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
            delete mentionBlocks[msg.blockId];

          } else if (msg.yokeType === "message" && msg.messageRole === "assistant" && !responseStreamedText && msg.content) {
            // Fallback: if text was not streamed via deltas, extract from assistant message
            var content = msg.content;
            if (Array.isArray(content)) {
              for (var ci = 0; ci < content.length; ci++) {
                if (content[ci].type === "text" && content[ci].text) {
                  responseFullText += content[ci].text;
                  if (currentOnDelta) currentOnDelta(content[ci].text);
                }
              }
            }

          } else if (msg.yokeType === "result") {
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
        handle.pushMessage(text, images || null);
      },
      abort: function () {
        try { abortController.abort(); } catch (e) {}
      },
      close: function () {
        alive = false;
        try { handle.close(); } catch (e) {}
      },
      isAlive: function () { return alive; },
    };
  }

  return {
    createMessageQueue: createMessageQueue,
    processSDKMessage: processSDKMessage,
    checkToolWhitelist: checkToolWhitelist,
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
    startIdleReaper: startIdleReaper,
    stopIdleReaper: stopIdleReaper,
  };
}

module.exports = { createSDKBridge, createMessageQueue };
