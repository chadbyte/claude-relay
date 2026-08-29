var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/input.css"), "utf8");

test("focused composer gains restrained depth", function() {
  assert.match(css, /#input-row:focus-within\s*\{[^}]*color-mix\(in srgb, var\(--accent\) 22%[^}]*0 8px 22px[^}]*translateY\(-1px\)/s);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*#input-row:focus-within\s*\{\s*transform: none/);
});
