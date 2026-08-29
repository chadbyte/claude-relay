var path = require("path");
var debateMcp = require("./debate-mcp-server");

function attachDebateProposal(ctx) {
  var pendingProposals = {};

  function createMcpServer(adapter, boundSession) {
    var toolDefs = debateMcp.getToolDefs(function onPropose(briefData) {
      if (!boundSession) {
        return Promise.resolve({
          action: "error",
          error: "Debate proposals require an active Clay session.",
        });
      }

      return new Promise(function (resolve) {
        var proposalId = "dp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
        briefData.proposalId = proposalId;
        pendingProposals[proposalId] = {
          resolve: resolve,
          briefData: briefData,
          session: boundSession,
        };
      });
    });

    return adapter.createToolServer({
      name: "clay-debate",
      version: "1.0.0",
      tools: toolDefs,
    });
  }

  function findPendingProposal(ws, msg) {
    var keys = Object.keys(pendingProposals);
    if (keys.length === 0) return null;
    var key = msg.proposalId || null;
    if (!key && ws && Number.isInteger(ws._clayActiveSession)) {
      for (var i = keys.length - 1; i >= 0; i--) {
        var candidate = pendingProposals[keys[i]];
        if (candidate.session && candidate.session.localId === ws._clayActiveSession) {
          key = keys[i];
          break;
        }
      }
    }
    if (!key) key = keys[keys.length - 1];
    var pending = pendingProposals[key];
    if (!pending) return null;
    delete pendingProposals[key];
    return pending;
  }

  function rejectProposal(ws, pending, error) {
    try {
      ctx.sendTo(ws, { type: "debate_error", error: error });
    } catch (sendErr) {
      console.error("[debate] Failed to send proposal error:", sendErr && sendErr.message ? sendErr.message : sendErr);
    }
    pending.resolve({ action: "error", error: error });
  }

  function validateProposal(ws, pending) {
    var briefData = pending.briefData;
    var moderatorId = ctx.isMate ? path.basename(ctx.cwd) : briefData.moderatorId;
    if (!moderatorId || typeof moderatorId !== "string") {
      return { error: "A valid Mate moderator is required to start this debate." };
    }

    var userId = ws && ws._clayUser
      ? ws._clayUser.id
      : (pending.session.ownerId || ctx.getProjectOwnerId() || null);
    var mateCtx = ctx.buildMateCtx(userId);
    if (!ctx.getMate(mateCtx, moderatorId)) {
      return { error: "The selected debate moderator is unavailable." };
    }

    var panelists = briefData.panelists;
    if (!Array.isArray(panelists) || panelists.length === 0) {
      return { error: "At least one valid panelist is required to start this debate." };
    }

    var seen = {};
    for (var i = 0; i < panelists.length; i++) {
      var panelistId = panelists[i] && panelists[i].mateId;
      if (!panelistId || typeof panelistId !== "string" || !ctx.getMate(mateCtx, panelistId)) {
        return { error: "One or more selected debate panelists are unavailable." };
      }
      if (panelistId === moderatorId) {
        return { error: "The debate moderator cannot also be a panelist." };
      }
      if (seen[panelistId]) {
        return { error: "The same Mate cannot be added to a debate more than once." };
      }
      seen[panelistId] = true;
    }

    return { moderatorId: moderatorId };
  }

  function handleMessage(ws, msg) {
    if (msg.type !== "debate_proposal_response") return false;

    var pending = findPendingProposal(ws, msg);
    if (!pending) return true;
    if (msg.action !== "start") {
      pending.resolve({ action: "cancel" });
      return true;
    }

    var validated = validateProposal(ws, pending);
    if (validated.error) {
      rejectProposal(ws, pending, validated.error);
      return true;
    }

    try {
      var result = ctx.startDebate(pending.session, pending.briefData, validated.moderatorId, ws);
      if (result && result.error) {
        rejectProposal(ws, pending, result.error);
        return true;
      }
      pending.resolve({ action: "start" });
    } catch (err) {
      var detail = err && err.message ? err.message : String(err);
      console.error("[debate] Failed to start approved proposal:", detail);
      rejectProposal(ws, pending, "The debate could not be started. Check the server logs for details.");
    }
    return true;
  }

  return {
    createMcpServer: createMcpServer,
    handleMessage: handleMessage,
  };
}

module.exports = { attachDebateProposal: attachDebateProposal };
