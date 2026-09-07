var pairMcp = require("./session-pair-mcp-server");
var pairPrompts = require("./session-pair-prompts");
var { attachPairFactory } = require("./session-pair-factory");
var { attachPairLifecycle } = require("./project-pair-lifecycle");
var { attachPairTurnControl } = require("./session-pair-turn-control");
var driverEligibility = require("./session-driver-eligibility"), driverOrchestration = require("./session-driver-orchestration");
var { attachWorkerPermission } = require("./project-worker-permission");
var { attachWorkerProposal } = require("./project-worker-proposal");
var MAX_RESPONSE_CHARS = 30000;
function toolResult(value) { return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] }); }
function toolError(err) {
  return Promise.resolve({
    content: [{ type: "text", text: "Error: " + (err.message || err) }],
    isError: true,
  });
}
function responseText(history, fromIndex) {
  var text = "";
  for (var i = Math.max(0, fromIndex || 0); i < history.length; i++) {
    if (history[i] && history[i].type === "delta" && history[i].text) text += history[i].text;
  }
  if (text.length > MAX_RESPONSE_CHARS) text = text.slice(-MAX_RESPONSE_CHARS);
  return text;
}

function errorSince(history, fromIndex) {
  for (var i = history.length - 1; i >= Math.max(0, fromIndex || 0); i--) {
    if (history[i] && history[i].type === "error") return history[i].text || "partner turn failed";
  }
  return null;
}

function recentTurns(session, count) {
  var history = session.history || [];
  var starts = [];
  for (var i = 0; i < history.length; i++) {
    if (history[i] && history[i].type === "user_message") starts.push(i);
  }
  var from = starts.length > 0 ? starts[Math.max(0, starts.length - count)] : 0;
  var turns = [];
  var current = null;
  for (var j = from; j < history.length; j++) {
    var item = history[j];
    if (!item) continue;
    if (item.type === "user_message") {
      current = { user: item.text || "", delegated: !!item.delegated, response: "" };
      turns.push(current);
    } else if (item.type === "delta" && item.text) {
      if (!current) { current = { user: "", delegated: false, response: "" }; turns.push(current); }
      current.response += item.text;
      if (current.response.length > MAX_RESPONSE_CHARS) current.response = current.response.slice(-MAX_RESPONSE_CHARS);
    }
  }
  return turns;
}

