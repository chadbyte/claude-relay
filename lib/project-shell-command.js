var { spawn } = require("child_process");
var { buildUserEnv } = require("./build-user-env");
var { wrapSpawnAsUser } = require("./os-users");

var MAX_COMMAND_LENGTH = 16 * 1024;
var MAX_OUTPUT_LENGTH = 64 * 1024;
var COMMAND_TIMEOUT_MS = 30 * 1000;

function stripTerminalCodes(value) {
  return String(value || "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

function attachShellCommand(ctx) {
  var runningBySocket = new WeakMap();

  function sendResult(ws, data) {
    ctx.sendTo(ws, Object.assign({ type: "shell_command_result" }, data));
  }

  function handleShellCommand(ws, msg) {
    if (msg.type !== "shell_command") return false;

    var requestId = typeof msg.requestId === "string" ? msg.requestId.slice(0, 100) : "";
    var command = typeof msg.command === "string" ? msg.command.trim() : "";
    if (!requestId || !command) {
      sendResult(ws, { requestId: requestId, error: "Enter a command to run." });
      return true;
    }
    if (command.length > MAX_COMMAND_LENGTH) {
      sendResult(ws, { requestId: requestId, error: "Command is too long." });
      return true;
    }

    if (ws._clayUser) {
      var permissions = ctx.usersModule.getEffectivePermissions(ws._clayUser, ctx.osUsers);
      if (!permissions.terminal) {
        sendResult(ws, { requestId: requestId, error: "Terminal access is not permitted." });
        return true;
      }
    }
    if (runningBySocket.get(ws)) {
      sendResult(ws, { requestId: requestId, error: "Another shell command is still running." });
      return true;
    }

    var session = ctx.getSessionForWs(ws);
    if (!session) {
      sendResult(ws, { requestId: requestId, error: "No active session." });
      return true;
    }

    var osUserInfo = ctx.getOsUserInfoForWs(ws);
    var shell = (osUserInfo && osUserInfo.shell)
      || process.env.SHELL
      || (process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh");
    var args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
    var spawnOptions = {
      cwd: ctx.cwd,
      env: buildUserEnv(osUserInfo),
      stdio: ["ignore", "pipe", "pipe"],
    };
    if (osUserInfo) {
      spawnOptions.uid = osUserInfo.uid;
      spawnOptions.gid = osUserInfo.gid;
    }

    var wrapped = wrapSpawnAsUser(shell, args, spawnOptions);
    var child;
    try {
      child = spawn(wrapped.command, wrapped.args, wrapped.options);
    } catch (e) {
      sendResult(ws, { requestId: requestId, error: e.message || "Failed to start command." });
      return true;
    }

    runningBySocket.set(ws, child);
    var chunks = [];
    var outputLength = 0;
    var truncated = false;
    var timedOut = false;
    var finished = false;

    function collect(data) {
      if (outputLength >= MAX_OUTPUT_LENGTH) {
        truncated = true;
        return;
      }
      var text = data.toString("utf8");
      var remaining = MAX_OUTPUT_LENGTH - outputLength;
      if (text.length > remaining) {
        text = text.slice(0, remaining);
        truncated = true;
      }
      chunks.push(text);
      outputLength += text.length;
    }

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    var timer = setTimeout(function () {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch (e) {}
      setTimeout(function () {
        if (!finished) {
          try { child.kill("SIGKILL"); } catch (e) {}
        }
      }, 1000).unref();
    }, COMMAND_TIMEOUT_MS);
    timer.unref();

    child.on("error", function (error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      runningBySocket.delete(ws);
      sendResult(ws, { requestId: requestId, command: command, error: error.message || "Command failed." });
    });

    child.on("close", function (code, signal) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      runningBySocket.delete(ws);

      var output = stripTerminalCodes(chunks.join(""));
      if (truncated) output += "\n… output truncated at 64 KB";
      if (timedOut) output += (output ? "\n" : "") + "Command timed out after 30 seconds.";
      var exitCode = typeof code === "number" ? code : null;
      var context = [
        "[Shell command executed by the user]",
        "$ " + command,
        output || "(no output)",
        "[Exit code: " + (exitCode == null ? (signal || "unknown") : exitCode) + "]",
      ].join("\n");
      if (!session.pendingShellContexts) session.pendingShellContexts = [];
      session.pendingShellContexts.push(context);

      sendResult(ws, {
        requestId: requestId,
        sessionId: session.localId,
        command: command,
        output: output,
        exitCode: exitCode,
        signal: signal || null,
        timedOut: timedOut,
        truncated: truncated,
      });
    });

    return true;
  }

  return { handleShellCommand: handleShellCommand };
}

module.exports = { attachShellCommand: attachShellCommand };
