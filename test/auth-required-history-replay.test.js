var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

test("authentication recovery does not replay or retain pre-login auth state", function () {
  var processor = fs.readFileSync(path.join(__dirname, "../lib/sdk-message-processor.js"), "utf8");
  var messages = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");
  var login = fs.readFileSync(path.join(__dirname, "../lib/project-vendor-login.js"), "utf8");

  assert.match(processor, /Authentication recovery is transient UI state[\s\S]*sendToSession\(session, \{[\s\S]*type: "auth_required"/);
  assert.doesNotMatch(processor, /sendAndRecord\(session, \{[\s\S]{0,300}type: "auth_required"/);
  assert.doesNotMatch(processor, /Authentication is available, but[\s\S]*auth-like error/);
  assert.match(messages, /if \(!store\.get\('replayingHistory'\)\) autoStartLoginIfNeeded\(msg\);/);
  assert.match(login, /if \(succeeded\) yoke\.invalidateAuthCache\(\);/);
});
