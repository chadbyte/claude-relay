// sidebar-mates.js - User/mate strip, DM picker, context menus, tooltips, presence
// Extracted from sidebar.js (PR-37)

import { userAvatarUrl, mateAvatarUrl } from './avatar.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { showMateProfilePopover } from './profile.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { closeProjectCtxMenu } from './sidebar-projects.js';
import { spawnDustParticles } from './sidebar.js';
import { openDm } from './app-dm.js';
import { openMateWizard } from './mate-wizard.js';
import { openUserSettings } from './user-settings.js';
import { getCachedProjects } from './app-projects.js';

function sendWs(msg) {
  var ws = getWs();
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// --- User strip state ---
var cachedAllUsers = [];
var cachedOnlineUserIds = [];
var cachedDmFavorites = [];
var cachedDmConversations = [];
var cachedDmUnread = {};
var cachedMyUserId = null;
var currentDmUserId = null;
var dmPickerOpen = false;
var cachedDmRemovedUsers = {};
var cachedMates = [];
var activeMentionMateIds = {};

export function setMentionActive(mateId, active) {
  if (active) { activeMentionMateIds[mateId] = true; }
  else { delete activeMentionMateIds[mateId]; }
}

export function clearAllMentionActive() {
  activeMentionMateIds = {};
}
var _lastUserStripJson = "";

// --- Icon strip tooltip ---
var iconStripTooltip = null;

// --- DM user context menu ---
var userCtxMenu = null;

export function initSidebarMates() {
  // --- Reactive UI sync for user strip ---
  store.subscribe(function (state, prev) {
    if (state.cachedAllUsers !== prev.cachedAllUsers ||
        state.cachedOnlineIds !== prev.cachedOnlineIds ||
        state.cachedDmFavorites !== prev.cachedDmFavorites ||
        state.cachedDmConversations !== prev.cachedDmConversations ||
        state.dmUnread !== prev.dmUnread ||
        state.dmRemovedUsers !== prev.dmRemovedUsers ||
        state.cachedMatesList !== prev.cachedMatesList ||
        state.myUserId !== prev.myUserId) {
      renderUserStrip();
    }
  });
}

export function showIconTooltip(el, text) {
  hideIconTooltip();
  var tip = document.createElement("div");
  tip.className = "icon-strip-tooltip";
  tip.textContent = text;
  document.body.appendChild(tip);
  iconStripTooltip = tip;

  requestAnimationFrame(function () {
    var rect = el.getBoundingClientRect();
    tip.style.top = (rect.top + rect.height / 2 - tip.offsetHeight / 2) + "px";
    tip.classList.add("visible");
  });
}

export function showIconTooltipHtml(el, html) {
  hideIconTooltip();
  var tip = document.createElement("div");
  tip.className = "icon-strip-tooltip";
  tip.style.whiteSpace = "normal";
  tip.style.maxWidth = "260px";
  tip.innerHTML = html;
  document.body.appendChild(tip);
  iconStripTooltip = tip;

  requestAnimationFrame(function () {
    var rect = el.getBoundingClientRect();
    tip.style.top = (rect.top + rect.height / 2 - tip.offsetHeight / 2) + "px";
    tip.classList.add("visible");
  });
}

export function hideIconTooltip() {
  if (iconStripTooltip) {
    iconStripTooltip.remove();
    iconStripTooltip = null;
  }
}

export function closeUserCtxMenu() {
  if (userCtxMenu) {
    userCtxMenu.remove();
    userCtxMenu = null;
  }
  document.removeEventListener("click", handleUserCtxOutsideClick, true);
}

function showUserCtxMenu(anchorEl, user) {
  closeUserCtxMenu();
  if (closeProjectCtxMenu) closeProjectCtxMenu();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  var removeItem = document.createElement("button");
  removeItem.className = "project-ctx-item project-ctx-delete";
  removeItem.innerHTML = iconHtml("user-minus") + " <span>Remove from favorites</span>";
  removeItem.addEventListener("click", function (e) {
    e.stopPropagation();
    // Spawn dust particles at the user icon position
    var iconRect = anchorEl.getBoundingClientRect();
    if (spawnDustParticles) spawnDustParticles(iconRect.left + iconRect.width / 2, iconRect.top + iconRect.height / 2);
    closeUserCtxMenu();
    // Immediately mark as removed so strip re-render hides the icon,
    // even if the user was only visible via cachedDmConversations (not favorites)
    cachedDmRemovedUsers[user.id] = true;
    var dr = Object.assign({}, store.get('dmRemovedUsers')); dr[user.id] = true; store.set({ dmRemovedUsers: dr });
    // renderUserStrip is handled by the store subscriber
    sendWs({ type: "dm_remove_favorite", targetUserId: user.id });
  });
  menu.appendChild(removeItem);

  document.body.appendChild(menu);
  userCtxMenu = menu;
  refreshIcons();

  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = (rect.right + 6) + "px";
    menu.style.top = rect.top + "px";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      menu.style.left = (rect.left - menuRect.width - 6) + "px";
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
    }
  });

  // Close on outside click
  setTimeout(function () {
    document.addEventListener("click", handleUserCtxOutsideClick, true);
  }, 0);
}

