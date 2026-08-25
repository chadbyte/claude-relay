var test = require("node:test");
var assert = require("node:assert");
var { createSDKBridge } = require("../lib/sdk-bridge");
var { buildInitialModelInfo } = require("../lib/project-connection");

test("new project publishes installed vendors before adapter warmup completes", async function () {
  var finishWarmup;
  var warmupResult = new Promise(function (resolve) {
    finishWarmup = resolve;
  });
  var adapter = {
    vendor: "claude",
    init: function () { return warmupResult; },
  };
  var sent = [];
  var sm = {
    availableModels: [],
    modelsByVendor: {},
    sessions: new Map(),
    setSlashCommandsForVendor: function () {},
  };
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    slug: "new-project",
    sessionManager: sm,
    send: function (msg) { sent.push(msg); },
    adapter: adapter,
    adapters: { claude: adapter },
  });

  var pendingWarmup = bridge.warmup(null);

  assert.ok(Array.isArray(sm.installedVendors));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].type, "model_info");
  assert.deepStrictEqual(sent[0].installedVendors, sm.installedVendors);

  finishWarmup({
    models: [],
    defaultModel: "",
    skills: [],
    slashCommands: [],
    capabilities: {},
  });
  await pendingWarmup;
});

test("project connection includes vendor state when the model is empty", function () {
  var msg = buildInitialModelInfo({
    availableVendors: ["claude", "codex", "kiro"],
    installedVendors: ["claude", "codex", "kiro"],
  }, "claude", "", []);

  assert.strictEqual(msg.type, "model_info");
  assert.strictEqual(msg.model, "");
  assert.deepStrictEqual(msg.installedVendors, ["claude", "codex", "kiro"]);
  assert.deepStrictEqual(msg.availableVendors, ["claude", "codex", "kiro"]);
});
