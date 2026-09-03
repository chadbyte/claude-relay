var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-capsule-pig-"));
process.env.CLAY_HOME = testRoot;

var pigLogic = require("../lib/capsule-pig-logic");
var registry = require("../lib/tools-registry");
var capsuleFloor = require("../lib/capsule-display-floor");
var toolStorage = require("../lib/tool-storage");
var serverRuntimes = require("../lib/capsule-server-runtimes");
var serverTools = require("../lib/server-tools");

test.after(function () { fs.rmSync(testRoot, { recursive: true, force: true }); });

function scriptedDice(faces) {
  var index = 0;
  return function () {
    if (index >= faces.length) throw new Error("The test rolled more dice than it scripted.");
    return faces[index++];
  };
}

function runtimeFor(userId, faces) {
  var ctx = { userId: userId, multiUser: true };
  registry.listTools(ctx);
  return serverRuntimes.createRuntime("pig", ctx, faces ? { rollDie: scriptedDice(faces) } : {});
}

var USER = { userId: "pig-user", actor: "human", callerId: "user" };
var MATE = { userId: "pig-user", actor: "mate", callerId: "mate-folder" };

test("the shipped Pig Capsule is discoverable, server-runtime, and has a usable floor", function () {
  var ctx = { userId: "pig-discovery", multiUser: true };
  var manifests = registry.listTools(ctx);
  var pig = manifests.filter(function (manifest) { return manifest.id === "pig"; })[0];
  assert.ok(pig, "Pig should seed into a fresh tools root");
  assert.strictEqual(pig.runtime, "server");
  assert.ok(pig.description && pig.description.length > 0);
  assert.ok(pig.useWhen && pig.useWhen.length > 0);
  assert.match(pig.skills, /clay_tool_act/);
  assert.match(pig.skills, /`roll`, `hold`, or `reset`/);
  assert.strictEqual(capsuleFloor.hasUsableFloor(pig), true);
  assert.strictEqual(serverRuntimes.hasRuntime("pig"), true);
  assert.strictEqual(serverRuntimes.hasRuntime("not-shipped"), false);
});

test("the shipped Display binds only to fields the projection publishes", function () {
  var displayCtx = { userId: "pig-display", multiUser: true };
  registry.listTools(displayCtx);
  var uiTree = registry.getTool(displayCtx, "pig").uiTree;
  var charts = uiTree.children.filter(function (node) { return node.type === "chart"; });
  assert.strictEqual(charts.length, 2);
  charts.forEach(function (chart) {
    assert.strictEqual(chart.props.kind, "progress");
    assert.strictEqual(chart.props.max, pigLogic.TARGET_SCORE);
  });
  var projection = pigLogic.project(pigLogic.newGame());
  assert.ok(Array.isArray(projection[charts[0].bind]));
  assert.ok(Array.isArray(projection[charts[1].bind]));
  assert.ok(Array.isArray(projection.recentRolls));
  assert.strictEqual(typeof projection.turnTotalText, "string");

  var buttons = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "button") buttons.push(node);
    (node.children || []).forEach(walk);
    if (node.else) walk(node.else);
  })(uiTree);
  var actions = buttons.map(function (button) { return button.action; });
  assert.deepStrictEqual(actions.slice().sort(), ["hold", "hold", "reset", "roll", "roll"]);
  var offTurn = buttons.filter(function (button) { return button.props.disabled === true; });
  assert.strictEqual(offTurn.length, 2, "roll and hold have a disabled variant off the user's turn");
});

test("rolling accumulates, a 1 busts the turn, and holding banks the total", function () {
  var state = pigLogic.newGame();
  assert.strictEqual(state.turn, "user");
  pigLogic.roll(state, "user", scriptedDice([4]));
  assert.strictEqual(state.turnTotal, 4);
  pigLogic.roll(state, "user", scriptedDice([5]));
  assert.strictEqual(state.turnTotal, 9);
  assert.strictEqual(state.turn, "user");

  pigLogic.hold(state, "user");
  assert.strictEqual(state.scores.user, 9);
  assert.strictEqual(state.turnTotal, 0);
  assert.strictEqual(state.turn, "mate");

  pigLogic.roll(state, "mate", scriptedDice([6]));
  pigLogic.roll(state, "mate", scriptedDice([1]));
  assert.strictEqual(state.turnTotal, 0);
  assert.strictEqual(state.scores.mate, 0);
  assert.strictEqual(state.turn, "user");
  assert.match(state.recentRolls[state.recentRolls.length - 1].text, /rolled a 1 and lost 6/);
});

