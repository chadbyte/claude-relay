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
var { resolveOsUserInfo, fsAsUser, grantProjectAccess } = require("./os-users");
var crisisSafety = require("./crisis-safety");
var matesModule = require("./mates");
var sessionSearch = require("./session-search");
var userPresence = require("./user-presence");
var { attachDebate } = require("./project-debate");
var { attachMemory } = require("./project-memory");
var { attachMateInteraction } = require("./project-mate-interaction");
var { attachUserMention } = require("./project-user-mention");
var { attachLoop } = require("./project-loop");
var { attachFileWatch } = require("./project-file-watch");
var { attachHTTP } = require("./project-http");
var { attachImage } = require("./project-image");
var { attachKnowledge } = require("./project-knowledge");
var { attachFilesystem } = require("./project-filesystem");
var { attachSessions } = require("./project-sessions");
var { attachUserMessage } = require("./project-user-message");
var { attachConnection } = require("./project-connection");
var { attachMcp } = require("./project-mcp");
var { attachMateDatastore } = require("./project-mate-datastore");
var { createLocalMcp } = require("./mcp-local");
var { attachEmail: attachEmailModule } = require("./project-email");
// project-notifications is attached globally in server.js, passed via opts.notificationsModule

// --- Context Sources persistence ---
var _ctxSrcConfig = require("./config");
var _ctxSrcDir = path.join(_ctxSrcConfig.CONFIG_DIR, "context-sources");

function loadContextSources(slug, sessionId) {
  try {
    var key = sessionId ? slug + "--" + sessionId : slug;
    var filePath = path.join(_ctxSrcDir, key + ".json");
    var data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return data.active || [];
  } catch (e) {
    return [];
  }
}

