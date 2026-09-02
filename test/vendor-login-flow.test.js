var test = require("node:test");
var assert = require("node:assert");

var { attachVendorLogin } = require("../lib/project-vendor-login");

// Minimal terminal-manager stand-in with the surface project-vendor-login uses.
function createFakeTerminalManager(opts) {
  var options = opts || {};
  var nextId = 1;
  var terminals = new Map();

  return {
    created: [],
    closed: [],
    attached: [],
    create: function (cols, rows, osUserInfo, ownerWs, createOpts) {
      if (options.failCreate) return null;
      var id = nextId++;
      var session = { id: id, opts: createOpts || {}, osUserInfo: osUserInfo || null };
      terminals.set(id, session);
      this.created.push(session);
      return session;
    },
    attach: function (id, ws) { this.attached.push({ id: id, ws: ws }); },
    close: function (id) { terminals.delete(id); this.closed.push(id); },
    has: function (id) { return terminals.has(id); },
    list: function () {
      var out = [];
      terminals.forEach(function (s) { out.push({ id: s.id, title: (s.opts && s.opts.title) || "", kind: (s.opts && s.opts.kind) || "shell" }); });
      return out;
    },
    emitData: function (id, chunk) {
      var s = terminals.get(id);
      if (s && s.opts && s.opts.onData) s.opts.onData(chunk);
    },
    emitExit: function (id) {
      var s = terminals.get(id);
      if (!s) return;
      terminals.delete(id);
      if (s.opts && s.opts.onExit) s.opts.onExit(s);
    },
  };
}

function createHarness(opts) {
  var options = opts || {};
  var broadcasts = [];
  var direct = [];
  var shutdowns = [];

  var tm = createFakeTerminalManager(options.tm);
  var adapters = options.adapters || {
    codex: {
      vendor: "codex",
      shutdown: function () { shutdowns.push("codex"); return Promise.resolve(true); },
    },
  };

  var login = attachVendorLogin({
    slug: "demo",
    osUsers: !!options.osUsers,
    sm: options.sm || { sessions: new Map() },
    tm: tm,
    adapters: adapters,
    send: function (msg) { broadcasts.push(msg); },
    sendTo: function (ws, msg) { direct.push({ ws: ws, msg: msg }); },
    usersModule: options.usersModule || null,
    getOsUserInfoForWs: options.getOsUserInfoForWs || function () { return null; },
    getOsUserInfoForLinuxUser: options.getOsUserInfoForLinuxUser || function () { return null; },
    getLinuxUserForSession: options.getLinuxUserForSession || function () { return null; },
  });

  return {
    login: login,
    tm: tm,
    broadcasts: broadcasts,
    direct: direct,
    shutdowns: shutdowns,
    typesTo: function (ws) {
      return direct.filter(function (e) { return e.ws === ws; }).map(function (e) { return e.msg.type; });
    },
    lastOf: function (type) {
      var hits = broadcasts.filter(function (m) { return m.type === type; });
      return hits.length ? hits[hits.length - 1] : null;
    },
  };
}

function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

test("first auth_required starts one login terminal running the vendor login command", function () {
  var h = createHarness();
  var ws = {};

  var handled = h.login.handleVendorLoginMessage(ws, { type: "vendor_login_start", vendor: "codex", auto: true });

  assert.strictEqual(handled, true);
  assert.strictEqual(h.tm.created.length, 1);
  assert.strictEqual(h.tm.created[0].opts.initialInput, "codex login --device-auth\n");
  assert.strictEqual(h.tm.created[0].opts.kind, "vendor-login");

  var ready = h.direct.find(function (e) { return e.msg.type === "vendor_login_ready"; });
  assert.ok(ready, "requester is told which terminal to attach to");
  assert.strictEqual(ready.msg.vendor, "codex");
  assert.strictEqual(ready.msg.reused, false);
  assert.strictEqual(ready.msg.terminalId, h.tm.created[0].id);
});

test("further auto auth_required events never spawn a second login terminal or prompt", function () {
  var h = createHarness();
  var paneA = {};
  var paneB = {};

  h.login.handleVendorLoginMessage(paneA, { type: "vendor_login_start", vendor: "codex", auto: true });
  h.login.handleVendorLoginMessage(paneB, { type: "vendor_login_start", vendor: "codex", auto: true });
  h.login.handleVendorLoginMessage(paneA, { type: "vendor_login_start", vendor: "codex", auto: true });

  assert.strictEqual(h.tm.created.length, 1, "one login terminal for the whole project");
  assert.deepStrictEqual(
    h.typesTo(paneB),
    ["vendor_login_state"],
    "the second pane only learns a flow is running; it gets no vendor_login_ready"
  );
  assert.strictEqual(h.login.listFlows().length, 1);
});

