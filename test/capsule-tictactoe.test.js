var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-capsule-tictactoe-"));
process.env.CLAY_HOME = testRoot;

var tttLogic = require("../lib/capsule-tictactoe-logic");
var registry = require("../lib/tools-registry");
var capsuleFloor = require("../lib/capsule-display-floor");
var toolStorage = require("../lib/tool-storage");
var serverRuntimes = require("../lib/capsule-server-runtimes");

test.after(function () { fs.rmSync(testRoot, { recursive: true, force: true }); });

function runtimeFor(userId) {
  var ctx = { userId: userId, multiUser: true };
  registry.listTools(ctx);
  return serverRuntimes.createRuntime("tictactoe", ctx, {});
}

var USER = { userId: "ttt-user", actor: "human", callerId: "user" };
var MATE = { userId: "ttt-user", actor: "mate", callerId: "mate-folder" };

test("the shipped Tic-Tac-Toe Capsule is discoverable, server-runtime, and has a usable floor", function () {
  var ctx = { userId: "ttt-discovery", multiUser: true };
  var manifests = registry.listTools(ctx);
  var ttt = manifests.filter(function (manifest) { return manifest.id === "tictactoe"; })[0];
  assert.ok(ttt, "Tic-Tac-Toe should seed into a fresh tools root");
  assert.strictEqual(ttt.runtime, "server");
  assert.ok(ttt.description && ttt.description.length > 0);
  assert.ok(ttt.useWhen && ttt.useWhen.length > 0);
  assert.match(ttt.skills, /clay_tool_snapshot/);
  assert.match(ttt.skills, /clay_tool_act/);
  assert.match(ttt.skills, /`mark`/);
  assert.strictEqual(capsuleFloor.hasUsableFloor(ttt), true);
  assert.strictEqual(serverRuntimes.hasRuntime("tictactoe"), true);
});

test("the shipped Display binds only to fields the projection publishes", function () {
  var displayCtx = { userId: "ttt-display", multiUser: true };
  registry.listTools(displayCtx);
  var uiTree = registry.getTool(displayCtx, "tictactoe").uiTree;
  var projection = tttLogic.project(tttLogic.newGame());

  // Every $state path anywhere in the tree must be a published field.
  var boundFields = [];
  (function collect(value) {
    if (typeof value === "string" && value.indexOf("$state.") === 0) {
      boundFields.push(value.slice("$state.".length).split(".")[0]);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.$bind === "string") collect(value.$bind);
    Object.keys(value).forEach(function (key) { collect(value[key]); });
  })(uiTree);
  assert.ok(boundFields.length > 0, "the floor binds state");
  boundFields.forEach(function (field) {
    assert.ok(Object.prototype.hasOwnProperty.call(projection, field), "projection publishes '" + field + "'");
  });

  var buttons = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "button") buttons.push(node);
    (node.children || []).forEach(walk);
    if (node.else) walk(node.else);
  })(uiTree);
  var marks = buttons.filter(function (button) { return button.action === "mark"; });
  var resets = buttons.filter(function (button) { return button.action === "reset"; });
  assert.strictEqual(marks.length, 9, "one mark button per cell");
  assert.strictEqual(resets.length, 1);
  var cells = marks.map(function (button) { return button.props.args.cell; });
  assert.deepStrictEqual(cells.slice().sort(function (a, b) { return a - b; }), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  buttons.forEach(function (button) {
    assert.ok(button.props.accessibleLabel || (typeof button.props.label === "string" && button.props.label), "every button is labelled");
  });
  marks.forEach(function (button) {
    assert.strictEqual(button.props.disabled, "$state.cell" + button.props.args.cell + "Disabled");
    assert.strictEqual(button.props.label.$bind, "$state.cell" + button.props.args.cell);
  });
});

