// Automatic upgrade migration: legacy Mate memory and knowledge files into the
// Clay-wide append-only Knowledge backend.
//
// This module owns discovery, the run lock, and versioned state. The actual
// source-to-record work lives in mate-knowledge-sync.js, which is the same code
// the live write-through bridge uses, so a startup import and a post-mutation
// mirror can never disagree about how a source is represented.
//
// Properties this migration guarantees:
//   - Non-destructive. Legacy files are read and never written, renamed, or
//     removed. They stay the live source for the existing read paths.
//   - Idempotent. Every source unit carries a stable import key, so a restart,
//     a partial run, or a deleted state file re-imports nothing.
//   - Overlap-safe. A run lock keeps two daemons from importing at once, and
//     the importer folds away a duplicate even if the lock is bypassed.
//   - Torn-input tolerant. An unparseable journal line is counted and skipped;
//     it never aborts the run.
//   - Honest. A source that cannot be represented is reported as a failure
//     rather than silently truncated or skipped.
//   - Isolated. Each user's Mates land in their own scope, derived from the
//     Mate storage root that already separates users on disk.

var fs = require("fs");
var path = require("path");
var config = require("./config");
var recordStore = require("./knowledge-record-store");
var mateSync = require("./mate-knowledge-sync");

var MIGRATION_NAME = "mate-knowledge";
var MIGRATION_VERSION = 2;
var LOCK_STALE_MS = 10 * 60 * 1000;

function knowledgeRoot() {
  return recordStore.knowledgeRoot();
}

function statePath(baseDir) {
  return path.join(baseDir || knowledgeRoot(), "migration-state.json");
}

function lockPath(baseDir) {
  return path.join(baseDir || knowledgeRoot(), ".mate-migration.lock");
}

function isMateDirName(name) {
  return typeof name === "string" && name.indexOf("mate_") === 0;
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
}

function mateNames(matesRoot) {
  var names = {};
  try {
    var parsed = JSON.parse(fs.readFileSync(path.join(matesRoot, "mates.json"), "utf8"));
    var list = (parsed && parsed.mates) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id) names[list[i].id] = list[i].name || null;
    }
  } catch (e) {
    // A missing or corrupt registry only costs provenance detail.
  }
  return names;
}

function collectFromRoot(matesRoot, out) {
  var names = mateNames(matesRoot);
  var entries = safeReadDir(matesRoot);
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory() || !isMateDirName(entries[i].name)) continue;
    var scope = mateSync.scopeForMateDir(path.join(matesRoot, entries[i].name));
    if (!scope) continue;
    scope.mateName = names[entries[i].name] || null;
    out.push(scope);
  }
}

// Both storage layouts are walked directly rather than through the Mate
// registry, so a Mate whose registry entry is missing or corrupt still gets
// its durable content migrated.
//   single-user:  {CONFIG_DIR}/mates/mate_*
//   multi-user:   {CONFIG_DIR}/mates/{userId}/mate_*
//   OS users:     roots supplied by the caller
function discoverMates(opts) {
  var options = opts || {};
  var out = [];
  var matesHome = options.matesHome || path.join(config.CONFIG_DIR, "mates");
  collectFromRoot(matesHome, out);

  var entries = safeReadDir(matesHome);
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory() || isMateDirName(entries[i].name)) continue;
    collectFromRoot(path.join(matesHome, entries[i].name), out);
  }

  var roots = options.extraRoots || [];
  for (var r = 0; r < roots.length; r++) {
    if (!roots[r] || !roots[r].matesRoot) continue;
    collectFromRoot(roots[r].matesRoot, out);
  }
  return out;
}

// --- Versioned state -------------------------------------------------

// State is a fast-path hint and an audit trail, never the authority. Deleting
// it makes the next run re-scan and import nothing, because the import keys
// already present in the records are what actually decide.
function loadState(baseDir) {
  try {
    var parsed = JSON.parse(fs.readFileSync(statePath(baseDir), "utf8"));
    if (parsed && parsed.version === MIGRATION_VERSION && parsed.scopes) return parsed;
  } catch (e) {}
  return { version: MIGRATION_VERSION, migration: MIGRATION_NAME, scopes: {}, lastRunAt: 0 };
}

function saveState(baseDir, state) {
  var target = statePath(baseDir);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    var temporary = target + ".tmp." + process.pid;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n");
    config.chmodSafe(temporary, 0o600);
    fs.renameSync(temporary, target);
  } catch (e) {
    // A migration that cannot record state still completed its imports.
  }
}

// --- Run lock ---------------------------------------------------------

