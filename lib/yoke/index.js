// YOKE - Yoke Overrides Known Engines
// Public entry point.

var iface = require("./interface");
var instructions = require("./instructions");
var createClaudeAdapter = require("./adapters/claude").createClaudeAdapter;
var createGeminiAdapter = require("./adapters/gemini").createGeminiAdapter;
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
  } else if (vendor === "gemini") {
    adapter = createGeminiAdapter(opts);
  } else if (vendor === "codex") {
    adapter = createCodexAdapter(opts);
  } else {
    throw new Error("[YOKE] Unknown adapter vendor: " + vendor);
  }
  iface.validateAdapter(adapter);
  wrapCreateQuery(adapter, opts.cwd);
  return adapter;
}

/**
 * Check which vendors have valid auth credentials.
 * Result is cached after first call (auth state doesn't change during runtime).
 * Call invalidateAuthCache() to force re-check (e.g. after login).
 */
var _authCache = null;

function checkAuth() {
  if (_authCache) return _authCache;

  var execSync = require("child_process").execSync;

  function checkClaude() {
    try {
      var out = execSync("claude auth status", { timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      var parsed = JSON.parse(out);
      return !!(parsed && parsed.loggedIn);
    } catch (e) {
      return false;
    }
  }

  function checkCodex() {
    try {
      var findCodexPath = require("./codex-app-server").findCodexPath;
      var codexBin = findCodexPath();
      execSync(codexBin + " login status", { timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return true;
    } catch (e) {
      return false;
    }
  }

  _authCache = { claude: checkClaude(), codex: checkCodex(), gemini: false };
  console.log("[yoke] Auth check: claude=" + _authCache.claude + " codex=" + _authCache.codex);
  return _authCache;
}

/**
 * Check which vendor binaries are installed (regardless of auth status).
 */
function checkInstalled() {
  var fs = require("fs");
  var path = require("path");
  var execSync = require("child_process").execSync;
  var result = { claude: false, codex: false };
  try {
    execSync("which claude", { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
    result.claude = true;
  } catch (e) {}
  try {
    var findCodexPath = require("./codex-app-server").findCodexPath;
    var codexBin = findCodexPath();
    if (fs.existsSync(codexBin)) result.codex = true;
  } catch (e) {}
  return result;
}

function invalidateAuthCache() {
  _authCache = null;
}

/**
 * Create adapters for all authenticated vendors.
 * Adapters are singletons shared across all projects (they are stateless factories).
 * The cwd is passed per-query, not per-adapter.
 * Returns { adapters: { vendor: Adapter }, auth: { vendor: boolean } }
 */
var _sharedAdapters = null;
var _sharedAuth = null;

function createAdapters(opts) {
  if (_sharedAdapters) {
    return { adapters: _sharedAdapters, auth: _sharedAuth };
  }

  var auth = checkAuth();
  var adapters = {};
  var vendors = Object.keys(auth);

  for (var i = 0; i < vendors.length; i++) {
    var vendor = vendors[i];
    if (!auth[vendor]) continue;
    try {
      adapters[vendor] = createAdapter({ vendor: vendor, cwd: opts.cwd });
      console.log("[yoke] Adapter created: " + vendor);
    } catch (e) {
      console.error("[yoke] Failed to create adapter for " + vendor + ":", e.message);
      auth[vendor] = false;
    }
  }

  _sharedAdapters = adapters;
  _sharedAuth = auth;
  return { adapters: adapters, auth: auth };
}

/**
 * Lazy-create an adapter for a vendor that wasn't available at startup.
 * Re-checks auth, creates adapter if now logged in.
 * Returns the adapter or null.
 */
function lazyCreateAdapter(adapters, vendor, opts) {
  if (_sharedAdapters && _sharedAdapters[vendor]) {
    adapters[vendor] = _sharedAdapters[vendor];
    return adapters[vendor];
  }

  // Force re-check since user may have logged in after server start
  invalidateAuthCache();
  _sharedAdapters = null;
  _sharedAuth = null;
  var auth = checkAuth();
  if (!auth[vendor]) return null;

  try {
    var ad = createAdapter({ vendor: vendor, cwd: opts.cwd });
    console.log("[yoke] Lazy adapter created: " + vendor);
    if (_sharedAdapters) _sharedAdapters[vendor] = ad;
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
