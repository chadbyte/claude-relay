var fs = require("fs");
var path = require("path");

/**
 * Attach file/directory watcher engine to a project context.
 *
 * ctx fields:
 *   cwd, send, sendTo, safePath, BINARY_EXTS, FS_MAX_SIZE, IGNORED_DIRS
 */
function attachFileWatch(ctx) {
  var cwd = ctx.cwd;
  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var safePath = ctx.safePath;
  var BINARY_EXTS = ctx.BINARY_EXTS;
  var FS_MAX_SIZE = ctx.FS_MAX_SIZE;
  var IGNORED_DIRS = ctx.IGNORED_DIRS;

  // --- File watcher ---
  // One open file per websocket client. A project-wide singleton watcher made
  // one browser tab silently replace another tab's live preview subscription.
  var fileWatchers = new Map();

  function settleFileWatchReady(entry, ready) {
    if (!entry || !entry.resolveReady) return;
    var resolve = entry.resolveReady;
    entry.resolveReady = null;
    resolve(ready);
  }

  function closeFileWatch(key) {
    var entry = fileWatchers.get(key);
    if (!entry) return;
    clearTimeout(entry.debounce);
    if (entry.reconcile) clearImmediate(entry.reconcile);
    if (entry.pollTimer) clearInterval(entry.pollTimer);
    try { entry.watcher.close(); } catch (e) {}
    fileWatchers.delete(key);
    settleFileWatchReady(entry, false);
  }

  function sendFileChanged(client, message) {
    if (client && typeof sendTo === "function") {
      sendTo(client, message);
    } else {
      send(message);
    }
  }

  function readFileSnapshot(absPath) {
    var stat = fs.statSync(absPath);
    var ext = path.extname(absPath).toLowerCase();
    if (stat.size > FS_MAX_SIZE || BINARY_EXTS.has(ext)) return null;
    return { content: fs.readFileSync(absPath, "utf8"), size: stat.size };
  }

  function publishFileChanged(key, client, relPath, absPath) {
    var latest = fileWatchers.get(key);
    if (!latest || latest.relPath !== relPath) return;
    try {
      var snapshot = readFileSnapshot(absPath);
      if (!snapshot) return;
      if (latest.hasSnapshot && latest.content === snapshot.content && latest.size === snapshot.size) return;
      latest.hasSnapshot = true;
      latest.content = snapshot.content;
      latest.size = snapshot.size;
      sendFileChanged(client, {
        type: "fs_file_changed",
        path: relPath,
        content: snapshot.content,
        size: snapshot.size,
      });
    } catch (e) {
      // Atomic saves can briefly remove the destination path between rename
      // events. Keep the parent watcher alive for the next event.
      if (e.code !== "ENOENT") closeFileWatch(key);
    }
  }

  function startFileWatch(client, relPath) {
    // Preserve the old single-argument API for callers outside the websocket
    // file browser. They share one legacy subscription.
    if (typeof relPath !== "string") {
      relPath = client;
      client = null;
    }
    var absPath = safePath(cwd, relPath);
    if (!absPath) return Promise.resolve(false);
    var key = client || "_legacy";
    var existing = fileWatchers.get(key);
    if (existing && existing.relPath === relPath) return existing.ready;
    closeFileWatch(key);

    // Watch the parent directory rather than the file inode. Editors and agent
    // tools commonly save with write-temp + rename; watching the old inode then
    // misses later edits even though the path still exists.
    var parentPath = path.dirname(absPath);
    var baseName = path.basename(absPath);
    var initialSnapshot = null;
    try { initialSnapshot = readFileSnapshot(absPath); } catch (e) {}
    try {
      var watcher = fs.watch(parentPath, function (eventType, filename) {
        if (filename && String(filename) !== baseName) return;
        var active = fileWatchers.get(key);
        if (!active || active.relPath !== relPath) return;
        clearTimeout(active.debounce);
        active.debounce = setTimeout(function () {
          publishFileChanged(key, client, relPath, absPath);
        }, 200);
      });
      var resolveReady = null;
      var ready = new Promise(function (resolve) { resolveReady = resolve; });
      var entry = {
        watcher: watcher,
        relPath: relPath,
        debounce: null,
        reconcile: null,
        pollTimer: null,
        ready: ready,
        resolveReady: resolveReady,
        hasSnapshot: !!initialSnapshot,
        content: initialSnapshot ? initialSnapshot.content : null,
        size: initialSnapshot ? initialSnapshot.size : null,
      };
      fileWatchers.set(key, entry);
      // Directory events are the low-latency path, but macOS can coalesce or
      // drop them under load. Periodic content reconciliation is the source of
      // truth and also survives atomic replacements with identical metadata.
      entry.pollTimer = setInterval(function () {
        publishFileChanged(key, client, relPath, absPath);
      }, 1000);
      // fs.watch has no readiness event. Reconcile once on the next event-loop
      // turn so a change between the initial read and native watcher activation
      // cannot leave the browser showing stale content.
      entry.reconcile = setImmediate(function () {
        var active = fileWatchers.get(key);
        if (active) active.reconcile = null;
        publishFileChanged(key, client, relPath, absPath);
        if (fileWatchers.get(key) === entry) settleFileWatchReady(entry, true);
      });
      watcher.on("error", function () { closeFileWatch(key); });
      return ready;
    } catch (e) {
      closeFileWatch(key);
      return Promise.resolve(false);
    }
  }

  function stopFileWatch(client) {
    if (arguments.length > 0) {
      closeFileWatch(client || "_legacy");
      return;
    }
    var keys = Array.from(fileWatchers.keys());
    for (var i = 0; i < keys.length; i++) closeFileWatch(keys[i]);
  }

  // --- Directory watcher ---
  var dirWatchers = {};  // relPath -> { watcher, debounce }

  function startDirWatch(relPath) {
    if (dirWatchers[relPath]) return;
    var absPath = safePath(cwd, relPath);
    if (!absPath) return;
    try {
      var debounce = null;
      var watcher = fs.watch(absPath, function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          // Re-read directory and broadcast to all clients
          try {
            var items = fs.readdirSync(absPath, { withFileTypes: true });
            var entries = [];
            for (var i = 0; i < items.length; i++) {
              if (items[i].isDirectory() && IGNORED_DIRS.has(items[i].name)) continue;
              entries.push({
                name: items[i].name,
                type: items[i].isDirectory() ? "dir" : "file",
                path: path.relative(cwd, path.join(absPath, items[i].name)).split(path.sep).join("/"),
              });
            }
            send({ type: "fs_dir_changed", path: relPath, entries: entries });
          } catch (e) {
            stopDirWatch(relPath);
          }
        }, 300);
      });
      watcher.on("error", function () { stopDirWatch(relPath); });
      dirWatchers[relPath] = { watcher: watcher, debounce: debounce };
    } catch (e) {}
  }

  function stopDirWatch(relPath) {
    var entry = dirWatchers[relPath];
    if (entry) {
      clearTimeout(entry.debounce);
      try { entry.watcher.close(); } catch (e) {}
      delete dirWatchers[relPath];
    }
  }

  function stopAllDirWatches() {
    var paths = Object.keys(dirWatchers);
    for (var i = 0; i < paths.length; i++) {
      stopDirWatch(paths[i]);
    }
  }

  return {
    startFileWatch: startFileWatch,
    stopFileWatch: stopFileWatch,
    startDirWatch: startDirWatch,
    stopDirWatch: stopDirWatch,
    stopAllDirWatches: stopAllDirWatches,
  };
}

module.exports = { attachFileWatch: attachFileWatch };
