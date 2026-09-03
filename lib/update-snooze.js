// Update-notification capability and snooze policy.
//
// Two concerns that belong together because both decide whether a given
// connection may be told that a new version exists:
//
//   1. Capability. Update version metadata and update actions are
//      admin-grade. In multi-user mode that means an authenticated user whose
//      role is "admin"; a connection with no identity is refused. A
//      single-user install has no user records at all by design, and its sole
//      local operator is the owner, so it is admin-grade. This is the one
//      canonical check; do not re-derive it anywhere else.
//
//   2. Snooze. A per-user, per-version deadline stored on the server so it
//      survives reloads and applies on every device. Snoozing 4.1.0 says
//      nothing about 4.2.0, so a newer release notifies immediately.
//
// The store is a small JSON file under CONFIG_DIR rather than the users
// record, because a single-user install has no users record to write to and
// the same policy has to work in both modes.

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var config = require("./config");

var STORE_VERSION = 1;
var STORE_FILE = "update-snooze.json";

// Requested durations are chosen from this allowlist by key. A duration is
// never read as a number from the payload, and a deadline is never read from
// the payload at all: the server computes every instant itself.
var SNOOZE_OPTIONS = {
  "3h": { label: "3 hours", ms: 3 * 60 * 60 * 1000 },
  "8h": { label: "8 hours", ms: 8 * 60 * 60 * 1000 },
  "tomorrow": { label: "Tomorrow", tomorrow: true },
};

// "Tomorrow" means the next calendar day at 09:00 local time, so at 23:00 it
// is 10 hours away and at 00:30 it is 32.5 hours away. That upper bound plus
// headroom is the hard server-side maximum: whatever timezone a client claims,
// the stored deadline is clamped to it.
var TOMORROW_HOUR = 9;
var MAX_SNOOZE_MS = 36 * 60 * 60 * 1000;

// A UTC offset outside real-world bounds is refused rather than clamped, so a
// malformed hint falls back to server local time instead of silently skewing.
var MIN_TZ_OFFSET_MINUTES = -14 * 60;
var MAX_TZ_OFFSET_MINUTES = 14 * 60;

// The key a single-user install stores its snooze under. It is a server-side
// constant, never a value a client can supply.
var LOCAL_USER_KEY = "__local__";

function storePath() {
  return path.join(config.CONFIG_DIR, STORE_FILE);
}

function emptyStore() {
  return { version: STORE_VERSION, users: {} };
}

function loadStore() {
  var raw;
  try {
    raw = fs.readFileSync(storePath(), "utf8");
  } catch (e) {
    return emptyStore();
  }
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // A torn or hand-edited file must not break update notifications; it just
    // means nothing is snoozed.
    return emptyStore();
  }
  if (!parsed || typeof parsed !== "object" || !parsed.users || typeof parsed.users !== "object") {
    return emptyStore();
  }
  return { version: STORE_VERSION, users: parsed.users };
}

// A per-writer temp name. A shared ".tmp" would let two concurrent writers
// scribble over each other's half-written file and then rename it into place,
// publishing a mix of both.
var tmpCounter = 0;

function saveStore(store) {
  try {
    config.ensureConfigDir();
  } catch (e) {}
  var target = storePath();
  tmpCounter++;
  var tmp = target + "." + process.pid + "-" + tmpCounter + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) {}
    return false;
  }
}

// --- Write serialization --------------------------------------------------
//
// One user's snooze must never erase another's. Node's synchronous I/O already
// serializes writers inside a process, but two daemons can share a CLAY_HOME,
// so read-modify-write is done under an exclusive lock file and the store is
// re-read inside that lock. That makes each mutation a merge into whatever is
// currently on disk rather than an overwrite with a stale snapshot.
//
// Follows the `fs.openSync(path, "wx")` convention already used for the Mate
// knowledge migration lock, with a short bounded wait because these writes are
// tiny and rare (a person clicking Snooze).
//
// A live holder always wins, however old its lock is: a daemon paused under a
// debugger is still holding the store, and stealing from it would let two
// writers merge against the same snapshot. Age alone can only reclaim a lock
// whose holder is confirmed dead or cannot be identified at all.

