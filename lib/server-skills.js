var http = require("http");
var https = require("https");

// --- Skills proxy cache & helpers ---

var skillsCache = {};

function httpGet(url) {
  return new Promise(function (resolve, reject) {
    var mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "Clay/1.0" } }, function (resp) {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return httpGet(resp.headers.location).then(resolve, reject);
      }
      var chunks = [];
      resp.on("data", function (c) { chunks.push(c); });
      resp.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
      resp.on("error", reject);
    }).on("error", reject);
  });
}

function fetchSkillsPage(url) {
  return httpGet(url).then(function (html) {
    // Data is inside self.__next_f.push() with escaped quotes: \"initialSkills\":[{\"source\":...}]
    var marker = 'initialSkills';
    var idx = html.indexOf(marker);
    if (idx < 0) return { skills: [] };

    // Find the start of the array: look for \\\":[
    var arrStart = html.indexOf(':[', idx);
    if (arrStart < 0) return { skills: [] };
    arrStart += 1; // point to '['

    // Find matching ']' -- track bracket depth
    var depth = 0;
    var arrEnd = -1;
    for (var i = arrStart; i < html.length; i++) {
      var ch = html[i];
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { arrEnd = i + 1; break; }
      }
    }
    if (arrEnd < 0) return { skills: [] };

    var raw = html.substring(arrStart, arrEnd);
    // Unescape: \\\" -> " and \\\\ -> backslash
    var unescaped = raw.replace(/\\\\"/g, '__BSLASH_QUOTE__').replace(/\\"/g, '"').replace(/__BSLASH_QUOTE__/g, '\\"');

    try {
      return { skills: JSON.parse(unescaped) };
    } catch (e) {
      return { skills: [] };
    }
  });
}

function fetchSkillDetail(url) {
  return httpGet(url).then(function (html) {
    var result = {};

    // Title: "skill-name by owner/repo"
    var titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      var parts = titleMatch[1].split(" by ");
      result.name = parts[0].trim();
    }

    // Description from meta
    var descMatch = html.match(/meta name="description" content="([^"]+)"/);
    if (descMatch) result.description = descMatch[1];

    // Install command
    var cmdMatch = html.match(/npx skills add [^ ]+ --skill [^ "<]+/);
    if (cmdMatch) result.command = cmdMatch[0];

    // Weekly installs: "Weekly Installs</span></div><div ...>VALUE</div>"
    var wiMatch = html.match(/Weekly Installs<\/span><\/div><div[^>]*>([\d,.]+K?)<\/div>/);
    if (wiMatch) result.weeklyInstalls = wiMatch[1];

    // GitHub Stars: after SVG icon, inside <span>X.XK</span>
    var gsIdx = html.indexOf("GitHub Stars");
    if (gsIdx > 0) {
      var gsRegion = html.substring(gsIdx, gsIdx + 1000);
      var gsVal = gsRegion.match(/<span>(\d[\d,.]*K?)<\/span>/);
      if (gsVal) result.githubStars = gsVal[1];
    }

    // First Seen
    var fsMatch = html.match(/First Seen<\/span><\/div><div[^>]*>([^<]+)<\/div>/);
    if (fsMatch) result.firstSeen = fsMatch[1].trim();

    // Repository: from title "by owner/repo"
    if (titleMatch) {
      var byParts = titleMatch[1].split(" by ");
      if (byParts[1]) result.repository = byParts[1].trim();
    }

    // Security audits: "text-foreground truncate">NAME</span><span ...>STATUS</span>"
    var audits = [];
    var auditRegex = /class="text-sm font-medium text-foreground truncate">([^<]+)<\/span><span class="[^"]*">(\w+)<\/span>/g;
    var am;
    while ((am = auditRegex.exec(html)) !== null) {
      audits.push({ name: am[1], status: am[2].toLowerCase() });
    }
    if (audits.length) result.audits = audits;

    // Installed on: "text-foreground">NAME</span><span class="text-muted-foreground font-mono">COUNT</span>
    var ioIdx = html.indexOf("Installed On");
    if (ioIdx > 0) {
      var ioRegion = html.substring(ioIdx, ioIdx + 3000);
      var platforms = [];
      var platRegex = /text-foreground">([^<]+)<\/span><span class="text-muted-foreground font-mono">([\d,.]+K?)<\/span>/g;
      var pm;
      while ((pm = platRegex.exec(ioRegion)) !== null) {
        platforms.push({ name: pm[1], installs: pm[2] });
      }
      if (platforms.length) result.installedOn = platforms;
    }

    // SKILL.md content: rendered HTML inside the main content area
    var skillMdIdx = html.indexOf("SKILL.md");
    if (skillMdIdx > 0) {
      // Find the prose content div after SKILL.md marker
      var proseIdx = html.indexOf("prose", skillMdIdx);
      if (proseIdx > 0) {
        var proseStart = html.indexOf(">", proseIdx) + 1;
        // Find the closing of the prose div (heuristic: next major section boundary)
        var endMarkers = ["<div class=\"bg-background", "<div class=\"sticky"];
        var proseEnd = html.length;
        for (var em = 0; em < endMarkers.length; em++) {
          var endIdx = html.indexOf(endMarkers[em], proseStart);
          if (endIdx > 0 && endIdx < proseEnd) proseEnd = endIdx;
        }
        var rawMd = html.substring(proseStart, proseEnd);
        // Rebase relative URLs to absolute (skills.sh base)
        result.skillMd = rawMd
          .replace(/src="(?!https?:\/\/|data:)([^"]+)"/g, function (m, p) {
            return 'src="' + new URL(p, url).href + '"';
          })
          .replace(/href="(?!https?:\/\/|mailto:|#)([^"]+)"/g, function (m, p) {
            return 'href="' + new URL(p, url).href + '"';
          });
      }
    }

    return result;
  });
}

