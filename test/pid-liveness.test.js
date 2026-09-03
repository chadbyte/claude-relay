// config.isPidAlive answers one question — does a process with this pid exist
// — and every caller uses the answer to gate a destructive or duplicating
// action. The dangerous direction is a false "dead": it unlinks a live
// daemon's socket, clears its config, and lets a second daemon start beside
// it, or lets a second importer steal the migration lock.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var spawnSync = require("node:child_process").spawnSync;

var root = path.join(__dirname, "..");

function freshConfig(t) {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pid-liveness-"));
  var previous = process.env.CLAY_HOME;
  process.env.CLAY_HOME = home;
  delete require.cache[require.resolve("../lib/config")];
  var config = require("../lib/config");
  t.after(function () {
    if (previous === undefined) delete process.env.CLAY_HOME;
    else process.env.CLAY_HOME = previous;
    delete require.cache[require.resolve("../lib/config")];
    fs.rmSync(home, { recursive: true, force: true });
  });
  return config;
}

// A pid that is definitely gone: run a child to completion and reuse its pid.
function deadPid() {
  return spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" }).pid;
}

// --- The three answers ----------------------------------------------------

test("a signalable process is alive", function (t) {
  var config = freshConfig(t);
  assert.equal(config.isPidAlive(process.pid), true, "our own process");
});

test("ESRCH is the only dead", function (t) {
  var config = freshConfig(t);
  var gone = deadPid();
  // Sanity: the kernel really does report ESRCH for this pid.
  var code = null;
  try { process.kill(gone, 0); } catch (e) { code = e.code; }
  assert.equal(code, "ESRCH", "the fixture pid is genuinely gone");
  assert.equal(config.isPidAlive(gone), false);
});

test("EPERM means the process exists and is reported alive", function (t) {
  var config = freshConfig(t);
  // pid 1 is owned by root, so an unprivileged test process gets EPERM. If the
  // suite runs as root the call simply succeeds; either way the answer must be
  // "alive", because the process exists. This is the regression: it used to
  // report dead here.
  var code = null;
  try { process.kill(1, 0); } catch (e) { code = e.code; }
  assert.ok(code === null || code === "EPERM",
    "pid 1 answers success or EPERM, never ESRCH");
  assert.equal(config.isPidAlive(1), true,
    "existence, not ownership, decides liveness");
});

test("an unanswerable error is treated as alive, never as an invitation to clean up", function (t) {
  var config = freshConfig(t);
  var realKill = process.kill;
  t.after(function () { process.kill = realKill; });

  var codes = ["EINVAL", "EIO", "ENOSYS", undefined, "SOMETHING_NEW"];
  for (var i = 0; i < codes.length; i++) {
    (function (code) {
      process.kill = function () {
        var err = new Error("simulated");
        if (code !== undefined) err.code = code;
        throw err;
      };
      assert.equal(config.isPidAlive(4242), true,
        "error " + String(code) + " fails conservatively towards alive");
    })(codes[i]);
  }

  // ESRCH through the same path still means dead, so the conservative branch
  // has not swallowed the one answer that matters.
  process.kill = function () {
    var err = new Error("no such process");
    err.code = "ESRCH";
    throw err;
  };
  assert.equal(config.isPidAlive(4242), false);
});

// --- Validation -----------------------------------------------------------

test("a pid that is not a positive integer is never a live process", function (t) {
  var config = freshConfig(t);
  var malformed = [0, -1, -process.pid, 1.5, -0.5, NaN, Infinity, -Infinity,
    "1", String(process.pid), "", null, undefined, {}, [], true, false];
  for (var i = 0; i < malformed.length; i++) {
    assert.equal(config.isPidAlive(malformed[i]), false,
      JSON.stringify(malformed[i]) + " is not an identifiable process");
  }
});

