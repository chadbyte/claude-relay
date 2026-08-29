import { VENDOR_NAMES, VENDOR_ORDER, isExperimentalVendor } from './app-rendering.js';
import { effortLevelsFor, effortDisplayName } from './app-panels.js';

function optionValue(entry) {
  if (typeof entry === "string") return entry;
  return entry && (entry.value || entry.id) || "";
}

function optionLabel(entry) {
  if (typeof entry === "string") return entry;
  return entry && (entry.displayName || entry.name || entry.value || entry.id) || "";
}

export function buildAgentVendorSelect(installed, preferred) {
  var select = document.createElement("select");
  select.className = "wt-modal-input";
  for (var i = 0; i < VENDOR_ORDER.length; i++) {
    var vendor = VENDOR_ORDER[i];
    if (installed.indexOf(vendor) === -1) continue;
    var option = document.createElement("option");
    option.value = vendor;
    option.textContent = (isExperimentalVendor(vendor) ? "🧪 " : "") + (VENDOR_NAMES[vendor] || vendor);
    if (isExperimentalVendor(vendor)) option.title = "Experimental integration; not yet validated through direct use testing";
    select.appendChild(option);
  }
  if (preferred && installed.indexOf(preferred) !== -1) select.value = preferred;
  return select;
}

export function fillAgentModels(select, vendor, options, preferred) {
  var models = (options.modelsByVendor && options.modelsByVendor[vendor]) || [];
  select.innerHTML = "";
  var automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "Automatic";
  select.appendChild(automatic);
  for (var i = 0; i < models.length; i++) {
    var option = document.createElement("option");
    option.value = optionValue(models[i]);
    option.textContent = optionLabel(models[i]);
    select.appendChild(option);
  }
  select.value = preferred || "";
  if (select.selectedIndex === -1) select.value = "";
}

export function buildAgentEffortSelect() {
  var select = document.createElement("select");
  select.className = "wt-modal-input";
  return select;
}

export function fillAgentEffort(select, vendor, options, modelValue, preferred) {
  var previous = preferred === undefined ? select.value : preferred;
  var models = (options.modelsByVendor && options.modelsByVendor[vendor]) || [];
  var levels = effortLevelsFor(vendor, models, modelValue);
  select.innerHTML = "";
  var automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "Default";
  select.appendChild(automatic);
  for (var i = 0; i < levels.length; i++) {
    var option = document.createElement("option");
    option.value = levels[i];
    option.textContent = effortDisplayName(levels[i]);
    select.appendChild(option);
  }
  select.value = levels.indexOf(previous) !== -1 ? previous : "";
}
