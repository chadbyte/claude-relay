#!/usr/bin/env node

// --- Node version check ---
var nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 20) {
  console.error("\x1b[31m[clay] Node.js 20+ is required (current: " + process.version + ")\x1b[0m");
  console.error("[clay] The Claude Agent SDK 0.2.40+ requires Node 20 for Symbol.dispose support.");
  console.error("[clay] If you cannot upgrade Node, use claude-relay@2.4.3 which supports Node 18.");
  console.error("");
  console.error("  Upgrade Node:  nvm install 22 && nvm use 22");
  console.error("  Or use older:  npx claude-relay@2.4.3");
  process.exit(78); // EX_CONFIG — fatal config error, don't auto-restart
}

// Polyfill Symbol.dispose/asyncDispose if missing (Node 20.x may not have it)
if (!Symbol.dispose) Symbol.dispose = Symbol("Symbol.dispose");
if (!Symbol.asyncDispose) Symbol.asyncDispose = Symbol("Symbol.asyncDispose");

// Increase listener limit for projects with many worktrees
process.setMaxListeners(50);

// Remove CLAUDECODE env var so the SDK can spawn Claude Code child processes
// (prevents "cannot be launched inside another Claude Code session" error)
delete process.env.CLAUDECODE;

var fs = require("fs");
var path = require("path");
var { loadConfig, saveConfig, socketPath, generateSlug, syncClayrc, removeFromClayrc, writeCrashInfo, readCrashInfo, clearCrashInfo, isPidAlive, clearStaleConfig, REAL_HOME } = require("./config");
var { createIPCServer } = require("./ipc");
var { createServer, generateAuthToken } = require("./server");
var { checkAclSupport, grantProjectAccess, revokeProjectAccess, provisionAllUsers, provisionLinuxUser, grantAllUsersAccess, deactivateLinuxUser, ensureProjectsDir } = require("./os-users");
var usersModule = require("./users");
var { createWorktree, removeWorktree, isWorktree } = require("./worktree");
var mates = require("./mates");
var { isWorktreeSlug, scanAndRegisterWorktrees, rescanWorktrees, cleanupWorktreesForParent, getFilteredRemovedProjects, registerWorktreeSlug, unregisterWorktreeSlug } = require("./daemon-projects");

var daemonVersion = require("../package.json").version;
var configFile = process.env.CLAY_CONFIG || process.env.CLAUDE_RELAY_CONFIG || require("./config").configPath();
var config;

try {
  config = JSON.parse(fs.readFileSync(configFile, "utf8"));
} catch (e) {
  console.error("[daemon] Failed to read config:", e.message);
  process.exit(1);
}
console.log("[daemon] v" + daemonVersion + " PID " + process.pid + " config " + configFile);

console.log("[daemon] Config: " + configFile);
console.log("[daemon] Users: " + usersModule.USERS_FILE);
if (process.env.SUDO_USER) console.log("[daemon] SUDO_USER: " + process.env.SUDO_USER);
console.log("[daemon] UID: " + (typeof process.getuid === "function" ? process.getuid() : "N/A"));

// --- OS users mode: check required system dependencies ---
if (config.osUsers) {
  var { execSync: checkExec } = require("child_process");
  var missing = [];
  try { checkExec("which setfacl", { stdio: "ignore" }); } catch (e) { missing.push("acl (setfacl)"); }
  try { checkExec("which git", { stdio: "ignore" }); } catch (e) { missing.push("git"); }
  try { checkExec("which useradd", { stdio: "ignore" }); } catch (e) { missing.push("useradd"); }
  if (missing.length > 0) {
    console.error("[daemon] OS users mode requires missing system packages: " + missing.join(", "));
    console.error("[daemon] Install with:  sudo apt install " + missing.map(function (m) { return m.split(" ")[0]; }).join(" "));
    process.exit(78); // EX_CONFIG
  }
}

// --- TLS ---
var tlsOptions = null;
if (config.tls) {
  // 1. Check builtin cert (shipped with package)
  var builtinKeyPath = path.join(__dirname, "certs", "privkey.pem");
  var builtinCertPath = path.join(__dirname, "certs", "fullchain.pem");

  // 2. User cert (mkcert, etc.)
  var os = require("os");
  var certDir = path.join(process.env.CLAY_HOME || process.env.CLAUDE_RELAY_HOME || path.join(REAL_HOME, ".clay"), "certs");
  var userKeyPath = path.join(certDir, "key.pem");
  var userCertPath = path.join(certDir, "cert.pem");

  var keyPath, certPath;
  if (config.builtinCert !== false && fs.existsSync(builtinKeyPath) && fs.existsSync(builtinCertPath)) {
    keyPath = builtinKeyPath;
    certPath = builtinCertPath;
    config.builtinCert = true;
  } else {
    keyPath = userKeyPath;
    certPath = userCertPath;
  }

  try {
    tlsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  } catch (e) {
    console.error("[daemon] TLS cert not found, falling back to HTTP");
  }
}

var caRoot = null;

// --- Resolve LAN IP for share URL ---
var os2 = require("os");
var lanIp = (function () {
  var ifaces = os2.networkInterfaces();
  for (var addrs of Object.values(ifaces)) {
    for (var i = 0; i < addrs.length; i++) {
      if (addrs[i].family === "IPv4" && !addrs[i].internal && addrs[i].address.startsWith("100.")) return addrs[i].address;
    }
  }
  for (var addrs of Object.values(ifaces)) {
    for (var i = 0; i < addrs.length; i++) {
      if (addrs[i].family === "IPv4" && !addrs[i].internal) return addrs[i].address;
    }
  }
  return null;
})();

// getFilteredRemovedProjects extracted to daemon-projects.js

// --- Create multi-project server ---
var listenHost = config.host || "0.0.0.0";

