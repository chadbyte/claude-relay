var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var execFileSync = require("child_process").execFileSync;

var context = require("../lib/project-log-context");

function git(cwd, args) {
  return execFileSync("git", args, { cwd: cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

test("existing projects freeze their legacy log scope while new projects use stable ids", function () {
  var existing = { path: "/srv/existing" };
  assert.equal(context.ensureProjectKnowledgeId(existing), true);
  assert.equal(existing.projectKnowledgeId, context.legacyKnowledgeId(existing.path));
  assert.equal(context.ensureProjectKnowledgeId(existing), false);
  assert.match(context.createProjectKnowledgeId(), /^pk_[A-Za-z0-9_-]+$/);
});

test("a linked worktree keeps one change-set id across restarts and branch renames", function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-log-context-"));
  var parent = path.join(root, "parent");
  var worktree = path.join(root, "worktree");
  fs.mkdirSync(parent);
  git(parent, ["init"]);
  git(parent, ["config", "user.email", "test@example.com"]);
  git(parent, ["config", "user.name", "Clay Test"]);
  fs.writeFileSync(path.join(parent, "seed.txt"), "seed\n");
  git(parent, ["add", "seed.txt"]);
  git(parent, ["commit", "-m", "test: seed"]);
  git(parent, ["worktree", "add", "-b", "change-a", worktree]);

  var first = context.resolveWorktreeContext(worktree, "pk_test", { branch: "change-a" });
  git(worktree, ["branch", "-m", "change-b"]);
  var second = context.resolveWorktreeContext(worktree, "pk_test", { branch: "change-b" });

  assert.match(first.changeSetId, /^cs_[A-Za-z0-9_-]+$/);
  assert.equal(second.changeSetId, first.changeSetId);
  assert.equal(second.branch, "change-b");
  assert.equal(second.baseCommit, first.baseCommit);
  assert.equal(second.headCommit, first.headCommit);
});
