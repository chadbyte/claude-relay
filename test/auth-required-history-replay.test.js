var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

test("authentication recovery stays out of transcript history and ignores replay", function () {
  var processor = fs.readFileSync(path.join(__dirname, "../lib/sdk-message-processor.js"), "utf8");
  var messages = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");

  assert.match(processor, /Authentication recovery is transient UI state[\s\S]*sendToSession\(session, \{[\s\S]*type: "auth_required"/);
  assert.doesNotMatch(processor, /sendAndRecord\(session, \{[\s\S]{0,300}type: "auth_required"/);
  assert.match(messages, /if \(!store\.get\('replayingHistory'\)\) autoStartLoginIfNeeded\(msg\);/);
});
