var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

var attachService = require("../lib/project-logs-service").attachProjectLogsService;

function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clay-logs-auth-"));
}

function projectHandle(status, sessions) {
  var manager = { sessions: new Map() };
  for (var i = 0; i < (sessions || []).length; i++) {
    manager.sessions.set(sessions[i].localId, sessions[i]);
  }
  return {
    getStatus: function () { return status; },
    getSessionManager: function () { return manager; },
    _sessions: manager,
  };
}

// One workspace shared by every case: an owned project, a shared project the
// owner is not a member of, a private project nobody else may read, a Mate
// project, and a worktree of the owned project.
function workspace(opts) {
  var options = opts || {};
  var ownedSession = { localId: 1, cliSessionId: "cli-owned", ownerId: "owner", vendor: "claude" };
  var sharedSession = { localId: 2, cliSessionId: "cli-shared", ownerId: "member", vendor: "codex" };
  var unattributedSession = { localId: 3, ownerId: null, vendor: "claude" };
  var worktreeSession = { localId: 4, cliSessionId: "cli-wt", ownerId: "owner", vendor: "claude" };
  var mateSession = { localId: 5, cliSessionId: "cli-mate", ownerId: "owner", vendor: "claude" };

  var projects = new Map();
  projects.set("owned", projectHandle({
    slug: "owned", path: "/srv/owned", projectOwnerId: "owner", visibility: "private", allowedUsers: [],
  }, [ownedSession, unattributedSession]));
  projects.set("shared", projectHandle({
    slug: "shared", path: "/srv/shared", projectOwnerId: "member", visibility: "private", allowedUsers: ["owner"],
  }, [sharedSession]));
  projects.set("private", projectHandle({
    slug: "private", path: "/srv/private", projectOwnerId: "stranger", visibility: "private", allowedUsers: [],
  }, []));
  projects.set("mate-home", projectHandle({
    slug: "mate-home", path: "/srv/mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id",
  }, [mateSession]));
  projects.set("owned-wt", projectHandle({
    slug: "owned-wt", path: "/srv/owned/.worktrees/feature", projectOwnerId: null,
    isWorktree: true, parentSlug: "owned",
  }, [worktreeSession]));

  var service = attachService({
    baseDir: tmpBase(),
    getProjects: function () { return projects; },
    isMultiUser: function () { return options.multiUser !== false; },
    resolveMate: options.resolveMate || function (ownerId, mateId) {
      return { id: mateId, createdBy: ownerId, builtinKey: options.builtinKey || "clay" };
    },
    canAccessProject: function (userId, status) {
      if (!status) return false;
      if (!status.visibility || status.visibility === "public") return true;
      if (status.projectOwnerId === userId) return true;
      return (status.allowedUsers || []).indexOf(userId) >= 0;
    },
    findUserById: function (id) {
      if (id === "owner") return { id: "owner", displayName: "Owner" };
      if (id === "member") return { id: "member", displayName: "Member" };
      return null;
    },
    // Distinct in-memory store per project path so bindings cannot cross-read.
    openStore: options.openStore || makeStoreFactory(),
  });

  return {
    service: service,
    projects: projects,
    ownedSession: ownedSession,
    sharedSession: sharedSession,
    unattributedSession: unattributedSession,
    worktreeSession: worktreeSession,
    mateSession: mateSession,
  };
}

// Real store, temp-backed, keyed by resolved project path.
function makeStoreFactory() {
  var base = tmpBase();
  var logsStore = require("../lib/project-logs-store");
  var cache = new Map();
  return function (cwd) {
    if (!cache.has(cwd)) cache.set(cwd, logsStore.createProjectLogsStore({ root: cwd, baseDir: base }));
    return cache.get(cwd);
  };
}

test("a project session binds to exactly its own project's Logs with session attribution", function () {
  var w = workspace();
  var bound = w.service.bindProjectSession({ projectSlug: "owned", session: w.ownedSession });
  assert.ok(bound);
  assert.equal(bound.projectSlug, "owned");
  assert.equal(bound.canWrite, true);
  assert.equal(bound.isClay, false);

  var entry = bound.createLog({ kind: "decision", title: "Bound write" });
  assert.equal(entry.createdBy.type, "session");
  assert.equal(entry.createdBy.sessionKey, "cli-owned");
  assert.equal(entry.createdBy.userId, "owner");
  assert.equal(entry.createdBy.displayName, "Owner", "attribution is enriched server-side");
  assert.equal(bound.listLogs({}).total, 1);

  // The binding, not an argument, decides the project. There is no slug input.
  var otherBound = w.service.bindProjectSession({ projectSlug: "shared", session: w.sharedSession });
  assert.equal(otherBound.listLogs({}).total, 0, "a sibling project's Logs are a separate store");
});

