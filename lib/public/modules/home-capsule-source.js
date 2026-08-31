import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';

var hosts = Object.create(null);
var sequence = 0;

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function nextRequestId(prefix) {
  sequence += 1;
  return prefix + "_" + Date.now() + "_" + sequence;
}

function setRuntimeVisible(host, visible) {
  var surfaces = host.root.querySelectorAll("[data-capsule-runtime-surface]");
  for (var i = 0; i < surfaces.length; i++) surfaces[i].hidden = !visible;
}

function setAccessStatus(host, text, error) {
  if (!host.accessStatus) return;
  host.accessStatus.textContent = text || "";
  host.accessStatus.classList.toggle("is-error", error === true);
}

function syncAccess(host, metadata) {
  if (!host.access) return;
  var allowed = host.definition.manifest.runtime === "worker" && !!(metadata && metadata.mateEditingAllowed === true);
  host.definition.metadata = { mateEditingAllowed: allowed };
  host.access.checked = allowed;
  host.access.disabled = host.definition.manifest.runtime !== "worker";
  host.access.setAttribute("aria-checked", allowed ? "true" : "false");
  host.access.setAttribute("aria-label", "Allow Mate editing for " + host.definition.manifest.name);
  setAccessStatus(host, allowed ? "On" : "Off", false);
}

function menuItems(host) {
  return host.menu ? host.menu.querySelectorAll('[role="menuitem"]') : [];
}

function removeMenuDocumentHandler(host) {
  if (!host.outsideMenuHandler) return;
  document.removeEventListener("pointerdown", host.outsideMenuHandler, true);
  host.outsideMenuHandler = null;
}

function closeActionsMenu(host, returnFocus) {
  if (!host || !host.menu) return;
  host.menu.hidden = true;
  host.actionsButton.setAttribute("aria-expanded", "false");
  removeMenuDocumentHandler(host);
  if (returnFocus && host.actionsButton.isConnected) host.actionsButton.focus({ preventScroll: true });
}

function openActionsMenu(host, focusFirst) {
  if (!host || !host.menu) return;
  var ids = Object.keys(hosts);
  for (var i = 0; i < ids.length; i++) {
    if (hosts[ids[i]] !== host) closeActionsMenu(hosts[ids[i]], false);
  }
  host.menu.hidden = false;
  host.actionsButton.setAttribute("aria-expanded", "true");
  removeMenuDocumentHandler(host);
  host.outsideMenuHandler = function (event) {
    if (host.toolbar.contains(event.target)) return;
    closeActionsMenu(host, false);
  };
  document.addEventListener("pointerdown", host.outsideMenuHandler, true);
  if (focusFirst) {
    var items = menuItems(host);
    if (items.length) items[0].focus({ preventScroll: true });
  }
}

function toggleActionsMenu(host) {
  if (host.menu.hidden) openActionsMenu(host, true);
  else closeActionsMenu(host, true);
}

function closeInspector(host) {
  if (!host || !host.inspector) return;
  host.inspector.remove();
  host.inspector = null;
  host.sourceRequestId = null;
  setRuntimeVisible(host, true);
  if (host.actionsButton && host.actionsButton.isConnected) host.actionsButton.focus({ preventScroll: true });
}

function createTab(label, index, host) {
  var tab = document.createElement("button");
  tab.type = "button";
  tab.className = "home-capsule-source-tab";
  tab.id = "home-capsule-source-tab-" + host.toolId + "-" + index;
  tab.setAttribute("role", "tab");
  tab.dataset.sourceIndex = String(index);
  tab.textContent = label;
  return tab;
}

export function highlightCapsuleSource(code, language, text) {
  code.className = "home-capsule-source-code language-" + language;
  code.removeAttribute("data-highlighted");
  code.textContent = text;
  var highlighter = typeof window !== "undefined" ? window.hljs : null;
  if (!highlighter || typeof highlighter.highlightElement !== "function") return false;
  if (typeof highlighter.getLanguage === "function" && !highlighter.getLanguage(language)) return false;
  try {
    highlighter.highlightElement(code);
    return true;
  } catch (error) {
    code.className = "home-capsule-source-code language-" + language;
    code.removeAttribute("data-highlighted");
    code.textContent = text;
    return false;
  }
}

