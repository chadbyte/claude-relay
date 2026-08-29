import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';

var overlay = null;
var bodyEl = null;
var activeKind = null;
var activeMateId = null;

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function closeViewer() {
  if (overlay) overlay.remove();
  overlay = null;
  bodyEl = null;
  activeKind = null;
  activeMateId = null;
}

function addEmpty(text) {
  var empty = document.createElement("div");
  empty.className = "home-mate-property-empty";
  empty.textContent = text;
  bodyEl.appendChild(empty);
}

function createViewer(kind, mateName) {
  closeViewer();
  overlay = document.createElement("div");
  overlay.className = "home-mate-property-overlay";
  var backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "home-mate-property-backdrop";
  backdrop.setAttribute("aria-label", "Close viewer");
  backdrop.addEventListener("click", closeViewer);
  var panel = document.createElement("section");
  panel.className = "home-mate-property-panel";
  var header = document.createElement("header");
  header.className = "home-mate-property-header";
  var title = document.createElement("div");
  title.className = "home-mate-property-title";
  title.innerHTML = iconHtml(kind === "memory" ? "brain" : "book-open");
  var titleText = document.createElement("span");
  titleText.textContent = (kind === "memory" ? "Memory" : "Knowledge") + " · " + mateName;
  title.appendChild(titleText);
  var close = document.createElement("button");
  close.type = "button";
  close.className = "home-mate-property-close";
  close.setAttribute("aria-label", "Close viewer");
  close.innerHTML = iconHtml("x");
  close.addEventListener("click", closeViewer);
  header.appendChild(title);
  header.appendChild(close);
  bodyEl = document.createElement("div");
  bodyEl.className = "home-mate-property-body";
  addEmpty("Loading…");
  panel.appendChild(header);
  panel.appendChild(bodyEl);
  overlay.appendChild(backdrop);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  refreshIcons();
}

export function openHomeMateProperty(kind, mateId, mateName) {
  if (!mateId || (kind !== "memory" && kind !== "knowledge")) return;
  createViewer(kind, mateName || "Mate");
  activeKind = kind;
  activeMateId = mateId;
  send({ type: kind === "memory" ? "home_mate_memory_list" : "home_mate_knowledge_list", mateId: mateId });
}

export function handleHomeMateMemoryState(msg) {
  if (!bodyEl || activeKind !== "memory" || msg.mateId !== activeMateId) return;
  bodyEl.innerHTML = "";
  if (msg.summary) {
    var summary = document.createElement("div");
    summary.className = "home-mate-property-summary";
    summary.textContent = msg.summary;
    bodyEl.appendChild(summary);
  }
  var entries = msg.entries || [];
  for (var i = 0; i < entries.length; i++) {
    var item = document.createElement("article");
    item.className = "home-mate-property-item";
    var heading = document.createElement("strong");
    heading.textContent = entries[i].topic || entries[i].date || "Memory";
    var detail = document.createElement("p");
    detail.textContent = entries[i].my_position || entries[i].decisions || entries[i].outcome || "";
    item.appendChild(heading);
    if (detail.textContent) item.appendChild(detail);
    bodyEl.appendChild(item);
  }
  if (!msg.summary && entries.length === 0) addEmpty("No memories yet.");
}

export function handleHomeMateKnowledgeState(msg) {
  if (!bodyEl || activeKind !== "knowledge" || msg.mateId !== activeMateId) return;
  bodyEl.innerHTML = "";
  var files = msg.files || [];
  for (var i = 0; i < files.length; i++) {
    var item = document.createElement("div");
    item.className = "home-mate-property-file";
    item.innerHTML = iconHtml("file-text");
    var name = document.createElement("span");
    name.textContent = files[i].name || "Untitled";
    item.appendChild(name);
    bodyEl.appendChild(item);
  }
  if (files.length === 0) addEmpty("No knowledge files yet.");
  refreshIcons();
}
