export var VENDOR_ORDER = ["claude", "codex", "antigravity", "opencode", "kiro"];

export function firstInstalledVendor(installedVendors) {
  var installed = Array.isArray(installedVendors) ? installedVendors : [];
  for (var i = 0; i < VENDOR_ORDER.length; i++) {
    if (installed.indexOf(VENDOR_ORDER[i]) !== -1) return VENDOR_ORDER[i];
  }
  return "";
}
