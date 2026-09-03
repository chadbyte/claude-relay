var test = require("node:test");
var assert = require("node:assert/strict");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

function whitelist() {
  return createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {},
    adapter: {},
    send: function () {},
  }).checkToolWhitelist;
}

test("Project Logs tools do not show redundant permission prompts", function () {
  var check = whitelist();
  var tools = [
    "list_logs", "search_logs", "read_log", "log_history", "create_log",
    "update_log", "list_log_feedback", "review_log_comment",
    "read_log_revision", "revert_log", "link_log",
  ];
  for (var i = 0; i < tools.length; i++) {
    var input = { marker: tools[i] };
    assert.deepEqual(check("mcp__clay-logs__" + tools[i], input), {
      behavior: "allow",
      updatedInput: input,
    });
  }
});

test("the Logs allowance is confined to the exact server namespace", function () {
  var check = whitelist();
  assert.equal(check("mcp__other__create_log", {}), null);
  assert.equal(check("mcp__clay-logs-extra__create_log", {}), null);
  assert.equal(check("mcp__other-clay-logs__create_log", {}), null);
  assert.equal(check("create_log", {}), null);
});
