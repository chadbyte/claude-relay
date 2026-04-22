// app-notifications.js - Notification banners (Apple banner style)
// New notifications appear as individual banners top-right, auto-dismiss after 3s.
// Bell button click shows all stored notifications as banners.

import { refreshIcons, iconHtml } from './icons.js';
import { escapeHtml } from './utils.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { openDm } from './app-dm.js';
import { getCachedProjects } from './app-projects.js';
import { switchProject } from './app-projects.js';
import { mateAvatarUrl } from './avatar.js';
var notifications = [];
var unreadCount = 0;
var bannerContainer = null;
var bellBtn = null;
var badgeEl = null;

// --- Update available banner state ---
// Server pushes update_available on an hourly boundary; dismissal is
// per-banner-instance and doesn't need to persist. The next server push
// (next hour) acts as a fresh ping.
var pendingUpdateMsg = null;

// ========================================================
// Init
// ========================================================

export function initAppNotifications() {
  bellBtn = document.getElementById("notif-center-btn");
  badgeEl = document.getElementById("notif-center-badge");

  // Create banner container
  bannerContainer = document.createElement("div");
  bannerContainer.className = "notif-banner-container";
  document.body.appendChild(bannerContainer);

  if (bellBtn) {
    bellBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      showAllBanners();
    });
  }
}

// ========================================================
// Show all stored notifications as banners
// ========================================================

function showAllBanners() {
  // Clear existing banners first
  if (bannerContainer) bannerContainer.innerHTML = "";

  // Re-add update banner if present (may be suppressed by recent dismiss)
  if (pendingUpdateMsg) showUpdateBanner(pendingUpdateMsg);

  // Check if any banner actually got rendered (update banner can be suppressed)
  var hasVisibleBanner = bannerContainer.children.length > 0;
  if (notifications.length === 0 && !hasVisibleBanner) {
    showBanner({
      id: "_empty",
      type: "info",
      title: randomEmptyMessage(),
      body: "",
      slug: "",
    }, 3000);
    return;
  }

  for (var i = 0; i < notifications.length; i++) {
    showBanner(notifications[i], false);
  }
}

// ========================================================
// Banner
// ========================================================

