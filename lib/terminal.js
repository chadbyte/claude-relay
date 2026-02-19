var pty;
try {
  pty = require("@lydell/node-pty");
} catch (e) {
  pty = null;
}

function createTerminal(cwd, cols, rows) {
  if (!pty) return null;

  var shell = process.env.SHELL
    || (process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/bash");
  var term = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: cols || 80,
    rows: rows || 24,
    cwd: cwd,
    env: Object.assign({}, process.env, { TERM: "xterm-256color" }),
  });

  return term;
}

module.exports = { createTerminal: createTerminal };
