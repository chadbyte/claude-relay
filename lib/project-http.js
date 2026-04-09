var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");
var { execFileSync, spawn } = require("child_process");
var { fsAsUser } = require("./os-users");
var usersModule = require("./users");

var IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);
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
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};
var MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

function parseJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var body = "";
    req.on("data", function (chunk) { body += chunk; });
    req.on("end", function () {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
  });
}

/**
 * Attach HTTP request handler to a project context.
 *
 * ctx fields:
 *   cwd, slug, project, sm, send, sendTo, imagesDir, osUsers, pushModule,
 *   safePath, safeAbsPath, getOsUserInfoForReq, sendExtensionCommandAny,
 *   _extToken, _browserTabList
 */
function attachHTTP(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var project = ctx.project;
  var sm = ctx.sm;
  var send = ctx.send;
  var imagesDir = ctx.imagesDir;
  var osUsers = ctx.osUsers;
  var pushModule = ctx.pushModule;
  var safePath = ctx.safePath;
  var safeAbsPath = ctx.safeAbsPath;
  var getOsUserInfoForReq = ctx.getOsUserInfoForReq;
  var sendExtensionCommandAny = ctx.sendExtensionCommandAny;
  var _extToken = ctx._extToken;
  var _browserTabList = ctx._browserTabList;

  function handleHTTP(req, res, urlPath) {
    // Browser MCP extension bridge: forward commands to Chrome extension
    if (req.method === "POST" && urlPath === "/ext-command") {
      parseJsonBody(req).then(function (body) {
        // Validate auth token
        if (!body.token || body.token !== _extToken) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid token"}');
          return;
        }
        var command = body.command;
        var args = body.args || {};
        var timeout = Math.min(body.timeout || 5000, 30000); // max 30s

        // Special command: list_tabs (no extension round-trip needed)
        if (command === "list_tabs") {
          var tabArr = [];
          for (var tid in _browserTabList) {
            tabArr.push(_browserTabList[tid]);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result: { tabs: tabArr } }));
          return;
        }

        sendExtensionCommandAny(command, args, timeout).then(function (result) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result: result || {} }));
        }).catch(function (err) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "Extension command failed" }));
        });
      }).catch(function () {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Invalid JSON body"}');
      });
      return true;
    }

    // Serve chat images
    if (req.method === "GET" && urlPath.indexOf("/images/") === 0) {
      var imgName = path.basename(urlPath);
      // Sanitize: only allow expected filename pattern
      if (!/^\d+-[a-f0-9]+\.\w+$/.test(imgName)) {
        res.writeHead(400);
        res.end("Bad request");
        return true;
      }
      var imgPath = path.join(imagesDir, imgName);
      try {
        var imgBuf = fs.readFileSync(imgPath);
        var ext = path.extname(imgName).toLowerCase();
        var mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
        res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
        res.end(imgBuf);
      } catch (e) {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    // File upload
    if (req.method === "POST" && urlPath === "/api/upload") {
      parseJsonBody(req).then(function (body) {
        var fileName = body.name;
        var fileData = body.data; // base64
        if (!fileName || !fileData) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing name or data"}');
          return;
        }
        // Sanitize filename — strip path separators
        var safeName = path.basename(fileName).replace(/[\x00-\x1f\/\\:*?"<>|]/g, "_");
        if (!safeName) safeName = "upload";

        // Check size
        var estimatedBytes = fileData.length * 0.75;
        if (estimatedBytes > MAX_UPLOAD_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end('{"error":"file too large (max 50MB)"}');
          return;
        }

        // Create tmp dir: os.tmpdir()/clay-{hash}/
        var cwdHash = crypto.createHash("sha256").update(cwd).digest("hex").substring(0, 12);
        var tmpDir = path.join(os.tmpdir(), "clay-" + cwdHash);
        try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}

        // Add timestamp prefix to avoid collisions
        var ts = Date.now();
        var destName = ts + "-" + safeName;
        var destPath = path.join(tmpDir, destName);

        try {
          var buf = Buffer.from(fileData, "base64");
          fs.writeFileSync(destPath, buf);
          // Make readable by all local users and chown to session owner
          try { fs.chmodSync(destPath, 0o644); } catch (e2) {}
          try { fs.chmodSync(tmpDir, 0o755); } catch (e2) {}
          if (req._clayUser && req._clayUser.linuxUser) {
            try {
              var _osUM = require("./os-users");
              var _uid = _osUM.getLinuxUserUid(req._clayUser.linuxUser);
              if (_uid != null) {
                require("child_process").execSync("chown " + _uid + " " + JSON.stringify(destPath));
                require("child_process").execSync("chown " + _uid + " " + JSON.stringify(tmpDir));
              }
            } catch (e2) {}
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ path: destPath, name: safeName }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "failed to save: " + (e.message || e) }));
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Push subscribe
    if (req.method === "POST" && urlPath === "/api/push-subscribe") {
      parseJsonBody(req).then(function (body) {
        var sub = body.subscription || body;
        if (pushModule) pushModule.addSubscription(sub, body.replaceEndpoint);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Permission response from push notification
    if (req.method === "POST" && urlPath === "/api/permission-response") {
      parseJsonBody(req).then(function (data) {
        var requestId = data.requestId;
        var decision = data.decision;
        if (!requestId || !decision) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing requestId or decision"}');
          return;
        }
        var found = false;
        sm.sessions.forEach(function (session) {
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
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // VAPID public key
    if (req.method === "GET" && urlPath === "/api/vapid-public-key") {
      if (pushModule) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" });
        res.end(JSON.stringify({ publicKey: pushModule.publicKey }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"push not available"}');
      }
      return true;
    }

    // File browser: serve project images
    if (req.method === "GET" && urlPath.startsWith("/api/file?")) {
      var qIdx = urlPath.indexOf("?");
      var params = new URLSearchParams(urlPath.substring(qIdx));
      var reqFilePath = params.get("path");
      if (!reqFilePath) { res.writeHead(400); res.end("Missing path"); return true; }
      var absFile = safePath(cwd, reqFilePath);
      if (!absFile && getOsUserInfoForReq(req)) {
        absFile = safeAbsPath(reqFilePath);
      }
      if (!absFile) { res.writeHead(403); res.end("Access denied"); return true; }
      var fileExt = path.extname(absFile).toLowerCase();
      if (!IMAGE_EXTS.has(fileExt)) { res.writeHead(403); res.end("Only image files"); return true; }
      try {
        var fileServeUserInfo = getOsUserInfoForReq(req);
        var fileContent;
        if (fileServeUserInfo) {
          var binResult = fsAsUser("read_binary", { file: absFile }, fileServeUserInfo);
          fileContent = binResult.buffer;
        } else {
          fileContent = fs.readFileSync(absFile);
        }
        var fileMime = MIME_TYPES[fileExt] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": fileMime, "Cache-Control": "no-cache" });
        res.end(fileContent);
      } catch (e) {
        res.writeHead(404); res.end("Not found");
      }
      return true;
    }

    // Skills permission gate
    if (urlPath === "/api/install-skill" || urlPath === "/api/uninstall-skill" || urlPath === "/api/installed-skills") {
      if (req._clayUser) {
        var skPerms = usersModule.getEffectivePermissions(req._clayUser, osUsers);
        if (!skPerms.skills) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"Skills access is not permitted"}');
          return true;
        }
      }
    }

    // Install a skill (background spawn)
    if (req.method === "POST" && urlPath === "/api/install-skill") {
      parseJsonBody(req).then(function (body) {
        var url = body.url;
        var skill = body.skill;
        var scope = body.scope; // "global" or "project"
        if (!url || !skill || !scope) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing url, skill, or scope"}');
          return;
        }
        // Validate skill name: alphanumeric, hyphens, underscores only
        if (!/^[a-zA-Z0-9_-]+$/.test(skill)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"invalid skill name"}');
          return;
        }
        // Validate URL: must be https://
        if (!/^https:\/\//i.test(url)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"only https:// URLs are allowed"}');
          return;
        }
        var skillUserInfo = getOsUserInfoForReq(req);
        var spawnCwd = scope === "global" ? (skillUserInfo ? skillUserInfo.home : require("./config").REAL_HOME) : cwd;
        var scopeFlag = scope === "global" ? "--global" : "--project";
        var skillSpawnOpts = {
          cwd: spawnCwd,
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        };
        if (skillUserInfo) {
          skillSpawnOpts.uid = skillUserInfo.uid;
          skillSpawnOpts.gid = skillUserInfo.gid;
          skillSpawnOpts.env = Object.assign({}, process.env, {
            HOME: skillUserInfo.home,
            npm_config_cache: require("path").join(skillUserInfo.home, ".npm"),
          });
        }
        console.log("[skill-install] spawning: npx skills add " + url + " --skill " + skill + " --yes " + scopeFlag + " (cwd: " + spawnCwd + ")");
        var child = spawn("npx", ["skills", "add", url, "--skill", skill, "--yes", scopeFlag], skillSpawnOpts);
        var stdoutBuf = "";
        var stderrBuf = "";
        child.stdout.on("data", function (chunk) {
          stdoutBuf += chunk.toString();
          console.log("[skill-install] " + skill + " stdout chunk: " + chunk.toString().trim().slice(0, 500));
        });
        child.stderr.on("data", function (chunk) {
          stderrBuf += chunk.toString();
          console.log("[skill-install] " + skill + " stderr chunk: " + chunk.toString().trim().slice(0, 500));
        });
        // Timeout after 60 seconds
        var installTimeout = setTimeout(function () {
          console.error("[skill-install] " + skill + " timed out after 60s, killing process");
          try { child.kill("SIGTERM"); } catch (e) {}
          try {
            send({ type: "skill_installed", skill: skill, scope: scope, success: false, error: "Installation timed out after 60 seconds" });
          } catch (e) {}
        }, 60000);
        child.on("close", function (code) {
          clearTimeout(installTimeout);
          console.log("[skill-install] " + skill + " exited with code " + code + " (stdout=" + stdoutBuf.length + "b, stderr=" + stderrBuf.length + "b)");
          if (stdoutBuf) console.log("[skill-install] stdout: " + stdoutBuf.slice(0, 2000));
          if (stderrBuf) console.log("[skill-install] stderr: " + stderrBuf.slice(0, 2000));
          try {
            var success = code === 0;
            send({
              type: "skill_installed",
              skill: skill,
              scope: scope,
              success: success,
              error: success ? null : "Process exited with code " + code,
            });
          } catch (e) {
            console.error("[project] skill_installed send failed:", e.message || e);
          }
        });
        child.on("error", function (err) {
          clearTimeout(installTimeout);
          console.error("[skill-install] " + skill + " spawn error:", err.message || err);
          try {
            send({
              type: "skill_installed",
              skill: skill,
              scope: scope,
              success: false,
              error: err.message,
            });
          } catch (e) {
            console.error("[skill-install] " + skill + " send failed:", e.message || e);
          }
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Uninstall a skill (remove directory)
    if (req.method === "POST" && urlPath === "/api/uninstall-skill") {
      parseJsonBody(req).then(function (body) {
        var skill = body.skill;
        var scope = body.scope; // "global" or "project"
        if (!skill || !scope) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing skill or scope"}');
          return;
        }
        // Validate skill name
        if (!/^[a-zA-Z0-9_-]+$/.test(skill)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"invalid skill name"}');
          return;
        }
        var uninstallUserInfo = getOsUserInfoForReq(req);
        var baseDir = scope === "global" ? (uninstallUserInfo ? uninstallUserInfo.home : require("./config").REAL_HOME) : cwd;
        var skillDir = path.join(baseDir, ".claude", "skills", skill);
        // Safety: ensure skillDir is inside the expected .claude/skills directory
        var expectedParent = path.join(baseDir, ".claude", "skills");
        var resolved = path.resolve(skillDir);
        if (!resolved.startsWith(expectedParent + path.sep)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"invalid skill path"}');
          return;
        }
        try {
          if (uninstallUserInfo) {
            // Run rm as target user to respect permissions
            var rmScript = "var fs = require('fs'); fs.rmSync(" + JSON.stringify(resolved) + ", { recursive: true, force: true });";
            execFileSync(process.execPath, ["-e", rmScript], {
              uid: uninstallUserInfo.uid,
              gid: uninstallUserInfo.gid,
              timeout: 10000,
            });
          } else {
            fs.rmSync(resolved, { recursive: true, force: true });
          }
          send({
            type: "skill_uninstalled",
            skill: skill,
            scope: scope,
            success: true,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch (err) {
          send({
            type: "skill_uninstalled",
            skill: skill,
            scope: scope,
            success: false,
            error: err.message,
          });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Installed skills (global + project)
    if (req.method === "GET" && urlPath === "/api/installed-skills") {
      var installed = {};
      var globalDir = path.join(require("./config").REAL_HOME, ".claude", "skills");
      var projectDir = path.join(cwd, ".claude", "skills");
      var scanDirs = [
        { dir: globalDir, scope: "global" },
        { dir: projectDir, scope: "project" },
      ];
      for (var sd = 0; sd < scanDirs.length; sd++) {
        var entries;
        try { entries = fs.readdirSync(scanDirs[sd].dir, { withFileTypes: true }); } catch (e) { continue; }
        for (var si = 0; si < entries.length; si++) {
          var ent = entries[si];
          if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
          var mdPath = path.join(scanDirs[sd].dir, ent.name, "SKILL.md");
          try {
            var mdContent = fs.readFileSync(mdPath, "utf8");
            var desc = "";
            // Parse YAML frontmatter for description
            var version = "";
            if (mdContent.startsWith("---")) {
              var endIdx = mdContent.indexOf("---", 3);
              if (endIdx !== -1) {
                var frontmatter = mdContent.substring(3, endIdx);
                var descMatch = frontmatter.match(/^description:\s*(.+)/m);
                if (descMatch) desc = descMatch[1].trim();
                var verMatch = frontmatter.match(/version:\s*"?([^"\n]+)"?/m);
                if (verMatch) version = verMatch[1].trim();
              }
            }
            if (!installed[ent.name]) {
              installed[ent.name] = { scope: scanDirs[sd].scope, description: desc, version: version, path: path.join(scanDirs[sd].dir, ent.name) };
            } else {
              // project-level adds to existing global entry
              installed[ent.name].scope = "both";
              if (desc && !installed[ent.name].description) installed[ent.name].description = desc;
              if (version && !installed[ent.name].version) installed[ent.name].version = version;
            }
          } catch (e) {}
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ installed: installed }));
      return true;
    }

    // Check skill updates (compare installed vs remote versions)
    if (req.method === "POST" && urlPath === "/api/check-skill-updates") {
      parseJsonBody(req).then(function (body) {
        var skills = body.skills; // [{ name, url, scope }]
        if (!Array.isArray(skills) || skills.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing skills array"}');
          return;
        }
        // Read installed versions (use requesting user's home in multi-user setups)
        var skillUserHome = (function () {
          var sui = getOsUserInfoForReq(req);
          return sui ? sui.home : require("./config").REAL_HOME;
        })();
        var globalSkillsDir = path.join(skillUserHome, ".claude", "skills");
        var projectSkillsDir = path.join(cwd, ".claude", "skills");
        var results = [];
        var pending = skills.length;

        function parseVersionFromSkillMd(content) {
          if (!content || !content.startsWith("---")) return "";
          var endIdx = content.indexOf("---", 3);
          if (endIdx === -1) return "";
          var fm = content.substring(3, endIdx);
          var m = fm.match(/version:\s*"?([^"\n]+)"?/m);
          return m ? m[1].trim() : "";
        }

        function getInstalledVersion(name) {
          var dirs = [path.join(globalSkillsDir, name, "SKILL.md"), path.join(projectSkillsDir, name, "SKILL.md")];
          for (var d = 0; d < dirs.length; d++) {
            try {
              var c = fs.readFileSync(dirs[d], "utf8");
              var v = parseVersionFromSkillMd(c);
              if (v) return v;
            } catch (e) {}
          }
          return "";
        }

        function compareVersions(a, b) {
          // returns -1 if a < b, 0 if equal, 1 if a > b
          if (!a && !b) return 0;
          if (!a) return -1;
          if (!b) return 1;
          var pa = a.split(".").map(Number);
          var pb = b.split(".").map(Number);
          for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
            var va = pa[i] || 0;
            var vb = pb[i] || 0;
            if (va < vb) return -1;
            if (va > vb) return 1;
          }
          return 0;
        }

        function finishOne() {
          pending--;
          if (pending === 0) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ results: results }));
          }
        }

        for (var si = 0; si < skills.length; si++) {
          (function (skill) {
            var installedVer = getInstalledVersion(skill.name);
            var installed = !!installedVer;
            console.log("[skill-check] " + skill.name + " installed=" + installed + " localVersion=" + (installedVer || "none"));
            // Convert GitHub repo URL to raw SKILL.md URL
            var rawUrl = "";
            var ghMatch = skill.url.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (ghMatch) {
              rawUrl = "https://raw.githubusercontent.com/" + ghMatch[1] + "/" + ghMatch[2] + "/main/SKILL.md";
            }
            if (!rawUrl) {
              console.log("[skill-check] " + skill.name + " no valid GitHub URL, skipping remote check");
              results.push({ name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: "", status: installed ? "ok" : "missing" });
              finishOne();
              return;
            }
            console.log("[skill-check] " + skill.name + " fetching remote: " + rawUrl);
            // Fetch remote SKILL.md
            var https = require("https");
            https.get(rawUrl, function (resp) {
              console.log("[skill-check] " + skill.name + " remote response status=" + resp.statusCode);
              var data = "";
              resp.on("data", function (chunk) { data += chunk; });
              resp.on("end", function () {
                try {
                  var remoteVer = parseVersionFromSkillMd(data);
                  var status = "ok";
                  if (!installed) {
                    status = "missing";
                  } else if (remoteVer && compareVersions(installedVer, remoteVer) < 0) {
                    status = "outdated";
                  }
                  console.log("[skill-check] " + skill.name + " remoteVersion=" + remoteVer + " status=" + status);
                  results.push({ name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: remoteVer, status: status });
                  finishOne();
                } catch (e) {
                  console.error("[skill-check] " + skill.name + " version parse failed:", e.message || e);
                  results.push({ name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: "", status: installed ? "ok" : "error" });
                  finishOne();
                }
              });
            }).on("error", function (err) {
              console.error("[skill-check] " + skill.name + " fetch error:", err.message || err);
              results.push({ name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: "", status: installed ? "ok" : "missing" });
              finishOne();
            });
          })(skills[si]);
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Git dirty check
    if (req.method === "GET" && urlPath === "/api/git-dirty") {
      var execSync = require("child_process").execSync;
      try {
        var out = execSync("git status --porcelain", { cwd: cwd, encoding: "utf8", timeout: 5000 });
        var dirty = out.trim().split("\n").some(function (line) {
          return line.trim().length > 0 && !line.startsWith("??");
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ dirty: dirty }));
      } catch (e) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ dirty: false }));
      }
      return true;
    }

    // List branches for worktree modal
    if (req.method === "GET" && urlPath === "/api/branches") {
      try {
        var brRaw = execFileSync("git", ["branch", "-a", "--format=%(refname:short)"], {
          cwd: cwd, timeout: 5000, encoding: "utf8"
        });
        var brList = brRaw.trim().split("\n").filter(Boolean);
        var defBr = "main";
        try {
          var hrRef = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], {
            cwd: cwd, timeout: 3000, encoding: "utf8"
          }).trim();
          defBr = hrRef.replace(/^origin\//, "");
        } catch (e) {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ branches: brList, defaultBranch: defBr }));
      } catch (e) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ branches: ["main"], defaultBranch: "main" }));
      }
      return true;
    }

    // Info endpoint
    if (req.method === "GET" && urlPath === "/info") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ cwd: cwd, project: project, slug: slug }));
      return true;
    }

    return false; // not handled
  }

  return {
    handleHTTP: handleHTTP,
  };
}

module.exports = { attachHTTP: attachHTTP, parseJsonBody: parseJsonBody };
