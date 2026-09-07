// Stable project knowledge and Git worktree change-set identities.
//
// Existing projects freeze their current path-derived scope so every opaque
// log ref remains valid. New projects receive a path-independent id. A linked
// worktree stores its generated change-set marker in Git's administrative
// directory, which survives daemon restarts and branch renames but disappears
// with the worktree itself; the durable log records retain the id afterward.

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var execFileSync = require("child_process").execFileSync;
var logsRoot = require("./project-logs-root");
var utils = require("./utils");

var ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(16).toString("base64url");
}

function validId(value, prefix) {
  return typeof value === "string" && ID_PATTERN.test(value) && (!prefix || value.indexOf(prefix + "_") === 0);
}

function legacyKnowledgeId(cwd) {
  return utils.encodeCwd(logsRoot.resolveProjectRoot(cwd));
}

function ensureProjectKnowledgeId(project) {
  if (!project || typeof project !== "object") return false;
  if (validId(project.projectKnowledgeId)) return false;
  project.projectKnowledgeId = project.path ? legacyKnowledgeId(project.path) : newId("pk");
  return true;
}

function initializeProjectKnowledge(config) {
  var changed = false;
  var projects = config && Array.isArray(config.projects) ? config.projects : [];
  for (var i = 0; i < projects.length; i++) {
    if (ensureProjectKnowledgeId(projects[i])) changed = true;
  }
  return changed;
}

function createProjectKnowledgeId() {
  return newId("pk");
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd: cwd,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function commit(cwd, ref) {
  try { return git(cwd, ["rev-parse", ref || "HEAD"]); }
  catch (e) { return null; }
}

function markerPath(cwd) {
  try {
    var gitDir = git(cwd, ["rev-parse", "--git-dir"]);
    return path.join(path.resolve(cwd, gitDir), "clay-change-set.json");
  } catch (e) {
    return null;
  }
}

function readMarker(filePath, knowledgeId) {
  if (!filePath) return null;
  try {
    var parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || parsed.projectKnowledgeId !== knowledgeId || !validId(parsed.changeSetId, "cs")) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function deterministicFallback(knowledgeId, cwd) {
  var digest = crypto.createHash("sha256").update(knowledgeId + "\u0000" + logsRoot.canonicalPath(cwd)).digest("base64url");
  return "cs_" + digest.substring(0, 22);
}

function resolveWorktreeContext(cwd, knowledgeId, details) {
  var input = details || {};
  var filePath = markerPath(cwd);
  var marker = readMarker(filePath, knowledgeId);
  if (!marker) {
    marker = {
      projectKnowledgeId: knowledgeId,
      changeSetId: newId("cs"),
      baseCommit: input.baseCommit || null,
      createdAt: Date.now(),
    };
    if (filePath) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(marker, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      } catch (e) {
        marker = readMarker(filePath, knowledgeId) || marker;
      }
    }
  }
  if (!filePath || !readMarker(filePath, knowledgeId)) {
    marker.changeSetId = deterministicFallback(knowledgeId, cwd);
  }
  return {
    kind: "worktree",
    changeSetId: marker.changeSetId,
    branch: input.branch || null,
    baseCommit: marker.baseCommit || input.baseCommit || null,
    headCommit: commit(cwd, "HEAD"),
    status: "active",
  };
}

function isMerged(parentCwd, worktreeCwd) {
  var head = commit(worktreeCwd, "HEAD");
  if (!head) return false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", head, "HEAD"], {
      cwd: parentCwd,
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch (e) {
    return false;
  }
}

function cleanCommit(value) {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value) ? value : null;
}

function cleanBranch(value) {
  if (typeof value !== "string") return null;
  var cleaned = value.trim().substring(0, 200);
  return cleaned && cleaned.indexOf("\n") === -1 && cleaned.indexOf("\r") === -1 ? cleaned : null;
}

function normalizeRecordContext(value) {
  if (!value || value.kind !== "worktree" || !validId(value.changeSetId, "cs")) {
    return { kind: "project", changeSetId: null, branch: null, baseCommit: null, headCommit: null, status: "active" };
  }
  return {
    kind: "worktree",
    changeSetId: value.changeSetId,
    branch: cleanBranch(value.branch),
    baseCommit: cleanCommit(value.baseCommit),
    headCommit: cleanCommit(value.headCommit),
    status: value.status === "merged" || value.status === "archived" ? value.status : "active",
  };
}

module.exports = {
  ID_PATTERN: ID_PATTERN,
  validId: validId,
  legacyKnowledgeId: legacyKnowledgeId,
  ensureProjectKnowledgeId: ensureProjectKnowledgeId,
  initializeProjectKnowledge: initializeProjectKnowledge,
  createProjectKnowledgeId: createProjectKnowledgeId,
  resolveWorktreeContext: resolveWorktreeContext,
  commit: commit,
  isMerged: isMerged,
  normalizeRecordContext: normalizeRecordContext,
};
