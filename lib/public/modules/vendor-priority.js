export var VENDOR_ORDER = ["claude", "codex", "grok", "kimi", "copilot", "qwen", "junie", "antigravity", "opencode", "kiro"];
export var EXPERIMENTAL_VENDORS = ["grok", "kimi", "copilot", "qwen", "junie", "antigravity", "opencode"];

export function isExperimentalVendor(vendor) {
  return EXPERIMENTAL_VENDORS.indexOf(vendor) !== -1;
}

export function firstInstalledVendor(installedVendors) {
  var installed = Array.isArray(installedVendors) ? installedVendors : [];
  for (var i = 0; i < VENDOR_ORDER.length; i++) {
    if (installed.indexOf(VENDOR_ORDER[i]) !== -1) return VENDOR_ORDER[i];
  }
  return "";
}
