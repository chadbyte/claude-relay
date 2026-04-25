#!/usr/bin/env node
// mcp-bridge-server.js - Stdio MCP bridge for Codex
// --------------------------------------------------
// Codex spawns this as a native MCP server via config.mcp_servers["clay-tools"].
// It implements the MCP protocol on stdio (JSON-RPC) and proxies tool
// list/call requests to Clay's project-scoped HTTP endpoint
// (/p/{slug}/api/mcp-bridge) when a slug is provided.
//
// Usage: node mcp-bridge-server.js --port 2633 --slug my-project
//
// Lifecycle:
//   1. Codex spawns this process
//   2. Codex sends MCP "initialize" request on stdin
//   3. We respond, then fetch tool list from Clay
//   4. Codex sends "tools/list" -> we return cached tools
//   5. Codex sends "tools/call" -> we proxy to Clay and return result
//   6. When stdin closes (Codex exits), we exit too

var http = require("http");
var https = require("https");

// --- Parse CLI args ---
var args = process.argv.slice(2);
var clayPort = 2633;
var claySlug = "";
var clayTls = false;

for (var i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    clayPort = parseInt(args[i + 1], 10) || 2633;
    i++;
  } else if (args[i] === "--slug" && args[i + 1]) {
    claySlug = args[i + 1];
    i++;
  } else if (args[i] === "--tls") {
    clayTls = true;
  }
}

var CLAY_PROTOCOL = clayTls ? "https" : "http";
var CLAY_BASE_URL = CLAY_PROTOCOL + "://127.0.0.1:" + clayPort;
var CLAY_MCP_PATH = claySlug
  ? ("/p/" + claySlug + "/api/mcp-bridge")
  : "/api/mcp-bridge";

// --- Auth ---
var clayAuthToken = process.env.CLAY_AUTH_TOKEN || "";

// --- Tool cache ---
var _tools = [];         // [{ server, name, description, inputSchema }]
var _toolsFetched = false;

// --- HTTP helper ---
function postJson(urlPath, body) {
  return new Promise(function (resolve, reject) {
    var data = JSON.stringify(body);
    var url = CLAY_BASE_URL + urlPath;
    var parsed = new URL(url);
    var mod = parsed.protocol === "https:" ? https : http;

    var headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    };
    // Include auth cookie if available (required for authenticated Clay servers)
    if (clayAuthToken) {
      headers["Cookie"] = "relay_auth=" + clayAuthToken;
    }

    var reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: headers,
      // Skip TLS verification for localhost self-signed certs
      rejectUnauthorized: false,
    };

    var req = mod.request(reqOpts, function (res) {
      var chunks = [];
      res.on("data", function (chunk) { chunks.push(chunk); });
      res.on("end", function () {
        var respBody = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(JSON.parse(respBody));
        } catch (e) {
          reject(new Error("Invalid JSON response: " + respBody.substring(0, 200)));
        }
      });
    });

    req.on("error", function (err) {
      reject(err);
    });

    // 10 min safety ceiling. ask_user_questions is stateless (returns
    // immediately; the user's answer arrives on the next turn as a new
    // user message), so no tool call should legitimately block long.
    // The generous ceiling is just a belt-and-suspenders against slow
    // browser automation or external MCP servers, not the primary
    // mechanism for human-in-the-loop tools.
    req.setTimeout(600000, function () {
      req.destroy(new Error("Request timed out"));
    });

    req.write(data);
    req.end();
  });
}

// --- Fetch tools from Clay ---
function fetchTools() {
  return postJson(CLAY_MCP_PATH, { action: "list_tools" }).then(function (resp) {
    if (resp.error) {
      log("Failed to fetch tools: " + resp.error);
      return [];
    }
    _tools = resp.tools || [];
    _toolsFetched = true;
    var serverNames = {};
    for (var i = 0; i < _tools.length; i++) {
      serverNames[_tools[i].server] = (serverNames[_tools[i].server] || 0) + 1;
    }
    log("Fetched " + _tools.length + " tools from Clay: " + Object.keys(serverNames).map(function(s) { return s + "(" + serverNames[s] + ")"; }).join(", "));
    return _tools;
  }).catch(function (err) {
    log("Error fetching tools: " + err.message);
    return [];
  });
}

