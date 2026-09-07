var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var execFileSync = require("child_process").execFileSync;

var recordStore = require("../lib/knowledge-record-store");
var logsStore = require("../lib/project-logs-store");
var knowledgeSearch = require("../lib/knowledge-search");
var logsQuery = require("../lib/project-logs-query");

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clay-logs-" + label + "-"));
}

function newStore(label) {
  var base = tmpDir(label);
  return logsStore.createProjectLogsStore({ root: "/srv/example-project", baseDir: base });
}

var SESSION_AUTHOR = { type: "session", userId: "u1", displayName: "Ada", sessionKey: "cli-1", vendor: "claude" };
var OTHER_AUTHOR = { type: "user", userId: "u2", displayName: "Grace" };

test("records are appended, projected, and never rewritten in place", function () {
  var store = newStore("append");
  var created = store.create({ kind: "decision", summary: "Recorded for the ledger.", title: "Use JSONL", body: "Append only.", tags: ["Storage"] }, SESSION_AUTHOR);

  assert.match(created.ref, logsStore.REF_PATTERN);
  assert.equal(created.kind, "decision");
  assert.deepEqual(created.tags, ["storage"]);
  assert.equal(created.revisions, 1);
  assert.equal(created.createdBy.sessionKey, "cli-1");

  var raw = fs.readFileSync(store.filePath, "utf8").trim().split("\n");
  assert.equal(raw.length, 1);

  store.update(created.ref, { body: "Append only, with a derived projection." }, OTHER_AUTHOR);

  var afterUpdate = fs.readFileSync(store.filePath, "utf8").trim().split("\n");
  assert.equal(afterUpdate.length, 2, "an update appends rather than rewriting");
  assert.equal(JSON.parse(afterUpdate[0]).body, "Append only.", "the original record is untouched");

  var head = store.read(created.ref, false);
  assert.equal(head.ref, created.ref, "the ref is stable across revisions");
  assert.equal(head.body, "Append only, with a derived projection.");
  assert.equal(head.title, "Use JSONL", "unspecified fields survive an update");
  assert.equal(head.revisions, 2);
  assert.equal(head.createdBy.userId, "u1");
  assert.equal(head.updatedBy.userId, "u2", "attribution follows the latest revision");
});

test("stable project identity preserves refs across project path changes", function () {
  var base = tmpDir("stable-id");
  var first = logsStore.createProjectLogsStore({ root: "/srv/old-path", baseDir: base, projectKnowledgeId: "pk_stable" });
  var created = first.create({ kind: "progress", summary: "Stable project ledger.", title: "Move the checkout" }, SESSION_AUTHOR);
  var moved = logsStore.createProjectLogsStore({ root: "/srv/new-path", baseDir: base, projectKnowledgeId: "pk_stable" });

  assert.equal(moved.read(created.ref, false).title, "Move the checkout");
  assert.equal(moved.filePath, first.filePath);
});

test("worktree provenance supports current, project, and all-change views", function () {
  var store = newStore("contexts");
  var worktreeA = { kind: "worktree", changeSetId: "cs_alpha", branch: "feature/alpha", status: "active" };
  var worktreeB = { kind: "worktree", changeSetId: "cs_beta", branch: "feature/beta", status: "active" };
  store.create({ kind: "decision", summary: "Applies across the project.", title: "Project policy" }, SESSION_AUTHOR);
  store.create({ kind: "progress", summary: "Alpha implementation.", title: "Alpha work" }, SESSION_AUTHOR, worktreeA);
  store.create({ kind: "progress", summary: "Beta implementation.", title: "Beta work" }, SESSION_AUTHOR, worktreeB);

  assert.equal(store.list({ contextMode: "project" }).total, 1);
  assert.equal(store.list({ contextMode: "current", currentChangeSetId: "cs_alpha" }).total, 2);
  assert.equal(store.list({ contextMode: "all" }).total, 3);
  assert.equal(store.search({ query: "implementation", contextMode: "current", currentChangeSetId: "cs_alpha" }).total, 1);

  assert.equal(store.setContextState(worktreeA, "merged"), true);
  assert.equal(store.setContextState(worktreeA, "merged"), false, "repeating one lifecycle state is a no-op");
  var alpha = store.list({ contextMode: "current", currentChangeSetId: "cs_alpha" }).entries.filter(function (entry) {
    return entry.context && entry.context.changeSetId === "cs_alpha";
  })[0];
  assert.equal(alpha.context.status, "merged");
});

test("history is a full author blame chain and delete is a tombstone", function () {
  var store = newStore("history");
  var entry = store.create({ kind: "incident", summary: "Recorded for the ledger.", title: "Daemon restart loop" }, SESSION_AUTHOR);
  store.update(entry.ref, { title: "Daemon restart loop (resolved)" }, OTHER_AUTHOR);
  store.link(entry.ref, [{ ref: "session:abc", label: "triage" }], SESSION_AUTHOR);

  var history = store.history(entry.ref, {});
  assert.equal(history.total, 3);
  assert.deepEqual(history.revisions.map(function (r) { return r.op; }), ["create", "update", "link"]);
  assert.deepEqual(history.revisions[0].changed, [], "a create has no prior state to differ from");
  assert.deepEqual(history.revisions[1].changed, ["title"]);
  assert.deepEqual(history.revisions[2].changed, ["links"]);
  assert.equal(history.revisions[0].body, undefined, "history carries no bodies");
  assert.equal(history.revisions[0].author.displayName, "Ada");
  assert.equal(history.revisions[1].author.displayName, "Grace");

  assert.equal(store.read(entry.ref, false).links[0].ref, "session:abc");

  var removed = store.remove(entry.ref, OTHER_AUTHOR);
  assert.equal(removed.deleted, true);
  assert.equal(removed.deletedBy.userId, "u2");
  assert.equal(store.read(entry.ref, false), null, "a tombstoned entry is hidden by default");
  assert.equal(store.read(entry.ref, true).deleted, true, "the record chain is retained");
  assert.equal(store.list({}).total, 0);
  assert.equal(store.list({ includeDeleted: true }).total, 1);
  assert.equal(store.history(entry.ref, {}).total, 4, "history survives deletion");

  assert.throws(function () { store.update(entry.ref, { title: "Reopen" }, SESSION_AUTHOR); }, /not found/);
});

test("list and search are bounded, filtered, and paged", function () {
  var store = newStore("bounded");
  for (var i = 0; i < 5; i++) {
    store.create({ kind: i % 2 === 0 ? "decision" : "progress", summary: "Entry " + i + " summary.", title: "Entry " + i, body: "shared marker body", tags: ["batch"] }, SESSION_AUTHOR);
  }
  store.create({ kind: "operations", summary: "Recorded for the ledger.", title: "Restart the daemon", body: "unrelated", tags: ["ops"] }, SESSION_AUTHOR);

  var firstPage = store.list({ limit: 2 });
  assert.equal(firstPage.entries.length, 2);
  assert.equal(firstPage.total, 6);
  assert.ok(firstPage.nextCursor);
  var secondPage = store.list({ limit: 2, cursor: firstPage.nextCursor });
  assert.equal(secondPage.entries.length, 2);
  assert.notEqual(secondPage.entries[0].ref, firstPage.entries[0].ref);

  assert.equal(store.list({ kind: "decision" }).total, 3);
  assert.equal(store.list({ tag: "ops" }).total, 1);
  assert.equal(store.list({ limit: 9999 }).entries.length, 6, "page size is clamped, not honored verbatim");

  var hits = store.search({ query: "shared marker" });
  assert.equal(hits.total, 5);
  assert.ok(hits.results[0].snippet.indexOf("shared marker") !== -1);
  assert.equal(store.search({ query: "restart", kind: "operations" }).total, 1);
  assert.throws(function () { store.search({ query: "" }); }, /query is required/);

  var long = store.create({ kind: "reference", summary: "Recorded for the ledger.", title: "T".repeat(400), body: "B".repeat(logsStore.MAX_BODY_CHARS + 500) }, SESSION_AUTHOR);
  assert.equal(long.title.length, logsStore.MAX_TITLE_CHARS);
  assert.equal(long.body.length, logsStore.MAX_BODY_CHARS);

  assert.equal(store.create({ kind: "gossip", summary: "Recorded for the ledger.", title: "Ok" }, SESSION_AUTHOR).category, "gossip", "an unfamiliar but well-formed category is accepted");
  assert.throws(function () { store.create({ kind: "decision", summary: "Recorded for the ledger.", title: "  " }, SESSION_AUTHOR); }, /title is required/);
});

