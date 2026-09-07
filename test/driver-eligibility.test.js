var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var eligibility = require("../lib/session-driver-eligibility");
var orchestration = require("../lib/session-driver-orchestration");

test("project chat sessions may drive regardless of vendor or model tier", function () {
  var sessions = [
    { vendor: "claude", model: "claude-haiku-4-5-20251001" },
    { vendor: "claude", model: "claude-sonnet-5" },
    { vendor: "codex", model: "gpt-5.6-luna" },
    { vendor: "kiro", model: "some-model" },
    { vendor: "claude", model: "" },
  ];
  for (var i = 0; i < sessions.length; i++) {
    assert.equal(eligibility.isEligibleDriverSession(sessions[i]), true);
    assert.equal(eligibility.evaluateDriverSession(sessions[i]).error, null);
  }
});

test("only sessions without a Driver-capable chat surface are rejected", function () {
  var tui = eligibility.evaluateDriverSession({ mode: "tui", vendor: "claude", model: "claude-fable-5" });
  assert.equal(tui.ok, false);
  assert.match(tui.error, /embedded terminal session cannot take the Driver role/);
  assert.equal(eligibility.evaluateDriverSession(null).ok, false);
});

test("Driver capability contains no model-tier policy", function () {
  var source = fs.readFileSync(path.join(root, "lib/session-driver-eligibility.js"), "utf8");
  assert.equal(/Fable tier|Sol tier|resolveTier|FAMILIES/.test(source), false);
  assert.equal(/=>/.test(source), false, "no arrow functions");
  assert.equal(/^\s*(const|let)\s/m.test(source), false, "var only");
  assert.ok(source.split("\n").length < 500);
});

test("proactive orchestration is limited to explicitly high-tier model families", function () {
  var highTier = [
    { vendor: "claude", model: "claude-fable-5-1" },
    { vendor: "claude", model: "claude-opus-4-6" },
    { vendor: "codex", model: "gpt-5.6-sol" },
    { vendor: "codex", model: "gpt-6-astra" },
    { vendor: "codex", model: "gpt-6" },
  ];
  var lowerTier = [
    { vendor: "claude", model: "claude-sonnet-5" },
    { vendor: "claude", model: "claude-haiku-4-5" },
    { vendor: "codex", model: "gpt-5.6-terra" },
    { vendor: "codex", model: "gpt-5.6-luna" },
    { vendor: "kiro", model: "some-model" },
  ];
  for (var i = 0; i < highTier.length; i++) {
    assert.equal(orchestration.isHighTierDriverSession(highTier[i]), true, highTier[i].model);
  }
  for (var j = 0; j < lowerTier.length; j++) {
    assert.equal(orchestration.isHighTierDriverSession(lowerTier[j]), false, lowerTier[j].model);
  }
});

test("orchestration tier resolves the configured vendor default when the session has no model", function () {
  var sm = { defaultModelByVendor: { codex: "gpt-6-astra", claude: "claude-sonnet-5" } };
  assert.equal(orchestration.isHighTierDriverSession({ vendor: "codex", model: "" }, sm), true);
  assert.equal(orchestration.isHighTierDriverSession({ vendor: "claude", model: "" }, sm), false);
});
