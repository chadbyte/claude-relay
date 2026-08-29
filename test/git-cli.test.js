var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var { execFileSync } = require("child_process");
var gitCli = require("../lib/git-cli");

function git(cwd, args) {
  return execFileSync("git", args, { cwd: cwd, encoding: "utf8" });
}

function createRepository(t) {
  var repo = fs.mkdtempSync(path.join(os.tmpdir(), "clay-git-cli-"));
  t.after(function () { fs.rmSync(repo, { recursive: true, force: true }); });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "Clay Test"]);
  git(repo, ["config", "user.email", "clay@example.test"]);
  fs.writeFileSync(path.join(repo, "tracked.txt"), "before\n");
  git(repo, ["add", "tracked.txt"]);
  git(repo, ["commit", "-qm", "initial"]);
  return repo;
}

test("porcelain parser preserves branch sync and changed path details", function () {
  var raw = "# branch.oid abc123\0" +
    "# branch.head feature/git panel\0" +
    "# branch.upstream origin/feature/git-panel\0" +
    "# branch.ab +2 -3\0" +
    "1 .M N... 100644 100644 100644 abc123 abc123 folder/file name.js\0" +
    "2 R. N... 100644 100644 100644 abc123 def456 R100 renamed file.js\0old file.js\0" +
    "? new file.txt\0";
  var parsed = gitCli.parsePorcelainV2(raw);

  assert.equal(parsed.branch, "feature/git panel");
  assert.equal(parsed.upstream, "origin/feature/git-panel");
  assert.equal(parsed.ahead, 2);
  assert.equal(parsed.behind, 3);
  assert.equal(parsed.files.length, 3);
  assert.equal(parsed.files[0].path, "folder/file name.js");
  assert.equal(parsed.files[0].unstaged, true);
  assert.equal(parsed.files[1].originalPath, "old file.js");
  assert.equal(parsed.files[1].staged, true);
  assert.equal(parsed.files[2].untracked, true);
});

test("Git status, diffs, and safe stage actions operate on the working tree", async function (t) {
  var repo = createRepository(t);
  fs.writeFileSync(path.join(repo, "tracked.txt"), "after\n");
  fs.writeFileSync(path.join(repo, "new file.txt"), "new\n");

  var status = gitCli.getStatus(repo);
  assert.equal(status.isRepository, true);
  assert.equal(status.dirty, true);
  assert.deepEqual(status.files.map(function (file) { return file.path; }).sort(), ["new file.txt", "tracked.txt"]);

  var diff = gitCli.getFileDiff(repo, "tracked.txt");
  assert.equal(diff.binary, false);
  assert.equal(diff.oldContent, "before\n");
  assert.equal(diff.newContent, "after\n");

  await gitCli.runAction(repo, { action: "stage", paths: ["tracked.txt"] });
  status = gitCli.getStatus(repo);
  var tracked = status.files.find(function (file) { return file.path === "tracked.txt"; });
  assert.equal(tracked.staged, true);
  assert.equal(tracked.unstaged, false);

  await gitCli.runAction(repo, { action: "unstage", paths: ["tracked.txt"] });
  status = gitCli.getStatus(repo);
  tracked = status.files.find(function (file) { return file.path === "tracked.txt"; });
  assert.equal(tracked.staged, false);
  assert.equal(tracked.unstaged, true);

  var target = path.join(repo, "outside-target.txt");
  fs.writeFileSync(target, "secret target contents\n");
  fs.symlinkSync(target, path.join(repo, "link.txt"));

  var symlinkDiff = gitCli.getFileDiff(repo, "link.txt");
  assert.equal(symlinkDiff.newContent, target);
  assert.doesNotMatch(symlinkDiff.newContent, /secret target contents/);

  assert.throws(
    function () { gitCli.runAction(repo, { action: "stage", paths: ["../outside.txt"] }); },
    /no longer changed/
  );
});
