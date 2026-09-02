var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

var migration = require("../lib/mate-knowledge-migration");
var knowledgeImport = require("../lib/knowledge-import");

// Durable sources per seeded Mate: memory-summary.md, architecture-notes.md,
// two session-digest lines, one user-observation line. Identity files excluded.
var DURABLE = 5;

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clay-mig-" + label + "-"));
}

function write(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function digest(topic) {
  return JSON.stringify({ date: "2026-04-09", type: "session", topic: topic, my_position: "noted" });
}

// A realistic legacy Mate: identity artifacts alongside durable knowledge.
function seedMate(matesRoot, mateId, extras) {
  var dir = path.join(matesRoot, mateId);
  var knowledge = path.join(dir, "knowledge");
  write(path.join(dir, "CLAUDE.md"), "# Identity\nYou are a systems thinker.\n");
  write(path.join(dir, "mate.yaml"), "name: Arch\n");
  write(path.join(knowledge, "base-template.md"), "# Base template\n");
  write(path.join(knowledge, "identity-backup.md"), "# Identity backup\n");
  write(path.join(knowledge, "identity-history.jsonl"), JSON.stringify({ at: 1, change: "created" }) + "\n");
  write(path.join(knowledge, "sticky-notes.md"), "- [yellow] a sticky note\n");
  write(path.join(knowledge, "memory-summary.md"), "## Summary\nWorked on storage.\n");
  write(path.join(knowledge, "architecture-notes.md"), "# Architecture\nAppend-only wins.\n");
  write(path.join(knowledge, "session-digests.jsonl"), digest("storage design") + "\n" + digest("auth review") + "\n");
  write(path.join(knowledge, "user-observations.jsonl"), JSON.stringify({ date: "2026-04-01", note: "prefers terse output" }) + "\n");
  var names = (extras && extras.names) || { mates: [{ id: mateId, name: "Arch" }] };
  write(path.join(matesRoot, "mates.json"), JSON.stringify(names));
  return { dir: dir, knowledge: knowledge };
}

function fixture(label) {
  var home = tmp(label);
  var matesHome = path.join(home, "mates");
  var baseDir = path.join(home, "knowledge");
  return { home: home, matesHome: matesHome, baseDir: baseDir };
}

function importerFor(f, scopeId) {
  return knowledgeImport.createKnowledgeImporter({ scopeId: scopeId, baseDir: f.baseDir });
}

function scopeOf(f, mateId, userId) {
  var root = userId ? path.join(f.matesHome, userId) : f.matesHome;
  return migration.scopeIdFor(migration.ownerKeyForRoot(root, userId || null), mateId);
}

test("first import maps every durable source and excludes identity files", function () {
  var f = fixture("first");
  seedMate(f.matesHome, "mate_aaa");

  var summary = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(summary.scopes, 1);
  assert.equal(summary.created, DURABLE, "2 markdown files + 2 digest lines + 1 observation");
  assert.equal(summary.identitySkipped, 3, "base template, identity backup, identity history");
  assert.equal(summary.excluded, 1, "sticky notes remain the separate attention layer");
  assert.equal(summary.failed, 0);
  assert.deepEqual(summary.errors, []);

  var entries = importerFor(f, scopeOf(f, "mate_aaa")).entries();
  var byKey = {};
  for (var i = 0; i < entries.length; i++) byKey[entries[i].importKey] = entries[i];

  assert.equal(Object.keys(byKey).length, DURABLE);
  assert.equal(byKey["file:memory-summary.md"].kind, "memory-summary");
  assert.equal(byKey["file:architecture-notes.md"].kind, "knowledge-file");
  assert.match(byKey["file:architecture-notes.md"].content, /Append-only wins/);

  // Identity and sticky notes never appear, under any key.
  for (var k = 0; k < entries.length; k++) {
    assert.doesNotMatch(entries[k].name || "", /identity|base-template|CLAUDE|sticky/i);
    assert.doesNotMatch(entries[k].content, /systems thinker/);
    assert.doesNotMatch(entries[k].content, /a sticky note/);
  }
  assert.equal(byKey["file:sticky-notes.md"], undefined);

  // Journals are line-addressed with one record per line.
  var digests = entries.filter(function (e) { return e.kind === "session-digest"; });
  assert.equal(digests.length, 2);
  assert.equal(entries.filter(function (e) { return e.kind === "user-observation"; }).length, 1);

  // Provenance is sufficient to trace a record back to its exact source, and
  // is relative: the scope already identifies the owner and the Mate.
  var one = digests[0];
  assert.equal(one.source.namespace, "mate-knowledge");
  assert.equal(one.source.mateId, "mate_aaa");
  assert.equal(one.source.mateName, "Arch");
  assert.equal(one.source.fileName, "session-digests.jsonl");
  assert.equal(one.source.relPath, "knowledge/session-digests.jsonl");
  assert.equal(one.source.path, undefined, "no absolute path is persisted");
  assert.equal(typeof one.source.lineIndex, "number");
  assert.equal(one.source.sourceDate, "2026-04-09");
  assert.ok(one.source.sourceModifiedAt > 0);
  assert.equal(one.actor.type, "migration", "the migration is recorded as the actor");
  for (var p = 0; p < entries.length; p++) {
    assert.equal(JSON.stringify(entries[p].source).indexOf(f.home), -1, "no filesystem prefix leaks");
  }

  // File records keep the legacy file's own timestamp.
  var stat = fs.statSync(path.join(f.matesHome, "mate_aaa", "knowledge", "architecture-notes.md"));
  assert.equal(byKey["file:architecture-notes.md"].importedAt, Math.round(stat.mtimeMs));
});

test("re-running across restarts imports nothing and writes no records", function () {
  var f = fixture("idempotent");
  seedMate(f.matesHome, "mate_bbb");

  var first = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(first.created, DURABLE);

  var importer = importerFor(f, scopeOf(f, "mate_bbb"));
  var recordsAfterFirst = importer.stats().records;

  var second = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(second.created, 0);
  assert.equal(second.revised, 0);
  assert.equal(second.unchanged, DURABLE);

  var third = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(third.created, 0);
  assert.equal(third.unchanged, DURABLE);

  assert.equal(importer.stats().records, recordsAfterFirst, "a no-op run appends nothing");
  assert.equal(importer.entries().length, DURABLE);
  assert.equal(importer.stats().duplicates, 0);
});

test("a deleted state file does not cause re-import; records are the authority", function () {
  var f = fixture("state");
  seedMate(f.matesHome, "mate_ccc");
  migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });

  var state = migration.loadState(f.baseDir);
  assert.equal(state.version, migration.MIGRATION_VERSION);
  assert.ok(state.scopes[scopeOf(f, "mate_ccc")], "state records the completed scope");

  fs.unlinkSync(migration.statePath(f.baseDir));
  var afterDelete = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(afterDelete.created, 0, "import keys, not the marker, decide");
  assert.equal(afterDelete.unchanged, DURABLE);

  // A corrupt state file is equally harmless.
  fs.writeFileSync(migration.statePath(f.baseDir), "{ not json");
  var afterCorrupt = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(afterCorrupt.created, 0);
  assert.equal(migration.loadState(f.baseDir).version, migration.MIGRATION_VERSION);
});

