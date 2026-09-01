// Complete, globally sorted Home chat archive rendered in the sidebar.

import { store } from './store.js';
import { getHomeSessionConversations, createHomeSessionActionsTrigger, disposeHomeSessionActionsMenu } from './home-session-actions.js';

export function renderHomeSidebarChats(openConversation) {
  var list = document.getElementById("home-sidebar-recent-list");
  if (!list) return 0;
  disposeHomeSessionActionsMenu();
  list.innerHTML = "";
  var chats = getHomeSessionConversations();
  var scope = store.get('homeChatScope') === "current" ? "current" : "all";
  var activeMateId = store.get('homeChatMateId');
  if (scope === "current") {
    chats = chats.filter(function (chat) { return chat.mateId === activeMateId; });
  }
  if (!chats.length) {
    var empty = document.createElement("div");
    empty.className = "home-sidebar-recent-empty";
    empty.textContent = scope === "current" ? "No chats with this Mate yet." : "Chats will appear here.";
    list.appendChild(empty);
    return 0;
  }
  var activeSessionId = store.get('homeChatSessionId');
  for (var i = 0; i < chats.length; i++) {
    (function (chat) {
      var item = document.createElement("div");
      item.className = "home-sidebar-recent-item";
      var row = document.createElement("button");
      row.type = "button";
      row.className = "home-sidebar-recent-row";
      row.setAttribute("aria-label", chat.title + ", with " + chat.mateName);
      if (chat.mateId === activeMateId && chat.sessionId === activeSessionId) {
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
      mate.textContent = chat.mateName;
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
      list.appendChild(item);
    })(chats[i]);
  }
  return chats.length;
}
