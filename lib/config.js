var fs = require("fs");
var path = require("path");
var os = require("os");
var net = require("net");

var CONFIG_DIR = path.join(os.homedir(), ".claude-relay");
var CLAYRC_PATH = path.join(os.homedir(), ".clayrc");

function configPath() {
  return path.join(CONFIG_DIR, "daemon.json");
}

function socketPath() {
  return path.join(CONFIG_DIR, "daemon.sock");
}

function logPath() {
  return path.join(CONFIG_DIR, "daemon.log");
}

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function loadConfig() {
  try {
    var data = fs.readFileSync(configPath(), "utf8");
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function saveConfig(config) {
  ensureConfigDir();
  var tmpPath = configPath() + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
  fs.renameSync(tmpPath, configPath());
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function isDaemonAlive(config) {
  if (!config || !config.pid) return false;
  if (!isPidAlive(config.pid)) return false;
  // Also check socket exists
  try {
    fs.statSync(socketPath());
    return true;
  } catch (e) {
    return false;
  }
}

function isDaemonAliveAsync(config) {
  return new Promise(function (resolve) {
    if (!config || !config.pid) return resolve(false);
    if (!isPidAlive(config.pid)) return resolve(false);

    var sock = socketPath();
    var client = net.connect(sock);
    var timer = setTimeout(function () {
      client.destroy();
      resolve(false);
    }, 1000);

    client.on("connect", function () {
      clearTimeout(timer);
      client.destroy();
      resolve(true);
    });
    client.on("error", function () {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function generateSlug(projectPath, existingSlugs) {
  var base = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!base) base = "project";
  if (!existingSlugs || existingSlugs.indexOf(base) === -1) return base;
  for (var i = 2; i < 100; i++) {
    var candidate = base + "-" + i;
    if (existingSlugs.indexOf(candidate) === -1) return candidate;
  }
  return base + "-" + Date.now();
}

function clearStaleConfig() {
  try { fs.unlinkSync(configPath()); } catch (e) {}
  try { fs.unlinkSync(socketPath()); } catch (e) {}
}

// --- ~/.clayrc (recent projects persistence) ---

function clayrcPath() {
  return CLAYRC_PATH;
}

function loadClayrc() {
  try {
    var data = fs.readFileSync(CLAYRC_PATH, "utf8");
    return JSON.parse(data);
  } catch (e) {
    return { recentProjects: [] };
  }
}

function saveClayrc(rc) {
  var tmpPath = CLAYRC_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(rc, null, 2) + "\n");
  fs.renameSync(tmpPath, CLAYRC_PATH);
}

/**
 * Update ~/.clayrc with the current project list from daemon config.
 * Merges with existing entries (preserves addedAt, updates lastUsed).
 */
function syncClayrc(projects) {
  var rc = loadClayrc();
  var existing = rc.recentProjects || [];

  // Build a map by path for quick lookup
  var byPath = {};
  for (var i = 0; i < existing.length; i++) {
    byPath[existing[i].path] = existing[i];
  }

  // Update/add current projects
  for (var j = 0; j < projects.length; j++) {
    var p = projects[j];
    if (byPath[p.path]) {
      // Update existing entry
      byPath[p.path].slug = p.slug;
      byPath[p.path].lastUsed = Date.now();
      if (p.title) byPath[p.path].title = p.title;
      else delete byPath[p.path].title;
    } else {
      // New entry
      byPath[p.path] = {
        path: p.path,
        slug: p.slug,
        title: p.title || undefined,
        addedAt: p.addedAt || Date.now(),
        lastUsed: Date.now(),
      };
    }
  }

  // Rebuild array, sorted by lastUsed descending
  var all = Object.keys(byPath).map(function (k) { return byPath[k]; });
  all.sort(function (a, b) { return (b.lastUsed || 0) - (a.lastUsed || 0); });

  // Keep at most 20 recent projects
  rc.recentProjects = all.slice(0, 20);
  saveClayrc(rc);
}

module.exports = {
  CONFIG_DIR: CONFIG_DIR,
  configPath: configPath,
  socketPath: socketPath,
  logPath: logPath,
  ensureConfigDir: ensureConfigDir,
  loadConfig: loadConfig,
  saveConfig: saveConfig,
  isPidAlive: isPidAlive,
  isDaemonAlive: isDaemonAlive,
  isDaemonAliveAsync: isDaemonAliveAsync,
  generateSlug: generateSlug,
  clearStaleConfig: clearStaleConfig,
  clayrcPath: clayrcPath,
  loadClayrc: loadClayrc,
  saveClayrc: saveClayrc,
  syncClayrc: syncClayrc,
};
