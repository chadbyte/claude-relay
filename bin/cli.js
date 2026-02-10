#!/usr/bin/env node

const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const qrcode = require("qrcode-terminal");
const { createServer } = require("../lib/server");

const args = process.argv.slice(2);
let port = 2633;
let useHttps = true;
let skipUpdate = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-p" || args[i] === "--port") {
    port = parseInt(args[i + 1], 10);
    if (isNaN(port)) {
      console.error("Invalid port number");
      process.exit(1);
    }
    i++;
  } else if (args[i] === "--no-https") {
    useHttps = false;
  } else if (args[i] === "--no-update" || args[i] === "--skip-update") {
    skipUpdate = true;
  } else if (args[i] === "-h" || args[i] === "--help") {
    console.log("Usage: claude-relay [-p|--port <port>] [--no-https] [--no-update]");
    console.log("");
    console.log("Options:");
    console.log("  -p, --port <port>  Port to listen on (default: 2633)");
    console.log("  --no-https         Disable HTTPS (enabled by default via mkcert)");
    console.log("  --no-update        Skip auto-update check on startup");
    process.exit(0);
  }
}

const cwd = process.cwd();

// --- ANSI helpers ---
var a = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

var sym = {
  pointer: a.cyan + "◆" + a.reset,
  done: a.green + "◇" + a.reset,
  bar: a.dim + "│" + a.reset,
  end: a.dim + "└" + a.reset,
  warn: a.yellow + "▲" + a.reset,
};

function log(s) { console.log("  " + s); }

function clearUp(n) {
  for (var i = 0; i < n; i++) {
    process.stdout.write("\x1b[1A\x1b[2K");
  }
}

// --- Network ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();

  // Prefer Tailscale IP
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (/^(tailscale|utun)/.test(name)) {
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal && addr.address.startsWith("100.")) {
          return addr.address;
        }
      }
    }
  }

  // Check all interfaces for Tailscale CGNAT range (100.64.0.0/10)
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal && addr.address.startsWith("100.")) {
        return addr.address;
      }
    }
  }

  // Fall back to LAN IP
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }

  return "localhost";
}

// --- Caffeinate ---
var caffeinateProc = null;

function startCaffeinate() {
  var { spawn } = require("child_process");
  caffeinateProc = spawn("caffeinate", ["-di"], { stdio: "ignore", detached: false });
  caffeinateProc.on("error", function () { caffeinateProc = null; });
  process.on("exit", function () { if (caffeinateProc) caffeinateProc.kill(); });
}

// --- Certs ---
function ensureCerts(ip) {
  var certDir = path.join(cwd, ".claude-relay", "certs");
  var keyPath = path.join(certDir, "key.pem");
  var certPath = path.join(certDir, "cert.pem");

  var caRoot = null;
  try {
    caRoot = path.join(
      execSync("mkcert -CAROOT", { encoding: "utf8" }).trim(),
      "rootCA.pem"
    );
    if (!fs.existsSync(caRoot)) caRoot = null;
  } catch (e) { }

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: keyPath, cert: certPath, caRoot: caRoot };
  }

  fs.mkdirSync(certDir, { recursive: true });

  var domains = ["localhost", "127.0.0.1", "::1"];
  if (ip && ip !== "localhost") domains.push(ip);

  try {
    execSync(
      "mkcert -key-file " + keyPath + " -cert-file " + certPath + " " + domains.join(" "),
      { stdio: "pipe" }
    );
  } catch (err) {
    return null;
  }

  return { key: keyPath, cert: certPath, caRoot: caRoot };
}

