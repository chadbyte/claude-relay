var test = require("node:test");
var assert = require("node:assert");
var attachFilesystem = require("../lib/project-filesystem").attachFilesystem;
var validateEnvString = require("../lib/runtime-env").validateEnvString;

function createFilesystem(overrides) {
  overrides = overrides || {};
  return attachFilesystem({
    cwd: process.cwd(),
    slug: "alpha",
    osUsers: null,
    sm: { sessions: new Map() },
    send: function() {},
    sendTo: overrides.sendTo || function() {},
    safePath: function() { return null; },
    safeAbsPath: function() { return null; },
    getOsUserInfoForWs: function() { return null; },
    startFileWatch: function() {},
    stopFileWatch: function() {},
    startDirWatch: function() {},
    usersModule: { getEffectivePermissions: function() { return { projectSettings: true }; } },
    fsAsUser: function() {},
    validateEnvString: validateEnvString,
    onEnvironmentChanged: overrides.onEnvironmentChanged || function() {},
    opts: overrides.opts || {},
    IGNORED_DIRS: new Set(),
    BINARY_EXTS: new Set(),
    IMAGE_EXTS: new Set(),
    FS_MAX_SIZE: 1024,
  });
}

test("saved project environment refreshes runtime only after validated persistence", function() {
  var saved = null;
  var refreshes = 0;
  var response = null;
  var filesystem = createFilesystem({
    sendTo: function(ws, msg) { response = msg; },
    onEnvironmentChanged: function() { refreshes++; },
    opts: { onSetProjectEnv: function(slug, envrc) { saved = { slug: slug, envrc: envrc }; return { ok: true }; } },
  });

  filesystem.handleFilesystemMessage({}, { type: "set_project_env", slug: "alpha", envrc: "export PROJECT_TOKEN=value" });
  assert.deepStrictEqual(saved, { slug: "alpha", envrc: "export PROJECT_TOKEN=value" });
  assert.strictEqual(refreshes, 1);
  assert.strictEqual(response.ok, true);
  assert.match(response.timing, /newly created coding-agent processes/);
});

test("invalid shared environment does not persist or refresh runtime", function() {
  var saves = 0;
  var refreshes = 0;
  var response = null;
  var filesystem = createFilesystem({
    sendTo: function(ws, msg) { response = msg; },
    onEnvironmentChanged: function() { refreshes++; },
    opts: { onSetSharedEnv: function() { saves++; return { ok: true }; } },
  });

  filesystem.handleFilesystemMessage({}, { type: "set_shared_env", envrc: "TOKEN=$(command)" });
  assert.strictEqual(saves, 0);
  assert.strictEqual(refreshes, 0);
  assert.strictEqual(response.ok, false);
  assert.match(response.error, /Unsupported executable syntax/);
});
