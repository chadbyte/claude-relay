// Driver eligibility is a hard server invariant: only a Claude model of Fable
// tier or higher, or an OpenAI model of Sol tier or higher, may hold the Driver
// role and receive the autonomous pair lifecycle tools.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var el = require("../lib/session-driver-eligibility");

// The catalogs as the server really reports them: Claude entries carry an
// alias, a resolved id and a display name; Codex ships a fixed id list.
var CLAUDE_CATALOG = [
  { value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" },
  { value: "opus", resolvedModel: "claude-opus-5", displayName: "Claude Opus" },
  { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Claude Sonnet" },
  { value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5" },
];
var CODEX_CATALOG = ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.5", "gpt-5.2"];
var CATALOG = { claude: CLAUDE_CATALOG, codex: CODEX_CATALOG };

function verdict(vendor, model) {
  return el.evaluateDriverModel(vendor, model, CATALOG);
}

// --- Claude family: Fable threshold ---------------------------------------

test("Claude models below Fable tier are denied the Driver role", function () {
  var denied = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001", "opus", "sonnet", "haiku"];
  for (var i = 0; i < denied.length; i++) {
    var v = verdict("claude", denied[i]);
    assert.equal(v.ok, false, denied[i] + " is not Driver-eligible");
    assert.match(v.error, /Fable tier or higher/, "and the reason names the threshold");
    assert.match(v.error, /Claude/);
  }
  assert.equal(verdict("claude", "claude-opus-5").tier.name, "Opus", "the tier is still reported");
  assert.equal(verdict("claude", "claude-haiku-4-5-20251001").tier.name, "Haiku");
});

test("Claude Fable tier and above are allowed, by id or by alias", function () {
  var allowed = ["claude-fable-5", "fable"];
  for (var i = 0; i < allowed.length; i++) {
    var v = verdict("claude", allowed[i]);
    assert.equal(v.ok, true, allowed[i] + " is Driver-eligible");
    assert.equal(v.error, null);
    assert.equal(v.tier.name, "Fable");
    assert.equal(v.tier.rank >= v.tier.threshold, true);
  }
});

test("a future Claude release in the same tier stays eligible", function () {
  // Token-based, so a version bump needs no code change.
  assert.equal(verdict("claude", "claude-fable-6").ok, true);
  assert.equal(verdict("claude", "claude-fable-5-20260901").ok, true);
  assert.equal(verdict("claude", "claude-opus-6").ok, false, "and a bump below the line stays denied");
});

test("the display name participates, matching the existing repo precedent", function () {
  // project-worker-proposal.js already detects Fable from the display label,
  // so an opaque id with a Fable label resolves the same way.
  var catalog = { claude: [{ value: "m1", resolvedModel: "internal-xyz", displayName: "Claude Fable" }] };
  assert.equal(el.evaluateDriverModel("claude", "m1", catalog).ok, true);
  assert.equal(el.evaluateDriverModel("claude", "m1", { claude: [] }).ok, false,
    "with no catalog entry there is nothing to resolve, so it fails closed");
});

// --- OpenAI family: Sol threshold ----------------------------------------

test("OpenAI models below Sol tier are denied the Driver role", function () {
  var denied = ["gpt-5.6-luna", "gpt-5.5", "gpt-5.2"];
  for (var i = 0; i < denied.length; i++) {
    var v = verdict("codex", denied[i]);
    assert.equal(v.ok, false, denied[i] + " is not Driver-eligible");
    assert.match(v.error, /Sol tier or higher/);
    assert.match(v.error, /OpenAI/);
  }
  assert.equal(verdict("codex", "gpt-5.6-luna").tier.name, "Luna");
});

test("OpenAI Sol tier and above are allowed", function () {
  assert.equal(verdict("codex", "gpt-5.6-sol").ok, true);
  assert.equal(verdict("codex", "gpt-5.6-sol").tier.name, "Sol");
  assert.equal(verdict("codex", "gpt-5.6-terra").ok, true, "Terra is above Sol");
  assert.equal(verdict("codex", "gpt-5.6-terra").tier.name, "Terra");
  assert.equal(verdict("codex", "gpt-5.7-terra").ok, true, "and a future release in that tier");
});

test("the Codex thresholds match the shipped catalog, strongest first", function () {
  var adapter = fs.readFileSync(path.join(root, "lib/yoke/adapters/codex.js"), "utf8");
  var block = adapter.slice(adapter.indexOf("var CODEX_MODELS = ["));
  block = block.slice(0, block.indexOf("];"));
  for (var i = 0; i < CODEX_CATALOG.length; i++) {
    assert.ok(block.indexOf('"' + CODEX_CATALOG[i] + '"') !== -1,
      CODEX_CATALOG[i] + " is a real shipped model id");
  }
  // Ranks follow the catalog's own strongest-first ordering.
  var ranks = CODEX_CATALOG.map(function (id) {
    var tier = el.resolveTier("codex", id, CATALOG);
    return tier ? tier.rank : null;
  });
  for (var j = 1; j < ranks.length; j++) {
    assert.ok(ranks[j] < ranks[j - 1], "rank decreases down the catalog");
  }
});

// --- Other vendors and malformed input -----------------------------------

test("a vendor with no comparable tier metadata is never a Driver", function () {
  var vendors = ["kiro", "opencode", "grok", "junie", "kimi", "qwen", "copilot", "antigravity", "", null];
  for (var i = 0; i < vendors.length; i++) {
    var v = el.evaluateDriverModel(vendors[i], "some-model", CATALOG);
    assert.equal(v.ok, false, String(vendors[i]) + " is not Driver-eligible");
    assert.match(v.error, /no comparable tier metadata|Fable tier or higher/);
  }
  // But they remain perfectly usable as Workers, which this module never gates.
  assert.match(el.evaluateDriverModel("kiro", "x", CATALOG).error, /can still be used for the Split Worker/);
});

test("an unrecognized model inside a known family fails closed", function () {
  var v = verdict("claude", "claude-experimental-9");
  assert.equal(v.ok, false, "unknown capability is not assumed to clear the bar");
  assert.equal(v.tier, null);
  assert.match(v.error, /not a recognized Claude tier/);

  var c = verdict("codex", "gpt-6-unknown");
  assert.equal(c.ok, false);
  assert.match(c.error, /not a recognized OpenAI tier/);
});

test("a missing model is denied with a clear reason", function () {
  var v = verdict("claude", "");
  assert.equal(v.ok, false);
  assert.match(v.error, /no resolved model yet/);
  assert.equal(verdict("claude", null).ok, false);
});

// --- Session form --------------------------------------------------------

function sm(overrides) {
  return Object.assign({
    modelsByVendor: CATALOG,
    defaultModelByVendor: { claude: "claude-fable-5", codex: "gpt-5.6-sol" },
  }, overrides || {});
}

test("the session form resolves the effective model the way the server does", function () {
  assert.equal(el.isEligibleDriverSession({ vendor: "claude", model: "claude-fable-5" }, sm()), true);
  assert.equal(el.isEligibleDriverSession({ vendor: "claude", model: "claude-sonnet-5" }, sm()), false);

  // No session model: the vendor default decides.
  assert.equal(el.isEligibleDriverSession({ vendor: "claude", model: "" }, sm()), true);
  assert.equal(el.isEligibleDriverSession({ vendor: "claude", model: "" },
    sm({ defaultModelByVendor: { claude: "claude-sonnet-5" } })), false);

  // Vendor defaults to claude when absent, matching the rest of the server.
  assert.equal(el.isEligibleDriverSession({ model: "claude-fable-5" }, sm()), true);

  // An embedded terminal session never drives.
  var tui = el.evaluateDriverSession({ vendor: "claude", model: "claude-fable-5", mode: "tui" }, sm());
  assert.equal(tui.ok, false);
  assert.match(tui.error, /embedded terminal session cannot take the Driver role/);

  assert.equal(el.evaluateDriverSession(null, sm()).ok, false);
});

test("eligibility reuses the repo's own model matcher rather than a new one", function () {
  var src = fs.readFileSync(path.join(root, "lib/session-driver-eligibility.js"), "utf8");
  assert.match(src, /var models = require\("\.\/project-models"\);/);
  assert.match(src, /models\.modelEntryMatches\(/,
    "aliases, ids and resolvedModel all resolve through the canonical matcher");
  assert.equal(/=>/.test(src), false, "no arrow functions");
  assert.equal(/^\s*(const|let)\s/m.test(src), false, "var only");
  assert.ok(src.split("\n").length < 500);
});