function handleUserCtxOutsideClick(e) {
  if (userCtxMenu && !userCtxMenu.contains(e.target)) {
    closeUserCtxMenu();
  }
}

function showMateCtxMenu(anchorEl, mate) {
  // Primary mates cannot be edited or removed
  if (mate.primary) return;

  closeUserCtxMenu();
  if (closeProjectCtxMenu) closeProjectCtxMenu();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  // Edit Profile item
  var editItem = document.createElement("button");
  editItem.className = "project-ctx-item";
  editItem.innerHTML = iconHtml("edit-2") + " <span>Edit Profile</span>";
  editItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeUserCtxMenu();
    showMateProfilePopover(anchorEl, mate, function (updates) {
      sendWs({ type: "mate_update", mateId: mate.id, updates: updates });
    });
  });
  menu.appendChild(editItem);

  var removeItem = document.createElement("button");
  removeItem.className = "project-ctx-item";
  removeItem.innerHTML = iconHtml("star-off") + " <span>Remove from favorites</span>";
  removeItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeUserCtxMenu();
    // Spawn dust particles at the mate icon position
    var iconRect = anchorEl.getBoundingClientRect();
    if (spawnDustParticles) spawnDustParticles(iconRect.left + iconRect.width / 2, iconRect.top + iconRect.height / 2);
    sendWs({ type: "dm_remove_favorite", targetUserId: mate.id });
  });
  menu.appendChild(removeItem);

  document.body.appendChild(menu);
  userCtxMenu = menu;
  refreshIcons();

  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = (rect.right + 6) + "px";
    menu.style.top = rect.top + "px";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      menu.style.left = (rect.left - menuRect.width - 6) + "px";
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
    }
  });

  setTimeout(function () {
    document.addEventListener("click", handleUserCtxOutsideClick, true);
  }, 0);
}

var _lastSidebarPresenceIds = [];
export function renderSidebarPresence(onlineUsers) {
  var container = document.getElementById("sidebar-presence");
  if (!container) return;
  if (!onlineUsers || onlineUsers.length < 2) {
    if (_lastSidebarPresenceIds.length > 0) {
      _lastSidebarPresenceIds = [];
      container.innerHTML = "";
    }
    return;
  }
  // Skip re-render if same users
  var newIds = onlineUsers.map(function (u) { return u.id; }).sort();
  if (newIds.length === _lastSidebarPresenceIds.length && newIds.every(function (id, i) { return id === _lastSidebarPresenceIds[i]; })) return;
  _lastSidebarPresenceIds = newIds;
  container.innerHTML = "";
  var maxShow = 4;
  for (var i = 0; i < Math.min(onlineUsers.length, maxShow); i++) {
    var ou = onlineUsers[i];
    var img = document.createElement("img");
    img.className = "sidebar-presence-avatar";
    img.src = presenceAvatarUrl(ou);
    img.alt = ou.displayName;
    img.dataset.tip = ou.displayName + " (@" + ou.username + ")";
    container.appendChild(img);
  }
  if (onlineUsers.length > maxShow) {
    var more = document.createElement("span");
    more.className = "sidebar-presence-more";
    more.textContent = "+" + (onlineUsers.length - maxShow);
    container.appendChild(more);
  }
}

// Presence avatar URL helper
function presenceAvatarUrl(userOrStyle) {
  if (userOrStyle && typeof userOrStyle === "object") return userAvatarUrl(userOrStyle, 24);
  return userAvatarUrl({ avatarStyle: userOrStyle || "thumbs" }, 24);
}

