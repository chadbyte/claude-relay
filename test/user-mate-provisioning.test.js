var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var spawnSync = require("node:child_process").spawnSync;

test("assigning an OS user provisions built-in Mates in the mapped context", function () {
  var clayHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-user-mates-"));
  var script = [
    "var matesPath = require.resolve('./lib/mates');",
    "var calls = [];",
    "require.cache[matesPath] = { id: matesPath, filename: matesPath, loaded: true, exports: {",
    "  buildMateCtx: function (userId) {",
    "    var users = require('./lib/users');",
    "    var user = users.findUserById(userId);",
    "    return { userId: userId, linuxUser: user && user.linuxUser || null };",
    "  },",
    "  ensureBuiltinMates: function (ctx) { calls.push(ctx); return []; }",
    "} };",
    "var users = require('./lib/users');",
    "users.enableMultiUser();",
    "var created = users.createUserWithoutPin({ username: process.env.USER, displayName: 'New User' });",
    "if (!created.ok) throw new Error(created.error);",
    "var updated = users.updateLinuxUser(created.user.id, process.env.USER);",
    "if (!updated.ok) throw new Error(updated.error);",
    "process.stdout.write(JSON.stringify(calls));",
  ].join("\n");
  var result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.join(__dirname, ".."),
    env: Object.assign({}, process.env, { CLAY_HOME: clayHome }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  var calls = JSON.parse(result.stdout);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].linuxUser, null);
  assert.equal(calls[1].linuxUser, process.env.USER);
});
