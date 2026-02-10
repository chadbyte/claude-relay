const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

// SDK loaded dynamically (ESM module)
var sdkModule = null;
function getSDK() {
  if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");
  return sdkModule;
}

// Async message queue for streaming input to SDK
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
        }
      };
    }
  };
}

const publicDir = path.join(__dirname, "public");

function generateAuthToken(pin) {
  return crypto.createHash("sha256").update("claude-relay:" + pin).digest("hex");
}

function parseCookies(req) {
  var cookies = {};
  var header = req.headers.cookie || "";
  header.split(";").forEach(function(part) {
    var pair = part.trim().split("=");
    if (pair.length === 2) cookies[pair[0]] = pair[1];
  });
  return cookies;
}

function isAuthed(req, authToken) {
  if (!authToken) return true;
  var cookies = parseCookies(req);
  return cookies["relay_auth"] === authToken;
}

function pinPageHtml() {
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<title>Claude Relay</title>' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{background:#2F2E2B;color:#E8E5DE;font-family:system-ui,-apple-system,sans-serif;' +
    'min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.c{max-width:320px;width:100%;text-align:center}' +
    'h1{color:#DA7756;font-size:22px;margin-bottom:8px}' +
    '.sub{color:#908B81;font-size:14px;margin-bottom:32px}' +
    'input{width:100%;background:#393733;border:1px solid #3E3C37;border-radius:12px;' +
    'color:#E8E5DE;font-size:24px;letter-spacing:12px;text-align:center;padding:14px;' +
    'outline:none;font-family:inherit;-webkit-text-security:disc}' +
    'input:focus{border-color:#DA7756}' +
    'input::placeholder{letter-spacing:0;font-size:15px;color:#6D6860}' +
    '.err{color:#E5534B;font-size:13px;margin-top:12px;min-height:1.3em}' +
    '</style></head><body><div class="c">' +
    '<h1>Claude Relay</h1>' +
    '<div class="sub">Enter PIN to continue</div>' +
    '<input id="pin" type="tel" maxlength="6" placeholder="6-digit PIN" autocomplete="off" inputmode="numeric">' +
    '<div class="err" id="err"></div>' +
    '<script>' +
    'var inp=document.getElementById("pin"),err=document.getElementById("err");' +
    'inp.focus();' +
    'inp.addEventListener("input",function(){' +
    'if(inp.value.length===6){' +
    'fetch("/auth",{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({pin:inp.value})})' +
    '.then(function(r){if(r.ok)location.reload();else{err.textContent="Wrong PIN";inp.value="";inp.focus()}})' +
    '.catch(function(){err.textContent="Connection error"})}});' +
    '</script></div></body></html>';
}

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

