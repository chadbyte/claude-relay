// Concrete Mate model resolution and Home model-selection protocol.

var modelEntryMatches = require("./project-models").modelEntryMatches;
var modelEntryValue = require("./project-models").modelEntryValue;

function attachHomeModels(deps) {
  var users = deps.users;
  var mates = deps.mates;
  var projects = deps.projects;
  var sendMessage = deps.sendMessage;

  function modelError(text) {
    var error = new Error(text);
    error.code = "model_unavailable";
    return error;
  }

  function broadcastMateUpdated(userId, mate) {
    projects.forEach(function (project) {
      project.forEachClient(function (client) {
        if (client.readyState !== 1) return;
        if (users.isMultiUser()) {
          var clientUserId = client._clayUser ? client._clayUser.id : null;
          if (!userId || clientUserId !== userId) return;
        }
        sendMessage(client, { type: "mate_updated", mate: mate });
      });
    });
  }

  function catalogModel(models, candidate) {
    if (!candidate) return "";
    for (var i = 0; i < models.length; i++) {
      if (modelEntryMatches(models[i], candidate)) return modelEntryValue(models[i]);
    }
    return "";
  }

  async function loadCatalog(ws, found, vendor) {
    if (typeof found.ctx.getVendorModelCatalog !== "function") {
      throw modelError("Model catalog is unavailable. Reconnect and choose a model before starting a conversation.");
    }
    var catalog = await found.ctx.getVendorModelCatalog(ws, vendor);
    var models = catalog.models || [];
    if (!models.length) {
      throw modelError(catalog.error || "No models are available for this Mate. Check the vendor connection and try again.");
    }
    return catalog;
  }

  async function resolveMateModel(ws, found, userId) {
    var mateCtx = mates.buildMateCtx(userId);
    var latestMate = mates.getMate(mateCtx, found.mate.id);
    if (!latestMate) throw modelError("Mate not available.");
    var vendor = latestMate.vendor || "claude";
    var catalog = await loadCatalog(ws, found, vendor);
    var models = catalog.models || [];
    var selected = catalogModel(models, latestMate.model);
    if (!selected) selected = catalogModel(models, catalog.defaultModel);
    for (var i = 0; i < models.length && !selected; i++) selected = modelEntryValue(models[i]);
    if (!selected) throw modelError("The Mate model catalog did not return a usable model. Choose a model and try again.");
    if (latestMate.model !== selected) {
      latestMate = mates.updateMate(mateCtx, latestMate.id, { model: selected });
      if (!latestMate) throw modelError("Could not save the resolved Mate model.");
      broadcastMateUpdated(userId, latestMate);
    }
    found.mate = latestMate;
    return { vendor: vendor, model: selected, catalog: catalog };
  }

  async function sendMateModels(ws, found, requestId) {
    var vendor = found.mate.vendor || "claude";
    try {
      var catalog = await loadCatalog(ws, found, vendor);
      sendMessage(ws, {
        type: "home_mate_models_state",
        mateId: found.mate.id,
        requestId: requestId,
        vendor: vendor,
        model: found.mate.model || "",
        models: catalog.models || [],
        status: catalog.status || "ready",
        error: catalog.error || "",
      });
    } catch (error) {
      sendMessage(ws, { type: "home_mate_models_state", mateId: found.mate.id, requestId: requestId, vendor: vendor, model: found.mate.model || "", models: [], status: "error", error: error.message || String(error) });
    }
  }

  async function setMateModel(ws, found, userId, msg) {
    var requestId = msg.requestId || null;
    var vendor = found.mate.vendor || "claude";
    if (msg.vendor && msg.vendor !== vendor) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: "The Mate vendor changed before the model selection completed." });
      return;
    }
    if (!msg.model) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: "That model is not available for this Mate." });
      return;
    }
    var catalog;
    try {
      catalog = await loadCatalog(ws, found, vendor);
    } catch (error) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: error.message || String(error) });
      return;
    }
    var mateCtx = mates.buildMateCtx(userId);
    var latestMate = mates.getMate(mateCtx, found.mate.id);
    if (!latestMate || (latestMate.vendor || "claude") !== vendor) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: "The Mate vendor changed before the model selection completed." });
      return;
    }
    var selected = catalogModel(catalog.models || [], msg.model);
    if (!selected) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: "That model is not available for the Mate vendor." });
      return;
    }
    var updated = mates.updateMate(mateCtx, found.mate.id, { model: selected });
    if (!updated) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: "Mate not available." });
      return;
    }
    found.mate = updated;
    broadcastMateUpdated(userId, updated);
    sendMessage(ws, { type: "home_mate_model_result", mateId: updated.id, requestId: requestId, ok: true, vendor: vendor, model: selected });
  }

  function sendAccessError(ws, msg, text) {
    if (msg.type === "home_mate_models_get") {
      sendMessage(ws, { type: "home_mate_models_state", mateId: msg.mateId || null, requestId: msg.requestId || null, vendor: "", model: "", models: [], status: "error", error: text });
      return;
    }
    sendMessage(ws, { type: "home_mate_model_result", mateId: msg.mateId || null, requestId: msg.requestId || null, ok: false, error: text });
  }

  return {
    resolveMateModel: resolveMateModel,
    sendMateModels: sendMateModels,
    setMateModel: setMateModel,
    sendAccessError: sendAccessError,
  };
}

module.exports = { attachHomeModels: attachHomeModels };