test("a torn trailing line and a malformed line do not break loading", function () {
  var base = tmpDir("torn");
  var first = logsStore.createProjectLogsStore({ root: "/srv/torn", baseDir: base });
  var good = first.create({ kind: "decision", summary: "Recorded for the ledger.", title: "Survives" }, SESSION_AUTHOR);

  fs.appendFileSync(first.filePath, "{\"v\":1,\"id\":\"broken\",\"op\":\"crea");
  var reopened = logsStore.createProjectLogsStore({ root: "/srv/torn", baseDir: base });
  assert.equal(reopened.list({}).total, 1, "a partial trailing line is held back");
  assert.equal(reopened.read(good.ref, false).title, "Survives");

  // Completing the torn line later must not corrupt the projection either. The
  // completed line parses, but it is not a usable log entry, so it must not
  // surface as a blank one.
  fs.appendFileSync(first.filePath, "te\"}\n");
  fs.appendFileSync(first.filePath, "this is not json at all\n");
  fs.appendFileSync(first.filePath, "{\"notversioned\":true}\n");

  var third = logsStore.createProjectLogsStore({ root: "/srv/torn", baseDir: base });
  assert.equal(third.list({}).total, 1, "unusable lines are skipped, not fatal");
  assert.equal(third.stats().skippedRecords, 2, "unparseable and unversioned lines are counted");
  assert.equal(third.read(good.ref, false).title, "Survives");

  var stillWritable = third.create({ kind: "progress", summary: "Recorded for the ledger.", title: "After the damage" }, SESSION_AUTHOR);
  assert.equal(third.read(stillWritable.ref, false).title, "After the damage");
  assert.equal(third.list({}).total, 2);
});

test("a second store instance sees appends made through the first", function () {
  var base = tmpDir("concurrent");
  var a = logsStore.createProjectLogsStore({ root: "/srv/shared", baseDir: base });
  var b = logsStore.createProjectLogsStore({ root: "/srv/shared", baseDir: base });

  var fromA = a.create({ kind: "decision", summary: "Recorded for the ledger.", title: "Written by A" }, SESSION_AUTHOR);
  var fromB = b.create({ kind: "decision", summary: "Recorded for the ledger.", title: "Written by B" }, OTHER_AUTHOR);

  // Neither writer clobbers the other: both records are present in both views.
  assert.equal(a.list({}).total, 2, "A picks up B's interleaved append");
  assert.equal(b.list({}).total, 2, "B picks up A's earlier append");
  assert.equal(a.read(fromB.ref, false).title, "Written by B");
  assert.equal(b.read(fromA.ref, false).title, "Written by A");
  assert.equal(fs.readFileSync(a.filePath, "utf8").trim().split("\n").length, 2);
});

test("scope ids are strict and cannot escape the storage root", function () {
  assert.throws(function () { recordStore.scopeSegments("project/../../etc"); }, /Invalid knowledge scope id/);
  assert.throws(function () { recordStore.scopeSegments("project"); }, /Invalid knowledge scope id/);
  assert.throws(function () { recordStore.scopeSegments("project/a/b/c/d"); }, /Invalid knowledge scope id/);
  assert.equal(recordStore.scopeSegments("project/-srv-example").length, 2);

  var base = tmpDir("root");
  var store = logsStore.createProjectLogsStore({ root: "/srv/example", baseDir: base });
  assert.equal(store.scopeId, "project/-srv-example");
  assert.equal(path.dirname(store.filePath), path.join(base, "project", "-srv-example"));

  var oversized = { id: "x", rootId: "x", op: "create", body: "z".repeat(recordStore.MAX_RECORD_BYTES) };
  var raw = recordStore.createRecordStore({ scopeId: "project/-srv-example", baseDir: base });
  assert.throws(function () { raw.append(oversized); }, /exceeds/);
});

test("a Git worktree shares the parent project's Logs instead of forking them", function (t) {
  var base = tmpDir("worktree");
  var repo = path.join(base, "repo");
  fs.mkdirSync(repo, { recursive: true });
  var git = function (cwd, args) {
    return execFileSync("git", args, { cwd: cwd, encoding: "utf8", timeout: 20000, stdio: ["pipe", "pipe", "pipe"] });
  };
  try {
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "init"]);
    git(repo, ["worktree", "add", "-q", "-b", "feature", path.join(base, "wt")]);
  } catch (e) {
    t.skip("git is unavailable in this environment: " + e.message);
    return;
  }

  var storeRoot = path.join(base, "store");
  var parent = logsStore.createProjectLogsStore({ cwd: repo, baseDir: storeRoot });
  var worktree = logsStore.createProjectLogsStore({ cwd: path.join(base, "wt"), baseDir: storeRoot });

  assert.equal(worktree.root, parent.root, "the worktree resolves to the parent working tree");
  assert.equal(worktree.scopeId, parent.scopeId);
  assert.equal(worktree.filePath, parent.filePath);

  var fromWorktree = worktree.create({ kind: "progress", summary: "Recorded for the ledger.", title: "Worktree finding" }, SESSION_AUTHOR);
  assert.equal(parent.read(fromWorktree.ref, false).title, "Worktree finding", "parent sees worktree Logs");

  // A subdirectory of the checkout resolves to the same project root.
  var nested = path.join(repo, "lib");
  fs.mkdirSync(nested, { recursive: true });
  var fromNested = logsStore.createProjectLogsStore({ cwd: nested, baseDir: storeRoot });
  assert.equal(fromNested.root, parent.root);

  // A plain directory outside any repository falls back to itself, in
  // canonical form so a symlinked spelling cannot fork the store.
  var plain = path.join(base, "plain");
  fs.mkdirSync(plain, { recursive: true });
  assert.equal(logsStore.resolveProjectRoot(plain, git), fs.realpathSync.native(plain));
  assert.equal(parent.root, fs.realpathSync.native(repo), "roots are canonical paths");
});