test("a changed file revises; a changed journal line is a new deterministic import", function () {
  var f = fixture("changed");
  var seeded = seedMate(f.matesHome, "mate_ddd");
  migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  var importer = importerFor(f, scopeOf(f, "mate_ddd"));

  // File-addressed: same key, new revision, previous revision retained.
  write(path.join(seeded.knowledge, "architecture-notes.md"), "# Architecture\nAppend-only wins, with revisions.\n");
  var changed = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(changed.revised, 1);
  assert.equal(changed.created, 0);
  assert.equal(changed.unchanged, DURABLE - 1);

  var entries = importer.entries();
  assert.equal(entries.length, DURABLE, "a revision does not add an entry");
  var file = entries.filter(function (e) { return e.importKey === "file:architecture-notes.md"; })[0];
  assert.equal(file.revisions, 2);
  assert.match(file.content, /with revisions/);

  // Line-addressed: an appended line is a new record, existing lines are not.
  fs.appendFileSync(path.join(seeded.knowledge, "session-digests.jsonl"), digest("cache eviction") + "\n");
  var appended = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(appended.created, 1);
  assert.equal(appended.unchanged, DURABLE);
  assert.equal(importer.entries().filter(function (e) { return e.kind === "session-digest"; }).length, 3);

  // Rewriting an existing journal line is a new deterministic import for the
  // new content, and the line that vanished is tombstoned rather than left
  // active as a memory the user can no longer see in the legacy store.
  var lines = fs.readFileSync(path.join(seeded.knowledge, "session-digests.jsonl"), "utf8").trim().split("\n");
  lines[0] = digest("storage design, revised");
  fs.writeFileSync(path.join(seeded.knowledge, "session-digests.jsonl"), lines.join("\n") + "\n");
  var edited = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(edited.created, 1);
  assert.equal(edited.revised, 0);
  assert.equal(edited.deleted, 1, "the replaced line is tombstoned");
  var finalDigests = importer.entries().filter(function (e) { return e.kind === "session-digest"; });
  assert.equal(finalDigests.length, 3, "live digests match the legacy file exactly");
  assert.equal(finalDigests.filter(function (e) { return /storage design"/.test(e.content); }).length, 0, "the removed line is no longer live");
  assert.equal(finalDigests.filter(function (e) { return /storage design, revised/.test(e.content); }).length, 1);
  var withDeleted = importer.entries({ includeDeleted: true }).filter(function (e) { return e.kind === "session-digest"; });
  assert.equal(withDeleted.length, 4, "history is retained");
});

test("partial and corrupt journal lines are counted and skipped, never fatal", function () {
  var f = fixture("corrupt");
  var seeded = seedMate(f.matesHome, "mate_eee");
  var journal = path.join(seeded.knowledge, "session-digests.jsonl");
  fs.appendFileSync(journal, "this is not json\n");
  fs.appendFileSync(journal, "[1,2,3]\n");
  fs.appendFileSync(journal, digest("valid after damage") + "\n");
  fs.appendFileSync(journal, "{\"date\":\"2026-05-01\",\"topic\":\"torn");

  var summary = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(summary.failed, 0, "malformed lines must not fail the run");
  assert.equal(summary.malformedLines, 3, "two unparseable lines plus the torn trailing line");
  assert.equal(summary.created, DURABLE + 1, "the valid line after the damage is still imported");

  var digests = importerFor(f, scopeOf(f, "mate_eee")).entries().filter(function (e) { return e.kind === "session-digest"; });
  assert.equal(digests.length, 3);
  assert.equal(digests.filter(function (e) { return /valid after damage/.test(e.content); }).length, 1);

  // An unreadable directory and an empty file are tolerated too.
  var f2 = fixture("empty");
  var seeded2 = seedMate(f2.matesHome, "mate_fff");
  write(path.join(seeded2.knowledge, "blank.md"), "   \n");
  write(path.join(seeded2.knowledge, "notes.txt"), "unsupported extension");
  var summary2 = migration.run({ matesHome: f2.matesHome, baseDir: f2.baseDir });
  assert.equal(summary2.empty, 1);
  assert.equal(summary2.unsupported, 1);
  assert.equal(summary2.failed, 0);
});

test("each user's Mates land in an isolated scope", function () {
  var f = fixture("isolation");
  // Multi-user layout plus a legacy flat Mate in the same root.
  seedMate(path.join(f.matesHome, "user-one"), "mate_shared_id");
  seedMate(path.join(f.matesHome, "user-two"), "mate_shared_id");
  seedMate(f.matesHome, "mate_flat");

  var summary = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(summary.scopes, 3);

  var discovered = migration.discoverMates({ matesHome: f.matesHome });
  var scopes = discovered.map(function (m) { return m.scopeId; });
  assert.equal(new Set(scopes).size, 3, "identical Mate ids under different users do not collide");
  assert.ok(scopes.indexOf(scopeOf(f, "mate_shared_id", "user-one")) !== -1);
  assert.ok(scopes.indexOf(scopeOf(f, "mate_shared_id", "user-two")) !== -1);

  var one = importerFor(f, scopeOf(f, "mate_shared_id", "user-one"));
  var two = importerFor(f, scopeOf(f, "mate_shared_id", "user-two"));
  assert.notEqual(one.filePath, two.filePath, "each scope has its own record file");
  assert.equal(one.entries().length, DURABLE);
  assert.equal(two.entries().length, DURABLE);

  // No record from one user's scope refers to another user's Mate directory.
  var oneEntries = one.entries();
  for (var i = 0; i < oneEntries.length; i++) {
    assert.equal(oneEntries[i].source.ownerKey, migration.ownerKeyForRoot(path.join(f.matesHome, "user-one")));
  }
  var twoEntries = two.entries();
  for (var j = 0; j < twoEntries.length; j++) {
    assert.notEqual(twoEntries[j].source.ownerKey, oneEntries[0].source.ownerKey);
  }

  var flat = importerFor(f, scopeOf(f, "mate_flat"));
  assert.notEqual(flat.filePath, one.filePath);
  assert.notEqual(flat.entries()[0].source.ownerKey, oneEntries[0].source.ownerKey);

  // Under the real per-user layout the owner key stays readable and the user
  // id is recovered for provenance. Path math only; nothing is created.
  var configDir = require("../lib/config").CONFIG_DIR;
  var realUserScope = migration.scopeForMateDir(path.join(configDir, "mates", "user-nine", "mate_zzz"));
  assert.equal(realUserScope.ownerKey, "u-user-nine");
  assert.equal(realUserScope.userId, "user-nine");
  assert.equal(realUserScope.scopeId, "mate/u-user-nine/mate_zzz");
  var realFlatScope = migration.scopeForMateDir(path.join(configDir, "mates", "mate_zzz"));
  assert.equal(realFlatScope.userId, null);
  assert.notEqual(realFlatScope.scopeId, realUserScope.scopeId);
});

test("overlapping runs are serialized by a stale-tolerant lock", function () {
  var f = fixture("lock");
  seedMate(f.matesHome, "mate_ggg");

  // A live holder blocks the run entirely rather than importing concurrently.
  var held = migration.acquireLock(f.baseDir);
  assert.ok(held);
  var blocked = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(blocked.skipped, "locked");
  assert.equal(blocked.created, 0);
  assert.equal(migration.acquireLock(f.baseDir), null, "the lock is exclusive");

  migration.releaseLock(held);
  var afterRelease = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(afterRelease.created, DURABLE);

  // A lock left behind by a dead process is reclaimed.
  fs.writeFileSync(migration.lockPath(f.baseDir), JSON.stringify({ pid: 999999999, startedAt: Date.now() }) + "\n");
  var reclaimed = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.notEqual(reclaimed.skipped, "locked", "a dead holder does not block upgrades forever");
  assert.equal(reclaimed.unchanged, DURABLE);

  assert.equal(fs.existsSync(migration.lockPath(f.baseDir)), false, "the lock is released after a run");
});

test("a lock held by a live process is never stolen, however old it is", function () {
  var f = fixture("live-lock");
  seedMate(f.matesHome, "mate_live");

  // A long-running daemon that is unambiguously alive. Age must not matter:
  // stealing here would let two daemons import at once, and the first to
  // finish would unlink the second's lock and leave the run unprotected.
  var ancient = Date.now() - (100 * migration.LOCK_STALE_MS);
  fs.mkdirSync(f.baseDir, { recursive: true });
  fs.writeFileSync(migration.lockPath(f.baseDir), JSON.stringify({ pid: process.pid, startedAt: ancient }) + "\n");

  assert.equal(migration.acquireLock(f.baseDir), null, "a live holder always wins");
  var blocked = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(blocked.skipped, "locked");
  assert.equal(blocked.created, 0, "no import happens behind a live holder");

  // The live holder's lock file is still exactly as it was written.
  var holder = JSON.parse(fs.readFileSync(migration.lockPath(f.baseDir), "utf8"));
  assert.equal(holder.pid, process.pid);
  assert.equal(holder.startedAt, ancient, "the live holder's lock was not overwritten");

  // Only an unidentifiable holder may be reclaimed on age alone.
  fs.writeFileSync(migration.lockPath(f.baseDir), JSON.stringify({ startedAt: Date.now() }) + "\n");
  assert.equal(migration.acquireLock(f.baseDir), null, "a fresh anonymous lock still blocks");
  fs.writeFileSync(migration.lockPath(f.baseDir), JSON.stringify({ startedAt: ancient }) + "\n");
  var reclaimed = migration.acquireLock(f.baseDir);
  assert.ok(reclaimed, "an abandoned anonymous lock is reclaimed once stale");
  migration.releaseLock(reclaimed);

  // A dead pid is reclaimed regardless of age.
  fs.writeFileSync(migration.lockPath(f.baseDir), JSON.stringify({ pid: 999999999, startedAt: Date.now() }) + "\n");
  var afterDead = migration.acquireLock(f.baseDir);
  assert.ok(afterDead);
  migration.releaseLock(afterDead);
});

test("a duplicate create is folded away even if a lock is bypassed", function () {
  var f = fixture("duplicate");
  var importer = importerFor(f, "mate/h-test/mate_hhh");
  importer.importRecord({ importKey: "file:notes.md", kind: "knowledge-file", name: "notes.md", content: "first" });

  // Simulate two daemons that both decided the key was absent.
  var raw = fs.readFileSync(importer.filePath, "utf8").trim();
  var forged = JSON.parse(raw);
  forged.id = "forged-duplicate";
  forged.rootId = "forged-duplicate";
  fs.appendFileSync(importer.filePath, JSON.stringify(forged) + "\n");

  var fresh = importerFor(f, "mate/h-test/mate_hhh");
  assert.equal(fresh.entries().length, 1, "the projection never double-counts");
  assert.equal(fresh.stats().duplicates, 1, "but the duplicate is visible for diagnosis");
  assert.equal(fresh.importRecord({ importKey: "file:notes.md", kind: "knowledge-file", name: "notes.md", content: "first" }).action, "unchanged");
});

test("legacy files are never modified, moved, or deleted", function () {
  var f = fixture("nondestructive");
  var seeded = seedMate(f.matesHome, "mate_iii");

  function snapshot() {
    var out = {};
    var walk = function (dir) {
      var entries = fs.readdirSync(dir, { withFileTypes: true });
      for (var i = 0; i < entries.length; i++) {
        var full = path.join(dir, entries[i].name);
        if (entries[i].isDirectory()) { walk(full); continue; }
        var stat = fs.statSync(full);
        out[full] = fs.readFileSync(full, "utf8") + "|" + stat.size + "|" + Math.round(stat.mtimeMs);
      }
    };
    walk(f.matesHome);
    return out;
  }

  var before = snapshot();
  migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  var after = snapshot();

  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), "no legacy file added or removed");
  assert.deepEqual(after, before, "no legacy file content or timestamp changed");
  assert.ok(fs.existsSync(path.join(seeded.dir, "CLAUDE.md")), "identity file untouched");
  assert.equal(fs.existsSync(path.join(f.matesHome, "mate_iii", "knowledge", "session-digests.jsonl.migrated")), false);

  // Nothing is written under the Mate storage root at all.
  assert.equal(fs.existsSync(path.join(f.matesHome, "migration-state.json")), false);
  assert.ok(fs.existsSync(migration.statePath(f.baseDir)), "state lives with the new backend");
});

test("discovery ignores non-Mate directories and survives a corrupt registry", function () {
  var f = fixture("discovery");
  seedMate(f.matesHome, "mate_jjj", { names: "not-an-object" });
  fs.mkdirSync(path.join(f.matesHome, "not-a-mate"), { recursive: true });
  fs.writeFileSync(path.join(f.matesHome, "common-knowledge.json"), "[]");
  fs.writeFileSync(path.join(f.matesHome, "mates.json"), "{ corrupt");

  var discovered = migration.discoverMates({ matesHome: f.matesHome });
  var ids = discovered.map(function (m) { return m.mateId; });
  assert.ok(ids.indexOf("mate_jjj") !== -1);
  assert.equal(ids.indexOf("not-a-mate"), -1);
  assert.equal(ids.indexOf("common-knowledge.json"), -1);
  assert.equal(discovered.filter(function (m) { return m.mateId === "mate_jjj"; })[0].mateName, null, "a corrupt registry costs only the name");

  var summary = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(summary.created, DURABLE);
  assert.equal(summary.failed, 0);

  // A missing Mate home is a clean no-op.
  var empty = migration.run({ matesHome: path.join(f.home, "nothing-here"), baseDir: f.baseDir });
  assert.equal(empty.scopes, 0);
  assert.equal(empty.created, 0);
  assert.equal(empty.failed, 0);
});

test("common and shared knowledge pointers are deliberately not migrated", function () {
  var f = fixture("common");
  seedMate(f.matesHome, "mate_kkk");
  fs.writeFileSync(path.join(f.matesHome, "common-knowledge.json"),
    JSON.stringify([{ name: "architecture-notes.md", mateId: "mate_kkk", mateName: "Arch", promotedAt: 1 }]));

  migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  var entries = importerFor(f, scopeOf(f, "mate_kkk")).entries();
  for (var i = 0; i < entries.length; i++) {
    assert.notEqual(entries[i].kind, "common-knowledge");
    assert.doesNotMatch(entries[i].importKey, /common/);
  }
  // The pointer file is left exactly as the existing read path expects it.
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.matesHome, "common-knowledge.json"), "utf8")).length, 1);
});

