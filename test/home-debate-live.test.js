var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attachDebate = require("../lib/project-debate").attachDebate;
var createSessionManager = require("../lib/sessions").createSessionManager;
var mates = require("../lib/mates");
var homeEvents = require("../lib/server-home-chat-events");

function settle() { return new Promise(function (resolve) { setImmediate(resolve); }); }

function fixture(home) {
  var originalGetMate = mates.getMate;
  var originalBuildMateCtx = mates.buildMateCtx;
  mates.getMate = function (ctx, id) {
    return {
      id: id,
      name: id === "builtin:clay" ? "Clay" : "Panel",
      vendor: "claude",
      profile: {
        displayName: id === "builtin:clay" ? "Clay" : "Panel",
        avatarStyle: "imprint",
        avatarSeed: id,
        avatarColor: "#555",
        avatarCustom: "data:image/svg+xml," + encodeURIComponent(id)
      }
    };
  };
  mates.buildMateCtx = function (userId) { return { userId: userId }; };
  var sessions = new Map();
  var created = 0;
  var events = [];
  var mentionOptions = [];
  var session = { localId: 7, ownerId: "user-a", title: "Debate planning", history: [], homeDebatePlanning: home === true, homeDebatePhase: home === true ? "planning" : null, debateSetupMode: home === true, isProcessing: home === true, queryInstance: { close: function () {} }, abortController: { abort: function () {} }, messageQueue: { end: function () {} } };
  sessions.set(session.localId, session);
  var manager = {
    sessions: sessions,
    createSession: function (options, ws) { created++; var next = { localId: 7 + created, ownerId: options && options.ownerId, history: [] }; sessions.set(next.localId, next); if (ws) ws._clayActiveSession = next.localId; return next; },
    saveSessionFile: function () {}, switchSession: function () {},
    sendAndRecord: function (target, event) { target.history.push(event); events.push({ session: target, event: event }); },
  };
  var engine = attachDebate({
    cwd: "/tmp/clay-home-debate-live-test", slug: "mate-builtin:clay", isMate: false,
    projectOwnerId: "user-a", send: function () {}, sendTo: function () {}, sendToSession: function () {}, sm: manager,
    sdk: { createMentionSession: function (options) { mentionOptions.push(options); return Promise.resolve({ isAlive: function () { return true; }, pushMessage: function () {}, close: function () {} }); } },
    getMateProfile: function (ctx, id) { return { name: id === "builtin:clay" ? "Clay" : "Panel", avatarStyle: "imprint", avatarSeed: id, avatarColor: "#555", avatarCustom: "data:image/svg+xml," + encodeURIComponent(id) }; },
    loadMateClaudeMd: function () { return ""; }, loadMateDigests: function () { return ""; }, hydrateImageRefs: function () {}, onProcessingChanged: function () {},
    getLinuxUserForSession: function () { return null; }, getSessionForWs: function () { return session; }, updateMemorySummary: function () {}, initMemorySummary: function () {},
  });
  function restore() { mates.getMate = originalGetMate; mates.buildMateCtx = originalBuildMateCtx; }
  return { engine: engine, manager: manager, session: session, events: events, mentionOptions: mentionOptions, created: function () { return created; }, restore: restore };
}

function brief() { return { topic: "Housing policy", format: "round_table", panelists: [{ mateId: "panel-1", role: "Analyst", brief: "Examine trade-offs" }] }; }

test("Home approval reuses the exact planning session and projects canonical live turns", async function (t) {
  var f = fixture(true);
  t.after(f.restore);
  var ws = { _clayUser: { id: "user-a" }, _homeChatTap: { mateSlug: "mate-builtin:clay", sessionId: 7 }, _clayActiveSession: 99 };
  assert.deepEqual(f.engine.handleMcpDebateApproval(f.session, brief(), "builtin:clay", ws), { ok: true });
  await settle();
  assert.equal(f.created(), 0);
  assert.equal(f.manager.sessions.size, 1);
  assert.equal(ws._clayActiveSession, 7);
  assert.equal(f.session.homeDebatePhase, "live");
  assert.equal(f.session.title, "Debate: Housing policy");
  assert.equal(f.session.debateState.phase, "live");
  assert.deepEqual(f.events.slice(0, 2).map(function (entry) { return entry.event.type; }), ["debate_started", "debate_turn"]);
  assert.equal(f.events[0].session, f.session);
  assert.equal(f.events[1].event.mateName, "Clay");
  assert.equal(f.events[1].event.avatarSeed, "builtin:clay");
  assert.match(f.events[1].event.avatarCustom, /builtin%3Aclay/);
  f.mentionOptions[0].onActivity("Thinking");
  f.mentionOptions[0].onDelta("Opening ");
  f.mentionOptions[0].onDone("Opening statement without a panel call.");
  var types = f.events.map(function (entry) { return entry.event.type; });
  assert.deepEqual(types.slice(2, 6), ["debate_activity", "debate_stream", "debate_turn_done", "debate_conclude_confirm"]);
  assert.equal(f.engine.handleHomeControl(ws, { action: "conclude", response: "end" }, f.session), true);
  assert.equal(f.session.homeDebatePhase, "ended");
  assert.equal(f.events[f.events.length - 1].event.type, "debate_ended");
  var projected = f.events.map(function (entry) { return homeEvents.transformEvent(entry.event, "builtin:clay", f.session, "request-a", "durable-a"); }).filter(Boolean);
  assert.equal(projected.every(function (event) { return event.type === "home_debate_event"; }), true);
  assert.equal(projected[1].sessionId, "durable-a");
  assert.equal(projected[1].requestId, "request-a");
  assert.equal(projected[1].avatarSeed, "builtin:clay");
  assert.match(projected[1].avatarCustom, /builtin%3Aclay/);
});

