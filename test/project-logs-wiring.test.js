var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

var attachService = require("../lib/project-logs-service").attachProjectLogsService;
var projectLogs = require("../lib/project-logs");
var attachProjectLogs = projectLogs.attachProjectLogs;
var logsMcp = require("../lib/project-logs-mcp-server");
var logsStore = require("../lib/project-logs-store");
var schema = require("../lib/ws-schema").schema;

var PROJECT_TOOLS = ["list_logs", "search_logs", "read_log", "log_history", "create_log", "update_log", "link_log"];
var CLAY_TOOLS = ["list_project_logs", "search_project_logs", "read_project_log", "project_log_history"];

function storeFactory() {
  var base = fs.mkdtempSync(path.join(os.tmpdir(), "clay-logs-wire-"));
  var cache = new Map();
  return function (cwd) {
    if (!cache.has(cwd)) cache.set(cwd, logsStore.createProjectLogsStore({ root: cwd, baseDir: base }));
    return cache.get(cwd);
  };
}

function handle(status, sessions) {
  var manager = { sessions: new Map() };
  for (var i = 0; i < (sessions || []).length; i++) manager.sessions.set(sessions[i].localId, sessions[i]);
  return { getStatus: function () { return status; }, getSessionManager: function () { return manager; } };
}

function fixture(opts) {
  var options = opts || {};
  var session = { localId: 11, cliSessionId: "cli-11", ownerId: "owner", vendor: "claude" };
  var otherSession = { localId: 12, cliSessionId: "cli-12", ownerId: "member", vendor: "codex" };
  var mateSession = { localId: 21, cliSessionId: "cli-21", ownerId: "owner", vendor: "claude" };

  var projects = new Map();
  projects.set("app", handle({ slug: "app", path: "/srv/app", projectOwnerId: "owner", visibility: "private", allowedUsers: ["member"] }, [session, otherSession]));
  projects.set("secret", handle({ slug: "secret", path: "/srv/secret", projectOwnerId: "stranger", visibility: "private", allowedUsers: [] }, []));
  projects.set("mate-home", handle({ slug: "mate-home", path: "/srv/mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id" }, [mateSession]));

  var service = attachService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    resolveMate: function (ownerId, mateId) {
      return { id: mateId, createdBy: ownerId, builtinKey: options.builtinKey || "clay" };
    },
    canAccessProject: function (userId, status) {
      if (!status) return false;
      if (status.projectOwnerId === userId) return true;
      return (status.allowedUsers || []).indexOf(userId) >= 0;
    },
    findUserById: function (id) {
      if (id === "owner") return { id: "owner", displayName: "Owner" };
      if (id === "member") return { id: "member", displayName: "Member" };
      return null;
    },
    openStore: storeFactory(),
  });

  var sent = [];
  var attached = attachProjectLogs({
    service: service,
    sm: projects.get(options.mate ? "mate-home" : "app").getSessionManager(),
    projectSlug: options.mate ? "mate-home" : "app",
    getProjectOwnerId: function () { return "owner"; },
    isMate: !!options.mate,
    mateId: options.mate ? "mate-id" : null,
    sendTo: function (ws, message) { sent.push(message); },
  });

  return { attached: attached, sent: sent, session: session, otherSession: otherSession, mateSession: mateSession, service: service, projects: projects };
}

function ws(user) {
  return { _clayUser: user || null, readyState: 1 };
}

function last(sent) {
  return sent[sent.length - 1];
}

// --- WebSocket protocol ------------------------------------------------

