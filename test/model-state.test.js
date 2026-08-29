var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");
var { buildInitialModelInfo } = require("../lib/project-connection");

function source(name) {
  return fs.readFileSync(path.join(__dirname, "../lib", name), "utf8");
}

test("model state no longer uses a project-global currentModel", function() {
  var files = [
    "project.js",
    "project-models.js",
    "project-sessions.js",
    "project-worker-proposal.js",
    "sdk-bridge.js",
    "sdk-message-processor.js",
  ];
  for (var i = 0; i < files.length; i++) {
    assert.doesNotMatch(source(files[i]), /sm\.currentModel/);
  }
});

test("model-less Claude restore validates only against Claude models", function() {
  var info = buildInitialModelInfo({
    availableVendors: ["claude", "codex"],
    installedVendors: ["claude", "codex"],
  }, "claude", "gpt-5.6-terra", ["sonnet"], "claude-session");
  assert.strictEqual(info.model, "sonnet");
  assert.strictEqual(info.vendor, "claude");
  assert.strictEqual(info.sessionId, "claude-session");
});

test("project-wide config broadcasts are self-describing and never carry a model", function() {
  var sessions = source("project-sessions.js");
  assert.doesNotMatch(sessions, /send\(\{ type: "config_state", model:/);
  assert.match(sessions, /send\(\{ type: "config_state", vendor: null, sessionId: null/);
});
