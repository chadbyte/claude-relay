// Driver eligibility: which models may hold the Driver role of a visible
// Driver/Split Worker pair and receive the autonomous lifecycle tools.
//
// There is no canonical tier helper in the repo to reuse. Claude models are
// enumerated by the SDK at runtime, so there is no static list; Codex ships a
// fixed catalog in yoke/adapters/codex.js. What both have in common is a tier
// token in the model id and in its display name, which the existing
// project-worker-proposal.js already keys on ("fable"). This module makes that
// same idea explicit, ordered, and vendor-scoped.
//
// Ranks are per vendor family and are only ever compared within a family; no
// cross-vendor ranking is implied or invented.
//
//   claude family   haiku 1  <  sonnet 2  <  opus 3  <  fable 4
//                   real ids: claude-haiku-4-5-20251001, claude-sonnet-5,
//                             claude-opus-5, claude-fable-5
//                   Driver threshold: fable
//
//   codex family    gpt-5.2 1 < gpt-5.5 2 < luna 3 < sol 4 < terra 5
//                   real ids: the CODEX_MODELS catalog, strongest first
//                   Driver threshold: sol
//
// Matching is by token, not by exact id, so a later release in the same family
// (claude-fable-6, gpt-5.7-terra) stays eligible without a code change. A
// model in a known family whose tier token is unrecognized is NOT eligible:
// unknown capability fails closed rather than inheriting the threshold.
//
// Any other vendor is not eligible for the Driver role at all, because no
// equivalent tier metadata exists to compare against. Those vendors remain
// perfectly usable as Workers.

var models = require("./project-models");

var FAMILIES = {
  claude: {
    label: "Claude",
    threshold: 4,
    thresholdName: "Fable",
    // Longest/most specific tokens first so "haiku" cannot shadow a future
    // compound name. Each entry is a token searched in id and display name.
    tiers: [
      { token: "fable", rank: 4, name: "Fable" },
      { token: "opus", rank: 3, name: "Opus" },
      { token: "sonnet", rank: 2, name: "Sonnet" },
      { token: "haiku", rank: 1, name: "Haiku" },
    ],
  },
  codex: {
    label: "OpenAI",
    threshold: 4,
    thresholdName: "Sol",
    tiers: [
      { token: "terra", rank: 5, name: "Terra" },
      { token: "sol", rank: 4, name: "Sol" },
      { token: "luna", rank: 3, name: "Luna" },
      { token: "gpt-5.5", rank: 2, name: "GPT-5.5" },
      { token: "gpt-5.2", rank: 1, name: "GPT-5.2" },
    ],
  },
};

function familyFor(vendor) {
  var key = String(vendor || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(FAMILIES, key) ? FAMILIES[key] : null;
}

// Every string the catalog knows this model by. The catalog entry is found with
// the repo's own matcher so an alias ("fable"), an id, or a resolvedModel all
// resolve to the same entry, and the display name participates in tier
// detection exactly as project-worker-proposal.js already relies on.
function searchTextFor(vendor, model, modelsByVendor) {
  var parts = [String(model || "")];
  var catalog = (modelsByVendor && modelsByVendor[vendor]) || [];
  for (var i = 0; i < catalog.length; i++) {
    if (!models.modelEntryMatches(catalog[i], model)) continue;
    var entry = catalog[i];
    if (typeof entry === "string") {
      parts.push(entry);
    } else {
      parts.push(entry.value || "");
      parts.push(entry.id || "");
      parts.push(entry.resolvedModel || "");
      parts.push(entry.displayName || "");
      parts.push(entry.name || "");
    }
    break;
  }
  return parts.join(" ").toLowerCase();
}

// Resolve the tier of one model inside its vendor family. Returns null when
// the vendor has no tier metadata or the tier token is unrecognized.
function resolveTier(vendor, model, modelsByVendor) {
  var family = familyFor(vendor);
  if (!family || !model) return null;
  var text = searchTextFor(vendor, model, modelsByVendor);
  for (var i = 0; i < family.tiers.length; i++) {
    if (text.indexOf(family.tiers[i].token) !== -1) {
      return {
        vendor: String(vendor).toLowerCase(),
        family: family.label,
        rank: family.tiers[i].rank,
        name: family.tiers[i].name,
        threshold: family.threshold,
        thresholdName: family.thresholdName,
      };
    }
  }
  return null;
}

// The hard invariant. Returns { ok, tier, error } and never throws. `error` is
// a complete English sentence suitable for returning to a tool caller.
function evaluateDriverModel(vendor, model, modelsByVendor) {
  var family = familyFor(vendor);
  if (!family) {
    return {
      ok: false,
      tier: null,
      error: "The Driver role requires a Claude model of Fable tier or higher, or an OpenAI model of " +
        "Sol tier or higher. Vendor \"" + String(vendor || "unknown") + "\" has no comparable tier " +
        "metadata, so it cannot take the Driver role. It can still be used for the Split Worker.",
    };
  }
  if (!model) {
    return {
      ok: false,
      tier: null,
      error: "This session has no resolved model yet, so its " + family.label +
        " tier cannot be confirmed. The Driver role requires " + family.thresholdName +
        " tier or higher.",
    };
  }
  var tier = resolveTier(vendor, model, modelsByVendor);
  if (!tier) {
    return {
      ok: false,
      tier: null,
      error: "Model \"" + model + "\" is not a recognized " + family.label +
        " tier, so it cannot take the Driver role. The Driver role requires " +
        family.thresholdName + " tier or higher.",
    };
  }
  if (tier.rank < tier.threshold) {
    return {
      ok: false,
      tier: tier,
      error: "The Driver role requires a " + family.label + " model of " + family.thresholdName +
        " tier or higher. This session is " + tier.name + " tier.",
    };
  }
  return { ok: true, tier: tier, error: null };
}

// The session-level form. Resolves the session's effective model the same way
// the rest of the server does: the session's own model, else the vendor
// default. Identity is read from the session object, never from a caller.
function evaluateDriverSession(session, sm) {
  if (!session) return { ok: false, tier: null, error: "No session was bound to this request." };
  if (session.mode === "tui") {
    return {
      ok: false,
      tier: null,
      error: "An embedded terminal session cannot take the Driver role.",
    };
  }
  var vendor = session.vendor || "claude";
  var fallback = (sm && sm.defaultModelByVendor && sm.defaultModelByVendor[vendor]) || "";
  var model = session.model || fallback;
  return evaluateDriverModel(vendor, model, sm && sm.modelsByVendor);
}

function isEligibleDriverSession(session, sm) {
  return evaluateDriverSession(session, sm).ok;
}

module.exports = {
  FAMILIES: FAMILIES,
  evaluateDriverModel: evaluateDriverModel,
  evaluateDriverSession: evaluateDriverSession,
  isEligibleDriverSession: isEligibleDriverSession,
  resolveTier: resolveTier,
};
