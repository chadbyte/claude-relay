// YOKE Claude Adapter
// --------------------
// Implements the YOKE interface using @anthropic-ai/claude-agent-sdk.
// This is the ONLY file (besides claude-worker.js) that imports the SDK.
// Also manages worker processes for OS-level user isolation.

var path = require("path");
var fs = require("fs");
var os = require("os");
var net = require("net");
var crypto = require("crypto");
var { spawn } = require("child_process");
var { resolveOsUserInfo } = require("../../os-users");

// --- SDK loading ---
// Async loader (ESM dynamic import, same pattern as current project.js getSDK)
var _sdkPromise = null;
function loadSDK() {
  if (!_sdkPromise) _sdkPromise = import("@anthropic-ai/claude-agent-sdk");
  return _sdkPromise;
}

// Sync loader (CJS require, for createToolServer which must be synchronous)
var _sdkSync = null;
function loadSDKSync() {
  if (!_sdkSync) {
    try { _sdkSync = require("@anthropic-ai/claude-agent-sdk"); } catch (e) {
      console.error("[yoke/claude] Failed to load SDK synchronously:", e.message);
      return null;
    }
  }
  return _sdkSync;
}

// --- Internal message queue (async iterable for SDK prompt) ---
function createMessageQueue() {
  var queue = [];
  var waiting = null;
  var ended = false;
  return {
    push: function(msg) {
      if (ended) return;
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
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise(function(resolve) { waiting = resolve; });
        },
      };
    },
  };
}

// --- Event flattening ---
// Converts raw Claude SDK events into flat objects with a yokeType field.
// This decouples processSDKMessage from the deeply-nested SDK event shapes.
function flattenEvent(raw) {
  // session_id and uuid are cross-cutting: attach to any event that has them
  var base = {};
  if (raw.session_id) base.sessionId = raw.session_id;
  if (raw.uuid) {
    base.uuid = raw.uuid;
    base.messageType = raw.type;  // "user" or "assistant"
    base.parentToolUseId = raw.parent_tool_use_id || null;
  }

  // --- stream_event with nested event ---
  if (raw.type === "stream_event" && raw.event) {
    var evt = raw.event;

    if (evt.type === "message_start") {
      base.yokeType = "turn_start";
      if (evt.message && evt.message.usage) {
        var u = evt.message.usage;
        base.inputTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
      }
      return base;
    }

    if (evt.type === "content_block_start" && evt.content_block) {
      var block = evt.content_block;
      base.blockIndex = evt.index;
      base.blockId = "blk_" + evt.index;
      if (block.type === "tool_use") {
        base.yokeType = "tool_start";
        base.toolId = block.id;
        base.toolName = block.name;
      } else if (block.type === "thinking") {
        base.yokeType = "thinking_start";
      } else if (block.type === "text") {
        base.yokeType = "text_start";
      } else {
        base.yokeType = "block_start";
        base.blockType = block.type;
      }
      return base;
    }

    if (evt.type === "content_block_delta" && evt.delta) {
      base.blockIndex = evt.index;
      base.blockId = "blk_" + evt.index;
      if (evt.delta.type === "text_delta") {
        base.yokeType = "text_delta";
        base.text = evt.delta.text;
      } else if (evt.delta.type === "input_json_delta") {
        base.yokeType = "tool_input_delta";
        base.partialJson = evt.delta.partial_json;
      } else if (evt.delta.type === "thinking_delta") {
        base.yokeType = "thinking_delta";
        base.text = evt.delta.thinking;
      } else {
        base.yokeType = "block_delta";
        base.delta = evt.delta;
      }
      return base;
    }

    if (evt.type === "content_block_stop") {
      base.yokeType = "block_stop";
      base.blockIndex = evt.index;
      base.blockId = "blk_" + evt.index;
      return base;
    }

    if (evt.type === "message_stop") {
      base.yokeType = "turn_stop";
      return base;
    }

    // Unrecognized stream_event: pass through
    base.yokeType = "stream_event";
    base.event = evt;
    return base;
  }

  // --- system events ---
  if (raw.type === "system") {
    if (raw.subtype === "init") {
      base.yokeType = "init";
      base.model = raw.model;
      base.skills = raw.skills;
      base.slashCommands = raw.slash_commands;
      base.fastModeState = raw.fast_mode_state || null;
      return base;
    }
    if (raw.subtype === "status") {
      base.yokeType = "status";
      base.status = raw.status;
      return base;
    }
    if (raw.subtype === "task_started") {
      base.yokeType = "task_started";
      base.parentToolId = raw.tool_use_id;
      base.taskId = raw.task_id;
      base.description = raw.description || "";
      return base;
    }
    if (raw.subtype === "task_progress") {
      base.yokeType = "task_progress";
      base.parentToolId = raw.tool_use_id;
      base.taskId = raw.task_id;
      base.usage = raw.usage || null;
      base.lastToolName = raw.last_tool_name || null;
      base.description = raw.description || "";
      base.summary = raw.summary || null;
      return base;
    }
    // Catch-all system event
    base.yokeType = "system";
    base.subtype = raw.subtype;
    base.error = raw.error;
    base.message = raw.message;
    base.text = raw.text;
    base.content = raw.content;
    return base;
  }

  // --- result ---
  if (raw.type === "result") {
    base.yokeType = "result";
    base.cost = raw.total_cost_usd;
    base.duration = raw.duration_ms;
    base.usage = raw.usage || null;
    base.modelUsage = raw.modelUsage || null;
    base.subtype = raw.subtype;
    base.errors = raw.errors;
    base.terminalReason = raw.terminal_reason;
    base.fastModeState = raw.fast_mode_state || null;
    return base;
  }

  // --- assistant/user messages (tool results, subagent messages, fallback text) ---
  if (raw.type === "assistant" || raw.type === "user") {
    if (raw.parent_tool_use_id) {
      base.yokeType = "subagent_message";
      base.parentToolUseId = raw.parent_tool_use_id;
      base.messageRole = raw.type;
      base.content = raw.message ? raw.message.content : null;
      return base;
    }
    base.yokeType = "message";
    base.messageRole = raw.type;
    base.content = raw.message ? raw.message.content : null;
    return base;
  }

  // --- rate_limit_event ---
  if (raw.type === "rate_limit_event" && raw.rate_limit_info) {
    base.yokeType = "rate_limit";
    base.rateLimitInfo = raw.rate_limit_info;
    return base;
  }

  // --- prompt_suggestion ---
  if (raw.type === "prompt_suggestion") {
    base.yokeType = "prompt_suggestion";
    base.suggestion = raw.suggestion || "";
    return base;
  }

  // --- task_notification ---
  if (raw.type === "task_notification") {
    base.yokeType = "task_notification";
    base.parentToolId = raw.parent_tool_use_id;
    base.taskId = raw.task_id;
    base.status = raw.status || "completed";
    base.summary = raw.summary || "";
    base.usage = raw.usage || null;
    return base;
  }

  // --- tool_progress ---
  if (raw.type === "tool_progress") {
    base.yokeType = "tool_progress";
    base.parentToolId = raw.parent_tool_use_id;
    base.text = raw.content || "";
    return base;
  }

  // --- _worker_meta passthrough (not a raw SDK event) ---
  if (raw.type === "_worker_meta") {
    return raw;
  }

  // --- fallback: unknown event type ---
  base.yokeType = "unknown";
  base.rawType = raw.type;
  base.raw = raw;
  return base;
}

