var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

function source(file) {
  return fs.readFileSync(path.join(__dirname, "../", file), "utf8");
}

test("connection overlay starts with connecting wording", function() {
  var html = source("lib/public/index.html");
  var baseCss = source("lib/public/css/base.css");
  var css = source("lib/public/css/overlays.css");
  var wordmark = source("lib/public/clay-studio-wordmark.svg");
  assert.match(html, /class="connect-symbol" src="clay-studio-symbol\.png"/);
  assert.match(html, /class="connect-wordmark" role="img" aria-label="Clay Studio"/);
  assert.match(html, /id="connect-overlay-msg">Connecting…</);
  assert.doesNotMatch(html, /id="connect-overlay-msg">Reconnecting/);
  assert.match(css, /#connect-overlay[\s\S]*background: var\(--bg\)/);
  assert.match(css, /width: clamp\(58px, 6vw, 82px\)/);
  assert.match(css, /width: clamp\(155px, 18vw, 238px\)/);
  assert.match(css, /mask: url\("\.\.\/clay-studio-wordmark\.svg\?v=400"\)/);
  assert.match(css, /connect-brand-breathe/);
  assert.match(css, /var\(--brand-green\) 50%/);
  assert.match(css, /var\(--brand-indigo\) 58%/);
  assert.doesNotMatch(css, /var\(--accent\) 50%/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(baseCss, /--brand-indigo: #5857fc/);
  assert.match(baseCss, /--brand-green: #07e5a3/);
  assert.match(wordmark, /Source Serif 4 v4\.005, weight 400/);
});

test("reconnect wording is only set after a prior connection", function() {
  var connection = source("lib/public/modules/app-connection.js");
  assert.match(connection, /var hasConnectedOnce = false/);
  assert.match(connection, /if \(hasConnectedOnce && connectOverlay\)[\s\S]*Reconnecting to server…/);
});

test("pane overlays use a quiet themed loading state", function() {
  var css = source("lib/public/css/pane.css");
  assert.match(css, /body\.pane-mode #connect-overlay \{ background: var\(--bg\); \}/);
  assert.doesNotMatch(css, /body\.pane-mode #connect-overlay \.connect-wordmark \{ display: none; \}/);
  assert.match(css, /body\.pane-mode #connect-overlay-msg \{ color: var\(--text-dimmer\); \}/);
});