test("the WebSocket round trip emits exactly the client protocol payloads", function () {
  var f = fixture();
  var owner = ws({ id: "owner", displayName: "Owner" });

  assert.equal(f.attached.handleLogsMessage(owner, { type: "project_log_create", requestId: "r1", kind: "session-note", title: "Cache decision", body: "Adopted an append-only log." }), true);
  var saved = last(f.sent);
  assert.equal(saved.type, "project_log_saved");
  assert.equal(saved.requestId, "r1");
  assert.equal(saved.entry.title, "Cache decision");
  assert.equal(saved.entry.body, "Adopted an append-only log.");
  assert.equal(saved.entry.kind, "session-note");
  assert.equal(saved.entry.revisions, 1);
  assert.equal(saved.entry.createdBy.type, "user");
  assert.equal(saved.entry.createdBy.userId, "owner");
  assert.equal(saved.entry.createdBy.displayName, "Owner");
  assert.match(saved.entry.ref, logsStore.REF_PATTERN);
  var ref = saved.entry.ref;

  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "r2", query: "" });
  var state = last(f.sent);
  assert.equal(state.type, "project_logs_state");
  assert.equal(state.requestId, "r2");
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].ref, ref);
  assert.equal(state.entries[0].revisions, 1);

  f.attached.handleLogsMessage(owner, { type: "project_log_read", requestId: "r3", ref: ref });
  var entryMsg = last(f.sent);
  assert.equal(entryMsg.type, "project_log_entry");
  assert.equal(entryMsg.requestId, "r3");
  assert.equal(entryMsg.entry.ref, ref);

  f.attached.handleLogsMessage(owner, { type: "project_log_update", requestId: "r4", ref: ref, title: "Cache decision", body: "Adopted an append-only log with revisions." });
  var updated = last(f.sent);
  assert.equal(updated.type, "project_log_saved");
  assert.equal(updated.requestId, "r4");
  assert.equal(updated.entry.revisions, 2);
  assert.equal(updated.entry.ref, ref, "the ref is stable across an update");

  // A search query returns the same full entry shape the index renders.
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "r5", query: "append-only" });
  var searched = last(f.sent);
  assert.equal(searched.type, "project_logs_state");
  assert.equal(searched.entries.length, 1);
  assert.equal(searched.entries[0].revisions, 2, "search rows carry a real revision count");
  assert.equal(searched.entries[0].body, "Adopted an append-only log with revisions.");

  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "r6", query: "nothing matches this" });
  assert.deepEqual(last(f.sent).entries, []);
});

test("identity and project scope are never taken from the message", function () {
  var f = fixture();
  var member = ws({ id: "member", displayName: "Member" });

  // Every spoofable field is present and must be ignored.
  f.attached.handleLogsMessage(member, {
    type: "project_log_create", requestId: "s1", kind: "decision", title: "Spoof attempt", body: "x",
    userId: "owner", user: { id: "owner" }, author: { userId: "owner", displayName: "Owner" },
    projectSlug: "secret", slug: "secret", ref: "log:aaaaaaaaaaaaaaaaaaaaaaaa",
  });
  var saved = last(f.sent);
  assert.equal(saved.type, "project_log_saved");
  assert.equal(saved.entry.createdBy.userId, "member", "attribution comes from ws._clayUser");
  assert.equal(saved.entry.createdBy.displayName, "Member");

  // The write landed in the bound project, not the one named in the message.
  var owner = ws({ id: "owner" });
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "s2", query: "" });
  assert.equal(last(f.sent).entries.length, 1, "the entry is in the bound project");

  var stranger = ws({ id: "stranger" });
  f.attached.handleLogsMessage(stranger, { type: "project_logs_list", requestId: "s3", query: "" });
  var denied = last(f.sent);
  assert.equal(denied.type, "project_logs_error");
  assert.equal(denied.requestId, "s3");
  assert.ok(denied.message);

  var anonymous = ws(null);
  f.attached.handleLogsMessage(anonymous, { type: "project_log_read", requestId: "s4", ref: saved.entry.ref });
  assert.equal(last(f.sent).type, "project_logs_error", "multi-user mode fails closed without an identified user");
});

test("shared-project members read and write with attribution preserved", function () {
  var f = fixture();
  var owner = ws({ id: "owner", displayName: "Owner" });
  var member = ws({ id: "member", displayName: "Member" });

  f.attached.handleLogsMessage(owner, { type: "project_log_create", requestId: "a1", kind: "incident", title: "Retry storm", body: "root cause pending" });
  var ref = last(f.sent).entry.ref;

  f.attached.handleLogsMessage(member, { type: "project_logs_list", requestId: "a2", query: "" });
  var visible = last(f.sent);
  assert.equal(visible.entries.length, 1, "a shared-project member reads the owner's entry");
  assert.equal(visible.entries[0].createdBy.displayName, "Owner");

  f.attached.handleLogsMessage(member, { type: "project_log_update", requestId: "a3", ref: ref, title: "Retry storm", body: "root cause: unbounded backoff" });
  var revised = last(f.sent);
  assert.equal(revised.type, "project_log_saved");
  assert.equal(revised.entry.createdBy.userId, "owner", "original authorship survives another member's edit");
  assert.equal(revised.entry.updatedBy.userId, "member");
});

