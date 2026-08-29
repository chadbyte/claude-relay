var test = require("node:test");
var assert = require("node:assert/strict");
var attachShellCommand = require("../lib/project-shell-command").attachShellCommand;

function createHarness(overrides) {
  var session = { localId: 7 };
  var sent = [];
  var resolveResult;
  var resultPromise = new Promise(function (resolve) { resolveResult = resolve; });
  var ctx = {
    cwd: process.cwd(),
    osUsers: false,
    usersModule: {
      getEffectivePermissions: function () { return { terminal: true }; },
    },
    sendTo: function (ws, message) {
      sent.push(message);
      if (message.type === "shell_command_result") resolveResult(message);
    },
    getSessionForWs: function () { return session; },
    getOsUserInfoForWs: function () { return null; },
  };
  Object.assign(ctx, overrides || {});
  return {
    handler: attachShellCommand(ctx),
    session: session,
    sent: sent,
    result: resultPromise,
  };
}

test("runs a shell command and queues its output for the next agent message", async function () {
  var harness = createHarness();
  var handled = harness.handler.handleShellCommand({}, {
    type: "shell_command",
    requestId: "request-1",
    command: "printf 'hello from shell'",
  });

  assert.equal(handled, true);
  var result = await harness.result;
  assert.equal(result.requestId, "request-1");
  assert.equal(result.sessionId, 7);
  assert.equal(result.output, "hello from shell");
  assert.equal(result.exitCode, 0);
  assert.equal(harness.session.pendingShellContexts.length, 1);
  assert.match(harness.session.pendingShellContexts[0], /\$ printf 'hello from shell'/);
  assert.match(harness.session.pendingShellContexts[0], /hello from shell/);
  assert.match(harness.session.pendingShellContexts[0], /\[Exit code: 0\]/);
});

test("rejects shell commands when terminal permission is disabled", async function () {
  var harness = createHarness({
    usersModule: {
      getEffectivePermissions: function () { return { terminal: false }; },
    },
  });
  var ws = { _clayUser: { id: "user-1" } };

  harness.handler.handleShellCommand(ws, {
    type: "shell_command",
    requestId: "request-2",
    command: "printf blocked",
  });

  var result = await harness.result;
  assert.equal(result.error, "Terminal access is not permitted.");
  assert.equal(harness.session.pendingShellContexts, undefined);
});
