// The cheap repository summary that backs the sidebar placard. It must be
// narrower than the panel's full status: no per-file payload, no filesystem
// path, no credentials, and identity derived here rather than by the client.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var { execFileSync } = require("child_process");
var gitCli = require("../lib/git-cli");

var projectHttpSource = fs.readFileSync(path.join(__dirname, "../lib/project-http.js"), "utf8");
var gitCliSource = fs.readFileSync(path.join(__dirname, "../lib/git-cli.js"), "utf8");

function git(cwd, args) {
  return execFileSync("git", args, { cwd: cwd, encoding: "utf8" });
}

function createRepository(t) {
  var repo = fs.mkdtempSync(path.join(os.tmpdir(), "clay-git-summary-"));
  t.after(function () { fs.rmSync(repo, { recursive: true, force: true }); });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", "Clay Test"]);
  git(repo, ["config", "user.email", "clay@example.test"]);
  fs.writeFileSync(path.join(repo, "tracked.txt"), "before\n");
  git(repo, ["add", "tracked.txt"]);
  git(repo, ["commit", "-qm", "initial"]);
  return repo;
}

test("a non-repository directory reports exactly that and nothing else", async function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-git-plain-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var summary = gitCli.getSummary(dir);
  assert.deepEqual(summary, { isRepository: false },
    "the client has nothing to render, so nothing is described");
});

test("the summary reports identity, branch and bounded counts", async function (t) {
  var repo = createRepository(t);
  fs.writeFileSync(path.join(repo, "tracked.txt"), "after\n");
  fs.writeFileSync(path.join(repo, "staged.txt"), "staged\n");
  fs.writeFileSync(path.join(repo, "untracked.txt"), "new\n");
  git(repo, ["add", "staged.txt"]);

  var summary = gitCli.getSummary(repo);
  assert.equal(summary.isRepository, true);
  assert.equal(summary.name, path.basename(repo), "identity is derived server-side");
  assert.equal(summary.branch, "main");
  assert.equal(summary.detached, false);
  assert.equal(summary.changed, 3);
  assert.equal(summary.staged, 1);
  assert.equal(summary.unstaged, 1, "the untracked file is not counted as unstaged");
  assert.equal(summary.untracked, 1);
  assert.equal(summary.conflicted, 0);
  assert.equal(summary.hasUpstream, false, "no upstream means no sync claim");
  assert.equal(summary.ahead, 0);
  assert.equal(summary.behind, 0);
  assert.equal(summary.isWorktree, false);
  assert.equal(summary.remote, null);
  assert.equal(summary.shortOid.length, 8);
});

test("the summary never returns a path or a file list", async function (t) {
  var repo = createRepository(t);
  fs.writeFileSync(path.join(repo, "secret-name.txt"), "x\n");
  var summary = gitCli.getSummary(repo);

  var keys = Object.keys(summary);
  assert.equal(keys.indexOf("root"), -1);
  assert.equal(keys.indexOf("gitDir"), -1);
  assert.equal(keys.indexOf("commonDir"), -1);
  assert.equal(keys.indexOf("mainWorktree"), -1);
  assert.equal(keys.indexOf("worktrees"), -1);
  assert.equal(keys.indexOf("files"), -1);
  assert.equal(keys.indexOf("upstream"), -1, "only the boolean hasUpstream is exposed");
  assert.equal(keys.indexOf("origin"), -1, "only the shortened label is exposed");

  var serialized = JSON.stringify(summary);
  assert.equal(serialized.indexOf(repo), -1, "the repository path does not leak");
  assert.equal(serialized.indexOf("secret-name.txt"), -1, "changed paths do not leak");
  assert.equal(summary.changed, 1, "the count is still reported");
});

test("a detached head is reported without inventing a branch name", async function (t) {
  var repo = createRepository(t);
  var head = git(repo, ["rev-parse", "HEAD"]).trim();
  git(repo, ["checkout", "-q", "--detach", head]);
  var summary = gitCli.getSummary(repo);
  assert.equal(summary.detached, true);
  assert.equal(summary.branch, null);
  assert.equal(summary.shortOid, head.slice(0, 8));
});

