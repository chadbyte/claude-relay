// mcp-ui.js - MCP Servers modal (sidebar button + panel)
// Renders available MCP servers with per-project toggle checkboxes.

import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { setHttpMcpServers } from './app-misc.js';

var modal = null;
var contentEl = null;
var _mcpServers = []; // { name, transport, toolCount, extensionEnabled, projectEnabled }
var _extensionConnected = false;
var _nativeHostConnected = false;
var _extensionId = null;

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
  if (msg.hostConnected !== undefined) _nativeHostConnected = msg.hostConnected;
  if (msg.extensionId) _extensionId = msg.extensionId;

  // Update HTTP MCP server registry for direct fetch calls
  setHttpMcpServers(_mcpServers);

  // Update sidebar badge
  updateBadge();

  // Re-render if modal is open (skip during toggle cooldown)
  if (modal && !modal.classList.contains("hidden") && !_toggleCooldown) {
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
  var hasServers = available.length > 0;
  var allDone = _extensionConnected && _nativeHostConnected && hasServers;

  // --- All setup complete: skip wizard, show server list only ---
  if (allDone) {
    var desc = document.createElement("p");
    desc.className = "mcp-desc";
    desc.textContent = "Toggle which MCP servers this project can use.";
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
    refreshIcons(contentEl);
    return;
  }

  // --- Setup incomplete: show step wizard ---
  var steps = document.createElement("div");
  steps.className = "mcp-steps";

  // Step 1: Chrome Extension
  var step1Done = _extensionConnected;
  steps.appendChild(renderStep({
    num: 1,
    done: step1Done,
    title: "Install Chrome Extension",
    desc: step1Done
      ? "Connected"
      : "Required to bridge your browser with Clay.",
    action: step1Done ? null : {
      label: "Setup Extension",
      icon: "puzzle",
      onClick: function () {
        closeMcpModal();
        setTimeout(function () {
          var extPill = document.getElementById("ext-pill");
          if (extPill) extPill.click();
        }, 100);
      }
    }
  }));

  // Step 2: Native Host (only needed for remote users)
  var step2Done = _extensionConnected && _nativeHostConnected;
  var installCmd = _extensionId
    ? "npx clay-mcp-bridge install " + _extensionId
    : "npx clay-mcp-bridge install <extension-id>";
  steps.appendChild(renderStep({
    num: 2,
    done: step2Done,
    title: "Install MCP Bridge",
    desc: step2Done
      ? "Connected"
      : "Run in your terminal, then restart your browser.",
    disabled: !step1Done,
    copyCmd: (!step2Done && step1Done) ? installCmd : null
  }));

  // Step 3: Configure MCP Servers
  var step3Done = hasServers;
  var step3Desc = "";
  if (step3Done) {
    step3Desc = available.length + " server" + (available.length === 1 ? "" : "s") + " enabled";
  } else if (step2Done) {
    step3Desc = "Add servers from the Clay Chrome Extension popup using the + button, or import an existing config file.";
  } else {
    step3Desc = "Configure after installing the bridge.";
  }
  steps.appendChild(renderStep({
    num: 3,
    done: step3Done,
    title: "Add MCP Servers",
    desc: step3Desc,
    disabled: !step2Done,
    action: (!step3Done && step2Done) ? {
      label: "Open Extension popup to add servers",
      icon: "puzzle",
      onClick: function () {
        closeMcpModal();
        setTimeout(function () {
          var extPill = document.getElementById("ext-pill");
          if (extPill) extPill.click();
        }, 100);
      }
    } : null
  }));

  contentEl.appendChild(steps);
  refreshIcons(contentEl);
}

function renderStep(opts) {
  var el = document.createElement("div");
  el.className = "mcp-step" + (opts.done ? " done" : "") + (opts.disabled ? " disabled" : "");

  var icon = opts.done ? "check-circle-2" : "circle";
  var iconClass = opts.done ? "mcp-step-icon done" : "mcp-step-icon";

  var html = '<div class="' + iconClass + '"><i data-lucide="' + icon + '"></i></div>'
    + '<div class="mcp-step-body">'
    + '<div class="mcp-step-title">' + opts.title + '</div>'
    + '<div class="mcp-step-desc">' + opts.desc + '</div>';

  if (opts.copyCmd) {
    html += '<div class="mcp-install-cmd-row">'
      + '<code class="mcp-install-cmd">' + opts.copyCmd + '</code>'
      + '<button class="mcp-install-copy-btn" type="button"><i data-lucide="copy"></i></button>'
      + '</div>';
  }

  html += '</div>';
  el.innerHTML = html;

  if (opts.action && !opts.disabled) {
    var btn = document.createElement("button");
    btn.className = "mcp-ext-setup-btn";
    btn.type = "button";
    btn.innerHTML = '<i data-lucide="' + opts.action.icon + '"></i> ' + opts.action.label;
    btn.addEventListener("click", opts.action.onClick);
    el.querySelector(".mcp-step-body").appendChild(btn);
  }

  if (opts.copyCmd) {
    var copyBtn = el.querySelector(".mcp-install-copy-btn");
    copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText(opts.copyCmd).then(function () {
        copyBtn.innerHTML = '<i data-lucide="check"></i>';
        refreshIcons(copyBtn);
        setTimeout(function () {
          copyBtn.innerHTML = '<i data-lucide="copy"></i>';
          refreshIcons(copyBtn);
        }, 1500);
      });
    });
  }

  return el;
}

var _toggleCooldown = false;

function onToggle(e) {
  var name = e.target.dataset.serverName;
  var enabled = e.target.checked;

  // Optimistic update: apply locally so incoming broadcasts don't revert
  for (var i = 0; i < _mcpServers.length; i++) {
    if (_mcpServers[i].name === name) {
      _mcpServers[i].projectEnabled = enabled;
      break;
    }
  }

  // Suppress re-renders from broadcasts for a short window
  _toggleCooldown = true;
  setTimeout(function () { _toggleCooldown = false; }, 1000);

  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: "mcp_toggle_server",
      name: name,
      enabled: enabled,
    }));
  }
}
