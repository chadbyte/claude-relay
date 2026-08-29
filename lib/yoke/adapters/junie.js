var createAcpAdapter = require("./acp").createAcpAdapter;

function createJunieAdapter(opts) {
  return createAcpAdapter("junie", opts);
}

module.exports = { createJunieAdapter: createJunieAdapter };