test("Logs search is BM25-ranked while preserving the response shape", function () {
  var store = newStore("bm25");
  var dense = store.create({ kind: "decision", summary: "Recorded for the ledger.", title: "Journal storage", body: "append-only journal chosen for durability; the journal replays cleanly", tags: ["storage"] }, SESSION_AUTHOR);
  var passing = store.create({ kind: "progress", summary: "Recorded for the ledger.", title: "Weekly update", body: "one passing mention of the journal", tags: ["status"] }, SESSION_AUTHOR);
  var titled = store.create({ kind: "operations", summary: "Recorded for the ledger.", title: "Durability drill", body: "unrelated body text", tags: ["ops"] }, SESSION_AUTHOR);
  store.create({ kind: "reference", summary: "Recorded for the ledger.", title: "Typography", body: "nothing relevant here", tags: ["design"] }, SESSION_AUTHOR);
  var tagged = store.create({ kind: "incident", summary: "Recorded for the ledger.", title: "Outage", body: "cause unknown", tags: ["durability"] }, SESSION_AUTHOR);

  var hits = store.search({ query: "journal durability" });
  assert.equal(hits.total, 4, "only matching entries are returned");
  assert.equal(hits.results[0].ref, dense.ref, "the densest match ranks first");
  assert.ok(hits.results[0].score > hits.results[1].score, "BM25 scores are graded, not a flat 3/2/1 count");
  assert.equal(hits.results.filter(function (r) { return r.title === "Typography"; }).length, 0);

  // Response shape is exactly what the protocol already returned.
  var hit = hits.results[0];
  assert.deepEqual(Object.keys(hit).sort(), [
    "category", "commentCount", "context", "createdAt", "createdBy", "kind", "pendingFeedbackCount",
    "priority", "ref", "revisions", "score", "snippet", "summary", "tags", "title",
    "updatedAt", "updatedBy",
  ].sort());
  assert.equal(hit.body, undefined, "a search row never carries the record body");
  assert.equal(hit.kind, "decision");
  assert.deepEqual(hit.tags, ["storage"]);
  assert.equal(hit.updatedBy.sessionKey, "cli-1");
  assert.ok(hit.snippet.indexOf("journal") !== -1, "the snippet centres on the match");
  assert.equal(hits.nextCursor, null);

  // Title and tag weighting still beats a body-only mention.
  var titleRank = hits.results.map(function (r) { return r.ref; }).indexOf(titled.ref);
  var bodyRank = hits.results.map(function (r) { return r.ref; }).indexOf(passing.ref);
  assert.ok(titleRank < bodyRank, "a title hit outranks a passing body mention");
  assert.ok(hits.results.map(function (r) { return r.ref; }).indexOf(tagged.ref) !== -1, "a tag-only hit still matches");

  // Filters, pagination, and the error contract are unchanged.
  assert.equal(store.search({ query: "journal", kind: "decision" }).total, 1);
  var paged = store.search({ query: "journal durability", limit: 2 });
  assert.equal(paged.results.length, 2);
  assert.ok(paged.nextCursor);
  assert.equal(store.search({ query: "journal durability", limit: 2, cursor: paged.nextCursor }).results.length, 2);
  assert.equal(store.search({ query: "journal durability", limit: 9999 }).results.length, 4);
  assert.throws(function () { store.search({ query: "" }); }, /query is required/);

  // Deterministic tie-breaks: equal scores fall back to recency, then ref.
  var first = store.search({ query: "journal durability" }).results.map(function (r) { return r.ref; });
  var second = store.search({ query: "journal durability" }).results.map(function (r) { return r.ref; });
  assert.deepEqual(first, second, "repeated searches are stable");

  // CJK queries route through the shared tokenizer's bigrams.
  var korean = store.create({ kind: "investigation", summary: "Recorded for the ledger.", title: "재고 관리", body: "재고 관리 시스템 설계를 논의했다" }, SESSION_AUTHOR);
  var cjk = store.search({ query: "재고 관리" });
  assert.equal(cjk.results[0].ref, korean.ref);
});

test("a Project Log match deep in a maximum-length body is still found", function () {
  var store = newStore("tail");
  // A Project Log body is capped at MAX_BODY_CHARS when it is written, so the
  // deepest reachable match sits just inside that cap. It is still far past the
  // BM25 segment boundary, which is what segmentation has to cover here.
  var filler = "";
  while (filler.length < logsStore.MAX_BODY_CHARS - 200) {
    filler += "routine paragraph " + filler.length + " describing nothing of consequence\n";
  }
  var body = filler.substring(0, logsStore.MAX_BODY_CHARS - 120) + "\nThe hexokinase rollback procedure.\n재고 관리 시스템 설계를 논의했다\n";
  assert.ok(body.length <= logsStore.MAX_BODY_CHARS);
  assert.ok(body.indexOf("hexokinase") > knowledgeSearch.SEGMENT_CHARS * 2, "the needle sits well past the segment boundary");

  var tail = store.create({ kind: "operations", summary: "Recorded for the ledger.", title: "Long runbook", body: body, tags: ["ops"] }, SESSION_AUTHOR);
  assert.ok(tail.body.indexOf("hexokinase") !== -1, "the needle survived the write-time body cap");
  store.create({ kind: "decision", summary: "Recorded for the ledger.", title: "Unrelated", body: "nothing relevant here", tags: ["misc"] }, SESSION_AUTHOR);

  var hits = store.search({ query: "hexokinase" });
  assert.equal(hits.total, 1, "a tail-only match is findable");
  assert.equal(hits.results[0].ref, tail.ref);
  assert.ok(hits.results[0].snippet.indexOf("hexokinase") !== -1, "the snippet centres on the tail match");
  assert.equal(hits.results.filter(function (r) { return r.ref === tail.ref; }).length, 1, "segments collapse to one result");

  // Response shape is unchanged for a segmented entry.
  assert.equal(hits.results[0].body, undefined, "a search row never carries the record body");
  assert.deepEqual(hits.results[0].tags, ["ops"]);

  // CJK tail content routes through the shared tokenizer's bigrams.
  var cjk = store.search({ query: "재고 관리" });
  assert.equal(cjk.total, 1);
  assert.equal(cjk.results[0].ref, tail.ref);

  // Title and tag weighting still applies to a segmented entry.
  assert.equal(store.search({ query: "Long runbook" }).results[0].ref, tail.ref);
  assert.equal(store.search({ query: "hexokinase", kind: "decision" }).total, 0, "filters still apply");
  assert.deepEqual(store.search({ query: "hexokinase" }).results.map(function (r) { return r.ref; }),
    store.search({ query: "hexokinase" }).results.map(function (r) { return r.ref; }), "ranking is stable");
});

// --- Categories, priority, summary, and comments --------------------------

test("categories and priority are independent axes", function () {
  var store = newStore("axes");
  var urgent = store.create({
    kind: "decision", priority: "urgent",
    title: "Rotate the signing key",
    summary: "Rotated the signing key after the leak report; old key revoked today.",
  }, SESSION_AUTHOR);
  assert.equal(urgent.category, "decision");
  assert.equal(urgent.priority, "urgent", "an urgent decision is both, not one or the other");

  var routine = store.create({ kind: "decision", title: "Name the module", summary: "Picked project-logs-schema.js." }, SESSION_AUTHOR);
  assert.equal(routine.priority, "normal", "priority defaults rather than being required");

  assert.equal(store.list({ kind: "decision" }).total, 2);
  assert.equal(store.list({ priority: "urgent" }).total, 1, "priority filters independently of category");
  assert.equal(store.list({ kind: "decision", priority: "urgent" }).total, 1);

  assert.throws(function () {
    store.create({ kind: "decision", priority: "critical", title: "x", summary: "y" }, SESSION_AUTHOR);
  }, /Unknown log priority/);
  assert.deepEqual(logsStore.PRIORITIES, ["normal", "important", "urgent"], "priority stays a stable enum");
  assert.equal(logsStore.CATEGORIES, undefined, "there is no global category enum");
});