var relay = createServer({
  tlsOptions: tlsOptions,
  caPath: caRoot,
  builtinCert: config.builtinCert || false,
  pinHash: config.pinHash || null,
  port: config.port,
  debug: config.debug || false,
  dangerouslySkipPermissions: config.dangerouslySkipPermissions || false,
  osUsers: config.osUsers || false,
  lanHost: lanIp ? lanIp + ":" + config.port : null,
  getRemovedProjects: function (userId) { return getFilteredRemovedProjects(config, userId); },
  onAddProject: function (absPath, wsUser) {
    // Check if already registered
    for (var j = 0; j < config.projects.length; j++) {
      if (config.projects[j].path === absPath) {
        return { ok: true, slug: config.projects[j].slug, existing: true };
      }
    }
    var slugs = config.projects.map(function (p) { return p.slug; });
    var slug = generateSlug(absPath, slugs);
    relay.addProject(absPath, slug, null, null, wsUser ? wsUser.id : null);
    var projectEntry = { path: absPath, slug: slug, addedAt: Date.now(), visibility: "private" };
    // The user who adds a project always becomes the owner
    if (wsUser && wsUser.id) {
      projectEntry.ownerId = wsUser.id;
    }
    config.projects.push(projectEntry);
    // Remove from removedProjects if present
    if (config.removedProjects) {
      config.removedProjects = config.removedProjects.filter(function (rp) { return rp.path !== absPath; });
    }
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    console.log("[daemon] Added project (web):", slug, "→", absPath);
    // OS users mode: grant ACL to project owner
    if (config.osUsers) {
      var newProj = config.projects[config.projects.length - 1];
      if (newProj.ownerId) {
        var ownerUser = usersModule.findUserById(newProj.ownerId);
        if (ownerUser && ownerUser.linuxUser) {
          grantProjectAccess(absPath, ownerUser.linuxUser);
        }
      }
    }
    // Discover and register worktrees for the new project
    scanAndRegisterWorktrees(relay, absPath, slug, null, wsUser && wsUser.id && wsUser.role !== "admin" ? wsUser.id : null);
    // Broadcast updated project list to all clients
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true, slug: slug };
  },
  onCreateProject: function (projectName, wsUser) {
    console.log("[daemon] onCreateProject wsUser:", JSON.stringify(wsUser ? { id: wsUser.id, role: wsUser.role, username: wsUser.username, linuxUser: wsUser.linuxUser } : null));
    var os = require("os");
    var { execSync } = require("child_process");
    var baseDir;
    if (config.osUsers) {
      baseDir = "/var/clay/projects";
    } else {
      baseDir = config.projectsDir || path.join(REAL_HOME, "clay-projects");
    }
    try { fs.mkdirSync(baseDir, { recursive: true }); } catch (e) {}
    // Generate slug and deduplicate
    var slugs = config.projects.map(function (p) { return p.slug; });
    var slug = generateSlug(path.join(baseDir, projectName), slugs);
    var targetDir = path.join(baseDir, slug);
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      // Run git init
      if (config.osUsers && wsUser) {
        var linuxUser = wsUser.linuxUser;
        if (linuxUser) {
          var uidGid = null;
          try {
            var passwdLine = execSync("id -u " + linuxUser + " && id -g " + linuxUser, { encoding: "utf8" }).trim().split("\n");
            uidGid = { uid: parseInt(passwdLine[0], 10), gid: parseInt(passwdLine[1], 10) };
          } catch (e) {}
          if (uidGid) {
            fs.chmodSync(targetDir, 0o700);
            execSync("chown -R " + linuxUser + ":" + linuxUser + " " + JSON.stringify(targetDir));
            execSync("git init", { cwd: targetDir, uid: uidGid.uid, gid: uidGid.gid, env: { PATH: "/usr/local/bin:/usr/bin:/bin" } });
          } else {
            execSync("git init", { cwd: targetDir });
          }
        } else {
          execSync("git init", { cwd: targetDir });
        }
      } else {
        execSync("git init", { cwd: targetDir });
      }
    } catch (e) {
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (ce) {}
      return { ok: false, error: "Failed to create project: " + e.message };
    }
    // Register project - creator always becomes owner, default private
    var projectEntry = { path: targetDir, slug: slug, addedAt: Date.now(), visibility: "private" };
    if (wsUser && wsUser.id) {
      projectEntry.ownerId = wsUser.id;
    }
    relay.addProject(targetDir, slug, null, null, wsUser ? wsUser.id : null);
    config.projects.push(projectEntry);
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    console.log("[daemon] Created project:", slug, "→", targetDir, "entry:", JSON.stringify({ ownerId: projectEntry.ownerId, visibility: projectEntry.visibility }));
    // OS users mode: grant ACL
    if (config.osUsers && wsUser && wsUser.linuxUser) {
      console.log("[daemon] Granting ACL:", targetDir, "→", wsUser.linuxUser);
      grantProjectAccess(targetDir, wsUser.linuxUser);
    } else if (config.osUsers) {
      console.log("[daemon] Skipping ACL grant: osUsers=true but linuxUser=", wsUser && wsUser.linuxUser);
    }
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true, slug: slug };
  },
  onCloneProject: function (cloneUrl, wsUser, callback) {
    var os = require("os");
    var { spawn, execSync } = require("child_process");
    var baseDir;
    if (config.osUsers) {
      baseDir = "/var/clay/projects";
    } else {
      baseDir = config.projectsDir || path.join(REAL_HOME, "clay-projects");
    }
    try { fs.mkdirSync(baseDir, { recursive: true }); } catch (e) {}
    // Derive slug from repo URL
    var repoName = cloneUrl.replace(/\.git$/, "").split("/").pop() || "project";
    var slugs = config.projects.map(function (p) { return p.slug; });
    var slug = generateSlug(path.join(baseDir, repoName), slugs);
    var targetDir = path.join(baseDir, slug);
    // Clone as user to use their git credentials
    var spawnOpts = { cwd: baseDir };
    if (config.osUsers && wsUser && wsUser.linuxUser) {
      try {
        var passwdLine = execSync("id -u " + wsUser.linuxUser + " && id -g " + wsUser.linuxUser, { encoding: "utf8" }).trim().split("\n");
        spawnOpts.uid = parseInt(passwdLine[0], 10);
        spawnOpts.gid = parseInt(passwdLine[1], 10);
        spawnOpts.env = Object.assign({}, process.env, {
          HOME: "/home/" + wsUser.linuxUser,
          USER: wsUser.linuxUser
        });
      } catch (e) {}
    }
    // Pre-create target directory as root and chown to user
    if (fs.existsSync(targetDir)) {
      callback({ ok: false, error: "Target directory already exists: " + targetDir });
      return;
    }
    if (config.osUsers && wsUser && wsUser.linuxUser && spawnOpts.uid != null) {
      try {
        fs.mkdirSync(targetDir, { mode: 0o700 });
        fs.chownSync(targetDir, spawnOpts.uid, spawnOpts.gid);
      } catch (e) {
        callback({ ok: false, error: "Failed to prepare project directory: " + e.message });
        return;
      }
    }
    var proc = spawn("git", ["clone", cloneUrl, targetDir], spawnOpts);
    var stderrBuf = "";
    proc.stderr.on("data", function (chunk) { stderrBuf += chunk.toString(); });
    // 5 minute timeout
    var cloneTimeout = setTimeout(function () {
      proc.kill("SIGTERM");
    }, 5 * 60 * 1000);
    proc.on("close", function (code) {
      clearTimeout(cloneTimeout);
      if (code !== 0) {
        try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (ce) {}
        var errMsg = stderrBuf.trim().split("\n").pop() || "Clone failed (exit code " + code + ")";
        callback({ ok: false, error: errMsg });
        return;
      }
      // chown and restrict permissions if osUsers
      if (config.osUsers && wsUser && wsUser.linuxUser) {
        try {
          fs.chmodSync(targetDir, 0o700);
          execSync("chown -R " + wsUser.linuxUser + ":" + wsUser.linuxUser + " " + JSON.stringify(targetDir));
        } catch (e) {}
      }
      // Register project - creator always becomes owner
      // Creator always becomes owner, default private
      var projectEntry = { path: targetDir, slug: slug, addedAt: Date.now(), visibility: "private" };
      if (wsUser && wsUser.id) {
        projectEntry.ownerId = wsUser.id;
      }
      relay.addProject(targetDir, slug);
      config.projects.push(projectEntry);
      saveConfig(config);
      try { syncClayrc(config.projects); } catch (e) {}
      console.log("[daemon] Cloned project:", slug, "→", targetDir);
      if (config.osUsers && wsUser && wsUser.linuxUser) {
        grantProjectAccess(targetDir, wsUser.linuxUser);
      }
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config.projects.length,
      });
      callback({ ok: true, slug: slug });
    });
    proc.on("error", function (err) {
      clearTimeout(cloneTimeout);
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (ce) {}
      callback({ ok: false, error: "Failed to start git clone: " + err.message });
    });
  },
  onRemoveProject: function (slug, userId) {
    // Check if this is a worktree project (ephemeral)
    if (isWorktreeSlug(slug)) {
      var wtParent = slug.split("--")[0];
      var wtDirName = slug.split("--").slice(1).join("--");
      // Find parent project path
      var parentProject = null;
      for (var pi = 0; pi < config.projects.length; pi++) {
        if (config.projects[pi].slug === wtParent) { parentProject = config.projects[pi]; break; }
      }
      if (parentProject) {
        var rmResult = removeWorktree(parentProject.path, wtDirName);
        if (!rmResult.ok) {
          console.log("[daemon] Failed to remove worktree:", slug, rmResult.error);
          return { ok: false, error: rmResult.error };
        }
      }
      relay.removeProject(slug);
      unregisterWorktreeSlug(wtParent, slug);
      console.log("[daemon] Removed worktree (web):", slug);
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config.projects.length,
      });
      return { ok: true };
    }
    var found = null;
    for (var j = 0; j < config.projects.length; j++) {
      if (config.projects[j].slug === slug) { found = config.projects[j]; break; }
    }
    if (!found) return { ok: false, error: "Project not found" };
    // Cascade remove worktrees belonging to this parent
    cleanupWorktreesForParent(relay, slug);
    // Save to removedProjects for re-add functionality
    if (!config.removedProjects) config.removedProjects = [];
    config.removedProjects.push({
      path: found.path,
      title: found.title || null,
      icon: found.icon || null,
      userId: userId || null,
      removedAt: Date.now(),
    });
    // Cap at 20 entries (oldest first)
    if (config.removedProjects.length > 20) {
      config.removedProjects = config.removedProjects.slice(config.removedProjects.length - 20);
    }
    relay.removeProject(slug);
    config.projects = config.projects.filter(function (p) { return p.slug !== slug; });
    saveConfig(config);
    // Remove from .clayrc so it doesn't appear in restore prompt
    if (found.path) { try { removeFromClayrc(found.path); } catch (e) {} }
    try { syncClayrc(config.projects); } catch (e) {}
    console.log("[daemon] Removed project (web):", slug);
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
  },
  onReorderProjects: function (slugs) {
    // Build a slug->project map from current projects
    var projectMap = {};
    for (var j = 0; j < config.projects.length; j++) {
      projectMap[config.projects[j].slug] = config.projects[j];
    }
    // Reorder based on the slugs array
    var reordered = [];
    for (var k = 0; k < slugs.length; k++) {
      if (projectMap[slugs[k]]) {
        reordered.push(projectMap[slugs[k]]);
        delete projectMap[slugs[k]];
      }
    }
    // Append any remaining projects not in slugs (safety)
    var remaining = Object.keys(projectMap);
    for (var m = 0; m < remaining.length; m++) {
      reordered.push(projectMap[remaining[m]]);
    }
    config.projects = reordered;
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    // Also reorder the in-memory Map so getProjects() returns the new order
    relay.reorderProjects(slugs);
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
  },
  onSetProjectTitle: function (slug, newTitle) {
    relay.setProjectTitle(slug, newTitle);
    for (var ti = 0; ti < config.projects.length; ti++) {
      if (config.projects[ti].slug === slug) {
        if (newTitle) {
          config.projects[ti].title = newTitle;
        } else {
          delete config.projects[ti].title;
        }
        break;
      }
    }
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
  },
  onSetProjectIcon: function (slug, newIcon) {
    relay.setProjectIcon(slug, newIcon);
    for (var ii = 0; ii < config.projects.length; ii++) {
      if (config.projects[ii].slug === slug) {
        if (newIcon) {
          config.projects[ii].icon = newIcon;
        } else {
          delete config.projects[ii].icon;
        }
        break;
      }
    }
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
  },
  onProjectOwnerChanged: function (slug, ownerId) {
    console.log("[daemon] onProjectOwnerChanged:", slug, "→", ownerId);
    var oldOwnerId = null;
    var projectIdx = -1;
    for (var oi = 0; oi < config.projects.length; oi++) {
      if (config.projects[oi].slug === slug) {
        oldOwnerId = config.projects[oi].ownerId || null;
        projectIdx = oi;
        if (ownerId) {
          config.projects[oi].ownerId = ownerId;
        } else {
          delete config.projects[oi].ownerId;
        }
        break;
      }
    }
    saveConfig(config);
    // OS users mode: revoke old owner ACL, grant new owner ACL
    if (config.osUsers && projectIdx >= 0) {
      var projectPath = config.projects[projectIdx].path;
      var allowed = config.projects[projectIdx].allowedUsers || [];
      var visibility = config.projects[projectIdx].visibility || "public";
      // Revoke old owner (if not in allowedUsers and project is not public)
      if (oldOwnerId && oldOwnerId !== ownerId) {
        var oldOwner = usersModule.findUserById(oldOwnerId);
        if (oldOwner && oldOwner.linuxUser && allowed.indexOf(oldOwnerId) === -1 && visibility !== "public") {
          revokeProjectAccess(projectPath, oldOwner.linuxUser);
        }
      }
      // Grant new owner
      if (ownerId) {
        var newOwner = usersModule.findUserById(ownerId);
        console.log("[daemon] Owner grant ACL:", ownerId, "linuxUser:", newOwner && newOwner.linuxUser, "path:", projectPath);
        if (newOwner && newOwner.linuxUser) {
          grantProjectAccess(projectPath, newOwner.linuxUser);
        }
      }
    }
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
  },
  onGetProjectEnv: function (slug) {
    for (var ei = 0; ei < config.projects.length; ei++) {
      if (config.projects[ei].slug === slug) {
        return { envrc: config.projects[ei].envrc || "" };
      }
    }
    return { envrc: "" };
  },
  onSetProjectEnv: function (slug, envrc) {
    for (var ei = 0; ei < config.projects.length; ei++) {
      if (config.projects[ei].slug === slug) {
        if (envrc) {
          config.projects[ei].envrc = envrc;
        } else {
          delete config.projects[ei].envrc;
        }
        saveConfig(config);
        return { ok: true };
      }
    }
    return { ok: false, error: "Project not found" };
  },
  onGetSharedEnv: function () {
    return { envrc: config.sharedEnv || "" };
  },
  onSetSharedEnv: function (envrc) {
    if (envrc) {
      config.sharedEnv = envrc;
    } else {
      delete config.sharedEnv;
    }
    saveConfig(config);
    return { ok: true };
  },
  onGetServerDefaultEffort: function () {
    return { effort: config.defaultEffort || null };
  },
  onSetServerDefaultEffort: function (effort) {
    if (effort) {
      config.defaultEffort = effort;
    } else {
      delete config.defaultEffort;
    }
    saveConfig(config);
    return { ok: true };
  },
  onGetProjectDefaultEffort: function (slug) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        return { effort: config.projects[i].defaultEffort || null };
      }
    }
    return { effort: null };
  },
  onSetProjectDefaultEffort: function (slug, effort) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        if (effort) {
          config.projects[i].defaultEffort = effort;
        } else {
          delete config.projects[i].defaultEffort;
        }
        saveConfig(config);
        return { ok: true };
      }
    }
    return { ok: false, error: "Project not found" };
  },
  onGetServerDefaultModel: function () {
    return { model: config.defaultModel || null };
  },
  onSetServerDefaultModel: function (model) {
    if (model) {
      config.defaultModel = model;
    } else {
      delete config.defaultModel;
    }
    saveConfig(config);
    return { ok: true };
  },
  onGetProjectDefaultModel: function (slug) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        return { model: config.projects[i].defaultModel || null };
      }
    }
    return { model: null };
  },
  onSetProjectDefaultModel: function (slug, model) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        if (model) {
          config.projects[i].defaultModel = model;
        } else {
          delete config.projects[i].defaultModel;
        }
        saveConfig(config);
        return { ok: true };
      }
    }
    return { ok: false, error: "Project not found" };
  },
  onGetProjectMcpServers: function (slug) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        return config.projects[i].enabledMcpServers || [];
      }
    }
    return [];
  },
  onSetProjectMcpServers: function (slug, servers) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        if (servers && servers.length > 0) {
          config.projects[i].enabledMcpServers = servers;
        } else {
          delete config.projects[i].enabledMcpServers;
        }
        saveConfig(config);
        return;
      }
    }
  },
  onGetServerDefaultMode: function () {
    return { mode: config.defaultMode || null };
  },
  onSetServerDefaultMode: function (mode) {
    if (mode) {
      config.defaultMode = mode;
    } else {
      delete config.defaultMode;
    }
    saveConfig(config);
    return { ok: true };
  },
  onGetProjectDefaultMode: function (slug) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        return { mode: config.projects[i].defaultMode || null };
      }
    }
    return { mode: null };
  },
  onSetProjectDefaultMode: function (slug, mode) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        if (mode) {
          config.projects[i].defaultMode = mode;
        } else {
          delete config.projects[i].defaultMode;
        }
        saveConfig(config);
        return { ok: true };
      }
    }
    return { ok: false, error: "Project not found" };
  },
  onGetDaemonConfig: function () {
    return {
      port: config.port,
      tls: !!tlsOptions,
      debug: !!config.debug,
      headless: !!config.headless,
      keepAwake: !!config.keepAwake,
      autoContinueOnRateLimit: !!config.autoContinueOnRateLimit,
      chatLayout: config.chatLayout || "channel",
      pinEnabled: !!config.pinHash,
      platform: process.platform,
      hostname: os2.hostname(),
      lanIp: lanIp || null,
      updateChannel: config.updateChannel || "stable",
      imageRetentionDays: config.imageRetentionDays !== undefined ? config.imageRetentionDays : 7,
    };
  },
  onSetImageRetention: function (days) {
    var d = parseInt(days, 10);
    if (isNaN(d) || d < 0) d = 7;
    config.imageRetentionDays = d;
    saveConfig(config);
    console.log("[daemon] Image retention:", d === 0 ? "forever" : d + " days");
    return { ok: true, days: d };
  },
  onSetUpdateChannel: function (channel) {
    config.updateChannel = channel === "beta" ? "beta" : "stable";
    saveConfig(config);
    console.log("[daemon] Update channel:", config.updateChannel, "(web)");
    return { ok: true, updateChannel: config.updateChannel };
  },
  onSetPin: function (pin) {
    if (pin) {
      config.pinHash = generateAuthToken(pin);
    } else {
      config.pinHash = null;
    }
    relay.setAuthToken(config.pinHash);
    saveConfig(config);
    console.log("[daemon] PIN", pin ? "set" : "removed", "(web)");
    return { ok: true, pinEnabled: !!config.pinHash };
  },
  onUpgradePin: function (newHash) {
    config.pinHash = newHash;
    relay.setAuthToken(newHash);
    saveConfig(config);
    console.log("[daemon] PIN hash auto-upgraded to scrypt");
  },
  onSetChatLayout: function (layout) {
    var val = (layout === "bubble") ? "bubble" : "channel";
    config.chatLayout = val;
    saveConfig(config);
    console.log("[daemon] Chat layout:", val, "(web)");
    return { ok: true, chatLayout: val };
  },
  onSetMateOnboarded: function () {
    config.mateOnboardingShown = true;
    saveConfig(config);
    return { ok: true };
  },
  onSetAutoContinue: function (value) {
    var want = !!value;
    config.autoContinueOnRateLimit = want;
    saveConfig(config);
    console.log("[daemon] Auto-continue on rate limit:", want, "(web)");
    return { ok: true, autoContinueOnRateLimit: want };
  },
  onGetToolPalettes: function () {
    return config.toolPalettes || {};
  },
  onSetToolPalette: function (paletteName, order, hidden) {
    if (paletteName !== "session" && paletteName !== "mate") {
      return { error: "Unknown palette" };
    }
    var safeOrder = Array.isArray(order)
      ? order.filter(function (s) { return typeof s === "string"; })
      : [];
    var safeHidden = Array.isArray(hidden)
      ? hidden.filter(function (s) { return typeof s === "string"; })
      : [];
    if (!config.toolPalettes) config.toolPalettes = {};
    config.toolPalettes[paletteName] = { order: safeOrder, hidden: safeHidden };
    saveConfig(config);
    return { ok: true, palette: paletteName, order: safeOrder, hidden: safeHidden };
  },
  onSetKeepAwake: function (value) {
    var want = !!value;
    config.keepAwake = want;
    saveConfig(config);
    if (want && !caffeinateProc && process.platform === "darwin") {
      try {
        var { spawn: spawnCaff } = require("child_process");
        caffeinateProc = spawnCaff("caffeinate", ["-di"], { stdio: "ignore", detached: false });
        caffeinateProc.on("error", function () { caffeinateProc = null; });
      } catch (e) {}
    } else if (!want && caffeinateProc) {
      try { caffeinateProc.kill(); } catch (e) {}
      caffeinateProc = null;
    }
    console.log("[daemon] Keep awake:", want, "(web)");
    return { ok: true, keepAwake: want };
  },
  onShutdown: function () {
    console.log("[daemon] Shutdown requested via web UI");
    gracefulShutdown();
  },
  onRestart: function () {
    console.log("[daemon] Restart requested via web UI");
    spawnAndRestart();
  },
  onSetProjectVisibility: function (slug, visibility) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        var prevVisibility = config.projects[i].visibility || "public";
        config.projects[i].visibility = visibility;
        saveConfig(config);
        console.log("[daemon] Set project visibility:", slug, "→", visibility);
        if (config.osUsers) {
          var projectPath = config.projects[i].path;
          var ownerId = config.projects[i].ownerId || null;
          // When switching to public: grant ACL to ALL clay users
          if (visibility === "public" && prevVisibility !== "public") {
            grantAllUsersAccess(projectPath, usersModule);
          }
          // When switching to private: revoke ACLs for users not in allowedUsers and not the owner
          if (visibility === "private" && prevVisibility !== "private") {
            var allowed = config.projects[i].allowedUsers || [];
            var allUsers = usersModule.getAllUsers();
            for (var u = 0; u < allUsers.length; u++) {
              var usr = allUsers[u];
              if (usr.role === "admin") continue;
              if (usr.id === ownerId) continue;
              if (usr.linuxUser && allowed.indexOf(usr.id) === -1) {
                revokeProjectAccess(projectPath, usr.linuxUser);
              }
            }
          }
        }
        return { ok: true };
      }
    }
    return { error: "Project not found" };
  },
  onSetProjectAllowedUsers: function (slug, allowedUsers) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        var prev = config.projects[i].allowedUsers || [];
        config.projects[i].allowedUsers = allowedUsers;
        saveConfig(config);
        console.log("[daemon] Set project allowed users:", slug, "→", allowedUsers.length, "users");
        // OS users mode: sync ACLs for added/removed users
        if (config.osUsers) {
          var projectPath = config.projects[i].path;
          // Grant access to newly added users
          for (var a = 0; a < allowedUsers.length; a++) {
            if (prev.indexOf(allowedUsers[a]) === -1) {
              var addedUser = usersModule.findUserById(allowedUsers[a]);
              if (addedUser && addedUser.linuxUser) {
                grantProjectAccess(projectPath, addedUser.linuxUser);
              }
            }
          }
          // Revoke access from removed users
          for (var r = 0; r < prev.length; r++) {
            if (allowedUsers.indexOf(prev[r]) === -1) {
              var removedUser = usersModule.findUserById(prev[r]);
              if (removedUser && removedUser.linuxUser) {
                revokeProjectAccess(projectPath, removedUser.linuxUser);
              }
            }
          }
        }
        return { ok: true };
      }
    }
    return { error: "Project not found" };
  },
  onGetProjectAccess: function (slug) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        var isMateProject = slug.indexOf("mate-") === 0;
        return {
          slug: slug,
          visibility: isMateProject ? "private" : (config.projects[i].visibility || (config.osUsers ? "private" : "public")),
          allowedUsers: config.projects[i].allowedUsers || [],
          ownerId: config.projects[i].ownerId || null,
        };
      }
    }
    return { error: "Project not found" };
  },
  onUserProvisioned: function (userId, linuxUser) {
    // Grant ACL on all public projects to the newly provisioned user
    if (!config.osUsers || !linuxUser) return;
    for (var i = 0; i < config.projects.length; i++) {
      var proj = config.projects[i];
      var visibility = proj.visibility || "public";
      if (visibility === "public") {
        grantProjectAccess(proj.path, linuxUser);
      }
    }
  },
  onUserDeleted: function (userId, linuxUser) {
    // Deactivate the Linux account when a Clay user is deleted
    if (!config.osUsers || !linuxUser) return;
    deactivateLinuxUser(linuxUser);
  },
  onCreateWorktree: function (parentSlug, branchName, dirName, baseBranch) {
    // Find the parent project
    var parent = null;
    for (var j = 0; j < config.projects.length; j++) {
      if (config.projects[j].slug === parentSlug) { parent = config.projects[j]; break; }
    }
    if (!parent) return { ok: false, error: "Parent project not found" };
    if (isWorktree(parent.path)) return { ok: false, error: "Cannot create worktrees from a worktree project" };
    var result = createWorktree(parent.path, branchName, dirName, baseBranch);
    if (!result.ok) return result;
    // Register the new worktree as ephemeral project
    var wtSlug = parentSlug + "--" + dirName;
    var wtMeta = { parentSlug: parentSlug, branch: branchName, accessible: true };
    relay.addProject(result.path, wtSlug, branchName, parent.icon, parent.ownerId, wtMeta);
    registerWorktreeSlug(parentSlug, wtSlug);
    console.log("[daemon] Created worktree:", wtSlug, "->", result.path);
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true, slug: wtSlug, path: result.path };
  },
});