// --- QueryHandle ---
// Wraps a raw SDK query object with the YOKE QueryHandle interface.
// Events are flattened via flattenEvent before yielding.
function createQueryHandle(rawQuery, messageQueue, abortController) {
  var handle = {
    // Opaque adapter state (null for in-process queries)
    _adapterState: null,

    // Async iterable: yields flattened SDK events
    [Symbol.asyncIterator]: function() {
      var rawIter = rawQuery[Symbol.asyncIterator]();
      return {
        next: function() {
          return rawIter.next().then(function(result) {
            if (result.done) return result;
            return { value: flattenEvent(result.value), done: false };
          });
        },
      };
    },

    pushMessage: function(text, images) {
      var content = [];
      if (images && images.length > 0) {
        for (var i = 0; i < images.length; i++) {
          content.push({
            type: "image",
            source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
          });
        }
      }
      if (text) content.push({ type: "text", text: text });
      messageQueue.push({ type: "user", message: { role: "user", content: content } });
    },

    setModel: function(model) {
      if (rawQuery && typeof rawQuery.setModel === "function") {
        return rawQuery.setModel(model);
      }
      return Promise.resolve();
    },

    setEffort: function(effort) {
      // Claude SDK has no setEffort on active query.
      // Stored at Clay level for next query.
      return Promise.resolve();
    },

    setToolPolicy: function(policy) {
      // Map YOKE policy to Claude permission mode
      if (rawQuery && typeof rawQuery.setPermissionMode === "function") {
        var mode = policy === "allow-all" ? "bypassPermissions" : "default";
        return rawQuery.setPermissionMode(mode);
      }
      return Promise.resolve();
    },

    // Phase 3 backward compat: direct setPermissionMode with Claude-specific modes
    setPermissionMode: function(mode) {
      if (rawQuery && typeof rawQuery.setPermissionMode === "function") {
        return rawQuery.setPermissionMode(mode);
      }
      return Promise.resolve();
    },

    stopTask: function(taskId) {
      if (rawQuery && typeof rawQuery.stopTask === "function") {
        return rawQuery.stopTask(taskId);
      }
      return Promise.resolve();
    },

    getContextUsage: function() {
      if (rawQuery && typeof rawQuery.getContextUsage === "function") {
        return rawQuery.getContextUsage();
      }
      return Promise.resolve(null);
    },

    supportedModels: function() {
      if (rawQuery && typeof rawQuery.supportedModels === "function") {
        return rawQuery.supportedModels();
      }
      return Promise.resolve([]);
    },

    abort: function() {
      if (abortController) {
        try { abortController.abort(); } catch (e) {}
      }
    },

    close: function() {
      try { messageQueue.end(); } catch (e) {}
      if (rawQuery && typeof rawQuery.close === "function") {
        try { rawQuery.close(); } catch (e) {}
      }
    },

    // End the message queue without closing the raw query
    endInput: function() {
      try { messageQueue.end(); } catch (e) {}
    },

    // Claude SDK specific: rewind files to a previous state
    rewindFiles: function(uuid, opts) {
      if (rawQuery && typeof rawQuery.rewindFiles === "function") {
        return rawQuery.rewindFiles(uuid, opts);
      }
      return Promise.reject(new Error("rewindFiles not supported"));
    },
  };

  return handle;
}

// ===================================================================
// Worker process management (OS-level multi-user)
// ===================================================================

// Ensure the package directory tree is world-readable so OS-level users
// can access the worker script and its dependencies (the install path
// may be under /root/.npm/_npx/ which defaults to 700)
(function ensurePackageReadable() {
  try {
    // Walk up from __dirname to find the package root (where node_modules lives)
    var pkgDir = path.join(__dirname, "..", "..", "..");
    // Open read+execute on each ancestor directory up to and including the
    // npx cache entry so that non-root users can traverse the path
    var dir = pkgDir;
    var dirs = [];
    while (dir !== path.dirname(dir)) {
      dirs.push(dir);
      dir = path.dirname(dir);
    }
    // Open o+rx on each ancestor so non-root users can traverse the path
    // (e.g. /root/.npm/_npx/.../node_modules/clay-server needs /root to be o+x)
    for (var di = 0; di < dirs.length; di++) {
      try {
        var st = fs.statSync(dirs[di]);
        // Add o+x (traverse) to all ancestors, o+rx to npm cache dirs
        var isNpmDir = dirs[di].indexOf(".npm") !== -1 || dirs[di].indexOf("node_modules") !== -1;
        var needed = isNpmDir ? 0o005 : 0o001; // rx for npm dirs, just x for ancestors like /root
        if ((st.mode & needed) !== needed) {
          fs.chmodSync(dirs[di], st.mode | needed);
        }
      } catch (e) {}
    }
    // Recursively make the package AND hoisted dependencies readable.
    // npm/npx may hoist deps (e.g. @anthropic-ai/claude-agent-sdk) to the
    // parent node_modules/ instead of inside clay-server/node_modules/.
    var { execSync: chmodExec } = require("child_process");
    // Find the top-level node_modules that contains clay-server
    var topNodeModules = path.join(pkgDir, "..");
    if (path.basename(topNodeModules) === "node_modules") {
      chmodExec("chmod -R o+rX " + JSON.stringify(topNodeModules), { stdio: "ignore", timeout: 15000 });
    } else {
      chmodExec("chmod -R o+rX " + JSON.stringify(pkgDir), { stdio: "ignore", timeout: 5000 });
    }
  } catch (e) {}
})();

