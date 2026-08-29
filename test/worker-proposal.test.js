var test = require("node:test");
var assert = require("node:assert");
var proposalModule = require("../lib/project-worker-proposal");

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

function nextTurn() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function fixture() {
  var session = {
    localId: 1,
    ownerId: null,
    title: "Planner",
    vendor: "claude",
    model: "claude-fable",
    mode: "gui",
    history: [],
    sentToolResults: {},
    isProcessing: false,
  };
  var sessions = new Map([[session.localId, session]]);
  var updates = [];
  var directEvents = [];
  var starts = [];
  var pairs = [];
  var delegations = [];
  var sm = {
    sessions: sessions,
    installedVendors: ["claude", "codex"],
    currentModel: "claude-sonnet-4-6",
    modelsByVendor: {
      claude: [{ value: "claude-fable", displayName: "Claude Fable" }],
      codex: [{ value: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" }],
    },
    capabilitiesByVendor: { claude: { effort: true }, codex: { effort: true } },
    sendAndRecord: function (target, message) { target.history.push(message); },
    saveSessionFile: function () {},
    sendToSession: function (target, message) { updates.push(message); },
  };
  var sdk = {
    pushMessage: function () { return false; },
    startQuery: function (target, text) {
      starts.push({ session: target, text: text });
      return Promise.resolve();
    },
  };
  var attached = proposalModule.attachWorkerProposal({
    sm: sm,
    isMate: false,
    splitStore: { groupForMember: function () { return null; } },
    getSdk: function () { return sdk; },
    sendTo: function (ws, message) { directEvents.push(message); },
    usersModule: { isMultiUser: function () { return false; } },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
    adapters: {},
    createPairRecord: function (ws, message) {
      pairs.push(message);
      return {
        worker: { localId: 2 },
        group: { id: "sg_worker", members: [1, 2], pair: { driverId: 1, workerId: 2 } },
      };
    },
    sendToPartner: function (args, target) {
      delegations.push({ args: args, session: target });
      return Promise.resolve({
        content: [{ type: "text", text: JSON.stringify({ status: "complete", response: "Implemented and tested." }) }],
      });
    },
  });
  return {
    attached: attached,
    session: session,
    updates: updates,
    directEvents: directEvents,
    starts: starts,
    pairs: pairs,
    delegations: delegations,
    sm: sm,
    ws: { _clayActiveSession: session.localId },
  };
}

async function postProposal(f) {
  var tool = f.attached.getToolDefs(f.session)[0];
  var result = parseToolResult(await tool.handler({
    summary: "The implementation is large enough to benefit from a dedicated Worker.",
    plan: "1. Inspect the current flow\n2. Implement the change\n3. Run focused tests",
    message: "Implement the approved change and run focused tests.",
    recommendedVendor: "codex",
    recommendedModel: "gpt-5.6-sol",
    recommendedEffort: "high",
  }));
  assert.strictEqual(result.status, "posted");
  return f.session.history.filter(function (item) { return item.type === "worker_proposal"; })[0];
}

test("Fable detection respects the session model before the global fallback", function () {
  var models = { claude: [
    { value: "opaque-fable-id", displayName: "Claude Fable" },
    { value: "claude-sonnet", displayName: "Claude Sonnet" },
  ] };
  assert.strictEqual(proposalModule.isFableSession({ vendor: "claude", model: "opaque-fable-id" }, models), true);
  assert.strictEqual(proposalModule.isFableSession({ vendor: "claude", model: "claude-sonnet" }, models, "opaque-fable-id"), false);
  assert.strictEqual(proposalModule.isFableSession({ vendor: "claude" }, models, "opaque-fable-id"), true);
  assert.strictEqual(proposalModule.isFableSession({ vendor: "codex", model: "claude-fable" }, models), false);
});

test("only an unpaired Fable session receives the Worker proposal tool and prompt", function () {
  var f = fixture();
  assert.deepStrictEqual(f.attached.getToolDefs(f.session).map(function (tool) { return tool.name; }), ["propose_worker"]);
  assert.match(f.attached.getSystemPrompt(f.session), /implementation-heavy/);
  f.session.model = "claude-sonnet-4-6";
  assert.deepStrictEqual(f.attached.getToolDefs(f.session), []);
  assert.strictEqual(f.attached.getSystemPrompt(f.session), "");
});

test("declining a Worker suggestion resumes execution in Fable", async function () {
  var f = fixture();
  var proposal = await postProposal(f);
  assert.strictEqual(proposal.status, "pending");
  assert.strictEqual(proposal.recommendedVendor, "codex");
  assert.strictEqual(proposal.recommendedModel, "gpt-5.6-sol");

  var response = await f.attached.respondToProposal(f.ws, {
    proposalId: proposal.proposalId,
    accepted: false,
  });
  assert.deepStrictEqual(response, { ok: true, status: "declined" });
  assert.strictEqual(proposal.status, "declined");
  assert.match(f.starts[0].text, /Continue this task in the current session/);
  assert.strictEqual(f.session.history[f.session.history.length - 1]._internal, true);
});

test("a same-vendor fallback recommends a non-Fable execution model", async function () {
  var f = fixture();
  f.sm.installedVendors = ["claude"];
  f.sm.modelsByVendor.claude = [
    { value: "claude-fable", displayName: "Claude Fable" },
    { value: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
  ];
  var proposal = await postProposal(f);
  assert.strictEqual(proposal.recommendedVendor, "claude");
  assert.strictEqual(proposal.recommendedModel, "claude-sonnet-4-6");
});

test("skip permissions auto-approves and starts a Worker", async function () {
  var f = fixture();
  f.session.permissionMode = "bypassPermissions";
  var tool = f.attached.getToolDefs(f.session)[0];
  var result = parseToolResult(await tool.handler({
    summary: "The implementation is large enough to benefit from a dedicated Worker.",
    plan: "1. Inspect the current flow\n2. Implement the change\n3. Run focused tests",
    message: "Implement the approved change and run focused tests.",
    recommendedVendor: "codex",
    recommendedModel: "gpt-5.6-sol",
    recommendedEffort: "high",
  }));
  var proposal = f.session.history.filter(function (item) { return item.type === "worker_proposal"; })[0];

  assert.strictEqual(result.status, "running");
  assert.match(result.instruction, /auto-approved and started/);
  assert.strictEqual(proposal.autoApproved, true);
  assert.ok(proposal.status === "running" || proposal.status === "completed");
  assert.strictEqual(f.pairs.length, 1);
  assert.ok(f.updates.some(function (message) { return message.autoApproved === true; }));
});

test("skip permissions off leaves a Worker proposal pending", async function () {
  var f = fixture();
  var proposal = await postProposal(f);

  assert.strictEqual(proposal.status, "pending");
  assert.strictEqual(proposal.autoApproved, undefined);
  assert.strictEqual(f.pairs.length, 0);
  assert.strictEqual(f.delegations.length, 0);
});

test("auto-approved proposal updates carry the auto-approval marker", async function () {
  var f = fixture();
  f.session.dangerouslySkipPermissions = true;
  var tool = f.attached.getToolDefs(f.session)[0];
  await tool.handler({
    summary: "The implementation is large enough to benefit from a dedicated Worker.",
    plan: "1. Inspect the current flow\n2. Implement the change\n3. Run focused tests",
    message: "Implement the approved change and run focused tests.",
  });

  var starting = f.updates.find(function (message) { return message.status === "starting"; });
  assert.strictEqual(starting.autoApproved, true);
});

test("accepting a Worker suggestion creates the split, delegates, and returns the result", async function () {
  var f = fixture();
  var proposal = await postProposal(f);
  var response = await f.attached.respondToProposal(f.ws, {
    proposalId: proposal.proposalId,
    accepted: true,
    vendor: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
  });
  assert.strictEqual(response.status, "running");
  assert.deepStrictEqual(f.pairs[0], {
    driver: { sessionId: 1 },
    worker: { vendor: "codex", model: "gpt-5.6-sol", effort: "high" },
  });
  assert.strictEqual(f.directEvents[0].type, "pair_session_created");
  assert.strictEqual(f.delegations[0].args.message, "Implement the approved change and run focused tests.");

  await nextTurn();
  assert.strictEqual(proposal.status, "completed");
  assert.strictEqual(proposal.resultPreview, "Implemented and tested.");
  assert.match(f.starts[0].text, /Worker execution completed/);
  assert.match(f.starts[0].text, /send a follow-up with send_to_partner/);
  assert.match(f.starts[0].text, /never substitute a background session/);
  assert.match(f.starts[0].text, /Implemented and tested/);
  assert.ok(f.updates.some(function (message) { return message.status === "running"; }));
  assert.ok(f.updates.some(function (message) { return message.status === "completed"; }));
});

test("an interrupted Worker proposal stays interrupted and warns the Driver", async function () {
  var f = fixture();
  f.attached = proposalModule.attachWorkerProposal({
    sm: f.sm,
    isMate: false,
    splitStore: { groupForMember: function () { return null; } },
    getSdk: function () { return { pushMessage: function () { return false; }, startQuery: function (target, text) { f.starts.push({ session: target, text: text }); return Promise.resolve(); } }; },
    sendTo: function (ws, message) { f.directEvents.push(message); },
    usersModule: { isMultiUser: function () { return false; } },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
    adapters: {},
    createPairRecord: function () { return { worker: { localId: 2 }, group: { id: "sg_worker", members: [1, 2] } }; },
    sendToPartner: function () { return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ status: "interrupted", response: "Partial implementation" }) }] }); },
  });
  var proposal = await postProposal(f);
  await f.attached.respondToProposal(f.ws, { proposalId: proposal.proposalId, accepted: true, vendor: "codex", model: "gpt-5.6-sol", effort: "high" });
  await nextTurn();
  assert.strictEqual(proposal.status, "interrupted");
  assert.match(f.starts[0].text, /Worker execution interrupted/);
  assert.match(f.starts[0].text, /PARTIAL/);
});
