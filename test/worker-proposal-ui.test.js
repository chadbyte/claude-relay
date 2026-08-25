var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");

test("Worker proposal card exposes runtime controls and sends one decision message", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/worker-proposal.js"), "utf8");
  assert.match(source, /worker-proposal-vendor/);
  assert.match(source, /worker-proposal-model/);
  assert.match(source, /worker-proposal-effort-btn/);
  assert.match(source, /type: "worker_proposal_response"/);
  assert.match(source, /Run with Worker/);
});

test("message routing renders and updates Worker proposal lifecycle events", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/app-messages.js"), "utf8");
  assert.match(source, /case "worker_proposal":\s*renderWorkerProposal\(msg\)/);
  assert.match(source, /case "worker_proposal_update":\s*updateWorkerProposal\(msg\)/);
  assert.match(source, /msg\.name\.indexOf\("propose_worker"\)/);
});

test("posting the approval card does not trigger a redundant tool permission prompt", function () {
  var source = fs.readFileSync(path.join(root, "lib/sdk-bridge.js"), "utf8");
  assert.match(source, /propose_worker: true/);
});

test("Worker proposal card keeps responsive controls inside split panes", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/css/worker-proposal.css"), "utf8");
  assert.match(source, /width: min\(var\(--content-width\), calc\(100% - 40px\)\)/);
  assert.match(source, /@media \(max-width: 720px\)/);
  assert.match(source, /grid-template-columns: 1fr 1fr/);
});

test("title bar identifies the add Worker action with a robot and text", function () {
  var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var css = fs.readFileSync(path.join(root, "lib/public/css/menus.css"), "utf8");
  assert.match(html, /id="header-add-worker-btn"[^>]*aria-label="Add AI Worker"/);
  assert.match(html, /data-lucide="bot"/);
  assert.match(html, /header-worker-add-badge[^>]*><i data-lucide="plus"/);
  assert.match(html, /header-worker-label/);
  assert.match(css, /\.header-worker-label/);
});

test("title bar groups session controls and places Worker before context usage", function () {
  var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var panels = fs.readFileSync(path.join(root, "lib/public/modules/app-panels.js"), "utf8");
  var renameAt = html.indexOf('id="header-rename-btn"');
  var fullAccessAt = html.indexOf('id="header-full-access-btn"');
  var statusAt = html.indexOf('<div class="status">');
  var workerAt = html.indexOf('id="header-add-worker-btn"');

  assert.ok(renameAt > 0 && renameAt < fullAccessAt);
  assert.ok(workerAt > statusAt);
  assert.match(panels, /workerBtn\.nextSibling/);
  assert.match(panels, /statusArea\.insertBefore\(hCtxEl, contextAnchor\)/);
});
