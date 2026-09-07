var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/session-actions.css"), "utf8");

test("composer session actions match the restrained icon toolbar", function () {
  assert.match(css, /\.composer-session-action\s*\{[^}]*width:\s*36px[^}]*height:\s*36px[^}]*border-radius:\s*50%/s);
  assert.match(css, /\.composer-session-action:focus-visible\s*\{[^}]*color-mix\(in srgb, var\(--link\) 18%, transparent\)/s);
  assert.match(css, /\.composer-session-action:disabled\s*\{[^}]*opacity:\s*0\.32/s);
});
