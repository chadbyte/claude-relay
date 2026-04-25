#!/usr/bin/env node
// Clay MCP Bridge - Native Messaging Host
// Communicates with the Clay Chrome Extension via Chrome Native Messaging protocol.
// Spawns and manages local MCP server processes, relays JSON-RPC messages.

var child_process = require("child_process");
var fs = require("fs");
var path = require("path");
var os = require("os");

// ---------- Native Messaging I/O ----------

var _inputBuffer = Buffer.alloc(0);

function sendMessage(obj) {
  var json = JSON.stringify(obj);
  var buf = Buffer.from(json, "utf8");
  var header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

process.stdin.on("readable", function () {
  var chunk;
  while ((chunk = process.stdin.read()) !== null) {
    _inputBuffer = Buffer.concat([_inputBuffer, chunk]);
    drainInput();
  }
});

function drainInput() {
  while (_inputBuffer.length >= 4) {
    var msgLen = _inputBuffer.readUInt32LE(0);
    if (_inputBuffer.length < 4 + msgLen) break;
    var json = _inputBuffer.slice(4, 4 + msgLen).toString("utf8");
    _inputBuffer = _inputBuffer.slice(4 + msgLen);
    try {
      var msg = JSON.parse(json);
      handleMessage(msg);
    } catch (e) {
      sendMessage({ type: "error", error: "Invalid JSON: " + e.message });
    }
  }
}

process.stdin.on("end", function () {
  // Extension disconnected, clean up all processes
  shutdown();
});

// ---------- MCP Process Manager ----------

var _processes = {}; // name -> { proc, buffer, ready, tools, pendingInit }
var _configCache = null; // parsed config
var _pendingRequests = {}; // callId -> { name, timer }
var _jsonRpcId = 1;
var _initCallbacks = {}; // jsonRpcId -> { name, resolve }

function readConfig(configPath) {
  var resolved = configPath.replace(/^~/, os.homedir());
  try {
    var raw = fs.readFileSync(resolved, "utf8");
    var parsed = JSON.parse(raw);
    _configCache = parsed.mcpServers || {};
    var servers = [];
    var names = Object.keys(_configCache);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var cfg = _configCache[name];
      servers.push({
        name: name,
        transport: cfg.url ? "http" : "stdio",
        command: cfg.command || null,
        url: cfg.url || null,
      });
    }
    return { servers: servers };
  } catch (e) {
    return { error: e.message };
  }
}

function spawnServer(name) {
  if (_processes[name]) {
    return { error: "Server already running: " + name };
  }
  if (!_configCache || !_configCache[name]) {
    return { error: "Server not found in config: " + name };
  }
  var cfg = _configCache[name];
  if (cfg.url) {
    return { error: "HTTP servers do not need spawning: " + name };
  }
  if (!cfg.command) {
    return { error: "No command configured for: " + name };
  }

  // Ensure PATH includes common Node.js binary locations
  // (Chrome launches native hosts with a minimal PATH)
  var nodeBinDir = path.dirname(process.execPath);
  var extraPaths = [
    nodeBinDir,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    path.join(os.homedir(), ".nvm/versions/node", process.version, "bin"),
  ];
  var currentPath = process.env.PATH || "";
  var fullPath = extraPaths.concat(currentPath.split(path.delimiter)).filter(Boolean);
  var seen = {};
  var dedupedPath = [];
  for (var pi = 0; pi < fullPath.length; pi++) {
    if (!seen[fullPath[pi]]) { seen[fullPath[pi]] = true; dedupedPath.push(fullPath[pi]); }
  }

  var env = Object.assign({}, process.env, cfg.env || {}, { PATH: dedupedPath.join(path.delimiter) });
  var proc;
  try {
    proc = child_process.spawn(cfg.command, cfg.args || [], {
      env: env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (e) {
    return { error: "Failed to spawn: " + e.message };
  }

  var entry = {
    proc: proc,
    buffer: "",
    ready: false,
    tools: [],
    pendingInit: null,
  };
  _processes[name] = entry;

  proc.stdout.on("data", function (chunk) {
    entry.buffer += chunk.toString("utf8");
    drainJsonRpc(name, entry);
  });

  proc.stderr.on("data", function (chunk) {
    sendMessage({ type: "server_log", server: name, log: chunk.toString("utf8") });
  });

  proc.on("error", function (err) {
    sendMessage({ type: "server_status", server: name, status: "error", error: err.message });
    delete _processes[name];
  });

  proc.on("exit", function (code, signal) {
    sendMessage({ type: "server_status", server: name, status: "exited", code: code, signal: signal });
    delete _processes[name];
  });

  // Send initialize
  var initId = _jsonRpcId++;
  var initMsg = JSON.stringify({
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "clay-mcp-bridge", version: "1.0.0" },
    },
  }) + "\n";
  proc.stdin.write(initMsg);

  _initCallbacks[initId] = { name: name, phase: "initialize" };

  return { ok: true };
}

function killServer(name) {
  var entry = _processes[name];
  if (!entry) return { error: "Server not running: " + name };
  entry.proc.kill("SIGTERM");
  setTimeout(function () {
    if (entry.proc && !entry.proc.killed) entry.proc.kill("SIGKILL");
  }, 3000);
  delete _processes[name];
  return { ok: true };
}

function drainJsonRpc(name, entry) {
  // MCP uses newline-delimited JSON-RPC
  var lines = entry.buffer.split("\n");
  entry.buffer = lines.pop(); // keep incomplete line
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    try {
      var msg = JSON.parse(line);
      handleMcpResponse(name, msg);
    } catch (e) {
      // skip unparseable lines
    }
  }
}

