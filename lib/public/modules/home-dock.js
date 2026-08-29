// home-dock.js - Home tool dock registry and active tool rendering.

import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml } from './utils.js';

var tools = [];
var toolsById = Object.create(null);
var mountedToolId = null;
var pulseTimers = Object.create(null);

export function registerDockTool(tool) {
  if (!tool || !tool.id || !tool.name || typeof tool.render !== "function") return;
  if (toolsById[tool.id]) {
    var existingIndex = tools.indexOf(toolsById[tool.id]);
    if (existingIndex !== -1) tools[existingIndex] = tool;
  } else {
    tools.push(tool);
  }
  toolsById[tool.id] = tool;
}

export function unregisterDockTool(toolId) {
  var tool = toolsById[toolId];
  if (!tool) return;
  var wasMounted = mountedToolId === toolId;
  if (wasMounted && typeof tool.onHide === "function") tool.onHide();
  var index = tools.indexOf(tool);
  if (index !== -1) tools.splice(index, 1);
  delete toolsById[toolId];
  if (store.get('dockActiveToolId') === toolId) store.set({ dockActiveToolId: "board" });
  if (wasMounted) mountedToolId = null;
}

export function pulseDockTool(toolId) {
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

function renderToolIdentity(tool) {
  return '<span class="home-app-mark">' + iconHtml(tool.lucideIcon || "box") + '</span>'
    + '<span class="home-app-name">' + escapeHtml(tool.name) + '</span>';
}

function activateTool(toolId) {
  store.set({ dockActiveToolId: toolId });
  renderDock();
}

export function renderDock() {
  var switcherEl = document.getElementById("home-dock-switcher");
  var contentEl = document.getElementById("home-dock-content");
  if (!switcherEl || !contentEl || tools.length === 0) return;

  var activeId = store.get('dockActiveToolId') || "board";
  var activeTool = toolsById[activeId] || toolsById.board || tools[0];
  if (activeTool.id !== activeId) store.set({ dockActiveToolId: activeTool.id });
  if (mountedToolId && mountedToolId !== activeTool.id) {
    var previousTool = toolsById[mountedToolId];
    if (previousTool && typeof previousTool.onHide === "function") previousTool.onHide();
  }
  mountedToolId = activeTool.id;

  switcherEl.innerHTML = "";
  delete switcherEl.dataset.dockToolId;
  if (tools.length === 1) {
    switcherEl.className = "home-app-identity";
    switcherEl.dataset.dockToolId = activeTool.id;
    switcherEl.innerHTML = renderToolIdentity(activeTool);
  } else {
    switcherEl.className = "home-dock-switcher";
    for (var i = 0; i < tools.length; i++) {
      (function (tool) {
        var tab = document.createElement("button");
        tab.type = "button";
        tab.className = "home-dock-tool" + (tool.id === activeTool.id ? " active" : "");
        tab.dataset.dockToolId = tool.id;
        tab.innerHTML = renderToolIdentity(tool);
        tab.addEventListener("click", function () { activateTool(tool.id); });
        switcherEl.appendChild(tab);
      })(tools[i]);
    }
  }

  contentEl.innerHTML = "";
  activeTool.render(contentEl);
  if (typeof activeTool.onShow === "function") activeTool.onShow();
  refreshIcons();
}