var LOCK_RETRIES = 25;
var LOCK_WAIT_MS = 2;
var LOCK_STALE_MS = 5000;

function lockPath() {
  return storePath() + ".lock";
}

function sleepBriefly(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (e) {
    // Without SharedArrayBuffer the retry loop simply spins; it is bounded.
  }
}

// Delegates to the shared helper, whose contract is exactly what this lock
// needs: a positive-integer pid, EPERM counted as alive (a second daemon run
// by another user still holds the store), ESRCH as the only dead, and any
// unanswerable error as alive. Erring towards "alive" is the safe direction
// here too: the worst case is refusing to write, never stealing a live lock.
function isHolderAlive(pid) {
  return config.isPidAlive(pid);
}

function readHolder(target) {
  var raw;
  try {
    raw = fs.readFileSync(target, "utf8");
  } catch (e) {
    return null;
  }
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { pid: null, nonce: null, startedAt: 0 };
  }
  if (!parsed || typeof parsed !== "object") return { pid: null, nonce: null, startedAt: 0 };
  return {
    pid: typeof parsed.pid === "number" ? parsed.pid : null,
    nonce: typeof parsed.nonce === "string" ? parsed.nonce : null,
    startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
  };
}

// The nonce is what makes release safe. A pid alone cannot distinguish our own
// lock from a successor's lock written by a recycled pid, so every acquisition
// stamps a fresh random nonce and release only unlinks a file that still
// carries it.
function writeLock(target) {
  var nonce = crypto.randomBytes(12).toString("hex");
  var payload = JSON.stringify({ pid: process.pid, nonce: nonce, startedAt: Date.now() }) + "\n";
  var fd = fs.openSync(target, "wx");
  try {
    fs.writeSync(fd, Buffer.from(payload, "utf8"));
  } finally {
    fs.closeSync(fd);
  }
  return { path: target, pid: process.pid, nonce: nonce };
}

function acquireLock() {
  var target = lockPath();
  for (var attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      return writeLock(target);
    } catch (e) {
      if (!e || e.code !== "EEXIST") return null;
    }

    var holder = readHolder(target);
    if (!holder) continue; // vanished between open and read: try again

    if (holder.pid !== null) {
      // An identifiable holder is only ever reclaimed once it is confirmed
      // dead. Age is irrelevant. A recycled pid can therefore only make us
      // wait and ultimately refuse the write, never double-enter.
      if (isHolderAlive(holder.pid)) {
        sleepBriefly(LOCK_WAIT_MS);
        continue;
      }
    } else {
      // No identifiable holder: reclaim only once unambiguously abandoned.
      // The recorded stamp is preferred over mtime, which anything can touch;
      // an unparseable lock has no stamp, so mtime is the only clock left.
      var stamp = holder.startedAt;
      if (!stamp) {
        try { stamp = fs.statSync(target).mtimeMs; } catch (e2) { stamp = 0; }
      }
      var age = Date.now() - stamp;
      // A future stamp (clock skew, or a hostile value) must not wedge the
      // lock forever; it simply starts ageing from now.
      if (age < 0) age = 0;
      if (age < LOCK_STALE_MS) {
        sleepBriefly(LOCK_WAIT_MS);
        continue;
      }
    }

    // Reclaim, then loop so the exclusive create decides the winner rather
    // than this process assuming it won the race.
    try { fs.unlinkSync(target); } catch (e3) {}
  }
  return null;
}

