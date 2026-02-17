var fs = require("fs");
var path = require("path");
var { createSessionManager } = require("./sessions");
var { createSDKBridge } = require("./sdk-bridge");
var { createTerminalManager } = require("./terminal-manager");
var { fetchLatestVersion, isNewer } = require("./updater");
var { fetchUsageData } = require("./usage");
var { execFileSync } = require("child_process");

// SDK loaded dynamically (ESM module)
var sdkModule = null;
function getSDK() {
  if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");
  return sdkModule;
}

// --- Shared constants ---
var IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "__pycache__", ".cache", "dist", "build", ".claude-relay"]);
var BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".pyc", ".o", ".a", ".class",
]);
var IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);
var FS_MAX_SIZE = 512 * 1024;
var MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function safePath(base, requested) {
  var resolved = path.resolve(base, requested);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  try {
    var real = fs.realpathSync(resolved);
    if (real !== base && !real.startsWith(base + path.sep)) return null;
    return real;
  } catch (e) {
    return null;
  }
}

/**
 * Create a project context — per-project state and handlers.
 * opts: { cwd, slug, title, pushModule, debug, currentVersion }
 */
function createProjectContext(opts) {
  var cwd = opts.cwd;
  var slug = opts.slug;
  var project = path.basename(cwd);
  var title = opts.title || null;
  var pushModule = opts.pushModule || null;
  var debug = opts.debug || false;
  var currentVersion = opts.currentVersion;
  var getProjectCount = opts.getProjectCount || function () { return 1; };
  var getProjectList = opts.getProjectList || function () { return []; };
  var latestVersion = null;

  // --- Per-project clients ---
  var clients = new Set();

  function send(obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  function sendTo(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function broadcastClientCount() {
    send({ type: "client_count", count: clients.size });
  }

  function sendToOthers(sender, obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws !== sender && ws.readyState === 1) ws.send(data);
    }
  }

  // --- File watcher ---
  var fileWatcher = null;
  var watchedPath = null;
  var watchDebounce = null;

  function startFileWatch(relPath) {
    var absPath = safePath(cwd, relPath);
    if (!absPath) return;
    if (watchedPath === relPath) return;
    stopFileWatch();
    watchedPath = relPath;
    try {
      fileWatcher = fs.watch(absPath, function () {
        clearTimeout(watchDebounce);
        watchDebounce = setTimeout(function () {
          try {
            var stat = fs.statSync(absPath);
            var ext = path.extname(absPath).toLowerCase();
            if (stat.size > FS_MAX_SIZE || BINARY_EXTS.has(ext)) return;
            var content = fs.readFileSync(absPath, "utf8");
            send({ type: "fs_file_changed", path: relPath, content: content, size: stat.size });
          } catch (e) {
            stopFileWatch();
          }
        }, 200);
      });
      fileWatcher.on("error", function () { stopFileWatch(); });
    } catch (e) {
      watchedPath = null;
    }
  }

  function stopFileWatch() {
    if (fileWatcher) {
      try { fileWatcher.close(); } catch (e) {}
      fileWatcher = null;
    }
    clearTimeout(watchDebounce);
    watchDebounce = null;
    watchedPath = null;
  }

  // --- Session manager ---
  var sm = createSessionManager({ cwd: cwd, send: send });

  // --- SDK bridge ---
  var sdk = createSDKBridge({
    cwd: cwd,
    sessionManager: sm,
    send: send,
    pushModule: pushModule,
    getSDK: getSDK,
  });

  // --- Terminal manager ---
  var tm = createTerminalManager({ cwd: cwd, send: send, sendTo: sendTo });

  // Check for updates in background
  fetchLatestVersion().then(function (v) {
    if (v && isNewer(v, currentVersion)) {
      latestVersion = v;
      send({ type: "update_available", version: v });
    }
  });

  // --- WS connection handler ---
  function handleConnection(ws) {
    clients.add(ws);
    broadcastClientCount();

    // Send cached state
    sendTo(ws, { type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, projectCount: getProjectCount(), projects: getProjectList() });
    if (latestVersion) {
      sendTo(ws, { type: "update_available", version: latestVersion });
    }
    if (sm.slashCommands) {
      sendTo(ws, { type: "slash_commands", commands: sm.slashCommands });
    }
    if (sm.currentModel) {
      sendTo(ws, { type: "model_info", model: sm.currentModel, models: sm.availableModels || [] });
    }
    sendTo(ws, { type: "term_list", terminals: tm.list() });

    // Session list
    sendTo(ws, {
      type: "session_list",
      sessions: [].concat(Array.from(sm.sessions.values())).map(function (s) {
        return {
          id: s.localId,
          cliSessionId: s.cliSessionId || null,
          title: s.title || "New Session",
          active: s.localId === sm.activeSessionId,
          isProcessing: s.isProcessing,
          lastActivity: s.lastActivity || s.createdAt || 0,
        };
      }),
    });

    // Restore active session for this client
    var active = sm.getActiveSession();
    if (active) {
      sendTo(ws, { type: "session_switched", id: active.localId, cliSessionId: active.cliSessionId || null });

      var total = active.history.length;
      var fromIndex = 0;
      if (total > sm.HISTORY_PAGE_SIZE) {
        fromIndex = sm.findTurnBoundary(active.history, Math.max(0, total - sm.HISTORY_PAGE_SIZE));
      }
      sendTo(ws, { type: "history_meta", total: total, from: fromIndex });
      for (var i = fromIndex; i < total; i++) {
        sendTo(ws, active.history[i]);
      }

      if (active.isProcessing) {
        sendTo(ws, { type: "status", status: "processing" });
      }
      var pendingIds = Object.keys(active.pendingPermissions);
      for (var pi = 0; pi < pendingIds.length; pi++) {
        var p = active.pendingPermissions[pendingIds[pi]];
        sendTo(ws, {
          type: "permission_request_pending",
          requestId: p.requestId,
          toolName: p.toolName,
          toolInput: p.toolInput,
          toolUseId: p.toolUseId,
          decisionReason: p.decisionReason,
        });
      }
    }

    ws.on("message", function (raw) {
      var msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      handleMessage(ws, msg);
    });

    ws.on("close", function () {
      handleDisconnection(ws);
    });
  }

  // --- WS message handler ---
  function handleMessage(ws, msg) {
    if (msg.type === "push_subscribe") {
      if (pushModule && msg.subscription) pushModule.addSubscription(msg.subscription);
      return;
    }

    if (msg.type === "load_more_history") {
      var session = sm.getActiveSession();
      if (!session || typeof msg.before !== "number") return;
      var before = msg.before;
      var from = sm.findTurnBoundary(session.history, Math.max(0, before - sm.HISTORY_PAGE_SIZE));
      var to = before;
      var items = session.history.slice(from, to);
      sendTo(ws, {
        type: "history_prepend",
        items: items,
        meta: { from: from, to: to, hasMore: from > 0 },
      });
      return;
    }

    if (msg.type === "new_session") {
      sm.createSession();
      return;
    }

    if (msg.type === "resume_session") {
      if (!msg.cliSessionId) return;
      sm.resumeSession(msg.cliSessionId);
      return;
    }

    if (msg.type === "switch_session") {
      if (msg.id && sm.sessions.has(msg.id)) {
        sm.switchSession(msg.id);
      }
      return;
    }

    if (msg.type === "delete_session") {
      if (msg.id && sm.sessions.has(msg.id)) {
        sm.deleteSession(msg.id);
      }
      return;
    }

    if (msg.type === "rename_session") {
      if (msg.id && sm.sessions.has(msg.id) && msg.title) {
        var s = sm.sessions.get(msg.id);
        s.title = String(msg.title).substring(0, 100);
        sm.saveSessionFile(s);
        sm.broadcastSessionList();
      }
      return;
    }

    if (msg.type === "search_sessions") {
      var results = sm.searchSessions(msg.query || "");
      sendTo(ws, { type: "search_results", query: msg.query || "", results: results });
      return;
    }

    if (msg.type === "check_update") {
      fetchLatestVersion().then(function (v) {
        if (v && isNewer(v, currentVersion)) {
          latestVersion = v;
          sendTo(ws, { type: "update_available", version: v });
        }
      }).catch(function () {});
      return;
    }

    if (msg.type === "stop") {
      var session = sm.getActiveSession();
      if (session && session.abortController && session.isProcessing) {
        session.abortController.abort();
      }
      return;
    }

    if (msg.type === "get_usage") {
      fetchUsageData().then(function (data) {
        sendTo(ws, { type: "usage_data", data: data });
      }).catch(function (err) {
        sendTo(ws, { type: "usage_data", error: err.message || "Failed to fetch usage data" });
      });
      return;
    }

    if (msg.type === "set_model" && msg.model) {
      var session = sm.getActiveSession();
      if (session) {
        sdk.setModel(session, msg.model);
      }
      return;
    }

    if (msg.type === "rewind_preview") {
      var session = sm.getActiveSession();
      if (!session || !session.cliSessionId || !msg.uuid) return;

      (async function () {
        var result;
        try {
          result = await sdk.getOrCreateRewindQuery(session);
          var preview = await result.query.rewindFiles(msg.uuid, { dryRun: true });
          var diffs = {};
          var changedFiles = preview.filesChanged || [];
          for (var f = 0; f < changedFiles.length; f++) {
            try {
              diffs[changedFiles[f]] = execFileSync(
                "git", ["diff", "HEAD", "--", changedFiles[f]],
                { cwd: cwd, encoding: "utf8", timeout: 5000 }
              ) || "";
            } catch (e) { diffs[changedFiles[f]] = ""; }
          }
          sendTo(ws, { type: "rewind_preview_result", preview: preview, diffs: diffs, uuid: msg.uuid });
        } catch (err) {
          sendTo(ws, { type: "rewind_error", text: "Failed to preview rewind: " + err.message });
        } finally {
          if (result && result.isTemp) result.cleanup();
        }
      })();
      return;
    }

    if (msg.type === "rewind_execute") {
      var session = sm.getActiveSession();
      if (!session || !session.cliSessionId || !msg.uuid) return;

      (async function () {
        var result;
        try {
          result = await sdk.getOrCreateRewindQuery(session);
          await result.query.rewindFiles(msg.uuid, { dryRun: false });

          var targetIdx = -1;
          for (var i = 0; i < session.messageUUIDs.length; i++) {
            if (session.messageUUIDs[i].uuid === msg.uuid) {
              targetIdx = i;
              break;
            }
          }

          if (targetIdx >= 0) {
            var trimTo = session.messageUUIDs[targetIdx].historyIndex;
            for (var k = trimTo - 1; k >= 0; k--) {
              if (session.history[k].type === "user_message") {
                trimTo = k;
                break;
              }
            }
            session.history = session.history.slice(0, trimTo);
            session.messageUUIDs = session.messageUUIDs.slice(0, targetIdx);
          }

          session.lastRewindUuid = msg.uuid;

          if (session.abortController) {
            try { session.abortController.abort(); } catch (e) {}
          }
          if (session.messageQueue) {
            try { session.messageQueue.end(); } catch (e) {}
          }
          session.queryInstance = null;
          session.messageQueue = null;
          session.abortController = null;
          session.blocks = {};
          session.sentToolResults = {};
          session.pendingPermissions = {};
          session.pendingAskUser = {};
          session.isProcessing = false;

          sm.saveSessionFile(session);
          sm.switchSession(session.localId);
          sm.sendAndRecord(session, { type: "rewind_complete" });
          sm.broadcastSessionList();
        } catch (err) {
          send({ type: "rewind_error", text: "Rewind failed: " + err.message });
        } finally {
          if (result && result.isTemp) result.cleanup();
        }
      })();
      return;
    }

    if (msg.type === "ask_user_response") {
      var session = sm.getActiveSession();
      if (!session) return;
      var toolId = msg.toolId;
      var answers = msg.answers || {};
      var pending = session.pendingAskUser[toolId];
      if (!pending) return;
      delete session.pendingAskUser[toolId];
      sm.sendAndRecord(session, { type: "ask_user_answered", toolId: toolId });
      pending.resolve({
        behavior: "allow",
        updatedInput: Object.assign({}, pending.input, { answers: answers }),
      });
      return;
    }

    if (msg.type === "input_sync") {
      sendToOthers(ws, msg);
      return;
    }

    if (msg.type === "permission_response") {
      var session = sm.getActiveSession();
      if (!session) return;
      var requestId = msg.requestId;
      var decision = msg.decision;
      var pending = session.pendingPermissions[requestId];
      if (!pending) return;
      delete session.pendingPermissions[requestId];

      if (decision === "allow" || decision === "allow_always") {
        if (decision === "allow_always") {
          if (!session.allowedTools) session.allowedTools = {};
          session.allowedTools[pending.toolName] = true;
        }
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
      } else {
        pending.resolve({ behavior: "deny", message: "User denied permission" });
      }

      sm.sendAndRecord(session, {
        type: "permission_resolved",
        requestId: requestId,
        decision: decision,
      });
      return;
    }

    // --- File browser ---
    if (msg.type === "fs_list") {
      var fsDir = safePath(cwd, msg.path || ".");
      if (!fsDir) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: "Access denied" });
        return;
      }
      try {
        var items = fs.readdirSync(fsDir, { withFileTypes: true });
        var entries = [];
        for (var fi = 0; fi < items.length; fi++) {
          var item = items[fi];
          if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
          entries.push({
            name: item.name,
            type: item.isDirectory() ? "dir" : "file",
            path: path.relative(cwd, path.join(fsDir, item.name)),
          });
        }
        sendTo(ws, { type: "fs_list_result", path: msg.path || ".", entries: entries });
      } catch (e) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: e.message });
      }
      return;
    }

    if (msg.type === "fs_read") {
      var fsFile = safePath(cwd, msg.path);
      if (!fsFile) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, error: "Access denied" });
        return;
      }
      try {
        var stat = fs.statSync(fsFile);
        var ext = path.extname(fsFile).toLowerCase();
        if (stat.size > FS_MAX_SIZE) {
          sendTo(ws, { type: "fs_read_result", path: msg.path, binary: true, size: stat.size, error: "File too large (" + (stat.size / 1024 / 1024).toFixed(1) + " MB)" });
          return;
        }
        if (BINARY_EXTS.has(ext)) {
          var result = { type: "fs_read_result", path: msg.path, binary: true, size: stat.size };
          if (IMAGE_EXTS.has(ext)) result.imageUrl = "api/file?path=" + encodeURIComponent(msg.path);
          sendTo(ws, result);
          return;
        }
        var content = fs.readFileSync(fsFile, "utf8");
        sendTo(ws, { type: "fs_read_result", path: msg.path, content: content, size: stat.size });
      } catch (e) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, error: e.message });
      }
      return;
    }

    // --- File watcher ---
    if (msg.type === "fs_watch") {
      if (msg.path) startFileWatch(msg.path);
      return;
    }

    if (msg.type === "fs_unwatch") {
      stopFileWatch();
      return;
    }

    // --- Web terminal ---
    if (msg.type === "term_create") {
      var t = tm.create(msg.cols || 80, msg.rows || 24);
      if (!t) {
        sendTo(ws, { type: "term_error", error: "Cannot create terminal (node-pty not available or limit reached)" });
        return;
      }
      tm.attach(t.id, ws);
      send({ type: "term_list", terminals: tm.list() });
      sendTo(ws, { type: "term_created", id: t.id });
      return;
    }

    if (msg.type === "term_attach") {
      if (msg.id) tm.attach(msg.id, ws);
      return;
    }

    if (msg.type === "term_detach") {
      if (msg.id) tm.detach(msg.id, ws);
      return;
    }

    if (msg.type === "term_input") {
      if (msg.id) tm.write(msg.id, msg.data);
      return;
    }

    if (msg.type === "term_resize") {
      if (msg.id && msg.cols > 0 && msg.rows > 0) {
        tm.resize(msg.id, msg.cols, msg.rows);
      }
      return;
    }

    if (msg.type === "term_close") {
      if (msg.id) {
        tm.close(msg.id);
        send({ type: "term_list", terminals: tm.list() });
      }
      return;
    }

    if (msg.type === "term_rename") {
      if (msg.id && msg.title) {
        tm.rename(msg.id, msg.title);
        send({ type: "term_list", terminals: tm.list() });
      }
      return;
    }

    if (msg.type !== "message") return;
    if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.pastes || msg.pastes.length === 0)) return;

    var session = sm.getActiveSession();
    if (!session) return;

    var userMsg = { type: "user_message", text: msg.text || "" };
    if (msg.images && msg.images.length > 0) {
      userMsg.imageCount = msg.images.length;
    }
    if (msg.pastes && msg.pastes.length > 0) {
      userMsg.pastes = msg.pastes;
    }
    session.history.push(userMsg);
    sm.appendToSessionFile(session, userMsg);
    sendToOthers(ws, userMsg);

    if (!session.title) {
      session.title = (msg.text || "Image").substring(0, 50);
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
    }

    var fullText = msg.text || "";
    if (msg.pastes && msg.pastes.length > 0) {
      for (var pi = 0; pi < msg.pastes.length; pi++) {
        if (fullText) fullText += "\n\n";
        fullText += msg.pastes[pi];
      }
    }

    if (!session.isProcessing) {
      session.isProcessing = true;
      session.sentToolResults = {};
      send({ type: "status", status: "processing" });
      if (!session.queryInstance) {
        sdk.startQuery(session, fullText, msg.images);
      } else {
        sdk.pushMessage(session, fullText, msg.images);
      }
    } else {
      sdk.pushMessage(session, fullText, msg.images);
    }
    sm.broadcastSessionList();
  }

  // --- WS disconnection handler ---
  function handleDisconnection(ws) {
    tm.detachAll(ws);
    clients.delete(ws);
    if (clients.size === 0) stopFileWatch();
    broadcastClientCount();
  }

  // --- Handle project-scoped HTTP requests ---
  function handleHTTP(req, res, urlPath) {
    // Push subscribe
    if (req.method === "POST" && urlPath === "/api/push-subscribe") {
      parseJsonBody(req).then(function (sub) {
        if (pushModule) pushModule.addSubscription(sub);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Permission response from push notification
    if (req.method === "POST" && urlPath === "/api/permission-response") {
      parseJsonBody(req).then(function (data) {
        var requestId = data.requestId;
        var decision = data.decision;
        if (!requestId || !decision) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing requestId or decision"}');
          return;
        }
        var found = false;
        sm.sessions.forEach(function (session) {
          var pending = session.pendingPermissions[requestId];
          if (!pending) return;
          found = true;
          delete session.pendingPermissions[requestId];
          if (decision === "allow") {
            pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
          } else {
            pending.resolve({ behavior: "deny", message: "Denied via push notification" });
          }
          sm.sendAndRecord(session, {
            type: "permission_resolved",
            requestId: requestId,
            decision: decision,
          });
        });
        if (found) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"permission request not found"}');
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // VAPID public key
    if (req.method === "GET" && urlPath === "/api/vapid-public-key") {
      if (pushModule) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" });
        res.end(JSON.stringify({ publicKey: pushModule.publicKey }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"push not available"}');
      }
      return true;
    }

    // File browser: serve project images
    if (req.method === "GET" && urlPath.startsWith("/api/file?")) {
      var qIdx = urlPath.indexOf("?");
      var params = new URLSearchParams(urlPath.substring(qIdx));
      var reqFilePath = params.get("path");
      if (!reqFilePath) { res.writeHead(400); res.end("Missing path"); return true; }
      var absFile = safePath(cwd, reqFilePath);
      if (!absFile) { res.writeHead(403); res.end("Access denied"); return true; }
      var fileExt = path.extname(absFile).toLowerCase();
      if (!IMAGE_EXTS.has(fileExt)) { res.writeHead(403); res.end("Only image files"); return true; }
      try {
        var fileContent = fs.readFileSync(absFile);
        var fileMime = MIME_TYPES[fileExt] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": fileMime, "Cache-Control": "no-cache" });
        res.end(fileContent);
      } catch (e) {
        res.writeHead(404); res.end("Not found");
      }
      return true;
    }

    // Info endpoint
    if (req.method === "GET" && urlPath === "/info") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ cwd: cwd, project: project, slug: slug }));
      return true;
    }

    return false; // not handled
  }

  // --- Destroy ---
  function destroy() {
    stopFileWatch();
    // Abort all active sessions
    sm.sessions.forEach(function (session) {
      if (session.abortController) {
        try { session.abortController.abort(); } catch (e) {}
      }
      if (session.messageQueue) {
        try { session.messageQueue.end(); } catch (e) {}
      }
    });
    // Kill all terminals
    tm.destroyAll();
    for (var ws of clients) {
      try { ws.close(); } catch (e) {}
    }
    clients.clear();
  }

  // --- Status info ---
  function getStatus() {
    var sessionCount = sm.sessions.size;
    var hasProcessing = false;
    sm.sessions.forEach(function (s) {
      if (s.isProcessing) hasProcessing = true;
    });
    return {
      slug: slug,
      path: cwd,
      project: project,
      title: title,
      clients: clients.size,
      sessions: sessionCount,
      isProcessing: hasProcessing,
    };
  }

  function setTitle(newTitle) {
    title = newTitle || null;
    send({ type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, projectCount: getProjectCount(), projects: getProjectList() });
  }

  return {
    cwd: cwd,
    slug: slug,
    project: project,
    clients: clients,
    sm: sm,
    sdk: sdk,
    send: send,
    sendTo: sendTo,
    handleConnection: handleConnection,
    handleMessage: handleMessage,
    handleDisconnection: handleDisconnection,
    handleHTTP: handleHTTP,
    getStatus: getStatus,
    setTitle: setTitle,
    warmup: function () { sdk.warmup(); },
    destroy: destroy,
  };
}

function parseJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var body = "";
    req.on("data", function (chunk) { body += chunk; });
    req.on("end", function () {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
  });
}

module.exports = { createProjectContext: createProjectContext };
