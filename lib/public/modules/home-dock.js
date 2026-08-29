// Home dock registry, three-state navigation, and preference synchronization.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml } from './utils.js';
import { applyHomeDockWidth, initHomeDockResize } from './home-dock-resize.js';

var tools = [];
var toolsById = Object.create(null);
var mountedToolId = null;
var pulseTimers = Object.create(null);
var initialized = false;
var resizeSaveTimer = null;

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function activeTool() {
  var activeId = store.get('dockActiveToolId') || "board";
  return toolsById[activeId] || toolsById.board || tools[0] || null;
}

function preference() {
  return {
    dockOpen: store.get('dockOpen') === true,
    dockWidth: store.get('dockWidth'),
    activeToolId: store.get('dockActiveToolId') || null,
  };
}

function persistDock() {
  send({ type: "home_dock_set", preference: preference() });
}

function hasVisibleEscapeLayer() {
  var selector = '[role="dialog"], .cmd-palette, [id$="-modal"], [id$="-overlay"], .panel-fullscreen';
  var layers = document.querySelectorAll(selector);
  for (var i = 0; i < layers.length; i++) {
    if (!layers[i].classList.contains("hidden") && layers[i].getClientRects().length > 0) return true;
  }
  return false;
}

function renderToolIdentity(tool) {
  return '<span class="home-dock-tab-icon">' + iconHtml(tool.lucideIcon || "box") + '</span>'
    + '<span class="home-dock-tab-label">' + escapeHtml(tool.name) + '</span>';
}

function syncDockTrigger() {
  var button = document.getElementById("home-tools-btn");
  var label = document.getElementById("home-tools-label");
  var dot = document.getElementById("home-tools-activity");
  var tool = activeTool();
  if (label) label.textContent = tool ? tool.name : "Tools";
  if (dot) dot.classList.toggle("visible", store.get('dockHasActivity') === true);
  if (button) button.setAttribute("aria-expanded", store.get('dockOpen') === true ? "true" : "false");
}

function syncDockState() {
  var hub = document.getElementById("home-hub");
  if (!hub) return;
  var open = store.get('dockOpen') === true;
  var focus = open && store.get('dockFocus') === true;
  hub.classList.toggle("dock-open", open);
  hub.classList.toggle("dock-split", open && !focus);
  hub.classList.toggle("dock-focus", focus);
  applyHomeDockWidth(store.get('dockWidth'));
  syncDockTrigger();
}

function setDockState(patch, persist) {
  store.set(patch);
  syncDockState();
  renderDock();
  if (persist) persistDock();
}

function activateTool(toolId) {
  setDockState({
    dockActiveToolId: toolId,
    dockOpen: true,
    dockFocus: store.get('dockFocus') === true,
    dockHasActivity: false,
  }, true);
}

export function openHomeDock(toolId) {
  var requested = toolId && toolsById[toolId] ? toolId : (activeTool() ? activeTool().id : "board");
  setDockState({ dockActiveToolId: requested, dockOpen: true, dockFocus: false, dockHasActivity: false }, true);
}

export function closeHomeDock() {
  setDockState({ dockOpen: false, dockFocus: false }, true);
}

export function focusHomeDock() {
  if (!store.get('dockOpen')) return;
  setDockState({ dockFocus: true }, false);
}

export function returnHomeDockToSplit() {
  if (!store.get('dockOpen')) return;
  setDockState({ dockFocus: false }, false);
}

function handleReturnHomeDock() {
  if (window.innerWidth <= 768) {
    closeHomeDock();
    return;
  }
  returnHomeDockToSplit();
}

export function resetHomeDockFocus() {
  if (!store.get('dockFocus')) return;
  store.set({ dockFocus: false });
  syncDockState();
}

export function requestHomeDockPreference() {
  send({ type: "home_dock_get" });
}

export function handleHomeDockState(msg) {
  if (!msg || msg.error || !msg.preference) return;
  var saved = msg.preference;
  store.set({
    dockOpen: saved.dockOpen === true,
    dockWidth: typeof saved.dockWidth === "number" ? saved.dockWidth : null,
    dockActiveToolId: saved.activeToolId || store.get('dockActiveToolId') || "board",
    dockFocus: saved.dockOpen === true && store.get('dockFocus') === true,
  });
  syncDockState();
  renderDock();
}

export function markDockToolChanged(toolId) {
  if (store.get('dockOpen')) {
    pulseDockTool(toolId);
    return;
  }
  store.set({ dockHasActivity: true, dockActivityToolId: toolId || null });
  syncDockTrigger();
}

