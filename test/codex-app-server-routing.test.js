var test = require("node:test");
var assert = require("node:assert");

var { CodexAppServer, buildSpawnSpec } = require("../lib/yoke/codex-app-server");

function makeServer() {
  var server = new CodexAppServer("/nonexistent/codex", {});
  server.started = true;
  server.proc = { stdin: { write: function() { return true; } } };
  server.written = [];
  server._write = function(msg) { server.written.push(msg); };
  return server;
}

test("routes Codex events to the handler bound to their thread", function() {
  var server = makeServer();
  var seenA = [];
  var seenB = [];
  var handlerA = server.addHandler(function(msg) { seenA.push(msg); });
  var handlerB = server.addHandler(function(msg) { seenB.push(msg); });
  handlerA.threadId = "thread-a";
  handlerB.threadId = "thread-b";

  server._handleMessage({ method: "item/agentMessage/delta", params: { threadId: "thread-a", delta: "hello" } });

  assert.strictEqual(seenA.length, 1);
  assert.strictEqual(seenB.length, 0);
});

test("a temporary query does not steal an existing Codex session handler", function() {
  var server = makeServer();
  var sessionEvents = [];
  var titleEvents = [];
  var sessionHandler = server.addHandler(function(msg) { sessionEvents.push(msg); });
  var titleHandler = server.addHandler(function(msg) { titleEvents.push(msg); });
  sessionHandler.threadId = "session-thread";
  titleHandler.threadId = "title-thread";

  server._handleMessage({ method: "turn/completed", params: { threadId: "session-thread" } });

  assert.strictEqual(sessionEvents.length, 1, "the original session must retain its events");
  assert.strictEqual(titleEvents.length, 0, "the title query must not receive another thread's events");
});

test("removing a temporary handler leaves existing Codex handlers active", function() {
  var server = makeServer();
  var sessionEvents = [];
  var sessionHandler = server.addHandler(function(msg) { sessionEvents.push(msg); });
  var titleHandler = server.addHandler(function() {});
  sessionHandler.threadId = "session-thread";
  titleHandler.threadId = "title-thread";

  server.removeHandler(titleHandler);
  server._handleMessage({ method: "turn/started", params: { threadId: "session-thread" } });

  assert.strictEqual(sessionEvents.length, 1);
  assert.strictEqual(server.handlers.length, 1);
});

test("fans process-wide Codex events out to every active handler", function() {
  var server = makeServer();
  var calls = 0;
  var handlerA = server.addHandler(function() { calls++; });
  var handlerB = server.addHandler(function() { calls++; });
  handlerA.threadId = "thread-a";
  handlerB.threadId = "thread-b";

  server._handleMessage({ method: "error", params: { error: { message: "transport failed" } } });

  assert.strictEqual(calls, 2);
});

test("rejects an unroutable Codex request instead of dropping it", function() {
  var server = makeServer();
  var handler = server.addHandler(function() { assert.fail("should not be called"); });
  handler.threadId = "thread-a";

  server._handleMessage({ id: 7, method: "item/commandExecution/requestApproval", params: { threadId: "missing-thread" } });

  assert.strictEqual(server.written.length, 1);
  assert.strictEqual(server.written[0].id, 7);
  assert.ok(server.written[0].error);
});

test("builds an OS-user Codex spawn without leaking the daemon environment", function() {
  var previousSecret = process.env.CLAY_TEST_DAEMON_SECRET;
  process.env.CLAY_TEST_DAEMON_SECRET = "must-not-leak";
  var wrappedOptions = null;
  try {
    var spec = buildSpawnSpec("/usr/bin/codex", ["app-server"], {
      cwd: "/workspace",
      env: { OPENAI_API_KEY: "user-key" },
      osUserInfo: {
        uid: 1201,
        gid: 1202,
        home: "/home/alice",
        user: "alice",
        shell: "/bin/bash",
      },
    }, function(command, args, options) {
      wrappedOptions = options;
      return { command: command, args: args, options: options };
    });

    assert.strictEqual(spec.command, "/usr/bin/codex");
    assert.strictEqual(wrappedOptions.uid, 1201);
    assert.strictEqual(wrappedOptions.gid, 1202);
    assert.strictEqual(wrappedOptions.env.HOME, "/home/alice");
    assert.strictEqual(wrappedOptions.env.USER, "alice");
    assert.strictEqual(wrappedOptions.env.OPENAI_API_KEY, "user-key");
    assert.strictEqual(wrappedOptions.env.CLAY_TEST_DAEMON_SECRET, undefined);
  } finally {
    if (previousSecret === undefined) delete process.env.CLAY_TEST_DAEMON_SECRET;
    else process.env.CLAY_TEST_DAEMON_SECRET = previousSecret;
  }
});
