var yoke = require("./yoke");
var contextBuilder = require("./session-handoff-context");

function hasUserContext(session) {
  var history = (session && session.history) || [];
  for (var i = 0; i < history.length; i++) {
    if (history[i] && history[i].type === "user_message" && history[i].text) return true;
    if (history[i] && history[i].type === "handoff_context" && history[i].request) return true;
  }
  return false;
}

function attachSessionHandoff(ctx) {
  var sm = ctx.sm;

  function sendResult(ws, ok, details) {
    ctx.sendTo(ws, Object.assign({ type: "session_handoff_result", ok: ok }, details || {}));
  }

  function validate(ws, source, targetVendor) {
    if (ctx.isMate) throw new Error("Session handoff is only available in projects.");
    if (!source) throw new Error("No active session was found.");
    if (ctx.splitStore && ctx.splitStore.groupForMember(source.localId)) {
      throw new Error("Open the session by itself before continuing it in another agent.");
    }
    if (source.isProcessing || source._queryStarting) {
      throw new Error("Wait for the current response to finish before continuing in another agent.");
    }
    if (!hasUserContext(source)) throw new Error("This session does not have any conversation to continue.");
    if (!targetVendor) throw new Error("Choose an agent for the handoff.");
    if (!ctx.adapters[targetVendor] || (sm.installedVendors || []).indexOf(targetVendor) === -1) {
      throw new Error("The selected coding agent is not installed.");
    }
    var linuxUser = ctx.getLinuxUserForSession(source);
    var vendorInfo = yoke.getVendorInfo(targetVendor);
    if (linuxUser && vendorInfo && vendorInfo.osUserIsolation === false) {
      throw new Error((vendorInfo.displayName || targetVendor) + " is not available for OS-isolated users.");
    }
    var ownerId = ws._clayUser && ctx.usersModule.isMultiUser() ? ws._clayUser.id : null;
    if ((source.ownerId || null) !== ownerId) throw new Error("Session access denied.");
    return linuxUser;
  }

  function quietRecord(session, entry) {
    session.history.push(entry);
    sm.appendToSessionFile(session, entry);
  }

  function handoff(ws, msg) {
    var source = sm.sessions.get(ws._clayActiveSession) || null;
    var targetVendor = typeof msg.targetVendor === "string" ? msg.targetVendor.trim() : "";
    var targetModel = typeof msg.model === "string" ? msg.model.trim() : "";
    var linuxUser;
    try {
      linuxUser = validate(ws, source, targetVendor);
    } catch (err) {
      sendResult(ws, false, { error: err.message || String(err) });
      return;
    }

    var targetEffort = yoke.clampEffort(
      targetVendor,
      msg.effort || (sm.currentEffortByVendor && sm.currentEffortByVendor[targetVendor]) || sm.currentEffort || "medium"
    ) || null;
    var target = sm.createSessionRaw({
      ownerId: source.ownerId || null,
      sessionVisibility: source.sessionVisibility || "shared",
      vendor: targetVendor,
      model: targetModel || null,
      effort: targetEffort,
    });
    var targetName = (yoke.getVendorInfo(targetVendor) || {}).displayName || targetVendor;
    target.title = (source.title || "Continued session") + " · " + targetName;
    target.handoff = {
      sourceSessionId: source.localId,
      sourceVendor: source.vendor || sm.defaultVendor || "claude",
      createdAt: Date.now(),
      mode: "context",
      sourceHistoryIndex: source.history.length,
    };

    var sourceEntry = {
      type: "handoff_created",
      targetSessionId: target.localId,
      targetVendor: targetVendor,
      targetTitle: target.title,
      _ts: Date.now(),
    };
    var targetEntry = {
      type: "handoff_context",
      sourceSessionId: source.localId,
      sourceVendor: target.handoff.sourceVendor,
      sourceTitle: source.title || "Untitled session",
      targetVendor: targetVendor,
      request: contextBuilder.latestUserRequest(source.history),
      _ts: Date.now(),
    };
    quietRecord(source, sourceEntry);
    quietRecord(target, targetEntry);

    var prompt = contextBuilder.buildHandoffContext({
      cwd: ctx.cwd,
      source: source,
      targetVendor: targetVendor,
    });
    target.isProcessing = true;
    target.lastActivity = Date.now();
    target.sentToolResults = {};
    sm.switchSession(target.localId, ws);
    if (typeof ctx.onProcessingChanged === "function") ctx.onProcessingChanged();
    sendResult(ws, true, {
      sourceSessionId: source.localId,
      targetSessionId: target.localId,
      targetVendor: targetVendor,
    });

    var sdk = ctx.getSdk();
    function failStart(err) {
      target.isProcessing = false;
      sm.sendAndRecord(target, { type: "error", text: "Could not start the handoff session: " + (err.message || String(err)) });
      if (typeof ctx.onProcessingChanged === "function") ctx.onProcessingChanged();
      sm.broadcastSessionList();
    }
    if (!sdk || typeof sdk.startQuery !== "function") {
      failStart(new Error("SDK bridge is not ready."));
      return;
    }
    target._queryStartTs = Date.now();
    var startPromise;
    try {
      startPromise = sdk.startQuery(target, prompt, undefined, linuxUser);
    } catch (err) {
      failStart(err);
      return;
    }
    Promise.resolve(startPromise).catch(failStart);
  }

  function handleMessage(ws, msg) {
    if (msg.type === "handoff_session_options") {
      ctx.sendTo(ws, {
        type: "handoff_session_options",
        installedVendors: sm.installedVendors || [],
        modelsByVendor: sm.modelsByVendor || {},
        capabilitiesByVendor: sm.capabilitiesByVendor || {},
      });
      return true;
    }
    if (msg.type === "handoff_session") {
      handoff(ws, msg);
      return true;
    }
    return false;
  }

  return { handleMessage: handleMessage };
}

module.exports = {
  attachSessionHandoff: attachSessionHandoff,
  hasUserContext: hasUserContext,
};
