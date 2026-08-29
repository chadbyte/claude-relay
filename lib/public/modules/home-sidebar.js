// Minimal Home navigation through Mates and their conversation history.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { updateHomeSurfacePreference } from './home-surface.js';
import { openHomeCapsules } from './home-dock.js';
import { openHomeConversation, openHomeMateActions, startNewHomeConversation } from './home-mate-chat.js';
import { openHomeConversationsSheet, refreshHomeConversationsSheet } from './home-conversations-sheet.js';

var initialized = false;
var requestedMateIds = {};

function visibleMates() {
  return (store.get('cachedMatesList') || []).filter(function (mate) {
    return !!mate && !mate.archived;
  });
}

function requestConversationLists(force) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  if (force) requestedMateIds = {};
  var mates = visibleMates();
  for (var i = 0; i < mates.length; i++) {
    if (requestedMateIds[mates[i].id]) continue;
    requestedMateIds[mates[i].id] = true;
    ws.send(JSON.stringify({ type: "home_mate_sessions_list", mateId: mates[i].id }));
  }
}

function allConversations() {
  var byMate = store.get('homeMateSessions') || {};
  var mateIds = Object.keys(byMate);
  var result = [];
  for (var i = 0; i < mateIds.length; i++) {
    var sessions = Array.isArray(byMate[mateIds[i]]) ? byMate[mateIds[i]] : [];
    for (var j = 0; j < sessions.length; j++) {
      if (!sessions[j] || !sessions[j].id) continue;
      result.push({
        mateId: mateIds[i],
        sessionId: sessions[j].id,
        title: sessions[j].title || "New conversation",
        lastActivity: sessions[j].lastActivity || 0,
        isProcessing: sessions[j].isProcessing === true,
      });
    }
  }
  result.sort(function (a, b) { return b.lastActivity - a.lastActivity; });
  return result;
}

function renderRecentConversations() {
  var list = document.getElementById("home-sidebar-recent-list");
  if (!list) return;
  list.innerHTML = "";
  var conversations = allConversations().slice(0, 5);
  if (!conversations.length) {
    var empty = document.createElement("div");
    empty.className = "home-sidebar-recent-empty";
    empty.textContent = "Your conversations will appear here.";
    list.appendChild(empty);
    return;
  }
  var activeMateId = store.get('homeChatMateId');
  var activeSessionId = store.get('homeChatSessionId');
  for (var i = 0; i < conversations.length; i++) {
    (function (conversation) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "home-sidebar-recent-row";
      if (conversation.mateId === activeMateId && conversation.sessionId === activeSessionId) row.classList.add("is-active");
      var title = document.createElement("span");
      title.className = "home-sidebar-recent-title";
      title.textContent = conversation.title;
      row.appendChild(title);
      if (conversation.isProcessing) {
        var activity = document.createElement("span");
        activity.className = "home-sidebar-processing";
        activity.setAttribute("aria-label", "Processing");
        row.appendChild(activity);
      }
      row.addEventListener("click", function () {
        openConversationFromSidebar(conversation.mateId, conversation.sessionId);
      });
      list.appendChild(row);
    })(conversations[i]);
  }
}

function renderSidebarState() {
  var hub = document.getElementById("home-hub");
  if (!hub) return;
  var collapsed = store.get('homeSidebarCollapsed') === true;
  hub.classList.toggle("home-sidebar-collapsed", collapsed);
  var collapse = document.getElementById("home-sidebar-collapse");
  var expand = document.getElementById("home-sidebar-expand");
  if (collapse) collapse.setAttribute("aria-expanded", String(!collapsed));
  if (expand) expand.setAttribute("aria-expanded", String(!collapsed));
  renderRecentConversations();
  refreshHomeConversationsSheet();
}

function setCollapsed(collapsed) {
  updateHomeSurfacePreference({ sidebarCollapsed: collapsed });
}

function isNarrowDrawer() {
  return !!window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
}

function focusNarrowNavigationTarget() {
  var composer = document.getElementById("home-mate-chat-input");
  if (composer && !composer.disabled && composer.getClientRects().length) {
    composer.focus();
    return;
  }
  var expand = document.getElementById("home-sidebar-expand");
  if (expand && expand.getClientRects().length) expand.focus();
}

function closeNarrowDrawer(focusConversation) {
  if (!isNarrowDrawer()) return;
  setCollapsed(true);
  if (focusConversation) focusNarrowNavigationTarget();
}

function openConversationFromSidebar(mateId, sessionId) {
  openHomeConversation(mateId, sessionId);
  closeNarrowDrawer(true);
}

function startConversationFromSidebar() {
  startNewHomeConversation();
  closeNarrowDrawer(true);
}

function openAllConversations(event) {
  openHomeConversationsSheet(openConversationFromSidebar, event.currentTarget);
}

function openCapsulesFromSidebar() {
  openHomeCapsules();
  closeNarrowDrawer(false);
}

function handleSidebarKeydown(event) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!document.body.classList.contains("home-active")) return;
  if (document.querySelector(".home-conversations-sheet")) return;
  if (!isNarrowDrawer() || store.get('homeSidebarCollapsed') === true) return;
  event.preventDefault();
  closeNarrowDrawer(true);
}

export function initHomeSidebar() {
  if (initialized) return;
  initialized = true;
  document.getElementById("home-sidebar-collapse").addEventListener("click", function () { setCollapsed(true); });
  document.getElementById("home-sidebar-expand").addEventListener("click", function () { setCollapsed(false); });
  document.getElementById("home-sidebar-backdrop").addEventListener("click", function () { setCollapsed(true); });
  document.getElementById("home-sidebar-new").addEventListener("click", startConversationFromSidebar);
  document.getElementById("home-sidebar-capsules").addEventListener("click", openCapsulesFromSidebar);
  document.getElementById("home-sidebar-all").addEventListener("click", openAllConversations);
  document.getElementById("home-sidebar-mate-overflow").addEventListener("click", function (event) {
    openHomeMateActions(event.currentTarget);
  });
  store.subscribe(function (state, prev) {
    if (state.connected !== prev.connected && state.connected) requestConversationLists(true);
    if (state.cachedMatesList !== prev.cachedMatesList) requestConversationLists(false);
    if (state.homeMateSessions !== prev.homeMateSessions || state.homeChatMateId !== prev.homeChatMateId || state.homeChatSessionId !== prev.homeChatSessionId || state.homeSidebarCollapsed !== prev.homeSidebarCollapsed) {
      renderSidebarState();
    }
  });
  document.addEventListener("keydown", handleSidebarKeydown);
  requestConversationLists(false);
  renderSidebarState();
  refreshIcons();
}

export function refreshHomeSidebarSessions() {
  requestConversationLists(true);
}