// Worktree tracking extracted to daemon-projects.js

// --- Register projects ---
var projects = config.projects || [];
for (var i = 0; i < projects.length; i++) {
  var p = projects[i];
  if (fs.existsSync(p.path)) {
    console.log("[daemon] Adding project:", p.slug, "→", p.path);
    relay.addProject(p.path, p.slug, p.title, p.icon, p.ownerId);
    // Discover and register worktrees for this project
    scanAndRegisterWorktrees(relay, p.path, p.slug, p.icon, p.ownerId);
  } else {
    console.log("[daemon] Skipping missing project:", p.path);
  }
}

// Migrate legacy mates storage before registration
mates.migrateLegacyMates();

// Register existing mates as projects
if (usersModule.isMultiUser()) {
  // Multi-user mode: iterate over all users and load each user's mates
  var allUsers = usersModule.getAllUsers();
  for (var ui = 0; ui < allUsers.length; ui++) {
    var mateCtx = mates.buildMateCtx(allUsers[ui].id);
    var userMates = mates.getAllMates(mateCtx);
    for (var mi = 0; mi < userMates.length; mi++) {
      var m = userMates[mi];
      var mateDir = mates.getMateDir(mateCtx, m.id);
      var mateSlug = "mate-" + m.id;
      var mateName = (m.profile && m.profile.displayName) || m.name || "New Mate";
      if (fs.existsSync(mateDir)) {
        console.log("[daemon] Adding mate project:", mateSlug);
        relay.addProject(mateDir, mateSlug, mateName, null, m.createdBy, null, { isMate: true, mateDisplayName: mateName });
      }
    }
  }
} else {
  // Single-user mode: use null ctx
  var mateCtx = mates.buildMateCtx(null);
  var allMates = mates.getAllMates(mateCtx);
  for (var mi = 0; mi < allMates.length; mi++) {
    var m = allMates[mi];
    var mateDir = mates.getMateDir(mateCtx, m.id);
    var mateSlug = "mate-" + m.id;
    var mateName = (m.profile && m.profile.displayName) || m.name || "New Mate";
    if (fs.existsSync(mateDir)) {
      console.log("[daemon] Adding mate project:", mateSlug);
      relay.addProject(mateDir, mateSlug, mateName, null, m.createdBy, null, { isMate: true, mateDisplayName: mateName });
    }
  }
}