// resolveLinuxUser delegates to shared os-users utility
function resolveLinuxUser(username) {
  return resolveOsUserInfo(username);
}

/**
 * Spawn an SDK worker process running as the given Linux user.
 * Returns a worker handle with send/kill/event methods.
 */
function spawnWorker(linuxUser, workerScriptPath, cwd) {
  var userInfo = resolveLinuxUser(linuxUser);
  var socketId = crypto.randomUUID();
  var socketPath = path.join(os.tmpdir(), "clay-worker-" + socketId + ".sock");

  var worker = {
    process: null,
    connection: null,
    socketPath: socketPath,
    server: null,
    messageHandlers: [],
    ready: false,
    readyPromise: null,
    _readyResolve: null,
    buffer: "",
  };

  worker.readyPromise = new Promise(function(resolve) {
    worker._readyResolve = resolve;
  });

  // Resolves when the worker process actually exits.
  // Used to prevent spawning a new worker before the old one finishes
  // flushing SDK session state to disk (race condition on resume).
  worker.exitPromise = new Promise(function(resolve) {
    worker._exitResolve = resolve;
  });

  // Create Unix socket server
  var spawnT0 = Date.now();
  worker.server = net.createServer(function(connection) {
    console.log("[PERF] spawnWorker: socket connection accepted +" + (Date.now() - spawnT0) + "ms");
    worker.connection = connection;
    connection.on("data", function(chunk) {
      worker.buffer += chunk.toString();
      var lines = worker.buffer.split("\n");
      worker.buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        try {
          var msg = JSON.parse(lines[i]);
          if (msg.type === "ready") {
            console.log("[PERF] spawnWorker: 'ready' IPC received +" + (Date.now() - spawnT0) + "ms");
            worker.ready = true;
            if (worker._readyResolve) {
              worker._readyResolve();
              worker._readyResolve = null;
            }
          }
          for (var h = 0; h < worker.messageHandlers.length; h++) {
            worker.messageHandlers[h](msg);
          }
        } catch (e) {
          console.error("[yoke/claude] Failed to parse worker message:", e.message);
        }
      }
    });
    connection.on("error", function(err) {
      console.error("[yoke/claude] Worker connection error:", err.message);
    });
  });

  worker.server.listen(socketPath, function() {
    console.log("[PERF] spawnWorker: socket listen ready +" + (Date.now() - spawnT0) + "ms");
    // Set socket permissions so the target user can connect
    try { fs.chmodSync(socketPath, 0o777); } catch (e) {}

    // Spawn worker process as the target Linux user.
    // Build a minimal, isolated env (no daemon env leakage).
    var workerEnv = require("../../build-user-env").buildUserEnv({
      uid: userInfo.uid,
      gid: userInfo.gid,
      home: userInfo.home,
      user: linuxUser,
      shell: userInfo.shell || "/bin/bash",
    });

    console.log("[yoke/claude] Spawning worker: uid=" + userInfo.uid + " gid=" + userInfo.gid + " cwd=" + cwd + " socket=" + socketPath);
    console.log("[yoke/claude] Worker script: " + workerScriptPath);
    console.log("[yoke/claude] Node: " + process.execPath);
    worker.process = spawn(process.execPath, [workerScriptPath, socketPath], {
      uid: userInfo.uid,
      gid: userInfo.gid,
      env: workerEnv,
      cwd: cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    worker.process.stdout.on("data", function(data) {
      console.log("[sdk-worker:" + linuxUser + "] " + data.toString().trim());
    });
    worker._stderrBuf = "";
    worker.process.stderr.on("data", function(data) {
      var text = data.toString().trim();
      worker._stderrBuf += text + "\n";
      console.error("[sdk-worker:" + linuxUser + "] " + text);
    });

    worker.process.on("exit", function(code, signal) {
      console.log("[yoke/claude] Worker for " + linuxUser + " exited (code=" + code + ", signal=" + signal + ")" + (worker._stderrBuf ? " stderr: " + worker._stderrBuf.trim() : ""));
      // Reject readyPromise if worker dies before becoming ready
      if (!worker.ready && worker._readyResolve) {
        worker._readyResolve = null;
        // Let the readyPromise hang; the query_error handler will clean up
      }
      // Notify message handlers about unexpected exit so sessions don't hang.
      // Always dispatch a fallback query_error. The handler is idempotent:
      // it checks isProcessing before taking action, and cleanupSessionWorker
      // guards against stale workers. This covers all exit cases including
      // signal kills (code=null) and normal exits where the IPC query_error
      // was lost due to connection timing.
      console.log("[yoke/claude] Exit handler: pid=" + (worker.process ? worker.process.pid : "?") + " ready=" + worker.ready + " _queryEnded=" + worker._queryEnded + " _abortSent=" + worker._abortSent + " handlers=" + worker.messageHandlers.length);
      if (code === 0 && !worker.ready) {
        // Worker exited cleanly before sending "ready"
        for (var h = 0; h < worker.messageHandlers.length; h++) {
          worker.messageHandlers[h]({
            type: "query_error",
            error: "Worker exited before ready (code=0). stderr: " + (worker._stderrBuf || "(none)"),
            exitCode: 0,
            stderr: worker._stderrBuf || null,
          });
        }
      } else if (code !== 0 || code === null || signal) {
        // Worker crashed, was killed by signal, or exited abnormally
        var stderrText = worker._stderrBuf || "";
        var exitReason = signal
          ? "Worker killed by " + signal
          : (stderrText || "Worker exited with code " + code);
        for (var h = 0; h < worker.messageHandlers.length; h++) {
          worker.messageHandlers[h]({
            type: "query_error",
            error: exitReason,
            exitCode: code,
            stderr: stderrText || null,
          });
        }
      } else if (worker.messageHandlers.length > 0) {
        // Normal exit (code=0, ready=true). Dispatch fallback in case the
        // IPC query_done/query_error was lost (e.g. connection closed early).
        var fallbackMsg = worker._abortSent
          ? "Worker aborted"
          : "Worker exited before query completed";
        for (var h = 0; h < worker.messageHandlers.length; h++) {
          worker.messageHandlers[h]({
            type: "query_error",
            error: fallbackMsg,
            exitCode: 0,
            stderr: worker._stderrBuf || null,
            _fallback: true,
          });
        }
      }
      cleanupWorker(worker);
      if (worker._exitResolve) {
        worker._exitResolve();
        worker._exitResolve = null;
      }
    });
  });

  worker.send = function(msg) {
    if (!worker.connection || worker.connection.destroyed) return;
    try {
      worker.connection.write(JSON.stringify(serializeWorkerValue(msg)) + "\n");
    } catch (e) {
      console.error("[yoke/claude] Failed to send to worker:", e.message);
    }
  };

  worker.onMessage = function(handler) {
    worker.messageHandlers.push(handler);
  };

  worker.kill = function() {
    console.log("[yoke/claude] worker.kill() called, pid=" + (worker.process ? worker.process.pid : "?") + " stack=" + new Error().stack.split("\n").slice(1, 4).join(" | "));
    worker.send({ type: "shutdown" });
    // Force kill after 5 seconds if still alive (gives SDK time to save session)
    setTimeout(function() {
      if (worker.process && !worker.process.killed) {
        try { worker.process.kill("SIGKILL"); } catch (e) {}
      }
    }, 5000);
    // Don't call cleanupWorker here. Let the exit handler do it after
    // the worker has had time to save SDK session state to disk.
    // Closing the connection prematurely causes the worker to exit
    // before the SDK can flush its session file, leading to "no
    // conversation found" errors on resume (OS multi-user mode).
  };

  return worker;
}

function cleanupWorker(worker) {
  console.log("[yoke/claude] cleanupWorker() called, pid=" + (worker.process ? worker.process.pid : "?") + " stack=" + new Error().stack.split("\n").slice(1, 4).join(" | "));
  if (worker._abortTimeout) { clearTimeout(worker._abortTimeout); worker._abortTimeout = null; }
  if (worker.connection && !worker.connection.destroyed) {
    try { worker.connection.end(); } catch (e) {}
  }
  if (worker.server) {
    try { worker.server.close(); } catch (e) {}
  }
  // Remove socket file
  try { fs.unlinkSync(worker.socketPath); } catch (e) {}
  worker.ready = false;
}

function serializeWorkerValue(value, seen) {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");

  if (!seen) seen = new WeakSet();
  if (typeof value === "object") {
    if (seen.has(value)) return undefined;
    seen.add(value);
  }

  if (Array.isArray(value)) {
    var arr = [];
    for (var i = 0; i < value.length; i++) {
      var item = serializeWorkerValue(value[i], seen);
      if (item !== undefined) arr.push(item);
    }
    return arr;
  }

  var out = {};
  var keys = Object.keys(value);
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    var child = serializeWorkerValue(value[key], seen);
    if (child !== undefined) out[key] = child;
  }
  return out;
}

