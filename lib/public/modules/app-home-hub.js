// app-home-hub.js - Home work hub navigation and mate switcher.

import { store } from './store.js';
import { getCachedProjects } from './app-projects.js';
import { mateAvatarUrl } from './avatar.js';
import { exitDmMode } from './app-dm.js';
import { initHomeDock, renderDock, requestHomeDockPreference, resetHomeDockFocus } from './home-dock.js';
import { openHomeChat, closeHomeChat, renderHomeChat } from './home-mate-chat.js';
import { getActiveMentionMateIds, showMateCtxMenu } from './sidebar-mates.js';
import { openMateWizard } from './mate-wizard.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { requestTools } from './home-tools.js';
import { initHomeShell, showHomeShell, hideHomeShell } from './home-shell.js';

var homeHub = null;
var homeHubVisible = false;
var mateSwitcherMenu = null;
var mateSwitcherAnchor = null;

function closeMateSwitcherMenu() {
  if (mateSwitcherMenu) {
    mateSwitcherMenu.remove();
    mateSwitcherMenu = null;
  }
  if (mateSwitcherAnchor) mateSwitcherAnchor.setAttribute("aria-expanded", "false");
  mateSwitcherAnchor = null;
  document.removeEventListener("click", handleMateSwitcherOutside, true);
  document.removeEventListener("keydown", handleMateSwitcherKeydown);
}

function handleMateSwitcherOutside(event) {
  if (!mateSwitcherMenu || mateSwitcherMenu.contains(event.target)) return;
  if (mateSwitcherAnchor && mateSwitcherAnchor.contains(event.target)) return;
  closeMateSwitcherMenu();
}

function handleMateSwitcherKeydown(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  var anchor = mateSwitcherAnchor;
  closeMateSwitcherMenu();
  if (anchor) anchor.focus();
}

function getVisibleMates() {
  var mates = (store.get('cachedMatesList') || []).filter(function (mate) {
    return !!mate && !mate.archived;
  });
  mates.sort(function (a, b) {
    var aClay = a.builtinKey === "clay" ? 0 : 1;
    var bClay = b.builtinKey === "clay" ? 0 : 1;
    if (aClay !== bClay) return aClay - bClay;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  return mates;
}

function getMateName(mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  return profile.displayName || (mate && (mate.displayName || mate.name)) || "Mate";
}

function getMateBio(mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  return profile.bio || (mate && mate.bio) || profile.description || (mate && mate.description) || "";
}

function getMateActivity() {
  var status = {};
  var projects = getCachedProjects() || [];
  for (var i = 0; i < projects.length; i++) {
    if (projects[i] && projects[i].slug) status[projects[i].slug] = projects[i];
  }
  return status;
}

function isMateBusy(mate, projectStatus, mentionActive) {
  var project = projectStatus["mate-" + mate.id] || {};
  return !!project.isProcessing || !!mentionActive[mate.id];
}

function positionMateSwitcherMenu(anchorEl, menu) {
  var rect = anchorEl.getBoundingClientRect();
  menu.style.left = rect.left + "px";
  menu.style.top = (rect.bottom + 8) + "px";
  var menuRect = menu.getBoundingClientRect();
  if (menuRect.right > window.innerWidth - 12) {
    menu.style.left = Math.max(12, window.innerWidth - menuRect.width - 12) + "px";
  }
  if (menuRect.bottom > window.innerHeight - 12) {
    menu.style.top = Math.max(12, rect.top - menuRect.height - 8) + "px";
  }
}

function appendRestoreRows(menu) {
  var builtins = store.get('cachedAvailableBuiltins') || [];
  if (!builtins.length) return;
  var divider = document.createElement("div");
  divider.className = "home-mate-switcher-divider";
  menu.appendChild(divider);

  for (var i = 0; i < builtins.length; i++) {
    (function (builtin) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "home-mate-switcher-footer-action";
      item.innerHTML = iconHtml("rotate-ccw");
      var label = document.createElement("span");
      label.textContent = "Restore " + (builtin.displayName || builtin.key);
      item.appendChild(label);
      item.addEventListener("click", function () {
        var ws = getWs();
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "mate_readd_builtin", builtinKey: builtin.key }));
        }
        closeMateSwitcherMenu();
      });
      menu.appendChild(item);
    })(builtins[i]);
  }
}

