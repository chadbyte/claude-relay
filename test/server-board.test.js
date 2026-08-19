var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-server-board-test-"));
process.env.CLAY_HOME = testRoot;

var attachBoard = require("../lib/server-board").attachBoard;

test.after(function () {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

// A socket that records everything the handler sends back to the client.
function fakeWs(userId) {
  return {
    readyState: 1,
    _clayUser: userId ? { id: userId } : null,
    sent: [],
    send: function (raw) {
      this.sent.push(JSON.parse(raw));
    },
  };
}

// Minimal project registry: one context whose only client is the given socket.
function harness(sockets, multiUser) {
  var projects = new Map();
  projects.set("p1", {
    forEachClient: function (fn) {
      for (var i = 0; i < sockets.length; i++) fn(sockets[i]);
    },
  });
  return attachBoard({
    users: {
      isMultiUser: function () { return multiUser !== false; },
      findUserById: function (id) { return { id: id, linuxUser: null }; },
    },
    projects: projects,
  });
}

// The handler answers asynchronously; wait until the socket has a reply.
async function waitForMessage(ws, type) {
  for (var i = 0; i < 100; i++) {
    for (var j = 0; j < ws.sent.length; j++) {
      if (ws.sent[j].type === type) return ws.sent[j];
    }
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
  }
  throw new Error("Timed out waiting for " + type + ", got: " + JSON.stringify(ws.sent));
}

test("board handler ignores unrelated message types", function () {
  var ws = fakeWs("ignore-user");
  var handler = harness([ws]);
  assert.strictEqual(handler.handleMessage(ws, { type: "dm_open" }), false);
  assert.strictEqual(handler.handleMessage(ws, { type: "board_list" }), true);
});

test("board_list replies with board_state on the requesting socket", async function () {
  var ws = fakeWs("list-user");
  var handler = harness([ws]);
  handler.handleMessage(ws, { type: "board_list" });
  var state = await waitForMessage(ws, "board_state");
  assert.ok(Array.isArray(state.cards));
});

test("creating a card broadcasts board_card_created to the user's sockets", async function () {
  var first = fakeWs("create-user");
  var second = fakeWs("create-user");
  var other = fakeWs("someone-else");
  var handler = harness([first, second, other]);

  handler.handleMessage(first, {
    type: "board_card_create",
    fields: { title: "Wire the board" },
  });
  var created = await waitForMessage(first, "board_card_created");
  assert.strictEqual(created.card.title, "Wire the board");
  assert.strictEqual(created.card.column, "todo");

  var mirrored = await waitForMessage(second, "board_card_created");
  assert.strictEqual(mirrored.card._id, created.card._id);
  assert.strictEqual(other.sent.length, 0);
});

test("invalid board requests reply with board_error and no broadcast", async function () {
  var ws = fakeWs("error-user");
  var handler = harness([ws]);
  handler.handleMessage(ws, { type: "board_card_create", fields: { title: "   " } });
  var error = await waitForMessage(ws, "board_error");
  assert.strictEqual(error.requestType, "board_card_create");
  assert.match(error.message, /non-empty string/);
});

test("moving a card broadcasts board_card_moved", async function () {
  var ws = fakeWs("move-user");
  var handler = harness([ws]);
  handler.handleMessage(ws, { type: "board_card_create", fields: { title: "Movable" } });
  var created = await waitForMessage(ws, "board_card_created");

  handler.handleMessage(ws, {
    type: "board_card_move",
    cardId: created.card._id,
    column: "doing",
  });
  var moved = await waitForMessage(ws, "board_card_moved");
  assert.strictEqual(moved.card.column, "doing");
});

test("confirming a mate proposal broadcasts board_done_updated", async function () {
  var ws = fakeWs("done-user");
  var handler = harness([ws]);
  handler.handleMessage(ws, { type: "board_card_create", fields: { title: "Finish me" } });
  var created = await waitForMessage(ws, "board_card_created");

  // Mates reach the board through the manager, not the client protocol.
  var manager = handler.getBoardManager("done-user");
  await manager.proposeDone(created.card._id, "mate_arch");

  handler.handleMessage(ws, {
    type: "board_done_confirm",
    cardId: created.card._id,
    accept: true,
  });
  var confirmed = await waitForMessage(ws, "board_done_updated");
  assert.strictEqual(confirmed.accepted, true);
  assert.strictEqual(confirmed.card.column, "done");
  assert.strictEqual(confirmed.card.pendingDone, false);
});

test("deleting a card broadcasts board_card_deleted with the id", async function () {
  var ws = fakeWs("delete-user");
  var handler = harness([ws]);
  handler.handleMessage(ws, { type: "board_card_create", fields: { title: "Temporary" } });
  var created = await waitForMessage(ws, "board_card_created");

  handler.handleMessage(ws, { type: "board_card_delete", cardId: created.card._id });
  var deleted = await waitForMessage(ws, "board_card_deleted");
  assert.strictEqual(deleted.cardId, created.card._id);
});

test("multi-user sockets without an authenticated user are not handled", function () {
  var ws = fakeWs(null);
  var handler = harness([ws]);
  assert.strictEqual(handler.handleMessage(ws, { type: "board_list" }), false);
  assert.strictEqual(ws.sent.length, 0);
});