// renderUserStrip: call with no args to read from store (subscriber pattern),
// or with all 8 args for legacy compatibility.
export function renderUserStrip(allUsers, onlineUserIds, myUserId, dmFavorites, dmConversations, dmUnread, dmRemovedUsers, matesList) {
  if (arguments.length === 0) {
    var s = store.snap();
    allUsers = s.cachedAllUsers;
    onlineUserIds = s.cachedOnlineIds;
    myUserId = s.myUserId;
    dmFavorites = s.cachedDmFavorites;
    dmConversations = s.cachedDmConversations;
    dmUnread = s.dmUnread;
    dmRemovedUsers = s.dmRemovedUsers;
    matesList = s.cachedMatesList;
  }
  // Skip full DOM rebuild if input data hasn't changed
  var fingerprint = JSON.stringify([allUsers, onlineUserIds, dmFavorites, dmConversations, dmUnread, dmRemovedUsers, matesList]);
  if (fingerprint === _lastUserStripJson) return;
  _lastUserStripJson = fingerprint;

  cachedMates = matesList || cachedMates || [];
  cachedAllUsers = allUsers || [];
  cachedOnlineUserIds = onlineUserIds || [];
  cachedDmFavorites = dmFavorites || [];
  cachedDmConversations = dmConversations || [];
  cachedDmUnread = dmUnread || {};
  cachedDmRemovedUsers = dmRemovedUsers || {};
  cachedMyUserId = myUserId;
  var container = document.getElementById("icon-strip-users");
  if (!container) return;

  // All other users
  var allOthers = cachedAllUsers.filter(function (u) { return u.id !== myUserId; });

  // Hide section if no other users and no mates
  if (allOthers.length === 0 && cachedMates.length === 0) {
    container.innerHTML = "";
    container.classList.add("hidden");
    return;
  }

  // Filter to show only: favorites + users with unread + users with DM conversations
  // But exclude users explicitly removed from favorites
  var others = allOthers.filter(function (u) {
    if (cachedDmRemovedUsers[u.id]) return false;
    if (cachedDmFavorites.indexOf(u.id) !== -1) return true;
    if (cachedDmUnread[u.id] && cachedDmUnread[u.id] > 0) return true;
    if (cachedDmConversations.indexOf(u.id) !== -1) return true;
    return false;
  });

  container.classList.remove("hidden");
  container.innerHTML = "";

  for (var i = 0; i < others.length; i++) {
    (function (u) {
      var el = document.createElement("div");
      el.className = "icon-strip-user";
      el.dataset.userId = u.id;
      if (u.id === currentDmUserId) el.classList.add("active");
      if (onlineUserIds.indexOf(u.id) !== -1) el.classList.add("online");

      var pill = document.createElement("span");
      pill.className = "icon-strip-pill";
      el.appendChild(pill);

      var avatar = document.createElement("img");
      avatar.className = "icon-strip-user-avatar";
      avatar.src = userAvatarUrl(u, 34);
      avatar.alt = u.displayName;
      el.appendChild(avatar);

      var onlineDot = document.createElement("span");
      onlineDot.className = "icon-strip-user-online";
      el.appendChild(onlineDot);

      var badge = document.createElement("span");
      badge.className = "icon-strip-user-badge";
      badge.dataset.userId = u.id;
      el.appendChild(badge);

      // Tooltip
      el.addEventListener("mouseenter", function () { showIconTooltip(el, u.displayName); });
      el.addEventListener("mouseleave", hideIconTooltip);

      // Click: open DM
      el.addEventListener("click", function () {
        if (openDm) openDm(u.id);
      });

      // Right-click: show context menu
      el.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showUserCtxMenu(el, u);
      });

      container.appendChild(el);
    })(others[i]);
  }

  // Build mate project status lookup from project list
  var mateProjectStatus = {};
  var _projList = getCachedProjects() || [];
  if (_projList.length) {
    var allProjects = _projList;
    for (var pi = 0; pi < allProjects.length; pi++) {
      if (allProjects[pi].isMate) {
        mateProjectStatus[allProjects[pi].slug] = allProjects[pi];
      }
    }
  }

  // Render mates: only favorited or unread, regardless of mode. Previously
  // single-user mode short-circuited to "show all", which meant users who
  // never engaged with Mates still saw 6 permanent avatars in the rail
  // with no way to thin them out (#341). Applying the same filter as
  // multi-user lets users curate the icon strip via favorites; the full
  // mate list is still reachable from the DM picker.
  var favoriteMates = cachedMates.filter(function (m) {
    if (cachedDmRemovedUsers[m.id]) return false;
    if (cachedDmFavorites.indexOf(m.id) !== -1) return true;
    if (cachedDmUnread[m.id] && cachedDmUnread[m.id] > 0) return true;
    return false;
  });
  var sortedMates = favoriteMates.sort(function (a, b) {
    var aBuiltin = a.builtinKey ? 1 : 0;
    var bBuiltin = b.builtinKey ? 1 : 0;
    if (aBuiltin !== bBuiltin) return bBuiltin - aBuiltin;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  for (var mi = 0; mi < sortedMates.length; mi++) {
    (function (mate) {
      var mp = mate.profile || {};
      var mateSlug = "mate-" + mate.id;
      var mateProj = mateProjectStatus[mateSlug] || {};
      var isActive = mate.id === currentDmUserId;
      var el = document.createElement("div");
      el.className = "icon-strip-user icon-strip-mate";
      el.dataset.userId = mate.id;
      el.dataset.mateSlug = mateSlug;
      if (isActive) el.classList.add("active");

      // Pending permission shake
      if (mateProj.pendingPermissions > 0 && !isActive) {
        el.classList.add("has-pending-perm");
      }

      var pill = document.createElement("span");
      pill.className = "icon-strip-pill";
      el.appendChild(pill);

      var avatar = document.createElement("img");
      avatar.className = "icon-strip-user-avatar" + (mate.primary ? " icon-strip-primary-mate" : "");
      avatar.src = mateAvatarUrl(mate, 34);
      avatar.alt = mp.displayName || mate.name || "Mate";
      var mateColor = (mp.avatarColor) || mate.avatarColor || "#7c3aed";
      avatar.style.background = mateColor + "30";
      el.appendChild(avatar);

      // Processing status dot (IO blink) - top-left
      var statusDot = document.createElement("span");
      statusDot.className = "icon-strip-status";
      var isMentionActive = !!activeMentionMateIds[mate.id];
      if (mateProj.isProcessing || isMentionActive) statusDot.classList.add("processing");
      if (isMentionActive) el.classList.add("mention-active");
      el.appendChild(statusDot);

      // Mate badge (bot icon)
      var mateBadge = document.createElement("span");
      mateBadge.className = "icon-strip-user-mate-badge";
      mateBadge.innerHTML = iconHtml("bot");
      el.appendChild(mateBadge);

      var badge = document.createElement("span");
      badge.className = "icon-strip-user-badge";
      badge.dataset.userId = mate.id;
      el.appendChild(badge);

      // Restore unread badge if cached
      var unreadCount = cachedDmUnread[mate.id] || 0;
      if (unreadCount > 0 && !isActive) {
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        badge.classList.add("has-unread");
      }

      // Tooltip
      var displayName = mp.displayName || mate.name || "New Mate";
      var mateVendor = mate.vendor || "claude";
      var vendorLabels = { claude: "Claude Code", codex: "OpenAI Codex" };
      el.addEventListener("mouseenter", function () {
        var html = '<div style="font-weight:600">' + escapeHtml(displayName);
        if (mate.primary) {
          html += ' <span style="font-size:10px;font-weight:600;color:#00b894;background:rgba(0,184,148,0.1);padding:1px 5px;border-radius:3px;margin-left:4px">SYSTEM</span>';
        }
        html += '</div>';
        if (mate.bio) {
          html += '<div style="font-weight:400;font-size:12px;color:var(--text-secondary);margin-top:2px">' + escapeHtml(mate.bio) + '</div>';
        }
        var vendorLabel = vendorLabels[mateVendor] || mateVendor;
        html += '<div style="font-size:11px;color:var(--text-dimmer);margin-top:3px">Powered by ' + escapeHtml(vendorLabel) + '</div>';
        showIconTooltipHtml(el, html);
      });
      el.addEventListener("mouseleave", hideIconTooltip);

      // Click: open DM with mate
      el.addEventListener("click", function () {
        if (openDm) openDm(mate.id);
      });

      // Right-click: context menu for mate
      el.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showMateCtxMenu(el, mate);
      });

      container.appendChild(el);
    })(sortedMates[mi]);
  }

  // Show container if we have mates even with no other users
  if (cachedMates.length > 0) {
    container.classList.remove("hidden");
  }

  // Add user (+) button
  var addBtn = document.createElement("button");
  addBtn.className = "icon-strip-invite";
  addBtn.innerHTML = iconHtml("user-plus");
  addBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    toggleDmUserPicker(addBtn);
  });
  addBtn.addEventListener("mouseenter", function () { showIconTooltip(addBtn, "Add user or create mate"); });
  addBtn.addEventListener("mouseleave", hideIconTooltip);
  container.appendChild(addBtn);
  refreshIcons();
}

