var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var source = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette.js"), "utf8");

// The normalizer is pure, so it is exercised directly rather than asserted
// against its source text. The module imports icons.js, which touches browser
// globals at load, so the function is evaluated in isolation from its own
// source: everything it needs is self-contained above the DOM code.
function loadNormalizer() {
  var start = source.indexOf("var LEGACY_SESSION_TOOL_IDS");
  var end = source.indexOf("export function initToolPalettes");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  var body = source.slice(start, end)
    .replace(/^export function/gm, "function");
  var factory = new Function(body + "\nreturn { normalizeToolPreferences: normalizeToolPreferences, LEGACY_SESSION_TOOL_IDS: LEGACY_SESSION_TOOL_IDS, RETIRED_SESSION_TOOL_IDS: RETIRED_SESSION_TOOL_IDS };");
  return factory();
}

var api = loadNormalizer();
var normalize = api.normalizeToolPreferences;

var DEFAULT_ORDER = [
  "file-browser-btn",
  "terminal-sidebar-btn",
  "sticky-notes-sidebar-btn",
  "scheduler-btn",
  "loop-tool-btn",
  "mcp-btn",
  "skills-btn",
];

test("the legacy id maps to Project Logs", function () {
  assert.equal(api.LEGACY_SESSION_TOOL_IDS["scheduler-btn"], "project-logs-btn");
});

test("a visible legacy tool is replaced at its exact index", function () {
  var result = normalize("session", { order: DEFAULT_ORDER, hidden: [] });
  assert.equal(result.migrated, true);
  assert.equal(result.order.indexOf("project-logs-btn"), 3, "Logs inherits the exact slot");
  assert.equal(result.order.indexOf("scheduler-btn"), -1, "the legacy id is gone");
  assert.equal(result.order.length, DEFAULT_ORDER.length, "no tool is added or lost");
  assert.deepEqual(result.hidden, []);

  // Every other position is untouched.
  assert.deepEqual(result.order, [
    "file-browser-btn",
    "terminal-sidebar-btn",
    "sticky-notes-sidebar-btn",
    "project-logs-btn",
    "loop-tool-btn",
    "mcp-btn",
    "skills-btn",
  ]);
});

test("a customized order keeps every other choice", function () {
  var custom = ["skills-btn", "scheduler-btn", "terminal-sidebar-btn", "file-browser-btn"];
  var result = normalize("session", { order: custom, hidden: [] });
  assert.deepEqual(result.order, ["skills-btn", "project-logs-btn", "terminal-sidebar-btn", "file-browser-btn"]);
  assert.equal(result.migrated, true);
  // The input is not mutated.
  assert.deepEqual(custom, ["skills-btn", "scheduler-btn", "terminal-sidebar-btn", "file-browser-btn"]);
});

test("a hidden legacy tool stays hidden as Project Logs", function () {
  var result = normalize("session", {
    order: ["file-browser-btn", "terminal-sidebar-btn"],
    hidden: ["mcp-btn", "scheduler-btn", "skills-btn"],
  });
  assert.equal(result.migrated, true);
  assert.deepEqual(result.hidden, ["mcp-btn", "project-logs-btn", "skills-btn"],
    "Logs inherits the hidden slot at the same index");
  assert.deepEqual(result.order, ["file-browser-btn", "terminal-sidebar-btn"],
    "the visible order is untouched");
});

test("an explicit Project Logs preference is never repositioned", function () {
  // The user already reordered Logs to the front and a stale legacy id remains.
  var result = normalize("session", {
    order: ["project-logs-btn", "file-browser-btn", "scheduler-btn", "terminal-sidebar-btn"],
    hidden: [],
  });
  assert.equal(result.migrated, true, "the stale id is still cleaned up");
  assert.deepEqual(result.order, ["project-logs-btn", "file-browser-btn", "terminal-sidebar-btn"],
    "the chosen position wins and the legacy id is dropped, not swapped in");
  assert.equal(result.order.indexOf("project-logs-btn"), 0);
});

