var test = require("node:test");
var assert = require("node:assert/strict");
var debateModels = require("../lib/debate-model-selection");

function context() {
  var mates = {
    moderator: { id: "moderator", vendor: "claude", model: "sonnet" },
    panel: { id: "panel", vendor: "codex", model: "gpt-5.6" },
  };
  return {
    getMate: function (mateCtx, mateId) { return mates[mateId] || null; },
    getVendorModelCatalog: function (ws, vendor) {
      if (vendor === "claude") return Promise.resolve({ defaultModel: "sonnet", models: [{ value: "sonnet", displayName: "Sonnet" }, { value: "opus", displayName: "Opus" }] });
      return Promise.resolve({ defaultModel: "gpt-5.6", models: [{ value: "gpt-5.6", displayName: "GPT-5.6" }, { value: "gpt-5.6-mini", displayName: "GPT-5.6 mini" }] });
    },
  };
}

test("debate model choices include moderator and panel defaults without changing Mate settings", async function () {
  var selections = await debateModels.loadSelections(context(), {}, {}, "moderator", [{ mateId: "panel" }]);
  assert.deepEqual(selections.map(function (item) { return [item.mateId, item.role, item.vendor, item.selectedModel]; }), [
    ["moderator", "moderator", "claude", "sonnet"],
    ["panel", "panelist", "codex", "gpt-5.6"],
  ]);
  assert.deepEqual(selections[0].models, [{ value: "sonnet", label: "Sonnet" }, { value: "opus", label: "Opus" }]);
});

test("debate model approval revalidates exact participants and live catalogs", async function () {
  var valid = await debateModels.validateSelections(context(), {}, {}, "moderator", [{ mateId: "panel" }], [
    { mateId: "moderator", model: "opus" },
    { mateId: "panel", model: "gpt-5.6-mini" },
  ]);
  assert.deepEqual(valid.selections, [
    { mateId: "moderator", vendor: "claude", model: "opus" },
    { mateId: "panel", vendor: "codex", model: "gpt-5.6-mini" },
  ]);

  var stale = await debateModels.validateSelections(context(), {}, {}, "moderator", [{ mateId: "panel" }], [{ mateId: "panel", model: "removed" }]);
  assert.match(stale.error, /no longer available/i);
  var foreign = await debateModels.validateSelections(context(), {}, {}, "moderator", [{ mateId: "panel" }], [{ mateId: "other", model: "opus" }]);
  assert.match(foreign.error, /does not belong/i);
  var malformed = await debateModels.validateSelections(context(), {}, {}, "moderator", [{ mateId: "panel" }], "opus");
  assert.match(malformed.error, /invalid/i);
});
