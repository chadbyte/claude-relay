var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var eligibility = require("../lib/session-driver-eligibility");

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
