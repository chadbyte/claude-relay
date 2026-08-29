// app-home-hub.js - Home work hub navigation and mate roster.

import { store } from './store.js';
import { renderProjectList, getCachedProjects } from './app-projects.js';
import { mateAvatarUrl } from './avatar.js';
import { exitDmMode } from './app-dm.js';
import { renderDock } from './home-dock.js';
import { openHomeChat, closeHomeChat, renderHomeChat } from './home-mate-chat.js';
import { escapeHtml } from './utils.js';
import { getActiveMentionMateIds, showIconTooltipHtml, hideIconTooltip, showMateCtxMenu } from './sidebar-mates.js';
import { openMateWizard } from './mate-wizard.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { requestTools } from './home-tools.js';

var homeHub = null;
var homeHubVisible = false;
var hubCloseBtn = null;
var mateTooltipTimer = null;
var addMateMenu = null;

function closeAddMateMenu() {
  if (addMateMenu) {
    addMateMenu.remove();
    addMateMenu = null;
  }
  document.removeEventListener("click", handleAddMateMenuOutside, true);
}

function handleAddMateMenuOutside(e) {
  if (addMateMenu && !addMateMenu.contains(e.target)) closeAddMateMenu();
}

function showAddMateMenu(anchorEl) {
  closeAddMateMenu();
  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  var createItem = document.createElement("button");
  createItem.className = "project-ctx-item";
  createItem.innerHTML = iconHtml("plus") + " <span>New mate</span>";
  createItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeAddMateMenu();
    openMateWizard();
  });
  menu.appendChild(createItem);

  var builtins = store.get('cachedAvailableBuiltins') || [];
  for (var i = 0; i < builtins.length; i++) {
    (function (builtin) {
      var item = document.createElement("button");
      item.className = "project-ctx-item";
      item.innerHTML = iconHtml("rotate-ccw") + " <span>Restore " + escapeHtml(builtin.displayName || builtin.key) + "</span>";
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        var ws = getWs();
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "mate_readd_builtin", builtinKey: builtin.key }));
        }
        closeAddMateMenu();
      });
      menu.appendChild(item);
    })(builtins[i]);
  }

  document.body.appendChild(menu);
  addMateMenu = menu;
  refreshIcons();
  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = rect.left + "px";
    menu.style.top = (rect.bottom + 6) + "px";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) menu.style.left = (window.innerWidth - menuRect.width - 8) + "px";
    if (menuRect.bottom > window.innerHeight - 8) menu.style.top = (rect.top - menuRect.height - 6) + "px";
  });
  setTimeout(function () { document.addEventListener("click", handleAddMateMenuOutside, true); }, 0);
}

function hideMateTooltip() {
  if (mateTooltipTimer) {
    clearTimeout(mateTooltipTimer);
    mateTooltipTimer = null;
  }
  hideIconTooltip();
}

function mateTooltipHtml(mate, displayName, avatarUrl, isBusy) {
  var profile = mate.profile || {};
  var bio = profile.bio || mate.bio || profile.description || mate.description || "";
  var vendor = mate.vendor || "";
  var vendorLabels = { claude: "Claude Code", codex: "OpenAI Codex", kiro: "Kiro CLI" };
  var presenceLabel = isBusy ? "Working" : "Available";
  var safeAvatarUrl = String(avatarUrl || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
  var html = '<div class="home-mate-tooltip">'
    + '<img class="home-mate-tooltip-avatar" src="' + safeAvatarUrl + '" alt="">'
    + '<div class="home-mate-tooltip-copy">'
    + '<div class="home-mate-tooltip-name">' + escapeHtml(displayName) + '</div>';
  if (bio) html += '<div class="home-mate-tooltip-bio">' + escapeHtml(bio) + '</div>';
  html += '<div class="home-mate-tooltip-meta">'
    + '<span class="home-mate-tooltip-presence' + (isBusy ? ' is-busy' : '') + '"><i></i>' + presenceLabel + '</span>';
  if (vendor) html += '<span class="home-mate-tooltip-vendor">' + escapeHtml(vendorLabels[vendor] || vendor) + '</span>';
  html += '</div></div></div>';
  return html;
}

function queueMateTooltip(item, mate, displayName, avatarUrl, isBusy, immediate) {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  hideMateTooltip();
  mateTooltipTimer = setTimeout(function () {
    mateTooltipTimer = null;
    if (!document.body.contains(item)) return;
    showIconTooltipHtml(item, mateTooltipHtml(mate, displayName, avatarUrl, isBusy), {
      placement: "bottom",
      className: "home-mate-hover-card",
    });
  }, immediate ? 0 : 200);
}

export function initHomeHub() {
  homeHub = document.getElementById("home-hub");
  hubCloseBtn = document.getElementById("home-hub-close");
  window.addEventListener("clay:home-debate", function () { hideHomeHub(); });

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
  hideMateTooltip();
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
  var mateProjectStatus = {};
  var projects = getCachedProjects() || [];
  for (var projectIndex = 0; projectIndex < projects.length; projectIndex++) {
    if (projects[projectIndex] && projects[projectIndex].slug) {
      mateProjectStatus[projects[projectIndex].slug] = projects[projectIndex];
    }
  }
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
      var mateProject = mateProjectStatus["mate-" + mate.id] || {};
      var isBusy = !!mateProject.isProcessing || !!mentionActive[mate.id];
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
      dot.className = "home-hub-mate-dot" + (isBusy ? " is-busy" : "");
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
        hideMateTooltip();
        openHomeChat(mate.id);
      });
      item.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        hideMateTooltip();
        showMateCtxMenu(item, mate);
      });
      item.addEventListener("mouseenter", function () {
        queueMateTooltip(item, mate, displayName, avatar.src, isBusy, false);
      });
      item.addEventListener("mouseleave", hideMateTooltip);
      item.addEventListener("focus", function () {
        queueMateTooltip(item, mate, displayName, avatar.src, isBusy, true);
      });
      item.addEventListener("blur", hideMateTooltip);
      container.appendChild(item);
    })(visibleMates[i]);
  }

  var addItem = document.createElement("button");
  addItem.type = "button";
  addItem.className = "home-hub-mate-item home-hub-mate-add";
  addItem.title = "Add mate";
  addItem.setAttribute("aria-label", "Add mate");
  addItem.innerHTML = '<div class="home-hub-mate-add-icon">+</div>';
  addItem.addEventListener("click", function () {
    showAddMateMenu(addItem);
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
  requestTools();
  renderDock();
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
  hideMateTooltip();
  closeAddMateMenu();
  homeHub.classList.add("hidden");
  closeHomeChat();
  var mobileHome = document.getElementById("mobile-home-btn");
  if (mobileHome) mobileHome.classList.remove("active");
}
