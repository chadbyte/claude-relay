// Isolated host for a Capsule's opt-in rich Display element.
//
// The rich element is additive Display: arbitrary rendering (canvas, WebGL)
// with zero authority. It runs in an iframe that is sandboxed with
// allow-scripts only and served from this dedicated listener, a distinct
// origin from the app, so nothing of Clay's DOM, cookies, or storage is
// reachable. Its one outward edge is postMessage to its embedder, and the
// only thing it can ask for is the same validated act a human click requests.
//
// The frame document carries its own CSP, strictly tighter than the app
// policy: default-src 'none' with a per-response script nonce. There is no
// connect-src at all, so the frame cannot fetch, beacon, or open sockets; a
// rich element ships self-contained. The nonce authorizes exactly two
// scripts: the inline bridge below and the Capsule's own display.js.
//
// This origin serves no cookies and knows no sessions. A frame URL is gated
// by a short-lived token issued over the user's authenticated WebSocket, and
// each token admits one shell fetch and one display.js fetch. Whatever state
// the host later pushes into the frame is the entire exfiltration surface,
// chosen per element, exactly like a snapshot projection is chosen per caller.

var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var https = require("https");
var path = require("path");
var toolsRegistry = require("./tools-registry");

var TOKEN_TTL_MS = 60000;
var DISPLAY_FILE = "display.js";
var MAX_DISPLAY_BYTES = 512 * 1024;

