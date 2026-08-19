// app-home-hub.js - Home work hub navigation and mate roster.

import { store } from './store.js';
import { renderProjectList } from './app-projects.js';
import { mateAvatarUrl } from './avatar.js';
import { exitDmMode } from './app-dm.js';
import { requestBoard, renderBoard } from './home-board.js';
import { openHomeChat, closeHomeChat, renderHomeChat } from './home-mate-chat.js';
import { getActiveMentionMateIds } from './sidebar-mates.js';
import { openMateWizard } from './mate-wizard.js';

var homeHub = null;
var homeHubVisible = false;
var hubCloseBtn = null;

export function initHomeHub() {
  homeHub = document.getElementById("home-hub");
  hubCloseBtn = document.getElementById("home-hub-close");

  if (hubCloseBtn) {
    hubCloseBtn.addEventListener("click", function () {
      hideHomeHub();
      if (store.get('currentSlug')) {
        if (document.documentElement.classList.contains("pwa-standalone")) {
          history.replaceState(null, "", "/p/" + store.get('currentSlug') + "/");
        } else {
          history.pushState(null, "", "/p/" + store.get('currentSlug') + "/");
        }
        var homeIcon = document.querySelector(".icon-strip-home");
        if (homeIcon) homeIcon.classList.remove("active");
        renderProjectList();
      }
    });
  }
  store.subscribe(function (state, prev) {
    if (state.homeChatMateId !== prev.homeChatMateId) renderHomeHubMates();
  });
  renderHomeChat();
}

export function isHomeHubVisible() {
  return homeHubVisible;
}

export function renderHomeHubMates() {
  var container = document.getElementById("home-hub-mates");
  if (!container) return;
  container.innerHTML = "";

  var visibleMates = (store.get('cachedMatesList') || []).filter(function (mate) {
    return !!mate && !mate.archived;
  });
  visibleMates.sort(function (a, b) {
    var aClay = a.builtinKey === "clay" ? 0 : 1;
    var bClay = b.builtinKey === "clay" ? 0 : 1;
    if (aClay !== bClay) return aClay - bClay;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });

  var mentionActive = getActiveMentionMateIds();
  var unread = store.get('dmUnread') || {};
  var activeMateId = store.get('homeChatMateId');
  for (var i = 0; i < visibleMates.length; i++) {
    (function (mate) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "home-hub-mate-item"
        + (mate.primary ? " home-hub-mate-primary" : "")
        + (mate.id === activeMateId ? " active" : "");
      var profile = mate.profile || {};
      var displayName = profile.displayName || mate.displayName || mate.name || "Mate";
      var mateColor = profile.avatarColor || mate.avatarColor || "";
      item.title = displayName;
      item.setAttribute("aria-label", displayName);
      if (mateColor) item.style.setProperty("--home-mate-color", mateColor);

      var avatarWrap = document.createElement("div");
      avatarWrap.className = "home-hub-mate-avatar-wrap";

      var avatar = document.createElement("img");
      avatar.className = "home-hub-mate-avatar";
      avatar.src = mateAvatarUrl(mate, 48);
      avatar.alt = "";
      avatarWrap.appendChild(avatar);

      var dot = document.createElement("span");
      dot.className = "home-hub-mate-dot";
      avatarWrap.appendChild(dot);

      if (mentionActive[mate.id]) {
        var mentionEl = document.createElement("span");
        mentionEl.className = "home-hub-mate-mention";
        mentionEl.title = "Responding to a mention";
        avatarWrap.appendChild(mentionEl);
      }

      var unreadCount = unread[mate.id] || 0;
      if (unreadCount > 0) {
        var badgeEl = document.createElement("span");
        badgeEl.className = "home-hub-mate-badge";
        badgeEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        avatarWrap.appendChild(badgeEl);
      }
      item.appendChild(avatarWrap);

      if (mate.id === activeMateId) {
        var nameEl = document.createElement("span");
        nameEl.className = "home-hub-mate-name";
        nameEl.textContent = displayName;
        item.appendChild(nameEl);
      }

      item.addEventListener("click", function () {
        openHomeChat(mate.id);
      });
      container.appendChild(item);
    })(visibleMates[i]);
  }

  var addItem = document.createElement("button");
  addItem.type = "button";
  addItem.className = "home-hub-mate-item home-hub-mate-add";
  addItem.title = "New mate";
  addItem.setAttribute("aria-label", "New mate");
  addItem.innerHTML = '<div class="home-hub-mate-add-icon">+</div>';
  addItem.addEventListener("click", function () {
    openMateWizard();
  });
  container.appendChild(addItem);

  if (homeHubVisible && !activeMateId) {
    for (var j = 0; j < visibleMates.length; j++) {
      if (visibleMates[j].builtinKey === "clay") {
        openHomeChat(visibleMates[j].id);
        break;
      }
    }
  }
}

export function updateHomeIconBadge() {
  var badge = document.getElementById("icon-strip-home-badge");
  if (!badge) return;
  var mates = store.get('cachedMatesList') || [];
  var unread = store.get('dmUnread') || {};
  var total = 0;
  for (var i = 0; i < mates.length; i++) {
    total += unread[mates[i].id] || 0;
  }
  if (total > 0) {
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.classList.add("has-unread");
  } else {
    badge.textContent = "";
    badge.classList.remove("has-unread");
  }
}

export function showHomeHub() {
  if (store.get('dmMode')) exitDmMode();
  var activeMateId = store.get('homeChatMateId');
  homeHubVisible = true;
  homeHub.classList.remove("hidden");
  if (hubCloseBtn) {
    if (store.get('currentSlug')) hubCloseBtn.classList.remove("hidden");
    else hubCloseBtn.classList.add("hidden");
  }
  renderHomeHubMates();
  if (activeMateId) openHomeChat(activeMateId);
  requestBoard();
  renderBoard();
  if (document.documentElement.classList.contains("pwa-standalone")) {
    history.replaceState(null, "", "/");
  } else {
    history.pushState(null, "", "/");
  }
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) homeIcon.classList.add("active");
  var activeProject = document.querySelector("#icon-strip-projects .icon-strip-item.active");
  if (activeProject) activeProject.classList.remove("active");
  var mobileHome = document.getElementById("mobile-home-btn");
  if (mobileHome) mobileHome.classList.add("active");
}

export function hideHomeHub() {
  if (!homeHubVisible) return;
  homeHubVisible = false;
  homeHub.classList.add("hidden");
  closeHomeChat();
  var mobileHome = document.getElementById("mobile-home-btn");
  if (mobileHome) mobileHome.classList.remove("active");
}
