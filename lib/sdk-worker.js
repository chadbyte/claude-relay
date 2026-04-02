// sdk-worker.js — Standalone worker process for OS-level user isolation.
// Runs as a target Linux user, loads the Claude Agent SDK, and communicates
// with the main Clay daemon over a Unix domain socket using JSON lines.
//
// Usage: node sdk-worker.js <socket-path>

// Early diagnostic — writes directly to fd 2 to ensure output even if pipes close fast
try { require("fs").writeSync(2, "[sdk-worker] BOOT pid=" + process.pid + " uid=" + (typeof process.getuid === "function" ? process.getuid() : "?") + " argv=" + process.argv.slice(1).join(" ") + "\n"); } catch (e) {}

var net = require("net");
var crypto = require("crypto");
var path = require("path");

var socketPath = process.argv[2];
if (!socketPath) {
  console.error("[sdk-worker] Missing socket path argument");
  process.exit(1);
}

// --- State ---
var sdkModule = null;
var queryInstance = null;
var messageQueue = null;
var abortController = null;
var pendingPermissions = {};  // requestId -> resolve
var pendingAskUser = {};      // toolUseId -> resolve
var pendingElicitations = {}; // requestId -> resolve
var conn = null;
var buffer = "";

// --- Message queue (same implementation as sdk-bridge.js) ---
function createMessageQueue() {
  var queue = [];
  var waiting = null;
  var ended = false;
  return {
    push: function(msg) {
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    end: function() {
      ended = true;
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: undefined, done: true });
      }
    },
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise(function(resolve) {
            waiting = resolve;
          });
        },
      };
    },
  };
}

// --- SDK loader ---
function getSDK() {
  if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");
  return sdkModule;
}

// --- IPC helpers ---
function sendToDaemon(msg) {
  if (!conn || conn.destroyed) return;
  try {
    conn.write(JSON.stringify(msg) + "\n");
  } catch (e) {
    console.error("[sdk-worker] Failed to send message:", e.message);
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case "query_start":
      handleQueryStart(msg);
      break;
    case "push_message":
      handlePushMessage(msg);
      break;
    case "end_messages":
      if (messageQueue) messageQueue.end();
      break;
    case "abort":
      if (abortController) abortController.abort();
      break;
    case "set_model":
      handleSetModel(msg);
      break;
    case "set_effort":
      handleSetEffort(msg);
      break;
    case "set_permission_mode":
      handleSetPermissionMode(msg);
      break;
    case "stop_task":
      handleStopTask(msg);
      break;
    case "permission_response":
      handlePermissionResponse(msg);
      break;
    case "ask_user_response":
      handleAskUserResponse(msg);
      break;
    case "elicitation_response":
      handleElicitationResponse(msg);
      break;
    case "warmup":
      handleWarmup(msg);
      break;
    case "shutdown":
      cleanup();
      process.exit(0);
      break;
    default:
      console.error("[sdk-worker] Unknown message type:", msg.type);
  }
}

// --- canUseTool: delegates to daemon via IPC ---
function canUseTool(toolName, input, opts) {
  var requestId = crypto.randomUUID();
  sendToDaemon({
    type: "permission_request",
    requestId: requestId,
    toolName: toolName,
    input: input,
    toolUseId: opts.toolUseID || "",
    decisionReason: opts.decisionReason || "",
  });
  return new Promise(function(resolve) {
    pendingPermissions[requestId] = resolve;
    if (opts.signal) {
      opts.signal.addEventListener("abort", function() {
        delete pendingPermissions[requestId];
        resolve({ behavior: "deny", message: "Cancelled" });
      });
    }
  });
}

// --- onElicitation: delegates to daemon via IPC ---
function onElicitation(request, opts) {
  var requestId = crypto.randomUUID();
  sendToDaemon({
    type: "elicitation_request",
    requestId: requestId,
    serverName: request.serverName,
    message: request.message,
    mode: request.mode || "form",
    url: request.url || null,
    elicitationId: request.elicitationId || null,
    requestedSchema: request.requestedSchema || null,
  });
  return new Promise(function(resolve) {
    pendingElicitations[requestId] = resolve;
    if (opts.signal) {
      opts.signal.addEventListener("abort", function() {
        delete pendingElicitations[requestId];
        resolve({ action: "reject" });
      });
    }
  });
}

