// Read-only Mate backstage surfaces hosted by the Home Workbench.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { openHomeBackstage, closeHomeBackstage } from './home-dock.js';
import { editMateProfile, confirmMateRemoval } from './mate-management.js';
import { updateHomeSurfacePreference } from './home-surface.js';
import { resetHomeMateModelPicker, clearHomeMateModelPicker, requestHomeMateModels, renderHomeMateModelPicker, applyHomeMateModelsState, applyHomeMateModelResult } from './home-mate-model-picker.js';

var activeKind = null;
var activeMateId = null;
var activeMateName = "";
var memoryState = null;
var knowledgeState = null;

function clearActiveState() {
  activeKind = null;
  activeMateId = null;
  activeMateName = "";
  memoryState = null;
  knowledgeState = null;
  clearHomeMateModelPicker();
}

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function getMate(mateId) {
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) {
    if (mates[i] && mates[i].id === mateId) return mates[i];
  }
  return null;
}

function isNarrow() {
  return !!window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
}

function kindLabel(kind) {
  if (kind === "memory") return "Memory";
  if (kind === "knowledge") return "Knowledge";
  if (kind === "model") return "Model";
  return "Mate settings";
}

function kindIcon(kind) {
  if (kind === "memory") return "brain";
  if (kind === "knowledge") return "book-open";
  if (kind === "model") return "cpu";
  return "settings-2";
}

function addEmpty(container, text) {
  var empty = document.createElement("div");
  empty.className = "home-mate-backstage-empty";
  empty.textContent = text;
  container.appendChild(empty);
  return empty;
}

function addBackstageNav(container) {
  var nav = document.createElement("nav");
  nav.className = "home-mate-backstage-nav";
  nav.setAttribute("aria-label", "Mate backstage sections");
  var sections = [
    { kind: "memory", label: "Memory" },
    { kind: "knowledge", label: "Knowledge" },
    { kind: "model", label: "Model" },
    { kind: "settings", label: "Settings" },
  ];
  for (var i = 0; i < sections.length; i++) {
    (function (section) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "home-mate-backstage-nav-item";
      button.textContent = section.label;
      if (section.kind === activeKind) button.setAttribute("aria-current", "page");
      button.addEventListener("click", function () {
        openHomeMateProperty(section.kind, activeMateId, activeMateName);
      });
      nav.appendChild(button);
    })(sections[i]);
  }
  container.appendChild(nav);
}

function renderMemory(body) {
  if (!memoryState) {
    addEmpty(body, "Loading memory…");
    return;
  }
  if (memoryState.summary) {
    var summary = document.createElement("div");
    summary.className = "home-mate-backstage-summary";
    var summaryLabel = document.createElement("span");
    summaryLabel.textContent = "Working summary";
    var summaryText = document.createElement("p");
    summaryText.textContent = memoryState.summary;
    summary.appendChild(summaryLabel);
    summary.appendChild(summaryText);
    body.appendChild(summary);
  }
  var entries = memoryState.entries || [];
  for (var i = 0; i < entries.length; i++) {
    var item = document.createElement("article");
    item.className = "home-mate-backstage-memory";
    var heading = document.createElement("h3");
    heading.textContent = entries[i].topic || entries[i].date || "Memory";
    var detail = document.createElement("p");
    detail.textContent = entries[i].my_position || entries[i].decisions || entries[i].outcome || "";
    item.appendChild(heading);
    if (detail.textContent) item.appendChild(detail);
    body.appendChild(item);
  }
  if (!memoryState.summary && entries.length === 0) addEmpty(body, "No memories yet.");
}

function renderKnowledge(body) {
  if (!knowledgeState) {
    addEmpty(body, "Loading knowledge…");
    return;
  }
  var files = knowledgeState.files || [];
  for (var i = 0; i < files.length; i++) {
    var item = document.createElement("div");
    item.className = "home-mate-backstage-file";
    item.innerHTML = iconHtml("file-text");
    var name = document.createElement("span");
    name.textContent = typeof files[i] === "string" ? files[i] : (files[i].name || "Untitled");
    item.appendChild(name);
    body.appendChild(item);
  }
  if (files.length === 0) addEmpty(body, "No knowledge files yet.");
}

function renderSettings(body, mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  var identity = document.createElement("div");
  identity.className = "home-mate-backstage-identity";
  var label = document.createElement("span");
  label.textContent = mate && mate.primary ? "Primary Mate" : "Current Mate";
  var name = document.createElement("h3");
  name.textContent = activeMateName;
  var bio = document.createElement("p");
  bio.textContent = profile.bio || (mate && mate.bio) || "Profile and management controls for this Mate.";
  identity.appendChild(label);
  identity.appendChild(name);
  identity.appendChild(bio);
  body.appendChild(identity);
  if (!mate || mate.primary) {
    addEmpty(body, "This built-in Mate is managed by Clay.");
    return;
  }
  var actions = document.createElement("div");
  actions.className = "home-mate-backstage-actions";
  var edit = document.createElement("button");
  edit.type = "button";
  edit.className = "home-mate-backstage-action";
  edit.innerHTML = iconHtml("edit-2") + "<span>Edit profile</span>";
  edit.addEventListener("click", function () { editMateProfile(edit, mate); });
  var remove = document.createElement("button");
  remove.type = "button";
  remove.className = "home-mate-backstage-action is-danger";
  remove.innerHTML = iconHtml(mate.builtinKey ? "minus-circle" : "trash-2") + "<span></span>";
  remove.querySelector("span").textContent = mate.builtinKey ? "Remove Mate" : "Delete Mate";
  remove.addEventListener("click", function () {
    confirmMateRemoval(remove, mate, closeHomeMateBackstage);
  });
  actions.appendChild(edit);
  actions.appendChild(remove);
  body.appendChild(actions);
}