test("Logic refuses out-of-turn moves, post-game moves, and a Mate reset mid-game", function () {
  var state = pigLogic.newGame();
  assert.throws(function () { pigLogic.roll(state, "mate", scriptedDice([3])); }, /out of turn/);
  assert.throws(function () { pigLogic.hold(state, "mate"); }, /out of turn/);
  assert.strictEqual(state.turnTotal, 0);

  assert.throws(function () { pigLogic.reset(state, "mate"); }, /Only the user may reset/);
  assert.strictEqual(pigLogic.reset(state, "user").scores.user, 0);

  var finished = pigLogic.newGame();
  finished.scores.user = 96;
  pigLogic.roll(finished, "user", scriptedDice([4]));
  pigLogic.hold(finished, "user");
  assert.strictEqual(finished.status, "complete");
  assert.strictEqual(finished.winner, "user");
  assert.strictEqual(finished.scores.user, 100);
  assert.throws(function () { pigLogic.roll(finished, "user", scriptedDice([3])); }, /already over/);
  assert.throws(function () { pigLogic.hold(finished, "mate"); }, /already over/);
  // A completed game may be reset by either seat.
  assert.strictEqual(pigLogic.reset(finished, "mate").status, "playing");
});

test("the projection restates state for the floor Display without inventing meaning", function () {
  var state = pigLogic.newGame();
  var idle = pigLogic.project(state);
  assert.strictEqual(idle.userTurn, true);
  assert.strictEqual(idle.recentRolls.length, 0);
  assert.deepStrictEqual(idle.userScoreSeries, [{ seat: "You", value: 0 }]);
  assert.deepStrictEqual(idle.mateScoreSeries, [{ seat: "Your Mate", value: 0 }]);
  assert.match(idle.turnTotalText, /Turn total 0 of 100/);

  pigLogic.roll(state, "user", scriptedDice([1]));
  var passed = pigLogic.project(state);
  assert.strictEqual(passed.turn, "mate");
  assert.strictEqual(passed.userTurn, false);
  assert.strictEqual(passed.recentRolls.length, 1);
  assert.strictEqual(passed.target, pigLogic.TARGET_SCORE);
});

test("a corrupt stored game is replaced rather than trusted", function () {
  assert.strictEqual(pigLogic.normalizeState(null).status, "playing");
  assert.strictEqual(pigLogic.normalizeState({ turn: "referee", status: "playing" }).scores.user, 0);
  assert.strictEqual(pigLogic.normalizeState({ turn: "user", status: "paused" }).turn, "user");
  var repaired = pigLogic.normalizeState({ turn: "user", status: "playing", scores: { user: -5, mate: "x" }, turnTotal: 3.5, recentRolls: "nope" });
  assert.deepStrictEqual(repaired.scores, { user: 0, mate: 0 });
  assert.strictEqual(repaired.turnTotal, 0);
  assert.deepStrictEqual(repaired.recentRolls, []);
  var partialRolls = pigLogic.normalizeState({
    turn: "user",
    status: "playing",
    recentRolls: [{ id: "roll-1", seat: "user", face: 4, text: "You rolled a 4." }, { id: "roll-2", text: "not a roll" }],
  });
  assert.strictEqual(partialRolls.recentRolls.length, 1);
});

