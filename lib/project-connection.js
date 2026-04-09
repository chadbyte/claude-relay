var fs = require("fs");
var path = require("path");
var usersModule = require("./users");
var userPresence = require("./user-presence");

/**
 * Attach connection/disconnection handlers to a project context.
 *
 * ctx fields:
 *   cwd, slug, isMate, osUsers, debug, dangerouslySkipPermissions,
 *   currentVersion, lanHost, sm, tm, nm, clients, send, sendTo,
 *   opts, loopState, loopRegistry, _loop, pushModule,
 *   hydrateImageRefs, broadcastClientCount, broadcastPresence,
 *   getProjectList, getHubSchedules, loadContextSources,
 *   restoreDebateState, handleMessage, handleDisconnection,
 *   stopFileWatch, stopAllDirWatches,
 *   getProjectOwnerId, setProjectOwnerId, getLatestVersion,
 *   getTitle, getProject
 */
function attachConnection(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var isMate = ctx.isMate;
  var osUsers = ctx.osUsers;
  var debug = ctx.debug;
  var dangerouslySkipPermissions = ctx.dangerouslySkipPermissions;
  var currentVersion = ctx.currentVersion;
  var lanHost = ctx.lanHost;
  var sm = ctx.sm;
  var tm = ctx.tm;
  var nm = ctx.nm;
  var clients = ctx.clients;
  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var opts = ctx.opts;
  var _loop = ctx._loop;
  var hydrateImageRefs = ctx.hydrateImageRefs;
  var broadcastClientCount = ctx.broadcastClientCount;
  var broadcastPresence = ctx.broadcastPresence;
  var getProjectList = ctx.getProjectList;
  var getHubSchedules = ctx.getHubSchedules;
  var loadContextSources = ctx.loadContextSources;
  var restoreDebateState = ctx.restoreDebateState;
  var stopFileWatch = ctx.stopFileWatch;
  var stopAllDirWatches = ctx.stopAllDirWatches;
  var getProjectOwnerId = ctx.getProjectOwnerId;
  var setProjectOwnerId = ctx.setProjectOwnerId;
  var getLatestVersion = ctx.getLatestVersion;
  var getTitle = ctx.getTitle;
  var getProject = ctx.getProject;

  function handleConnection(ws, wsUser, handleMessage, handleDisconnection) {
    ws._clayUser = wsUser || null;
    clients.add(ws);
    broadcastClientCount();

    var loopState = _loop.loopState;
    var loopRegistry = _loop.loopRegistry;

    // Resume loop if server restarted mid-execution (deferred so client gets initial state first)
    if (loopState._needsResume) {
      delete loopState._needsResume;
      setTimeout(function() { _loop.resumeLoop(); }, 500);
    }

    // Auto-assign owner if project has none and a user connects (e.g. IPC-added projects)
    var projectOwnerId = getProjectOwnerId();
    if (!projectOwnerId && ws._clayUser && ws._clayUser.id && !isMate) {
      setProjectOwnerId(ws._clayUser.id);
      projectOwnerId = ws._clayUser.id;
      if (opts.onProjectOwnerChanged) {
        opts.onProjectOwnerChanged(slug, projectOwnerId);
      }
      console.log("[project] Auto-assigned owner for " + slug + ": " + projectOwnerId);
    }

    // Send cached state
    var _userId = ws._clayUser ? ws._clayUser.id : null;
    var _filteredProjects = getProjectList(_userId);
    var title = getTitle();
    var project = getProject();
    sendTo(ws, { type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, dangerouslySkipPermissions: dangerouslySkipPermissions, osUsers: osUsers, lanHost: lanHost, projectCount: _filteredProjects.length, projects: _filteredProjects, projectOwnerId: projectOwnerId });
    var latestVersion = getLatestVersion();
    if (latestVersion && ws._clayUser && ws._clayUser.role === "admin") {
      sendTo(ws, { type: "update_available", version: latestVersion });
    }
    if (sm.slashCommands) {
      sendTo(ws, { type: "slash_commands", commands: sm.slashCommands });
    }
    if (sm.currentModel) {
      sendTo(ws, { type: "model_info", model: sm.currentModel, models: sm.availableModels || [] });
    }
    sendTo(ws, { type: "config_state", model: sm.currentModel || "", mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
    sendTo(ws, { type: "term_list", terminals: tm.list() });
    var restoredSources = loadContextSources(slug);
    sendTo(ws, { type: "context_sources_state", active: restoredSources });
    sendTo(ws, { type: "notes_list", notes: nm.list() });
    sendTo(ws, { type: "loop_registry_updated", records: getHubSchedules() });
    _loop.sendConnectionState(ws);

    // Session list (filtered for access control)
    var allSessions = [].concat(Array.from(sm.sessions.values())).filter(function (s) { return !s.hidden; });
    if (usersModule.isMultiUser() && wsUser) {
      allSessions = allSessions.filter(function (s) {
        return usersModule.canAccessSession(wsUser.id, s, { visibility: "public" });
      });
    } else if (!usersModule.isMultiUser()) {
      allSessions = allSessions.filter(function (s) { return !s.ownerId; });
    }
    sendTo(ws, {
      type: "session_list",
      sessions: allSessions.map(function (s) {
        var loop = s.loop ? Object.assign({}, s.loop) : null;
        if (loop && loop.loopId && loopRegistry) {
          var rec = loopRegistry.getById(loop.loopId);
          if (rec) {
            if (rec.name) loop.name = rec.name;
            if (rec.source) loop.source = rec.source;
          }
        }
        return {
          id: s.localId,
          cliSessionId: s.cliSessionId || null,
          title: s.title || "New Session",
          active: s.localId === sm.activeSessionId,
          isProcessing: s.isProcessing,
          lastActivity: s.lastActivity || s.createdAt || 0,
          loop: loop,
          ownerId: s.ownerId || null,
          sessionVisibility: s.sessionVisibility || "shared",
        };
      }),
    });

    // Restore active session for this client from server-side presence
    var active = null;
    var presenceKey = wsUser ? wsUser.id : "_default";
    var storedPresence = userPresence.getPresence(slug, presenceKey);
    if (storedPresence && storedPresence.sessionId) {
      if (sm.sessions.has(storedPresence.sessionId)) {
        active = sm.sessions.get(storedPresence.sessionId);
      } else {
        sm.sessions.forEach(function (s) {
          if (s.cliSessionId && s.cliSessionId === storedPresence.sessionId) active = s;
        });
      }
      if (active && usersModule.isMultiUser() && wsUser) {
        if (!usersModule.canAccessSession(wsUser.id, active, { visibility: "public" })) active = null;
      } else if (active && !usersModule.isMultiUser() && active.ownerId) {
        active = null;
      }
    }
    if (!active && allSessions.length > 0) {
      active = allSessions[0];
      for (var fi = 1; fi < allSessions.length; fi++) {
        if ((allSessions[fi].lastActivity || 0) > (active.lastActivity || 0)) {
          active = allSessions[fi];
        }
      }
    }
    var autoCreated = false;
    if (!active) {
      var autoOpts = {};
      if (wsUser && usersModule.isMultiUser()) autoOpts.ownerId = wsUser.id;
      active = sm.createSession(autoOpts, ws);
      autoCreated = true;
    }
    if (active && !autoCreated) {
      if (!active.ownerId && wsUser && usersModule.isMultiUser()) {
        active.ownerId = wsUser.id;
        sm.saveSessionFile(active);
      }
      ws._clayActiveSession = active.localId;
      sendTo(ws, { type: "session_switched", id: active.localId, cliSessionId: active.cliSessionId || null, loop: active.loop || null });

      var total = active.history.length;
      var fromIndex = 0;
      if (total > sm.HISTORY_PAGE_SIZE) {
        fromIndex = sm.findTurnBoundary(active.history, Math.max(0, total - sm.HISTORY_PAGE_SIZE));
      }
      sendTo(ws, { type: "history_meta", total: total, from: fromIndex });
      for (var i = fromIndex; i < total; i++) {
        sendTo(ws, hydrateImageRefs(active.history[i]));
      }
      var _lastUsage = null, _lastModelUsage = null, _lastCost = null, _lastStreamInputTokens = null;
      for (var _ri = total - 1; _ri >= 0; _ri--) {
        if (active.history[_ri].type === "result") {
          var _r = active.history[_ri];
          _lastUsage = _r.usage || null;
          _lastModelUsage = _r.modelUsage || null;
          _lastCost = _r.cost != null ? _r.cost : null;
          _lastStreamInputTokens = _r.lastStreamInputTokens || null;
          break;
        }
      }
      sendTo(ws, { type: "history_done", lastUsage: _lastUsage, lastModelUsage: _lastModelUsage, lastCost: _lastCost, lastStreamInputTokens: _lastStreamInputTokens, contextUsage: active.lastContextUsage || null });

      if (active.isProcessing) {
        sendTo(ws, { type: "status", status: "processing" });
      }
      var pendingIds = Object.keys(active.pendingPermissions);
      for (var pi = 0; pi < pendingIds.length; pi++) {
        var p = active.pendingPermissions[pendingIds[pi]];
        sendTo(ws, {
          type: "permission_request_pending",
          requestId: p.requestId,
          toolName: p.toolName,
          toolInput: p.toolInput,
          toolUseId: p.toolUseId,
          decisionReason: p.decisionReason,
          mateId: p.mateId || undefined,
        });
      }
    }

    if (active) {
      userPresence.setPresence(slug, presenceKey, active.localId, storedPresence ? storedPresence.mateDm : null);
    }
    if (storedPresence && storedPresence.mateDm && !isMate) {
      sendTo(ws, { type: "restore_mate_dm", mateId: storedPresence.mateDm });
    }

    broadcastPresence();
    restoreDebateState(ws);

    ws.on("message", function (raw) {
      var msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      handleMessage(ws, msg);
    });

    ws.on("close", function () {
      handleDisconnection(ws);
    });
  }

  function handleDisconnection(ws) {
    if (ws._clayActiveSession) {
      var dcPresKey = ws._clayUser ? ws._clayUser.id : "_default";
      var dcExisting = userPresence.getPresence(slug, dcPresKey);
      userPresence.setPresence(slug, dcPresKey, ws._clayActiveSession, dcExisting ? dcExisting.mateDm : null);
    }
    tm.detachAll(ws);
    clients.delete(ws);
    if (clients.size === 0) {
      stopFileWatch();
      stopAllDirWatches();
    }
    broadcastClientCount();
    broadcastPresence();
  }

  return {
    handleConnection: handleConnection,
    handleDisconnection: handleDisconnection,
  };
}

module.exports = { attachConnection: attachConnection };
