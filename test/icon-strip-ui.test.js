var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/icon-strip.css"), "utf8");

test("project strip icons use defined surfaces without obscuring brand artwork", function () {
  assert.match(css, /\.icon-strip-item::before\s*\{[^}]*background:\s*var\(--bg\)[^}]*box-shadow:/s);
  assert.doesNotMatch(css, /\.icon-strip-item::before\s*\{[^}]*border:/s);
  assert.match(css, /\.icon-strip-item\.active::before\s*\{[^}]*0 5px 14px color-mix\(in srgb, var\(--brand-indigo\) 28%, transparent\)/s);
  assert.doesNotMatch(css, /\.icon-strip-item\.active::before\s*\{[^}]*0 0 0 1px/s);
  assert.match(css, /\.icon-strip-home:hover::before\s*\{[^}]*background:\s*var\(--bg\)/s);
  assert.doesNotMatch(css, /\.icon-strip-home::before\s*\{[^}]*border:/s);
  assert.doesNotMatch(css, /\.icon-strip-home:hover::before\s*\{[^}]*background:\s*var\(--accent\)/s);
  assert.doesNotMatch(css, /\.icon-strip-home\.active::before\s*\{[^}]*background:\s*var\(--accent\)/s);
});

test("worktree icons follow the same quiet surface hierarchy", function () {
  assert.match(css, /\.icon-strip-wt-item::before\s*\{[^}]*background:\s*var\(--bg\)[^}]*box-shadow:/s);
  assert.match(css, /\.icon-strip-wt-item:hover::before\s*\{[^}]*background:\s*var\(--bg-alt\)/s);
  assert.doesNotMatch(css, /\.icon-strip-wt-item\.active::before\s*\{[^}]*var\(--accent\)/s);
  assert.match(css, /\.icon-strip-wt-item\.active::before\s*\{[^}]*0 0 0 1px color-mix\(in srgb, var\(--link\) 58%, var\(--border\)\)/s);
  assert.match(css, /\.icon-strip-wt-item\.active\s*\{[^}]*color:\s*var\(--text\)/s);
});