function setupPageHtml(httpsUrl) {
  var httpUrl = "/app";
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<title>Claude Relay</title>' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{background:#2F2E2B;color:#E8E5DE;font-family:system-ui,-apple-system,sans-serif;min-height:100dvh;display:flex;justify-content:center;padding:env(safe-area-inset-top,0) 20px 40px}' +
    '.c{max-width:480px;width:100%;text-align:center;padding-top:25dvh}' +
    '.c.show-setup{padding-top:40px}' +
    'h1{color:#DA7756;font-size:24px;margin:0 0 6px}' +
    // Loading state
    '#loading{display:flex;flex-direction:column;align-items:center;gap:20px;padding:32px 0}' +
    '.glow{width:100px;height:100px;border-radius:50%;' +
    'background:radial-gradient(circle,rgba(218,119,86,0.15) 0%,transparent 70%);' +
    'display:flex;align-items:center;justify-content:center;' +
    'animation:breathe 3s ease-in-out infinite}' +
    '.dot{width:12px;height:12px;border-radius:50%;background:#DA7756;' +
    'animation:pulse 2s ease-in-out infinite}' +
    '@keyframes breathe{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.2);opacity:1}}' +
    '@keyframes pulse{0%,100%{box-shadow:0 0 15px rgba(218,119,86,0.3)}50%{box-shadow:0 0 35px rgba(218,119,86,0.7)}}' +
    '.loading-text{color:#908B81;font-size:14px}' +
    // Setup section
    '#setup{display:none;text-align:left}' +
    '.explain{background:rgba(218,119,86,0.06);border:1px solid rgba(218,119,86,0.15);border-radius:12px;padding:16px 18px;margin-bottom:28px;text-align:left}' +
    '.explain-title{font-size:14px;font-weight:600;color:#DA7756;margin-bottom:6px}' +
    '.explain-text{font-size:13px;line-height:1.6;color:#908B81}' +
    '.step{display:flex;gap:14px;margin-bottom:20px}' +
    '.num{width:28px;height:28px;border-radius:50%;background:#DA7756;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;margin-top:2px}' +
    '.txt{font-size:15px;line-height:1.6}' +
    '.txt .note{font-size:13px;color:#6D6860;margin-top:4px}' +
    'a.btn{display:inline-block;background:#DA7756;color:#fff;text-decoration:none;padding:12px 28px;border-radius:12px;font-weight:600;font-size:15px;margin:8px 0;text-align:center}' +
    'a.btn.outline{background:transparent;border:1px solid #DA7756;color:#DA7756}' +
    '.sep{border:none;border-top:1px solid #3E3C37;margin:28px 0}' +
    '.skip{display:block;text-align:center;color:#6D6860;font-size:13px;text-decoration:none;margin-top:16px}' +
    '.skip:hover{color:#908B81}' +
    '</style></head><body><div class="c" id="container">' +
    '<h1>Claude Relay</h1>' +
    '<div id="loading"><div class="glow"><div class="dot"></div></div>' +
    '<div class="loading-text">Connecting...</div></div>' +
    '<div id="setup">' +
    '<div class="explain">' +
    '<div class="explain-title">Secure your connection</div>' +
    '<div class="explain-text">' +
    'Install a certificate to encrypt all traffic between this device and the relay. ' +
    'Without it, anyone on the same network could intercept your data.<br><br>' +
    'The certificate is generated locally on your machine and does not grant any additional access.' +
    '</div></div>' +
    '<div class="step"><div class="num">1</div><div class="txt">' +
    'Download the certificate.<br>' +
    '<a class="btn" href="/ca/download">Download Certificate</a>' +
    '</div></div>' +
    '<div id="steps-ios">' +
    '<div class="step"><div class="num">2</div><div class="txt">' +
    'Open <b>Settings</b> and tap the <b>Profile Downloaded</b> banner to install.' +
    '<div class="note">If the banner is gone: Settings &gt; General &gt; VPN &amp; Device Management</div>' +
    '</div></div>' +
    '<div class="step"><div class="num">3</div><div class="txt">' +
    'Go to <b>Settings &gt; General &gt; About &gt; Certificate Trust Settings</b> and enable full trust.' +
    '</div></div></div>' +
    '<div id="steps-android" style="display:none">' +
    '<div class="step"><div class="num">2</div><div class="txt">' +
    'Open the downloaded file, or go to <b>Settings &gt; Security &gt; Install a certificate &gt; CA certificate</b>.' +
    '<div class="note">Path may vary by device. Search "certificate" in Settings if needed.</div>' +
    '</div></div></div>' +
    '<hr class="sep">' +
    '<a class="btn" href="' + httpsUrl + '">Open Claude Relay</a>' +
    '<a class="skip" href="' + httpUrl + '">Skip, use without HTTPS</a>' +
    '</div>' +
    '<script>' +
    'if(/Android/i.test(navigator.userAgent)){' +
    'document.getElementById("steps-ios").style.display="none";' +
    'document.getElementById("steps-android").style.display="block"}' +
    'var show=function(){document.getElementById("loading").style.display="none";' +
    'document.getElementById("setup").style.display="block";' +
    'document.getElementById("container").classList.add("show-setup")};' +
    'var c=new AbortController();setTimeout(function(){c.abort()},2000);' +
    'fetch("' + httpsUrl + '/info",{signal:c.signal})' +
    '.then(function(){location.replace("' + httpsUrl + '")})' +
    '.catch(show);' +
    '</script>' +
    '</div></body></html>';
}