// --- Call a tool via Clay ---
function callTool(serverName, toolName, args) {
  return postJson(CLAY_MCP_PATH, {
    action: "call_tool",
    server: serverName,
    tool: toolName,
    args: args || {},
  });
}

// --- JSON-RPC stdio protocol ---
var _inputBuffer = "";

function sendJsonRpc(obj) {
  var line = JSON.stringify(obj) + "\n";
  try {
    process.stdout.write(line);
  } catch (e) {
    // stdout closed, exit
    process.exit(0);
  }
}

function sendResult(id, result) {
  sendJsonRpc({ jsonrpc: "2.0", id: id, result: result });
}

function sendError(id, code, message) {
  sendJsonRpc({ jsonrpc: "2.0", id: id, error: { code: code, message: message } });
}

function log(msg) {
  try {
    process.stderr.write("[mcp-bridge] " + msg + "\n");
  } catch (e) {}
}

// --- MCP message handlers ---

function handleInitialize(id, params) {
  sendResult(id, {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: "clay-tools",
      version: "1.0.0",
    },
  });

  // Pre-fetch tools after handshake
  fetchTools();
}

function handleToolsList(id, params) {
  function respond() {
    var mcpTools = _tools.map(function (t) {
      return {
        name: t.server + "__" + t.name,
        description: "[REMOTE MCP: " + t.server + "] " + (t.description || t.name)
          + " (This tool runs on a REMOTE machine connected via browser extension, NOT on the local server.)",
        inputSchema: t.inputSchema || { type: "object", properties: {} },
      };
    });
    sendResult(id, { tools: mcpTools });
  }

  // Always re-fetch: remote MCP servers may connect after initial fetch
  fetchTools().then(respond);
}

function handleToolsCall(id, params) {
  var fullName = params.name || "";
  var toolArgs = params.arguments || {};

  // Parse "server__toolName" format
  var sepIdx = fullName.indexOf("__");
  if (sepIdx === -1) {
    sendError(id, -32602, "Invalid tool name format. Expected 'server__tool': " + fullName);
    return;
  }

  var serverName = fullName.substring(0, sepIdx);
  var toolName = fullName.substring(sepIdx + 2);

  callTool(serverName, toolName, toolArgs).then(function (resp) {
    if (resp.error) {
      sendResult(id, {
        content: [{ type: "text", text: "Error: " + resp.error }],
        isError: true,
      });
    } else {
      var result = resp.result;
      // Normalize result to MCP content format
      if (result && result.content) {
        sendResult(id, result);
      } else {
        sendResult(id, {
          content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
        });
      }
    }
  }).catch(function (err) {
    sendResult(id, {
      content: [{ type: "text", text: "Bridge error: " + (err.message || String(err)) }],
      isError: true,
    });
  });
}

function handleMessage(msg) {
  if (!msg.method) {
    // Response or notification we don't handle
    return;
  }

  var method = msg.method;
  var id = msg.id;

  if (method === "initialize") {
    handleInitialize(id, msg.params || {});
  } else if (method === "notifications/initialized") {
    // Client acknowledged init, nothing to do
  } else if (method === "tools/list") {
    handleToolsList(id, msg.params || {});
  } else if (method === "tools/call") {
    handleToolsCall(id, msg.params || {});
  } else if (method === "ping") {
    sendResult(id, {});
  } else {
    if (id !== undefined) {
      sendError(id, -32601, "Method not found: " + method);
    }
  }
}

// --- Stdin reader ---
process.stdin.setEncoding("utf8");
process.stdin.on("data", function (chunk) {
  _inputBuffer += chunk;
  var lines = _inputBuffer.split("\n");
  _inputBuffer = lines.pop();
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    try {
      var msg = JSON.parse(line);
      handleMessage(msg);
    } catch (e) {
      log("Failed to parse JSON: " + e.message);
    }
  }
});

// Exit when stdin closes (Codex process exited)
process.stdin.on("end", function () {
  log("stdin closed, exiting");
  process.exit(0);
});

process.stdin.on("error", function () {
  process.exit(0);
});

// Graceful shutdown
process.on("SIGTERM", function () { process.exit(0); });
process.on("SIGINT", function () { process.exit(0); });

log("Started: port=" + clayPort + " slug=" + claySlug);
