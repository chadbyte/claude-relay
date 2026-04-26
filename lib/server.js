var http = require("http");
var fs = require("fs");
var path = require("path");
var { WebSocketServer } = require("ws");
var pages = require("./pages");
var smtp = require("./smtp");
var { createProjectContext } = require("./project");
var users = require("./users");
var dm = require("./dm");
var mates = require("./mates");
var serverAuth = require("./server-auth");
var serverSkills = require("./server-skills");
var serverDm = require("./server-dm");
var serverMates = require("./server-mates");
var serverAdmin = require("./server-admin");
var serverSettings = require("./server-settings");
var serverPalette = require("./server-palette");
var serverEmail = require("./server-email");

var { CONFIG_DIR } = require("./config");
var { provisionLinuxUser } = require("./os-users");

var https = require("https");
var pkg = require("../package.json");

var publicDir = path.join(__dirname, "public");
var bundledThemesDir = path.join(__dirname, "themes");
var userThemesDir = path.join(CONFIG_DIR, "themes");

// --- HTTP helpers (used by skills proxy and extension download) ---

function httpGetBinary(url) {
  return new Promise(function (resolve, reject) {
    var mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "Clay/1.0" } }, function (resp) {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return httpGetBinary(resp.headers.location).then(resolve, reject);
      }
      if (resp.statusCode !== 200) {
        return reject(new Error("HTTP " + resp.statusCode));
      }
      var chunks = [];
      resp.on("data", function (c) { chunks.push(c); });
      resp.on("end", function () { resolve(Buffer.concat(chunks)); });
      resp.on("error", reject);
    }).on("error", reject);
  });
}


var MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

var generateAuthToken = serverAuth.generateAuthToken;
var verifyPin = serverAuth.verifyPin;

