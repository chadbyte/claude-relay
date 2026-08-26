var createAcpAdapter = require("./acp").createAcpAdapter;

function createGrokAdapter(opts) {
  return createAcpAdapter("grok", opts);
}

module.exports = { createGrokAdapter: createGrokAdapter };
