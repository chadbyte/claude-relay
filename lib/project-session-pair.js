var pairMcp = require("./session-pair-mcp-server");
var pairPrompts = require("./session-pair-prompts");
var { attachPairFactory } = require("./session-pair-factory");
var { attachPairLifecycle } = require("./project-pair-lifecycle");
var driverEligibility = require("./session-driver-eligibility");
var { attachWorkerPermission } = require("./project-worker-permission");
var { attachWorkerProposal } = require("./project-worker-proposal");

var MAX_RESPONSE_CHARS = 30000;

function toolResult(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

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

  function groupAndPartner(caller) {
    if (!caller) throw new Error("partner tools require a session-bound tool server");
    // Exact live object identity. MCP tool handlers are captured per query and
    // outlive the session they were bound to, so a stale session object — or a
    // different object reusing the same localId — must not be able to drive a
    // pair through a handler someone still holds a reference to.
    if (sm.sessions.get(caller.localId) !== caller) {
      throw new Error("this session is no longer live; the partner tools are bound to an exact session");
    }
    var group = store.groupForMember(caller.localId);
    if (!group) throw new Error("this session is not in a split group");
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

  // Deliver an internal message to the Driver and make sure it is running so
  // the message is actually consumed. Shared by the delegated-result push-back
  // and by Split Worker permission routing, so both use one resume path.
  function resumeDriverWithMessage(caller, text, meta) {
    if (!caller || caller.destroying) return false;
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

  // A Driver blocked inside a waiting send_to_partner cannot answer a tool
  // call. Asking the wait to detach lets its turn continue; the delegated
  // result then arrives through the existing detached push-back path.
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
        // Either the deadline passed, or something needs the Driver's turn
        // back before then (a Split Worker permission request). Both detach
        // the same way, so the completed result still returns automatically.
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
      var message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message) throw new Error("message is required");
      var created = null;
      if (caller && !store.groupForMember(caller.localId)) {
        created = createWorkerForDriver(caller, args);
      }
      var resolved = groupAndPartner(caller);
      if (created && created.worker) lifecycle.recordGenerationStart(caller, created.worker);
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
        return toolResult({ status: "running", partnerId: partner.localId, workerCreated: !!created, hint: "The completed result will be pushed back automatically. Use read_partner only for an interim status check." });
      }
      var completed = await waitForPartner(resolved.group, caller, partner, token, timeout);
      if (created) {
        completed.workerCreated = true;
        completed.partnerId = partner.localId;
      }
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
      // The same bounded capacity report partner_status returns, so a Driver
      // already reading turns needs no second call; null for anyone else.
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
      // Anything the Worker was waiting on the Driver to decide dies with the
      // pair, immediately rather than on the next liveness sweep.
      workerPermission.cancelForSession(partner, "The Driver closed the Split Worker pair.");
      var ws = { _clayUser: caller.ownerId ? { id: caller.ownerId } : null };
      var result = store.dissolve(ws, { id: resolved.group.id });
      if (!result.ok) throw new Error(result.error || "could not close the Worker pair");
      return toolResult({ status: "closed", partnerId: partner.localId, interrupted: interrupted, historyPreserved: true });
    } catch (e) {
      return toolError(e);
    }
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
    // Mount whenever we have a bound session: MCP servers are fixed for the
    // lifetime of a query, and Claude queries live across turns, so gating on
    // group membership HERE would permanently hide the tools from a session
    // whose split is created mid-conversation (the ad-hoc flow). Handlers
    // re-resolve the group on every call, so an ungrouped session gets a
    // clear error, and a session that gains a partner later just works.
    // The one structural exclusion: a session that is ALREADY a configured
    // pair worker at query start never sees the tools.
    var group = store.groupForMember(boundSession.localId);
    if (group && group.pair && group.pair.driverId !== boundSession.localId) return [];
    // A plain side-by-side split has no Driver role, so it keeps exactly the
    // partner tools it always had. Every path that would make this session a
    // Driver — an existing configured pair, or an unpaired session whose
    // send_to_partner would create one — requires the hard tier invariant. A
    // model below its family's threshold never receives the autonomous
    // lifecycle tools and cannot create or direct a pair.
    var adHocSplit = !!(group && !group.pair);
    if (!adHocSplit && !driverEligibility.isEligibleDriverSession(boundSession, sm)) return [];
    var lifecycleHandlers = lifecycle.toolHandlers(boundSession);
    var tools = pairMcp.getToolDefs({
      send: function (args) { return sendToPartner(args, boundSession); },
      read: function (args) { return readPartner(args, boundSession); },
      interrupt: function (args) { return interruptPartner(args, boundSession); },
      close: function (args) { return closePartner(args, boundSession); },
      status: lifecycleHandlers.status,
      replace: lifecycleHandlers.replace,
      evaluate: lifecycleHandlers.evaluate,
    }, { lifecycle: !adHocSplit });
    return tools
      .concat(workerPermission.getToolDefs(boundSession))
      .concat(workerProposal.getToolDefs(boundSession));
  }

  var factory = attachPairFactory({ sm: sm, splitStore: store, ctx: ctx });
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
    createPairRecord: createPairRecord,
    sendToPartner: sendToPartner,
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
      pairPrompt = pairPrompts.DRIVER;
    } else if (!group && !ctx.isMate) {
      pairPrompt = pairPrompts.UNPAIRED;
    }
    return pairPrompt;
  }

  return {
    getToolDefs: getToolDefs,
    handleMessage: handleMessage,
    handleTurnDone: handleTurnDone,
    getSystemPrompt: getSystemPrompt,
    workerPermission: workerPermission,
  };
}

module.exports = {
  attachSessionPair: attachSessionPair,
  responseText: responseText,
  recentTurns: recentTurns,
};
