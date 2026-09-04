// Server-side Logic for the Pig validation Capsule.
//
// Logic is the single source of truth. Every state change in the game happens
// through one of these functions and nowhere else: the die is rolled here, the
// turn rules are enforced here, and the game record lives in the Capsule's own
// datastore. A human button click and a Mate clay_tool_act call arrive at the
// same act pipeline with the same rules, so neither party can break a rule the
// other is bound by, and neither sees state the other cannot.
//
// The two seats are "user" and "mate". The server resolves its own actor before
// calling in, and the human actor maps onto the user seat; seat is never read
// from caller-supplied text.
//
// Rules: seats alternate turns. On your turn you may roll as often as you like;
// each roll adds to the turn total, but rolling a 1 loses the whole turn total
// and passes play. Holding banks the turn total into your score, and the first
// seat to bank at least 100 points wins. A finished game is frozen until
// someone resets it; only the user may reset a game in progress, because the
// Capsule belongs to the human, not to the Mate.

var crypto = require("crypto");

var GAME_DOC_ID = "game";
var TARGET_SCORE = 100;
var BUST_FACE = 1;
var USER = "user";
var MATE = "mate";
var SEATS = [USER, MATE];
var SEAT_LABELS = { user: "You", mate: "Your Mate" };
var MAX_RECENT_ROLLS = 12;

// Every read-modify-write for one stored game runs to completion before the
// next one starts. Two acts that arrive together would otherwise both validate
// against the same turn, and the second write would silently discard the first.
var gameLocks = Object.create(null);

function runExclusive(key, operation) {
  var previous = gameLocks[key] || Promise.resolve();
  var settled = previous.then(operation, operation);
  gameLocks[key] = settled.then(function () {}, function () {});
  return settled;
}

function secureRollDie() {
  return crypto.randomInt(1, 7);
}

function otherSeat(seat) {
  return seat === USER ? MATE : USER;
}

function newGame() {
  return {
    status: "playing",
    turn: USER,
    scores: { user: 0, mate: 0 },
    turnTotal: 0,
    lastRoll: null,
    lastActor: null,
    winner: null,
    target: TARGET_SCORE,
    sequence: 0,
    eventSeq: 0,
    recentRolls: [],
  };
}

function safeScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10000 ? value : 0;
}