function attachSkills(ctx) {
  var users = ctx.users;
  var osUsers = ctx.osUsers;
  var getMultiUserFromReq = ctx.getMultiUserFromReq;

  function handleRequest(req, res, fullUrl) {
    // Skills proxy: permission gate + routes
    if (fullUrl !== "/api/skills" && !fullUrl.startsWith("/api/skills/") && !fullUrl.startsWith("/api/skills?")) {
      return false;
    }

    // Permission gate
    if (users.isMultiUser()) {
      var skMu = getMultiUserFromReq(req);
      if (skMu) {
        var skPerms = users.getEffectivePermissions(skMu, osUsers);
        if (!skPerms.skills) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"Skills access is not permitted"}');
          return true;
        }
      }
    }

    // Skills proxy: leaderboard list
    if (req.method === "GET" && fullUrl === "/api/skills") {
      var qs = req.url.indexOf("?") >= 0 ? req.url.substring(req.url.indexOf("?")) : "";
      var tabParam = new URLSearchParams(qs).get("tab") || "all";
      var tabPath = tabParam === "trending" ? "/trending" : tabParam === "hot" ? "/hot" : "/";
      var cacheKey = "skills_" + tabParam;
      var cached = skillsCache[cacheKey];
      if (cached && Date.now() - cached.ts < 300000) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(cached.data);
        return true;
      }
      fetchSkillsPage("https://skills.sh" + tabPath).then(function (data) {
        var json = JSON.stringify(data);
        skillsCache[cacheKey] = { ts: Date.now(), data: json };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(json);
      }).catch(function (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch skills: " + (err.message || err) }));
      });
      return true;
    }

    // Skills proxy: search
    if (req.method === "GET" && fullUrl.startsWith("/api/skills/search")) {
      var sqsRaw = req.url.indexOf("?") >= 0 ? req.url.substring(req.url.indexOf("?")) : "";
      var searchQ = new URLSearchParams(sqsRaw).get("q") || "";
      if (!searchQ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"missing q param"}');
        return true;
      }
      var searchCacheKey = "search_" + searchQ.toLowerCase();
      var searchCached = skillsCache[searchCacheKey];
      if (searchCached && Date.now() - searchCached.ts < 300000) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(searchCached.data);
        return true;
      }
      // Reuse cached "all" tab data if available, otherwise fetch
      var allCached = skillsCache["skills_all"];
      var allPromise = (allCached && Date.now() - allCached.ts < 300000)
        ? Promise.resolve(JSON.parse(allCached.data))
        : fetchSkillsPage("https://skills.sh/");
      allPromise.then(function (data) {
        var q = searchQ.toLowerCase();
        var filtered = (data.skills || []).filter(function (s) {
          var name = (s.name || "").toLowerCase();
          var source = (s.source || "").toLowerCase();
          var skillId = (s.skillId || "").toLowerCase();
          return name.indexOf(q) >= 0 || source.indexOf(q) >= 0 || skillId.indexOf(q) >= 0;
        });
        var json = JSON.stringify({ skills: filtered });
        skillsCache[searchCacheKey] = { ts: Date.now(), data: json };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(json);
      }).catch(function (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to search skills: " + (err.message || err) }));
      });
      return true;
    }

    // Skills proxy: skill detail
    if (req.method === "GET" && fullUrl.startsWith("/api/skills/detail")) {
      var qs2 = req.url.indexOf("?") >= 0 ? req.url.substring(req.url.indexOf("?")) : "";
      var params2 = new URLSearchParams(qs2);
      var detailSource = params2.get("source");
      var detailSkill = params2.get("skill");
      if (!detailSource || !detailSkill) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"missing source or skill param"}');
        return true;
      }
      var detailCacheKey = "detail_" + detailSource + "_" + detailSkill;
      var detailCached = skillsCache[detailCacheKey];
      if (detailCached && Date.now() - detailCached.ts < 300000) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(detailCached.data);
        return true;
      }
      var detailUrl = "https://skills.sh/" + encodeURIComponent(detailSource).replace(/%2F/g, "/") + "/" + encodeURIComponent(detailSkill);
      fetchSkillDetail(detailUrl).then(function (data) {
        var json = JSON.stringify(data);
        skillsCache[detailCacheKey] = { ts: Date.now(), data: json };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(json);
      }).catch(function (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch skill detail: " + (err.message || err) }));
      });
      return true;
    }

    return false;
  }

  return {
    handleRequest: handleRequest,
  };
}

module.exports = { attachSkills: attachSkills };