test("summary is required for new records, revision-tracked, and back-filled for old ones", function () {
  var store = newStore("summary");
  assert.throws(function () {
    store.create({ kind: "progress", title: "No summary" }, SESSION_AUTHOR);
  }, /summary is required/);

  var entry = store.create({ kind: "progress", title: "Shipped the ledger", summary: "First cut of the ledger is live." }, SESSION_AUTHOR);
  assert.equal(entry.summary, "First cut of the ledger is live.");

  store.update(entry.ref, { summary: "Ledger shipped; comments follow next." }, SESSION_AUTHOR);
  var revised = store.read(entry.ref, false);
  assert.equal(revised.summary, "Ledger shipped; comments follow next.");
  assert.equal(revised.revisions, 2);
  var history = store.history(entry.ref, {});
  assert.deepEqual(history.revisions[1].changed, ["summary"], "summary changes are tracked like title");
  assert.throws(function () { store.update(entry.ref, { summary: "  " }, SESSION_AUTHOR); }, /cannot be emptied/);

  // A record written before summaries existed gets a deterministic fallback
  // from its own body, and nothing on disk is rewritten.
  var legacyLine = JSON.stringify({
    v: 1, id: "legacy-1", rootId: "legacy-1", op: "create", kind: "session-note",
    title: "Old entry", body: "# Heading\nThe first real line of the old body.\nmore",
    author: { type: "session", displayName: "Ada" }, at: 1700000000000,
  });
  fs.appendFileSync(store.filePath, legacyLine + "\n");
  var reopened = logsStore.createProjectLogsStore({ root: "/srv/example-project", baseDir: path.dirname(path.dirname(path.dirname(store.filePath))) });
  var legacy = reopened.list({}).entries.filter(function (e) { return e.title === "Old entry"; })[0];
  assert.ok(legacy, "a legacy record still projects");
  assert.equal(legacy.kind, "session-note", "its stored category is preserved");
  assert.equal(legacy.category, "session-note", "the project's real historical term is never hidden by a global remap");
  assert.equal(legacy.priority, "normal");
  assert.equal(legacy.summary, "The first real line of the old body.", "the fallback is derived, not invented");
  assert.equal(reopened.list({ kind: "session-note" }).entries.filter(function (e) { return e.title === "Old entry"; }).length, 1,
    "and it is findable under that exact term");
  assert.ok(reopened.list({}).categories.indexOf("session-note") !== -1, "so it appears in the project vocabulary");
});

test("comments are append-only participation and never canonical revisions", function () {
  var store = newStore("comments");
  var entry = store.create({ kind: "decision", title: "Adopt JSONL", summary: "Append-only journal chosen." }, SESSION_AUTHOR);
  assert.equal(entry.commentCount, 0);
  assert.deepEqual(entry.comments, []);

  var afterOne = store.comment(entry.ref, { body: "Matches the migration plan." }, OTHER_AUTHOR);
  assert.equal(afterOne.commentCount, 1);
  assert.equal(afterOne.revisions, 1, "a comment does not advance the revision count");
  assert.equal(afterOne.updatedBy.userId, "u1", "nor does it steal canonical blame");
  assert.equal(afterOne.comments[0].author.displayName, "Grace");
  assert.equal(afterOne.comments[0].author.type, "user");
  assert.ok(afterOne.comments[0].at > 0);

  var afterTwo = store.comment(entry.ref, { body: "Second note." }, SESSION_AUTHOR);
  assert.equal(afterTwo.commentCount, 2);
  assert.deepEqual(afterTwo.comments.map(function (c) { return c.body; }), ["Matches the migration plan.", "Second note."]);

  // History stays canonical: comments are not revisions.
  var history = store.history(entry.ref, {});
  assert.equal(history.total, 1);
  assert.deepEqual(history.revisions.map(function (r) { return r.op; }), ["create"]);

  // The ledger row reports the count without the bodies.
  var row = store.list({}).entries[0];
  assert.equal(row.commentCount, 2);
  assert.equal(row.comments, undefined, "a list row never carries comment bodies");

  assert.throws(function () { store.comment(entry.ref, { body: "  " }, OTHER_AUTHOR); }, /comment body is required/);
  assert.throws(function () { store.comment("log:aaaaaaaaaaaaaaaaaaaaaaaa", { body: "x" }, OTHER_AUTHOR); }, /not found/);

  // Comments survive a reload and stay attributed.
  var reopened = logsStore.createProjectLogsStore({ root: "/srv/example-project", baseDir: path.dirname(path.dirname(path.dirname(store.filePath))) });
  var reloaded = reopened.read(entry.ref, false);
  assert.equal(reloaded.commentCount, 2);
  assert.equal(reloaded.comments[0].author.displayName, "Grace");
});

test("summary participates in BM25 ranking", function () {
  var store = newStore("summary-rank");
  var summarised = store.create({
    kind: "decision", title: "Storage format",
    summary: "Chose an append-only journal for durability and replay.",
    body: "unrelated body text",
  }, SESSION_AUTHOR);
  store.create({ kind: "progress", title: "Weekly", summary: "Routine update.", body: "a passing mention of durability" }, SESSION_AUTHOR);

  var hits = store.search({ query: "durability replay" });
  assert.equal(hits.results[0].ref, summarised.ref, "a summary match outranks a passing body mention");
  assert.ok(hits.results[0].summary.indexOf("append-only journal") !== -1, "the row carries the summary");
});


// --- Adaptive project vocabulary ------------------------------------------

test("each project evolves its own category vocabulary", function () {
  var alpha = newStore("vocab-alpha");
  var beta = newStore("vocab-beta");

  alpha.create({ kind: "decision", title: "Pick a datastore", summary: "Chose JSONL." }, SESSION_AUTHOR);
  alpha.create({ kind: "release-process", title: "Cut releases weekly", summary: "Weekly train agreed." }, SESSION_AUTHOR);
  beta.create({ kind: "clinical-safety", title: "Escalation path", summary: "Defined the escalation path." }, SESSION_AUTHOR);

  assert.deepEqual(alpha.list({}).categories, ["decision", "release-process"]);
  assert.deepEqual(beta.list({}).categories, ["clinical-safety"],
    "one project's vocabulary never leaks into another");

  // A category this project has never used is valid and simply matches nothing.
  var none = alpha.list({ kind: "clinical-safety" });
  assert.equal(none.total, 0);
  assert.deepEqual(none.categories, ["decision", "release-process"], "the vocabulary is still reported");
  assert.equal(alpha.search({ query: "datastore", kind: "clinical-safety" }).total, 0);
});

