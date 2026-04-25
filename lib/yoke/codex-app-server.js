// Codex App-Server Protocol Client
// ---------------------------------
// Manages a codex app-server child process with bidirectional JSON-RPC
// communication over stdin/stdout. Replaces the SDK exec mode to enable
// interactive approval flows.

var { spawn } = require("child_process");
var readline = require("readline");
var path = require("path");
var { createRequire } = require("module");

// --- Find the codex binary path ---
// Mirrors the logic from @openai/codex-sdk findCodexPath()

var PLATFORM_PACKAGE_BY_TARGET = {
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
};

function getTargetTriple() {
  var arch = process.arch;
  var platform = process.platform;
  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (platform === "linux") {
    return arch === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
  }
  if (platform === "win32") {
    return "x86_64-pc-windows-msvc";
  }
  return null;
}

function findCodexPath() {
  var triple = getTargetTriple();
  if (!triple) throw new Error("Unsupported platform: " + process.platform + "/" + process.arch);

  var platformPkg = PLATFORM_PACKAGE_BY_TARGET[triple];
  if (!platformPkg) throw new Error("No codex binary package for: " + triple);

  try {
    var codexPkgJson = require.resolve("@openai/codex/package.json");
    var codexRequire = createRequire(codexPkgJson);
    var platformPkgJson = codexRequire.resolve(platformPkg + "/package.json");
    var vendorRoot = path.join(path.dirname(platformPkgJson), "vendor");
    var binaryName = process.platform === "win32" ? "codex.exe" : "codex";
    return path.join(vendorRoot, triple, "codex", binaryName);
  } catch (e) {
    throw new Error("Could not find codex binary: " + e.message);
  }
}

// --- Config serialization ---
// Flattens a nested config object into --config key=value pairs.
// Values are serialized as TOML literals (strings quoted, others raw).
// e.g. { mcp_servers: { "clay-tools": { command: "node", args: ["a.js"] } } }
// -> ["mcp_servers.clay-tools.command=\"node\"", "mcp_servers.clay-tools.args=[\"a.js\"]"]

function serializeConfig(obj, prefix) {
  var result = [];
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var val = obj[key];
    var fullKey = prefix ? prefix + "." + key : key;

    if (val === null || val === undefined) continue;

    if (typeof val === "object" && !Array.isArray(val)) {
      // Recurse for nested objects
      var nested = serializeConfig(val, fullKey);
      for (var j = 0; j < nested.length; j++) {
        result.push(nested[j]);
      }
    } else {
      // Leaf value: serialize as TOML
      result.push(fullKey + "=" + toTomlValue(val));
    }
  }
  return result;
}

function toTomlValue(val) {
  if (typeof val === "string") return JSON.stringify(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  if (Array.isArray(val)) return "[" + val.map(function(v) { return toTomlValue(v); }).join(", ") + "]";
  return JSON.stringify(val);
}

// --- CodexAppServer ---

function CodexAppServer(executablePath, opts) {
  this.proc = null;
  this.rl = null;
  this.nextId = 1;
  this.pendingRequests = {};  // id -> { resolve, reject, timer }
  this.eventHandler = null;   // function(notification) for server-initiated events
  this.executablePath = executablePath || findCodexPath();
  this.opts = opts || {};
  this.started = false;
  this._stderrBuf = "";
}

CodexAppServer.prototype.start = function() {
  var self = this;

  return new Promise(function(resolve, reject) {
    try {
      var args = ["app-server"];
      var env = Object.assign({}, process.env, self.opts.env || {});

      // Pass config overrides via --config key=value flags
      if (self.opts.config) {
        var configArgs = serializeConfig(self.opts.config, "");
        for (var ci = 0; ci < configArgs.length; ci++) {
          args.push("--config", configArgs[ci]);
        }
      }

      console.log("[codex-app-server] Spawning:", self.executablePath, args.join(" "));

      self.proc = spawn(self.executablePath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: env,
        cwd: self.opts.cwd || process.cwd(),
      });

      self.proc.on("error", function(err) {
        console.error("[codex-app-server] Process error:", err.message);
        if (!self.started) {
          reject(err);
        }
        self._rejectAllPending(err);
      });

      self.proc.on("exit", function(code, signal) {
        console.log("[codex-app-server] Process exited: code=" + code + " signal=" + signal);
        self.started = false;
        self._rejectAllPending(new Error("Process exited: code=" + code));
      });

      // Collect stderr for debugging
      self.proc.stderr.on("data", function(chunk) {
        var text = chunk.toString();
        self._stderrBuf += text;
        // Print stderr lines as they come
        var lines = self._stderrBuf.split("\n");
        while (lines.length > 1) {
          var line = lines.shift();
          if (line.trim()) console.log("[codex-app-server stderr]", line);
        }
        self._stderrBuf = lines[0] || "";
      });

      // Set up line-based JSON-RPC reading from stdout
      self.rl = readline.createInterface({
        input: self.proc.stdout,
        crlfDelay: Infinity,
      });

      self.rl.on("line", function(line) {
        if (!line.trim()) return;
        try {
          var msg = JSON.parse(line);
          self._handleMessage(msg);
        } catch (e) {
          console.error("[codex-app-server] Failed to parse line:", line.substring(0, 200));
        }
      });

      self.rl.on("close", function() {
        console.log("[codex-app-server] stdout closed");
      });

      self.started = true;
      resolve();
    } catch (e) {
      reject(e);
    }
  });
};