test("process-group selectors are refused before reaching the kernel", function (t) {
  var config = freshConfig(t);
  // process.kill(0, 0) and process.kill(-1, 0) target process GROUPS and
  // return success, so an unvalidated 0 or -1 in a config file used to report
  // a running daemon that does not exist.
  var zeroSucceeds = true;
  try { process.kill(0, 0); } catch (e) { zeroSucceeds = false; }
  assert.equal(zeroSucceeds, true, "the kernel really does accept pid 0");
  assert.equal(config.isPidAlive(0), false, "but it is not a daemon");

  // And the validation happens first, so the kernel is never asked at all.
  var realKill = process.kill;
  var asked = false;
  process.kill = function () { asked = true; return realKill.apply(process, arguments); };
  t.after(function () { process.kill = realKill; });
  config.isPidAlive(0);
  config.isPidAlive(-1);
  config.isPidAlive(1.5);
  config.isPidAlive("123");
  assert.equal(asked, false, "malformed input never reaches process.kill");
});

// --- Caller-level regressions --------------------------------------------

test("a foreign-owned live daemon is not cleared and its socket is not unlinked", function (t) {
  var config = freshConfig(t);
  config.ensureConfigDir();

  // A config pointing at a live process we cannot signal (pid 1 stands in for
  // a daemon started by another OS user).
  config.saveConfig({ pid: 1, port: 4711, projects: [] });
  fs.writeFileSync(config.socketPath(), "");
  var socketBefore = fs.readFileSync(config.socketPath());

  var alive = config.isDaemonAlive(config.loadConfig());

  assert.equal(alive, true, "the socket exists and the pid exists, so it is running");
  assert.equal(fs.existsSync(config.socketPath()), true,
    "the live daemon's socket survived; clearing it would break its IPC");
  assert.deepEqual(fs.readFileSync(config.socketPath()), socketBefore);
  assert.equal(config.loadConfig().pid, 1,
    "and its pid is still recorded, so nothing starts a second daemon");
});

test("a genuinely dead daemon is still cleaned up exactly as before", function (t) {
  var config = freshConfig(t);
  config.ensureConfigDir();

  config.saveConfig({ pid: deadPid(), port: 4711, projects: [{ path: "/tmp/p", slug: "p" }] });
  fs.writeFileSync(config.socketPath(), "");

  assert.equal(config.isDaemonAlive(config.loadConfig()), false);
  assert.equal(fs.existsSync(config.socketPath()), false, "the stale socket is removed");
  var after = config.loadConfig();
  assert.equal(after.pid, null, "the stale pid is cleared");
  assert.deepEqual(after.projects, [{ path: "/tmp/p", slug: "p" }],
    "and project settings are preserved, as clearStaleConfig has always done");
});

test("a config with a malformed pid is treated as stale, not as a running daemon", function (t) {
  var config = freshConfig(t);
  config.ensureConfigDir();

  config.saveConfig({ pid: 0, port: 4711, projects: [] });
  fs.writeFileSync(config.socketPath(), "");
  assert.equal(config.isDaemonAlive(config.loadConfig()), false,
    "pid 0 no longer masquerades as a live daemon");

  // A missing pid short-circuits before the liveness check, as before.
  config.saveConfig({ port: 4711, projects: [] });
  assert.equal(config.isDaemonAlive(config.loadConfig()), false);
  assert.equal(config.isDaemonAlive(null), false);
  assert.equal(config.isDaemonAlive({}), false);
});

test("liveness still requires the socket, so a reused pid is not mistaken for a daemon", function (t) {
  var config = freshConfig(t);
  config.ensureConfigDir();

  // The pid exists but no socket does: something else now owns that pid.
  config.saveConfig({ pid: 1, port: 4711, projects: [] });
  try { fs.unlinkSync(config.socketPath()); } catch (e) {}

  assert.equal(config.isDaemonAlive(config.loadConfig()), false,
    "the socket is the real proof of a daemon; the pid only gates cleanup");
  assert.equal(config.loadConfig().pid, 1,
    "and an unproven pid is left alone rather than cleared on a guess");
});

