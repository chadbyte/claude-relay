var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var diagnostics = require("../lib/os-user-diagnostics");

test("OS-user diagnostics report missing mappings without provisioning", function() {
  var result = diagnostics.collectOsUserDiagnostics({
    users: [{ id: "missing" }, { id: "gone", linuxUser: "clay-gone" }],
    resolveUser: function() { throw new Error("account not found"); },
    execFile: function() { throw new Error("not installed"); },
  });
  assert.strictEqual(result.setprivAvailable, false);
  assert.strictEqual(result.users[0].mapping, "missing");
  assert.strictEqual(result.users[1].mapping, "unavailable");
  assert.strictEqual(result.users[1].account, "missing");
});

test("OS-user diagnostics only check credential path presence and preserve unknown probes", function() {
  var reads = 0;
  var result = diagnostics.collectOsUserDiagnostics({
    users: [{ id: "alice", linuxUser: "clay-alice" }],
    projects: [{ slug: "legacy", path: "/srv/legacy" }],
    resolveUser: function() { return { home: "/home/clay-alice" }; },
    exists: function(name) { return name === "/home/clay-alice/.codex"; },
    execFile: function(command) {
      if (command === "setpriv") return "";
      if (command === "id") return "users docker\n";
      reads++;
      return "";
    },
  });
  assert.strictEqual(reads, 0);
  assert.deepStrictEqual(result.users[0].supplementaryGroups, ["users", "docker"]);
  assert.deepStrictEqual(result.users[0].credentialPaths.filter(function(item) { return item.present; }).map(function(item) { return item.path; }), ["/home/clay-alice/.codex"]);
  assert.strictEqual(result.projectAccess[0].result, "unknown");
});

test("OS-user diagnostics retain probe errors as evidence", function() {
  var result = diagnostics.collectOsUserDiagnostics({
    users: [{ id: "alice", linuxUser: "clay-alice" }],
    projects: [{ slug: "private" }],
    resolveUser: function() { return { home: "/home/clay-alice" }; },
    exists: function() { return false; },
    execFile: function() { return ""; },
    probeProjectAccess: function() { throw new Error("probe unavailable"); },
  });
  assert.strictEqual(result.projectAccess[0].result, "unknown");
  assert.strictEqual(result.projectAccess[0].evidence, "probe_failed");
});

test("mapped identity project probe is read-only and uses the runtime spawn wrapper", function() {
  var wrapped;
  var result = diagnostics.probeMappedProjectAccess({ slug: "private", path: "/srv/private" }, { id: "alice", linuxUser: "clay-alice" }, {
    resolveUser: function() { return { uid: 1201, gid: 1301 }; },
    wrapSpawn: function(command, args, options) {
      wrapped = { command: command, args: args, options: options };
      return { command: command, args: args, options: options };
    },
    execFile: function(command, args, options) {
      assert.strictEqual(command, process.execPath);
      assert.strictEqual(options.uid, 1201);
      assert.strictEqual(options.gid, 1301);
      assert.match(args[1], /accessSync/);
      assert.doesNotMatch(args[1], /writeFileSync|mkdirSync|appendFileSync/);
      return JSON.stringify({
        read: { status: "allow" },
        traverse: { status: "allow" },
        write: { status: "deny", code: "EACCES" },
      });
    },
  });
  assert.strictEqual(wrapped.options.uid, 1201);
  assert.strictEqual(result.result, "deny");
  assert.strictEqual(result.checks.write.status, "deny");
});

test("mapped identity probe and collection failures remain diagnostic-only", function() {
  var probe = diagnostics.probeMappedProjectAccess({ slug: "private", path: "/srv/private" }, { id: "gone", linuxUser: "clay-gone" }, {
    resolveUser: function() { throw new Error("missing"); },
  });
  assert.strictEqual(probe.result, "unknown");
  assert.strictEqual(probe.evidence, "linux_account_unavailable");

  var result = diagnostics.collectOsUserDiagnostics({
    users: [{ id: "alice", linuxUser: "clay-alice" }],
    projects: [{ slug: "private", path: "/srv/private" }],
    resolveUser: function() { throw new Error("missing"); },
    execFile: function() { throw new Error("unavailable"); },
  });
  assert.strictEqual(result.projectAccess[0].result, "unknown");
  assert.strictEqual(result.projectAccess[0].evidence, "linux_account_unavailable");
});

test("credential and collection probe failures do not throw", function() {
  assert.doesNotThrow(function() {
    var result = diagnostics.collectOsUserDiagnostics({
      users: [{ id: "alice", linuxUser: "clay-alice" }],
      projects: [{ slug: "private", path: "/srv/private" }],
      resolveUser: function() { return { home: "/home/clay-alice", uid: 1201, gid: 1301 }; },
      exists: function() { throw new Error("unavailable"); },
      execFile: function() { throw new Error("unavailable"); },
    });
    assert.strictEqual(result.users[0].credentialPaths[0].present, "unknown");
    assert.strictEqual(result.projectAccess[0].result, "unknown");
  });
});

