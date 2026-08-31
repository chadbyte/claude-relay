var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

function loadTranslator() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/capsules/translator/logic.js"), "utf8");
  return vm.runInNewContext(source + "\ntool;", { Date: Date, Object: Object });
}

function createApi(initialRecords) {
  var records = (initialRecords || []).map(function (record) { return Object.assign({}, record); });
  var requests = [];
  return {
    requests: requests,
    records: records,
    storage: {
      get: async function (id) { return records.find(function (record) { return record._id === id; }) || null; },
      list: async function () { return records.map(function (record) { return Object.assign({}, record); }); },
      put: async function (record) {
        var stored = Object.assign({}, record);
        if (!stored._id) stored._id = "history-" + records.length;
        var index = records.findIndex(function (item) { return item._id === stored._id; });
        if (index === -1) records.push(stored);
        else records[index] = stored;
        return stored;
      },
      delete: async function (id) { records = records.filter(function (record) { return record._id !== id; }); },
    },
    llm: {
      complete: async function (request) { requests.push(request); return "Hello"; },
    },
  };
}

test("Translator persists its capability choice without adding settings to history", async function () {
  var translator = loadTranslator();
  var api = createApi([
    { _id: "translator-settings", type: "settings", model: "deep" },
    { _id: "old-translation", source: "안녕", result: "Hi", direction: "ko-en", at: 1 },
  ]);
  var state = await translator.actions.load(translator.initialState, {}, api);
  assert.strictEqual(state.model, "deep");
  assert.deepStrictEqual(state.history.map(function (item) { return item._id; }), ["old-translation"]);

  state = await translator.actions.setModel(state, { value: "standard" }, api);
  assert.strictEqual(state.model, "standard");
  assert.strictEqual(api.records.filter(function (record) { return record._id === "translator-settings"; })[0].model, "standard");
  state = Object.assign({}, state, { source: "안녕하세요" });
  state = await translator.actions.translate(state, {}, api);
  assert.strictEqual(api.requests[0].model, "standard");
  assert.strictEqual(state.history.some(function (record) { return record._id === "translator-settings"; }), false);

  var reloaded = await translator.actions.load(translator.initialState, {}, api);
  assert.strictEqual(reloaded.model, "standard");
  assert.strictEqual(reloaded.history.length, 2);
});

test("Translator rejects non-capability state and keeps legacy history compatible", async function () {
  var translator = loadTranslator();
  var api = createApi([{ _id: "legacy", source: "one", result: "하나", direction: "en-ko", at: 2 }]);
  var state = await translator.actions.load(Object.assign({}, translator.initialState, { model: "vendor/model" }), {}, api);
  assert.strictEqual(state.model, "fast");
  state = await translator.actions.setModel(state, { value: "vendor/model" }, api);
  assert.strictEqual(state.model, "fast");
  assert.strictEqual(state.history[0]._id, "legacy");
});
