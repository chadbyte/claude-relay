var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var attachConnection = require("../lib/project-connection").attachConnection;

// The keep-alive handler reads nothing from the surrounding project, so the
// context only needs a send path and the fields attachConnection destructures.
function fixture() {
  var sent = [];
  var connection = attachConnection({
    cwd: "/srv/example",
    slug: "example",
    clients: new Set(),
    sendTo: function (ws, msg) {
      // Mirrors the real sendTo: only ever writes to an open socket.
      if (ws && ws.readyState === 1) sent.push({ ws: ws, msg: msg });
    },
    opts: {},
  });
  return { connection: connection, sent: sent };
}

function socket() {
  return { readyState: 1 };
}

test("the project socket answers a ping with a pong", function () {
  var f = fixture();
  var ws = socket();

  assert.equal(f.connection.handleKeepaliveMessage(ws, { type: "ping" }), true,
    "the message is reported as handled so no other module sees it");
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].ws, ws, "the reply goes to the exact socket that pinged");
  assert.deepEqual(f.sent[0].msg, { type: "pong" },
    "the reply is a fixed pong and carries no identity or state");
  assert.deepEqual(Object.keys(f.sent[0].msg), ["type"]);

  // Repeated pings are answered independently and accumulate no state.
  f.connection.handleKeepaliveMessage(ws, { type: "ping" });
  f.connection.handleKeepaliveMessage(ws, { type: "ping" });
  assert.equal(f.sent.length, 3);
  for (var i = 0; i < f.sent.length; i++) assert.deepEqual(f.sent[i].msg, { type: "pong" });
});

test("unrelated messages are not claimed and produce no reply", function () {
  var f = fixture();
  var ws = socket();
  var others = [
    { type: "message", text: "hello" },
    { type: "new_session" },
    { type: "pong" },
    { type: "PING" },
    { type: "ping_extra" },
    { type: "project_logs_list", requestId: "r1" },
  ];
  for (var i = 0; i < others.length; i++) {
    assert.equal(f.connection.handleKeepaliveMessage(ws, others[i]), false,
      others[i].type + " must fall through to the normal dispatch chain");
  }
  assert.equal(f.sent.length, 0, "nothing is written for a message this handler does not own");
});

test("malformed input fails safe instead of throwing", function () {
  var f = fixture();
  var ws = socket();
  var malformed = [null, undefined, "ping", 42, true, [], function () {}];
  for (var i = 0; i < malformed.length; i++) {
    var value = malformed[i];
    assert.doesNotThrow(function () { f.connection.handleKeepaliveMessage(ws, value); });
    assert.equal(f.connection.handleKeepaliveMessage(ws, value), false);
  }
  // An object with no type, or a prototype-less object, is equally inert.
  assert.equal(f.connection.handleKeepaliveMessage(ws, {}), false);
  assert.equal(f.connection.handleKeepaliveMessage(ws, Object.create(null)), false);
  assert.equal(f.sent.length, 0);

  // A closed socket is filtered by the shared sendTo, not by this handler.
  var closed = { readyState: 3 };
  assert.equal(f.connection.handleKeepaliveMessage(closed, { type: "ping" }), true);
  assert.equal(f.sent.length, 0, "no write is attempted on a socket that is not open");
});

test("the keep-alive is dispatched from project.js without inline logic", function () {
  var projectSource = fs.readFileSync(path.join(__dirname, "..", "lib/project.js"), "utf8");
  var handler = projectSource.slice(projectSource.indexOf("function handleMessage(ws, msg) {"));
  handler = handler.slice(0, handler.indexOf("ws._clayHomeDebateSlug"));

  // Exactly one delegating line, before any routing, with no ping logic inline.
  assert.match(handler, /if \(_connection && _connection\.handleKeepaliveMessage\(ws, msg\)\) return;/);
  assert.equal(/"pong"/.test(handler), false, "the reply is not constructed in project.js");
  assert.equal(/msg\.type === "ping"/.test(handler), false, "the type check is not duplicated in project.js");
});

test("the global socket keep-alive is unchanged", function () {
  var globalWs = fs.readFileSync(path.join(__dirname, "..", "lib/server-global-ws.js"), "utf8");
  assert.match(globalWs, /if \(msg\.type === "ping"\) \{\s*\n\s*sendTo\(ws, \{ type: "pong" \}\);\s*\n\s*return;\s*\n\s*\}/,
    "the slug-less /ws handler still answers ping itself");
  // The project handler is additive; it does not reach into the global one.
  var connectionSource = fs.readFileSync(path.join(__dirname, "..", "lib/project-connection.js"), "utf8");
  assert.equal(/server-global-ws/.test(connectionSource), false);
});

test("the keep-alive handler neither reads identity nor mutates state", function () {
  var connectionSource = fs.readFileSync(path.join(__dirname, "..", "lib/project-connection.js"), "utf8");
  var start = connectionSource.indexOf("function handleKeepaliveMessage(ws, msg)");
  assert.notEqual(start, -1);
  var body = connectionSource.slice(start, connectionSource.indexOf("\n  }", start));
  assert.equal(/_clayUser|ownerId|clients\.|store|session/.test(body), false,
    "no identity or session state is touched");
  // Strip comparison operators, then any remaining "=" would be an assignment.
  var withoutComparisons = body.replace(/!==|===|!=|==|>=|<=/g, " ");
  assert.equal(withoutComparisons.indexOf("=") !== -1, false,
    "no assignment happens in the handler body");

  // Pinging must not disturb a live connection's bookkeeping.
  var f = fixture();
  var ws = { readyState: 1, _clayUser: { id: "owner" } };
  f.connection.handleKeepaliveMessage(ws, { type: "ping" });
  assert.deepEqual(Object.keys(ws).sort(), ["_clayUser", "readyState"],
    "the socket gains no new properties");
  assert.deepEqual(ws._clayUser, { id: "owner" });
});
