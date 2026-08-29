var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

async function loadPicker(initialState) {
  var state = Object.assign({}, initialState || {});
  var messages = [];
  globalThis.__modelPickerStore = {
    get: function(key) { return state[key]; },
    snap: function() { return state; },
    set: function(partial) { state = Object.assign({}, state, partial); },
  };
  globalThis.__modelPickerWs = {
    readyState: 1,
    send: function(raw) { messages.push(JSON.parse(raw)); },
  };
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/model-picker.js"), "utf8");
  source = source.replace("import { store } from './store.js';", "var store = globalThis.__modelPickerStore;");
  source = source.replace("import { getWs } from './ws-ref.js';", "var getWs = function() { return globalThis.__modelPickerWs; };");
  var url = "data:text/javascript;base64," + Buffer.from(source).toString("base64") + "#" + Date.now() + Math.random();
  var picker = await import(url);
  return { picker: picker, messages: messages, getState: function() { return state; } };
}

test("opening an empty picker requests models and ignores an interim empty response", async function() {
  var f = await loadPicker({
    currentVendor: "claude",
    currentModels: [],
    modelListVendor: "",
    modelListStatus: "idle",
    modelRequestId: "",
    vendorInfo: { claude: { displayName: "Claude Code" } },
  });
  f.picker.prepareModelPickerOpen();
  assert.strictEqual(f.messages.length, 1);
  assert.strictEqual(f.messages[0].type, "get_vendor_models");
  assert.strictEqual(f.getState().modelListStatus, "loading");

  var interim = f.picker.getModelInfoUpdate({ vendor: "claude", model: "", models: [] });
  assert.strictEqual(interim.modelListStatus, "loading");

  var ready = f.picker.getModelInfoUpdate({
    vendor: "claude",
    requestId: f.messages[0].requestId,
    modelStatus: "ready",
    models: [{ value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" }],
  });
  assert.strictEqual(ready.modelListStatus, "ready");
});

test("stale model responses cannot replace a newer vendor request", async function() {
  var f = await loadPicker({
    currentVendor: "claude",
    currentModels: [],
    modelListVendor: "",
    modelListStatus: "idle",
    modelRequestId: "",
    vendorInfo: {},
  });
  var first = f.picker.requestVendorModels("claude", true);
  var second = f.picker.requestVendorModels("claude", true);
  assert.strictEqual(f.picker.getModelInfoUpdate({ vendor: "claude", requestId: first, models: ["old"] }), null);
  var accepted = f.picker.getModelInfoUpdate({ vendor: "claude", requestId: second, models: ["new"] });
  assert.strictEqual(accepted.modelListStatus, "ready");
});

test("model info for another vendor or session is ignored", async function() {
  var f = await loadPicker({
    activeSessionId: "claude-session",
    currentVendor: "claude",
    currentModels: ["sonnet"],
    modelListVendor: "claude",
    modelListStatus: "ready",
    modelRequestId: "",
    vendorInfo: {},
  });
  assert.strictEqual(f.picker.getModelInfoUpdate({ vendor: "codex", sessionId: "claude-session", model: "gpt-5.6", models: ["gpt-5.6"] }), null);
  assert.strictEqual(f.picker.getModelInfoUpdate({ vendor: "claude", sessionId: "codex-session", model: "gpt-5.6", models: ["gpt-5.6"] }), null);
});

test("model router rejects an unlisted id and keeps a valid current selection", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");
  assert.match(source, /Ignoring model not listed for vendor/);
  assert.match(source, /_miUpdate\.currentModel = _curInList \? _curModel : modelEntryValue/);
});

test("Fable selection is optimistic, acknowledged, and rolled back on failure", async function() {
  var f = await loadPicker({
    currentVendor: "claude",
    currentModel: "sonnet",
    currentModels: [{ value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" }],
    modelSelectionPending: null,
    modelSelectionError: "",
  });
  assert.strictEqual(f.picker.modelEntryMatches(f.getState().currentModels[0], "claude-fable-5"), true);
  f.picker.requestModelSelection("fable");
  assert.strictEqual(f.getState().currentModel, "fable");
  assert.strictEqual(f.messages[0].type, "set_model");
  var requestId = f.messages[0].requestId;
  f.picker.handleModelSelectionResult({ requestId: requestId, ok: false, error: "Fable is unavailable" });
  assert.strictEqual(f.getState().currentModel, "sonnet");
  assert.strictEqual(f.getState().modelSelectionError, "Fable is unavailable");
});

test("model picker does not impose a first-message lock", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/model-picker.js"), "utf8");
  assert.doesNotMatch(source, /Locked after first message/);
  assert.doesNotMatch(source, /midSessionModelSwitch/);
});
