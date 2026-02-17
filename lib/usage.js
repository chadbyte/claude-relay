var os = require("os");
var path = require("path");
var fs = require("fs");
var { execFileSync } = require("child_process");
var https = require("https");

var BASE_API_URL = "https://api.anthropic.com";

function readOAuthToken() {
  // Priority 1: env var override
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  // Priority 2: macOS keychain
  if (process.platform === "darwin") {
    try {
      var user = os.userInfo().username;
      var data = execFileSync("security", [
        "find-generic-password", "-a", user, "-w", "-s", "Claude Code-credentials"
      ], { encoding: "utf8", timeout: 5000 }).trim();
      if (data) {
        var parsed = JSON.parse(data);
        if (parsed.claudeAiOauth && parsed.claudeAiOauth.accessToken) {
          return parsed.claudeAiOauth.accessToken;
        }
      }
    } catch (e) { /* fall through */ }
  }

  // Priority 3: plaintext credentials file
  var configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  var credFile = path.join(configDir, ".credentials.json");
  try {
    var content = fs.readFileSync(credFile, "utf8");
    var parsed = JSON.parse(content);
    if (parsed.claudeAiOauth && parsed.claudeAiOauth.accessToken) {
      return parsed.claudeAiOauth.accessToken;
    }
  } catch (e) { /* fall through */ }

  return null;
}

function fetchUsageData() {
  return new Promise(function (resolve, reject) {
    var token = readOAuthToken();
    if (!token) {
      reject(new Error("No OAuth token available"));
      return;
    }

    var url = new URL(BASE_API_URL + "/api/oauth/usage");
    var options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.0.0",
      },
      timeout: 5000,
    };

    var req = https.request(options, function (res) {
      var body = "";
      res.on("data", function (chunk) { body += chunk; });
      res.on("end", function () {
        if (res.statusCode !== 200) {
          reject(new Error("Usage API returned " + res.statusCode));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error("Invalid JSON from usage API"));
        }
      });
    });

    req.on("error", function (err) { reject(err); });
    req.on("timeout", function () { req.destroy(); reject(new Error("Usage API timeout")); });
    req.end();
  });
}

module.exports = { fetchUsageData: fetchUsageData };