// Only unlink a lock this call still owns. If the file now carries a different
// pid or nonce, ownership changed while we held it and the file belongs to a
// successor, so removing it would release someone else's lock.
function releaseLock(token) {
  if (!token || !token.path) return;
  var holder = readHolder(token.path);
  if (!holder) return;
  if (holder.pid !== token.pid || holder.nonce !== token.nonce) return;
  try { fs.unlinkSync(token.path); } catch (e) {}
}

// Apply `mutator` to the store under the lock. The mutator receives the store
// as it exists on disk right now and mutates it in place; returning false means
// "nothing changed", so no write happens.
function mutate(mutator) {
  try {
    config.ensureConfigDir();
  } catch (e) {}
  var lock = acquireLock();
  if (!lock) return false;
  try {
    var store = loadStore();
    if (mutator(store) === false) return true;
    return saveStore(store);
  } catch (e) {
    return false;
  } finally {
    releaseLock(lock);
  }
}

// --- Capability -----------------------------------------------------------

// The canonical admin-grade check for everything update-related: delivery of
// version metadata, the snooze action, manual checks, channel changes, and
// installing.
//
// `conn._clayUser` is a snapshot taken when the socket was opened and can be
// arbitrarily stale: a user demoted or deleted mid-session still carries
// role "admin" on their live connection. So the snapshot is only used for its
// id, and the role is re-resolved from the authoritative users store on every
// delivery and every action. Both must independently say "admin"; a missing
// record, a throwing store, or any disagreement between the two is a denial.
function isUpdateAdmin(conn, usersModule) {
  if (!conn) return false;
  var multiUser = false;
  try {
    multiUser = !!(usersModule && typeof usersModule.isMultiUser === "function" && usersModule.isMultiUser());
  } catch (e) {
    // An unreadable users record must not be treated as "no restrictions".
    return false;
  }
  if (!multiUser) return true;

  var user = conn._clayUser;
  if (!user || !user.id || user.role !== "admin") return false;
  if (!usersModule || typeof usersModule.findUserById !== "function") return false;

  var live;
  try {
    live = usersModule.findUserById(user.id);
  } catch (e) {
    return false;
  }
  // Deleted between connect and now, or demoted since.
  if (!live || live.role !== "admin") return false;
  return true;
}

// The storage key for a connection. Returns null when multi-user mode cannot
// attribute the connection, so callers persist nothing rather than guessing.
// Identity is always read from the connection, never from a message payload.
function userKeyFor(conn, usersModule) {
  if (!isUpdateAdmin(conn, usersModule)) return null;
  var multiUser = false;
  try {
    multiUser = !!(usersModule && typeof usersModule.isMultiUser === "function" && usersModule.isMultiUser());
  } catch (e) {
    return null;
  }
  if (!multiUser) return LOCAL_USER_KEY;
  var user = conn._clayUser;
  if (!user || !user.id) return null;
  return String(user.id);
}

// --- Deadlines ------------------------------------------------------------

function isValidTzOffset(value) {
  return typeof value === "number" && isFinite(value) &&
    Math.floor(value) === value &&
    value >= MIN_TZ_OFFSET_MINUTES && value <= MAX_TZ_OFFSET_MINUTES;
}

// Next calendar day at TOMORROW_HOUR, in the zone described by a UTC offset in
// minutes east of UTC, expressed as a UTC instant. With no usable offset the
// server's own local time is used, which is the safe default because it is the
// only clock the server can vouch for.
function nextLocalMorning(nowMs, tzOffsetMinutes) {
  if (!isValidTzOffset(tzOffsetMinutes)) {
    var local = new Date(nowMs);
    var serverTarget = new Date(local.getFullYear(), local.getMonth(), local.getDate() + 1, TOMORROW_HOUR, 0, 0, 0);
    return serverTarget.getTime();
  }
  var offsetMs = tzOffsetMinutes * 60 * 1000;
  // Shift into the target zone, take the calendar date there, then shift back.
  var shifted = new Date(nowMs + offsetMs);
  var midnightNextDayUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    TOMORROW_HOUR, 0, 0, 0
  );
  return midnightNextDayUtc - offsetMs;
}

