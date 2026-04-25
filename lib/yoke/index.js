// YOKE - Yoke Overrides Known Engines
// Public entry point.

var iface = require("./interface");
var instructions = require("./instructions");
var createClaudeAdapter = require("./adapters/claude").createClaudeAdapter;
var createCodexAdapter = require("./adapters/codex").createCodexAdapter;

/**
 * Wrap adapter.createQuery to inject cross-vendor project instructions.
 *
 * Scans the project directory for instruction files (CLAUDE.md, AGENTS.md,
 * .cursorrules, etc.) that the current vendor does NOT natively read,
 * and merges them into queryOpts.systemPrompt before calling the real
 * createQuery. This way every adapter gets project context regardless
 * of which vendor wrote the instruction file.
 */
function wrapCreateQuery(adapter, defaultCwd) {
  var originalCreateQuery = adapter.createQuery.bind(adapter);

  adapter.createQuery = function(queryOpts) {
    queryOpts = queryOpts || {};
    var projectDir = (queryOpts && queryOpts.cwd) || defaultCwd;
    var merged = instructions.scanAndMerge(projectDir, adapter.vendor);

    if (merged) {
      var parts = [];
      if (queryOpts.systemPrompt) parts.push(queryOpts.systemPrompt);
      parts.push(merged);
      queryOpts.systemPrompt = parts.join("\n\n");
    }

    return originalCreateQuery(queryOpts);
  };
}

/**
 * Create a YOKE adapter.
 *
 * @param {object} opts
 * @param {string} [opts.vendor="claude"] - Adapter vendor name
 * @param {string} opts.cwd              - Project working directory
 * @param {object} [opts.adapterOpts]    - Vendor-specific adapter construction options
 * @returns {Adapter}
 */
function createAdapter(opts) {
  var vendor = (opts && opts.vendor) || "claude";
  var adapter;
  if (vendor === "claude") {
    adapter = createClaudeAdapter(opts);
  } else if (vendor === "codex") {
    adapter = createCodexAdapter(opts);
  } else {
    throw new Error("[YOKE] Unknown adapter vendor: " + vendor);
  }
  iface.validateAdapter(adapter);
  wrapCreateQuery(adapter, opts && opts.cwd);
  return adapter;
}

/**
 * Check which vendors have valid auth credentials.
 * Result is cached after first call (auth state doesn't change during runtime).
 * Call invalidateAuthCache() to force re-check (e.g. after login).
 */
var _authCache = null;
var _lastAuthLogKey = null;
var _lastAuthLogAt = 0;

function logAuthCheck(auth) {
  var key = JSON.stringify(auth || {});
  var now = Date.now();
  if (_lastAuthLogKey === key && now - _lastAuthLogAt < 30000) return;
  _lastAuthLogKey = key;
  _lastAuthLogAt = now;
  console.log("[yoke] Auth check: claude=" + auth.claude + " codex=" + auth.codex);
}

