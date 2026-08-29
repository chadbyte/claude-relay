var test = require("node:test");
var assert = require("node:assert");
var { attachDebateProposal } = require("../lib/project-debate-proposal");
var { dispatchMessageSafely } = require("../lib/project-connection");

function createHarness(options) {
  var sent = [];
  var starts = [];
  var mates = options.mates || {};
  var proposal = attachDebateProposal({
    cwd: options.cwd || "/projects/example",
    isMate: !!options.isMate,
    sendTo: function (ws, msg) { sent.push(msg); },
    buildMateCtx: function (userId) { return { userId: userId }; },
    getMate: function (mateCtx, mateId) { return mates[mateId] || null; },
    getProjectOwnerId: function () { return "project-owner"; },
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
