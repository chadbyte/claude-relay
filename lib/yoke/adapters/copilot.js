var createAcpAdapter = require("./acp").createAcpAdapter;

function createCopilotAdapter(opts) {
  return createAcpAdapter("copilot", opts);
}

module.exports = { createCopilotAdapter: createCopilotAdapter };