test("session identity must be the exact live object, not a matching id", function () {
  var w = workspace();
  var impostor = { localId: 1, cliSessionId: "cli-owned", ownerId: "owner" };
  assert.equal(w.service.bindProjectSession({ projectSlug: "owned", session: impostor }), null);

  var unknown = { localId: 99, ownerId: "owner" };
  assert.equal(w.service.bindProjectSession({ projectSlug: "owned", session: unknown }), null);

  // A session that was live at bind time but has since been dropped.
  var live = w.service.bindProjectSession({ projectSlug: "owned", session: w.ownedSession });
  assert.ok(live);
  w.projects.get("owned")._sessions.sessions.delete(1);
  assert.equal(w.service.bindProjectSession({ projectSlug: "owned", session: w.ownedSession }), null);

  assert.equal(w.service.bindProjectSession({ projectSlug: "missing", session: w.ownedSession }), null);
  assert.equal(w.service.bindProjectSession({ projectSlug: "owned", session: null }), null);
  assert.equal(w.service.bindProjectSession(null), null);
});

test("multi-user mode fails closed on an unattributed session", function () {
  var multi = workspace({ multiUser: true });
  assert.equal(
    multi.service.bindProjectSession({ projectSlug: "owned", session: multi.unattributedSession }),
    null,
    "a session with no ownerId gets no capability in multi-user mode"
  );

  // Single-user mode has no user records, so an unowned session is legitimate.
  var single = workspace({ multiUser: false });
  assert.ok(single.service.bindProjectSession({ projectSlug: "owned", session: single.unattributedSession }));

  // Even in single-user mode, a session attributed to someone other than the
  // project owner is rejected rather than silently accepted.
  var mismatched = { localId: 7, ownerId: "stranger" };
  single.projects.get("owned")._sessions.sessions.set(7, mismatched);
  assert.equal(single.service.bindProjectSession({ projectSlug: "owned", session: mismatched }), null);
});

test("shared-project members read each other's entries with attribution intact", function () {
  var w = workspace();
  var memberBound = w.service.bindProjectSession({ projectSlug: "shared", session: w.sharedSession });
  memberBound.createLog({ kind: "investigation", title: "Member finding", body: "traced the retry loop" });

  // "owner" is not the owner of "shared" but is in allowedUsers.
  var guest = w.service.bindUser({ projectSlug: "shared", user: { id: "owner", displayName: "Owner" } });
  assert.ok(guest, "an authorized non-owner member is bound");
  var listed = guest.listLogs({});
  assert.equal(listed.total, 1);
  assert.equal(listed.entries[0].createdBy.userId, "member");
  assert.equal(listed.entries[0].createdBy.displayName, "Member", "the other member's authorship is preserved");

  var edited = guest.updateLog({ ref: listed.entries[0].ref, body: "traced the retry loop to the daemon" });
  assert.equal(edited.createdBy.userId, "member", "original authorship is never overwritten");
  assert.equal(edited.updatedBy.userId, "owner");
  assert.equal(edited.updatedBy.type, "user");

  var blame = guest.logHistory({ ref: listed.entries[0].ref });
  assert.deepEqual(blame.revisions.map(function (r) { return r.author.userId; }), ["member", "owner"]);

  // A user with no grant on a private project gets nothing.
  assert.equal(w.service.bindUser({ projectSlug: "private", user: { id: "owner" } }), null);
  assert.equal(w.service.bindUser({ projectSlug: "owned", user: null }), null, "multi-user requires an identified user");
});

test("a worktree shares the parent project's Logs and inherits its authorization", function () {
  var w = workspace();
  var parentBound = w.service.bindProjectSession({ projectSlug: "owned", session: w.ownedSession });
  parentBound.createLog({ kind: "progress", title: "Parent entry" });

  var worktreeBound = w.service.bindProjectSession({ projectSlug: "owned-wt", session: w.worktreeSession });
  assert.ok(worktreeBound, "a worktree with no owner of its own inherits the parent's visibility");

  var seen = worktreeBound.listLogs({});
  assert.equal(seen.total, 1, "the worktree reads the parent project's Logs rather than an empty fork");
  assert.equal(seen.entries[0].title, "Parent entry");

  worktreeBound.createLog({ kind: "session-note", title: "Worktree entry" });
  assert.equal(parentBound.listLogs({}).total, 2, "worktree writes land in the parent's Logs");
});

