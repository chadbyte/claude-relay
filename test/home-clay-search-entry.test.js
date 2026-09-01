var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var attachHomeClayEntry = require("../lib/server-home-clay-entry").attachHomeClayEntry;
var transformEvent = require("../lib/server-home-chat-events").transformEvent;

function fixture(modelError) {
  var sessions = new Map();
  var nextId = 1;
  var calls = { starts: [], histories: [], taps: [], lists: 0, errors: [] };
  var manager = {
    sessions: sessions,
    createSession: function (options) {
      var session = { localId: nextId++, ownerId: options.ownerId, vendor: options.vendor, model: options.model, history: [], isProcessing: false };
      sessions.set(session.localId, session);
      return session;
    },
    sendAndRecord: function (session, event) { session.history.push(event); },
    saveSessionFile: function () {},
  };
  var found = { mate: { id: "clay-id", builtinKey: "clay" }, ctx: { getSessionManager: function () { return manager; }, sdk: { startQuery: function (session, text) { calls.starts.push({ session: session, text: text }); } } } };
  var entry = attachHomeClayEntry({
    findMateProject: function (userId, mateId) { assert.equal(mateId, null); return found; },
    ownsSession: function (session, userId) { return session.ownerId === userId; },
    sessionReference: function (session) { return session.cliSessionId || "local:" + session.localId; },
    setupSearchTap: function (ws, selected, localId, requestId) { calls.taps.push({ localId: localId, requestId: requestId }); },
    sendHistory: function (ws, selected, session, requestId) { calls.histories.push({ session: session, requestId: requestId, processing: session.isProcessing }); },
    sendSessionList: function () { calls.lists++; },
    sendError: function () { calls.errors.push(Array.prototype.slice.call(arguments)); },
    sendModelError: function (ws, selected, msg, error, sessionId) { calls.errors.push({ error: error.message, sessionId: sessionId }); },
    homeModels: { resolveMateModel: function () { if (modelError) return Promise.reject(new Error("Choose a model")); return Promise.resolve({ vendor: "codex", model: "gpt-5.6-sol" }); } },
  });
  return { entry: entry, manager: manager, calls: calls };
}

test("global Ask Clay creates one exact owned session and records the visible user query before execution", async function () {
  var value = fixture(false);
  var ws = { readyState: 1 };
  await value.entry.start(ws, "user-1", { requestId: "request-1", text: "Find my conversation about fruit", mateId: "forged" });
  assert.equal(value.manager.sessions.size, 1);
  var session = Array.from(value.manager.sessions.values())[0];
  assert.equal(session.ownerId, "user-1");
  assert.equal(session.vendor, "codex");
  assert.equal(session.model, "gpt-5.6-sol");
  assert.equal(session.homeClayEntryMode, "search");
  assert.equal(session.homeClayEntryRequestId, "request-1");
  assert.deepEqual(session.history, [{ type: "user_message", text: "Find my conversation about fruit" }]);
  assert.equal(value.calls.histories[0].processing, true);
  assert.equal(value.calls.starts[0].session, session);
  assert.match(value.calls.starts[0].text, /global search[\s\S]*Search by meaning[\s\S]*User request:\nFind my conversation about fruit/);
  assert.match(value.calls.starts[0].text, /use search_workspace_history before any other investigation/);
  assert.match(value.calls.starts[0].text, /at most three focused search passes/);
  assert.match(value.calls.starts[0].text, /Do not use Bash, filesystem scans, or generic agents/);
});

test("global Ask Clay is idempotent per owner and request while new requests create distinct chats", async function () {
  var value = fixture(false);
  var msg = { requestId: "request-1", text: "Find apples" };
  await value.entry.start({ readyState: 1 }, "user-1", msg);
  await value.entry.start({ readyState: 1 }, "user-1", msg);
  assert.equal(value.manager.sessions.size, 1);
  assert.equal(value.calls.starts.length, 1);
  await value.entry.start({ readyState: 1 }, "user-2", msg);
  assert.equal(value.manager.sessions.size, 2);
  assert.equal(value.calls.starts.length, 2);
  await value.entry.start({ readyState: 1 }, "user-1", { requestId: "request-2", text: "Find pears" });
  assert.equal(value.manager.sessions.size, 3);
  assert.equal(value.calls.starts.length, 3);
});

test("model failure does not strand an empty Ask Clay session", async function () {
  var value = fixture(true);
  await value.entry.start({ readyState: 1 }, "user-1", { requestId: "request-1", text: "Find fruit" });
  assert.equal(value.manager.sessions.size, 0);
  assert.equal(value.calls.starts.length, 0);
  assert.match(value.calls.errors[0].error, /Choose a model/);
});

test("Ask Clay projects changing sanitized search stages without leaking tool details", function () {
  var session = { homeClayEntryMode: "search", model: "gpt-5.6-sol", vendor: "codex" };
  var thinking = transformEvent({ type: "thinking_start" }, "clay-id", session, "request-1", "session-1");
  var searching = transformEvent({ type: "tool_start", name: "search_workspace_history", input: { query: "secret" } }, "clay-id", session, "request-1", "session-1");
  var reviewing = transformEvent({ type: "tool_result", content: "private transcript" }, "clay-id", session, "request-1", "session-1");
  assert.deepEqual([thinking.phase, searching.phase, reviewing.phase], ["thinking", "searching", "reviewing"]);
  assert.equal(searching.step, 1);
  assert.equal(reviewing.step, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(searching, "name"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(searching, "input"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(reviewing, "content"), false);
});

test("global search is deterministic first and exposes an explicit branded Clay chat handoff", function () {
  var root = path.join(__dirname, "..");
  var palette = fs.readFileSync(path.join(root, "lib/public/modules/command-palette.js"), "utf8");
  var widget = fs.readFileSync(path.join(root, "lib/public/modules/search-clay-chat.js"), "utf8");
  var markup = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var project = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  var schema = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");
  assert.match(markup, /cmd-palette-searchbar-brand[\s\S]*clay-studio-symbol\.png[\s\S]*Search or ask Clay/);
  assert.match(palette, /fetch\("\/api\/palette\/search\?q=" \+ encodeURIComponent\(query\)/);
  assert.match(palette, /type: "ask-clay"/);
  assert.match(palette, /No exact matches\. Clay can search by meaning\./);
  assert.doesNotMatch(palette, /New Mate|group-label">Mates|group-label">Commands|group-label">Users/);
  assert.doesNotMatch(palette, /group-label">Projects|type: "project"/);
  assert.match(widget, /type: "home_clay_ask"/);
  assert.match(widget, /openHomeConversation\(mateId, sessionId\)/);
  assert.match(widget, /Open this conversation in Home/);
  assert.match(widget, /Search pass " \+ state\.step/);
  assert.match(widget, /Trying another search route/);
  assert.match(widget, /previousTranscript\.scrollHeight - previousTranscript\.scrollTop/);
  assert.match(project, /msg\.type === "home_clay_ask"[\s\S]*opts\.onDmMessage\(ws, msg, slug\)/);
  assert.match(schema, /"home_clay_ask"[\s\S]*direction: "c2s"/);
});