function checkAuth() {
  if (_authCache) return _authCache;

  var execSync = require("child_process").execSync;
  var execFileSync = require("child_process").execFileSync;

  function lookupBinary(name) {
    try {
      if (process.platform === "win32") {
        return execFileSync("where", [name], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim().split(/\r?\n/)[0] || null;
      }
      return execFileSync("which", [name], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim().split(/\r?\n/)[0] || null;
    } catch (e) {
      return null;
    }
  }

  function parseClaudeAuthStatusJson(out) {
    if (!out) return null;
    try {
      return JSON.parse(out);
    } catch (e) {
      return null;
    }
  }

  function isClaudeLoggedInText(out) {
    if (!out) return false;
    var text = String(out).toLowerCase();
    if (text.indexOf("not logged in") !== -1) return false;
    if (text.indexOf("login method:") !== -1) return true;
    if (text.indexOf("logged in") !== -1) return true;
    return false;
  }

  function hasThirdPartyProviderAuth() {
    // Claude Code supports third-party providers via env vars. When these are set,
    // `claude auth status` reports "not logged in" because there is no OAuth session,
    // but Claude Code itself authenticates directly through the provider.
    var env = process.env;
    if (env.CLAUDE_CODE_USE_BEDROCK === "1"
        && (env.AWS_BEARER_TOKEN_BEDROCK
            || env.AWS_ACCESS_KEY_ID
            || env.AWS_PROFILE
            || env.AWS_SESSION_TOKEN)) {
      return "bedrock";
    }
    if (env.CLAUDE_CODE_USE_VERTEX === "1") return "vertex";
    if (env.ANTHROPIC_API_KEY) return "api_key";
    if (env.ANTHROPIC_AUTH_TOKEN) return "auth_token";
    return null;
  }

  function checkClaude() {
    var provider = hasThirdPartyProviderAuth();
    if (provider) {
      console.log("[yoke] Claude auth via third-party provider: " + provider);
      return true;
    }

    try {
      var out = execSync("claude auth status --json", { timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      var parsed = parseClaudeAuthStatusJson(out);
      if (parsed) return !!parsed.loggedIn;
      console.warn("[yoke] Claude auth status JSON parse failed; falling back to text output");
    } catch (e) {
      var stdout = e && e.stdout ? String(e.stdout) : "";
      if (stdout) {
        var parsedFallback = parseClaudeAuthStatusJson(stdout);
        if (parsedFallback) return !!parsedFallback.loggedIn;
      }
      console.warn("[yoke] Claude auth status JSON check failed; falling back to text output:", e.message);
    }

    try {
      var textOut = execSync("claude auth status --text", { timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return isClaudeLoggedInText(textOut);
    } catch (e) {
      return false;
    }
  }

  function resolveCodexBinary() {
    var fs = require("fs");
    var findCodexPath = require("./codex-app-server").findCodexPath;

    try {
      var codexBin = findCodexPath();
      if (codexBin && fs.existsSync(codexBin)) return codexBin;
    } catch (e) {}

    return lookupBinary("codex");
  }

  function checkCodex() {
    try {
      var codexBin = resolveCodexBinary();
      if (!codexBin) return false;
      execFileSync(codexBin, ["login", "status"], { timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return true;
    } catch (e) {
      return false;
    }
  }

  _authCache = { claude: checkClaude(), codex: checkCodex() };
  logAuthCheck(_authCache);
  return _authCache;
}

/**
 * Check which vendor binaries are installed (regardless of auth status).
 *
 * Result is cached at module scope because the check runs two execFileSync
 * calls per invocation and is triggered once per project context on daemon
 * startup. With N projects this used to cost ~2N synchronous subprocesses;
 * caching collapses it to two total. The cache is invalidated alongside
 * the auth cache (via invalidateAuthCache) since "just installed" is the
 * same situation as "just logged in" from the daemon's perspective.
 */
var _installedCache = null;

function checkInstalled() {
  if (_installedCache) return _installedCache;

  var fs = require("fs");
  var execFileSync = require("child_process").execFileSync;
  var result = { claude: false, codex: false };
  try {
    if (process.platform === "win32") execFileSync("where", ["claude"], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
    else execFileSync("which", ["claude"], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
    result.claude = true;
  } catch (e) {}
  try {
    var codexBin = null;
    try {
      var findCodexPath = require("./codex-app-server").findCodexPath;
      codexBin = findCodexPath();
      if (codexBin && fs.existsSync(codexBin)) {
        result.codex = true;
        _installedCache = result;
        return result;
      }
    } catch (e) {}

    var whichOut = process.platform === "win32"
      ? execFileSync("where", ["codex"], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
      : execFileSync("which", ["codex"], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    if (whichOut.trim()) result.codex = true;
  } catch (e) {}
  _installedCache = result;
  return result;
}

function invalidateAuthCache() {
  _authCache = null;
  _installedCache = null;
}

/**
 * Create adapters for all authenticated vendors.
 * Claude may be shared across projects, but Codex is instantiated per project
 * so its app-server and bridge stay scoped to a single project slug.
 * Returns { adapters: { vendor: Adapter }, auth: { vendor: boolean } }
 */
var _sharedClaudeAdapter = null;

function createAdapters(opts) {
  opts = opts || {};
  // Gate adapter creation on binary installation, not OAuth auth status.
  // Claude Code supports multiple auth modes (OAuth, Bedrock, Vertex, API key)
  // that `claude auth status` does not always detect. Runtime auth failures are
  // handled downstream via query-level error detection.
  var installed = checkInstalled();
  var auth = { claude: false, codex: false };
  var adapters = {};

  if (installed.claude) {
    try {
      if (!_sharedClaudeAdapter) {
        _sharedClaudeAdapter = createAdapter({ vendor: "claude", cwd: opts.cwd });
      }
      adapters.claude = _sharedClaudeAdapter;
      auth.claude = true;
      console.log("[yoke] Adapter created: claude");
    } catch (e) {
      console.error("[yoke] Failed to create adapter for claude:", e.message);
    }
  }

  if (installed.codex) {
    try {
      adapters.codex = createAdapter({ vendor: "codex", cwd: opts.cwd, slug: opts.slug });
      auth.codex = true;
      console.log("[yoke] Adapter created: codex");
    } catch (e) {
      console.error("[yoke] Failed to create adapter for codex:", e.message);
    }
  }

  return { adapters: adapters, auth: auth };
}

/**
 * Lazy-create an adapter for a vendor that wasn't available at startup.
 * Re-checks auth, creates adapter if now logged in.
 * Returns the adapter or null.
 */
async function lazyCreateAdapter(adapters, vendor, opts) {
  opts = opts || {};

  // Force re-check since user may have logged in after server start
  invalidateAuthCache();
  var installed = checkInstalled();
  if (!installed[vendor]) return null;

  try {
    var ad = createAdapter({ vendor: vendor, cwd: opts.cwd, slug: opts.slug });
    if (typeof ad.init === "function") {
      await ad.init(opts || {});
    }
    console.log("[yoke] Lazy adapter created: " + vendor);
    adapters[vendor] = ad;
    return ad;
  } catch (e) {
    console.error("[yoke] Failed to lazy-create adapter for " + vendor + ":", e.message);
    return null;
  }
}

module.exports = {
  createAdapter: createAdapter,
  createAdapters: createAdapters,
  lazyCreateAdapter: lazyCreateAdapter,
  checkAuth: checkAuth,
  checkInstalled: checkInstalled,
  invalidateAuthCache: invalidateAuthCache,
  TOOL_POLICIES: iface.TOOL_POLICIES,
  validateAdapter: iface.validateAdapter,
  validateQueryHandle: iface.validateQueryHandle,
};
