// Home dock registry, three-state navigation, and preference synchronization.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml } from './utils.js';
import { applyHomeDockWidth, initHomeDockResize } from './home-dock-resize.js';
import { renderHomeCapsuleLibrary } from './home-capsule-library.js';

var tools = [];
var toolsById = Object.create(null);
var mountedToolId = null;
var pulseTimers = Object.create(null);
var initialized = false;
var resizeSaveTimer = null;
var backstageView = null;
var backstageReturnTarget = null;

function clearBackstageView() {
  var previous = backstageView;
  backstageView = null;
  backstageReturnTarget = null;
  if (previous && typeof previous.onClose === "function") previous.onClose();
}

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
    dockFocus: store.get('dockOpen') === true && store.get('dockFocus') === true,
    dockWidth: store.get('dockWidth'),
    activeToolId: store.get('dockActiveToolId') || null,
  };
}

function persistDock() {
  send({ type: "home_dock_set", preference: preference() });
}

function hasVisibleEscapeLayer() {
  var selector = '[role="dialog"], [role="menu"], .profile-popover, .project-ctx-menu, .cmd-palette, [id$="-modal"], [id$="-overlay"], .panel-fullscreen';
  var layers = document.querySelectorAll(selector);
  for (var i = 0; i < layers.length; i++) {
    if (!layers[i].classList.contains("hidden") && layers[i].getClientRects().length > 0) return true;
  }
  return false;
}

function hasEditableEscapeTarget(target) {
  if (!target || typeof target.matches !== "function") return false;
  if (target.matches('input, textarea, select, [contenteditable="true"]')) return true;
  return typeof target.closest === "function" && Boolean(target.closest('[contenteditable="true"]'));
}

function renderToolIdentity(tool) {
  return '<span class="home-dock-tab-icon">' + iconHtml(tool.lucideIcon || "box") + '</span>'
    + '<span class="home-dock-tab-label">' + escapeHtml(tool.name) + '</span>';
}

function clearDockContext(contextEl) {
  var mounted = mountedToolId ? toolsById[mountedToolId] : null;
  if (mounted && typeof mounted.onChromeHide === "function") mounted.onChromeHide();
  contextEl.innerHTML = "";
  contextEl.hidden = true;
}

function syncDockTrigger() {
  var button = document.getElementById("home-tools-btn");
  var label = document.getElementById("home-tools-label");
  var activity = document.getElementById("home-tools-activity");
  var hasActivity = store.get('dockHasActivity') === true;
  if (label) label.textContent = "Capsules";
  if (activity) activity.classList.toggle("is-active", hasActivity);
  if (button) {
    button.setAttribute("aria-expanded", store.get('dockOpen') === true ? "true" : "false");
    button.setAttribute("aria-label", hasActivity ? "Capsules, new activity" : "Capsules");
  }
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
  clearBackstageView();
  setDockState({
    dockActiveToolId: toolId,
    dockOpen: true,
    dockFocus: store.get('dockFocus') === true,
    dockLibraryOpen: false,
    dockBackstageOpen: false,
    dockHasActivity: false,
    dockActivityToolId: null,
  }, true);
}

export function openHomeDock(toolId) {
  clearBackstageView();
  var requested = toolId && toolsById[toolId] ? toolId : (activeTool() ? activeTool().id : "board");
  setDockState({ dockActiveToolId: requested, dockOpen: true, dockFocus: false, dockLibraryOpen: false, dockBackstageOpen: false, dockHasActivity: false, dockActivityToolId: null }, true);
}

function focusActiveCapsuleTab() {
  var activeTab = document.querySelector("#home-dock-switcher .home-dock-tool.active");
  if (activeTab) activeTab.focus();
}

function openLibraryCapsule(toolId) {
  activateTool(toolId);
  focusActiveCapsuleTab();
}

function openHomeCapsuleLibrary() {
  clearBackstageView();
  setDockState({
    dockActiveToolId: null,
    dockOpen: true,
    dockFocus: false,
    dockLibraryOpen: true,
    dockBackstageOpen: false,
    dockHasActivity: false,
    dockActivityToolId: null,
  }, true);
  var title = document.getElementById("home-capsule-library-title");
  if (title) title.focus();
}

export function openHomeCapsules() {
  var lastActiveId = store.get('dockActiveToolId');
  if (lastActiveId && toolsById[lastActiveId]) {
    openHomeDock(lastActiveId);
    focusActiveCapsuleTab();
    return;
  }
  openHomeCapsuleLibrary();
}

export function toggleHomeCapsules() {
  if (store.get('dockOpen')) closeHomeDock();
  else openHomeCapsules();
}

export function openHomeBackstage(view) {
  if (!view || typeof view.render !== "function") return;
  clearBackstageView();
  backstageView = view;
  var activeId = store.get('dockActiveToolId');
  backstageReturnTarget = activeId && toolsById[activeId]
    ? { type: "capsule", toolId: activeId }
    : { type: "library" };
  setDockState({
    dockOpen: true,
    dockFocus: false,
    dockLibraryOpen: backstageReturnTarget.type === "library",
    dockBackstageOpen: true,
  }, true);
  var focusTarget = document.querySelector("#home-dock-content [data-home-backstage-focus]");
  if (focusTarget) focusTarget.focus();
}