test("Mate projects deny the Logs UI path and errors stay correlated", function () {
  var f = fixture({ mate: true });
  var owner = ws({ id: "owner" });

  assert.equal(f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "m1", query: "" }), true);
  var denied = last(f.sent);
  assert.equal(denied.type, "project_logs_error");
  assert.equal(denied.requestId, "m1");
  assert.match(denied.message, /Mate conversations/);

  f.attached.handleLogsMessage(owner, { type: "project_log_create", requestId: "m2", kind: "decision", title: "No", body: "No" });
  assert.equal(last(f.sent).type, "project_logs_error");

  // Unrelated and unknown message types are not claimed.
  assert.equal(f.attached.handleLogsMessage(owner, { type: "note_create" }), false);
  assert.equal(f.attached.handleLogsMessage(owner, { type: "project_log_delete", requestId: "m3" }), false);
});

test("a store error is reported as a correlated error, not a thrown handler", function () {
  var f = fixture();
  var owner = ws({ id: "owner" });
  assert.equal(f.attached.handleLogsMessage(owner, { type: "project_log_read", requestId: "e1", ref: "not-a-ref" }), true);
  var failed = last(f.sent);
  assert.equal(failed.type, "project_logs_error");
  assert.equal(failed.requestId, "e1");

  f.attached.handleLogsMessage(owner, { type: "project_log_create", requestId: "e2", kind: "decision", title: "   ", body: "x" });
  assert.equal(last(f.sent).type, "project_logs_error");

  f.attached.handleLogsMessage(owner, { type: "project_log_update", requestId: "e3", ref: "log:aaaaaaaaaaaaaaaaaaaaaaaa", title: "Ghost" });
  assert.equal(last(f.sent).type, "project_logs_error");
});

// --- MCP surface --------------------------------------------------------

test("a bound project session gets project-scoped tools with no projectSlug argument", function () {
  var f = fixture();
  var defs = f.attached.getToolDefs(f.session);
  assert.deepEqual(defs.map(function (d) { return d.name; }), PROJECT_TOOLS);
  for (var i = 0; i < defs.length; i++) {
    assert.equal(Object.keys(defs[i].inputSchema).indexOf("projectSlug"), -1, defs[i].name + " must not accept a project argument");
  }

  var adapter = { createToolServer: function (definition) { return definition; } };
  var server = f.attached.createMcpServer(adapter, f.session);
  assert.equal(server.name, "clay-logs");
  assert.equal(server.tools.length, 7);
});

test("session-bound MCP writes are attributed to the session and scoped to its project", async function () {
  var f = fixture();
  var defs = f.attached.getToolDefs(f.session);
  function tool(name) {
    for (var i = 0; i < defs.length; i++) if (defs[i].name === name) return defs[i];
    throw new Error("missing tool " + name);
  }

  var created = JSON.parse((await tool("create_log").handler({ kind: "runbook", title: "Restart the daemon", body: "steps", tags: "[\"ops\",\"ops\"]" })).content[0].text);
  assert.equal(created.createdBy.type, "session");
  assert.equal(created.createdBy.sessionKey, "cli-11");
  assert.equal(created.createdBy.userId, "owner");
  assert.deepEqual(created.tags, ["ops"], "a JSON-encoded tag array is parsed and de-duplicated");

  var listed = JSON.parse((await tool("list_logs").handler({})).content[0].text);
  assert.equal(listed.total, 1);

  var found = JSON.parse((await tool("search_logs").handler({ query: "restart" })).content[0].text);
  assert.equal(found.total, 1);

  var linked = JSON.parse((await tool("link_log").handler({ ref: created.ref, links: "[{\"ref\":\"session:abc\",\"label\":\"triage\"}]" })).content[0].text);
  assert.equal(linked.links[0].ref, "session:abc");

  var history = JSON.parse((await tool("log_history").handler({ ref: created.ref })).content[0].text);
  assert.deepEqual(history.revisions.map(function (r) { return r.op; }), ["create", "link"]);

  var badTags = await tool("create_log").handler({ kind: "decision", title: "Bad tags", tags: "not json" });
  assert.equal(badTags.isError, true);

  // A different session in the same project sees the same Logs.
  var otherDefs = f.attached.getToolDefs(f.otherSession);
  var otherList = JSON.parse((await otherDefs[0].handler({})).content[0].text);
  assert.equal(otherList.total, 1);
});

test("static and impostor descriptors fail closed", async function () {
  var f = fixture();
  var adapter = { createToolServer: function (definition) { return definition; } };

  var staticServer = f.attached.createMcpServer(adapter, null);
  assert.equal(staticServer.tools.length, 7, "a descriptor is still advertised before a session is known");
  for (var i = 0; i < staticServer.tools.length; i++) {
    var result = await staticServer.tools[i].handler({});
    assert.equal(result.isError, true, staticServer.tools[i].name + " must fail closed when unbound");
  }

  var impostor = { localId: 11, cliSessionId: "cli-11", ownerId: "owner" };
  assert.deepEqual(f.attached.getToolDefs(impostor), [], "a session object that is not the live one gets no tools");
  var impostorServer = f.attached.createMcpServer(adapter, impostor);
  assert.equal((await impostorServer.tools[0].handler({})).isError, true);

  var unattributed = { localId: 13, ownerId: null };
  assert.deepEqual(f.attached.getToolDefs(unattributed), []);
});

