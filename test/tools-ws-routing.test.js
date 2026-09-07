var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");

// The tools handler lives at the server level, but browser messages arrive on
// a project socket, so project.js forwards tool message types to onDmMessage
// by an explicit list. A type missing from that list is silently dropped: the
// client sees no error and no response, which is exactly how the Capsule
// snapshot path shipped broken. This test pins the two lists together.
test("every server-tools c2s message type is forwarded by project.js and accepted by the handler", function () {
  var schemaSource = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");
  var schemaTypes = [];
  var schemaPattern = /"([a-z0-9_]+)":\s*\{\s*direction:\s*"c2s",\s*handler:\s*"lib\/server-tools\.js"/g;
  var match;
  while ((match = schemaPattern.exec(schemaSource)) !== null) schemaTypes.push(match[1]);
  assert.ok(schemaTypes.indexOf("tool_server_control") !== -1, "the schema knows tool_server_control");
  assert.ok(schemaTypes.indexOf("tool_frame_url") !== -1, "the schema knows tool_frame_url");

  var projectSource = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  var serverToolsSource = fs.readFileSync(path.join(root, "lib/server-tools.js"), "utf8");
  for (var i = 0; i < schemaTypes.length; i++) {
    assert.ok(
      projectSource.indexOf('msg.type === "' + schemaTypes[i] + '"') !== -1,
      "project.js must forward '" + schemaTypes[i] + "' to the server-level tools handler"
    );
    assert.ok(
      serverToolsSource.indexOf('"' + schemaTypes[i] + '"') !== -1,
      "server-tools.js must accept '" + schemaTypes[i] + "'"
    );
  }
});
