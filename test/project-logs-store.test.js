var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var execFileSync = require("child_process").execFileSync;

var recordStore = require("../lib/knowledge-record-store");
var logsStore = require("../lib/project-logs-store");
var knowledgeSearch = require("../lib/knowledge-search");

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
  var created = store.create({ kind: "decision", title: "Use JSONL", body: "Append only.", tags: ["Storage"] }, SESSION_AUTHOR);

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

test("history is a full author blame chain and delete is a tombstone", function () {
  var store = newStore("history");
  var entry = store.create({ kind: "incident", title: "Daemon restart loop" }, SESSION_AUTHOR);
  store.update(entry.ref, { title: "Daemon restart loop (resolved)" }, OTHER_AUTHOR);
  store.link(entry.ref, [{ ref: "session:abc", label: "triage" }], SESSION_AUTHOR);

  var history = store.history(entry.ref, {});
  assert.equal(history.total, 3);
  assert.deepEqual(history.revisions.map(function (r) { return r.op; }), ["create", "update", "link"]);
  assert.deepEqual(history.revisions[1].changed, ["title"]);
  assert.deepEqual(history.revisions[2].changed, ["links"]);
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
    store.create({ kind: i % 2 === 0 ? "decision" : "progress", title: "Entry " + i, body: "shared marker body", tags: ["batch"] }, SESSION_AUTHOR);
  }
  store.create({ kind: "runbook", title: "Restart the daemon", body: "unrelated", tags: ["ops"] }, SESSION_AUTHOR);

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
  assert.equal(store.search({ query: "restart", kind: "runbook" }).total, 1);
  assert.throws(function () { store.search({ query: "" }); }, /query is required/);

  var long = store.create({ kind: "reference", title: "T".repeat(400), body: "B".repeat(logsStore.MAX_BODY_CHARS + 500) }, SESSION_AUTHOR);
  assert.equal(long.title.length, logsStore.MAX_TITLE_CHARS);
  assert.equal(long.body.length, logsStore.MAX_BODY_CHARS);

  assert.throws(function () { store.create({ kind: "gossip", title: "No" }, SESSION_AUTHOR); }, /Unknown log kind/);
  assert.throws(function () { store.create({ kind: "decision", title: "  " }, SESSION_AUTHOR); }, /title is required/);
});

test("a torn trailing line and a malformed line do not break loading", function () {
  var base = tmpDir("torn");
  var first = logsStore.createProjectLogsStore({ root: "/srv/torn", baseDir: base });
  var good = first.create({ kind: "decision", title: "Survives" }, SESSION_AUTHOR);

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

  var stillWritable = third.create({ kind: "progress", title: "After the damage" }, SESSION_AUTHOR);
  assert.equal(third.read(stillWritable.ref, false).title, "After the damage");
  assert.equal(third.list({}).total, 2);
});

test("a second store instance sees appends made through the first", function () {
  var base = tmpDir("concurrent");
  var a = logsStore.createProjectLogsStore({ root: "/srv/shared", baseDir: base });
  var b = logsStore.createProjectLogsStore({ root: "/srv/shared", baseDir: base });

  var fromA = a.create({ kind: "decision", title: "Written by A" }, SESSION_AUTHOR);
  var fromB = b.create({ kind: "decision", title: "Written by B" }, OTHER_AUTHOR);

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

  var fromWorktree = worktree.create({ kind: "session-note", title: "Worktree finding" }, SESSION_AUTHOR);
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
  var dense = store.create({ kind: "decision", title: "Journal storage", body: "append-only journal chosen for durability; the journal replays cleanly", tags: ["storage"] }, SESSION_AUTHOR);
  var passing = store.create({ kind: "progress", title: "Weekly update", body: "one passing mention of the journal", tags: ["status"] }, SESSION_AUTHOR);
  var titled = store.create({ kind: "runbook", title: "Durability drill", body: "unrelated body text", tags: ["ops"] }, SESSION_AUTHOR);
  store.create({ kind: "reference", title: "Typography", body: "nothing relevant here", tags: ["design"] }, SESSION_AUTHOR);
  var tagged = store.create({ kind: "incident", title: "Outage", body: "cause unknown", tags: ["durability"] }, SESSION_AUTHOR);

  var hits = store.search({ query: "journal durability" });
  assert.equal(hits.total, 4, "only matching entries are returned");
  assert.equal(hits.results[0].ref, dense.ref, "the densest match ranks first");
  assert.ok(hits.results[0].score > hits.results[1].score, "BM25 scores are graded, not a flat 3/2/1 count");
  assert.equal(hits.results.filter(function (r) { return r.title === "Typography"; }).length, 0);

  // Response shape is exactly what the protocol already returned.
  var hit = hits.results[0];
  assert.deepEqual(Object.keys(hit).sort(), ["kind", "ref", "score", "snippet", "tags", "title", "updatedAt", "updatedBy"].sort());
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
  var korean = store.create({ kind: "investigation", title: "재고 관리", body: "재고 관리 시스템 설계를 논의했다" }, SESSION_AUTHOR);
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

  var tail = store.create({ kind: "runbook", title: "Long runbook", body: body, tags: ["ops"] }, SESSION_AUTHOR);
  assert.ok(tail.body.indexOf("hexokinase") !== -1, "the needle survived the write-time body cap");
  store.create({ kind: "decision", title: "Unrelated", body: "nothing relevant here", tags: ["misc"] }, SESSION_AUTHOR);

  var hits = store.search({ query: "hexokinase" });
  assert.equal(hits.total, 1, "a tail-only match is findable");
  assert.equal(hits.results[0].ref, tail.ref);
  assert.ok(hits.results[0].snippet.indexOf("hexokinase") !== -1, "the snippet centres on the tail match");
  assert.equal(hits.results.filter(function (r) { return r.ref === tail.ref; }).length, 1, "segments collapse to one result");

  // Response shape is unchanged for a segmented entry.
  assert.deepEqual(Object.keys(hits.results[0]).sort(), ["kind", "ref", "score", "snippet", "tags", "title", "updatedAt", "updatedBy"].sort());
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