test("production diagnostics return immediately and run probes in a child process", function() {
  var callbacks = [];
  var handlers = {};
  var logs = [];
  var input;
  var spawnCall;
  var probeCalled = false;
  var child = {
    stdin: { end: function(value) { input = value; } },
    stdout: { on: function(name, callback) { handlers[name] = callback; } },
    once: function(name, callback) { handlers[name] = callback; },
    kill: function() {},
  };
  diagnostics.scheduleOsUserDiagnosticsAsync({
    getUsers: function() { return [{ id: "alice", linuxUser: "clay-alice" }]; },
    getProjects: function() { return [{ slug: "private", path: "/srv/private" }]; },
    execFile: function() { probeCalled = true; throw new Error("must not run in daemon"); },
    timeoutMs: 50,
    schedule: function(callback, delay) {
      callbacks.push({ callback: callback, delay: delay });
      return callbacks.length;
    },
    clearSchedule: function() {},
    spawn: function(command, args, options) {
      spawnCall = { command: command, args: args, options: options };
      return child;
    },
    logger: { log: function(message) { logs.push(message); }, warn: function(message) { logs.push(message); } },
  });
  assert.strictEqual(spawnCall, undefined);
  assert.strictEqual(probeCalled, false);
  assert.strictEqual(callbacks.length, 1);
  callbacks[0].callback();
  assert.strictEqual(probeCalled, false);
  assert.strictEqual(spawnCall.command, process.execPath);
  assert.match(spawnCall.args[0], /os-user-diagnostics-worker\.js$/);
  assert.deepStrictEqual(spawnCall.options.stdio, ["pipe", "pipe", "ignore"]);
  assert.deepStrictEqual(JSON.parse(input), {
    users: [{ id: "alice", linuxUser: "clay-alice" }],
    projects: [{ slug: "private", path: "/srv/private" }],
  });
  assert.strictEqual(callbacks[1].delay, 50);
  handlers.data(JSON.stringify({ summary: "OS-user diagnostics: 1 user mappings, 0 unavailable, 1 project probes, 0 unavailable" }));
  handlers.close(0);
  assert.deepStrictEqual(logs, ["[daemon] OS-user diagnostics: 1 user mappings, 0 unavailable, 1 project probes, 0 unavailable"]);
});

test("production diagnostics child errors and timeouts only log sanitized warnings", function() {
  var callbacks = [];
  var handlers = {};
  var logs = [];
  var killed = false;
  var child = {
    stdin: { end: function() {} },
    stdout: { on: function(name, callback) { handlers[name] = callback; } },
    once: function(name, callback) { handlers[name] = callback; },
    kill: function() { killed = true; },
  };
  diagnostics.scheduleOsUserDiagnosticsAsync({
    users: [],
    projects: [],
    timeoutMs: 10,
    schedule: function(callback, delay) {
      callbacks.push({ callback: callback, delay: delay });
      return callbacks.length;
    },
    clearSchedule: function() {},
    spawn: function() { return child; },
    logger: { log: function(message) { logs.push(message); }, warn: function(message) { logs.push(message); } },
  });
  callbacks[0].callback();
  handlers.error(new Error("sensitive /private/path"));
  assert.deepStrictEqual(logs, ["[daemon] OS-user diagnostics unavailable"]);

  callbacks = [];
  handlers = {};
  logs = [];
  diagnostics.scheduleOsUserDiagnosticsAsync({
    users: [],
    projects: [],
    timeoutMs: 10,
    schedule: function(callback, delay) {
      callbacks.push({ callback: callback, delay: delay });
      return callbacks.length;
    },
    clearSchedule: function() {},
    spawn: function() { return child; },
    logger: { log: function(message) { logs.push(message); }, warn: function(message) { logs.push(message); } },
  });
  callbacks[0].callback();
  callbacks[1].callback();
  assert.strictEqual(killed, true);
  assert.deepStrictEqual(logs, ["[daemon] OS-user diagnostics timed out"]);
});

test("daemon schedules async diagnostics only after listening without a reconciliation API", function() {
  var daemonSource = fs.readFileSync(path.join(__dirname, "..", "lib", "daemon.js"), "utf8");
  var diagnosticsSource = fs.readFileSync(path.join(__dirname, "..", "lib", "os-user-diagnostics.js"), "utf8");
  var scheduleIndex = daemonSource.lastIndexOf("scheduleOsUserDiagnosticsAsync({");
  assert.ok(scheduleIndex > daemonSource.indexOf("relay.server.listen("));
  assert.ok(scheduleIndex > daemonSource.indexOf("console.log(\"[daemon] Startup OS users check complete.\");"));
  assert.doesNotMatch(diagnosticsSource, /writeFileSync|appendFileSync|mkdirSync|saveConfig|provisionAllUsers|grantAllUsersAccess|fingerprint|reconcile/i);
  assert.doesNotMatch(diagnosticsSource, /handleRequest|handleMessage|\/api\//);
});