function refreshActiveBody() {
  var body = document.querySelector("#home-dock-content .home-mate-backstage-body");
  if (!body) return;
  var focusedModel = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.homeMateModel : null;
  var focusedVendor = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.homeMateVendor : null;
  var focusedModelControl = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.homeModelFocus : null;
  body.innerHTML = "";
  if (activeKind === "memory") renderMemory(body);
  else if (activeKind === "knowledge") renderKnowledge(body);
  else if (activeKind === "model") renderHomeMateModelPicker(body, refreshActiveBody);
  else renderSettings(body, getMate(activeMateId));
  refreshIcons();
  if (focusedModel) {
    var options = body.querySelectorAll("[data-home-mate-model]");
    for (var i = 0; i < options.length; i++) {
      if (options[i].dataset.homeMateModel !== focusedModel) continue;
      options[i].focus({ preventScroll: true });
      break;
    }
  }
  if (focusedVendor) {
    var vendors = body.querySelectorAll("[data-home-mate-vendor]");
    for (var j = 0; j < vendors.length; j++) {
      if (vendors[j].dataset.homeMateVendor !== focusedVendor) continue;
      vendors[j].focus({ preventScroll: true });
      break;
    }
  }
  if (focusedModelControl) {
    var modelControl = body.querySelector("[data-home-model-focus='" + focusedModelControl + "']");
    if (modelControl) modelControl.focus({ preventScroll: true });
  }
}

function renderBackstage(container, onReturn) {
  var section = document.createElement("section");
  section.className = "home-mate-backstage";
  section.setAttribute("aria-labelledby", "home-mate-backstage-title");
  var utility = document.createElement("div");
  utility.className = "home-mate-backstage-utility";
  var back = document.createElement("button");
  back.type = "button";
  back.className = "home-mate-backstage-return";
  back.innerHTML = iconHtml("arrow-left") + "<span>Return to Workbench</span>";
  back.addEventListener("click", onReturn);
  var eyebrow = document.createElement("span");
  eyebrow.className = "home-mate-backstage-eyebrow";
  eyebrow.textContent = "Mate backstage";
  utility.appendChild(back);
  utility.appendChild(eyebrow);
  var title = document.createElement("h2");
  title.id = "home-mate-backstage-title";
  title.tabIndex = -1;
  title.setAttribute("data-home-backstage-focus", "");
  title.innerHTML = iconHtml(kindIcon(activeKind)) + "<span></span>";
  title.querySelector("span").textContent = kindLabel(activeKind) + " · " + activeMateName;
  section.appendChild(utility);
  section.appendChild(title);
  addBackstageNav(section);
  var body = document.createElement("div");
  body.className = "home-mate-backstage-body";
  if (activeKind === "memory") renderMemory(body);
  else if (activeKind === "knowledge") renderKnowledge(body);
  else if (activeKind === "model") renderHomeMateModelPicker(body, refreshActiveBody);
  else renderSettings(body, getMate(activeMateId));
  section.appendChild(body);
  container.appendChild(section);
  refreshIcons();
}

export function openHomeMateProperty(kind, mateId, mateName) {
  if (!mateId || (kind !== "memory" && kind !== "knowledge" && kind !== "model" && kind !== "settings")) return;
  if (activeKind) closeHomeMateBackstage();
  activeKind = kind;
  activeMateId = mateId;
  activeMateName = mateName || "Mate";
  if (kind === "memory") memoryState = null;
  if (kind === "knowledge") knowledgeState = null;
  if (kind === "model") resetHomeMateModelPicker(mateId, activeMateName, getMate(mateId));
  openHomeBackstage({ label: kindLabel(kind), render: renderBackstage, onClose: clearActiveState });
  if (kind === "memory") send({ type: "home_mate_memory_list", mateId: mateId });
  if (kind === "knowledge") send({ type: "home_mate_knowledge_list", mateId: mateId });
  if (kind === "model") requestHomeMateModels((getMate(mateId) || {}).vendor || "", refreshActiveBody, false);
  if (isNarrow() && store.get('homeSidebarCollapsed') !== true) {
    updateHomeSurfacePreference({ sidebarCollapsed: true });
  }
}

export function closeHomeMateBackstage() {
  if (!activeKind) return;
  closeHomeBackstage();
}

export function handleHomeMateMemoryState(msg) {
  if (activeKind !== "memory" || msg.mateId !== activeMateId) return;
  memoryState = { summary: msg.summary || "", entries: msg.entries || [] };
  refreshActiveBody();
}

export function handleHomeMateKnowledgeState(msg) {
  if (activeKind !== "knowledge" || msg.mateId !== activeMateId) return;
  knowledgeState = { files: msg.files || [] };
  refreshActiveBody();
}

export function handleHomeMateModelsState(msg) {
  if (activeKind === "model" && applyHomeMateModelsState(msg)) refreshActiveBody();
}

export function handleHomeMateModelResult(msg) {
  if (activeKind === "model" && applyHomeMateModelResult(msg)) refreshActiveBody();
}
