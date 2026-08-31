var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var pathToFileURL = require("url").pathToFileURL;

test("Capsule model status renders a concrete provider and model", async function () {
  var status = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-llm-status.js")).href);
  assert.strictEqual(status.toolLlmDisplayValue({ status: "ready", vendorName: "Claude", modelName: "Fable" }), "Claude · Fable");
  assert.strictEqual(status.toolLlmDisplayValue({ status: "error" }), "No model configured");
  assert.strictEqual(status.initialToolLlmAlias({ modelAlias: "fast" }), "fast");
  assert.strictEqual(status.initialToolLlmAlias({}), null);
});

test("Capsule model status offers Retry only after loading fails", async function () {
  var status = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-llm-status.js")).href);
  assert.strictEqual(status.toolLlmShouldRetry({ status: "loading" }), false);
  assert.strictEqual(status.toolLlmShouldRetry({ status: "ready" }), false);
  assert.strictEqual(status.toolLlmShouldRetry({ status: "error" }), true);
  assert.strictEqual(status.toolLlmShouldRetry(null), false);

  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/tool-llm-status.js"), "utf8");
  assert.match(source, /surface\.retry\.classList\.toggle\("hidden", !toolLlmShouldRetry\(state\)\)/);
});

test("LLM Capsule status uses correlated alias routing and runtime alias handoff", function () {
  var root = path.join(__dirname, "..");
  var status = fs.readFileSync(path.join(root, "lib/public/modules/tool-llm-status.js"), "utf8");
  var tools = fs.readFileSync(path.join(root, "lib/public/modules/home-tools.js"), "utf8");
  var runtime = fs.readFileSync(path.join(root, "lib/public/modules/tool-runtime.js"), "utf8");
  var router = fs.readFileSync(path.join(root, "lib/public/modules/app-message-router.js"), "utf8");
  var project = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  var schema = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");
  assert.match(status, /alias: alias/);
  assert.match(status, /msg\.requestId !== activeRequests\[alias\]/);
  assert.match(tools, /onLlmRequest:[\s\S]*setAlias\(alias\)/);
  assert.match(runtime, /config\.onLlmRequest\(msg\.args && msg\.args\.model/);
  assert.match(router, /msg\.type === "tool_llm_config_state"[\s\S]*handleToolLlmConfigState\(msg\)/);
  assert.match(project, /msg\.type === "tool_llm_config_get"[\s\S]*opts\.onDmMessage\(ws, msg, slug\)/);
  assert.match(schema, /"tool_llm_config_get"[\s\S]*"tool_llm_config_state"/);
});

test("declarative renderer uses composition-safe binding and scroll-stable focus", function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/tool-renderer.js"), "utf8");
  assert.match(source, /bindToolTextInput\(input/);
  assert.match(source, /focus\(\{ preventScroll: true \}\)/);
});

test("Home suppresses fallback status for authored model selectors and disposes mounted surfaces", async function () {
  var root = path.join(__dirname, "..");
  var tree = await import(pathToFileURL(path.join(root, "lib/public/modules/tool-ui-tree.js")).href);
  var tools = fs.readFileSync(path.join(root, "lib/public/modules/home-tools.js"), "utf8");
  var css = fs.readFileSync(path.join(root, "lib/public/css/home-hub.css"), "utf8");
  assert.strictEqual(tree.shouldInjectToolLlmStatus({ manifest: { permissions: ["llm"] }, uiTree: { type: "text" } }), true);
  assert.strictEqual(tree.shouldInjectToolLlmStatus({ manifest: { permissions: ["llm"] }, uiTree: { type: "stack", children: [{ type: "model-select" }] } }), false);
  assert.strictEqual(tree.shouldInjectToolLlmStatus({ manifest: { permissions: [] }, uiTree: { type: "text" } }), false);
  assert.strictEqual(tree.isToolModelAlias("deep"), true);
  assert.strictEqual(tree.isToolModelAlias("vendor/model"), false);
  assert.match(tools, /shouldInjectToolLlmStatus\(definition\)/);
  assert.match(tools, /llmStatuses\[toolId\]\.dispose\(\)/);
  assert.doesNotMatch(css, /\.tool-llm-status\s*\{[^}]*border:/s);
});
