var fs = require("fs");
var path = require("path");

/**
 * Attach file/directory watcher engine to a project context.
 *
 * ctx fields:
 *   cwd, send, safePath, BINARY_EXTS, FS_MAX_SIZE, IGNORED_DIRS
 */
function attachFileWatch(ctx) {
  var cwd = ctx.cwd;
  var send = ctx.send;
  var safePath = ctx.safePath;
  var BINARY_EXTS = ctx.BINARY_EXTS;
  var FS_MAX_SIZE = ctx.FS_MAX_SIZE;
  var IGNORED_DIRS = ctx.IGNORED_DIRS;

  // --- File watcher ---
  var fileWatcher = null;
  var watchedPath = null;
  var watchDebounce = null;

  function startFileWatch(relPath) {
    var absPath = safePath(cwd, relPath);
    if (!absPath) return;
    if (watchedPath === relPath) return;
    stopFileWatch();
    watchedPath = relPath;
    try {
      fileWatcher = fs.watch(absPath, function () {
        clearTimeout(watchDebounce);
        watchDebounce = setTimeout(function () {
          try {
            var stat = fs.statSync(absPath);
            var ext = path.extname(absPath).toLowerCase();
            if (stat.size > FS_MAX_SIZE || BINARY_EXTS.has(ext)) return;
            var content = fs.readFileSync(absPath, "utf8");
            send({ type: "fs_file_changed", path: relPath, content: content, size: stat.size });
          } catch (e) {
            stopFileWatch();
          }
        }, 200);
      });
      fileWatcher.on("error", function () { stopFileWatch(); });
    } catch (e) {
      watchedPath = null;
    }
  }

  function stopFileWatch() {
    if (fileWatcher) {
      try { fileWatcher.close(); } catch (e) {}
      fileWatcher = null;
    }
    clearTimeout(watchDebounce);
    watchDebounce = null;
    watchedPath = null;
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