export function closeHomeBackstage() {
  var returnTarget = backstageReturnTarget;
  clearBackstageView();
  var returnToCapsule = returnTarget && returnTarget.type === "capsule" && toolsById[returnTarget.toolId];
  setDockState({
    dockActiveToolId: returnToCapsule ? returnTarget.toolId : store.get('dockActiveToolId'),
    dockLibraryOpen: !returnToCapsule,
    dockBackstageOpen: false,
  }, false);
  if (!returnToCapsule) {
    var libraryTitle = document.getElementById("home-capsule-library-title");
    if (libraryTitle) libraryTitle.focus();
    return;
  }
  focusActiveCapsuleTab();
}

export function closeHomeDock() {
  clearBackstageView();
  setDockState({ dockOpen: false, dockFocus: false, dockBackstageOpen: false }, true);
  var homeControl = document.getElementById("home-tools-btn");
  if (homeControl && homeControl.getClientRects().length) homeControl.focus({ preventScroll: true });
  else {
    var sidebarControl = document.getElementById("home-sidebar-expand");
    if (sidebarControl && sidebarControl.getClientRects().length) sidebarControl.focus({ preventScroll: true });
  }
}

export function focusHomeDock() {
  if (!store.get('dockOpen')) return;
  setDockState({ dockFocus: true }, true);
}

export function returnHomeDockToSplit() {
  if (!store.get('dockOpen')) return;
  setDockState({ dockFocus: false }, true);
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
  if (!msg) return;
  if (msg.error || !msg.preference) {
    store.set({ homeDockPreferenceLoaded: true });
    return;
  }
  var saved = msg.preference;
  store.set({
    dockOpen: saved.dockOpen === true,
    homeDockPreferenceLoaded: true,
    dockWidth: typeof saved.dockWidth === "number" ? saved.dockWidth : null,
    dockActiveToolId: saved.activeToolId || null,
    dockFocus: saved.dockOpen === true && saved.dockFocus === true,
    dockLibraryOpen: saved.dockOpen === true && !saved.activeToolId,
  });
  syncDockState();
  if (store.get('homeToolRegistryLoaded') && reconcileDockActiveTool()) return;
  renderDock();
}

export function reconcileDockActiveTool() {
  var activeToolId = store.get('dockActiveToolId');
  if (!activeToolId || toolsById[activeToolId]) return false;
  store.set({
    dockActiveToolId: null,
    dockLibraryOpen: store.get('dockOpen') === true,
  });
  syncDockState();
  renderDock();
  persistDock();
  return true;
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
  if (store.get('dockActiveToolId') === toolId) {
    store.set({
      dockActiveToolId: null,
      dockLibraryOpen: store.get('dockOpen') === true,
    });
    persistDock();
  }
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
  var contextEl = document.getElementById("home-dock-context");
  var contentEl = document.getElementById("home-dock-content");
  if (!switcherEl || !contextEl || !contentEl) return;
  var backstageOpen = store.get('dockBackstageOpen') === true && !!backstageView;
  var libraryOpen = store.get('dockLibraryOpen') === true;
  var selected = backstageOpen || libraryOpen ? null : activeTool();
  switcherEl.innerHTML = "";
  clearDockContext(contextEl);
  for (var i = 0; i < tools.length; i++) {
    (function (tool) {
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "home-dock-tool" + (selected && tool.id === selected.id ? " active" : "");
      tab.dataset.dockToolId = tool.id;
      tab.innerHTML = renderToolIdentity(tool);
      tab.addEventListener("click", function () { activateTool(tool.id); });
      switcherEl.appendChild(tab);
    })(tools[i]);
  }
  if (backstageOpen) {
    contentEl.innerHTML = "";
    backstageView.render(contentEl, closeHomeBackstage);
    syncDockTrigger();
    refreshIcons();
    return;
  }
  if (libraryOpen) {
    if (mountedToolId) {
      var mounted = toolsById[mountedToolId];
      if (mounted && typeof mounted.onHide === "function") mounted.onHide();
    }
    mountedToolId = null;
    contentEl.innerHTML = "";
    renderHomeCapsuleLibrary(contentEl, store.get('installedTools') || [], openLibraryCapsule);
    syncDockTrigger();
    refreshIcons();
    return;
  }
  if (!selected) {
    contentEl.innerHTML = "";
    syncDockTrigger();
    return;
  }
  if (mountedToolId && mountedToolId !== selected.id) {
    var previous = toolsById[mountedToolId];
    if (previous && typeof previous.onHide === "function") previous.onHide();
  }
  mountedToolId = selected.id;
  contentEl.innerHTML = "";
  contextEl.hidden = false;
  selected.render(contentEl, contextEl);
  if (typeof selected.onShow === "function") selected.onShow();
  syncDockTrigger();
  refreshIcons();
}

export function initHomeDock() {
  if (initialized) return;
  initialized = true;
  initHomeDockResize();
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
    if (event.key !== "Escape" || !document.body.classList.contains("home-active")) return;
    if (hasVisibleEscapeLayer()) return;
    if (store.get('dockOpen') && store.get('dockBackstageOpen') && backstageView) {
      event.preventDefault();
      event.stopPropagation();
      closeHomeBackstage();
      return;
    }
    if (hasEditableEscapeTarget(event.target)) return;
    if (!store.get('dockFocus')) return;
    event.preventDefault();
    event.stopPropagation();
    returnHomeDockToSplit();
  }, true);
  syncDockState();
}