function attachSessionPair(ctx) {
  var sm = ctx.sm;
  var store = ctx.splitStore;
  var workerProposal;
  var workerPermission;
  var lifecycle;
  var turnControl = attachPairTurnControl({ sm: sm, splitStore: store });
  function groupAndPartner(caller, missingPairMessage) {
    if (!caller) throw new Error("partner tools require a session-bound tool server");
    // Captured handlers must remain bound to the exact live Session object.
    if (sm.sessions.get(caller.localId) !== caller) {
      throw new Error("this session is no longer live; the partner tools are bound to an exact session");
    }
    var group = store.groupForMember(caller.localId);
    if (!group) throw new Error(missingPairMessage || "this session is not in a split group");
    if (group.pair && group.pair.driverId !== caller.localId) {
      throw new Error("only the configured Driver can direct this pair");
    }
    var partnerId = group.members[0] === caller.localId ? group.members[1] : group.members[0];
    var partner = sm.sessions.get(partnerId);
    if (!partner) throw new Error("split partner session was not found");
    if (caller.ownerId !== partner.ownerId) throw new Error("split partner access denied");
    return { group: group, partner: partner };
  }

  function broadcastDelegation(group, caller, partner, active) {
    var message = {
      type: "split_delegation",
      groupId: group.id,
      from: caller.localId,
      to: partner.localId,
      active: !!active,
    };
    if (typeof ctx.broadcastDelegation === "function") ctx.broadcastDelegation(group, message);
    else ctx.send(message);
  }

  function finishDelegation(group, caller, partner, token) {
    if (partner._pairDelegation !== token) return;
    delete partner._pairDelegation;
    delete partner._delegatedBy;
    broadcastDelegation(group, caller, partner, false);
  }

  function resumeDriverWithMessage(caller, text, meta) {
    if (!caller || caller.destroying) return false;
    if (turnControl.blockedReason(caller)) return false;
    var record = {
      type: "user_message",
      text: text,
      _internal: true,
    };
    if (meta) {
      var keys = Object.keys(meta);
      for (var i = 0; i < keys.length; i++) record[keys[i]] = meta[keys[i]];
    }
    sm.sendAndRecord(caller, record);
    caller.lastActivity = Date.now();
    var sdk = ctx.getSdk();
    if (!sdk) {
      sm.sendAndRecord(caller, { type: "error", text: "Could not resume the Driver: SDK bridge is not ready" });
      return false;
    }
    if (!caller.isProcessing) {
      caller.isProcessing = true;
      caller.sentToolResults = {};
      ctx.onProcessingChanged();
      sm.sendToSession(caller, { type: "status", status: "processing" });
    }
    if (!sdk.pushMessage(caller, text)) {
      caller._queryStartTs = Date.now();
      Promise.resolve(sdk.startQuery(caller, text, undefined, ctx.getLinuxUserForSession(caller))).catch(function (err) {
        caller.isProcessing = false;
        sm.sendAndRecord(caller, { type: "error", text: err.message || String(err) });
        ctx.onProcessingChanged();
      });
    }
    sm.broadcastSessionList();
    return true;
  }

  function resumeDriverWithResult(caller, partner, token) {
    if (!token.detached || token.delivered || caller.destroying) return false;
    token.delivered = true;
    var failure = token.failure || null;
    var response = token.response || "";
    var text;
    if (token.interrupted) {
      text = "[Split Worker execution interrupted] The user interrupted the Split Worker mid-turn. Its work is PARTIAL and unverified — do not treat it as finished. Review what was done and decide next steps with the user.";
    } else {
      text = "A Split Worker task delegated through send_to_partner has finished.\n\n" +
        "Original task:\n" + token.message + "\n\n" +
        (failure ? "Split Worker error:\n" + failure : "Split Worker result:\n" + (response || "(No text response was recorded.)")) +
        "\n\nReview the result, verify it as needed, and continue the task.";
    }
    return resumeDriverWithMessage(caller, text, {
      partnerResult: true,
      partnerSessionId: partner.localId,
    });
  }

  function requestDetach(worker) {
    var token = worker && worker._pairDelegation;
    if (!token || token.detached || token.detachRequested) return false;
    token.detachRequested = true;
    return true;
  }

  function handleTurnDone(partner) {
    var token = partner && partner._pairDelegation;
    if (!token) return false;
    var group = store.groupForMember(partner.localId);
    if (!group || group.id !== token.groupId || group.members.indexOf(token.from) === -1) return false;
    var caller = sm.sessions.get(token.from);
    if (!caller || caller.ownerId !== partner.ownerId) return false;
    if (group.pair && (group.pair.driverId !== caller.localId || group.pair.workerId !== partner.localId)) {
      finishDelegation(group, caller, partner, token);
      return false;
    }
    token.response = responseText(partner.history || [], token.startIndex);
    token.failure = errorSince(partner.history || [], token.startIndex);
    token.interrupted = !token.failure && !!partner._lastTurnInterrupted;
    finishDelegation(group, caller, partner, token);
    return resumeDriverWithResult(caller, partner, token);
  }

  function waitForPartner(group, caller, partner, token, timeoutSeconds) {
    return new Promise(function (resolve, reject) {
      var deadline = Date.now() + timeoutSeconds * 1000;
      var timer = setInterval(function () {
        var currentGroup = store.groupForMember(caller.localId);
        if (!currentGroup || currentGroup.id !== group.id || currentGroup.members.indexOf(partner.localId) === -1) {
          clearInterval(timer);
          finishDelegation(group, caller, partner, token);
          reject(new Error("the split group was dissolved while waiting for the partner"));
          return;
        }
        if (!partner.isProcessing && !partner._queryStarting) {
          clearInterval(timer);
          finishDelegation(group, caller, partner, token);
          var failure = errorSince(partner.history || [], token.startIndex);
          var interrupted = !failure && !!partner._lastTurnInterrupted;
          resolve({
            status: failure ? "error" : (interrupted ? "interrupted" : "complete"),
            response: responseText(partner.history || [], token.startIndex),
            error: failure || undefined,
          });
          return;
        }
        // Timeouts and permission requests both detach into the push-back path.
        if (Date.now() >= deadline || token.detachRequested) {
          clearInterval(timer);
          token.detached = true;
          monitorPartner(group, caller, partner, token);
          resolve({ status: "running", response: responseText(partner.history || [], token.startIndex), hint: "The completed result will be pushed back automatically. Use read_partner only for an interim status check." });
        }
      }, 500);
    });
  }

  function monitorPartner(group, caller, partner, token) {
    var timer = setInterval(function () {
      var currentGroup = store.groupForMember(caller.localId);
      if (!currentGroup || currentGroup.id !== group.id || (!partner.isProcessing && !partner._queryStarting)) {
        clearInterval(timer);
        if (currentGroup && currentGroup.id === group.id) handleTurnDone(partner);
        else finishDelegation(group, caller, partner, token);
      }
    }, 500);
  }

  async function sendToPartner(args, caller) {
    try {
      if (caller && caller._delegatedBy) throw new Error("delegated turns cannot delegate to another session");
      var resolved = groupAndPartner(caller,
        "send_to_partner requires an exact existing Driver/Split Worker pair; call propose_worker while unpaired");
      var message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message) throw new Error("message is required");
      turnControl.assertWorkerAction(caller);
      var wait = args.wait !== false;
      var timeout = Number.isFinite(args.timeoutSeconds) ? Math.floor(args.timeoutSeconds) : 300;
      timeout = Math.max(1, Math.min(900, timeout));
      var partner = resolved.partner;
      if (partner._pairDelegation) throw new Error("the partner is already handling a delegated task");
      var token = { from: caller.localId, groupId: resolved.group.id, startIndex: partner.history.length, message: message };
      partner._pairDelegation = token;
      partner._delegatedBy = caller.localId;
      sm.sendAndRecord(partner, {
        type: "user_message",
        text: message,
        delegated: true,
        delegatedBy: caller.localId,
        delegatedByTitle: caller.title || "Driver",
        delegatedByVendor: caller.vendor || "claude",
      });
      partner.lastActivity = Date.now();
      partner.sentToolResults = {};
      broadcastDelegation(resolved.group, caller, partner, true);
      var sdk = ctx.getSdk();
      if (!sdk) throw new Error("SDK bridge is not ready");
      if (!partner.isProcessing) {
        partner.isProcessing = true;
        ctx.onProcessingChanged();
        sm.sendToSession(partner, { type: "status", status: "processing" });
      }
      if (!sdk.pushMessage(partner, message)) {
        partner._queryStartTs = Date.now();
        Promise.resolve(sdk.startQuery(partner, message, undefined, ctx.getLinuxUserForSession(partner))).catch(function (err) {
          partner.isProcessing = false;
          sm.sendAndRecord(partner, { type: "error", text: err.message || String(err) });
        });
      }
      sm.broadcastSessionList();
      if (!wait) {
        token.detached = true;
        monitorPartner(resolved.group, caller, partner, token);
        return toolResult({ status: "running", partnerId: partner.localId, hint: "The completed result will be pushed back automatically. Use read_partner only for an interim status check." });
      }
      if (!partner.isProcessing && !partner._queryStarting) {
        finishDelegation(resolved.group, caller, partner, token);
        var immediateFailure = errorSince(partner.history || [], token.startIndex);
        return toolResult({
          status: immediateFailure ? "error" : "complete",
          response: responseText(partner.history || [], token.startIndex),
          error: immediateFailure || undefined,
        });
      }
      var completed = await waitForPartner(resolved.group, caller, partner, token, timeout);
      return toolResult(completed);
    } catch (e) {
      if (caller) {
        var group = store.groupForMember(caller.localId);
        if (group) {
          var partnerId = group.members[0] === caller.localId ? group.members[1] : group.members[0];
          var partner = sm.sessions.get(partnerId);
          if (partner && partner._pairDelegation && partner._pairDelegation.from === caller.localId && !partner.isProcessing) {
            finishDelegation(group, caller, partner, partner._pairDelegation);
          }
        }
      }
      return toolError(e);
    }
  }

  function readPartner(args, caller) {
    try {
      var resolved = groupAndPartner(caller);
      var count = Number.isFinite(args.lastTurns) ? Math.floor(args.lastTurns) : 1;
      count = Math.max(0, Math.min(5, count));
      var payload = {
        status: resolved.partner.isProcessing ? "running" : (resolved.partner._lastTurnInterrupted ? "interrupted" : "idle"),
        partnerId: resolved.partner.localId,
        title: resolved.partner.title || "New Session",
        turns: count > 0 ? recentTurns(resolved.partner, count) : [],
      };
      payload.capacity = lifecycle.optionalStatus(caller);
      return toolResult(payload);
    } catch (e) {
      return toolError(e);
    }
  }

  function interruptPartner(args, caller) {
    try {
      var resolved = groupAndPartner(caller);
      var partner = resolved.partner;
      if (!partner.isProcessing && !partner._queryStarting) {
        return toolResult({ status: "idle", partnerId: partner.localId, title: partner.title || "New Session" });
      }
      partner.taskStopRequested = true;
      if (partner.abortController) partner.abortController.abort();
      return toolResult({ status: "interrupting", partnerId: partner.localId, title: partner.title || "New Session" });
    } catch (e) {
      return toolError(e);
    }
  }

  function closePartner(args, caller) {
    try {
      var resolved = groupAndPartner(caller);
      var partner = resolved.partner;
      var interrupted = !!(partner.isProcessing || partner._queryStarting);
      if (interrupted) {
        partner.taskStopRequested = true;
        if (partner.abortController) partner.abortController.abort();
      }
      if (partner._pairDelegation) finishDelegation(resolved.group, caller, partner, partner._pairDelegation);
      workerPermission.cancelForSession(partner, "The Driver closed the Split Worker pair.");
      var ws = { _clayUser: caller.ownerId ? { id: caller.ownerId } : null };
      var result = store.dissolve(ws, { id: resolved.group.id });
      if (!result.ok) throw new Error(result.error || "could not close the Worker pair");
      return toolResult({ status: "closed", partnerId: partner.localId, interrupted: interrupted, historyPreserved: true });
    } catch (e) {
      return toolError(e);
    }
  }

  function handleHumanStop(session) {
    var roles = turnControl.markHumanStop(session);
    if (!roles) return false;
    workerPermission.cancelForSession(roles.worker, "The human stopped this Split Worker turn.");
    return true;
  }

  function getToolDefs(boundSession) {
    if (!boundSession) return pairMcp.getToolDefs({
      send: function () { return toolError(new Error("send_to_partner requires a session-bound tool server")); },
      read: function () { return toolError(new Error("read_partner requires a session-bound tool server")); },
      interrupt: function () { return toolError(new Error("interrupt_partner requires a session-bound tool server")); },
      close: function () { return toolError(new Error("close_partner requires a session-bound tool server")); },
      status: function () { return toolError(new Error("partner_status requires a session-bound tool server")); },
      replace: function () { return toolError(new Error("replace_partner requires a session-bound tool server")); },
      evaluate: function () { return toolError(new Error("record_partner_evaluation requires a session-bound tool server")); },
    });
    var group = store.groupForMember(boundSession.localId);
    if (group && group.pair && group.pair.driverId !== boundSession.localId) return [];
    var adHocSplit = !!(group && !group.pair);
    if (!driverEligibility.isEligibleDriverSession(boundSession, sm)) return [];
    var persistentCatalog = boundSession.vendor === "codex" && (!group || !!group.pair);
    if (!group && !persistentCatalog) {
      return workerProposal.getToolDefs(boundSession)
        .concat(workerPermission.getToolDefs(boundSession, { dormantDriver: true }));
    }
    var lifecycleHandlers = lifecycle.toolHandlers(boundSession);
    var tools = pairMcp.getToolDefs({
      send: function (args) {
        return turnControl.runOperation(boundSession, "send", args && args.operationId, function () {
          return sendToPartner(args || {}, boundSession);
        });
      },
      read: function (args) { return readPartner(args, boundSession); },
      interrupt: function (args) { return interruptPartner(args, boundSession); },
      close: function (args) { return closePartner(args, boundSession); },
      status: lifecycleHandlers.status,
      replace: function (args) {
        return turnControl.runOperation(boundSession, "replace", args && args.operationId, function () {
          return workerProposal.proposeReplacement(args || {}, boundSession);
        });
      },
      evaluate: lifecycleHandlers.evaluate,
    }, { lifecycle: persistentCatalog || !adHocSplit });
    if (persistentCatalog) {
      return workerProposal.getToolDefs(boundSession, { persistent: true })
        .concat(tools)
        .concat(workerPermission.getToolDefs(boundSession, { dormantDriver: true }));
    }
    return tools
      .concat(workerPermission.getToolDefs(boundSession, { dormantDriver: false }));
  }

  var factory = attachPairFactory(ctx);
  var createPairRecord = factory.createPairRecord;
  var createWorkerForDriver = factory.createWorkerForDriver;
  var createPair = factory.createPair;
  var preflightWorkerForDriver = factory.preflightWorkerForDriver;

  lifecycle = attachPairLifecycle({
    sm: sm,
    splitStore: store,
    createWorkerForDriver: function (driver, args) { return createWorkerForDriver(driver, args); },
    preflightWorkerForDriver: function (driver, args) { return preflightWorkerForDriver(driver, args); },
    sendToPartner: function (args, caller) { return sendToPartner(args, caller); },
    finishDelegation: finishDelegation,
    cancelWorkerPermissions: function (worker, reason) {
      return workerPermission.cancelForSession(worker, reason);
    },
    turnControl: turnControl,
  });

  workerPermission = attachWorkerPermission({
    sm: sm,
    splitStore: store,
    onProcessingChanged: ctx.onProcessingChanged,
    resumeDriverWithMessage: resumeDriverWithMessage,
    requestDetach: requestDetach,
  });

  workerProposal = attachWorkerProposal({
    sm: sm,
    isMate: ctx.isMate,
    splitStore: store,
    getSdk: ctx.getSdk,
    sendTo: ctx.sendTo,
    usersModule: ctx.usersModule,
    getLinuxUserForSession: ctx.getLinuxUserForSession,
    onProcessingChanged: ctx.onProcessingChanged,
    adapters: ctx.adapters,
    dangerouslySkipPermissions: ctx.dangerouslySkipPermissions,
    createPairRecord: createPairRecord,
    recordGenerationStart: function (driver, worker) { return lifecycle.recordGenerationStart(driver, worker); },
    sendToPartner: sendToPartner,
    replacePartner: function (args, session) { return lifecycle.replacePartner(args, session); },
  });

  function handleMessage(ws, msg) {
    if (workerProposal.handleMessage(ws, msg)) return true;
    if (msg.type === "pair_session_options") {
      if (ctx.isMate) return false;
      ctx.sendTo(ws, {
        type: "pair_session_options",
        installedVendors: sm.installedVendors || [],
        modelsByVendor: sm.modelsByVendor || {},
        capabilitiesByVendor: sm.capabilitiesByVendor || {},
        lastVendor: sm.lastVendor || null,
      });
      return true;
    }
    if (msg.type === "pair_session_create") {
      createPair(ws, msg);
      return true;
    }
    return false;
  }

  function getSystemPrompt(session) {
    var group = store.groupForMember(session.localId);
    var pairPrompt = "";
    if (group && group.pair && group.pair.driverId === session.localId) {
      pairPrompt = pairPrompts.DRIVER_CORE;
      if (driverOrchestration.isHighTierDriverSession(session, sm)) {
        pairPrompt += " " + pairPrompts.DRIVER_DELEGATION;
      }
    } else if (!group && !ctx.isMate && driverEligibility.isEligibleDriverSession(session, sm) &&
      driverOrchestration.isHighTierDriverSession(session, sm)) {
      pairPrompt = pairPrompts.UNPAIRED + " " + workerProposal.getSystemPrompt(session);
    }
    return pairPrompt;
  }

  return {
    beginHumanTurn: turnControl.beginHumanTurn,
    getToolDefs: getToolDefs,
    handleHumanStop: handleHumanStop,
    handleMessage: handleMessage,
    handleTurnDone: handleTurnDone,
    getSystemPrompt: getSystemPrompt,
    respondToWorkerProposal: workerProposal.respondToProposal,
    workerPermission: workerPermission,
  };
}

module.exports = { attachSessionPair: attachSessionPair, responseText: responseText, recentTurns: recentTurns };