function createCapsuleFrameServer(opts) {
  opts = opts || {};
  var tlsOptions = opts.tlsOptions || null;
  var tokens = Object.create(null);
  var server = null;
  var listening = null;

  function pruneTokens(now) {
    var keys = Object.keys(tokens);
    for (var i = 0; i < keys.length; i++) {
      if (tokens[keys[i]].expiresAt <= now) delete tokens[keys[i]];
    }
  }

  function displayPathFor(ctx, toolId) {
    toolsRegistry.validateToolId(toolId);
    return path.join(toolsRegistry.resolveToolsRoot(ctx), toolId, DISPLAY_FILE);
  }

  function hasRichDisplay(ctx, toolId) {
    try {
      return fs.existsSync(displayPathFor(ctx, toolId));
    } catch (error) {
      return false;
    }
  }

  function ensureListening() {
    if (listening) return listening;
    server = tlsOptions ? https.createServer(tlsOptions, handleRequest) : http.createServer(handleRequest);
    listening = new Promise(function (resolve, reject) {
      server.once("error", reject);
      server.listen(opts.port || 0, function () {
        resolve(server.address().port);
      });
    });
    return listening;
  }

  // Issues the one-time frame URL for a Capsule that ships a rich element.
  // Callable only from the authenticated WebSocket side, which is what binds
  // the anonymous frame origin to a specific user's tools root.
  function issueFrameUrl(ctx, toolId) {
    if (!hasRichDisplay(ctx, toolId)) {
      return Promise.reject(new Error("This Capsule ships no rich Display element."));
    }
    return ensureListening().then(function (port) {
      pruneTokens(Date.now());
      var token = crypto.randomBytes(24).toString("hex");
      tokens[token] = {
        ctx: { userId: ctx.userId, multiUser: ctx.multiUser, linuxUser: ctx.linuxUser },
        toolId: toolId,
        expiresAt: Date.now() + TOKEN_TTL_MS,
        shell: true,
        display: true,
      };
      return { port: port, path: "/capsule/?t=" + token, secure: !!tlsOptions };
    });
  }

  function consumeToken(token, use) {
    if (typeof token !== "string" || !token) return null;
    var entry = tokens[token];
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      delete tokens[token];
      return null;
    }
    if (!entry[use]) return null;
    entry[use] = false;
    if (!entry.shell && !entry.display) delete tokens[token];
    return entry;
  }

  function deny(res, code) {
    res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    res.end(code === 404 ? "Not found" : "Forbidden");
  }

  // The in-frame half of the bridge. Its only capabilities are receiving
  // state/event pushes from the embedder and asking the embedder for an act.
  // The embedder routes that request into the same pipeline a floor button
  // uses; nothing here can mutate anything directly.
  function bridgeSource() {
    return [
      "(function () {",
      "  \"use strict\";",
      "  var api = {",
      "    onState: null,",
      "    onEvent: null,",
      "    act: function (actionId, args) {",
      "      window.parent.postMessage({ clayCapsuleFrame: 1, type: \"act\", actionId: String(actionId), args: args || {} }, \"*\");",
      "    },",
      "  };",
      "  window.ClayCapsule = api;",
      "  window.addEventListener(\"message\", function (event) {",
      "    if (event.source !== window.parent) return;",
      "    var data = event.data;",
      "    if (!data || data.clayCapsuleFrame !== 1) return;",
      "    if (data.type === \"state\" && typeof api.onState === \"function\") api.onState(data.state || {});",
      "    else if (data.type === \"event\" && typeof api.onEvent === \"function\") api.onEvent(data.event || null);",
      "  });",
      "  window.addEventListener(\"load\", function () {",
      "    window.parent.postMessage({ clayCapsuleFrame: 1, type: \"ready\" }, \"*\");",
      "  });",
      "})();",
    ].join("\n");
  }

  function shellHtml(nonce, token) {
    return [
      "<!doctype html>",
      "<html>",
      "<head>",
      "<meta charset=\"utf-8\">",
      "<title>Capsule Display</title>",
      "</head>",
      "<body>",
      "<script nonce=\"" + nonce + "\">" + bridgeSource() + "</script>",
      "<script nonce=\"" + nonce + "\" src=\"/capsule/display.js?t=" + token + "\"></script>",
      "</body>",
      "</html>",
    ].join("\n");
  }

  function handleRequest(req, res) {
    if (req.method !== "GET") return deny(res, 404);
    var parsed;
    try {
      parsed = new URL(req.url, "http://frame.invalid");
    } catch (error) {
      return deny(res, 404);
    }
    var token = parsed.searchParams.get("t");
    if (parsed.pathname === "/capsule/" || parsed.pathname === "/capsule") {
      var shellEntry = consumeToken(token, "shell");
      if (!shellEntry) return deny(res, 403);
      var nonce = crypto.randomBytes(16).toString("base64");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        // No connect-src, no default fallback: the frame cannot reach the
        // network at all, and only the two nonced scripts may run. This is
        // deliberately tighter than the app policy in every direction.
        "Content-Security-Policy": "default-src 'none'; script-src 'nonce-" + nonce + "'; base-uri 'none'; form-action 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      });
      res.end(shellHtml(nonce, token));
      return;
    }
    if (parsed.pathname === "/capsule/display.js") {
      var displayEntry = consumeToken(token, "display");
      if (!displayEntry) return deny(res, 403);
      var source;
      try {
        var filePath = displayPathFor(displayEntry.ctx, displayEntry.toolId);
        if (fs.statSync(filePath).size > MAX_DISPLAY_BYTES) return deny(res, 403);
        source = fs.readFileSync(filePath, "utf8");
      } catch (error) {
        return deny(res, 404);
      }
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      });
      res.end(source);
      return;
    }
    return deny(res, 404);
  }

  function close() {
    if (!server) return Promise.resolve();
    var closing = server;
    server = null;
    listening = null;
    return new Promise(function (resolve) {
      closing.close(function () { resolve(); });
    });
  }

  return {
    issueFrameUrl: issueFrameUrl,
    hasRichDisplay: hasRichDisplay,
    ensureListening: ensureListening,
    close: close,
  };
}

module.exports = {
  DISPLAY_FILE: DISPLAY_FILE,
  TOKEN_TTL_MS: TOKEN_TTL_MS,
  createCapsuleFrameServer: createCapsuleFrameServer,
};
