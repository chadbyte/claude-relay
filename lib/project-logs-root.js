// Project root resolution for Project Logs storage.
//
// Split from project-logs-store.js so the store stays inside the module size
// limit. A worktree shares its parent project's Logs: the store root is
// resolved through Git's common directory, so a worktree session and a parent
// session read and write the same record file instead of forking knowledge.

var fs = require("fs");
var path = require("path");
var execFileSync = require("child_process").execFileSync;
var utils = require("./utils");

var _rootCache = new Map();

function defaultGit(cwd, args) {
  return execFileSync("git", args, {
    cwd: cwd,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// Symlinked paths must collapse to one identity. Git reports a worktree's
// common directory in real terms while a project path may arrive symlinked
// (/var vs /private/var on macOS), and two spellings of one root would fork
// the Logs, which is precisely what worktree sharing exists to prevent.
function canonicalPath(value) {
  var resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch (e) {
    return resolved;
  }
}

// A worktree's common directory points at the parent checkout's .git, so its
// parent working tree is that directory's parent. Anything that is not an
// ordinary .git directory (bare-backed worktrees, non-Git folders) falls back
// to the path itself rather than guessing.
function resolveProjectRoot(cwd, runGit) {
  var resolved = canonicalPath(cwd);
  if (!runGit && _rootCache.has(resolved)) return _rootCache.get(resolved);
  var root = resolved;
  try {
    var commonDir = (runGit || defaultGit)(resolved, ["rev-parse", "--git-common-dir"]);
    var absoluteCommon = path.resolve(resolved, String(commonDir || "").trim());
    if (path.basename(absoluteCommon) === ".git") {
      var parent = path.dirname(absoluteCommon);
      if (fs.statSync(parent).isDirectory()) root = canonicalPath(parent);
    }
  } catch (e) {
    root = resolved;
  }
  if (!runGit) _rootCache.set(resolved, root);
  return root;
}

function scopeIdForRoot(root) {
  return "project/" + utils.encodeCwd(root);
}

module.exports = {
  resolveProjectRoot: resolveProjectRoot,
  scopeIdForRoot: scopeIdForRoot,
  canonicalPath: canonicalPath,
};