test("a large legacy source migrates losslessly and is reported honestly", function () {
  var f = fixture("large");
  var seeded = seedMate(f.matesHome, "mate_big");
  var body = "";
  for (var i = 0; i < 5000; i++) body += "# heading " + i + "\nsome \"quoted\" text with é and \\ backslash\n";
  write(path.join(seeded.knowledge, "large-plan.md"), body);
  // A single journal line larger than one record must survive too.
  var fatLine = JSON.stringify({ date: "2026-06-01", topic: "fat", body: new Array(30000).join("z") });
  fs.appendFileSync(path.join(seeded.knowledge, "session-digests.jsonl"), fatLine + "\n");

  var summary = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(summary.failed, 0, "a representable source is never reported as failed");
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.created, DURABLE + 2);
  assert.equal(summary.chunked, 2, "both oversized sources were chunked");

  var importer = importerFor(f, scopeOf(f, "mate_big"));
  var live = importer.entries();
  var big = live.filter(function (e) { return e.name === "large-plan.md"; })[0];
  assert.equal(big.chunked, true);
  assert.equal(big.content, "", "no partial content is presented as the whole source");
  var read = importer.readContent(big);
  assert.equal(read.complete, true);
  assert.equal(read.content, body, "byte-exact reassembly of a large file");

  var fat = live.filter(function (e) { return e.chunked && e.kind === "session-digest"; })[0];
  assert.equal(importer.readContent(fat).content, fatLine, "byte-exact reassembly of a large journal line");

  // Chunk records are internal and never counted as knowledge.
  assert.equal(live.length, DURABLE + 2);
  assert.ok(importer.stats().chunks > 4);

  // Re-running imports nothing and does not re-chunk.
  var again = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(again.created, 0);
  assert.equal(again.unchanged, DURABLE + 2);
  assert.equal(again.failed, 0);
  assert.equal(importer.readContent(importer.entries().filter(function (e) { return e.name === "large-plan.md"; })[0]).content, body);
});

