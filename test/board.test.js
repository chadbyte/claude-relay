var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-board-test-"));
process.env.CLAY_HOME = testRoot;

var createBoardManager = require("../lib/board").createBoardManager;
var resolveToolsRoot = require("../lib/tools-registry").resolveToolsRoot;

test.after(function () {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function managerFor(userId) {
  return createBoardManager({ userId: userId, multiUser: true, linuxUser: null });
}

test("board create and list roundtrip preserves the card model", async function () {
  var manager = managerFor("roundtrip");
  var created = await manager.create({
    title: "Ship the board",
    body: "Server storage first",
    column: "doing",
    projectId: "clay",
    assignee: "mate_arch",
    sessionId: "session-1",
  }, "user");
  var cards = await manager.list();

  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0]._id, created._id);
  assert.strictEqual(cards[0].title, "Ship the board");
  assert.strictEqual(cards[0].source, "native");
  assert.strictEqual(cards[0].createdBy, "user");
  assert.strictEqual(cards[0].pendingDone, false);
  assert.strictEqual(cards[0].order, 1);
  assert.ok(fs.existsSync(path.join(resolveToolsRoot({ userId: "roundtrip", multiUser: true }), "board", "data.db")));
});

test("board update allows only mutable fields", async function () {
  var manager = managerFor("update-fields");
  var created = await manager.create({ title: "Original" }, "user");
  var updated = await manager.update(created._id, {
    title: "Updated",
    body: "Details",
    projectId: "project-2",
    assignee: null,
    order: 42,
  }, "user");

  assert.strictEqual(updated.title, "Updated");
  assert.strictEqual(updated.order, 42);
  await assert.rejects(
    manager.update(created._id, { column: "done" }, "user"),
    /cannot be updated/
  );
  var cards = await manager.list();
  assert.strictEqual(cards[0].column, "todo");
});

test("mates propose completion instead of moving cards to done", async function () {
  var manager = managerFor("mate-completion");
  var created = await manager.create({ title: "Mate task" }, "mate_arch");

  await assert.rejects(
    manager.create({ title: "Already done", column: "done" }, "mate_arch"),
    /Only the user can create a card in done/
  );
  await assert.rejects(
    manager.move(created._id, "done", "mate_arch"),
    /Only the user can move a card to done/
  );
  var proposed = await manager.proposeDone(created._id, "mate_arch");
  assert.strictEqual(proposed.column, "todo");
  assert.strictEqual(proposed.pendingDone, true);
});

test("confirming completion accepts and rejects proposals", async function () {
  var manager = managerFor("confirm-completion");
  var acceptedCard = await manager.create({ title: "Accept me" }, "mate_arch");
  await manager.proposeDone(acceptedCard._id, "mate_arch");
  var accepted = await manager.confirmDone(acceptedCard._id, true, "user");
  assert.strictEqual(accepted.column, "done");
  assert.strictEqual(accepted.pendingDone, false);
  assert.strictEqual(typeof accepted.completedAt, "number");

  var rejectedCard = await manager.create({ title: "Reject me", column: "doing" }, "mate_arch");
  await manager.proposeDone(rejectedCard._id, "mate_arch");
  var rejected = await manager.confirmDone(rejectedCard._id, false, "user");
  assert.strictEqual(rejected.column, "doing");
  assert.strictEqual(rejected.pendingDone, false);
  assert.strictEqual(rejected.completedAt, null);
});

test("only the user can remove a board card", async function () {
  var manager = managerFor("remove-card");
  var created = await manager.create({ title: "Protected" }, "user");

  await assert.rejects(manager.remove(created._id, "mate_arch"), /Only the user can delete/);
  assert.strictEqual((await manager.list()).length, 1);
  await manager.remove(created._id, "user");
  assert.strictEqual((await manager.list()).length, 0);
});

test("board managers isolate cards by user", async function () {
  var first = managerFor("isolation-first");
  var second = managerFor("isolation-second");
  await first.create({ title: "First user's card" }, "user");

  assert.strictEqual((await first.list()).length, 1);
  assert.strictEqual((await second.list()).length, 0);
});

test("board columns are validated on create and move", async function () {
  var manager = managerFor("column-validation");
  await assert.rejects(
    manager.create({ title: "Bad column", column: "backlog" }, "user"),
    /Column must be one of/
  );
  var created = await manager.create({ title: "Valid column" }, "user");
  await assert.rejects(manager.move(created._id, "backlog", "user"), /Column must be one of/);
});
