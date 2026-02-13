const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");
const { WebSocketServer } = require("ws");
const { fetchLatestVersion, isNewer } = require("./updater");
const { pinPageHtml, setupPageHtml } = require("./pages");
const { createSessionManager } = require("./sessions");
const { createSDKBridge } = require("./sdk-bridge");

// SDK loaded dynamically (ESM module)
var sdkModule = null;
function getSDK() {
  if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");
  return sdkModule;
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


function createServer(cwd, tlsOptions, caPath, pin, mainPort, debug) {
  var authToken = pin ? generateAuthToken(pin) : null;
  const project = path.basename(cwd);
  const realVersion = require("../package.json").version;
  const currentVersion = debug ? "0.0.9" : realVersion;
  let latestVersion = null;

  // Check for updates in background
  fetchLatestVersion().then(function(v) {
    if (v && isNewer(v, currentVersion)) {
      latestVersion = v;
      // Notify already-connected clients
      send({ type: "update_available", version: v });
    }
  });

  // --- Push notifications ---
  var pushModule = null;
  try {
    var { initPush } = require("./push");
    pushModule = initPush(cwd);
  } catch(e) {}

  // --- Messaging helpers ---
  let clients = new Set();

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

  // --- Session manager ---
  var sm = createSessionManager({ cwd: cwd, send: send });

  // --- SDK bridge ---
  var sdk = createSDKBridge({
    cwd: cwd,
    sessionManager: sm,
    send: send,
    pushModule: pushModule,
    getSDK: getSDK,
  });

  function parseJsonBody(req) {
    return new Promise(function(resolve, reject) {
      var body = "";
      req.on("data", function(chunk) { body += chunk; });
      req.on("end", function() {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(e); }
      });
    });
  }

  // --- App HTTP handler ---
  var caContent = caPath ? fs.readFileSync(caPath) : null;
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
              "Set-Cookie": "relay_auth=" + authToken + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000" + (tlsOptions ? "; Secure" : ""),
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

    // VAPID public key (no auth needed, just returns a key)
    if (req.method === "GET" && req.url === "/api/vapid-public-key") {
      if (pushModule) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store",
        });
        res.end(JSON.stringify({ publicKey: pushModule.publicKey }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"push not available"}');
      }
      return;
    }

    // Check auth for everything else
    if (!isAuthed(req, authToken)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pinPage);
      return;
    }

    // Push subscribe endpoint
    if (req.method === "POST" && req.url === "/api/push-subscribe") {
      parseJsonBody(req).then(function(sub) {
        if (pushModule) pushModule.addSubscription(sub);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function() {
        res.writeHead(400);
        res.end("Bad request");
      });
      return;
    }

    // Permission response from push notification (service worker)
    if (req.method === "POST" && req.url === "/api/permission-response") {
      parseJsonBody(req).then(function(data) {
        var requestId = data.requestId;
        var decision = data.decision;
        if (!requestId || !decision) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing requestId or decision"}');
          return;
        }

        // Search all sessions for the pending permission
        var found = false;
        sm.sessions.forEach(function(session) {
          var pending = session.pendingPermissions[requestId];
          if (!pending) return;
          found = true;

          delete session.pendingPermissions[requestId];

          if (decision === "allow") {
            pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
          } else {
            pending.resolve({ behavior: "deny", message: "Denied via push notification" });
          }

          sm.sendAndRecord(session, {
            type: "permission_resolved",
            requestId: requestId,
            decision: decision,
          });
        });

        if (found) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"permission request not found"}');
        }
      }).catch(function() {
        res.writeHead(400);
        res.end("Bad request");
      });
      return;
    }

    // CA certificate download (available on both HTTP and HTTPS)
    if (req.url === "/ca/download" && req.method === "GET" && caContent) {
      res.writeHead(200, {
        "Content-Type": "application/x-pem-file",
        "Content-Disposition": 'attachment; filename="claude-relay-ca.pem"',
      });
      res.end(caContent);
      return;
    }

    // Setup page (available on both HTTP and HTTPS)
    if (req.url === "/setup" && req.method === "GET") {
      var host = req.headers.host || "localhost";
      var hostname = host.split(":")[0];
      var setupHttpsUrl = tlsOptions
        ? "https://" + hostname + ":" + (mainPort + 1)
        : "http://" + hostname + ":" + mainPort;
      var httpEntryUrl = "http://" + hostname + ":" + mainPort;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(setupPageHtml(setupHttpsUrl, httpEntryUrl, !!caContent));
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

    entryServer = http.createServer(function(req, res) {
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
    sendTo(ws, { type: "info", cwd: cwd, project: project, version: currentVersion, debug: !!debug });
    if (latestVersion) {
      sendTo(ws, { type: "update_available", version: latestVersion });
    }
    if (sm.slashCommands) {
      sendTo(ws, { type: "slash_commands", commands: sm.slashCommands });
    }

    // Session list to this client
    sendTo(ws, {
      type: "session_list",
      sessions: [...sm.sessions.values()].map(function(s) {
        return {
          id: s.localId,
          cliSessionId: s.cliSessionId || null,
          title: s.title || "New Session",
          active: s.localId === sm.activeSessionId,
          isProcessing: s.isProcessing,
        };
      }),
    });

    // Restore active session for this client
    var active = sm.getActiveSession();
    if (active) {
      sendTo(ws, { type: "session_switched", id: active.localId, cliSessionId: active.cliSessionId || null });

      var total = active.history.length;
      var fromIndex = 0;
      if (total > sm.HISTORY_PAGE_SIZE) {
        fromIndex = sm.findTurnBoundary(active.history, Math.max(0, total - sm.HISTORY_PAGE_SIZE));
      }
      sendTo(ws, { type: "history_meta", total: total, from: fromIndex });
      for (var i = fromIndex; i < total; i++) {
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

      if (msg.type === "push_subscribe") {
        if (pushModule && msg.subscription) pushModule.addSubscription(msg.subscription);
        return;
      }

      if (msg.type === "load_more_history") {
        var session = sm.getActiveSession();
        if (!session || typeof msg.before !== "number") return;
        var before = msg.before;
        var from = sm.findTurnBoundary(session.history, Math.max(0, before - sm.HISTORY_PAGE_SIZE));
        var to = before;
        var items = session.history.slice(from, to);
        sendTo(ws, {
          type: "history_prepend",
          items: items,
          meta: { from: from, to: to, hasMore: from > 0 },
        });
        return;
      }

      if (msg.type === "new_session") {
        sm.createSession();
        return;
      }

      if (msg.type === "resume_session") {
        if (!msg.cliSessionId) return;
        sm.resumeSession(msg.cliSessionId);
        return;
      }

      if (msg.type === "switch_session") {
        if (msg.id && sm.sessions.has(msg.id)) {
          sm.switchSession(msg.id);
        }
        return;
      }

      if (msg.type === "delete_session") {
        if (msg.id && sm.sessions.has(msg.id)) {
          sm.deleteSession(msg.id);
        }
        return;
      }

      if (msg.type === "rename_session") {
        if (msg.id && sm.sessions.has(msg.id) && msg.title) {
          var s = sm.sessions.get(msg.id);
          s.title = String(msg.title).substring(0, 100);
          sm.saveSessionFile(s);
          sm.broadcastSessionList();
        }
        return;
      }

      if (msg.type === "check_update") {
        fetchLatestVersion().then(function(v) {
          if (v && isNewer(v, currentVersion)) {
            latestVersion = v;
            sendTo(ws, { type: "update_available", version: v });
          }
        }).catch(function() {});
        return;
      }

      if (msg.type === "stop") {
        var session = sm.getActiveSession();
        if (session && session.abortController && session.isProcessing) {
          session.abortController.abort();
        }
        return;
      }

      if (msg.type === "rewind_preview") {
        var session = sm.getActiveSession();
        if (!session || !session.cliSessionId || !msg.uuid) return;

        (async function() {
          var result;
          try {
            result = await sdk.getOrCreateRewindQuery(session);
            var preview = await result.query.rewindFiles(msg.uuid, { dryRun: true });
            var diffs = {};
            var changedFiles = preview.filesChanged || [];
            for (var f = 0; f < changedFiles.length; f++) {
              try {
                diffs[changedFiles[f]] = execFileSync(
                  "git", ["diff", "HEAD", "--", changedFiles[f]],
                  { cwd: cwd, encoding: "utf8", timeout: 5000 }
                ) || "";
              } catch(e) { diffs[changedFiles[f]] = ""; }
            }
            sendTo(ws, { type: "rewind_preview_result", preview: preview, diffs: diffs, uuid: msg.uuid });
          } catch(err) {
            sendTo(ws, { type: "rewind_error", text: "Failed to preview rewind: " + err.message });
          } finally {
            if (result && result.isTemp) result.cleanup();
          }
        })();
        return;
      }

      if (msg.type === "rewind_execute") {
        var session = sm.getActiveSession();
        if (!session || !session.cliSessionId || !msg.uuid) return;

        (async function() {
          var result;
          try {
            result = await sdk.getOrCreateRewindQuery(session);
            await result.query.rewindFiles(msg.uuid, { dryRun: false });

            // Find the target UUID in messageUUIDs and trim history
            var targetIdx = -1;
            for (var i = 0; i < session.messageUUIDs.length; i++) {
              if (session.messageUUIDs[i].uuid === msg.uuid) {
                targetIdx = i;
                break;
              }
            }

            if (targetIdx >= 0) {
              var trimTo = session.messageUUIDs[targetIdx].historyIndex;
              // Walk back to also remove the user_message before the message_uuid
              for (var k = trimTo - 1; k >= 0; k--) {
                if (session.history[k].type === "user_message") {
                  trimTo = k;
                  break;
                }
              }
              session.history = session.history.slice(0, trimTo);
              session.messageUUIDs = session.messageUUIDs.slice(0, targetIdx);
            }

            session.lastRewindUuid = msg.uuid;

            // Clean up query state
            if (session.abortController) {
              try { session.abortController.abort(); } catch(e) {}
            }
            if (session.messageQueue) {
              try { session.messageQueue.end(); } catch(e) {}
            }
            session.queryInstance = null;
            session.messageQueue = null;
            session.abortController = null;
            session.blocks = {};
            session.sentToolResults = {};
            session.pendingPermissions = {};
            session.pendingAskUser = {};
            session.isProcessing = false;

            sm.saveSessionFile(session);

            // Replay trimmed history then show rewind complete
            sm.switchSession(session.localId);
            sm.sendAndRecord(session, { type: "rewind_complete" });
            sm.broadcastSessionList();
          } catch(err) {
            send({ type: "rewind_error", text: "Rewind failed: " + err.message });
          } finally {
            if (result && result.isTemp) result.cleanup();
          }
        })();
        return;
      }

      if (msg.type === "ask_user_response") {
        var session = sm.getActiveSession();
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
        var session = sm.getActiveSession();
        if (!session) return;

        var requestId = msg.requestId;
        var decision = msg.decision; // "allow" | "deny" | "allow_always"
        var pending = session.pendingPermissions[requestId];
        if (!pending) return;

        delete session.pendingPermissions[requestId];

        if (decision === "allow" || decision === "allow_always") {
          if (decision === "allow_always") {
            if (!session.allowedTools) session.allowedTools = {};
            session.allowedTools[pending.toolName] = true;
          }
          pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
        } else {
          pending.resolve({ behavior: "deny", message: "User denied permission" });
        }

        sm.sendAndRecord(session, {
          type: "permission_resolved",
          requestId: requestId,
          decision: decision,
        });
        return;
      }

      if (msg.type !== "message") return;
      if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.pastes || msg.pastes.length === 0)) return;

      var session = sm.getActiveSession();
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
      if (msg.pastes && msg.pastes.length > 0) {
        userMsg.pastes = msg.pastes;
      }
      session.history.push(userMsg);
      sm.appendToSessionFile(session, userMsg);
      sendToOthers(ws, userMsg);
      send({ type: "status", status: "processing" });

      // Set title from first user message
      if (!session.title) {
        session.title = (msg.text || "Image").substring(0, 50);
        sm.saveSessionFile(session);
        sm.broadcastSessionList();
      }

      // Combine text with pasted content for Claude
      var fullText = msg.text || "";
      if (msg.pastes && msg.pastes.length > 0) {
        for (var pi = 0; pi < msg.pastes.length; pi++) {
          if (fullText) fullText += "\n\n";
          fullText += msg.pastes[pi];
        }
      }

      // Start new query or push to existing one
      if (!session.queryInstance) {
        sdk.startQuery(session, fullText, msg.images);
      } else {
        sdk.pushMessage(session, fullText, msg.images);
      }
      sm.broadcastSessionList();
    });

    ws.on("close", function() {
      clients.delete(ws);
      broadcastClientCount();
    });
  });

  // Warm up: grab slash_commands from SDK init message, then abort
  sdk.warmup();

  return { entryServer: entryServer, httpsServer: httpsServer };
}

module.exports = { createServer };
