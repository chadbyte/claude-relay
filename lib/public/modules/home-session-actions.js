// Home conversation row actions and server-authoritative details dialog.

import { store } from './store.js';
import { copyToClipboard } from './utils.js';

var menu = null;
var menuTrigger = null;
var detailsOverlay = null;
var detailsOpener = null;
var detailsKey = null;
var detailsConversation = null;
var copyTimers = [];

function mateNames() {
  var result = {};
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) {
    if (!mates[i] || mates[i].archived) continue;
    var profile = mates[i].profile || {};
    result[mates[i].id] = profile.displayName || mates[i].displayName || mates[i].name || "Mate";
  }
  return result;
}

function safeText(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

function conversationKey(conversation) {
  var identity = conversation.localId != null ? "local:" + conversation.localId : conversation.sessionId;
  return conversation.mateId + ":" + identity;
}

export function getHomeSessionConversations() {
  var byMate = store.get('homeMateSessions') || {};
  var names = mateNames();
  var mateIds = Object.keys(byMate);
  var result = [];
  for (var i = 0; i < mateIds.length; i++) {
    if (!names[mateIds[i]]) continue;
    var sessions = Array.isArray(byMate[mateIds[i]]) ? byMate[mateIds[i]] : [];
    for (var j = 0; j < sessions.length; j++) {
      if (!sessions[j] || typeof sessions[j].id !== "string" || !sessions[j].id) continue;
      result.push({
        mateId: mateIds[i],
        mateName: names[mateIds[i]],
        sessionId: sessions[j].id,
        cliSessionId: safeText(sessions[j].cliSessionId, null),
        localId: sessions[j].localId != null ? sessions[j].localId : null,
        title: safeText(sessions[j].title, "New conversation"),
        vendor: safeText(sessions[j].vendor, null),
        model: safeText(sessions[j].model, null),
        createdAt: typeof sessions[j].createdAt === "number" ? sessions[j].createdAt : 0,
        lastActivity: typeof sessions[j].lastActivity === "number" ? sessions[j].lastActivity : 0,
        isProcessing: sessions[j].isProcessing === true,
        sessionRole: sessions[j].sessionRole === "worker" ? "worker" : "driver",
        parentSessionId: safeText(sessions[j].parentSessionId, null),
        parentAvailable: sessions[j].parentAvailable === true,
        workerGeneration: typeof sessions[j].workerGeneration === "number" ? sessions[j].workerGeneration : null,
        hierarchyId: mateIds[i] + ":" + sessions[j].id,
        parentHierarchyId: sessions[j].parentSessionId ? mateIds[i] + ":" + sessions[j].parentSessionId : null,
      });
    }
  }
  result.sort(function (a, b) { return b.lastActivity - a.lastActivity; });
  return result;
}

function findConversation(key) {
  var conversations = getHomeSessionConversations();
  for (var i = 0; i < conversations.length; i++) {
    if (conversationKey(conversations[i]) === key) return conversations[i];
  }
  return null;
}

function menuItems() {
  return menu ? menu.querySelectorAll('[role="menuitem"]') : [];
}

function positionMenu() {
  if (!menu || !menuTrigger || !menuTrigger.isConnected) return;
  var rect = menuTrigger.getBoundingClientRect();
  var menuRect = menu.getBoundingClientRect();
  var left = Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, rect.right - menuRect.width));
  var top = rect.bottom + 5;
  if (top + menuRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - menuRect.height - 5);
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function closeMenu(returnFocus) {
  var trigger = menuTrigger;
  if (menu) menu.remove();
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  menu = null;
  menuTrigger = null;
  document.removeEventListener("pointerdown", handleMenuOutside, true);
  document.removeEventListener("keydown", handleMenuKeydown, true);
  window.removeEventListener("resize", handleViewportChange);
  window.removeEventListener("scroll", handleViewportChange, true);
  if (returnFocus && trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
}

function handleViewportChange() {
  closeMenu(false);
}

function handleMenuOutside(event) {
  if (menu && !menu.contains(event.target) && event.target !== menuTrigger) closeMenu(false);
}

function handleMenuKeydown(event) {
  if (!menu) return;
  var items = menuItems();
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  var current = Array.prototype.indexOf.call(items, document.activeElement);
  var next = 0;
  if (event.key === "End") next = items.length - 1;
  else if (event.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
  else if (event.key === "ArrowDown") next = current < 0 || current === items.length - 1 ? 0 : current + 1;
  if (items[next]) items[next].focus({ preventScroll: true });
}

function openMenu(trigger, conversation, options) {
  closeMenu(false);
  menuTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  menu = document.createElement("div");
  menu.className = "home-session-actions-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Actions for " + conversation.title);
  var details = document.createElement("button");
  details.type = "button";
  details.className = "home-session-actions-menu-item";
  details.setAttribute("role", "menuitem");
  details.textContent = "View details";
  details.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    var opener = options && options.detailsOpener ? options.detailsOpener : trigger;
    closeMenu(false);
    if (options && options.beforeOpenDetails) options.beforeOpenDetails();
    openHomeSessionDetails(conversation, opener);
  });
  menu.appendChild(details);
  document.body.appendChild(menu);
  requestAnimationFrame(function () {
    positionMenu();
    details.focus({ preventScroll: true });
  });
  document.addEventListener("pointerdown", handleMenuOutside, true);
  document.addEventListener("keydown", handleMenuKeydown, true);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
}

