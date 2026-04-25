var fs = require("fs");
var path = require("path");
var config = require("./config");
var utils = require("./utils");
var users = require("./users");
var { CODEX_DEFAULTS } = require("./codex-defaults");

function createSessionManager(opts) {
  var cwd = opts.cwd;
  var send = opts.send;          // function(obj) - broadcast to all clients
  var sendTo = opts.sendTo || null; // function(ws, obj) - send to specific client
  var sendEach = opts.sendEach || null; // function(fn) - call fn(ws) for each connected client
  var sendAndRecord = null;      // set after init via setSendAndRecord
  var onSessionDone = opts.onSessionDone || function () {};

  // --- Multi-session state ---
  var nextLocalId = 1;
  var sessions = new Map();     // localId -> session object
  var activeSessionId = null;   // currently active local ID
  var slashCommands = null;     // shared across sessions (deprecated, use slashCommandsByVendor)
  var slashCommandsByVendor = {}; // vendor -> array of slash commands
  var skillNames = null;        // Claude-only skills to filter from slash menu
  var singleUserUnread = {};    // sessionLocalId -> unread count (single-user mode)
  var permissionRequestIndex = {}; // requestId -> sessionLocalId (O(1) lookup)
  var capabilitiesByVendor = null; // set by sdk-bridge after adapter init
  var defaultVendor = null;        // set by sdk-bridge
  var codexApproval = CODEX_DEFAULTS.approval;
  var codexSandbox = CODEX_DEFAULTS.sandbox;
  var codexWebSearch = CODEX_DEFAULTS.webSearch;

  // --- Session persistence (centralized in ~/.clay/sessions/{encoded-cwd}/) ---
  var sessionsBase = path.join(config.CONFIG_DIR, "sessions");
  var encodedCwd = utils.resolveEncodedDir(sessionsBase, cwd);
  var sessionsDir = path.join(sessionsBase, encodedCwd);
  fs.mkdirSync(sessionsDir, { recursive: true });

  // Auto-migrate sessions from legacy locations:
  //   v1: {cwd}/.claude-relay/sessions/
  //   v2: ~/.claude-relay/sessions/{encoded-cwd}/  (if config.js rename didn't cover it)
  var legacySessionDirs = [
    path.join(cwd, ".claude-relay", "sessions"),
    path.join(require("./config").REAL_HOME, ".claude-relay", "sessions", encodedCwd),
  ];
  for (var li = 0; li < legacySessionDirs.length; li++) {
    var oldSessionsDir = legacySessionDirs[li];
    try {
      var oldFiles = fs.readdirSync(oldSessionsDir);
      var migrated = 0;
      for (var mi = 0; mi < oldFiles.length; mi++) {
        if (!oldFiles[mi].endsWith(".jsonl")) continue;
        var oldFilePath = path.join(oldSessionsDir, oldFiles[mi]);
        var newFilePath = path.join(sessionsDir, oldFiles[mi]);
        if (fs.existsSync(newFilePath)) continue;
        try {
          fs.renameSync(oldFilePath, newFilePath);
          migrated++;
        } catch (renameErr) {
          try {
            fs.copyFileSync(oldFilePath, newFilePath);
            fs.unlinkSync(oldFilePath);
            migrated++;
          } catch (copyErr) {}
        }
      }
      if (migrated > 0) {
        console.log("[sessions] Migrated " + migrated + " session(s) from " + oldSessionsDir);
      }
      // Clean up old directory if empty
      try {
        if (fs.readdirSync(oldSessionsDir).length === 0) {
          fs.rmdirSync(oldSessionsDir);
          var parentDir = path.dirname(oldSessionsDir);
          if (fs.readdirSync(parentDir).length === 0) fs.rmdirSync(parentDir);
        }
      } catch (e) {}
    } catch (e) {
      // Old directory doesn't exist — that's fine
    }
  }

  function sessionFilePath(cliSessionId) {
    return path.join(sessionsDir, cliSessionId + ".jsonl");
  }

  function saveSessionFile(session) {
    if (!session.cliSessionId) return;
    try {
      var metaObj = {
        type: "meta",
        localId: session.localId,
        cliSessionId: session.cliSessionId,
        title: session.title,
        createdAt: session.createdAt,
      };
      if (session.ownerId) metaObj.ownerId = session.ownerId;
      if (session.vendor) metaObj.vendor = session.vendor;
      if (session.sessionVisibility) metaObj.sessionVisibility = session.sessionVisibility;
      if (session.bookmarked) metaObj.bookmarked = true;
      if (typeof session.favoriteOrder === "number") metaObj.favoriteOrder = session.favoriteOrder;
      if (session.lastRewindUuid) metaObj.lastRewindUuid = session.lastRewindUuid;
      if (session.loop) metaObj.loop = session.loop;
      if (session.debateState) metaObj.debateState = session.debateState;
      if (session.debateSetupMode) metaObj.debateSetupMode = true;
      var meta = JSON.stringify(metaObj);
      var lines = [meta];
      for (var i = 0; i < session.history.length; i++) {
        lines.push(JSON.stringify(session.history[i]));
      }
      var sfPath = sessionFilePath(session.cliSessionId);
      // Atomic write: write to temp file then rename, so a crash mid-write
      // cannot leave a truncated/corrupted session file.
      var tmpPath = sfPath + ".tmp." + process.pid;
      fs.writeFileSync(tmpPath, lines.join("\n") + "\n");
      if (process.platform !== "win32") {
        try { fs.chmodSync(tmpPath, 0o600); } catch (chmodErr) {}
      }
      fs.renameSync(tmpPath, sfPath);
    } catch(e) {
      console.error("[session] Failed to save session file:", e.message);
    }
  }

  function appendToSessionFile(session, obj) {
    if (!session.cliSessionId) return;
    session.lastActivity = Date.now();
    try {
      var afPath = sessionFilePath(session.cliSessionId);
      fs.appendFileSync(afPath, JSON.stringify(obj) + "\n");
      if (process.platform !== "win32") {
        try { fs.chmodSync(afPath, 0o600); } catch (chmodErr) {}
      }
    } catch(e) {
      console.error("[session] Failed to append to session file:", e.message);
    }
  }

  function loadSessions() {
    var files;
    try { files = fs.readdirSync(sessionsDir); } catch { return; }

    // Clean up stale temp files from interrupted atomic writes
    for (var ti = 0; ti < files.length; ti++) {
      if (files[ti].indexOf(".tmp.") !== -1) {
        try { fs.unlinkSync(path.join(sessionsDir, files[ti])); } catch (e) {}
      }
    }

    var loaded = [];
    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith(".jsonl")) continue;
      var content;
      try { content = fs.readFileSync(path.join(sessionsDir, files[i]), "utf8"); } catch { continue; }
      var lines = content.trim().split("\n");
      if (lines.length === 0) continue;

      var meta;
      try { meta = JSON.parse(lines[0]); } catch { continue; }
      if (meta.type !== "meta" || !meta.cliSessionId) continue;

      var history = [];
      for (var j = 1; j < lines.length; j++) {
        try { history.push(JSON.parse(lines[j])); } catch {}
      }

      var fileMtime = 0;
      try { fileMtime = fs.statSync(path.join(sessionsDir, files[i])).mtimeMs; } catch {}
      loaded.push({ meta: meta, history: history, mtime: fileMtime });
    }

    loaded.sort(function(a, b) { return a.meta.createdAt - b.meta.createdAt; });

    for (var i = 0; i < loaded.length; i++) {
      var m = loaded[i].meta;
      var localId = nextLocalId++;
      // Reconstruct messageUUIDs from history
      var messageUUIDs = [];
      for (var k = 0; k < loaded[i].history.length; k++) {
        if (loaded[i].history[k].type === "message_uuid") {
          messageUUIDs.push({ uuid: loaded[i].history[k].uuid, type: loaded[i].history[k].messageType, historyIndex: k });
        }
      }
      var session = {
        localId: localId,
        queryInstance: null,
        messageQueue: null,
        cliSessionId: m.cliSessionId,
        blocks: {},
        sentToolResults: {},
        pendingPermissions: {},
        pendingAskUser: {},
        isProcessing: false,
        title: m.title || "",
        createdAt: m.createdAt || Date.now(),
        lastActivity: loaded[i].mtime || m.createdAt || Date.now(),
        history: loaded[i].history,
        messageUUIDs: messageUUIDs,
        lastRewindUuid: m.lastRewindUuid || null,
      };
      if (m.vendor) session.vendor = m.vendor;
      if (m.loop) session.loop = m.loop;
      if (m.debateState) session.debateState = m.debateState;
      if (m.debateSetupMode) session.debateSetupMode = true;
      if (m.ownerId) session.ownerId = m.ownerId;
      session.sessionVisibility = m.sessionVisibility || "shared";
      session.bookmarked = !!m.bookmarked;
      session.favoriteOrder = typeof m.favoriteOrder === "number" ? m.favoriteOrder : null;
      sessions.set(localId, session);
    }
  }

  // Load persisted sessions from disk
  loadSessions();

  function getActiveSession() {
    return sessions.get(activeSessionId) || null;
  }

  var resolveLoopInfo = null; // optional callback: (loopId) => { name, source } or null

  function setResolveLoopInfo(fn) {
    resolveLoopInfo = fn;
  }

  function mapSessionForClient(s, clientActiveId, wsUnread) {
    var loop = s.loop ? Object.assign({}, s.loop) : null;
    if (loop && loop.loopId && resolveLoopInfo) {
      var info = resolveLoopInfo(loop.loopId);
      if (info) {
        if (info.name) loop.name = info.name;
        if (info.source) loop.source = info.source;
      }
    }
    var isActive = (typeof clientActiveId === "number") ? s.localId === clientActiveId : s.localId === activeSessionId;
    var unreadMap = wsUnread || singleUserUnread;
    return {
      id: s.localId,
      cliSessionId: s.cliSessionId || null,
      title: s.title || "New Session",
      active: isActive,
      isProcessing: s.isProcessing,
      lastActivity: s.lastActivity || s.createdAt || 0,
      loop: loop,
      ownerId: s.ownerId || null,
      sessionVisibility: s.sessionVisibility || "shared",
      bookmarked: !!s.bookmarked,
      favoriteOrder: typeof s.favoriteOrder === "number" ? s.favoriteOrder : null,
      unread: unreadMap[s.localId] || 0,
      vendor: s.vendor || null,
    };
  }

  function getVisibleSessions() {
    var multiUser = users.isMultiUser();
    return [...sessions.values()].filter(function (s) {
      if (s.hidden) return false;
      if (!multiUser) {
        return !s.ownerId;
      }
      return true;
    });
  }

  function broadcastSessionList() {
    var allVisible = getVisibleSessions();
    if (sendEach) {
      // Per-client filtering (multi-user mode)
      sendEach(function (ws, filterFn) {
        var filtered = filterFn ? allVisible.filter(filterFn) : allVisible;
        var clientActiveId = ws._clayActiveSession;
        var wsUnread = ws._clayUnread || {};
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "session_list",
            sessions: filtered.map(function (s) { return mapSessionForClient(s, clientActiveId, wsUnread); }),
          }));
        }
      });
    } else {
      send({
        type: "session_list",
        sessions: allVisible.map(function (s) { return mapSessionForClient(s); }),
      });
    }
  }

  function createSession(sessionOpts, targetWs) {
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      queryInstance: null,
      messageQueue: null,
      cliSessionId: null,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: "",
      titleAutoGenerated: false,
      turnCount: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      history: [],
      messageUUIDs: [],
      ownerId: (sessionOpts && sessionOpts.ownerId) || null,
      sessionVisibility: (sessionOpts && sessionOpts.sessionVisibility) || "shared",
      bookmarked: false,
      favoriteOrder: null,
      vendor: (sessionOpts && sessionOpts.vendor) || null,
    };
    sessions.set(localId, session);
    switchSession(localId, targetWs);
    return session;
  }

  // Create a session without switching to it (used for mate/background sessions)
  function createSessionRaw(sessionOpts) {
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      queryInstance: null,
      messageQueue: null,
      cliSessionId: null,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: "",
      titleAutoGenerated: false,
      turnCount: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      history: [],
      messageUUIDs: [],
      ownerId: (sessionOpts && sessionOpts.ownerId) || null,
      sessionVisibility: (sessionOpts && sessionOpts.sessionVisibility) || "shared",
      bookmarked: false,
      favoriteOrder: null,
      vendor: (sessionOpts && sessionOpts.vendor) || null,
    };
    sessions.set(localId, session);
    return session;
  }

  var HISTORY_PAGE_SIZE = 200;

  function findTurnBoundary(history, targetIndex) {
    for (var i = targetIndex; i >= 0; i--) {
      if (history[i] && history[i].type === "user_message") return i;
    }
    return 0;
  }

  function replayHistory(session, fromIndex, targetWs, transform) {
    var _send = (targetWs && sendTo) ? function (obj) { sendTo(targetWs, obj); } : send;
    var total = session.history.length;
    if (typeof fromIndex !== "number") {
      if (total <= HISTORY_PAGE_SIZE) {
        fromIndex = 0;
      } else {
        fromIndex = findTurnBoundary(session.history, Math.max(0, total - HISTORY_PAGE_SIZE));
      }
    }

    _send({ type: "history_meta", total: total, from: fromIndex });

    for (var i = fromIndex; i < total; i++) {
      var _item = session.history[i];
      // Skip internal bookkeeping entries not meant for the UI
      if (_item && _item.type === "digest_checkpoint") continue;
      if (_item && (_item.type === "mention_user" || _item.type === "mention_response")) {
        console.log("[DEBUG replayHistory] sending mention at index=" + i + " from=" + fromIndex + " total=" + total + " type=" + _item.type + " mate=" + (_item.mateName || ""));
      }
      _send(transform ? transform(_item) : _item);
    }

    // Find the last result message in the full history for accurate context data
    var lastUsage = null;
    var lastModelUsage = null;
    var lastCost = null;
    var lastStreamInputTokens = null;
    for (var j = total - 1; j >= 0; j--) {
      if (session.history[j].type === "result") {
        var r = session.history[j];
        lastUsage = r.usage || null;
        lastModelUsage = r.modelUsage || null;
        lastCost = r.cost != null ? r.cost : null;
        lastStreamInputTokens = r.lastStreamInputTokens || null;
        break;
      }
    }

    _send({ type: "history_done", lastUsage: lastUsage, lastModelUsage: lastModelUsage, lastCost: lastCost, lastStreamInputTokens: lastStreamInputTokens, contextUsage: session.lastContextUsage || null });
  }

  function switchSession(localId, targetWs, transform) {
    var session = sessions.get(localId);
    if (!session) return;

    activeSessionId = localId;
    if (targetWs) {
      targetWs._clayActiveSession = localId;
      // Clear unread for this session (multi-user)
      if (targetWs._clayUnread) targetWs._clayUnread[localId] = 0;
    } else if (sendEach) {
      // No specific target: update all connected clients (server-initiated switch)
      sendEach(function (ws) {
        ws._clayActiveSession = localId;
      });
    }
    // Clear unread for single-user mode
    singleUserUnread[localId] = 0;

    // In multi-user mode with a specific client, only send to that client
    var _send = (targetWs && sendTo) ? function (obj) { sendTo(targetWs, obj); } : send;

    var _capsByVendor = capabilitiesByVendor || {};
    var _sessionVendor = session.vendor || defaultVendor || "claude";
    var _vendorCaps = _capsByVendor[_sessionVendor] || {};
    _send({ type: "session_switched", id: localId, cliSessionId: session.cliSessionId || null, loop: session.loop || null, vendor: session.vendor || null, hasHistory: (session.history && session.history.length > 0), capabilities: _vendorCaps });
    // Send vendor-specific slash commands
    var _vendorCmds = slashCommandsByVendor[_sessionVendor] || slashCommands || [];
    _send({ type: "slash_commands", commands: _vendorCmds, vendor: _sessionVendor });
    broadcastSessionList();
    replayHistory(session, undefined, targetWs, transform);

    if (session.isProcessing) {
      _send({ type: "status", status: "processing" });
    }

    // Re-send any pending permission requests
    var pendingIds = Object.keys(session.pendingPermissions);
    for (var i = 0; i < pendingIds.length; i++) {
      var p = session.pendingPermissions[pendingIds[i]];
      _send({
        type: "permission_request_pending",
        requestId: p.requestId,
        toolName: p.toolName,
        toolInput: p.toolInput,
        toolUseId: p.toolUseId,
        decisionReason: p.decisionReason,
      });
    }

    // Re-send active mention indicator so returning clients restore the mate avatar state
    if (session._mentionInProgress && session._mentionActiveMateId) {
      _send({ type: "mention_processing", mateId: session._mentionActiveMateId, active: true });
    }
  }

  function cleanupMentionSessions(session) {
    if (session._mentionSessions) {
      var mateIds = Object.keys(session._mentionSessions);
      for (var mi = 0; mi < mateIds.length; mi++) {
        try { session._mentionSessions[mateIds[mi]].close(); } catch (e) {}
      }
      session._mentionSessions = {};
    }
  }

  function deleteSession(localId, targetWs) {
    var session = sessions.get(localId);
    if (!session) return;

    // Clean up unread tracking
    delete singleUserUnread[localId];

    cleanupMentionSessions(session);

    if (session.abortController) {
      try { session.abortController.abort(); } catch(e) {}
    }
    // Close SDK query to terminate the underlying claude child process
    if (session.queryInstance && typeof session.queryInstance.close === "function") {
      try { session.queryInstance.close(); } catch(e) {}
    }
    session.queryInstance = null;
    if (session.messageQueue) {
      try { session.messageQueue.end(); } catch(e) {}
    }
    if (session.worker) {
      try { session.worker.kill(); } catch(e) {}
      session.worker = null;
    }

    if (session.cliSessionId) {
      try { fs.unlinkSync(sessionFilePath(session.cliSessionId)); } catch(e) {}
    }

    sessions.delete(localId);

    if (activeSessionId === localId) {
      var remaining = [...sessions.keys()];
      if (remaining.length > 0) {
        switchSession(remaining[remaining.length - 1], targetWs);
      } else {
        createSession(null, targetWs);
      }
    } else {
      broadcastSessionList();
    }
  }

  function deleteSessionQuiet(localId) {
    var session = sessions.get(localId);
    if (!session) return;
    delete singleUserUnread[localId];
    cleanupMentionSessions(session);
    if (session.abortController) {
      try { session.abortController.abort(); } catch(e) {}
    }
    // Close SDK query to terminate the underlying claude child process
    if (session.queryInstance && typeof session.queryInstance.close === "function") {
      try { session.queryInstance.close(); } catch(e) {}
    }
    session.queryInstance = null;
    if (session.messageQueue) {
      try { session.messageQueue.end(); } catch(e) {}
    }
    if (session.worker) {
      try { session.worker.kill(); } catch(e) {}
      session.worker = null;
    }
    if (session.cliSessionId) {
      try { fs.unlinkSync(sessionFilePath(session.cliSessionId)); } catch(e) {}
    }
    sessions.delete(localId);
  }

  function deleteSessionsBulk(localIds, targetWs) {
    if (!Array.isArray(localIds) || localIds.length === 0) return;

    var seen = {};
    var ids = [];
    for (var i = 0; i < localIds.length; i++) {
      var id = localIds[i];
      if (typeof id !== "number" || seen[id] || !sessions.has(id)) continue;
      seen[id] = true;
      ids.push(id);
    }
    if (ids.length === 0) return;

    var deletedActive = false;
    for (var j = 0; j < ids.length; j++) {
      if (ids[j] === activeSessionId) deletedActive = true;
      deleteSessionQuiet(ids[j]);
    }

    if (sessions.size === 0) {
      createSession(null, targetWs);
      return;
    }

    if (deletedActive) {
      var remaining = [...sessions.keys()];
      switchSession(remaining[remaining.length - 1], targetWs);
    } else {
      broadcastSessionList();
    }
  }

  function doSendToSession(session, obj) {
    // Send to active clients without recording to history/disk (ephemeral data)
    if (sendEach) {
      var data = JSON.stringify(obj);
      sendEach(function (ws) {
        if (ws._clayActiveSession === session.localId && ws.readyState === 1) {
          ws.send(data);
        }
      });
    } else if (session.localId === activeSessionId) {
      send(obj);
    }
  }

  function doSendAndRecord(session, obj) {
    // Stamp every recorded message so history replay preserves original times
    if (!obj._ts) obj._ts = Date.now();
    session.history.push(obj);
    appendToSessionFile(session, obj);
    if (sendEach) {
      // Multi-user: send to clients whose active session matches this one
      var data = JSON.stringify(obj);
      var ioData = null;
      sendEach(function (ws) {
        if (ws._clayActiveSession === session.localId) {
          if (ws.readyState === 1) ws.send(data);
        } else if (session.isProcessing && !session._ioThrottle) {
          if (!ioData) ioData = JSON.stringify({ type: "session_io", id: session.localId });
          if (ws.readyState === 1) ws.send(ioData);
        }
        // Track unread: increment on "done" for clients not viewing this session
        // Only count if session has no owner (my session) or owner matches this client
        if (obj.type === "done" && ws._clayActiveSession !== session.localId) {
          var _isMySession = !session.ownerId || (ws._clayUser && ws._clayUser.id === session.ownerId);
          if (_isMySession) {
            if (!ws._clayUnread) ws._clayUnread = {};
            ws._clayUnread[session.localId] = (ws._clayUnread[session.localId] || 0) + 1;
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "session_unread", id: session.localId, count: ws._clayUnread[session.localId] }));
            }
          }
        }
      });
      if (session.isProcessing && !session._ioThrottle && ioData) {
        session._ioThrottle = true;
        setTimeout(function () { session._ioThrottle = false; }, 80);
      }
    } else if (session.localId === activeSessionId) {
      send(obj);
    } else {
      // Track unread for single-user mode on "done"
      if (obj.type === "done") {
        singleUserUnread[session.localId] = (singleUserUnread[session.localId] || 0) + 1;
        send({ type: "session_unread", id: session.localId, count: singleUserUnread[session.localId] });
      }
      if (session.isProcessing && !session._ioThrottle) {
        session._ioThrottle = true;
        send({ type: "session_io", id: session.localId });
        setTimeout(function () { session._ioThrottle = false; }, 80);
      }
    }
    // Notify server for cross-project unread tracking
    if (obj.type === "done") onSessionDone();
  }

  function resumeSession(cliSessionId, opts, targetWs) {
    // If a session with this cliSessionId already exists, just switch to it
    var existing = null;
    sessions.forEach(function (s) {
      if (s.cliSessionId === cliSessionId) existing = s;
    });
    if (existing) {
      existing.lastActivity = Date.now();
      switchSession(existing.localId, targetWs);
      return existing;
    }

    var cliHistory = (opts && opts.history) || [];
    var title = (opts && opts.title) || "Resumed session";
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      queryInstance: null,
      messageQueue: null,
      cliSessionId: cliSessionId,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: title,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      history: cliHistory,
      messageUUIDs: [],
      bookmarked: false,
      favoriteOrder: null,
    };
    if (opts && opts.vendor) session.vendor = opts.vendor;
    if (opts && opts.ownerId) session.ownerId = opts.ownerId;
    sessions.set(localId, session);
    saveSessionFile(session);
    switchSession(localId, targetWs);
    return session;
  }

  // --- Spawn initial session only if no persisted sessions ---
  if (sessions.size === 0) {
    createSession();
  } else {
    // Activate the most recently used session
    var allSessions = [...sessions.values()];
    var mostRecent = allSessions[0];
    for (var i = 1; i < allSessions.length; i++) {
      if ((allSessions[i].lastActivity || 0) > (mostRecent.lastActivity || 0)) {
        mostRecent = allSessions[i];
      }
    }
    activeSessionId = mostRecent.localId;
  }

  function searchSessions(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    var results = [];
    sessions.forEach(function (session) {
      var titleMatch = (session.title || "New Session").toLowerCase().indexOf(q) !== -1;
      var contentMatch = false;
      for (var i = 0; i < session.history.length; i++) {
        var entry = session.history[i];
        if ((entry.type === "delta" || entry.type === "user_message" || entry.type === "mention_user" || entry.type === "mention_response" || entry.type === "debate_turn_done" || entry.type === "debate_comment_injected") && entry.text) {
          if (entry.text.toLowerCase().indexOf(q) !== -1) {
            contentMatch = true;
            break;
          }
        }
      }
      if (titleMatch || contentMatch) {
        results.push({
          id: session.localId,
          cliSessionId: session.cliSessionId || null,
          title: session.title || "New Session",
          active: session.localId === activeSessionId,
          isProcessing: session.isProcessing,
          lastActivity: session.lastActivity || session.createdAt || 0,
          matchType: titleMatch && contentMatch ? "both" : titleMatch ? "title" : "content",
        });
      }
    });
    return results;
  }

  function searchSessionContent(localId, query) {
    if (!query) return { hits: [], total: 0 };
    var session = sessions.get(localId);
    if (!session) return { hits: [], total: 0 };
    var q = query.toLowerCase();
    var qLen = query.length;
    var history = session.history;
    var hits = [];

    // Assistant turns can consist of many streaming deltas (especially Codex,
    // where agentMessage/delta fragments arrive in small chunks). We accumulate
    // delta text per turn, scan for ALL occurrences of the query across the
    // accumulated buffer, then map each occurrence back to the historyIndex of
    // the delta that contains its starting offset. This catches multiple
    // matches within a single turn and also matches that straddle delta
    // boundaries.
    var turnBuffer = "";
    var turnSegments = []; // [{ start, end, historyIndex, ts }]

    function pushScalarHits(text, historyIndex, role, ts) {
      if (!text) return;
      var lower = text.toLowerCase();
      var from = 0;
      while (true) {
        var idx = lower.indexOf(q, from);
        if (idx === -1) break;
        var s = Math.max(0, idx - 15);
        var e = Math.min(text.length, idx + qLen + 15);
        var snippet = (s > 0 ? "\u2026" : "") + text.substring(s, e) + (e < text.length ? "\u2026" : "");
        hits.push({ historyIndex: historyIndex, snippet: snippet, role: role, ts: ts });
        from = idx + qLen;
      }
    }

    function flushTurn() {
      if (!turnBuffer || turnSegments.length === 0) {
        turnBuffer = "";
        turnSegments = [];
        return;
      }
      var lowerBuf = turnBuffer.toLowerCase();
      var from = 0;
      var segCursor = 0;
      while (true) {
        var idx = lowerBuf.indexOf(q, from);
        if (idx === -1) break;
        // Advance segCursor to the segment containing idx.
        while (segCursor < turnSegments.length - 1 && turnSegments[segCursor].end <= idx) {
          segCursor++;
        }
        var seg = turnSegments[segCursor];
        var s = Math.max(0, idx - 15);
        var e = Math.min(turnBuffer.length, idx + qLen + 15);
        var snippet = (s > 0 ? "\u2026" : "") + turnBuffer.substring(s, e) + (e < turnBuffer.length ? "\u2026" : "");
        hits.push({ historyIndex: seg.historyIndex, snippet: snippet, role: "assistant", ts: seg.ts });
        from = idx + qLen;
      }
      turnBuffer = "";
      turnSegments = [];
    }

    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      var t = entry.type;
      if (t === "user_message" || t === "mention_user") {
        flushTurn();
        pushScalarHits(entry.text, i, t === "user_message" ? "user" : "assistant", entry._ts || null);
      } else if (t === "delta" && entry.text) {
        turnSegments.push({
          start: turnBuffer.length,
          end: turnBuffer.length + entry.text.length,
          historyIndex: i,
          ts: entry._ts || null,
        });
        turnBuffer += entry.text;
      } else if ((t === "mention_response" || t === "debate_turn_done" || t === "debate_comment_injected") && entry.text) {
        flushTurn();
        pushScalarHits(entry.text, i, "assistant", entry._ts || null);
      }
    }
    flushTurn();
    return { hits: hits, total: history.length };
  }

  var _migrationFailedIds = {};
  function migrateSessionTitles(adapter, migrateCwd) {
    var candidates = [];
    sessions.forEach(function(s) {
      if (s.cliSessionId && s.title && s.title !== "New Session" && s.title !== "Resumed session"
          && !_migrationFailedIds[s.cliSessionId]) {
        candidates.push({ cliSessionId: s.cliSessionId, title: s.title });
      }
    });
    if (candidates.length === 0) return;
    adapter.listSessions({ dir: migrateCwd }).then(function(sdkSessions) {
      var sdkTitles = {};
      for (var i = 0; i < sdkSessions.length; i++) {
        if (sdkSessions[i].customTitle) {
          sdkTitles[sdkSessions[i].sessionId] = sdkSessions[i].customTitle;
        }
      }
      var toMigrate = candidates.filter(function(item) {
        var relayTitle = (item.title || "").trim();
        var sdkTitle = (sdkTitles[item.cliSessionId] || "").trim();
        return sdkTitle !== relayTitle;
      });
      if (toMigrate.length === 0) return;
      var migrated = 0;
      var failed = 0;
      var chain = Promise.resolve();
      for (var j = 0; j < toMigrate.length; j++) {
        (function(item) {
          chain = chain.then(function() {
            return adapter.renameSession(item.cliSessionId, item.title.trim(), { dir: migrateCwd }).then(function() {
              migrated++;
            }).catch(function(e) {
              failed++;
              _migrationFailedIds[item.cliSessionId] = true;
            });
          });
        })(toMigrate[j]);
      }
      chain.then(function() {
        if (migrated > 0) {
          console.log("[session] Migrated " + migrated + " session title(s) to SDK format");
        }
        if (failed > 0) {
          console.log("[session] Skipped " + failed + " session(s) (CLI session not found for current user)");
        }
      }).catch(function(e) {
        console.error("[session] Migration chain failed:", e.message || e);
      });
    }).catch(function() {});
  }

  return {
    get activeSessionId() { return activeSessionId; },
    get nextLocalId() { return nextLocalId; },
    get slashCommands() { return slashCommands; },
    set slashCommands(v) { slashCommands = v; },
    get slashCommandsByVendor() { return slashCommandsByVendor; },
    setSlashCommandsForVendor: function(vendor, cmds) {
      slashCommandsByVendor[vendor] = cmds || [];
    },
    getSlashCommandsForVendor: function(vendor) {
      return slashCommandsByVendor[vendor] || [];
    },
    get skillNames() { return skillNames; },
    set skillNames(v) { skillNames = v; },
    get capabilitiesByVendor() { return capabilitiesByVendor; },
    set capabilitiesByVendor(v) { capabilitiesByVendor = v; },
    get defaultVendor() { return defaultVendor; },
    set defaultVendor(v) { defaultVendor = v; },
    get codexApproval() { return codexApproval; },
    set codexApproval(v) { codexApproval = v; },
    get codexSandbox() { return codexSandbox; },
    set codexSandbox(v) { codexSandbox = v; },
    get codexWebSearch() { return codexWebSearch; },
    set codexWebSearch(v) { codexWebSearch = v; },
    sessions: sessions,
    sessionsDir: sessionsDir,
    HISTORY_PAGE_SIZE: HISTORY_PAGE_SIZE,
    getActiveSession: getActiveSession,
    createSession: createSession,
    createSessionRaw: createSessionRaw,
    switchSession: switchSession,
    deleteSession: deleteSession,
    deleteSessionQuiet: deleteSessionQuiet,
    deleteSessionsBulk: deleteSessionsBulk,
    resumeSession: resumeSession,
    broadcastSessionList: broadcastSessionList,
    getTotalUnread: function (ws) {
      var unreadMap = ws && ws._clayUnread ? ws._clayUnread : singleUserUnread;
      var total = 0;
      var keys = Object.keys(unreadMap);
      for (var i = 0; i < keys.length; i++) {
        total += unreadMap[keys[i]] || 0;
      }
      return total;
    },
    saveSessionFile: saveSessionFile,
    appendToSessionFile: appendToSessionFile,
    sendAndRecord: doSendAndRecord,
    sendToSession: doSendToSession,
    findTurnBoundary: findTurnBoundary,
    replayHistory: replayHistory,
    searchSessions: searchSessions,
    searchSessionContent: searchSessionContent,
    setResolveLoopInfo: setResolveLoopInfo,
    migrateSessionTitles: migrateSessionTitles,
    setSessionVisibility: function (localId, visibility) {
      var session = sessions.get(localId);
      if (!session) return { error: "Session not found" };
      session.sessionVisibility = visibility;
      saveSessionFile(session);
      broadcastSessionList();
      return { ok: true };
    },
    setSessionBookmarked: function (localId, bookmarked) {
      var session = sessions.get(localId);
      if (!session) return { error: "Session not found" };
      session.bookmarked = !!bookmarked;
      if (session.bookmarked) {
        var maxOrder = -1;
        sessions.forEach(function (s) {
          if (s.bookmarked && typeof s.favoriteOrder === "number" && s.favoriteOrder > maxOrder) {
            maxOrder = s.favoriteOrder;
          }
        });
        session.favoriteOrder = maxOrder + 1;
      } else {
        session.favoriteOrder = null;
      }
      saveSessionFile(session);
      broadcastSessionList();
      return { ok: true };
    },
    reorderBookmarkedSessions: function (sourceId, targetId, insertBefore) {
      var source = sessions.get(sourceId);
      var target = sessions.get(targetId);
      if (!source || !target) return { error: "Session not found" };
      if (!source.bookmarked || !target.bookmarked) return { error: "Only favorites can be reordered" };

      var favorites = [];
      sessions.forEach(function (s) {
        if (s.bookmarked) favorites.push(s);
      });
      favorites.sort(function (a, b) {
        var ao = typeof a.favoriteOrder === "number" ? a.favoriteOrder : Number.MAX_SAFE_INTEGER;
        var bo = typeof b.favoriteOrder === "number" ? b.favoriteOrder : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return (b.lastActivity || 0) - (a.lastActivity || 0);
      });

      var reordered = [];
      for (var i = 0; i < favorites.length; i++) {
        if (favorites[i].localId !== sourceId) reordered.push(favorites[i]);
      }

      var targetIdx = -1;
      for (var j = 0; j < reordered.length; j++) {
        if (reordered[j].localId === targetId) {
          targetIdx = j;
          break;
        }
      }
      if (targetIdx === -1) return { error: "Target favorite not found" };
      if (!insertBefore) targetIdx++;
      reordered.splice(targetIdx, 0, source);

      for (var k = 0; k < reordered.length; k++) {
        reordered[k].favoriteOrder = k;
        saveSessionFile(reordered[k]);
      }
      broadcastSessionList();
      return { ok: true };
    },
    setSessionOwner: function (localId, ownerId) {
      var session = sessions.get(localId);
      if (!session) return { error: "Session not found" };
      session.ownerId = ownerId;
      saveSessionFile(session);
      return { ok: true };
    },
    permissionRequestIndex: permissionRequestIndex,
  };
}

module.exports = { createSessionManager };