function writeLock(target) {
  var payload = JSON.stringify({ pid: process.pid, startedAt: Date.now() }) + "\n";
  var fd = fs.openSync(target, "wx");
  try {
    fs.writeSync(fd, Buffer.from(payload, "utf8"));
  } finally {
    fs.closeSync(fd);
  }
  return target;
}

// A live holder always wins, no matter how long it has been running. Stealing
// a lock from a running daemon would let two daemons import at once and would
// let the first one unlink the second one's lock on completion. Age alone can
// only reclaim a lock whose holder is gone or unidentifiable.
function acquireLock(baseDir) {
  var target = lockPath(baseDir);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch (e) {}
  try {
    return writeLock(target);
  } catch (e) {
    if (!e || e.code !== "EEXIST") return null;
  }

  var holder = null;
  try {
    holder = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (e2) {}

  var pid = holder && holder.pid;
  if (pid && config.isPidAlive(pid)) return null;

  // No identifiable holder: only reclaim once it is unambiguously abandoned.
  if (!pid) {
    var age = Date.now() - ((holder && holder.startedAt) || 0);
    if (age < LOCK_STALE_MS) return null;
  }

  try {
    fs.unlinkSync(target);
    return writeLock(target);
  } catch (e3) {
    return null;
  }
}

function releaseLock(target) {
  if (!target) return;
  try { fs.unlinkSync(target); } catch (e) {}
}

// --- Entry point -------------------------------------------------------

function run(opts) {
  var options = opts || {};
  var baseDir = options.baseDir || knowledgeRoot();
  var summary = mateSync.newSummary();
  summary.migration = MIGRATION_NAME;
  summary.version = MIGRATION_VERSION;
  summary.scopes = 0;

  var lock = acquireLock(baseDir);
  if (!lock) {
    summary.skipped = "locked";
    return summary;
  }
  try {
    var mates = discoverMates(options);
    var state = loadState(baseDir);
    for (var i = 0; i < mates.length; i++) {
      var before = summary.failed;
      try {
        mateSync.reconcileMate({
          scope: mates[i],
          mateName: mates[i].mateName,
          baseDir: baseDir,
          actor: { type: "migration" },
          summary: summary,
        });
      } catch (e) {
        summary.failed++;
        summary.errors.push({ scopeId: mates[i].scopeId, message: e.message });
      }
      summary.scopes++;
      state.scopes[mates[i].scopeId] = {
        version: MIGRATION_VERSION,
        mateId: mates[i].mateId,
        userId: mates[i].userId,
        completedAt: Date.now(),
        // A scope with a failure is recorded as incomplete so it is never
        // reported as migrated while a source is missing content.
        complete: summary.failed === before,
      };
    }
    state.lastRunAt = Date.now();
    saveState(baseDir, state);
    return summary;
  } finally {
    releaseLock(lock);
  }
}

// Startup wrapper: never throws, never blocks boot, logs only when it did work
// or when a source could not be represented.
function runAtStartup(opts) {
  var summary;
  try {
    summary = run(opts);
  } catch (e) {
    console.error("[knowledge-migration] Mate knowledge migration failed:", e.message);
    return null;
  }
  if (summary.skipped === "locked") return summary;
  if (summary.created > 0 || summary.revised > 0 || summary.deleted > 0) {
    console.log("[knowledge-migration] Mate knowledge: " + summary.created + " imported, " +
      summary.revised + " revised, " + summary.deleted + " tombstoned, " +
      summary.unchanged + " unchanged across " + summary.scopes + " scope(s)");
  }
  if (summary.failed > 0) {
    console.error("[knowledge-migration] " + summary.failed + " source(s) could not be migrated; " +
      "legacy files remain authoritative. First error: " + (summary.errors[0] && summary.errors[0].message));
  }
  return summary;
}

module.exports = {
  MIGRATION_NAME: MIGRATION_NAME,
  MIGRATION_VERSION: MIGRATION_VERSION,
  LOCK_STALE_MS: LOCK_STALE_MS,
  IDENTITY_FILES: mateSync.IDENTITY_FILES,
  EXCLUDED_FILES: mateSync.EXCLUDED_FILES,
  JOURNAL_KINDS: mateSync.JOURNAL_KINDS,
  ownerKeyForRoot: mateSync.ownerKeyForRoot,
  scopeIdFor: mateSync.scopeIdFor,
  scopeForMateDir: mateSync.scopeForMateDir,
  sourceKindFor: mateSync.sourceKindFor,
  discoverMates: discoverMates,
  statePath: statePath,
  lockPath: lockPath,
  loadState: loadState,
  acquireLock: acquireLock,
  releaseLock: releaseLock,
  run: run,
  runAtStartup: runAtStartup,
};
