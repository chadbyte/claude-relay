var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");
var { createSessionManager } = require("./sessions");
var { createSDKBridge, createMessageQueue } = require("./sdk-bridge");
var { createTerminalManager } = require("./terminal-manager");
var { createNotesManager } = require("./notes");
var { fetchLatestVersion, fetchVersion, isNewer } = require("./updater");
var { execFileSync, spawn } = require("child_process");
var usersModule = require("./users");
var { resolveOsUserInfo, fsAsUser } = require("./os-users");
var crisisSafety = require("./crisis-safety");
var matesModule = require("./mates");
var sessionSearch = require("./session-search");
var userPresence = require("./user-presence");
var { attachDebate } = require("./project-debate");
var { attachMemory } = require("./project-memory");
var { attachMateInteraction } = require("./project-mate-interaction");
var { attachLoop } = require("./project-loop");
var { attachFileWatch } = require("./project-file-watch");
var { attachHTTP } = require("./project-http");
var { attachImage } = require("./project-image");
var { attachKnowledge } = require("./project-knowledge");
var { attachFilesystem } = require("./project-filesystem");
var { attachSessions } = require("./project-sessions");
var { attachUserMessage } = require("./project-user-message");
var { attachConnection } = require("./project-connection");

// --- Context Sources persistence ---
var _ctxSrcConfig = require("./config");
var _ctxSrcDir = path.join(_ctxSrcConfig.CONFIG_DIR, "context-sources");

function loadContextSources(slug) {
  try {
    var filePath = path.join(_ctxSrcDir, slug + ".json");
    var data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return data.active || [];
  } catch (e) {
    return [];
  }
}

function saveContextSources(slug, activeIds) {
  try {
    if (!fs.existsSync(_ctxSrcDir)) {
      fs.mkdirSync(_ctxSrcDir, { recursive: true });
    }
    var filePath = path.join(_ctxSrcDir, slug + ".json");
    fs.writeFileSync(filePath, JSON.stringify({ active: activeIds }), "utf8");
  } catch (e) {
    console.error("[context-sources] Failed to save:", e.message);
  }
}

