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
  assert.match(source, /status === "completed"\) return "Completed"/);
  assert.match(source, /statusLabel\(status\) \+ \(autoApproved \? " · auto-approved" : ""\)/);
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

test("title bar moves Worker creation into the labeled session actions menu", function () {
  var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var actions = fs.readFileSync(path.join(root, "lib/public/modules/session-actions.js"), "utf8");
  assert.match(html, /id="header-session-actions-btn"[^>]*aria-label="Session actions"/);
  assert.doesNotMatch(html, /id="header-add-worker-btn"/);
  assert.match(actions, /actionRow\("bot", "Add AI worker"/);
  assert.match(actions, /openPairDialog/);
});

test("title bar presents a labeled session actions button in the status area", function () {
  var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var panels = fs.readFileSync(path.join(root, "lib/public/modules/app-panels.js"), "utf8");
  var renameAt = html.indexOf('id="header-rename-btn"');
  var fullAccessAt = html.indexOf('id="header-full-access-btn"');
  var statusAt = html.indexOf('<div class="status">');
  var actionsAt = html.indexOf('id="header-session-actions-btn"');

  assert.ok(renameAt > 0 && renameAt < fullAccessAt);
  assert.ok(actionsAt > statusAt);
  assert.match(html, /id="header-session-actions-btn"[^>]*>[\s\S]*Add AI worker[\s\S]*session-actions-trigger-chevron/);
  assert.match(panels, /statusArea\.insertBefore\(hCtxEl, statusArea\.firstChild\)/);
});
