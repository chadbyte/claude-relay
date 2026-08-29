var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("global settings omit vendor-specific model defaults", function() {
  var html = read("lib/public/index.html");
  var settingsSource = read("lib/public/modules/server-settings.js");
  var messageSource = read("lib/public/modules/app-messages.js");

  assert.doesNotMatch(html, /data-section="models"/);
  assert.doesNotMatch(html, /id="ss-(?:model|mode|effort|thinking|beta)/);
  assert.match(html, /id="ps-model-list"/);
  assert.doesNotMatch(settingsSource, /set_server_default_model|renderModelList\("ss"/);
  assert.doesNotMatch(messageSource, /updateSettingsModels/);
});