function showMateSwitcherMenu(anchorEl) {
  closeMateSwitcherMenu();
  var mates = getVisibleMates();
  var unread = store.get('dmUnread') || {};
  var activeMateId = store.get('homeChatMateId');
  var mentionActive = getActiveMentionMateIds();
  var projectStatus = getMateActivity();
  var menu = document.createElement("div");
  menu.className = "home-mate-switcher-menu";
  menu.setAttribute("role", "menu");

  for (var i = 0; i < mates.length; i++) {
    (function (mate) {
      var name = getMateName(mate);
      var row = document.createElement("button");
      row.type = "button";
      row.className = "home-mate-switcher-row" + (mate.id === activeMateId ? " active" : "");
      row.setAttribute("role", "menuitem");

      var avatarWrap = document.createElement("span");
      avatarWrap.className = "home-mate-switcher-row-avatar-wrap";
      var avatar = document.createElement("img");
      avatar.className = "home-mate-switcher-row-avatar";
      avatar.src = mateAvatarUrl(mate, 36);
      avatar.alt = "";
      avatarWrap.appendChild(avatar);
      var presence = document.createElement("span");
      presence.className = "home-mate-switcher-presence" + (isMateBusy(mate, projectStatus, mentionActive) ? " is-busy" : "");
      avatarWrap.appendChild(presence);
      row.appendChild(avatarWrap);

      var copy = document.createElement("span");
      copy.className = "home-mate-switcher-row-copy";
      var nameEl = document.createElement("span");
      nameEl.className = "home-mate-switcher-row-name";
      nameEl.textContent = name;
      copy.appendChild(nameEl);
      var bio = document.createElement("span");
      bio.className = "home-mate-switcher-row-bio";
      bio.textContent = getMateBio(mate) || "Available to work with you";
      copy.appendChild(bio);
      row.appendChild(copy);

      var meta = document.createElement("span");
      meta.className = "home-mate-switcher-row-meta";
      if (mentionActive[mate.id]) {
        var mention = document.createElement("span");
        mention.className = "home-mate-switcher-mention";
        mention.title = "Responding to a mention";
        meta.appendChild(mention);
      }
      var count = unread[mate.id] || 0;
      if (count > 0) {
        var badge = document.createElement("span");
        badge.className = "home-mate-switcher-unread";
        badge.textContent = count > 99 ? "99+" : String(count);
        meta.appendChild(badge);
      }
      row.appendChild(meta);

      row.addEventListener("click", function () {
        closeMateSwitcherMenu();
        openHomeChat(mate.id);
      });
      row.addEventListener("contextmenu", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var rect = row.getBoundingClientRect();
        var anchor = { getBoundingClientRect: function () { return rect; } };
        closeMateSwitcherMenu();
        showMateCtxMenu(anchor, mate);
      });
      menu.appendChild(row);
    })(mates[i]);
  }

  appendRestoreRows(menu);
  var divider = document.createElement("div");
  divider.className = "home-mate-switcher-divider";
  menu.appendChild(divider);
  var createItem = document.createElement("button");
  createItem.type = "button";
  createItem.className = "home-mate-switcher-footer-action";
  createItem.innerHTML = iconHtml("plus") + "<span>New mate</span>";
  createItem.addEventListener("click", function () {
    closeMateSwitcherMenu();
    openMateWizard();
  });
  menu.appendChild(createItem);

  document.body.appendChild(menu);
  mateSwitcherMenu = menu;
  mateSwitcherAnchor = anchorEl;
  anchorEl.setAttribute("aria-expanded", "true");
  refreshIcons();
  requestAnimationFrame(function () {
    positionMateSwitcherMenu(anchorEl, menu);
  });
  setTimeout(function () {
    document.addEventListener("click", handleMateSwitcherOutside, true);
    document.addEventListener("keydown", handleMateSwitcherKeydown);
  }, 0);
}