test("ordinary Mates are denied and Mate projects have no Logs", function () {
  var ordinary = workspace({ builtinKey: "researcher" });
  assert.equal(
    ordinary.service.bindMate({ projectSlug: "mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id", session: ordinary.mateSession }),
    null,
    "a non-Clay builtin Mate gets no Logs capability"
  );

  var custom = workspace({ resolveMate: function (ownerId, mateId) { return { id: mateId, createdBy: ownerId, builtinKey: null }; } });
  assert.equal(
    custom.service.bindMate({ projectSlug: "mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id" }),
    null,
    "a user-created Mate gets no Logs capability"
  );

  // A Mate cannot slip through the project-session or user binders either.
  var w = workspace();
  assert.equal(w.service.bindProjectSession({ projectSlug: "mate-home", session: w.mateSession }), null);
  assert.equal(w.service.bindUser({ projectSlug: "mate-home", user: { id: "owner" } }), null);
});

test("authoritative builtin Clay reads authorized projects only, and never writes", function () {
  var w = workspace();
  w.service.bindProjectSession({ projectSlug: "owned", session: w.ownedSession })
    .createLog({ kind: "decision", title: "Owned decision", body: "adopt append-only logs" });
  w.service.bindProjectSession({ projectSlug: "shared", session: w.sharedSession })
    .createLog({ kind: "decision", title: "Shared decision" });

  var clay = w.service.bindMate({ projectSlug: "mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id", session: w.mateSession });
  assert.ok(clay);
  assert.equal(clay.isClay, true);
  assert.equal(clay.canWrite, false);
  assert.equal(clay.projectSlug, null, "Clay is not bound to one project");

  assert.equal(clay.listLogs({ projectSlug: "owned" }).total, 1);
  assert.equal(clay.searchLogs({ projectSlug: "owned", query: "append-only" }).total, 1);
  assert.equal(clay.listLogs({ projectSlug: "shared" }).total, 1, "a project the user is a member of is readable");

  assert.throws(function () { clay.listLogs({ projectSlug: "private" }); }, /not available/);
  assert.throws(function () { clay.listLogs({ projectSlug: "mate-home" }); }, /not available/);
  assert.throws(function () { clay.listLogs({ projectSlug: "missing" }); }, /Project not found/);
  assert.throws(function () { clay.listLogs({}); }, /exact project slug is required/);

  assert.throws(function () { clay.createLog({ projectSlug: "owned", kind: "decision", title: "No" }); }, /read-only/);
  assert.throws(function () { clay.updateLog({ projectSlug: "owned", ref: "log:x", title: "No" }); }, /read-only/);
  assert.throws(function () { clay.linkLog({ projectSlug: "owned", ref: "log:x", links: [] }); }, /read-only/);
  assert.throws(function () { clay.removeLog({ projectSlug: "owned", ref: "log:x" }); }, /read-only/);
});

test("a Clay binding is refused when the Mate registry does not confirm it", function () {
  var w = workspace();
  var wrongOwner = w.service.bindMate({ projectSlug: "mate-home", projectOwnerId: "stranger", isMate: true, mateId: "mate-id" });
  assert.equal(wrongOwner, null, "the source project owner must match the project status");

  var wrongMateId = w.service.bindMate({ projectSlug: "mate-home", projectOwnerId: "owner", isMate: true, mateId: "other-mate" });
  assert.equal(wrongMateId, null);

  var notAMateProject = w.service.bindMate({ projectSlug: "owned", projectOwnerId: "owner", isMate: true, mateId: "mate-id" });
  assert.equal(notAMateProject, null, "a plain project cannot claim to be a Mate");

  var staleSession = w.service.bindMate({
    projectSlug: "mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id",
    session: { localId: 5, ownerId: "owner" },
  });
  assert.equal(staleSession, null, "an impostor session object is rejected");

  var foreignMate = workspace({ resolveMate: function (ownerId, mateId) { return { id: mateId, createdBy: "someone-else", builtinKey: "clay" }; } });
  assert.equal(
    foreignMate.service.bindMate({ projectSlug: "mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id" }),
    null,
    "a Mate created by another user is not authoritative for this owner"
  );

  assert.equal(w.service.bindMate({ projectSlug: "mate-home", projectOwnerId: "owner", isMate: false, mateId: "mate-id" }), null);
  assert.equal(w.service.bindMate(null), null);
});