// Sync ~/.clayrc on startup
try { syncClayrc(config.projects); } catch (e) {}

// --- IPC server ---
// Clean up stale socket/config left by a previously killed daemon
var existingConfig = loadConfig();
if (existingConfig && existingConfig.pid && existingConfig.pid !== process.pid) {
  if (!isPidAlive(existingConfig.pid)) {
    console.log("[daemon] Clearing stale config from dead PID " + existingConfig.pid);
    clearStaleConfig();
  }
}
var ipc = createIPCServer(socketPath(), function (msg) {
  console.log("[daemon] IPC:", msg.cmd);
  switch (msg.cmd) {
    case "add_project": {
      if (!msg.path) return { ok: false, error: "missing path" };
      var absPath = path.resolve(msg.path);
      // Check if already registered
      for (var j = 0; j < config.projects.length; j++) {
        if (config.projects[j].path === absPath) {
          return { ok: true, slug: config.projects[j].slug, existing: true };
        }
      }
      var slugs = config.projects.map(function (p) { return p.slug; });
      var slug = generateSlug(absPath, slugs);
      relay.addProject(absPath, slug);
      config.projects.push({ path: absPath, slug: slug, addedAt: Date.now(), visibility: "private" });
      saveConfig(config);
      try { syncClayrc(config.projects); } catch (e) {}
      console.log("[daemon] Added project:", slug, "→", absPath);
      // Discover and register worktrees for the new project
      scanAndRegisterWorktrees(relay, absPath, slug, null, null);
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config.projects.length,
      });
      return { ok: true, slug: slug };
    }

    case "remove_project": {
      if (!msg.path && !msg.slug) return { ok: false, error: "missing path or slug" };
      var target = msg.slug;
      if (!target) {
        var abs = path.resolve(msg.path);
        for (var k = 0; k < config.projects.length; k++) {
          if (config.projects[k].path === abs) {
            target = config.projects[k].slug;
            break;
          }
        }
      }
      if (!target) return { ok: false, error: "project not found" };
      relay.removeProject(target);
      config.projects = config.projects.filter(function (p) { return p.slug !== target; });
      saveConfig(config);
      try { syncClayrc(config.projects); } catch (e) {}
      console.log("[daemon] Removed project:", target);
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config.projects.length,
      });
      return { ok: true };
    }

    case "get_status":
      return {
        ok: true,
        pid: process.pid,
        port: config.port,
        tls: !!tlsOptions,
        keepAwake: !!config.keepAwake,
        osUsers: !!config.osUsers,
        projects: relay.getProjects(),
        uptime: process.uptime(),
      };

    case "set_pin": {
      config.pinHash = msg.pinHash || null;
      relay.setAuthToken(config.pinHash);
      saveConfig(config);
      return { ok: true };
    }

    case "set_project_title": {
      if (!msg.slug) return { ok: false, error: "missing slug" };
      var newTitle = msg.title || null;
      relay.setProjectTitle(msg.slug, newTitle);
      for (var ti = 0; ti < config.projects.length; ti++) {
        if (config.projects[ti].slug === msg.slug) {
          if (newTitle) {
            config.projects[ti].title = newTitle;
          } else {
            delete config.projects[ti].title;
          }
          break;
        }
      }
      saveConfig(config);
      try { syncClayrc(config.projects); } catch (e) {}
      console.log("[daemon] Project title:", msg.slug, "→", newTitle || "(default)");
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config.projects.length,
      });
      return { ok: true };
    }

    case "set_os_users": {
      var enableOsUsers = !!msg.value;
      if (enableOsUsers) {
        // Pre-flight: check if setfacl is available
        var aclCheck = checkAclSupport();
        if (!aclCheck.available) {
          return { error: "acl_not_installed", installCmd: aclCheck.installCmd };
        }
      }
      config.osUsers = enableOsUsers;
      saveConfig(config);
      console.log("[daemon] OS users:", enableOsUsers);
      // Provisioning is handled by CLI (which has terminal access for progress).
      // Daemon only saves the flag. On next restart, daemon will pick it up.
      return { ok: true };
    }

    case "set_auto_continue": {
      var acWant = !!msg.value;
      config.autoContinueOnRateLimit = acWant;
      saveConfig(config);
      console.log("[daemon] Auto-continue on rate limit:", acWant, "(cli)");
      return { ok: true, autoContinueOnRateLimit: acWant };
    }

    case "set_keep_awake": {
      var want = !!msg.value;
      config.keepAwake = want;
      saveConfig(config);
      if (want && !caffeinateProc && process.platform === "darwin") {
        try {
          var { spawn: spawnCaff } = require("child_process");
          caffeinateProc = spawnCaff("caffeinate", ["-di"], { stdio: "ignore", detached: false });
          caffeinateProc.on("error", function () { caffeinateProc = null; });
        } catch (e) {}
      } else if (!want && caffeinateProc) {
        try { caffeinateProc.kill(); } catch (e) {}
        caffeinateProc = null;
      }
      console.log("[daemon] Keep awake:", want);
      return { ok: true };
    }

    case "enable_recovery": {
      if (!msg.urlPath || !msg.password) return { ok: false, error: "missing urlPath or password" };
      relay.setRecovery(msg.urlPath, msg.password);
      console.log("[daemon] Admin recovery mode enabled");
      return { ok: true };
    }

    case "disable_recovery": {
      relay.clearRecovery();
      console.log("[daemon] Admin recovery mode disabled");
      return { ok: true };
    }

    case "shutdown":
      console.log("[daemon] Shutdown requested via IPC");
      gracefulShutdown();
      return { ok: true };

    case "restart":
      console.log("[daemon] Restart requested via IPC");
      spawnAndRestart();
      return { ok: true };

    case "update": {
      if (config.headless) {
        console.log("[daemon] Update & restart requested via IPC — blocked (headless mode)");
        return { ok: false, error: "Auto-update is disabled in headless mode" };
      }
      console.log("[daemon] Update & restart requested via IPC");

      // Dev mode (config.debug): just exit with code 120, cli.js dev watcher respawns daemon
      if (config.debug) {
        console.log("[daemon] Dev mode — restarting via dev watcher");
        updateHandoff = true;
        setTimeout(function () { gracefulShutdown(); }, 100);
        return { ok: true };
      }

      // Production: fetch latest via npx, then spawn updated daemon
      var { execSync: execSyncUpd, spawn: spawnUpd } = require("child_process");
      var updTag = config.updateChannel === "beta" ? "beta" : "latest";
      var updDaemonScript;
      try {
        // npx downloads the package and puts a bin symlink; `which` prints its path
        var binPath = execSyncUpd(
          "npx --yes --package=clay-server@" + updTag + " -- which clay-server",
          { stdio: ["ignore", "pipe", "pipe"], timeout: 120000, encoding: "utf8" }
        ).trim();
        // Resolve symlink to get the actual package directory
        var realBin = fs.realpathSync(binPath);
        updDaemonScript = path.join(path.dirname(realBin), "..", "lib", "daemon.js");
        updDaemonScript = path.resolve(updDaemonScript);
        console.log("[daemon] Resolved updated daemon:", updDaemonScript);
      } catch (updErr) {
        console.log("[daemon] npx resolve failed:", updErr.message);
        // Fallback: restart with current code
        updDaemonScript = path.join(__dirname, "daemon.js");
      }
      // Spawn new daemon process — it will retry if port is still in use
      var { logPath: updLogPath, configPath: updConfigPath } = require("./config");
      var updLogFd = fs.openSync(updLogPath(), "a");
      var updChild = spawnUpd(process.execPath, [updDaemonScript], {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", updLogFd, updLogFd],
        env: Object.assign({}, process.env, {
          CLAY_CONFIG: updConfigPath(),
        }),
      });
      updChild.unref();
      fs.closeSync(updLogFd);
      config.pid = updChild.pid;
      saveConfig(config);
      console.log("[daemon] Spawned new daemon (PID " + updChild.pid + "), shutting down...");
      updateHandoff = true;
      setTimeout(function () { gracefulShutdown(); }, 100);
      return { ok: true };
    }

    default:
      return { ok: false, error: "unknown command: " + msg.cmd };
  }
});