function handleMcpResponse(name, msg) {
  // Check if this is a response to our initialize or tools/list call
  if (msg.id !== undefined && _initCallbacks[msg.id]) {
    var cb = _initCallbacks[msg.id];
    delete _initCallbacks[msg.id];

    if (cb.phase === "initialize") {
      // Send initialized notification
      var entry = _processes[name];
      if (entry) {
        entry.proc.stdin.write(JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }) + "\n");

        // Now request tools/list
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
      sendMessage({
        type: "server_ready",
        server: name,
        tools: tools,
      });
      return;
    }
  }

  // Regular tool call response: forward to extension
  if (msg.id !== undefined && _pendingRequests[msg.id]) {
    var req = _pendingRequests[msg.id];
    delete _pendingRequests[msg.id];
    if (req.timer) clearTimeout(req.timer);

    if (msg.error) {
      sendMessage({
        type: "mcp_response",
        callId: req.callId,
        error: msg.error.message || JSON.stringify(msg.error),
      });
    } else {
      sendMessage({
        type: "mcp_response",
        callId: req.callId,
        result: msg.result,
      });
    }
    return;
  }

  // Notifications from MCP server (e.g. progress, log)
  if (!msg.id && msg.method) {
    sendMessage({
      type: "server_notification",
      server: name,
      method: msg.method,
      params: msg.params,
    });
  }
}

function relayToolCall(name, callId, method, params) {
  var entry = _processes[name];
  if (!entry || !entry.ready) {
    sendMessage({
      type: "mcp_response",
      callId: callId,
      error: "Server not running or not ready: " + name,
    });
    return;
  }

  var rpcId = _jsonRpcId++;
  _pendingRequests[rpcId] = {
    callId: callId,
    name: name,
    timer: setTimeout(function () {
      delete _pendingRequests[rpcId];
      sendMessage({
        type: "mcp_response",
        callId: callId,
        error: "Tool call timed out after 30s",
      });
    }, 30000),
  };

  var rpcMsg = JSON.stringify({
    jsonrpc: "2.0",
    id: rpcId,
    method: method,
    params: params,
  }) + "\n";
  entry.proc.stdin.write(rpcMsg);
}

function getStatus() {
  var result = {};
  var names = Object.keys(_processes);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var entry = _processes[name];
    result[name] = {
      ready: entry.ready,
      tools: entry.tools.length,
      pid: entry.proc.pid,
    };
  }
  return result;
}

// ---------- Clay Config Management (~/.clay/mcp.json) ----------

var CLAY_CONFIG_PATH = path.join(os.homedir(), ".clay", "mcp.json");

function ensureClayConfig() {
  var dir = path.dirname(CLAY_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CLAY_CONFIG_PATH)) {
    fs.writeFileSync(CLAY_CONFIG_PATH, JSON.stringify({ mcpServers: {}, include: [] }, null, 2));
  }
}

function readClayConfig() {
  ensureClayConfig();
  try {
    return JSON.parse(fs.readFileSync(CLAY_CONFIG_PATH, "utf8"));
  } catch (e) {
    return { mcpServers: {}, include: [] };
  }
}