CodexAppServer.prototype._handleMessage = function(msg) {
  // Response to a request we sent
  if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
    var pending = this.pendingRequests[msg.id];
    if (pending) {
      delete this.pendingRequests[msg.id];
      if (pending.timer) clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        pending.resolve(msg.result);
      }
    }
    return;
  }

  // Server-initiated request (has id + method) or notification (has method, no id)
  if (msg.method) {
    if (this.eventHandler) {
      this.eventHandler(msg);
    } else {
      console.log("[codex-app-server] Unhandled event:", msg.method);
    }
  }
};

// Send a JSON-RPC request (expects a response)
CodexAppServer.prototype.send = function(method, params, timeoutMs) {
  var self = this;
  var id = this.nextId++;
  timeoutMs = timeoutMs || 30000;

  return new Promise(function(resolve, reject) {
    if (!self.proc || !self.started) {
      return reject(new Error("App-server not started"));
    }

    var timer = setTimeout(function() {
      delete self.pendingRequests[id];
      reject(new Error("Request timeout: " + method + " (id=" + id + ")"));
    }, timeoutMs);

    self.pendingRequests[id] = { resolve: resolve, reject: reject, timer: timer };

    var msg = { jsonrpc: "2.0", id: id, method: method };
    if (params !== undefined) msg.params = params;

    self._write(msg);
  });
};

// Send a JSON-RPC notification (no response expected)
CodexAppServer.prototype.notify = function(method, params) {
  if (!this.proc || !this.started) return;

  var msg = { jsonrpc: "2.0", method: method };
  if (params !== undefined) msg.params = params;

  this._write(msg);
};

// Respond to a server-initiated request
CodexAppServer.prototype.respond = function(id, result) {
  if (!this.proc || !this.started) return;

  var msg = { jsonrpc: "2.0", id: id, result: result };
  this._write(msg);
};

// Respond with an error to a server-initiated request
CodexAppServer.prototype.respondError = function(id, code, message) {
  if (!this.proc || !this.started) return;

  var msg = { jsonrpc: "2.0", id: id, error: { code: code || -1, message: message || "Error" } };
  this._write(msg);
};

CodexAppServer.prototype._write = function(msg) {
  if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) return;
  try {
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  } catch (e) {
    console.error("[codex-app-server] Write error:", e.message);
  }
};

CodexAppServer.prototype._rejectAllPending = function(err) {
  var ids = Object.keys(this.pendingRequests);
  for (var i = 0; i < ids.length; i++) {
    var pending = this.pendingRequests[ids[i]];
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(err);
  }
  this.pendingRequests = {};
};

CodexAppServer.prototype.stop = function() {
  this.started = false;
  this._rejectAllPending(new Error("Stopped"));

  if (this.rl) {
    this.rl.close();
    this.rl = null;
  }

  if (this.proc) {
    try {
      this.proc.stdin.end();
    } catch (e) {}
    try {
      this.proc.kill("SIGTERM");
    } catch (e) {}
    this.proc = null;
  }
};

module.exports = {
  CodexAppServer: CodexAppServer,
  findCodexPath: findCodexPath,
};
