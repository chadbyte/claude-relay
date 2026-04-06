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
var { createLoopRegistry } = require("./scheduler");
var usersModule = require("./users");
var { resolveOsUserInfo, fsAsUser } = require("./os-users");
var crisisSafety = require("./crisis-safety");
var matesModule = require("./mates");
var sessionSearch = require("./session-search");
var userPresence = require("./user-presence");
var { attachDebate } = require("./project-debate");
var MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

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
  var latestVersion = null;

  // --- Chat image storage ---
  var _imgConfig = require("./config");
  var _imgUtils = require("./utils");
  var _imagesBaseDir = path.join(_imgConfig.CONFIG_DIR, "images");
  var _imagesEncodedCwd = _imgUtils.encodeCwd(cwd);
  var imagesDir = path.join(_imagesBaseDir, _imagesEncodedCwd);

  // Convert imageRefs in history entries to images with URLs for the client
  function hydrateImageRefs(entry) {
    if (!entry || !entry.imageRefs) return entry;
    if (entry.type !== "user_message" && entry.type !== "mention_user") return entry;
    var images = [];
    for (var ri = 0; ri < entry.imageRefs.length; ri++) {
      var ref = entry.imageRefs[ri];
      images.push({ mediaType: ref.mediaType, url: "/p/" + slug + "/images/" + ref.file });
    }
    var hydrated = {};
    for (var k in entry) {
      if (k !== "imageRefs") hydrated[k] = entry[k];
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

  // --- Directory watcher ---
  var dirWatchers = {};  // relPath -> { watcher, debounce }

  function startDirWatch(relPath) {
    if (dirWatchers[relPath]) return;
    var absPath = safePath(cwd, relPath);
    if (!absPath) return;
    try {
      var debounce = null;
      var watcher = fs.watch(absPath, function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          // Re-read directory and broadcast to all clients
          try {
            var items = fs.readdirSync(absPath, { withFileTypes: true });
            var entries = [];
            for (var i = 0; i < items.length; i++) {
              if (items[i].isDirectory() && IGNORED_DIRS.has(items[i].name)) continue;
              entries.push({
                name: items[i].name,
                type: items[i].isDirectory() ? "dir" : "file",
                path: path.relative(cwd, path.join(absPath, items[i].name)).split(path.sep).join("/"),
              });
            }
            send({ type: "fs_dir_changed", path: relPath, entries: entries });
          } catch (e) {
            stopDirWatch(relPath);
          }
        }, 300);
      });
      watcher.on("error", function () { stopDirWatch(relPath); });
      dirWatchers[relPath] = { watcher: watcher, debounce: debounce };
    } catch (e) {}
  }

  function stopDirWatch(relPath) {
    var entry = dirWatchers[relPath];
    if (entry) {
      clearTimeout(entry.debounce);
      try { entry.watcher.close(); } catch (e) {}
      delete dirWatchers[relPath];
    }
  }

  function stopAllDirWatches() {
    var paths = Object.keys(dirWatchers);
    for (var i = 0; i < paths.length; i++) {
      stopDirWatch(paths[i]);
    }
  }

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
    onProcessingChanged: onProcessingChanged,
    onTurnDone: isMate ? function (session, preview) { digestDmTurn(session, preview); } : null,
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

  // --- Ralph Loop state ---
  var loopState = {
    active: false,
    phase: "idle", // idle | crafting | approval | executing | done
    promptText: "",
    judgeText: "",
    iteration: 0,
    maxIterations: 20,
    baseCommit: null,
    currentSessionId: null,
    judgeSessionId: null,
    results: [],
    stopping: false,
    wizardData: null,
    craftingSessionId: null,
    startedAt: null,
    loopId: null,
    loopFilesId: null,
  };

  function loopDir() {
    var id = loopState.loopFilesId || loopState.loopId;
    if (!id) return null;
    return path.join(cwd, ".claude", "loops", id);
  }

  function generateLoopId() {
    return "loop_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
  }

  // Loop state persistence
  var _loopConfig = require("./config");
  var _loopUtils = require("./utils");
  var _loopDir = path.join(_loopConfig.CONFIG_DIR, "loops");
  var _loopEncodedCwd = _loopUtils.resolveEncodedFile(_loopDir, cwd, ".json");
  var _loopStatePath = path.join(_loopDir, _loopEncodedCwd + ".json");

  function saveLoopState() {
    try {
      fs.mkdirSync(_loopDir, { recursive: true });
      var data = {
        phase: loopState.phase,
        active: loopState.active,
        iteration: loopState.iteration,
        maxIterations: loopState.maxIterations,
        baseCommit: loopState.baseCommit,
        results: loopState.results,
        wizardData: loopState.wizardData,
        startedAt: loopState.startedAt,
        loopId: loopState.loopId,
        loopFilesId: loopState.loopFilesId || null,
      };
      var tmpPath = _loopStatePath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
      fs.renameSync(tmpPath, _loopStatePath);
    } catch (e) {
      console.error("[ralph-loop] Failed to save state:", e.message);
    }
  }

  function loadLoopState() {
    try {
      var raw = fs.readFileSync(_loopStatePath, "utf8");
      var data = JSON.parse(raw);
      loopState.phase = data.phase || "idle";
      loopState.active = data.active || false;
      loopState.iteration = data.iteration || 0;
      loopState.maxIterations = data.maxIterations || 20;
      loopState.baseCommit = data.baseCommit || null;
      loopState.results = data.results || [];
      loopState.wizardData = data.wizardData || null;
      loopState.startedAt = data.startedAt || null;
      loopState.loopId = data.loopId || null;
      loopState.loopFilesId = data.loopFilesId || null;
      // SDK sessions cannot survive daemon restart
      loopState.currentSessionId = null;
      loopState.judgeSessionId = null;
      loopState.craftingSessionId = null;
      loopState.stopping = false;
      // If was executing, schedule resume after SDK is ready
      if (loopState.phase === "executing" && loopState.active) {
        loopState._needsResume = true;
      }
      // If was crafting, check if files exist and move to approval
      if (loopState.phase === "crafting") {
        var hasFiles = checkLoopFilesExist();
        if (hasFiles) {
          loopState.phase = "approval";
          saveLoopState();
        } else {
          loopState.phase = "idle";
          saveLoopState();
        }
      }
    } catch (e) {
      // No saved state, use defaults
    }
    // Recover orphaned loops: if idle but completed loop files exist in .claude/loops/
    if (loopState.phase === "idle") {
      var _loopsBase = path.join(cwd, ".claude", "loops");
      try {
        var _loopDirs = fs.readdirSync(_loopsBase).filter(function (d) {
          return d.indexOf("loop_") === 0;
        });
        for (var _li = 0; _li < _loopDirs.length; _li++) {
          var _ld = path.join(_loopsBase, _loopDirs[_li]);
          try {
            fs.accessSync(path.join(_ld, "PROMPT.md"));
            fs.accessSync(path.join(_ld, "JUDGE.md"));
            fs.accessSync(path.join(_ld, "LOOP.json"));
            // Found a completed loop — recover to approval phase
            loopState.loopId = _loopDirs[_li];
            loopState.phase = "approval";
            var _loopCfg = JSON.parse(fs.readFileSync(path.join(_ld, "LOOP.json"), "utf8"));
            loopState.maxIterations = _loopCfg.maxIterations || 20;
            saveLoopState();
            console.log("[ralph-loop] Recovered orphaned loop: " + _loopDirs[_li]);
            break;
          } catch (e) {}
        }
      } catch (e) {}
    }
  }

  function clearLoopState() {
    loopState.active = false;
    loopState.phase = "idle";
    loopState.promptText = "";
    loopState.judgeText = "";
    loopState.iteration = 0;
    loopState.maxIterations = 20;
    loopState.baseCommit = null;
    loopState.currentSessionId = null;
    loopState.judgeSessionId = null;
    loopState.results = [];
    loopState.stopping = false;
    loopState.wizardData = null;
    loopState.craftingSessionId = null;
    loopState.startedAt = null;
    loopState.loopId = null;
    loopState.loopFilesId = null;
    saveLoopState();
  }

  function checkLoopFilesExist() {
    var dir = loopDir();
    if (!dir) return false;
    var hasPrompt = false;
    var hasJudge = false;
    try { fs.accessSync(path.join(dir, "PROMPT.md")); hasPrompt = true; } catch (e) {}
    try { fs.accessSync(path.join(dir, "JUDGE.md")); hasJudge = true; } catch (e) {}
    return hasPrompt && hasJudge;
  }

  // .claude/ directory watcher for PROMPT.md / JUDGE.md
  var claudeDirWatcher = null;
  var claudeDirDebounce = null;

  // Mate CLAUDE.md crisis safety watcher
  var crisisWatcher = null;
  var crisisDebounce = null;

  function startClaudeDirWatch() {
    if (claudeDirWatcher) return;
    var watchDir = loopDir();
    if (!watchDir) return;
    try { fs.mkdirSync(watchDir, { recursive: true }); } catch (e) {}
    try {
      claudeDirWatcher = fs.watch(watchDir, function () {
        if (claudeDirDebounce) clearTimeout(claudeDirDebounce);
        claudeDirDebounce = setTimeout(function () {
          broadcastLoopFilesStatus();
        }, 300);
      });
      claudeDirWatcher.on("error", function () {});
    } catch (e) {
      console.error("[ralph-loop] Failed to watch .claude/:", e.message);
    }
  }

  function stopClaudeDirWatch() {
    if (claudeDirWatcher) {
      claudeDirWatcher.close();
      claudeDirWatcher = null;
    }
    if (claudeDirDebounce) {
      clearTimeout(claudeDirDebounce);
      claudeDirDebounce = null;
    }
  }

  function broadcastLoopFilesStatus() {
    var dir = loopDir();
    var hasPrompt = false;
    var hasJudge = false;
    var hasLoopJson = false;
    if (dir) {
      try { fs.accessSync(path.join(dir, "PROMPT.md")); hasPrompt = true; } catch (e) {}
      try { fs.accessSync(path.join(dir, "JUDGE.md")); hasJudge = true; } catch (e) {}
      try { fs.accessSync(path.join(dir, "LOOP.json")); hasLoopJson = true; } catch (e) {}
    }
    send({
      type: "ralph_files_status",
      promptReady: hasPrompt,
      judgeReady: hasJudge,
      loopJsonReady: hasLoopJson,
      bothReady: hasPrompt && hasJudge,
      taskId: loopState.loopId,
    });
    // Auto-transition to approval phase when both files appear
    if (hasPrompt && hasJudge && loopState.phase === "crafting") {
      loopState.phase = "approval";
      saveLoopState();

      // Parse recommended title from crafting session conversation
      if (loopState.craftingSessionId && loopState.loopId) {
        var craftSess = sm.sessions.get(loopState.craftingSessionId);
        if (craftSess && craftSess.history) {
          for (var hi = craftSess.history.length - 1; hi >= 0; hi--) {
            var entry = craftSess.history[hi];
            var entryText = entry.text || "";
            var titleMatch = entryText.match(/\[\[LOOP_TITLE:\s*(.+?)\]\]/);
            if (titleMatch) {
              var suggestedTitle = titleMatch[1].trim();
              if (suggestedTitle) {
                loopRegistry.updateRecord(loopState.loopId, { name: suggestedTitle });
              }
              break;
            }
          }
        }
      }
    }
  }

  // Load persisted state on startup
  loadLoopState();

  // --- Loop Registry (unified one-off + scheduled) ---
  var activeRegistryId = null; // track which registry record triggered current loop

  var loopRegistry = createLoopRegistry({
    cwd: cwd,
    onTrigger: function (record) {
      // Skip trigger if a loop is already active and skipIfRunning is enabled
      if (loopState.active || loopState.phase === "executing") {
        if (record.skipIfRunning !== false) {
          console.log("[loop-registry] Skipping trigger for " + record.name + " — loop already active (skipIfRunning)");
          return;
        }
        console.log("[loop-registry] Loop active but skipIfRunning disabled for " + record.name + "; deferring");
        return;
      }

      // For schedule records, resolve the linked task to get loop files
      var loopFilesId = record.id;
      if (record.source === "schedule") {
        if (!record.linkedTaskId) {
          console.error("[loop-registry] Schedule has no linked task: " + record.name);
          return;
        }
        loopFilesId = record.linkedTaskId;
        console.log("[loop-registry] Schedule triggered: " + record.name + " → linked task " + loopFilesId);
      }

      // Verify the loop directory and PROMPT.md exist
      var recDir = path.join(cwd, ".claude", "loops", loopFilesId);
      try {
        fs.accessSync(path.join(recDir, "PROMPT.md"));
      } catch (e) {
        console.error("[loop-registry] PROMPT.md missing for " + loopFilesId);
        return;
      }
      // Set the loopId to the schedule's own id (not the linked task) so sidebar groups correctly
      loopState.loopId = record.id;
      loopState.loopFilesId = loopFilesId;
      loopState.wizardData = null;
      activeRegistryId = record.id;
      console.log("[loop-registry] Auto-starting loop: " + record.name + " (" + loopState.loopId + ")");
      send({ type: "schedule_run_started", recordId: record.id });
      startLoop({ maxIterations: record.maxIterations, name: record.name });
    },
    onChange: function () {
      send({ type: "loop_registry_updated", records: getHubSchedules() });
    },
  });
  loopRegistry.load();
  loopRegistry.startTimer();

  // Wire loop info resolution for session list broadcasts
  sm.setResolveLoopInfo(function (loopId) {
    var rec = loopRegistry.getById(loopId);
    if (!rec) return null;
    return { name: rec.name || null, source: rec.source || null };
  });

  function startLoop(opts) {
    var loopOpts = opts || {};
    var dir = loopDir();
    if (!dir) {
      send({ type: "loop_error", text: "No loop directory. Run the wizard first." });
      return;
    }
    var promptPath = path.join(dir, "PROMPT.md");
    var judgePath = path.join(dir, "JUDGE.md");
    var promptText, judgeText;
    try {
      promptText = fs.readFileSync(promptPath, "utf8");
    } catch (e) {
      send({ type: "loop_error", text: "Missing PROMPT.md in " + dir });
      return;
    }
    try {
      judgeText = fs.readFileSync(judgePath, "utf8");
    } catch (e) {
      judgeText = null;
    }

    var baseCommit;
    try {
      baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: cwd, encoding: "utf8", timeout: 5000,
      }).trim();
    } catch (e) {
      send({ type: "loop_error", text: "Failed to get git HEAD: " + e.message });
      return;
    }

    // Read loop config from LOOP.json in loop directory
    var loopConfig = {};
    try {
      loopConfig = JSON.parse(fs.readFileSync(path.join(dir, "LOOP.json"), "utf8"));
    } catch (e) {}

    loopState.active = true;
    loopState.phase = "executing";
    loopState.promptText = promptText;
    loopState.judgeText = judgeText;
    loopState.iteration = 0;
    loopState.maxIterations = judgeText ? ((loopOpts.maxIterations >= 1 ? loopOpts.maxIterations : null) || loopConfig.maxIterations || 20) : 1;
    loopState.baseCommit = baseCommit;
    loopState.currentSessionId = null;
    loopState.judgeSessionId = null;
    loopState.results = [];
    loopState.stopping = false;
    loopState.name = loopOpts.name || null;
    loopState.startedAt = Date.now();
    saveLoopState();

    stopClaudeDirWatch();

    send({ type: "loop_started", maxIterations: loopState.maxIterations, name: loopState.name });
    runNextIteration();
  }

  function runNextIteration() {
    console.log("[ralph-loop] runNextIteration called, iteration: " + loopState.iteration + ", active: " + loopState.active + ", stopping: " + loopState.stopping);
    if (!loopState.active || loopState.stopping) {
      finishLoop("stopped");
      return;
    }

    loopState.iteration++;
    if (loopState.iteration > loopState.maxIterations) {
      finishLoop("max_iterations");
      return;
    }

    var session = sm.createSession();
    var loopSource = loopRegistry.getById(loopState.loopId);
    var loopName = (loopState.wizardData && loopState.wizardData.name) || (loopSource && loopSource.name) || "";
    var loopSourceTag = (loopSource && loopSource.source) || null;
    var isRalphLoop = loopSourceTag === "ralph";
    session.loop = { active: true, iteration: loopState.iteration, role: "coder", loopId: loopState.loopId, name: loopName, source: loopSourceTag, startedAt: loopState.startedAt };
    session.title = (isRalphLoop ? "Ralph" : "Task") + (loopName ? " " + loopName : "") + " #" + loopState.iteration;
    sm.saveSessionFile(session);
    sm.broadcastSessionList();

    loopState.currentSessionId = session.localId;

    send({
      type: "loop_iteration",
      iteration: loopState.iteration,
      maxIterations: loopState.maxIterations,
      sessionId: session.localId,
    });

    var coderCompleted = false;
    session.onQueryComplete = function(completedSession) {
      if (coderCompleted) return;
      coderCompleted = true;
      if (coderWatchdog) { clearTimeout(coderWatchdog); coderWatchdog = null; }
      console.log("[ralph-loop] Coder #" + loopState.iteration + " onQueryComplete fired, history length: " + completedSession.history.length);
      if (!loopState.active) { console.log("[ralph-loop] Coder: loopState.active is false, skipping"); return; }
      // Check if session ended with error
      var lastItems = completedSession.history.slice(-3);
      var hadError = false;
      for (var i = 0; i < lastItems.length; i++) {
        if (lastItems[i].type === "error" || (lastItems[i].type === "done" && lastItems[i].code === 1)) {
          hadError = true;
          break;
        }
      }
      if (hadError) {
        loopState.results.push({
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Iteration ended with error",
        });
        send({
          type: "loop_verdict",
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Iteration ended with error, retrying...",
        });
        setTimeout(function() { runNextIteration(); }, 2000);
        return;
      }
      if (loopState.judgeText && loopState.maxIterations > 1) {
        runJudge();
      } else {
        finishLoop("pass");
      }
    };

    // Watchdog: if onQueryComplete hasn't fired after 10 minutes, force error and retry
    var coderWatchdog = setTimeout(function() {
      if (!coderCompleted && loopState.active && !loopState.stopping) {
        console.error("[ralph-loop] Coder #" + loopState.iteration + " watchdog triggered — onQueryComplete never fired");
        coderCompleted = true;
        loopState.results.push({
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Coder session timed out (no completion signal)",
        });
        send({
          type: "loop_verdict",
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Coder session timed out, retrying...",
        });
        setTimeout(function() { runNextIteration(); }, 2000);
      }
    }, 10 * 60 * 1000);

    var userMsg = { type: "user_message", text: loopState.promptText };
    session.history.push(userMsg);
    sm.appendToSessionFile(session, userMsg);

    session.isProcessing = true;
    onProcessingChanged();
    session.sentToolResults = {};
    sendToSession(session.localId, { type: "status", status: "processing" });
    session.acceptEditsAfterStart = true;
    session.singleTurn = true;
    sdk.startQuery(session, loopState.promptText, undefined, getLinuxUserForSession(session));
  }

  function runJudge() {
    if (!loopState.active || loopState.stopping) {
      finishLoop("stopped");
      return;
    }

    var diff;
    try {
      diff = execFileSync("git", ["diff", loopState.baseCommit], {
        cwd: cwd, encoding: "utf8", timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (e) {
      send({ type: "loop_error", text: "Failed to generate git diff: " + e.message });
      finishLoop("error");
      return;
    }

    var gitLog = "";
    try {
      gitLog = execFileSync("git", ["log", "--oneline", loopState.baseCommit + "..HEAD"], {
        cwd: cwd, encoding: "utf8", timeout: 10000,
      }).trim();
    } catch (e) {}

    var judgePrompt = "You are a judge evaluating whether a coding task has been completed.\n\n" +
      "## Original Task (PROMPT.md)\n\n" + loopState.promptText + "\n\n" +
      "## Evaluation Criteria (JUDGE.md)\n\n" + loopState.judgeText + "\n\n" +
      "## Commit History\n\n```\n" + (gitLog || "(no commits yet)") + "\n```\n\n" +
      "## Changes Made (git diff)\n\n```diff\n" + diff + "\n```\n\n" +
      "Based on the evaluation criteria, has the task been completed successfully?\n\n" +
      "IMPORTANT: The git diff above may not show everything. If criteria involve checking whether " +
      "specific files, classes, or features exist, use tools (Read, Glob, Grep, Bash) to verify " +
      "directly in the codebase. Do NOT assume something is missing just because it is not in the diff.\n\n" +
      "After your evaluation, respond with exactly one of:\n" +
      "- PASS: [brief explanation]\n" +
      "- FAIL: [brief explanation of what is still missing]";

    var judgeSession = sm.createSession();
    var judgeSource = loopRegistry.getById(loopState.loopId);
    var judgeName = (loopState.wizardData && loopState.wizardData.name) || (judgeSource && judgeSource.name) || "";
    var judgeSourceTag = (judgeSource && judgeSource.source) || null;
    var isRalphJudge = judgeSourceTag === "ralph";
    judgeSession.loop = { active: true, iteration: loopState.iteration, role: "judge", loopId: loopState.loopId, name: judgeName, source: judgeSourceTag, startedAt: loopState.startedAt };
    judgeSession.title = (isRalphJudge ? "Ralph" : "Task") + (judgeName ? " " + judgeName : "") + " Judge #" + loopState.iteration;
    sm.saveSessionFile(judgeSession);
    sm.broadcastSessionList();
    loopState.judgeSessionId = judgeSession.localId;

    send({
      type: "loop_judging",
      iteration: loopState.iteration,
      sessionId: judgeSession.localId,
    });

    var judgeCompleted = false;
    judgeSession.onQueryComplete = function(completedSession) {
      if (judgeCompleted) return;
      judgeCompleted = true;
      if (judgeWatchdog) { clearTimeout(judgeWatchdog); judgeWatchdog = null; }
      console.log("[ralph-loop] Judge #" + loopState.iteration + " onQueryComplete fired, history length: " + completedSession.history.length);
      var verdict = parseJudgeVerdict(completedSession);
      console.log("[ralph-loop] Judge verdict: " + (verdict.pass ? "PASS" : "FAIL") + " - " + verdict.explanation);

      loopState.results.push({
        iteration: loopState.iteration,
        verdict: verdict.pass ? "pass" : "fail",
        summary: verdict.explanation,
      });

      send({
        type: "loop_verdict",
        iteration: loopState.iteration,
        verdict: verdict.pass ? "pass" : "fail",
        summary: verdict.explanation,
      });

      if (verdict.pass) {
        finishLoop("pass");
      } else {
        setTimeout(function() { runNextIteration(); }, 1000);
      }
    };

    // Watchdog: judge may use tools to verify, so allow more time
    var judgeWatchdog = setTimeout(function() {
      if (!judgeCompleted && loopState.active && !loopState.stopping) {
        console.error("[ralph-loop] Judge #" + loopState.iteration + " watchdog triggered — onQueryComplete never fired");
        judgeCompleted = true;
        loopState.results.push({
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Judge session timed out (no completion signal)",
        });
        send({
          type: "loop_verdict",
          iteration: loopState.iteration,
          verdict: "error",
          summary: "Judge session timed out, retrying...",
        });
        setTimeout(function() { runNextIteration(); }, 2000);
      }
    }, 10 * 60 * 1000);

    var userMsg = { type: "user_message", text: judgePrompt };
    judgeSession.history.push(userMsg);
    sm.appendToSessionFile(judgeSession, userMsg);

    judgeSession.isProcessing = true;
    onProcessingChanged();
    judgeSession.sentToolResults = {};
    judgeSession.acceptEditsAfterStart = true;
    judgeSession.singleTurn = true;
    sdk.startQuery(judgeSession, judgePrompt, undefined, getLinuxUserForSession(judgeSession));
  }

  function parseJudgeVerdict(session) {
    var text = "";
    for (var i = 0; i < session.history.length; i++) {
      var h = session.history[i];
      if (h.type === "delta" && h.text) text += h.text;
      if (h.type === "text" && h.text) text += h.text;
    }
    console.log("[ralph-loop] Judge raw text (last 500 chars): " + text.slice(-500));
    var upper = text.toUpperCase();
    var passIdx = upper.indexOf("PASS");
    var failIdx = upper.indexOf("FAIL");
    if (passIdx !== -1 && (failIdx === -1 || passIdx < failIdx)) {
      var explanation = text.substring(passIdx + 4).replace(/^[\s:]+/, "").split("\n")[0].trim();
      return { pass: true, explanation: explanation || "Task completed" };
    }
    if (failIdx !== -1) {
      var explanation = text.substring(failIdx + 4).replace(/^[\s:]+/, "").split("\n")[0].trim();
      return { pass: false, explanation: explanation || "Task not yet complete" };
    }
    return { pass: false, explanation: "Could not parse judge verdict" };
  }

  function finishLoop(reason) {
    console.log("[ralph-loop] finishLoop called, reason: " + reason + ", iteration: " + loopState.iteration);
    loopState.active = false;
    loopState.phase = "done";
    loopState.stopping = false;
    loopState.currentSessionId = null;
    loopState.judgeSessionId = null;
    saveLoopState();

    send({
      type: "loop_finished",
      reason: reason,
      iterations: loopState.iteration,
      results: loopState.results,
    });

    // Record result in loop registry
    if (loopState.loopId) {
      loopRegistry.recordRun(loopState.loopId, {
        reason: reason,
        startedAt: loopState.startedAt,
        iterations: loopState.iteration,
      });
    }
    if (activeRegistryId) {
      send({ type: "schedule_run_finished", recordId: activeRegistryId, reason: reason, iterations: loopState.iteration });
      activeRegistryId = null;
    }

    if (pushModule) {
      var body = reason === "pass"
        ? "Task completed after " + loopState.iteration + " iteration(s)"
        : reason === "max_iterations"
          ? "Reached max iterations (" + loopState.maxIterations + ")"
          : reason === "stopped"
            ? "Loop stopped by user"
            : "Loop ended due to error";
      pushModule.sendPush({
        type: "done",
        slug: slug,
        title: "Ralph Loop Complete",
        body: body,
        tag: "ralph-loop-done",
      });
    }
  }

  function resumeLoop() {
    var dir = loopDir();
    if (!dir) {
      console.error("[ralph-loop] Cannot resume: no loop directory");
      loopState.active = false;
      loopState.phase = "idle";
      saveLoopState();
      return;
    }
    try {
      loopState.promptText = fs.readFileSync(path.join(dir, "PROMPT.md"), "utf8");
    } catch (e) {
      console.error("[ralph-loop] Cannot resume: missing PROMPT.md");
      loopState.active = false;
      loopState.phase = "idle";
      saveLoopState();
      return;
    }
    try {
      loopState.judgeText = fs.readFileSync(path.join(dir, "JUDGE.md"), "utf8");
    } catch (e) {
      console.error("[ralph-loop] Cannot resume: missing JUDGE.md");
      loopState.active = false;
      loopState.phase = "idle";
      saveLoopState();
      return;
    }
    // Retry the interrupted iteration (runNextIteration will increment)
    if (loopState.iteration > 0) {
      loopState.iteration--;
    }
    console.log("[ralph-loop] Resuming loop, next iteration will be " + (loopState.iteration + 1) + "/" + loopState.maxIterations);
    send({ type: "loop_started", maxIterations: loopState.maxIterations });
    runNextIteration();
  }

  function stopLoop() {
    if (!loopState.active) return;
    console.log("[ralph-loop] stopLoop called");
    loopState.stopping = true;

    // Abort all loop-related sessions (coder + judge)
    var sessionIds = [loopState.currentSessionId, loopState.judgeSessionId];
    for (var i = 0; i < sessionIds.length; i++) {
      if (sessionIds[i] == null) continue;
      var s = sm.sessions.get(sessionIds[i]);
      if (!s) continue;
      // End message queue so SDK exits prompt wait
      if (s.messageQueue) { try { s.messageQueue.end(); } catch (e) {} }
      // Abort active API call
      if (s.abortController) { try { s.abortController.abort(); } catch (e) {} }
    }

    send({ type: "loop_stopping" });

    // Fallback: force finish if onQueryComplete hasn't fired after 5s
    setTimeout(function() {
      if (loopState.active && loopState.stopping) {
        console.log("[ralph-loop] Stop fallback triggered — forcing finishLoop");
        finishLoop("stopped");
      }
    }, 5000);
  }

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
    sendTo(ws, { type: "notes_list", notes: nm.list() });
    sendTo(ws, { type: "loop_registry_updated", records: getHubSchedules() });

    // Ralph Loop availability
    var hasLoopFiles = false;
    try {
      fs.accessSync(path.join(cwd, ".claude", "PROMPT.md"));
      fs.accessSync(path.join(cwd, ".claude", "JUDGE.md"));
      hasLoopFiles = true;
    } catch (e) {}
    // Also check loop directory files
    if (!hasLoopFiles && loopState.loopId) {
      var _avDir = loopDir();
      if (_avDir) {
        try {
          fs.accessSync(path.join(_avDir, "PROMPT.md"));
          fs.accessSync(path.join(_avDir, "JUDGE.md"));
          hasLoopFiles = true;
        } catch (e) {}
      }
    }
    sendTo(ws, {
      type: "loop_available",
      available: hasLoopFiles,
      active: loopState.active,
      iteration: loopState.iteration,
      maxIterations: loopState.maxIterations,
      name: loopState.name || null,
    });

    // Ralph phase state
    sendTo(ws, {
      type: "ralph_phase",
      phase: loopState.phase,
      wizardData: loopState.wizardData,
      craftingSessionId: loopState.craftingSessionId || null,
    });
    if (loopState.phase === "crafting" || loopState.phase === "approval") {
      var _hasPrompt = false;
      var _hasJudge = false;
      var _lDir = loopDir();
      if (_lDir) {
        try { fs.accessSync(path.join(_lDir, "PROMPT.md")); _hasPrompt = true; } catch (e) {}
        try { fs.accessSync(path.join(_lDir, "JUDGE.md")); _hasJudge = true; } catch (e) {}
      }
      sendTo(ws, {
        type: "ralph_files_status",
        promptReady: _hasPrompt,
        judgeReady: _hasJudge,
        bothReady: _hasPrompt && _hasJudge,
        taskId: loopState.loopId,
      });
    }

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
      sendTo(ws, { type: "history_done" });

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
    var schedDelay = Math.max(0, resetsAt - Date.now()) + 180000; // +3min buffer after reset
    var schedEntry = {
      type: "scheduled_message_queued",
      text: text,
      resetsAt: resetsAt,
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
      }
      return;
    }

    // --- Debate ---
    if (msg.type === "debate_start") {
      handleDebateStart(ws, msg);
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

    // --- Memory (session digests) management ---
    if (msg.type === "memory_list") {
      var digestFile = path.join(cwd, "knowledge", "session-digests.jsonl");
      var summaryFile = path.join(cwd, "knowledge", "memory-summary.md");
      var entries = [];
      var summary = "";
      try {
        var raw = fs.readFileSync(digestFile, "utf8").trim();
        if (raw) {
          var lines = raw.split("\n");
          for (var mi = 0; mi < lines.length; mi++) {
            try {
              var obj = JSON.parse(lines[mi]);
              obj.index = mi;
              entries.push(obj);
            } catch (e) {}
          }
        }
      } catch (e) { /* file may not exist */ }
      try {
        if (fs.existsSync(summaryFile)) {
          summary = fs.readFileSync(summaryFile, "utf8").trim();
        }
      } catch (e) {}
      // Return newest first
      entries.reverse();
      sendTo(ws, { type: "memory_list", entries: entries, summary: summary });
      return;
    }

    if (msg.type === "memory_search") {
      if (!msg.query || typeof msg.query !== "string") {
        sendTo(ws, { type: "memory_search_results", results: [], query: "" });
        return;
      }
      var digestFile = path.join(cwd, "knowledge", "session-digests.jsonl");
      try {
        var results = sessionSearch.searchDigests(digestFile, msg.query, {
          maxResults: msg.maxResults || 10,
          minScore: msg.minScore || 0.5,
          dateFrom: msg.dateFrom || null,
          dateTo: msg.dateTo || null
        });
        sendTo(ws, {
          type: "memory_search_results",
          results: sessionSearch.formatForMemoryUI(results),
          query: msg.query
        });
      } catch (e) {
        console.error("[session-search] Search failed:", e.message);
        sendTo(ws, { type: "memory_search_results", results: [], query: msg.query });
      }
      return;
    }

    if (msg.type === "memory_delete") {
      if (typeof msg.index !== "number") return;
      var digestFile = path.join(cwd, "knowledge", "session-digests.jsonl");
      try {
        var raw = fs.readFileSync(digestFile, "utf8").trim();
        var lines = raw ? raw.split("\n") : [];
        if (msg.index >= 0 && msg.index < lines.length) {
          lines.splice(msg.index, 1);
          if (lines.length === 0) {
            fs.unlinkSync(digestFile);
          } else {
            fs.writeFileSync(digestFile, lines.join("\n") + "\n");
          }
        }
      } catch (e) {}
      sendTo(ws, { type: "memory_deleted", index: msg.index });
      handleMessage(ws, { type: "memory_list" });
      return;
    }

    if (msg.type === "push_subscribe") {
      if (pushModule && msg.subscription) pushModule.addSubscription(msg.subscription, msg.replaceEndpoint);
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
      var t = tm.create(msg.cols || 80, msg.rows || 24, getOsUserInfoForWs(ws));
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

    if (msg.type === "loop_start") {
      // If this loop has a cron schedule, don't run immediately — just confirm registration
      if (loopState.wizardData && loopState.wizardData.cron) {
        loopState.active = false;
        loopState.phase = "done";
        saveLoopState();
        send({ type: "loop_finished", reason: "scheduled", iterations: 0, results: [] });
        send({ type: "ralph_phase", phase: "idle", wizardData: null });
        send({ type: "loop_scheduled", recordId: loopState.loopId, cron: loopState.wizardData.cron });
        return;
      }
      startLoop();
      return;
    }

    if (msg.type === "loop_stop") {
      stopLoop();
      return;
    }

    if (msg.type === "ralph_wizard_complete") {
      var wData = msg.data || {};
      var maxIter = wData.maxIterations || 3;
      var wizardCron = wData.cron || null;
      var newLoopId = generateLoopId();
      loopState.loopId = newLoopId;
      loopState.wizardData = {
        name: wData.name || wData.task || "Untitled",
        task: wData.task || "",
        maxIterations: maxIter,
        cron: wizardCron,
      };
      loopState.phase = "crafting";
      loopState.startedAt = Date.now();
      saveLoopState();

      // Register in loop registry
      var recordSource = wData.source === "task" ? null : "ralph";
      loopRegistry.register({
        id: newLoopId,
        name: loopState.wizardData.name,
        task: wData.task || "",
        cron: wizardCron,
        enabled: wizardCron ? true : false,
        maxIterations: maxIter,
        source: recordSource,
      });

      // Create loop directory and write LOOP.json
      var lDir = loopDir();
      try { fs.mkdirSync(lDir, { recursive: true }); } catch (e) {}
      var loopJsonPath = path.join(lDir, "LOOP.json");
      var tmpLoopJson = loopJsonPath + ".tmp";
      fs.writeFileSync(tmpLoopJson, JSON.stringify({ maxIterations: maxIter }, null, 2));
      fs.renameSync(tmpLoopJson, loopJsonPath);

      var craftName = (loopState.wizardData && loopState.wizardData.name) || "";
      var isRalphCraft = recordSource === "ralph";

      // User provided their own PROMPT.md (and optionally JUDGE.md)
      if (wData.mode === "own" && wData.promptText) {
        // Write PROMPT.md
        var promptPath = path.join(lDir, "PROMPT.md");
        var tmpPrompt = promptPath + ".tmp";
        fs.writeFileSync(tmpPrompt, wData.promptText);
        fs.renameSync(tmpPrompt, promptPath);

        if (wData.judgeText) {
          // Both provided: write JUDGE.md too
          var judgePath = path.join(lDir, "JUDGE.md");
          var tmpJudge = judgePath + ".tmp";
          fs.writeFileSync(tmpJudge, wData.judgeText);
          fs.renameSync(tmpJudge, judgePath);
        } else if (!recordSource) {
          // Scheduled task with no judge: force single iteration and go to approval
          var singleJson = loopJsonPath + ".tmp2";
          fs.writeFileSync(singleJson, JSON.stringify({ maxIterations: 1 }, null, 2));
          fs.renameSync(singleJson, loopJsonPath);

          loopState.phase = "approval";
          saveLoopState();
          send({ type: "ralph_phase", phase: "approval", source: recordSource, wizardData: loopState.wizardData });
          send({ type: "ralph_files_status", promptReady: true, judgeReady: false, bothReady: true });
          return;
        } else {
          // Ralph with no judge: start a crafting session to create JUDGE.md
          loopState.phase = "crafting";
          saveLoopState();

          var judgeCraftPrompt = "Use the /clay-ralph skill to design ONLY a JUDGE.md for an existing Ralph Loop. " +
            "The user has already provided PROMPT.md, so do NOT create or modify PROMPT.md. " +
            "You MUST invoke the clay-ralph skill — do NOT execute the task yourself. " +
            "Your job is to read the existing PROMPT.md and create a JUDGE.md " +
            "that will evaluate whether the coder session completed the task successfully.\n\n" +
            "## Task\n" + (wData.task || "") +
            "\n\n## Loop Directory\n" + lDir;

          var judgeCraftSession = sm.createSession();
          judgeCraftSession.title = (isRalphCraft ? "Ralph" : "Task") + (craftName ? " " + craftName : "") + " Crafting";
          judgeCraftSession.ralphCraftingMode = true;
          judgeCraftSession.loop = { active: true, iteration: 0, role: "crafting", loopId: newLoopId, name: craftName, source: recordSource, startedAt: loopState.startedAt };
          sm.saveSessionFile(judgeCraftSession);
          sm.switchSession(judgeCraftSession.localId, null, hydrateImageRefs);
          loopState.craftingSessionId = judgeCraftSession.localId;

          loopRegistry.updateRecord(newLoopId, { craftingSessionId: judgeCraftSession.localId });

          startClaudeDirWatch();

          judgeCraftSession.history.push({ type: "user_message", text: judgeCraftPrompt });
          sm.appendToSessionFile(judgeCraftSession, { type: "user_message", text: judgeCraftPrompt });
          sendToSession(judgeCraftSession.localId, { type: "user_message", text: judgeCraftPrompt });
          judgeCraftSession.isProcessing = true;
          onProcessingChanged();
          judgeCraftSession.sentToolResults = {};
          sendToSession(judgeCraftSession.localId, { type: "status", status: "processing" });
          sdk.startQuery(judgeCraftSession, judgeCraftPrompt, undefined, getLinuxUserForSession(judgeCraftSession));

          send({ type: "ralph_crafting_started", sessionId: judgeCraftSession.localId, taskId: newLoopId, source: recordSource });
          send({ type: "ralph_phase", phase: "crafting", wizardData: loopState.wizardData, craftingSessionId: judgeCraftSession.localId });
          send({ type: "ralph_files_status", promptReady: true, judgeReady: false, bothReady: false });
          return;
        }

        // Both prompt and judge provided: go straight to approval
        loopState.phase = "approval";
        saveLoopState();
        send({ type: "ralph_phase", phase: "approval", source: recordSource, wizardData: loopState.wizardData });
        send({ type: "ralph_files_status", promptReady: true, judgeReady: true, bothReady: true });
        return;
      }

      // Default: "draft" mode — Clay crafts both PROMPT.md and JUDGE.md
      var craftingPrompt = "Use the /clay-ralph skill to design a Ralph Loop for the following task. " +
        "You MUST invoke the clay-ralph skill — do NOT execute the task yourself. " +
        "Your job is to interview me, then create PROMPT.md and JUDGE.md files " +
        "that a future autonomous session will execute.\n\n" +
        "## Task\n" + (wData.task || "") +
        "\n\n## Loop Directory\n" + lDir;

      // Create a new session for crafting
      var craftingSession = sm.createSession();
      craftingSession.title = (isRalphCraft ? "Ralph" : "Task") + (craftName ? " " + craftName : "") + " Crafting";
      craftingSession.ralphCraftingMode = true;
      craftingSession.loop = { active: true, iteration: 0, role: "crafting", loopId: newLoopId, name: craftName, source: recordSource, startedAt: loopState.startedAt };
      sm.saveSessionFile(craftingSession);
      sm.switchSession(craftingSession.localId, null, hydrateImageRefs);
      loopState.craftingSessionId = craftingSession.localId;

      // Store crafting session ID in the registry record
      loopRegistry.updateRecord(newLoopId, { craftingSessionId: craftingSession.localId });

      // Start .claude/ directory watcher
      startClaudeDirWatch();

      // Send crafting prompt and start the conversation with Claude.
      craftingSession.history.push({ type: "user_message", text: craftingPrompt });
      sm.appendToSessionFile(craftingSession, { type: "user_message", text: craftingPrompt });
      sendToSession(craftingSession.localId, { type: "user_message", text: craftingPrompt });
      craftingSession.isProcessing = true;
      onProcessingChanged();
      craftingSession.sentToolResults = {};
      sendToSession(craftingSession.localId, { type: "status", status: "processing" });
      sdk.startQuery(craftingSession, craftingPrompt, undefined, getLinuxUserForSession(craftingSession));

      send({ type: "ralph_crafting_started", sessionId: craftingSession.localId, taskId: newLoopId, source: recordSource });
      send({ type: "ralph_phase", phase: "crafting", wizardData: loopState.wizardData, craftingSessionId: craftingSession.localId });
      return;
    }

    if (msg.type === "loop_registry_files") {
      var recId = msg.id;
      var lDir = path.join(cwd, ".claude", "loops", recId);
      var promptContent = "";
      var judgeContent = "";
      try { promptContent = fs.readFileSync(path.join(lDir, "PROMPT.md"), "utf8"); } catch (e) {}
      try { judgeContent = fs.readFileSync(path.join(lDir, "JUDGE.md"), "utf8"); } catch (e) {}
      send({
        type: "loop_registry_files_content",
        id: recId,
        prompt: promptContent,
        judge: judgeContent,
      });
      return;
    }

    if (msg.type === "ralph_preview_files") {
      var promptContent = "";
      var judgeContent = "";
      var previewDir = loopDir();
      if (previewDir) {
        try { promptContent = fs.readFileSync(path.join(previewDir, "PROMPT.md"), "utf8"); } catch (e) {}
        try { judgeContent = fs.readFileSync(path.join(previewDir, "JUDGE.md"), "utf8"); } catch (e) {}
      }
      sendTo(ws, {
        type: "ralph_files_content",
        prompt: promptContent,
        judge: judgeContent,
      });
      return;
    }

    if (msg.type === "ralph_wizard_cancel") {
      stopClaudeDirWatch();
      // Clean up loop directory
      var cancelDir = loopDir();
      if (cancelDir) {
        try { fs.rmSync(cancelDir, { recursive: true, force: true }); } catch (e) {}
      }
      clearLoopState();
      send({ type: "ralph_phase", phase: "idle", wizardData: null });
      return;
    }

    if (msg.type === "ralph_cancel_crafting") {
      // Abort the crafting session if running
      if (loopState.craftingSessionId != null) {
        var craftSession = sm.sessions.get(loopState.craftingSessionId) || null;
        if (craftSession && craftSession.abortController) {
          craftSession.abortController.abort();
        }
      }
      stopClaudeDirWatch();
      // Clean up loop directory
      var craftCancelDir = loopDir();
      if (craftCancelDir) {
        try { fs.rmSync(craftCancelDir, { recursive: true, force: true }); } catch (e) {}
      }
      clearLoopState();
      send({ type: "ralph_phase", phase: "idle", wizardData: null });
      return;
    }

    // --- Schedule create (from calendar click) ---
    if (msg.type === "schedule_create") {
      var sData = msg.data || {};
      var newRec = loopRegistry.register({
        name: sData.name || "Untitled",
        task: sData.name || "",
        description: sData.description || "",
        date: sData.date || null,
        time: sData.time || null,
        allDay: sData.allDay !== undefined ? sData.allDay : true,
        linkedTaskId: sData.taskId || null,
        cron: sData.cron || null,
        enabled: sData.cron ? (sData.enabled !== false) : false,
        maxIterations: sData.maxIterations || 3,
        source: "schedule",
        color: sData.color || null,
        recurrenceEnd: sData.recurrenceEnd || null,
        skipIfRunning: sData.skipIfRunning !== undefined ? sData.skipIfRunning : true,
        intervalEnd: sData.intervalEnd || null,
      });
      return;
    }

    // --- Hub: cross-project schedule aggregation ---
    if (msg.type === "hub_schedules_list") {
      sendTo(ws, { type: "hub_schedules", schedules: getHubSchedules() });
      return;
    }

    // --- Loop Registry messages ---
    if (msg.type === "loop_registry_list") {
      sendTo(ws, { type: "loop_registry_updated", records: getHubSchedules() });
      return;
    }

    if (msg.type === "loop_registry_update") {
      var updatedRec = loopRegistry.update(msg.id, msg.data || {});
      if (!updatedRec) {
        sendTo(ws, { type: "loop_registry_error", text: "Record not found" });
      }
      return;
    }

    if (msg.type === "loop_registry_rename") {
      if (msg.id && msg.name) {
        loopRegistry.updateRecord(msg.id, { name: String(msg.name).substring(0, 100) });
        sm.broadcastSessionList();
      }
      return;
    }

    if (msg.type === "loop_registry_remove") {
      var removedRec = loopRegistry.remove(msg.id);
      if (!removedRec) {
        sendTo(ws, { type: "loop_registry_error", text: "Record not found" });
      }
      return;
    }

    if (msg.type === "loop_registry_convert") {
      // Convert ralph source to regular task (remove source tag)
      if (msg.id) {
        loopRegistry.updateRecord(msg.id, { source: null });
        sm.broadcastSessionList();
      }
      return;
    }

    if (msg.type === "delete_loop_group") {
      // Delete all sessions belonging to this loopId, then remove registry record
      var loopIdToDel = msg.loopId;
      if (!loopIdToDel) return;
      var sessionIds = [];
      sm.sessions.forEach(function (s, lid) {
        if (s.loop && s.loop.loopId === loopIdToDel) sessionIds.push(lid);
      });
      for (var di = 0; di < sessionIds.length; di++) {
        sm.deleteSessionQuiet(sessionIds[di]);
      }
      loopRegistry.remove(loopIdToDel);
      sm.broadcastSessionList();
      return;
    }

    if (msg.type === "loop_registry_toggle") {
      var toggledRec = loopRegistry.toggleEnabled(msg.id);
      if (!toggledRec) {
        sendTo(ws, { type: "loop_registry_error", text: "Record not found or not scheduled" });
      }
      return;
    }

    if (msg.type === "loop_registry_rerun") {
      // Re-run an existing job (one-off from library)
      if (loopState.active || loopState.phase === "executing") {
        sendTo(ws, { type: "loop_registry_error", text: "A loop is already running" });
        return;
      }
      var rerunRec = loopRegistry.getById(msg.id);
      if (!rerunRec) {
        sendTo(ws, { type: "loop_registry_error", text: "Record not found" });
        return;
      }
      var rerunDir = path.join(cwd, ".claude", "loops", rerunRec.id);
      try {
        fs.accessSync(path.join(rerunDir, "PROMPT.md"));
      } catch (e) {
        sendTo(ws, { type: "loop_registry_error", text: "PROMPT.md missing for " + rerunRec.id });
        return;
      }
      loopState.loopId = rerunRec.id;
      loopState.loopFilesId = null;
      activeRegistryId = null; // not a scheduled trigger
      send({ type: "loop_rerun_started", recordId: rerunRec.id });
      startLoop();
      return;
    }

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

    if (!session.isProcessing) {
      session.isProcessing = true;
      onProcessingChanged();
      session.sentToolResults = {};
      sendToSession(session.localId, { type: "status", status: "processing" });
      if (!session.queryInstance && (!session.worker || session.messageQueue !== "worker")) {
        // No active query (or worker idle between queries): start a new query
        session._queryStartTs = Date.now();
        console.log("[PERF] project.js: startQuery called, localId=" + session.localId + " t=0ms");
        sdk.startQuery(session, fullText, msg.images, getLinuxUserForSession(session));
      } else {
        sdk.pushMessage(session, fullText, msg.images);
      }
    } else {
      sdk.pushMessage(session, fullText, msg.images);
    }
    sm.broadcastSessionList();
  }

  // --- @Mention handler ---
  var MENTION_WINDOW = 20; // turns to check for session continuity

  function getRecentTurns(session, n) {
    var turns = [];
    var history = session.history;
    // Walk backwards through history, collect user/assistant/mention text turns
    var assistantBuffer = "";
    for (var i = history.length - 1; i >= 0 && turns.length < n; i--) {
      var entry = history[i];
      if (entry.type === "user_message") {
        if (assistantBuffer) {
          turns.push({ role: "assistant", text: assistantBuffer.trim() });
          assistantBuffer = "";
        }
        turns.push({ role: "user", text: entry.text || "" });
      } else if (entry.type === "delta" || entry.type === "text") {
        assistantBuffer = (entry.text || "") + assistantBuffer;
      } else if (entry.type === "mention_response") {
        if (assistantBuffer) {
          turns.push({ role: "assistant", text: assistantBuffer.trim() });
          assistantBuffer = "";
        }
        turns.push({ role: "@" + (entry.mateName || "Mate"), text: entry.text || "", mateId: entry.mateId });
      } else if (entry.type === "mention_user") {
        if (assistantBuffer) {
          turns.push({ role: "assistant", text: assistantBuffer.trim() });
          assistantBuffer = "";
        }
        turns.push({ role: "user", text: "@" + (entry.mateName || "Mate") + " " + (entry.text || ""), mateId: entry.mateId });
      }
    }
    if (assistantBuffer) {
      turns.push({ role: "assistant", text: assistantBuffer.trim() });
    }
    turns.reverse();
    return turns;
  }

  // Check if the given mate has a mention response in the recent window
  function hasMateInWindow(recentTurns, mateId) {
    for (var i = 0; i < recentTurns.length; i++) {
      if (recentTurns[i].mateId === mateId && recentTurns[i].role.charAt(0) === "@") {
        return true;
      }
    }
    return false;
  }

  // Build the "middle context": conversation turns since the mate's last response
  function buildMiddleContext(recentTurns, mateId) {
    // Find the last mention response from this mate
    var lastIdx = -1;
    for (var i = recentTurns.length - 1; i >= 0; i--) {
      if (recentTurns[i].mateId === mateId && recentTurns[i].role.charAt(0) === "@") {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx === -1 || lastIdx >= recentTurns.length - 1) return "";

    // Collect turns after the last mention response
    var lines = ["[Conversation since your last response:]", "---"];
    for (var j = lastIdx + 1; j < recentTurns.length; j++) {
      var turn = recentTurns[j];
      lines.push(turn.role + ": " + turn.text);
    }
    lines.push("---");
    return lines.join("\n");
  }

  function buildMentionContext(userName, recentTurns) {
    var lines = [
      "You were @mentioned in a project session by " + userName + ".",
      "You are responding inline in their conversation. Keep your response focused on what was asked.",
      "You have read-only access to the project files but cannot make changes.",
      "",
      "Recent conversation context:",
      "---",
    ];
    for (var i = 0; i < recentTurns.length; i++) {
      var turn = recentTurns[i];
      lines.push(turn.role + ": " + turn.text);
    }
    lines.push("---");
    return lines.join("\n");
  }

  // --- Shared digest worker: one reusable Haiku session for gate+digest ---
  // Combines gate check and digest generation into a single prompt,
  // processes jobs sequentially from a queue, reuses the session across calls.
  // Session is recycled after DIGEST_WORKER_MAX_TURNS to prevent context bloat.
  var _digestWorker = null;
  var _digestQueue = [];
  var _digestBusy = false;
  var _digestWorkerTurns = 0;
  var DIGEST_WORKER_MAX_TURNS = 20;

  function enqueueDigest(job) {
    _digestQueue.push(job);
    if (!_digestBusy) processDigestQueue();
  }

  function processDigestQueue() {
    if (_digestQueue.length === 0) { _digestBusy = false; return; }
    _digestBusy = true;
    var job = _digestQueue.shift();

    var mateDir = matesModule.getMateDir(job.mateCtx, job.mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");

    // Load mate role for gate context
    var mateRole = "";
    try {
      var yamlRaw = fs.readFileSync(path.join(mateDir, "mate.yaml"), "utf8");
      var roleMatch = yamlRaw.match(/^relationship:\s*(.+)$/m);
      if (roleMatch) mateRole = roleMatch[1].trim();
    } catch (e) {}

    // Combined gate + digest in one prompt (saves a full round-trip vs separate gate)
    var prompt = [
      "[SYSTEM: Memory Gate + Digest]",
      "You are a memory system for an AI Mate (role: " + (mateRole || "assistant") + ").",
      "",
      "Conversation (" + job.type + "):",
      job.conversationContent,
      "",
      "STEP 1: Should this be saved to memory?",
      'Answer "no" ONLY if the entire conversation is trivial (e.g. just "hi"/"hello").',
      "When in doubt, save it.",
      "",
      'STEP 2: If yes, output a JSON digest. If no, output exactly: {"skip":true}',
      "",
      "JSON schema (output ONLY the JSON, no markdown, no fences):",
      "{",
      '  "date": "YYYY-MM-DD",',
      '  "type": "' + job.type + '",',
      '  "topic": "short topic description",',
      '  "summary": "2-3 sentence summary",',
      '  "key_quotes": ["user quotes, verbatim, max 5"],',
      '  "user_context": "personal/project context or null",',
      '  "my_position": "what I said/recommended",',
      job.type === "dm" ? '  "user_intent": "what the user wanted",' : '  "other_perspectives": "key points from others",',
      '  "decisions": "what was decided or null",',
      '  "open_items": "what remains unresolved",',
      '  "user_sentiment": "how user felt",',
      '  "confidence": "high|medium|low",',
      '  "revisit_later": true/false,',
      '  "tags": ["topic", "tags"],',
      '  "user_observations": [{"category":"pattern|decision|reaction|preference","observation":"...","evidence":"..."}]',
      "}",
      "",
      "user_observations: OPTIONAL array. Include ONLY if you noticed meaningful patterns about the USER themselves (not the topic).",
      "Categories: pattern (repeated behavior 2+ times), decision (explicit choice with reasoning), reaction (emotional/attitude signal), preference (tool/style/communication preference).",
      "Omit the field entirely if nothing notable about the user.",
    ].join("\n");

    function handleResult(text) {
      var cleaned = text.trim();
      if (cleaned.indexOf("```") === 0) {
        cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
      }

      var digestObj = null;
      try { digestObj = JSON.parse(cleaned); } catch (e) {
        console.error("[digest-worker] Parse failed for " + job.mateId + ":", e.message);
        digestObj = { date: new Date().toISOString().slice(0, 10), topic: "parse_failed", raw: text.substring(0, 500) };
      }

      if (digestObj && digestObj.skip) {
        console.log("[digest-worker] Gate declined for " + job.mateId);
        if (job.onDone) job.onDone();
        processDigestQueue();
        return;
      }

      try {
        fs.mkdirSync(knowledgeDir, { recursive: true });
        var digestFile = path.join(knowledgeDir, "session-digests.jsonl");
        fs.appendFileSync(digestFile, JSON.stringify(digestObj) + "\n");
      } catch (e) {
        console.error("[digest-worker] Write failed for " + job.mateId + ":", e.message);
      }

      // Write user observations if present
      if (digestObj.user_observations && digestObj.user_observations.length > 0) {
        try {
          var obsFile = path.join(knowledgeDir, "user-observations.jsonl");
          var obsMate = matesModule.getMate(job.mateCtx, job.mateId);
          var obsMateName = (obsMate && obsMate.name) || job.mateId;
          var obsLines = [];
          for (var oi = 0; oi < digestObj.user_observations.length; oi++) {
            var obs = digestObj.user_observations[oi];
            obsLines.push(JSON.stringify({
              date: digestObj.date || new Date().toISOString().slice(0, 10),
              category: obs.category || "pattern",
              observation: obs.observation || "",
              evidence: obs.evidence || "",
              confidence: digestObj.confidence || "medium",
              mateName: obsMateName,
              mateId: job.mateId
            }));
          }
          fs.appendFileSync(obsFile, obsLines.join("\n") + "\n");
        } catch (e) {
          console.error("[digest-worker] Observations write failed for " + job.mateId + ":", e.message);
        }
      }

      updateMemorySummary(job.mateCtx, job.mateId, digestObj);
      maybeSynthesizeUserProfile(job.mateCtx, job.mateId);
      if (job.onDone) job.onDone();
      processDigestQueue();
    }

    // Recycle worker session if it has exceeded max turns
    if (_digestWorker && _digestWorkerTurns >= DIGEST_WORKER_MAX_TURNS) {
      try { _digestWorker.close(); } catch (e) {}
      _digestWorker = null;
      _digestWorkerTurns = 0;
    }

    var responseText = "";
    if (_digestWorker && _digestWorker.isAlive()) {
      _digestWorkerTurns++;
      _digestWorker.pushMessage(prompt, {
        onActivity: function () {},
        onDelta: function (d) { responseText += d; },
        onDone: function () { handleResult(responseText); },
        onError: function (err) {
          console.error("[digest-worker] Error:", err);
          _digestWorker = null;
          _digestWorkerTurns = 0;
          if (job.onDone) job.onDone();
          processDigestQueue();
        },
      });
    } else {
      sdk.createMentionSession({
        claudeMd: "",
        model: "haiku",
        initialContext: "[Digest Worker] You generate memory digests. Respond with ONLY JSON.",
        initialMessage: prompt,
        onActivity: function () {},
        onDelta: function (d) { responseText += d; },
        onDone: function () { handleResult(responseText); },
        onError: function (err) {
          console.error("[digest-worker] Create error:", err);
          _digestWorker = null;
          if (job.onDone) job.onDone();
          processDigestQueue();
        },
      }).then(function (ws) { _digestWorker = ws; _digestWorkerTurns = 1; }).catch(function () {
        if (job.onDone) job.onDone();
        processDigestQueue();
      });
    }
  }

  function digestMentionSession(session, mateId, mateCtx, mateResponse, userQuestion) {
    if (!session._mentionSessions || !session._mentionSessions[mateId]) return;
    var mentionSession = session._mentionSessions[mateId];
    if (!mentionSession.isAlive()) return;

    mentionSession._digesting = true;

    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");

    // Migration: generate initial summary if missing
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");
    var digestFile = path.join(knowledgeDir, "session-digests.jsonl");
    if (!fs.existsSync(summaryFile) && fs.existsSync(digestFile)) {
      initMemorySummary(mateCtx, mateId, function () {});
    }

    var userQ = userQuestion || "(unknown)";
    var mateR = mateResponse || "(unknown)";
    var conversationContent = "User: " + (userQ.length > 2000 ? userQ.substring(0, 2000) + "..." : userQ) +
      "\nMate: " + (mateR.length > 2000 ? mateR.substring(0, 2000) + "..." : mateR);

    enqueueDigest({
      mateCtx: mateCtx,
      mateId: mateId,
      type: "mention",
      conversationContent: conversationContent,
      onDone: function () { mentionSession._digesting = false; },
    });
  }

  // Digest DM turn for mate projects - uses shared digest worker
  var _dmDigestPending = false;
  function digestDmTurn(session, responsePreview) {
    if (!isMate || _dmDigestPending) return;
    var mateId = path.basename(cwd);
    var mateCtx = matesModule.buildMateCtx(projectOwnerId);
    if (!matesModule.isMate(mateCtx, mateId)) return;

    // Collect full conversation from session history (all user + mate turns)
    var conversationParts = [];
    var totalLen = 0;
    var CONV_CAP = 6000;
    for (var hi = 0; hi < session.history.length; hi++) {
      var entry = session.history[hi];
      if (entry.type === "user_message" && entry.text) {
        var uText = entry.text;
        if (totalLen + uText.length > CONV_CAP) {
          uText = uText.substring(0, Math.max(200, CONV_CAP - totalLen)) + "...";
        }
        conversationParts.push("User: " + uText);
        totalLen += uText.length;
      } else if (entry.type === "assistant_message" && entry.text) {
        var aText = entry.text;
        if (totalLen + aText.length > CONV_CAP) {
          aText = aText.substring(0, Math.max(200, CONV_CAP - totalLen)) + "...";
        }
        conversationParts.push("Mate: " + aText);
        totalLen += aText.length;
      }
      if (totalLen >= CONV_CAP) break;
    }
    var lastResponseText = responsePreview || "";
    if (lastResponseText && conversationParts.length > 0) {
      var lastPart = conversationParts[conversationParts.length - 1];
      if (lastPart.indexOf("Mate:") !== 0 || lastPart.indexOf(lastResponseText.substring(0, 50)) === -1) {
        var rText = lastResponseText;
        if (totalLen + rText.length > CONV_CAP) {
          rText = rText.substring(0, Math.max(200, CONV_CAP - totalLen)) + "...";
        }
        conversationParts.push("Mate: " + rText);
      }
    }
    if (conversationParts.length === 0) return;

    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");

    // Migration: if memory-summary.md missing but digests exist, generate initial summary
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");
    var digestFile = path.join(knowledgeDir, "session-digests.jsonl");
    if (!fs.existsSync(summaryFile) && fs.existsSync(digestFile)) {
      initMemorySummary(mateCtx, mateId, function () {
        console.log("[memory-migrate] Initial summary generated for mate " + mateId);
      });
    }

    _dmDigestPending = true;

    enqueueDigest({
      mateCtx: mateCtx,
      mateId: mateId,
      type: "dm",
      conversationContent: conversationParts.join("\n"),
      onDone: function () { _dmDigestPending = false; },
    });
  }

  function handleMention(ws, msg) {
    if (!msg.mateId) return;
    if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.pastes || msg.pastes.length === 0)) return;

    var session = getSessionForWs(ws);
    if (!session) return;

    // Block mentions during an active debate
    if (session._debate && session._debate.phase === "live") {
      sendTo(ws, { type: "mention_error", mateId: msg.mateId, error: "Cannot use @mentions during an active debate." });
      return;
    }

    // Check if a mention is already in progress for this session
    if (session._mentionInProgress) {
      sendTo(ws, { type: "mention_error", mateId: msg.mateId, error: "A mention is already in progress." });
      return;
    }

    var userId = ws._clayUser ? ws._clayUser.id : null;
    var mateCtx = matesModule.buildMateCtx(userId);
    var mate = matesModule.getMate(mateCtx, msg.mateId);
    if (!mate) {
      sendTo(ws, { type: "mention_error", mateId: msg.mateId, error: "Mate not found" });
      return;
    }

    var mateName = (mate.profile && mate.profile.displayName) || mate.name || "Mate";
    var avatarColor = (mate.profile && mate.profile.avatarColor) || "#6c5ce7";
    var avatarStyle = (mate.profile && mate.profile.avatarStyle) || "bottts";
    var avatarSeed = (mate.profile && mate.profile.avatarSeed) || mate.id;

    // Build full mention text (include pasted content)
    var mentionFullInput = msg.text || "";
    if (msg.pastes && msg.pastes.length > 0) {
      for (var pi = 0; pi < msg.pastes.length; pi++) {
        if (mentionFullInput) mentionFullInput += "\n\n";
        mentionFullInput += msg.pastes[pi];
      }
    }

    // Save images to disk (same pattern as regular messages)
    var imageRefs = [];
    if (msg.images && msg.images.length > 0) {
      for (var imgIdx = 0; imgIdx < msg.images.length; imgIdx++) {
        var img = msg.images[imgIdx];
        var savedName = saveImageFile(img.mediaType, img.data, getLinuxUserForSession(session));
        if (savedName) {
          imageRefs.push({ mediaType: img.mediaType, file: savedName });
        }
      }
    }

    // Save mention user message to session history
    var mentionUserEntry = { type: "mention_user", text: msg.text, mateId: msg.mateId, mateName: mateName };
    if (msg.pastes && msg.pastes.length > 0) mentionUserEntry.pastes = msg.pastes;
    if (imageRefs.length > 0) mentionUserEntry.imageRefs = imageRefs;
    session.history.push(mentionUserEntry);
    sm.appendToSessionFile(session, mentionUserEntry);
    sendToSessionOthers(ws, session.localId, hydrateImageRefs(mentionUserEntry));

    // Extract recent turns for continuity check
    var recentTurns = getRecentTurns(session, MENTION_WINDOW);

    // Determine user name for context
    var userName = "User";
    if (ws._clayUser) {
      var p = ws._clayUser.profile || {};
      userName = p.name || ws._clayUser.displayName || ws._clayUser.username || "User";
    }

    session._mentionInProgress = true;

    // Send mention start indicator
    sendToSession(session.localId, {
      type: "mention_start",
      mateId: msg.mateId,
      mateName: mateName,
      avatarColor: avatarColor,
      avatarStyle: avatarStyle,
      avatarSeed: avatarSeed,
    });

    // Shared callbacks for both new and continued sessions
    var mentionCallbacks = {
      onActivity: function (activity) {
        sendToSession(session.localId, {
          type: "mention_activity",
          mateId: msg.mateId,
          activity: activity,
        });
      },
      onDelta: function (delta) {
        sendToSession(session.localId, {
          type: "mention_stream",
          mateId: msg.mateId,
          mateName: mateName,
          delta: delta,
        });
      },
      onDone: function (fullText) {
        session._mentionInProgress = false;

        // Save mention response to session history
        var mentionResponseEntry = {
          type: "mention_response",
          mateId: msg.mateId,
          mateName: mateName,
          text: fullText,
          avatarColor: avatarColor,
          avatarStyle: avatarStyle,
          avatarSeed: avatarSeed,
        };
        session.history.push(mentionResponseEntry);
        sm.appendToSessionFile(session, mentionResponseEntry);

        // Queue mention context for injection into the current agent's next turn
        if (!session.pendingMentionContexts) session.pendingMentionContexts = [];
        session.pendingMentionContexts.push(
          "[Context: @" + mateName + " was mentioned and responded]\n\n" +
          "User asked @" + mateName + ": " + msg.text + "\n" +
          mateName + " responded: " + fullText + "\n\n" +
          "[End of @mention context. This is for your reference only. Do not re-execute or repeat this response.]"
        );

        sendToSession(session.localId, { type: "mention_done", mateId: msg.mateId });

        // Check if the mate wrote a debate brief during this turn
        checkForDmDebateBrief(session, msg.mateId, mateCtx);

        // Generate session digest for mate's long-term memory
        digestMentionSession(session, msg.mateId, mateCtx, fullText, msg.text);
      },
      onError: function (errMsg) {
        session._mentionInProgress = false;
        // Clean up dead session
        if (session._mentionSessions && session._mentionSessions[msg.mateId]) {
          delete session._mentionSessions[msg.mateId];
        }
        console.error("[mention] Error for mate " + msg.mateId + ":", errMsg);
        sendToSession(session.localId, { type: "mention_error", mateId: msg.mateId, error: errMsg });
      },
    };

    // Initialize mention sessions map if needed
    if (!session._mentionSessions) session._mentionSessions = {};

    // Session continuity: check if this mate has a response in the recent window
    var existingSession = session._mentionSessions[msg.mateId];
    // Don't reuse a session that's still generating a digest (would mix digest output into mention stream)
    var canContinue = existingSession && existingSession.isAlive() && !existingSession._digesting && hasMateInWindow(recentTurns, msg.mateId);

    if (canContinue) {
      // Continue existing mention session with middle context
      var middleContext = buildMiddleContext(recentTurns, msg.mateId);
      var continuationText = middleContext ? middleContext + "\n\n" + mentionFullInput : mentionFullInput;
      existingSession.pushMessage(continuationText, mentionCallbacks, msg.images);
    } else {
      // Clean up old session if it exists
      if (existingSession) {
        existingSession.close();
        delete session._mentionSessions[msg.mateId];
      }

      // Load Mate CLAUDE.md
      var mateDir = matesModule.getMateDir(mateCtx, msg.mateId);
      var claudeMd = "";
      try {
        claudeMd = fs.readFileSync(path.join(mateDir, "CLAUDE.md"), "utf8");
      } catch (e) {
        // CLAUDE.md may not exist for new mates
      }

      // Load session digests (unified: uses memory-summary.md if available)
      // Pass user's message as query for BM25 search of relevant past sessions
      var recentDigests = loadMateDigests(mateCtx, msg.mateId, mentionFullInput);

      // Build initial mention context
      var mentionContext = buildMentionContext(userName, recentTurns) + recentDigests;

      // Create new persistent mention session
      sdk.createMentionSession({
        claudeMd: claudeMd,
        initialContext: mentionContext,
        initialMessage: mentionFullInput,
        initialImages: msg.images || null,
        onActivity: mentionCallbacks.onActivity,
        onDelta: mentionCallbacks.onDelta,
        onDone: mentionCallbacks.onDone,
        onError: mentionCallbacks.onError,
        canUseTool: function (toolName, input, toolOpts) {
          var autoAllow = { Read: true, Glob: true, Grep: true, WebFetch: true, WebSearch: true };
          if (autoAllow[toolName]) {
            return Promise.resolve({ behavior: "allow", updatedInput: input });
          }
          // Route through the project session's permission system
          return new Promise(function (resolve) {
            var requestId = crypto.randomUUID();
            session.pendingPermissions[requestId] = {
              resolve: resolve,
              requestId: requestId,
              toolName: toolName,
              toolInput: input,
              toolUseId: toolOpts ? toolOpts.toolUseID : undefined,
              decisionReason: (toolOpts && toolOpts.decisionReason) || "",
              mateId: msg.mateId,
            };
            sendToSession(session.localId, {
              type: "permission_request",
              requestId: requestId,
              toolName: toolName,
              toolInput: input,
              toolUseId: toolOpts ? toolOpts.toolUseID : undefined,
              decisionReason: (toolOpts && toolOpts.decisionReason) || "",
              mateId: msg.mateId,
            });
            onProcessingChanged();
            if (toolOpts && toolOpts.signal) {
              toolOpts.signal.addEventListener("abort", function () {
                delete session.pendingPermissions[requestId];
                sendToSession(session.localId, { type: "permission_cancel", requestId: requestId });
                onProcessingChanged();
                resolve({ behavior: "deny", message: "Request cancelled" });
              });
            }
          });
        },
      }).then(function (mentionSession) {
        if (mentionSession) {
          session._mentionSessions[msg.mateId] = mentionSession;
        }
      }).catch(function (err) {
        session._mentionInProgress = false;
        console.error("[mention] Failed to create session for mate " + msg.mateId + ":", err.message || err);
        sendToSession(session.localId, { type: "mention_error", mateId: msg.mateId, error: "Failed to create mention session." });
      });
    }
  }

  // --- Shared mate helpers (used by debate module and other code) ---

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getMateProfile(mateCtx, mateId) {
    var mate = matesModule.getMate(mateCtx, mateId);
    if (!mate) return { name: "Mate", avatarColor: "#6c5ce7", avatarStyle: "bottts", avatarSeed: mateId };
    return {
      name: (mate.profile && mate.profile.displayName) || mate.name || "Mate",
      avatarColor: (mate.profile && mate.profile.avatarColor) || "#6c5ce7",
      avatarStyle: (mate.profile && mate.profile.avatarStyle) || "bottts",
      avatarSeed: (mate.profile && mate.profile.avatarSeed) || mateId,
    };
  }

  function loadMateClaudeMd(mateCtx, mateId) {
    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    try {
      return fs.readFileSync(path.join(mateDir, "CLAUDE.md"), "utf8");
    } catch (e) {
      return "";
    }
  }

  function formatRawDigests(rawLines, headerLabel) {
    if (!rawLines || rawLines.length === 0) return "";
    var lines = ["\n\n" + (headerLabel || "Your recent session memories:")];
    for (var i = 0; i < rawLines.length; i++) {
      try {
        var d = JSON.parse(rawLines[i]);
        if (d.type === "debate" && d.my_role) {
          // Debate memories are role-played positions, not genuine opinions
          lines.push("- [" + (d.date || "?") + "] DEBATE (role: " + d.my_role + ") " + (d.topic || "unknown") +
            ": argued " + (d.my_position || "N/A") + " (assigned role, not my actual opinion)" +
            (d.outcome ? " | Outcome: " + d.outcome : "") +
            (d.open_items ? " | Open: " + d.open_items : ""));
        } else {
          lines.push("- [" + (d.date || "?") + "] " + (d.topic || "unknown") + ": " + (d.my_position || "") +
            (d.decisions ? " | Decisions: " + d.decisions : "") +
            (d.open_items ? " | Open: " + d.open_items : ""));
        }
      } catch (e) {}
    }
    return lines.join("\n");
  }

  function loadMateDigests(mateCtx, mateId, query) {
    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");
    var mate = matesModule.getMate(mateCtx, mateId);
    var hasGlobalSearch = mate && mate.globalSearch;

    // Load shared user profile (available to ALL mates)
    var userProfileResult = "";
    try {
      var matesRoot = matesModule.resolveMatesRoot(mateCtx);
      var userProfilePath = path.join(matesRoot, "user-profile.md");
      if (fs.existsSync(userProfilePath)) {
        var profileContent = fs.readFileSync(userProfilePath, "utf8").trim();
        if (profileContent && profileContent.length > 50) {
          userProfileResult = "\n\n" + profileContent;
        }
      }
    } catch (e) {}

    // Check for memory-summary.md first
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");
    var hasSummary = false;
    var summaryContent = "";
    try {
      if (fs.existsSync(summaryFile)) {
        summaryContent = fs.readFileSync(summaryFile, "utf8").trim();
        if (summaryContent) hasSummary = true;
      }
    } catch (e) {}

    // Load raw digests
    var allLines = [];
    var digestFile = path.join(knowledgeDir, "session-digests.jsonl");
    try {
      if (fs.existsSync(digestFile)) {
        allLines = fs.readFileSync(digestFile, "utf8").trim().split("\n").filter(function (l) { return l.trim(); });
      }
    } catch (e) {}

    var result = userProfileResult;

    if (hasSummary) {
      // Load summary + latest 5 raw digests for richer context
      var recent = allLines.slice(-5);
      result = "\n\nYour memory summary:\n" + summaryContent;
      if (recent.length > 0) {
        result += formatRawDigests(recent, "Latest raw session memories:");
      }
    } else {
      // Backward compatible: latest 8 raw digests
      var recent = allLines.slice(-8);
      result = formatRawDigests(recent, "Your recent session memories:");
    }

    // Global search: always load team memory summaries for globalSearch mates
    var otherDigests = [];
    if (hasGlobalSearch) {
      try {
        var allMates = matesModule.getAllMates(mateCtx);
        var teamSummaries = [];
        for (var mi = 0; mi < allMates.length; mi++) {
          if (allMates[mi].id === mateId) continue;
          var otherDir = matesModule.getMateDir(mateCtx, allMates[mi].id);
          var mateName = allMates[mi].name || allMates[mi].id;

          // Collect digest files for BM25 search
          var otherDigest = path.join(otherDir, "knowledge", "session-digests.jsonl");
          if (fs.existsSync(otherDigest)) {
            otherDigests.push({ path: otherDigest, mateName: mateName });
          }

          // Collect memory summaries for direct context injection
          var otherSummary = path.join(otherDir, "knowledge", "memory-summary.md");
          try {
            if (fs.existsSync(otherSummary)) {
              var summaryText = fs.readFileSync(otherSummary, "utf8").trim();
              if (summaryText && summaryText.length > 50) {
                teamSummaries.push({ mateName: mateName, summary: summaryText });
              }
            }
          } catch (e) {}
        }

        // Inject team memory summaries into context
        if (teamSummaries.length > 0) {
          result += "\n\nTeam memory summaries (other mates' accumulated context):";
          for (var tsi = 0; tsi < teamSummaries.length; tsi++) {
            var ts = teamSummaries[tsi];
            // Cap each summary to avoid context overflow
            var capped = ts.summary.length > 2000 ? ts.summary.substring(0, 2000) + "\n...(truncated)" : ts.summary;
            result += "\n\n--- @" + ts.mateName + " ---\n" + capped;
          }
        }
      } catch (e) {}

      // Inject recent user observations from all mates (newest first, max 15)
      try {
        var allObservations = [];
        var allMatesForObs = matesModule.getAllMates(mateCtx);
        for (var moi = 0; moi < allMatesForObs.length; moi++) {
          var moDir = matesModule.getMateDir(mateCtx, allMatesForObs[moi].id);
          var moFile = path.join(moDir, "knowledge", "user-observations.jsonl");
          try {
            if (fs.existsSync(moFile)) {
              var moLines = fs.readFileSync(moFile, "utf8").trim().split("\n").filter(function (l) { return l.trim(); });
              for (var mli = 0; mli < moLines.length; mli++) {
                try {
                  var moEntry = JSON.parse(moLines[mli]);
                  moEntry._mateName = moEntry.mateName || allMatesForObs[moi].name || allMatesForObs[moi].id;
                  allObservations.push(moEntry);
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
        if (allObservations.length > 0) {
          // Sort by date descending
          allObservations.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
          var recentObs = allObservations.slice(0, 15);
          result += "\n\nRecent user observations from all mates:";
          for (var roi = 0; roi < recentObs.length; roi++) {
            var ro = recentObs[roi];
            result += "\n- [" + (ro.date || "?") + "] [@" + ro._mateName + "] [" + (ro.category || "?") + "] " + (ro.observation || "") + (ro.evidence ? " (evidence: " + ro.evidence + ")" : "");
          }
        }
      } catch (e) {}

      // Inject recent activity timeline across all projects (chronological)
      try {
        var timelineEntries = [];

        // Own sessions
        sm.sessions.forEach(function (s) {
          if (s.hidden || !s.history || s.history.length === 0) return;
          timelineEntries.push({
            title: s.title || "New Session",
            project: null,
            ts: s.lastActivity || s.createdAt || 0
          });
        });

        // Cross-project sessions
        var crossForTimeline = getAllProjectSessions();
        for (var cti = 0; cti < crossForTimeline.length; cti++) {
          var cs = crossForTimeline[cti];
          timelineEntries.push({
            title: cs.title || "New Session",
            project: cs._projectTitle || null,
            ts: cs.lastActivity || cs.createdAt || 0
          });
        }

        // Sort by time descending, take latest 20
        timelineEntries.sort(function (a, b) { return b.ts - a.ts; });
        timelineEntries = timelineEntries.slice(0, 20);

        if (timelineEntries.length > 0) {
          result += "\n\nRecent activity timeline (newest first):";
          for (var ti = 0; ti < timelineEntries.length; ti++) {
            var te = timelineEntries[ti];
            var dateStr = te.ts ? new Date(te.ts).toISOString().replace("T", " ").substring(0, 16) : "?";
            var line = "- [" + dateStr + "] " + te.title;
            if (te.project) line += " (project: " + te.project + ")";
            result += "\n" + line;
          }
        }
      } catch (e) {}
    }

    // BM25 unified search: digests + session history for current topic
    // globalSearch mates always search (they see everything); others need enough digests
    if (query && (hasGlobalSearch || allLines.length > 5)) {
      try {
        // Collect mate's own sessions
        var mateSessions = [];
        sm.sessions.forEach(function (s) {
          if (!s.hidden && s.history && s.history.length > 0) {
            mateSessions.push(s);
          }
        });

        // globalSearch: also collect sessions from all other projects + knowledge files
        var knowledgeFiles = [];
        if (hasGlobalSearch) {
          var crossSessions = getAllProjectSessions();
          for (var cs = 0; cs < crossSessions.length; cs++) {
            mateSessions.push(crossSessions[cs]);
          }

          // Collect knowledge files from all mates
          try {
            var allMatesForKnowledge = matesModule.getAllMates(mateCtx);
            for (var mk = 0; mk < allMatesForKnowledge.length; mk++) {
              var mkDir = matesModule.getMateDir(mateCtx, allMatesForKnowledge[mk].id);
              var mkName = allMatesForKnowledge[mk].name || allMatesForKnowledge[mk].id;
              var mkKnowledgeDir = path.join(mkDir, "knowledge");
              try {
                var kFiles = fs.readdirSync(mkKnowledgeDir);
                for (var kfi = 0; kfi < kFiles.length; kfi++) {
                  var kfName = kFiles[kfi];
                  // Skip system files (digests, identity, base-template)
                  if (kfName === "session-digests.jsonl" || kfName === "memory-summary.md" ||
                      kfName === "identity-backup.md" || kfName === "identity-history.jsonl" ||
                      kfName === "base-template.md") continue;
                  knowledgeFiles.push({
                    filePath: path.join(mkKnowledgeDir, kfName),
                    name: kfName,
                    mateName: mkName
                  });
                }
              } catch (e) {}
            }
          } catch (e) {}
        }

        var searchResults = sessionSearch.searchMate({
          digestFilePath: digestFile,
          otherDigests: otherDigests,
          sessions: mateSessions,
          knowledgeFiles: knowledgeFiles,
          query: query,
          maxResults: hasGlobalSearch ? 12 : 5,
          minScore: 1.0
        });
        var contextStr = sessionSearch.formatForContext(searchResults);
        if (contextStr) result += contextStr;
      } catch (e) {
        console.error("[session-search] Mate search failed:", e.message);
      }
    }

    return result;
  }

  // Gate check: ask Haiku whether this conversation contains anything worth remembering
  function gateMemory(mateCtx, mateId, conversationContent, callback, opts) {
    opts = opts || {};
    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");

    // Load mate role/activities from mate.yaml (lightweight, no full CLAUDE.md)
    var mateRole = "";
    var mateActivities = "";
    try {
      var yamlRaw = fs.readFileSync(path.join(mateDir, "mate.yaml"), "utf8");
      var roleMatch = yamlRaw.match(/^relationship:\s*(.+)$/m);
      var actMatch = yamlRaw.match(/^activities:\s*(.+)$/m);
      if (roleMatch) mateRole = roleMatch[1].trim();
      if (actMatch) mateActivities = actMatch[1].trim();
    } catch (e) {}

    // Load existing memory summary if available
    var summaryContent = "";
    try {
      var summaryFile = path.join(knowledgeDir, "memory-summary.md");
      if (fs.existsSync(summaryFile)) {
        summaryContent = fs.readFileSync(summaryFile, "utf8").trim();
      }
    } catch (e) {}

    // Cap conversation content for gate
    var cappedContent = conversationContent;
    if (cappedContent.length > 3000) {
      cappedContent = cappedContent.substring(0, 3000) + "...";
    }

    var gateContext = [
      "[SYSTEM: Memory Gate]",
      "You are a memory filter for an AI Mate.",
      "",
      "Mate role: " + (mateRole || "assistant"),
      "Mate activities: " + (mateActivities || "general"),
      "",
      "Current memory summary:",
      summaryContent || "No memory summary yet.",
      "",
      "Conversation just ended:",
      cappedContent,
    ].join("\n");

    var gatePrompt = opts.gatePrompt || [
      'Should this conversation be saved to long-term memory?',
      'Answer "yes" if ANY of these apply:',
      "- A new decision, commitment, or direction",
      "- A change in position or strategy",
      "- New information relevant to this Mate's role",
      "- A user preference, opinion, or pattern not already in the summary",
      "- The user shared personal context, project details, or goals",
      "- The user expressed what they like, dislike, or care about",
      "- The user gave instructions on how they want things done",
      "- Anything the user would reasonably expect to be remembered next time",
      "",
      'Answer "no" ONLY if:',
      "- It exactly duplicates what is already in the memory summary",
      "- The entire conversation is a single trivial exchange (e.g. just 'hi' / 'hello')",
      "",
      "When in doubt, answer yes. It is better to remember too much than to forget something important.",
      "",
      'Answer with ONLY "yes" or "no". Nothing else.',
    ].join("\n");
    var defaultOnError = opts.defaultYes !== undefined ? !!opts.defaultYes : true;

    var gateText = "";
    var _gateSession = null;
    sdk.createMentionSession({
      claudeMd: "",
      model: "haiku",
      initialContext: gateContext,
      initialMessage: gatePrompt,
      onActivity: function () {},
      onDelta: function (delta) {
        gateText += delta;
      },
      onDone: function () {
        var answer = gateText.trim().toLowerCase();
        var shouldRemember = answer.indexOf("yes") !== -1;
        if (_gateSession) try { _gateSession.close(); } catch (e) {}
        callback(shouldRemember);
      },
      onError: function (err) {
        console.error("[memory-gate] Gate check failed for mate " + mateId + ":", err);
        if (_gateSession) try { _gateSession.close(); } catch (e) {}
        callback(defaultOnError);
      },
    }).then(function (gs) {
      _gateSession = gs;
      if (!gs) callback(defaultOnError);
    }).catch(function (err) {
      console.error("[memory-gate] Failed to create gate session for mate " + mateId + ":", err);
      callback(defaultOnError);
    });
  }

  // Update (or create) memory-summary.md based on a new digest
  function updateMemorySummary(mateCtx, mateId, digestObj) {
    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");

    // Check if summary exists; if not, try initial generation first
    var summaryExists = false;
    var summaryContent = "";
    try {
      if (fs.existsSync(summaryFile)) {
        summaryContent = fs.readFileSync(summaryFile, "utf8").trim();
        if (summaryContent) summaryExists = true;
      }
    } catch (e) {}

    if (!summaryExists) {
      // Try initial summary generation from existing digests (migration)
      initMemorySummary(mateCtx, mateId, function () {
        // After init, do incremental update with the new digest
        doIncrementalUpdate(mateCtx, mateId, knowledgeDir, summaryFile, digestObj);
      });
    } else {
      doIncrementalUpdate(mateCtx, mateId, knowledgeDir, summaryFile, digestObj);
    }
  }

  // Incremental update of memory-summary.md with a single new digest
  function doIncrementalUpdate(mateCtx, mateId, knowledgeDir, summaryFile, digestObj) {
    var existingSummary = "";
    try {
      if (fs.existsSync(summaryFile)) {
        existingSummary = fs.readFileSync(summaryFile, "utf8").trim();
      }
    } catch (e) {}

    var updateContext = [
      "[SYSTEM: Memory Summary Update]",
      "You are updating an AI Mate's long-term memory summary.",
      "",
      "Current summary:",
      existingSummary || "(empty, this is the first entry)",
      "",
      "New session digest to incorporate:",
      JSON.stringify(digestObj, null, 2),
    ].join("\n");

    var updatePrompt = [
      "Update the summary by:",
      "1. Adding new information from this session",
      "2. Updating existing entries if positions changed",
      "3. Moving resolved open threads out of \"Open Threads\"",
      "4. Adding to \"My Track Record\" if a past prediction/recommendation can now be evaluated",
      "5. Removing outdated or redundant information",
      "6. Preserving important user quotes and context from key_quotes and user_context fields",
      "",
      "Maintain this structure:",
      "",
      "# Memory Summary",
      "Last updated: YYYY-MM-DD (session count: N+1)",
      "",
      "## User Context",
      "(who they are, what they work on, project details, goals)",
      "## User Patterns",
      "(preferences, work style, communication style, likes/dislikes)",
      "## Key Decisions",
      "## Notable Quotes",
      "(important things the user said, verbatim when possible)",
      "## My Track Record",
      "## Open Threads",
      "## Recurring Topics",
      "",
      "Keep it concise. Each section should have at most 10 bullet points.",
      "Drop the oldest/least relevant if needed.",
      "The Notable Quotes section is valuable for preserving the user's voice and intent.",
      "Output ONLY the updated markdown. Nothing else.",
    ].join("\n");

    var updateText = "";
    var _updateSession = null;
    sdk.createMentionSession({
      claudeMd: "",
      model: "haiku",
      initialContext: updateContext,
      initialMessage: updatePrompt,
      onActivity: function () {},
      onDelta: function (delta) {
        updateText += delta;
      },
      onDone: function () {
        try {
          var cleaned = updateText.trim();
          if (cleaned.indexOf("```") === 0) {
            cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
          }
          fs.mkdirSync(knowledgeDir, { recursive: true });
          fs.writeFileSync(summaryFile, cleaned + "\n", "utf8");
          console.log("[memory-summary] Updated memory-summary.md for mate " + mateId);
        } catch (e) {
          console.error("[memory-summary] Failed to write memory-summary.md for mate " + mateId + ":", e.message);
        }
        if (_updateSession) try { _updateSession.close(); } catch (e) {}
      },
      onError: function (err) {
        console.error("[memory-summary] Summary update failed for mate " + mateId + ":", err);
        if (_updateSession) try { _updateSession.close(); } catch (e) {}
      },
    }).then(function (us) {
      _updateSession = us;
    }).catch(function (err) {
      console.error("[memory-summary] Failed to create summary update session for mate " + mateId + ":", err);
    });
  }

  // User profile synthesis: collect observations from all mates, synthesize unified profile
  var USER_PROFILE_SYNTHESIS_THRESHOLD = 8;

  function maybeSynthesizeUserProfile(mateCtx, mateId) {
    var mate = matesModule.getMate(mateCtx, mateId);
    if (!mate || !mate.globalSearch) return; // Only primary/globalSearch mates synthesize

    var matesRoot = matesModule.resolveMatesRoot(mateCtx);
    var profilePath = path.join(matesRoot, "user-profile.md");

    // Collect all observations across all mates
    var allObs = [];
    try {
      var allMates = matesModule.getAllMates(mateCtx);
      for (var mi = 0; mi < allMates.length; mi++) {
        var moDir = matesModule.getMateDir(mateCtx, allMates[mi].id);
        var moFile = path.join(moDir, "knowledge", "user-observations.jsonl");
        try {
          if (fs.existsSync(moFile)) {
            var lines = fs.readFileSync(moFile, "utf8").trim().split("\n").filter(function (l) { return l.trim(); });
            for (var li = 0; li < lines.length; li++) {
              try { allObs.push(JSON.parse(lines[li])); } catch (e) {}
            }
          }
        } catch (e) {}
      }
    } catch (e) { return; }

    if (allObs.length === 0) return;

    // Check if synthesis is needed (threshold since last synthesis)
    var existingProfile = "";
    var lastObsCount = 0;
    try {
      if (fs.existsSync(profilePath)) {
        existingProfile = fs.readFileSync(profilePath, "utf8").trim();
        var countMatch = existingProfile.match(/from (\d+) observations/);
        if (countMatch) lastObsCount = parseInt(countMatch[1], 10) || 0;
      }
    } catch (e) {}

    if (allObs.length - lastObsCount < USER_PROFILE_SYNTHESIS_THRESHOLD) return;

    // Sort newest first for synthesis
    allObs.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });

    var synthContext = [
      "[SYSTEM: User Profile Synthesis]",
      "You are synthesizing a user profile from observations collected by multiple AI teammates.",
      "",
      "Current profile:",
      existingProfile || "(none yet, first synthesis)",
      "",
      "All observations (" + allObs.length + " total, newest first):",
      allObs.map(function (o) {
        return "[" + (o.date || "?") + "] [@" + (o.mateName || o.mateId || "?") + "] [" + (o.category || "?") + "] " + (o.observation || "") + (o.evidence ? " (evidence: " + o.evidence + ")" : "");
      }).join("\n"),
    ].join("\n");

    var synthPrompt = [
      "Synthesize a unified user profile from these observations.",
      "",
      "Rules:",
      "1. Organize by: Communication Style, Decision Patterns, Working Habits, Technical Preferences, Emotional Signals",
      "2. Each point: observation + source mates and dates in parentheses",
      "3. If observations contradict, note both with dates. Preferences evolve.",
      "4. Mark patterns seen 3+ times as [strong], 2 times as [emerging]",
      "5. Keep under 800 words. This is a reference card, not a biography.",
      '6. End with: "Last synthesized: YYYY-MM-DD from N observations across M mates"',
      "",
      "Output ONLY the markdown profile. No fences, no extra text.",
    ].join("\n");

    var synthText = "";
    sdk.createMentionSession({
      claudeMd: "",
      model: "haiku",
      initialContext: synthContext,
      initialMessage: synthPrompt,
      onActivity: function () {},
      onDelta: function (delta) { synthText += delta; },
      onDone: function () {
        try {
          var cleaned = synthText.trim();
          if (cleaned.indexOf("```") === 0) {
            cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
          }
          fs.mkdirSync(path.dirname(profilePath), { recursive: true });
          fs.writeFileSync(profilePath, cleaned + "\n", "utf8");
          console.log("[user-profile] Synthesized user-profile.md from " + allObs.length + " observations");
        } catch (e) {
          console.error("[user-profile] Failed to write user-profile.md:", e.message);
        }
      },
      onError: function (err) {
        console.error("[user-profile] Synthesis failed:", err);
      },
    }).catch(function (err) {
      console.error("[user-profile] Failed to create synthesis session:", err);
    });
  }

  // Initial summary generation (migration): read latest 20 digests and generate first summary
  function initMemorySummary(mateCtx, mateId, callback) {
    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");
    var digestFile = path.join(knowledgeDir, "session-digests.jsonl");

    // Check if digests exist
    var allLines = [];
    try {
      if (fs.existsSync(digestFile)) {
        allLines = fs.readFileSync(digestFile, "utf8").trim().split("\n").filter(function (l) { return l.trim(); });
      }
    } catch (e) {}

    if (allLines.length === 0) {
      // No digests to summarize, just callback
      callback();
      return;
    }

    var recent = allLines.slice(-20);
    var digestsText = [];
    for (var i = 0; i < recent.length; i++) {
      try {
        var d = JSON.parse(recent[i]);
        digestsText.push(JSON.stringify(d));
      } catch (e) {}
    }

    if (digestsText.length === 0) {
      callback();
      return;
    }

    var initContext = [
      "[SYSTEM: Initial Memory Summary]",
      "You are creating the first long-term memory summary for an AI Mate.",
      "",
      "Here are the most recent session digests (up to 20):",
      digestsText.join("\n"),
    ].join("\n");

    var initPrompt = [
      "Create a memory summary from these sessions.",
      "",
      "Structure:",
      "",
      "# Memory Summary",
      "Last updated: YYYY-MM-DD (session count: N)",
      "",
      "## User Context",
      "(who they are, what they work on, project details, goals)",
      "## User Patterns",
      "(preferences, work style, communication style, likes/dislikes)",
      "## Key Decisions",
      "## Notable Quotes",
      "(important things the user said, verbatim when possible)",
      "## My Track Record",
      "## Open Threads",
      "## Recurring Topics",
      "",
      "Keep it concise. Focus on patterns, decisions, and the user's own words.",
      "Each section should have at most 10 bullet points.",
      "Preserve key_quotes from digests in the Notable Quotes section.",
      "Set session count to " + digestsText.length + ".",
      "Output ONLY the markdown. Nothing else.",
    ].join("\n");

    var initText = "";
    var _initSession = null;
    sdk.createMentionSession({
      claudeMd: "",
      model: "haiku",
      initialContext: initContext,
      initialMessage: initPrompt,
      onActivity: function () {},
      onDelta: function (delta) {
        initText += delta;
      },
      onDone: function () {
        try {
          var cleaned = initText.trim();
          if (cleaned.indexOf("```") === 0) {
            cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
          }
          fs.mkdirSync(knowledgeDir, { recursive: true });
          fs.writeFileSync(summaryFile, cleaned + "\n", "utf8");
          console.log("[memory-summary] Generated initial memory-summary.md for mate " + mateId + " from " + digestsText.length + " digests");
        } catch (e) {
          console.error("[memory-summary] Failed to write initial memory-summary.md for mate " + mateId + ":", e.message);
        }
        if (_initSession) try { _initSession.close(); } catch (e) {}
        callback();
      },
      onError: function (err) {
        console.error("[memory-summary] Initial summary generation failed for mate " + mateId + ":", err);
        if (_initSession) try { _initSession.close(); } catch (e) {}
        callback();
      },
    }).then(function (is) {
      _initSession = is;
      if (!is) callback();
    }).catch(function (err) {
      console.error("[memory-summary] Failed to create init summary session for mate " + mateId + ":", err);
      callback();
    });
  }

  // --- Debate engine (delegated to project-debate.js) ---
  var _debate = attachDebate({
    cwd: cwd,
    slug: slug,
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
  var handleDebateComment = _debate.handleDebateComment;
  var handleDebateStop = _debate.handleDebateStop;
  var handleDebateConcludeResponse = _debate.handleDebateConcludeResponse;
  var handleDebateConfirmBrief = _debate.handleDebateConfirmBrief;
  var restoreDebateState = _debate.restoreDebateState;
  var checkForDmDebateBrief = _debate.checkForDmDebateBrief;

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

  // --- Handle project-scoped HTTP requests ---
  function handleHTTP(req, res, urlPath) {
    // Serve chat images
    if (req.method === "GET" && urlPath.indexOf("/images/") === 0) {
      var imgName = path.basename(urlPath);
      // Sanitize: only allow expected filename pattern
      if (!/^\d+-[a-f0-9]+\.\w+$/.test(imgName)) {
        res.writeHead(400);
        res.end("Bad request");
        return true;
      }
      var imgPath = path.join(imagesDir, imgName);
      try {
        var imgBuf = fs.readFileSync(imgPath);
        var ext = path.extname(imgName).toLowerCase();
        var mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
        res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
        res.end(imgBuf);
      } catch (e) {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    // File upload
    if (req.method === "POST" && urlPath === "/api/upload") {
      parseJsonBody(req).then(function (body) {
        var fileName = body.name;
        var fileData = body.data; // base64
        if (!fileName || !fileData) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing name or data"}');
          return;
        }
        // Sanitize filename — strip path separators
        var safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._\-\(\)\[\] ]/g, "_");
        if (!safeName) safeName = "upload";

        // Check size
        var estimatedBytes = fileData.length * 0.75;
        if (estimatedBytes > MAX_UPLOAD_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end('{"error":"file too large (max 50MB)"}');
          return;
        }

        // Create tmp dir: os.tmpdir()/clay-{hash}/
        var cwdHash = crypto.createHash("sha256").update(cwd).digest("hex").substring(0, 12);
        var tmpDir = path.join(os.tmpdir(), "clay-" + cwdHash);
        try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}

        // Add timestamp prefix to avoid collisions
        var ts = Date.now();
        var destName = ts + "-" + safeName;
        var destPath = path.join(tmpDir, destName);

        try {
          var buf = Buffer.from(fileData, "base64");
          fs.writeFileSync(destPath, buf);
          // Make readable by all local users and chown to session owner
          try { fs.chmodSync(destPath, 0o644); } catch (e2) {}
          try { fs.chmodSync(tmpDir, 0o755); } catch (e2) {}
          if (req._clayUser && req._clayUser.linuxUser) {
            try {
              var _osUM = require("./os-users");
              var _uid = _osUM.getLinuxUserUid(req._clayUser.linuxUser);
              if (_uid != null) {
                require("child_process").execSync("chown " + _uid + " " + JSON.stringify(destPath));
                require("child_process").execSync("chown " + _uid + " " + JSON.stringify(tmpDir));
              }
            } catch (e2) {}
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ path: destPath, name: safeName }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "failed to save: " + (e.message || e) }));
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Push subscribe
    if (req.method === "POST" && urlPath === "/api/push-subscribe") {
      parseJsonBody(req).then(function (body) {
        var sub = body.subscription || body;
        if (pushModule) pushModule.addSubscription(sub, body.replaceEndpoint);
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
        var fileServeUserInfo = getOsUserInfoForReq(req);
        var fileContent;
        if (fileServeUserInfo) {
          var binResult = fsAsUser("read_binary", { file: absFile }, fileServeUserInfo);
          fileContent = binResult.buffer;
        } else {
          fileContent = fs.readFileSync(absFile);
        }
        var fileMime = MIME_TYPES[fileExt] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": fileMime, "Cache-Control": "no-cache" });
        res.end(fileContent);
      } catch (e) {
        res.writeHead(404); res.end("Not found");
      }
      return true;
    }

    // Skills permission gate
    if (urlPath === "/api/install-skill" || urlPath === "/api/uninstall-skill" || urlPath === "/api/installed-skills") {
      if (req._clayUser) {
        var skPerms = usersModule.getEffectivePermissions(req._clayUser, osUsers);
        if (!skPerms.skills) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"Skills access is not permitted"}');
          return true;
        }
      }
    }

    // Install a skill (background spawn)
    if (req.method === "POST" && urlPath === "/api/install-skill") {
      parseJsonBody(req).then(function (body) {
        var url = body.url;
        var skill = body.skill;
        var scope = body.scope; // "global" or "project"
        if (!url || !skill || !scope) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing url, skill, or scope"}');
          return;
        }
        // Validate skill name: alphanumeric, hyphens, underscores only
        if (!/^[a-zA-Z0-9_-]+$/.test(skill)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"invalid skill name"}');
          return;
        }
        // Validate URL: must be https://
        if (!/^https:\/\//i.test(url)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"only https:// URLs are allowed"}');
          return;
        }
        var skillUserInfo = getOsUserInfoForReq(req);
        var spawnCwd = scope === "global" ? (skillUserInfo ? skillUserInfo.home : require("./config").REAL_HOME) : cwd;
        var scopeFlag = scope === "global" ? "--global" : "--project";
        var skillSpawnOpts = {
          cwd: spawnCwd,
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        };
        if (skillUserInfo) {
          skillSpawnOpts.uid = skillUserInfo.uid;
          skillSpawnOpts.gid = skillUserInfo.gid;
          skillSpawnOpts.env = Object.assign({}, process.env, {
            HOME: skillUserInfo.home,
            npm_config_cache: require("path").join(skillUserInfo.home, ".npm"),
          });
        }
        console.log("[skill-install] spawning: npx skills add " + url + " --skill " + skill + " --yes " + scopeFlag + " (cwd: " + spawnCwd + ")");
        var child = spawn("npx", ["skills", "add", url, "--skill", skill, "--yes", scopeFlag], skillSpawnOpts);
        var stdoutBuf = "";
        var stderrBuf = "";
        child.stdout.on("data", function (chunk) {
          stdoutBuf += chunk.toString();
          console.log("[skill-install] " + skill + " stdout chunk: " + chunk.toString().trim().slice(0, 500));
        });
        child.stderr.on("data", function (chunk) {
          stderrBuf += chunk.toString();
          console.log("[skill-install] " + skill + " stderr chunk: " + chunk.toString().trim().slice(0, 500));
        });
        // Timeout after 60 seconds
        var installTimeout = setTimeout(function () {
          console.error("[skill-install] " + skill + " timed out after 60s, killing process");
          try { child.kill("SIGTERM"); } catch (e) {}
          try {
            send({ type: "skill_installed", skill: skill, scope: scope, success: false, error: "Installation timed out after 60 seconds" });
          } catch (e) {}
        }, 60000);
        child.on("close", function (code) {
          clearTimeout(installTimeout);
          console.log("[skill-install] " + skill + " exited with code " + code + " (stdout=" + stdoutBuf.length + "b, stderr=" + stderrBuf.length + "b)");
          if (stdoutBuf) console.log("[skill-install] stdout: " + stdoutBuf.slice(0, 2000));
          if (stderrBuf) console.log("[skill-install] stderr: " + stderrBuf.slice(0, 2000));
          try {
            var success = code === 0;
            send({
              type: "skill_installed",
              skill: skill,
              scope: scope,
              success: success,
              error: success ? null : "Process exited with code " + code,
            });
          } catch (e) {
            console.error("[project] skill_installed send failed:", e.message || e);
          }
        });
        child.on("error", function (err) {
          clearTimeout(installTimeout);
          console.error("[skill-install] " + skill + " spawn error:", err.message || err);
          try {
            send({
              type: "skill_installed",
              skill: skill,
              scope: scope,
              success: false,
              error: err.message,
            });
          } catch (e) {
            console.error("[skill-install] " + skill + " send failed:", e.message || e);
          }
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Uninstall a skill (remove directory)
    if (req.method === "POST" && urlPath === "/api/uninstall-skill") {
      parseJsonBody(req).then(function (body) {
        var skill = body.skill;
        var scope = body.scope; // "global" or "project"
        if (!skill || !scope) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing skill or scope"}');
          return;
        }
        // Validate skill name
        if (!/^[a-zA-Z0-9_-]+$/.test(skill)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"invalid skill name"}');
          return;
        }
        var uninstallUserInfo = getOsUserInfoForReq(req);
        var baseDir = scope === "global" ? (uninstallUserInfo ? uninstallUserInfo.home : require("./config").REAL_HOME) : cwd;
        var skillDir = path.join(baseDir, ".claude", "skills", skill);
        // Safety: ensure skillDir is inside the expected .claude/skills directory
        var expectedParent = path.join(baseDir, ".claude", "skills");
        var resolved = path.resolve(skillDir);
        if (!resolved.startsWith(expectedParent + path.sep)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"invalid skill path"}');
          return;
        }
        try {
          if (uninstallUserInfo) {
            // Run rm as target user to respect permissions
            var rmScript = "var fs = require('fs'); fs.rmSync(" + JSON.stringify(resolved) + ", { recursive: true, force: true });";
            execFileSync(process.execPath, ["-e", rmScript], {
              uid: uninstallUserInfo.uid,
              gid: uninstallUserInfo.gid,
              timeout: 10000,
            });
          } else {
            fs.rmSync(resolved, { recursive: true, force: true });
          }
          send({
            type: "skill_uninstalled",
            skill: skill,
            scope: scope,
            success: true,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch (err) {
          send({
            type: "skill_uninstalled",
            skill: skill,
            scope: scope,
            success: false,
            error: err.message,
          });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Installed skills (global + project)
    if (req.method === "GET" && urlPath === "/api/installed-skills") {
      var installed = {};
      var globalDir = path.join(require("./config").REAL_HOME, ".claude", "skills");
      var projectDir = path.join(cwd, ".claude", "skills");
      var scanDirs = [
        { dir: globalDir, scope: "global" },
        { dir: projectDir, scope: "project" },
      ];
      for (var sd = 0; sd < scanDirs.length; sd++) {
        var entries;
        try { entries = fs.readdirSync(scanDirs[sd].dir, { withFileTypes: true }); } catch (e) { continue; }
        for (var si = 0; si < entries.length; si++) {
          var ent = entries[si];
          if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
          var mdPath = path.join(scanDirs[sd].dir, ent.name, "SKILL.md");
          try {
            var mdContent = fs.readFileSync(mdPath, "utf8");
            var desc = "";
            // Parse YAML frontmatter for description
            var version = "";
            if (mdContent.startsWith("---")) {
              var endIdx = mdContent.indexOf("---", 3);
              if (endIdx !== -1) {
                var frontmatter = mdContent.substring(3, endIdx);
                var descMatch = frontmatter.match(/^description:\s*(.+)/m);
                if (descMatch) desc = descMatch[1].trim();
                var verMatch = frontmatter.match(/version:\s*"?([^"\n]+)"?/m);
                if (verMatch) version = verMatch[1].trim();
              }
            }
            if (!installed[ent.name]) {
              installed[ent.name] = { scope: scanDirs[sd].scope, description: desc, version: version, path: path.join(scanDirs[sd].dir, ent.name) };
            } else {
              // project-level adds to existing global entry
              installed[ent.name].scope = "both";
              if (desc && !installed[ent.name].description) installed[ent.name].description = desc;
              if (version && !installed[ent.name].version) installed[ent.name].version = version;
            }
          } catch (e) {}
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ installed: installed }));
      return true;
    }

    // Check skill updates (compare installed vs remote versions)
    if (req.method === "POST" && urlPath === "/api/check-skill-updates") {
      parseJsonBody(req).then(function (body) {
        var skills = body.skills; // [{ name, url, scope }]
        if (!Array.isArray(skills) || skills.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing skills array"}');
          return;
        }
        // Read installed versions (use requesting user's home in multi-user setups)
        var skillUserHome = (function () {
          var sui = getOsUserInfoForReq(req);
          return sui ? sui.home : require("./config").REAL_HOME;
        })();
        var globalSkillsDir = path.join(skillUserHome, ".claude", "skills");
        var projectSkillsDir = path.join(cwd, ".claude", "skills");
        var results = [];
        var pending = skills.length;

        function parseVersionFromSkillMd(content) {
          if (!content || !content.startsWith("---")) return "";
          var endIdx = content.indexOf("---", 3);
          if (endIdx === -1) return "";
          var fm = content.substring(3, endIdx);
          var m = fm.match(/version:\s*"?([^"\n]+)"?/m);
          return m ? m[1].trim() : "";
        }

        function getInstalledVersion(name) {
          var dirs = [path.join(globalSkillsDir, name, "SKILL.md"), path.join(projectSkillsDir, name, "SKILL.md")];
          for (var d = 0; d < dirs.length; d++) {
            try {
              var c = fs.readFileSync(dirs[d], "utf8");
              var v = parseVersionFromSkillMd(c);
              if (v) return v;
            } catch (e) {}
          }
          return "";
        }

        function compareVersions(a, b) {
          // returns -1 if a < b, 0 if equal, 1 if a > b
          if (!a && !b) return 0;
          if (!a) return -1;
          if (!b) return 1;
          var pa = a.split(".").map(Number);
          var pb = b.split(".").map(Number);
          for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
            var va = pa[i] || 0;
            var vb = pb[i] || 0;
            if (va < vb) return -1;
            if (va > vb) return 1;
          }
          return 0;
        }

        function finishOne() {
          pending--;
          if (pending === 0) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ results: results }));
          }
        }

        for (var si = 0; si < skills.length; si++) {
          (function (skill) {
            var installedVer = getInstalledVersion(skill.name);
            var installed = !!installedVer;
            console.log("[skill-check] " + skill.name + " installed=" + installed + " localVersion=" + (installedVer || "none"));
            // Convert GitHub repo URL to raw SKILL.md URL
            var rawUrl = "";
            var ghMatch = skill.url.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (ghMatch) {
              rawUrl = "https://raw.githubusercontent.com/" + ghMatch[1] + "/" + ghMatch[2] + "/main/SKILL.md";
            }
            if (!rawUrl) {
              console.log("[skill-check] " + skill.name + " no valid GitHub URL, skipping remote check");
              results.push({ name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: "", status: installed ? "ok" : "missing" });
              finishOne();
              return;
            }
            console.log("[skill-check] " + skill.name + " fetching remote: " + rawUrl);
            // Fetch remote SKILL.md
            var https = require("https");
            https.get(rawUrl, function (resp) {
              console.log("[skill-check] " + skill.name + " remote response status=" + resp.statusCode);
              var data = "";
              resp.on("data", function (chunk) { data += chunk; });
              resp.on("end", function () {
                try {
                  var remoteVer = parseVersionFromSkillMd(data);
                  var status = "ok";
                  if (!installed) {
                    status = "missing";
                  } else if (remoteVer && compareVersions(installedVer, remoteVer) < 0) {
                    status = "outdated";
                  }
                  console.log("[skill-check] " + skill.name + " remoteVersion=" + remoteVer + " status=" + status);
                  results.push({ name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: remoteVer, status: status });
                  finishOne();
                } catch (e) {
                  console.error("[skill-check] " + skill.name + " version parse failed:", e.message || e);
                  results.push({ name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: "", status: installed ? "ok" : "error" });
                  finishOne();
                }
              });
            }).on("error", function (err) {
              console.error("[skill-check] " + skill.name + " fetch error:", err.message || err);
              results.push({ name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: "", status: installed ? "ok" : "missing" });
              finishOne();
            });
          })(skills[si]);
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Git dirty check
    if (req.method === "GET" && urlPath === "/api/git-dirty") {
      var execSync = require("child_process").execSync;
      try {
        var out = execSync("git status --porcelain", { cwd: cwd, encoding: "utf8", timeout: 5000 });
        var dirty = out.trim().split("\n").some(function (line) {
          return line.trim().length > 0 && !line.startsWith("??");
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ dirty: dirty }));
      } catch (e) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ dirty: false }));
      }
      return true;
    }

    // List branches for worktree modal
    if (req.method === "GET" && urlPath === "/api/branches") {
      try {
        var brRaw = execFileSync("git", ["branch", "-a", "--format=%(refname:short)"], {
          cwd: cwd, timeout: 5000, encoding: "utf8"
        });
        var brList = brRaw.trim().split("\n").filter(Boolean);
        var defBr = "main";
        try {
          var hrRef = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], {
            cwd: cwd, timeout: 3000, encoding: "utf8"
          }).trim();
          defBr = hrRef.replace(/^origin\//, "");
        } catch (e) {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ branches: brList, defaultBranch: defBr }));
      } catch (e) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ branches: ["main"], defaultBranch: "main" }));
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
    loopRegistry.stopTimer();
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
    getSchedules: function () { return loopRegistry.getAll(); },
    importSchedule: function (data) { return loopRegistry.register(data); },
    removeSchedule: function (id) { return loopRegistry.remove(id); },
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

module.exports = { createProjectContext: createProjectContext, safePath: safePath, validateEnvString: validateEnvString };
