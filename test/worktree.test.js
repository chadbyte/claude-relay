var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var { execFileSync } = require("child_process");
var { scanWorktrees } = require("../lib/worktree");

function git(cwd, args) {
  return execFileSync("git", args, { cwd: cwd, encoding: "utf8" });
}

function createRepository(t) {
  var repo = fs.mkdtempSync(path.join(os.tmpdir(), "clay-worktree-"));
  t.after(function () { fs.rmSync(repo, { recursive: true, force: true }); });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "Clay Test"]);
  git(repo, ["config", "user.email", "clay@example.test"]);
  fs.writeFileSync(path.join(repo, "tracked.txt"), "initial\n");
  git(repo, ["add", "tracked.txt"]);
  git(repo, ["commit", "-qm", "initial"]);
  return repo;
}

test("worktree scan ignores Git entries whose directories were removed", function (t) {
  var repo = createRepository(t);
  var staleWorktree = path.join(os.tmpdir(), "clay-stale-worktree-" + Date.now());
  t.after(function () { fs.rmSync(staleWorktree, { recursive: true, force: true }); });

  git(repo, ["worktree", "add", "-q", "-b", "stale-branch", staleWorktree]);
  fs.rmSync(staleWorktree, { recursive: true, force: true });

  var discovered = scanWorktrees(repo);
  assert.equal(discovered.some(function (worktree) {
    return worktree.path === staleWorktree;
  }), false);
});