function showBanner(notif, autoDismissMs) {
  if (!bannerContainer) return;

  var isEmpty = notif.id === "_empty";
  var projectIcon = isEmpty ? null : getProjectIcon(notif.slug);
  var projectName = isEmpty ? "" : getProjectName(notif.slug);
  var isPermission = notif.type === "permission_request" && notif.meta && notif.meta.requestId;
  var mate = isEmpty ? null : getMateForNotification(notif);

  var banner = document.createElement("div");
  banner.className = "notif-banner" + (isPermission ? " notif-banner-permission" : "");
  if (!isEmpty) banner.setAttribute("data-notif-id", notif.id);

  var iconHtmlStr = mate
    ? '<img class="notif-banner-avatar" src="' + escapeHtml(mateAvatarUrl(mate, 32)) + '" alt="' + escapeHtml(mate.displayName || mate.name || "Mate") + '">'
    : projectIcon
      ? '<span class="notif-banner-emoji">' + projectIcon + '</span>'
      : iconHtml(isEmpty ? "check-circle" : "folder");

  // Format permission title as "Can I ..." style
  if (isPermission && notif.meta) {
    var permInfo = formatPermissionInfo(notif.meta.toolName, notif.meta.toolInput);
    if (permInfo) {
      notif = Object.assign({}, notif, { title: "Can I " + permInfo.verb + (permInfo.target ? " " + permInfo.target : "") + "?" });
    }
  }

  var actionsHtml = "";
  if (isPermission) {
    actionsHtml =
      '<div class="notif-banner-actions">' +
        '<button class="notif-banner-allow">Sure</button>' +
        '<button class="notif-banner-always">Allow for session</button>' +
        '<button class="notif-banner-deny">No</button>' +
        '<button class="notif-banner-goto" title="Go to session">' + iconHtml("external-link") + '</button>' +
      '</div>';
  }

  banner.innerHTML =
    '<div class="notif-banner-icon">' + iconHtmlStr + '</div>' +
    '<div class="notif-banner-body">' +
      (projectName ? '<div class="notif-banner-project">' + escapeHtml(projectName) + '</div>' : '') +
      '<div class="notif-banner-title">' + escapeHtml(notif.title) + '</div>' +
      (notif.body ? '<div class="notif-banner-text">' + escapeHtml(notif.body) + '</div>' : '') +
      actionsHtml +
    '</div>' +
    (!isEmpty ? '<button class="notif-banner-close">' + iconHtml("x") + '</button>' : '');

  bannerContainer.appendChild(banner);
  refreshIcons();
  ensureClearAllButton();

  requestAnimationFrame(function () {
    banner.classList.add("show");
  });

  if (!isEmpty) {
    // Click banner body -> navigate + dismiss
    banner.addEventListener("click", function (e) {
      if (e.target.closest(".notif-banner-close")) return;
      removeBanner(banner);
      dismissNotif(notif.id);
      navigateToNotification(notif);
    });

    // Close button -> dismiss
    var closeBtn = banner.querySelector(".notif-banner-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        removeBanner(banner);
        dismissNotif(notif.id);
      });
    }

    // Permission actions
    if (isPermission) {
      var sureBtn = banner.querySelector(".notif-banner-allow");
      var alwaysBtn = banner.querySelector(".notif-banner-always");
      var noBtn = banner.querySelector(".notif-banner-deny");
      var gotoBtn = banner.querySelector(".notif-banner-goto");

      if (sureBtn) {
        sureBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          sendPermissionResponse(notif.meta.requestId, true, notif.slug);
          removeBanner(banner);
          dismissNotif(notif.id);
        });
      }
      if (alwaysBtn) {
        alwaysBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          sendPermissionResponse(notif.meta.requestId, "always", notif.slug);
          removeBanner(banner);
          dismissNotif(notif.id);
        });
      }
      if (noBtn) {
        noBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          sendPermissionResponse(notif.meta.requestId, false, notif.slug);
          removeBanner(banner);
          dismissNotif(notif.id);
        });
      }
      if (gotoBtn) {
        gotoBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          navigateToNotification(notif);
          removeBanner(banner);
          dismissNotif(notif.id);
        });
      }
    }
  }

  // Auto-dismiss (number = ms, false = stay)
  if (typeof autoDismissMs === "number") {
    setTimeout(function () { removeBanner(banner); }, autoDismissMs);
  } else if (autoDismissMs === true) {
    setTimeout(function () { removeBanner(banner); }, 3000);
  }
}

function removeBanner(banner) {
  if (!banner || !banner.parentNode) return;
  banner.classList.remove("show");
  banner.classList.add("hide");
  // Update the clear-all button right away so it disappears before the
  // last banner finishes animating out, and again after the node is
  // actually removed in case the count check depends on DOM presence.
  ensureClearAllButton();
  setTimeout(function () {
    if (banner.parentNode) banner.parentNode.removeChild(banner);
    ensureClearAllButton();
  }, 300);
}

// Count real (non-"_empty", not in hide animation) banners to decide
// whether a Clear-all affordance is worth showing.
function countActiveBanners() {
  if (!bannerContainer) return 0;
  var banners = bannerContainer.querySelectorAll('.notif-banner');
  var n = 0;
  for (var i = 0; i < banners.length; i++) {
    if (banners[i].classList.contains('hide')) continue;
    if (banners[i].getAttribute('data-notif-id')) n++;
  }
  return n;
}

function ensureClearAllButton() {
  if (!bannerContainer) return;
  var existing = bannerContainer.querySelector('.notif-banner-clear-all');
  if (countActiveBanners() >= 2) {
    if (existing) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notif-banner-clear-all';
    btn.innerHTML = iconHtml('x') + '<span>Clear all</span>';
    btn.addEventListener('click', clearAllBanners);
    bannerContainer.insertBefore(btn, bannerContainer.firstChild);
    refreshIcons();
  } else if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
}

function clearAllBanners() {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'notification_dismiss_all' }));
  }
  // Dismiss visually right away — the server will broadcast
  // notification_dismissed_all too, but doing it optimistically makes
  // the click feel instant.
  if (bannerContainer) {
    var banners = bannerContainer.querySelectorAll('.notif-banner[data-notif-id]');
    for (var i = 0; i < banners.length; i++) removeBanner(banners[i]);
  }
  var btn = bannerContainer && bannerContainer.querySelector('.notif-banner-clear-all');
  if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
}

