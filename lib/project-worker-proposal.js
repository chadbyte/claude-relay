var crypto = require("crypto");
var yoke = require("./yoke");
var buildShape = require("./session-spawn-mcp-server").buildShape;

var MAX_SUMMARY_CHARS = 600;
var MAX_PLAN_CHARS = 6000;
var MAX_TASK_CHARS = 30000;

function modelValue(entry) {
  if (typeof entry === "string") return entry;
  return entry && (entry.value || entry.id) || "";
}

function modelLabel(entry) {
  if (typeof entry === "string") return entry;
  return entry && (entry.displayName || entry.name || entry.value || entry.id) || "";
}

function isFableSession(session, modelsByVendor, fallbackModel) {
  if (!session || (session.vendor || "claude") !== "claude") return false;
  var effectiveModel = session.model || fallbackModel || "";
  var selected = String(effectiveModel).toLowerCase();
  if (selected.indexOf("fable") !== -1) return true;
  var models = (modelsByVendor && modelsByVendor.claude) || [];
  for (var i = 0; i < models.length; i++) {
    if (modelValue(models[i]) !== effectiveModel) continue;
    if (modelLabel(models[i]).toLowerCase().indexOf("fable") !== -1) return true;
  }
  return false;
}

function toolResult(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

function attachWorkerProposal(ctx) {
  var sm = ctx.sm;
  var store = ctx.splitStore;

  function isEligible(session) {
    if (ctx.isMate || !session || session.mode === "tui") return false;
    if (store.groupForMember(session.localId)) return false;
    return isFableSession(session, sm.modelsByVendor, (sm.defaultModelByVendor || {})[session.vendor || "claude"]);
  }

  function safeModelsByVendor(installed) {
    var result = {};
    for (var i = 0; i < installed.length; i++) {
      var vendor = installed[i];
      var source = (sm.modelsByVendor && sm.modelsByVendor[vendor]) || [];
      result[vendor] = source.map(function (entry) {
        if (typeof entry === "string") return entry;
        return {
          value: modelValue(entry),
          displayName: modelLabel(entry),
          supportedEffortLevels: entry.supportedEffortLevels || null,
        };
      });
    }
    return result;
  }

  function proposalOptions() {
    var installed = (sm.installedVendors || []).slice();
    var capabilities = {};
    for (var i = 0; i < installed.length; i++) {
      var source = (sm.capabilitiesByVendor && sm.capabilitiesByVendor[installed[i]]) || {};
      var vendorInfo = yoke.getVendorInfo(installed[i]) || {};
      var supportsEffort = Array.isArray(vendorInfo.effortLevels) && vendorInfo.effortLevels.length > 0;
      capabilities[installed[i]] = { effort: source.effort === undefined ? supportsEffort : source.effort !== false };
    }
    return {
      installedVendors: installed,
      modelsByVendor: safeModelsByVendor(installed),
      capabilitiesByVendor: capabilities,
    };
  }

  async function ensureModelCatalogs() {
    var installed = sm.installedVendors || [];
    sm.modelsByVendor = sm.modelsByVendor || {};
    for (var i = 0; i < installed.length; i++) {
      var vendor = installed[i];
      if (sm.modelsByVendor[vendor] && sm.modelsByVendor[vendor].length > 0) continue;
      var adapter = ctx.adapters && ctx.adapters[vendor];
      if (!adapter || typeof adapter.supportedModels !== "function") continue;
      try { sm.modelsByVendor[vendor] = await adapter.supportedModels(); }
      catch (err) { console.warn("[worker-proposal] Could not load " + vendor + " models:", err.message || err); }
    }
  }

  function modelIsAvailable(options, vendor, model) {
    if (!model) return true;
    var models = options.modelsByVendor[vendor] || [];
    for (var i = 0; i < models.length; i++) {
      if (modelValue(models[i]) === model) return true;
    }
    return models.length === 0;
  }

  function chooseRecommendation(args, session, options) {
    var installed = options.installedVendors;
    var vendor = args.recommendedVendor;
    if (installed.indexOf(vendor) === -1) {
      if (installed.indexOf("codex") !== -1) vendor = "codex";
      else {
        vendor = installed[0] || session.vendor || "claude";
        for (var i = 0; i < installed.length; i++) {
          if (installed[i] !== session.vendor) { vendor = installed[i]; break; }
        }
      }
    }
    var models = options.modelsByVendor[vendor] || [];
    var model = modelIsAvailable(options, vendor, args.recommendedModel) ? (args.recommendedModel || "") : "";
    var currentModel = session.model || (sm.defaultModelByVendor || {})[session.vendor || "claude"] || "";
    if (vendor === session.vendor && model === currentModel) model = "";
    if (!model && models.length > 0) {
      for (var j = 0; j < models.length; j++) {
        if (vendor === session.vendor && modelValue(models[j]) === currentModel) continue;
        if (modelLabel(models[j]).toLowerCase().indexOf("fable") !== -1) continue;
        model = modelValue(models[j]);
        break;
      }
    }
    if (!model && models.length > 0 && vendor !== session.vendor) model = modelValue(models[0]);
    var effort = yoke.clampEffort(vendor, args.recommendedEffort || "medium") || "";
    return { vendor: vendor, model: model, effort: effort };
  }

  function findProposal(session, proposalId) {
    var history = (session && session.history) || [];
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i] && history[i].type === "worker_proposal" && history[i].proposalId === proposalId) return history[i];
    }
    return null;
  }

  function hasPendingProposal(session) {
    var history = (session && session.history) || [];
    for (var i = history.length - 1; i >= 0; i--) {
      var item = history[i];
      if (!item || item.type !== "worker_proposal") continue;
      return item.status === "pending" || item.status === "starting" || item.status === "running";
    }
    return false;
  }

  function updateProposal(session, proposal, patch) {
    Object.assign(proposal, patch, { updatedAt: Date.now() });
    sm.saveSessionFile(session);
    sm.sendToSession(session, Object.assign({
      type: "worker_proposal_update",
      proposalId: proposal.proposalId,
    }, patch));
  }

  function skipPermissionsEnabled(session) {
    return !!session && (session.permissionMode === "bypassPermissions" || session.dangerouslySkipPermissions === true);
  }

  function autoApprovalWs(session) {
    return {
      _clayActiveSession: session.localId,
      _clayUser: session.ownerId ? { id: session.ownerId } : null,
      _autoApproval: true,
    };
  }

  async function propose(args, session) {
    if (!isEligible(session)) return toolResult({ error: "Worker suggestions are only available in an unpaired Fable session." });
    if (hasPendingProposal(session)) return toolResult({ error: "A Worker suggestion is already awaiting a decision." });
    var summary = typeof args.summary === "string" ? args.summary.trim() : "";
    var plan = typeof args.plan === "string" ? args.plan.trim() : "";
    var task = typeof args.message === "string" ? args.message.trim() : "";
    if (!summary || !plan || !task) return toolResult({ error: "summary, plan, and message are required." });
    if (task.length > MAX_TASK_CHARS) return toolResult({ error: "The Worker task is too long." });
    await ensureModelCatalogs();
    var options = proposalOptions();
    if (options.installedVendors.length === 0) return toolResult({ error: "No coding agent is installed for a Worker session." });
    var recommendation = chooseRecommendation(args, session, options);
    var autoApprove = skipPermissionsEnabled(session);
    var proposal = {
      type: "worker_proposal",
      proposalId: "worker_" + crypto.randomUUID(),
      summary: summary.slice(0, MAX_SUMMARY_CHARS),
      plan: plan.slice(0, MAX_PLAN_CHARS),
      message: task,
      status: "pending",
      recommendedVendor: recommendation.vendor,
      recommendedModel: recommendation.model,
      recommendedEffort: recommendation.effort,
      options: options,
    };
    if (autoApprove) proposal.autoApproved = true;
    sm.sendAndRecord(session, proposal);
    if (autoApprove) {
      var accepted = await acceptProposal(session, proposal, {
        vendor: recommendation.vendor,
        model: recommendation.model,
        effort: recommendation.effort,
        autoApproved: true,
      }, autoApprovalWs(session));
      if (!accepted.ok) return toolResult({ error: accepted.error || "Could not start the Worker." });
      return toolResult({
        status: "running",
        proposalId: proposal.proposalId,
        instruction: "The Worker was auto-approved and started because skip permissions is enabled. Its result will return for review.",
      });
    }
    return toolResult({
      status: "posted",
      proposalId: proposal.proposalId,
      instruction: "The Worker suggestion is visible in the chat. End this turn now and wait for the user's decision.",
    });
  }

  function resumeDriver(session, text) {
    var sdk = ctx.getSdk();
    if (!sdk) return Promise.reject(new Error("SDK bridge is not ready"));
    var message = { type: "user_message", text: text, _internal: true };
    sm.sendAndRecord(session, message);
    session.sentToolResults = {};
    if (!session.isProcessing) {
      session.isProcessing = true;
      ctx.onProcessingChanged();
      sm.sendToSession(session, { type: "status", status: "processing" });
    }
    if (sdk.pushMessage(session, text)) return Promise.resolve();
    return Promise.resolve(sdk.startQuery(session, text, undefined, ctx.getLinuxUserForSession(session)));
  }

  function parsePartnerResult(result) {
    if (!result || result.isError || !result.content || !result.content[0]) {
      return { status: "error", error: "Worker execution failed." };
    }
    try { return JSON.parse(result.content[0].text); }
    catch (e) { return { status: "error", error: result.content[0].text || "Worker execution failed." }; }
  }

  async function runWorker(session, proposal) {
    var result = parsePartnerResult(await ctx.sendToPartner({ message: proposal.message, wait: true, timeoutSeconds: 900 }, session));
    var status = result.status === "complete" ? "completed" : result.status;
    updateProposal(session, proposal, {
      status: status || "error",
      resultPreview: result.response ? result.response.slice(0, 1200) : "",
      error: result.error || null,
    });
    var followup;
    if (result.status === "complete") {
      followup = "[Worker execution completed]\nReview and verify the Worker's result. The Worker session remains available: if the implementation needs corrections or additional edits, send a follow-up with send_to_partner instead of taking over the Worker-owned files yourself. If that Worker is no longer available, keep the work in the visible Worker flow and use send_to_partner again after the stale pair is removed; never substitute a background session.\n\n" + (result.response || "The Worker completed without a text summary.");
    } else if (result.status === "interrupted") {
      followup = "[Worker execution interrupted]\nThe user interrupted the Worker mid-turn. Its work is PARTIAL and unverified — do not treat it as finished. Review what was done and decide next steps with the user.";
    } else if (result.status === "running") {
      followup = "[Worker execution is still running]\nUse read_partner to inspect progress before completing the task.";
    } else {
      followup = "[Worker execution failed]\nInspect the failure and delegate a narrower follow-up to the Worker when implementation work remains.\n\n" + (result.error || result.response || "Unknown Worker error.");
    }
    await resumeDriver(session, followup);
  }

  function sessionForResponse(ws) {
    var session = sm.sessions.get(ws._clayActiveSession);
    if (!session) throw new Error("active Driver session not found");
    if (ctx.usersModule.isMultiUser()) {
      var userId = ws._clayUser && ws._clayUser.id;
      if (!userId || session.ownerId !== userId) throw new Error("Driver session access denied");
    }
    return session;
  }

  async function acceptProposal(session, proposal, msg, ws) {
    var options = proposal.options || proposalOptions();
    var vendor = msg.vendor || proposal.recommendedVendor;
    var model = msg.model || "";
    if (options.installedVendors.indexOf(vendor) === -1) throw new Error("Selected Worker vendor is not installed");
    if (!modelIsAvailable(options, vendor, model)) throw new Error("Selected Worker model is unavailable");
    var effort = yoke.clampEffort(vendor, msg.effort || proposal.recommendedEffort || "medium") || "";
    var startingPatch = { status: "starting", selectedVendor: vendor, selectedModel: model, selectedEffort: effort };
    if (msg.autoApproved) startingPatch.autoApproved = true;
    updateProposal(session, proposal, startingPatch);
    try {
      var created = ctx.createPairRecord(ws, {
        driver: { sessionId: session.localId },
        worker: { vendor: vendor, model: model, effort: effort },
      });
      updateProposal(session, proposal, { status: "running", groupId: created.group.id, workerId: created.worker.localId });
      if (ws._autoApproval) sm.sendToSession(session, { type: "pair_session_created", ok: true, group: created.group });
      else ctx.sendTo(ws, { type: "pair_session_created", ok: true, group: created.group });
      runWorker(session, proposal).catch(function (err) {
        updateProposal(session, proposal, { status: "error", error: err.message || String(err) });
        resumeDriver(session, "[Worker execution failed]\n" + (err.message || String(err))).catch(function () {});
      });
      return { ok: true, status: "running", group: created.group };
    } catch (err) {
      updateProposal(session, proposal, { status: "pending", error: err.message || String(err) });
      return { ok: false, status: "pending", error: err.message || String(err) };
    }
  }

  async function respondToProposal(ws, msg) {
    var session = sessionForResponse(ws);
    var proposal = findProposal(session, msg.proposalId);
    if (!proposal) throw new Error("Worker suggestion not found");
    if (proposal.status !== "pending") throw new Error("Worker suggestion has already been resolved");
    if (!msg.accepted) {
      updateProposal(session, proposal, { status: "declined" });
      await resumeDriver(session, "[Worker suggestion declined]\nContinue this task in the current session using the plan you already prepared.");
      return { ok: true, status: "declined" };
    }
    return acceptProposal(session, proposal, msg, ws);
  }

  function handleMessage(ws, msg) {
    if (msg.type !== "worker_proposal_response") return false;
    respondToProposal(ws, msg).catch(function (err) {
      ctx.sendTo(ws, { type: "worker_proposal_update", proposalId: msg.proposalId, status: "pending", error: err.message || String(err) });
    });
    return true;
  }

  function getToolDefs(session) {
    if (!isEligible(session)) return [];
    return [{
      name: "propose_worker",
      description: "After making a concise plan for an implementation-heavy task, suggest that the user run the execution with another model in a visible Worker session. Use this only before substantial execution begins, never for small edits, explanations, or tasks the user asked you to keep in this session.",
      inputSchema: buildShape({
        summary: { type: "string", description: "One short sentence explaining why a Worker is useful for this task." },
        plan: { type: "string", description: "A concise numbered implementation plan to show in the approval card." },
        message: { type: "string", description: "Complete execution instructions for the Worker, including scope, constraints, validation, and expected result." },
        recommendedVendor: { type: "string", description: "Optional installed vendor id for the Worker." },
        recommendedModel: { type: "string", description: "Optional exact Worker model id. Omit when uncertain." },
        recommendedEffort: { type: "string", description: "Optional reasoning effort: minimal, low, medium, high, xhigh, or max." },
      }, ["summary", "plan", "message"]),
      handler: function (args) { return propose(args || {}, session); },
    }];
  }

  function getSystemPrompt(session) {
    if (!isEligible(session)) return "";
    return "You can introduce Clay's Driver/Worker workflow with propose_worker. For an implementation-heavy task that is likely to consume substantial execution time, first reason about the work and form a concise plan. Before editing files or running substantial execution, call propose_worker once with that plan and a complete Worker instruction, recommending another suitable execution model. Use it conservatively: do not suggest a Worker for questions, investigations, tiny fixes, or when the user explicitly wants you to execute here. After posting a proposal, end the turn and wait. If accepted, the Worker runs visibly and its result returns to you for review.";
  }

  return {
    getToolDefs: getToolDefs,
    getSystemPrompt: getSystemPrompt,
    handleMessage: handleMessage,
    respondToProposal: respondToProposal,
  };
}

module.exports = {
  attachWorkerProposal: attachWorkerProposal,
  isFableSession: isFableSession,
};