// Resolve an allowlisted duration key to a UTC deadline, clamped to the
// server-side maximum. Returns null for anything not on the allowlist.
function resolveDeadline(durationKey, nowMs, tzOffsetMinutes) {
  if (typeof durationKey !== "string") return null;
  var option = Object.prototype.hasOwnProperty.call(SNOOZE_OPTIONS, durationKey)
    ? SNOOZE_OPTIONS[durationKey]
    : null;
  if (!option) return null;
  var until = option.tomorrow
    ? nextLocalMorning(nowMs, tzOffsetMinutes)
    : nowMs + option.ms;
  if (!isFinite(until)) return null;
  if (until <= nowMs) return null;
  if (until > nowMs + MAX_SNOOZE_MS) until = nowMs + MAX_SNOOZE_MS;
  return until;
}

// --- Store operations ----------------------------------------------------

function readRecord(userKey) {
  if (!userKey) return null;
  var store = loadStore();
  var record = store.users[userKey];
  if (!record || typeof record !== "object") return null;
  var until = typeof record.until === "number" && isFinite(record.until) ? record.until : 0;
  var version = typeof record.version === "string" ? record.version : "";
  if (!until || !version) return null;
  return { version: version, until: until };
}

// Touches exactly one user's entry and leaves every other entry as found on
// disk, so two users snoozing at the same moment both survive.
function writeRecord(userKey, record) {
  if (!userKey) return false;
  return mutate(function (store) {
    if (record) store.users[userKey] = { version: record.version, until: record.until };
    else if (Object.prototype.hasOwnProperty.call(store.users, userKey)) delete store.users[userKey];
    else return false;
  });
}

// Whether this user is currently snoozing exactly this version. A snooze for a
// different version never suppresses a newer one, and an expired snooze never
// suppresses anything.
function isSnoozed(userKey, version, nowMs) {
  if (!userKey || !version) return false;
  var record = readRecord(userKey);
  if (!record) return false;
  if (record.version !== version) return false;
  return record.until > nowMs;
}

// Record a snooze. `version` is the server's authoritative latest version; a
// version named in a client payload is never used.
function snooze(userKey, version, durationKey, nowMs, tzOffsetMinutes) {
  if (!userKey) return { ok: false, error: "no_identity" };
  if (typeof version !== "string" || !version) return { ok: false, error: "no_update" };
  var until = resolveDeadline(durationKey, nowMs, tzOffsetMinutes);
  if (!until) return { ok: false, error: "invalid_duration" };
  if (!writeRecord(userKey, { version: version, until: until })) {
    return { ok: false, error: "not_persisted" };
  }
  return { ok: true, version: version, until: until, duration: durationKey };
}

// Drop any snooze for this user. Used when the user re-engages deliberately:
// a manual update check, or installing.
function clearSnooze(userKey) {
  if (!userKey) return false;
  // Delegates straight to the locked mutation rather than checking first and
  // writing after; the check-then-write pair was itself a race.
  return writeRecord(userKey, null);
}

module.exports = {
  LOCAL_USER_KEY: LOCAL_USER_KEY,
  LOCK_STALE_MS: LOCK_STALE_MS,
  acquireLock: acquireLock,
  isHolderAlive: isHolderAlive,
  lockPath: lockPath,
  releaseLock: releaseLock,
  MAX_SNOOZE_MS: MAX_SNOOZE_MS,
  SNOOZE_OPTIONS: SNOOZE_OPTIONS,
  TOMORROW_HOUR: TOMORROW_HOUR,
  clearSnooze: clearSnooze,
  isSnoozed: isSnoozed,
  isUpdateAdmin: isUpdateAdmin,
  readRecord: readRecord,
  resolveDeadline: resolveDeadline,
  snooze: snooze,
  storePath: storePath,
  userKeyFor: userKeyFor,
};