function saveContextSources(slug, sessionId, activeIds) {
  try {
    if (!fs.existsSync(_ctxSrcDir)) {
      fs.mkdirSync(_ctxSrcDir, { recursive: true });
    }
    var key = sessionId ? slug + "--" + sessionId : slug;
    var filePath = path.join(_ctxSrcDir, key + ".json");
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

// YOKE adapter (replaces direct SDK access)
var yoke = require("./yoke");

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
  var isAgent = opts.isAgent || false;
  var agentName = opts.agentName || "";
  var agentDescription = opts.agentDescription || "";
  var agentModel = opts.agentModel || "";
  var agentBody = opts.agentBody || "";
  var agentHomeDir = opts.agentHomeDir || "";
  var onCreateWorktree = opts.onCreateWorktree || null;
  var serverPort = opts.port || 2633;
  var serverTls = opts.tls || false;
  var serverAuthToken = opts.authToken || null;
  var latestVersion = null;
  var sessionTitleMigrationScheduled = false;

  // --- YOKE adapters (multi-vendor, lazy init) ---
  var _yokeState = yoke.createAdapters({ cwd: cwd, slug: slug });
  var adapters = _yokeState.adapters;
  var defaultVendor = adapters.claude ? "claude" : Object.keys(adapters)[0] || "claude";
  var adapter = adapters[defaultVendor] || null;

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

  function ensureProjectAccessForSession(session) {
    var linuxUser = getLinuxUserForSession(session);
    if (linuxUser) {
      grantProjectAccess(cwd, linuxUser);
    }
    return linuxUser;
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

  // --- Browser extension state (shared mutable object) ---
  var _pendingDebateProposals = {}; // proposalId -> { resolve, briefData }
  var _extToken = crypto.randomUUID(); // Auth token for MCP server bridge
  var browserState = {
    _browserTabList: {},
    _extensionWs: null,
    pendingExtensionRequests: {}
  };

  function sendExtensionCommand(ws, command, args, timeout) {
    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      var ms = timeout || 3000;
      var timer = setTimeout(function() {
        delete browserState.pendingExtensionRequests[requestId];
        resolve(null);
      }, ms);
      browserState.pendingExtensionRequests[requestId] = { resolve: resolve, timer: timer };
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
    if (!browserState._extensionWs || browserState._extensionWs.readyState !== 1) {
      return Promise.reject(new Error("Browser extension not connected"));
    }
    return sendExtensionCommand(browserState._extensionWs, command, args, timeout);
  }

  function requestTabContext(tabId) {
    if (!browserState._extensionWs || browserState._extensionWs.readyState !== 1) {
      return Promise.resolve(null);
    }
    var extWs = browserState._extensionWs;
    // Try inject first (best-effort), then request all data in parallel.
    // Even if inject fails (CSP etc.), page text and screenshot still work.
    return sendExtensionCommand(extWs, "tab_inject", { tabId: tabId }).then(function() {}, function() {}).then(function() {
      return Promise.all([
        sendExtensionCommand(extWs, "tab_console", { tabId: tabId }),
        sendExtensionCommand(extWs, "tab_network", { tabId: tabId }),
        sendExtensionCommand(extWs, "tab_page_text", { tabId: tabId }),
        sendExtensionCommand(extWs, "tab_screenshot", { tabId: tabId })
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
  sm.availableVendors = Object.keys(adapters);
  sm.defaultVendor = defaultVendor;

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

  // --- Local MCP (direct process management for localhost clients) ---
  var _localMcp = createLocalMcp();

  // --- MCP bridge (remote MCP servers via Chrome Extension) ---
  var _mcp = attachMcp({
    send: send,
    sendTo: sendTo,
    slug: slug,
    isMate: isMate,
    getExtensionWs: function () { return browserState._extensionWs; },
    getExtensionId: function () { return browserState._extensionId || null; },
    getEnabledMcpServers: function () {
      return typeof opts.onGetProjectMcpServers === "function"
        ? opts.onGetProjectMcpServers(slug) : [];
    },
    setEnabledMcpServers: function (servers) {
      if (typeof opts.onSetProjectMcpServers === "function") {
        opts.onSetProjectMcpServers(slug, servers);
      }
    },
    localMcp: _localMcp,
  });

  // --- Email module (delegated to project-email.js) ---
  var _email = attachEmailModule({
    slug: slug,
    send: send,
    sendTo: sendTo,
    clients: clients,
    loadContextSources: loadContextSources,
    getUserIdForWs: function (ws) {
      return (ws._clayUser && ws._clayUser.id) || "default";
    },
  });

  // --- Mate datastore (Mate projects only) ---
  var _mateDatastore = attachMateDatastore({
    cwd: cwd,
    slug: slug,
    isMate: isMate,
    send: send,
    sendTo: sendTo,
    clients: clients,
    getSessionForWs: getSessionForWs,
    usersModule: usersModule,
    getProjectOwnerId: function () { return projectOwnerId; },
  });

  // --- MCP tool servers (created via YOKE adapter) ---
  var mcpServers = (function () {
    var servers = {};

    // Debate MCP server (available to both mates and main project)
    try {
      var debateMcp = require("./debate-mcp-server");
      var debateToolDefs = debateMcp.getToolDefs(function onPropose(briefData) {
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
      var debateMcpConfig = adapter.createToolServer({ name: "clay-debate", version: "1.0.0", tools: debateToolDefs });
      if (debateMcpConfig) servers[debateMcpConfig.name || "clay-debate"] = debateMcpConfig;
    } catch (e) {
      console.error("[project] Failed to create debate MCP server:", e.message);
    }

    // Ask-user MCP server (mates only)
    if (isMate) {
      try {
        var askUserMcp = require("./ask-user-mcp-server");
        var askUserToolDefs = askUserMcp.getToolDefs(function onAsk(input) {
          // Stateless: the tool's job is to *post* the question card.
          // We do NOT hold a promise open waiting for the user. When the
          // user answers, the answer is injected as a fresh user message
          // on the next turn (see project-sessions.js ask_user_response).
          // This avoids HTTP long-poll timeouts on the MCP bridge and
          // matches the natural multi-turn agent loop.
          var session = sm.getActiveSession();
          if (!session) {
            // No active session means we have no way to show a card or
            // route the answer. Fail closed rather than pretend success.
            return Promise.resolve({
              content: [{ type: "text", text: "Error: no active session in " + slug + "; cannot display question card." }],
              isError: true,
            });
          }
          if (session.loop && session.loop.active && session.loop.role !== "crafting") {
            return Promise.resolve({
              content: [{ type: "text", text: "Error: Autonomous mode. Make your own decision." }],
              isError: true,
            });
          }

          var toolId = "ask_" + Date.now() + "_" + crypto.randomUUID().slice(0, 8);
          // Track for UI card lifecycle + answer routing. No resolve function.
          session.pendingAskUser[toolId] = {
            input: input,
            mode: "mcp",
            sessionId: session.localId,
            postedAt: Date.now(),
          };

          sm.sendAndRecord(session, {
            type: "tool_executing",
            id: toolId,
            name: "AskUserQuestion",
            input: input,
          });

          return Promise.resolve({
            content: [{
              type: "text",
              text: "The question card has been posted to the user. End this turn now without further commentary; the user's answer will arrive as the next user message.",
            }],
          });
        });
        var askUserMcpConfig = adapter.createToolServer({ name: "clay-ask-user", version: "1.0.0", tools: askUserToolDefs });
        if (askUserMcpConfig) servers[askUserMcpConfig.name || "clay-ask-user"] = askUserMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create ask-user MCP server:", e.message);
      }
    }

    // Browser MCP server (main project only, not mates)
    if (!isMate) {
      try {
        var browserMcp = require("./browser-mcp-server");
        var browserToolDefs = browserMcp.getToolDefs(sendExtensionCommandAny, function () {
          return Object.values(browserState._browserTabList || {});
        }, {
          watchTab: function (tabId) {
            var key = "tab:" + tabId;
            // Apply to all connected clients' active sessions
            for (var c of clients) {
              if (c.readyState !== 1) continue;
              var sid = c._clayActiveSession || null;
              var active = loadContextSources(slug, sid);
              if (active.indexOf(key) === -1) {
                active.push(key);
                saveContextSources(slug, sid, active);
                c.send(JSON.stringify({ type: "context_sources_state", active: active }));
              }
            }
            return [];
          },
          unwatchTab: function (tabId) {
            var key = "tab:" + tabId;
            for (var c of clients) {
              if (c.readyState !== 1) continue;
              var sid = c._clayActiveSession || null;
              var active = loadContextSources(slug, sid);
              var idx = active.indexOf(key);
              if (idx !== -1) {
                active.splice(idx, 1);
                saveContextSources(slug, sid, active);
                c.send(JSON.stringify({ type: "context_sources_state", active: active }));
              }
            }
            return active;
          },
        });
        var mcpConfig = adapter.createToolServer({ name: "clay-browser", version: "1.0.0", tools: browserToolDefs });
        if (mcpConfig) servers[mcpConfig.name || "clay-browser"] = mcpConfig;
      } catch (e) {
        console.error("[project] Failed to create browser MCP server:", e.message);
      }
    }

    // Email MCP server (available to both mates and main project)
    // Note: email-mcp-server still uses the legacy create() pattern (not yet converted to getToolDefs).
    try {
      var emailMcp = require("./email-mcp-server");
      var emailMcpConfig = emailMcp.create(_email.createMcpDeps());
      if (emailMcpConfig) servers[emailMcpConfig.name || "clay-email"] = emailMcpConfig;
    } catch (e) {
      console.error("[project] Failed to create email MCP server:", e.message);
    }

    if (isMate) {
      try {
        var datastoreMcp = _mateDatastore.createMcpServer();
        if (datastoreMcp) servers[datastoreMcp.name || "clay-datastore"] = datastoreMcp;
      } catch (e) {
        console.error("[project] Failed to create datastore MCP server:", e.message);
      }
    }

    return Object.keys(servers).length > 0 ? servers : undefined;
  })();

  // Gate in-app MCP servers on the underlying capability actually being
  // available. Without this, tools show up in every session's tool list
  // even when the user can't use them, which wastes context and can cause
  // the model to pick the wrong MCP when the user has another one
  // configured (see issue #325).
  //
  //   clay-browser -> only when the Chrome extension is connected
  //   clay-email   -> only when the user has an account or server SMTP
  function getLocalMcpServers() {
    if (!mcpServers) return undefined;
    var extWs = browserState._extensionWs;
    var extConnected = !!(extWs && extWs.readyState === 1);
    var emailAvailable = !!(_email && typeof _email.hasEmailCapability === "function" && _email.hasEmailCapability());
    var keys = Object.keys(mcpServers);
    var filtered = {};
    var hasAny = false;
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      if (name === "clay-browser" && !extConnected) continue;
      if (name === "clay-email" && !emailAvailable) continue;
      filtered[name] = mcpServers[name];
      hasAny = true;
    }
    return hasAny ? filtered : undefined;
  }

  // --- SDK bridge ---
  var sdk = createSDKBridge({
    cwd: cwd,
    slug: slug,
    sessionManager: sm,
    send: send,
    pushModule: pushModule,
    adapter: adapter,
    adapters: adapters,
    getNotificationsModule: function () { return _notifications; },
    mateDisplayName: opts.mateDisplayName || "",
    isMate: isMate,
    isAgent: isAgent,
    agentName: agentName,
    agentBody: agentBody,
    agentHomeDir: agentHomeDir,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    mcpServers: getLocalMcpServers,
    getRemoteMcpServers: function () { return _mcp.getMcpServers(); },
    clayPort: serverPort,
    clayTls: serverTls,
    clayAuthToken: serverAuthToken,
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
  // --- Notification center (global singleton from server.js) ---
  var _notifications = opts.notificationsModule || null;

  var _loop = attachLoop({
    cwd: cwd,
    slug: slug,
    sm: sm,
    sdk: sdk,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    pushModule: pushModule,
    notificationsModule: _notifications,
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

  // Check for updates in background (admin only). The result is stored in
  // latestVersion; broadcast is handled by the hourly scheduler below, so
  // page refreshes don't re-trigger the banner.
  function runVersionCheck(broadcast) {
    fetchVersion(updateChannel).then(function (v) {
      if (v && isNewer(v, currentVersion)) {
        latestVersion = v;
        if (broadcast) sendToAdmins({ type: "update_available", version: v });
      }
    }).catch(function (e) {
      console.error("[project] Background version check failed:", e.message || e);
    });
  }
  runVersionCheck(false);

  // Push update_available on every hour boundary. Clients can dismiss the
  // banner; the next hourly push acts as a fresh ping. This avoids needing
  // any dismissed-state persistence.
  function scheduleNextHourlyBroadcast() {
    var now = Date.now();
    var msUntilNextHour = 60 * 60 * 1000 - (now % (60 * 60 * 1000));
    setTimeout(function tick() {
      runVersionCheck(true);
      setTimeout(tick, 60 * 60 * 1000);
    }, msUntilNextHour);
  }
  scheduleNextHourlyBroadcast();

  // --- WS connection handler (delegated to project-connection.js) ---
  function handleConnection(ws, wsUser) {
    _connection.handleConnection(ws, wsUser, handleMessage, handleDisconnection);

    // Initialize local MCP when a localhost client connects
    if (ws._clayLocal && _localMcp && !_localMcp.isReady()) {
      _localMcp.initialize(function () {
        // Rebuild proxy servers and broadcast state when local servers are ready
        _mcp.rebuildAndBroadcast();
      });
    }
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
        var schedUserMsg = { type: "user_message", text: text, _ts: Date.now() };
        session.history.push(schedUserMsg);
        sm.appendToSessionFile(session, schedUserMsg);
        sendToSession(session.localId, schedUserMsg);
        session.isProcessing = true;
        onProcessingChanged();
        sendToSession(session.localId, { type: "status", status: "processing" });
        sdk.startQuery(session, text, null, ensureProjectAccessForSession(session));
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
    // --- Cross-project routing (e.g. permission_response from notification banner) ---
    if (msg.targetSlug && msg.targetSlug !== slug && opts.getProject) {
      var targetCtx = opts.getProject(msg.targetSlug);
      if (targetCtx) {
        targetCtx.handleMessage(ws, msg);
        return;
      }
    }

    // --- DM messages (delegated to server-level handler) ---
    if (msg.type === "dm_open" || msg.type === "dm_send" || msg.type === "dm_list" || msg.type === "dm_typing" || msg.type === "dm_add_favorite" || msg.type === "dm_remove_favorite" || msg.type === "mate_create" || msg.type === "mate_list" || msg.type === "mate_delete" || msg.type === "mate_update" || msg.type === "mate_readd_builtin" || msg.type === "mate_list_available_builtins" || msg.type === "email_accounts_list" || msg.type === "email_account_add" || msg.type === "email_account_remove" || msg.type === "email_account_test") {
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

    // --- @Mention: user-to-user side conversation in this session ---
    if (msg.type === "user_mention") {
      handleUserMention(ws, msg);
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
        session._mentionActiveMateId = null;
        sendToSession(session.localId, { type: "mention_done", mateId: mateId, stopped: true });
        send({ type: "mention_processing", mateId: mateId, active: false });
      }
      return;
    }

    // --- Vendor model switching ---
    if (msg.type === "get_vendor_models") {
      (async function() {
        if (msg.vendor) {
          try {
            var vendorAdapter = adapters[msg.vendor] || null;
            if (!vendorAdapter) {
              vendorAdapter = await yoke.lazyCreateAdapter(adapters, msg.vendor, {
                cwd: cwd,
                clayPort: serverPort,
                clayTls: serverTls,
                clayAuthToken: serverAuthToken,
                slug: slug,
              });
            } else if ((!sm.modelsByVendor || !sm.modelsByVendor[msg.vendor]) && typeof vendorAdapter.init === "function") {
              await vendorAdapter.init({
                cwd: cwd,
                clayPort: serverPort,
                clayTls: serverTls,
                clayAuthToken: serverAuthToken,
                slug: slug,
              });
            }
            if (vendorAdapter) {
              sm.availableVendors = Object.keys(adapters);
              sm.modelsByVendor = sm.modelsByVendor || {};
              if (!sm.modelsByVendor[msg.vendor] && typeof vendorAdapter.supportedModels === "function") {
                sm.modelsByVendor[msg.vendor] = await vendorAdapter.supportedModels();
              }
            }
          } catch (e) {
            console.error("[project] get_vendor_models lazy init failed for " + msg.vendor + ":", e.message || e);
          }
        }
        var vendorModels = (sm.modelsByVendor && sm.modelsByVendor[msg.vendor]) || [];
        var firstModel = vendorModels[0] || "";
        // model value can be string or {value, displayName} object
        var defaultModel = typeof firstModel === "string" ? firstModel : (firstModel.value || "");
        sendTo(ws, { type: "model_info", model: defaultModel, models: vendorModels, vendor: msg.vendor, availableVendors: sm.availableVendors || [], installedVendors: sm.installedVendors || [] });
      })();
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

    // --- Email defaults (project-level) ---
    if (_email.handleEmailMessage(ws, msg)) return;

    // --- MCP bridge (remote MCP servers via extension) ---
    if (_mcp.handleMcpMessage(ws, msg)) return;

    // --- Mate datastore ---
    if (_mateDatastore.handleMateDatastoreMessage(ws, msg)) return;

    // --- Knowledge file management (delegated to project-knowledge.js) ---
    if (_knowledge.handleKnowledgeMessage(ws, msg)) return;

    // --- Notifications (delegated to project-notifications.js) ---
    if (_notifications.handleNotificationMessage(ws, msg)) return;

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
    slug: slug,
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
    getNotificationsModule: function () { return _notifications; },
    get checkForDmDebateBrief() { return checkForDmDebateBrief; },
  });
  var handleMention = _mateInteraction.handleMention;
  var getMateProfile = _mateInteraction.getMateProfile;
  var loadMateClaudeMd = _mateInteraction.loadMateClaudeMd;
  var digestDmTurn = _mateInteraction.digestDmTurn;
  var enqueueDigest = _mateInteraction.enqueueDigest;

  // --- User-to-user mention engine (delegated to project-user-mention.js) ---
  var _userMention = attachUserMention({
    slug: slug,
    sm: sm,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    sendToSessionOthers: sendToSessionOthers,
    getSessionForWs: getSessionForWs,
    getLinuxUserForSession: getLinuxUserForSession,
    saveImageFile: saveImageFile,
    hydrateImageRefs: hydrateImageRefs,
    usersModule: usersModule,
    pushModule: pushModule,
    isUserOnline: opts.isUserOnline || function () { return false; },
    getNotificationsModule: function () { return _notifications; },
    getProjectTitle: function () { return title || slug; },
  });
  var handleUserMention = _userMention.handleUserMention;

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
    // Clean up extension WS reference if this was the extension client
    if (browserState._extensionWs === ws) {
      browserState._extensionWs = null;
      browserState._extensionId = null;
      if (_mcp) _mcp.handleExtensionDisconnect();
    }
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
    ensureProjectAccessForSession: ensureProjectAccessForSession,
    getOsUserInfoForWs: getOsUserInfoForWs,
    hydrateImageRefs: hydrateImageRefs,
    onProcessingChanged: onProcessingChanged,
    broadcastPresence: broadcastPresence,
    adapter: adapter,
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
    onCreateWorktree: onCreateWorktree,
    IGNORED_DIRS: IGNORED_DIRS,
    loadContextSources: loadContextSources,
    saveContextSources: saveContextSources,
    _email: _email,
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
    ensureProjectAccessForSession: ensureProjectAccessForSession,
    getOsUserInfoForWs: getOsUserInfoForWs,
    hydrateImageRefs: hydrateImageRefs,
    saveImageFile: saveImageFile,
    imagesDir: imagesDir,
    onProcessingChanged: onProcessingChanged,
    _loop: _loop,
    browserState: browserState,
    sendExtensionCommandAny: sendExtensionCommandAny,
    requestTabContext: requestTabContext,
    scheduleMessage: scheduleMessage,
    cancelScheduledMessage: cancelScheduledMessage,
    loadContextSources: loadContextSources,
    saveContextSources: saveContextSources,
    digestDmTurn: digestDmTurn,
    gateMemory: gateMemory,
    escapeRegex: escapeRegex,
    adapter: adapter,
    getHubSchedules: getHubSchedules,
    getProjectOwnerId: function () { return projectOwnerId; },
    _email: _email,
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

  // --- MCP bridge handler for Codex (Track 2) ---
  // Provides list_tools and call_tool operations over HTTP for mcp-bridge-server.js.
  // Excludes local MCP servers since Codex manages those natively via Track 1.
  function getMcpBridgeHandler() {
    // Build set of local MCP server names to exclude (Codex handles these natively)
    var localMcpNames = {};
    try {
      var mcpLocalModule = require("./mcp-local");
      var localConfig = mcpLocalModule.readMergedServers();
      var lcNames = Object.keys(localConfig);
      for (var li = 0; li < lcNames.length; li++) {
        localMcpNames[lcNames[li]] = true;
      }
    } catch (e) { /* no local MCP config */ }

    return {
      listTools: function () {
        var tools = [];
        var toJSONSchema;
        try { toJSONSchema = require("zod").toJSONSchema; } catch (e) { /* fallback */ }

        // Helper to extract tools from an SDK MCP server object
        function extractServerTools(serverName, server) {
          if (!server || !server.instance || !server.instance._registeredTools) return;
          var toolNames = Object.keys(server.instance._registeredTools);
          for (var j = 0; j < toolNames.length; j++) {
            var toolDef = server.instance._registeredTools[toolNames[j]];
            var inputSchema = { type: "object", properties: {} };
            try {
              if (toJSONSchema && toolDef.inputSchema) inputSchema = toJSONSchema(toolDef.inputSchema);
            } catch (e) { /* fallback */ }
            tools.push({
              server: serverName,
              name: toolNames[j],
              description: toolDef.description || toolNames[j],
              inputSchema: inputSchema,
            });
          }
        }

        // In-app MCP servers (debate, browser, email).
        // Use getLocalMcpServers() so clay-browser is hidden unless the
        // Chrome extension is currently connected (see issue #325).
        var localMcp = getLocalMcpServers();
        if (localMcp) {
          var inAppNames = Object.keys(localMcp);
          for (var i = 0; i < inAppNames.length; i++) {
            extractServerTools(inAppNames[i], localMcp[inAppNames[i]]);
          }
        }

        // Remote MCP servers (extension-proxied only, skip local proxy servers)
        var remoteServers = _mcp.getMcpServers();
        if (remoteServers) {
          var remoteNames = Object.keys(remoteServers);
          for (var ri = 0; ri < remoteNames.length; ri++) {
            // Skip servers that Codex manages natively via Track 1
            if (localMcpNames[remoteNames[ri]]) continue;
            extractServerTools(remoteNames[ri], remoteServers[remoteNames[ri]]);
          }
        }

        return Promise.resolve(tools);
      },
      callTool: function (serverName, toolName, args) {
        // Try in-app servers first (gated by extension connectivity for clay-browser).
        var localMcp = getLocalMcpServers();
        if (localMcp && localMcp[serverName]) {
          var server = localMcp[serverName];
          if (server.instance && server.instance._registeredTools && server.instance._registeredTools[toolName]) {
            var handler = server.instance._registeredTools[toolName].handler;
            if (typeof handler === "function") {
              return Promise.resolve(handler(args));
            }
          }
        }
        // Try remote/local proxy servers
        var remoteServers = _mcp.getMcpServers();
        if (remoteServers && remoteServers[serverName]) {
          var rServer = remoteServers[serverName];
          if (rServer.instance && rServer.instance._registeredTools && rServer.instance._registeredTools[toolName]) {
            var rHandler = rServer.instance._registeredTools[toolName].handler;
            if (typeof rHandler === "function") {
              return Promise.resolve(rHandler(args));
            }
          }
        }
        return Promise.reject(new Error("Tool not found: " + serverName + "/" + toolName));
      },
    };
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
    _browserTabList: browserState._browserTabList,
    getMcpBridgeHandler: getMcpBridgeHandler,
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
    _mcp: _mcp,
    _notifications: _notifications,
    hydrateImageRefs: hydrateImageRefs,
    broadcastClientCount: broadcastClientCount,
    broadcastPresence: broadcastPresence,
    getProjectList: getProjectList,
    getHubSchedules: getHubSchedules,
    loadContextSources: loadContextSources,
    saveContextSources: saveContextSources,
    _email: _email,
    restoreDebateState: restoreDebateState,
    stopFileWatch: stopFileWatch,
    stopAllDirWatches: stopAllDirWatches,
    getProjectOwnerId: function () { return projectOwnerId; },
    setProjectOwnerId: function (id) { projectOwnerId = id; },
    getLatestVersion: function () { return latestVersion; },
    getTitle: function () { return title; },
    getProject: function () { return project; },
    // Exposed so the first websocket connection can lazily warm up the
    // adapters for this project (see project-connection handleConnection).
    warmup: function () {
      sdk.warmup();
      sdk.startIdleReaper();
      if (!osUsers && !sessionTitleMigrationScheduled) {
        sessionTitleMigrationScheduled = true;
        setTimeout(function () {
          try {
            sm.migrateSessionTitles(adapter, cwd);
          } catch (e) {
            console.error("[project] Session title migration failed for " + slug + ":", e && e.message ? e.message : e);
          }
        }, 5000);
      }
    },
  });

  // --- Destroy ---
  function destroy() {
    _loop.stopTimer();
    _email.destroy();
    if (_mateDatastore && typeof _mateDatastore.closeAllDatastores === "function") {
      try { _mateDatastore.closeAllDatastores(); } catch (e) {}
    }
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

    var codexShutdown = Promise.resolve(true);
    if (adapters && adapters.codex && typeof adapters.codex.shutdown === "function") {
      codexShutdown = adapters.codex.shutdown().catch(function(err) {
        console.error("[project] Codex shutdown failed for " + slug + ":", err && err.message ? err.message : err);
        return false;
      });
    }
    return codexShutdown;
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
    if (isAgent) {
      status.isAgent = true;
      status.agentName = agentName;
      status.agentDescription = agentDescription;
      status.agentModel = agentModel;
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
    getMcpBridgeHandler: getMcpBridgeHandler,
    getStatus: getStatus,
    getSessionManager: function () { return sm; },
    getNotificationsModule: function () { return _notifications; },
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
    destroy: function () {
      sdk.stopIdleReaper();
      return destroy();
    },
  };
}

module.exports = { createProjectContext: createProjectContext, safePath: safePath, validateEnvString: validateEnvString };
