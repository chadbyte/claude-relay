var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var attachHomeChat = require("../lib/server-home-chat").attachHomeChat;

function settle() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function fixture(options) {
  var opts = options || {};
  var mateModel = Object.prototype.hasOwnProperty.call(opts, "mateModel") ? opts.mateModel : "fable";
  var mate = { id: "mate-a", name: "A", vendor: "claude", model: mateModel };
  var sessions = new Map();
  if (opts.existingSession) sessions.set(1, opts.existingSession);
  var created = [];
  var saved = [];
  var dispatched = [];
  var manager = {
    sessions: sessions,
    createSession: function (sessionOptions) {
      created.push(sessionOptions);
      var session = Object.assign({ localId: created.length + 10, history: [], lastActivity: Date.now() }, sessionOptions);
      sessions.set(session.localId, session);
      return session;
    },
    subscribeSession: function () { return function () {}; },
    saveSessionFile: opts.noPersistence ? null : function (session) { saved.push(session.localId); },
  };
  var messages = [];
  var ws = {
    readyState: 1,
    _clayUser: opts.unauthenticated ? null : { id: "u1" },
    send: function (value) { messages.push(JSON.parse(value)); },
  };
  var updates = [];
  var project = {
    getSessionManager: function () { return manager; },
    getVendorModelCatalog: function () {
      return Promise.resolve(opts.catalog || {
        status: "ready",
        error: "",
        models: [
          { value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" },
          { value: "sonnet", displayName: "Claude Sonnet" },
        ],
      });
    },
    sdk: opts.sdk === null ? null : (opts.sdk || {
      startQuery: function (session) { dispatched.push(session.model); },
      pushMessage: function (session) { dispatched.push(session.model); },
    }),
    getMemoryState: function () { return { entries: [], summary: "" }; },
    listKnowledgeFiles: function () { return []; },
    forEachClient: function (fn) { fn(ws); },
  };
  var handler = attachHomeChat({
    users: { isMultiUser: function () { return true; } },
    mates: {
      buildMateCtx: function (userId) { return { userId: userId }; },
      getAllMates: function () { return [mate]; },
      getMate: function () { return mate; },
      getMateDir: function () { return "/tmp/mate-a"; },
      updateMate: function (ctx, mateId, patch) {
        updates.push({ ctx: ctx, mateId: mateId, patch: patch });
        mate = Object.assign({}, mate, patch);
        return mate;
      },
    },
    projects: new Map([["mate-mate-a", project]]),
    addProject: function () {},
  });
  return { handler: handler, ws: ws, messages: messages, updates: updates, created: created, sessions: sessions, saved: saved, dispatched: dispatched, getMate: function () { return mate; } };
}

test("Mate model catalog responses preserve request correlation and vendor state", async function () {
  var f = fixture();
  assert.equal(f.handler.handleMessage(f.ws, { type: "home_mate_models_get", mateId: "mate-a", requestId: "catalog-1" }), true);
  await settle();
  assert.deepEqual(f.messages[0], {
    type: "home_mate_models_state",
    mateId: "mate-a",
    requestId: "catalog-1",
    vendor: "claude",
    model: "fable",
    models: [
      { value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" },
      { value: "sonnet", displayName: "Claude Sonnet" },
    ],
    status: "ready",
    error: "",
  });
  assert.equal(f.messages.some(function (message) { return message.type === "model_info"; }), false);
});

test("Mate model access errors remain correlated instead of leaving the UI loading", function () {
  var f = fixture({ unauthenticated: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_models_get", mateId: "mate-a", requestId: "catalog-auth" });
  assert.deepEqual(f.messages[0], { type: "home_mate_models_state", mateId: "mate-a", requestId: "catalog-auth", vendor: "", model: "", models: [], status: "error", error: "Not authenticated." });
});

test("Mate model selection validates the Mate vendor catalog before persistence", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "claude", model: "unknown", requestId: "set-invalid" });
  await settle();
  assert.equal(f.updates.length, 0);
  assert.equal(f.messages[0].type, "home_mate_model_result");
  assert.equal(f.messages[0].requestId, "set-invalid");
  assert.equal(f.messages[0].ok, false);
  assert.match(f.messages[0].error, /not available/);
});

test("valid Mate model selection persists and broadcasts the server-confirmed record", async function () {
  var f = fixture();
  f.handler.handleMessage(f.ws, { type: "home_mate_model_set", mateId: "mate-a", vendor: "claude", model: "claude-fable-5", requestId: "set-valid" });
  await settle();
  assert.deepEqual(f.updates[0], { ctx: { userId: "u1" }, mateId: "mate-a", patch: { model: "fable" } });
  assert.equal(f.getMate().model, "fable");
  assert.equal(f.messages[0].type, "mate_updated");
  assert.equal(f.messages[0].mate.model, "fable");
  assert.deepEqual(f.messages[1], { type: "home_mate_model_result", mateId: "mate-a", requestId: "set-valid", ok: true, vendor: "claude", model: "fable" });
});

test("Mate model resolver repairs invalid records with the saved catalog default then first entry", async function () {
  var preferred = fixture({
    mateModel: "removed-model",
    catalog: { status: "ready", models: ["fable", "sonnet"], defaultModel: "sonnet", error: "" },
  });
  preferred.handler.handleMessage(preferred.ws, { type: "home_mate_new_session", mateId: "mate-a", requestId: "new-preferred" });
  await settle();
  assert.equal(preferred.getMate().model, "sonnet");
  assert.equal(preferred.created[0].model, "sonnet");
  assert.equal(preferred.messages[0].type, "mate_updated");
  assert.equal(preferred.messages[0].mate.model, "sonnet");

  var first = fixture({
    mateModel: "removed-model",
    catalog: { status: "ready", models: [{ displayName: "Unavailable heading" }, "fable", "sonnet"], defaultModel: "removed-default", error: "" },
  });
  first.handler.handleMessage(first.ws, { type: "home_mate_new_session", mateId: "mate-a", requestId: "new-first" });
  await settle();
  assert.equal(first.getMate().model, "fable");
  assert.equal(first.created[0].model, "fable");
});

test("catalog failures create no Home session and return an actionable correlated error", async function () {
  var f = fixture({ mateModel: null, catalog: { status: "error", models: [], error: "Vendor authentication expired. Reconnect the vendor and try again." } });
  f.handler.handleMessage(f.ws, { type: "home_mate_new_session", mateId: "mate-a", requestId: "new-error" });
  await settle();
  assert.equal(f.created.length, 0);
  assert.equal(f.messages[0].type, "home_mate_error");
  assert.equal(f.messages[0].requestId, "new-error");
  assert.equal(f.messages[0].code, "model_unavailable");
  assert.match(f.messages[0].text, /authentication expired/);
});

test("catalog outages do not block exact or default resume of concrete sessions", async function () {
  var exactSession = { localId: 1, cliSessionId: "exact-ready", ownerId: "u1", vendor: "codex", model: "gpt-5.6", history: [], lastActivity: 20 };
  var exact = fixture({ mateModel: null, existingSession: exactSession, catalog: { status: "error", models: [], error: "Vendor authentication expired." } });
  exact.handler.handleMessage(exact.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "exact-ready", requestId: "exact-offline" });
  await settle();
  assert.equal(exact.messages[0].type, "home_mate_history");
  assert.equal(exact.messages[0].model, "gpt-5.6");
  assert.equal(exact.messages[0].requestId, "exact-offline");
  assert.deepEqual(exact.saved, []);
  assert.deepEqual(exact.updates, []);

  var latestSession = { localId: 1, cliSessionId: "latest-ready", ownerId: "u1", vendor: "claude", model: "sonnet", history: [], lastActivity: 30 };
  var latest = fixture({ mateModel: null, existingSession: latestSession, catalog: { status: "error", models: [], error: "Vendor authentication expired." } });
  latest.handler.handleMessage(latest.ws, { type: "home_mate_open", mateId: "mate-a", requestId: "default-offline" });
  await settle();
  assert.equal(latest.messages[0].type, "home_mate_history");
  assert.equal(latest.messages[0].sessionId, "latest-ready");
  assert.equal(latest.messages[0].model, "sonnet");
  assert.deepEqual(latest.saved, []);
  assert.deepEqual(latest.updates, []);
});