test("a hostile large legacy source migrates losslessly and reports no failure", function () {
  var f = fixture("hostile");
  var seeded = seedMate(f.matesHome, "mate_hostile");
  var NUL = String.fromCharCode(0);
  var controls = "";
  for (var c = 0; c < 32; c++) controls += String.fromCharCode(c);
  var body = "";
  for (var i = 0; i < 900; i++) {
    body += "row " + i + " " + NUL + " ünïcode 漢字 🎉 " + controls + " \\ \" end\n";
  }
  write(path.join(seeded.knowledge, "hostile-plan.md"), body);
  var fatLine = JSON.stringify({ date: "2026-08-01", topic: "n" + NUL + "ul", body: "漢字🎉" + new Array(20000).join("w") });
  fs.appendFileSync(path.join(seeded.knowledge, "session-digests.jsonl"), fatLine + "\n");

  var summary = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(summary.failed, 0, "a representable source is never reported as failed");
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.chunked, 2);
  assert.equal(summary.created, DURABLE + 2);

  var importer = importerFor(f, scopeOf(f, "mate_hostile"));
  var live = importer.entries();
  var big = live.filter(function (e) { return e.name === "hostile-plan.md"; })[0];
  var read = importer.readContent(big);
  assert.equal(read.complete, true);
  assert.equal(read.content, body, "byte-exact reassembly with NUL and astral characters");
  assert.equal(read.content.indexOf(NUL), body.indexOf(NUL));

  var fat = live.filter(function (e) { return e.chunked && e.kind === "session-digest"; })[0];
  var fatRead = importer.readContent(fat);
  assert.equal(fatRead.complete, true);
  assert.equal(fatRead.content, fatLine);
  assert.equal(JSON.parse(fatRead.content).topic, "n" + NUL + "ul");

  // Every stored source verifies against its own content hash.
  var all = importer.entries({ includeChunks: true });
  for (var j = 0; j < all.length; j++) {
    assert.equal(importer.readContent(all[j]).complete, true, all[j].importKey);
  }

  var again = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(again.created, 0);
  assert.equal(again.failed, 0);
  assert.equal(again.unchanged, DURABLE + 2);
});

