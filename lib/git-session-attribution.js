// Connect working-tree changes to the Clay sessions that were active while they changed.

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var config = require("./config");
var gitCli = require("./git-cli");
var utils = require("./utils");

var MAX_BASELINE_BYTES = 2 * 1024 * 1024;
var MAX_DIGEST_BYTES = 8 * 1024 * 1024;
var MAX_SESSION_RECORDS = 80;

function attachGitSessionAttribution(options) {
  var cwd = options.cwd;
  var getOsUserInfoForSession = options.getOsUserInfoForSession || function () { return null; };
  var storageDir = options.storageDir || path.join(config.CONFIG_DIR, "git-attribution");
  var storagePath = path.join(storageDir, utils.encodeCwd(cwd) + ".json");
  var state = loadState();

  function loadState() {
    try {
      var parsed = JSON.parse(fs.readFileSync(storagePath, "utf8"));
      if (parsed && parsed.version === 1 && parsed.sessions) return parsed;
    } catch (e) {}
    return { version: 1, sessions: {} };
  }

  function saveState() {
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      var keys = Object.keys(state.sessions).sort(function (left, right) {
        return (state.sessions[right].lastChangedAt || 0) - (state.sessions[left].lastChangedAt || 0);
      });
      for (var i = MAX_SESSION_RECORDS; i < keys.length; i++) delete state.sessions[keys[i]];
      var temporaryPath = storagePath + ".tmp." + process.pid;
      fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2) + "\n");
      if (process.platform !== "win32") {
        try { fs.chmodSync(temporaryPath, 0o600); } catch (chmodError) {}
      }
      fs.renameSync(temporaryPath, storagePath);
    } catch (e) {
      console.error("[git-attribution] Unable to save session change data:", e.message);
    }
  }

  function sessionKey(session) {
    return session.cliSessionId || ("local:" + session.localId);
  }

  function digestPath(root, file) {
    var absolutePath = path.resolve(root, file.path);
    var rootPrefix = path.resolve(root) + path.sep;
    if (absolutePath.indexOf(rootPrefix) !== 0) return "invalid:" + file.code;
    try {
      var stat = fs.lstatSync(absolutePath);
      var hash = crypto.createHash("sha256");
      hash.update(file.code || "");
      if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(absolutePath));
      else if (stat.isFile() && stat.size <= MAX_DIGEST_BYTES) hash.update(fs.readFileSync(absolutePath));
      else if (stat.isFile()) hash.update("large:" + stat.size + ":" + stat.mtimeMs);
      else hash.update("non-file");
      return hash.digest("hex");
    } catch (e) {
      return "missing:" + (file.code || "");
    }
  }

  function readBaseline(root, file) {
    var absolutePath = path.resolve(root, file.path);
    var rootPrefix = path.resolve(root) + path.sep;
    if (absolutePath.indexOf(rootPrefix) !== 0) return null;
    try {
      var stat = fs.lstatSync(absolutePath);
      var buffer;
      if (stat.isSymbolicLink()) buffer = Buffer.from(fs.readlinkSync(absolutePath), "utf8");
      else if (stat.isFile() && stat.size <= MAX_BASELINE_BYTES) buffer = fs.readFileSync(absolutePath);
      else return null;
      return { content: buffer.toString("base64"), binary: buffer.indexOf(0) !== -1 };
    } catch (e) {
      return { missing: true };
    }
  }

  function captureSnapshot(includeBaseline, osUserInfo) {
    var status = gitCli.getStatus(cwd, osUserInfo);
    if (!status.isRepository) return null;
    var files = {};
    for (var i = 0; i < status.files.length; i++) {
      var file = status.files[i];
      files[file.path] = {
        fingerprint: digestPath(status.root, file),
        baseline: includeBaseline ? readBaseline(status.root, file) : undefined,
      };
    }
    return { root: status.root, head: status.oid || null, files: files, capturedAt: Date.now() };
  }

  function beginTurn(session) {
    if (!session || session._gitAttributionTurn) return;
    try {
      var osUserInfo = getOsUserInfoForSession(session);
      var snapshot = captureSnapshot(false, osUserInfo);
      if (!snapshot) return;
      var key = sessionKey(session);
      var oldLocalKey = "local:" + session.localId;
      if (key !== oldLocalKey && state.sessions[oldLocalKey] && !state.sessions[key]) {
        state.sessions[key] = state.sessions[oldLocalKey];
        delete state.sessions[oldLocalKey];
      }
      if (!state.sessions[key]) {
        var baseline = captureSnapshot(true, osUserInfo);
        state.sessions[key] = {
          key: key,
          title: session.title || "Untitled session",
          vendor: session.vendor || null,
          startedAt: Date.now(),
          baseline: baseline,
          changedPaths: {},
        };
        saveState();
      }
      session._gitAttributionTurn = snapshot;
      session._gitAttributionOsUserInfo = osUserInfo;
    } catch (e) {
      console.error("[git-attribution] Unable to capture turn start:", e.message);
    }
  }

  function finishTurn(session) {
    if (!session || !session._gitAttributionTurn) return;
    var before = session._gitAttributionTurn;
    session._gitAttributionTurn = null;
    try {
      var after = captureSnapshot(false, session._gitAttributionOsUserInfo);
      session._gitAttributionOsUserInfo = null;
      if (!after) return;
      var key = sessionKey(session);
      var record = state.sessions[key] || state.sessions["local:" + session.localId];
      if (!record) return;
      record.title = session.title || record.title;
      record.vendor = session.vendor || record.vendor;
      var paths = {};
      Object.keys(before.files).forEach(function (filePath) { paths[filePath] = true; });
      Object.keys(after.files).forEach(function (filePath) { paths[filePath] = true; });
      var changedAt = Date.now();
      Object.keys(paths).forEach(function (filePath) {
        var oldFingerprint = before.files[filePath] ? before.files[filePath].fingerprint : null;
        var newFingerprint = after.files[filePath] ? after.files[filePath].fingerprint : null;
        if (oldFingerprint !== newFingerprint) record.changedPaths[filePath] = changedAt;
      });
      record.lastChangedAt = changedAt;
      saveState();
    } catch (e) {
      console.error("[git-attribution] Unable to capture turn result:", e.message);
    }
  }

  function decorateStatus(status, sessions) {
    if (!status || !status.isRepository) return status;
    var liveByKey = {};
    sessions.forEach(function (session) {
      liveByKey[sessionKey(session)] = session;
      liveByKey["local:" + session.localId] = session;
    });
    for (var i = 0; i < status.files.length; i++) {
      var file = status.files[i];
      var matches = [];
      Object.keys(state.sessions).forEach(function (key) {
        var record = state.sessions[key];
        if (!record.changedPaths || !record.changedPaths[file.path]) return;
        var live = liveByKey[key];
        if (!live) return;
        matches.push({
          key: key,
          sessionId: live ? live.localId : null,
          title: live ? (live.title || record.title) : record.title,
          vendor: record.vendor || null,
          changedAt: record.changedPaths[file.path],
          preExisting: !!(record.baseline && record.baseline.files && record.baseline.files[file.path]),
        });
      });
      matches.sort(function (left, right) { return right.changedAt - left.changedAt; });
      file.sessions = matches.slice(0, 4);
    }
    return status;
  }

  function getSessionBaselineDiff(key, filePath, osUserInfo) {
    var record = state.sessions[key];
    if (!record || !record.baseline) throw new Error("Session baseline is unavailable");
    var current = gitCli.readWorkingTreeFile(record.baseline.root || cwd, filePath);
    var saved = record.baseline.files && record.baseline.files[filePath];
    var oldFile;
    if (saved && saved.baseline) {
      oldFile = saved.baseline.missing
        ? { content: "", binary: false }
        : { content: Buffer.from(saved.baseline.content || "", "base64").toString("utf8"), binary: !!saved.baseline.binary };
    } else {
      oldFile = gitCli.getFileAtCommit(record.baseline.root || cwd, record.baseline.head, filePath, osUserInfo);
    }
    return {
      path: filePath,
      oldContent: oldFile.binary ? "" : oldFile.content,
      newContent: current.binary ? "" : current.content,
      binary: oldFile.binary || current.binary,
      sessionTitle: record.title,
    };
  }

  return {
    beginTurn: beginTurn,
    decorateStatus: decorateStatus,
    finishTurn: finishTurn,
    getSessionBaselineDiff: getSessionBaselineDiff,
  };
}

module.exports = { attachGitSessionAttribution: attachGitSessionAttribution };
