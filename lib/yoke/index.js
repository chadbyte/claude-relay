// YOKE - Yoke Overrides Known Engines
// Public entry point.

var iface = require("./interface");
var createClaudeAdapter = require("./adapters/claude").createClaudeAdapter;
var createGeminiAdapter = require("./adapters/gemini").createGeminiAdapter;
var createCodexAdapter = require("./adapters/codex").createCodexAdapter;

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
  return adapter;
}

module.exports = {
  createAdapter: createAdapter,
  TOOL_POLICIES: iface.TOOL_POLICIES,
  validateAdapter: iface.validateAdapter,
  validateQueryHandle: iface.validateQueryHandle,
};
