// Searchable projection of every user-owned Mate conversation loaded by Home.

import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { getHomeSessionConversations, createHomeSessionActionsTrigger, disposeHomeSessionActionsMenu } from './home-session-actions.js';
import { buildSessionHierarchy } from './session-hierarchy.js';

var overlay = null;
var searchInput = null;
var listEl = null;
var sheetOpener = null;
var selectConversation = null;
var hierarchyExpansion = new Map();

function closeSheet(restoreFocus) {
  if (!overlay) return;
  var opener = sheetOpener;
  disposeHomeSessionActionsMenu();
  overlay.remove();
  overlay = null;
  searchInput = null;
  listEl = null;
  sheetOpener = null;
  selectConversation = null;
  document.removeEventListener("keydown", handleKeydown, true);
  if (restoreFocus !== false && opener && document.contains(opener) && typeof opener.focus === "function") opener.focus();
}

function focusableElements() {
  if (!overlay) return [];
  return Array.prototype.slice.call(overlay.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeSheet();
    return;
  }
  if (event.key !== "Tab") return;
  var focusable = focusableElements();
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  var first = focusable[0];
  var last = focusable[focusable.length - 1];
  var active = document.activeElement;
  if (event.shiftKey && (active === first || !overlay.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !overlay.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function conversationMatches(conversation, query) {
  if (!query) return true;
  return conversation.title.toLowerCase().indexOf(query) !== -1 || conversation.mateName.toLowerCase().indexOf(query) !== -1;
}

function createSheetItem(conversation, worker) {
  var item = document.createElement("div");
  item.className = "home-conversations-sheet-item" + (worker ? " home-conversations-worker-item" : "");
  var row = document.createElement("button");
  row.type = "button";
  row.className = "home-conversations-sheet-row";
  var copy = document.createElement("span");
  copy.className = "home-conversations-sheet-copy";
  var title = document.createElement("span");
  title.className = "home-conversations-sheet-row-title";
  title.textContent = conversation.title;
  copy.appendChild(title);
  var mate = document.createElement("span");
  mate.className = "home-conversations-sheet-row-mate";
  mate.textContent = worker && conversation.workerGeneration ? conversation.mateName + " · Worker generation " + conversation.workerGeneration : conversation.mateName;
  copy.appendChild(mate);
  row.appendChild(copy);
  if (conversation.isProcessing) {
    var activity = document.createElement("span");
    activity.className = "home-sidebar-processing";
    activity.setAttribute("aria-label", "Processing");
    row.appendChild(activity);
  }
  row.addEventListener("click", function () {
    var onSelect = selectConversation;
    closeSheet();
    if (onSelect) onSelect(conversation.mateId, conversation.sessionId);
  });
  var active = conversation.mateId === store.get('homeChatMateId') && conversation.sessionId === store.get('homeChatSessionId');
  if (active) {
    item.classList.add("is-active");
    row.setAttribute("aria-current", "page");
  }
  var detailsReturn = sheetOpener;
  var actions = createHomeSessionActionsTrigger(conversation, {
    detailsOpener: detailsReturn,
    beforeOpenDetails: function () { closeSheet(false); },
  });
  item.appendChild(row);
  item.appendChild(actions);
  return item;
}

function createSheetHierarchy(root, query) {
  if (!root.workers.length) return createSheetItem(root.driver, false);
  var key = root.driver.hierarchyId;
  var expanded = hierarchyExpansion.has(key) ? hierarchyExpansion.get(key) : !!query;
  for (var ai = 0; ai < root.workers.length; ai++) {
    if (root.workers[ai].mateId === store.get('homeChatMateId') && root.workers[ai].sessionId === store.get('homeChatSessionId')) expanded = true;
  }
  var wrapper = document.createElement("div");
  wrapper.className = "home-conversations-driver-hierarchy";
  var header = document.createElement("div");
  header.className = "home-conversations-driver-header";
  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "home-conversations-driver-toggle";
  var childrenId = "home-sheet-workers-" + String(key).replace(/[^a-zA-Z0-9_-]/g, "-");
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-controls", childrenId);
  toggle.setAttribute("aria-label", (expanded ? "Collapse" : "Expand") + " Workers for " + (root.driver.title || "Unavailable Driver"));
  toggle.innerHTML = iconHtml("chevron-right");
  if (!root.driver.sessionId) toggle.insertAdjacentHTML("beforeend", "<span>Unavailable Driver</span><span>" + root.workers.length + "</span>");
  toggle.addEventListener("click", function () {
    hierarchyExpansion.set(key, !expanded);
    renderRows();
  });
  header.appendChild(toggle);
  if (root.driver.sessionId) header.appendChild(createSheetItem(root.driver, false));
  wrapper.appendChild(header);
  var children = document.createElement("div");
  children.id = childrenId;
  children.className = "home-conversations-worker-children";
  children.setAttribute("role", "group");
  children.setAttribute("aria-label", "Workers for " + (root.driver.title || "Unavailable Driver"));
  children.hidden = !expanded;
  var driverMatched = root.driver.sessionId && conversationMatches(root.driver, query);
  for (var i = 0; i < root.workers.length; i++) {
    if (!query || driverMatched || conversationMatches(root.workers[i], query)) children.appendChild(createSheetItem(root.workers[i], true));
  }
  wrapper.appendChild(children);
  return wrapper;
}

function renderRows() {
  if (!listEl) return;
  var query = searchInput ? searchInput.value.trim().toLowerCase() : "";
  var hierarchy = buildSessionHierarchy(getHomeSessionConversations());
  var roots = hierarchy.roots.filter(function (root) {
    if (conversationMatches(root.driver, query)) return true;
    for (var i = 0; i < root.workers.length; i++) if (conversationMatches(root.workers[i], query)) return true;
    return false;
  });
  var orphans = hierarchy.orphans.filter(function (worker) { return conversationMatches(worker, query); });
  disposeHomeSessionActionsMenu();
  listEl.innerHTML = "";
  if (!roots.length && !orphans.length) {
    var empty = document.createElement("div");
    empty.className = "home-conversations-sheet-empty";
    empty.textContent = query ? "No chats match your search." : "No chats yet.";
    listEl.appendChild(empty);
    return;
  }
  roots.sort(function (a, b) { return b.lastActivity - a.lastActivity; });
  for (var i = 0; i < roots.length; i++) listEl.appendChild(createSheetHierarchy(roots[i], query));
  if (orphans.length) listEl.appendChild(createSheetHierarchy({ driver: { hierarchyId: "orphan-sheet", title: "Unavailable Driver" }, workers: orphans }, query));
  refreshIcons();
}

export function openHomeConversationsSheet(onSelect, opener) {
  closeSheet();
  sheetOpener = opener || document.activeElement;
  selectConversation = onSelect;
  overlay = document.createElement("div");
  overlay.className = "home-conversations-sheet";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "home-conversations-sheet-title");

  var backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "home-conversations-sheet-backdrop";
  backdrop.setAttribute("aria-label", "Close chats");
  backdrop.tabIndex = -1;
  backdrop.addEventListener("click", closeSheet);
  overlay.appendChild(backdrop);

  var panel = document.createElement("section");
  panel.className = "home-conversations-sheet-panel";
  var header = document.createElement("header");
  header.className = "home-conversations-sheet-header";
  var title = document.createElement("div");
  title.id = "home-conversations-sheet-title";
  title.className = "home-conversations-sheet-title";
  title.textContent = "All chats";
  header.appendChild(title);
  var close = document.createElement("button");
  close.type = "button";
  close.className = "home-sidebar-icon-btn";
  close.setAttribute("aria-label", "Close chats");
  close.innerHTML = iconHtml("x");
  close.addEventListener("click", closeSheet);
  header.appendChild(close);
  panel.appendChild(header);

  var search = document.createElement("label");
  search.className = "home-conversations-sheet-search";
  search.innerHTML = iconHtml("search");
  searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search chats";
  searchInput.setAttribute("aria-label", "Search chats");
  searchInput.addEventListener("input", renderRows);
  search.appendChild(searchInput);
  panel.appendChild(search);

  listEl = document.createElement("div");
  listEl.className = "home-conversations-sheet-list";
  panel.appendChild(listEl);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", handleKeydown, true);
  renderRows();
  refreshIcons();
  searchInput.focus();
}

export function refreshHomeConversationsSheet() {
  if (overlay) renderRows();
}