test("a coined category is normalized deterministically", function () {
  var store = newStore("coined");
  var entry = store.create({ kind: "Build Tooling", title: "Adopt esbuild", summary: "Faster local builds." }, SESSION_AUTHOR);
  assert.equal(entry.category, "build-tooling", "free text becomes a safe kebab-case label");
  assert.equal(entry.kind, "build-tooling");
  assert.deepEqual(store.list({}).categories, ["build-tooling"]);
  assert.equal(store.list({ kind: "Build Tooling" }).total, 1, "a filter is normalized the same way");

  // Hostile and empty shapes are refused rather than coerced into something odd.
  var hostile = ["", "   ", "../etc/passwd", "a/b", "!!!", "x".repeat(80), null, 42, {}];
  for (var i = 0; i < hostile.length; i++) {
    assert.throws(function () {
      store.create({ kind: hostile[i], title: "No", summary: "No." }, SESSION_AUTHOR);
    }, /category/i, "refused: " + JSON.stringify(hostile[i]));
  }
  // A supplied malformed filter is an error, not a silently dropped one:
  // ignoring it would widen the result set to everything instead of narrowing.
  assert.throws(function () { store.list({ kind: "../etc" }); }, /path characters/);
  assert.throws(function () { store.list({ kind: 42 }); }, /must be a string/);
  assert.throws(function () { store.list({ kind: "!!!" }); }, /letters or digits/);
  assert.throws(function () { store.search({ query: "esbuild", kind: "a/b" }); }, /path characters/);
  // Absent or empty stays "no filter".
  assert.equal(store.list({}).total, 1);
  assert.equal(store.list({ kind: "" }).total, 1);
  assert.equal(store.list({ kind: null }).total, 1);
});

test("the vocabulary follows revisions and deletions without rewriting history", function () {
  var store = newStore("vocab-live");
  var moved = store.create({ kind: "idea", title: "Batch the writes", summary: "Might reduce syscalls." }, SESSION_AUTHOR);
  var doomed = store.create({ kind: "spike", title: "Try a B-tree", summary: "Exploratory only." }, SESSION_AUTHOR);
  assert.deepEqual(store.list({}).categories, ["idea", "spike"]);

  // A revision that changes category updates the vocabulary.
  store.update(moved.ref, { category: "decision" }, SESSION_AUTHOR);
  assert.deepEqual(store.list({}).categories, ["decision", "spike"], "the old term drops out when unused");
  assert.equal(store.read(moved.ref, false).category, "decision");
  // History still shows the change without any record being rewritten.
  var history = store.history(moved.ref, {});
  assert.deepEqual(history.revisions[1].changed, ["category"]);
  var raw = fs.readFileSync(store.filePath, "utf8");
  assert.ok(raw.indexOf('"kind":"idea"') !== -1, "the original category is still on disk");

  // A category that exists only on deleted entries disappears.
  store.remove(doomed.ref, SESSION_AUTHOR);
  assert.deepEqual(store.list({}).categories, ["decision"]);
  assert.ok(store.list({ includeDeleted: true }).total > 1, "the deleted entry itself is still retrievable");
});


test("project vocabularies are not limited to Latin script", function () {
  var store = newStore("unicode");
  var korean = store.create({ kind: "보안", title: "키 회전", summary: "서명 키를 회전했다." }, SESSION_AUTHOR);
  var japanese = store.create({ kind: "設計 レビュー", title: "Storage review", summary: "Reviewed the storage design." }, SESSION_AUTHOR);
  var french = store.create({ kind: "Sécurité", title: "Audit", summary: "Audited the dependency tree." }, SESSION_AUTHOR);
  var cyrillic = store.create({ kind: "безопасность", title: "Scan", summary: "Ran the scanner." }, SESSION_AUTHOR);

  assert.equal(korean.category, "보안", "Hangul is preserved");
  assert.equal(japanese.category, "設計-レビュー", "a space becomes a hyphen across scripts");
  assert.equal(french.category, "sécurité", "accented Latin lowercases correctly");
  assert.equal(cyrillic.category, "безопасность");

  assert.deepEqual(store.list({}).categories.sort(), ["sécurité", "безопасность", "보안", "設計-レビュー"].sort());
  assert.equal(store.list({ kind: "보안" }).total, 1);
  assert.equal(store.list({ kind: "設計 レビュー" }).total, 1, "a filter is normalized the same way");
  assert.equal(store.list({ kind: "設計" }).total, 0, "a partial label is a different, unused category");

  // Bounds are counted in code points, not UTF-16 units.
  var longKorean = "가".repeat(33);
  assert.throws(function () { store.create({ kind: longKorean, title: "x", summary: "y" }, SESSION_AUTHOR); }, /32 characters or fewer/);
  assert.equal(store.create({ kind: "가".repeat(32), title: "ok", summary: "ok." }, SESSION_AUTHOR).category.length, 32);

  // Emoji and punctuation are still not categories.
  assert.throws(function () { store.create({ kind: "🎉", title: "x", summary: "y" }, SESSION_AUTHOR); }, /letters or digits/);
  assert.throws(function () { store.create({ kind: "보안/etc", title: "x", summary: "y" }, SESSION_AUTHOR); }, /path characters/);
});

// --- Comment review and version control ----------------------------------

test("a comment is a proposal: pending until the Driver reviews it", function () {
  var store = newStore("review");
  var entry = store.create({ kind: "decision", title: "Adopt X", summary: "Chose X." }, SESSION_AUTHOR);
  var withComment = store.comment(entry.ref, { body: "Should mention Y." }, OTHER_AUTHOR);
  var commentId = withComment.comments[0].id;

  assert.equal(withComment.comments[0].status, "pending");
  assert.equal(withComment.comments[0].review, null);
  assert.equal(withComment.pendingFeedbackCount, 1);
  assert.equal(withComment.revisions, 1, "a comment is not a revision");

  // Clarify and decline resolve the comment without touching the record.
  var clarified = store.review(entry.ref, {
    commentId: commentId, action: "clarify", response: "Which Y do you mean?",
  }, SESSION_AUTHOR);
  assert.equal(clarified.comments[0].status, "clarification-needed");
  assert.equal(clarified.comments[0].review.response, "Which Y do you mean?");
  assert.equal(clarified.comments[0].review.revision, null);
  assert.equal(clarified.revisions, 1, "clarifying creates no revision");
  assert.equal(clarified.pendingFeedbackCount, 0,
    "a clarification leaves the Driver queue: the ball is with the user");

  // A user answers with another comment, which is pending in its own right.
  var answered = store.comment(entry.ref, { body: "The retry path." }, OTHER_AUTHOR);
  assert.equal(answered.comments[1].status, "pending");
  assert.equal(answered.pendingFeedbackCount, 1, "the reply is the only Driver work");
  assert.equal(answered.comments[0].status, "clarification-needed",
    "and the Driver's question stays visible on the comment it answered");
  assert.equal(answered.comments[0].review.response, "Which Y do you mean?");

  var declined = store.review(entry.ref, {
    commentId: answered.comments[1].id, action: "decline", response: "The retry path is out of scope here.",
  }, SESSION_AUTHOR);
  assert.equal(declined.comments[1].status, "declined");
  assert.equal(declined.revisions, 1);
  assert.equal(declined.pendingFeedbackCount, 0, "nothing is left waiting on the Driver");

  // A response is required for clarify and decline.
  var third = store.comment(entry.ref, { body: "Another." }, OTHER_AUTHOR);
  assert.equal(third.pendingFeedbackCount, 1);
  assert.throws(function () {
    store.review(entry.ref, { commentId: third.comments[2].id, action: "decline" }, SESSION_AUTHOR);
  }, /requires a response/);
  // A comment is settled once, permanently.
  assert.throws(function () {
    store.review(entry.ref, { commentId: commentId, action: "decline", response: "again" }, SESSION_AUTHOR);
  }, /already been reviewed/);
  assert.throws(function () {
    store.review(entry.ref, { commentId: "nope", action: "decline", response: "x" }, SESSION_AUTHOR);
  }, /Comment not found/);
  assert.throws(function () {
    store.review(entry.ref, { commentId: commentId, action: "obey", response: "x" }, SESSION_AUTHOR);
  }, /review action is required/);
});

