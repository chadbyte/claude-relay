var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/admin.js"), "utf8");

test("user removal uses the custom destructive confirmation dialog", function () {
  assert.doesNotMatch(source, /\bconfirm\s*\(/);
  assert.match(source, /function showConfirmDialog\(message, actionLabel, onConfirm\)/);
  assert.match(source, /role="dialog" aria-modal="true" aria-label="Confirm action"/);
  assert.match(source, /showConfirmDialog\("Remove " \+ name \+ "\? This cannot be undone\.", "Remove user", function \(\) \{/);
  assert.match(source, /admin-modal-confirm-danger/);
  assert.match(source, /removeUser\(userId, body\)/);
});

test("invite revocation keeps its explicit custom-dialog action", function () {
  assert.match(source, /showConfirmDialog\("Revoke this invite\? The link will no longer work\.", "Revoke", function \(\) \{/);
});

test("SMTP removal uses the same custom destructive confirmation dialog", function () {
  assert.match(source, /showConfirmDialog\("Remove SMTP configuration\? Users will need to use PIN login\.", "Remove SMTP", function \(\) \{/);
});
