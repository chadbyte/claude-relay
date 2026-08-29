// Embedded mate chat server handler.
// Routes home_mate_* messages through whichever project socket is open and
// mirrors conversational session events into the home work hub.

var fs = require("fs");

function attachHomeChat(deps) {
  var users = deps.users;
  var mates = deps.mates;
  var projects = deps.projects;
  var addProject = deps.addProject;

  function findMateProject(userId, mateId, ensureRegistered) {
    var mateCtx = mates.buildMateCtx(userId);
    var allMates = mates.getAllMates(mateCtx);
    var mate = null;
    for (var i = 0; i < allMates.length; i++) {
      if (!allMates[i]) continue;
      if (mateId && allMates[i].id === mateId) {
        mate = allMates[i];
        break;
      }
      if (!mateId && allMates[i].builtinKey === "clay") mate = allMates[i];
    }
    if (!mate) return null;

    var slug = "mate-" + mate.id;
    if (!projects.has(slug)) {
      if (!ensureRegistered) return null;
      var dir = mates.getMateDir(mateCtx, mate.id);
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      var name = (mate.profile && mate.profile.displayName) || mate.name || "Mate";
      addProject(dir, slug, name, null, mate.createdBy || userId, null, {
        isMate: true,
        mateDisplayName: name,
        isHostAgent: mate.builtinKey === "clay",
      });
    }
    var ctx = projects.get(slug);
    return ctx ? { ctx: ctx, slug: slug, mate: mate } : null;
  }

  function ownsSession(session, userId) {
    if (!session || session.hidden) return false;
    if (users.isMultiUser()) return !!userId && session.ownerId === userId;
    return !session.ownerId;
  }

  function sessionReference(session) {
    return session.cliSessionId || "local:" + session.localId;
  }

  function resolveHomeSession(found, userId, reference) {
    if (!reference || typeof reference !== "string") return null;
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) return null;
    var localMatch = reference.match(/^local:(\d+)$/);
    var candidate = localMatch ? sessionManager.sessions.get(parseInt(localMatch[1], 10)) : null;
    if (!candidate) {
      sessionManager.sessions.forEach(function (session) {
        if (!candidate && session.cliSessionId === reference) candidate = session;
      });
    }
    return ownsSession(candidate, userId) ? candidate : null;
  }

  function listHomeSessions(found, userId) {
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) return [];
    var result = [];
    sessionManager.sessions.forEach(function (session) {
      if (!ownsSession(session, userId)) return;
      result.push({
        id: sessionReference(session),
        title: session.title || "New conversation",
        lastActivity: session.lastActivity || session.createdAt || 0,
        isProcessing: !!session.isProcessing,
      });
    });
    result.sort(function (a, b) { return b.lastActivity - a.lastActivity; });
    return result;
  }

  function getOrCreateHomeSession(found, userId) {
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) return null;
    var best = null;
    sessionManager.sessions.forEach(function (session) {
      if (!ownsSession(session, userId)) return;
      if (!best || (session.lastActivity || 0) > (best.lastActivity || 0)) best = session;
    });
    if (best) return best;
    return sessionManager.createSession({
      ownerId: userId,
      vendor: found.mate.vendor || "claude",
    }, null);
  }

  function historyToHomeChat(history) {
    var messages = [];
    var pending = "";
    function flushAssistant() {
      if (!pending) return;
      messages.push({ role: "assistant", text: pending });
      pending = "";
    }
    for (var i = 0; i < history.length; i++) {
      var event = history[i];
      if (!event) continue;
      if (event.type === "user_message" && event.text) {
        flushAssistant();
        messages.push({ role: "user", text: event.text });
      } else if (event.type === "delta" && typeof event.text === "string") {
        pending += event.text;
      } else if (event.type === "result" || event.type === "done") {
        flushAssistant();
      } else if (event.type === "error" && event.text) {
        flushAssistant();
        messages.push({ role: "assistant", text: "[error] " + event.text });
      }
    }
    flushAssistant();
    return messages;
  }

  function transformEvent(event, mateId, sessionId) {
    if (!event || typeof event.type !== "string") return null;
    if (event.type === "delta" && typeof event.text === "string") {
      return { type: "home_mate_delta", mateId: mateId, sessionId: sessionId, text: event.text };
    }
    if (event.type === "result" || event.type === "done") {
      return { type: "home_mate_done", mateId: mateId, sessionId: sessionId };
    }
    if (event.type === "error") {
      return { type: "home_mate_error", mateId: mateId, sessionId: sessionId, text: event.text || "Unknown error" };
    }
    return null;
  }

  function teardownTap(ws) {
    if (ws && ws._homeChatTap && typeof ws._homeChatTap.unsubscribe === "function") {
      try { ws._homeChatTap.unsubscribe(); } catch (e) {}
    }
    if (ws) ws._homeChatTap = null;
  }

  function setupTap(ws, found, sessionId) {
    teardownTap(ws);
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager || typeof sessionManager.subscribeSession !== "function") return;
    var mateId = found.mate.id;
    var unsubscribe = sessionManager.subscribeSession(sessionId, function (event) {
      if (ws.readyState !== 1) return;
      var activeSession = sessionManager.sessions.get(sessionId);
      var transformed = transformEvent(event, mateId, activeSession ? sessionReference(activeSession) : null);
      if (!transformed) return;
      try { ws.send(JSON.stringify(transformed)); } catch (e) {}
      if (event.type === "result" || event.type === "done") {
        var userId = ws._clayUser ? ws._clayUser.id : null;
        sendMessage(ws, { type: "home_mate_sessions_state", mateId: mateId, sessions: listHomeSessions(found, userId) });
      }
    });
    if (!unsubscribe) return;
    ws._homeChatTap = {
      unsubscribe: unsubscribe,
      sessionId: sessionId,
      mateId: mateId,
      mateSlug: found.slug,
      openedAt: Date.now(),
    };
  }

  function sendError(ws, mateId, text) {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({ type: "home_mate_error", mateId: mateId, text: text }));
    } catch (e) {}
  }

  function sendMessage(ws, payload) {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(payload)); } catch (e) {}
  }

  function sendHistory(ws, found, session) {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({
        type: "home_mate_history",
        mateId: found.mate.id,
        sessionId: sessionReference(session),
        messages: historyToHomeChat(session.history || []),
      }));
    } catch (e) {}
  }

  function handleMessage(ws, msg) {
    if (!msg || typeof msg.type !== "string") return false;
    if (msg.type !== "home_mate_open" && msg.type !== "home_mate_sessions_list" && msg.type !== "home_mate_session_open" && msg.type !== "home_mate_send" && msg.type !== "home_mate_new_session" && msg.type !== "home_mate_close" && msg.type !== "home_mate_memory_list" && msg.type !== "home_mate_knowledge_list") {
      return false;
    }

    if (msg.type === "home_mate_close") {
      teardownTap(ws);
      return true;
    }

    var userId = ws._clayUser ? ws._clayUser.id : null;
    if (users.isMultiUser() && !userId) {
      sendError(ws, msg.mateId || null, "Not authenticated.");
      return true;
    }

    var found = findMateProject(userId, msg.mateId, true);
    if (!found) {
      sendError(ws, msg.mateId || null, "Mate not available.");
      return true;
    }

    if (msg.type === "home_mate_memory_list") {
      var memory = found.ctx.getMemoryState();
      sendMessage(ws, {
        type: "home_mate_memory_state",
        mateId: found.mate.id,
        entries: memory.entries,
        summary: memory.summary,
      });
      return true;
    }

    if (msg.type === "home_mate_knowledge_list") {
      sendMessage(ws, {
        type: "home_mate_knowledge_state",
        mateId: found.mate.id,
        files: found.ctx.listKnowledgeFiles(),
      });
      return true;
    }

    if (msg.type === "home_mate_sessions_list") {
      sendMessage(ws, {
        type: "home_mate_sessions_state",
        mateId: found.mate.id,
        sessions: listHomeSessions(found, userId),
      });
      return true;
    }

    if (msg.type === "home_mate_session_open") {
      var selected = resolveHomeSession(found, userId, msg.sessionId);
      if (!selected) {
        sendMessage(ws, {
          type: "home_mate_error",
          mateId: found.mate.id,
          sessionId: msg.sessionId || null,
          code: "session_not_found",
          text: "Conversation not available.",
        });
        return true;
      }
      setupTap(ws, found, selected.localId);
      sendHistory(ws, found, selected);
      sendMessage(ws, { type: "home_mate_sessions_state", mateId: found.mate.id, sessions: listHomeSessions(found, userId) });
      return true;
    }

    if (msg.type === "home_mate_open") {
      var session = getOrCreateHomeSession(found, userId);
      if (!session) {
        sendError(ws, found.mate.id, "Could not open mate session.");
        return true;
      }
      setupTap(ws, found, session.localId);
      sendHistory(ws, found, session);
      sendMessage(ws, { type: "home_mate_sessions_state", mateId: found.mate.id, sessions: listHomeSessions(found, userId) });
      return true;
    }

    if (msg.type === "home_mate_new_session") {
      var sessionManager = found.ctx.getSessionManager();
      if (!sessionManager) {
        sendError(ws, found.mate.id, "Session manager unavailable.");
        return true;
      }
      var fresh = sessionManager.createSession({
        ownerId: userId,
        vendor: found.mate.vendor || "claude",
      }, null);
      setupTap(ws, found, fresh.localId);
      sendHistory(ws, found, fresh);
      sendMessage(ws, { type: "home_mate_sessions_state", mateId: found.mate.id, sessions: listHomeSessions(found, userId) });
      return true;
    }

    if (msg.type === "home_mate_send") {
      var text = (msg.text || "").trim();
      if (!text) return true;
      var sessionManager2 = found.ctx.getSessionManager();
      if (!sessionManager2) {
        sendError(ws, found.mate.id, "Session manager unavailable.");
        return true;
      }

      var tap = ws._homeChatTap;
      var sessionId = tap && tap.mateId === found.mate.id ? tap.sessionId : null;
      if (!sessionId) {
        var resumed = getOrCreateHomeSession(found, userId);
        if (!resumed) {
          sendError(ws, found.mate.id, "Could not open mate session.");
          return true;
        }
        sessionId = resumed.localId;
        setupTap(ws, found, sessionId);
      }

      var activeSession = sessionManager2.sessions.get(sessionId);
      if (!activeSession) {
        sendError(ws, found.mate.id, "Session not found: " + sessionId);
        return true;
      }
      var sdk = found.ctx.sdk;
      if (!sdk) {
        sendError(ws, found.mate.id, "Mate SDK bridge unavailable.");
        return true;
      }
      try {
        if (!activeSession.isProcessing) {
          activeSession.isProcessing = true;
          activeSession.sentToolResults = {};
          if (!activeSession.queryInstance && (!activeSession.worker || activeSession.messageQueue !== "worker")) {
            sdk.startQuery(activeSession, text, null, null);
          } else {
            sdk.pushMessage(activeSession, text, null);
          }
        } else {
          sdk.pushMessage(activeSession, text, null);
        }
      } catch (e) {
        sendError(ws, found.mate.id, "Failed to dispatch: " + (e.message || String(e)));
      }
      return true;
    }

    return false;
  }

  function handleDisconnection(ws) {
    teardownTap(ws);
  }

  return { handleMessage: handleMessage, handleDisconnection: handleDisconnection };
}

module.exports = { attachHomeChat: attachHomeChat };
