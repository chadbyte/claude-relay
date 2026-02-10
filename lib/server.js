const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { WebSocketServer } = require("ws");

const publicDir = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  var urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";

  var filePath = path.join(publicDir, urlPath);

  // Prevent path traversal
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  try {
    var content = fs.readFileSync(filePath);
    var ext = path.extname(filePath);
    var mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime + "; charset=utf-8" });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function createServer(cwd) {
  const project = path.basename(cwd);

  // --- Multi-session state ---
  let nextLocalId = 1;
  let sessions = new Map();     // localId -> session object
  let activeSessionId = null;   // currently active local ID
  let slashCommands = null;     // shared across sessions
  let activeWs = null;

  // --- Session persistence ---
  var sessionsDir = path.join(cwd, ".claude-relay", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });

  function sessionFilePath(cliSessionId) {
    return path.join(sessionsDir, cliSessionId + ".jsonl");
  }

  function saveSessionFile(session) {
    if (!session.cliSessionId) return;
    var meta = JSON.stringify({
      type: "meta",
      localId: session.localId,
      cliSessionId: session.cliSessionId,
      title: session.title,
      createdAt: session.createdAt,
    });
    var lines = [meta];
    for (var i = 0; i < session.history.length; i++) {
      lines.push(JSON.stringify(session.history[i]));
    }
    fs.writeFileSync(sessionFilePath(session.cliSessionId), lines.join("\n") + "\n");
  }

  function appendToSessionFile(session, obj) {
    if (!session.cliSessionId) return;
    fs.appendFileSync(sessionFilePath(session.cliSessionId), JSON.stringify(obj) + "\n");
  }

  function loadSessions() {
    var files;
    try { files = fs.readdirSync(sessionsDir); } catch { return; }

    var loaded = [];
    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith(".jsonl")) continue;
      var content;
      try { content = fs.readFileSync(path.join(sessionsDir, files[i]), "utf8"); } catch { continue; }
      var lines = content.trim().split("\n");
      if (lines.length === 0) continue;

      var meta;
      try { meta = JSON.parse(lines[0]); } catch { continue; }
      if (meta.type !== "meta" || !meta.cliSessionId) continue;

      var history = [];
      for (var j = 1; j < lines.length; j++) {
        try { history.push(JSON.parse(lines[j])); } catch {}
      }

      loaded.push({ meta: meta, history: history });
    }

    loaded.sort(function(a, b) { return a.meta.createdAt - b.meta.createdAt; });

    for (var i = 0; i < loaded.length; i++) {
      var m = loaded[i].meta;
      var localId = nextLocalId++;
      var session = {
        localId: localId,
        proc: null,
        cliSessionId: m.cliSessionId,
        buffer: "",
        blocks: {},
        sentToolResults: {},
        isProcessing: false,
        title: m.title || "",
        createdAt: m.createdAt || Date.now(),
        history: loaded[i].history,
      };
      sessions.set(localId, session);
    }
  }

  // Load persisted sessions from disk
  loadSessions();

  function send(obj) {
    if (activeWs && activeWs.readyState === 1) {
      activeWs.send(JSON.stringify(obj));
    }
  }

  // Send a message and record it in session history for replay on reconnect
  function sendAndRecord(session, obj) {
    session.history.push(obj);
    appendToSessionFile(session, obj);
    if (session.localId === activeSessionId) {
      send(obj);
    }
  }

  function getActiveSession() {
    return sessions.get(activeSessionId) || null;
  }

  function broadcastSessionList() {
    send({
      type: "session_list",
      sessions: [...sessions.values()].map(function(s) {
        return {
          id: s.localId,
          title: s.title || "New Session",
          active: s.localId === activeSessionId,
          isProcessing: s.isProcessing,
        };
      }),
    });
  }

  function createSession() {
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      proc: null,
      cliSessionId: null,
      buffer: "",
      blocks: {},
      sentToolResults: {},
      isProcessing: false,
      title: "",
      createdAt: Date.now(),
      history: [],
    };
    sessions.set(localId, session);
    spawnProcess(session);
    switchSession(localId);
    return session;
  }

  function replayHistory(session) {
    for (var i = 0; i < session.history.length; i++) {
      send(session.history[i]);
    }
  }

  function switchSession(localId) {
    var session = sessions.get(localId);
    if (!session) return;

    activeSessionId = localId;
    send({ type: "session_switched", id: localId });
    broadcastSessionList();
    replayHistory(session);

    if (session.isProcessing) {
      send({ type: "status", status: "processing" });
    }
  }

  function deleteSession(localId) {
    var session = sessions.get(localId);
    if (!session) return;

    if (session.proc) {
      try { session.proc.kill("SIGTERM"); } catch(e) {}
      session.proc = null;
    }

    if (session.cliSessionId) {
      try { fs.unlinkSync(sessionFilePath(session.cliSessionId)); } catch(e) {}
    }

    sessions.delete(localId);

    if (activeSessionId === localId) {
      var remaining = [...sessions.keys()];
      if (remaining.length > 0) {
        switchSession(remaining[remaining.length - 1]);
      } else {
        createSession();
      }
    } else {
      broadcastSessionList();
    }
  }

  function processLine(session, line) {
    if (!line.trim()) return;

    var parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (parsed.session_id && !session.cliSessionId) {
      session.cliSessionId = parsed.session_id;
      saveSessionFile(session);
    } else if (parsed.session_id) {
      session.cliSessionId = parsed.session_id;
    }

    // Cache slash_commands from CLI init message
    if (parsed.type === "system" && parsed.subtype === "init" && parsed.slash_commands) {
      slashCommands = parsed.slash_commands;
      send({ type: "slash_commands", commands: slashCommands });
    }

    if (parsed.type === "stream_event" && parsed.event) {
      var evt = parsed.event;

      if (evt.type === "content_block_start") {
        var block = evt.content_block;
        var idx = evt.index;

        if (block.type === "tool_use") {
          session.blocks[idx] = { type: "tool_use", id: block.id, name: block.name, inputJson: "" };
          sendAndRecord(session, { type: "tool_start", id: block.id, name: block.name });
        } else if (block.type === "thinking") {
          session.blocks[idx] = { type: "thinking", thinkingText: "" };
          sendAndRecord(session, { type: "thinking_start" });
        } else if (block.type === "text") {
          session.blocks[idx] = { type: "text" };
        }
      }

      if (evt.type === "content_block_delta" && evt.delta) {
        var idx = evt.index;

        if (evt.delta.type === "text_delta" && typeof evt.delta.text === "string") {
          sendAndRecord(session, { type: "delta", text: evt.delta.text });
        } else if (evt.delta.type === "input_json_delta" && session.blocks[idx]) {
          session.blocks[idx].inputJson += evt.delta.partial_json;
        } else if (evt.delta.type === "thinking_delta" && session.blocks[idx]) {
          session.blocks[idx].thinkingText += evt.delta.thinking;
          sendAndRecord(session, { type: "thinking_delta", text: evt.delta.thinking });
        }
      }

      if (evt.type === "content_block_stop") {
        var idx = evt.index;
        var block = session.blocks[idx];

        if (block && block.type === "tool_use") {
          var input = {};
          try { input = JSON.parse(block.inputJson); } catch {}
          sendAndRecord(session, { type: "tool_executing", id: block.id, name: block.name, input: input });
        } else if (block && block.type === "thinking") {
          sendAndRecord(session, { type: "thinking_stop" });
        }

        delete session.blocks[idx];
      }

    } else if ((parsed.type === "assistant" || parsed.type === "user") && parsed.message && parsed.message.content) {
      var content = parsed.message.content;
      for (var i = 0; i < content.length; i++) {
        var block = content[i];
        if (block.type === "tool_result" && !session.sentToolResults[block.tool_use_id]) {
          var resultText = "";
          if (typeof block.content === "string") {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = block.content
              .filter(function(c) { return c.type === "text"; })
              .map(function(c) { return c.text; })
              .join("\n");
          }
          session.sentToolResults[block.tool_use_id] = true;
          sendAndRecord(session, {
            type: "tool_result",
            id: block.tool_use_id,
            content: resultText,
            is_error: block.is_error || false,
          });
        }
      }

    } else if (parsed.type === "result") {
      session.blocks = {};
      session.sentToolResults = {};
      session.isProcessing = false;
      sendAndRecord(session, {
        type: "result",
        cost: parsed.total_cost_usd,
        duration: parsed.duration_ms,
        sessionId: parsed.session_id,
      });
      sendAndRecord(session, { type: "done", code: 0 });
      broadcastSessionList();
    }
  }

  function spawnProcess(session) {
    var args = [
      "-p",
      "--verbose",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--include-partial-messages",
    ];

    if (session.cliSessionId) {
      args.push("--resume", session.cliSessionId);
    }

    session.buffer = "";
    session.blocks = {};
    session.sentToolResults = {};

    session.proc = spawn("claude", args, {
      cwd: cwd,
      env: Object.assign({}, process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    session.proc.stdout.on("data", function(chunk) {
      session.buffer += chunk.toString();
      var lines = session.buffer.split("\n");
      session.buffer = lines.pop();

      for (var i = 0; i < lines.length; i++) {
        processLine(session, lines[i]);
      }
    });

    session.proc.stderr.on("data", function(chunk) {
      var errText = chunk.toString();
      if (errText.includes("Error") || errText.includes("error")) {
        if (session.localId === activeSessionId) {
          send({ type: "stderr", text: errText });
        }
      }
    });

    session.proc.on("close", function(code) {
      if (session.buffer.trim()) {
        processLine(session, session.buffer);
        session.buffer = "";
      }

      session.proc = null;
      session.blocks = {};

      if (session.isProcessing) {
        session.isProcessing = false;
        sendAndRecord(session, { type: "error", text: "Claude process exited unexpectedly (code " + code + ")" });
        sendAndRecord(session, { type: "done", code: code || 1 });
        broadcastSessionList();
      }
    });

    session.proc.on("error", function(err) {
      session.proc = null;
      session.isProcessing = false;
      sendAndRecord(session, { type: "error", text: "Failed to spawn claude: " + err.message });
      sendAndRecord(session, { type: "done", code: 1 });
      broadcastSessionList();
    });
  }

  function writeMessage(session, text, images) {
    var content = [];

    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: images[i].mediaType,
            data: images[i].data,
          },
        });
      }
    }

    if (text) {
      content.push({ type: "text", text: text });
    }

    var msg = {
      type: "user",
      session_id: "",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: content,
      },
    };
    session.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  function writeToolResult(session, toolUseId, resultText) {
    var msg = {
      type: "user",
      session_id: "",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: toolUseId,
          content: resultText,
        }],
      },
    };
    session.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  // --- Spawn initial session only if no persisted sessions ---
  if (sessions.size === 0) {
    createSession();
  } else {
    // Activate the most recent session
    var lastSession = [...sessions.values()].pop();
    activeSessionId = lastSession.localId;
  }

  // --- HTTP server ---
  var server = http.createServer(function(req, res) {
    if (req.method === "GET" && req.url === "/info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ cwd: cwd, project: project }));
      return;
    }

    if (req.method === "GET") {
      if (serveStatic(req, res)) return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  // --- WebSocket ---
  var wss = new WebSocketServer({ server: server });

  wss.on("connection", function(ws) {
    activeWs = ws;

    // Send cached state
    send({ type: "info", cwd: cwd, project: project });
    if (slashCommands) {
      send({ type: "slash_commands", commands: slashCommands });
    }
    broadcastSessionList();

    // Restore active session
    var active = getActiveSession();
    if (active) {
      send({ type: "session_switched", id: active.localId });
      replayHistory(active);
      if (active.isProcessing) {
        send({ type: "status", status: "processing" });
      }
    }

    ws.on("message", function(raw) {
      var msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "new_session") {
        createSession();
        return;
      }

      if (msg.type === "switch_session") {
        if (msg.id && sessions.has(msg.id)) {
          switchSession(msg.id);
        }
        return;
      }

      if (msg.type === "delete_session") {
        if (msg.id && sessions.has(msg.id)) {
          deleteSession(msg.id);
        }
        return;
      }

      if (msg.type === "ask_user_response") {
        var session = getActiveSession();
        if (!session || !session.proc) return;

        var toolId = msg.toolId;
        var answers = msg.answers || {};
        var resultText = JSON.stringify({ answers: answers });

        writeToolResult(session, toolId, resultText);
        return;
      }

      if (msg.type !== "message") return;
      if (!msg.text && (!msg.images || msg.images.length === 0)) return;

      var session = getActiveSession();
      if (!session) return;

      if (session.isProcessing) {
        send({ type: "error", text: "Still processing previous message. Please wait." });
        return;
      }

      session.isProcessing = true;
      session.sentToolResults = {};

      // Record user message in history for replay (without base64 data to save space)
      var userMsg = { type: "user_message", text: msg.text || "" };
      if (msg.images && msg.images.length > 0) {
        userMsg.imageCount = msg.images.length;
      }
      session.history.push(userMsg);
      appendToSessionFile(session, userMsg);
      send({ type: "status", status: "processing" });

      // Set title from first user message
      if (!session.title) {
        session.title = (msg.text || "Image").substring(0, 50);
        saveSessionFile(session);
        broadcastSessionList();
      }

      // Respawn if process died
      if (!session.proc) {
        spawnProcess(session);
      }

      writeMessage(session, msg.text || "", msg.images);
      broadcastSessionList();
    });

    ws.on("close", function() {
      if (activeWs === ws) activeWs = null;
      // Don't kill procs — they persist across reconnects
    });
  });

  return server;
}

module.exports = { createServer };