// Counters are ordering, not points: they only ever grow, so they carry no
// upper bound. eventSeq in particular must survive a reset, because a Display
// that saw event N must treat anything at or below N as already rendered.
function safeCounter(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

// A stored game is data, not a promise about shape. Anything unreadable is
// replaced by a fresh game rather than trusted.
function normalizeState(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return newGame();
  if (SEATS.indexOf(stored.turn) === -1) return newGame();
  if (stored.status !== "playing" && stored.status !== "complete") return newGame();
  var scores = stored.scores && typeof stored.scores === "object" ? stored.scores : {};
  var rolls = Array.isArray(stored.recentRolls) ? stored.recentRolls.slice(-MAX_RECENT_ROLLS) : [];
  return {
    status: stored.status,
    turn: stored.turn,
    scores: { user: safeScore(scores.user), mate: safeScore(scores.mate) },
    turnTotal: safeScore(stored.turnTotal),
    lastRoll: Number.isInteger(stored.lastRoll) ? stored.lastRoll : null,
    lastActor: SEATS.indexOf(stored.lastActor) !== -1 ? stored.lastActor : null,
    winner: SEATS.indexOf(stored.winner) !== -1 ? stored.winner : null,
    target: TARGET_SCORE,
    sequence: safeCounter(stored.sequence),
    eventSeq: safeCounter(stored.eventSeq),
    recentRolls: rolls.filter(function (entry) {
      return entry && typeof entry.text === "string" && Number.isInteger(entry.face);
    }),
  };
}

// recentRolls holds rolls and only rolls, including a bust. Banking and winning
// are turn outcomes rather than rolls, so they never appear here.
function appendRoll(state, seat, face, text) {
  var next = state.sequence + 1;
  state.sequence = next;
  state.recentRolls = state.recentRolls
    .concat([{ id: "roll-" + next, seat: seat, face: face, text: text }])
    .slice(-MAX_RECENT_ROLLS);
}

function requirePlayableTurn(state, seat) {
  if (state.status !== "playing") {
    throw new Error("This game is already over. Reset it to play again.");
  }
  if (state.turn !== seat) {
    throw new Error("This move is out of turn: " + SEAT_LABELS[state.turn] + " to play.");
  }
}

function roll(state, seat, rollDie) {
  requirePlayableTurn(state, seat);
  var face = rollDie();
  if (!Number.isInteger(face) || face < 1 || face > 6) throw new Error("The die produced an invalid face.");
  state.lastRoll = face;
  state.lastActor = seat;
  if (face === BUST_FACE) {
    appendRoll(state, seat, face, SEAT_LABELS[seat] + " rolled a 1 and lost " + state.turnTotal + " point(s).");
    state.turnTotal = 0;
    state.turn = otherSeat(seat);
    return state;
  }
  state.turnTotal += face;
  appendRoll(state, seat, face, SEAT_LABELS[seat] + " rolled a " + face + " for a turn total of " + state.turnTotal + ".");
  return state;
}

function hold(state, seat) {
  requirePlayableTurn(state, seat);
  var banked = state.turnTotal;
  state.scores[seat] += banked;
  state.lastActor = seat;
  state.turnTotal = 0;
  if (state.scores[seat] >= state.target) {
    state.status = "complete";
    state.winner = seat;
    return state;
  }
  state.turn = otherSeat(seat);
  return state;
}

function reset(state, seat) {
  if (state.status === "playing" && seat !== USER) {
    throw new Error("Only the user may reset a game that is still in progress.");
  }
  return newGame();
}

// The projection a Display renders and a Mate reads. It adds no meaning that is
// absent from state: every derived field is a restatement of the fields above.
// The score series exist because a progress chart binds to a collection.
function project(state) {
  var complete = state.status === "complete";
  var userTurn = !complete && state.turn === USER;
  return {
    status: state.status,
    turn: state.turn,
    scores: { user: state.scores.user, mate: state.scores.mate },
    userScoreSeries: [{ seat: SEAT_LABELS.user, value: state.scores.user }],
    mateScoreSeries: [{ seat: SEAT_LABELS.mate, value: state.scores.mate }],
    turnTotal: state.turnTotal,
    turnTotalText: "Turn total " + state.turnTotal + " of " + state.target + ", " + SEAT_LABELS[state.turn] + " to play.",
    lastRoll: state.lastRoll,
    lastActor: state.lastActor,
    winner: state.winner,
    target: state.target,
    recentRolls: state.recentRolls,
    complete: complete,
    userTurn: userTurn,
    eventSeq: state.eventSeq,
  };
}

// Causality for the live Display: {actor, action, previous, next} plus a
// monotonic seq. Sending only the new state would make a Mate's move teleport
// onto the human's screen; the event lets the Display replay and attribute it.
function buildEvent(seat, actionId, previous, next) {
  return {
    seq: next.eventSeq,
    actor: seat,
    action: actionId,
    previous: previous,
    next: next,
  };
}

function seatFor(context) {
  var actor = context && context.actor;
  if (actor === "human" || actor === USER) return USER;
  if (actor === MATE) return MATE;
  throw new Error("The Capsule caller seat could not be determined.");
}

// One act pipeline. The human surface and the Mate MCP surface both land here.
function createRuntime(options) {
  options = options || {};
  var storage = options.storage;
  var rollDie = typeof options.rollDie === "function" ? options.rollDie : secureRollDie;
  var lockKey = options.lockKey || "pig";
  if (!storage) throw new Error("The Pig Capsule requires its datastore.");

  async function writeState(state) {
    await storage.put({ _id: GAME_DOC_ID, state: state });
    return state;
  }

  async function readState() {
    var doc = await storage.get(GAME_DOC_ID);
    if (!doc) return writeState(newGame());
    return normalizeState(doc.state);
  }

  async function snapshot(context) {
    seatFor(context);
    return runExclusive(lockKey, async function () {
      return project(await readState());
    });
  }

  // An act returns {state, event}: the new projection for the caller and the
  // causal event for every watching Display. Both are built inside the lock,
  // so seq order on the wire is the order the rules actually ran in.
  async function act(context, actionId, args) {
    var seat = seatFor(context);
    return runExclusive(lockKey, async function () {
      var state = await readState();
      var previous = project(state);
      var next;
      if (actionId === "roll") next = roll(state, seat, rollDie);
      else if (actionId === "hold") next = hold(state, seat);
      else if (actionId === "reset") next = reset(state, seat);
      else throw new Error("Unknown Pig action '" + String(actionId) + "'.");
      next.eventSeq = previous.eventSeq + 1;
      await writeState(next);
      var projected = project(next);
      return { state: projected, event: buildEvent(seat, actionId, previous, projected) };
    });
  }

  return { snapshot: snapshot, act: act };
}

module.exports = {
  GAME_DOC_ID: GAME_DOC_ID,
  TARGET_SCORE: TARGET_SCORE,
  SEATS: SEATS,
  newGame: newGame,
  normalizeState: normalizeState,
  project: project,
  buildEvent: buildEvent,
  roll: roll,
  hold: hold,
  reset: reset,
  createRuntime: createRuntime,
};
