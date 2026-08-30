var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var pathToFileURL = require("url").pathToFileURL;

function FakeButton() {
  this.attributes = Object.create(null);
  this.listeners = Object.create(null);
}

FakeButton.prototype.addEventListener = function(type, listener) { this.listeners[type] = listener; };
FakeButton.prototype.setAttribute = function(name, value) { this.attributes[name] = value; };
FakeButton.prototype.getAttribute = function(name) { return this.attributes[name] || null; };
FakeButton.prototype.click = function() { this.listeners.click(); };

test("Capsule model status renders a concrete provider and model", async function () {
  var status = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-llm-status.js")).href);
  assert.strictEqual(status.toolLlmDisplayValue({ status: "ready", vendorName: "Claude", modelName: "Fable" }), "Claude · Fable");
  assert.strictEqual(status.toolLlmDisplayValue({ status: "error" }), "No model configured");
  assert.strictEqual(status.initialToolLlmAlias({ modelAlias: "fast" }), "fast");
  assert.strictEqual(status.initialToolLlmAlias({}), null);
});

test("setup help disclosure is keyboard-button driven and truthfully explains current provider setup", async function () {
  var status = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-llm-status.js")).href);
  var button = new FakeButton();
  var hidden = true;
  var help = { classList: { toggle: function(_name, forceHidden) { hidden = forceHidden; } } };
  button.setAttribute("aria-expanded", "false");
  status.bindToolLlmHelp(button, help);
  button.click();
  assert.strictEqual(button.getAttribute("aria-expanded"), "true");
  assert.strictEqual(hidden, false);
  button.click();
  assert.strictEqual(button.getAttribute("aria-expanded"), "false");
  assert.strictEqual(hidden, true);

  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/tool-llm-status.js"), "utf8");
  assert.match(source, /installed and signed in on this Clay host/);
  assert.match(source, /API-key BYOK setup is not available in Home yet/);
  assert.doesNotMatch(source, /Configure models|data-section=['"]environment|MutationObserver/);
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
  assert.match(project, /msg\.type === "tool_llm_config_get"[\s\S]*opts\.onDmMessage\(ws, msg\)/);
  assert.match(schema, /"tool_llm_config_get"[\s\S]*"tool_llm_config_state"/);
});

test("declarative renderer uses composition-safe binding and scroll-stable focus", function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/tool-renderer.js"), "utf8");
  assert.match(source, /bindToolTextInput\(input/);
  assert.match(source, /focus\(\{ preventScroll: true \}\)/);
});
