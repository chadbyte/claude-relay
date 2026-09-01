var test = require("node:test");
var assert = require("node:assert/strict");
var attachDebateProposal = require("../lib/project-debate-proposal").attachDebateProposal;

test("project proposal bridge requires and retains its exact bound session", async function () {
  var records = [];
  var proposal = attachDebateProposal({
    cwd: "/projects/example",
    isMate: false,
    isHostAgent: false,
    sendTo: function () {},
    buildMateCtx: function () { return {}; },
    getMate: function () { return null; },
    getProjectOwnerId: function () { return "owner-a"; },
    recordSessionEvent: function (session, event) { session.history.push(event); records.push({ session: session, event: event }); },
    startDebate: function () { return { ok: true }; },
  });
  var exact = { localId: 31, ownerId: "owner-a", history: [] };
  var unrelated = { localId: 44, ownerId: "owner-a", history: [] };
  var normalizeSchema = function (schema) { return schema ? { type: "object" } : { type: "object" }; };

  assert.deepEqual(proposal.getBridgeTools(null, normalizeSchema), []);
  assert.deepEqual(proposal.getBridgeTools(exact, normalizeSchema).map(function (tool) { return tool.server + "/" + tool.name; }), ["clay-debate/propose_debate"]);
  await assert.rejects(proposal.callBridgeTool(null, "propose_debate", {}), /valid Clay session/);

  var resultPromise = proposal.callBridgeTool(exact, "propose_debate", {
    topic: "Bound project proposal",
    panelists: "[]",
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].session, exact);
  assert.equal(unrelated.history.length, 0);
  proposal.handleMessage({}, {
    type: "debate_proposal_response",
    proposalId: records[0].event.proposal.proposalId,
    action: "cancel",
  });
  var result = await resultPromise;
  assert.match(result.content[0].text, /cancelled/i);
});
