var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/session-actions.css"), "utf8");

test("session actions menu uses restrained focus and readable supporting copy", function () {
  assert.match(css, /#header-session-actions-btn:focus-visible\s*\{[^}]*color-mix\(in srgb, var\(--link\) 18%, transparent\)/s);
  assert.match(css, /\.session-actions-row-icon\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--accent2\) 38%, var\(--text-secondary\)\)/s);
  assert.match(css, /\.session-actions-row-copy > span\s*\{[^}]*color:\s*var\(--text-muted\)[^}]*font-size:\s*11px/s);
});