// --- Logo ---
function printLogo() {
  var c = "\x1b[38;2;218;119;86m";
  var r = a.reset;
  var lines = [
    "  ██████╗ ██╗       █████╗  ██╗   ██╗ ██████╗  ███████╗     ██████╗  ███████╗ ██╗       █████╗  ██╗   ██╗",
    " ██╔════╝ ██║      ██╔══██╗ ██║   ██║ ██╔══██╗ ██╔════╝     ██╔══██╗ ██╔════╝ ██║      ██╔══██╗ ╚██╗ ██╔╝",
    " ██║      ██║      ███████║ ██║   ██║ ██║  ██║ █████╗       ██████╔╝ █████╗   ██║      ███████║  ╚████╔╝ ",
    " ██║      ██║      ██╔══██║ ██║   ██║ ██║  ██║ ██╔══╝       ██╔══██╗ ██╔══╝   ██║      ██╔══██║   ╚██╔╝  ",
    " ╚██████╗ ███████╗ ██║  ██║ ╚██████╔╝ ██████╔╝ ███████╗     ██║  ██║ ███████╗ ███████╗ ██║  ██║    ██║   ",
    "  ╚═════╝ ╚══════╝ ╚═╝  ╚═╝  ╚═════╝  ╚═════╝  ╚══════╝     ╚═╝  ╚═╝ ╚══════╝ ╚══════╝ ╚═╝  ╚═╝    ╚═╝   ",
  ];
  console.log("");
  for (var i = 0; i < lines.length; i++) {
    console.log(c + lines[i] + r);
  }
}

// --- Interactive setup (clack-style) ---
function setup(callback) {
  console.clear();
  printLogo();
  log("");
  log(sym.pointer + "  " + a.bold + "Claude Relay" + a.reset + a.dim + "  ·  Unofficial, open-source project" + a.reset);
  log(sym.bar);
  log(sym.bar + "  " + a.dim + "Anyone with the URL gets full Claude Code access to this machine." + a.reset);
  log(sym.bar + "  " + a.dim + "Use a private network (Tailscale, VPN)." + a.reset);
  log(sym.bar + "  " + a.dim + "The authors assume no responsibility for any damage or data loss." + a.reset);
  log(sym.bar);

  promptToggle("Accept and continue", null, true, function (accepted) {
    if (!accepted) {
      log(sym.end + "  " + a.dim + "Aborted." + a.reset);
      log("");
      process.exit(0);
      return;
    }
    log(sym.bar);

    promptPin(function (pin) {
      promptToggle("Keep awake", "Prevent system sleep while relay is running", false, function (keepAwake) {
        log(sym.bar);
        log(sym.end + "  " + a.dim + "Starting relay..." + a.reset);
        log("");

        if (keepAwake) startCaffeinate();
        callback(pin);
      });
    });
  });
}

function promptPin(callback) {
  log(sym.pointer + "  " + a.bold + "PIN protection" + a.reset);
  log(sym.bar + "  " + a.dim + "Require a 6-digit PIN to access the web UI. Enter to skip." + a.reset);
  process.stdout.write("  " + sym.bar + "  ");

  var pin = "";

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", function onPin(ch) {
    if (ch === "\r" || ch === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onPin);
      process.stdout.write("\n");

      if (pin !== "" && !/^\d{6}$/.test(pin)) {
        clearUp(3);
        log(sym.done + "  PIN protection " + a.red + "Must be exactly 6 digits" + a.reset);
        log(sym.end);
        process.exit(1);
        return;
      }

      clearUp(3);
      if (pin) {
        log(sym.done + "  PIN protection " + a.dim + "·" + a.reset + " " + a.green + "Enabled" + a.reset);
      } else {
        log(sym.done + "  PIN protection " + a.dim + "· Skipped" + a.reset);
      }
      log(sym.bar);

      callback(pin || null);
    } else if (ch === "\x03") {
      process.stdout.write("\n");
      clearUp(3);
      log(sym.end + "  " + a.dim + "Cancelled" + a.reset);
      process.exit(0);
    } else if (ch === "\x7f" || ch === "\b") {
      if (pin.length > 0) {
        pin = pin.slice(0, -1);
        process.stdout.write("\b \b");
      }
    } else if (/\d/.test(ch) && pin.length < 6) {
      pin += ch;
      process.stdout.write(a.cyan + "●" + a.reset);
    }
  });
}