function sendPermissionResponse(requestId, decision, slug) {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    var d = decision === "always" ? "allow_always" : decision ? "allow" : "deny";
    var msg = { type: "permission_response", requestId: requestId, decision: d };
    if (slug) msg.targetSlug = slug;
    ws.send(JSON.stringify(msg));
  }
}

function dismissNotif(id) {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "notification_dismiss", ids: [id] }));
  }
}

// ========================================================
// Message handlers
// ========================================================

export function handleNotificationsState(msg) {
  notifications = msg.notifications || [];
  unreadCount = msg.unreadCount || 0;
  updateBadge();

  // Check for pending session navigation after project switch
  try {
    var pendingSession = sessionStorage.getItem("pending-notif-session");
    if (pendingSession) {
      sessionStorage.removeItem("pending-notif-session");
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "switch_session", id: parseInt(pendingSession, 10) }));
      }
    }
  } catch (e) {}
}

export function handleNotificationCreated(msg) {
  var notif = msg.notification;

  // Auto-dismiss if it's for the session the user is currently viewing
  var activeSession = store.get('activeSessionId') || null;
  console.log("[notif] created:", notif.type, "sessionId=" + notif.sessionId + "(" + typeof notif.sessionId + ")", "active=" + activeSession + "(" + typeof activeSession + ")", "match=" + (notif.sessionId == activeSession));
  if (notif.sessionId && String(notif.sessionId) === String(activeSession)) {
    dismissNotif(notif.id);
    return;
  }

  notifications.unshift(notif);
  unreadCount = msg.unreadCount;
  updateBadge();

  var _autoDismiss = notif.type === "permission_request" ? false : true;
  showBanner(notif, _autoDismiss);
}

export function handleNotificationDismissed(msg) {
  var ids = msg.ids || [];
  notifications = notifications.filter(function (n) { return ids.indexOf(n.id) === -1; });
  unreadCount = msg.unreadCount;
  updateBadge();
  // Remove corresponding banners if visible
  if (bannerContainer) {
    for (var i = 0; i < ids.length; i++) {
      var el = bannerContainer.querySelector('[data-notif-id="' + ids[i] + '"]');
      if (el) removeBanner(el);
    }
  }
}

export function handleNotificationDismissedAll() {
  notifications = [];
  unreadCount = 0;
  updateBadge();
  if (bannerContainer) bannerContainer.innerHTML = "";
}

// ========================================================
// Badge
// ========================================================

function updateBadge() {
  if (!badgeEl) return;
  if (unreadCount > 0) {
    badgeEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badgeEl.classList.remove("hidden");
  } else {
    badgeEl.classList.add("hidden");
  }
}

// ========================================================
// Navigation
// ========================================================

function navigateToNotification(notif) {
  var mateId = notif.mateId || deriveMateIdFromNotification(notif);
  if (mateId) {
    if (notif.sessionId) {
      try { sessionStorage.setItem("pending-notif-session", notif.sessionId); } catch (e) {}
    }
    openDm(mateId);
    return;
  }

  var currentSlug = store.get('currentSlug') || "";
  var needsProjectSwitch = notif.slug && notif.slug !== currentSlug;

  if (needsProjectSwitch) {
    // Store target session for after project switch
    if (notif.sessionId) {
      try { sessionStorage.setItem("pending-notif-session", notif.sessionId); } catch (e) {}
    }
    switchProject(notif.slug);
  } else if (notif.sessionId) {
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "switch_session", id: notif.sessionId }));
    }
  }
}

function deriveMateIdFromNotification(notif) {
  if (!notif) return null;
  if (typeof notif.slug === "string" && notif.slug.indexOf("mate-") === 0) {
    return notif.slug.substring(5) || null;
  }
  return null;
}

function getMateForNotification(notif) {
  var mateId = notif && notif.meta ? notif.meta.avatarMateId : null;
  if (!mateId) mateId = deriveMateIdFromNotification(notif);
  if (!mateId) return null;
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) {
    if (mates[i] && mates[i].id === mateId) return mates[i];
  }
  return { id: mateId };
}