test("legacy project approval still creates a dedicated live debate session", function (t) {
  var f = fixture(false);
  t.after(f.restore);
  var ws = { _clayUser: { id: "user-a" }, _clayActiveSession: 7 };
  f.engine.handleMcpDebateApproval(f.session, brief(), "builtin:clay", ws);
  assert.equal(f.created(), 1);
  assert.equal(f.manager.sessions.size, 2);
  assert.equal(f.session._debate, undefined);
});

test("Home live history restores one finalized turn without duplicating streamed text", function () {
  var history = [
    { type: "debate_started", topic: "Housing", moderatorId: "builtin:clay", moderatorName: "Clay", panelists: [{ mateId: "panel-1", name: "Panel", role: "Analyst" }] },
    { type: "debate_turn", turnId: "d:1", mateId: "builtin:clay", mateName: "Clay", role: "moderator", round: 1, avatarStyle: "imprint", avatarSeed: "clay-seed", avatarCustom: "data:image/svg+xml,clay" },
    { type: "debate_stream", turnId: "d:1", mateId: "builtin:clay", delta: "Hello " },
    { type: "debate_stream", turnId: "d:1", mateId: "builtin:clay", delta: "panel" },
    { type: "debate_turn_done", turnId: "d:1", mateId: "builtin:clay", mateName: "Clay", role: "moderator", round: 1, text: "Hello panel" },
    { type: "debate_ended", topic: "Housing", round: 1, reason: "interrupted" },
  ];
  var messages = homeEvents.historyToHomeChat(history, true);
  var turns = messages.filter(function (message) { return message.role === "debate_turn"; });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, "Hello panel");
  assert.equal(turns[0].status, "done");
  assert.equal(turns[0].mateName, "Clay");
  assert.equal(turns[0].avatarSeed, "clay-seed");
  assert.equal(turns[0].avatarCustom, "data:image/svg+xml,clay");
  assert.equal(messages.find(function (message) { return message.role === "debate_header"; }).phase, "interrupted");
});

test("Home live debate survives websocket reconnect but a restarted runtime restores as interrupted", async function (t) {
  var f = fixture(true);
  t.after(f.restore);
  var ws = { _clayUser: { id: "user-a" }, _homeChatTap: { mateSlug: "mate-builtin:clay", sessionId: 7 }, _clayActiveSession: 7 };
  f.engine.handleMcpDebateApproval(f.session, brief(), "builtin:clay", ws);
  await settle();
  var activeRuntime = f.session._debate;
  f.engine.restoreDebateState(ws);
  assert.equal(f.session._debate, activeRuntime);
  assert.equal(f.session.homeDebatePhase, "live");
  delete f.session._debate;
  f.engine.restoreDebateState(ws);
  assert.equal(f.session.homeDebatePhase, "interrupted");
  assert.equal(f.session.debateState.phase, "interrupted");
  assert.equal(f.session.history.filter(function (event) { return event.type === "debate_ended" && event.reason === "interrupted"; }).length, 1);
  f.engine.restoreDebateState(ws);
  assert.equal(f.session.history.filter(function (event) { return event.type === "debate_ended" && event.reason === "interrupted"; }).length, 1);
});

test("Home debate identity and phase persist with the exact session", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-home-debate-phase-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var options = { cwd: path.join(root, "project"), sessionsBase: path.join(root, "sessions"), cliSessionsDir: path.join(root, "cli"), send: function () {} };
  var first = createSessionManager(options);
  var session = first.createSessionRaw({ cliSessionId: "11111111-2222-4333-8444-555555555555", vendor: "claude", model: "sonnet" });
  session.debateSetupMode = true;
  session.homeDebatePlanning = true;
  session.homeDebatePhase = "live";
  session.title = "Debate planning";
  first.saveSessionFile(session);
  var second = createSessionManager(options);
  var restored = Array.from(second.sessions.values())[0];
  assert.equal(restored.cliSessionId, session.cliSessionId);
  assert.equal(restored.debateSetupMode, true);
  assert.equal(restored.homeDebatePlanning, true);
  assert.equal(restored.homeDebatePhase, "live");
  assert.equal(restored.title, "Debate planning");
});

test("Home debate gives every Mate and participant the same left identity rail", function () {
  var root = path.join(__dirname, "..");
  var css = fs.readFileSync(path.join(root, "lib/public/css/home-debate-live.css"), "utf8");
  assert.match(css, /\.home-debate-live-turn\.msg-assistant,[\s\S]*grid-template-columns: 34px minmax\(0, 1fr\)/);
  assert.match(css, /\.home-debate-live-turn > \.dm-bubble-avatar,[\s\S]*\.home-debate-live-user > \.dm-bubble-avatar \{[\s\S]*width: 34px;[\s\S]*height: 34px;/);
  assert.doesNotMatch(css, /home-debate-live-user\.msg-user \{ grid-template-columns: minmax|home-debate-live-user \.dm-bubble-content \{ display: contents|home-debate-live-user \.dm-bubble-header \{ grid-column/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.home-debate-live-turn\.msg-assistant,[\s\S]*\.home-debate-live-user\.msg-user \{ grid-template-columns: 32px minmax\(0, 1fr\); gap: 9px;/);
});
