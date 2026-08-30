// Embedded mate chat server handler.
// Routes home_mate_* messages through whichever project socket is open and
// mirrors conversational session events into the home work hub.

var fs = require("fs");
var attachHomeModels = require("./server-home-models").attachHomeModels;

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

  function getLatestHomeSession(found, userId) {
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) return null;
    var best = null;
    sessionManager.sessions.forEach(function (session) {
      if (!ownsSession(session, userId)) return;
      if (!best || (session.lastActivity || 0) > (best.lastActivity || 0)) best = session;
    });
    return best;
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

  function latestAssistantText(history) {
    var messages = historyToHomeChat(history || []);
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].text || "";
      if (messages[i].role === "user") return "";
    }
    return "";
  }

  function transformEvent(event, mateId, session, requestId, stableSessionId) {
    if (!event || typeof event.type !== "string") return null;
    var metadata = {
      mateId: mateId,
      sessionId: stableSessionId || null,
      requestId: requestId || null,
      model: session && session.model ? session.model : null,
      vendor: session && session.vendor ? session.vendor : null,
    };
    if (event.type === "delta" && typeof event.text === "string") {
      return Object.assign({ type: "home_mate_delta", text: event.text }, metadata);
    }
    if (event.type === "result" || event.type === "done") {
      return Object.assign({ type: "home_mate_done", text: session ? latestAssistantText(session.history) : "" }, metadata);
    }
    if (event.type === "error") {
      return Object.assign({ type: "home_mate_error", text: event.text || "Unknown error" }, metadata);
    }
    return null;
  }

  function teardownTap(ws) {
    if (ws && ws._homeChatTap && typeof ws._homeChatTap.unsubscribe === "function") {
      try { ws._homeChatTap.unsubscribe(); } catch (e) {}
    }
    if (ws) ws._homeChatTap = null;
  }

  function setupTap(ws, found, sessionId, requestId) {
    teardownTap(ws);
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager || typeof sessionManager.subscribeSession !== "function") return;
    var mateId = found.mate.id;
    var openedSession = sessionManager.sessions.get(sessionId);
    var stableSessionId = openedSession ? sessionReference(openedSession) : null;
    var unsubscribe = sessionManager.subscribeSession(sessionId, function (event) {
      if (ws.readyState !== 1) return;
      var activeSession = sessionManager.sessions.get(sessionId);
      if (event && event.type === "session_id" && event.cliSessionId) {
        var previousSessionId = stableSessionId;
        stableSessionId = event.cliSessionId;
        sendMessage(ws, { type: "home_mate_session_identity", mateId: mateId, previousSessionId: previousSessionId, sessionId: stableSessionId, requestId: requestId || null });
        if (ws._homeChatTap && ws._homeChatTap.sessionId === sessionId) ws._homeChatTap.sessionReference = stableSessionId;
        return;
      }
      var transformed = transformEvent(event, mateId, activeSession, requestId, stableSessionId);
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
      sessionReference: stableSessionId,
      mateId: mateId,
      mateSlug: found.slug,
      requestId: requestId || null,
      openedAt: Date.now(),
    };
  }

  function sendError(ws, mateId, text, requestId, sessionId, code) {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({
        type: "home_mate_error",
        mateId: mateId,
        sessionId: sessionId || null,
        requestId: requestId || null,
        code: code || null,
        text: text,
      }));
    } catch (e) {}
  }

  function sendMessage(ws, payload) {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(payload)); } catch (e) {}
  }

  var homeModels = attachHomeModels({ users: users, mates: mates, projects: projects, sendMessage: sendMessage });

  function sendHistory(ws, found, session, requestId) {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({
        type: "home_mate_history",
        mateId: found.mate.id,
        sessionId: sessionReference(session),
        requestId: requestId || null,
        model: session.model || null,
        vendor: session.vendor || null,
        messages: historyToHomeChat(session.history || []),
      }));
    } catch (e) {}
  }

  async function ensureSessionModel(ws, found, userId, session, resolvedMateModel) {
    if (session && typeof session.model === "string" && session.model.trim()) return session.model;
    if (!session) throw new Error("Conversation not available.");
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager || typeof sessionManager.saveSessionFile !== "function") {
      var persistError = new Error("Could not persist the conversation model. Reconnect and try again.");
      persistError.code = "model_unavailable";
      throw persistError;
    }
    var resolved = resolvedMateModel || await homeModels.resolveMateModel(ws, found, userId);
    session.vendor = resolved.vendor;
    session.model = resolved.model;
    sessionManager.saveSessionFile(session);
    return session.model;
  }

  function sendModelError(ws, found, msg, error, sessionId) {
    var text = error && error.message ? error.message : String(error || "Model unavailable.");
    sendError(ws, found.mate.id, text, msg.requestId || null, sessionId || msg.sessionId || null, error && error.code ? error.code : null);
  }

  async function openExactSession(ws, found, userId, selected, msg) {
    await ensureSessionModel(ws, found, userId, selected, null);
    setupTap(ws, found, selected.localId, msg.requestId || null);
    sendHistory(ws, found, selected, msg.requestId || null);
    sendMessage(ws, { type: "home_mate_sessions_state", mateId: found.mate.id, sessions: listHomeSessions(found, userId) });
  }

  async function openDefaultSession(ws, found, userId, msg) {
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) throw new Error("Session manager unavailable.");
    var session = getLatestHomeSession(found, userId);
    if (!session) {
      var resolved = await homeModels.resolveMateModel(ws, found, userId);
      session = sessionManager.createSession({ ownerId: userId, vendor: resolved.vendor, model: resolved.model }, null);
    } else {
      await ensureSessionModel(ws, found, userId, session, null);
    }
    setupTap(ws, found, session.localId, msg.requestId || null);
    sendHistory(ws, found, session, msg.requestId || null);
    sendMessage(ws, { type: "home_mate_sessions_state", mateId: found.mate.id, sessions: listHomeSessions(found, userId) });
  }

  async function openNewSession(ws, found, userId, msg) {
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) throw new Error("Session manager unavailable.");
    var resolved = await homeModels.resolveMateModel(ws, found, userId);
    var fresh = sessionManager.createSession({ ownerId: userId, vendor: resolved.vendor, model: resolved.model }, null);
    setupTap(ws, found, fresh.localId, msg.requestId || null);
    sendHistory(ws, found, fresh, msg.requestId || null);
    sendMessage(ws, { type: "home_mate_sessions_state", mateId: found.mate.id, sessions: listHomeSessions(found, userId) });
  }

  async function sendHomeMessage(ws, found, userId, msg) {
    var text = (msg.text || "").trim();
    if (!text) return;
    var tap = ws._homeChatTap;
    var requestId = msg.requestId || (tap && tap.requestId) || null;
    var sessionReferenceValue = msg.sessionId || (tap && tap.sessionReference) || null;
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) throw new Error("Session manager unavailable.");
    var sessionId = tap && tap.mateId === found.mate.id ? tap.sessionId : null;
    var activeSession = sessionId ? sessionManager.sessions.get(sessionId) : null;
    if (!activeSession) {
      var resolved = await homeModels.resolveMateModel(ws, found, userId);
      activeSession = getLatestHomeSession(found, userId);
      if (!activeSession) {
        activeSession = sessionManager.createSession({ ownerId: userId, vendor: resolved.vendor, model: resolved.model }, null);
      } else {
        await ensureSessionModel(ws, found, userId, activeSession, resolved);
      }
      setupTap(ws, found, activeSession.localId, requestId);
      sessionReferenceValue = sessionReference(activeSession);
    } else {
      await ensureSessionModel(ws, found, userId, activeSession, null);
    }
    if (!activeSession.model) {
      var missingModelError = new Error("Choose a model before sending a message.");
      missingModelError.code = "model_unavailable";
      throw missingModelError;
    }
    var sdk = found.ctx.sdk;
    if (!sdk) {
      var sdkError = new Error("Mate SDK bridge unavailable.");
      sdkError.sessionId = sessionReference(activeSession);
      throw sdkError;
    }
    if (typeof sessionManager.sendAndRecord !== "function") {
      var historyError = new Error("Conversation history is unavailable.");
      historyError.sessionId = sessionReference(activeSession);
      throw historyError;
    }
    sessionManager.sendAndRecord(activeSession, { type: "user_message", text: text });
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
    } catch (error) {
      error.sessionId = sessionReference(activeSession);
      throw error;
    }
    return sessionReferenceValue;
  }

  function handleMessage(ws, msg) {
    if (!msg || typeof msg.type !== "string") return false;
    if (msg.type !== "home_mate_present" && msg.type !== "home_mate_open" && msg.type !== "home_mate_sessions_list" && msg.type !== "home_mate_session_open" && msg.type !== "home_mate_send" && msg.type !== "home_mate_new_session" && msg.type !== "home_mate_close" && msg.type !== "home_mate_memory_list" && msg.type !== "home_mate_knowledge_list" && msg.type !== "home_mate_models_get" && msg.type !== "home_mate_model_set") {
      return false;
    }

    if (msg.type === "home_mate_present") {
      ws._homeChatPresented = msg.visible === true;
      return true;
    }

    if (msg.type === "home_mate_close") {
      ws._homeChatPresented = false;
      teardownTap(ws);
      return true;
    }

    var userId = ws._clayUser ? ws._clayUser.id : null;
    if (users.isMultiUser() && !userId) {
      if (msg.type === "home_mate_models_get" || msg.type === "home_mate_model_set") homeModels.sendAccessError(ws, msg, "Not authenticated.");
      else sendError(ws, msg.mateId || null, "Not authenticated.", msg.requestId || null, msg.sessionId || null);
      return true;
    }

    var found = findMateProject(userId, msg.mateId, true);
    if (!found) {
      if (msg.type === "home_mate_models_get" || msg.type === "home_mate_model_set") homeModels.sendAccessError(ws, msg, "Mate not available.");
      else sendError(ws, msg.mateId || null, "Mate not available.", msg.requestId || null, msg.sessionId || null);
      return true;
    }

    if (msg.type === "home_mate_models_get") {
      homeModels.sendMateModels(ws, found, msg.requestId || null, msg.vendor || null).catch(function (error) {
        sendMessage(ws, { type: "home_mate_models_state", mateId: found.mate.id, requestId: msg.requestId || null, vendor: msg.vendor || found.mate.vendor || "claude", mateVendor: found.mate.vendor || "claude", mateModel: found.mate.model || "", model: "", models: [], vendors: [], status: "error", error: error.message || String(error) });
      });
      return true;
    }

    if (msg.type === "home_mate_model_set") {
      homeModels.setMateModel(ws, found, userId, msg).catch(function (error) {
        sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: msg.requestId || null, ok: false, error: error.message || String(error) });
      });
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
        sendError(ws, found.mate.id, "Conversation not available.", msg.requestId || null, msg.sessionId || null, "session_not_found");
        return true;
      }
      openExactSession(ws, found, userId, selected, msg).catch(function (error) {
        sendModelError(ws, found, msg, error, sessionReference(selected));
      });
      return true;
    }

    if (msg.type === "home_mate_open") {
      openDefaultSession(ws, found, userId, msg).catch(function (error) {
        sendModelError(ws, found, msg, error, null);
      });
      return true;
    }

    if (msg.type === "home_mate_new_session") {
      openNewSession(ws, found, userId, msg).catch(function (error) {
        sendModelError(ws, found, msg, error, null);
      });
      return true;
    }

    if (msg.type === "home_mate_send") {
      var sendTap = ws._homeChatTap;
      var sendRequestId = msg.requestId || (sendTap && sendTap.requestId) || null;
      var sendSessionReference = msg.sessionId || (sendTap && sendTap.sessionReference) || null;
      sendHomeMessage(ws, found, userId, msg).catch(function (error) {
        sendError(ws, found.mate.id, error.message || String(error), sendRequestId, error.sessionId || sendSessionReference, error.code || null);
      });
      return true;
    }

    return false;
  }

  function handleDisconnection(ws) {
    ws._homeChatPresented = false;
    teardownTap(ws);
  }

  return { handleMessage: handleMessage, handleDisconnection: handleDisconnection };
}

module.exports = { attachHomeChat: attachHomeChat };
