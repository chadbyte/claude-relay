var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");

test("desktop terminal resize preserves the Clay panel header", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/terminal.js"), "utf8");

  assert.match(source, /if \(isTouchDevice && window\.visualViewport && !viewportHandler\)/);
  assert.match(source, /terminalContainerEl\.style\.height = window\.visualViewport\.height/);
});