test("recentRolls holds rolls only, including a bust, and never a hold or a win", function () {
  var state = pigLogic.newGame();
  pigLogic.roll(state, "user", scriptedDice([4]));
  pigLogic.roll(state, "user", scriptedDice([2]));
  pigLogic.hold(state, "user");
  pigLogic.roll(state, "mate", scriptedDice([1]));
  assert.deepStrictEqual(state.recentRolls.map(function (entry) { return entry.face; }), [4, 2, 1]);
  state.recentRolls.forEach(function (entry) {
    assert.match(entry.text, /rolled a/);
    assert.doesNotMatch(entry.text, /held|banked|won/);
  });

  var winning = pigLogic.newGame();
  winning.scores.user = 98;
  pigLogic.roll(winning, "user", scriptedDice([3]));
  pigLogic.hold(winning, "user");
  assert.strictEqual(winning.winner, "user");
  assert.strictEqual(winning.recentRolls.length, 1, "winning adds no entry");

  // The collection stays bounded no matter how long the game runs.
  var long = pigLogic.newGame();
  for (var i = 0; i < 40; i++) {
    if (long.turn !== "user") pigLogic.roll(long, "mate", scriptedDice([2]));
    else pigLogic.roll(long, "user", scriptedDice([2]));
  }
  assert.strictEqual(long.recentRolls.length, 12);
});

test("one act pipeline: user and Mate share the same persisted game", async function () {
  var runtime = runtimeFor("pig-user", [3, 2, 5]);
  var start = await runtime.snapshot(USER);
  assert.strictEqual(start.turn, "user");
  assert.strictEqual(start.scores.user, 0);

  var rolled = await runtime.act(USER, "roll", {});
  assert.strictEqual(rolled.turnTotal, 3);
  await runtime.act(USER, "hold", {});

  await assert.rejects(function () { return runtime.act(USER, "roll", {}); }, /out of turn/);

  var mateRolled = await runtime.act(MATE, "roll", {});
  assert.strictEqual(mateRolled.turnTotal, 2);
  assert.strictEqual(mateRolled.scores.user, 3);

  // A separate runtime instance for the same user reads the same stored game,
  // and the Mate sees exactly what the user sees.
  var reopened = runtimeFor("pig-user");
  var userView = await reopened.snapshot(USER);
  var mateView = await reopened.snapshot(MATE);
  assert.deepStrictEqual(userView, mateView);
  assert.strictEqual(userView.scores.user, 3);
  assert.strictEqual(userView.turn, "mate");

  await assert.rejects(function () { return reopened.act(USER, "newGame", {}); }, /Unknown Pig action/);
  await assert.rejects(function () { return reopened.snapshot({ userId: "pig-user" }); }, /caller seat/);
});

test("concurrent acts serialize across separately created runtime instances", async function () {
  // Production creates a runtime per request, so the lock has to hold across
  // instances for one user's stored game, not just within one instance.
  var rollerA = runtimeFor("pig-race", [3]);
  var rollerB = runtimeFor("pig-race", [4]);
  assert.notStrictEqual(rollerA, rollerB);

  // Two rolls that arrive together must both land on the running total. An
  // unserialized read-modify-write would read 0 twice and lose one of them.
  var rolls = await Promise.all([rollerA.act(USER, "roll", {}), rollerB.act(USER, "roll", {})]);
  var latest = rolls[0].recentRolls.length === 2 ? rolls[0] : rolls[1];
  assert.strictEqual(latest.turnTotal, 7);
  assert.strictEqual(latest.recentRolls.length, 2);
  assert.deepStrictEqual(latest.recentRolls.map(function (entry) { return entry.face; }).slice().sort(), [3, 4]);

  // Two holds that arrive together cannot both be in turn: the first banks and
  // passes play, and the second is refused by the same rule a Mate would hit.
  var holderA = runtimeFor("pig-race");
  var holderB = runtimeFor("pig-race");
  var settled = await Promise.allSettled([holderA.act(USER, "hold", {}), holderB.act(USER, "hold", {})]);
  var fulfilled = settled.filter(function (entry) { return entry.status === "fulfilled"; });
  var rejected = settled.filter(function (entry) { return entry.status === "rejected"; });
  assert.strictEqual(fulfilled.length, 1);
  assert.strictEqual(rejected.length, 1);
  assert.match(rejected[0].reason.message, /out of turn/);

  var after = await runtimeFor("pig-race").snapshot(USER);
  assert.strictEqual(after.scores.user, 7, "the turn total is banked exactly once");
  assert.strictEqual(after.turn, "mate");
  assert.strictEqual(after.turnTotal, 0);

  // A concurrent Mate act on the same game queues behind the user's, and the
  // rule it meets is decided by the state the earlier act committed.
  var userRoller = runtimeFor("pig-race", [5]);
  var mateRoller = runtimeFor("pig-race", [6]);
  var mixed = await Promise.allSettled([mateRoller.act(MATE, "roll", {}), userRoller.act(USER, "roll", {})]);
  assert.strictEqual(mixed[0].status, "fulfilled", "the mate is in turn and rolls");
  assert.strictEqual(mixed[1].status, "rejected");
  assert.match(mixed[1].reason.message, /out of turn/);
  var final = await runtimeFor("pig-race").snapshot(MATE);
  assert.strictEqual(final.turnTotal, 6, "exactly one roll was applied");
});