// --- Worker QueryHandle ---
// Wraps worker IPC into the same async iterable + control interface as the
// in-process QueryHandle. This allows processQueryStream to iterate a worker
// query identically to an in-process query.

function createWorkerQueryHandle(worker, canUseTool, onElicitation, callMcpTool) {
  // Async iterable state
  var iterQueue = [];
  var iterWaiting = null;
  var iterEnded = false;
  var iterError = null;

  function pushToIter(value) {
    if (iterEnded) return;
    if (iterWaiting) {
      var resolve = iterWaiting;
      iterWaiting = null;
      resolve({ value: value, done: false });
    } else {
      iterQueue.push(value);
    }
  }

  function endIter() {
    if (iterEnded) return;
    iterEnded = true;
    if (iterWaiting) {
      var resolve = iterWaiting;
      iterWaiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  function errorIter(err) {
    if (iterEnded) return;
    iterEnded = true;
    iterError = err;
    if (iterWaiting) {
      var reject = iterWaiting;
      iterWaiting = null;
      // We stored the reject function below; for simplicity, use a combined approach
      reject({ error: err });
    }
  }

  // Set up message handler on the worker
  worker.onMessage(function(msg) {
    switch (msg.type) {
      case "sdk_event":
        pushToIter(flattenEvent(msg.event));
        break;

      case "permission_request":
        if (canUseTool) {
          canUseTool(msg.toolName, msg.input, {
            toolUseID: msg.toolUseId,
            decisionReason: msg.decisionReason,
            signal: { addEventListener: function() {} },
          }).then(function(result) {
            worker.send({ type: "permission_response", requestId: msg.requestId, result: result });
          }).catch(function(e) {
            console.error("[yoke/claude] permission_response send failed:", e.message || e);
          });
        }
        break;

      case "ask_user_request":
        if (canUseTool) {
          canUseTool("AskUserQuestion", msg.input, {
            toolUseID: msg.toolUseId,
            signal: { addEventListener: function() {} },
          }).then(function(result) {
            worker.send({ type: "ask_user_response", toolUseId: msg.toolUseId, result: result });
          }).catch(function(e) {
            console.error("[yoke/claude] ask_user_response send failed:", e.message || e);
          });
        }
        break;

      case "elicitation_request":
        if (onElicitation) {
          onElicitation({
            serverName: msg.serverName,
            message: msg.message,
            mode: msg.mode,
            url: msg.url,
            elicitationId: msg.elicitationId,
            requestedSchema: msg.requestedSchema,
          }, {
            signal: { addEventListener: function() {} },
          }).then(function(result) {
            worker.send({ type: "elicitation_response", requestId: msg.requestId, result: result });
          }).catch(function(e) {
            console.error("[yoke/claude] elicitation_response send failed:", e.message || e);
          });
        }
        break;

      case "mcp_tool_call":
        if (callMcpTool) {
          callMcpTool(msg.serverName, msg.toolName, msg.args || {}).then(function(result) {
            worker.send({ type: "mcp_tool_result", requestId: msg.requestId, result: result });
          }).catch(function(e) {
            worker.send({
              type: "mcp_tool_result",
              requestId: msg.requestId,
              error: (e && e.message) ? e.message : String(e),
            });
          });
        }
        break;

      case "context_usage":
      case "model_changed":
      case "effort_changed":
      case "permission_mode_changed":
      case "worker_error":
        // Yield these as _worker_meta events so processQueryStream can handle them
        pushToIter({ type: "_worker_meta", subtype: msg.type, data: msg });
        break;

      case "query_done":
        console.log("[yoke/claude] IPC query_done received, pid=" + (worker.process ? worker.process.pid : "?"));
        worker._queryEnded = true;
        endIter();
        break;

      case "query_error": {
        console.log("[yoke/claude] IPC query_error received, pid=" + (worker.process ? worker.process.pid : "?") + " _fallback=" + !!msg._fallback + " _queryEnded=" + worker._queryEnded + " error=" + (msg.error || "").substring(0, 100));
        // Skip fallback errors from exit handler if we already handled the real one
        if (msg._fallback && worker._queryEnded) break;
        worker._queryEnded = true;
        var err = new Error(msg.error || "Worker query error");
        err.exitCode = msg.exitCode;
        err.stderr = msg.stderr;
        // Also store the worker stderr buffer for when msg.stderr is empty
        if (!msg.stderr && worker._stderrBuf) {
          err.stderr = worker._stderrBuf.trim();
        }
        errorIter(err);
        break;
      }
    }
  });

  var handle = {
    // Opaque adapter state: contains worker reference and exit promise
    _adapterState: {
      worker: worker,
      exitPromise: worker.exitPromise,
    },

    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          // Check for error first
          if (iterError) {
            return Promise.reject(iterError);
          }
          if (iterQueue.length > 0) {
            var item = iterQueue.shift();
            if (item && item.error && iterEnded) {
              // This was an error signal
              return Promise.reject(item.error);
            }
            return Promise.resolve({ value: item, done: false });
          }
          if (iterEnded) {
            if (iterError) return Promise.reject(iterError);
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise(function(resolve, reject) {
            iterWaiting = function(result) {
              if (result && result.error) {
                reject(result.error);
              } else {
                resolve(result);
              }
            };
          });
        },
      };
    },

    pushMessage: function(text, images) {
      var content = [];
      if (images && images.length > 0) {
        for (var i = 0; i < images.length; i++) {
          content.push({
            type: "image",
            source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
          });
        }
      }
      if (text) content.push({ type: "text", text: text });
      var userMsg = { type: "user", message: { role: "user", content: content } };
      worker.send({ type: "push_message", content: userMsg });
    },

    setModel: function(model) {
      worker.send({ type: "set_model", model: model });
      return Promise.resolve();
    },

    setEffort: function(effort) {
      worker.send({ type: "set_effort", effort: effort });
      return Promise.resolve();
    },

    setToolPolicy: function(policy) {
      var mode = policy === "allow-all" ? "bypassPermissions" : "default";
      worker.send({ type: "set_permission_mode", mode: mode });
      return Promise.resolve();
    },

    setPermissionMode: function(mode) {
      worker.send({ type: "set_permission_mode", mode: mode });
      return Promise.resolve();
    },

    stopTask: function(taskId) {
      worker.send({ type: "stop_task", taskId: taskId });
      return Promise.resolve();
    },

    getContextUsage: function() {
      return Promise.resolve(null);
    },

    supportedModels: function() {
      return Promise.resolve([]);
    },

    abort: function() {
      console.log("[yoke/claude] ABORT sent to worker pid=" + (worker.process ? worker.process.pid : "?"));
      worker._abortSent = true;
      try { worker.send({ type: "abort" }); } catch (e) {}
      // If the worker doesn't finish within 5s (e.g. subagent stuck), force-kill it.
      // The worker exit handler will dispatch a fallback query_error and send done.
      if (worker._abortTimeout) clearTimeout(worker._abortTimeout);
      worker._abortTimeout = setTimeout(function() {
        if (worker.process && !worker.process.killed) {
          console.log("[yoke/claude] Abort timeout: force-killing worker pid=" + (worker.process ? worker.process.pid : "?"));
          try { worker.process.kill("SIGKILL"); } catch (e) {}
        }
      }, 5000);
    },

    close: function() {
      // End the iterator
      endIter();
      // Send end_messages to worker
      worker.send({ type: "end_messages" });
    },

    endInput: function() {
      worker.send({ type: "end_messages" });
    },
  };

  return handle;
}