export function initHomeHub() {
  homeHub = document.getElementById("home-hub");
  initHomeShell();
  initHomeDock();
  window.addEventListener("clay:home-debate", function () { hideHomeHub(); });

  store.subscribe(function (state, prev) {
    if (state.homeChatMateId !== prev.homeChatMateId) renderHomeMateSwitcher();
  });
  renderHomeChat();
}

export function isHomeHubVisible() {
  return homeHubVisible;
}

export function renderHomeMateSwitcher() {
  var container = document.getElementById("home-mate-switcher");
  if (!container) return;
  closeMateSwitcherMenu();
  container.innerHTML = "";
  var visibleMates = getVisibleMates();
  var mentionActive = getActiveMentionMateIds();
  var activeMateId = store.get('homeChatMateId');
  var activeMate = null;
  for (var i = 0; i < visibleMates.length; i++) {
    if (visibleMates[i].id === activeMateId) activeMate = visibleMates[i];
  }

  if (homeHubVisible && !activeMate) {
    for (var j = 0; j < visibleMates.length; j++) {
      if (visibleMates[j].builtinKey === "clay") {
        openHomeChat(visibleMates[j].id);
        return;
      }
    }
  }

  var trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "home-mate-switcher-trigger";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", activeMate ? "Switch mate" : "Select a mate");

  if (activeMate) {
    var projectStatus = getMateActivity();
    var avatarWrap = document.createElement("span");
    avatarWrap.className = "home-mate-switcher-avatar-wrap";
    var avatar = document.createElement("img");
    avatar.className = "home-mate-switcher-avatar";
    avatar.src = mateAvatarUrl(activeMate, 36);
    avatar.alt = "";
    avatarWrap.appendChild(avatar);
    var presence = document.createElement("span");
    presence.className = "home-mate-switcher-presence" + (isMateBusy(activeMate, projectStatus, mentionActive) ? " is-busy" : "");
    avatarWrap.appendChild(presence);
    trigger.appendChild(avatarWrap);

    var name = document.createElement("span");
    name.className = "home-mate-switcher-name";
    name.textContent = getMateName(activeMate);
    trigger.appendChild(name);
    if (mentionActive[activeMate.id]) {
      var mention = document.createElement("span");
      mention.className = "home-mate-switcher-mention";
      mention.title = "Responding to a mention";
      trigger.appendChild(mention);
    }
  } else {
    var placeholder = document.createElement("span");
    placeholder.className = "home-mate-switcher-name";
    placeholder.textContent = "Select a mate";
    trigger.appendChild(placeholder);
  }
  var chevron = document.createElement("span");
  chevron.className = "home-mate-switcher-chevron";
  chevron.innerHTML = iconHtml("chevron-down");
  trigger.appendChild(chevron);
  trigger.addEventListener("click", function () {
    if (mateSwitcherMenu) closeMateSwitcherMenu();
    else showMateSwitcherMenu(trigger);
  });
  container.appendChild(trigger);
  refreshIcons();
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

export function showHomeHub(fromHistory) {
  if (store.get('dmMode')) exitDmMode();
  var activeMateId = store.get('homeChatMateId');
  homeHubVisible = true;
  showHomeShell(store.get('currentSlug'));
  homeHub.classList.remove("hidden");
  renderHomeMateSwitcher();
  if (activeMateId) openHomeChat(activeMateId);
  requestTools();
  requestHomeDockPreference();
  renderDock();
  if (!fromHistory && location.pathname !== "/") {
    if (document.documentElement.classList.contains("pwa-standalone")) {
      history.replaceState(null, "", "/");
    } else {
      history.pushState(null, "", "/");
    }
  }
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) homeIcon.classList.add("active");
  var mobileHome = document.getElementById("mobile-home-btn");
  if (mobileHome) mobileHome.classList.add("active");
}

export function hideHomeHub() {
  if (!homeHubVisible) return;
  homeHubVisible = false;
  resetHomeDockFocus();
  hideHomeShell();
  closeMateSwitcherMenu();
  homeHub.classList.add("hidden");
  closeHomeChat();
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) homeIcon.classList.remove("active");
  var mobileHome = document.getElementById("mobile-home-btn");
  if (mobileHome) mobileHome.classList.remove("active");
}