test("each user's game is stored in their own Capsule datastore", async function () {
  var first = runtimeFor("pig-alpha", [6]);
  await first.act(USER, "roll", {});
  var second = runtimeFor("pig-beta");
  var otherView = await second.snapshot(USER);
  assert.strictEqual(otherView.turnTotal, 0);
  assert.strictEqual(otherView.recentRolls.length, 0);
  var stored = await toolStorage.createToolStorage({ userId: "pig-alpha", multiUser: true }, "pig").get("game");
  assert.strictEqual(stored.state.turnTotal, 6);
});

test("the human WebSocket path and the Mate MCP path drive one shared game", async function () {
  var sent = [];
  var socket = { readyState: 1, send: function (payload) { sent.push(JSON.parse(payload)); } };
  var projects = new Map();
  projects.set("home", { forEachClient: function (fn) { fn(socket); } });
  var tools = serverTools.attachTools({
    users: { isMultiUser: function () { return false; }, findUserById: function () { return null; } },
    projects: projects,
  });
  tools.installedManifests("default");

  var userState = await tools.controlForUser("default", "pig", "act", { actionId: "roll", args: {} });
  assert.ok(userState.turnTotal > 0 || userState.turn === "mate", "a roll either builds the turn or busts it");
  // State only: a Mate never sees Display, and neither surface returns one.
  assert.strictEqual(userState.ui, undefined);
  assert.strictEqual(userState.controls, undefined);
  // Acting does not push anything to anyone; the initiator gets the reply.
  assert.deepStrictEqual(sent, []);

  var mateView = await tools.controlForMate("default", "mate-folder", "pig", "snapshot", {});
  assert.strictEqual(mateView.ui, undefined);
  assert.strictEqual(mateView.controls, undefined);
  assert.strictEqual(mateView.turnTotal, userState.turnTotal);
  assert.strictEqual(mateView.turn, userState.turn);

  if (userState.turn === "user") {
    await assert.rejects(function () {
      return tools.controlForMate("default", "mate-folder", "pig", "act", { actionId: "roll", args: {} });
    }, /out of turn/);
  }

  assert.strictEqual(tools.handleMessage(socket, { type: "tool_server_control", toolId: "pig", kind: "snapshot", requestId: "snap-1" }), true);
  for (var i = 0; i < 50 && sent.length === 0; i++) await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.strictEqual(sent.length, 1, "only the requesting socket is answered");
  assert.strictEqual(sent[0].type, "tool_server_state");
  assert.strictEqual(sent[0].ok, true);
  assert.strictEqual(sent[0].requestId, "snap-1");
  assert.strictEqual(sent[0].state.target, pigLogic.TARGET_SCORE);
  assert.strictEqual(sent[0].state.userScoreSeries.length, 1);
});

test("the die stays inside Logic and stays on a real die face", async function () {
  var runtime = runtimeFor("pig-random");
  var seen = Object.create(null);
  for (var i = 0; i < 60; i++) {
    var state = await runtime.act(USER, "roll", {});
    if (state.lastRoll !== null) seen[state.lastRoll] = true;
    if (state.turn !== "user") await runtime.act(MATE, "hold", {});
    if (state.status === "complete") await runtime.act(USER, "reset", {});
    assert.ok(state.lastRoll >= 1 && state.lastRoll <= 6, "roll must be a die face");
  }
  assert.ok(Object.keys(seen).length > 1, "rolls should not be constant");
});
