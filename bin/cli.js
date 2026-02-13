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
let debugMode = false;

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
  } else if (args[i] === "--debug") {
    debugMode = true;
  } else if (args[i] === "-h" || args[i] === "--help") {
    console.log("Usage: claude-relay [-p|--port <port>] [--no-https] [--no-update] [--debug]");
    console.log("");
    console.log("Options:");
    console.log("  -p, --port <port>  Port to listen on (default: 2633)");
    console.log("  --no-https         Disable HTTPS (enabled by default via mkcert)");
    console.log("  --no-update        Skip auto-update check on startup");
    console.log("  --debug            Enable debug panel in the web UI");
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

// --- Port availability check ---
var net = require("net");

function isPortFree(p) {
  return new Promise(function (resolve) {
    var srv = net.createServer();
    srv.once("error", function () { resolve(false); });
    srv.once("listening", function () { srv.close(function () { resolve(true); }); });
    srv.listen(p);
  });
}

async function findAvailablePort(startPort) {
  var p = startPort;
  var maxAttempts = 20;
  for (var i = 0; i < maxAttempts; i++) {
    var httpFree = await isPortFree(p);
    var httpsFree = await isPortFree(p + 1);
    if (httpFree && httpsFree) return p;
    p += 2;
  }
  return null;
}

// --- Detect tools ---
function getTailscaleIP() {
  var interfaces = os.networkInterfaces();
  for (var name in interfaces) {
    if (/^(tailscale|utun)/.test(name)) {
      for (var i = 0; i < interfaces[name].length; i++) {
        var addr = interfaces[name][i];
        if (addr.family === "IPv4" && !addr.internal && addr.address.startsWith("100.")) {
          return addr.address;
        }
      }
    }
  }
  for (var addrs of Object.values(interfaces)) {
    for (var j = 0; j < addrs.length; j++) {
      if (addrs[j].family === "IPv4" && !addrs[j].internal && addrs[j].address.startsWith("100.")) {
        return addrs[j].address;
      }
    }
  }
  return null;
}

function hasTailscale() {
  return getTailscaleIP() !== null;
}

function hasMkcert() {
  try {
    execSync("mkcert -CAROOT", { stdio: "pipe", encoding: "utf8" });
    return true;
  } catch (e) { return false; }
}

// --- Re-check / back key listener ---
function listenForKey(keys, callback) {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  var handler = function (ch) {
    var lower = ch.toLowerCase();
    if (ch === "\x03") { process.exit(0); return; }
    if (keys[lower]) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", handler);
      keys[lower]();
    }
  };
  process.stdin.on("data", handler);
}