test("ordinary Mates receive no Project Logs tools at all", function () {
  var ordinary = fixture({ mate: true, builtinKey: "researcher" });
  var adapter = { createToolServer: function (definition) { return definition; } };
  assert.deepEqual(ordinary.attached.getToolDefs(ordinary.mateSession), []);
  assert.deepEqual(ordinary.attached.getToolDefs(null), []);
  assert.equal(ordinary.attached.createMcpServer(adapter, ordinary.mateSession), null);
  assert.equal(ordinary.attached.createMcpServer(adapter, null), null, "no descriptor is advertised either");
  assert.deepEqual(ordinary.attached.getBridgeTools(ordinary.mateSession, function () { return {}; }), []);
  assert.equal(ordinary.attached.getSystemPrompt(ordinary.mateSession), "");
});

test("authoritative builtin Clay gets only the read-only cross-project tools", async function () {
  var project = fixture();
  var ownerWs = ws({ id: "owner", displayName: "Owner" });
  project.attached.handleLogsMessage(ownerWs, { type: "project_log_create", requestId: "c1", kind: "decision", title: "Adopt append-only logs", body: "one backend" });

  // Clay reads through the same service instance, so it sees that write.
  var clay = attachProjectLogs({
    service: project.service,
    sm: project.projects.get("mate-home").getSessionManager(),
    projectSlug: "mate-home",
    getProjectOwnerId: function () { return "owner"; },
    isMate: true,
    mateId: "mate-id",
    sendTo: function () {},
  });

  var defs = clay.getToolDefs(project.mateSession);
  assert.deepEqual(defs.map(function (d) { return d.name; }), CLAY_TOOLS);
  for (var i = 0; i < defs.length; i++) {
    assert.equal(PROJECT_TOOLS.indexOf(defs[i].name), -1, "no tool name is advertised by both sets");
    assert.ok(Object.keys(defs[i].inputSchema).indexOf("projectSlug") !== -1, defs[i].name + " requires an explicit slug");
  }
  assert.equal(defs.filter(function (d) { return /create|update|link/.test(d.name); }).length, 0, "Clay is advertised no write tool");

  function tool(name) {
    for (var j = 0; j < defs.length; j++) if (defs[j].name === name) return defs[j];
    throw new Error("missing tool " + name);
  }

  var listed = JSON.parse((await tool("list_project_logs").handler({ projectSlug: "app" })).content[0].text);
  assert.equal(listed.total, 1);
  assert.equal(listed.entries[0].createdBy.userId, "owner");

  var searched = JSON.parse((await tool("search_project_logs").handler({ projectSlug: "app", query: "append-only" })).content[0].text);
  assert.equal(searched.total, 1);

  var read = JSON.parse((await tool("read_project_log").handler({ projectSlug: "app", ref: listed.entries[0].ref })).content[0].text);
  assert.equal(read.title, "Adopt append-only logs");

  var history = JSON.parse((await tool("project_log_history").handler({ projectSlug: "app", ref: listed.entries[0].ref })).content[0].text);
  assert.equal(history.total, 1);

  // Unauthorized and Mate projects are refused, and a missing slug is refused.
  assert.equal((await tool("list_project_logs").handler({ projectSlug: "secret" })).isError, true);
  assert.equal((await tool("list_project_logs").handler({ projectSlug: "mate-home" })).isError, true);
  assert.equal((await tool("list_project_logs").handler({})).isError, true);

  var adapter = { createToolServer: function (definition) { return definition; } };
  assert.equal(clay.createMcpServer(adapter, project.mateSession).tools.length, 4);
});

