// Tests for lib/agents.js — named-agent home_project resolution.
// See lr-195d: session cwd should be the agent's home project so
// Sentinel can attribute the JSONL to a workspace project.

var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var agents = require("../lib/agents");

// ============================================================
// parseFrontmatter — sanity coverage for home_project
// ============================================================

test("parseFrontmatter extracts home_project field", function () {
  var raw = "---\nname: foo\nchat: true\nhome_project: /workspace/foo\n---\nbody";
  var parsed = agents.parseFrontmatter(raw);
  assert.strictEqual(parsed.meta.home_project, "/workspace/foo");
  assert.strictEqual(parsed.meta.chat, true);
  assert.strictEqual(parsed.body, "body");
});

// ============================================================
// resolveAgentHomeProject
// ============================================================

test("resolveAgentHomeProject returns null when meta is empty", function () {
  assert.strictEqual(agents.resolveAgentHomeProject(null), null);
  assert.strictEqual(agents.resolveAgentHomeProject({}), null);
  assert.strictEqual(agents.resolveAgentHomeProject({ home_project: "" }), null);
});

test("resolveAgentHomeProject resolves an existing absolute path", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-agents-test-"));
  try {
    var resolved = agents.resolveAgentHomeProject({ home_project: dir });
    assert.strictEqual(resolved, dir);
  } finally {
    fs.rmdirSync(dir);
  }
});

test("resolveAgentHomeProject returns null when path does not exist", function () {
  var bogus = path.join(os.tmpdir(), "clay-agents-test-does-not-exist-" + Date.now());
  assert.strictEqual(agents.resolveAgentHomeProject({ home_project: bogus }), null);
});

test("resolveAgentHomeProject returns null when path is a file, not a directory", function () {
  var f = path.join(os.tmpdir(), "clay-agents-test-file-" + Date.now());
  fs.writeFileSync(f, "x");
  try {
    assert.strictEqual(agents.resolveAgentHomeProject({ home_project: f }), null);
  } finally {
    fs.unlinkSync(f);
  }
});

test("resolveAgentHomeProject accepts homeProject and project aliases", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-agents-test-alias-"));
  try {
    assert.strictEqual(agents.resolveAgentHomeProject({ homeProject: dir }), dir);
    assert.strictEqual(agents.resolveAgentHomeProject({ project: dir }), dir);
    assert.strictEqual(agents.resolveAgentHomeProject({ cwd: dir }), dir);
  } finally {
    fs.rmdirSync(dir);
  }
});

test("resolveAgentHomeProject resolves relative path under /workspace", function () {
  // Use whatever the first /workspace/<dir> entry is, since the test
  // environment provides /workspace.
  if (!fs.existsSync("/workspace")) return; // skip outside dev env
  var entries = fs.readdirSync("/workspace");
  var firstDir = null;
  for (var i = 0; i < entries.length; i++) {
    var p = path.join("/workspace", entries[i]);
    try {
      if (fs.statSync(p).isDirectory()) { firstDir = entries[i]; break; }
    } catch (e) {}
  }
  if (!firstDir) return;
  var resolved = agents.resolveAgentHomeProject({ home_project: firstDir });
  assert.strictEqual(resolved, path.join("/workspace", firstDir));
});

// ============================================================
// projectSlugFor / getAgentDir — sanity
// ============================================================

test("projectSlugFor produces stable agent- prefix", function () {
  assert.strictEqual(agents.projectSlugFor({ slug: "foo" }), "agent-foo");
});