// --- Adapter factory ---

function resolveClaudeBinaryPath() {
  try {
    var result = require("child_process").execSync("which claude", { encoding: "utf8", timeout: 5000 }).trim();
    if (result && fs.existsSync(result)) return result;
  } catch (e) {}
  return null;
}

function createClaudeAdapter(opts) {
  var _cwd = (opts && opts.cwd) || process.cwd();
  var _cachedModels = [];
  var _claudeBinaryPath = resolveClaudeBinaryPath();

  // Path to the worker script (for OS-level user isolation)
  var workerScriptPath = path.join(__dirname, "claude-worker.js");

  var adapter = {
    vendor: "claude",

    // Path to worker script (sdk-bridge uses this to spawn worker processes)
    workerScriptPath: workerScriptPath,

    /**
     * Initialize the adapter. Performs SDK warmup to discover models, skills, etc.
     * If linuxUser is provided (via initOpts.linuxUser), delegates to a worker process.
     *
     * @param {object} initOpts
     * @param {string} [initOpts.cwd]
     * @param {boolean} [initOpts.dangerouslySkipPermissions]
     * @param {string} [initOpts.linuxUser] - OS user for worker isolation
     * @returns {Promise<{ models, defaultModel, skills, slashCommands, fastModeState, capabilities }>}
     */
    init: async function(initOpts) {
      var linuxUser = initOpts && initOpts.linuxUser;
      if (linuxUser) {
        return initViaWorker(linuxUser, initOpts);
      }

      var sdk = await loadSDK();
      var ac = new AbortController();
      var mq = createMessageQueue();
      mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
      mq.end();

      var warmupOptions = {
        cwd: (initOpts && initOpts.cwd) || _cwd,
        settingSources: ["user", "project", "local"],
        abortController: ac,
        settings: { disableAllHooks: true },
      };
      if (_claudeBinaryPath) warmupOptions.pathToClaudeCodeExecutable = _claudeBinaryPath;

      if (initOpts && initOpts.dangerouslySkipPermissions) {
        warmupOptions.permissionMode = "bypassPermissions";
        warmupOptions.allowDangerouslySkipPermissions = true;
      }

      var result = {
        models: [],
        defaultModel: "",
        skills: [],
        slashCommands: [],
        fastModeState: null,
        capabilities: {
          thinking: true,
          betas: true,
          rewind: true,
          sessionResume: true,
          promptSuggestions: true,
          elicitation: true,
          fileCheckpointing: true,
          contextCompacting: true,
          toolPolicy: ["ask", "allow-all"],
        },
      };

      try {
        var stream = sdk.query({ prompt: mq, options: warmupOptions });

        for await (var msg of stream) {
          if (msg.type === "system" && msg.subtype === "init") {
            result.skills = msg.skills || [];
            result.defaultModel = msg.model || "";
            result.slashCommands = msg.slash_commands || [];
            result.fastModeState = msg.fast_mode_state || null;

            try {
              var models = await stream.supportedModels();
              result.models = models || [];
              _cachedModels = result.models;
            } catch (e) {
              // supportedModels may fail, models list will be empty
            }

            ac.abort();
            break;
          }
        }
      } catch (e) {
        if (e && e.name !== "AbortError" && !(e.message && e.message.indexOf("aborted") !== -1)) {
          throw e;
        }
      }

      return result;
    },

    /**
     * Return cached list of supported models.
     * @returns {Promise<string[]>}
     */
    supportedModels: function() {
      return Promise.resolve(_cachedModels.slice());
    },

    /**
     * Create a tool server from runtime-agnostic definitions.
     * Synchronous because MCP servers are created during project setup.
     *
     * @param {object} def
     * @param {string} def.name
     * @param {string} def.version
     * @param {Array} def.tools - [{ name, description, inputSchema, handler }]
     * @returns {object|null} Opaque MCP server config
     */
    createToolServer: function(def) {
      var sdk = loadSDKSync();
      if (!sdk || !sdk.createSdkMcpServer || !sdk.tool) {
        console.error("[yoke/claude] SDK not available for createToolServer");
        return null;
      }

      var sdkTools = [];
      for (var i = 0; i < def.tools.length; i++) {
        var t = def.tools[i];
        sdkTools.push(sdk.tool(t.name, t.description, t.inputSchema, t.handler));
      }
      return sdk.createSdkMcpServer({
        name: def.name,
        version: def.version,
        tools: sdkTools,
      });
    },

    /**
     * Create a new query. Returns a QueryHandle (async iterable + control methods).
     *
     * If adapterOptions.CLAUDE.linuxUser is set, creates a worker-based query.
     * Otherwise, creates an in-process query.
     *
     * The caller must push the first message via handle.pushMessage()
     * and then iterate the handle for events.
     *
     * @param {object} queryOpts
     * @param {string}   [queryOpts.cwd]
     * @param {string}   [queryOpts.systemPrompt]
     * @param {string}   [queryOpts.model]
     * @param {string}   [queryOpts.effort]
     * @param {object}   [queryOpts.toolServers]  - mcpServers config object
     * @param {Function} [queryOpts.canUseTool]
     * @param {Function} [queryOpts.onElicitation]
     * @param {string}   [queryOpts.resumeSessionId]
     * @param {AbortController} [queryOpts.abortController] - Phase 3: pass full controller
     * @param {object}   [queryOpts.adapterOptions] - { CLAUDE: { ... } }
     * @returns {Promise<QueryHandle>}
     */
    createQuery: async function(queryOpts) {
      var co = (queryOpts.adapterOptions && queryOpts.adapterOptions.CLAUDE) || {};
      var linuxUser = co.linuxUser;

      // Worker path: OS-level user isolation
      if (linuxUser) {
        return createWorkerQuery(queryOpts, co, linuxUser);
      }

      // In-process path
      var sdk = await loadSDK();
      var mq = createMessageQueue();
      var ac = queryOpts.abortController || new AbortController();

      // Build SDK-specific options
      var sdkOptions = {
        cwd: queryOpts.cwd || _cwd,
        abortController: ac,
      };
      if (_claudeBinaryPath) sdkOptions.pathToClaudeCodeExecutable = _claudeBinaryPath;

      // YOKE standard options -> SDK options
      if (queryOpts.systemPrompt) sdkOptions.systemPrompt = queryOpts.systemPrompt;
      if (queryOpts.model) sdkOptions.model = queryOpts.model;
      if (queryOpts.effort) sdkOptions.effort = queryOpts.effort;
      if (queryOpts.toolServers) sdkOptions.mcpServers = queryOpts.toolServers;
      if (queryOpts.canUseTool) sdkOptions.canUseTool = queryOpts.canUseTool;
      if (queryOpts.onElicitation) sdkOptions.onElicitation = queryOpts.onElicitation;
      if (queryOpts.resumeSessionId) sdkOptions.resume = queryOpts.resumeSessionId;

      // Claude-specific options from adapterOptions.CLAUDE
      if (co.settingSources) sdkOptions.settingSources = co.settingSources;
      if (co.includePartialMessages != null) sdkOptions.includePartialMessages = co.includePartialMessages;
      if (co.enableFileCheckpointing != null) sdkOptions.enableFileCheckpointing = co.enableFileCheckpointing;
      if (co.extraArgs) sdkOptions.extraArgs = co.extraArgs;
      if (co.promptSuggestions != null) sdkOptions.promptSuggestions = co.promptSuggestions;
      if (co.agentProgressSummaries != null) sdkOptions.agentProgressSummaries = co.agentProgressSummaries;
      if (co.thinking) sdkOptions.thinking = co.thinking;
      if (co.betas && co.betas.length > 0) sdkOptions.betas = co.betas;
      if (co.permissionMode) sdkOptions.permissionMode = co.permissionMode;
      if (co.allowDangerouslySkipPermissions) sdkOptions.allowDangerouslySkipPermissions = true;
      if (co.resumeSessionAt) sdkOptions.resumeSessionAt = co.resumeSessionAt;
      if (co.settings) sdkOptions.settings = co.settings;

      var rawQuery = sdk.query({ prompt: mq, options: sdkOptions });
      return createQueryHandle(rawQuery, mq, ac);
    },

    // --- Title generation ---
    generateTitle: async function(messages, opts) {
      console.log("[auto-title/claude] generateTitle called with " + messages.length + " messages");
      var systemPrompt = "You are a title generator. Output only a short title (3-8 words). No quotes, no punctuation at the end, no explanation.";
      var prompt = "Below is a conversation between a user and an AI assistant. Generate a short, descriptive title (3-8 words) that captures the main topic. Reply with ONLY the title, nothing else.\n\n";
      for (var i = 0; i < messages.length; i++) {
        prompt += "User message " + (i + 1) + ": " + messages[i] + "\n";
      }
      var ac = new AbortController();
      console.log("[auto-title/claude] Creating query with model=haiku...");
      var handle = await adapter.createQuery({
        cwd: (opts && opts.cwd) || _cwd,
        systemPrompt: systemPrompt,
        model: "haiku",
        adapterOptions: {
          CLAUDE: {
            settingSources: ["user"],
            permissionMode: "bypassPermissions",
          }
        },
        abortController: ac,
      });
      console.log("[auto-title/claude] Query created, pushing message...");
      handle.pushMessage(prompt);
      var title = "";
      var streamed = false;
      try {
        for await (var msg of handle) {
          if (msg.yokeType === "text_delta" && msg.text) {
            streamed = true;
            title += msg.text;
          } else if (msg.yokeType === "message" && msg.messageRole === "assistant" && !streamed && msg.content) {
            // Fallback: extract text from non-streamed message content
            var content = msg.content;
            if (Array.isArray(content)) {
              for (var ci = 0; ci < content.length; ci++) {
                if (content[ci].type === "text" && content[ci].text) {
                  title += content[ci].text;
                }
              }
            }
          } else if (msg.yokeType === "result") {
            break;
          }
        }
      } finally {
        handle.close();
      }
      console.log("[auto-title/claude] Generated: " + title.substring(0, 80));
      return title.replace(/[\r\n]+/g, " ").replace(/^["'\s]+|["'\s.]+$/g, "").trim();
    },

    // --- Session management ---
    // These delegate to SDK module-level functions.

    getSessionInfo: function(sessionId, sessionOpts) {
      return loadSDK().then(function(sdk) {
        return sdk.getSessionInfo(sessionId, sessionOpts);
      });
    },

    listSessions: function(sessionOpts) {
      return loadSDK().then(function(sdk) {
        return sdk.listSessions(sessionOpts);
      });
    },

    renameSession: function(sessionId, title, sessionOpts) {
      return loadSDK().then(function(sdk) {
        return sdk.renameSession(sessionId, title, sessionOpts);
      });
    },

    forkSession: function(sessionId, sessionOpts) {
      return loadSDK().then(function(sdk) {
        return sdk.forkSession(sessionId, sessionOpts);
      });
    },

    // --- Internal (Phase 3 transition) ---
    // These are NOT part of the YOKE interface. They exist to support
    // incremental migration and will be removed in later phases.

    /**
     * Get the raw SDK module (async). Used by sdk-message-processor.js during transition.
     * @returns {Promise<object>}
     */
    _loadSDK: loadSDK,
  };

  // --- Worker query creation (internal) ---

  async function createWorkerQuery(queryOpts, claudeOpts, linuxUser) {
    var workerCwd = queryOpts.cwd || _cwd;

    // Check for previous worker state (reuse pattern)
    var workerState = claudeOpts._workerState;
    var worker;
    var reusingWorker = false;

    // Wait for previous worker exit if needed
    if (workerState && workerState.exitPromise && !workerState.worker) {
      await Promise.race([
        workerState.exitPromise,
        new Promise(function(resolve) { setTimeout(resolve, 3000); }),
      ]);
    }

    // Reuse existing worker if alive
    if (workerState && workerState.worker && workerState.worker.ready &&
        workerState.worker.process && !workerState.worker.process.killed) {
      worker = workerState.worker;
      reusingWorker = true;
      // Clear old message handlers so they don't fire for the new query
      worker.messageHandlers = [];
      worker._queryEnded = false;
      worker._abortSent = false;
    } else {
      worker = spawnWorker(linuxUser, workerScriptPath, workerCwd);
    }

    // Create the worker query handle (sets up message handler on worker)
    var handle = createWorkerQueryHandle(worker, queryOpts.canUseTool, queryOpts.onElicitation, queryOpts.callMcpTool);

    // Wait for worker to be ready before sending query_start
    if (!reusingWorker) {
      await worker.readyPromise;
    }

    // Build serializable query options (no callbacks, no AbortController)
    var queryOptions = {
      cwd: workerCwd,
    };
    if (claudeOpts.settingSources) queryOptions.settingSources = claudeOpts.settingSources;
    if (claudeOpts.includePartialMessages != null) queryOptions.includePartialMessages = claudeOpts.includePartialMessages;
    if (claudeOpts.enableFileCheckpointing != null) queryOptions.enableFileCheckpointing = claudeOpts.enableFileCheckpointing;
    if (claudeOpts.extraArgs) queryOptions.extraArgs = claudeOpts.extraArgs;
    if (claudeOpts.promptSuggestions != null) queryOptions.promptSuggestions = claudeOpts.promptSuggestions;
    if (claudeOpts.agentProgressSummaries != null) queryOptions.agentProgressSummaries = claudeOpts.agentProgressSummaries;
    if (claudeOpts.thinking) queryOptions.thinking = claudeOpts.thinking;
    if (claudeOpts.betas && claudeOpts.betas.length > 0) queryOptions.betas = claudeOpts.betas;
    if (claudeOpts.permissionMode) queryOptions.permissionMode = claudeOpts.permissionMode;
    if (claudeOpts.allowDangerouslySkipPermissions) queryOptions.allowDangerouslySkipPermissions = true;
    if (claudeOpts.settings) queryOptions.settings = claudeOpts.settings;

    if (queryOpts.toolServerDescriptors) queryOptions.mcpServerDescriptors = queryOpts.toolServerDescriptors;
    if (queryOpts.model) queryOptions.model = queryOpts.model;
    if (queryOpts.effort) queryOptions.effort = queryOpts.effort;
    if (queryOpts.resumeSessionId) queryOptions.resume = queryOpts.resumeSessionId;
    if (claudeOpts.resumeSessionAt) queryOptions.resumeSessionAt = claudeOpts.resumeSessionAt;

    // Send query_start; the caller pushes the initial message via handle.pushMessage()
    // which routes through worker IPC.
    // NOTE: We do NOT send query_start with a prompt here. The caller (sdk-bridge)
    // will push the initial message and the worker receives it via push_message.
    // Instead, we send query_start with no prompt; the worker starts a query with
    // the message queue, and the first push_message will arrive.
    worker.send({
      type: "query_start",
      prompt: null,
      options: queryOptions,
      singleTurn: !!claudeOpts.singleTurn,
      originalHome: claudeOpts.originalHome || null,
      projectPath: claudeOpts.projectPath || null,
      _perfT0: claudeOpts._perfT0 || Date.now(),
    });

    return handle;
  }

  // --- Worker warmup (internal) ---

  async function initViaWorker(linuxUser, initOpts) {
    var worker;
    try {
      worker = spawnWorker(linuxUser, workerScriptPath, (initOpts && initOpts.cwd) || _cwd);
    } catch (e) {
      throw new Error("Failed to spawn warmup worker for " + linuxUser + ": " + (e.message || e));
    }

    var result = await new Promise(function(resolve, reject) {
      var warmupDone = false;

      worker.onMessage(function(msg) {
        if (msg.type === "warmup_done" && !warmupDone) {
          warmupDone = true;
          var r = msg.result || {};
          resolve({
            models: r.models || [],
            defaultModel: r.model || "",
            skills: r.skills || [],
            slashCommands: r.slashCommands || [],
            fastModeState: r.fastModeState || null,
            capabilities: {
              thinking: true,
              betas: true,
              rewind: true,
              sessionResume: true,
              promptSuggestions: true,
              elicitation: true,
              fileCheckpointing: true,
              contextCompacting: true,
              toolPolicy: ["ask", "allow-all"],
            },
          });
          worker.kill();
        } else if (msg.type === "warmup_error" && !warmupDone) {
          warmupDone = true;
          worker.kill();
          reject(new Error(msg.error || "Warmup failed"));
        }
      });

      // Handle case where worker fails to connect
      worker.readyPromise.catch(function(e) {
        if (!warmupDone) {
          warmupDone = true;
          cleanupWorker(worker);
          reject(new Error("Warmup worker failed to connect: " + (e.message || e)));
        }
      });
    });

    // Wait for worker to be ready, then send warmup command
    // This is inside the Promise above, but we need readyPromise first
    // Actually, let's restructure: wait for ready, then send warmup
    // The Promise constructor above registers message handlers, but we need
    // to await readyPromise separately.

    // Rethinking: the Promise above is returned directly. We need to await
    // readyPromise before sending warmup. Let me use a different approach.

    return result;
  }

  // Override initViaWorker to properly sequence ready + warmup
  adapter.init = async function(initOpts) {
    var linuxUser = initOpts && initOpts.linuxUser;
    if (!linuxUser) {
      // In-process warmup (original code)
      var sdk = await loadSDK();
      var ac = new AbortController();
      var mq = createMessageQueue();
      mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
      mq.end();

      var warmupOptions = {
        cwd: (initOpts && initOpts.cwd) || _cwd,
        settingSources: ["user", "project", "local"],
        abortController: ac,
        settings: { disableAllHooks: true },
      };
      if (_claudeBinaryPath) warmupOptions.pathToClaudeCodeExecutable = _claudeBinaryPath;

      if (initOpts && initOpts.dangerouslySkipPermissions) {
        warmupOptions.permissionMode = "bypassPermissions";
        warmupOptions.allowDangerouslySkipPermissions = true;
      }

      var result = {
        models: [],
        defaultModel: "",
        skills: [],
        slashCommands: [],
        fastModeState: null,
        capabilities: {
          thinking: true,
          betas: true,
          rewind: true,
          sessionResume: true,
          promptSuggestions: true,
          elicitation: true,
          fileCheckpointing: true,
          contextCompacting: true,
          toolPolicy: ["ask", "allow-all"],
        },
      };

      try {
        var stream = sdk.query({ prompt: mq, options: warmupOptions });

        for await (var msg of stream) {
          if (msg.type === "system" && msg.subtype === "init") {
            result.skills = msg.skills || [];
            result.defaultModel = msg.model || "";
            result.slashCommands = msg.slash_commands || [];
            result.fastModeState = msg.fast_mode_state || null;

            try {
              var models = await stream.supportedModels();
              result.models = models || [];
              _cachedModels = result.models;
            } catch (e) {
              // supportedModels may fail, models list will be empty
            }

            ac.abort();
            break;
          }
        }
      } catch (e) {
        if (e && e.name !== "AbortError" && !(e.message && e.message.indexOf("aborted") !== -1)) {
          throw e;
        }
      }

      return result;
    }

    // Worker-based warmup
    var worker;
    var workerCwd = (initOpts && initOpts.cwd) || _cwd;
    try {
      worker = spawnWorker(linuxUser, workerScriptPath, workerCwd);
    } catch (e) {
      throw new Error("Failed to spawn warmup worker for " + linuxUser + ": " + (e.message || e));
    }

    try {
      await worker.readyPromise;
    } catch (e) {
      cleanupWorker(worker);
      throw new Error("Warmup worker failed to connect: " + (e.message || e));
    }

    var warmupOptions = { cwd: workerCwd, settingSources: ["user", "project", "local"], settings: { disableAllHooks: true } };
    if (_claudeBinaryPath) warmupOptions.pathToClaudeCodeExecutable = _claudeBinaryPath;
    if (initOpts && initOpts.dangerouslySkipPermissions) {
      warmupOptions.permissionMode = "bypassPermissions";
      warmupOptions.allowDangerouslySkipPermissions = true;
    }

    return new Promise(function(resolve, reject) {
      var warmupDone = false;

      worker.onMessage(function(msg) {
        if (msg.type === "warmup_done" && !warmupDone) {
          warmupDone = true;
          var r = msg.result || {};
          resolve({
            models: r.models || [],
            defaultModel: r.model || "",
            skills: r.skills || [],
            slashCommands: r.slashCommands || [],
            fastModeState: r.fastModeState || null,
            capabilities: {
              thinking: true,
              betas: true,
              rewind: true,
              sessionResume: true,
              promptSuggestions: true,
              elicitation: true,
              fileCheckpointing: true,
              contextCompacting: true,
              toolPolicy: ["ask", "allow-all"],
            },
          });
          worker.kill();
        } else if (msg.type === "warmup_error" && !warmupDone) {
          warmupDone = true;
          worker.kill();
          reject(new Error(msg.error || "Warmup failed"));
        }
      });

      worker.send({ type: "warmup", options: warmupOptions });
    });
  };

  return adapter;
}

module.exports = {
  createClaudeAdapter: createClaudeAdapter,
  createMessageQueue: createMessageQueue,
};