test("the async path agrees with the sync path about a foreign-owned daemon", function (t) {
  var config = freshConfig(t);
  config.ensureConfigDir();
  config.saveConfig({ pid: 1, port: 4711, projects: [] });
  fs.writeFileSync(config.socketPath(), "");

  // Nothing is listening, so the connect fails and the answer is false — but
  // the important part is that the early pid branch did not fire and destroy
  // the socket on the way.
  return config.isDaemonAliveAsync(config.loadConfig()).then(function (alive) {
    assert.equal(alive, false, "no listener, so not reachable");
    assert.equal(fs.existsSync(config.socketPath()), true,
      "and the socket of a process we cannot signal was left intact");
    assert.equal(config.loadConfig().pid, 1);
  });
});

test("the async path still clears a genuinely dead daemon", function (t) {
  var config = freshConfig(t);
  config.ensureConfigDir();
  config.saveConfig({ pid: deadPid(), port: 4711, projects: [] });
  fs.writeFileSync(config.socketPath(), "");

  return config.isDaemonAliveAsync(config.loadConfig()).then(function (alive) {
    assert.equal(alive, false);
    assert.equal(fs.existsSync(config.socketPath()), false);
    assert.equal(config.loadConfig().pid, null);
  });
});

// --- Callers that gate a non-config destructive decision ------------------

var daemonSource = fs.readFileSync(path.join(root, "lib/daemon.js"), "utf8");
var migrationSource = fs.readFileSync(path.join(root, "lib/mate-knowledge-migration.js"), "utf8");
var snoozeSource = fs.readFileSync(path.join(root, "lib/update-snooze.js"), "utf8");
var configSource = fs.readFileSync(path.join(root, "lib/config.js"), "utf8");

test("daemon startup only clears another daemon's config when it is confirmed dead", function () {
  var block = daemonSource.slice(daemonSource.indexOf("// Clean up stale socket/config left by a previously killed daemon"));
  block = block.slice(0, block.indexOf("var ipc = createIPCServer"));
  assert.match(block, /existingConfig\.pid !== process\.pid/,
    "a daemon never evaluates its own pid");
  assert.match(block, /if \(!isPidAlive\(existingConfig\.pid\)\) \{[\s\S]*?clearStaleConfig\(\);/,
    "cleanup is gated on the shared liveness answer");
  // With EPERM now meaning alive, this branch no longer fires for a daemon
  // owned by another user, which is what used to produce two daemons.
});

test("the migration lock is only reclaimed from a holder that is not alive", function () {
  assert.match(migrationSource, /if \(pid && config\.isPidAlive\(pid\)\) return null;/,
    "a live holder always wins");
  assert.match(migrationSource, /A live holder always wins, no matter how long it has been running/,
    "and the rule is stated where it is enforced");
  assert.match(migrationSource, /Age alone can\s*\n\/\/ only reclaim a lock whose holder is gone or unidentifiable/);
});

test("the snooze lock reuses the shared helper rather than keeping its own copy", function () {
  assert.match(snoozeSource, /function isHolderAlive\(pid\) \{\s*\n\s*return config\.isPidAlive\(pid\);\s*\n\}/,
    "one definition of process liveness");
  assert.equal(/process\.kill\(/.test(snoozeSource), false,
    "the duplicate implementation is gone");
  assert.ok(snoozeSource.split("\n").length < 500, "and the module is still under the size limit");
});

test("the shared helper documents that existence is not ownership", function () {
  var fn = configSource.slice(configSource.indexOf("// Does a process with this pid exist?"));
  fn = fn.slice(0, fn.indexOf("\nfunction isDaemonAlive"));
  assert.match(fn, /never ownership/);
  assert.match(fn, /if \(e && e\.code === "ESRCH"\) return false;/,
    "ESRCH is the only dead");
  assert.match(fn, /return true;\s*\n\s*\}\s*\n\}/, "everything else is alive");
  assert.equal(/e\.code === "EPERM"/.test(fn), false,
    "EPERM needs no special case once the default is alive");
});
