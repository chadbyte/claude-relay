var fs = require("fs");
var path = require("path");
var execFileSync = require("child_process").execFileSync;

/**
 * Attach filesystem-related message handlers to a project context.
 *
 * ctx fields:
 *   cwd, slug, osUsers
 *   sm (session manager)
 *   send, sendTo
 *   safePath, safeAbsPath (functions)
 *   getOsUserInfoForWs (function)
 *   startFileWatch, stopFileWatch, startDirWatch (from _fileWatch)
 *   usersModule, fsAsUser
 *   validateEnvString (function)
 *   opts (for onGetProjectEnv, onSetProjectEnv, onGetSharedEnv, onSetSharedEnv callbacks)
 *   IGNORED_DIRS, BINARY_EXTS, IMAGE_EXTS, FS_MAX_SIZE (constants)
 */
function attachFilesystem(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var osUsers = ctx.osUsers;
  var sm = ctx.sm;
  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var safePath = ctx.safePath;
  var safeAbsPath = ctx.safeAbsPath;
  var getOsUserInfoForWs = ctx.getOsUserInfoForWs;
  var startFileWatch = ctx.startFileWatch;
  var stopFileWatch = ctx.stopFileWatch;
  var startDirWatch = ctx.startDirWatch;
  var usersModule = ctx.usersModule;
  var fsAsUser = ctx.fsAsUser;
  var validateEnvString = ctx.validateEnvString;
  var opts = ctx.opts;
  var IGNORED_DIRS = ctx.IGNORED_DIRS;
  var BINARY_EXTS = ctx.BINARY_EXTS;
  var IMAGE_EXTS = ctx.IMAGE_EXTS;
  var FS_MAX_SIZE = ctx.FS_MAX_SIZE;

  function handleFilesystemMessage(ws, msg) {
    // --- File browser permission gate ---
    if (msg.type === "fs_list" || msg.type === "fs_read" || msg.type === "fs_write" || msg.type === "fs_delete" || msg.type === "fs_rename" || msg.type === "fs_mkdir" || msg.type === "fs_upload" || msg.type === "fs_search") {
      if (ws._clayUser) {
        var fbPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!fbPerms.fileBrowser) {
          sendTo(ws, { type: msg.type + "_result", error: "File browser access is not permitted" });
          return true;
        }
      }
    }

    // --- fs_list ---
    if (msg.type === "fs_list") {
      var fsDir = safePath(cwd, msg.path || ".");
      // In OS user mode, fall back to absolute path resolution (ACL enforces access)
      if (!fsDir && getOsUserInfoForWs(ws)) {
        fsDir = safeAbsPath(msg.path);
      }
      if (!fsDir) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: "Access denied" });
        return true;
      }
      try {
        var fsListUserInfo = getOsUserInfoForWs(ws);
        var entries = [];
        if (fsListUserInfo) {
          // Run as target OS user to respect Linux file permissions
          var rawEntries = fsAsUser("list", { dir: fsDir }, fsListUserInfo);
          for (var fi = 0; fi < rawEntries.length; fi++) {
            var re = rawEntries[fi];
            if (re.isDir && IGNORED_DIRS.has(re.name)) continue;
            entries.push({
              name: re.name,
              type: re.isDir ? "dir" : "file",
              path: path.relative(cwd, path.join(fsDir, re.name)).split(path.sep).join("/"),
            });
          }
        } else {
          var items = fs.readdirSync(fsDir, { withFileTypes: true });
          for (var fi = 0; fi < items.length; fi++) {
            var item = items[fi];
            if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
            entries.push({
              name: item.name,
              type: item.isDirectory() ? "dir" : "file",
              path: path.relative(cwd, path.join(fsDir, item.name)).split(path.sep).join("/"),
            });
          }
        }
        sendTo(ws, { type: "fs_list_result", path: msg.path || ".", entries: entries });
        // Auto-watch the directory for changes
        startDirWatch(msg.path || ".");
      } catch (e) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: e.message });
      }
      return true;
    }

    // --- fs_search ---
    if (msg.type === "fs_search") {
      var query = (msg.query || "").trim().toLowerCase();
      if (!query) {
        sendTo(ws, { type: "fs_search_result", query: msg.query, entries: [] });
        return true;
      }
      try {
        var searchResults = [];
        var MAX_RESULTS = 50;
        var searchUserInfo = getOsUserInfoForWs(ws);

        function walkDir(dir, relPrefix) {
          if (searchResults.length >= MAX_RESULTS) return;
          var items;
          try {
            if (searchUserInfo) {
              items = fsAsUser("list", { dir: dir }, searchUserInfo);
            } else {
              items = fs.readdirSync(dir, { withFileTypes: true }).map(function (d) {
                return { name: d.name, isDir: d.isDirectory() };
              });
            }
          } catch (e) { return; }
          for (var i = 0; i < items.length; i++) {
            if (searchResults.length >= MAX_RESULTS) return;
            var it = items[i];
            if (it.isDir && IGNORED_DIRS.has(it.name)) continue;
            var rel = relPrefix ? relPrefix + "/" + it.name : it.name;
            if (it.name.toLowerCase().indexOf(query) !== -1) {
              searchResults.push({ name: it.name, type: it.isDir ? "dir" : "file", path: rel });
            }
            if (it.isDir) {
              walkDir(path.join(dir, it.name), rel);
            }
          }
        }

        walkDir(cwd, "");
        sendTo(ws, { type: "fs_search_result", query: msg.query, entries: searchResults });
      } catch (e) {
        sendTo(ws, { type: "fs_search_result", query: msg.query, entries: [], error: e.message });
      }
      return true;
    }

    // --- fs_read ---
    if (msg.type === "fs_read") {
      var fsFile = safePath(cwd, msg.path);
      if (!fsFile && getOsUserInfoForWs(ws)) {
        fsFile = safeAbsPath(msg.path);
      }
      if (!fsFile) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, error: "Access denied" });
        return true;
      }
      try {
        var fsReadUserInfo = getOsUserInfoForWs(ws);
        var ext = path.extname(fsFile).toLowerCase();
        if (fsReadUserInfo) {
          // Run stat and read as target OS user
          var statResult = fsAsUser("stat", { file: fsFile }, fsReadUserInfo);
          if (statResult.size > FS_MAX_SIZE) {
            sendTo(ws, { type: "fs_read_result", path: msg.path, binary: true, size: statResult.size, error: "File too large (" + (statResult.size / 1024 / 1024).toFixed(1) + " MB)" });
            return true;
          }
          if (BINARY_EXTS.has(ext)) {
            var result = { type: "fs_read_result", path: msg.path, binary: true, size: statResult.size };
            if (IMAGE_EXTS.has(ext)) result.imageUrl = "api/file?path=" + encodeURIComponent(msg.path);
            sendTo(ws, result);
            return true;
          }
          var readResult = fsAsUser("read", { file: fsFile, readContent: true }, fsReadUserInfo);
          sendTo(ws, { type: "fs_read_result", path: msg.path, content: readResult.content, size: statResult.size });
        } else {
          var stat = fs.statSync(fsFile);
          if (stat.size > FS_MAX_SIZE) {
            sendTo(ws, { type: "fs_read_result", path: msg.path, binary: true, size: stat.size, error: "File too large (" + (stat.size / 1024 / 1024).toFixed(1) + " MB)" });
            return true;
          }
          if (BINARY_EXTS.has(ext)) {
            var result = { type: "fs_read_result", path: msg.path, binary: true, size: stat.size };
            if (IMAGE_EXTS.has(ext)) result.imageUrl = "api/file?path=" + encodeURIComponent(msg.path);
            sendTo(ws, result);
            return true;
          }
          var content = fs.readFileSync(fsFile, "utf8");
          sendTo(ws, { type: "fs_read_result", path: msg.path, content: content, size: stat.size });
        }
      } catch (e) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, error: e.message });
      }
      return true;
    }

    // --- fs_write ---
    if (msg.type === "fs_write") {
      var fsWriteFile = safePath(cwd, msg.path);
      if (!fsWriteFile && getOsUserInfoForWs(ws)) {
        fsWriteFile = safeAbsPath(msg.path);
      }
      if (!fsWriteFile) {
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: false, error: "Access denied" });
        return true;
      }
      try {
        var fsWriteUserInfo = getOsUserInfoForWs(ws);
        if (fsWriteUserInfo) {
          fsAsUser("write", { file: fsWriteFile, content: msg.content || "" }, fsWriteUserInfo);
        } else {
          fs.writeFileSync(fsWriteFile, msg.content || "", "utf8");
        }
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: true });
      } catch (e) {
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: false, error: e.message });
      }
      return true;
    }

    // --- Project settings permission gate ---
    if (msg.type === "get_project_env" || msg.type === "set_project_env" ||
        msg.type === "read_global_claude_md" || msg.type === "write_global_claude_md" ||
        msg.type === "get_shared_env" || msg.type === "set_shared_env" ||
        msg.type === "transfer_project_owner") {
      if (ws._clayUser) {
        var psPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!psPerms.projectSettings) {
          sendTo(ws, { type: "error", text: "Project settings access is not permitted" });
          return true;
        }
      }
    }

    // --- Project environment variables ---
    if (msg.type === "get_project_env") {
      var envrc = "";
      var hasEnvrc = false;
      if (typeof opts.onGetProjectEnv === "function") {
        var envResult = opts.onGetProjectEnv(msg.slug);
        envrc = envResult.envrc || "";
      }
      try {
        var envrcPath = path.join(cwd, ".envrc");
        hasEnvrc = fs.existsSync(envrcPath);
      } catch (e) {}
      sendTo(ws, { type: "project_env_result", slug: msg.slug, envrc: envrc, hasEnvrc: hasEnvrc });
      return true;
    }

    if (msg.type === "set_project_env") {
      if (typeof opts.onSetProjectEnv === "function") {
        var envError = validateEnvString(msg.envrc || "");
        if (envError) {
          sendTo(ws, { type: "set_project_env_result", ok: false, slug: msg.slug, error: envError });
          return true;
        }
        var setResult = opts.onSetProjectEnv(msg.slug, msg.envrc || "");
        sendTo(ws, { type: "set_project_env_result", ok: setResult.ok, slug: msg.slug, error: setResult.error });
      } else {
        sendTo(ws, { type: "set_project_env_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Global CLAUDE.md ---
    if (msg.type === "read_global_claude_md") {
      var globalMdPath = path.join(require("./config").REAL_HOME, ".claude", "CLAUDE.md");
      try {
        var globalMdContent = fs.readFileSync(globalMdPath, "utf8");
        sendTo(ws, { type: "global_claude_md_result", content: globalMdContent });
      } catch (e) {
        sendTo(ws, { type: "global_claude_md_result", error: e.message });
      }
      return true;
    }

    if (msg.type === "write_global_claude_md") {
      var globalMdDir = path.join(require("./config").REAL_HOME, ".claude");
      var globalMdWritePath = path.join(globalMdDir, "CLAUDE.md");
      try {
        if (!fs.existsSync(globalMdDir)) {
          fs.mkdirSync(globalMdDir, { recursive: true });
        }
        fs.writeFileSync(globalMdWritePath, msg.content || "", "utf8");
        sendTo(ws, { type: "write_global_claude_md_result", ok: true });
      } catch (e) {
        sendTo(ws, { type: "write_global_claude_md_result", ok: false, error: e.message });
      }
      return true;
    }

    // --- Shared environment variables ---
    if (msg.type === "get_shared_env") {
      var sharedEnvrc = "";
      if (typeof opts.onGetSharedEnv === "function") {
        var sharedResult = opts.onGetSharedEnv();
        sharedEnvrc = sharedResult.envrc || "";
      }
      sendTo(ws, { type: "shared_env_result", envrc: sharedEnvrc });
      return true;
    }

    if (msg.type === "set_shared_env") {
      if (typeof opts.onSetSharedEnv === "function") {
        var sharedEnvError = validateEnvString(msg.envrc || "");
        if (sharedEnvError) {
          sendTo(ws, { type: "set_shared_env_result", ok: false, error: sharedEnvError });
          return true;
        }
        var sharedSetResult = opts.onSetSharedEnv(msg.envrc || "");
        sendTo(ws, { type: "set_shared_env_result", ok: sharedSetResult.ok, error: sharedSetResult.error });
      } else {
        sendTo(ws, { type: "set_shared_env_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- File watcher ---
    if (msg.type === "fs_watch") {
      if (msg.path) startFileWatch(msg.path);
      return true;
    }

    if (msg.type === "fs_unwatch") {
      stopFileWatch();
      return true;
    }

    // --- File edit history ---
    if (msg.type === "fs_file_history") {
      var histPath = msg.path;
      if (!histPath) {
        sendTo(ws, { type: "fs_file_history_result", path: histPath, entries: [] });
        return true;
      }
      var absHistPath = path.resolve(cwd, histPath);
      var entries = [];

      // Collect session edits
      sm.sessions.forEach(function (session) {
        var sessionLocalId = session.localId;
        var sessionTitle = session.title || "Untitled";
        var histLen = session.history.length || 1;

        for (var hi = 0; hi < session.history.length; hi++) {
          var entry = session.history[hi];
          if (entry.type !== "tool_executing") continue;
          if (entry.name !== "Edit" && entry.name !== "Write") continue;
          if (!entry.input || !entry.input.file_path) continue;
          if (entry.input.file_path !== absHistPath) continue;

          // Find parent assistant UUID + message snippet by scanning backwards
          var assistantUuid = null;
          var uuidIndex = -1;
          for (var hj = hi - 1; hj >= 0; hj--) {
            if (session.history[hj].type === "message_uuid" && session.history[hj].messageType === "assistant") {
              assistantUuid = session.history[hj].uuid;
              uuidIndex = hj;
              break;
            }
          }

          // Find user prompt by scanning backwards from the assistant uuid
          var messageSnippet = "";
          var searchFrom = uuidIndex >= 0 ? uuidIndex : hi;
          for (var hk = searchFrom - 1; hk >= 0; hk--) {
            if (session.history[hk].type === "user_message" && session.history[hk].text) {
              messageSnippet = session.history[hk].text.trim().substring(0, 100);
              break;
            }
          }

          // Collect Claude's explanation: scan backwards from tool_executing
          // to find the nearest delta text block (skipping tool_start).
          // If no delta found immediately before this tool, scan past
          // intervening tool blocks to find the last delta text within
          // the same assistant turn.
          var assistantSnippet = "";
          var deltaChunks = [];
          for (var hd = hi - 1; hd >= 0; hd--) {
            var hEntry = session.history[hd];
            if (hEntry.type === "tool_start") continue;
            if (hEntry.type === "delta" && hEntry.text) {
              deltaChunks.unshift(hEntry.text);
            } else {
              break;
            }
          }
          if (deltaChunks.length === 0) {
            // No delta immediately before; scan past tool blocks
            // to find the nearest preceding delta in the same turn
            for (var hd2 = hi - 1; hd2 >= 0; hd2--) {
              var hEntry2 = session.history[hd2];
              if (hEntry2.type === "tool_start" || hEntry2.type === "tool_executing" || hEntry2.type === "tool_result") continue;
              if (hEntry2.type === "delta" && hEntry2.text) {
                // Found a delta before an earlier tool in the same turn.
                // Collect this contiguous block of deltas.
                for (var hd3 = hd2; hd3 >= 0; hd3--) {
                  var hEntry3 = session.history[hd3];
                  if (hEntry3.type === "tool_start") continue;
                  if (hEntry3.type === "delta" && hEntry3.text) {
                    deltaChunks.unshift(hEntry3.text);
                  } else {
                    break;
                  }
                }
                break;
              } else {
                // Hit message_uuid, user_message, etc. Stop.
                break;
              }
            }
          }
          assistantSnippet = deltaChunks.join("").trim().substring(0, 150);

          // Approximate timestamp: interpolate between session creation and last activity
          var tStart = session.createdAt || 0;
          var tEnd = session.lastActivity || tStart;
          var ts = tStart + Math.floor((hi / histLen) * (tEnd - tStart));

          var editRecord = {
            source: "session",
            timestamp: ts,
            sessionLocalId: sessionLocalId,
            sessionTitle: sessionTitle,
            assistantUuid: assistantUuid,
            toolId: entry.id,
            messageSnippet: messageSnippet,
            assistantSnippet: assistantSnippet,
            toolName: entry.name,
          };

          if (entry.name === "Edit") {
            editRecord.old_string = entry.input.old_string || "";
            editRecord.new_string = entry.input.new_string || "";
          } else {
            editRecord.isFullWrite = true;
          }

          entries.push(editRecord);
        }
      });

      // Collect git commits
      try {
        var gitLog = execFileSync(
          "git", ["log", "--format=%H|%at|%an|%s", "--follow", "--", histPath],
          { cwd: cwd, encoding: "utf8", timeout: 5000 }
        );
        var gitLines = gitLog.trim().split("\n");
        for (var gi = 0; gi < gitLines.length; gi++) {
          if (!gitLines[gi]) continue;
          var parts = gitLines[gi].split("|");
          if (parts.length < 4) continue;
          entries.push({
            source: "git",
            hash: parts[0],
            timestamp: parseInt(parts[1], 10) * 1000,
            author: parts[2],
            message: parts.slice(3).join("|"),
          });
        }
      } catch (e) {
        // Not a git repo or file not tracked, that is fine
      }

      // Sort by timestamp descending (newest first)
      entries.sort(function (a, b) { return b.timestamp - a.timestamp; });

      sendTo(ws, { type: "fs_file_history_result", path: histPath, entries: entries });
      return true;
    }

    // --- Git diff for file history ---
    if (msg.type === "fs_git_diff") {
      var diffPath = msg.path;
      var hash = msg.hash;
      var hash2 = msg.hash2 || null;
      if (!diffPath || !hash) {
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, path: diffPath, diff: "", error: "Missing params" });
        return true;
      }
      try {
        var diff;
        if (hash2) {
          diff = execFileSync("git", ["diff", hash, hash2, "--", diffPath],
            { cwd: cwd, encoding: "utf8", timeout: 5000 });
        } else {
          diff = execFileSync("git", ["show", hash, "--format=", "--", diffPath],
            { cwd: cwd, encoding: "utf8", timeout: 5000 });
        }
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, hash2: hash2, path: diffPath, diff: diff || "" });
      } catch (e) {
        sendTo(ws, { type: "fs_git_diff_result", hash: hash, hash2: hash2, path: diffPath, diff: "", error: e.message });
      }
      return true;
    }

    // --- File content at a git commit ---
    if (msg.type === "fs_file_at") {
      var atPath = msg.path;
      var atHash = msg.hash;
      if (!atPath || !atHash) {
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: "Missing params" });
        return true;
      }
      try {
        // Convert to repo-relative path (git show requires hash:relative/path)
        var atAbsPath = path.resolve(cwd, atPath);
        var atRelPath = path.relative(cwd, atAbsPath);
        var content = execFileSync("git", ["show", atHash + ":" + atRelPath],
          { cwd: cwd, encoding: "utf8", timeout: 5000 });
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: content });
      } catch (e) {
        sendTo(ws, { type: "fs_file_at_result", hash: atHash, path: atPath, content: "", error: e.message });
      }
      return true;
    }

    return false;
  }

  return {
    handleFilesystemMessage: handleFilesystemMessage,
  };
}

module.exports = { attachFilesystem: attachFilesystem };
