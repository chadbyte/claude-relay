var test = require("node:test");
var assert = require("node:assert");
var { attachModels, modelEntryMatches } = require("../lib/project-models");

function fixture(options) {
  options = options || {};
  var sent = [];
  var session = options.session || { vendor: "claude" };
  var sm = {
    defaultModelByVendor: { claude: options.currentModel || "" },
    defaultVendor: "claude",
    modelsByVendor: {},
    capabilitiesByVendor: {},
    availableVendors: ["claude"],
    installedVendors: ["claude"],
  };
  var adapter = options.adapter || {
    init: function() {
      return Promise.resolve({
        models: [{ value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" }],
        capabilities: { midSessionModelSwitch: true },
      });
    },
    supportedModels: function() { return Promise.resolve([]); },
  };
  var attached = attachModels({
    cwd: process.cwd(),
    slug: "model-test",
    sm: sm,
    sdk: options.sdk || { setModel: function(_session, model) { return Promise.resolve({ ok: true, model: model }); } },
    adapters: { claude: adapter },
    sendTo: function(_ws, msg) { sent.push(msg); },
    getSessionForWs: function() { return session; },
    getLinuxUserForWs: function() { return null; },
    serverPort: 2633,
    serverTls: false,
    serverAuthToken: null,
  });
  return { attached: attached, sent: sent, sm: sm, session: session };
}

test("model loading correlates responses and matches Fable resolved IDs", async function() {
  var f = fixture({ currentModel: "claude-fable-5" });
  await f.attached.loadVendorModels({}, { vendor: "claude", requestId: "models-1" });
  assert.strictEqual(f.sent.length, 1);
  assert.strictEqual(f.sent[0].requestId, "models-1");
  assert.strictEqual(f.sent[0].modelStatus, "ready");
  assert.strictEqual(f.sent[0].model, "fable");
  assert.strictEqual(f.sent[0].models[0].displayName, "Claude Fable");
  assert.strictEqual(modelEntryMatches(f.sent[0].models[0], "claude-fable-5"), true);
});

test("model loading returns an actionable error instead of a blank list", async function() {
  var f = fixture({
    adapter: {
      init: function() { return Promise.reject(new Error("authentication expired")); },
      supportedModels: function() { return Promise.resolve([]); },
    },
  });
  await f.attached.loadVendorModels({}, { vendor: "claude", requestId: "models-2" });
  assert.strictEqual(f.sent[0].modelStatus, "error");
  assert.deepStrictEqual(f.sent[0].models, []);
  assert.match(f.sent[0].error, /authentication expired/);
});

test("model selection reports adapter success and failure", async function() {
  var results = [
    { ok: true, model: "fable" },
    { ok: false, model: "sonnet", error: "Fable is unavailable" },
  ];
  var f = fixture({
    sdk: { setModel: function() { return Promise.resolve(results.shift()); } },
  });
  await f.attached.selectModel({}, { model: "fable", requestId: "select-1" });
  await f.attached.selectModel({}, { model: "fable", requestId: "select-2" });
  assert.deepStrictEqual(f.sent.map(function(msg) { return [msg.requestId, msg.ok, msg.error]; }), [
    ["select-1", true, ""],
    ["select-2", false, "Fable is unavailable"],
  ]);
});

test("model selection rejects stale vendors and unknown models before adapter use", async function() {
  var calls = 0;
  var f = fixture({
    sdk: { setModel: function() { calls++; return Promise.resolve({ ok: true, model: "fable" }); } },
  });
  f.sm.modelsByVendor.claude = [{ value: "fable", resolvedModel: "claude-fable-5" }];
  await f.attached.selectModel({}, { vendor: "codex", model: "fable", requestId: "stale" });
  await f.attached.selectModel({}, { vendor: "claude", model: "unknown", requestId: "unknown" });
  assert.strictEqual(calls, 0);
  assert.match(f.sent[0].error, /vendor changed/);
  assert.match(f.sent[1].error, /not available/);
});
