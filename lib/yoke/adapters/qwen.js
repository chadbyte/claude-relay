var createAcpAdapter = require("./acp").createAcpAdapter;

function createQwenAdapter(opts) {
  return createAcpAdapter("qwen", opts);
}

module.exports = { createQwenAdapter: createQwenAdapter };
