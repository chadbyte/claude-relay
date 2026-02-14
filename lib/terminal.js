var pty;
try {
  pty = require("@lydell/node-pty");
} catch (e) {
  pty = null;
}

function createTerminal(cwd) {
  if (!pty) return null;

  var shell = process.env.SHELL || "/bin/bash";
  var term = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: cwd,
    env: Object.assign({}, process.env, { TERM: "xterm-256color" }),
  });

  return term;
}

module.exports = { createTerminal: createTerminal };