test("marks alternate seats and a completed line wins the game", function () {
  var state = tttLogic.newGame();
  assert.strictEqual(state.turn, "user");
  tttLogic.mark(state, "user", { cell: 0 });
  assert.strictEqual(state.turn, "mate");
  tttLogic.mark(state, "mate", { cell: 3 });
  tttLogic.mark(state, "user", { cell: 1 });
  tttLogic.mark(state, "mate", { cell: 4 });
  assert.strictEqual(state.status, "playing");
  tttLogic.mark(state, "user", { cell: 2 });
  assert.strictEqual(state.status, "complete");
  assert.strictEqual(state.winner, "user");
  // The finished game keeps the winning board rather than clearing it.
  assert.deepStrictEqual(state.board.slice(0, 3), ["user", "user", "user"]);

  var columns = tttLogic.newGame();
  tttLogic.mark(columns, "user", { cell: 0 });
  tttLogic.mark(columns, "mate", { cell: 1 });
  tttLogic.mark(columns, "user", { cell: 3 });
  tttLogic.mark(columns, "mate", { cell: 4 });
  tttLogic.mark(columns, "user", { cell: 6 });
  assert.strictEqual(columns.winner, "user");

  var diagonal = tttLogic.newGame();
  tttLogic.mark(diagonal, "user", { cell: 1 });
  tttLogic.mark(diagonal, "mate", { cell: 0 });
  tttLogic.mark(diagonal, "user", { cell: 3 });
  tttLogic.mark(diagonal, "mate", { cell: 4 });
  tttLogic.mark(diagonal, "user", { cell: 5 });
  tttLogic.mark(diagonal, "mate", { cell: 8 });
  assert.strictEqual(diagonal.winner, "mate");
});

test("a full board with no line is a draw", function () {
  var state = tttLogic.newGame();
  var moves = [
    ["user", 0], ["mate", 4], ["user", 8], ["mate", 1], ["user", 7],
    ["mate", 6], ["user", 2], ["mate", 5], ["user", 3],
  ];
  moves.forEach(function (move) { tttLogic.mark(state, move[0], { cell: move[1] }); });
  assert.strictEqual(state.status, "complete");
  assert.strictEqual(state.winner, null);
  var projection = tttLogic.project(state);
  assert.strictEqual(projection.complete, true);
  assert.match(projection.statusText, /draw/);
  for (var i = 0; i < 9; i++) assert.strictEqual(projection["cell" + i + "Disabled"], true);
});

test("Logic refuses occupied cells, bad cells, out-of-turn moves, and post-game moves", function () {
  var state = tttLogic.newGame();
  assert.throws(function () { tttLogic.mark(state, "mate", { cell: 0 }); }, /out of turn/);
  assert.throws(function () { tttLogic.mark(state, "user", { cell: 9 }); }, /integer from 0 to 8/);
  assert.throws(function () { tttLogic.mark(state, "user", { cell: -1 }); }, /integer from 0 to 8/);
  assert.throws(function () { tttLogic.mark(state, "user", { cell: 4.5 }); }, /integer from 0 to 8/);
  assert.throws(function () { tttLogic.mark(state, "user", { cell: "4" }); }, /integer from 0 to 8/);
  assert.throws(function () { tttLogic.mark(state, "user", {}); }, /integer from 0 to 8/);
  assert.throws(function () { tttLogic.mark(state, "user", null); }, /integer from 0 to 8/);
  assert.deepStrictEqual(state.board, tttLogic.newGame().board, "a refused mark changes nothing");

  tttLogic.mark(state, "user", { cell: 4 });
  assert.throws(function () { tttLogic.mark(state, "mate", { cell: 4 }); }, /already marked with X/);
  assert.strictEqual(state.turn, "mate", "a refused mark does not pass the turn");

  var finished = tttLogic.newGame();
  tttLogic.mark(finished, "user", { cell: 0 });
  tttLogic.mark(finished, "mate", { cell: 3 });
  tttLogic.mark(finished, "user", { cell: 1 });
  tttLogic.mark(finished, "mate", { cell: 4 });
  tttLogic.mark(finished, "user", { cell: 2 });
  assert.strictEqual(finished.status, "complete");
  assert.throws(function () { tttLogic.mark(finished, "mate", { cell: 5 }); }, /already over/);
  assert.throws(function () { tttLogic.mark(finished, "user", { cell: 5 }); }, /already over/);
});

test("only the user may reset a live game, and either seat may reset a finished one", function () {
  var state = tttLogic.newGame();
  tttLogic.mark(state, "user", { cell: 0 });
  assert.throws(function () { tttLogic.reset(state, "mate"); }, /Only the user may reset/);
  var fresh = tttLogic.reset(state, "user");
  assert.strictEqual(fresh.board[0], null);
  assert.strictEqual(fresh.turn, "user");

  var finished = tttLogic.newGame();
  finished.status = "complete";
  finished.winner = "mate";
  assert.strictEqual(tttLogic.reset(finished, "mate").status, "playing");
  assert.strictEqual(tttLogic.reset(finished, "user").status, "playing");
});