test("legacy model-less sessions commit once while concrete sessions remain immutable", async function () {
  var legacySession = { localId: 1, cliSessionId: "legacy", ownerId: "u1", vendor: "claude", model: null, history: [], lastActivity: 20 };
  var legacy = fixture({ mateModel: "sonnet", existingSession: legacySession });
  legacy.handler.handleMessage(legacy.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "legacy", requestId: "legacy-open" });
  await settle();
  assert.equal(legacySession.model, "sonnet");
  assert.deepEqual(legacy.saved, [1]);
  legacy.handler.handleMessage(legacy.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "legacy", requestId: "legacy-reopen" });
  await settle();
  assert.deepEqual(legacy.saved, [1]);

  var concreteSession = { localId: 1, cliSessionId: "concrete", ownerId: "u1", vendor: "claude", model: "fable", history: [], lastActivity: 20 };
  var concrete = fixture({ mateModel: "sonnet", existingSession: concreteSession });
  concrete.handler.handleMessage(concrete.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "concrete", requestId: "concrete-open" });
  await settle();
  assert.equal(concreteSession.model, "fable");
  assert.deepEqual(concrete.saved, []);
});

test("legacy session mutation waits for metadata persistence capability", async function () {
  var session = { localId: 1, cliSessionId: "legacy-no-save", ownerId: "u1", vendor: "legacy-vendor", model: null, history: [], lastActivity: 20 };
  var f = fixture({ mateModel: "sonnet", existingSession: session, noPersistence: true });
  f.handler.handleMessage(f.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "legacy-no-save", requestId: "legacy-no-save-open" });
  await settle();
  assert.equal(session.vendor, "legacy-vendor");
  assert.equal(session.model, null);
  assert.deepEqual(f.updates, []);
  assert.equal(f.messages[0].type, "home_mate_error");
  assert.equal(f.messages[0].requestId, "legacy-no-save-open");
  assert.equal(f.messages[0].sessionId, "legacy-no-save");
  assert.equal(f.messages[0].code, "model_unavailable");
  assert.match(f.messages[0].text, /persist/);
});