export function registerDockTool(tool) {
  if (!tool || !tool.id || !tool.name || typeof tool.render !== "function") return;
  if (toolsById[tool.id]) {
    var existingIndex = tools.indexOf(toolsById[tool.id]);
    if (existingIndex !== -1) tools[existingIndex] = tool;
  } else {
    tools.push(tool);
  }
  toolsById[tool.id] = tool;
  syncDockTrigger();
}

export function unregisterDockTool(toolId) {
  var tool = toolsById[toolId];
  if (!tool) return;
  var wasMounted = mountedToolId === toolId;
  if (wasMounted && typeof tool.onHide === "function") tool.onHide();
  var index = tools.indexOf(tool);
  if (index !== -1) tools.splice(index, 1);
  delete toolsById[toolId];
  if (store.get('dockActiveToolId') === toolId) store.set({ dockActiveToolId: toolsById.board ? "board" : null });
  if (wasMounted) mountedToolId = null;
  syncDockTrigger();
}

export function pulseDockTool(toolId) {
  if (!store.get('dockOpen')) {
    store.set({ dockHasActivity: true, dockActivityToolId: toolId || null });
    syncDockTrigger();
    return;
  }
  var tabs = document.querySelectorAll("[data-dock-tool-id]");
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].dataset.dockToolId !== toolId) continue;
    tabs[i].classList.remove("mate-acted");
    void tabs[i].offsetWidth;
    tabs[i].classList.add("mate-acted");
  }
  if (pulseTimers[toolId]) clearTimeout(pulseTimers[toolId]);
  pulseTimers[toolId] = setTimeout(function () {
    var current = document.querySelectorAll("[data-dock-tool-id]");
    for (var j = 0; j < current.length; j++) {
      if (current[j].dataset.dockToolId === toolId) current[j].classList.remove("mate-acted");
    }
    delete pulseTimers[toolId];
  }, 1600);
}

export function renderDock() {
  var switcherEl = document.getElementById("home-dock-switcher");
  var contentEl = document.getElementById("home-dock-content");
  if (!switcherEl || !contentEl) return;
  var selected = activeTool();
  switcherEl.innerHTML = "";
  if (!selected) {
    contentEl.innerHTML = "";
    syncDockTrigger();
    return;
  }
  if (selected.id !== store.get('dockActiveToolId')) store.set({ dockActiveToolId: selected.id });
  for (var i = 0; i < tools.length; i++) {
    (function (tool) {
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "home-dock-tool" + (tool.id === selected.id ? " active" : "");
      tab.dataset.dockToolId = tool.id;
      tab.innerHTML = renderToolIdentity(tool);
      tab.addEventListener("click", function () { activateTool(tool.id); });
      switcherEl.appendChild(tab);
    })(tools[i]);
  }
  if (mountedToolId && mountedToolId !== selected.id) {
    var previous = toolsById[mountedToolId];
    if (previous && typeof previous.onHide === "function") previous.onHide();
  }
  mountedToolId = selected.id;
  contentEl.innerHTML = "";
  selected.render(contentEl);
  if (typeof selected.onShow === "function") selected.onShow();
  syncDockTrigger();
  refreshIcons();
}

export function initHomeDock() {
  if (initialized) return;
  initialized = true;
  initHomeDockResize();
  document.getElementById("home-tools-btn").addEventListener("click", function () {
    if (store.get('dockOpen')) closeHomeDock();
    else openHomeDock();
  });
  document.getElementById("home-dock-collapse").addEventListener("click", closeHomeDock);
  document.getElementById("home-dock-focus").addEventListener("click", focusHomeDock);
  document.getElementById("home-dock-return").addEventListener("click", handleReturnHomeDock);
  document.getElementById("home-dock-backdrop").addEventListener("click", closeHomeDock);
  window.addEventListener("clay:home-dock-width-preview", function (event) {
    if (event.detail && typeof event.detail.width === "number") store.set({ dockWidth: event.detail.width });
  });
  window.addEventListener("clay:home-dock-width-commit", function (event) {
    if (!event.detail || typeof event.detail.width !== "number") return;
    store.set({ dockWidth: event.detail.width });
    if (resizeSaveTimer) clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(persistDock, 180);
  });
  window.addEventListener("resize", syncDockState);
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !store.get('dockFocus') || !document.body.classList.contains("home-active")) return;
    if (hasVisibleEscapeLayer()) return;
    event.preventDefault();
    event.stopPropagation();
    returnHomeDockToSplit();
  }, true);
  syncDockState();
}
