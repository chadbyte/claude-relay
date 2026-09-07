// Model-tier policy for proactive Split Worker orchestration.
//
// Structural Driver eligibility remains model-agnostic. This policy only
// decides whether a model should be prompted to judge when delegation helps.

var HIGH_TIER_PATTERNS = {
  claude: [/(?:^|-)fable(?:-|$)/i, /(?:^|-)opus(?:-|$)/i],
  codex: [/^gpt-6(?:-|$)/i, /^gpt-[0-9]+(?:\.[0-9]+)?-sol(?:-|$)/i],
};

function resolvedModel(session, sm) {
  if (!session) return "";
  var vendor = session.vendor || "claude";
  var defaults = sm && sm.defaultModelByVendor || {};
  return session.model || defaults[vendor] || "";
}

function isHighTierDriverSession(session, sm) {
  if (!session) return false;
  var patterns = HIGH_TIER_PATTERNS[session.vendor || "claude"] || [];
  var model = resolvedModel(session, sm);
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].test(model)) return true;
  }
  return false;
}

module.exports = {
  isHighTierDriverSession: isHighTierDriverSession,
  resolvedModel: resolvedModel,
};