test("the projection restates state for the floor Display without inventing meaning", function () {
  var state = tttLogic.newGame();
  var idle = tttLogic.project(state);
  assert.strictEqual(idle.userTurn, true);
  assert.strictEqual(idle.turn, "user");
  assert.strictEqual(idle.cell0, "");
  assert.strictEqual(idle.cell0Disabled, false);
  assert.match(idle.statusText, /You \(X\) to play/);

  tttLogic.mark(state, "user", { cell: 4 });
  var passed = tttLogic.project(state);
  assert.strictEqual(passed.cell4, "X");
  assert.strictEqual(passed.cell4Disabled, true, "a taken cell is disabled");
  assert.strictEqual(passed.userTurn, false);
  assert.strictEqual(passed.cell0Disabled, true, "every cell is disabled off the user's turn");
  assert.match(passed.statusText, /Your Mate \(O\) to play/);

  tttLogic.mark(state, "mate", { cell: 0 });
  var back = tttLogic.project(state);
  assert.strictEqual(back.cell0, "O");
  assert.strictEqual(back.cell1Disabled, false, "an open cell is enabled on the user's turn");
});

test("a corrupt stored game is replaced rather than trusted", function () {
  assert.strictEqual(tttLogic.normalizeState(null).status, "playing");
  assert.strictEqual(tttLogic.normalizeState({ turn: "referee", status: "playing" }).turn, "user");
  assert.strictEqual(tttLogic.normalizeState({ turn: "user", status: "paused" }).status, "playing");
  var repaired = tttLogic.normalizeState({
    turn: "mate",
    status: "playing",
    board: ["user", "X", 7, null, "mate"],
    winner: "referee",
    eventSeq: -3,
  });
  assert.deepStrictEqual(repaired.board, ["user", null, null, null, "mate", null, null, null, null]);
  assert.strictEqual(repaired.winner, null);
  assert.strictEqual(repaired.eventSeq, 0);
  assert.strictEqual(repaired.turn, "mate");
});

test("one act pipeline: user and Mate share the same persisted game", async function () {
  var runtime = runtimeFor("ttt-user");
  var start = await runtime.snapshot(USER);
  assert.strictEqual(start.turn, "user");
  assert.strictEqual(start.eventSeq, 0);

  var marked = await runtime.act(USER, "mark", { cell: 4 });
  assert.strictEqual(marked.state.cell4, "X");
  // The act carries its own causality for a watching Display.
  assert.strictEqual(marked.event.actor, "user");
  assert.strictEqual(marked.event.action, "mark");
  assert.strictEqual(marked.event.previous.cell4, "");
  assert.deepStrictEqual(marked.event.next, marked.state);
  assert.strictEqual(marked.event.seq, marked.state.eventSeq);
  assert.strictEqual(marked.state.eventSeq, 1);

  await assert.rejects(function () { return runtime.act(USER, "mark", { cell: 0 }); }, /out of turn/);
  await assert.rejects(function () { return runtime.act(MATE, "mark", { cell: 4 }); }, /already marked/);

  var mateMarked = await runtime.act(MATE, "mark", { cell: 0 });
  assert.strictEqual(mateMarked.state.cell0, "O");
  assert.strictEqual(mateMarked.state.eventSeq, 2);
  // The event chain: each previous is exactly the prior event's next.
  assert.deepStrictEqual(mateMarked.event.previous, marked.event.next);
  assert.strictEqual(mateMarked.event.seq, marked.event.seq + 1);

  // A separate runtime instance for the same user reads the same stored game,
  // and the Mate sees exactly what the user sees.
  var reopened = runtimeFor("ttt-user");
  var userView = await reopened.snapshot(USER);
  var mateView = await reopened.snapshot(MATE);
  assert.deepStrictEqual(userView, mateView);
  assert.strictEqual(userView.cell4, "X");
  assert.strictEqual(userView.cell0, "O");

  await assert.rejects(function () { return reopened.act(USER, "newGame", {}); }, /Unknown Tic-Tac-Toe action/);
  await assert.rejects(function () { return reopened.snapshot({ userId: "ttt-user" }); }, /caller seat/);
});