test("bridge advertising and dispatch mirror the adapter path without duplicates", async function () {
  var f = fixture();
  var normalize = function () { return { type: "object", properties: {} }; };
  var bridge = f.attached.getBridgeTools(f.session, normalize);
  assert.equal(bridge.length, 7);
  var names = {};
  for (var i = 0; i < bridge.length; i++) {
    assert.equal(bridge[i].server, "clay-logs");
    assert.equal(names[bridge[i].name], undefined, "no duplicate advertised tool");
    names[bridge[i].name] = true;
  }
  assert.deepEqual(Object.keys(names), PROJECT_TOOLS);
  assert.deepEqual(f.attached.getBridgeTools(null, normalize), []);

  var created = JSON.parse((await f.attached.callBridgeTool(f.session, "create_log", { kind: "progress", title: "Bridge write", body: "x" })).content[0].text);
  assert.equal(created.createdBy.sessionKey, "cli-11");
  await assert.rejects(function () { return f.attached.callBridgeTool(f.session, "delete_log", {}); }, /not found/);
  await assert.rejects(function () { return f.attached.callBridgeTool(null, "list_logs", {}); }, /require a valid session/);

  var dynamic = f.attached.getDynamicToolDefs(f.session);
  assert.equal(dynamic.length, 7);
  for (var d = 0; d < dynamic.length; d++) {
    assert.equal(dynamic[d].permissionName, "mcp__clay-logs__" + dynamic[d].name);
  }
});

test("system prompt guidance is factual and carries no persona", function () {
  var f = fixture();
  var prompt = f.attached.getSystemPrompt(f.session);
  assert.ok(prompt.indexOf(projectLogs.SYSTEM_PROMPT_LABEL) === 0);
  assert.match(prompt, /dry, factual record/);
  assert.match(prompt, /Default to not writing/);
  assert.match(prompt, /durable value/);
  assert.match(prompt, /not personal memory and not a persona/);
  assert.doesNotMatch(prompt, /\byou are\b/i, "the guidance must not describe an identity");
  assert.doesNotMatch(prompt, /\bI\b/, "the guidance must not speak in the first person");

  assert.equal(f.attached.getSystemPrompt({ localId: 11, ownerId: "owner" }), "", "an unbindable session gets no guidance");
  assert.equal(fixture({ mate: true }).attached.getSystemPrompt(null), "");
});

test("a service-less attachment is inert rather than failing open", function () {
  var sent = [];
  var inert = attachProjectLogs({
    service: null, sm: { sessions: new Map() }, projectSlug: "app",
    isMate: false, sendTo: function (w, m) { sent.push(m); },
  });
  assert.equal(inert.handleLogsMessage(ws({ id: "owner" }), { type: "project_logs_list", requestId: "z1" }), true);
  assert.equal(last(sent).type, "project_logs_error");
  assert.deepEqual(inert.getToolDefs({ localId: 1 }), []);
  assert.equal(inert.createMcpServer({ createToolServer: function (d) { return d; } }, null), null);
  assert.equal(inert.getSystemPrompt(null), "");
});

test("every Project Logs message type is registered in the WebSocket schema", function () {
  var c2s = ["project_logs_list", "project_log_read", "project_log_create", "project_log_update"];
  var s2c = ["project_logs_state", "project_log_entry", "project_log_saved", "project_logs_error"];
  for (var i = 0; i < c2s.length; i++) {
    assert.ok(schema[c2s[i]], c2s[i] + " is missing from ws-schema");
    assert.equal(schema[c2s[i]].direction, "c2s");
    assert.equal(schema[c2s[i]].handler, "lib/project-logs.js");
  }
  for (var j = 0; j < s2c.length; j++) {
    assert.ok(schema[s2c[j]], s2c[j] + " is missing from ws-schema");
    assert.equal(schema[s2c[j]].direction, "s2c");
  }
});

test("tool argument coercion accepts arrays and rejects non-array JSON", function () {
  assert.deepEqual(projectLogs.coerceToolArgs({ tags: ["a"] }).tags, ["a"]);
  assert.deepEqual(projectLogs.coerceToolArgs({ tags: "[\"a\"]" }).tags, ["a"]);
  assert.equal(projectLogs.coerceToolArgs({ tags: "" }).tags, undefined);
  assert.equal(projectLogs.coerceToolArgs({}).tags, undefined);
  assert.throws(function () { projectLogs.coerceToolArgs({ links: "{\"ref\":\"x\"}" }); }, /JSON array/);
  assert.throws(function () { projectLogs.coerceToolArgs({ links: "nope" }); }, /JSON array/);
});

test("the MCP tool sets are disjoint and the contract is shared", function () {
  var projectDefs = logsMcp.getToolDefs(null, false);
  var clayDefs = logsMcp.getToolDefs(null, true);
  assert.deepEqual(projectDefs.map(function (d) { return d.name; }), PROJECT_TOOLS);
  assert.deepEqual(clayDefs.map(function (d) { return d.name; }), CLAY_TOOLS);
  for (var i = 0; i < projectDefs.length; i++) {
    assert.ok(projectDefs[i].description.indexOf(logsMcp.LOGS_CONTRACT) === 0);
  }
  assert.equal(logsMcp.createMcpServer(null, null, false), null);
});