test("incorporating writes exactly one revision that also resolves the comment", function () {
  var store = newStore("incorporate");
  var entry = store.create({ kind: "decision", title: "Adopt X", summary: "Chose X." }, SESSION_AUTHOR);
  var commentId = store.comment(entry.ref, { body: "Summary omits Y." }, OTHER_AUTHOR).comments[0].id;
  var before = fs.readFileSync(store.filePath, "utf8").trim().split("\n").length;

  var result = store.review(entry.ref, {
    commentId: commentId, action: "incorporate",
    response: "Good catch, added Y.", summary: "Chose X, noting Y.",
  }, SESSION_AUTHOR);

  var after = fs.readFileSync(store.filePath, "utf8").trim().split("\n").length;
  assert.equal(after - before, 1, "exactly one record is appended, so the two can never drift");
  assert.equal(result.revisions, 2, "and it counts as exactly one revision");
  assert.equal(result.summary, "Chose X, noting Y.");
  assert.equal(result.comments[0].status, "incorporated");
  assert.equal(result.comments[0].review.revision, 2, "the comment points at the revision it produced");
  assert.equal(result.comments[0].author.userId, "u2", "the commenter keeps their attribution");
  assert.equal(result.updatedBy.type, "session", "the canonical author is the Driver");
  assert.equal(result.pendingFeedbackCount, 0);

  var history = store.history(entry.ref, {});
  assert.deepEqual(history.revisions.map(function (r) { return r.op; }), ["create", "incorporate"]);
  assert.equal(history.revisions[1].commentId, commentId);

  // Incorporating must actually change the record.
  var idle = store.comment(entry.ref, { body: "No change needed." }, OTHER_AUTHOR).comments[1].id;
  assert.throws(function () {
    store.review(entry.ref, { commentId: idle, action: "incorporate", response: "ok" }, SESSION_AUTHOR);
  }, /requires an actual canonical change/);
});

test("every new canonical edit stores a complete snapshot", function () {
  var store = newStore("snapshots");
  var entry = store.create({ kind: "decision", title: "T1", summary: "S1", body: "B1", tags: ["a"] }, SESSION_AUTHOR);
  store.update(entry.ref, { title: "T2" }, SESSION_AUTHOR);
  store.link(entry.ref, [{ ref: "session:abc" }], SESSION_AUTHOR);

  var lines = fs.readFileSync(store.filePath, "utf8").trim().split("\n").map(JSON.parse);
  for (var i = 0; i < lines.length; i++) {
    if (["create", "update", "link"].indexOf(lines[i].op) === -1) continue;
    var snapshot = lines[i].snapshot;
    assert.ok(snapshot, lines[i].op + " carries a snapshot");
    ["category", "priority", "title", "summary", "body", "tags", "links"].forEach(function (field) {
      assert.notEqual(snapshot[field], undefined, lines[i].op + " snapshot has " + field);
    });
  }
  // A later revision's snapshot carries fields it did not itself change.
  var linkRecord = lines.filter(function (l) { return l.op === "link"; })[0];
  assert.equal(linkRecord.snapshot.title, "T2", "the link snapshot still carries the current title");
  assert.equal(linkRecord.snapshot.body, "B1");
  assert.deepEqual(linkRecord.snapshot.tags, ["a"]);
});

test("legacy partial records still reconstruct exactly", function () {
  var base = tmpDir("legacy-rev");
  var store = logsStore.createProjectLogsStore({ root: "/srv/legacy-rev", baseDir: base });
  // Hand-written records in the pre-snapshot shape: create plus a partial update.
  fs.mkdirSync(path.dirname(store.filePath), { recursive: true });
  var create = { v: 1, id: "l1", rootId: "l1", op: "create", kind: "decision", title: "Old title", summary: "Old summary.", body: "Old body", tags: ["x"], author: { type: "session", sessionKey: "cli-old" }, at: 1700000000000 };
  var update = { v: 1, id: "l2", rootId: "l1", op: "update", title: "Newer title", author: { type: "session", sessionKey: "cli-old" }, at: 1700000001000 };
  fs.appendFileSync(store.filePath, JSON.stringify(create) + "\n" + JSON.stringify(update) + "\n");

  var reopened = logsStore.createProjectLogsStore({ root: "/srv/legacy-rev", baseDir: base });
  var entry = reopened.list({}).entries[0];
  assert.equal(entry.title, "Newer title");
  assert.equal(entry.revisions, 2);

  var first = reopened.readRevision(entry.ref, 1);
  assert.equal(first.snapshot.title, "Old title", "revision 1 reconstructs from the partial chain");
  assert.equal(first.snapshot.body, "Old body");
  assert.deepEqual(first.snapshot.tags, ["x"]);
  assert.equal(first.reconstructed, true, "and says it was reconstructed rather than stored");

  var second = reopened.readRevision(entry.ref, 2);
  assert.equal(second.snapshot.title, "Newer title");
  assert.equal(second.snapshot.body, "Old body", "an unchanged field carries forward");
  assert.deepEqual(second.changed, ["title"]);

  // Nothing on disk was rewritten.
  var raw = fs.readFileSync(store.filePath, "utf8");
  assert.equal(raw.indexOf('"snapshot"'), -1, "legacy records are left exactly as they were");

  // A new edit on top of a legacy chain does store a snapshot.
  reopened.update(entry.ref, { body: "Fresh body" }, SESSION_AUTHOR);
  var third = reopened.readRevision(entry.ref, 3);
  assert.equal(third.reconstructed, false);
  assert.equal(third.snapshot.title, "Newer title");
  assert.equal(third.snapshot.body, "Fresh body");
});

test("revert appends a new revision and never erases later history", function () {
  var store = newStore("revert");
  var entry = store.create({ kind: "decision", title: "V1", summary: "S1", body: "B1" }, SESSION_AUTHOR);
  store.update(entry.ref, { title: "V2", body: "B2" }, SESSION_AUTHOR);
  store.update(entry.ref, { title: "V3", body: "B3" }, SESSION_AUTHOR);

  var reverted = store.revert(entry.ref, 1, "V2 and V3 were based on a bad measurement.", SESSION_AUTHOR);
  assert.equal(reverted.revisions, 4, "a revert is itself a revision");
  assert.equal(reverted.title, "V1");
  assert.equal(reverted.body, "B1");

  var history = store.history(entry.ref, {});
  assert.deepEqual(history.revisions.map(function (r) { return r.op; }), ["create", "update", "update", "revert"]);
  assert.equal(history.revisions[3].revertedFrom, 1);
  assert.match(history.revisions[3].reason, /bad measurement/);
  // The reverted-away revisions are still readable.
  assert.equal(store.readRevision(entry.ref, 3).snapshot.title, "V3");
  assert.equal(store.readRevision(entry.ref, 2).snapshot.body, "B2");

  // Reverting to the current state is refused as a no-op.
  assert.throws(function () { store.revert(entry.ref, 4, "again", SESSION_AUTHOR); }, /identical to the current one/);
  assert.throws(function () { store.revert(entry.ref, 99, "nope", SESSION_AUTHOR); }, /only 4 revisions/);
  assert.throws(function () { store.revert(entry.ref, 1, "", SESSION_AUTHOR); }, /requires a reason/);
  assert.throws(function () { store.revert(entry.ref, 0, "bad", SESSION_AUTHOR); }, /revision number is required/);

  // A deleted entry cannot be reverted back into existence.
  store.remove(entry.ref, SESSION_AUTHOR);
  assert.throws(function () { store.revert(entry.ref, 1, "resurrect", SESSION_AUTHOR); }, /not found/);
  assert.equal(store.read(entry.ref, false), null, "and it stays deleted");
});