function handlePermissionResponse(msg) {
  var resolve = pendingPermissions[msg.requestId];
  if (resolve) {
    delete pendingPermissions[msg.requestId];
    resolve(msg.result);
  }
}

function handleAskUserResponse(msg) {
  var resolve = pendingAskUser[msg.toolUseId];
  if (resolve) {
    delete pendingAskUser[msg.toolUseId];
    resolve(msg.result);
  }
}

function handleElicitationResponse(msg) {
  var resolve = pendingElicitations[msg.requestId];
  if (resolve) {
    delete pendingElicitations[msg.requestId];
    resolve(msg.result);
  }
}

// --- Query handling ---
async function handleQueryStart(msg) {
  var sdk;
  try {
    sdk = await getSDK();
  } catch (e) {
    sendToDaemon({ type: "query_error", error: "Failed to load SDK: " + (e.message || e), exitCode: null, stderr: null });
    return;
  }

  messageQueue = createMessageQueue();
  abortController = new AbortController();

  // Push the initial user message
  if (msg.prompt) {
    messageQueue.push(msg.prompt);
  }

  // Build query options (callbacks are local, everything else from daemon)
  var options = msg.options || {};
  options.abortController = abortController;
  options.canUseTool = function(toolName, input, toolOpts) {
    // AskUserQuestion is handled specially: we send it as a separate IPC type
    // so the daemon can use its own AskUserQuestion handling logic
    if (toolName === "AskUserQuestion") {
      var toolUseId = toolOpts.toolUseID || "";
      sendToDaemon({
        type: "ask_user_request",
        toolUseId: toolUseId,
        input: input,
      });
      return new Promise(function(resolve) {
        pendingAskUser[toolUseId] = resolve;
        if (toolOpts.signal) {
          toolOpts.signal.addEventListener("abort", function() {
            delete pendingAskUser[toolUseId];
            resolve({ behavior: "deny", message: "Cancelled" });
          });
        }
      });
    }
    return canUseTool(toolName, input, toolOpts);
  };
  options.onElicitation = function(request, elicitOpts) {
    return onElicitation(request, elicitOpts);
  };

  try {
    queryInstance = sdk.query({
      prompt: messageQueue,
      options: options,
    });
  } catch (e) {
    sendToDaemon({ type: "query_error", error: "Failed to create query: " + (e.message || e), exitCode: null, stderr: null });
    queryInstance = null;
    messageQueue = null;
    abortController = null;
    return;
  }

  // If single-turn, end the message queue immediately
  if (msg.singleTurn) {
    messageQueue.end();
  }

  // Stream events to daemon
  try {
    for await (var event of queryInstance) {
      sendToDaemon({ type: "sdk_event", event: event });
    }
    sendToDaemon({ type: "query_done" });
  } catch (err) {
    var errMsg = err.message || String(err);
    sendToDaemon({
      type: "query_error",
      error: errMsg,
      exitCode: err.exitCode != null ? err.exitCode : null,
      stderr: err.stderr || null,
    });
  } finally {
    queryInstance = null;
    messageQueue = null;
    abortController = null;
    pendingPermissions = {};
    pendingAskUser = {};
    pendingElicitations = {};
  }
}

function handlePushMessage(msg) {
  if (!messageQueue) return;
  messageQueue.push(msg.content);
}

async function handleSetModel(msg) {
  if (!queryInstance) return;
  try {
    await queryInstance.setModel(msg.model);
    sendToDaemon({ type: "model_changed", model: msg.model });
  } catch (e) {
    sendToDaemon({ type: "worker_error", error: "Failed to set model: " + (e.message || e) });
  }
}

async function handleSetEffort(msg) {
  if (!queryInstance) return;
  try {
    await queryInstance.setEffort(msg.effort);
    sendToDaemon({ type: "effort_changed", effort: msg.effort });
  } catch (e) {
    sendToDaemon({ type: "worker_error", error: "Failed to set effort: " + (e.message || e) });
  }
}