function showSourcePanel(host, index) {
  var tabs = host.inspector.querySelectorAll('[role="tab"]');
  for (var i = 0; i < tabs.length; i++) {
    var selected = Number(tabs[i].dataset.sourceIndex) === index;
    tabs[i].setAttribute("aria-selected", selected ? "true" : "false");
    tabs[i].tabIndex = selected ? 0 : -1;
  }
  var source = host.source;
  var label = index === 0 ? "Manifest" : (index === 1 ? "UI" : "Logic");
  var language = index === 2 ? "javascript" : "json";
  var text;
  host.code.setAttribute("aria-label", label + " source");
  if (index === 0) text = JSON.stringify(source.manifest, null, 2);
  else if (index === 1) text = JSON.stringify(source.uiTree, null, 2);
  else if (source.logicAvailable) text = source.logicSource || "";
  else text = "Logic is server-managed and is not available as authored Capsule source.";
  highlightCapsuleSource(host.code, language, text);
}

function renderSource(host, source) {
  host.source = source;
  host.inspector.classList.remove("is-loading");
  host.loading.remove();
  var tablist = document.createElement("div");
  tablist.className = "home-capsule-source-tabs";
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Capsule source files");
  var labels = ["Manifest", "UI", "Logic"];
  for (var i = 0; i < labels.length; i++) {
    var tab = createTab(labels[i], i, host);
    tab.addEventListener("click", function (event) {
      showSourcePanel(host, Number(event.currentTarget.dataset.sourceIndex));
    });
    tablist.appendChild(tab);
  }
  var code = document.createElement("pre");
  code.className = "home-capsule-source-code";
  code.setAttribute("role", "region");
  code.tabIndex = 0;
  host.code = code;
  host.inspector.appendChild(tablist);
  host.inspector.appendChild(code);
  showSourcePanel(host, 0);
  tablist.firstElementChild.focus({ preventScroll: true });
}

function openInspector(host) {
  if (host.inspector) return;
  closeActionsMenu(host, false);
  var inspector = document.createElement("section");
  inspector.className = "home-capsule-source-inspector is-loading";
  inspector.setAttribute("aria-label", host.definition.manifest.name + " source inspector");
  var header = document.createElement("header");
  header.className = "home-capsule-source-header";
  var back = document.createElement("button");
  back.type = "button";
  back.className = "home-capsule-source-back";
  back.setAttribute("aria-label", "Return to Capsule");
  back.innerHTML = iconHtml("arrow-left") + '<span>Capsule</span>';
  back.addEventListener("click", function () { closeInspector(host); });
  header.appendChild(back);
  var title = document.createElement("div");
  title.className = "home-capsule-source-title";
  title.textContent = "Source · " + host.definition.manifest.name;
  header.appendChild(title);
  inspector.appendChild(header);
  var loading = document.createElement("p");
  loading.className = "home-capsule-source-loading";
  loading.textContent = "Loading source…";
  inspector.appendChild(loading);
  inspector.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeInspector(host);
      return;
    }
    if (!event.target || event.target.getAttribute("role") !== "tab") return;
    var tabs = inspector.querySelectorAll('[role="tab"]');
    var current = Number(event.target.dataset.sourceIndex);
    var next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    showSourcePanel(host, next);
    tabs[next].focus({ preventScroll: true });
  });
  host.inspector = inspector;
  host.loading = loading;
  host.root.appendChild(inspector);
  setRuntimeVisible(host, false);
  back.focus({ preventScroll: true });
  var requestId = nextRequestId("tool_source");
  host.sourceRequestId = requestId;
  if (!send({ type: "tool_source_get", toolId: host.toolId, requestId: requestId })) {
    loading.textContent = "Source is unavailable while Clay is disconnected.";
    inspector.classList.remove("is-loading");
  }
  refreshIcons();
}