function promptToggle(title, desc, defaultValue, callback) {
  var value = defaultValue || false;

  function renderToggle() {
    var yes = value
      ? a.green + a.bold + "● Yes" + a.reset
      : a.dim + "○ Yes" + a.reset;
    var no = !value
      ? a.green + a.bold + "● No" + a.reset
      : a.dim + "○ No" + a.reset;
    return yes + a.dim + " / " + a.reset + no;
  }

  var lines = 2;
  log(sym.pointer + "  " + a.bold + title + a.reset);
  if (desc) {
    log(sym.bar + "  " + a.dim + desc + a.reset);
    lines = 3;
  }
  process.stdout.write("  " + sym.bar + "  " + renderToggle());

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", function onToggle(ch) {
    if (ch === "\x1b[D" || ch === "\x1b[C" || ch === "\t") {
      value = !value;
      process.stdout.write("\x1b[2K\r  " + sym.bar + "  " + renderToggle());
    } else if (ch === "y" || ch === "Y") {
      value = true;
      process.stdout.write("\x1b[2K\r  " + sym.bar + "  " + renderToggle());
    } else if (ch === "n" || ch === "N") {
      value = false;
      process.stdout.write("\x1b[2K\r  " + sym.bar + "  " + renderToggle());
    } else if (ch === "\r" || ch === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onToggle);
      process.stdout.write("\n");

      clearUp(lines);
      var result = value ? a.green + "Yes" + a.reset : a.dim + "No" + a.reset;
      log(sym.done + "  " + title + " " + a.dim + "·" + a.reset + " " + result);

      callback(value);
    } else if (ch === "\x03") {
      process.stdout.write("\n");
      clearUp(lines);
      log(sym.end + "  " + a.dim + "Cancelled" + a.reset);
      process.exit(0);
    }
  });
}

// --- Server start ---
function start(pin) {
  var ip = getLocalIP();
  var tlsOptions = null;
  var caRoot = null;

  if (useHttps) {
    var paths = ensureCerts(ip);
    if (paths) {
      tlsOptions = {
        key: fs.readFileSync(paths.key),
        cert: fs.readFileSync(paths.cert),
      };
      caRoot = paths.caRoot;
    } else {
      log(sym.warn + "  " + a.yellow + "HTTPS unavailable" + a.reset + a.dim + " · mkcert not installed" + a.reset);
      log(sym.bar + "  " + a.dim + "brew install mkcert && mkcert -install" + a.reset);
      log(sym.bar);
    }
  }

  var result = createServer(cwd, tlsOptions, caRoot, pin, port);
  var entryServer = result.entryServer;
  var httpsServer = result.httpsServer;

  entryServer.on("error", function (err) {
    if (err.code === "EADDRINUSE") {
      log(a.red + "Port " + port + " is already in use." + a.reset);
      log(a.dim + "Run: claude-relay -p <port>" + a.reset);
    } else {
      log(a.red + "Server error: " + err.message + a.reset);
    }
    process.exit(1);
  });

  var httpsPort = port + 1;
  if (httpsServer) {
    httpsServer.on("error", function (err) {
      if (err.code === "EADDRINUSE") {
        log(a.red + "HTTPS port " + httpsPort + " is already in use." + a.reset);
      } else {
        log(a.red + "HTTPS error: " + err.message + a.reset);
      }
      process.exit(1);
    });
    httpsServer.listen(httpsPort);
  }

  entryServer.listen(port, function () {
    var project = path.basename(cwd);
    var url = "http://" + ip + ":" + port;

    if (ip !== "localhost") {
      qrcode.generate(url, { small: true }, function (code) {
        var lines = code.split("\n").map(function (l) { return "  " + l; }).join("\n");
        console.log(lines);
        console.log("");
        log(a.bold + "Claude Relay" + a.reset + " running at " + a.bold + url + a.reset);
        log(a.dim + project + " · " + cwd + a.reset);
        log("");
      });
    } else {
      log(a.bold + "Claude Relay" + a.reset + " running at " + a.bold + url + a.reset);
      log(a.dim + project + " · " + cwd + a.reset);
      log("");
    }
  });
}

const { checkAndUpdate } = require("../lib/updater");
const currentVersion = require("../package.json").version;

(async () => {
  const updated = await checkAndUpdate(currentVersion, skipUpdate);
  if (!updated) setup(start);
})();
