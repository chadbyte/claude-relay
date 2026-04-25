// mcp-local.js - Local MCP process manager
// Spawns and manages MCP stdio processes directly on the Clay server machine.
// Used when the client connects from localhost (no Native Host needed).

var child_process = require("child_process");
var fs = require("fs");
var path = require("path");
var os = require("os");

var CLAY_CONFIG_PATH = path.join(os.homedir(), ".clay", "mcp.json");

function createLocalMcp() {
  var _configCache = {};    // name -> { command, args, env, url }
  var _processes = {};      // name -> { proc, buffer, ready, tools, pendingInit }
  var _pendingRequests = {}; // rpcId -> { callId, resolve, reject, timer }
  var _initCallbacks = {};  // rpcId -> { name, phase }
  var _jsonRpcId = 1;
  var _initialized = false;
  var _onServersReady = null; // callback when server list changes

  // ---------- Config ----------

  function ensureConfig() {
    var dir = path.dirname(CLAY_CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(CLAY_CONFIG_PATH)) {
      fs.writeFileSync(CLAY_CONFIG_PATH, JSON.stringify({ mcpServers: {}, include: [] }, null, 2));
    }
  }

  function readConfig() {
    ensureConfig();
    try {
      return JSON.parse(fs.readFileSync(CLAY_CONFIG_PATH, "utf8"));
    } catch (e) {
      return { mcpServers: {}, include: [] };
    }
  }

  function writeConfig(config) {
    ensureConfig();
    fs.writeFileSync(CLAY_CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  function getMergedServers() {
    var config = readConfig();
    var merged = Object.assign({}, config.mcpServers || {});

    var includes = config.include || [];
    for (var i = 0; i < includes.length; i++) {
      var resolved = includes[i].replace(/^~/, os.homedir());
      try {
        var ext = JSON.parse(fs.readFileSync(resolved, "utf8"));
        var extServers = ext.mcpServers || {};
        var names = Object.keys(extServers);
        for (var j = 0; j < names.length; j++) {
          if (!merged[names[j]]) merged[names[j]] = extServers[names[j]];
        }
      } catch (e) {
        // Skip unreadable files
      }
    }

    _configCache = merged;
    return merged;
  }

  // ---------- Process Spawning ----------

  function spawnServer(name) {
    if (_processes[name]) return;
    var cfg = _configCache[name];
    if (!cfg || cfg.url || !cfg.command) return;

    var env = Object.assign({}, process.env, cfg.env || {});
    var proc;
    try {
      proc = child_process.spawn(cfg.command, cfg.args || [], {
        env: env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      return;
    }

    var entry = {
      proc: proc,
      buffer: "",
      ready: false,
      tools: [],
    };
    _processes[name] = entry;

    proc.stdout.on("data", function (chunk) {
      entry.buffer += chunk.toString("utf8");
      drainJsonRpc(name, entry);
    });

    proc.stderr.on("data", function () {
      // Ignore stderr
    });

    proc.on("error", function () {
      delete _processes[name];
    });

    proc.on("exit", function () {
      delete _processes[name];
    });

    // MCP initialize handshake
    var initId = _jsonRpcId++;
    _initCallbacks[initId] = { name: name, phase: "initialize" };
    proc.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "clay-mcp-local", version: "1.0.0" },
      },
    }) + "\n");
  }

  function killServer(name) {
    var entry = _processes[name];
    if (!entry) return;
    entry.proc.kill("SIGTERM");
    setTimeout(function () {
      if (entry.proc && !entry.proc.killed) entry.proc.kill("SIGKILL");
    }, 3000);
    delete _processes[name];
  }

  // ---------- JSON-RPC Parser ----------

  function drainJsonRpc(name, entry) {
    var lines = entry.buffer.split("\n");
    entry.buffer = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        var msg = JSON.parse(line);
        handleMcpResponse(name, msg);
      } catch (e) {
        // Skip unparseable
      }
    }
  }

  function handleMcpResponse(name, msg) {
    // Init handshake responses
    if (msg.id !== undefined && _initCallbacks[msg.id]) {
      var cb = _initCallbacks[msg.id];
      delete _initCallbacks[msg.id];

      if (cb.phase === "initialize") {
        var entry = _processes[name];
        if (entry) {
          // Send initialized notification
          entry.proc.stdin.write(JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }) + "\n");

          // Request tools/list
          var toolsId = _jsonRpcId++;
          _initCallbacks[toolsId] = { name: name, phase: "tools_list" };
          entry.proc.stdin.write(JSON.stringify({
            jsonrpc: "2.0",
            id: toolsId,
            method: "tools/list",
            params: {},
          }) + "\n");
        }
        return;
      }

      if (cb.phase === "tools_list") {
        var tools = (msg.result && msg.result.tools) || [];
        var entry2 = _processes[name];
        if (entry2) {
          entry2.tools = tools;
          entry2.ready = true;
        }
        if (_onServersReady) _onServersReady();
        return;
      }
    }

    // Tool call responses
    if (msg.id !== undefined && _pendingRequests[msg.id]) {
      var req = _pendingRequests[msg.id];
      delete _pendingRequests[msg.id];
      if (req.timer) clearTimeout(req.timer);

      if (msg.error) {
        req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        req.resolve(msg.result);
      }
      return;
    }
  }

  // ---------- Tool Call Relay ----------

  function callTool(serverName, toolName, args) {
    return new Promise(function (resolve, reject) {
      var entry = _processes[serverName];
      if (!entry || !entry.ready) {
        reject(new Error("MCP server not running: " + serverName));
        return;
      }

      var rpcId = _jsonRpcId++;
      _pendingRequests[rpcId] = {
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function () {
          delete _pendingRequests[rpcId];
          reject(new Error("Tool call timed out after 30s"));
        }, 30000),
      };

      entry.proc.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: "tools/call",
        params: { name: toolName, arguments: args || {} },
      }) + "\n");
    });
  }

  // ---------- Public API ----------

  function initialize(onReady) {
    if (_initialized) return;
    _initialized = true;
    _onServersReady = onReady || null;

    getMergedServers();
    var names = Object.keys(_configCache);
    for (var i = 0; i < names.length; i++) {
      spawnServer(names[i]);
    }
  }

  function shutdown() {
    var names = Object.keys(_processes);
    for (var i = 0; i < names.length; i++) {
      killServer(names[i]);
    }
    _processes = {};
    _initialized = false;
  }

  function getAvailableServers() {
    var servers = [];
    var names = Object.keys(_configCache);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var cfg = _configCache[name];
      var entry = _processes[name];
      servers.push({
        name: name,
        transport: cfg.url ? "http" : "stdio",
        ready: !!(entry && entry.ready),
        tools: entry ? entry.tools : [],
        toolCount: entry ? entry.tools.length : 0,
        source: "local",
      });
    }
    return servers;
  }

  function isReady() {
    return _initialized;
  }

  function addServer(name, command, args, env) {
    var config = readConfig();
    config.mcpServers = config.mcpServers || {};
    config.mcpServers[name] = { command: command, args: args || [], env: env || {} };
    writeConfig(config);
    _configCache[name] = config.mcpServers[name];
    spawnServer(name);
  }

  function removeServer(name) {
    var config = readConfig();
    if (config.mcpServers && config.mcpServers[name]) {
      delete config.mcpServers[name];
      writeConfig(config);
    }
    killServer(name);
    delete _configCache[name];
  }

  function addImport(filePath) {
    var resolved = filePath.replace(/^~/, os.homedir());
    try {
      var ext = JSON.parse(fs.readFileSync(resolved, "utf8"));
      var count = Object.keys(ext.mcpServers || {}).length;
      if (count === 0) return { error: "No mcpServers found in " + filePath };
    } catch (e) {
      return { error: "Cannot read file: " + e.message };
    }

    var config = readConfig();
    config.include = config.include || [];
    if (config.include.indexOf(filePath) === -1) {
      config.include.push(filePath);
      writeConfig(config);
    }

    // Re-merge and spawn new servers
    getMergedServers();
    var names = Object.keys(_configCache);
    for (var i = 0; i < names.length; i++) {
      if (!_processes[names[i]]) spawnServer(names[i]);
    }

    return { ok: true, count: count };
  }

  function removeImport(filePath) {
    var config = readConfig();
    config.include = (config.include || []).filter(function (p) { return p !== filePath; });
    writeConfig(config);
  }

  function getImports() {
    var config = readConfig();
    return config.include || [];
  }

  return {
    initialize: initialize,
    shutdown: shutdown,
    callTool: callTool,
    getAvailableServers: getAvailableServers,
    isReady: isReady,
    addServer: addServer,
    removeServer: removeServer,
    addImport: addImport,
    removeImport: removeImport,
    getImports: getImports,
  };
}

// Standalone config reader (no process spawning).
// Returns merged server definitions from ~/.clay/mcp.json + includes.
// Used by Codex adapter to pass server configs for native MCP management.
function readMergedServers() {
  var dir = path.dirname(CLAY_CONFIG_PATH);
  if (!fs.existsSync(dir)) return {};
  var config;
  try {
    config = JSON.parse(fs.readFileSync(CLAY_CONFIG_PATH, "utf8"));
  } catch (e) {
    return {};
  }
  var merged = Object.assign({}, config.mcpServers || {});
  var includes = config.include || [];
  for (var i = 0; i < includes.length; i++) {
    var resolved = includes[i].replace(/^~/, os.homedir());
    try {
      var ext = JSON.parse(fs.readFileSync(resolved, "utf8"));
      var extServers = ext.mcpServers || {};
      var names = Object.keys(extServers);
      for (var j = 0; j < names.length; j++) {
        if (!merged[names[j]]) merged[names[j]] = extServers[names[j]];
      }
    } catch (e) {
      // Skip unreadable files
    }
  }
  return merged;
}

module.exports = { createLocalMcp: createLocalMcp, readMergedServers: readMergedServers };