function toggleDmUserPicker(anchorEl) {
  if (dmPickerOpen) {
    closeDmUserPicker();
    return;
  }
  dmPickerOpen = true;

  var picker = document.createElement("div");
  picker.className = "dm-user-picker";
  picker.id = "dm-user-picker";

  // Mates enabled flag is consulted up here so the search input can drop
  // mates from its placeholder copy when the section is hidden.
  var matesEnabled = store.get('matesEnabled') !== false;

  // Search input
  var searchInput = document.createElement("input");
  searchInput.className = "dm-user-picker-search";
  searchInput.type = "text";
  searchInput.placeholder = matesEnabled
    ? "Search mates and users..."
    : "Search users...";
  picker.appendChild(searchInput);

  // User list element (appended later, after USERS label)
  var listEl = document.createElement("div");
  listEl.className = "dm-user-picker-list";

  // Position the picker above the + button
  document.body.appendChild(picker);
  var rect = anchorEl.getBoundingClientRect();
  picker.style.left = (rect.right + 8) + "px";
  picker.style.bottom = (window.innerHeight - rect.bottom) + "px";

  function renderPickerList(filter) {
    listEl.innerHTML = "";
    var allOthers = cachedAllUsers.filter(function (u) { return u.id !== cachedMyUserId; });
    // Exclude already-favorited users
    var available = allOthers.filter(function (u) {
      return cachedDmFavorites.indexOf(u.id) === -1;
    });
    if (filter) {
      var lf = filter.toLowerCase();
      available = available.filter(function (u) {
        return (u.displayName && u.displayName.toLowerCase().indexOf(lf) !== -1) ||
               (u.username && u.username.toLowerCase().indexOf(lf) !== -1);
      });
    }
    if (available.length === 0) {
      var emptyEl = document.createElement("div");
      emptyEl.className = "dm-user-picker-empty";
      emptyEl.textContent = filter ? "No users found" : "No more users to add";
      listEl.appendChild(emptyEl);
      return;
    }
    for (var i = 0; i < available.length; i++) {
      (function (u) {
        var item = document.createElement("div");
        item.className = "dm-user-picker-item";

        var av = document.createElement("img");
        av.className = "dm-user-picker-avatar";
        av.src = userAvatarUrl(u, 28);
        av.alt = u.displayName;
        item.appendChild(av);

        var name = document.createElement("span");
        name.className = "dm-user-picker-name";
        name.textContent = u.displayName;
        item.appendChild(name);

        item.addEventListener("click", function () {
          sendWs({ type: "dm_add_favorite", targetUserId: u.id });
          closeDmUserPicker();
        });

        listEl.appendChild(item);
      })(available[i]);
    }
  }

  // --- Layout depends on whether Mates is enabled ---
  // When enabled: Mates section first, then Users. Mates list is fully
  // rendered with delete buttons, create-mate entry, etc.
  // When disabled: Users first, then a Mates discovery promo (animated
  // avatar marquee + value prop + a single CTA that deep-links into
  // User Settings → Mates). We deliberately don't render the actual
  // mate list when off — showing real mates with greyed-out trash icons
  // is visually heavy and contradicts the user's choice to hide them.
  // (matesEnabled is computed earlier near the search input.)

  // matesListEl + renderMatesList are only used in the enabled layout.
  // Declared up-front so the search handler can reference renderMatesList
  // safely; renderMatesList stays a no-op in disabled mode.
  var matesListEl = null;
  var renderMatesList = function () {};

  function renderMatesEnabledSection() {
    var matesSectionLabel = document.createElement("div");
    matesSectionLabel.className = "dm-user-picker-section";
    matesSectionLabel.textContent = "Mates";
    picker.appendChild(matesSectionLabel);

    matesListEl = document.createElement("div");
    matesListEl.className = "dm-user-picker-list dm-mates-list";
    picker.appendChild(matesListEl);

    // Update scroll gradient hint
    function updateMatesScrollHint() {
      var isOverflow = matesListEl.scrollHeight > matesListEl.clientHeight + 2;
      if (!isOverflow) {
        matesListEl.classList.add("no-overflow");
        matesListEl.classList.remove("scrolled-bottom");
        return;
      }
      matesListEl.classList.remove("no-overflow");
      var atBottom = matesListEl.scrollTop + matesListEl.clientHeight >= matesListEl.scrollHeight - 4;
      if (atBottom) {
        matesListEl.classList.add("scrolled-bottom");
      } else {
        matesListEl.classList.remove("scrolled-bottom");
      }
    }
    matesListEl.addEventListener("scroll", updateMatesScrollHint);

    renderMatesList = function (filter) {
    matesListEl.innerHTML = "";
    var allMates = cachedMates || [];
    if (filter) {
      var lf = filter.toLowerCase();
      allMates = allMates.filter(function (m) {
        var name = (m.profile && m.profile.displayName) || m.name || "";
        return name.toLowerCase().indexOf(lf) !== -1;
      });
    }
    // Build unified list: installed builtins, deleted builtins, user-created
    var availBuiltins = store.get('cachedAvailableBuiltins') || [];
    var entries = [];
    // 1. Installed builtin mates
    for (var si = 0; si < allMates.length; si++) {
      if (allMates[si].builtinKey) entries.push({ type: "mate", data: allMates[si] });
    }
    // 2. Deleted builtins (only when not filtering)
    if (!filter) {
      for (var di = 0; di < availBuiltins.length; di++) {
        entries.push({ type: "deleted", data: availBuiltins[di] });
      }
    }
    // 3. User-created mates
    var userMates = allMates.filter(function (m) { return !m.builtinKey; });
    userMates.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    for (var ui = 0; ui < userMates.length; ui++) {
      entries.push({ type: "mate", data: userMates[ui] });
    }

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.type === "deleted") {
        // Deleted builtin: show with "+ Add" button
        (function (b) {
          var bItem = document.createElement("div");
          bItem.className = "dm-user-picker-item dm-user-picker-builtin-item";
          bItem.style.opacity = "0.7";
          var bAv = document.createElement("img");
          bAv.className = "dm-user-picker-avatar";
          bAv.src = mateAvatarUrl({ avatarCustom: b.avatarCustom, avatarStyle: b.avatarStyle || "bottts", avatarSeed: b.displayName, id: b.key }, 28);
          bAv.alt = b.displayName;
          bItem.appendChild(bAv);
          var bNameWrap = document.createElement("div");
          bNameWrap.style.cssText = "flex:1;min-width:0;";
          var bName = document.createElement("span");
          bName.className = "dm-user-picker-name";
          bName.textContent = b.displayName;
          bNameWrap.appendChild(bName);
          var bBio = document.createElement("div");
          bBio.style.cssText = "font-size:11px;color:var(--text-dimmer);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          bBio.textContent = b.bio || b.displayName;
          bNameWrap.appendChild(bBio);
          bItem.appendChild(bNameWrap);
          var bAddBtn = document.createElement("button");
          bAddBtn.style.cssText = "border:none;background:none;cursor:pointer;padding:2px 6px;color:var(--accent, #6366f1);font-size:12px;font-weight:600;white-space:nowrap;";
          bAddBtn.textContent = "+ Add";
          bAddBtn.title = "Re-add " + b.displayName;
          bAddBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            sendWs({ type: "mate_readd_builtin", builtinKey: b.key });
            closeDmUserPicker();
          });
          bItem.appendChild(bAddBtn);
          bItem.addEventListener("click", function () {
            sendWs({ type: "mate_readd_builtin", builtinKey: b.key });
            closeDmUserPicker();
          });
          matesListEl.appendChild(bItem);
        })(entry.data);
      } else {
        // Normal mate
        (function (m) {
          var mp = m.profile || {};
          var isFav = cachedDmFavorites.indexOf(m.id) !== -1;
          var item = document.createElement("div");
          item.className = "dm-user-picker-item";
          if (isFav) item.classList.add("dm-picker-fav");
          var av = document.createElement("img");
          av.className = "dm-user-picker-avatar";
          av.src = mateAvatarUrl(m, 28);
          av.alt = mp.displayName || m.name || "Mate";
          item.appendChild(av);
          var nameWrap = document.createElement("div");
          nameWrap.style.cssText = "flex:1;min-width:0;";
          var name = document.createElement("span");
          name.className = "dm-user-picker-name";
          name.textContent = mp.displayName || m.name || "Mate";
          nameWrap.appendChild(name);
          if (m.bio) {
            var bio = document.createElement("div");
            bio.style.cssText = "font-size:11px;color:var(--text-dimmer);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            bio.textContent = m.bio;
            nameWrap.appendChild(bio);
          }
          item.appendChild(nameWrap);
          // Delete button with inline confirm
          var delBtn = document.createElement("button");
          delBtn.className = "dm-picker-del-btn";
          delBtn.innerHTML = m.builtinKey ? iconHtml("minus-circle") : iconHtml("trash-2");
          delBtn.title = m.builtinKey ? "Remove mate" : "Delete mate";
          delBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            var origHtml = item.innerHTML;
            item.innerHTML = "";
            item.style.justifyContent = "center";
            item.style.gap = "6px";
            var confirmMsg = document.createElement("span");
            confirmMsg.style.cssText = "font-size:12px;color:var(--text-dimmer);";
            confirmMsg.textContent = m.builtinKey ? "Remove? You can add back anytime." : "Delete permanently?";
            item.appendChild(confirmMsg);
            var yesBtn = document.createElement("button");
            yesBtn.style.cssText = "border:none;background:var(--danger,#e74c3c);color:#fff;padding:3px 10px;border-radius:4px;font-size:12px;cursor:pointer;";
            yesBtn.textContent = m.builtinKey ? "Remove" : "Delete";
            yesBtn.addEventListener("click", function (e2) {
              e2.stopPropagation();
              sendWs({ type: "mate_delete", mateId: m.id });
              closeDmUserPicker();
            });
            item.appendChild(yesBtn);
            var noBtn = document.createElement("button");
            noBtn.style.cssText = "border:1px solid var(--border);background:none;color:var(--text);padding:3px 10px;border-radius:4px;font-size:12px;cursor:pointer;";
            noBtn.textContent = "Cancel";
            noBtn.addEventListener("click", function (e2) {
              e2.stopPropagation();
              item.innerHTML = origHtml;
              item.style.justifyContent = "";
              item.style.gap = "";
              refreshIcons();
            });
            item.appendChild(noBtn);
          });
          item.appendChild(delBtn);
          item.addEventListener("click", function () {
            if (openDm) openDm(m.id);
            if (!isFav) sendWs({ type: "dm_add_favorite", targetUserId: m.id });
            closeDmUserPicker();
          });
          matesListEl.appendChild(item);
        })(entry.data);
      }
    }

    if (entries.length === 0 && filter) {
      var emptyEl = document.createElement("div");
      emptyEl.className = "dm-user-picker-empty";
      emptyEl.textContent = "No mates found";
      matesListEl.appendChild(emptyEl);
    }
      refreshIcons();
      requestAnimationFrame(updateMatesScrollHint);
    };

    // Create Mate option
    var createMateEl = document.createElement("div");
    createMateEl.className = "dm-user-picker-create-mate";
    var hasCustomMates = (cachedMates || []).some(function (m) { return !m.builtinKey; });
    var createMateLabel = hasCustomMates ? "Create a Mate" : "Create a Mate for what you're doing";
    createMateEl.innerHTML = iconHtml("bot") + " <span>" + createMateLabel + "</span>";
    createMateEl.addEventListener("click", function () {
      closeDmUserPicker();
      if (openMateWizard) openMateWizard();
    });
    picker.appendChild(createMateEl);

    // Divider
    var divider = document.createElement("div");
    divider.style.borderTop = "1px solid var(--border, #333)";
    divider.style.margin = "4px 0";
    picker.appendChild(divider);

    // Users section
    var usersLabelEnabled = document.createElement("div");
    usersLabelEnabled.className = "dm-user-picker-section";
    usersLabelEnabled.textContent = "Users";
    picker.appendChild(usersLabelEnabled);
    picker.appendChild(listEl);
  }

  function renderMatesDisabledLayout() {
    // Users section first when Mates is off — they are the only thing
    // a user can actually act on, so they lead.
    var usersLabel = document.createElement("div");
    usersLabel.className = "dm-user-picker-section";
    usersLabel.textContent = "Users";
    picker.appendChild(usersLabel);
    picker.appendChild(listEl);

    // Divider
    var divider = document.createElement("div");
    divider.style.borderTop = "1px solid var(--border, #333)";
    divider.style.margin = "8px 0 4px";
    picker.appendChild(divider);

    // Mates discovery promo: animated avatar marquee + value prop + CTA.
    // The marquee uses real cached mate avatars purely as decoration; we
    // never attach click handlers, never show delete buttons, and never
    // render a list view — turning the section into a soft invitation
    // rather than a "list with everything greyed out" tease.
    var promo = document.createElement("div");
    promo.className = "dm-picker-mates-promo";

    var promoLabel = document.createElement("div");
    promoLabel.className = "dm-user-picker-section";
    promoLabel.textContent = "Mates";
    promo.appendChild(promoLabel);

    var marqueeWrap = document.createElement("div");
    marqueeWrap.className = "dm-picker-mates-marquee";
    var marqueeTrack = document.createElement("div");
    marqueeTrack.className = "dm-picker-mates-marquee-track";
    var marqueeSource = (cachedMates && cachedMates.length > 0)
      ? cachedMates.slice(0, 8)
      : (store.get('cachedAvailableBuiltins') || []).slice(0, 6);
    // Duplicate the avatar set so the keyframe loop wraps seamlessly.
    for (var copy = 0; copy < 2; copy++) {
      for (var mi = 0; mi < marqueeSource.length; mi++) {
        var src = marqueeSource[mi];
        var avEl = document.createElement("img");
        avEl.className = "dm-picker-mates-marquee-avatar";
        avEl.alt = "";
        avEl.setAttribute("aria-hidden", "true");
        if (src.id) {
          avEl.src = mateAvatarUrl(src, 32);
        } else {
          avEl.src = mateAvatarUrl({
            avatarCustom: src.avatarCustom,
            avatarStyle: src.avatarStyle || "bottts",
            avatarSeed: src.displayName,
            id: src.key,
          }, 32);
        }
        marqueeTrack.appendChild(avEl);
      }
    }
    marqueeWrap.appendChild(marqueeTrack);
    promo.appendChild(marqueeWrap);

    var promoText = document.createElement("div");
    promoText.className = "dm-picker-mates-promo-text";
    promoText.textContent = "Specialist AI teammates with long-term memory across sessions. Mention with @ for design, engineering, strategy, or marketing, or build your own.";
    promo.appendChild(promoText);

    var cta = document.createElement("button");
    cta.type = "button";
    cta.className = "dm-picker-mates-promo-cta";
    cta.textContent = "Click here to enable Mates";
    cta.addEventListener("click", function () {
      closeDmUserPicker();
      openUserSettings('us-mates');
    });
    promo.appendChild(cta);

    picker.appendChild(promo);
  }

  if (matesEnabled) {
    renderMatesEnabledSection();
    renderMatesList("");
    renderPickerList("");
    searchInput.addEventListener("input", function () {
      var val = searchInput.value;
      renderMatesList(val);
      renderPickerList(val);
    });
  } else {
    renderMatesDisabledLayout();
    renderPickerList("");
    searchInput.addEventListener("input", function () {
      renderPickerList(searchInput.value);
    });
  }

  // Focus search
  setTimeout(function () { searchInput.focus(); }, 50);

  // Close on click outside
  function onDocClick(e) {
    if (!picker.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
      closeDmUserPicker();
      document.removeEventListener("click", onDocClick, true);
    }
  }
  setTimeout(function () {
    document.addEventListener("click", onDocClick, true);
  }, 10);
  picker._docClickHandler = onDocClick;
}

