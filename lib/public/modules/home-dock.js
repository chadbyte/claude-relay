// home-dock.js - Home tool dock registry and active tool rendering.

import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml } from './utils.js';

var tools = [];
var toolsById = Object.create(null);

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

  switcherEl.innerHTML = "";
  if (tools.length === 1) {
    switcherEl.className = "home-app-identity";
    switcherEl.innerHTML = renderToolIdentity(activeTool);
  } else {
    switcherEl.className = "home-dock-switcher";
    for (var i = 0; i < tools.length; i++) {
      (function (tool) {
        var tab = document.createElement("button");
        tab.type = "button";
        tab.className = "home-dock-tool" + (tool.id === activeTool.id ? " active" : "");
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
