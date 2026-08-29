var test = require("node:test");
var assert = require("node:assert");
var toolLlm = require("../lib/tool-llm");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var managedAllow = require("../lib/claude-hook-installer").CLAY_MANAGED_ALLOW;

function queryHandle(events, capture) {
  return {
    pushMessage: function (prompt) { capture.prompt = prompt; return true; },
    setModel: function () {}, setEffort: function () {}, setToolPolicy: function () {},
    stopTask: function () {}, getContextUsage: function () { return Promise.resolve(null); },
    endInput: function () {}, abort: function () {}, close: function () { capture.closed = true; },
    [Symbol.asyncIterator]: async function* () {
      for (var i = 0; i < events.length; i++) yield events[i];
    },
  };
}

test("LLM aliases map per adapter and reject vendor model names", function () {
  assert.strictEqual(toolLlm.resolveAliasModel("claude", "fast", []), "haiku");
  assert.strictEqual(toolLlm.resolveAliasModel("codex", "standard", []), "gpt-5.6-terra");
  assert.strictEqual(toolLlm.resolveAliasModel("codex", "deep", ["gpt-5.6-sol", "gpt-5.4-mini"]), "gpt-5.6-sol");
  assert.throws(function () { toolLlm.validateArgs({ prompt: "hello", model: "claude-opus-4" }); }, /capability alias/);
});

test("LLM completion uses a sessionless one-shot adapter query", async function () {
  var capture = {};
  var adapter = {
    supportedModels: function () { return Promise.resolve(["haiku", "sonnet", "opus"]); },
    createQuery: function (opts) {
      capture.opts = opts;
      return Promise.resolve(queryHandle([
        { yokeType: "text_delta", text: "안녕" },
        { yokeType: "result" },
      ], capture));
    },
  };
  var text = await toolLlm.complete({ adapters: { claude: adapter }, cwd: "/tmp", args: { prompt: "hello", model: "fast" } });
  assert.strictEqual(text, "안녕");
  assert.strictEqual(capture.opts.model, "haiku");
  assert.strictEqual(capture.opts.persistSession, false);
  assert.strictEqual(capture.opts.skipProjectInstructions, true);
  assert.strictEqual(capture.opts.skipSkills, true);
  assert.strictEqual(capture.prompt, "hello");
  assert.strictEqual(capture.closed, true);
});

test("capsule authoring tools are excluded from both auto-approval paths", function () {
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: {}, adapter: {}, send: function () {} });
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-tools__clay_tool_list", {}).behavior, "allow");
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-tools__clay_tool_act", {}).behavior, "allow");
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-tools__clay_tool_install", {}), null);
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-tools__clay_tool_uninstall", {}), null);
  assert.ok(managedAllow.indexOf("mcp__clay-tools__clay_tool_list") !== -1);
  assert.ok(managedAllow.indexOf("mcp__clay-tools__clay_tool_install") === -1);
  assert.ok(managedAllow.indexOf("mcp__clay-tools__clay_tool_uninstall") === -1);
  assert.ok(managedAllow.indexOf("mcp__clay-tools__*") === -1);
});