export function closeDmUserPicker() {
  dmPickerOpen = false;
  var picker = document.getElementById("dm-user-picker");
  if (picker) {
    if (picker._docClickHandler) {
      document.removeEventListener("click", picker._docClickHandler, true);
    }
    picker.remove();
  }
}

export function setCurrentDmUser(userId) {
  currentDmUserId = userId;
  // Update active state on user icons immediately
  var container = document.getElementById("icon-strip-users");
  if (!container) return;
  var items = container.querySelectorAll(".icon-strip-user");
  for (var i = 0; i < items.length; i++) {
    if (items[i].dataset.userId === userId) {
      items[i].classList.add("active");
    } else {
      items[i].classList.remove("active");
    }
  }
}

export function updateDmBadge(userId, count) {
  var badge = document.querySelector('.icon-strip-user-badge[data-user-id="' + userId + '"]');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.add("has-unread");
  } else {
    badge.textContent = "";
    badge.classList.remove("has-unread");
  }
}

export function getCurrentDmUserId() {
  return currentDmUserId;
}

export function getCachedMates() {
  return cachedMates;
}

export function getCachedDmFavorites() {
  return cachedDmFavorites;
}

export function getCachedDmUnread() {
  return cachedDmUnread;
}

export function getCachedDmRemovedUsers() {
  return cachedDmRemovedUsers;
}
