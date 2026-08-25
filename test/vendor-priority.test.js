var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

function loadVendorPriority() {
  var file = path.join(__dirname, "../lib/public/modules/vendor-priority.js");
  var source = fs.readFileSync(file, "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

test("installed vendor selection prefers Claude over Codex", async function () {
  var vendorPriority = await loadVendorPriority();
  assert.strictEqual(vendorPriority.firstInstalledVendor(["codex", "claude", "kiro"]), "claude");
});

test("installed vendor selection falls back to Codex", async function () {
  var vendorPriority = await loadVendorPriority();
  assert.strictEqual(vendorPriority.firstInstalledVendor(["kiro", "codex"]), "codex");
});

test("installed vendor selection follows remaining priority and handles none", async function () {
  var vendorPriority = await loadVendorPriority();
  assert.strictEqual(vendorPriority.firstInstalledVendor(["kiro", "opencode"]), "opencode");
  assert.strictEqual(vendorPriority.firstInstalledVendor([]), "");
});