// --- Review-workflow review findings -------------------------------------

test("two incorporations in the same millisecond map to their own revisions", function () {
  var base = tmpDir("same-ms");
  var store = logsStore.createProjectLogsStore({ root: "/srv/same-ms", baseDir: base });
  var entry = store.create({ kind: "decision", title: "V1", summary: "S1" }, SESSION_AUTHOR);
  var first = store.comment(entry.ref, { body: "Fix the title." }, OTHER_AUTHOR).comments[0].id;
  var second = store.comment(entry.ref, { body: "Fix the summary." }, OTHER_AUTHOR).comments[1].id;

  // Hand-write both incorporations sharing one `at`, which is exactly what a
  // timestamp-matching link could not tell apart.
  var chain = fs.readFileSync(store.filePath, "utf8").trim().split("\n").map(JSON.parse);
  var rootId = chain[0].rootId;
  var stamp = 1800000000000;
  function incorporation(id, commentId, snapshot) {
    return JSON.stringify({
      v: 1, id: id, rootId: rootId, op: "review", action: "incorporate",
      commentId: commentId, response: "Done.",
      kind: snapshot.category, priority: snapshot.priority, title: snapshot.title,
      summary: snapshot.summary, body: snapshot.body, tags: snapshot.tags, links: snapshot.links,
      snapshot: snapshot,
      author: { type: "session", sessionKey: "cli-1", vendor: "claude" }, at: stamp,
    });
  }
  var afterFirst = { category: "decision", priority: "normal", title: "V2", summary: "S1", body: "", tags: [], links: [] };
  var afterSecond = { category: "decision", priority: "normal", title: "V2", summary: "S2", body: "", tags: [], links: [] };
  fs.appendFileSync(store.filePath,
    incorporation("inc-a", first, afterFirst) + "\n" + incorporation("inc-b", second, afterSecond) + "\n");

  var reopened = logsStore.createProjectLogsStore({ root: "/srv/same-ms", baseDir: base });
  var read = reopened.read(entry.ref, false);
  assert.equal(read.revisions, 3, "create plus two incorporations");
  assert.equal(read.comments[0].review.revision, 2, "the first comment produced revision 2");
  assert.equal(read.comments[1].review.revision, 3, "the second produced revision 3");
  assert.equal(read.comments[0].review.at, stamp);
  assert.equal(read.comments[1].review.at, stamp, "identical timestamps, distinct revisions");

  // Causal order, not clock order, decides.
  var history = reopened.history(entry.ref, {});
  assert.deepEqual(history.revisions.map(function (r) { return r.commentId; }), [null, first, second]);
});

test("no internal record id escapes through a public shape", function () {
  var store = newStore("no-ids");
  var entry = store.create({ kind: "decision", title: "V1", summary: "S1" }, SESSION_AUTHOR);
  var commentId = store.comment(entry.ref, { body: "A note." }, OTHER_AUTHOR).comments[0].id;
  store.review(entry.ref, { commentId: commentId, action: "incorporate", response: "Done.", summary: "S2" }, SESSION_AUTHOR);

  var revision = store.readRevision(entry.ref, 2);
  assert.equal(revision.sourceRecordId, undefined, "readRevision exposes no source record id");
  var history = store.history(entry.ref, {});
  for (var i = 0; i < history.revisions.length; i++) {
    assert.equal(history.revisions[i].sourceRecordId, undefined, "history exposes no source record id");
  }
  var read = store.read(entry.ref, false);
  for (var j = 0; j < read.history.length; j++) {
    assert.equal(read.history[j].sourceRecordId, undefined);
  }
  // The comment id is the one opaque identifier a caller sees, and it round-trips.
  assert.equal(read.comments[0].id, commentId);
});

test("pending feedback is found on old entries however many newer ones exist", function () {
  var store = newStore("deep-feedback");
  var oldest = store.create({ kind: "decision", title: "The oldest entry", summary: "Written first." }, SESSION_AUTHOR);
  var commentId = store.comment(oldest.ref, { body: "This needs a correction." }, OTHER_AUTHOR).comments[0].id;

  // Well past any page-sized ceiling, and every one of them newer.
  for (var i = 0; i < 60; i++) {
    store.create({ kind: "progress", title: "Later entry " + i, summary: "Filler " + i + "." }, SESSION_AUTHOR);
  }
  assert.ok(store.list({ limit: 50 }).total > 50);
  assert.equal(store.list({ limit: 50 }).entries.filter(function (e) { return e.ref === oldest.ref; }).length, 0,
    "the oldest entry is off the first page");

  var feedback = store.feedback({});
  assert.equal(feedback.total, 1, "the exact total is reported, not a page-limited one");
  assert.equal(feedback.feedback[0].ref, oldest.ref);
  assert.equal(feedback.feedback[0].commentId, commentId);
  assert.equal(feedback.feedback[0].title, "The oldest entry");
  assert.equal(feedback.truncated, false);

  // Totals stay exact past the returned-summary clamp.
  for (var j = 0; j < 40; j++) {
    var extra = store.create({ kind: "idea", title: "Commented " + j, summary: "S." }, SESSION_AUTHOR);
    store.comment(extra.ref, { body: "Note " + j }, OTHER_AUTHOR);
  }
  var many = store.feedback({});
  assert.equal(many.total, 41, "every pending comment is counted");
  assert.equal(many.feedback.length, 25, "while the returned summaries stay clamped");
  assert.equal(many.truncated, true);
  assert.equal(store.feedback({ limit: 5 }).feedback.length, 5);
  assert.equal(store.feedback({ limit: 9999 }).feedback.length, 25, "the clamp is server-side");
  assert.equal(store.feedback({ limit: 5 }).total, 41, "and the total never shrinks with the page");

  // Bodies stay bounded.
  var long = store.create({ kind: "idea", title: "Long", summary: "S." }, SESSION_AUTHOR);
  store.comment(long.ref, { body: "z".repeat(2000) }, OTHER_AUTHOR);
  var bounded = store.feedback({ limit: 25 });
  for (var k = 0; k < bounded.feedback.length; k++) {
    assert.ok(bounded.feedback[k].body.length <= 603, "a feedback body is bounded");
  }
});

test("a clarification leaves the Driver queue and the reply re-enters it once", function () {
  var store = newStore("clarify-flow");
  var entry = store.create({ kind: "decision", title: "V1", summary: "S1" }, SESSION_AUTHOR);
  var first = store.comment(entry.ref, { body: "This looks wrong." }, OTHER_AUTHOR).comments[0].id;
  assert.equal(store.feedback({}).total, 1);

  var clarified = store.review(entry.ref, { commentId: first, action: "clarify", response: "Which part?" }, SESSION_AUTHOR);
  assert.equal(clarified.revisions, 1, "no canonical revision");
  assert.equal(clarified.pendingFeedbackCount, 0);
  assert.equal(store.feedback({}).total, 0, "the Driver queue is empty while the user answers");
  assert.equal(clarified.comments[0].status, "clarification-needed");
  assert.equal(clarified.comments[0].review.response, "Which part?", "the question stays visible");

  // The user answers with a new comment: exactly one new pending item.
  var reply = store.comment(entry.ref, { body: "The summary understates the risk." }, OTHER_AUTHOR);
  assert.equal(reply.pendingFeedbackCount, 1);
  var queue = store.feedback({});
  assert.equal(queue.total, 1);
  assert.equal(queue.feedback[0].commentId, reply.comments[1].id, "the reply, not the answered question");

  // And it can be incorporated once.
  var incorporated = store.review(entry.ref, {
    commentId: reply.comments[1].id, action: "incorporate",
    response: "Raised the risk wording.", summary: "S1, with the risk called out.",
  }, SESSION_AUTHOR);
  assert.equal(incorporated.revisions, 2);
  assert.equal(incorporated.comments[1].status, "incorporated");
  assert.equal(incorporated.comments[1].review.revision, 2);
  assert.equal(incorporated.pendingFeedbackCount, 0);
  assert.equal(store.feedback({}).total, 0);
  // The original clarification is untouched and still never re-enters the queue.
  assert.equal(incorporated.comments[0].status, "clarification-needed");
});

