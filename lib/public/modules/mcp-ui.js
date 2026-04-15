// mcp-ui.js - MCP Servers modal (sidebar button + panel)
// Renders available MCP servers with per-project toggle checkboxes.

import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { setHttpMcpServers } from './app-misc.js';

var modal = null;
var contentEl = null;
var _mcpServers = []; // { name, transport, toolCount, extensionEnabled, projectEnabled }
var _extensionConnected = false;

export function initMcp() {
  modal = document.getElementById("mcp-modal");
  contentEl = document.getElementById("mcp-content");

  var btn = document.getElementById("mcp-btn");
  var mateBtn = document.getElementById("mate-mcp-btn");
  var closeBtn = document.getElementById("mcp-modal-close");
  var backdrop = modal ? modal.querySelector(".confirm-backdrop") : null;

  if (btn) btn.addEventListener("click", openMcpModal);
  if (mateBtn) mateBtn.addEventListener("click", openMcpModal);
  if (closeBtn) closeBtn.addEventListener("click", closeMcpModal);
  if (backdrop) backdrop.addEventListener("click", closeMcpModal);

  // ESC to close
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      closeMcpModal();
    }
  });
}

export function handleMcpServersState(msg) {
  _mcpServers = msg.servers || [];
  _extensionConnected = true;

  // Update HTTP MCP server registry for direct fetch calls
  setHttpMcpServers(_mcpServers);

  // Update sidebar badge
  updateBadge();

  // Re-render if modal is open
  if (modal && !modal.classList.contains("hidden")) {
    renderMcpServerList();
  }
}

export function setExtensionConnected(connected) {
  _extensionConnected = connected;
}

export function getMcpServers() {
  return _mcpServers;
}

function openMcpModal() {
  if (!modal) return;
  modal.classList.remove("hidden");
  refreshIcons(modal);
  renderMcpServerList();
}

function closeMcpModal() {
  if (!modal) return;
  modal.classList.add("hidden");
}

function updateBadge() {
  var enabled = 0;
  for (var i = 0; i < _mcpServers.length; i++) {
    if (_mcpServers[i].extensionEnabled && _mcpServers[i].projectEnabled) enabled++;
  }

  var badges = [
    document.getElementById("mcp-sidebar-count"),
    document.getElementById("mate-mcp-sidebar-count"),
  ];
  for (var j = 0; j < badges.length; j++) {
    var badge = badges[j];
    if (!badge) continue;
    if (enabled > 0) {
      badge.textContent = String(enabled);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
}

function renderMcpServerList() {
  if (!contentEl) return;
  contentEl.innerHTML = "";

  var available = _mcpServers.filter(function (s) { return s.extensionEnabled; });

  if (!_extensionConnected) {
    var extNotice = document.createElement("div");
    extNotice.className = "mcp-empty";
    extNotice.innerHTML = '<i data-lucide="puzzle"></i>'
      + '<p class="mcp-empty-title">Chrome Extension required</p>'
      + '<p class="mcp-empty-desc">Install and connect the Clay Chrome Extension to use MCP servers.</p>'
      + '<button class="mcp-ext-setup-btn" type="button"><i data-lucide="puzzle"></i> Setup Extension</button>';
    var setupBtn = extNotice.querySelector(".mcp-ext-setup-btn");
    setupBtn.addEventListener("click", function () {
      closeMcpModal();
      var extPill = document.getElementById("ext-pill");
      if (extPill) extPill.click();
    });
    contentEl.appendChild(extNotice);
    refreshIcons(contentEl);
    return;
  }

  if (available.length === 0) {
    var empty = document.createElement("div");
    empty.className = "mcp-empty";
    empty.innerHTML = '<i data-lucide="cable"></i>'
      + '<p class="mcp-empty-title">No MCP servers detected</p>'
      + '<p class="mcp-empty-desc">Configure MCP servers in the Clay Chrome Extension, then toggle them here for this project.</p>';
    contentEl.appendChild(empty);
    refreshIcons(contentEl);
    return;
  }

  var desc = document.createElement("p");
  desc.className = "mcp-desc";
  desc.textContent = "Toggle which MCP servers this project can use. Servers are managed in the Chrome Extension.";
  contentEl.appendChild(desc);

  for (var i = 0; i < available.length; i++) {
    var server = available[i];
    var row = document.createElement("label");
    row.className = "mcp-server-row";

    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = server.projectEnabled;
    cb.dataset.serverName = server.name;
    cb.addEventListener("change", onToggle);

    var info = document.createElement("div");
    info.className = "mcp-server-info";

    var nameSpan = document.createElement("span");
    nameSpan.className = "mcp-server-name";
    nameSpan.textContent = server.name;

    var meta = document.createElement("span");
    meta.className = "mcp-server-meta";
    meta.textContent = server.toolCount + " tool" + (server.toolCount === 1 ? "" : "s");
    if (server.transport === "http") meta.textContent += "  \u00B7  HTTP";

    info.appendChild(nameSpan);
    info.appendChild(meta);

    row.appendChild(cb);
    row.appendChild(info);
    contentEl.appendChild(row);
  }
}

function onToggle(e) {
  var name = e.target.dataset.serverName;
  var enabled = e.target.checked;
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: "mcp_toggle_server",
      name: name,
      enabled: enabled,
    }));
  }
}