function writeClayConfig(config) {
  ensureClayConfig();
  fs.writeFileSync(CLAY_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function addServer(name, command, args, env) {
  var config = readClayConfig();
  config.mcpServers = config.mcpServers || {};
  config.mcpServers[name] = { command: command, args: args || [], env: env || {} };
  writeClayConfig(config);
  // Also update in-memory cache
  _configCache = _configCache || {};
  _configCache[name] = config.mcpServers[name];
  spawnServer(name);
  return { ok: true };
}

function removeServer(name) {
  var config = readClayConfig();
  if (config.mcpServers && config.mcpServers[name]) {
    delete config.mcpServers[name];
    writeClayConfig(config);
  }
  // Kill if running
  if (_processes[name]) killServer(name);
  if (_configCache) delete _configCache[name];
  return { ok: true };
}

function getAllServers() {
  var config = readClayConfig();
  var merged = Object.assign({}, config.mcpServers || {});

  // Merge included configs
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

  // Update cache
  _configCache = merged;

  var servers = [];
  var allNames = Object.keys(merged);
  for (var k = 0; k < allNames.length; k++) {
    var n = allNames[k];
    var cfg = merged[n];
    servers.push({
      name: n,
      transport: cfg.url ? "http" : "stdio",
      command: cfg.command || null,
      url: cfg.url || null,
      running: !!(_processes[n] && _processes[n].ready)
    });
  }
  return { servers: servers };
}

function importConfig(filePath) {
  var resolved = filePath.replace(/^~/, os.homedir());
  try {
    var ext = JSON.parse(fs.readFileSync(resolved, "utf8"));
    var count = Object.keys(ext.mcpServers || {}).length;
    if (count === 0) return { error: "No mcpServers found in " + filePath };

    var config = readClayConfig();
    config.include = config.include || [];
    if (config.include.indexOf(filePath) === -1) {
      config.include.push(filePath);
      writeClayConfig(config);
    }
    return { ok: true, count: count };
  } catch (e) {
    return { error: "Cannot read file: " + e.message };
  }
}

function getImports() {
  var config = readClayConfig();
  return { paths: config.include || [] };
}

function removeImport(filePath) {
  var config = readClayConfig();
  config.include = (config.include || []).filter(function (p) { return p !== filePath; });
  writeClayConfig(config);
  return { ok: true };
}

// ---------- Message Router ----------

function handleMessage(msg) {
  switch (msg.type) {
    case "ping":
      sendMessage({ callId: msg.callId, type: "pong" });
      break;

    // Config management
    case "add_server":
      var addResult = addServer(msg.name, msg.command, msg.args, msg.env);
      sendMessage({ callId: msg.callId, ok: addResult.ok, error: addResult.error });
      break;

    case "remove_server":
      var removeResult = removeServer(msg.name);
      sendMessage({ callId: msg.callId, ok: removeResult.ok, error: removeResult.error });
      break;

    case "get_servers":
      var serversResult = getAllServers();
      sendMessage({ callId: msg.callId, servers: serversResult.servers });
      break;

    case "import_config":
      var importResult = importConfig(msg.path);
      sendMessage({ callId: msg.callId, ok: importResult.ok, count: importResult.count, error: importResult.error });
      break;

    case "get_imports":
      var importsResult = getImports();
      sendMessage({ callId: msg.callId, paths: importsResult.paths });
      break;

    case "remove_import":
      var removeImpResult = removeImport(msg.path);
      sendMessage({ callId: msg.callId, ok: removeImpResult.ok });
      break;

    // Legacy: read external config directly
    case "read_config":
      var configResult = readConfig(msg.path);
      sendMessage({ type: "config_result", callId: msg.callId, data: configResult });
      break;

    // Process management
    case "spawn_server":
      var spawnResult = spawnServer(msg.name);
      sendMessage({ type: "spawn_result", callId: msg.callId, server: msg.name, data: spawnResult });
      break;

    case "kill_server":
      var killResult = killServer(msg.name);
      sendMessage({ type: "kill_result", callId: msg.callId, server: msg.name, data: killResult });
      break;

    case "mcp_request":
      relayToolCall(msg.server, msg.callId, msg.method, msg.params);
      break;

    case "status":
      sendMessage({ type: "status_result", callId: msg.callId, servers: getStatus() });
      break;

    default:
      sendMessage({ callId: msg.callId, error: "Unknown message type: " + msg.type });
  }
}

// ---------- Cleanup ----------

function shutdown() {
  var names = Object.keys(_processes);
  for (var i = 0; i < names.length; i++) {
    var entry = _processes[names[i]];
    if (entry && entry.proc) {
      try { entry.proc.kill("SIGTERM"); } catch (e) { /* ignore */ }
    }
  }
  _processes = {};
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ---------- Auto-start servers from config ----------

(function autoStart() {
  var result = getAllServers();
  var servers = result.servers || [];
  for (var i = 0; i < servers.length; i++) {
    if (servers[i].transport === "stdio" && servers[i].command) {
      spawnServer(servers[i].name);
    }
  }
})();
