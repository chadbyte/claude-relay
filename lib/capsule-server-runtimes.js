// Trusted server-runtime Logic for shipped Capsules.
//
// A server Capsule's Logic runs in this process rather than in a browser
// worker, so it stays available with no home screen open and owns randomness
// and hidden state the client must never hold. Only Capsules shipped in
// lib/capsules/ can claim the server runtime (see tools-registry
// isTrustedServerRuntime), and only IDs listed here resolve to real Logic.
//
// A runtime is created per call. State lives in the Capsule's datastore, never
// in this module, so nothing here is shared between users.

var path = require("path");
var toolStorage = require("./tool-storage");
var toolsRegistry = require("./tools-registry");
var pigLogic = require("./capsule-pig-logic");

var RUNTIME_FACTORIES = {
  pig: pigLogic.createRuntime,
};

function hasRuntime(toolId) {
  return Object.prototype.hasOwnProperty.call(RUNTIME_FACTORIES, toolId);
}

function createRuntime(toolId, ctx, options) {
  if (!hasRuntime(toolId)) return null;
  var settings = Object.assign({}, options || {});
  if (!settings.storage) settings.storage = toolStorage.createToolStorage(ctx, toolId);
  // One stored game, one serialization key, no matter how many runtime
  // instances are created for it.
  if (!settings.lockKey) settings.lockKey = path.join(toolsRegistry.resolveToolsRoot(ctx), toolId);
  return RUNTIME_FACTORIES[toolId](settings);
}

module.exports = {
  hasRuntime: hasRuntime,
  createRuntime: createRuntime,
  ids: Object.keys(RUNTIME_FACTORIES),
};