export function createHomeSessionActionsTrigger(conversation, options) {
  var trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "home-session-actions-trigger";
  trigger.setAttribute("aria-label", "Conversation actions for " + conversation.title);
  trigger.setAttribute("title", "Conversation actions");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = '<span class="home-session-actions-mark" aria-hidden="true">•••</span>';
  trigger.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (menu && menuTrigger === trigger) closeMenu(false);
    else openMenu(trigger, conversation, options || {});
  });
  trigger.addEventListener("keydown", function (event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(trigger, conversation, options || {});
    requestAnimationFrame(function () {
      var items = menuItems();
      if (!items.length) return;
      items[event.key === "ArrowUp" || event.key === "End" ? items.length - 1 : 0].focus({ preventScroll: true });
    });
  });
  return trigger;
}

export function disposeHomeSessionActionsMenu() {
  closeMenu(false);
}

function formatTime(value) {
  if (!value) return "Not available";
  var date = new Date(value);
  if (isNaN(date.getTime())) return "Not available";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function clearCopyTimers() {
  for (var i = 0; i < copyTimers.length; i++) clearTimeout(copyTimers[i]);
  copyTimers = [];
}

function addDetailField(list, label, value, copyValue, copyKey) {
  var row = document.createElement("div");
  row.className = "home-session-details-field";
  var term = document.createElement("dt");
  term.textContent = label;
  var description = document.createElement("dd");
  var text = document.createElement("span");
  text.textContent = value;
  if (copyKey) text.className = "home-session-details-id";
  description.appendChild(text);
  if (copyValue) {
    var copy = document.createElement("button");
    copy.type = "button";
    copy.className = "home-session-details-copy";
    copy.dataset.homeSessionCopy = copyKey;
    copy.setAttribute("aria-label", "Copy " + label);
    copy.textContent = "Copy";
    copy.addEventListener("click", function () {
      copyToClipboard(copyValue).then(function () {
        copy.textContent = "Copied";
        var timer = setTimeout(function () { if (copy.isConnected) copy.textContent = "Copy"; }, 1200);
        copyTimers.push(timer);
      }).catch(function () {
        copy.textContent = "Copy failed";
      });
    });
    description.appendChild(copy);
  }
  row.appendChild(term);
  row.appendChild(description);
  list.appendChild(row);
}

function renderDetails() {
  if (!detailsOverlay || !detailsConversation) return;
  var body = detailsOverlay.querySelector(".home-session-details-body");
  if (!body) return;
  body.innerHTML = "";
  var summary = document.createElement("div");
  summary.className = "home-session-details-summary";
  var title = document.createElement("h3");
  title.textContent = detailsConversation.title;
  var mate = document.createElement("p");
  mate.textContent = "Conversation with " + detailsConversation.mateName;
  summary.appendChild(title);
  summary.appendChild(mate);
  body.appendChild(summary);
  var list = document.createElement("dl");
  list.className = "home-session-details-list";
  addDetailField(list, "Status", detailsConversation.isProcessing ? "Working" : "Ready");
  addDetailField(list, "Provider", detailsConversation.vendor || "Not available");
  addDetailField(list, "Model", detailsConversation.model || "Not available");
  addDetailField(list, "Created", formatTime(detailsConversation.createdAt));
  addDetailField(list, "Last activity", formatTime(detailsConversation.lastActivity));
  addDetailField(list, "Session reference", detailsConversation.sessionId, detailsConversation.sessionId, "reference");
  if (detailsConversation.cliSessionId) {
    addDetailField(list, "Session ID", detailsConversation.cliSessionId, detailsConversation.cliSessionId, "session-id");
  } else {
    addDetailField(list, "Session ID", "Not assigned yet — this conversation is still local.");
  }
  var localId = detailsConversation.localId == null ? "Not available" : String(detailsConversation.localId);
  addDetailField(list, "Local ID", localId, detailsConversation.localId == null ? null : localId, "local-id");
  body.appendChild(list);
}

function focusableDetails() {
  return detailsOverlay ? detailsOverlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') : [];
}

function handleDetailsKeydown(event) {
  if (!detailsOverlay) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeHomeSessionDetails();
    return;
  }
  if (event.key !== "Tab") return;
  var focusable = focusableDetails();
  if (!focusable.length) return;
  var first = focusable[0];
  var last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !detailsOverlay.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !detailsOverlay.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

export function closeHomeSessionDetails() {
  var opener = detailsOpener;
  clearCopyTimers();
  if (detailsOverlay) detailsOverlay.remove();
  detailsOverlay = null;
  detailsOpener = null;
  detailsKey = null;
  detailsConversation = null;
  document.removeEventListener("keydown", handleDetailsKeydown, true);
  document.body.classList.remove("home-session-details-open");
  if (opener && opener.isConnected) opener.focus({ preventScroll: true });
}

export function openHomeSessionDetails(conversation, opener) {
  if (!conversation || !conversation.mateId || !conversation.sessionId) return false;
  closeHomeSessionDetails();
  detailsConversation = conversation;
  detailsKey = conversationKey(conversation);
  detailsOpener = opener || document.activeElement;
  var overlay = document.createElement("div");
  overlay.className = "home-session-details-overlay";
  var dialog = document.createElement("section");
  dialog.className = "home-session-details-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "home-session-details-title");
  var header = document.createElement("header");
  header.className = "home-session-details-header";
  var title = document.createElement("h2");
  title.id = "home-session-details-title";
  title.textContent = "Conversation details";
  var close = document.createElement("button");
  close.type = "button";
  close.className = "home-session-details-close";
  close.setAttribute("aria-label", "Close conversation details");
  close.textContent = "×";
  close.addEventListener("click", closeHomeSessionDetails);
  header.appendChild(title);
  header.appendChild(close);
  var body = document.createElement("div");
  body.className = "home-session-details-body";
  dialog.appendChild(header);
  dialog.appendChild(body);
  overlay.appendChild(dialog);
  overlay.addEventListener("click", function (event) { if (event.target === overlay) closeHomeSessionDetails(); });
  document.body.appendChild(overlay);
  detailsOverlay = overlay;
  document.body.classList.add("home-session-details-open");
  document.addEventListener("keydown", handleDetailsKeydown, true);
  renderDetails();
  requestAnimationFrame(function () { close.focus({ preventScroll: true }); });
  return true;
}

export function syncHomeSessionDetails() {
  if (!detailsOverlay || !detailsKey) return;
  var next = findConversation(detailsKey);
  if (!next) {
    closeHomeSessionDetails();
    return;
  }
  var previous = JSON.stringify(detailsConversation);
  if (JSON.stringify(next) === previous) return;
  var activeCopy = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.homeSessionCopy : null;
  detailsConversation = next;
  renderDetails();
  if (!activeCopy || !detailsOverlay) return;
  var copies = detailsOverlay.querySelectorAll("[data-home-session-copy]");
  for (var i = 0; i < copies.length; i++) {
    if (copies[i].dataset.homeSessionCopy !== activeCopy) continue;
    copies[i].focus({ preventScroll: true });
    break;
  }
}

export function disposeHomeSessionActions() {
  closeMenu(false);
  closeHomeSessionDetails();
}
