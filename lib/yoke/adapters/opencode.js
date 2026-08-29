var createAcpAdapter = require("./acp").createAcpAdapter;

function createOpenCodeAdapter(opts) {
  return createAcpAdapter("opencode", opts);
}

module.exports = { createOpenCodeAdapter: createOpenCodeAdapter };