test("a deliberate login request re-attaches to the live terminal instead of creating one", function () {
  var h = createHarness();
  var first = {};
  var second = {};

  h.login.handleVendorLoginMessage(first, { type: "vendor_login_start", vendor: "codex", auto: true });
  h.login.handleVendorLoginMessage(second, { type: "vendor_login_start", vendor: "codex" });

  assert.strictEqual(h.tm.created.length, 1);
  var ready = h.direct.filter(function (e) { return e.msg.type === "vendor_login_ready"; });
  assert.strictEqual(ready.length, 2);
  assert.strictEqual(ready[1].msg.reused, true);
  assert.strictEqual(ready[1].msg.terminalId, h.tm.created[0].id);
  assert.ok(h.tm.attached.some(function (a) { return a.ws === second; }), "re-attaches the requester to the existing PTY");
});

test("successful login restarts the vendor adapter, announces auth_refreshed and removes the terminal", async function () {
  var h = createHarness();
  var ws = {};
  h.login.handleVendorLoginMessage(ws, { type: "vendor_login_start", vendor: "codex", auto: true });
  var terminalId = h.tm.created[0].id;

  // Split across chunks and wrapped in ANSI, the way a PTY actually delivers it.
  h.tm.emitData(terminalId, "[32mSuccessfu");
  h.tm.emitData(terminalId, "lly logged in.[0m\r\n");

  await new Promise(function (resolve) { setTimeout(resolve, 2200); });
  await flush();

  assert.deepStrictEqual(h.shutdowns, ["codex"], "the app-server is torn down so the next query re-reads auth.json");
  var refreshed = h.lastOf("auth_refreshed");
  assert.ok(refreshed, "clients are told auth was reloaded");
  assert.strictEqual(refreshed.vendor, "codex");
  assert.strictEqual(refreshed.adapterRestarted, true);
  assert.deepStrictEqual(h.tm.closed, [terminalId], "the login terminal does not linger in the sidebar");
  assert.deepStrictEqual(h.login.listFlows(), [], "the flow record is cleared");
  assert.deepStrictEqual(h.lastOf("vendor_login_state").flows, []);
});

test("logging out does not read as a successful login", async function () {
  var h = createHarness();
  h.login.handleVendorLoginMessage({}, { type: "vendor_login_start", vendor: "codex", auto: true });
  h.tm.emitData(h.tm.created[0].id, "Successfully logged out\r\n");

  await flush();

  assert.deepStrictEqual(h.shutdowns, []);
  assert.strictEqual(h.login.listFlows().length, 1, "the flow stays open");
});

test("cancelling the flow kills the terminal without restarting the adapter", function () {
  var h = createHarness();
  var ws = {};
  h.login.handleVendorLoginMessage(ws, { type: "vendor_login_start", vendor: "codex", auto: true });
  var terminalId = h.tm.created[0].id;

  h.login.handleVendorLoginMessage(ws, { type: "vendor_login_cancel", vendor: "codex" });

  assert.deepStrictEqual(h.tm.closed, [terminalId]);
  assert.deepStrictEqual(h.shutdowns, [], "an abandoned login must not bounce the app-server");
  assert.deepStrictEqual(h.login.listFlows(), []);
});

test("a login terminal killed from the sidebar clears the flow so the next auth_required can retry", async function () {
  var h = createHarness();
  var ws = {};
  h.login.handleVendorLoginMessage(ws, { type: "vendor_login_start", vendor: "codex", auto: true });
  h.tm.emitExit(h.tm.created[0].id);
  await flush();

  assert.deepStrictEqual(h.login.listFlows(), []);
  assert.deepStrictEqual(h.shutdowns, [], "an exit with no success line must not bounce the app-server");

  h.login.handleVendorLoginMessage(ws, { type: "vendor_login_start", vendor: "codex", auto: true });
  assert.strictEqual(h.tm.created.length, 2, "a fresh flow is allowed once the previous one is gone");
});

test("the login terminal spawns as the identity the adapter will read credentials from", function () {
  var sessionOwner = { uid: 1201, gid: 1301, home: "/home/alice", user: "alice", shell: "/bin/bash" };
  var connectedUser = { uid: 1202, gid: 1302, home: "/home/bob", user: "bob", shell: "/bin/bash" };
  var sessions = new Map();
  sessions.set("s1", { localId: "s1", ownerId: "u-alice", vendor: "codex" });

  var h = createHarness({
    osUsers: true,
    sm: { sessions: sessions },
    getLinuxUserForSession: function (session) { return session.ownerId === "u-alice" ? "alice" : null; },
    getOsUserInfoForLinuxUser: function (name) { return name === "alice" ? sessionOwner : null; },
    getOsUserInfoForWs: function () { return connectedUser; },
  });

  // An admin opening someone else's session must still log in as the session
  // owner, because that is the HOME the adapter's app-server reads.
  h.login.handleVendorLoginMessage(
    { _clayUser: { id: "u-admin", role: "admin" } },
    { type: "vendor_login_start", vendor: "codex", auto: true, sessionId: "s1" }
  );

  assert.strictEqual(h.tm.created[0].osUserInfo.home, "/home/alice");
});

