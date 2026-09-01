var test = require("node:test");
var assert = require("node:assert");
var { attachDebateProposal } = require("../lib/project-debate-proposal");
var { dispatchMessageSafely } = require("../lib/project-connection");

function createHarness(options) {
  var sent = [];
  var starts = [];
  var records = [];
  var mates = options.mates || {};
  var proposal = attachDebateProposal({
    cwd: options.cwd || "/projects/example",
    isMate: !!options.isMate,
    isHostAgent: !!options.isHostAgent,
    sendTo: function (ws, msg) { sent.push(msg); },
    buildMateCtx: function (userId) { return { userId: userId }; },
    getMate: function (mateCtx, mateId) { return mates[mateId] || null; },
    getVendorModelCatalog: options.getVendorModelCatalog,
    getVendorModelCatalogForSession: options.getVendorModelCatalog ? function (session, vendor) { return options.getVendorModelCatalog(null, vendor); } : undefined,
    getProjectOwnerId: function () { return "project-owner"; },
    recordSessionEvent: function (session, event) { records.push(event); },
    startDebate: function (session, briefData, moderatorId, ws) {
      starts.push({ session: session, briefData: briefData, moderatorId: moderatorId, ws: ws });
      if (options.startError) throw options.startError;
      return { ok: true };
    },
  });
  var adapter = {
    createToolServer: function (definition) {
      return { name: definition.name, definition: definition };
    },
  };
  var session = { localId: 7, ownerId: "session-owner" };
  var server = proposal.createMcpServer(adapter, session);
  return {
    proposal: proposal,
    tool: server.definition.tools[0],
    session: session,
    sent: sent,
    starts: starts,
    records: records,
  };
}

function proposalArgs(overrides) {
  return Object.assign({
    topic: "Test debate",
    panelists: JSON.stringify([{ mateId: "mate_panel", role: "Reviewer", brief: "Review the proposal" }]),
  }, overrides || {});
}

test("normal project proposals fail safely when no moderator is provided", async function () {
  var harness = createHarness({ mates: { mate_panel: { id: "mate_panel" } } });
  var resultPromise = harness.tool.handler(proposalArgs());

  assert.equal(harness.proposal.handleMessage({}, { type: "debate_proposal_response", action: "start" }), true);
  var result = await resultPromise;

  assert.equal(harness.starts.length, 0);
  assert.equal(harness.sent[0].type, "debate_error");
  assert.match(harness.sent[0].error, /moderator/i);
  assert.equal(result.isError, true);
});

test("normal project proposals use an explicit moderator and their bound session", async function () {
  var harness = createHarness({
    mates: {
      mate_mod: { id: "mate_mod" },
      mate_panel: { id: "mate_panel" },
    },
  });
  var resultPromise = harness.tool.handler(proposalArgs({ moderatorId: "mate_mod" }));
  var ws = { _clayUser: { id: "user-1" } };

  harness.proposal.handleMessage(ws, { type: "debate_proposal_response", action: "start" });
  var result = await resultPromise;

  assert.equal(harness.starts.length, 1);
  assert.equal(harness.starts[0].session, harness.session);
  assert.equal(harness.starts[0].moderatorId, "mate_mod");
  assert.match(result.content[0].text, /approved and started/i);
});

test("proposal approval exposes defaults and starts with revalidated per-participant model overrides", async function () {
  var harness = createHarness({
    mates: {
      mate_mod: { id: "mate_mod", vendor: "claude", model: "sonnet" },
      mate_panel: { id: "mate_panel", vendor: "codex", model: "gpt-5.6" },
    },
    getVendorModelCatalog: function (ws, vendor) {
      return Promise.resolve(vendor === "claude"
        ? { models: [{ value: "sonnet", displayName: "Sonnet" }, { value: "opus", displayName: "Opus" }] }
        : { models: [{ value: "gpt-5.6", displayName: "GPT-5.6" }, { value: "gpt-5.6-mini", displayName: "GPT-5.6 mini" }] });
    },
  });
  var resultPromise = harness.tool.handler(proposalArgs({ moderatorId: "mate_mod" }));
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(harness.records[0].proposal.modelSelections[0].role, "moderator");
  assert.equal(harness.records[0].proposal.modelSelections[1].role, "panelist");
  harness.proposal.handleMessage({ _clayUser: { id: "user-1" } }, {
    type: "debate_proposal_response", proposalId: harness.records[0].proposal.proposalId, action: "start",
    modelOverrides: [{ mateId: "mate_mod", model: "opus" }, { mateId: "mate_panel", model: "gpt-5.6-mini" }],
  });
  await resultPromise;
  assert.deepEqual(harness.starts[0].briefData.participantModels, [
    { mateId: "mate_mod", vendor: "claude", model: "opus" },
    { mateId: "mate_panel", vendor: "codex", model: "gpt-5.6-mini" },
  ]);
});