test("a bound principal loses access when project visibility changes mid-session", function () {
  var w = workspace();
  var guest = w.service.bindUser({ projectSlug: "shared", user: { id: "owner" } });
  assert.ok(guest);
  assert.equal(guest.listLogs({}).total, 0);

  var handle = w.projects.get("shared");
  var revoked = Object.assign({}, handle.getStatus(), { allowedUsers: [] });
  handle.getStatus = function () { return revoked; };

  assert.throws(function () { guest.listLogs({}); }, /not available/, "authorization is re-checked on every call");
  assert.throws(function () { guest.createLog({ kind: "decision", title: "No" }); }, /not available/);
});

test("a captured project-session binding stops working when its exact session goes away", function () {
  var w = workspace();
  var bound = w.service.bindProjectSession({ projectSlug: "owned", session: w.ownedSession });
  assert.ok(bound);
  bound.createLog({ kind: "decision", title: "While live" });
  assert.equal(bound.listLogs({}).total, 1, "valid while the session is live");

  // The exact session object is dropped after the binding was captured.
  var manager = w.projects.get("owned")._sessions.sessions;
  manager.delete(1);
  assert.throws(function () { bound.listLogs({}); }, /no longer valid/, "identity is re-derived on every call");
  assert.throws(function () { bound.searchLogs({ query: "while" }); }, /no longer valid/);
  assert.throws(function () { bound.createLog({ kind: "decision", title: "After removal" }); }, /no longer valid/);
  assert.throws(function () { bound.readLog({ ref: "log:aaaaaaaaaaaaaaaaaaaaaaaa" }); }, /no longer valid/);
  assert.throws(function () { bound.logHistory({ ref: "log:aaaaaaaaaaaaaaaaaaaaaaaa" }); }, /no longer valid/);

  // An impostor object with the same id does not revive it.
  manager.set(1, { localId: 1, cliSessionId: "cli-owned", ownerId: "owner" });
  assert.throws(function () { bound.listLogs({}); }, /no longer valid/, "a different object with the same id is rejected");

  // Restoring the exact same object restores the capability.
  manager.set(1, w.ownedSession);
  assert.equal(bound.listLogs({}).total, 1);
  var written = bound.createLog({ kind: "progress", title: "After restore" });
  assert.equal(written.createdBy.sessionKey, "cli-owned", "attribution is re-derived too");
});

test("a captured user binding still re-checks project authorization per call", function () {
  var w = workspace();
  var guest = w.service.bindUser({ projectSlug: "shared", user: { id: "owner", displayName: "Owner" } });
  assert.ok(guest);
  assert.equal(guest.listLogs({}).total, 0);

  var handle = w.projects.get("shared");
  var revoked = Object.assign({}, handle.getStatus(), { allowedUsers: [] });
  handle.getStatus = function () { return revoked; };
  assert.throws(function () { guest.listLogs({}); }, /not available/);
});

test("a captured Clay Logs binding re-checks the Mate registry and owner per call", function () {
  var w = workspace();
  w.service.bindProjectSession({ projectSlug: "owned", session: w.ownedSession })
    .createLog({ kind: "decision", title: "Owned decision" });

  var clay = w.service.bindMate({ projectSlug: "mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id", session: w.mateSession });
  assert.ok(clay);
  assert.equal(clay.listLogs({ projectSlug: "owned" }).total, 1);

  // The Mate project's session is dropped after the binding was captured.
  var mateManager = w.projects.get("mate-home")._sessions.sessions;
  mateManager.delete(5);
  assert.throws(function () { clay.listLogs({ projectSlug: "owned" }); }, /no longer valid/);
  mateManager.set(5, w.mateSession);
  assert.equal(clay.listLogs({ projectSlug: "owned" }).total, 1);

  // Writes stay refused regardless of revalidation.
  assert.throws(function () { clay.createLog({ projectSlug: "owned", kind: "decision", title: "No" }); }, /read-only/);
});

test("a Clay Logs binding is lost when the Mate stops being authoritative Clay", function () {
  var builtinKey = "clay";
  var w = workspace({ resolveMate: function (ownerId, mateId) { return { id: mateId, createdBy: ownerId, builtinKey: builtinKey }; } });
  w.service.bindProjectSession({ projectSlug: "owned", session: w.ownedSession })
    .createLog({ kind: "decision", title: "Owned decision" });

  var clay = w.service.bindMate({ projectSlug: "mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id" });
  assert.ok(clay);
  assert.equal(clay.listLogs({ projectSlug: "owned" }).total, 1);

  builtinKey = null;
  assert.throws(function () { clay.listLogs({ projectSlug: "owned" }); }, /no longer valid/,
    "a demoted Mate loses the read view through a captured handler");
});
