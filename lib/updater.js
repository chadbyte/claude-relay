const https = require("https");
const { execSync, spawn } = require("child_process");

// ANSI helpers (mirrors cli.js)
var isBasicTerm = process.env.TERM_PROGRAM === "Apple_Terminal";
var a = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  clay: isBasicTerm ? "\x1b[34m" : "\x1b[38;2;88;87;252m",   // #5857FC Indigo — active interaction
  green: "\x1b[32m",
  yellow: "\x1b[33m",
};

var sym = {
  pointer: a.clay + "\u25C6" + a.reset,
  done: a.green + "\u25C7" + a.reset,
  bar: a.dim + "\u2502" + a.reset,
  warn: a.yellow + "\u25B2" + a.reset,
};

function log(s) { console.log("  " + s); }

function fetchVersion(channel) {
  var tag = channel === "beta" ? "beta" : "latest";
  return new Promise(function (resolve) {
    var req = https.get("https://registry.npmjs.org/clay-server/" + tag, function (res) {
      var data = "";
      res.on("data", function (chunk) { data += chunk; });
      res.on("end", function () {
        try {
          resolve(JSON.parse(data).version || null);
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on("error", function () { resolve(null); });
    req.setTimeout(3000, function () {
      req.destroy();
      resolve(null);
    });
  });
}

function fetchLatestVersion() {
  return fetchVersion("stable");
}

function parseVersion(v) {
  var dashIdx = v.indexOf("-");
  var base = dashIdx === -1 ? v : v.substring(0, dashIdx);
  var pre = dashIdx === -1 ? null : v.substring(dashIdx + 1);
  var parts = base.split(".").map(Number);
  var preNum = null;
  if (pre) {
    var m = pre.match(/\.(\d+)$/);
    preNum = m ? parseInt(m[1], 10) : 0;
  }
  return { parts: parts, pre: pre, preNum: preNum };
}

function isNewer(latest, current) {
  if (!latest || !current) return false;
  var l = parseVersion(latest);
  var c = parseVersion(current);
  // Compare base version (major.minor.patch)
  for (var i = 0; i < 3; i++) {
    var lv = l.parts[i] || 0;
    var cv = c.parts[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  // Bases are equal: stable (no pre-release) beats pre-release
  if (!l.pre && c.pre) return true;
  if (l.pre && !c.pre) return false;
  // Both pre-release with same base: compare pre-release number
  if (l.pre && c.pre) {
    return l.preNum > c.preNum;
  }
  return false;
}

function performUpdate(channel) {
  var tag = channel === "beta" ? "beta" : "latest";
  try {
    execSync("npm install -g clay-server@" + tag, { stdio: "pipe" });
    return true;
  } catch (e) {
    return false;
  }
}

function reExec() {
  var args = process.argv.slice(1).concat("--no-update");
  var child = spawn(process.execPath, args, { stdio: "inherit" });
  child.on("exit", function (code) {
    process.exit(code);
  });
}

async function checkAndUpdate(currentVersion, skipUpdate) {
  if (skipUpdate) return false;

  var latest = await fetchLatestVersion();
  if (!latest || !isNewer(latest, currentVersion)) return false;

  log(sym.pointer + "  " + a.bold + "Update available" + a.reset + "  " + a.dim + currentVersion + " -> " + latest + a.reset);
  log(sym.bar + "  Installing...");

  if (performUpdate()) {
    log(sym.done + "  Updated to " + a.green + latest + a.reset);
    log("");
    reExec();
    return true;
  }

  log(sym.warn + "  " + a.yellow + "Update failed" + a.reset + a.dim + " (permission denied?)" + a.reset);
  log(sym.bar + "  " + a.dim + "Run manually: npm install -g clay-server@latest" + a.reset);
  log("");
  return false;
}

module.exports = { checkAndUpdate, fetchLatestVersion, fetchVersion, isNewer };
