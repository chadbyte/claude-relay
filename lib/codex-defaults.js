var CODEX_DEFAULTS = {
  approval: "on-failure",
  sandbox: "danger-full-access",
  webSearch: "live",
};

function getCodexConfig(sm) {
  return {
    approval: (sm && sm.codexApproval) || CODEX_DEFAULTS.approval,
    sandbox: (sm && sm.codexSandbox) || CODEX_DEFAULTS.sandbox,
    webSearch: (sm && sm.codexWebSearch) || CODEX_DEFAULTS.webSearch,
  };
}

module.exports = {
  CODEX_DEFAULTS: CODEX_DEFAULTS,
  getCodexConfig: getCodexConfig,
};