// --- Ledger ordering ------------------------------------------------------

test("the ledger sorts by latest canonical update, and comments never promote", function () {
  var store = newStore("ordering");
  // The store stamps with Date.now(), so distinct revisions need distinct
  // milliseconds for the primary sort to be the thing under test.
  function tick() {
    var start = Date.now();
    while (Date.now() === start) { /* wait out the millisecond */ }
  }

  var alpha = store.create({ kind: "decision", title: "Alpha", summary: "First." }, SESSION_AUTHOR);
  tick();
  var beta = store.create({ kind: "decision", title: "Beta", summary: "Second." }, SESSION_AUTHOR);
  tick();
  var gamma = store.create({ kind: "decision", title: "Gamma", summary: "Third." }, SESSION_AUTHOR);

  function order() {
    return store.list({}).entries.map(function (e) { return e.title; });
  }
  assert.deepEqual(order(), ["Gamma", "Beta", "Alpha"], "newest canonical write first");

  // A canonical revision moves an entry to the top.
  tick();
  store.update(alpha.ref, { body: "Revised." }, SESSION_AUTHOR);
  assert.deepEqual(order(), ["Alpha", "Gamma", "Beta"]);

  tick();
  store.link(beta.ref, [{ ref: "session:abc" }], SESSION_AUTHOR);
  assert.deepEqual(order(), ["Beta", "Alpha", "Gamma"], "a link is a canonical revision");

  // Participation does not, however recent.
  tick();
  var commentId = store.comment(gamma.ref, { body: "A note." }, OTHER_AUTHOR).comments[0].id;
  assert.deepEqual(order(), ["Beta", "Alpha", "Gamma"], "a plain comment does not promote");

  tick();
  store.review(gamma.ref, { commentId: commentId, action: "clarify", response: "Which part?" }, SESSION_AUTHOR);
  assert.deepEqual(order(), ["Beta", "Alpha", "Gamma"], "nor does a clarification");

  tick();
  var declineId = store.comment(gamma.ref, { body: "Another." }, OTHER_AUTHOR).comments[1].id;
  store.review(gamma.ref, { commentId: declineId, action: "decline", response: "Out of scope." }, SESSION_AUTHOR);
  assert.deepEqual(order(), ["Beta", "Alpha", "Gamma"], "nor a decline");

  // Incorporation does, because it is a revision.
  tick();
  var incId = store.comment(gamma.ref, { body: "Summary is thin." }, OTHER_AUTHOR).comments[2].id;
  store.review(gamma.ref, {
    commentId: incId, action: "incorporate", response: "Expanded.", summary: "Third, expanded.",
  }, SESSION_AUTHOR);
  assert.deepEqual(order(), ["Gamma", "Beta", "Alpha"]);

  // So does a revert.
  tick();
  store.revert(alpha.ref, 1, "The revision was premature.", SESSION_AUTHOR);
  assert.deepEqual(order(), ["Alpha", "Gamma", "Beta"]);
});

test("entries written in the same millisecond fall back to a stable ref order", function () {
  var store = newStore("tie-break");

  // The documented contract, stated independently of any locale: newest
  // canonical update first, then UTF-16 code-unit order on the ref.
  function contractOrder(entries) {
    return entries.slice().sort(function (a, b) {
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
    }).map(function (e) { return e.ref; });
  }

  // No ticks between these, so several share a timestamp.
  for (var i = 0; i < 12; i++) {
    store.create({ kind: "decision", title: "Entry " + i, summary: "S." }, SESSION_AUTHOR);
  }

  var listed = store.list({ limit: 50 }).entries;
  assert.equal(listed.length, 12);
  var refs = listed.map(function (e) { return e.ref; });

  // The whole list obeys the contract, whether or not the clock ticked.
  assert.deepEqual(refs, contractOrder(listed), "the list matches the documented total order");
  assert.deepEqual(store.list({ limit: 50 }).entries.map(function (e) { return e.ref; }), refs,
    "and repeating the call is stable");

  // At least one real tie must exist for the tie-break itself to be exercised.
  var byStamp = {};
  for (var j = 0; j < listed.length; j++) {
    var stamp = listed[j].updatedAt;
    if (!byStamp[stamp]) byStamp[stamp] = [];
    byStamp[stamp].push(listed[j].ref);
  }
  var tiedGroups = Object.keys(byStamp).filter(function (k) { return byStamp[k].length > 1; });
  assert.ok(tiedGroups.length > 0, "twelve immediate creates must produce at least one timestamp tie");

  // Every tied group is in code-unit order, which is also plain Array#sort
  // order. These two agreeing is the point: localeCompare does not agree.
  for (var g = 0; g < tiedGroups.length; g++) {
    var group = byStamp[tiedGroups[g]];
    var expected = group.slice().sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    assert.deepEqual(group, expected, "a tied group is ordered by ref code units");
    assert.deepEqual(group, group.slice().sort(), "which is exactly default lexical order");
  }

  // Guard the regression directly: refs are base64url, so "-" and "_" both
  // occur, and those are precisely the characters collation reorders.
  var mixed = ["log:_aaaaaaaaaaaaaaaaaaaaaaa", "log:-aaaaaaaaaaaaaaaaaaaaaaa"];
  var byContract = mixed.slice().sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  assert.deepEqual(byContract, ["log:-aaaaaaaaaaaaaaaaaaaaaaa", "log:_aaaaaaaaaaaaaaaaaaaaaaa"]);
  assert.deepEqual(byContract, mixed.slice().sort(), "the contract is default lexical order");
  assert.deepEqual(logsQuery.compareRefs(mixed[0], mixed[1]) > 0, true,
    "the shared comparator puts \"-\" before \"_\", unlike localeCompare");
});

test("search shares the same locale-independent ref tie-break", function () {
  var store = newStore("tie-break-search");
  for (var i = 0; i < 12; i++) {
    store.create({ kind: "decision", title: "Shared marker " + i, summary: "Shared marker summary." }, SESSION_AUTHOR);
  }
  var hits = store.search({ query: "shared marker", limit: 50 }).results;
  assert.equal(hits.length, 12);

  // Score first, then recency, then the same code-unit ref order.
  var expected = hits.slice().sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
  }).map(function (e) { return e.ref; });
  assert.deepEqual(hits.map(function (e) { return e.ref; }), expected,
    "search obeys the same documented total order as the list");
  assert.deepEqual(store.search({ query: "shared marker", limit: 50 }).results.map(function (e) { return e.ref; }),
    expected, "and is stable across calls");
});
