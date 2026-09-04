// Complete Home chat archive rendered as provenance-preserving session trees.

import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { getHomeSessionConversations, createHomeSessionActionsTrigger, disposeHomeSessionActionsMenu } from './home-session-actions.js';
import { buildSessionHierarchy } from './session-hierarchy.js';

var expansion = new Map();

function isExpanded(key, workers) {
  if (expansion.has(key)) return expansion.get(key);
  for (var i = 0; i < workers.length; i++) {
    if (workers[i].mateId === store.get('homeChatMateId') && workers[i].sessionId === store.get('homeChatSessionId')) return true;
  }
  return false;
}

function createChatItem(chat, openConversation, worker) {
  var item = document.createElement("div");
  item.className = "home-sidebar-recent-item" + (worker ? " home-sidebar-worker-item" : "");
  var row = document.createElement("button");
  row.type = "button";
  row.className = "home-sidebar-recent-row";
  row.setAttribute("aria-label", chat.title + ", with " + chat.mateName);
  if (chat.mateId === store.get('homeChatMateId') && chat.sessionId === store.get('homeChatSessionId')) {
    item.classList.add("is-active");
    row.setAttribute("aria-current", "page");
  }
  var copy = document.createElement("span");
  copy.className = "home-sidebar-recent-copy";
  var title = document.createElement("span");
  title.className = "home-sidebar-recent-title";
  title.textContent = chat.title;
  var mate = document.createElement("span");
  mate.className = "home-sidebar-recent-mate";
  mate.textContent = worker && chat.workerGeneration ? chat.mateName + " · Worker generation " + chat.workerGeneration : chat.mateName;
  copy.appendChild(title);
  copy.appendChild(mate);
  row.appendChild(copy);
  if (chat.isProcessing) {
    var activity = document.createElement("span");
    activity.className = "home-sidebar-processing";
    activity.setAttribute("aria-label", "Processing");
    row.appendChild(activity);
  }
  row.addEventListener("click", function () {
    if (typeof openConversation === "function") openConversation(chat.mateId, chat.sessionId);
  });
  item.appendChild(row);
  item.appendChild(createHomeSessionActionsTrigger(chat));
  return item;
}

function createHierarchy(root, openConversation) {
  if (!root.workers.length) return createChatItem(root.driver, openConversation, false);
  var wrapper = document.createElement("div");
  wrapper.className = "home-sidebar-driver-hierarchy";
  var key = root.driver.hierarchyId;
  var expanded = isExpanded(key, root.workers);
  var childrenId = "home-sidebar-workers-" + String(key).replace(/[^a-zA-Z0-9_-]/g, "-");
  var header = document.createElement("div");
  header.className = "home-sidebar-driver-header";
  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "home-sidebar-driver-toggle";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-controls", childrenId);
  toggle.setAttribute("aria-label", (expanded ? "Collapse" : "Expand") + " Workers for " + (root.driver.title || "Unavailable Driver"));
  toggle.innerHTML = iconHtml("chevron-right");
  toggle.addEventListener("click", function () {
    expansion.set(key, !expanded);
    renderHomeSidebarChats(openConversation);
  });
  header.appendChild(toggle);
  if (root.driver.sessionId) header.appendChild(createChatItem(root.driver, openConversation, false));
  wrapper.appendChild(header);
  var children = document.createElement("div");
  children.id = childrenId;
  children.className = "home-sidebar-worker-children";
  children.setAttribute("role", "group");
  children.setAttribute("aria-label", "Workers for " + (root.driver.title || "Unavailable Driver"));
  children.hidden = !expanded;
  for (var i = 0; i < root.workers.length; i++) children.appendChild(createChatItem(root.workers[i], openConversation, true));
  wrapper.appendChild(children);
  return wrapper;
}

function createOrphans(workers, openConversation) {
  var wrapper = createHierarchy({ driver: { hierarchyId: "orphan-home", title: "Unavailable Driver" }, workers: workers }, openConversation);
  var toggle = wrapper.querySelector(".home-sidebar-driver-toggle");
  toggle.classList.add("home-sidebar-orphan-toggle");
  toggle.setAttribute("aria-label", "Toggle Workers whose Driver is unavailable");
  toggle.insertAdjacentHTML("beforeend", "<span>Unavailable Driver</span><span>" + workers.length + "</span>");
  return wrapper;
}

export function renderHomeSidebarChats(openConversation) {
  var list = document.getElementById("home-sidebar-recent-list");
  if (!list) return 0;
  disposeHomeSessionActionsMenu();
  list.innerHTML = "";
  var chats = getHomeSessionConversations();
  var scope = store.get('homeChatScope') === "current" ? "current" : "all";
  var activeMateId = store.get('homeChatMateId');
  if (scope === "current") chats = chats.filter(function (chat) { return chat.mateId === activeMateId; });
  if (!chats.length) {
    var empty = document.createElement("div");
    empty.className = "home-sidebar-recent-empty";
    empty.textContent = scope === "current" ? "No chats with this Mate yet." : "Chats will appear here.";
    list.appendChild(empty);
    return 0;
  }
  var hierarchy = buildSessionHierarchy(chats);
  var hasHierarchy = hierarchy.orphans.length > 0;
  hierarchy.roots.sort(function (a, b) { return b.lastActivity - a.lastActivity; });
  for (var i = 0; i < hierarchy.roots.length; i++) {
    if (hierarchy.roots[i].workers.length) hasHierarchy = true;
    list.appendChild(createHierarchy(hierarchy.roots[i], openConversation));
  }
  if (hierarchy.orphans.length) list.appendChild(createOrphans(hierarchy.orphans, openConversation));
  if (hasHierarchy) refreshIcons();
  return chats.length;
}