// --- Start listening (with retry for port-in-use during update handoff) ---
var listenRetries = 0;
var MAX_LISTEN_RETRIES = 15;

function startListening() {
  relay.server.listen(config.port, listenHost, function () {
    var protocol = tlsOptions ? "https" : "http";
    console.log("[daemon] Listening on " + protocol + "://" + listenHost + ":" + config.port);
    console.log("[daemon] PID:", process.pid);
    console.log("[daemon] Projects:", config.projects.length);

    // Update PID in config
    config.pid = process.pid;
    saveConfig(config);

    // Auto-provision Linux accounts on startup if OS users mode is enabled.
    // ACLs are NOT re-applied on every startup (too slow with recursive setfacl).
    // ACLs are set when: projects are added, users are added, or visibility changes.
    if (config.osUsers) {
      setTimeout(function () {
        try { ensureProjectsDir(); } catch (e) {}
        try {
          var provResult = provisionAllUsers(usersModule);
          if (provResult.provisioned.length > 0) {
            console.log("[daemon] Auto-provisioned " + provResult.provisioned.length + " Linux account(s) on startup");
            // Only set ACLs for newly provisioned users (not all users on all projects)
            for (var pi = 0; pi < config.projects.length; pi++) {
              var proj = config.projects[pi];
              if ((proj.visibility || "public") === "public") {
                for (var ni = 0; ni < provResult.provisioned.length; ni++) {
                  try {
                    grantProjectAccess(proj.path, provResult.provisioned[ni].linuxUser);
                  } catch (e) {}
                }
              }
            }
          }
          if (provResult.errors.length > 0) {
            console.error("[daemon] Failed to provision " + provResult.errors.length + " account(s)");
          }
        } catch (provErr) {
          console.error("[daemon] Startup provisioning error:", provErr.message);
        }
        console.log("[daemon] Startup OS users check complete.");
      }, 100);
    }

    // Check for crash info from a previous crash and notify clients
    var crashInfo = readCrashInfo();
    if (crashInfo) {
      console.log("[daemon] Recovered from crash at", new Date(crashInfo.time).toISOString());
      console.log("[daemon] Crash reason:", crashInfo.reason);
      // Delay notification so clients have time to reconnect
      setTimeout(function () {
        relay.broadcastAll({
          type: "toast",
          level: "warn",
          message: "Server recovered from a crash and was automatically restarted.",
          detail: crashInfo.reason || null,
        });
      }, 3000);
      clearCrashInfo();
    }
  });
}

