import { store } from './store.js';

function mateName(mateId) {
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) {
    if (!mates[i] || mates[i].id !== mateId) continue;
    var profile = mates[i].profile || {};
    return profile.displayName || mates[i].displayName || mates[i].name || "Mate";
  }
  return "Mate";
}

function textElement(tag, className, text) {
  var element = document.createElement(tag);
  element.className = className;
  element.textContent = text || "";
  return element;
}

export function appendDebateModelSelectors(body, proposal, disabled) {
  var selections = Array.isArray(proposal.modelSelections) ? proposal.modelSelections : [];
  if (!selections.length) return null;
  var fieldset = document.createElement("fieldset");
  fieldset.className = "home-debate-models";
  fieldset.disabled = disabled === true;
  fieldset.appendChild(textElement("legend", "home-debate-models-title", "Models"));
  fieldset.appendChild(textElement("p", "home-debate-models-hint", "Used for this debate only. Mate defaults stay unchanged."));
  for (var i = 0; i < selections.length; i++) {
    var selection = selections[i];
    if (!selection || !selection.mateId) continue;
    var row = document.createElement("label");
    row.className = "home-debate-model-row";
    var identity = document.createElement("span");
    identity.className = "home-debate-model-identity";
    identity.appendChild(textElement("strong", "home-debate-model-name", mateName(selection.mateId)));
    identity.appendChild(textElement("small", "home-debate-model-role", selection.role === "moderator" ? "Moderator" : "Panelist"));
    row.appendChild(identity);
    var models = Array.isArray(selection.models) ? selection.models : [];
    if (models.length) {
      var select = document.createElement("select");
      select.className = "home-debate-model-select";
      select.dataset.mateId = selection.mateId;
      select.setAttribute("aria-label", "Model for " + mateName(selection.mateId));
      for (var j = 0; j < models.length; j++) {
        var option = document.createElement("option");
        option.value = models[j].value || "";
        option.textContent = models[j].label || models[j].value || "Model";
        if (option.value === selection.selectedModel) option.selected = true;
        select.appendChild(option);
      }
      select.value = selection.selectedModel || (models[0] && models[0].value) || "";
      row.appendChild(select);
    } else {
      var unavailable = textElement("span", "home-debate-model-unavailable", "Default model");
      unavailable.title = selection.error || "The model catalog is unavailable.";
      row.appendChild(unavailable);
    }
    fieldset.appendChild(row);
  }
  body.appendChild(fieldset);
  return fieldset;
}

export function collectDebateModelOverrides(card) {
  var result = [];
  if (!card || typeof card.querySelectorAll !== "function") return result;
  var selects = card.querySelectorAll(".home-debate-model-select");
  for (var i = 0; i < selects.length; i++) {
    if (!selects[i].dataset || !selects[i].dataset.mateId || !selects[i].value) continue;
    result.push({ mateId: selects[i].dataset.mateId, model: selects[i].value });
  }
  return result;
}
