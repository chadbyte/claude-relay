var projectModels = require("./project-models");

var MAX_MODELS = 100;

function modelValue(entry) {
  return projectModels.modelEntryValue(entry);
}

function modelLabel(entry) {
  if (typeof entry === "string") return entry;
  return entry && (entry.displayName || entry.label || entry.name || modelValue(entry)) || "Model";
}

function findModel(models, candidate) {
  if (!candidate) return "";
  for (var i = 0; i < models.length; i++) {
    if (projectModels.modelEntryMatches(models[i], candidate)) return modelValue(models[i]);
  }
  return "";
}

function participantIds(moderatorId, panelists) {
  var ids = [moderatorId];
  for (var i = 0; i < panelists.length; i++) ids.push(panelists[i].mateId);
  return ids;
}

async function loadParticipant(ctx, ws, mateCtx, mateId, role, sourceSession) {
  var mate = ctx.getMate(mateCtx, mateId);
  if (!mate) return null;
  var vendor = mate.vendor || "claude";
  var catalog;
  try {
    if (sourceSession && typeof ctx.getVendorModelCatalogForSession === "function") catalog = await ctx.getVendorModelCatalogForSession(sourceSession, vendor);
    else catalog = await ctx.getVendorModelCatalog(ws, vendor);
  } catch (error) {
    catalog = { models: [], error: error && error.message ? error.message : String(error) };
  }
  var sourceModels = Array.isArray(catalog.models) ? catalog.models.slice(0, MAX_MODELS) : [];
  var models = [];
  var seen = {};
  for (var i = 0; i < sourceModels.length; i++) {
    var value = modelValue(sourceModels[i]);
    if (typeof value !== "string" || !value || seen[value]) continue;
    seen[value] = true;
    models.push({ value: value.slice(0, 300), label: modelLabel(sourceModels[i]).slice(0, 160) });
  }
  var selected = findModel(sourceModels, mate.model) || findModel(sourceModels, catalog.defaultModel);
  if (!selected && models.length) selected = models[0].value;
  if (!selected && typeof mate.model === "string" && mate.model) {
    selected = mate.model;
    models.push({ value: mate.model, label: mate.model });
  }
  return {
    mateId: mateId,
    role: role,
    vendor: vendor,
    selectedModel: selected || "",
    models: models,
    status: models.length ? "ready" : "unavailable",
    error: models.length ? "" : (catalog.error || "No models are available for this provider."),
  };
}

async function loadSelections(ctx, ws, mateCtx, moderatorId, panelists, sourceSession) {
  var ids = participantIds(moderatorId, panelists);
  var selections = [];
  for (var i = 0; i < ids.length; i++) {
    var selection = await loadParticipant(ctx, ws, mateCtx, ids[i], i === 0 ? "moderator" : "panelist", sourceSession);
    if (selection) selections.push(selection);
  }
  return selections;
}

function requestedByMate(overrides) {
  if (overrides == null) return { values: {} };
  if (!Array.isArray(overrides) || overrides.length > 12) return { error: "The debate model selection is invalid." };
  var result = {};
  for (var i = 0; i < overrides.length; i++) {
    var item = overrides[i];
    if (!item || typeof item.mateId !== "string" || typeof item.model !== "string" || !item.mateId || !item.model || result[item.mateId]) {
      return { error: "The debate model selection is invalid." };
    }
    result[item.mateId] = item.model.slice(0, 300);
  }
  return { values: result };
}

async function validateSelections(ctx, ws, mateCtx, moderatorId, panelists, overrides, sourceSession) {
  var selections = await loadSelections(ctx, ws, mateCtx, moderatorId, panelists, sourceSession);
  var requestResult = requestedByMate(overrides);
  if (requestResult.error) return { error: requestResult.error };
  var requested = requestResult.values;
  var allowed = {};
  var resolved = [];
  for (var i = 0; i < selections.length; i++) {
    var selection = selections[i];
    allowed[selection.mateId] = true;
    var requestedModel = requested[selection.mateId] || selection.selectedModel;
    var selected = "";
    for (var j = 0; j < selection.models.length; j++) {
      if (selection.models[j].value === requestedModel) selected = requestedModel;
    }
    if (requested[selection.mateId] && !selected) {
      return { error: "A selected debate model is no longer available. Review the panel models and try again." };
    }
    if (selected) resolved.push({ mateId: selection.mateId, vendor: selection.vendor, model: selected });
  }
  var requestedIds = Object.keys(requested);
  for (var k = 0; k < requestedIds.length; k++) {
    if (!allowed[requestedIds[k]]) return { error: "A model override does not belong to this debate panel." };
  }
  return { selections: resolved };
}

module.exports = {
  loadSelections: loadSelections,
  validateSelections: validateSelections,
};