// --- Post-startup setup guide ---
function showSetupGuide(serverIP, httpPort, httpsPort, showMainView) {
  var wantRemote = false;
  var wantPush = false;

  function redraw(renderFn) {
    console.clear();
    printLogo();
    log("");
    log(sym.pointer + "  " + a.bold + "Setup Guide" + a.reset);
    log(sym.bar);
    if (wantRemote) log(sym.done + "  Access from outside your network? " + a.dim + "·" + a.reset + " " + a.green + "Yes" + a.reset);
    else log(sym.done + "  Access from outside your network? " + a.dim + "· No" + a.reset);
    log(sym.bar);
    if (wantPush) log(sym.done + "  Want push notifications? " + a.dim + "·" + a.reset + " " + a.green + "Yes" + a.reset);
    else log(sym.done + "  Want push notifications? " + a.dim + "· No" + a.reset);
    log(sym.bar);
    renderFn();
  }

  log("");
  log(sym.pointer + "  " + a.bold + "Setup Guide" + a.reset);
  log(sym.bar);

  promptToggle("Access from outside your network?", "Requires Tailscale on both devices", false, function (remote) {
    wantRemote = remote;
    log(sym.bar);
    promptToggle("Want push notifications?", "Requires HTTPS (mkcert certificate)", false, function (push) {
      wantPush = push;
      log(sym.bar);
      afterToggles();
    });
  });

  function showSetupQR() {
    var tsIP = getTailscaleIP();
    var setupUrl = "http://" + (tsIP || serverIP) + ":" + httpPort + "/setup";
    log(sym.pointer + "  " + a.bold + "Continue on your device" + a.reset);
    log(sym.bar + "  " + a.dim + "Scan the QR code or open:" + a.reset);
    log(sym.bar + "  " + a.bold + setupUrl + a.reset);
    log(sym.bar);
    qrcode.generate(setupUrl, { small: true }, function (code) {
      var lines = code.split("\n").map(function (l) { return "  " + sym.bar + "  " + l; }).join("\n");
      console.log(lines);
      log(sym.bar);
      log(sym.bar + "  " + a.dim + "Can't connect?" + a.reset);
      if (tsIP) {
        log(sym.bar + "  " + a.dim + "Make sure Tailscale is installed on your phone too." + a.reset);
      } else {
        log(sym.bar + "  " + a.dim + "Your phone must be on the same Wi-Fi network." + a.reset);
      }
      log(sym.bar);
      log(sym.done + "  " + a.dim + "Server setup complete." + a.reset);
      log(sym.end);
      log("");
      listenForBackKey(showMainView);
    });
  }

  function afterToggles() {
    if (!wantRemote && !wantPush) {
      log(sym.done + "  " + a.green + "All set!" + a.reset + a.dim + " · No additional setup needed." + a.reset);
      log(sym.end);
      log("");
      listenForBackKey(showMainView);
      return;
    }
    if (wantRemote) {
      renderTailscale();
    } else {
      renderHttps();
    }
  }

  function renderTailscale() {
    var tsReady = hasTailscale();
    var tsIP = tsReady ? getTailscaleIP() : null;

    log(sym.pointer + "  " + a.bold + "Tailscale Setup" + a.reset);
    if (tsReady && tsIP) {
      log(sym.bar + "  " + a.green + "Tailscale is running" + a.reset + a.dim + " · " + tsIP + a.reset);
      log(sym.bar);
      log(sym.bar + "  On your phone/tablet:");
      log(sym.bar + "  " + a.dim + "1. Install Tailscale (App Store / Google Play)" + a.reset);
      log(sym.bar + "  " + a.dim + "2. Sign in with the same account" + a.reset);
      log(sym.bar);
      renderHttps();
    } else if (tsReady) {
      log(sym.bar + "  " + a.yellow + "Tailscale is installed but no IP found." + a.reset);
      log(sym.bar + "  " + a.dim + "Run: tailscale up" + a.reset);
      log(sym.bar);
      log(sym.bar + "  " + a.dim + "Press " + a.reset + "r" + a.dim + " to re-check, " + a.reset + "h" + a.dim + " to go back." + a.reset);
      log(sym.end);
      log("");
      listenForKey({ r: function () { redraw(renderTailscale); }, h: showMainView });
    } else {
      log(sym.bar + "  " + a.yellow + "Tailscale not found on this machine." + a.reset);
      log(sym.bar + "  " + a.dim + "Install: https://tailscale.com/download" + a.reset);
      log(sym.bar + "  " + a.dim + "Then run: tailscale up" + a.reset);
      log(sym.bar);
      log(sym.bar + "  On your phone/tablet:");
      log(sym.bar + "  " + a.dim + "1. Install Tailscale (App Store / Google Play)" + a.reset);
      log(sym.bar + "  " + a.dim + "2. Sign in with the same account" + a.reset);
      log(sym.bar);
      log(sym.bar + "  " + a.dim + "Press " + a.reset + "r" + a.dim + " to re-check, " + a.reset + "h" + a.dim + " to go back." + a.reset);
      log(sym.end);
      log("");
      listenForKey({ r: function () { redraw(renderTailscale); }, h: showMainView });
    }
  }

  function renderHttps() {
    if (!wantPush) {
      showSetupQR();
      return;
    }

    var mcReady = hasMkcert();
    var tsIP = getTailscaleIP();
    log(sym.pointer + "  " + a.bold + "HTTPS Setup (for push notifications)" + a.reset);
    if (mcReady) {
      log(sym.bar + "  " + a.green + "mkcert is installed" + a.reset);
      log(sym.bar);
      showSetupQR();
    } else {
      log(sym.bar + "  " + a.yellow + "mkcert not found." + a.reset);
      log(sym.bar + "  " + a.dim + "Install: brew install mkcert && mkcert -install" + a.reset);
      log(sym.bar);
      log(sym.bar + "  " + a.dim + "Press " + a.reset + "r" + a.dim + " to re-check, " + a.reset + "h" + a.dim + " to go back." + a.reset);
      log(sym.end);
      log("");
      listenForKey({ r: function () { redraw(renderHttps); }, h: showMainView });
    }
  }
}