relay.server.on("error", function (err) {
  if (err.code === "EADDRINUSE" && listenRetries < MAX_LISTEN_RETRIES) {
    listenRetries++;
    console.log("[daemon] Port " + config.port + " in use, retrying (" + listenRetries + "/" + MAX_LISTEN_RETRIES + ")...");
    setTimeout(startListening, 1000);
    return;
  }
  console.error("[daemon] Server error:", err.message);
  writeCrashInfo({
    reason: "Server error: " + err.message,
    pid: process.pid,
    time: Date.now(),
  });
  process.exit(1);
});

startListening();

// --- HTTP onboarding server (only when TLS is active) ---
if (relay.onboardingServer) {
  var onboardingPort = config.port + 1;
  relay.onboardingServer.on("error", function (err) {
    console.error("[daemon] Onboarding HTTP server error:", err.message);
  });
  relay.onboardingServer.listen(onboardingPort, listenHost, function () {
    console.log("[daemon] Onboarding HTTP on http://" + listenHost + ":" + onboardingPort);
  });
}

// --- Caffeinate (macOS) ---
var caffeinateProc = null;
if (config.keepAwake && process.platform === "darwin") {
  try {
    var { spawn } = require("child_process");
    caffeinateProc = spawn("caffeinate", ["-di"], { stdio: "ignore", detached: false });
    caffeinateProc.on("error", function () { caffeinateProc = null; });
  } catch (e) {}
}