test("startup reconciles sources deleted while the daemon was stopped", function () {
  var f = fixture("offline-delete");
  var seeded = seedMate(f.matesHome, "mate_offline");

  var first = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(first.created, DURABLE);
  assert.equal(first.deleted, 0);

  var importer = importerFor(f, scopeOf(f, "mate_offline"));
  assert.equal(importer.entries().length, DURABLE);

  // The daemon is not running: a knowledge file and a whole journal are
  // removed by direct filesystem tooling, so no write path ever observes them.
  fs.unlinkSync(path.join(seeded.knowledge, "architecture-notes.md"));
  fs.unlinkSync(path.join(seeded.knowledge, "session-digests.jsonl"));

  var restart = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(restart.deleted, 3, "one file record plus both digest lines");
  assert.equal(restart.created, 0);
  assert.equal(restart.unchanged, 2, "memory summary and observations are untouched");
  assert.equal(restart.failed, 0);

  var live = importer.entries();
  assert.equal(live.length, 2);
  assert.equal(live.filter(function (e) { return e.kind === "session-digest"; }).length, 0);
  assert.equal(live.filter(function (e) { return e.name === "architecture-notes.md"; }).length, 0);
  assert.equal(live.filter(function (e) { return e.kind === "memory-summary"; }).length, 1);
  assert.equal(live.filter(function (e) { return e.kind === "user-observation"; }).length, 1);

  // History is retained and the removal is attributed to the migration.
  var all = importer.entries({ includeDeleted: true });
  assert.equal(all.length, DURABLE);
  var tombstoned = all.filter(function (e) { return e.name === "architecture-notes.md"; })[0];
  assert.equal(tombstoned.deleted, true);
  assert.equal(tombstoned.deletedBy.type, "migration");
  assert.match(tombstoned.content, /Append-only wins/, "the last known content is still readable");

  // A second startup is a no-op.
  var before = importer.stats().records;
  var second = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(second.deleted, 0);
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 2);
  assert.equal(importer.stats().records, before, "an idempotent restart appends nothing");

  // Restoring a source revives its record rather than duplicating it.
  write(path.join(seeded.knowledge, "architecture-notes.md"), "# Architecture\nAppend-only wins.\n");
  var restored = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(restored.revived, 1);
  assert.equal(restored.created, 0);
  assert.equal(importer.entries().length, 3);
  assert.equal(importer.entries().filter(function (e) { return e.name === "architecture-notes.md"; }).length, 1);
});