test("eventSeq grows by exactly one per act and survives a reset", async function () {
  var runtime = runtimeFor("ttt-seq");
  var first = await runtime.act(USER, "mark", { cell: 0 });
  var second = await runtime.act(MATE, "mark", { cell: 4 });
  var third = await runtime.act(USER, "mark", { cell: 8 });
  assert.strictEqual(first.event.seq, 1);
  assert.strictEqual(second.event.seq, 2);
  assert.strictEqual(third.event.seq, 3);
  assert.deepStrictEqual(second.event.previous, first.event.next);
  assert.deepStrictEqual(third.event.previous, second.event.next);

  // A reset starts a new game but never restarts the event clock, so a
  // Display that saw event N can never mistake the fresh game for stale news.
  var resetResult = await runtime.act(USER, "reset", {});
  assert.strictEqual(resetResult.event.seq, 4);
  assert.strictEqual(resetResult.state.eventSeq, 4);
  assert.strictEqual(resetResult.state.cell0, "");
  assert.deepStrictEqual(resetResult.event.previous, third.event.next);
  var after = await runtimeFor("ttt-seq").snapshot(USER);
  assert.strictEqual(after.eventSeq, 4);
});

test("a full game through the act pipeline reaches a frozen win", async function () {
  var runtime = runtimeFor("ttt-full");
  await runtime.act(USER, "mark", { cell: 0 });
  await runtime.act(MATE, "mark", { cell: 3 });
  await runtime.act(USER, "mark", { cell: 1 });
  await runtime.act(MATE, "mark", { cell: 4 });
  var winning = await runtime.act(USER, "mark", { cell: 2 });
  assert.strictEqual(winning.state.status, "complete");
  assert.strictEqual(winning.state.winner, "user");
  assert.strictEqual(winning.state.complete, true);
  assert.match(winning.state.statusText, /You \(X\) won/);
  await assert.rejects(function () { return runtime.act(MATE, "mark", { cell: 5 }); }, /already over/);
  await assert.rejects(function () { return runtime.act(USER, "mark", { cell: 5 }); }, /already over/);
  // A completed game may be reset by either seat.
  var reset = await runtime.act(MATE, "reset", {});
  assert.strictEqual(reset.state.status, "playing");
  assert.strictEqual(reset.state.turn, "user");
});

test("only the user may reset through the pipeline while the game runs", async function () {
  var runtime = runtimeFor("ttt-reset");
  await runtime.act(USER, "mark", { cell: 0 });
  await assert.rejects(function () { return runtime.act(MATE, "reset", {}); }, /Only the user may reset/);
  var reset = await runtime.act(USER, "reset", {});
  assert.strictEqual(reset.state.cell0, "");
});

test("concurrent marks serialize across separately created runtime instances", async function () {
  // Production creates a runtime per request, so the lock has to hold across
  // instances for one user's stored game, not just within one instance.
  var markerA = runtimeFor("ttt-race");
  var markerB = runtimeFor("ttt-race");
  assert.notStrictEqual(markerA, markerB);

  // Two user marks that arrive together cannot both be in turn: the first
  // lands and passes play, and the second is refused by the same rule a Mate
  // would hit. An unserialized read-modify-write would land both.
  var settled = await Promise.allSettled([
    markerA.act(USER, "mark", { cell: 0 }),
    markerB.act(USER, "mark", { cell: 4 }),
  ]);
  var fulfilled = settled.filter(function (entry) { return entry.status === "fulfilled"; });
  var rejected = settled.filter(function (entry) { return entry.status === "rejected"; });
  assert.strictEqual(fulfilled.length, 1);
  assert.strictEqual(rejected.length, 1);
  assert.match(rejected[0].reason.message, /out of turn/);

  var after = await runtimeFor("ttt-race").snapshot(USER);
  var markedCells = [];
  for (var i = 0; i < 9; i++) {
    if (after["cell" + i] !== "") markedCells.push(i);
  }
  assert.strictEqual(markedCells.length, 1, "the board holds exactly one mark");
  assert.strictEqual(after["cell" + markedCells[0]], "X");
  assert.strictEqual(after.turn, "mate");
  assert.strictEqual(after.eventSeq, 1, "exactly one act was applied");
});

test("each user's game is stored in their own Capsule datastore", async function () {
  var first = runtimeFor("ttt-alpha");
  await first.act(USER, "mark", { cell: 8 });
  var second = runtimeFor("ttt-beta");
  var otherView = await second.snapshot(USER);
  assert.strictEqual(otherView.cell8, "");
  assert.strictEqual(otherView.eventSeq, 0);
  var stored = await toolStorage.createToolStorage({ userId: "ttt-alpha", multiUser: true }, "tictactoe").get("game");
  assert.strictEqual(stored.state.board[8], "user");
});
