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
  assert.strictEqual(vendorPriority.firstInstalledVendor(["qwen", "kimi", "grok"]), "grok");
  assert.strictEqual(vendorPriority.firstInstalledVendor(["qwen", "copilot"]), "copilot");
  assert.strictEqual(vendorPriority.firstInstalledVendor(["kiro", "junie"]), "junie");
  assert.strictEqual(vendorPriority.firstInstalledVendor(["kiro", "opencode"]), "opencode");
  assert.strictEqual(vendorPriority.firstInstalledVendor([]), "");
});

test("only vendors without direct use testing are marked experimental", async function () {
  var vendorPriority = await loadVendorPriority();
  var stable = ["claude", "codex", "kiro"];
  var experimental = ["grok", "kimi", "copilot", "qwen", "junie", "antigravity", "opencode"];
  for (var i = 0; i < stable.length; i++) {
    assert.strictEqual(vendorPriority.isExperimentalVendor(stable[i]), false);
  }
  for (var j = 0; j < experimental.length; j++) {
    assert.strictEqual(vendorPriority.isExperimentalVendor(experimental[j]), true);
  }
});

test("composer relies on vendor priority instead of a segmented vendor picker", function () {
  var html = fs.readFileSync(path.join(__dirname, "../lib/public/index.html"), "utf8");
  var panelSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-panels.js"), "utf8");

  assert.doesNotMatch(html, /id="vendor-toggle-wrap"|class="vendor-toggle-btn/);
  assert.doesNotMatch(panelSource, /vendor-btn-|updateVendorToggle|onVendorClick/);
  assert.match(html, /id="config-chip"/);
  assert.match(html, /id="active-vendor-indicator"/);
});
