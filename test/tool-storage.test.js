var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-tool-storage-test-"));
process.env.CLAY_HOME = testRoot;
var createToolStorage = require("../lib/tool-storage").createToolStorage;

test.after(function () { fs.rmSync(testRoot, { recursive: true, force: true }); });

function ctx(userId) { return { userId: userId, multiUser: true, linuxUser: null }; }

test("tool storage supports put, get, query, list, and delete", async function () {
  var storage = createToolStorage(ctx("roundtrip"), "notes");
  var created = await storage.put({ title: "First", category: "work" });
  assert.strictEqual((await storage.get(created._id)).title, "First");
  assert.strictEqual((await storage.query({ category: "work" })).length, 1);
  assert.strictEqual((await storage.list()).length, 1);
  await storage.delete(created._id);
  assert.strictEqual((await storage.list()).length, 0);
});

test("tool storage rejects documents over 64KB", async function () {
  var storage = createToolStorage(ctx("size-limit"), "large-docs");
  await assert.rejects(storage.put({ value: "x".repeat(70 * 1024) }), /64KB/);
});

test("tool storage scopes data by tool and user", async function () {
  var firstTool = createToolStorage(ctx("owner"), "tool-a");
  var secondTool = createToolStorage(ctx("owner"), "tool-b");
  var otherUser = createToolStorage(ctx("other"), "tool-a");
  await firstTool.put({ value: "private" });
  assert.strictEqual((await firstTool.list()).length, 1);
  assert.strictEqual((await secondTool.list()).length, 0);
  assert.strictEqual((await otherUser.list()).length, 0);
});