test("an explicitly hidden Project Logs stays hidden even with a visible legacy id", function () {
  var result = normalize("session", {
    order: ["file-browser-btn", "scheduler-btn", "terminal-sidebar-btn"],
    hidden: ["project-logs-btn"],
  });
  assert.equal(result.migrated, true);
  assert.deepEqual(result.hidden, ["project-logs-btn"], "the user's hide choice is preserved");
  assert.deepEqual(result.order, ["file-browser-btn", "terminal-sidebar-btn"],
    "the legacy id is removed rather than un-hiding Logs");
  assert.equal(result.order.indexOf("project-logs-btn"), -1);
});

test("both ids present in one list deduplicate to a single entry", function () {
  var result = normalize("session", {
    order: ["file-browser-btn", "scheduler-btn", "project-logs-btn", "terminal-sidebar-btn"],
    hidden: [],
  });
  assert.deepEqual(result.order, ["file-browser-btn", "project-logs-btn", "terminal-sidebar-btn"]);
  assert.equal(result.order.filter(function (id) { return id === "project-logs-btn"; }).length, 1);

  // Reversed input order: the explicit entry still wins its own position.
  var reversed = normalize("session", {
    order: ["project-logs-btn", "scheduler-btn"],
    hidden: [],
  });
  assert.deepEqual(reversed.order, ["project-logs-btn"]);

  // A duplicated legacy id collapses too.
  var doubled = normalize("session", { order: ["scheduler-btn", "terminal-sidebar-btn", "scheduler-btn"], hidden: [] });
  assert.deepEqual(doubled.order, ["project-logs-btn", "terminal-sidebar-btn"]);
});

test("preferences without the legacy id are left completely alone", function () {
  var current = { order: ["file-browser-btn", "project-logs-btn"], hidden: ["mcp-btn"] };
  var result = normalize("session", current);
  assert.equal(result.migrated, false, "no migration means no write-back");
  assert.deepEqual(result.order, current.order);
  assert.deepEqual(result.hidden, current.hidden);

  var empty = normalize("session", { order: [], hidden: [] });
  assert.equal(empty.migrated, false);
  assert.deepEqual(empty.order, []);
});

test("the mate palette is untouched by the session migration", function () {
  var result = normalize("mate", { order: ["mate-memory-btn", "scheduler-btn"], hidden: [] });
  assert.equal(result.migrated, false);
  assert.deepEqual(result.order, ["mate-memory-btn", "scheduler-btn"],
    "a mate preference is never rewritten by a session-only mapping");
});

test("missing or malformed preference shapes fail safe", function () {
  var nothing = normalize("session", null);
  assert.equal(nothing.migrated, false);
  assert.deepEqual(nothing.order, []);
  assert.deepEqual(nothing.hidden, []);

  var partial = normalize("session", { order: ["scheduler-btn"] });
  assert.equal(partial.migrated, true);
  assert.deepEqual(partial.order, ["project-logs-btn"]);
  assert.deepEqual(partial.hidden, []);

  assert.doesNotThrow(function () { normalize("session", {}); });
  assert.doesNotThrow(function () { normalize("session", undefined); });
});

// --- Git retirement -------------------------------------------------------

test("Git is retired from the session palette with no replacement", function () {
  assert.deepEqual(api.RETIRED_SESSION_TOOL_IDS, ["git-sidebar-btn"]);
  assert.equal(api.LEGACY_SESSION_TOOL_IDS["git-sidebar-btn"], undefined,
    "Git is dropped, never remapped onto another tool's slot");
});

test("a saved Git preference is dropped from order and hidden alike", function () {
  var visible = normalize("session", {
    order: ["file-browser-btn", "git-sidebar-btn", "skills-btn"],
    hidden: [],
  });
  assert.equal(visible.migrated, true, "the drop is written back so it does not linger");
  assert.deepEqual(visible.order, ["file-browser-btn", "skills-btn"],
    "every other tool keeps its relative position");
  assert.deepEqual(visible.hidden, []);

  var hidden = normalize("session", {
    order: ["file-browser-btn"],
    hidden: ["git-sidebar-btn", "mcp-btn"],
  });
  assert.equal(hidden.migrated, true);
  assert.deepEqual(hidden.hidden, ["mcp-btn"]);
  assert.deepEqual(hidden.order, ["file-browser-btn"]);
});