export function mountCapsuleHostControls(toolId, definition, chromeRoot, contentRoot) {
  var toolbar = document.createElement("section");
  toolbar.className = "home-capsule-chrome-controls";
  toolbar.setAttribute("aria-label", definition.manifest.name + " Capsule controls");
  var host = { toolId: toolId, definition: definition, root: contentRoot, toolbar: toolbar, actionsButton: null, menu: null, outsideMenuHandler: null, access: null, accessStatus: null, inspector: null, sourceRequestId: null };
  hosts[toolId] = host;
  if (definition.manifest.runtime === "worker") {
    var permission = document.createElement("label");
    permission.className = "home-capsule-access";
    permission.title = "Allow Mates to inspect and propose edits to this Capsule source";
    var access = document.createElement("input");
    access.type = "checkbox";
    access.setAttribute("role", "switch");
    access.setAttribute("aria-describedby", "home-capsule-access-help-" + toolId);
    permission.appendChild(access);
    var copy = document.createElement("span");
    copy.className = "home-capsule-access-copy";
    var name = document.createElement("span");
    name.className = "home-capsule-access-name";
    name.textContent = "Allow Mate editing";
    copy.appendChild(name);
    var status = document.createElement("span");
    status.className = "home-capsule-access-status";
    status.setAttribute("aria-live", "polite");
    copy.appendChild(status);
    permission.appendChild(copy);
    var help = document.createElement("span");
    help.id = "home-capsule-access-help-" + toolId;
    help.className = "home-capsule-access-help";
    help.textContent = "Allows Mates to inspect and propose edits to this Capsule source.";
    permission.appendChild(help);
    toolbar.appendChild(permission);
    host.access = access;
    host.accessStatus = status;
    syncAccess(host, definition.metadata);
    access.addEventListener("change", function () {
      var confirmed = !!(host.definition.metadata && host.definition.metadata.mateEditingAllowed);
      var requested = access.checked === true;
      access.checked = confirmed;
      access.disabled = true;
      setAccessStatus(host, "Saving permission…", false);
      host.accessRequestId = nextRequestId("tool_access");
      if (!send({ type: "tool_mate_access_set", toolId: toolId, allowed: requested, requestId: host.accessRequestId })) {
        access.disabled = definition.manifest.runtime !== "worker";
        setAccessStatus(host, "Could not save while Clay is disconnected.", true);
      }
    });
  }
  var actionsButton = document.createElement("button");
  actionsButton.type = "button";
  actionsButton.className = "home-capsule-actions-trigger";
  actionsButton.setAttribute("aria-label", definition.manifest.name + " Capsule actions");
  actionsButton.setAttribute("aria-haspopup", "menu");
  actionsButton.setAttribute("aria-expanded", "false");
  actionsButton.title = "Capsule actions";
  actionsButton.innerHTML = iconHtml("ellipsis");
  toolbar.appendChild(actionsButton);
  var menu = document.createElement("div");
  menu.className = "home-capsule-actions-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", definition.manifest.name + " Capsule actions");
  menu.hidden = true;
  var sourceItem = document.createElement("button");
  sourceItem.type = "button";
  sourceItem.className = "home-capsule-actions-item";
  sourceItem.setAttribute("role", "menuitem");
  sourceItem.tabIndex = -1;
  sourceItem.innerHTML = iconHtml("file-code-2") + "<span>View source</span>";
  sourceItem.addEventListener("click", function () { openInspector(host); });
  menu.appendChild(sourceItem);
  toolbar.appendChild(menu);
  host.actionsButton = actionsButton;
  host.menu = menu;
  actionsButton.addEventListener("click", function () { toggleActionsMenu(host); });
  actionsButton.addEventListener("keydown", function (event) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    openActionsMenu(host, true);
  });
  menu.addEventListener("keydown", function (event) {
    var items = menuItems(host);
    if (!items.length) return;
    var current = Array.prototype.indexOf.call(items, event.target);
    var next = current;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current + items.length - 1) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeActionsMenu(host, true);
      return;
    } else return;
    event.preventDefault();
    items[next].focus({ preventScroll: true });
  });
  chromeRoot.appendChild(toolbar);
  refreshIcons();
  return toolbar;
}

export function disposeCapsuleHostControls(toolId) {
  var host = hosts[toolId];
  if (!host) return;
  closeActionsMenu(host, false);
  if (host.inspector) {
    host.inspector.remove();
    host.inspector = null;
    setRuntimeVisible(host, true);
  }
  delete hosts[toolId];
}

export function handleToolSourceState(msg) {
  var host = hosts[msg.toolId];
  if (!host || !host.inspector || host.sourceRequestId !== msg.requestId) return;
  if (!msg.ok) {
    host.loading.textContent = msg.error || "Could not read Capsule source.";
    host.inspector.classList.remove("is-loading");
    return;
  }
  renderSource(host, msg);
}

export function handleToolMateAccessState(msg) {
  var host = hosts[msg.toolId];
  if (!host || !host.access) return;
  if (!msg.ok) {
    host.access.disabled = host.definition.manifest.runtime !== "worker";
    host.access.checked = !!(host.definition.metadata && host.definition.metadata.mateEditingAllowed);
    setAccessStatus(host, msg.error || "Could not update Mate editing permission.", true);
    return;
  }
  syncAccess(host, msg.metadata);
}