// --- Spawn new daemon and graceful restart ---
function spawnAndRestart() {
  try {
    updateHandoff = true;
    ipc.close();
    relay.destroyAll();
    if (relay.onboardingServer) relay.onboardingServer.close();

    // Close the server first so the port is released before spawning the new daemon
    relay.server.close(function () {
      try {
        var { spawn: spawnRestart } = require("child_process");
        var { logPath: restartLogPath, configPath: restartConfigPath } = require("./config");
        var daemonScript = path.join(__dirname, "daemon.js");
        var logFd = fs.openSync(restartLogPath(), "a");
        var child = spawnRestart(process.execPath, [daemonScript], {
          detached: true,
          windowsHide: true,
          stdio: ["ignore", logFd, logFd],
          env: Object.assign({}, process.env, {
            CLAY_CONFIG: restartConfigPath(),
          }),
        });
        child.unref();
        fs.closeSync(logFd);
        config.pid = child.pid;
        saveConfig(config);
        console.log("[daemon] Spawned new daemon (PID " + child.pid + "), exiting.");
        process.exit(120);
      } catch (e) {
        console.error("[daemon] Restart failed:", e.message);
        process.exit(1);
      }
    });

    // Force exit after 5 seconds if server.close hangs
    setTimeout(function () {
      console.error("[daemon] Forced exit after timeout during restart");
      process.exit(1);
    }, 5000);
  } catch (e) {
    console.error("[daemon] Restart failed:", e.message);
    relay.broadcastAll({ type: "toast", level: "error", message: "Restart failed: " + e.message });
    relay.broadcastAll({ type: "restart_server_result", ok: false, error: e.message });
  }
}

