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
// createLoopRegistry moved to project-loop.js
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
// MAX_UPLOAD_BYTES moved to project-http.js

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
// MIME_TYPES moved to project-http.js

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

  // --- Chat image storage ---
  var _imgConfig = require("./config");
  var _imgUtils = require("./utils");
  var _imagesBaseDir = path.join(_imgConfig.CONFIG_DIR, "images");
  var _imagesEncodedCwd = _imgUtils.encodeCwd(cwd);
  var imagesDir = path.join(_imagesBaseDir, _imagesEncodedCwd);

  // Convert imageRefs in history entries to images with URLs for the client
  function hydrateImageRefs(entry) {
    if (!entry) return entry;
    // Hydrate context_preview: convert screenshotFile to screenshotUrl
    if (entry.type === "context_preview" && entry.tab && entry.tab.screenshotFile) {
      var hydrated = {};
      for (var k in entry) hydrated[k] = entry[k];
      hydrated.tab = {};
      for (var tk in entry.tab) hydrated.tab[tk] = entry.tab[tk];
      hydrated.tab.screenshotUrl = "/p/" + slug + "/images/" + entry.tab.screenshotFile;
      delete hydrated.tab.screenshotFile;
      return hydrated;
    }
    if (!entry.imageRefs) return entry;
    if (entry.type !== "user_message" && entry.type !== "mention_user") return entry;
    var images = [];
    for (var ri = 0; ri < entry.imageRefs.length; ri++) {
      var ref = entry.imageRefs[ri];
      images.push({ mediaType: ref.mediaType, url: "/p/" + slug + "/images/" + ref.file });
    }
    var hydrated = {};
    for (var k2 in entry) {
      if (k2 !== "imageRefs") hydrated[k2] = entry[k2];
    }
    hydrated.images = images;
    return hydrated;
  }

  function saveImageFile(mediaType, base64data, ownerLinuxUser) {
    try { fs.mkdirSync(imagesDir, { recursive: true }); } catch (e) {}
    var ext = mediaType === "image/png" ? ".png" : mediaType === "image/gif" ? ".gif" : mediaType === "image/webp" ? ".webp" : ".jpg";
    var hash = crypto.createHash("sha256").update(base64data).digest("hex").substring(0, 16);
    var fileName = Date.now() + "-" + hash + ext;
    var filePath = path.join(imagesDir, fileName);
    try {
      fs.writeFileSync(filePath, Buffer.from(base64data, "base64"));
      if (process.platform !== "win32") {
        // 644 so all local users can read (needed for git, copy, etc.)
        try { fs.chmodSync(filePath, 0o644); } catch (e) {}
        // In OS-user mode the daemon runs as root, so chown the file
        // (and parent dirs) to the session owner to avoid permission issues.
        if (ownerLinuxUser) {
          try {
            var osUsersMod = require("./os-users");
            var uid = osUsersMod.getLinuxUserUid(ownerLinuxUser);
            if (uid != null) {
              require("child_process").execSync("chown " + uid + " " + JSON.stringify(filePath));
              // Also fix parent dirs if root-owned
              try {
                var dirStat = fs.statSync(imagesDir);
                if (dirStat.uid !== uid) {
                  require("child_process").execSync("chown " + uid + " " + JSON.stringify(imagesDir));
                }
              } catch (e2) {}
            }
          } catch (e) {}
        }
      }
      return fileName;
    } catch (e) {
      console.error("[images] Failed to save image:", e.message);
      return null;
    }
  }

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

  // --- WS connection handler ---
  function handleConnection(ws, wsUser) {
    ws._clayUser = wsUser || null;
    clients.add(ws);
    broadcastClientCount();

    // Resume loop if server restarted mid-execution (deferred so client gets initial state first)
    if (loopState._needsResume) {
      delete loopState._needsResume;
      setTimeout(function() { resumeLoop(); }, 500);
    }

    // Auto-assign owner if project has none and a user connects (e.g. IPC-added projects)
    if (!projectOwnerId && ws._clayUser && ws._clayUser.id && !isMate) {
      projectOwnerId = ws._clayUser.id;
      if (opts.onProjectOwnerChanged) {
        opts.onProjectOwnerChanged(slug, projectOwnerId);
      }
      console.log("[project] Auto-assigned owner for " + slug + ": " + projectOwnerId);
    }

    // Send cached state
    var _userId = ws._clayUser ? ws._clayUser.id : null;
    var _filteredProjects = getProjectList(_userId);
    sendTo(ws, { type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, dangerouslySkipPermissions: dangerouslySkipPermissions, osUsers: osUsers, lanHost: lanHost, projectCount: _filteredProjects.length, projects: _filteredProjects, projectOwnerId: projectOwnerId });
    if (latestVersion && ws._clayUser && ws._clayUser.role === "admin") {
      sendTo(ws, { type: "update_available", version: latestVersion });
    }
    if (sm.slashCommands) {
      sendTo(ws, { type: "slash_commands", commands: sm.slashCommands });
    }
    if (sm.currentModel) {
      sendTo(ws, { type: "model_info", model: sm.currentModel, models: sm.availableModels || [] });
    }
    sendTo(ws, { type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
    sendTo(ws, { type: "term_list", terminals: tm.list() });
    // Restore context sources (keep tab: sources — validated against _browserTabList at query time)
    var restoredSources = loadContextSources(slug);
    sendTo(ws, { type: "context_sources_state", active: restoredSources });
    sendTo(ws, { type: "notes_list", notes: nm.list() });
    sendTo(ws, { type: "loop_registry_updated", records: getHubSchedules() });
    _loop.sendConnectionState(ws);

    // Session list (filtered for access control)
    var allSessions = [].concat(Array.from(sm.sessions.values())).filter(function (s) { return !s.hidden; });
    if (usersModule.isMultiUser() && wsUser) {
      allSessions = allSessions.filter(function (s) {
        return usersModule.canAccessSession(wsUser.id, s, { visibility: "public" });
      });
    } else if (!usersModule.isMultiUser()) {
      allSessions = allSessions.filter(function (s) { return !s.ownerId; });
    }
    sendTo(ws, {
      type: "session_list",
      sessions: allSessions.map(function (s) {
        var loop = s.loop ? Object.assign({}, s.loop) : null;
        if (loop && loop.loopId && loopRegistry) {
          var rec = loopRegistry.getById(loop.loopId);
          if (rec) {
            if (rec.name) loop.name = rec.name;
            if (rec.source) loop.source = rec.source;
          }
        }
        return {
          id: s.localId,
          cliSessionId: s.cliSessionId || null,
          title: s.title || "New Session",
          active: s.localId === sm.activeSessionId,
          isProcessing: s.isProcessing,
          lastActivity: s.lastActivity || s.createdAt || 0,
          loop: loop,
          ownerId: s.ownerId || null,
          sessionVisibility: s.sessionVisibility || "shared",
        };
      }),
    });

    // Restore active session for this client from server-side presence
    var active = null;
    var presenceKey = wsUser ? wsUser.id : "_default";
    var storedPresence = userPresence.getPresence(slug, presenceKey);
    if (storedPresence && storedPresence.sessionId) {
      // Look up stored session by localId
      if (sm.sessions.has(storedPresence.sessionId)) {
        active = sm.sessions.get(storedPresence.sessionId);
      } else {
        // Try matching by cliSessionId (survives server restarts where localIds change)
        sm.sessions.forEach(function (s) {
          if (s.cliSessionId && s.cliSessionId === storedPresence.sessionId) active = s;
        });
      }
      // Validate access
      if (active && usersModule.isMultiUser() && wsUser) {
        if (!usersModule.canAccessSession(wsUser.id, active, { visibility: "public" })) active = null;
      } else if (active && !usersModule.isMultiUser() && active.ownerId) {
        active = null;
      }
    }
    // Fallback: pick the most recent accessible session
    if (!active && allSessions.length > 0) {
      active = allSessions[0];
      for (var fi = 1; fi < allSessions.length; fi++) {
        if ((allSessions[fi].lastActivity || 0) > (active.lastActivity || 0)) {
          active = allSessions[fi];
        }
      }
    }
    // Auto-create a session if none exist for this client
    var autoCreated = false;
    if (!active) {
      var autoOpts = {};
      if (wsUser && usersModule.isMultiUser()) autoOpts.ownerId = wsUser.id;
      active = sm.createSession(autoOpts, ws);
      autoCreated = true;
    }
    if (active && !autoCreated) {
      // Backfill ownerId for legacy sessions restored without one (multi-user only)
      if (!active.ownerId && wsUser && usersModule.isMultiUser()) {
        active.ownerId = wsUser.id;
        sm.saveSessionFile(active);
      }
      ws._clayActiveSession = active.localId;
      sendTo(ws, { type: "session_switched", id: active.localId, cliSessionId: active.cliSessionId || null, loop: active.loop || null });

      var total = active.history.length;
      var fromIndex = 0;
      if (total > sm.HISTORY_PAGE_SIZE) {
        fromIndex = sm.findTurnBoundary(active.history, Math.max(0, total - sm.HISTORY_PAGE_SIZE));
      }
      sendTo(ws, { type: "history_meta", total: total, from: fromIndex });
      for (var i = fromIndex; i < total; i++) {
        var _hitem = active.history[i];
        if (_hitem && (_hitem.type === "mention_user" || _hitem.type === "mention_response")) {
          console.log("[DEBUG handleConnection] sending mention at index=" + i + " from=" + fromIndex + " total=" + total + " type=" + _hitem.type + " mate=" + (_hitem.mateName || "") + " slug=" + slug);
        }
        sendTo(ws, hydrateImageRefs(_hitem));
      }
      // Include last result data + cached context usage for accurate restore
      var _lastUsage = null, _lastModelUsage = null, _lastCost = null, _lastStreamInputTokens = null;
      for (var _ri = total - 1; _ri >= 0; _ri--) {
        if (active.history[_ri].type === "result") {
          var _r = active.history[_ri];
          _lastUsage = _r.usage || null;
          _lastModelUsage = _r.modelUsage || null;
          _lastCost = _r.cost != null ? _r.cost : null;
          _lastStreamInputTokens = _r.lastStreamInputTokens || null;
          break;
        }
      }
      sendTo(ws, { type: "history_done", lastUsage: _lastUsage, lastModelUsage: _lastModelUsage, lastCost: _lastCost, lastStreamInputTokens: _lastStreamInputTokens, contextUsage: active.lastContextUsage || null });

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
          mateId: p.mateId || undefined,
        });
      }
    }

    // Record presence for this user + send mate DM restore hint if applicable
    if (active) {
      userPresence.setPresence(slug, presenceKey, active.localId, storedPresence ? storedPresence.mateDm : null);
    }
    if (storedPresence && storedPresence.mateDm && !isMate) {
      sendTo(ws, { type: "restore_mate_dm", mateId: storedPresence.mateDm });
    }

    broadcastPresence();

    // Restore debate state and brief watcher if a debate was in progress
    restoreDebateState(ws);

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

    // --- Knowledge file management ---
    if (msg.type === "knowledge_list") {
      var knowledgeDir = path.join(cwd, "knowledge");
      var files = [];
      try {
        var entries = fs.readdirSync(knowledgeDir);
        for (var ki = 0; ki < entries.length; ki++) {
          if (entries[ki] === "session-digests.jsonl") continue;
          if (entries[ki] === "sticky-notes.md") continue;
          if (entries[ki] === "memory-summary.md") continue;
          if (entries[ki].endsWith(".md") || entries[ki].endsWith(".jsonl")) {
            var stat = fs.statSync(path.join(knowledgeDir, entries[ki]));
            files.push({ name: entries[ki], size: stat.size, mtime: stat.mtimeMs, common: false });
          }
        }
      } catch (e) { /* dir may not exist */ }
      files.sort(function (a, b) { return b.mtime - a.mtime; });

      // For mate projects, check which files are promoted and include common files from other mates
      if (isMate) {
        var mateCtx = matesModule.buildMateCtx(projectOwnerId);
        var thisMateId = path.basename(cwd);
        // Tag promoted files
        for (var pi = 0; pi < files.length; pi++) {
          files[pi].promoted = matesModule.isPromoted(mateCtx, thisMateId, files[pi].name);
        }
        // Get common files from other mates
        var commonFiles = matesModule.getCommonKnowledgeForMate(mateCtx, thisMateId);
        // Filter out entries that belong to THIS mate (those are already in the list as promoted)
        for (var ci = 0; ci < commonFiles.length; ci++) {
          if (commonFiles[ci].ownMateId !== thisMateId) {
            files.push(commonFiles[ci]);
          }
        }
      }

      sendTo(ws, { type: "knowledge_list", files: files });
      return;
    }

    if (msg.type === "knowledge_read") {
      if (!msg.name) return;
      var safeName = path.basename(msg.name);
      var filePath;
      if (msg.common && msg.ownMateId && isMate) {
        // Reading a common file from another mate
        var mateCtx = matesModule.buildMateCtx(projectOwnerId);
        try {
          var content = matesModule.readCommonKnowledgeFile(mateCtx, msg.ownMateId, safeName);
          sendTo(ws, { type: "knowledge_content", name: safeName, content: content, common: true, ownMateId: msg.ownMateId });
        } catch (e) {
          sendTo(ws, { type: "knowledge_content", name: safeName, content: "", error: "File not found", common: true });
        }
      } else {
        filePath = path.join(cwd, "knowledge", safeName);
        try {
          var content = fs.readFileSync(filePath, "utf8");
          sendTo(ws, { type: "knowledge_content", name: safeName, content: content });
        } catch (e) {
          sendTo(ws, { type: "knowledge_content", name: safeName, content: "", error: "File not found" });
        }
      }
      return;
    }

    if (msg.type === "knowledge_save") {
      if (!msg.name || typeof msg.content !== "string") return;
      var safeName = path.basename(msg.name);
      if (!safeName.endsWith(".md") && !safeName.endsWith(".jsonl")) safeName += ".md";
      var knowledgeDir = path.join(cwd, "knowledge");
      fs.mkdirSync(knowledgeDir, { recursive: true });
      fs.writeFileSync(path.join(knowledgeDir, safeName), msg.content);
      // Return updated list
      var files = [];
      try {
        var entries = fs.readdirSync(knowledgeDir);
        for (var ki = 0; ki < entries.length; ki++) {
          if (entries[ki].endsWith(".md") || entries[ki].endsWith(".jsonl")) {
            var stat = fs.statSync(path.join(knowledgeDir, entries[ki]));
            files.push({ name: entries[ki], size: stat.size, mtime: stat.mtimeMs });
          }
        }
      } catch (e) {}
      files.sort(function (a, b) { return b.mtime - a.mtime; });
      // Tag files for mate projects
      if (isMate) {
        var mateCtx = matesModule.buildMateCtx(projectOwnerId);
        var thisMateId = path.basename(cwd);
        for (var pi = 0; pi < files.length; pi++) {
          files[pi].common = false;
          files[pi].promoted = matesModule.isPromoted(mateCtx, thisMateId, files[pi].name);
        }
        var commonFiles = matesModule.getCommonKnowledgeForMate(mateCtx, thisMateId);
        for (var ci = 0; ci < commonFiles.length; ci++) {
          if (commonFiles[ci].ownMateId !== thisMateId) files.push(commonFiles[ci]);
        }
      }
      sendTo(ws, { type: "knowledge_saved", name: safeName });
      sendTo(ws, { type: "knowledge_list", files: files });
      return;
    }

    if (msg.type === "knowledge_delete") {
      if (!msg.name) return;
      var safeName = path.basename(msg.name);
      var filePath = path.join(cwd, "knowledge", safeName);
      try { fs.unlinkSync(filePath); } catch (e) {}
      // Return updated list
      var knowledgeDir = path.join(cwd, "knowledge");
      var files = [];
      try {
        var entries = fs.readdirSync(knowledgeDir);
        for (var ki = 0; ki < entries.length; ki++) {
          if (entries[ki].endsWith(".md") || entries[ki].endsWith(".jsonl")) {
            var stat = fs.statSync(path.join(knowledgeDir, entries[ki]));
            files.push({ name: entries[ki], size: stat.size, mtime: stat.mtimeMs });
          }
        }
      } catch (e) {}
      files.sort(function (a, b) { return b.mtime - a.mtime; });
      // Tag files for mate projects
      if (isMate) {
        var mateCtx = matesModule.buildMateCtx(projectOwnerId);
        var thisMateId = path.basename(cwd);
        for (var pi = 0; pi < files.length; pi++) {
          files[pi].common = false;
          files[pi].promoted = matesModule.isPromoted(mateCtx, thisMateId, files[pi].name);
        }
        var commonFiles = matesModule.getCommonKnowledgeForMate(mateCtx, thisMateId);
        for (var ci = 0; ci < commonFiles.length; ci++) {
          if (commonFiles[ci].ownMateId !== thisMateId) files.push(commonFiles[ci]);
        }
      }
      sendTo(ws, { type: "knowledge_deleted", name: safeName });
      sendTo(ws, { type: "knowledge_list", files: files });
      return;
    }

    if (msg.type === "knowledge_promote") {
      if (!isMate || !msg.name) return;
      var safeName = path.basename(msg.name);
      var mateCtx = matesModule.buildMateCtx(projectOwnerId);
      var thisMateId = path.basename(cwd);
      var mate = matesModule.getMate(mateCtx, thisMateId);
      var mateName = (mate && mate.name) || null;
      matesModule.promoteKnowledge(mateCtx, thisMateId, mateName, safeName);
      sendTo(ws, { type: "knowledge_promoted", name: safeName });
      // Re-send updated list (reuse knowledge_list logic)
      handleMessage(ws, { type: "knowledge_list" });
      return;
    }

    if (msg.type === "knowledge_depromote") {
      if (!isMate || !msg.name) return;
      var safeName = path.basename(msg.name);
      var mateCtx = matesModule.buildMateCtx(projectOwnerId);
      var thisMateId = path.basename(cwd);
      matesModule.depromoteKnowledge(mateCtx, thisMateId, safeName);
      sendTo(ws, { type: "knowledge_depromoted", name: safeName });
      handleMessage(ws, { type: "knowledge_list" });
      return;
    }

    // --- Memory (session digests) management (delegated to project-memory.js) ---
    if (msg.type === "memory_list") { _memory.handleMemoryList(ws); return; }
    if (msg.type === "memory_search") { _memory.handleMemorySearch(ws, msg); return; }
    if (msg.type === "memory_delete") { _memory.handleMemoryDelete(ws, msg); return; }

    if (msg.type === "push_subscribe") {
      var _pushUserId = ws._clayUser ? ws._clayUser.id : null;
      if (pushModule && msg.subscription) pushModule.addSubscription(msg.subscription, msg.replaceEndpoint, _pushUserId);
      return;
    }

    if (msg.type === "load_more_history") {
      var session = getSessionForWs(ws);
      if (!session || typeof msg.before !== "number") return;
      var before = msg.before;
      var targetFrom = typeof msg.target === "number" ? msg.target : before - sm.HISTORY_PAGE_SIZE;
      var from = sm.findTurnBoundary(session.history, Math.max(0, targetFrom));
      var to = before;
      var items = session.history.slice(from, to).map(hydrateImageRefs);
      sendTo(ws, {
        type: "history_prepend",
        items: items,
        meta: { from: from, to: to, hasMore: from > 0 },
      });
      return;
    }

    if (msg.type === "new_session") {
      var sessionOpts = {};
      if (ws._clayUser && usersModule.isMultiUser()) sessionOpts.ownerId = ws._clayUser.id;
      if (msg.sessionVisibility) sessionOpts.sessionVisibility = msg.sessionVisibility;
      var newSess = sm.createSession(sessionOpts, ws);
      ws._clayActiveSession = newSess.localId;
      var nsPresKey = ws._clayUser ? ws._clayUser.id : "_default";
      userPresence.setPresence(slug, nsPresKey, newSess.localId, null);
      if (usersModule.isMultiUser()) {
        broadcastPresence();
      }
      return;
    }

    if (msg.type === "set_session_visibility") {
      if (typeof msg.sessionId === "number" && (msg.visibility === "shared" || msg.visibility === "private")) {
        sm.setSessionVisibility(msg.sessionId, msg.visibility);
      }
      return;
    }

    if (msg.type === "transfer_project_owner") {
      var isAdmin = ws._clayUser && ws._clayUser.role === "admin";
      var isProjectOwner = ws._clayUser && projectOwnerId && ws._clayUser.id === projectOwnerId;
      if (!ws._clayUser || (!isAdmin && !isProjectOwner)) {
        sendTo(ws, { type: "error", text: "Only project owners or admins can transfer ownership." });
        return;
      }
      var targetUser = msg.userId ? usersModule.findUserById(msg.userId) : null;
      if (!targetUser) {
        sendTo(ws, { type: "error", text: "User not found." });
        return;
      }
      projectOwnerId = targetUser.id;
      // Persist via daemon callback
      if (opts.onProjectOwnerChanged) {
        opts.onProjectOwnerChanged(slug, projectOwnerId);
      }
      send({ type: "project_owner_changed", ownerId: projectOwnerId, ownerName: targetUser.displayName || targetUser.username });
      return;
    }

    if (msg.type === "resume_session") {
      if (!msg.cliSessionId) return;
      var cliSess = require("./cli-sessions");
      // Try SDK for title first, then fall back to manual parsing
      var titlePromise = getSDK().then(function(sdkMod) {
        return sdkMod.getSessionInfo(msg.cliSessionId, { dir: cwd });
      }).then(function(info) {
        return (info && info.summary) ? info.summary.substring(0, 100) : null;
      }).catch(function() { return null; });

      Promise.all([
        cliSess.readCliSessionHistory(cwd, msg.cliSessionId),
        titlePromise
      ]).then(function(results) {
        var history = results[0];
        var sdkTitle = results[1];
        var title = sdkTitle || "Resumed session";
        if (!sdkTitle) {
          for (var i = 0; i < history.length; i++) {
            if (history[i].type === "user_message" && history[i].text) {
              title = history[i].text.substring(0, 50);
              break;
            }
          }
        }
        var resumed = sm.resumeSession(msg.cliSessionId, { history: history, title: title }, ws);
        if (resumed) ws._clayActiveSession = resumed.localId;
      }).catch(function() {
        var resumed = sm.resumeSession(msg.cliSessionId, undefined, ws);
        if (resumed) ws._clayActiveSession = resumed.localId;
      });
      return;
    }

    if (msg.type === "list_cli_sessions") {
      var _fs = require("fs");
      // Collect session IDs already in relay (in-memory + persisted on disk)
      var relayIds = {};
      sm.sessions.forEach(function (s) {
        if (s.cliSessionId) relayIds[s.cliSessionId] = true;
      });
      try {
        var sessDir = sm.sessionsDir;
        var diskFiles = _fs.readdirSync(sessDir);
        for (var fi = 0; fi < diskFiles.length; fi++) {
          if (diskFiles[fi].endsWith(".jsonl")) {
            relayIds[diskFiles[fi].replace(".jsonl", "")] = true;
          }
        }
      } catch (e) {}

      getSDK().then(function(sdkMod) {
        return sdkMod.listSessions({ dir: cwd });
      }).then(function(sdkSessions) {
        var filtered = sdkSessions.filter(function(s) {
          return !relayIds[s.sessionId];
        }).map(function(s) {
          return {
            sessionId: s.sessionId,
            firstPrompt: s.summary || s.firstPrompt || "",
            model: null,
            gitBranch: s.gitBranch || null,
            startTime: s.createdAt ? new Date(s.createdAt).toISOString() : null,
            lastActivity: s.lastModified ? new Date(s.lastModified).toISOString() : null,
          };
        });
        sendTo(ws, { type: "cli_session_list", sessions: filtered });
      }).catch(function() {
        // Fallback to manual parsing if SDK fails
        var cliSessions = require("./cli-sessions");
        cliSessions.listCliSessions(cwd).then(function(sessions) {
          var filtered = sessions.filter(function(s) {
            return !relayIds[s.sessionId];
          });
          sendTo(ws, { type: "cli_session_list", sessions: filtered });
        }).catch(function() {
          sendTo(ws, { type: "cli_session_list", sessions: [] });
        });
      });
      return;
    }


    if (msg.type === "switch_session") {
      if (msg.id && sm.sessions.has(msg.id)) {
        // Check access in multi-user mode
        if (usersModule.isMultiUser() && ws._clayUser) {
          var switchTarget = sm.sessions.get(msg.id);
          if (!usersModule.canAccessSession(ws._clayUser.id, switchTarget, { visibility: "public" })) return;
          ws._clayActiveSession = msg.id;
          sm.switchSession(msg.id, ws, hydrateImageRefs);
          broadcastPresence();
        } else {
          ws._clayActiveSession = msg.id;
          sm.switchSession(msg.id, ws, hydrateImageRefs);
        }
        var swPresKey = ws._clayUser ? ws._clayUser.id : "_default";
        userPresence.setPresence(slug, swPresKey, msg.id, null);
      }
      return;
    }

    if (msg.type === "set_mate_dm") {
      // Only store mateDm on non-mate projects (main project presence).
      // Mate projects should never hold mateDm to avoid circular restore loops.
      if (!isMate) {
        var dmPresKey = ws._clayUser ? ws._clayUser.id : "_default";
        userPresence.setMateDm(slug, dmPresKey, msg.mateId || null);
      }
      return;
    }

    if (msg.type === "delete_session") {
      if (ws._clayUser) {
        var sdPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!sdPerms.sessionDelete) {
          sendTo(ws, { type: "error", text: "You do not have permission to delete sessions" });
          return;
        }
      }
      if (msg.id && sm.sessions.has(msg.id)) {
        sm.deleteSession(msg.id, ws);
      }
      return;
    }

    if (msg.type === "rename_session") {
      if (msg.id && sm.sessions.has(msg.id) && msg.title) {
        var s = sm.sessions.get(msg.id);
        s.title = String(msg.title).substring(0, 100);
        sm.saveSessionFile(s);
        sm.broadcastSessionList();
        // Sync title to SDK session
        if (s.cliSessionId) {
          getSDK().then(function(sdk) {
            sdk.renameSession(s.cliSessionId, s.title, { dir: cwd }).catch(function(e) {
              console.error("[project] SDK renameSession failed:", e.message);
            });
          }).catch(function() {});
        }
      }
      return;
    }

    if (msg.type === "search_sessions") {
      var results = sm.searchSessions(msg.query || "");
      sendTo(ws, { type: "search_results", query: msg.query || "", results: results });
      return;
    }

    if (msg.type === "search_session_content") {
      var targetSession = msg.id ? sm.sessions.get(msg.id) : getSessionForWs(ws);
      if (!targetSession) return;
      var contentResults = sm.searchSessionContent(targetSession.localId, msg.query || "");
      var searchResp = { type: "search_content_results", query: msg.query || "", sessionId: targetSession.localId, hits: contentResults.hits, total: contentResults.total };
      if (msg.source) searchResp.source = msg.source;
      sendTo(ws, searchResp);
      return;
    }

    if (msg.type === "set_update_channel") {
      if (usersModule.isMultiUser() && (!ws._clayUser || ws._clayUser.role !== "admin")) return;
      var newChannel = msg.channel === "beta" ? "beta" : "stable";
      updateChannel = newChannel;
      latestVersion = null;
      if (typeof opts.onSetUpdateChannel === "function") {
        opts.onSetUpdateChannel(newChannel);
      }
      // Re-fetch with new channel and broadcast to admin clients
      fetchVersion(updateChannel).then(function (v) {
        if (v && isNewer(v, currentVersion)) {
          latestVersion = v;
          sendToAdmins({ type: "update_available", version: v });
        }
      }).catch(function () {});
      return;
    }

    if (msg.type === "check_update") {
      if (usersModule.isMultiUser() && (!ws._clayUser || ws._clayUser.role !== "admin")) return;
      fetchVersion(updateChannel).then(function (v) {
        if (v && isNewer(v, currentVersion)) {
          latestVersion = v;
          sendTo(ws, { type: "update_available", version: v });
        } else {
          sendTo(ws, { type: "up_to_date", version: currentVersion });
        }
      }).catch(function () {});
      return;
    }

    if (msg.type === "update_now") {
      if (usersModule.isMultiUser() && (!ws._clayUser || ws._clayUser.role !== "admin")) return;
      send({ type: "update_started", version: latestVersion || "" });
      var _ipc = require("./ipc");
      var _config = require("./config");
      _ipc.sendIPCCommand(_config.socketPath(), { cmd: "update" });
      return;
    }

    if (msg.type === "process_stats") {
      var sessionCount = sm.sessions.size;
      var processingCount = 0;
      sm.sessions.forEach(function (s) {
        if (s.isProcessing) processingCount++;
      });
      var mem = process.memoryUsage();
      sendTo(ws, {
        type: "process_stats",
        pid: process.pid,
        uptime: process.uptime(),
        memory: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
        },
        sessions: sessionCount,
        processing: processingCount,
        clients: clients.size,
        terminals: tm.list().length,
      });
      return;
    }

    if (msg.type === "stop") {
      var session = getSessionForWs(ws);
      if (session && session.abortController && session.isProcessing) {
        session.abortController.abort();
      }
      return;
    }


    if (msg.type === "stop_task") {
      if (msg.taskId) {
        sdk.stopTask(msg.taskId);
      }
      return;
    }

    if (msg.type === "kill_process") {
      var pid = msg.pid;
      if (!pid || typeof pid !== "number") return;
      // Verify target is actually a claude process before killing
      if (!sdk.isClaudeProcess(pid)) {
        console.error("[project] Refused to kill PID " + pid + ": not a claude process");
        sendTo(ws, { type: "error", text: "Process " + pid + " is not a Claude process." });
        return;
      }
      try {
        process.kill(pid, "SIGTERM");
        console.log("[project] Sent SIGTERM to conflicting Claude process PID " + pid);
        sendTo(ws, { type: "process_killed", pid: pid });
      } catch (e) {
        console.error("[project] Failed to kill PID " + pid + ":", e.message);
        sendTo(ws, { type: "error", text: "Failed to kill process " + pid + ": " + (e.message || e) });
      }
      return;
    }

    if (msg.type === "set_model" && msg.model) {
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setModel(session, msg.model);
      }
      return;
    }

    if (msg.type === "set_server_default_model" && msg.model) {
      if (typeof opts.onSetServerDefaultModel === "function") {
        opts.onSetServerDefaultModel(msg.model);
      }
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setModel(session, msg.model);
      }
      return;
    }

    if (msg.type === "set_project_default_model" && msg.model) {
      if (typeof opts.onSetProjectDefaultModel === "function") {
        opts.onSetProjectDefaultModel(slug, msg.model);
      }
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setModel(session, msg.model);
      }
      return;
    }

    if (msg.type === "set_permission_mode" && msg.mode) {
      sm.currentPermissionMode = msg.mode;
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setPermissionMode(session, msg.mode);
      }
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return;
    }

    if (msg.type === "set_server_default_mode" && msg.mode) {
      if (typeof opts.onSetServerDefaultMode === "function") {
        opts.onSetServerDefaultMode(msg.mode);
      }
      sm.currentPermissionMode = msg.mode;
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setPermissionMode(session, msg.mode);
      }
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return;
    }

    if (msg.type === "set_project_default_mode" && msg.mode) {
      if (typeof opts.onSetProjectDefaultMode === "function") {
        opts.onSetProjectDefaultMode(slug, msg.mode);
      }
      sm.currentPermissionMode = msg.mode;
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setPermissionMode(session, msg.mode);
      }
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return;
    }

    if (msg.type === "set_effort" && msg.effort) {
      sm.currentEffort = msg.effort;
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setEffort(session, msg.effort);
      }
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return;
    }

    if (msg.type === "set_server_default_effort" && msg.effort) {
      if (typeof opts.onSetServerDefaultEffort === "function") {
        opts.onSetServerDefaultEffort(msg.effort);
      }
      sm.currentEffort = msg.effort;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return;
    }

    if (msg.type === "set_project_default_effort" && msg.effort) {
      if (typeof opts.onSetProjectDefaultEffort === "function") {
        opts.onSetProjectDefaultEffort(slug, msg.effort);
      }
      sm.currentEffort = msg.effort;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return;
    }

    if (msg.type === "set_betas") {
      sm.currentBetas = msg.betas || [];
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas, thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return;
    }

    if (msg.type === "set_thinking") {
      sm.currentThinking = msg.thinking || "adaptive";
      if (msg.budgetTokens) sm.currentThinkingBudget = msg.budgetTokens;
      send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return;
    }

    if (msg.type === "rewind_preview") {
      var session = getSessionForWs(ws);
      if (!session || !session.cliSessionId || !msg.uuid) return;
      // Reject preview requests while a rewind is executing
      if (session._rewindInProgress) return;

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
      var session = getSessionForWs(ws);
      if (!session || !session.cliSessionId || !msg.uuid) return;
      // Guard against concurrent rewind executions
      if (session._rewindInProgress) {
        sendTo(ws, { type: "rewind_error", text: "Rewind already in progress." });
        return;
      }
      session._rewindInProgress = true;
      var mode = msg.mode || "both";

      (async function () {
        var result;
        try {
          // File restoration (skip for chat-only mode)
          if (mode !== "chat") {
            result = await sdk.getOrCreateRewindQuery(session);
            await result.query.rewindFiles(msg.uuid, { dryRun: false });
          }

          // Conversation rollback (skip for files-only mode)
          if (mode !== "files") {
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

            var kept = session.messageUUIDs;
            session.lastRewindUuid = kept.length > 0 ? kept[kept.length - 1].uuid : null;
          }

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
          onProcessingChanged();

          sm.saveSessionFile(session);
          sm.switchSession(session.localId, ws, hydrateImageRefs);
          sm.sendAndRecord(session, { type: "rewind_complete", mode: mode });
          sm.broadcastSessionList();
        } catch (err) {
          sendTo(ws, { type: "rewind_error", text: "Rewind failed: " + err.message });
        } finally {
          session._rewindInProgress = false;
          if (result && result.isTemp) result.cleanup();
        }
      })();
      return;
    }

    if (msg.type === "fork_session" && msg.uuid) {
      var session = getSessionForWs(ws);
      if (!session || !session.cliSessionId) {
        sendTo(ws, { type: "error", text: "Cannot fork: no CLI session" });
        return;
      }
      var forkCliId = session.cliSessionId;
      var forkTitle = (session.title || "New Session") + " (fork)";
      getSDK().then(function(sdkMod) {
        return sdkMod.forkSession(forkCliId, {
          upToMessageId: msg.uuid,
          dir: cwd,
        });
      }).then(function(result) {
        var cliSess = require("./cli-sessions");
        return cliSess.readCliSessionHistory(cwd, result.sessionId).then(function(history) {
          var forked = sm.resumeSession(result.sessionId, { history: history, title: forkTitle }, ws);
          if (forked) {
            ws._clayActiveSession = forked.localId;
            sendTo(ws, { type: "fork_complete", sessionId: forked.localId });
          }
        });
      }).catch(function(e) {
        sendTo(ws, { type: "error", text: "Fork failed: " + (e.message || e) });
      });
      return;
    }

    if (msg.type === "ask_user_response") {
      var session = getSessionForWs(ws);
      if (!session) return;
      var toolId = msg.toolId;
      var answers = msg.answers || {};
      var pending = session.pendingAskUser[toolId];
      if (!pending) return;
      delete session.pendingAskUser[toolId];
      sm.sendAndRecord(session, { type: "ask_user_answered", toolId: toolId, answers: answers });
      pending.resolve({
        behavior: "allow",
        updatedInput: Object.assign({}, pending.input, { answers: answers }),
      });
      return;
    }

    if (msg.type === "input_sync") {
      sendToSessionOthers(ws, ws._clayActiveSession, msg);
      return;
    }

    if (msg.type === "cursor_move" || msg.type === "cursor_leave" || msg.type === "text_select") {
      if (!usersModule.isMultiUser() || !ws._clayUser) return;
      var u = ws._clayUser;
      var p = u.profile || {};
      var cursorMsg = {
        type: msg.type,
        userId: u.id,
        displayName: p.name || u.displayName || u.username,
        avatarStyle: p.avatarStyle || "thumbs",
        avatarSeed: p.avatarSeed || u.username,
        avatarCustom: p.avatarCustom || "",
      };
      if (msg.type === "cursor_move") {
        cursorMsg.turn = msg.turn;
        if (msg.rx != null) cursorMsg.rx = msg.rx;
        if (msg.ry != null) cursorMsg.ry = msg.ry;
      }
      if (msg.type === "text_select") {
        cursorMsg.ranges = msg.ranges || [];
      }
      sendToSessionOthers(ws, ws._clayActiveSession, cursorMsg);
      return;
    }

    if (msg.type === "permission_response") {
      var session = getSessionForWs(ws);
      if (!session) return;
      var requestId = msg.requestId;
      var decision = msg.decision;
      var pending = session.pendingPermissions[requestId];
      if (!pending) return;
      delete session.pendingPermissions[requestId];
      onProcessingChanged(); // update cross-project permission badge

      // --- Plan approval: "allow_accept_edits" — approve + switch to acceptEdits mode ---
      if (decision === "allow_accept_edits") {
        sdk.setPermissionMode(session, "acceptEdits");
        sm.currentPermissionMode = "acceptEdits";
        send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });
        return;
      }

      // --- Plan approval: "allow_clear_context" — new session + plan as first message + acceptEdits ---
      if (decision === "allow_clear_context") {
        // Deny current plan to end the turn
        pending.resolve({ behavior: "deny", message: "User chose to clear context and restart" });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });

        // Abort the old session's query — but defer to next tick so the SDK's
        // deny write (scheduled as microtask by pending.resolve) completes first.
        // Aborting synchronously would kill the subprocess before the write,
        // causing an "Operation aborted" crash in the SDK.
        session.isProcessing = false;
        onProcessingChanged();
        session.pendingPermissions = {};
        session.pendingAskUser = {};
        sm.broadcastSessionList();
        setImmediate(function () {
          if (session.abortController) {
            session.abortController.abort();
          }
        });

        // Update permission mode for the new session
        sm.currentPermissionMode = "acceptEdits";
        send({ type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });

        // Build prompt from plan content (sent from client) or plan file path
        var clientPlanContent = msg.planContent || "";
        var planPrompt;
        if (clientPlanContent) {
          planPrompt = "Execute the following plan. Do NOT re-enter plan mode — just implement it step by step.\n\n" + clientPlanContent;
        } else {
          var planFilePath = (pending.toolInput && pending.toolInput.planFilePath) || "";
          planPrompt = "Execute the plan in " + planFilePath + ". Do NOT re-enter plan mode — read the plan file and implement it step by step.";
        }

        // Wait for old query stream to fully terminate, then create new session + send plan
        var oldStreamPromise = session.streamPromise || Promise.resolve();
        Promise.race([
          oldStreamPromise,
          new Promise(function (resolve) { setTimeout(resolve, 3000); }),
        ]).then(function () {
          try {
            var newSession = sm.createSession(null, ws);
            // Send the plan as the first user message (with planContent for UI rendering)
            var userMsg = { type: "user_message", text: planPrompt, planContent: clientPlanContent || null };
            newSession.history.push(userMsg);
            sm.appendToSessionFile(newSession, userMsg);
            newSession.title = "Plan execution (cleared context)";
            sm.saveSessionFile(newSession);
            sm.broadcastSessionList();
            sendToSession(newSession.localId, userMsg);

            newSession.isProcessing = true;
            onProcessingChanged();
            newSession.sentToolResults = {};
            sendToSession(newSession.localId, { type: "status", status: "processing" });
            newSession.acceptEditsAfterStart = true;
            sdk.startQuery(newSession, planPrompt, undefined, getLinuxUserForSession(newSession));
          } catch (e) {
            console.error("[project] Error starting plan execution:", e);
            sendTo(ws, { type: "error", text: "Failed to start plan execution: " + (e.message || e) });
          }
        }).catch(function (e) {
          console.error("[project] Plan execution stream wait failed:", e.message || e);
        });
        return;
      }

      // --- Plan approval: "deny_with_feedback" — deny + send feedback as follow-up message ---
      if (decision === "deny_with_feedback") {
        var feedback = msg.feedback || "";
        pending.resolve({ behavior: "deny", message: feedback || "User provided feedback" });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });

        // Send feedback as next user message if there's text
        if (feedback) {
          setTimeout(function () {
            var userMsg = { type: "user_message", text: feedback };
            session.history.push(userMsg);
            sm.appendToSessionFile(session, userMsg);
            sendToSession(session.localId, userMsg);

            if (!session.isProcessing) {
              session.isProcessing = true;
              onProcessingChanged();
              session.sentToolResults = {};
              sendToSession(session.localId, { type: "status", status: "processing" });
              if (!session.queryInstance && !session.worker) {
                sdk.startQuery(session, feedback, undefined, getLinuxUserForSession(session));
              } else {
                sdk.pushMessage(session, feedback);
              }
            } else {
              sdk.pushMessage(session, feedback);
            }
          }, 200);
        }
        return;
      }

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

    // --- MCP elicitation response ---
    if (msg.type === "elicitation_response") {
      var session = getSessionForWs(ws);
      if (!session) return;
      var pending = session.pendingElicitations && session.pendingElicitations[msg.requestId];
      if (!pending) return;
      delete session.pendingElicitations[msg.requestId];
      if (msg.action === "accept") {
        pending.resolve({ action: "accept", content: msg.content || {} });
      } else {
        pending.resolve({ action: "reject" });
      }
      sm.sendAndRecord(session, {
        type: "elicitation_resolved",
        requestId: msg.requestId,
        action: msg.action,
      });
      return;
    }

    // --- Browse directories (for add-project autocomplete) ---
    if (msg.type === "browse_dir") {
      var rawPath = (msg.path || "").replace(/^~/, require("./config").REAL_HOME);
      var absTarget = path.resolve(rawPath);
      var parentDir, prefix;
      try {
        var stat = fs.statSync(absTarget);
        if (stat.isDirectory()) {
          // Input is an existing directory — list its children
          parentDir = absTarget;
          prefix = "";
        } else {
          parentDir = path.dirname(absTarget);
          prefix = path.basename(absTarget).toLowerCase();
        }
      } catch (e) {
        // Path doesn't exist — list parent and filter by typed prefix
        parentDir = path.dirname(absTarget);
        prefix = path.basename(absTarget).toLowerCase();
      }
      try {
        var dirItems = fs.readdirSync(parentDir, { withFileTypes: true });
        var dirEntries = [];
        for (var di = 0; di < dirItems.length; di++) {
          var d = dirItems[di];
          if (!d.isDirectory()) continue;
          if (d.name.charAt(0) === ".") continue;
          if (IGNORED_DIRS.has(d.name)) continue;
          if (prefix && !d.name.toLowerCase().startsWith(prefix)) continue;
          dirEntries.push({ name: d.name, path: path.join(parentDir, d.name) });
        }
        dirEntries.sort(function (a, b) { return a.name.localeCompare(b.name); });
        sendTo(ws, { type: "browse_dir_result", path: msg.path, entries: dirEntries });
      } catch (e) {
        sendTo(ws, { type: "browse_dir_result", path: msg.path, entries: [], error: e.message });
      }
      return;
    }

    // --- Add project from web UI ---
    if (msg.type === "add_project") {
      var addPath = (msg.path || "").replace(/^~/, require("./config").REAL_HOME);
      var addAbs = path.resolve(addPath);
      try {
        var addStat = fs.statSync(addAbs);
        if (!addStat.isDirectory()) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "Not a directory" });
          return;
        }
      } catch (e) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Directory not found" });
        return;
      }
      if (typeof opts.onAddProject === "function") {
        var result = opts.onAddProject(addAbs, ws._clayUser);
        sendTo(ws, { type: "add_project_result", ok: result.ok, slug: result.slug, error: result.error, existing: result.existing });
      } else {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Create new empty project ---
    if (msg.type === "create_project" || msg.type === "clone_project") {
      if (ws._clayUser) {
        var cpPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!cpPerms.createProject) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "You do not have permission to create projects" });
          return;
        }
      }
    }
    if (msg.type === "create_project") {
      var createName = (msg.name || "").trim();
      if (!createName || !/^[a-zA-Z0-9_-]+$/.test(createName)) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Invalid name. Use only letters, numbers, dashes, and underscores." });
        return;
      }
      if (typeof opts.onCreateProject === "function") {
        var createResult = opts.onCreateProject(createName, ws._clayUser);
        sendTo(ws, { type: "add_project_result", ok: createResult.ok, slug: createResult.slug, error: createResult.error });
      } else {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Clone project from GitHub ---
    if (msg.type === "clone_project") {
      var cloneUrl = (msg.url || "").trim();
      if (!cloneUrl || (!/^https?:\/\//.test(cloneUrl) && !/^git@/.test(cloneUrl))) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Invalid URL. Use https:// or git@ format." });
        return;
      }
      sendTo(ws, { type: "clone_project_progress", status: "cloning" });
      if (typeof opts.onCloneProject === "function") {
        opts.onCloneProject(cloneUrl, ws._clayUser, function (cloneResult) {
          sendTo(ws, { type: "add_project_result", ok: cloneResult.ok, slug: cloneResult.slug, error: cloneResult.error });
        });
      } else {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Create worktree from web UI ---
    if (msg.type === "create_worktree") {
      var wtBranch = (msg.branch || "").trim();
      var wtDirName = (msg.dirName || "").trim() || wtBranch.replace(/\//g, "-");
      var wtBase = (msg.baseBranch || "").trim() || null;
      if (!wtBranch || !/^[a-zA-Z0-9_\/.@-]+$/.test(wtBranch)) {
        sendTo(ws, { type: "create_worktree_result", ok: false, error: "Invalid branch name" });
        return;
      }
      if (typeof onCreateWorktree === "function") {
        var wtResult = onCreateWorktree(slug, wtBranch, wtDirName, wtBase);
        sendTo(ws, { type: "create_worktree_result", ok: wtResult.ok, slug: wtResult.slug, error: wtResult.error });
      } else {
        sendTo(ws, { type: "create_worktree_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Pre-check: does the project have tasks/schedules? ---
    if (msg.type === "remove_project_check") {
      var checkSlug = msg.slug;
      if (!checkSlug) {
        sendTo(ws, { type: "remove_project_check_result", slug: checkSlug, name: msg.name || checkSlug, count: 0 });
        return;
      }
      var schedCount = getScheduleCount(checkSlug);
      sendTo(ws, { type: "remove_project_check_result", slug: checkSlug, name: msg.name || checkSlug, count: schedCount });
      return;
    }

    // --- Remove project from web UI ---
    if (msg.type === "remove_project") {
      if (ws._clayUser) {
        var dpPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!dpPerms.deleteProject) {
          sendTo(ws, { type: "remove_project_result", ok: false, error: "You do not have permission to delete projects" });
          return;
        }
      }
      var removeSlug = msg.slug;
      if (!removeSlug) {
        sendTo(ws, { type: "remove_project_result", ok: false, error: "Missing slug" });
        return;
      }
      // If client chose to move tasks to another project before removing
      if (msg.moveTasksTo) {
        moveAllSchedulesToProject(removeSlug, msg.moveTasksTo);
      }
      if (typeof opts.onRemoveProject === "function") {
        // Send result before removing so the WS is still open
        sendTo(ws, { type: "remove_project_result", ok: true, slug: removeSlug });
        var removeUserId = ws._clayUser ? ws._clayUser.id : null;
        opts.onRemoveProject(removeSlug, removeUserId);
      } else {
        sendTo(ws, { type: "remove_project_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Move a single schedule to another project ---
    if (msg.type === "schedule_move") {
      var moveResult = moveScheduleToProject(msg.recordId, msg.fromSlug, msg.toSlug);
      if (moveResult.ok) {
        // Re-broadcast updated records to this project's clients
        send({ type: "loop_registry_updated", records: getHubSchedules() });
      }
      sendTo(ws, { type: "schedule_move_result", ok: moveResult.ok, error: moveResult.error });
      return;
    }

    // --- Reorder projects ---
    if (msg.type === "reorder_projects") {
      var slugs = msg.slugs;
      if (!Array.isArray(slugs) || slugs.length === 0) {
        sendTo(ws, { type: "reorder_projects_result", ok: false, error: "Missing slugs" });
        return;
      }
      if (typeof opts.onReorderProjects === "function") {
        var reorderResult = opts.onReorderProjects(slugs);
        sendTo(ws, { type: "reorder_projects_result", ok: reorderResult.ok, error: reorderResult.error });
      } else {
        sendTo(ws, { type: "reorder_projects_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Set project title (rename) ---
    if (msg.type === "set_project_title") {
      if (!msg.slug) {
        sendTo(ws, { type: "set_project_title_result", ok: false, error: "Missing slug" });
        return;
      }
      if (typeof opts.onSetProjectTitle === "function") {
        var titleResult = opts.onSetProjectTitle(msg.slug, msg.title || null);
        sendTo(ws, { type: "set_project_title_result", ok: titleResult.ok, slug: msg.slug, error: titleResult.error });
      } else {
        sendTo(ws, { type: "set_project_title_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Set project icon (emoji) ---
    if (msg.type === "set_project_icon") {
      if (!msg.slug) {
        sendTo(ws, { type: "set_project_icon_result", ok: false, error: "Missing slug" });
        return;
      }
      if (typeof opts.onSetProjectIcon === "function") {
        var iconResult = opts.onSetProjectIcon(msg.slug, msg.icon || null);
        sendTo(ws, { type: "set_project_icon_result", ok: iconResult.ok, slug: msg.slug, error: iconResult.error });
      } else {
        sendTo(ws, { type: "set_project_icon_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Daemon config / server management (admin-only in multi-user mode) ---
    if (msg.type === "get_daemon_config" || msg.type === "set_pin" || msg.type === "set_keep_awake" ||
        msg.type === "set_auto_continue" || msg.type === "set_image_retention" || msg.type === "shutdown_server" || msg.type === "restart_server") {
      if (usersModule.isMultiUser()) {
        var _wsUser = ws._clayUser;
        if (!_wsUser || _wsUser.role !== "admin") {
          sendTo(ws, { type: "error", message: "Admin access required" });
          return;
        }
      }
    }

    if (msg.type === "get_daemon_config") {
      if (typeof opts.onGetDaemonConfig === "function") {
        var daemonConfig = opts.onGetDaemonConfig();
        sendTo(ws, { type: "daemon_config", config: daemonConfig });
      }
      return;
    }

    if (msg.type === "set_pin") {
      if (typeof opts.onSetPin === "function") {
        var pinResult = opts.onSetPin(msg.pin || null);
        sendTo(ws, { type: "set_pin_result", ok: pinResult.ok, pinEnabled: pinResult.pinEnabled });
      }
      return;
    }

    if (msg.type === "set_keep_awake") {
      if (typeof opts.onSetKeepAwake === "function") {
        var kaResult = opts.onSetKeepAwake(msg.value);
        sendTo(ws, { type: "set_keep_awake_result", ok: kaResult.ok, keepAwake: kaResult.keepAwake });
        send({ type: "keep_awake_changed", keepAwake: kaResult.keepAwake });
      }
      return;
    }

    if (msg.type === "set_auto_continue") {
      if (typeof opts.onSetAutoContinue === "function") {
        var acResult = opts.onSetAutoContinue(msg.value);
        sendTo(ws, { type: "set_auto_continue_result", ok: acResult.ok, autoContinueOnRateLimit: acResult.autoContinueOnRateLimit });
        send({ type: "auto_continue_changed", autoContinueOnRateLimit: acResult.autoContinueOnRateLimit });
      }
      return;
    }

    if (msg.type === "set_image_retention") {
      if (typeof opts.onSetImageRetention === "function") {
        var irResult = opts.onSetImageRetention(msg.days);
        sendTo(ws, { type: "set_image_retention_result", ok: irResult.ok, days: irResult.days });
      }
      return;
    }

    if (msg.type === "shutdown_server") {
      if (typeof opts.onShutdown === "function") {
        sendTo(ws, { type: "shutdown_server_result", ok: true });
        send({ type: "toast", level: "warn", message: "Server is shutting down..." });
        // Small delay so the response has time to reach clients
        setTimeout(function () {
          opts.onShutdown();
        }, 500);
      } else {
        sendTo(ws, { type: "shutdown_server_result", ok: false, error: "Shutdown not supported" });
      }
      return;
    }

    if (msg.type === "restart_server") {
      if (typeof opts.onRestart === "function") {
        sendTo(ws, { type: "restart_server_result", ok: true });
        send({ type: "toast", level: "info", message: "Server is restarting..." });
        // Small delay so the response has time to reach clients
        setTimeout(function () {
          opts.onRestart();
        }, 500);
      } else {
        sendTo(ws, { type: "restart_server_result", ok: false, error: "Restart not supported" });
      }
      return;
    }

    // --- File browser ---
    if (msg.type === "fs_list" || msg.type === "fs_read" || msg.type === "fs_write" || msg.type === "fs_delete" || msg.type === "fs_rename" || msg.type === "fs_mkdir" || msg.type === "fs_upload") {
      if (ws._clayUser) {
        var fbPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!fbPerms.fileBrowser) {
          sendTo(ws, { type: msg.type + "_result", error: "File browser access is not permitted" });
          return;
        }
      }
    }
    if (msg.type === "fs_list") {
      var fsDir = safePath(cwd, msg.path || ".");
      // In OS user mode, fall back to absolute path resolution (ACL enforces access)
      if (!fsDir && getOsUserInfoForWs(ws)) {
        fsDir = safeAbsPath(msg.path);
      }
      if (!fsDir) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: "Access denied" });
        return;
      }
      try {
        var fsListUserInfo = getOsUserInfoForWs(ws);
        var entries = [];
        if (fsListUserInfo) {
          // Run as target OS user to respect Linux file permissions
          var rawEntries = fsAsUser("list", { dir: fsDir }, fsListUserInfo);
          for (var fi = 0; fi < rawEntries.length; fi++) {
            var re = rawEntries[fi];
            if (re.isDir && IGNORED_DIRS.has(re.name)) continue;
            entries.push({
              name: re.name,
              type: re.isDir ? "dir" : "file",
              path: path.relative(cwd, path.join(fsDir, re.name)).split(path.sep).join("/"),
            });
          }
        } else {
          var items = fs.readdirSync(fsDir, { withFileTypes: true });
          for (var fi = 0; fi < items.length; fi++) {
            var item = items[fi];
            if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
            entries.push({
              name: item.name,
              type: item.isDirectory() ? "dir" : "file",
              path: path.relative(cwd, path.join(fsDir, item.name)).split(path.sep).join("/"),
            });
          }
        }
        sendTo(ws, { type: "fs_list_result", path: msg.path || ".", entries: entries });
        // Auto-watch the directory for changes
        startDirWatch(msg.path || ".");
      } catch (e) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: e.message });
      }
      return;
    }

    if (msg.type === "fs_read") {
      var fsFile = safePath(cwd, msg.path);
      if (!fsFile && getOsUserInfoForWs(ws)) {
        fsFile = safeAbsPath(msg.path);
      }
      if (!fsFile) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, error: "Access denied" });
        return;
      }
      try {
        var fsReadUserInfo = getOsUserInfoForWs(ws);
        var ext = path.extname(fsFile).toLowerCase();
        if (fsReadUserInfo) {
          // Run stat and read as target OS user
          var statResult = fsAsUser("stat", { file: fsFile }, fsReadUserInfo);
          if (statResult.size > FS_MAX_SIZE) {
            sendTo(ws, { type: "fs_read_result", path: msg.path, binary: true, size: statResult.size, error: "File too large (" + (statResult.size / 1024 / 1024).toFixed(1) + " MB)" });
            return;
          }
          if (BINARY_EXTS.has(ext)) {
            var result = { type: "fs_read_result", path: msg.path, binary: true, size: statResult.size };
            if (IMAGE_EXTS.has(ext)) result.imageUrl = "api/file?path=" + encodeURIComponent(msg.path);
            sendTo(ws, result);
            return;
          }
          var readResult = fsAsUser("read", { file: fsFile, readContent: true }, fsReadUserInfo);
          sendTo(ws, { type: "fs_read_result", path: msg.path, content: readResult.content, size: statResult.size });
        } else {
          var stat = fs.statSync(fsFile);
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
        }
      } catch (e) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, error: e.message });
      }
      return;
    }

    // --- File write ---
    if (msg.type === "fs_write") {
      var fsWriteFile = safePath(cwd, msg.path);
      if (!fsWriteFile && getOsUserInfoForWs(ws)) {
        fsWriteFile = safeAbsPath(msg.path);
      }
      if (!fsWriteFile) {
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: false, error: "Access denied" });
        return;
      }
      try {
        var fsWriteUserInfo = getOsUserInfoForWs(ws);
        if (fsWriteUserInfo) {
          fsAsUser("write", { file: fsWriteFile, content: msg.content || "" }, fsWriteUserInfo);
        } else {
          fs.writeFileSync(fsWriteFile, msg.content || "", "utf8");
        }
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: true });
      } catch (e) {
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: false, error: e.message });
      }
      return;
    }

    // --- Project settings permission gate ---
    if (msg.type === "get_project_env" || msg.type === "set_project_env" ||
        msg.type === "read_global_claude_md" || msg.type === "write_global_claude_md" ||
        msg.type === "get_shared_env" || msg.type === "set_shared_env" ||
        msg.type === "transfer_project_owner") {
      if (ws._clayUser) {
        var psPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!psPerms.projectSettings) {
          sendTo(ws, { type: "error", text: "Project settings access is not permitted" });
          return;
        }
      }
    }

    // --- Project environment variables ---
    if (msg.type === "get_project_env") {
      var envrc = "";
      var hasEnvrc = false;
      if (typeof opts.onGetProjectEnv === "function") {
        var envResult = opts.onGetProjectEnv(msg.slug);
        envrc = envResult.envrc || "";
      }
      try {
        var envrcPath = path.join(cwd, ".envrc");
        hasEnvrc = fs.existsSync(envrcPath);
      } catch (e) {}
      sendTo(ws, { type: "project_env_result", slug: msg.slug, envrc: envrc, hasEnvrc: hasEnvrc });
      return;
    }

    if (msg.type === "set_project_env") {
      if (typeof opts.onSetProjectEnv === "function") {
        var envError = validateEnvString(msg.envrc || "");
        if (envError) {
          sendTo(ws, { type: "set_project_env_result", ok: false, slug: msg.slug, error: envError });
          return;
        }
        var setResult = opts.onSetProjectEnv(msg.slug, msg.envrc || "");
        sendTo(ws, { type: "set_project_env_result", ok: setResult.ok, slug: msg.slug, error: setResult.error });
      } else {
        sendTo(ws, { type: "set_project_env_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // --- Global CLAUDE.md ---
    if (msg.type === "read_global_claude_md") {
      var globalMdPath = path.join(require("./config").REAL_HOME, ".claude", "CLAUDE.md");
      try {
        var globalMdContent = fs.readFileSync(globalMdPath, "utf8");
        sendTo(ws, { type: "global_claude_md_result", content: globalMdContent });
      } catch (e) {
        sendTo(ws, { type: "global_claude_md_result", error: e.message });
      }
      return;
    }

    if (msg.type === "write_global_claude_md") {
      var globalMdDir = path.join(require("./config").REAL_HOME, ".claude");
      var globalMdWritePath = path.join(globalMdDir, "CLAUDE.md");
      try {
        if (!fs.existsSync(globalMdDir)) {
          fs.mkdirSync(globalMdDir, { recursive: true });
        }
        fs.writeFileSync(globalMdWritePath, msg.content || "", "utf8");
        sendTo(ws, { type: "write_global_claude_md_result", ok: true });
      } catch (e) {
        sendTo(ws, { type: "write_global_claude_md_result", ok: false, error: e.message });
      }
      return;
    }

    // --- Shared environment variables ---
    if (msg.type === "get_shared_env") {
      var sharedEnvrc = "";
      if (typeof opts.onGetSharedEnv === "function") {
        var sharedResult = opts.onGetSharedEnv();
        sharedEnvrc = sharedResult.envrc || "";
      }
      sendTo(ws, { type: "shared_env_result", envrc: sharedEnvrc });
      return;
    }

    if (msg.type === "set_shared_env") {
      if (typeof opts.onSetSharedEnv === "function") {
        var sharedEnvError = validateEnvString(msg.envrc || "");
        if (sharedEnvError) {
          sendTo(ws, { type: "set_shared_env_result", ok: false, error: sharedEnvError });
          return;
        }
        var sharedSetResult = opts.onSetSharedEnv(msg.envrc || "");
        sendTo(ws, { type: "set_shared_env_result", ok: sharedSetResult.ok, error: sharedSetResult.error });
      } else {
        sendTo(ws, { type: "set_shared_env_result", ok: false, error: "Not supported" });
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

    // --- File edit history ---
    if (msg.type === "fs_file_history") {
      var histPath = msg.path;
      if (!histPath) {
        sendTo(ws, { type: "fs_file_history_result", path: histPath, entries: [] });
        return;
      }
      var absHistPath = path.resolve(cwd, histPath);
      var entries = [];

      // Collect session edits
      sm.sessions.forEach(function (session) {
        var sessionLocalId = session.localId;
        var sessionTitle = session.title || "Untitled";
        var histLen = session.history.length || 1;

        for (var hi = 0; hi < session.history.length; hi++) {
          var entry = session.history[hi];
          if (entry.type !== "tool_executing") continue;
          if (entry.name !== "Edit" && entry.name !== "Write") continue;
          if (!entry.input || !entry.input.file_path) continue;
          if (entry.input.file_path !== absHistPath) continue;

          // Find parent assistant UUID + message snippet by scanning backwards
          var assistantUuid = null;
          var uuidIndex = -1;
          for (var hj = hi - 1; hj >= 0; hj--) {
            if (session.history[hj].type === "message_uuid" && session.history[hj].messageType === "assistant") {
              assistantUuid = session.history[hj].uuid;
              uuidIndex = hj;
              break;
            }
          }

          // Find user prompt by scanning backwards from the assistant uuid
          var messageSnippet = "";
          var searchFrom = uuidIndex >= 0 ? uuidIndex : hi;
          for (var hk = searchFrom - 1; hk >= 0; hk--) {
            if (session.history[hk].type === "user_message" && session.history[hk].text) {
              messageSnippet = session.history[hk].text.trim().substring(0, 100);
              break;
            }
          }

          // Collect Claude's explanation: scan backwards from tool_executing
          // to find the nearest delta text block (skipping tool_start).
          // If no delta found immediately before this tool, scan past
          // intervening tool blocks to find the last delta text within
          // the same assistant turn.
          var assistantSnippet = "";
          var deltaChunks = [];
          for (var hd = hi - 1; hd >= 0; hd--) {
            var hEntry = session.history[hd];
            if (hEntry.type === "tool_start") continue;
            if (hEntry.type === "delta" && hEntry.text) {
              deltaChunks.unshift(hEntry.text);
            } else {
              break;
            }
          }
          if (deltaChunks.length === 0) {
            // No delta immediately before; scan past tool blocks
            // to find the nearest preceding delta in the same turn
            for (var hd2 = hi - 1; hd2 >= 0; hd2--) {
              var hEntry2 = session.history[hd2];
              if (hEntry2.type === "tool_start" || hEntry2.type === "tool_executing" || hEntry2.type === "tool_result") continue;
              if (hEntry2.type === "delta" && hEntry2.text) {
                // Found a delta before an earlier tool in the same turn.
                // Collect this contiguous block of deltas.
                for (var hd3 = hd2; hd3 >= 0; hd3--) {
                  var hEntry3 = session.history[hd3];
                  if (hEntry3.type === "tool_start") continue;
                  if (hEntry3.type === "delta" && hEntry3.text) {
                    deltaChunks.unshift(hEntry3.text);
                  } else {
                    break;
                  }
                }
                break;
              } else {
                // Hit message_uuid, user_message, etc. Stop.
                break;
              }
            }
          }
          assistantSnippet = deltaChunks.join("").trim().substring(0, 150);

          // Approximate timestamp: interpolate between session creation and last activity
          var tStart = session.createdAt || 0;
          var tEnd = session.lastActivity || tStart;
          var ts = tStart + Math.floor((hi / histLen) * (tEnd - tStart));

          var editRecord = {
            source: "session",
            timestamp: ts,
            sessionLocalId: sessionLocalId,
            sessionTitle: sessionTitle,
            assistantUuid: assistantUuid,
            toolId: entry.id,
            messageSnippet: messageSnippet,
            assistantSnippet: assistantSnippet,
            toolName: entry.name,
          };

          if (entry.name === "Edit") {
            editRecord.old_string = entry.input.old_string || "";
            editRecord.new_string = entry.input.new_string || "";
          } else {
            editRecord.isFullWrite = true;
          }

          entries.push(editRecord);
        }
      });

      // Collect git commits
      try {
        var gitLog = execFileSync(
          "git", ["log", "--format=%H|%at|%an|%s", "--follow", "--", histPath],
          { cwd: cwd, encoding: "utf8", timeout: 5000 }
        );
        var gitLines = gitLog.trim().split("\n");
        for (var gi = 0; gi < gitLines.length; gi++) {
          if (!gitLines[gi]) continue;
          var parts = gitLines[gi].split("|");
          if (parts.length < 4) continue;
          entries.push({
            source: "git",
            hash: parts[0],
            timestamp: parseInt(parts[1], 10) * 1000,
            author: parts[2],
            message: parts.slice(3).join("|"),
          });
        }
      } catch (e) {
        // Not a git repo or file not tracked, that's fine
      }

      // Sort by timestamp descending (newest first)
      entries.sort(function (a, b) { return b.timestamp - a.timestamp; });

      sendTo(ws, { type: "fs_file_history_result", path: histPath, entries: entries });
      return;
    }

    // --- Git diff for file history ---
    if (msg.type === "fs_git_diff") {
      var diffPath = msg.path;
      var hash = msg.hash;
      var hash2 = msg.hash2 || null;
      if (!diffPath || !hash) {
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, path: diffPath, diff: "", error: "Missing params" });
        return;
      }
      try {
        var diff;
        if (hash2) {
          diff = execFileSync("git", ["diff", hash, hash2, "--", diffPath],
            { cwd: cwd, encoding: "utf8", timeout: 5000 });
        } else {
          diff = execFileSync("git", ["show", hash, "--format=", "--", diffPath],
            { cwd: cwd, encoding: "utf8", timeout: 5000 });
        }
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, hash2: hash2, path: diffPath, diff: diff || "" });
      } catch (e) {
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, hash2: hash2, path: diffPath, diff: "", error: e.message });
      }
      return;
    }

    // --- File content at a git commit ---
    if (msg.type === "fs_file_at") {
      var atPath = msg.path;
      var atHash = msg.hash;
      if (!atPath || !atHash) {
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: "Missing params" });
        return;
      }
      try {
        // Convert to repo-relative path (git show requires hash:relative/path)
        var atAbsPath = path.resolve(cwd, atPath);
        var atRelPath = path.relative(cwd, atAbsPath);
        var content = execFileSync("git", ["show", atHash + ":" + atRelPath],
          { cwd: cwd, encoding: "utf8", timeout: 5000 });
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: content });
      } catch (e) {
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: e.message });
      }
      return;
    }

    // --- Sticky notes ---
    function syncNotesKnowledge() {
      if (!isMate) return;
      try {
        var knDir = path.join(cwd, "knowledge");
        var knFile = path.join(knDir, "sticky-notes.md");
        var text = nm.getActiveNotesText();
        if (text) {
          fs.mkdirSync(knDir, { recursive: true });
          fs.writeFileSync(knFile, text);
        } else {
          try { fs.unlinkSync(knFile); } catch (e) {}
        }
      } catch (e) {
        console.error("[project] Failed to sync sticky-notes.md:", e.message);
      }
    }

    if (msg.type === "note_create") {
      var note = nm.create(msg);
      if (note) {
        send({ type: "note_created", note: note });
        syncNotesKnowledge();
      }
      return;
    }

    if (msg.type === "note_update") {
      if (!msg.id) return;
      var updated = nm.update(msg.id, msg);
      if (updated) {
        send({ type: "note_updated", note: updated });
        if (msg.text !== undefined || msg.hidden !== undefined) syncNotesKnowledge();
      }
      return;
    }

    if (msg.type === "note_delete") {
      if (!msg.id) return;
      if (nm.remove(msg.id)) {
        send({ type: "note_deleted", id: msg.id });
        syncNotesKnowledge();
      }
      return;
    }

    if (msg.type === "note_list_request") {
      sendTo(ws, { type: "notes_list", notes: nm.list() });
      return;
    }

    if (msg.type === "note_bring_front") {
      if (!msg.id) return;
      var front = nm.bringToFront(msg.id);
      if (front) send({ type: "note_updated", note: front });
      return;
    }

    // --- Web terminal ---
    if (msg.type === "term_create") {
      if (ws._clayUser) {
        var termPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!termPerms.terminal) {
          sendTo(ws, { type: "term_error", error: "Terminal access is not permitted" });
          return;
        }
      }
      var t = tm.create(msg.cols || 80, msg.rows || 24, getOsUserInfoForWs(ws), ws);
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
        tm.resize(msg.id, msg.cols, msg.rows, ws);
      }
      return;
    }

    if (msg.type === "term_close") {
      if (msg.id) {
        tm.close(msg.id);
        send({ type: "term_list", terminals: tm.list() });
        // Remove closed terminal from context sources
        var saved = loadContextSources(slug);
        var termKey = "term:" + msg.id;
        var filtered = saved.filter(function(id) { return id !== termKey; });
        if (filtered.length !== saved.length) {
          saveContextSources(slug, filtered);
          send({ type: "context_sources_state", active: filtered });
        }
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

    // --- Context Sources ---
    if (msg.type === "context_sources_save") {
      var activeIds = msg.active || [];
      saveContextSources(slug, activeIds);
      return;
    }

    // --- Browser Extension ---
    if (msg.type === "browser_tab_list") {
      _extensionWs = ws; // Track which client has the extension
      var tabs = msg.tabs || [];
      _browserTabList = {};
      for (var bti = 0; bti < tabs.length; bti++) {
        _browserTabList[tabs[bti].id] = tabs[bti];
      }
      return;
    }

    if (msg.type === "extension_result") {
      var pending = pendingExtensionRequests[msg.requestId];
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(msg.result);
        delete pendingExtensionRequests[msg.requestId];
      }
      return;
    }

    // --- Scheduled tasks permission gate ---
    if (msg.type === "loop_start" || msg.type === "loop_stop" || msg.type === "loop_registry_files" ||
        msg.type === "loop_registry_list" || msg.type === "loop_registry_update" || msg.type === "loop_registry_rename" ||
        msg.type === "loop_registry_remove" || msg.type === "loop_registry_convert" || msg.type === "loop_registry_toggle" ||
        msg.type === "loop_registry_rerun" || msg.type === "schedule_create" || msg.type === "schedule_move") {
      if (ws._clayUser) {
        var schPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!schPerms.scheduledTasks) {
          sendTo(ws, { type: "error", text: "Scheduled tasks access is not permitted" });
          return;
        }
      }
    }

    // --- Loop message delegation (project-loop.js) ---
    if (_loop.handleLoopMessage(ws, msg)) return;

    // --- Schedule message for after rate limit resets ---
    if (msg.type === "schedule_message") {
      var schedSession = getSessionForWs(ws);
      if (!schedSession || !msg.text || !msg.resetsAt) return;
      scheduleMessage(schedSession, msg.text, msg.resetsAt);
      return;
    }

    if (msg.type === "cancel_scheduled_message") {
      var cancelSession = getSessionForWs(ws);
      if (!cancelSession) return;
      cancelScheduledMessage(cancelSession);
      return;
    }

    if (msg.type === "send_scheduled_now") {
      var nowSession = getSessionForWs(ws);
      if (!nowSession || !nowSession.scheduledMessage) return;
      var schedText = nowSession.scheduledMessage.text;
      clearTimeout(nowSession.scheduledMessage.timer);
      nowSession.scheduledMessage = null;
      console.log("[project] Scheduled message sent immediately for session " + nowSession.localId);
      sm.sendAndRecord(nowSession, { type: "scheduled_message_sent" });
      var userMsg = { type: "user_message", text: schedText };
      nowSession.history.push(userMsg);
      sm.appendToSessionFile(nowSession, userMsg);
      sendToSession(nowSession.localId, userMsg);
      nowSession.isProcessing = true;
      onProcessingChanged();
      sendToSession(nowSession.localId, { type: "status", status: "processing" });
      sdk.startQuery(nowSession, schedText, null, getLinuxUserForSession(nowSession));
      sm.broadcastSessionList();
      return;
    }

    if (msg.type !== "message") return;
    if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.pastes || msg.pastes.length === 0)) return;

    var session = getSessionForWs(ws);
    if (!session) return;

    // Backfill ownerId for legacy sessions restored without one (multi-user only)
    if (!session.ownerId && ws._clayUser && usersModule.isMultiUser()) {
      session.ownerId = ws._clayUser.id;
      sm.saveSessionFile(session);
    }

    // Keep any pending scheduled message alive when user sends a regular message

    var userMsg = { type: "user_message", text: msg.text || "" };
    // Attach sender info for multi-user attribution (backward-compatible: old clients ignore these)
    if (ws._clayUser) {
      userMsg.from = ws._clayUser.id;
      userMsg.fromName = ws._clayUser.displayName || ws._clayUser.username || "";
    }
    var savedImagePaths = [];
    if (msg.images && msg.images.length > 0) {
      userMsg.imageCount = msg.images.length;
      // Save images as files, store URL references in history
      var imageRefs = [];
      for (var imgIdx = 0; imgIdx < msg.images.length; imgIdx++) {
        var img = msg.images[imgIdx];
        var savedName = saveImageFile(img.mediaType, img.data, getLinuxUserForSession(session));
        if (savedName) {
          imageRefs.push({ mediaType: img.mediaType, file: savedName });
          savedImagePaths.push(path.join(imagesDir, savedName));
        }
      }
      if (imageRefs.length > 0) {
        userMsg.imageRefs = imageRefs;
      }
    }
    if (msg.pastes && msg.pastes.length > 0) {
      userMsg.pastes = msg.pastes;
    }
    session.history.push(userMsg);
    sm.appendToSessionFile(session, userMsg);
    sendToSessionOthers(ws, session.localId, hydrateImageRefs(userMsg));

    if (!session.title) {
      session.title = (msg.text || "Image").substring(0, 50);
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
      // Sync auto-title to SDK
      if (session.cliSessionId) {
        getSDK().then(function(sdk) {
          sdk.renameSession(session.cliSessionId, session.title, { dir: cwd }).catch(function(e) {
            console.error("[project] SDK renameSession failed:", e.message);
          });
        }).catch(function() {});
      }
    }

    var fullText = msg.text || "";
    // Prepend saved image paths so Claude can copy/save them
    if (savedImagePaths.length > 0) {
      var imgPathLines = savedImagePaths.map(function (p) { return "[Uploaded image: " + p + "]"; }).join("\n");
      fullText = imgPathLines + (fullText ? "\n" + fullText : "");
    }
    if (msg.pastes && msg.pastes.length > 0) {
      for (var pi = 0; pi < msg.pastes.length; pi++) {
        if (fullText) fullText += "\n\n";
        fullText += msg.pastes[pi];
      }
    }

    // Inject pending @mention context so the current agent sees the exchange
    if (session.pendingMentionContexts && session.pendingMentionContexts.length > 0) {
      var mentionPrefix = session.pendingMentionContexts.join("\n\n");
      session.pendingMentionContexts = [];
      fullText = mentionPrefix + "\n\n" + fullText;
    }

    // Inject active terminal context sources (delta only: send new output since last message)
    var TERM_CONTEXT_MAX = 8192; // 8KB max per terminal per message
    var TERM_HEAD_SIZE = 2048;   // keep first 2KB for error context
    var TERM_TAIL_SIZE = 6144;   // keep last 6KB for recent state
    var ctxSources = loadContextSources(slug);
    if (ctxSources.length > 0) {
      if (!session._termContextCursors) session._termContextCursors = {};
      var termContextParts = [];
      for (var ci = 0; ci < ctxSources.length; ci++) {
        var srcId = ctxSources[ci];
        if (srcId.startsWith("term:")) {
          var termId = parseInt(srcId.split(":")[1], 10);
          var sb = tm.getScrollback(termId);
          if (sb) {
            var lastCursor;
            if (termId in session._termContextCursors) {
              lastCursor = session._termContextCursors[termId];
              // Terminal was recycled (closed and reopened with same ID) — reset cursor
              if (lastCursor > sb.totalBytesWritten) lastCursor = 0;
            } else {
              // First time seeing this terminal — include last 8KB (what user can see now)
              lastCursor = Math.max(0, sb.totalBytesWritten - TERM_CONTEXT_MAX);
            }
            var newBytes = sb.totalBytesWritten - lastCursor;
            session._termContextCursors[termId] = sb.totalBytesWritten;
            if (newBytes <= 0) continue;
            // Build timestamped delta from chunks
            var deltaChunks = [];
            var bytePos = sb.bufferStart;
            for (var chunkIdx = 0; chunkIdx < sb.chunks.length; chunkIdx++) {
              var chunk = sb.chunks[chunkIdx];
              var chunkEnd = bytePos + chunk.data.length;
              if (chunkEnd > lastCursor) {
                // This chunk has new content
                var chunkData = chunk.data;
                if (bytePos < lastCursor) {
                  // Partial chunk: only the part after lastCursor
                  chunkData = chunkData.slice(lastCursor - bytePos);
                }
                deltaChunks.push({ ts: chunk.ts, data: chunkData });
              }
              bytePos = chunkEnd;
            }
            if (deltaChunks.length === 0) continue;
            // Format with timestamps: group by second to avoid excessive timestamps
            var lines = [];
            var lastTimeSec = 0;
            for (var di = 0; di < deltaChunks.length; di++) {
              var dc = deltaChunks[di];
              var cleaned = dc.data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
              if (!cleaned) continue;
              var timeSec = Math.floor(dc.ts / 1000);
              if (timeSec !== lastTimeSec) {
                var d = new Date(dc.ts);
                var timeStr = d.toTimeString().slice(0, 8); // HH:MM:SS
                lines.push("[" + timeStr + "] " + cleaned);
                lastTimeSec = timeSec;
              } else {
                lines.push(cleaned);
              }
            }
            var delta = lines.join("").trim();
            if (!delta) continue;
            var termInfo = tm.list().find(function(t) { return t.id === termId; });
            var termTitle = termInfo ? termInfo.title : "Terminal " + termId;
            var header;
            if (delta.length > TERM_CONTEXT_MAX) {
              var head = delta.slice(0, TERM_HEAD_SIZE);
              var tail = delta.slice(-TERM_TAIL_SIZE);
              var omittedBytes = delta.length - TERM_HEAD_SIZE - TERM_TAIL_SIZE;
              var omittedLines = delta.slice(TERM_HEAD_SIZE, delta.length - TERM_TAIL_SIZE).split("\n").length;
              delta = head + "\n\n... (" + omittedLines + " lines / " + Math.round(omittedBytes / 1024) + "KB omitted) ...\n\n" + tail;
              header = "[New terminal output from " + termTitle + " (large output, head+tail shown)]";
            } else {
              header = "[New terminal output from " + termTitle + "]";
            }
            termContextParts.push(header + "\n```\n" + delta + "\n```");
          }
        }
      }
      if (termContextParts.length > 0) {
        fullText = termContextParts.join("\n\n") + "\n\n" + fullText;
      }
    }

    // Collect browser tab context (async: requires round-trip to client extension)
    var tabSources = ctxSources.filter(function(id) {
      if (!id.startsWith("tab:")) return false;
      // Only include tabs that currently exist in the browser
      var tid = parseInt(id.split(":")[1], 10);
      return !!_browserTabList[tid];
    });

    function dispatchToSdk(finalText) {
      if (!session.isProcessing) {
        session.isProcessing = true;
        onProcessingChanged();
        session.sentToolResults = {};
        sendToSession(session.localId, { type: "status", status: "processing" });
        if (!session.queryInstance && (!session.worker || session.messageQueue !== "worker")) {
          // No active query (or worker idle between queries): start a new query
          session._queryStartTs = Date.now();
          console.log("[PERF] project.js: startQuery called, localId=" + session.localId + " t=0ms");
          sdk.startQuery(session, finalText, msg.images, getLinuxUserForSession(session));
        } else {
          sdk.pushMessage(session, finalText, msg.images);
        }
      } else {
        sdk.pushMessage(session, finalText, msg.images);
      }
      sm.broadcastSessionList();
    }

    if (tabSources.length > 0) {
      // Request tab context from all active browser tab sources
      var tabPromises = tabSources.map(function(srcId) {
        var tabId = parseInt(srcId.split(":")[1], 10);
        return requestTabContext(ws, tabId);
      });
      Promise.all(tabPromises).then(function(results) {
        var tabContextParts = [];
        var screenshotImages = [];

        for (var ti = 0; ti < results.length; ti++) {
          if (!results[ti]) continue;
          var tabId2 = parseInt(tabSources[ti].split(":")[1], 10);
          var tabInfo = _browserTabList[tabId2];
          var tabLabel = tabInfo ? (tabInfo.title || tabInfo.url || "Tab " + tabId2) : "Tab " + tabId2;
          var r = results[ti];
          var parts = [];

          // Console logs
          if (r.console && r.console.logs) {
            try {
              var logs = typeof r.console.logs === "string" ? JSON.parse(r.console.logs) : r.console.logs;
              if (logs && logs.length > 0) {
                var logLines = [];
                var logSlice = logs.slice(-50);
                for (var li = 0; li < logSlice.length; li++) {
                  var entry = logSlice[li];
                  var ts = entry.ts ? new Date(entry.ts).toTimeString().slice(0, 8) : "";
                  var lvl = (entry.level || "log").toUpperCase();
                  logLines.push("[" + ts + " " + lvl + "] " + (entry.text || ""));
                }
                parts.push("Console:\n" + logLines.join("\n"));
              }
            } catch (e) {
              // ignore parse errors
            }
          }

          // Network requests
          if (r.network && r.network.network) {
            try {
              var netLog = typeof r.network.network === "string" ? JSON.parse(r.network.network) : r.network.network;
              if (netLog && netLog.length > 0) {
                var netLines = [];
                var netSlice = netLog.slice(-30);
                for (var ni = 0; ni < netSlice.length; ni++) {
                  var req = netSlice[ni];
                  var line = (req.method || "GET") + " " + (req.url || "") + " " + (req.status || 0) + " " + (req.duration || 0) + "ms";
                  if (req.error) line += " [" + req.error + "]";
                  netLines.push(line);
                }
                parts.push("Network (last " + netSlice.length + " requests):\n" + netLines.join("\n"));
              }
            } catch (e) {
              // ignore parse errors
            }
          }

          // Page text (from tab_page_text command)
          if (r.pageText && (r.pageText.text || r.pageText.value)) {
            var pageContent = r.pageText.text || r.pageText.value;
            if (pageContent.length > 0) {
              if (pageContent.length > 32768) {
                pageContent = pageContent.substring(0, 32768) + "\n... (truncated)";
              }
              parts.push("Page text:\n" + pageContent);
            }
          }

          // Screenshot — save to disk and add to images for SDK
          if (r.screenshot && r.screenshot.image) {
            try {
              var screenshotData = r.screenshot.image;
              var screenshotName = saveImageFile("image/png", screenshotData, getLinuxUserForSession(session));
              if (screenshotName) {
                var screenshotPath = path.join(imagesDir, screenshotName);
                // Add to images array for SDK multimodal
                screenshotImages.push({
                  mediaType: "image/png",
                  data: screenshotData,
                  file: screenshotName,
                  tabTitle: tabLabel,
                  tabUrl: tabInfo ? tabInfo.url : "",
                  tabFavIconUrl: tabInfo ? tabInfo.favIconUrl : ""
                });
                parts.push("[Screenshot saved: " + screenshotPath + "]");
              }
            } catch (e) {
              // ignore screenshot save errors
            }
          }

          if (r.console && r.console.error) {
            parts.push("(Console error: " + r.console.error + ")");
          }
          if (r.network && r.network.error) {
            parts.push("(Network error: " + r.network.error + ")");
          }

          if (parts.length > 0) {
            tabContextParts.push("[Browser tab: " + tabLabel + "]\n" + parts.join("\n\n"));
          }
        }

        if (tabContextParts.length > 0) {
          fullText = "[The following browser tab data is automatically attached as context sources. Do NOT call browser_read_page, browser_console, browser_network, or browser_screenshot for these tabs — the data is already here.]\n\n" +
            tabContextParts.join("\n\n---\n\n") + "\n\n" + fullText;
        }

        // If screenshots were captured, send context preview cards and add to SDK images
        if (screenshotImages.length > 0) {
          if (!msg.images) msg.images = [];
          for (var si = 0; si < screenshotImages.length; si++) {
            var ss = screenshotImages[si];
            // Save context_preview to history so it restores on session load
            var previewEntry = {
              type: "context_preview",
              tab: {
                title: ss.tabTitle || "",
                url: ss.tabUrl || "",
                favIconUrl: ss.tabFavIconUrl || "",
                screenshotFile: ss.file
              }
            };
            session.history.push(previewEntry);
            // Send context card to all clients
            sendToSession(session.localId, {
              type: "context_preview",
              tab: {
                title: ss.tabTitle || "",
                url: ss.tabUrl || "",
                favIconUrl: ss.tabFavIconUrl || "",
                screenshotUrl: "/p/" + slug + "/images/" + ss.file
              }
            });
            // Add to SDK images for multimodal
            msg.images.push({ mediaType: ss.mediaType, data: ss.data });
          }
          sm.saveSessionFile(session);
        }

        dispatchToSdk(fullText);
      });
    } else {
      dispatchToSdk(fullText);
    }
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

  // --- WS disconnection handler ---
  function handleDisconnection(ws) {
    // Persist last active session for this user before cleanup
    if (ws._clayActiveSession) {
      var dcPresKey = ws._clayUser ? ws._clayUser.id : "_default";
      var dcExisting = userPresence.getPresence(slug, dcPresKey);
      userPresence.setPresence(slug, dcPresKey, ws._clayActiveSession, dcExisting ? dcExisting.mateDm : null);
    }
    tm.detachAll(ws);
    clients.delete(ws);
    if (clients.size === 0) {
      stopFileWatch();
      stopAllDirWatches();
    }
    broadcastClientCount();
    broadcastPresence();
  }

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
