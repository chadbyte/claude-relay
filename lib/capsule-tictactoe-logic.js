// Server-side Logic for the Tic-Tac-Toe Capsule.
//
// Logic is the single source of truth. Every state change in the game happens
// through one of these functions and nowhere else: turn order, cell ownership,
// and win detection are enforced here, and the game record lives in the
// Capsule's own datastore. A human button click and a Mate clay_tool_act call
// arrive at the same act pipeline with the same rules, so neither party can
// break a rule the other is bound by, and neither sees state the other cannot.
//
// The two seats are "user" (X, first to move in a fresh game) and "mate" (O).
// The server resolves its own actor before calling in, and the human actor
// maps onto the user seat; seat is never read from caller-supplied text.
//
// Rules: seats alternate marks on a 3x3 board, cells numbered 0-8 left to
// right, top to bottom. Three in a row, column, or diagonal wins; a full board
// with no line is a draw. A finished game is frozen until someone resets it;
// only the user may reset a game in progress, because the Capsule belongs to
// the human, not to the Mate.

var GAME_DOC_ID = "game";
var BOARD_CELLS = 9;
var USER = "user";
var MATE = "mate";
var SEATS = [USER, MATE];
var SEAT_LABELS = { user: "You", mate: "Your Mate" };
var SEAT_MARKS = { user: "X", mate: "O" };
var WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

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

function otherSeat(seat) {
  return seat === USER ? MATE : USER;
}

function emptyBoard() {
  var board = [];
  for (var i = 0; i < BOARD_CELLS; i++) board.push(null);
  return board;
}

function newGame() {
  return {
    status: "playing",
    turn: USER,
    board: emptyBoard(),
    winner: null,
    eventSeq: 0,
  };
}

// Counters are ordering, not points: they only ever grow, so they carry no
// upper bound. eventSeq must survive a reset, because a Display that saw
// event N must treat anything at or below N as already rendered.
function safeCounter(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

// A stored game is data, not a promise about shape. Anything unreadable is
// replaced by a fresh game rather than trusted.
function normalizeState(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return newGame();
  if (SEATS.indexOf(stored.turn) === -1) return newGame();
  if (stored.status !== "playing" && stored.status !== "complete") return newGame();
  var board = emptyBoard();
  if (Array.isArray(stored.board)) {
    for (var i = 0; i < BOARD_CELLS; i++) {
      if (SEATS.indexOf(stored.board[i]) !== -1) board[i] = stored.board[i];
    }
  }
  return {
    status: stored.status,
    turn: stored.turn,
    board: board,
    winner: SEATS.indexOf(stored.winner) !== -1 ? stored.winner : null,
    eventSeq: safeCounter(stored.eventSeq),
  };
}

function lineWinner(board) {
  for (var i = 0; i < WIN_LINES.length; i++) {
    var line = WIN_LINES[i];
    var seat = board[line[0]];
    if (seat && board[line[1]] === seat && board[line[2]] === seat) return seat;
  }
  return null;
}

function boardFull(board) {
  for (var i = 0; i < BOARD_CELLS; i++) {
    if (board[i] === null) return false;
  }
  return true;
}

function requirePlayableTurn(state, seat) {
  if (state.status !== "playing") {
    throw new Error("This game is already over. Reset it to play again.");
  }
  if (state.turn !== seat) {
    throw new Error("This move is out of turn: " + SEAT_LABELS[state.turn] + " to play.");
  }
}

function mark(state, seat, args) {
  requirePlayableTurn(state, seat);
  var cell = args && typeof args === "object" ? args.cell : undefined;
  if (!Number.isInteger(cell) || cell < 0 || cell >= BOARD_CELLS) {
    throw new Error("The cell must be an integer from 0 to 8.");
  }
  if (state.board[cell] !== null) {
    throw new Error("Cell " + cell + " is already marked with " + SEAT_MARKS[state.board[cell]] + ".");
  }
  state.board[cell] = seat;
  var winner = lineWinner(state.board);
  if (winner) {
    state.status = "complete";
    state.winner = winner;
    return state;
  }
  if (boardFull(state.board)) {
    state.status = "complete";
    state.winner = null;
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

function statusText(state) {
  if (state.status !== "complete") {
    return SEAT_LABELS[state.turn] + " (" + SEAT_MARKS[state.turn] + ") to play.";
  }
  if (state.winner === USER) return "You (X) won this game.";
  if (state.winner === MATE) return "Your Mate (O) won this game.";
  return "The game ended in a draw.";
}

// The projection a Display renders and a Mate reads. It adds no meaning that
// is absent from state: every derived field is a restatement of the fields
// above. The per-cell fields exist because the floor's grid buttons bind to
// one scalar each.
function project(state) {
  var complete = state.status === "complete";
  var userTurn = !complete && state.turn === USER;
  var projection = {
    status: state.status,
    turn: state.turn,
    winner: state.winner,
    complete: complete,
    userTurn: userTurn,
    statusText: statusText(state),
    eventSeq: state.eventSeq,
  };
  for (var i = 0; i < BOARD_CELLS; i++) {
    var seat = state.board[i];
    projection["cell" + i] = seat ? SEAT_MARKS[seat] : "";
    projection["cell" + i + "Disabled"] = seat !== null || complete || !userTurn;
  }
  return projection;
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
  var lockKey = options.lockKey || "tictactoe";
  if (!storage) throw new Error("The Tic-Tac-Toe Capsule requires its datastore.");

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
      if (actionId === "mark") next = mark(state, seat, args);
      else if (actionId === "reset") next = reset(state, seat);
      else throw new Error("Unknown Tic-Tac-Toe action '" + String(actionId) + "'.");
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
  SEATS: SEATS,
  newGame: newGame,
  normalizeState: normalizeState,
  project: project,
  buildEvent: buildEvent,
  mark: mark,
  reset: reset,
  createRuntime: createRuntime,
};