test("an unrelated viewer falls back to their own identity rather than borrowing the owner's", function () {
  var connectedUser = { uid: 1202, gid: 1302, home: "/home/bob", user: "bob", shell: "/bin/bash" };
  var sessions = new Map();
  sessions.set("s1", { localId: "s1", ownerId: "u-alice", vendor: "codex" });

  var h = createHarness({
    osUsers: true,
    sm: { sessions: sessions },
    getLinuxUserForSession: function () { return "alice"; },
    getOsUserInfoForLinuxUser: function () { return { uid: 1201, gid: 1301, home: "/home/alice", user: "alice" }; },
    getOsUserInfoForWs: function () { return connectedUser; },
  });

  h.login.handleVendorLoginMessage(
    { _clayUser: { id: "u-bob", role: "user" } },
    { type: "vendor_login_start", vendor: "codex", auto: true, sessionId: "s1" }
  );

  assert.strictEqual(h.tm.created[0].osUserInfo.home, "/home/bob");
});

test("shared adapters are not torn down on login, but auth_refreshed still fires", async function () {
  var shutdowns = [];
  var h = createHarness({
    adapters: {
      claude: {
        vendor: "claude",
        shared: true,
        shutdown: function () { shutdowns.push("claude"); return Promise.resolve(true); },
      },
    },
  });
  h.login.handleVendorLoginMessage({}, { type: "vendor_login_start", vendor: "claude", auto: true });
  h.tm.emitData(h.tm.created[0].id, "Login successful\r\n");

  await new Promise(function (resolve) { setTimeout(resolve, 2200); });
  await flush();

  assert.deepStrictEqual(shutdowns, [], "a project must not kill the cross-project Claude adapter");
  var refreshed = h.lastOf("auth_refreshed");
  assert.ok(refreshed);
  assert.strictEqual(refreshed.adapterRestarted, false);
});

test("terminal creation failure reports an error and leaves no flow behind", function () {
  var h = createHarness({ tm: { failCreate: true } });
  var ws = {};

  h.login.handleVendorLoginMessage(ws, { type: "vendor_login_start", vendor: "codex", auto: true });

  var err = h.direct.find(function (e) { return e.msg.type === "vendor_login_error"; });
  assert.ok(err);
  assert.deepStrictEqual(h.login.listFlows(), []);
});

test("terminal-less users cannot open a login flow", function () {
  var h = createHarness({
    usersModule: {
      getEffectivePermissions: function () { return { terminal: false }; },
    },
  });
  var ws = { _clayUser: { id: "u1", role: "user" } };

  h.login.handleVendorLoginMessage(ws, { type: "vendor_login_start", vendor: "codex", auto: true });

  assert.strictEqual(h.tm.created.length, 0);
  var err = h.direct.find(function (e) { return e.msg.type === "vendor_login_error"; });
  assert.ok(err);
  assert.match(err.msg.error, /not permitted/);
});

test("a reconnecting client is handed the live flow so it re-attaches instead of restarting", function () {
  var h = createHarness();
  h.login.handleVendorLoginMessage({}, { type: "vendor_login_start", vendor: "codex", auto: true });

  var reconnected = {};
  h.login.handleVendorLoginMessage(reconnected, { type: "vendor_login_state_request" });

  var state = h.direct.filter(function (e) { return e.ws === reconnected; })[0].msg;
  assert.strictEqual(state.type, "vendor_login_state");
  assert.strictEqual(state.flows.length, 1);
  assert.strictEqual(state.flows[0].vendor, "codex");
  assert.strictEqual(state.flows[0].terminalId, h.tm.created[0].id);
});

test("unknown vendors are rejected", function () {
  var h = createHarness();
  var ws = {};
  h.login.handleVendorLoginMessage(ws, { type: "vendor_login_start", vendor: "not-a-vendor" });
  assert.strictEqual(h.tm.created.length, 0);
  var err = h.direct.find(function (e) { return e.msg.type === "vendor_login_error"; });
  assert.ok(err);
});

test("unrelated messages fall through to the next handler", function () {
  var h = createHarness();
  assert.strictEqual(h.login.handleVendorLoginMessage({}, { type: "term_create" }), false);
});