test("an emptied Mate knowledge directory tombstones everything it had imported", function () {
  var f = fixture("emptied");
  var seeded = seedMate(f.matesHome, "mate_emptied");
  assert.equal(migration.run({ matesHome: f.matesHome, baseDir: f.baseDir }).created, DURABLE);

  var names = fs.readdirSync(seeded.knowledge);
  for (var i = 0; i < names.length; i++) fs.unlinkSync(path.join(seeded.knowledge, names[i]));

  var restart = migration.run({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(restart.deleted, DURABLE, "every imported source is tombstoned");
  assert.equal(restart.failed, 0);

  var importer = importerFor(f, scopeOf(f, "mate_emptied"));
  assert.equal(importer.entries().length, 0);
  assert.equal(importer.entries({ includeDeleted: true }).length, DURABLE, "history is retained");
  assert.equal(migration.run({ matesHome: f.matesHome, baseDir: f.baseDir }).deleted, 0, "idempotent");
});

test("startup wrapper never throws and reports a locked run", function () {
  var f = fixture("startup");
  seedMate(f.matesHome, "mate_lll");
  var summary = migration.runAtStartup({ matesHome: f.matesHome, baseDir: f.baseDir });
  assert.equal(summary.created, DURABLE);

  var held = migration.acquireLock(f.baseDir);
  assert.equal(migration.runAtStartup({ matesHome: f.matesHome, baseDir: f.baseDir }).skipped, "locked");
  migration.releaseLock(held);

  // An unusable base directory is reported, not thrown.
  var blocked = path.join(f.home, "blocked");
  fs.writeFileSync(blocked, "not a directory");
  assert.doesNotThrow(function () {
    migration.runAtStartup({ matesHome: f.matesHome, baseDir: blocked });
  });
});