function listenForSetupKey(serverIP, httpPort, httpsPort, showMainView) {
  if (!process.stdin.isTTY) return;
  var bc = a.dim;
  var rc = a.reset;
  var msg1 = "Access from your phone or get notified when Claude is done?";
  var msg2 = "Press " + a.cyan + a.bold + "s" + rc + " to set up.";
  var w = msg1.length + 4;
  var pad2 = " ".repeat(msg1.length - 18);
  log(bc + "┌" + "─".repeat(w) + "┐" + rc);
  log(bc + "│  " + rc + msg1 + bc + "  │" + rc);
  log(bc + "│  " + rc + msg2 + pad2 + bc + "  │" + rc);
  log(bc + "└" + "─".repeat(w) + "┘" + rc);
  log("");

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", function onKey(ch) {
    if (ch === "s" || ch === "S") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onKey);
      console.clear();
      printLogo();
      log("");
      showSetupGuide(serverIP, httpPort, httpsPort, showMainView);
    } else if (ch === "\x03") {
      process.exit(0);
    }
  });
}

function listenForBackKey(showMainView) {
  if (!process.stdin.isTTY) return;
  log(a.dim + "Press " + a.reset + "h" + a.dim + " to go back." + a.reset);
  log("");

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", function onBack(ch) {
    if (ch === "h" || ch === "H") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onBack);
      showMainView();
    } else if (ch === "\x03") {
      process.exit(0);
    }
  });
}

// --- Server start ---
async function start(pin) {
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

  var actualPort = await findAvailablePort(port);
  if (actualPort === null) {
    log(a.red + "No available port found (tried " + port + " to " + (port + 38) + ")." + a.reset);
    process.exit(1);
    return;
  }
  if (actualPort !== port) {
    log(sym.warn + "  " + a.yellow + "Port " + port + " in use" + a.reset + a.dim + " · using " + actualPort + a.reset);
    log(sym.bar);
  }
  port = actualPort;

  var result = createServer(cwd, tlsOptions, caRoot, pin, port, debugMode);
  var entryServer = result.entryServer;
  var httpsServer = result.httpsServer;

  entryServer.on("error", function (err) {
    log(a.red + "Server error: " + err.message + a.reset);
    process.exit(1);
  });

  var httpsPort = port + 1;
  if (httpsServer) {
    httpsServer.on("error", function (err) {
      log(a.red + "HTTPS error: " + err.message + a.reset);
      process.exit(1);
    });
    httpsServer.listen(httpsPort);
  }

  var hPort = httpsServer ? httpsPort : null;

  function showMainView() {
    var project = path.basename(cwd);
    var url = "http://" + ip + ":" + port;

    console.clear();
    printLogo();
    log("");

    if (ip !== "localhost") {
      qrcode.generate(url, { small: true }, function (code) {
        var lines = code.split("\n").map(function (l) { return "  " + l; }).join("\n");
        console.log(lines);
        console.log("");
        log(a.bold + "Claude Relay" + a.reset + " running at " + a.bold + url + a.reset);
        log(a.dim + project + " · " + cwd + a.reset);
        log("");
        listenForSetupKey(ip, port, hPort, showMainView);
      });
    } else {
      log(a.bold + "Claude Relay" + a.reset + " running at " + a.bold + url + a.reset);
      log(a.dim + project + " · " + cwd + a.reset);
      log("");
      listenForSetupKey(ip, port, hPort, showMainView);
    }
  }

  entryServer.listen(port, showMainView);
}

const { checkAndUpdate } = require("../lib/updater");
const currentVersion = require("../package.json").version;

(async () => {
  const updated = await checkAndUpdate(currentVersion, skipUpdate);
  if (!updated) setup(start);
})();
