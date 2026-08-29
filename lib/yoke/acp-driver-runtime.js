// ACP Vendor Driver Runtime
// -------------------------
// ACP supplies defaults. Trusted vendor drivers may extend or replace them so
// the shared protocol never becomes the ceiling of the richer YOKE contract.

function hasHook(driver, name) {
  return !!(driver && typeof driver[name] === "function");
}

function call(driver, name, context, fallback) {
  if (hasHook(driver, name)) return driver[name](context, fallback);
  return fallback ? fallback() : undefined;
}

function callAsync(driver, name, context, fallback) {
  try {
    return Promise.resolve(call(driver, name, context, fallback));
  } catch (e) {
    return Promise.reject(e);
  }
}

function mergeCapabilities(driver, context, base) {
  var defaults = Object.assign({}, base);
  if (!hasHook(driver, "extendCapabilities")) return defaults;
  var extended = driver.extendCapabilities(context, Object.assign({}, defaults));
  return Object.assign({}, defaults, extended || {});
}

function buildParams(driver, hookName, context, base) {
  var defaults = Object.assign({}, base);
  if (!hasHook(driver, hookName)) return defaults;
  var result = driver[hookName](context, Object.assign({}, defaults));
  return result === undefined || result === null ? defaults : result;
}

function normalizeEvents(driver, context, fallback) {
  var result = call(driver, "normalizeUpdate", context, fallback);
  if (result === undefined || result === null) return [];
  return Array.isArray(result) ? result : [result];
}

module.exports = {
  hasHook: hasHook,
  call: call,
  callAsync: callAsync,
  mergeCapabilities: mergeCapabilities,
  buildParams: buildParams,
  normalizeEvents: normalizeEvents,
};
