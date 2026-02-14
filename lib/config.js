var fs = require("fs");
var path = require("path");
var os = require("os");
var net = require("net");

var CONFIG_DIR = path.join(os.homedir(), ".claude-relay");

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
};