function createServer(cwd, tlsOptions, caPath, pin, mainPort) {
  var authToken = pin ? generateAuthToken(pin) : null;
  const project = path.basename(cwd);

  // --- Multi-session state ---
  let nextLocalId = 1;
  let sessions = new Map();     // localId -> session object
  let activeSessionId = null;   // currently active local ID
  let slashCommands = null;     // shared across sessions
  let skillNames = null;        // Claude-only skills to filter from slash menu
  let clients = new Set();

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
        queryInstance: null,
        messageQueue: null,
        cliSessionId: m.cliSessionId,
        blocks: {},
        sentToolResults: {},
        pendingPermissions: {},
        pendingAskUser: {},
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
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  function sendTo(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function broadcastClientCount() {
    send({ type: "client_count", count: clients.size });
  }

  function sendToOthers(sender, obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws !== sender && ws.readyState === 1) ws.send(data);
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
      queryInstance: null,
      messageQueue: null,
      cliSessionId: null,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      isProcessing: false,
      title: "",
      createdAt: Date.now(),
      history: [],
    };
    sessions.set(localId, session);
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
    send({ type: "session_switched", id: localId, cliSessionId: session.cliSessionId || null });
    broadcastSessionList();
    replayHistory(session);

    if (session.isProcessing) {
      send({ type: "status", status: "processing" });
    }

    // Re-send any pending permission requests
    var pendingIds = Object.keys(session.pendingPermissions);
    for (var i = 0; i < pendingIds.length; i++) {
      var p = session.pendingPermissions[pendingIds[i]];
      send({
        type: "permission_request_pending",
        requestId: p.requestId,
        toolName: p.toolName,
        toolInput: p.toolInput,
        toolUseId: p.toolUseId,
        decisionReason: p.decisionReason,
      });
    }
  }

  function deleteSession(localId) {
    var session = sessions.get(localId);
    if (!session) return;

    if (session.abortController) {
      try { session.abortController.abort(); } catch(e) {}
    }
    if (session.messageQueue) {
      try { session.messageQueue.end(); } catch(e) {}
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

  // --- SDK message processing ---

  function processSDKMessage(session, parsed) {
    // Extract session_id from any message that carries it
    if (parsed.session_id && !session.cliSessionId) {
      session.cliSessionId = parsed.session_id;
      saveSessionFile(session);
      if (session.localId === activeSessionId) {
        send({ type: "session_id", cliSessionId: session.cliSessionId });
      }
    } else if (parsed.session_id) {
      session.cliSessionId = parsed.session_id;
    }

    // Cache slash_commands from CLI init message
    if (parsed.type === "system" && parsed.subtype === "init") {
      if (parsed.skills) {
        skillNames = new Set(parsed.skills);
      }
      if (parsed.slash_commands) {
        slashCommands = parsed.slash_commands.filter(function(name) {
          return !skillNames || !skillNames.has(name);
        });
        send({ type: "slash_commands", commands: slashCommands });
      }
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

      // Check for local slash command output in user messages
      if (parsed.type === "user") {
        var fullText = "";
        if (typeof content === "string") {
          fullText = content;
        } else if (Array.isArray(content)) {
          fullText = content
            .filter(function(c) { return c.type === "text"; })
            .map(function(c) { return c.text; })
            .join("\n");
        }
        if (fullText.indexOf("local-command-stdout") !== -1) {
          var m = fullText.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
          if (m) {
            sendAndRecord(session, { type: "slash_command_result", text: m[1].trim() });
          }
        }
      }

      if (Array.isArray(content)) {
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
      }

    } else if (parsed.type === "result") {
      session.blocks = {};
      session.sentToolResults = {};
      session.pendingPermissions = {};
      session.pendingAskUser = {};
      session.isProcessing = false;
      sendAndRecord(session, {
        type: "result",
        cost: parsed.total_cost_usd,
        duration: parsed.duration_ms,
        sessionId: parsed.session_id,
      });
      sendAndRecord(session, { type: "done", code: 0 });
      broadcastSessionList();

    } else if (parsed.type && parsed.type !== "system" && parsed.type !== "user") {
    }
  }

  // --- SDK query lifecycle ---

  function handleCanUseTool(session, toolName, input, opts) {
    // AskUserQuestion: wait for user answers via WebSocket
    if (toolName === "AskUserQuestion") {
      return new Promise(function(resolve) {
        session.pendingAskUser[opts.toolUseID] = {
          resolve: resolve,
          input: input,
        };
        // The client sees this tool via stream_event content blocks
        // and renders the AskUserQuestion UI automatically.
        // We just wait for the answer to come back.
        if (opts.signal) {
          opts.signal.addEventListener("abort", function() {
            delete session.pendingAskUser[opts.toolUseID];
            resolve({ behavior: "deny", message: "Cancelled" });
          });
        }
      });
    }

    // Regular tool permission request: send to client and wait
    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      session.pendingPermissions[requestId] = {
        resolve: resolve,
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
      };

      var permMsg = {
        type: "permission_request",
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
      };
      sendAndRecord(session, permMsg);

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          delete session.pendingPermissions[requestId];
          sendAndRecord(session, { type: "permission_cancel", requestId: requestId });
          resolve({ behavior: "deny", message: "Request cancelled" });
        });
      }
    });
  }

  async function processQueryStream(session) {
    try {
      for await (var msg of session.queryInstance) {
        processSDKMessage(session, msg);
      }
    } catch (err) {
      if (session.isProcessing) {
        session.isProcessing = false;
        if (err.name === "AbortError" || (session.abortController && session.abortController.signal.aborted)) {
          sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
          sendAndRecord(session, { type: "done", code: 0 });
        } else {
          sendAndRecord(session, { type: "error", text: "Claude process error: " + err.message });
          sendAndRecord(session, { type: "done", code: 1 });
        }
        broadcastSessionList();
      }
    } finally {
      session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
    }
  }

  async function startQuery(session, text, images) {
    var sdk = await getSDK();

    session.messageQueue = createMessageQueue();
    session.blocks = {};
    session.sentToolResults = {};

    // Build initial user message
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }

    session.messageQueue.push({
      type: "user",
      message: { role: "user", content: content },
    });

    session.abortController = new AbortController();

    var queryOptions = {
      cwd: cwd,
      includePartialMessages: true,
      extraArgs: { "replay-user-messages": null },
      abortController: session.abortController,
      canUseTool: function(toolName, input, opts) {
        return handleCanUseTool(session, toolName, input, opts);
      },
    };

    if (session.cliSessionId) {
      queryOptions.resume = session.cliSessionId;
    }

    session.queryInstance = sdk.query({
      prompt: session.messageQueue,
      options: queryOptions,
    });

    processQueryStream(session).catch(function(err) {
    });
  }

  function pushMessage(session, text, images) {
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }
    session.messageQueue.push({
      type: "user",
      message: { role: "user", content: content },
    });
  }

  // --- Spawn initial session only if no persisted sessions ---
  if (sessions.size === 0) {
    createSession();
  } else {
    // Activate the most recent session
    var lastSession = [...sessions.values()].pop();
    activeSessionId = lastSession.localId;
  }

  // --- App HTTP handler ---
  var pinPage = pinPageHtml();

  var appHandler = function(req, res) {
    // PIN auth endpoint
    if (req.method === "POST" && req.url === "/auth") {
      var body = "";
      req.on("data", function(chunk) { body += chunk; });
      req.on("end", function() {
        try {
          var data = JSON.parse(body);
          if (authToken && generateAuthToken(data.pin) === authToken) {
            res.writeHead(200, {
              "Set-Cookie": "relay_auth=" + authToken + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000",
              "Content-Type": "application/json",
            });
            res.end('{"ok":true}');
          } else {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end('{"ok":false}');
          }
        } catch (e) {
          res.writeHead(400);
          res.end("Bad request");
        }
      });
      return;
    }

    // Allow /info without auth (used by setup page HTTPS check)
    if (req.method === "GET" && req.url === "/info") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ cwd: cwd, project: project }));
      return;
    }

    // Check auth for everything else
    if (!isAuthed(req, authToken)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pinPage);
      return;
    }

    if (req.method === "GET") {
      if (serveStatic(req, res)) return;
    }

    res.writeHead(404);
    res.end("Not found");
  };

  // --- Server setup ---
  // Entry server (HTTP) always listens on the main branded port.
  // When TLS is available, HTTPS runs on port+1 and the entry server
  // auto-redirects (via setup page) once the CA is trusted.
  var entryServer;
  var httpsServer = null;
  var wssTargets;

  if (tlsOptions) {
    var httpsPort = mainPort + 1;
    httpsServer = require("https").createServer(tlsOptions, appHandler);

    var caContent = caPath ? fs.readFileSync(caPath) : null;
    entryServer = http.createServer(function(req, res) {
      // CA certificate download
      if (req.url === "/ca/download" && caContent) {
        res.writeHead(200, {
          "Content-Type": "application/x-pem-file",
          "Content-Disposition": 'attachment; filename="claude-relay-ca.pem"',
        });
        res.end(caContent);
        return;
      }
      // Certificate setup page
      if (req.url === "/setup") {
        var host = req.headers.host || "localhost";
        var hostname = host.split(":")[0];
        var httpsUrl = "https://" + hostname + ":" + httpsPort;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(setupPageHtml(httpsUrl));
        return;
      }
      // HTTPS info endpoint for client banner
      if (req.url === "/https-info") {
        var host = req.headers.host || "localhost";
        var hostname = host.split(":")[0];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          httpsPort: httpsPort,
          httpsUrl: "https://" + hostname + ":" + httpsPort,
          setupUrl: "/setup",
        }));
        return;
      }
      // Serve app directly over HTTP
      appHandler(req, res);
    });

    wssTargets = [httpsServer, entryServer];
  } else {
    entryServer = http.createServer(appHandler);
    wssTargets = [entryServer];
  }

  // --- WebSocket ---
  var wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(req, socket, head) {
    if (!isAuthed(req, authToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, function(ws) {
      wss.emit("connection", ws, req);
    });
  }

  for (var i = 0; i < wssTargets.length; i++) {
    wssTargets[i].on("upgrade", handleUpgrade);
  }

  wss.on("connection", function(ws) {
    clients.add(ws);
    broadcastClientCount();

    // Send cached state to this client only
    sendTo(ws, { type: "info", cwd: cwd, project: project });
    if (slashCommands) {
      sendTo(ws, { type: "slash_commands", commands: slashCommands });
    }

    // Session list to this client
    sendTo(ws, {
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

    // Restore active session for this client
    var active = getActiveSession();
    if (active) {
      sendTo(ws, { type: "session_switched", id: active.localId, cliSessionId: active.cliSessionId || null });
      for (var i = 0; i < active.history.length; i++) {
        sendTo(ws, active.history[i]);
      }
      if (active.isProcessing) {
        sendTo(ws, { type: "status", status: "processing" });
      }
      var pendingIds = Object.keys(active.pendingPermissions);
      for (var i = 0; i < pendingIds.length; i++) {
        var p = active.pendingPermissions[pendingIds[i]];
        sendTo(ws, {
          type: "permission_request_pending",
          requestId: p.requestId,
          toolName: p.toolName,
          toolInput: p.toolInput,
          toolUseId: p.toolUseId,
          decisionReason: p.decisionReason,
        });
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

      if (msg.type === "stop") {
        var session = getActiveSession();
        if (session && session.abortController && session.isProcessing) {
          session.abortController.abort();
        }
        return;
      }

      if (msg.type === "ask_user_response") {
        var session = getActiveSession();
        if (!session) return;

        var toolId = msg.toolId;
        var answers = msg.answers || {};
        var pending = session.pendingAskUser[toolId];
        if (!pending) return;

        delete session.pendingAskUser[toolId];
        pending.resolve({
          behavior: "allow",
          updatedInput: Object.assign({}, pending.input, { answers: answers }),
        });
        return;
      }

      if (msg.type === "input_sync") {
        sendToOthers(ws, msg);
        return;
      }

      if (msg.type === "permission_response") {
        var session = getActiveSession();
        if (!session) return;

        var requestId = msg.requestId;
        var decision = msg.decision; // "allow" | "deny" | "allow_always"
        var pending = session.pendingPermissions[requestId];
        if (!pending) return;

        delete session.pendingPermissions[requestId];

        if (decision === "allow" || decision === "allow_always") {
          pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
        } else {
          pending.resolve({ behavior: "deny", message: "User denied permission" });
        }

        sendAndRecord(session, {
          type: "permission_resolved",
          requestId: requestId,
          decision: decision,
        });
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
      sendToOthers(ws, userMsg);
      send({ type: "status", status: "processing" });

      // Set title from first user message
      if (!session.title) {
        session.title = (msg.text || "Image").substring(0, 50);
        saveSessionFile(session);
        broadcastSessionList();
      }

      // Start new query or push to existing one
      if (!session.queryInstance) {
        startQuery(session, msg.text || "", msg.images);
      } else {
        pushMessage(session, msg.text || "", msg.images);
      }
      broadcastSessionList();
    });

    ws.on("close", function() {
      clients.delete(ws);
      broadcastClientCount();
    });
  });

  // Warm up: grab slash_commands from SDK init message, then abort
  (async function warmup() {
    try {
      var sdk = await getSDK();
      var ac = new AbortController();
      var mq = createMessageQueue();
      mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
      mq.end();
      var stream = sdk.query({
        prompt: mq,
        options: { cwd: cwd, abortController: ac },
      });
      for await (var msg of stream) {
        if (msg.type === "system" && msg.subtype === "init") {
          if (msg.skills) {
            skillNames = new Set(msg.skills);
          }
          if (msg.slash_commands) {
            slashCommands = msg.slash_commands.filter(function(name) {
              return !skillNames || !skillNames.has(name);
            });
            if (clients.size > 0) {
              send({ type: "slash_commands", commands: slashCommands });
            }
          }
          ac.abort();
          break;
        }
      }
    } catch (e) {
      // Expected: AbortError after we abort
    }
  })();

  return { entryServer: entryServer, httpsServer: httpsServer };
}

module.exports = { createServer };