async function handleSetPermissionMode(msg) {
  if (!queryInstance) return;
  try {
    await queryInstance.setPermissionMode(msg.mode);
    sendToDaemon({ type: "permission_mode_changed", mode: msg.mode });
  } catch (e) {
    sendToDaemon({ type: "worker_error", error: "Failed to set permission mode: " + (e.message || e) });
  }
}

async function handleStopTask(msg) {
  if (!queryInstance) return;
  try {
    await queryInstance.stopTask(msg.taskId);
  } catch (e) {
    console.error("[sdk-worker] stopTask error:", e.message);
  }
  // Also abort as fallback (matches daemon behavior)
  if (abortController) {
    abortController.abort();
  }
}

// --- Warmup ---
async function handleWarmup(msg) {
  var sdk;
  try {
    sdk = await getSDK();
  } catch (e) {
    sendToDaemon({ type: "warmup_error", error: "Failed to load SDK: " + (e.message || e) });
    return;
  }

  var ac = new AbortController();
  var mq = createMessageQueue();
  mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
  mq.end();

  var warmupOptions = msg.options || {};
  warmupOptions.abortController = ac;

  try {
    var stream = sdk.query({
      prompt: mq,
      options: warmupOptions,
    });

    for await (var event of stream) {
      if (event.type === "system" && event.subtype === "init") {
        var result = {
          slashCommands: event.slash_commands || [],
          model: event.model || "",
          skills: event.skills || [],
          fastModeState: event.fast_mode_state || null,
        };

        // Fetch available models before aborting
        try {
          var models = await stream.supportedModels();
          result.models = models || [];
        } catch (e) {
          result.models = [];
        }

        sendToDaemon({ type: "warmup_done", result: result });
        ac.abort();
        break;
      }
    }
  } catch (e) {
    if (e && e.name !== "AbortError" && !(e.message && e.message.indexOf("aborted") !== -1)) {
      sendToDaemon({ type: "warmup_error", error: "Warmup failed: " + (e.message || e) });
    }
  }
}

// --- Cleanup ---
function cleanup() {
  if (_keepAlive) {
    try { clearInterval(_keepAlive); } catch (e) {}
  }
  if (abortController) {
    try { abortController.abort(); } catch (e) {}
  }
  if (messageQueue) {
    try { messageQueue.end(); } catch (e) {}
  }
  if (conn && !conn.destroyed) {
    try { conn.end(); } catch (e) {}
  }
}

// Keep event loop alive — without this, Node may exit if the socket handle
// gets unreferenced (observed on Linux with uid/gid spawn)
var _keepAlive = setInterval(function() {}, 30000);

// --- Connect to daemon socket ---
try { require("fs").writeSync(2, "[sdk-worker] Connecting to socket: " + socketPath + "\n"); } catch (e) {}
conn = net.connect(socketPath, function() {
  try { require("fs").writeSync(2, "[sdk-worker] Connected, sending ready\n"); } catch (e) {}
  sendToDaemon({ type: "ready" });
});

conn.on("data", function(chunk) {
  buffer += chunk.toString();
  var lines = buffer.split("\n");
  buffer = lines.pop(); // keep incomplete line in buffer
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      var msg = JSON.parse(lines[i]);
      handleMessage(msg);
    } catch (e) {
      console.error("[sdk-worker] Failed to parse message:", e.message);
    }
  }
});

conn.on("error", function(err) {
  console.error("[sdk-worker] Socket error:", err.message);
  cleanup();
  process.exit(1);
});

conn.on("close", function() {
  try { require("fs").writeSync(2, "[sdk-worker] EXIT REASON: socket closed\n"); } catch (e) {}
  cleanup();
  process.exit(0);
});

// Handle process signals
process.on("SIGTERM", function() {
  try { require("fs").writeSync(2, "[sdk-worker] EXIT REASON: SIGTERM\n"); } catch (e) {}
  cleanup();
  process.exit(0);
});

process.on("SIGINT", function() {
  try { require("fs").writeSync(2, "[sdk-worker] EXIT REASON: SIGINT\n"); } catch (e) {}
  cleanup();
  process.exit(0);
});