function serveStatic(urlPath, res) {
  if (urlPath === "/") urlPath = "/index.html";

  var filePath = path.join(publicDir, urlPath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  try {
    var content = fs.readFileSync(filePath);
    var ext = path.extname(filePath);
    var mime = MIME_TYPES[ext] || "application/octet-stream";
    var isImage = ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".svg" || ext === ".webp" || ext === ".ico";
    var cacheControl = isImage ? "public, max-age=86400, immutable" : "no-cache";
    res.writeHead(200, {
      "Content-Type": mime + (isImage ? "" : "; charset=utf-8"),
      "Cache-Control": cacheControl,
    });
    res.end(content);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Extract slug from URL path: /p/{slug}/... → slug
 * Returns null if path doesn't match /p/{slug}
 */
function extractSlug(urlPath) {
  var match = urlPath.match(/^\/p\/([a-z0-9_-]+)(\/|$)/);
  return match ? match[1] : null;
}

/**
 * Strip the /p/{slug} prefix from URL path
 */
function stripPrefix(urlPath, slug) {
  var prefix = "/p/" + slug;
  var rest = urlPath.substring(prefix.length);
  return rest || "/";
}

/**
 * Create a multi-project server.
 * opts: { tlsOptions, caPath, pinHash, port, debug, dangerouslySkipPermissions }
 */
function createServer(opts) {
  var tlsOptions = opts.tlsOptions || null;
  var caPath = opts.caPath || null;
  var pinHash = opts.pinHash || null;
  var portNum = opts.port || 2633;
  var debug = opts.debug || false;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var osUsers = opts.osUsers || false;
  var lanHost = opts.lanHost || null;
  var onAddProject = opts.onAddProject || null;
  var onCreateProject = opts.onCreateProject || null;
  var onCloneProject = opts.onCloneProject || null;
  var onRemoveProject = opts.onRemoveProject || null;
  var onReorderProjects = opts.onReorderProjects || null;
  var onSetProjectTitle = opts.onSetProjectTitle || null;
  var onSetProjectIcon = opts.onSetProjectIcon || null;
  var onProjectOwnerChanged = opts.onProjectOwnerChanged || null;
  var onGetServerDefaultEffort = opts.onGetServerDefaultEffort || null;
  var onSetServerDefaultEffort = opts.onSetServerDefaultEffort || null;
  var onGetProjectDefaultEffort = opts.onGetProjectDefaultEffort || null;
  var onSetProjectDefaultEffort = opts.onSetProjectDefaultEffort || null;
  var onGetServerDefaultModel = opts.onGetServerDefaultModel || null;
  var onSetServerDefaultModel = opts.onSetServerDefaultModel || null;
  var onGetProjectDefaultModel = opts.onGetProjectDefaultModel || null;
  var onSetProjectDefaultModel = opts.onSetProjectDefaultModel || null;
  var onGetServerDefaultMode = opts.onGetServerDefaultMode || null;
  var onSetServerDefaultMode = opts.onSetServerDefaultMode || null;
  var onGetProjectDefaultMode = opts.onGetProjectDefaultMode || null;
  var onSetProjectDefaultMode = opts.onSetProjectDefaultMode || null;
  var onGetProjectMcpServers = opts.onGetProjectMcpServers || null;
  var onSetProjectMcpServers = opts.onSetProjectMcpServers || null;
  var onGetDaemonConfig = opts.onGetDaemonConfig || null;
  var onSetPin = opts.onSetPin || null;
  var onSetKeepAwake = opts.onSetKeepAwake || null;
  var onSetImageRetention = opts.onSetImageRetention || null;
  var onShutdown = opts.onShutdown || null;
  var onRestart = opts.onRestart || null;
  var onSetUpdateChannel = opts.onSetUpdateChannel || null;
  var onUpgradePin = opts.onUpgradePin || null;
  var onSetProjectVisibility = opts.onSetProjectVisibility || null;
  var onSetProjectAllowedUsers = opts.onSetProjectAllowedUsers || null;
  var onGetProjectAccess = opts.onGetProjectAccess || null;
  var onCreateWorktree = opts.onCreateWorktree || null;
  var onUserProvisioned = opts.onUserProvisioned || null;
  var onUserDeleted = opts.onUserDeleted || null;
  var getRemovedProjects = opts.getRemovedProjects || function () { return []; };

  // --- Auth module ---
  var auth = serverAuth.attachAuth({
    users: users,
    smtp: smtp,
    pages: pages,
    tlsOptions: tlsOptions,
    osUsers: osUsers,
    pinHash: pinHash,
    provisionLinuxUser: provisionLinuxUser,
    onUpgradePin: onUpgradePin,
    onUserProvisioned: onUserProvisioned,
  });
  var getMultiUserFromReq = auth.getMultiUserFromReq;
  var isRequestAuthed = auth.isRequestAuthed;
  var parseCookies = auth.parseCookies;

  var realVersion = require("../package.json").version;
  var currentVersion = debug ? "0.0.9" : realVersion;

  var caContent = caPath ? (function () { try { return fs.readFileSync(caPath); } catch (e) { return null; } })() : null;

  // --- Project registry ---
  var projects = new Map(); // slug → projectContext

  // --- Admin module ---
  var admin = serverAdmin.attachAdmin({
    users: users,
    smtp: smtp,
    getMultiUserFromReq: getMultiUserFromReq,
    projects: projects,
    osUsers: osUsers,
    tlsOptions: tlsOptions,
    portNum: portNum,
    provisionLinuxUser: provisionLinuxUser,
    onUserProvisioned: onUserProvisioned,
    onUserDeleted: onUserDeleted,
    revokeUserTokens: auth.revokeUserTokens,
    onSetProjectVisibility: onSetProjectVisibility,
    onSetProjectAllowedUsers: onSetProjectAllowedUsers,
    onGetProjectAccess: onGetProjectAccess,
    onProjectOwnerChanged: onProjectOwnerChanged,
  });

  var skills = serverSkills.attachSkills({
    users: users,
    osUsers: osUsers,
    getMultiUserFromReq: getMultiUserFromReq,
  });

  var settings = serverSettings.attachSettings({
    users: users,
    mates: mates,
    getMultiUserFromReq: getMultiUserFromReq,
    projects: projects,
    opts: opts,
    CONFIG_DIR: CONFIG_DIR,
  });

  var palette = serverPalette.attachPalette({
    users: users,
    projects: projects,
    getMultiUserFromReq: getMultiUserFromReq,
    onGetProjectAccess: onGetProjectAccess,
  });

  // --- Push module (global) ---
  var pushModule = null;
  try {
    var { initPush } = require("./push");
    pushModule = initPush();
  } catch (e) {}

  // --- Notifications module (global singleton, shared by all projects) ---
  var { attachNotifications: _attachNotifications } = require("./project-notifications");
  var _globalNotifications = _attachNotifications({
    broadcastAll: function (msg) { broadcastAll(msg); },
    sendToUser: function (userId, msg) { sendToUser(userId, msg); },
    pushModule: pushModule,
  });

  // --- Security headers ---
  var securityHeaders = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://esm.sh; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; img-src * data: blob:; connect-src 'self' ws: wss: https://cdn.jsdelivr.net https://esm.sh https://api.dicebear.com https://api.open-meteo.com https://ipapi.co; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net;",
  };
  if (tlsOptions) {
    securityHeaders["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  function setSecurityHeaders(res) {
    var keys = Object.keys(securityHeaders);
    for (var i = 0; i < keys.length; i++) {
      res.setHeader(keys[i], securityHeaders[keys[i]]);
    }
  }

  // --- HTTP handler ---
  var appHandler = function (req, res) {
    setSecurityHeaders(res);
    var fullUrl = req.url.split("?")[0];

    // --- Auth routes (delegated to server-auth) ---
    if (auth.handleRequest(req, res, fullUrl)) return;
    // CA certificate download
    if (req.url === "/ca/download" && req.method === "GET" && caContent) {
      res.writeHead(200, {
        "Content-Type": "application/x-pem-file",
        "Content-Disposition": 'attachment; filename="clay-ca.pem"',
      });
      res.end(caContent);
      return;
    }

    // Chrome extension download (proxy from GitHub)
    if (fullUrl === "/api/extension/download" && req.method === "GET") {
      if (!isRequestAuthed(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      var archiveUrl = "https://github.com/chadbyte/clay-chrome/archive/refs/heads/main.zip";
      httpGetBinary(archiveUrl).then(function (buf) {
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="clay-chrome-extension.zip"',
          "Content-Length": buf.length,
        });
        res.end(buf);
      }).catch(function (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to download extension: " + (err.message || "unknown error") }));
      });
      return;
    }

    // CORS preflight for cross-origin requests (HTTP onboarding → HTTPS)
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    // Setup page
    if (fullUrl === "/setup" && req.method === "GET") {
      var host = req.headers.host || "localhost";
      var hostname = host.split(":")[0];
      var protocol = tlsOptions ? "https" : "http";
      var setupUrl = protocol + "://" + hostname + ":" + portNum;
      var lanMode = /[?&]mode=lan/.test(req.url);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(pages.setupPageHtml(setupUrl, setupUrl, !!caContent, lanMode));
      return;
    }

    // PWA install guide (builtin cert mode, no CA step needed)
    if (fullUrl === "/pwa" && req.method === "GET") {
      var host = req.headers.host || "localhost";
      var hostname = host.split(":")[0];
      var protocol = tlsOptions ? "https" : "http";
      var pwaUrl = protocol + "://" + hostname + ":" + portNum;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
      });
      res.end(pages.setupPageHtml(pwaUrl, pwaUrl, false, true));
      return;
    }

    // Global push endpoints (used by setup page)
    if (req.method === "GET" && fullUrl === "/api/vapid-public-key" && pushModule) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ publicKey: pushModule.publicKey }));
      return;
    }

    if (req.method === "POST" && fullUrl === "/api/push-subscribe" && pushModule) {
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var parsed = JSON.parse(body);
          var sub = parsed.subscription || parsed;
          var _httpPushUser = getMultiUserFromReq(req);
          pushModule.addSubscription(sub, parsed.replaceEndpoint, _httpPushUser ? _httpPushUser.id : null);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400);
          res.end("Bad request");
        }
      });
      return;
    }

    // Health check endpoint
    // Unauthenticated: minimal liveness info only
    // Authenticated: full system details (memory, pid, version, sessions)
    if (req.method === "GET" && fullUrl === "/api/health") {
      var health = {
        status: "ok",
        timestamp: new Date().toISOString(),
      };
      if (isRequestAuthed(req)) {
        var mem = process.memoryUsage();
        var activeSessions = 0;
        projects.forEach(function (ctx) {
          if (ctx && ctx.clients) {
            activeSessions += ctx.clients.size || 0;
          }
        });
        health.uptime = process.uptime();
        health.version = pkg.version;
        health.node = process.version;
        health.sessions = activeSessions;
        health.projects = projects.size;
        health.memory = {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
        };
        health.pid = process.pid;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
      return;
    }

    // Theme list: bundled (lib/themes/) + user (~/.clay/themes/)
    if (req.method === "GET" && fullUrl === "/api/themes") {
      var bundled = {};
      var custom = {};
      // Read bundled themes
      try {
        var bFiles = fs.readdirSync(bundledThemesDir);
        for (var i = 0; i < bFiles.length; i++) {
          if (!bFiles[i].endsWith(".json")) continue;
          try {
            var raw = fs.readFileSync(path.join(bundledThemesDir, bFiles[i]), "utf8");
            var id = bFiles[i].replace(/\.json$/, "");
            bundled[id] = JSON.parse(raw);
          } catch (e) {}
        }
      } catch (e) {}
      // Read user themes (override bundled if same id)
      try {
        var uFiles = fs.readdirSync(userThemesDir);
        for (var j = 0; j < uFiles.length; j++) {
          if (!uFiles[j].endsWith(".json")) continue;
          try {
            var uRaw = fs.readFileSync(path.join(userThemesDir, uFiles[j]), "utf8");
            var uid = uFiles[j].replace(/\.json$/, "");
            custom[uid] = JSON.parse(uRaw);
          } catch (e) {}
        }
      } catch (e) {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ bundled: bundled, custom: custom }));
      return;
    }

    if (settings.handleRequest(req, res, fullUrl)) return;

    // --- Admin API endpoints (multi-user mode only) ---
    if (admin.handleRequest(req, res, fullUrl)) return;

    // --- Palette search (delegated to server-palette) ---
    if (palette.handleRequest(req, res, fullUrl)) return;

    // Multi-user info endpoint (who am I?)
    if (req.method === "GET" && fullUrl === "/api/me") {
      if (!users.isMultiUser()) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"multiUser":false}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"error":"unauthorized"}');
        return;
      }
      var meResp = { multiUser: true, smtpEnabled: smtp.isSmtpConfigured(), emailLoginEnabled: smtp.isEmailLoginEnabled(), user: { id: mu.id, username: mu.username, email: mu.email || null, displayName: mu.displayName, role: mu.role } };
      meResp.permissions = users.getEffectivePermissions(mu, osUsers);
      if (mu.mustChangePin) meResp.mustChangePin = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(meResp));
      return;
    }

    // --- Skills routes (delegated to server-skills) ---
    if (skills.handleRequest(req, res, fullUrl)) return;

    // Root path — redirect to first accessible project
    if (fullUrl === "/" && req.method === "GET") {
      if (!isRequestAuthed(req)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(auth.getAuthPage());
        return;
      }
      if (projects.size > 0) {
        var targetSlug = null;
        var reqUser = users.isMultiUser() ? getMultiUserFromReq(req) : null;
        // Check for last-visited project cookie
        var lastProject = parseCookies(req)["clay_last_project"];
        if (lastProject && projects.has(lastProject)) {
          if (reqUser && onGetProjectAccess) {
            var lpAccess = onGetProjectAccess(lastProject);
            if (lpAccess && !lpAccess.error && users.canAccessProject(reqUser.id, lpAccess)) {
              targetSlug = lastProject;
            }
          } else {
            targetSlug = lastProject;
          }
        }
        // Fall back to first accessible project
        if (!targetSlug) {
          projects.forEach(function (ctx, s) {
            if (targetSlug) return;
            if (reqUser && onGetProjectAccess) {
              var access = onGetProjectAccess(s);
              if (access && !access.error && users.canAccessProject(reqUser.id, access)) {
                targetSlug = s;
              }
            } else {
              targetSlug = s;
            }
          });
        }
        if (targetSlug) {
          res.writeHead(302, { "Location": "/p/" + targetSlug + "/" });
          res.end();
          return;
        }
      }
      // No accessible projects — show info page
      if (users.isMultiUser()) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pages.noProjectsPageHtml());
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("No projects registered.");
      return;
    }

    // Global info endpoint (projects only for authenticated requests)
    if (req.method === "GET" && req.url === "/info") {
      if (!isRequestAuthed(req)) {
        res.writeHead(401, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ version: currentVersion, authenticated: false }));
        return;
      }
      var projectList = [];
      projects.forEach(function (ctx, slug) {
        projectList.push({ slug: slug, project: ctx.project });
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects: projectList, version: currentVersion, authenticated: true }));
      return;
    }

    // Static files (favicon, manifest, icons, sw.js, mate avatars, etc.)
    if (!fullUrl.includes("..") && !fullUrl.startsWith("/p/") && !fullUrl.startsWith("/api/")) {
      if (serveStatic(fullUrl, res)) return;
    }

    // Project-scoped routes: /p/{slug}/...
    var slug = extractSlug(req.url.split("?")[0]);
    if (!slug) {
      // Not a project route and not handled above
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    var ctx = projects.get(slug);
    if (!ctx) {
      res.writeHead(302, { "Location": "/" });
      res.end();
      return;
    }

    // Redirect /p/{slug} → /p/{slug}/ (trailing slash required for relative paths)
    if (fullUrl === "/p/" + slug) {
      res.writeHead(301, { "Location": "/p/" + slug + "/" });
      res.end();
      return;
    }

    // Auth check for project routes
    // Bypass auth for MCP bridge endpoint (localhost only).
    // The mcp-bridge-server.js runs as a local child process and cannot carry cookies.
    var projectUrlForAuth = stripPrefix(req.url.split("?")[0], slug);
    // req.socket.remoteAddress may differ between HTTP/HTTPS (TLSSocket wraps net.Socket).
    // Also check req.connection.remoteAddress for compatibility.
    var remoteAddr = req.socket.remoteAddress
      || (req.connection && req.connection.remoteAddress)
      || "";
    var isLocalhost = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
    var isMcpBridgeLocal = projectUrlForAuth === "/api/mcp-bridge"
      && req.method === "POST"
      && isLocalhost;
    if (projectUrlForAuth === "/api/mcp-bridge") {
      console.log("[server] MCP bridge auth: method=" + req.method + " addr=" + remoteAddr + " bypass=" + isMcpBridgeLocal);
    }
    if (!isMcpBridgeLocal && !isRequestAuthed(req)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(auth.getAuthPage());
      return;
    }

    // Set last-visited project cookie for root redirect
    res.setHeader("Set-Cookie", "clay_last_project=" + slug + "; Path=/; SameSite=Strict; Max-Age=31536000" + (tlsOptions ? "; Secure" : ""));

    // Multi-user: check project access for HTTP requests
    if (users.isMultiUser() && onGetProjectAccess) {
      var httpUser = getMultiUserFromReq(req);
      if (httpUser) {
        var httpAccess = onGetProjectAccess(slug);
        if (httpAccess && !httpAccess.error && !users.canAccessProject(httpUser.id, httpAccess)) {
          res.writeHead(302, { "Location": "/" });
          res.end();
          return;
        }
      }
    }

    // Strip prefix for project-scoped handling
    var projectUrl = stripPrefix(req.url.split("?")[0], slug);
    // Re-attach query string for API routes
    var qsIdx = req.url.indexOf("?");
    var projectUrlWithQS = qsIdx >= 0 ? projectUrl + req.url.substring(qsIdx) : projectUrl;

    // Attach user info for project HTTP handler (OS-level isolation)
    if (users.isMultiUser()) {
      req._clayUser = getMultiUserFromReq(req);
    }

    // Try project HTTP handler first (APIs)
    var origUrl = req.url;
    req.url = projectUrlWithQS;
    var handled = ctx.handleHTTP(req, res, projectUrlWithQS);
    req.url = origUrl;
    if (handled) return;

    // Static files (same assets for all projects)
    if (req.method === "GET") {
      if (serveStatic(projectUrl, res)) return;
    }

    res.writeHead(404);
    res.end("Not found");
  };

  // --- Server setup ---
  var server;
  if (tlsOptions) {
    server = require("https").createServer(tlsOptions, appHandler);
  } else {
    server = http.createServer(appHandler);
  }

  // --- HTTP onboarding server (only when TLS is active) ---
  var onboardingServer = null;
  if (tlsOptions) {
    onboardingServer = http.createServer(function (req, res) {
      var url = req.url.split("?")[0];

      // CA certificate download
      if (url === "/ca/download" && req.method === "GET" && caContent) {
        res.writeHead(200, {
          "Content-Type": "application/x-pem-file",
          "Content-Disposition": 'attachment; filename="clay-ca.pem"',
        });
        res.end(caContent);
        return;
      }

      // Setup page
      if (url === "/setup" && req.method === "GET") {
        var host = req.headers.host || "localhost";
        var hostname = host.split(":")[0];
        var httpsSetupUrl = "https://" + hostname + ":" + portNum;
        var httpSetupUrl = "http://" + hostname + ":" + (portNum + 1);
        var lanMode = /[?&]mode=lan/.test(req.url);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pages.setupPageHtml(httpsSetupUrl, httpSetupUrl, !!caContent, lanMode));
        return;
      }

      // /info — CORS-enabled, used by setup page to verify HTTPS
      if (url === "/info" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ version: currentVersion }));
        return;
      }

      // Static files at root (favicon, manifest, icons, etc.)
      if (url.lastIndexOf("/") === 0 && !url.includes("..")) {
        if (serveStatic(url, res)) return;
      }

      // Everything else → redirect to HTTPS setup
      var hostname = (req.headers.host || "localhost").split(":")[0];
      res.writeHead(302, { "Location": "https://" + hostname + ":" + portNum + "/setup" });
      res.end();
    });
  }

  // --- WebSocket ---
  var wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", function (req, socket, head) {
    // Origin validation (CSRF prevention)
    var origin = req.headers.origin;
    if (origin) {
      try {
        var originUrl = new URL(origin);
        var originPort = String(originUrl.port || (originUrl.protocol === "https:" ? "443" : "80"));
        // Extract port from Host header for reverse proxy support.
        // Use URL parser to correctly handle IPv6 addresses (e.g. [::1])
        // and infer default port from origin protocol (not backend tlsOptions)
        // so TLS-terminating proxies on :443 with HTTP backends work.
        var hostPort;
        try {
          var hostUrl = new URL(originUrl.protocol + "//" + (req.headers.host || ""));
          hostPort = String(hostUrl.port || (originUrl.protocol === "https:" ? "443" : "80"));
        } catch (e2) {
          hostPort = String(portNum);
        }
        if (originPort !== String(portNum) && originPort !== hostPort) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch (e) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    if (!isRequestAuthed(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Extract slug from WS URL: /p/{slug}/ws
    var wsSlug = extractSlug(req.url);
    if (!wsSlug) {
      socket.destroy();
      return;
    }

    var ctx = projects.get(wsSlug);
    if (!ctx) {
      if (debug) console.log("[server] WS rejected: project not found for slug", wsSlug);
      socket.destroy();
      return;
    }

    // Attach user info to the WS connection for multi-user filtering
    var wsUser = null;
    if (users.isMultiUser()) {
      wsUser = getMultiUserFromReq(req);
      // Check project access for multi-user mode
      if (wsUser && onGetProjectAccess) {
        // For worktree projects, inherit access from parent
        var accessSlug = (wsSlug.indexOf("--") !== -1) ? wsSlug.split("--")[0] : wsSlug;
        var projectAccess = onGetProjectAccess(accessSlug);
        if (debug) console.log("[server] WS access check:", wsSlug, "user:", wsUser.id, "role:", wsUser.role, "visibility:", projectAccess && projectAccess.visibility, "ownerId:", projectAccess && projectAccess.ownerId, "allowed:", projectAccess && projectAccess.allowedUsers);
        if (projectAccess && !projectAccess.error) {
          if (!users.canAccessProject(wsUser.id, projectAccess)) {
            if (debug) console.log("[server] WS rejected: access denied for", wsUser.id, "on", wsSlug);
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }
        }
      }
    }

    wss.handleUpgrade(req, socket, head, function (ws) {
      // Apply rate limiting to WS messages
      var msgCount = 0;
      var msgWindowStart = Date.now();
      var WS_RATE_LIMIT = 60; // messages per second
      var origEmit = ws.emit;
      ws.emit = function (event) {
        if (event === "message") {
          var now = Date.now();
          if (now - msgWindowStart >= 1000) {
            msgCount = 0;
            msgWindowStart = now;
          }
          msgCount++;
          if (msgCount > WS_RATE_LIMIT) {
            try {
              ws.send(JSON.stringify({ type: "error", message: "Rate limit exceeded. Connection will be closed." }));
              ws.close(1008, "Rate limit exceeded");
            } catch (e) {}
            return false;
          }
        }
        return origEmit.apply(ws, arguments);
      };
      ws._clayUser = wsUser; // attach user context
      var remoteAddr = req.socket.remoteAddress || "";
      ws._clayLocal = (remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1");
      // Clear cross-project unread for this project when client connects
      var unreadMap = getCrossProjectUnread(ws);
      if (unreadMap[wsSlug]) {
        unreadMap[wsSlug] = 0;
      }
      ctx.handleConnection(ws, wsUser);
    });
  });

  // --- Cross-project unread tracking ---
  // WeakMap<ws, { slug: count }> tracks how many done events happened in other projects
  var crossProjectUnread = new WeakMap();

  function getCrossProjectUnread(ws) {
    var map = crossProjectUnread.get(ws);
    if (!map) { map = {}; crossProjectUnread.set(ws, map); }
    return map;
  }

  function onSessionDone(sourceSlug) {
    // Increment unread for all clients NOT connected to sourceSlug
    projects.forEach(function (ctx, projSlug) {
      if (projSlug === sourceSlug) return;
      ctx.forEachClient(function (ws) {
        var map = getCrossProjectUnread(ws);
        map[sourceSlug] = (map[sourceSlug] || 0) + 1;
      });
    });
    // Trigger a projects_updated broadcast so clients get updated unread counts
    broadcastProcessingChange();
  }

  // --- Debounced broadcast for processing status changes ---
  var processingUpdateTimer = null;
  function broadcastProcessingChange() {
    if (processingUpdateTimer) clearTimeout(processingUpdateTimer);
    processingUpdateTimer = setTimeout(function () {
      processingUpdateTimer = null;
      var allProjectsList = getProjects();
      // Always send per-client to include cross-project unread counts
      projects.forEach(function (ctx, projSlug) {
        ctx.forEachClient(function (ws) {
          var filtered = allProjectsList;
          if (users.isMultiUser() && onGetProjectAccess) {
            var wsUser = ws._clayUser;
            if (wsUser) {
              filtered = allProjectsList.filter(function (p) {
                var access = onGetProjectAccess(p.slug);
                if (!access || access.error) return true;
                return users.canAccessProject(wsUser.id, access);
              });
            }
          }
          // Attach per-project unread counts for this client
          var unreadMap = getCrossProjectUnread(ws);
          var projectsWithUnread = filtered.map(function (p) {
            var copy = {};
            var keys = Object.keys(p);
            for (var i = 0; i < keys.length; i++) copy[keys[i]] = p[keys[i]];
            // For the current project, use session-level unread total
            if (p.slug === projSlug) {
              copy.unread = ctx.sm.getTotalUnread(ws);
            } else {
              copy.unread = unreadMap[p.slug] || 0;
            }
            return copy;
          });
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "projects_updated",
              projects: projectsWithUnread,
              projectCount: projectsWithUnread.length,
              removedProjects: getRemovedProjects(ws._clayUser ? ws._clayUser.id : null),
            }));
          }
        });
      });
    }, 200);
  }

  // --- Project management ---
  function addProject(cwd, slug, title, icon, projectOwnerId, worktreeMeta, extraOpts) {
    if (projects.has(slug)) return false;
    var extra = extraOpts || {};
    var ctx = createProjectContext({
      cwd: cwd,
      slug: slug,
      title: title || null,
      icon: icon || null,
      projectOwnerId: projectOwnerId || null,
      worktreeMeta: worktreeMeta || null,
      isMate: extra.isMate || false,
      mateDisplayName: extra.mateDisplayName || "",
      isAgent: extra.isAgent || false,
      agentName: extra.agentName || "",
      agentDescription: extra.agentDescription || "",
      agentModel: extra.agentModel || "",
      agentSourcePath: extra.agentSourcePath || "",
      agentBody: extra.agentBody || "",
      agentHomeDir: extra.agentHomeDir || "",
      pushModule: pushModule,
      debug: debug,
      dangerouslySkipPermissions: dangerouslySkipPermissions,
      osUsers: osUsers,
      currentVersion: currentVersion,
      lanHost: lanHost,
      port: portNum,
      tls: !!tlsOptions,
      authToken: pinHash || null,
      getProjectCount: function () { return projects.size; },
      getProjectList: function (userId) {
        var list = [];
        projects.forEach(function (ctx, s) {
          var status = ctx.getStatus();
          if (userId && users.isMultiUser() && onGetProjectAccess) {
            var access = onGetProjectAccess(s);
            if (access && !access.error && !users.canAccessProject(userId, access)) return;
          }
          list.push(status);
        });
        return list;
      },
      getAllProjectSessions: function () {
        var allSessions = [];
        projects.forEach(function (pCtx, pSlug) {
          if (pSlug === slug) return; // skip self
          var status = pCtx.getStatus();
          if (status.isWorktree) return;
          var pSm = pCtx.getSessionManager();
          if (!pSm) return;
          var projectTitle = status.title || status.project || pSlug;
          pSm.sessions.forEach(function (s) {
            if (!s.hidden && s.history && s.history.length > 0) {
              s._projectTitle = projectTitle;
              allSessions.push(s);
            }
          });
        });
        return allSessions;
      },
      getHubSchedules: function () {
        var allSchedules = [];
        projects.forEach(function (ctx, s) {
          var status = ctx.getStatus();
          var recs = ctx.getSchedules();
          for (var i = 0; i < recs.length; i++) {
            // Shallow-copy full record and augment with project metadata
            var copy = {};
            var keys = Object.keys(recs[i]);
            for (var k = 0; k < keys.length; k++) copy[keys[k]] = recs[i][keys[k]];
            copy.projectSlug = s;
            copy.projectTitle = status.title || status.project;
            allSchedules.push(copy);
          }
        });
        return allSchedules;
      },
      // Move a schedule record from one project to another
      moveScheduleToProject: function (recordId, fromSlug, toSlug) {
        var fromCtx = projects.get(fromSlug);
        var toCtx = projects.get(toSlug);
        if (!fromCtx || !toCtx) return { ok: false, error: "Project not found" };
        var recs = fromCtx.getSchedules();
        var rec = null;
        for (var i = 0; i < recs.length; i++) {
          if (recs[i].id === recordId) { rec = recs[i]; break; }
        }
        if (!rec) return { ok: false, error: "Record not found" };
        // Copy full record data
        var data = {};
        var keys = Object.keys(rec);
        for (var k = 0; k < keys.length; k++) data[keys[k]] = rec[keys[k]];
        // Import into target, remove from source
        toCtx.importSchedule(data);
        fromCtx.removeSchedule(recordId);
        return { ok: true };
      },
      // Bulk move all schedules from one project to another
      moveAllSchedulesToProject: function (fromSlug, toSlug) {
        var fromCtx = projects.get(fromSlug);
        var toCtx = projects.get(toSlug);
        if (!fromCtx || !toCtx) return { ok: false, error: "Project not found" };
        var recs = fromCtx.getSchedules();
        for (var i = 0; i < recs.length; i++) {
          var data = {};
          var keys = Object.keys(recs[i]);
          for (var k = 0; k < keys.length; k++) data[keys[k]] = recs[i][keys[k]];
          toCtx.importSchedule(data);
        }
        // Remove all from source
        var ids = recs.map(function (r) { return r.id; });
        for (var j = 0; j < ids.length; j++) {
          fromCtx.removeSchedule(ids[j]);
        }
        return { ok: true };
      },
      // Get schedule count for a project slug
      getScheduleCount: function (slug) {
        var ctx = projects.get(slug);
        if (!ctx) return 0;
        return ctx.getSchedules().length;
      },
      onPresenceChange: broadcastPresenceChange,
      onProcessingChanged: broadcastProcessingChange,
      onSessionDone: function () { onSessionDone(slug); },
      onAddProject: onAddProject,
      onCreateProject: onCreateProject,
      onCloneProject: onCloneProject,
      onRemoveProject: onRemoveProject,
      onCreateWorktree: onCreateWorktree,
      onReorderProjects: onReorderProjects,
      onSetProjectTitle: onSetProjectTitle,
      onSetProjectIcon: onSetProjectIcon,
      onProjectOwnerChanged: onProjectOwnerChanged,
      onGetServerDefaultEffort: onGetServerDefaultEffort,
      onSetServerDefaultEffort: onSetServerDefaultEffort,
      onGetProjectDefaultEffort: onGetProjectDefaultEffort,
      onSetProjectDefaultEffort: onSetProjectDefaultEffort,
      onGetServerDefaultModel: onGetServerDefaultModel,
      onSetServerDefaultModel: onSetServerDefaultModel,
      onGetProjectDefaultModel: onGetProjectDefaultModel,
      onSetProjectDefaultModel: onSetProjectDefaultModel,
      onGetServerDefaultMode: onGetServerDefaultMode,
      onSetServerDefaultMode: onSetServerDefaultMode,
      onGetProjectDefaultMode: onGetProjectDefaultMode,
      onSetProjectDefaultMode: onSetProjectDefaultMode,
      onGetProjectMcpServers: onGetProjectMcpServers,
      onSetProjectMcpServers: onSetProjectMcpServers,
      onGetDaemonConfig: onGetDaemonConfig,
      onSetPin: onSetPin,
      onSetKeepAwake: onSetKeepAwake,
      onSetImageRetention: onSetImageRetention,
      onSetUpdateChannel: onSetUpdateChannel,
      updateChannel: onGetDaemonConfig ? (onGetDaemonConfig().updateChannel || "stable") : "stable",
      onShutdown: onShutdown,
      onRestart: onRestart,
      onDmMessage: handleDmMessage,
      broadcastAll: broadcastAll,
      notificationsModule: _globalNotifications,
      getProject: function (s) { return projects.get(s) || null; },
      isUserOnline: isUserOnline,
    });
    projects.set(slug, ctx);
    // ctx.warmup() is now deferred to the first websocket connection into
    // this project (see project-connection.js handleConnection). Warming
    // every project at startup spawned a CodexAppServer and an mcp-bridge
    // child for each one, which cost 30+ processes on daemons with many
    // projects/mates even though the user typically only opens one.
    // Schedule project registry refresh for all mates when a non-mate project is added
    if (!extra.isMate) scheduleRegistryRefresh();
    return true;
  }

  // --- DM message handler (delegated to server-dm + server-mates inline) ---
  var dmHandler = serverDm.attachDm({
    users: users,
    dm: dm,
    mates: mates,
    projects: projects,
    pushModule: pushModule,
    addProject: addProject,
  });

  // --- Email account handler (per-user email account management) ---
  var emailHandler = serverEmail.attachEmail({ users: users });

  // --- Mate handler ---
  // Forward reference: mateHandler is set up after removeProject is defined
  var mateHandler = null;
  function scheduleRegistryRefresh() {
    if (mateHandler) mateHandler.scheduleRegistryRefresh();
  }

  function handleDmMessage(ws, msg) {
    if (dmHandler.handleMessage(ws, msg)) return;
    if (mateHandler && mateHandler.handleMessage(ws, msg)) return;
    if (emailHandler.handleMessage(ws, msg)) return;
  }

  function removeProject(slug) {
    var ctx = projects.get(slug);
    if (!ctx) return false;
    var wasMate = ctx.getStatus().isMate;
    var shutdownResult = ctx.destroy();
    projects.delete(slug);
    if (shutdownResult && typeof shutdownResult.catch === "function") {
      shutdownResult.catch(function(err) {
        console.error("[server] Project destroy failed for " + slug + ":", err && err.message ? err.message : err);
      });
    }
    if (!wasMate) scheduleRegistryRefresh();
    return true;
  }

  // Now that addProject and removeProject are defined, initialize mateHandler
  mateHandler = serverMates.attachMates({
    users: users,
    mates: mates,
    projects: projects,
    addProject: addProject,
    removeProject: removeProject,
    onGetProjectAccess: onGetProjectAccess,
  });

  function getProjects() {
    var list = [];
    projects.forEach(function (ctx) {
      list.push(ctx.getStatus());
    });
    return list;
  }

  function reorderProjects(slugs) {
    var ordered = new Map();
    for (var i = 0; i < slugs.length; i++) {
      var ctx = projects.get(slugs[i]);
      if (ctx) ordered.set(slugs[i], ctx);
    }
    // Append any remaining (safety)
    projects.forEach(function (ctx, slug) {
      if (!ordered.has(slug)) ordered.set(slug, ctx);
    });
    projects.clear();
    ordered.forEach(function (ctx, slug) {
      projects.set(slug, ctx);
    });
  }

  function setProjectTitle(slug, title) {
    var ctx = projects.get(slug);
    if (!ctx) return false;
    ctx.setTitle(title);
    return true;
  }

  function setProjectIcon(slug, icon) {
    var ctx = projects.get(slug);
    if (!ctx) return false;
    ctx.setIcon(icon);
    return true;
  }

  // Collect all unique users across all projects (for topbar server-wide presence)
  function getServerUsers() {
    var seen = {};
    var list = [];
    projects.forEach(function (ctx) {
      ctx.forEachClient(function (ws) {
        if (!ws._clayUser) return;
        var u = ws._clayUser;
        if (seen[u.id]) return;
        seen[u.id] = true;
        var p = u.profile || {};
        list.push({
          id: u.id,
          displayName: p.name || u.displayName || u.username,
          username: u.username,
          avatarStyle: p.avatarStyle || "thumbs",
          avatarSeed: p.avatarSeed || u.username,
          avatarCustom: p.avatarCustom || "",
        });
      });
    });
    return list;
  }

  // Debounced broadcast of projects_updated when presence changes
  // Sends per-user filtered project lists + server-wide user list
  var presenceTimer = null;
  function broadcastPresenceChange() {
    if (presenceTimer) clearTimeout(presenceTimer);
    presenceTimer = setTimeout(function () {
      presenceTimer = null;
      if (!users.isMultiUser()) {
        broadcastAll({
          type: "projects_updated",
          projects: getProjects(),
          projectCount: projects.size,
          removedProjects: getRemovedProjects(),
        });
        return;
      }
      var serverUsers = getServerUsers();
      var allUsers = users.getAllUsers().map(function (u) {
        var p = u.profile || {};
        return {
          id: u.id,
          displayName: p.name || u.displayName || u.username,
          username: u.username,
          role: u.role,
          avatarStyle: p.avatarStyle || "thumbs",
          avatarSeed: p.avatarSeed || u.username,
          avatarColor: p.avatarColor || "#7c3aed",
          avatarCustom: p.avatarCustom || "",
        };
      });
      // Build per-user filtered lists, send individually
      var sentUsers = {};
      projects.forEach(function (ctx) {
        ctx.forEachClient(function (ws) {
          var userId = ws._clayUser ? ws._clayUser.id : null;
          var key = userId || "__anon__";
          if (sentUsers[key]) {
            // Already computed for this user, just send the cached msg
            ws.send(sentUsers[key]);
            return;
          }
          var filteredProjects = [];
          projects.forEach(function (pCtx, s) {
            var status = pCtx.getStatus();
            if (userId && onGetProjectAccess) {
              var access = onGetProjectAccess(s);
              if (access && !access.error && !users.canAccessProject(userId, access)) return;
            }
            filteredProjects.push(status);
          });
          // Per-user DM data
          var userDmFavorites = userId ? users.getDmFavorites(userId) : [];
          var userDmHidden = userId ? users.getDmHidden(userId) : [];
          var userDmConversations = [];
          if (userId) {
            var dmList = dm.getDmList(userId);
            for (var di = 0; di < dmList.length; di++) {
              if (userDmHidden.indexOf(dmList[di].otherUserId) === -1) {
                userDmConversations.push(dmList[di].otherUserId);
              }
            }
          }
          var msgStr = JSON.stringify({
            type: "projects_updated",
            projects: filteredProjects,
            projectCount: projects.size,
            serverUsers: serverUsers,
            allUsers: allUsers,
            dmFavorites: userDmFavorites,
            dmConversations: userDmConversations,
            removedProjects: getRemovedProjects(userId),
          });
          sentUsers[key] = msgStr;
          ws.send(msgStr);
        });
      });
    }, 300);
  }

  function broadcastAll(msg) {
    projects.forEach(function (ctx) {
      ctx.send(msg);
    });
  }

  // Send a message to every live ws belonging to a specific user across all projects.
  // Used by user-targeted notifications (e.g. user-to-user @mentions).
  function sendToUser(userId, msg) {
    if (!userId) return;
    var data = JSON.stringify(msg);
    projects.forEach(function (ctx) {
      if (typeof ctx.forEachClient !== "function") return;
      ctx.forEachClient(function (ws) {
        if (ws._clayUser && ws._clayUser.id === userId && ws.readyState === 1) {
          ws.send(data);
        }
      });
    });
  }

  // True if the user has any live ws across any project.
  function isUserOnline(userId) {
    if (!userId) return false;
    var found = false;
    projects.forEach(function (ctx) {
      if (found) return;
      if (typeof ctx.forEachClient !== "function") return;
      ctx.forEachClient(function (ws) {
        if (found) return;
        if (ws._clayUser && ws._clayUser.id === userId && ws.readyState === 1) {
          found = true;
        }
      });
    });
    return found;
  }

  function forEachProject(fn) {
    projects.forEach(function (ctx, slug) {
      fn(ctx, slug);
    });
  }

  function destroyAll() {
    var shutdowns = [];
    projects.forEach(function (ctx, slug) {
      console.log("[server] Destroying project:", slug);
      var result = ctx.destroy();
      if (result && typeof result.then === "function") {
        shutdowns.push(result.catch(function(err) {
          console.error("[server] Project destroy failed for " + slug + ":", err && err.message ? err.message : err);
          return false;
        }));
      }
    });
    projects.clear();
    return Promise.all(shutdowns);
  }

  // --- Periodic cleanup of old chat images ---
  var imagesBaseDir = path.join(CONFIG_DIR, "images");
  function getImageMaxAgeMs() {
    var days = onGetDaemonConfig ? onGetDaemonConfig().imageRetentionDays : undefined;
    if (days === undefined) days = 7;
    if (days === 0) return 0; // 0 = keep forever
    return days * 24 * 60 * 60 * 1000;
  }
  function cleanupOldImages() {
    var maxAge = getImageMaxAgeMs();
    if (maxAge === 0) return; // keep forever
    try {
      if (!fs.existsSync(imagesBaseDir)) return;
      var dirs = fs.readdirSync(imagesBaseDir);
      var now = Date.now();
      var removed = 0;
      for (var d = 0; d < dirs.length; d++) {
        var dirPath = path.join(imagesBaseDir, dirs[d]);
        try {
          var stat = fs.statSync(dirPath);
          if (!stat.isDirectory()) continue;
        } catch (e) { continue; }
        var files = fs.readdirSync(dirPath);
        for (var f = 0; f < files.length; f++) {
          var filePath = path.join(dirPath, files[f]);
          try {
            var fstat = fs.statSync(filePath);
            if (now - fstat.mtimeMs > maxAge) {
              fs.unlinkSync(filePath);
              removed++;
            }
          } catch (e) {}
        }
        // Remove empty directory
        try {
          var remaining = fs.readdirSync(dirPath);
          if (remaining.length === 0) fs.rmdirSync(dirPath);
        } catch (e) {}
      }
      if (removed > 0) console.log("[images] Cleaned up " + removed + " expired image(s)");
    } catch (e) {
      console.error("[images] Cleanup error:", e.message);
    }
  }
  cleanupOldImages();
  setInterval(cleanupOldImages, 24 * 60 * 60 * 1000);

  return {
    server: server,
    onboardingServer: onboardingServer,
    isTLS: !!tlsOptions,
    addProject: addProject,
    removeProject: removeProject,
    getProjects: getProjects,
    reorderProjects: reorderProjects,
    setProjectTitle: setProjectTitle,
    setProjectIcon: setProjectIcon,
    setAuthToken: auth.setAuthToken,
    setRecovery: auth.setRecovery,
    clearRecovery: auth.clearRecovery,
    broadcastAll: broadcastAll,
    forEachProject: forEachProject,
    destroyProject: removeProject,
    destroyAll: destroyAll,
  };
}

module.exports = { createServer: createServer, generateAuthToken: generateAuthToken, verifyPin: verifyPin };
