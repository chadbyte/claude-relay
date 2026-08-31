// Searchable projection of every user-owned Mate conversation loaded by Home.

import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { getHomeSessionConversations, createHomeSessionActionsTrigger, disposeHomeSessionActionsMenu } from './home-session-actions.js';

var overlay = null;
var searchInput = null;
var listEl = null;
var sheetOpener = null;
var selectConversation = null;

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

function renderRows() {
  if (!listEl) return;
  var query = searchInput ? searchInput.value.trim().toLowerCase() : "";
  var all = getHomeSessionConversations().filter(function (conversation) {
    if (!query) return true;
    return conversation.title.toLowerCase().indexOf(query) !== -1 || conversation.mateName.toLowerCase().indexOf(query) !== -1;
  });
  disposeHomeSessionActionsMenu();
  listEl.innerHTML = "";
  if (!all.length) {
    var empty = document.createElement("div");
    empty.className = "home-conversations-sheet-empty";
    empty.textContent = query ? "No chats match your search." : "No chats yet.";
    listEl.appendChild(empty);
    return;
  }
  for (var i = 0; i < all.length; i++) {
    (function (conversation) {
      var item = document.createElement("div");
      item.className = "home-conversations-sheet-item";
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
      mate.textContent = conversation.mateName;
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
      listEl.appendChild(item);
    })(all[i]);
  }
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