test("the retirement composes with the legacy remap in one pass", function () {
  var result = normalize("session", {
    order: ["git-sidebar-btn", "scheduler-btn", "file-browser-btn"],
    hidden: [],
  });
  assert.equal(result.migrated, true);
  assert.deepEqual(result.order, ["project-logs-btn", "file-browser-btn"],
    "Logs inherits the legacy slot and Git simply disappears");
});

test("preferences that never mentioned Git are left alone", function () {
  var current = { order: ["file-browser-btn", "mcp-btn"], hidden: [] };
  var result = normalize("session", current);
  assert.equal(result.migrated, false, "no gratuitous write-back");
  assert.deepEqual(result.order, current.order);
});

test("the mate palette is unaffected by the Git retirement", function () {
  var result = normalize("mate", { order: ["mate-memory-btn", "git-sidebar-btn"], hidden: [] });
  assert.equal(result.migrated, false);
  assert.deepEqual(result.order, ["mate-memory-btn", "git-sidebar-btn"]);
});

test("no palette registry lists Git as a tile", function () {
  assert.equal(/id: "git-sidebar-btn"/.test(source), false,
    "Git no longer consumes an icon slot in either palette");
  assert.equal(/countId: "git-sidebar-count"/.test(source), false,
    "the tile badge is gone with the tile");
});

// --- Wiring ---------------------------------------------------------------

test("applyPreferences normalizes before arranging and persists once", function () {
  var apply = source.slice(source.indexOf("function applyPreferences(name, prefs)"));
  apply = apply.slice(0, apply.indexOf("\nfunction queueSave"));

  // The normalized lists, not the raw preference, drive the DOM arrangement.
  assert.match(apply, /var normalized = normalizeToolPreferences\(name, prefs\);/);
  assert.match(apply, /var hiddenList = normalized\.hidden;/);
  assert.match(apply, /var orderList = normalized\.order;/);
  assert.equal(/prefs\.hidden \|\| \[\]|prefs\.order \|\| \[\]/.test(apply), false,
    "the raw preference is no longer read directly");

  // Persisted exactly once, only when something actually changed, through the
  // existing debounced save path rather than a new request.
  assert.match(apply, /if \(normalized\.migrated\) queueSave\(name\);/);
  assert.equal((apply.match(/queueSave\(/g) || []).length, 1, "a single write-back");
  assert.equal(/fetch\(/.test(apply), false, "no bespoke request is issued");
  assert.ok(apply.indexOf("hiddenGrid.appendChild(hbtn)") < apply.indexOf("if (normalized.migrated)"),
    "the DOM is arranged before the save reads it");
});

test("the save path and storage rules are unchanged", function () {
  assert.match(source, /fetch\('\/api\/user\/tool-palettes', \{\s*\n\s*method: 'PUT'/,
    "the existing server preference endpoint is reused");
  assert.equal(/localStorage|sessionStorage/.test(source), false, "no client-side settings storage");
  assert.equal(/=>/.test(source), false, "no arrow functions");
  assert.equal(/^\s*(const|let)\s/m.test(source), false, "var only");
  assert.match(source, /export function normalizeToolPreferences/, "ESM export");
});

test("the default registry still lists Logs in the vacated slot", function () {
  var registry = source.slice(source.indexOf("var SESSION_TOOLS"), source.indexOf("var MATE_TOOLS"));
  assert.match(registry, /id: "project-logs-btn"/);
  assert.equal(/id: "scheduler-btn"/.test(registry), false);
  var ids = registry.match(/id: "([a-z-]+)"/g).map(function (m) { return m.slice(5, -1); });
  assert.equal(ids.indexOf("project-logs-btn"), 3,
    "the default position matches the slot the migration assigns");
});
