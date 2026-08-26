var createAcpAdapter = require("./acp").createAcpAdapter;

function createKimiAdapter(opts) {
  return createAcpAdapter("kimi", opts);
}

module.exports = { createKimiAdapter: createKimiAdapter };
