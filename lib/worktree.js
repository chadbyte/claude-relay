var { execFileSync } = require("child_process");
var path = require("path");

// Parse `git worktree list --porcelain` output into structured objects
function parseWorktreeOutput(output) {
  var worktrees = [];
  var current = null;
  var lines = output.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf("worktree ") === 0) {
      if (current) worktrees.push(current);
      current = { path: line.slice(9), branch: null, bare: false, detached: false };
    } else if (line.indexOf("branch ") === 0 && current) {
      // refs/heads/feat/login -> feat/login
      var ref = line.slice(7);
      var headsIdx = ref.indexOf("refs/heads/");
      current.branch = headsIdx === 0 ? ref.slice(11) : ref;
    } else if (line === "bare" && current) {
      current.bare = true;
    } else if (line === "detached" && current) {
      current.detached = true;
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

// Check if a given path is itself a worktree (not the main working tree)
function isWorktree(projectPath) {
  try {
    var gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: projectPath, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    var commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: projectPath, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    var absGit = path.resolve(projectPath, gitDir);
    var absCommon = path.resolve(projectPath, commonDir);
    return absGit !== absCommon;
  } catch (e) {
    return false;
  }
}

function isPathInside(parentPath, candidatePath) {
  var relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative !== "" && relative !== ".." && relative.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(relative);
}

// Scan worktrees for a given project path
// Returns array of { path, branch, bare, detached, external }
// external = true when Git registered the worktree outside the main project folder
function scanWorktrees(projectPath) {
  var resolvedParent = path.resolve(projectPath);
  try {
    var output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: resolvedParent,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    var all = parseWorktreeOutput(output);
    // Filter out bare worktrees and the main worktree itself
    var results = [];
    for (var i = 0; i < all.length; i++) {
      var wt = all[i];
      if (wt.bare) continue;
      var resolvedWt = path.resolve(wt.path);
      if (resolvedWt === resolvedParent) continue;
      wt.external = !isPathInside(resolvedParent, resolvedWt);
      wt.dirName = path.basename(wt.path);
      results.push(wt);
    }
    return results;
  } catch (e) {
    return [];
  }
}

// Create a new worktree inside the parent project directory
// Returns { ok, path, error }
function createWorktree(projectPath, branchName, dirName, baseBranch) {
  var resolvedParent = path.resolve(projectPath);
  var wtPath = path.join(resolvedParent, dirName || branchName);
  var base = baseBranch || "main";
  // Try creating with -b (new branch)
  try {
    execFileSync("git", ["worktree", "add", wtPath, "-b", branchName, base], {
      cwd: resolvedParent,
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, path: wtPath };
  } catch (e) {
    // Branch may already exist, try without -b
    try {
      execFileSync("git", ["worktree", "add", wtPath, branchName], {
        cwd: resolvedParent,
        encoding: "utf8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { ok: true, path: wtPath };
    } catch (e2) {
      return { ok: false, error: e2.message || "Failed to create worktree" };
    }
  }
}

// Remove a worktree
// Returns { ok, error }
function removeWorktree(projectPath, worktreeDirName) {
  var resolvedParent = path.resolve(projectPath);
  var wtPath = path.join(resolvedParent, worktreeDirName);
  // Try normal remove first
  try {
    execFileSync("git", ["worktree", "remove", wtPath], {
      cwd: resolvedParent,
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true };
  } catch (e) {
    var errMsg = (e.stderr || e.message || "").toString();
    // If dirty, report to user
    if (errMsg.indexOf("modified") !== -1 || errMsg.indexOf("untracked") !== -1) {
      return { ok: false, error: "Worktree has uncommitted changes. Commit or discard them first." };
    }
    if (errMsg.indexOf("locked") !== -1) {
      return { ok: false, error: "Worktree is locked. Unlock it first with: git worktree unlock" };
    }
    return { ok: false, error: errMsg || "Failed to remove worktree" };
  }
}

module.exports = { scanWorktrees: scanWorktrees, createWorktree: createWorktree, removeWorktree: removeWorktree, isWorktree: isWorktree, isPathInside: isPathInside };
