var test = require("node:test");
var assert = require("node:assert");

var { createCodexAdapter } = require("../lib/yoke/adapters/codex");

function fakeUserInfo(username) {
  return {
    uid: username === "alice" ? 1201 : 1202,
    gid: username === "alice" ? 1301 : 1302,
    home: "/home/" + username,
    user: username,
    shell: "/bin/bash",
  };
}

function createFakeServer(options) {
  return {
    options: options,
    started: false,
    proc: null,
    start: function() {
      this.started = true;
      return Promise.resolve();
    },
    send: function(method) {
      if (method === "skills/list") return Promise.resolve({ data: [] });
      return Promise.resolve({});
    },
    notify: function() {},
    stop: function() { this.started = false; },
  };
}

test("Codex creates and reuses a separate app-server for each mapped Linux user", async function() {
  var servers = [];
  var adapter = createCodexAdapter({
    cwd: process.cwd(),
    osUsers: true,
    resolveOsUserInfo: fakeUserInfo,
    createAppServer: function(options) {
      var server = createFakeServer(options);
      servers.push(server);
      return server;
    },
  });

  await adapter.init({ linuxUser: "alice" });
  await adapter.init({ linuxUser: "alice" });
  await adapter.init({ linuxUser: "bob" });

  assert.strictEqual(servers.length, 2);
  assert.strictEqual(servers[0].options.osUserInfo.user, "alice");
  assert.strictEqual(servers[1].options.osUserInfo.user, "bob");
  assert.notStrictEqual(servers[0], servers[1]);
});

test("Codex fails closed when OS-user isolation lacks a mapped Linux user", async function() {
  var adapter = createCodexAdapter({
    cwd: process.cwd(),
    osUsers: true,
    resolveOsUserInfo: fakeUserInfo,
    createAppServer: createFakeServer,
  });

  await assert.rejects(
    adapter.init({}),
    /requires a mapped Linux user/
  );
});
