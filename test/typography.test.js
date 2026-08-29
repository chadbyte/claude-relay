var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("core typography uses a restrained four-step weight scale", function() {
  var base = read("lib/public/css/base.css");
  var sidebar = read("lib/public/css/sidebar.css");
  var settings = read("lib/public/css/user-settings.css");
  var titleBar = read("lib/public/css/title-bar.css");

  assert.match(base, /--font-weight-body: 400/);
  assert.match(base, /--font-weight-ui: 500/);
  assert.match(base, /--font-weight-heading: 600/);
  assert.match(base, /--font-weight-emphasis: 700/);
  assert.match(sidebar, /\.session-item \{[\s\S]*font-weight: var\(--font-weight-body\)/);
  assert.match(settings, /#user-settings \.settings-label \{[\s\S]*font-weight: var\(--font-weight-ui\)/);
  assert.match(titleBar, /\.title-bar-project-name \{[\s\S]*font-weight: var\(--font-weight-heading\)/);
});