test("a linked worktree is identified without exposing the main checkout path", async function (t) {
  var repo = createRepository(t);
  var worktree = path.join(repo, "..", path.basename(repo) + "-wt");
  git(repo, ["worktree", "add", "-q", "-b", "feat/placard", worktree]);
  t.after(function () {
    try { git(repo, ["worktree", "remove", "--force", worktree]); } catch (e) {}
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  var summary = gitCli.getSummary(worktree);
  assert.equal(summary.isRepository, true);
  assert.equal(summary.isWorktree, true);
  assert.equal(summary.branch, "feat/placard");
  assert.equal(JSON.stringify(summary).indexOf(repo), -1);

  var main = gitCli.getSummary(repo);
  assert.equal(main.isWorktree, false);
  assert.equal(main.branch, "main");
});

test("worktree detection survives a symlinked working directory", async function (t) {
  // macOS puts temp dirs behind /var -> /private/var. git answers
  // --absolute-git-dir resolved and --git-common-dir relative, so comparing
  // the raw strings reported every ordinary repository as a linked worktree.
  var repo = createRepository(t);
  assert.equal(gitCli.getSummary(repo).isWorktree, false);
  assert.equal(gitCli.getStatus(repo).isWorktree, false,
    "the full status agrees, so the panel and the placard cannot disagree");
});

test("the remote label is bounded and credential-free", function () {
  var label = gitCli.shortRemoteLabel;
  assert.equal(label("git@github.com:ThroughLineCare/throughline-portal.git"),
    "github.com/ThroughLineCare/throughline-portal");
  assert.equal(label("https://github.com/ThroughLineCare/throughline-portal.git"),
    "github.com/ThroughLineCare/throughline-portal");
  assert.equal(label("ssh://git@example.com:2222/team/repo.git"),
    "example.com:2222/team/repo");
  assert.equal(label("https://someone:ghp_secrettoken@github.com/team/repo.git"),
    "github.com/team/repo", "an embedded token is dropped, not merely hidden");
  assert.equal(label("https://github.com/team/repo/"), "github.com/team/repo");
  assert.equal(label(null), null);
  assert.equal(label(""), null);

  var long = label("https://github.com/" + "x".repeat(200) + "/repo.git");
  assert.ok(long.length <= 64, "the label is bounded");
  assert.match(long, /…$/, "truncation is visible rather than silent");
});

test("the summary is cheaper than the full status by construction", function () {
  var summary = gitCliSource.slice(gitCliSource.indexOf("function getSummary(cwd, osUserInfo)"));
  summary = summary.slice(0, summary.indexOf("function resolveChangedPaths"));

  // One combined rev-parse, one status, one remote lookup.
  assert.equal((summary.match(/runGitSync\(/g) || []).length, 3,
    "three git invocations, against the full status's six");
  assert.match(summary, /"rev-parse", "--is-inside-work-tree", "--show-toplevel",\s*\n?\s*"--absolute-git-dir", "--git-common-dir",/,
    "the identity probe is a single invocation");
  assert.equal(/worktree", "list|"diff"|"show"/.test(summary), false,
    "no worktree enumeration and no diff work");
  assert.equal(/decorateStatus/.test(summary), false, "no session attribution");
});

test("the endpoint is registered behind the same permission gate as the panel", function () {
  assert.match(projectHttpSource,
    /var isGitPanelRequest = urlPath === "\/api\/git\/status" \|\| urlPath === "\/api\/git\/summary"/,
    "the summary is gated exactly like the rest of the Git surface");
  var gate = projectHttpSource.slice(projectHttpSource.indexOf("if (isGitPanelRequest && usersModule.isMultiUser())"));
  gate = gate.slice(0, gate.indexOf("if (req.method === \"GET\" && urlPath === \"/api/git/status\")"));
  assert.match(gate, /!gitPermissions\.fileBrowser/);
  assert.match(gate, /Git access is not permitted/);

  var handler = projectHttpSource.slice(projectHttpSource.indexOf('urlPath === "/api/git/summary") {'));
  handler = handler.slice(0, handler.indexOf('urlPath.indexOf("/api/git/file-diff?")'));
  assert.match(handler, /gitCli\.getSummary\(cwd, getOsUserInfoForReq\(req\)\)/,
    "the OS user identity is applied, same as every other Git read");
  assert.match(handler, /"Cache-Control": "no-store"/);
  assert.match(handler, /res\.writeHead\(500/, "a failure is reported rather than faked as an empty repo");
});