test("Mate project proposals use the current Mate as moderator", async function () {
  var harness = createHarness({
    cwd: "/mates/mate_self",
    isMate: true,
    mates: {
      mate_self: { id: "mate_self" },
      mate_panel: { id: "mate_panel" },
    },
  });
  var resultPromise = harness.tool.handler(proposalArgs());

  harness.proposal.handleMessage({}, { type: "debate_proposal_response", action: "start" });
  await resultPromise;

  assert.equal(harness.starts[0].moderatorId, "mate_self");
});

test("Home planning proposal tools fail closed unless bound to an owned builtin Clay session", async function () {
  var harness = createHarness({
    cwd: "/mates/builtin:clay",
    isMate: true,
    isHostAgent: true,
    mates: { "builtin:clay": { id: "builtin:clay" }, mate_panel: { id: "mate_panel" } },
  });
  harness.session.homeDebatePlanning = true;
  harness.session.debateSetupMode = true;
  harness.session.history = [
    { type: "tool_executing", id: "topic", name: "AskUserQuestion" },
    { type: "ask_user_answered", toolId: "topic", answers: { 0: "Housing" } },
  ];
  var unbound = harness.proposal.getToolDefs(null)[0];
  var noSession = await unbound.handler(proposalArgs());
  assert.equal(noSession.isError, true);
  assert.match(noSession.content[0].text, /active Clay session/i);

  var nonClay = createHarness({
    cwd: "/mates/custom-mate",
    isMate: true,
    isHostAgent: false,
    mates: { "custom-mate": { id: "custom-mate" }, mate_panel: { id: "mate_panel" } },
  });
  nonClay.session.homeDebatePlanning = true;
  nonClay.session.debateSetupMode = true;
  nonClay.session.history = harness.session.history.slice();
  var rejected = await nonClay.proposal.getToolDefs(nonClay.session)[0].handler(proposalArgs());
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /owned Clay planning session/i);

  harness.session.ownerId = "other-user";
  var wrongOwner = await harness.proposal.getToolDefs(harness.session)[0].handler(proposalArgs());
  assert.equal(wrongOwner.isError, true);
  assert.match(wrongOwner.content[0].text, /owned Clay planning session/i);
});

test("a form-seeded owned Home session may propose without a synthetic topic answer event", async function () {
  var harness = createHarness({
    cwd: "/mates/builtin:clay",
    isMate: true,
    isHostAgent: true,
    mates: { "builtin:clay": { id: "builtin:clay" }, mate_panel: { id: "mate_panel" } },
  });
  harness.session.ownerId = "project-owner";
  harness.session.homeDebatePlanning = true;
  harness.session.debateSetupMode = true;
  harness.session.homeDebateInitialTopic = "Local-first storage";
  harness.session.history = [];
  var resultPromise = harness.proposal.getToolDefs(harness.session)[0].handler(proposalArgs());
  harness.proposal.handleMessage({}, { type: "debate_proposal_response", action: "start" });
  var result = await resultPromise;
  assert.equal(result.isError, undefined);
  assert.equal(harness.starts.length, 1);
});

test("invalid panelist payloads are rejected before creating a proposal", async function () {
  var harness = createHarness({ mates: {} });
  var result = await harness.tool.handler(proposalArgs({ panelists: "{}" }));

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /JSON array/i);
});

test("debate startup exceptions become proposal errors", async function () {
  var harness = createHarness({
    mates: {
      mate_mod: { id: "mate_mod" },
      mate_panel: { id: "mate_panel" },
    },
    startError: new TypeError("The path argument must be of type string"),
  });
  var originalError = console.error;
  console.error = function () {};
  try {
    var resultPromise = harness.tool.handler(proposalArgs({ moderatorId: "mate_mod" }));
    assert.doesNotThrow(function () {
      harness.proposal.handleMessage({}, { type: "debate_proposal_response", action: "start" });
    });
    var result = await resultPromise;
    assert.equal(result.isError, true);
    assert.equal(harness.sent[0].type, "debate_error");
  } finally {
    console.error = originalError;
  }
});

test("project message exceptions are isolated from the daemon", function () {
  var sent = [];
  var originalError = console.error;
  console.error = function () {};
  try {
    var handled = dispatchMessageSafely(function () {
      throw new Error("message failed");
    }, function (ws, msg) {
      sent.push(msg);
    }, "example", {}, { type: "debate_proposal_response" });

    assert.equal(handled, false);
    assert.deepEqual(sent, [{
      type: "error",
      text: "The request could not be completed. Check the server logs for details.",
    }]);
  } finally {
    console.error = originalError;
  }
});

test("a closed WebSocket cannot escape the project message boundary", function () {
  var originalError = console.error;
  console.error = function () {};
  try {
    assert.doesNotThrow(function () {
      dispatchMessageSafely(function () {
        throw new Error("message failed");
      }, function () {
        throw new Error("socket closed");
      }, "example", {}, { type: "debate_proposal_response" });
    });
  } finally {
    console.error = originalError;
  }
});