// Validate environment variable string (KEY=VALUE per line)
// Returns null if valid, or an error string if invalid
function validateEnvString(str) {
  if (!str || !str.trim()) return null;
  var lines = str.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) === "#") continue;
    // Must be KEY=VALUE format
    var eqIdx = line.indexOf("=");
    if (eqIdx < 1) return "Invalid format at line " + (i + 1) + ": expected KEY=VALUE";
    var key = line.substring(0, eqIdx);
    // Key must be valid env var name (no shell metacharacters)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      return "Invalid variable name at line " + (i + 1) + ": " + key;
    }
    // Value must not contain shell injection characters
    var value = line.substring(eqIdx + 1);
    if (/[`$\\;|&><(){}\n]/.test(value) && !/^["'].*["']$/.test(value)) {
      return "Potentially unsafe value at line " + (i + 1) + ": shell metacharacters detected";
    }
  }
  return null;
}

// SDK loaded dynamically (ESM module)
var sdkModule = null;
function getSDK() {
  if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");
  return sdkModule;
}

// --- Shared constants ---
var IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "__pycache__", ".cache", "dist", "build", ".clay", ".claude-relay"]);
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

// Resolve an absolute path without requiring it to be within cwd.
// Used as fallback in OS user mode where ACL enforces access at the OS level.
function safeAbsPath(requested) {
  if (!requested) return null;
  var resolved = path.resolve(requested);
  try {
    return fs.realpathSync(resolved);
  } catch (e) {
    return null;
  }
}

/**
 * Create a project context — per-project state and handlers.
 * opts: { cwd, slug, title, pushModule, debug, dangerouslySkipPermissions, currentVersion }
 */
function createProjectContext(opts) {
  var cwd = opts.cwd;
  var slug = opts.slug;
  var project = path.basename(cwd);
  var title = opts.title || null;
  var icon = opts.icon || null;
  var pushModule = opts.pushModule || null;
  var debug = opts.debug || false;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var currentVersion = opts.currentVersion;
  var lanHost = opts.lanHost || null;
  var getProjectCount = opts.getProjectCount || function () { return 1; };
  var getProjectList = opts.getProjectList || function () { return []; };
  var getAllProjectSessions = opts.getAllProjectSessions || function () { return []; };
  var getHubSchedules = opts.getHubSchedules || function () { return []; };
  var moveScheduleToProject = opts.moveScheduleToProject || function () { return { ok: false, error: "Not supported" }; };
  var moveAllSchedulesToProject = opts.moveAllSchedulesToProject || function () { return { ok: false, error: "Not supported" }; };
  var getScheduleCount = opts.getScheduleCount || function () { return 0; };
  var onProcessingChanged = opts.onProcessingChanged || function () {};
  var onSessionDone = opts.onSessionDone || function () {};
  var onPresenceChange = opts.onPresenceChange || function () {};
  var updateChannel = opts.updateChannel || "stable";
  var osUsers = opts.osUsers || false;
  var projectOwnerId = opts.projectOwnerId || null;
  var worktreeMeta = opts.worktreeMeta || null; // { parentSlug, branch, accessible }
  var isMate = opts.isMate || false;
  var onCreateWorktree = opts.onCreateWorktree || null;
  var serverPort = opts.port || 2633;
  var serverTls = opts.tls || false;
  var latestVersion = null;

  // Browser MCP server runs in-process via createSdkMcpServer (no child process spawn).
  // Do NOT write to .claude-local/settings.json -- the SDK reads that too, causing duplicate spawns.

  // --- Image engine (delegated to project-image.js) ---
  var _image = attachImage({ cwd: cwd, slug: slug });
  var imagesDir = _image.imagesDir;
  var hydrateImageRefs = _image.hydrateImageRefs;
  var saveImageFile = _image.saveImageFile;

  // --- OS-level user isolation helper ---
  // Returns the Linux username for the session owner.
  // Each session uses its own owner's Claude account and credits.
  function getLinuxUserForSession(session) {
    if (!osUsers) return null;
    if (!session.ownerId) return null;
    var user = usersModule.findUserById(session.ownerId);
    if (!user || !user.linuxUser) return null;
    return user.linuxUser;
  }

  function getLinuxUserForWs(ws) {
    if (!osUsers) return null;
    if (!ws._clayUser || !ws._clayUser.linuxUser) return null;
    return ws._clayUser.linuxUser;
  }

  // Cache resolved OS user info to avoid repeated getent calls
  var osUserInfoCache = {};
  function getOsUserInfoForWs(ws) {
    var linuxUser = getLinuxUserForWs(ws);
    if (!linuxUser) return null;
    if (osUserInfoCache[linuxUser]) return osUserInfoCache[linuxUser];
    try {
      var info = resolveOsUserInfo(linuxUser);
      osUserInfoCache[linuxUser] = info;
      return info;
    } catch (e) {
      console.error("[project] Failed to resolve OS user info for " + linuxUser + ":", e.message);
      return null;
    }
  }

  function getOsUserInfoForReq(req) {
    if (!osUsers) return null;
    if (!req._clayUser || !req._clayUser.linuxUser) return null;
    var linuxUser = req._clayUser.linuxUser;
    if (osUserInfoCache[linuxUser]) return osUserInfoCache[linuxUser];
    try {
      var info = resolveOsUserInfo(linuxUser);
      osUserInfoCache[linuxUser] = info;
      return info;
    } catch (e) {
      console.error("[project] Failed to resolve OS user info for " + linuxUser + ":", e.message);
      return null;
    }
  }

  // --- Per-project clients ---
  var clients = new Set();

  // --- Browser extension state ---
  var _browserTabList = {}; // tabId -> { id, url, title, favIconUrl }
  var _pendingDebateProposals = {}; // proposalId -> { resolve, briefData }
  var _extensionWs = null; // WebSocket of the client with the Chrome extension
  var _extToken = crypto.randomUUID(); // Auth token for MCP server bridge
  var pendingExtensionRequests = {}; // requestId -> { resolve, timer }

  function sendExtensionCommand(ws, command, args, timeout) {
    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      var ms = timeout || 3000;
      var timer = setTimeout(function() {
        delete pendingExtensionRequests[requestId];
        resolve(null);
      }, ms);
      pendingExtensionRequests[requestId] = { resolve: resolve, timer: timer };
      sendTo(ws, {
        type: "extension_command",
        command: command,
        args: args,
        requestId: requestId
      });
    });
  }

  // Send extension command via the tracked extension client (for MCP bridge)
  function sendExtensionCommandAny(command, args, timeout) {
    if (!_extensionWs || _extensionWs.readyState !== 1) {
      return Promise.reject(new Error("Browser extension not connected"));
    }
    return sendExtensionCommand(_extensionWs, command, args, timeout);
  }

  function requestTabContext(ws, tabId) {
    // Try inject first (best-effort), then request all data in parallel.
    // Even if inject fails (CSP etc.), page text and screenshot still work.
    return sendExtensionCommand(ws, "tab_inject", { tabId: tabId }).then(function() {}, function() {}).then(function() {
      return Promise.all([
        sendExtensionCommand(ws, "tab_console", { tabId: tabId }),
        sendExtensionCommand(ws, "tab_network", { tabId: tabId }),
        sendExtensionCommand(ws, "tab_page_text", { tabId: tabId }),
        sendExtensionCommand(ws, "tab_screenshot", { tabId: tabId })
      ]);
    }).then(function(results) {
      return {
        console: results[0],
        network: results[1],
        pageText: results[2],
        screenshot: results[3]
      };
    }).catch(function() {
      return null;
    });
  }

  function send(obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  function sendTo(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function sendToAdmins(obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws.readyState === 1 && ws._clayUser && ws._clayUser.role === "admin") ws.send(data);
    }
  }

  function broadcastClientCount() {
    var msg = { type: "client_count", count: clients.size };
    if (usersModule.isMultiUser()) {
      var seen = {};
      var userList = [];
      for (var c of clients) {
        if (!c._clayUser) continue;
        var u = c._clayUser;
        if (seen[u.id]) continue;
        seen[u.id] = true;
        var p = u.profile || {};
        userList.push({
          id: u.id,
          displayName: p.name || u.displayName || u.username,
          username: u.username,
          avatarStyle: p.avatarStyle || "thumbs",
          avatarSeed: p.avatarSeed || u.username,
          avatarCustom: p.avatarCustom || "",
        });
      }
      msg.users = userList;
    }
    send(msg);
    onPresenceChange();
  }

  function sendToOthers(sender, obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws !== sender && ws.readyState === 1) ws.send(data);
    }
  }

  function sendToSession(sessionId, obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws.readyState === 1 && ws._clayActiveSession === sessionId) {
        ws.send(data);
      }
    }
  }

  function sendToSessionOthers(sender, sessionId, obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws !== sender && ws.readyState === 1 && ws._clayActiveSession === sessionId) {
        ws.send(data);
      }
    }
  }

  // --- Knowledge engine (delegated to project-knowledge.js) ---
  var _knowledge = attachKnowledge({
    cwd: cwd,
    isMate: isMate,
    sendTo: sendTo,
    matesModule: matesModule,
    getProjectOwnerId: function () { return projectOwnerId; },
  });

  // --- File/directory watcher engine (delegated to project-file-watch.js) ---
  var _fileWatch = attachFileWatch({
    cwd: cwd,
    send: send,
    safePath: safePath,
    BINARY_EXTS: BINARY_EXTS,
    FS_MAX_SIZE: FS_MAX_SIZE,
    IGNORED_DIRS: IGNORED_DIRS,
  });
  var startFileWatch = _fileWatch.startFileWatch;
  var stopFileWatch = _fileWatch.stopFileWatch;
  var startDirWatch = _fileWatch.startDirWatch;
  var stopDirWatch = _fileWatch.stopDirWatch;
  var stopAllDirWatches = _fileWatch.stopAllDirWatches;

  // --- Session manager ---
  var sm = createSessionManager({
    cwd: cwd,
    send: send,
    sendTo: sendTo,
    sendEach: function (fn) {
      for (var ws of clients) {
        var user = ws._clayUser;
        var filterFn = null;
        if (usersModule.isMultiUser() && user) {
          filterFn = (function (u) {
            return function (s) {
              return usersModule.canAccessSession(u.id, s, { visibility: "public" });
            };
          })(user);
        }
        fn(ws, filterFn);
      }
    },
    onSessionDone: onSessionDone,
  });
  var _projMode = typeof opts.onGetProjectDefaultMode === "function" ? opts.onGetProjectDefaultMode(slug) : null;
  var _srvMode = typeof opts.onGetServerDefaultMode === "function" ? opts.onGetServerDefaultMode() : null;
  sm._savedDefaultMode = (_projMode && _projMode.mode) || (_srvMode && _srvMode.mode) || "default";
  // Immediately apply the saved default so config_state on connect reflects it
  // before the SDK has warmed up and fired system/init.
  if (sm._savedDefaultMode) sm.currentPermissionMode = sm._savedDefaultMode;

  var _projEffort = typeof opts.onGetProjectDefaultEffort === "function" ? opts.onGetProjectDefaultEffort(slug) : null;
  var _srvEffort = typeof opts.onGetServerDefaultEffort === "function" ? opts.onGetServerDefaultEffort() : null;
  sm.currentEffort = (_projEffort && _projEffort.effort) || (_srvEffort && _srvEffort.effort) || "medium";

  var _projModel = typeof opts.onGetProjectDefaultModel === "function" ? opts.onGetProjectDefaultModel(slug) : null;
  var _srvModel = typeof opts.onGetServerDefaultModel === "function" ? opts.onGetServerDefaultModel() : null;
  sm._savedDefaultModel = (_projModel && _projModel.model) || (_srvModel && _srvModel.model) || null;
  // Immediately apply the saved default so config_state on connect reflects it
  // before the SDK has warmed up and fired system/init.
  if (sm._savedDefaultModel) sm.currentModel = sm._savedDefaultModel;

  // --- SDK bridge ---
  var sdk = createSDKBridge({
    cwd: cwd,
    slug: slug,
    sessionManager: sm,
    send: send,
    pushModule: pushModule,
    getSDK: getSDK,
    mateDisplayName: opts.mateDisplayName || "",
    isMate: isMate,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    mcpServers: (function () {
      var servers = {};

      // Debate MCP server (available to both mates and main project)
      try {
        var debateMcp = require("./debate-mcp-server");
        var debateMcpConfig = debateMcp.create(function onPropose(briefData) {
          return new Promise(function (resolve) {
            var proposalId = "dp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
            briefData.proposalId = proposalId;
            _pendingDebateProposals[proposalId] = {
              resolve: resolve,
              briefData: briefData,
            };
            // The SDK sends tool_executing with briefData as input.
            // Client renders the debate brief card when it sees propose_debate.
          });
        });
        if (debateMcpConfig) servers[debateMcpConfig.name || "clay-debate"] = debateMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create debate MCP server:", e.message);
      }

      // Browser MCP server (main project only, not mates)
      if (!isMate) {
        try {
          var browserMcp = require("./browser-mcp-server");
          var mcpConfig = browserMcp.create(sendExtensionCommandAny, function () {
            return Object.values(_browserTabList || {});
          }, {
            watchTab: function (tabId) {
              var key = "tab:" + tabId;
              var active = loadContextSources(slug);
              if (active.indexOf(key) === -1) {
                active.push(key);
                saveContextSources(slug, active);
                var _msg = JSON.stringify({ type: "context_sources_state", active: active });
                for (var c of clients) { if (c.readyState === 1) c.send(_msg); }
              }
              return active;
            },
            unwatchTab: function (tabId) {
              var key = "tab:" + tabId;
              var active = loadContextSources(slug);
              var idx = active.indexOf(key);
              if (idx !== -1) {
                active.splice(idx, 1);
                saveContextSources(slug, active);
                var _msg = JSON.stringify({ type: "context_sources_state", active: active });
                for (var c of clients) { if (c.readyState === 1) c.send(_msg); }
              }
              return active;
            },
          });
          if (mcpConfig) servers[mcpConfig.name || "clay-browser"] = mcpConfig;
        } catch (e) {
          console.error("[project] Failed to create browser MCP server:", e.message);
        }
      }

      return Object.keys(servers).length > 0 ? servers : undefined;
    })(),
    onProcessingChanged: onProcessingChanged,
    onTurnDone: isMate ? function (session, preview) {
      digestDmTurn(session, preview);
    } : null,
    scheduleMessage: function (session, text, resetsAt) {
      scheduleMessage(session, text, resetsAt);
    },
    getAutoContinueSetting: function (session) {
      // Per-user setting in multi-user mode
      if (usersModule.isMultiUser() && session && session.ownerId) {
        return usersModule.getAutoContinue(session.ownerId);
      }
      // Single-user: fall back to daemon config
      if (typeof opts.onGetDaemonConfig === "function") {
        var dc = opts.onGetDaemonConfig();
        return !!dc.autoContinueOnRateLimit;
      }
      return false;
    },
  });

  // --- Loop engine (delegated to project-loop.js) ---
  var _loop = attachLoop({
    cwd: cwd,
    slug: slug,
    sm: sm,
    sdk: sdk,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    pushModule: pushModule,
    getHubSchedules: getHubSchedules,
    getLinuxUserForSession: getLinuxUserForSession,
    onProcessingChanged: onProcessingChanged,
    hydrateImageRefs: hydrateImageRefs,
  });
  var loopState = _loop.loopState;
  var loopRegistry = _loop.loopRegistry;
  var loopDir = _loop.loopDir;
  var startLoop = _loop.startLoop;
  var stopLoop = _loop.stopLoop;
  var resumeLoop = _loop.resumeLoop;

  // Mate CLAUDE.md crisis safety watcher
  var crisisWatcher = null;
  var crisisDebounce = null;



  // --- Terminal manager ---
  var tm = createTerminalManager({ cwd: cwd, send: send, sendTo: sendTo });
  var nm = createNotesManager({ cwd: cwd, send: send, sendTo: sendTo });

  // Check for updates in background (admin only)
  fetchVersion(updateChannel).then(function (v) {
    if (v && isNewer(v, currentVersion)) {
      latestVersion = v;
      sendToAdmins({ type: "update_available", version: v });
    }
  }).catch(function (e) {
    console.error("[project] Background version check failed:", e.message || e);
  });

  // --- WS connection handler (delegated to project-connection.js) ---
  function handleConnection(ws, wsUser) {
    _connection.handleConnection(ws, wsUser, handleMessage, handleDisconnection);
  }

  // --- WS message handler ---
  function getSessionForWs(ws) {
    return sm.sessions.get(ws._clayActiveSession) || null;
  }

  // --- Schedule / cancel a message (used by WS handler and auto-continue) ---
  function scheduleMessage(session, text, resetsAt) {
    if (!session || !text || !resetsAt) return;
    // Cancel any existing scheduled message
    if (session.scheduledMessage && session.scheduledMessage.timer) {
      clearTimeout(session.scheduledMessage.timer);
    }
    var isPastReset = resetsAt <= Date.now();
    var schedDelay = isPastReset ? 5000 : Math.max(0, resetsAt - Date.now()) + 60000; // +1min buffer after reset, or 5s for immediate
    var sendsAt = Date.now() + schedDelay;
    var schedEntry = {
      type: "scheduled_message_queued",
      text: text,
      resetsAt: sendsAt,
      scheduledAt: Date.now(),
    };
    sm.sendAndRecord(session, schedEntry);
    session.scheduledMessage = {
      text: text,
      resetsAt: resetsAt,
      timer: setTimeout(function () {
        session.scheduledMessage = null;
        if (session.destroying) return;
        console.log("[project] Scheduled message firing for session " + session.localId);
        sm.sendAndRecord(session, { type: "scheduled_message_sent" });
        var schedUserMsg = { type: "user_message", text: text };
        session.history.push(schedUserMsg);
        sm.appendToSessionFile(session, schedUserMsg);
        sendToSession(session.localId, schedUserMsg);
        session.isProcessing = true;
        onProcessingChanged();
        sendToSession(session.localId, { type: "status", status: "processing" });
        sdk.startQuery(session, text, null, getLinuxUserForSession(session));
        sm.broadcastSessionList();
      }, schedDelay),
    };
  }

  function cancelScheduledMessage(session) {
    if (!session) return;
    if (session.scheduledMessage && session.scheduledMessage.timer) {
      clearTimeout(session.scheduledMessage.timer);
      session.scheduledMessage = null;
      session.rateLimitAutoContinuePending = false;
      sm.sendAndRecord(session, { type: "scheduled_message_cancelled" });
    }
  }

  function handleMessage(ws, msg) {
    // --- DM messages (delegated to server-level handler) ---
    if (msg.type === "dm_open" || msg.type === "dm_send" || msg.type === "dm_list" || msg.type === "dm_typing" || msg.type === "dm_add_favorite" || msg.type === "dm_remove_favorite" || msg.type === "mate_create" || msg.type === "mate_list" || msg.type === "mate_delete" || msg.type === "mate_update" || msg.type === "mate_readd_builtin" || msg.type === "mate_list_available_builtins") {
      if (typeof opts.onDmMessage === "function") {
        opts.onDmMessage(ws, msg);
      }
      return;
    }

    // --- @Mention: invoke another Mate inline ---
    if (msg.type === "mention") {
      handleMention(ws, msg);
      return;
    }

    if (msg.type === "mention_stop") {
      var session = getSessionForWs(ws);
      if (session && session._mentionInProgress) {
        // Abort the active mention session for this mate
        var mateId = msg.mateId;
        if (mateId && session._mentionSessions && session._mentionSessions[mateId]) {
          session._mentionSessions[mateId].abort();
          session._mentionSessions[mateId].close();
          delete session._mentionSessions[mateId];
        }
        session._mentionInProgress = false;
        sendToSession(session.localId, { type: "mention_done", mateId: mateId, stopped: true });
        send({ type: "mention_processing", mateId: mateId, active: false });
      }
      return;
    }

    // --- Debate ---
    if (msg.type === "debate_start") {
      handleDebateStart(ws, msg);
      return;
    }
    if (msg.type === "debate_hand_raise") {
      handleDebateHandRaise(ws);
      return;
    }
    if (msg.type === "debate_comment") {
      handleDebateComment(ws, msg);
      return;
    }
    if (msg.type === "debate_stop") {
      handleDebateStop(ws);
      return;
    }
    if (msg.type === "debate_conclude_response") {
      handleDebateConcludeResponse(ws, msg);
      return;
    }
    if (msg.type === "debate_confirm_brief") {
      handleDebateConfirmBrief(ws);
      return;
    }
    if (msg.type === "debate_proposal_response") {
      // Match the most recent pending proposal (proposalId may not be
      // available on the client since it's not part of the tool input)
      var _dpKeys = Object.keys(_pendingDebateProposals);
      if (_dpKeys.length === 0) return;
      var _dpKey = msg.proposalId || _dpKeys[_dpKeys.length - 1];
      var pending = _pendingDebateProposals[_dpKey];
      if (!pending) return;
      delete _pendingDebateProposals[_dpKey];
      if (msg.action === "start") {
        // Set up debate state on the session, then transition to live
        var _dpSession = getSessionForWs(ws);
        if (_dpSession) {
          var _dpMateId = isMate ? path.basename(cwd) : null;
          handleMcpDebateApproval(_dpSession, pending.briefData, _dpMateId, ws);
        }
        pending.resolve({ action: "start" });
      } else {
        pending.resolve({ action: "cancel" });
      }
      return;
    }
    if (msg.type === "debate_user_floor_response") {
      handleDebateUserFloorResponse(ws, msg);
      return;
    }

    // --- Knowledge file management (delegated to project-knowledge.js) ---
    if (_knowledge.handleKnowledgeMessage(ws, msg)) return;

    // --- Memory (session digests) management (delegated to project-memory.js) ---
    if (msg.type === "memory_list") { _memory.handleMemoryList(ws); return; }
    if (msg.type === "memory_search") { _memory.handleMemorySearch(ws, msg); return; }
    if (msg.type === "memory_delete") { _memory.handleMemoryDelete(ws, msg); return; }

    // --- Sessions, config, project mgmt (delegated to project-sessions.js) ---
    if (_sessions.handleSessionsMessage(ws, msg)) return;

    // --- Filesystem, settings, env (delegated to project-filesystem.js) ---
    if (_filesystem.handleFilesystemMessage(ws, msg)) return;

    // --- Notes, terminals, context, user message (delegated to project-user-message.js) ---
    if (_userMessage.handleUserMessage(ws, msg)) return;
  }

  // --- Shared helpers ---

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // --- Memory engine (delegated to project-memory.js) ---
  var _memory = attachMemory({
    cwd: cwd,
    sm: sm,
    sdk: sdk,
    sendTo: sendTo,
    matesModule: matesModule,
    sessionSearch: sessionSearch,
    getAllProjectSessions: getAllProjectSessions,
    projectOwnerId: projectOwnerId,
    handleMessage: handleMessage,
  });
  var loadMateDigests = _memory.loadMateDigests;
  var gateMemory = _memory.gateMemory;
  var updateMemorySummary = _memory.updateMemorySummary;
  var initMemorySummary = _memory.initMemorySummary;

  // --- Mate interaction engine (delegated to project-mate-interaction.js) ---
  // Note: checkForDmDebateBrief comes from _debate (initialized below),
  // so we use a lazy getter that resolves at call time.
  var _mateInteraction = attachMateInteraction({
    cwd: cwd,
    sm: sm,
    sdk: sdk,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    sendToSessionOthers: sendToSessionOthers,
    matesModule: matesModule,
    isMate: isMate,
    projectOwnerId: projectOwnerId,
    getSessionForWs: getSessionForWs,
    getLinuxUserForSession: getLinuxUserForSession,
    saveImageFile: saveImageFile,
    hydrateImageRefs: hydrateImageRefs,
    onProcessingChanged: onProcessingChanged,
    loadMateDigests: loadMateDigests,
    updateMemorySummary: updateMemorySummary,
    initMemorySummary: initMemorySummary,
    get checkForDmDebateBrief() { return checkForDmDebateBrief; },
  });
  var handleMention = _mateInteraction.handleMention;
  var getMateProfile = _mateInteraction.getMateProfile;
  var loadMateClaudeMd = _mateInteraction.loadMateClaudeMd;
  var digestDmTurn = _mateInteraction.digestDmTurn;
  var enqueueDigest = _mateInteraction.enqueueDigest;

  // --- Debate engine (delegated to project-debate.js) ---
  var _debate = attachDebate({
    cwd: cwd,
    slug: slug,
    isMate: isMate,
    projectOwnerId: projectOwnerId,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    sm: sm,
    sdk: sdk,
    getMateProfile: getMateProfile,
    loadMateClaudeMd: loadMateClaudeMd,
    loadMateDigests: loadMateDigests,
    hydrateImageRefs: hydrateImageRefs,
    onProcessingChanged: onProcessingChanged,
    getLinuxUserForSession: getLinuxUserForSession,
    getSessionForWs: getSessionForWs,
    updateMemorySummary: updateMemorySummary,
    initMemorySummary: initMemorySummary,
  });
  var handleDebateStart = _debate.handleDebateStart;
  var handleDebateHandRaise = _debate.handleDebateHandRaise;
  var handleDebateComment = _debate.handleDebateComment;
  var handleDebateStop = _debate.handleDebateStop;
  var handleDebateConcludeResponse = _debate.handleDebateConcludeResponse;
  var handleDebateConfirmBrief = _debate.handleDebateConfirmBrief;
  var handleDebateUserFloorResponse = _debate.handleDebateUserFloorResponse;
  var restoreDebateState = _debate.restoreDebateState;
  var checkForDmDebateBrief = _debate.checkForDmDebateBrief;
  var handleMcpDebateApproval = _debate.handleMcpDebateApproval;

  // --- Session presence (who is viewing which session) ---
  function broadcastPresence() {
    if (!usersModule.isMultiUser()) return;
    var presence = {};
    for (var c of clients) {
      if (!c._clayUser || !c._clayActiveSession) continue;
      var sid = c._clayActiveSession;
      if (!presence[sid]) presence[sid] = [];
      var u = c._clayUser;
      var p = u.profile || {};
      // Deduplicate: skip if this user is already listed for this session
      var dominated = false;
      for (var di = 0; di < presence[sid].length; di++) {
        if (presence[sid][di].id === u.id) { dominated = true; break; }
      }
      if (dominated) continue;
      presence[sid].push({
        id: u.id,
        displayName: p.name || u.displayName || u.username,
        username: u.username,
        avatarStyle: p.avatarStyle || "thumbs",
        avatarSeed: p.avatarSeed || u.username,
        avatarCustom: p.avatarCustom || "",
      });
    }
    send({ type: "session_presence", presence: presence });
  }

  // --- WS disconnection handler (delegated to project-connection.js) ---
  function handleDisconnection(ws) {
    _connection.handleDisconnection(ws);
  }

  // --- Sessions/config/project handler (delegated to project-sessions.js) ---
  var _sessions = attachSessions({
    cwd: cwd,
    slug: slug,
    isMate: isMate,
    osUsers: osUsers,
    debug: debug,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    currentVersion: currentVersion,
    sm: sm,
    sdk: sdk,
    tm: tm,
    clients: clients,
    send: send,
    sendTo: sendTo,
    sendToAdmins: sendToAdmins,
    sendToSession: sendToSession,
    sendToSessionOthers: sendToSessionOthers,
    opts: opts,
    usersModule: usersModule,
    userPresence: userPresence,
    matesModule: matesModule,
    pushModule: pushModule,
    getSessionForWs: getSessionForWs,
    getLinuxUserForSession: getLinuxUserForSession,
    getOsUserInfoForWs: getOsUserInfoForWs,
    hydrateImageRefs: hydrateImageRefs,
    onProcessingChanged: onProcessingChanged,
    broadcastPresence: broadcastPresence,
    getSDK: getSDK,
    getProjectList: getProjectList,
    getProjectCount: getProjectCount,
    getScheduleCount: getScheduleCount,
    moveScheduleToProject: moveScheduleToProject,
    moveAllSchedulesToProject: moveAllSchedulesToProject,
    getHubSchedules: getHubSchedules,
    fetchVersion: fetchVersion,
    isNewer: isNewer,
    scheduleMessage: scheduleMessage,
    cancelScheduledMessage: cancelScheduledMessage,
    getProjectOwnerId: function () { return projectOwnerId; },
    setProjectOwnerId: function (id) { projectOwnerId = id; },
    getUpdateChannel: function () { return updateChannel; },
    setUpdateChannel: function (ch) { updateChannel = ch; },
    getLatestVersion: function () { return latestVersion; },
    setLatestVersion: function (v) { latestVersion = v; },
  });

  // --- User message handler (delegated to project-user-message.js) ---
  var _userMessage = attachUserMessage({
    cwd: cwd,
    slug: slug,
    isMate: isMate,
    osUsers: osUsers,
    sm: sm,
    sdk: sdk,
    nm: nm,
    tm: tm,
    clients: clients,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    sendToSessionOthers: sendToSessionOthers,
    opts: opts,
    usersModule: usersModule,
    matesModule: matesModule,
    getSessionForWs: getSessionForWs,
    getLinuxUserForSession: getLinuxUserForSession,
    hydrateImageRefs: hydrateImageRefs,
    saveImageFile: saveImageFile,
    imagesDir: imagesDir,
    onProcessingChanged: onProcessingChanged,
    _loop: _loop,
    browserState: { _browserTabList: _browserTabList, _extensionWs: _extensionWs, pendingExtensionRequests: pendingExtensionRequests },
    sendExtensionCommandAny: sendExtensionCommandAny,
    scheduleMessage: scheduleMessage,
    cancelScheduledMessage: cancelScheduledMessage,
    loadContextSources: loadContextSources,
    saveContextSources: saveContextSources,
    digestDmTurn: digestDmTurn,
    gateMemory: gateMemory,
    escapeRegex: escapeRegex,
    getSDK: getSDK,
    getHubSchedules: getHubSchedules,
    getProjectOwnerId: function () { return projectOwnerId; },
  });

  // --- Filesystem handler (delegated to project-filesystem.js) ---
  var _filesystem = attachFilesystem({
    cwd: cwd,
    slug: slug,
    osUsers: osUsers,
    sm: sm,
    send: send,
    sendTo: sendTo,
    safePath: safePath,
    safeAbsPath: safeAbsPath,
    getOsUserInfoForWs: getOsUserInfoForWs,
    startFileWatch: startFileWatch,
    stopFileWatch: stopFileWatch,
    startDirWatch: startDirWatch,
    usersModule: usersModule,
    fsAsUser: fsAsUser,
    validateEnvString: validateEnvString,
    opts: opts,
    IGNORED_DIRS: IGNORED_DIRS,
    BINARY_EXTS: BINARY_EXTS,
    IMAGE_EXTS: IMAGE_EXTS,
    FS_MAX_SIZE: FS_MAX_SIZE,
  });

  // --- HTTP handler (delegated to project-http.js) ---
  var _http = attachHTTP({
    cwd: cwd,
    slug: slug,
    project: title || project,
    sm: sm,
    send: send,
    imagesDir: imagesDir,
    osUsers: osUsers,
    pushModule: pushModule,
    safePath: safePath,
    safeAbsPath: safeAbsPath,
    getOsUserInfoForReq: getOsUserInfoForReq,
    sendExtensionCommandAny: sendExtensionCommandAny,
    _extToken: _extToken,
    _browserTabList: _browserTabList,
  });
  var handleHTTP = _http.handleHTTP;

  // --- Connection handler (delegated to project-connection.js) ---
  var _connection = attachConnection({
    cwd: cwd,
    slug: slug,
    isMate: isMate,
    osUsers: osUsers,
    debug: debug,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    currentVersion: currentVersion,
    lanHost: lanHost,
    sm: sm,
    tm: tm,
    nm: nm,
    clients: clients,
    send: send,
    sendTo: sendTo,
    opts: opts,
    _loop: _loop,
    hydrateImageRefs: hydrateImageRefs,
    broadcastClientCount: broadcastClientCount,
    broadcastPresence: broadcastPresence,
    getProjectList: getProjectList,
    getHubSchedules: getHubSchedules,
    loadContextSources: loadContextSources,
    restoreDebateState: restoreDebateState,
    stopFileWatch: stopFileWatch,
    stopAllDirWatches: stopAllDirWatches,
    getProjectOwnerId: function () { return projectOwnerId; },
    setProjectOwnerId: function (id) { projectOwnerId = id; },
    getLatestVersion: function () { return latestVersion; },
    getTitle: function () { return title; },
    getProject: function () { return project; },
  });

  // --- Destroy ---
  function destroy() {
    _loop.stopTimer();
    stopFileWatch();
    stopAllDirWatches();
    // Abort all active sessions and clean up mention sessions
    sm.sessions.forEach(function (session) {
      session.destroying = true;
      if (session.autoContinueTimer) {
        clearTimeout(session.autoContinueTimer);
        session.autoContinueTimer = null;
      }
      if (session.scheduledMessage && session.scheduledMessage.timer) {
        clearTimeout(session.scheduledMessage.timer);
        session.scheduledMessage = null;
      }
      if (session.abortController) {
        try { session.abortController.abort(); } catch (e) {}
      }
      // Close SDK query to terminate the underlying claude child process
      if (session.queryInstance && typeof session.queryInstance.close === "function") {
        try { session.queryInstance.close(); } catch (e) {}
      }
      session.queryInstance = null;
      if (session.messageQueue) {
        try { session.messageQueue.end(); } catch (e) {}
      }
      if (session.worker) {
        try { session.worker.kill(); } catch (e) {}
        session.worker = null;
      }
      // Close all mention SDK sessions to prevent zombie processes
      if (session._mentionSessions) {
        var mateIds = Object.keys(session._mentionSessions);
        for (var mi = 0; mi < mateIds.length; mi++) {
          try { session._mentionSessions[mateIds[mi]].close(); } catch (e) {}
        }
        session._mentionSessions = {};
      }
    });
    // Kill all terminals
    tm.destroyAll();
    for (var ws of clients) {
      try { ws.close(); } catch (e) {}
    }
    clients.clear();
    // Cleanup tmp upload directory
    try {
      var cwdHash = crypto.createHash("sha256").update(cwd).digest("hex").substring(0, 12);
      var tmpDir = path.join(os.tmpdir(), "clay-" + cwdHash);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  }

  // --- Status info ---
  function getStatus() {
    var sessionCount = sm.sessions.size;
    var hasProcessing = false;
    var pendingPermCount = 0;
    sm.sessions.forEach(function (s) {
      if (s.isProcessing) hasProcessing = true;
      if (s.pendingPermissions) {
        pendingPermCount += Object.keys(s.pendingPermissions).length;
      }
    });
    var status = {
      slug: slug,
      path: cwd,
      project: project,
      title: title,
      icon: icon,
      clients: clients.size,
      sessions: sessionCount,
      isProcessing: hasProcessing,
      pendingPermissions: pendingPermCount,
      projectOwnerId: projectOwnerId,
    };
    if (isMate) {
      status.isMate = true;
      status.mateId = path.basename(cwd);
    }
    if (worktreeMeta) {
      status.isWorktree = true;
      status.parentSlug = worktreeMeta.parentSlug;
      status.branch = worktreeMeta.branch;
      status.worktreeAccessible = worktreeMeta.accessible;
    }
    if (usersModule.isMultiUser()) {
      var seen = {};
      var onlineUsers = [];
      for (var c of clients) {
        if (!c._clayUser) continue;
        var u = c._clayUser;
        if (seen[u.id]) continue;
        seen[u.id] = true;
        var p = u.profile || {};
        onlineUsers.push({
          id: u.id,
          displayName: p.name || u.displayName || u.username,
          username: u.username,
          avatarStyle: p.avatarStyle || "thumbs",
          avatarSeed: p.avatarSeed || u.username,
          avatarCustom: p.avatarCustom || "",
        });
      }
      status.onlineUsers = onlineUsers;
    }
    return status;
  }

  function setTitle(newTitle) {
    title = newTitle || null;
    send({ type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, osUsers: osUsers, lanHost: lanHost, projectCount: getProjectCount(), projects: getProjectList(), projectOwnerId: projectOwnerId });
  }

  function setIcon(newIcon) {
    icon = newIcon || null;
  }

  // Mate projects: watch CLAUDE.md and enforce system-managed sections
  if (isMate) {
    var claudeMdPath = path.join(cwd, "CLAUDE.md");
    // Derive mateId from cwd (last path segment) and build ctx for dynamic team section
    var _mateId = path.basename(cwd);
    var _mateCtx = matesModule.buildMateCtx(projectOwnerId);
    // Collect non-mate projects for project registry injection
    var _projectList = (getProjectList() || []).filter(function (p) { return !p.isMate; });
    var _enforceOpts = { ctx: _mateCtx, mateId: _mateId, projects: _projectList };
    // Enforce all system sections atomically on startup (single read/write)
    var _selfWrite = false; // suppress watcher when we wrote the file ourselves
    try { _selfWrite = !!matesModule.enforceAllSections(claudeMdPath, _enforceOpts); } catch (e) {}
    // Sync sticky notes knowledge file on startup
    try {
      var knDir = path.join(cwd, "knowledge");
      var knFile = path.join(knDir, "sticky-notes.md");
      var notesText = nm.getActiveNotesText();
      if (notesText) {
        fs.mkdirSync(knDir, { recursive: true });
        fs.writeFileSync(knFile, notesText);
      } else {
        try { fs.unlinkSync(knFile); } catch (e) {}
      }
    } catch (e) {}
    // Watch for changes
    try {
      crisisWatcher = fs.watch(claudeMdPath, function () {
        if (crisisDebounce) clearTimeout(crisisDebounce);
        crisisDebounce = setTimeout(function () {
          crisisDebounce = null;
          // Skip if the previous change was our own write
          if (_selfWrite) { _selfWrite = false; return; }
          // Atomic enforce: single read/write for all system sections
          try { _selfWrite = !!matesModule.enforceAllSections(claudeMdPath, _enforceOpts); } catch (e) {}
        }, 500);
      });
      crisisWatcher.on("error", function () {});
    } catch (e) {}
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
    forEachClient: function (fn) {
      for (var ws of clients) {
        if (ws.readyState === 1) fn(ws);
      }
    },
    handleConnection: handleConnection,
    handleMessage: handleMessage,
    handleDisconnection: handleDisconnection,
    handleHTTP: handleHTTP,
    getStatus: getStatus,
    getSessionManager: function () { return sm; },
    getSchedules: _loop.getSchedules,
    importSchedule: _loop.importSchedule,
    removeSchedule: _loop.removeSchedule,
    setTitle: setTitle,
    setIcon: setIcon,
    setProjectOwner: function (ownerId) { projectOwnerId = ownerId; },
    getProjectOwner: function () { return projectOwnerId; },
    refreshUserProfile: function (userId) {
      var user = usersModule.findUserById(userId);
      if (!user) return;
      for (var ws of clients) {
        if (ws._clayUser && ws._clayUser.id === userId) {
          ws._clayUser = user;
        }
      }
      broadcastClientCount();
      broadcastPresence();
    },
    warmup: function () {
      sdk.warmup();
      // Migrate existing relay session titles to SDK format (one-time, async)
      sm.migrateSessionTitles(getSDK, cwd);
    },
    destroy: destroy,
  };
}

module.exports = { createProjectContext: createProjectContext, safePath: safePath, validateEnvString: validateEnvString };