// --- Graceful shutdown ---
var updateHandoff = false; // true when shutting down for update (new daemon already spawned)

function gracefulShutdown() {
  try { console.log("[daemon] Shutting down..."); } catch (e) {}
  var exitCode = updateHandoff ? 120 : 0; // 120 = update handoff, don't auto-restart

  if (caffeinateProc) {
    try { caffeinateProc.kill(); } catch (e) {}
  }

  ipc.close();

  // Remove PID from config (skip if update handoff — new daemon PID is already saved)
  if (!updateHandoff) {
    try {
      var c = loadConfig();
      if (c && c.pid === process.pid) {
        delete c.pid;
        saveConfig(c);
      }
    } catch (e) {}
  }

  relay.destroyAll();

  if (relay.onboardingServer) {
    relay.onboardingServer.close();
  }

  relay.server.close(function () {
    try { console.log("[daemon] Server closed"); } catch (e) {}
    process.exit(exitCode);
  });

  // Force exit after 5 seconds
  setTimeout(function () {
    try { console.error("[daemon] Forced exit after timeout"); } catch (e) {}
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Last-resort cleanup: kill caffeinate if process exits without graceful shutdown
process.on("exit", function () {
  if (caffeinateProc) {
    try { caffeinateProc.kill(); } catch (e) {}
  }
});

// Windows emits SIGHUP when console window closes
if (process.platform === "win32") {
  process.on("SIGHUP", gracefulShutdown);
}

process.on("uncaughtException", function (err) {
  var errMsg = err ? (err.message || String(err)) : "";
  var isAbort = errMsg.indexOf("Operation aborted") !== -1
    || errMsg.indexOf("AbortError") !== -1
    || (err && err.name === "AbortError");

  if (isAbort) {
    // A single session's SDK write was aborted (e.g. stream closed before
    // write completed). This is recoverable, so do NOT tear down the whole
    // daemon and kill every other session.
    try { console.error("[daemon] Suppressed AbortError (single-session failure):", errMsg); } catch (e) {}
    return;
  }

  // EIO/EPIPE on stdout/stderr when parent process (dev mode CLI) dies.
  // Not fatal for the daemon itself.
  var isIOError = errMsg.indexOf("EIO") !== -1 || errMsg.indexOf("EPIPE") !== -1;
  if (isIOError) {
    return;
  }

  console.error("[daemon] Uncaught exception:", err);
  writeCrashInfo({
    reason: err ? (err.stack || err.message || String(err)) : "unknown",
    pid: process.pid,
    time: Date.now(),
  });
  gracefulShutdown();
});

process.on("unhandledRejection", function (reason) {
  var errMsg = reason ? (reason.message || String(reason)) : "";
  var isAbort = errMsg.indexOf("Operation aborted") !== -1
    || errMsg.indexOf("AbortError") !== -1
    || (reason && reason.name === "AbortError");

  if (isAbort) {
    console.error("[daemon] Suppressed unhandled rejection (AbortError):", errMsg);
    return;
  }

  console.error("[daemon] Unhandled rejection:", reason);
});
