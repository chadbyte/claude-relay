var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var test = require("node:test");
var { execFileSync } = require("node:child_process");
var { attachGitSessionAttribution } = require("../lib/git-session-attribution");
var gitCli = require("../lib/git-cli");

function git(cwd, args) {
  return execFileSync("git", args, { cwd: cwd, encoding: "utf8" });
}

function makeRepository() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-git-session-"));
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Clay Test"]);
  fs.writeFileSync(path.join(root, "app.js"), "var value = 1;\n");
  git(root, ["add", "app.js"]);
  git(root, ["commit", "-m", "test: initialize repository"]);
  return root;
}

test("session attribution links new working-tree changes and compares their baseline", function () {
  var root = makeRepository();
  var tracker = attachGitSessionAttribution({ cwd: root, storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "clay-git-tracking-")) });
  var session = { localId: 7, cliSessionId: "session-one", title: "Update value", vendor: "codex" };

  tracker.beginTurn(session);
  fs.writeFileSync(path.join(root, "app.js"), "var value = 2;\n");
  tracker.finishTurn(session);

  var sessions = new Map([[7, session]]);
  var status = tracker.decorateStatus(gitCli.getStatus(root), sessions);
  assert.equal(status.files[0].sessions[0].sessionId, 7);
  assert.equal(status.files[0].sessions[0].title, "Update value");
  assert.equal(status.files[0].sessions[0].preExisting, false);

  var comparison = tracker.getSessionBaselineDiff("session-one", "app.js");
  assert.equal(comparison.oldContent, "var value = 1;\n");
  assert.equal(comparison.newContent, "var value = 2;\n");
});

test("session attribution preserves pre-existing uncommitted content as the baseline", function () {
  var root = makeRepository();
  var tracker = attachGitSessionAttribution({ cwd: root, storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "clay-git-tracking-")) });
  var session = { localId: 8, cliSessionId: "session-two", title: "Continue edit", vendor: "claude" };
  fs.writeFileSync(path.join(root, "app.js"), "var value = 2;\n");

  tracker.beginTurn(session);
  fs.writeFileSync(path.join(root, "app.js"), "var value = 3;\n");
  tracker.finishTurn(session);

  var status = tracker.decorateStatus(gitCli.getStatus(root), new Map([[8, session]]));
  assert.equal(status.files[0].sessions[0].preExisting, true);
  var comparison = tracker.getSessionBaselineDiff("session-two", "app.js");
  assert.equal(comparison.oldContent, "var value = 2;\n");
  assert.equal(comparison.newContent, "var value = 3;\n");
});
