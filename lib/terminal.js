var pty;
try {
  pty = require("@lydell/node-pty");
} catch (e) {
  pty = null;
}

var { buildUserEnv } = require("./build-user-env");

function createTerminal(cwd, cols, rows, osUserInfo) {
  if (!pty) return null;

  // Determine shell: prefer target user's shell, then $SHELL, then platform default
  var shell = (osUserInfo && osUserInfo.shell)
    || process.env.SHELL
    || (process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh");

  // Build a minimal, isolated environment (no daemon env leakage)
  var termEnv = buildUserEnv(osUserInfo);
  var spawnOpts = {
    name: "xterm-256color",
    cols: cols || 80,
    rows: rows || 24,
    cwd: cwd,
    env: termEnv,
  };

  if (osUserInfo) {
    spawnOpts.uid = osUserInfo.uid;
    spawnOpts.gid = osUserInfo.gid;
  }

  var args = osUserInfo ? ["-l"] : [];
  var term = pty.spawn(shell, args, spawnOpts);

  return term;
}

module.exports = { createTerminal: createTerminal };