// ========================================================
// Update available banner
// ========================================================

export function showUpdateBanner(msg) {
  if (!msg || !msg.version) return;
  pendingUpdateMsg = msg;
  if (!bannerContainer) return;

  // Remove any existing update banner
  var existing = bannerContainer.querySelector('[data-notif-id="_update"]');
  if (existing) removeBanner(existing);

  var isHeadless = store.get('isHeadlessMode');
  var updTag = msg.version.indexOf("-beta") !== -1 ? "beta" : "latest";

  var banner = document.createElement("div");
  banner.className = "notif-banner notif-banner-update";
  banner.setAttribute("data-notif-id", "_update");

  var actionsHtml = '';
  if (!isHeadless) {
    actionsHtml =
      '<div class="notif-banner-actions">' +
        '<button class="notif-banner-update-now">Update now</button>' +
      '</div>';
  }

  banner.innerHTML =
    '<div class="notif-banner-icon"><img src="/icon-banded-76.png" width="32" height="32" alt="Clay" style="border-radius:8px"></div>' +
    '<div class="notif-banner-body">' +
      '<div class="notif-banner-project">CLAY</div>' +
      '<div class="notif-banner-title">v' + escapeHtml(msg.version) + ' is available</div>' +
      (isHeadless
        ? '<div class="notif-banner-text">Run: npx clay-server@' + escapeHtml(updTag) + '</div>'
        : '') +
      actionsHtml +
    '</div>' +
    '<button class="notif-banner-close">' + iconHtml("x") + '</button>';

  bannerContainer.appendChild(banner);
  refreshIcons();

  requestAnimationFrame(function () {
    banner.classList.add("show");
  });

  // "Update now" button
  var updateBtn = banner.querySelector(".notif-banner-update-now");
  if (updateBtn) {
    updateBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "update_now" }));
        updateBtn.textContent = "Updating...";
        updateBtn.disabled = true;
      }
    });
  }

  // Close button -> dismiss. No local throttle; the server pushes a new
  // update_available on the next hour boundary, which re-shows naturally.
  var closeBtn = banner.querySelector(".notif-banner-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      removeBanner(banner);
    });
  }
}

// ========================================================
// Helpers
// ========================================================

function formatPermissionInfo(toolName, toolInput) {
  if (!toolName) return null;
  var input = toolInput && typeof toolInput === "object" ? toolInput : {};
  var verb = "use " + toolName;
  var target = "";
  var shortPath = function (p) { return p ? p.split(/[/\\]/).pop() : ""; };

  switch (toolName) {
    case "Write": verb = "write to"; target = shortPath(input.file_path); break;
    case "Edit": verb = "edit"; target = shortPath(input.file_path); break;
    case "Read": verb = "read"; target = shortPath(input.file_path); break;
    case "Bash": verb = "run"; target = input.description || (input.command || "").substring(0, 80); break;
    case "Grep": verb = "search"; target = input.pattern || ""; break;
    case "Glob": verb = "search for files in"; target = input.pattern || ""; break;
    case "WebFetch": verb = "fetch"; target = input.url || ""; break;
    case "WebSearch": verb = "search the web for"; target = input.query || ""; break;
  }
  return { verb: verb, target: target };
}

var EMPTY_MESSAGES = [
  "Quiet. Too quiet.",
  "Nothing. Suspiciously nothing.",
  "Inbox zero. Brag about it.",
  "No notifications. Are you even working?",
  "All clear. For now.",
  "The void stares back.",
  "Notification-free since just now.",
  "You have 0 problems. Allegedly.",
  "Tumbleweeds.",
  "Your agents are napping.",
];

function randomEmptyMessage() {
  return EMPTY_MESSAGES[Math.floor(Math.random() * EMPTY_MESSAGES.length)];
}

function getProjectIcon(slug) {
  var projects = getCachedProjects();
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].slug === slug) return projects[i].icon || null;
  }
  return null;
}

function getProjectName(slug) {
  var projects = getCachedProjects();
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].slug === slug) return projects[i].title || projects[i].name || slug;
  }
  return slug;
}