test("Home send resolves a legacy model before dispatch and blocks when no catalog is available", async function () {
  var session = { localId: 1, cliSessionId: "legacy-send", ownerId: "u1", vendor: "claude", model: "", history: [], lastActivity: 20 };
  var ready = fixture({ mateModel: "sonnet", existingSession: session });
  ready.handler.handleMessage(ready.ws, { type: "home_mate_session_open", mateId: "mate-a", sessionId: "legacy-send", requestId: "send-open" });
  await settle();
  ready.handler.handleMessage(ready.ws, { type: "home_mate_send", mateId: "mate-a", sessionId: "legacy-send", requestId: "send-open", text: "Hello" });
  await settle();
  assert.deepEqual(ready.dispatched, ["sonnet"]);

  var blockedSession = { localId: 1, cliSessionId: "blocked", ownerId: "u1", vendor: "claude", model: null, history: [], lastActivity: 20 };
  var blocked = fixture({ mateModel: null, existingSession: blockedSession, catalog: { status: "empty", models: [], error: "No installed models." } });
  blocked.ws._homeChatTap = { mateId: "mate-a", sessionId: 1, sessionReference: "blocked", requestId: "blocked-send" };
  blocked.handler.handleMessage(blocked.ws, { type: "home_mate_send", mateId: "mate-a", sessionId: "blocked", requestId: "blocked-send", text: "Hello" });
  await settle();
  assert.deepEqual(blocked.dispatched, []);
  assert.equal(blocked.messages[0].code, "model_unavailable");
  assert.equal(blocked.messages[0].requestId, "blocked-send");
});

test("new Home sessions inherit the Mate model while existing sessions remain unchanged", async function () {
  var fresh = fixture({ mateModel: "sonnet" });
  fresh.handler.handleMessage(fresh.ws, { type: "home_mate_open", mateId: "mate-a" });
  await settle();
  fresh.handler.handleMessage(fresh.ws, { type: "home_mate_new_session", mateId: "mate-a" });
  await settle();
  assert.equal(fresh.created.length, 2);
  assert.deepEqual(fresh.created.map(function (options) { return [options.vendor, options.model]; }), [["claude", "sonnet"], ["claude", "sonnet"]]);

  var existingSession = { localId: 1, cliSessionId: "existing", ownerId: "u1", vendor: "claude", model: "fable", history: [], lastActivity: 20 };
  var existing = fixture({ mateModel: "sonnet", existingSession: existingSession });
  existing.handler.handleMessage(existing.ws, { type: "home_mate_open", mateId: "mate-a" });
  await settle();
  assert.equal(existing.created.length, 0);
  assert.equal(existingSession.model, "fable");
});

test("Mate model messages route through Home ownership and cannot bypass catalog validation", function () {
  var root = path.join(__dirname, "..");
  var projectSource = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  var schemaSource = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");
  var matesSource = fs.readFileSync(path.join(root, "lib/server-mates.js"), "utf8");
  var homeSource = fs.readFileSync(path.join(root, "lib/server-home-chat.js"), "utf8");
  var homeModelsSource = fs.readFileSync(path.join(root, "lib/server-home-models.js"), "utf8");
  assert.match(projectSource, /home_mate_models_get[\s\S]*home_mate_model_set[\s\S]*opts\.onDmMessage/);
  assert.match(schemaSource, /"home_mate_models_get"[\s\S]*"home_mate_model_set"[\s\S]*"home_mate_models_state"[\s\S]*"home_mate_model_result"/);
  assert.match(homeSource, /findMateProject\(userId, msg\.mateId, true\)/);
  assert.match(homeModelsSource, /catalogModel\(catalog\.models \|\| \[\], msg\.model\)/);
  assert.match(matesSource, /hasOwnProperty\.call\(msg\.updates, "model"\)[\s\S]*Use the Mate model selector/);
});
