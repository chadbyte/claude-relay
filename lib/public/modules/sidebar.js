import { avatarUrl, userAvatarUrl, mateAvatarUrl } from './avatar.js';
import { escapeHtml, copyToClipboard } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { openProjectSettings } from './project-settings.js';
import { triggerShare } from './qrcode.js';
import { parseEmojis } from './markdown.js';
import { getCurrentTheme, getChatLayout, setChatLayout } from './theme.js';
import { showMateProfilePopover } from './profile.js';
import { closeArchive } from './sticky-notes.js';
import { closeScheduler } from './scheduler.js';
import { openSearch as openSessionSearch } from './session-search.js';
import { openCommandPalette } from './command-palette.js';

var ctx;

// --- Session search ---
var searchQuery = "";
var searchMatchIds = null; // null = no search, Set of matched session IDs
var searchDebounce = null;
var cachedSessions = [];
var expandedLoopGroups = new Set();
var expandedLoopRuns = new Set();
var expandedMobileLoopGroups = new Set();
var expandedMobileLoopRuns = new Set();

// --- Cached project data for mobile sheet ---
var cachedProjectList = [];
var cachedCurrentSlug = null;
var mobileChatSheetOpen = false; // track if chat sheet is showing

function dismissOverlayPanels() {
  closeArchive();
  closeScheduler();
}

// --- Session presence (multi-user: who is viewing which session) ---
var sessionPresence = {}; // { sessionId: [{ id, displayName, avatarStyle, avatarSeed }] }

// --- Countdown timer for upcoming schedules ---
var countdownTimer = null;
var countdownContainer = null;

// --- Session context menu ---
var sessionCtxMenu = null;
var sessionCtxSessionId = null;

function closeSessionCtxMenu() {
  if (sessionCtxMenu) {
    sessionCtxMenu.remove();
    sessionCtxMenu = null;
    sessionCtxSessionId = null;
  }
}

function showSessionCtxMenu(anchorBtn, sessionId, title, cliSid, sessionData) {
  closeSessionCtxMenu();
  sessionCtxSessionId = sessionId;

  var menu = document.createElement("div");
  menu.className = "session-ctx-menu";

  var renameItem = document.createElement("button");
  renameItem.className = "session-ctx-item";
  renameItem.innerHTML = iconHtml("pencil") + " <span>Rename</span>";
  renameItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    startInlineRename(sessionId, title);
  });
  menu.appendChild(renameItem);

  // Session visibility toggle (only the session owner can change)
  if (ctx.multiUser && sessionData && sessionData.ownerId && sessionData.ownerId === ctx.myUserId) {
    var currentVis = (sessionData && sessionData.sessionVisibility) || "shared";
    var isPrivate = currentVis === "private";
    var visItem = document.createElement("button");
    visItem.className = "session-ctx-item";
    visItem.innerHTML = iconHtml(isPrivate ? "eye" : "eye-off") + " <span>" + (isPrivate ? "Make Shared" : "Make Private") + "</span>";
    visItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeSessionCtxMenu();
      var newVis = isPrivate ? "shared" : "private";
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "set_session_visibility", sessionId: sessionId, visibility: newVis }));
      }
    });
    menu.appendChild(visItem);
  }

  if (!ctx.permissions || ctx.permissions.sessionDelete !== false) {
    var deleteItem = document.createElement("button");
    deleteItem.className = "session-ctx-item session-ctx-delete";
    deleteItem.innerHTML = iconHtml("trash-2") + " <span>Delete</span>";
    deleteItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeSessionCtxMenu();
      ctx.showConfirm('Delete "' + (title || "New Session") + '"? This session and its history will be permanently removed.', function () {
        var ws = ctx.ws;
        if (ws && ctx.connected) {
          ws.send(JSON.stringify({ type: "delete_session", id: sessionId }));
        }
      });
    });
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  // Position: fixed relative to the anchor button
  requestAnimationFrame(function () {
    var btnRect = anchorBtn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (btnRect.bottom + 2) + "px";
    menu.style.right = (window.innerWidth - btnRect.right) + "px";
    menu.style.left = "auto";
    // If menu overflows below viewport, flip up
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (btnRect.top - menuRect.height - 2) + "px";
    }
  });
}

function startInlineRename(sessionId, currentTitle) {
  var el = ctx.sessionListEl.querySelector('.session-item[data-session-id="' + sessionId + '"]');
  if (!el) return;
  var textSpan = el.querySelector(".session-item-text");
  if (!textSpan) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = currentTitle || "New Session";

  var originalHtml = textSpan.innerHTML;
  textSpan.innerHTML = "";
  textSpan.appendChild(input);
  input.focus();
  input.select();

  function commitRename() {
    var newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "rename_session", id: sessionId, title: newTitle }));
    }
    // Restore text (server will send updated session_list)
    textSpan.innerHTML = originalHtml;
    if (newTitle && newTitle !== currentTitle) {
      textSpan.textContent = newTitle;
    }
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); textSpan.innerHTML = originalHtml; }
  });
  input.addEventListener("blur", commitRename);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

function showLoopCtxMenu(anchorBtn, loopId, loopName, childCount) {
  closeSessionCtxMenu();

  var menu = document.createElement("div");
  menu.className = "session-ctx-menu";

  var renameItem = document.createElement("button");
  renameItem.className = "session-ctx-item";
  renameItem.innerHTML = iconHtml("pencil") + " <span>Rename</span>";
  renameItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    startLoopInlineRename(loopId, loopName);
  });
  menu.appendChild(renameItem);

  if (!ctx.permissions || ctx.permissions.sessionDelete !== false) {
    var deleteItem = document.createElement("button");
    deleteItem.className = "session-ctx-item session-ctx-delete";
    deleteItem.innerHTML = iconHtml("trash-2") + " <span>Delete</span>";
    deleteItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeSessionCtxMenu();
      var msg = 'Delete "' + (loopName || "Ralph Loop") + '"';
      if (childCount > 1) msg += " and its " + childCount + " sessions";
      msg += "? This cannot be undone.";
      ctx.showConfirm(msg, function () {
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "delete_loop_group", loopId: loopId }));
        }
      });
    });
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  requestAnimationFrame(function () {
    var btnRect = anchorBtn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (btnRect.bottom + 2) + "px";
    menu.style.right = (window.innerWidth - btnRect.right) + "px";
    menu.style.left = "auto";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (btnRect.top - menuRect.height - 2) + "px";
    }
  });
}

function startLoopInlineRename(loopId, currentName) {
  var el = ctx.sessionListEl.querySelector('.session-loop-group[data-loop-id="' + loopId + '"]');
  if (!el) return;
  var textSpan = el.querySelector(".session-item-text");
  if (!textSpan) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = currentName || "Ralph Loop";

  var originalHtml = textSpan.innerHTML;
  textSpan.innerHTML = "";
  textSpan.appendChild(input);
  input.focus();
  input.select();

  function commitRename() {
    var newName = input.value.trim();
    if (newName && newName !== currentName && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "loop_registry_rename", id: loopId, name: newName }));
    }
    textSpan.innerHTML = originalHtml;
    if (newName && newName !== currentName) {
      // Update text inline immediately
      var nameNode = textSpan.querySelector(".session-loop-name");
      if (nameNode) nameNode.textContent = newName;
    }
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); textSpan.innerHTML = originalHtml; }
  });
  input.addEventListener("blur", commitRename);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

function getDateGroup(ts) {
  var now = new Date();
  var d = new Date(ts);
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var yesterday = new Date(today.getTime() - 86400000);
  var weekAgo = new Date(today.getTime() - 7 * 86400000);
  if (d >= today) return "Today";
  if (d >= yesterday) return "Yesterday";
  if (d >= weekAgo) return "This Week";
  return "Older";
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  var lower = text.toLowerCase();
  var qLower = query.toLowerCase();
  var idx = lower.indexOf(qLower);
  if (idx === -1) return escapeHtml(text);
  var before = text.substring(0, idx);
  var match = text.substring(idx, idx + query.length);
  var after = text.substring(idx + query.length);
  return escapeHtml(before) + '<mark class="session-highlight">' + escapeHtml(match) + '</mark>' + escapeHtml(after);
}

function renderLoopChild(s) {
  var el = document.createElement("div");
  var isMatch = searchMatchIds !== null && searchMatchIds.has(s.id);
  var dimmed = searchMatchIds !== null && !isMatch;
  el.className = "session-loop-child" + (s.active ? " active" : "") + (isMatch ? " search-match" : "") + (dimmed ? " search-dimmed" : "");
  el.dataset.sessionId = s.id;

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (s.isProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  if (s.loop) {
    var isRalphChild = s.loop.source === "ralph";
    var roleName = s.loop.role === "crafting" ? "Crafting" : s.loop.role === "judge" ? "Judge" : (isRalphChild ? "Coder" : "Run");
    var iterSuffix = s.loop.role === "crafting" ? "" : " #" + s.loop.iteration;
    var roleCls = s.loop.role === "crafting" ? " crafting" : (!isRalphChild ? " scheduled" : "");
    textHtml += '<span class="session-loop-role-badge' + roleCls + '">' + roleName + iterSuffix + '</span>';
  }
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

  el.addEventListener("click", (function (id) {
    return function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
        dismissOverlayPanels();
        closeSidebar();
      }
    };
  })(s.id));

  return el;
}

function renderLoopGroup(loopId, children, groupKey) {
  var gk = groupKey || loopId;

  // Sub-group children by startedAt (each run)
  var runMap = {};
  for (var i = 0; i < children.length; i++) {
    var runKey = String(children[i].loop && children[i].loop.startedAt || 0);
    if (!runMap[runKey]) runMap[runKey] = [];
    runMap[runKey].push(children[i]);
  }
  var runKeys = Object.keys(runMap);

  // Sort each run's children by iteration then role
  for (var ri = 0; ri < runKeys.length; ri++) {
    runMap[runKeys[ri]].sort(function (a, b) {
      var ai = (a.loop && a.loop.iteration) || 0;
      var bi = (b.loop && b.loop.iteration) || 0;
      if (ai !== bi) return ai - bi;
      var ar = (a.loop && a.loop.role === "judge") ? 1 : 0;
      var br = (b.loop && b.loop.role === "judge") ? 1 : 0;
      return ar - br;
    });
  }

  // Sort runs by startedAt descending (newest first)
  runKeys.sort(function (a, b) { return Number(b) - Number(a); });

  var expanded = expandedLoopGroups.has(gk);
  var hasActive = false;
  var anyProcessing = false;
  var latestSession = children[0];
  for (var ci = 0; ci < children.length; ci++) {
    if (children[ci].active) hasActive = true;
    if (children[ci].isProcessing) anyProcessing = true;
    if ((children[ci].lastActivity || 0) > (latestSession.lastActivity || 0)) {
      latestSession = children[ci];
    }
  }

  var loopName = (children[0].loop && children[0].loop.name) || "Ralph Loop";
  var isRalph = children[0].loop && children[0].loop.source === "ralph";
  var isCrafting = false;
  for (var j = 0; j < children.length; j++) {
    if (children[j].loop && children[j].loop.role === "crafting") isCrafting = true;
  }

  var runCount = runKeys.length;

  var wrapper = document.createElement("div");
  wrapper.className = "session-loop-wrapper";

  // Group header row
  var el = document.createElement("div");
  el.className = "session-loop-group" + (hasActive ? " active" : "") + (expanded ? " expanded" : "") + (isRalph ? "" : " scheduled");
  el.dataset.loopId = loopId;

  var chevron = document.createElement("button");
  chevron.className = "session-loop-chevron";
  chevron.innerHTML = iconHtml("chevron-right");
  chevron.addEventListener("click", (function (lid) {
    return function (e) {
      e.stopPropagation();
      if (expandedLoopGroups.has(lid)) {
        expandedLoopGroups.delete(lid);
      } else {
        expandedLoopGroups.add(lid);
      }
      renderSessionList(null);
    };
  })(gk));
  el.appendChild(chevron);

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (anyProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  var groupIcon = isRalph ? "repeat" : "calendar-clock";
  textHtml += '<span class="session-loop-icon' + (isRalph ? "" : " scheduled") + '">' + iconHtml(groupIcon) + '</span>';
  textHtml += '<span class="session-loop-name">' + escapeHtml(loopName) + '</span>';
  if (isCrafting && children.length === 1) {
    textHtml += '<span class="session-loop-badge crafting">Crafting</span>';
  } else {
    var countLabel = runCount === 1 ? children.length : runCount + (runCount === 1 ? " run" : " runs");
    textHtml += '<span class="session-loop-count' + (isRalph ? "" : " scheduled") + '">' + countLabel + '</span>';
  }
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

  // More button (ellipsis)
  var moreBtn = document.createElement("button");
  moreBtn.className = "session-more-btn";
  moreBtn.innerHTML = iconHtml("ellipsis");
  moreBtn.title = "More options";
  moreBtn.addEventListener("click", (function (lid, name, count, btn) {
    return function (e) {
      e.stopPropagation();
      showLoopCtxMenu(btn, lid, name, count);
    };
  })(loopId, loopName, children.length, moreBtn));
  el.appendChild(moreBtn);

  // Click row (not chevron/more) -> switch to latest session
  el.addEventListener("click", (function (id) {
    return function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
        dismissOverlayPanels();
        closeSidebar();
      }
    };
  })(latestSession.id));

  wrapper.appendChild(el);

  // Expanded: show runs as sub-groups
  if (expanded) {
    var childContainer = document.createElement("div");
    childContainer.className = "session-loop-children";

    if (runCount === 1) {
      // Single run: show sessions directly (no extra nesting)
      var singleRun = runMap[runKeys[0]];
      for (var sk = 0; sk < singleRun.length; sk++) {
        childContainer.appendChild(renderLoopChild(singleRun[sk]));
      }
    } else {
      // Multiple runs: render each run as a collapsible sub-group
      for (var rk = 0; rk < runKeys.length; rk++) {
        childContainer.appendChild(renderLoopRun(gk, runKeys[rk], runMap[runKeys[rk]], isRalph));
      }
    }

    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

function renderLoopRun(parentGk, startedAtKey, sessions, isRalph) {
  var runGk = parentGk + ":" + startedAtKey;
  var expanded = expandedLoopRuns.has(runGk);
  var startedAt = Number(startedAtKey);
  var timeLabel = startedAt ? new Date(startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Unknown";

  var hasActive = false;
  var anyProcessing = false;
  var latestSession = sessions[0];
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].active) hasActive = true;
    if (sessions[i].isProcessing) anyProcessing = true;
    if ((sessions[i].lastActivity || 0) > (latestSession.lastActivity || 0)) {
      latestSession = sessions[i];
    }
  }

  var wrapper = document.createElement("div");
  wrapper.className = "session-loop-run-wrapper";

  var el = document.createElement("div");
  el.className = "session-loop-run" + (hasActive ? " active" : "") + (expanded ? " expanded" : "") + (isRalph ? "" : " scheduled");

  var chevron = document.createElement("button");
  chevron.className = "session-loop-chevron";
  chevron.innerHTML = iconHtml("chevron-right");
  chevron.addEventListener("click", (function (rk) {
    return function (e) {
      e.stopPropagation();
      if (expandedLoopRuns.has(rk)) {
        expandedLoopRuns.delete(rk);
      } else {
        expandedLoopRuns.add(rk);
      }
      renderSessionList(null);
    };
  })(runGk));
  el.appendChild(chevron);

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (anyProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  textHtml += '<span class="session-loop-run-time">' + escapeHtml(timeLabel) + '</span>';
  textHtml += '<span class="session-loop-count' + (isRalph ? "" : " scheduled") + '">' + sessions.length + '</span>';
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

  // Click row -> switch to latest session of this run
  el.addEventListener("click", (function (id) {
    return function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
        dismissOverlayPanels();
        closeSidebar();
      }
    };
  })(latestSession.id));

  wrapper.appendChild(el);

  if (expanded) {
    var childContainer = document.createElement("div");
    childContainer.className = "session-loop-children";
    for (var k = 0; k < sessions.length; k++) {
      childContainer.appendChild(renderLoopChild(sessions[k]));
    }
    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

function renderSessionItem(s) {
  var el = document.createElement("div");
  var isMatch = searchMatchIds !== null && searchMatchIds.has(s.id);
  var dimmed = searchMatchIds !== null && !isMatch;
  el.className = "session-item" + (s.active ? " active" : "") + (isMatch ? " search-match" : "") + (dimmed ? " search-dimmed" : "");
  el.dataset.sessionId = s.id;

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (s.isProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  if (ctx.multiUser && s.sessionVisibility === "private") {
    textHtml += '<span class="session-private-icon" title="Private session">' + iconHtml("lock") + '</span>';
  }
  textHtml += highlightMatch(s.title || "New Session", searchQuery);
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

  // Right-click / long-press: context menu
  el.addEventListener("contextmenu", (function(id, title, cliSid, anchor, sData) {
    return function(e) {
      e.preventDefault();
      e.stopPropagation();
      showSessionCtxMenu(anchor, id, title, cliSid, sData);
    };
  })(s.id, s.title, s.cliSessionId, el, s));

  // Unread badge
  var unreadBadge = document.createElement("span");
  unreadBadge.className = "session-unread-badge";
  unreadBadge.dataset.sessionId = s.id;
  if (s.unread > 0) {
    unreadBadge.textContent = s.unread > 99 ? "99+" : String(s.unread);
    unreadBadge.classList.add("has-unread");
  }
  el.appendChild(unreadBadge);

  el.addEventListener("click", (function (id) {
    return function () {
      if (ctx.ws && ctx.connected) {
        var pendingQuery = searchQuery || "";
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
        dismissOverlayPanels();
        closeSidebar();
        if (pendingQuery) {
          setTimeout(function () { openSessionSearch(pendingQuery); }, 400);
        }
      }
    };
  })(s.id));

  // Presence avatars (multi-user)
  renderPresenceAvatars(el, String(s.id));

  return el;
}

export function renderSessionList(sessions) {
  if (sessions) cachedSessions = sessions;

  // If mobile chat sheet is open, refresh its session list
  refreshMobileChatSheet();

  ctx.sessionListEl.innerHTML = "";

  // Partition: loop sessions vs normal sessions
  // Group by loopId + date so all runs of the same task on the same day are merged
  var loopGroups = {}; // groupKey -> [sessions]
  var normalSessions = [];
  for (var i = 0; i < cachedSessions.length; i++) {
    var s = cachedSessions[i];
    if (s.loop && s.loop.loopId && s.loop.role === "crafting" && s.loop.source !== "ralph") {
      // Task crafting sessions live in the scheduler calendar, not the main list
      continue;
    } else if (s.loop && s.loop.loopId) {
      var startedAt = s.loop.startedAt || 0;
      var dateStr = startedAt ? new Date(startedAt).toISOString().slice(0, 10) : "unknown";
      var groupKey = s.loop.loopId + ":" + dateStr;
      if (!loopGroups[groupKey]) loopGroups[groupKey] = [];
      loopGroups[groupKey].push(s);
    } else {
      normalSessions.push(s);
    }
  }

  // Build virtual items: normal sessions + one entry per loop group (using latest child's lastActivity)
  var items = [];
  for (var j = 0; j < normalSessions.length; j++) {
    items.push({ type: "session", data: normalSessions[j], lastActivity: normalSessions[j].lastActivity || 0 });
  }
  var groupKeys = Object.keys(loopGroups);
  for (var k = 0; k < groupKeys.length; k++) {
    var gk = groupKeys[k];
    var children = loopGroups[gk];
    var realLoopId = children[0].loop.loopId;
    var maxActivity = 0;
    for (var m = 0; m < children.length; m++) {
      var act = children[m].lastActivity || 0;
      if (act > maxActivity) maxActivity = act;
    }
    items.push({ type: "loop", loopId: realLoopId, groupKey: gk, children: children, lastActivity: maxActivity });
  }

  // Sort by lastActivity descending
  items.sort(function (a, b) {
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  var currentGroup = "";
  for (var n = 0; n < items.length; n++) {
    var item = items[n];
    var group = getDateGroup(item.lastActivity || 0);
    if (group !== currentGroup) {
      currentGroup = group;
      var header = document.createElement("div");
      header.className = "session-group-header";
      header.textContent = group;
      ctx.sessionListEl.appendChild(header);
    }
    if (item.type === "loop") {
      ctx.sessionListEl.appendChild(renderLoopGroup(item.loopId, item.children, item.groupKey));
    } else {
      ctx.sessionListEl.appendChild(renderSessionItem(item.data));
    }
  }
  refreshIcons();
  updatePageTitle();
}

export function handleSearchResults(msg) {
  if (msg.query !== searchQuery) return; // stale response
  var ids = new Set();
  for (var i = 0; i < msg.results.length; i++) {
    ids.add(msg.results[i].id);
  }
  searchMatchIds = ids;
  renderSessionList(null);
}

export function updateSessionPresence(presence) {
  sessionPresence = presence;
  // Update presence avatars on existing session items without full re-render
  var items = ctx.sessionListEl.querySelectorAll("[data-session-id]");
  for (var i = 0; i < items.length; i++) {
    renderPresenceAvatars(items[i], items[i].dataset.sessionId);
  }
}

function presenceAvatarUrl(userOrStyle, seed) {
  if (userOrStyle && typeof userOrStyle === "object") return userAvatarUrl(userOrStyle, 24);
  return avatarUrl(userOrStyle || "thumbs", seed, 24);
}

function renderPresenceAvatars(el, sessionId) {
  // Remove existing presence container
  var existing = el.querySelector(".session-presence");
  if (existing) existing.remove();

  var users = sessionPresence[sessionId];
  if (!users || users.length === 0) return;

  var container = document.createElement("span");
  container.className = "session-presence";

  var max = 3;
  var shown = users.length > max ? max : users.length;
  for (var i = 0; i < shown; i++) {
    var u = users[i];
    var img = document.createElement("img");
    img.className = "session-presence-avatar";
    img.src = presenceAvatarUrl(u);
    img.alt = u.displayName;
    img.dataset.tip = u.displayName + (u.username ? " (@" + u.username + ")" : "");
    if (i > 0) img.style.marginLeft = "-6px";
    container.appendChild(img);
  }
  if (users.length > max) {
    var more = document.createElement("span");
    more.className = "session-presence-more";
    more.textContent = "+" + (users.length - max);
    container.appendChild(more);
  }

  // Insert before the more-btn
  var moreBtn = el.querySelector(".session-more-btn");
  if (moreBtn) {
    el.insertBefore(container, moreBtn);
  } else {
    el.appendChild(container);
  }
}

export function updatePageTitle() {
  var sessionTitle = "";
  var activeItem = ctx.sessionListEl.querySelector(".session-item.active .session-item-text");
  if (activeItem) sessionTitle = activeItem.textContent;
  if (ctx.headerTitleEl) {
    ctx.headerTitleEl.textContent = sessionTitle || ctx.projectName || "Clay";
  }
  var tbProjectName = ctx.$("title-bar-project-name");
  if (tbProjectName && ctx.projectName) {
    tbProjectName.textContent = ctx.projectName;
  } else if (tbProjectName && !tbProjectName.textContent) {
    // Fallback: derive name from URL slug when projectName not yet available
    var _m = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
    if (_m) tbProjectName.textContent = _m[1];
  }
  if (ctx.projectName && sessionTitle) {
    document.title = sessionTitle + " - " + ctx.projectName;
  } else if (ctx.projectName) {
    document.title = ctx.projectName + " - Clay";
  } else {
    document.title = "Clay";
  }
}

export function openSidebar() {
  ctx.sidebar.classList.add("open");
  ctx.sidebarOverlay.classList.add("visible");
}

export function closeSidebar() {
  ctx.sidebar.classList.remove("open");
  ctx.sidebarOverlay.classList.remove("visible");
}

// --- Mobile sheet (fullscreen overlay for Projects / Sessions / Mate Profile) ---

var mobileSheetMateData = null;

export function setMobileSheetMateData(data) {
  mobileSheetMateData = data;
}

export function openMobileSheet(type) {
  var sheet = document.getElementById("mobile-sheet");
  if (!sheet) return;

  var titleEl = sheet.querySelector(".mobile-sheet-title");
  var listEl = sheet.querySelector(".mobile-sheet-list");
  if (!titleEl || !listEl) return;

  // Return file tree to sidebar before clearing (prevents destroying it)
  if (sheet.classList.contains("sheet-files")) {
    var prevFileTree = document.getElementById("file-tree");
    var prevPanel = document.getElementById("sidebar-panel-files");
    if (prevFileTree && prevPanel) prevPanel.appendChild(prevFileTree);
  }
  // Return knowledge files to mate sidebar before clearing
  if (sheet.classList.contains("sheet-knowledge")) {
    var prevKnowledge = document.getElementById("mate-knowledge-files");
    var prevKnowledgePanel = document.getElementById("mate-sidebar-knowledge");
    if (prevKnowledge && prevKnowledgePanel) prevKnowledgePanel.appendChild(prevKnowledge);
  }

  listEl.innerHTML = "";
  sheet.classList.remove("sheet-files", "sheet-knowledge");

  if (type === "projects") {
    titleEl.textContent = "Projects";
    renderSheetProjects(listEl);
  } else if (type === "sessions") {
    titleEl.textContent = "Chat";
    renderSheetSessions(listEl);
  } else if (type === "files") {
    titleEl.textContent = "Files";
    sheet.classList.add("sheet-files");
    var fileTree = document.getElementById("file-tree");
    if (fileTree) {
      listEl.appendChild(fileTree);
      fileTree.classList.remove("hidden");
    }
    if (ctx.onFilesTabOpen) ctx.onFilesTabOpen();
  } else if (type === "mate-knowledge") {
    titleEl.textContent = "Knowledge";
    sheet.classList.add("sheet-knowledge");
    var knowledgeFiles = document.getElementById("mate-knowledge-files");
    if (knowledgeFiles) {
      listEl.appendChild(knowledgeFiles);
      knowledgeFiles.classList.remove("hidden");
    }
    // Request knowledge list if not loaded
    if (ctx.requestKnowledgeList) ctx.requestKnowledgeList();
  } else if (type === "mate-profile") {
    titleEl.textContent = "";
    renderSheetMateProfile(listEl);
  } else if (type === "search") {
    titleEl.textContent = "Search";
    renderSheetSearch(listEl);
  } else if (type === "tools") {
    titleEl.textContent = "Tools";
    renderSheetTools(listEl);
  } else if (type === "settings") {
    titleEl.textContent = "Settings";
    renderSheetSettings(listEl);
  }

  sheet.classList.remove("hidden", "closing");
  refreshIcons();
}

function closeMobileSheet() {
  var sheet = document.getElementById("mobile-sheet");
  if (!sheet || sheet.classList.contains("hidden")) return;

  mobileChatSheetOpen = false;

  // Return file tree to sidebar if it was moved
  if (sheet.classList.contains("sheet-files")) {
    var fileTree = document.getElementById("file-tree");
    var sidebarFilesPanel = document.getElementById("sidebar-panel-files");
    if (fileTree && sidebarFilesPanel) {
      sidebarFilesPanel.appendChild(fileTree);
    }
  }
  // Return knowledge files to mate sidebar if moved
  if (sheet.classList.contains("sheet-knowledge")) {
    var knowledgeFiles = document.getElementById("mate-knowledge-files");
    var knowledgePanel = document.getElementById("mate-sidebar-knowledge");
    if (knowledgeFiles && knowledgePanel) {
      knowledgePanel.appendChild(knowledgeFiles);
    }
  }

  sheet.classList.add("closing");
  setTimeout(function () {
    sheet.classList.add("hidden");
    sheet.classList.remove("closing", "sheet-files");
  }, 230);
}

function renderSheetProjects(listEl) {
  for (var i = 0; i < cachedProjectList.length; i++) {
    (function (p) {
      var el = document.createElement("button");
      el.className = "mobile-project-item" + (p.slug === cachedCurrentSlug ? " active" : "");

      var abbrev = document.createElement("span");
      abbrev.className = "mobile-project-abbrev";
      if (p.icon) {
        abbrev.textContent = p.icon;
        parseEmojis(abbrev);
      } else {
        abbrev.textContent = getProjectAbbrev(p.name);
      }
      el.appendChild(abbrev);

      var name = document.createElement("span");
      name.className = "mobile-project-name";
      name.textContent = p.name;
      el.appendChild(name);

      if (p.isProcessing) {
        var dot = document.createElement("span");
        dot.className = "mobile-project-processing";
        el.appendChild(dot);
      }

      if (p.unread > 0 && p.slug !== cachedCurrentSlug) {
        var mBadge = document.createElement("span");
        mBadge.className = "mobile-project-unread";
        mBadge.textContent = p.unread > 99 ? "99+" : String(p.unread);
        el.appendChild(mBadge);
      }

      el.addEventListener("click", function () {
        if (ctx.switchProject) ctx.switchProject(p.slug);
        closeMobileSheet();
      });

      listEl.appendChild(el);
    })(cachedProjectList[i]);
  }
}

function renderSheetSessions(listEl) {
  // --- Context filter bar (horizontal scroll) ---
  var filterBar = document.createElement("div");
  filterBar.className = "mobile-chat-filter-bar";

  // Current project chip (always first, pre-selected)
  var currentProject = null;
  for (var pi = 0; pi < cachedProjectList.length; pi++) {
    if (cachedProjectList[pi].slug === cachedCurrentSlug) {
      currentProject = cachedProjectList[pi];
      break;
    }
  }

  // Build chips: projects first, then mates
  var chips = [];

  for (var ci = 0; ci < cachedProjectList.length; ci++) {
    (function (p) {
      var chip = document.createElement("button");
      chip.className = "mobile-chat-chip";
      if (p.slug === cachedCurrentSlug) chip.classList.add("active");
      chip.dataset.type = "project";
      chip.dataset.slug = p.slug;

      var abbrev = document.createElement("span");
      abbrev.className = "mobile-chat-chip-icon";
      if (p.icon) {
        abbrev.textContent = p.icon;
        parseEmojis(abbrev);
      } else {
        abbrev.textContent = getProjectAbbrev(p.name);
      }
      chip.appendChild(abbrev);

      var label = document.createElement("span");
      label.textContent = p.name;
      chip.appendChild(label);

      // Processing dot: same class as icon strip
      var statusDot = document.createElement("span");
      statusDot.className = "icon-strip-status";
      if (p.isProcessing) statusDot.classList.add("processing");
      chip.appendChild(statusDot);

      if (p.unread > 0 && p.slug !== cachedCurrentSlug) {
        var badge = document.createElement("span");
        badge.className = "mobile-chat-chip-badge";
        badge.textContent = p.unread > 99 ? "99+" : String(p.unread);
        chip.appendChild(badge);
      }

      chips.push(chip);
    })(cachedProjectList[ci]);
  }

  var favoriteChipMates = cachedMates.filter(function (m) {
    if (cachedDmRemovedUsers[m.id]) return false;
    if (cachedDmFavorites.indexOf(m.id) !== -1) return true;
    if (cachedDmUnread[m.id] && cachedDmUnread[m.id] > 0) return true;
    return false;
  });
  var sortedChipMates = favoriteChipMates.sort(function (a, b) {
    var aBuiltin = a.builtinKey ? 1 : 0;
    var bBuiltin = b.builtinKey ? 1 : 0;
    if (aBuiltin !== bBuiltin) return bBuiltin - aBuiltin;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  for (var mi = 0; mi < sortedChipMates.length; mi++) {
    (function (mate) {
      var mp = mate.profile || {};
      var chip = document.createElement("button");
      chip.className = "mobile-chat-chip";
      chip.dataset.type = "mate";
      chip.dataset.mateId = mate.id;

      var avatarEl = document.createElement("img");
      avatarEl.className = "mobile-chat-chip-avatar";
      avatarEl.src = mateAvatarUrl(mate, 20);
      avatarEl.alt = mp.displayName || mate.name || "";
      chip.appendChild(avatarEl);

      var label = document.createElement("span");
      label.textContent = mp.displayName || mate.name || "Mate";
      chip.appendChild(label);

      // Processing dot: same class as icon strip, same data source
      var mateSlug = "mate-" + mate.id;
      var mateProj = null;
      var allProjects = (ctx && ctx.projectList) || [];
      for (var pi = 0; pi < allProjects.length; pi++) {
        if (allProjects[pi].slug === mateSlug) { mateProj = allProjects[pi]; break; }
      }
      var statusDot = document.createElement("span");
      statusDot.className = "icon-strip-status";
      if (mateProj && mateProj.isProcessing) statusDot.classList.add("processing");
      chip.appendChild(statusDot);

      var unreadCount = cachedDmUnread[mate.id] || 0;
      if (unreadCount > 0) {
        var badge = document.createElement("span");
        badge.className = "mobile-chat-chip-badge";
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        chip.appendChild(badge);
      }

      chips.push(chip);
    })(sortedChipMates[mi]);
  }

  for (var i = 0; i < chips.length; i++) {
    filterBar.appendChild(chips[i]);
  }
  listEl.appendChild(filterBar);

  // --- Session list container ---
  var sessionListEl = document.createElement("div");
  sessionListEl.className = "mobile-chat-session-list";
  listEl.appendChild(sessionListEl);

  // --- Render sessions for a context ---
  function renderSessionsForContext(type, slug, mateId) {
    sessionListEl.innerHTML = "";

    if (type === "project") {
      renderMobileSessionsInto(sessionListEl);
    } else if (type === "mate") {
      // Mate DM: just open the DM
      if (ctx.openDm) ctx.openDm(mateId);
      closeMobileSheet();
      return;
    }

    refreshIcons();
  }

  // --- Chip click handlers ---
  for (var j = 0; j < chips.length; j++) {
    (function (chip) {
      chip.addEventListener("click", function () {
        // Deactivate all chips
        for (var k = 0; k < chips.length; k++) {
          chips[k].classList.remove("active");
        }
        chip.classList.add("active");

        var type = chip.dataset.type;
        if (type === "project") {
          var slug = chip.dataset.slug;
          if (slug !== cachedCurrentSlug) {
            // Switch project, show loading, keep sheet open
            sessionListEl.innerHTML = "";
            var loading = document.createElement("div");
            loading.className = "mobile-chat-context-note";
            loading.textContent = "Loading sessions...";
            sessionListEl.appendChild(loading);
            if (ctx.switchProject) ctx.switchProject(slug);
            // renderSessionList will be called by WS, which calls refreshMobileChatSheet
          } else {
            renderSessionsForContext("project", slug, null);
          }
        } else if (type === "mate") {
          renderSessionsForContext("mate", null, chip.dataset.mateId);
        }
      });
    })(chips[j]);
  }

  // Track that chat sheet is open
  mobileChatSheetOpen = true;

  // --- Initial render: current project sessions ---
  renderSessionsForContext("project", cachedCurrentSlug, null);
}

// Helper: create a mobile session item element
function createMobileSessionItem(s) {
  var el = document.createElement("button");
  el.className = "mobile-session-item" + (s.active ? " active" : "");

  // Processing dot (left side, before title)
  if (s.isProcessing) {
    var dot = document.createElement("span");
    dot.className = "mobile-session-processing";
    el.appendChild(dot);
  }

  var titleSpan = document.createElement("span");
  titleSpan.className = "mobile-session-title";
  titleSpan.textContent = s.title || "New Session";
  el.appendChild(titleSpan);

  // Unread badge (right side)
  if (s.unread > 0 && !s.active) {
    var badge = document.createElement("span");
    badge.className = "mobile-session-unread";
    badge.textContent = s.unread > 99 ? "99+" : String(s.unread);
    el.appendChild(badge);
  }

  (function (id) {
    el.addEventListener("click", function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
      }
      dismissOverlayPanels();
      closeMobileSheet();
    });
  })(s.id);

  return el;
}

// Helper: create a mobile loop child element (individual session inside a group)
function createMobileLoopChild(s) {
  var el = document.createElement("button");
  el.className = "mobile-loop-child" + (s.active ? " active" : "");

  if (s.isProcessing) {
    var dot = document.createElement("span");
    dot.className = "mobile-session-processing";
    el.appendChild(dot);
  }

  var textSpan = document.createElement("span");
  textSpan.className = "mobile-session-title";
  if (s.loop) {
    var isRalphChild = s.loop.source === "ralph";
    var roleName = s.loop.role === "crafting" ? "Crafting" : s.loop.role === "judge" ? "Judge" : (isRalphChild ? "Coder" : "Run");
    var iterSuffix = s.loop.role === "crafting" ? "" : " #" + s.loop.iteration;
    var roleCls = s.loop.role === "crafting" ? " crafting" : (!isRalphChild ? " scheduled" : "");
    var badge = document.createElement("span");
    badge.className = "mobile-loop-role-badge" + roleCls;
    badge.textContent = roleName + iterSuffix;
    textSpan.appendChild(badge);
  }
  el.appendChild(textSpan);

  (function (id) {
    el.addEventListener("click", function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
      }
      dismissOverlayPanels();
      closeMobileSheet();
    });
  })(s.id);

  return el;
}

// Helper: create a mobile loop run sub-group (collapsible time group)
function createMobileLoopRun(parentGk, startedAtKey, sessions, isRalph) {
  var runGk = parentGk + ":" + startedAtKey;
  var expanded = expandedMobileLoopRuns.has(runGk);
  var startedAt = Number(startedAtKey);
  var timeLabel = startedAt ? new Date(startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Unknown";

  var hasActive = false;
  var anyProcessing = false;
  var latestSession = sessions[0];
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].active) hasActive = true;
    if (sessions[i].isProcessing) anyProcessing = true;
    if ((sessions[i].lastActivity || 0) > (latestSession.lastActivity || 0)) {
      latestSession = sessions[i];
    }
  }

  var wrapper = document.createElement("div");
  wrapper.className = "mobile-loop-run-wrapper";

  var header = document.createElement("button");
  header.className = "mobile-loop-run" + (hasActive ? " active" : "") + (expanded ? " expanded" : "") + (isRalph ? "" : " scheduled");

  var chevron = document.createElement("span");
  chevron.className = "mobile-loop-chevron";
  chevron.innerHTML = iconHtml("chevron-right");
  header.appendChild(chevron);

  var label = document.createElement("span");
  label.className = "mobile-loop-run-time";
  var labelHtml = "";
  if (anyProcessing) {
    labelHtml += '<span class="mobile-session-processing"></span> ';
  }
  labelHtml += escapeHtml(timeLabel);
  label.innerHTML = labelHtml;
  header.appendChild(label);

  var countBadge = document.createElement("span");
  countBadge.className = "mobile-loop-count" + (isRalph ? "" : " scheduled");
  countBadge.textContent = String(sessions.length);
  header.appendChild(countBadge);

  header.addEventListener("click", (function (rk) {
    return function (e) {
      e.stopPropagation();
      if (expandedMobileLoopRuns.has(rk)) {
        expandedMobileLoopRuns.delete(rk);
      } else {
        expandedMobileLoopRuns.add(rk);
      }
      refreshMobileChatSheet();
    };
  })(runGk));

  wrapper.appendChild(header);

  if (expanded) {
    var childContainer = document.createElement("div");
    childContainer.className = "mobile-loop-children";
    for (var k = 0; k < sessions.length; k++) {
      childContainer.appendChild(createMobileLoopChild(sessions[k]));
    }
    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

// Helper: create a mobile loop group element (collapsible group header)
function createMobileLoopGroup(loopId, children, groupKey) {
  var gk = groupKey || loopId;

  // Sub-group children by startedAt (each run)
  var runMap = {};
  for (var i = 0; i < children.length; i++) {
    var runKey = String(children[i].loop && children[i].loop.startedAt || 0);
    if (!runMap[runKey]) runMap[runKey] = [];
    runMap[runKey].push(children[i]);
  }
  var runKeys = Object.keys(runMap);

  // Sort each run's children by iteration then role
  for (var ri = 0; ri < runKeys.length; ri++) {
    runMap[runKeys[ri]].sort(function (a, b) {
      var ai = (a.loop && a.loop.iteration) || 0;
      var bi = (b.loop && b.loop.iteration) || 0;
      if (ai !== bi) return ai - bi;
      var ar = (a.loop && a.loop.role === "judge") ? 1 : 0;
      var br = (b.loop && b.loop.role === "judge") ? 1 : 0;
      return ar - br;
    });
  }

  // Sort runs by startedAt descending (newest first)
  runKeys.sort(function (a, b) { return Number(b) - Number(a); });

  var expanded = expandedMobileLoopGroups.has(gk);
  var hasActive = false;
  var anyProcessing = false;
  var latestSession = children[0];
  for (var ci = 0; ci < children.length; ci++) {
    if (children[ci].active) hasActive = true;
    if (children[ci].isProcessing) anyProcessing = true;
    if ((children[ci].lastActivity || 0) > (latestSession.lastActivity || 0)) {
      latestSession = children[ci];
    }
  }

  var loopName = (children[0].loop && children[0].loop.name) || "Ralph Loop";
  var isRalph = children[0].loop && children[0].loop.source === "ralph";
  var isCrafting = false;
  for (var j = 0; j < children.length; j++) {
    if (children[j].loop && children[j].loop.role === "crafting") isCrafting = true;
  }
  var runCount = runKeys.length;

  var wrapper = document.createElement("div");
  wrapper.className = "mobile-loop-wrapper";

  // Group header row
  var header = document.createElement("button");
  header.className = "mobile-loop-group" + (hasActive ? " active" : "") + (expanded ? " expanded" : "") + (isRalph ? "" : " scheduled");

  var chevron = document.createElement("span");
  chevron.className = "mobile-loop-chevron";
  chevron.innerHTML = iconHtml("chevron-right");
  header.appendChild(chevron);

  var iconSpan = document.createElement("span");
  var groupIcon = isRalph ? "repeat" : "calendar-clock";
  iconSpan.className = "mobile-loop-icon" + (isRalph ? "" : " scheduled");
  iconSpan.innerHTML = iconHtml(groupIcon);
  header.appendChild(iconSpan);

  if (anyProcessing) {
    var dot = document.createElement("span");
    dot.className = "mobile-session-processing";
    header.appendChild(dot);
  }

  var nameSpan = document.createElement("span");
  nameSpan.className = "mobile-loop-name";
  nameSpan.textContent = loopName;
  header.appendChild(nameSpan);

  if (isCrafting && children.length === 1) {
    var craftBadge = document.createElement("span");
    craftBadge.className = "mobile-loop-badge crafting";
    craftBadge.textContent = "Crafting";
    header.appendChild(craftBadge);
  } else {
    var countBadge = document.createElement("span");
    countBadge.className = "mobile-loop-count" + (isRalph ? "" : " scheduled");
    var countLabel = runCount === 1 ? String(children.length) : runCount + (runCount === 1 ? " run" : " runs");
    countBadge.textContent = countLabel;
    header.appendChild(countBadge);
  }

  // Chevron toggles expansion
  header.addEventListener("click", (function (lid) {
    return function (e) {
      e.stopPropagation();
      if (expandedMobileLoopGroups.has(lid)) {
        expandedMobileLoopGroups.delete(lid);
      } else {
        expandedMobileLoopGroups.add(lid);
      }
      refreshMobileChatSheet();
    };
  })(gk));

  wrapper.appendChild(header);

  // Expanded: show runs
  if (expanded) {
    var childContainer = document.createElement("div");
    childContainer.className = "mobile-loop-children";

    if (runCount === 1) {
      var singleRun = runMap[runKeys[0]];
      for (var sk = 0; sk < singleRun.length; sk++) {
        childContainer.appendChild(createMobileLoopChild(singleRun[sk]));
      }
    } else {
      for (var rk = 0; rk < runKeys.length; rk++) {
        childContainer.appendChild(createMobileLoopRun(gk, runKeys[rk], runMap[runKeys[rk]], isRalph));
      }
    }

    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

// Helper: render sorted sessions into a container with date groups (with loop session grouping)
function renderMobileSessionsInto(container) {
  var newBtn = document.createElement("button");
  newBtn.className = "mobile-session-new";
  newBtn.innerHTML = '<i data-lucide="plus" style="width:16px;height:16px"></i> New session';
  newBtn.addEventListener("click", function () {
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
    }
    closeMobileSheet();
  });
  container.appendChild(newBtn);

  // Partition: loop sessions vs normal sessions (same logic as desktop renderSessionList)
  var loopGroups = {};
  var normalSessions = [];
  for (var i = 0; i < cachedSessions.length; i++) {
    var s = cachedSessions[i];
    if (s.loop && s.loop.loopId && s.loop.role === "crafting" && s.loop.source !== "ralph") {
      continue;
    } else if (s.loop && s.loop.loopId) {
      var startedAt = s.loop.startedAt || 0;
      var dateStr = startedAt ? new Date(startedAt).toISOString().slice(0, 10) : "unknown";
      var groupKey = s.loop.loopId + ":" + dateStr;
      if (!loopGroups[groupKey]) loopGroups[groupKey] = [];
      loopGroups[groupKey].push(s);
    } else {
      normalSessions.push(s);
    }
  }

  // Build virtual items
  var items = [];
  for (var j = 0; j < normalSessions.length; j++) {
    items.push({ type: "session", data: normalSessions[j], lastActivity: normalSessions[j].lastActivity || 0 });
  }
  var groupKeys = Object.keys(loopGroups);
  for (var k = 0; k < groupKeys.length; k++) {
    var gk = groupKeys[k];
    var children = loopGroups[gk];
    var realLoopId = children[0].loop.loopId;
    var maxActivity = 0;
    for (var m = 0; m < children.length; m++) {
      var act = children[m].lastActivity || 0;
      if (act > maxActivity) maxActivity = act;
    }
    items.push({ type: "loop", loopId: realLoopId, groupKey: gk, children: children, lastActivity: maxActivity });
  }

  // Sort by lastActivity descending
  items.sort(function (a, b) {
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  var currentGroup = "";
  for (var n = 0; n < items.length; n++) {
    var item = items[n];
    var group = getDateGroup(item.lastActivity || 0);
    if (group !== currentGroup) {
      currentGroup = group;
      var header = document.createElement("div");
      header.className = "mobile-sheet-group";
      header.textContent = group;
      container.appendChild(header);
    }
    if (item.type === "loop") {
      container.appendChild(createMobileLoopGroup(item.loopId, item.children, item.groupKey));
    } else {
      container.appendChild(createMobileSessionItem(item.data));
    }
  }
}

// Refresh mobile chat sheet when session data updates (called from renderSessionList)
function refreshMobileChatSheet() {
  if (!mobileChatSheetOpen) return;
  var sheet = document.getElementById("mobile-sheet");
  if (!sheet || sheet.classList.contains("hidden")) {
    mobileChatSheetOpen = false;
    return;
  }
  var sessionListEl = sheet.querySelector(".mobile-chat-session-list");
  if (!sessionListEl) return;

  // Update chips: active state and processing dots
  var chips = sheet.querySelectorAll(".mobile-chat-chip");
  for (var i = 0; i < chips.length; i++) {
    var chip = chips[i];
    chip.classList.remove("active");

    // Update active state
    if (chip.dataset.type === "project" && chip.dataset.slug === cachedCurrentSlug) {
      chip.classList.add("active");
    }

    // Update processing dot: same class as icon strip
    var statusDot = chip.querySelector(".icon-strip-status");
    if (statusDot) {
      var isProcessing = false;
      var allProjects = (ctx && ctx.projectList) || [];
      var lookupSlug = chip.dataset.type === "mate" ? ("mate-" + chip.dataset.mateId) : chip.dataset.slug;
      for (var pi = 0; pi < allProjects.length; pi++) {
        if (allProjects[pi].slug === lookupSlug && allProjects[pi].isProcessing) {
          isProcessing = true;
          break;
        }
      }
      statusDot.classList.toggle("processing", isProcessing);
    }
  }

  // Re-render sessions for current project
  sessionListEl.innerHTML = "";
  renderMobileSessionsInto(sessionListEl);

  refreshIcons();
}

function renderSheetMateProfile(listEl) {
  if (!mobileSheetMateData) return;
  var data = mobileSheetMateData;

  // Profile header
  var header = document.createElement("div");
  header.className = "mate-profile-header";

  var avatar = document.createElement("img");
  avatar.className = "mate-profile-avatar";
  avatar.src = data.avatarUrl || "";
  avatar.alt = data.displayName || "";
  header.appendChild(avatar);

  var info = document.createElement("div");
  info.className = "mate-profile-info";
  var nameEl = document.createElement("div");
  nameEl.className = "mate-profile-name";
  nameEl.textContent = data.displayName || "";
  info.appendChild(nameEl);
  if (data.description) {
    var descEl = document.createElement("div");
    descEl.className = "mate-profile-desc";
    descEl.textContent = data.description;
    info.appendChild(descEl);
  }
  header.appendChild(info);
  listEl.appendChild(header);

  // Action buttons
  var actions = [
    { icon: "book-open", label: "Knowledge", btnId: "mate-knowledge-btn", countId: "mate-knowledge-count" },
    { icon: "sticky-note", label: "Sticky Notes", btnId: "sticky-notes-toggle-btn", countId: "sticky-notes-sidebar-count" },
    { icon: "puzzle", label: "Skills", btnId: "mate-skills-btn" },
    { icon: "calendar", label: "Scheduled Tasks", btnId: "mate-scheduler-btn" }
  ];

  for (var i = 0; i < actions.length; i++) {
    (function (action) {
      var btn = document.createElement("button");
      btn.className = "mate-profile-action";
      var countHtml = "";
      if (action.countId) {
        var countEl = document.getElementById(action.countId);
        if (countEl && !countEl.classList.contains("hidden") && countEl.textContent) {
          countHtml = '<span class="mate-profile-action-count">' + escapeHtml(countEl.textContent) + '</span>';
        }
      }
      btn.innerHTML = '<i data-lucide="' + action.icon + '"></i><span>' + action.label + '</span>' + countHtml;
      btn.addEventListener("click", function () {
        closeMobileSheet();
        var targetBtn = document.getElementById(action.btnId);
        if (targetBtn) {
          setTimeout(function () { targetBtn.click(); }, 250);
        }
      });
      listEl.appendChild(btn);
    })(actions[i]);
  }
}

function renderSheetSearch(listEl) {
  // Search input at top
  var wrap = document.createElement("div");
  wrap.className = "mobile-search-input-wrap";
  var input = document.createElement("input");
  input.className = "mobile-search-input";
  input.type = "text";
  input.placeholder = "Search sessions, messages...";
  input.autocomplete = "off";
  input.spellcheck = false;
  wrap.appendChild(input);
  listEl.appendChild(wrap);

  // Results container
  var resultsEl = document.createElement("div");
  resultsEl.style.padding = "0 8px";
  listEl.appendChild(resultsEl);

  // Auto-focus
  setTimeout(function () { input.focus(); }, 300);

  // Show all sessions initially
  renderSearchResults(resultsEl, "");

  input.addEventListener("input", function () {
    var q = input.value.trim().toLowerCase();
    renderSearchResults(resultsEl, q);
  });
  input.addEventListener("keydown", function (e) { e.stopPropagation(); });
  input.addEventListener("keyup", function (e) { e.stopPropagation(); });
  input.addEventListener("keypress", function (e) { e.stopPropagation(); });
}

function renderSearchResults(container, query) {
  container.innerHTML = "";
  var sorted = cachedSessions.slice().sort(function (a, b) {
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  var found = 0;
  for (var i = 0; i < sorted.length; i++) {
    var s = sorted[i];
    var title = s.title || "New Session";
    if (query && title.toLowerCase().indexOf(query) === -1) continue;
    found++;

    var el = document.createElement("button");
    el.className = "mobile-session-item";
    if (s.active) el.classList.add("active");

    var titleSpan = document.createElement("span");
    titleSpan.className = "mobile-session-title";
    titleSpan.textContent = title;
    el.appendChild(titleSpan);

    if (s.isProcessing) {
      var dot = document.createElement("span");
      dot.className = "mobile-session-processing";
      el.appendChild(dot);
    }

    (function (id) {
      el.addEventListener("click", function () {
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
        }
        dismissOverlayPanels();
        closeMobileSheet();
      });
    })(s.id);

    container.appendChild(el);
  }

  if (found === 0 && query) {
    var empty = document.createElement("div");
    empty.className = "mobile-alert-empty";
    empty.textContent = 'No results for "' + query + '"';
    container.appendChild(empty);
  }
}

function renderSheetTools(listEl) {
  var isMateDm = document.body.classList.contains("mate-dm-active");

  var items = isMateDm ? [
    { icon: "book-open", label: "Knowledge", action: "mate-knowledge" },
    { icon: "calendar-clock", label: "Scheduled Tasks", action: "mate-scheduler" }
  ] : [
    { icon: "folder-tree", label: "Files", action: "files" },
    { icon: "square-terminal", label: "Terminal", action: "terminal" },
    { icon: "calendar-clock", label: "Scheduled Tasks", action: "scheduler" }
  ];

  for (var i = 0; i < items.length; i++) {
    (function (item) {
      var btn = document.createElement("button");
      btn.className = "mobile-more-item";
      btn.innerHTML = '<i data-lucide="' + item.icon + '"></i><span class="mobile-more-item-label">' + item.label + '</span>';
      btn.addEventListener("click", function () {
        closeMobileSheet();
        var targetId = null;
        if (item.action === "files") {
          setTimeout(function () { openMobileSheet("files"); }, 250);
        } else if (item.action === "terminal") {
          if (ctx.openTerminal) ctx.openTerminal();
        } else if (item.action === "scheduler") {
          targetId = "scheduler-btn";
        } else if (item.action === "mate-knowledge") {
          setTimeout(function () { openMobileSheet("mate-knowledge"); }, 250);
          return;
        } else if (item.action === "mate-sticky") {
          targetId = "sticky-notes-toggle-btn";
        } else if (item.action === "mate-skills") {
          targetId = "mate-skills-btn";
        } else if (item.action === "mate-scheduler") {
          targetId = "mate-scheduler-btn";
        }
        if (targetId) {
          var targetBtn = document.getElementById(targetId);
          if (targetBtn) setTimeout(function () { targetBtn.click(); }, 250);
        }
      });
      listEl.appendChild(btn);
    })(items[i]);
  }
}

function renderSheetSettings(listEl) {
  var items = [
    { icon: "folder-cog", label: "Project Settings", action: "project-settings" },
    { icon: "settings", label: "Server Settings", action: "server-settings" }
  ];

  for (var i = 0; i < items.length; i++) {
    (function (item) {
      var btn = document.createElement("button");
      btn.className = "mobile-more-item";
      btn.innerHTML = '<i data-lucide="' + item.icon + '"></i><span class="mobile-more-item-label">' + item.label + '</span>';
      btn.addEventListener("click", function () {
        closeMobileSheet();
        if (item.action === "project-settings") {
          setTimeout(function () {
            // Find current project data
            var proj = null;
            for (var pi = 0; pi < cachedAllProjects.length; pi++) {
              if (cachedAllProjects[pi].slug === cachedCurrentSlug) {
                proj = cachedAllProjects[pi];
                break;
              }
            }
            // For mate projects, use mate display name instead of slug
            if (proj && proj.isMate && cachedMates.length > 0) {
              var mateId = cachedCurrentSlug.replace("mate-", "");
              for (var mi = 0; mi < cachedMates.length; mi++) {
                var mp = cachedMates[mi].profile || {};
                if (cachedMates[mi].id === mateId) {
                  proj = Object.assign({}, proj, { name: mp.displayName || cachedMates[mi].name || proj.name });
                  break;
                }
              }
            }
            openProjectSettings(cachedCurrentSlug, proj);
          }, 250);
        } else if (item.action === "server-settings") {
          var settingsBtn = document.getElementById("server-settings-btn");
          if (settingsBtn) setTimeout(function () { settingsBtn.click(); }, 250);
        }
      });
      listEl.appendChild(btn);
    })(items[i]);
  }

  // Dark/Light switch button
  var isDark = getCurrentTheme().variant === "dark";
  var themeBtn = document.createElement("button");
  themeBtn.className = "mobile-more-item";
  themeBtn.innerHTML = '<i data-lucide="' + (isDark ? "sun" : "moon") + '"></i><span class="mobile-more-item-label">Switch to ' + (isDark ? "Light" : "Dark") + '</span>';

  themeBtn.addEventListener("click", function () {
    var themeToggle = document.getElementById("theme-toggle-check");
    if (themeToggle) themeToggle.click();
    // Update button text after a tick (theme applies async)
    setTimeout(function () {
      var nowDark = getCurrentTheme().variant === "dark";
      themeBtn.innerHTML = '<i data-lucide="' + (nowDark ? "sun" : "moon") + '"></i><span class="mobile-more-item-label">Switch to ' + (nowDark ? "Light" : "Dark") + '</span>';
      refreshIcons();
    }, 50);
  });

  listEl.appendChild(themeBtn);

  // Chat Layout switch button
  var currentLayout = getChatLayout();
  var isBubble = currentLayout === "bubble";
  var layoutBtn = document.createElement("button");
  layoutBtn.className = "mobile-more-item";
  layoutBtn.innerHTML = '<i data-lucide="' + (isBubble ? "monitor" : "message-circle") + '"></i>'
    + '<span class="mobile-more-item-label">Switch to ' + (isBubble ? "Channel" : "Bubble") + '</span>';

  layoutBtn.addEventListener("click", function () {
    var next = getChatLayout() === "bubble" ? "channel" : "bubble";
    setChatLayout(next);
    fetch('/api/user/chat-layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: next })
    });
    closeMobileSheet();
  });

  listEl.appendChild(layoutBtn);

  // "Open as app" — only show if not already in PWA standalone mode
  if (!document.documentElement.classList.contains("pwa-standalone")) {
    var pwaBtn = document.createElement("button");
    pwaBtn.className = "mobile-more-item";
    pwaBtn.innerHTML = '<i data-lucide="smartphone"></i><span class="mobile-more-item-label">Open as app</span>';
    pwaBtn.addEventListener("click", function () {
      closeMobileSheet();
      // Trigger the existing PWA install modal
      var installPill = document.getElementById("pwa-install-pill");
      if (installPill) {
        setTimeout(function () { installPill.click(); }, 250);
      }
    });
    listEl.appendChild(pwaBtn);
  }
}

export function initSidebar(_ctx) {
  ctx = _ctx;

  document.addEventListener("click", function () { closeSessionCtxMenu(); });

  ctx.hamburgerBtn.addEventListener("click", function () {
    ctx.sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });

  ctx.sidebarOverlay.addEventListener("click", closeSidebar);

  // --- Desktop sidebar collapse/expand ---
  function toggleSidebarCollapse() {
    var layout = ctx.$("layout");
    var collapsed = layout.classList.toggle("sidebar-collapsed");
    try { localStorage.setItem("sidebar-collapsed", collapsed ? "1" : ""); } catch (e) {}
    setTimeout(function () { syncUserIslandWidth(); syncResizeHandle(); }, 210);
  }

  if (ctx.sidebarToggleBtn) ctx.sidebarToggleBtn.addEventListener("click", toggleSidebarCollapse);
  if (ctx.sidebarExpandBtn) ctx.sidebarExpandBtn.addEventListener("click", toggleSidebarCollapse);
  var mateSidebarToggle = document.getElementById("mate-sidebar-toggle-btn");
  if (mateSidebarToggle) mateSidebarToggle.addEventListener("click", toggleSidebarCollapse);

  // Restore collapsed state from localStorage
  try {
    if (localStorage.getItem("sidebar-collapsed") === "1") {
      ctx.$("layout").classList.add("sidebar-collapsed");
    }
  } catch (e) {}

  ctx.newSessionBtn.addEventListener("click", function () {
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
      closeSidebar();
    }
  });

  // --- New Ralph Loop button ---
  var newRalphBtn = ctx.$("new-ralph-btn");
  if (newRalphBtn) {
    newRalphBtn.addEventListener("click", function () {
      if (ctx.openRalphWizard) ctx.openRalphWizard();
    });
  }

  // --- Session search ---
  var searchBtn = ctx.$("search-session-btn");
  var searchBox = ctx.$("session-search");
  var searchInput = ctx.$("session-search-input");
  var searchClear = ctx.$("session-search-clear");

  function openSearch() {
    searchBox.classList.remove("hidden");
    searchBtn.classList.add("active");
    searchInput.value = "";
    searchQuery = "";
    setTimeout(function () { searchInput.focus(); }, 50);
  }

  function closeSearch() {
    searchBox.classList.add("hidden");
    searchBtn.classList.remove("active");
    searchInput.value = "";
    searchQuery = "";
    searchMatchIds = null;
    if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = null; }
    renderSessionList(null);
  }

  searchBtn.addEventListener("click", function () {
    if (searchBox.classList.contains("hidden")) {
      openSearch();
    } else {
      closeSearch();
    }
  });

  if (searchClear) {
    searchClear.addEventListener("click", function () {
      closeSearch();
    });
  }

  searchInput.addEventListener("input", function () {
    searchQuery = searchInput.value.trim();
    if (searchDebounce) clearTimeout(searchDebounce);
    if (!searchQuery) {
      searchMatchIds = null;
      renderSessionList(null);
      return;
    }
    searchDebounce = setTimeout(function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "search_sessions", query: searchQuery }));
      }
    }, 200);
  });

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  });

  // --- Resume session picker ---
  var resumeModal = ctx.$("resume-modal");
  var resumeCancel = ctx.$("resume-cancel");
  var pickerLoading = ctx.$("resume-picker-loading");
  var pickerEmpty = ctx.$("resume-picker-empty");
  var pickerList = ctx.$("resume-picker-list");

  function openResumeModal() {
    resumeModal.classList.remove("hidden");
    pickerLoading.classList.remove("hidden");
    pickerEmpty.classList.add("hidden");
    pickerList.classList.add("hidden");
    pickerList.innerHTML = "";
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "list_cli_sessions" }));
    }
  }

  function closeResumeModal() {
    resumeModal.classList.add("hidden");
  }

  ctx.resumeSessionBtn.addEventListener("click", openResumeModal);
  resumeCancel.addEventListener("click", closeResumeModal);
  resumeModal.querySelector(".confirm-backdrop").addEventListener("click", closeResumeModal);

  // --- Panel switch (sessions / files / projects) ---
  var fileBrowserBtn = ctx.$("file-browser-btn");
  var projectsPanel = ctx.$("sidebar-panel-projects");
  var sessionsPanel = ctx.$("sidebar-panel-sessions");
  var filesPanel = ctx.$("sidebar-panel-files");
  var sessionsHeaderContent = ctx.$("sessions-header-content");
  var filesHeaderContent = ctx.$("files-header-content");
  var filePanelClose = ctx.$("file-panel-close");

  function hideAllPanels() {
    if (projectsPanel) projectsPanel.classList.add("hidden");
    if (sessionsPanel) sessionsPanel.classList.add("hidden");
    if (filesPanel) filesPanel.classList.add("hidden");
    if (sessionsHeaderContent) sessionsHeaderContent.classList.add("hidden");
    if (filesHeaderContent) filesHeaderContent.classList.add("hidden");
  }

  function showProjectsPanel() {
    hideAllPanels();
    if (projectsPanel) projectsPanel.classList.remove("hidden");
  }

  function showSessionsPanel() {
    hideAllPanels();
    if (sessionsPanel) sessionsPanel.classList.remove("hidden");
    if (sessionsHeaderContent) sessionsHeaderContent.classList.remove("hidden");
  }

  function showFilesPanel() {
    hideAllPanels();
    if (filesPanel) filesPanel.classList.remove("hidden");
    if (filesHeaderContent) filesHeaderContent.classList.remove("hidden");
    if (ctx.onFilesTabOpen) ctx.onFilesTabOpen();
  }

  if (fileBrowserBtn) {
    fileBrowserBtn.addEventListener("click", showFilesPanel);
  }
  if (filePanelClose) {
    filePanelClose.addEventListener("click", showSessionsPanel);
  }

  // --- Mobile sheet close handlers ---
  var mobileSheet = document.getElementById("mobile-sheet");
  if (mobileSheet) {
    var sheetBackdrop = mobileSheet.querySelector(".mobile-sheet-backdrop");
    var sheetCloseBtn = mobileSheet.querySelector(".mobile-sheet-close");
    if (sheetBackdrop) sheetBackdrop.addEventListener("click", closeMobileSheet);
    if (sheetCloseBtn) sheetCloseBtn.addEventListener("click", closeMobileSheet);

    // --- Drag to dismiss sheet ---
    var sheetHandle = mobileSheet.querySelector(".mobile-sheet-handle");
    var sheetContent = mobileSheet.querySelector(".mobile-sheet-content");
    if (sheetHandle && sheetContent) {
      var dragStartY = 0;
      var dragging = false;

      sheetHandle.addEventListener("touchstart", function (e) {
        dragStartY = e.touches[0].clientY;
        dragging = true;
        sheetContent.style.transition = "none";
      }, { passive: true });

      mobileSheet.addEventListener("touchmove", function (e) {
        if (!dragging) return;
        var deltaY = e.touches[0].clientY - dragStartY;
        if (deltaY < 0) deltaY = 0;
        sheetContent.style.transform = "translateY(" + deltaY + "px)";
        if (sheetBackdrop) {
          var opacity = Math.max(0, 1 - deltaY / (sheetContent.offsetHeight * 0.5));
          sheetBackdrop.style.opacity = opacity;
        }
      }, { passive: true });

      mobileSheet.addEventListener("touchend", function () {
        if (!dragging) return;
        dragging = false;
        var currentY = parseFloat(sheetContent.style.transform.replace(/[^0-9.-]/g, "")) || 0;
        var threshold = sheetContent.offsetHeight * 0.3;

        if (currentY > threshold) {
          sheetContent.style.transition = "transform 0.22s ease-in";
          sheetContent.style.transform = "translateY(100%)";
          if (sheetBackdrop) {
            sheetBackdrop.style.transition = "opacity 0.22s ease-in";
            sheetBackdrop.style.opacity = "0";
          }
          setTimeout(function () {
            sheetContent.style.transition = "";
            sheetContent.style.transform = "";
            if (sheetBackdrop) {
              sheetBackdrop.style.transition = "";
              sheetBackdrop.style.opacity = "";
            }
            // Close without animation since we already animated
            var sheet = document.getElementById("mobile-sheet");
            if (sheet) {
              if (sheet.classList.contains("sheet-files")) {
                var fileTree = document.getElementById("file-tree");
                var sidebarFilesPanel = document.getElementById("sidebar-panel-files");
                if (fileTree && sidebarFilesPanel) {
                  sidebarFilesPanel.appendChild(fileTree);
                }
              }
              sheet.classList.add("hidden");
              sheet.classList.remove("closing", "sheet-files");
            }
          }, 230);
        } else {
          sheetContent.style.transition = "transform 0.2s ease-out";
          sheetContent.style.transform = "translateY(0)";
          if (sheetBackdrop) {
            sheetBackdrop.style.transition = "opacity 0.2s ease-out";
            sheetBackdrop.style.opacity = "";
          }
          setTimeout(function () {
            sheetContent.style.transition = "";
            sheetContent.style.transform = "";
            if (sheetBackdrop) {
              sheetBackdrop.style.transition = "";
              sheetBackdrop.style.opacity = "";
            }
          }, 200);
        }
      }, { passive: true });
    }
  }

  // --- Mobile tab bar ---
  var mobileTabBar = document.getElementById("mobile-tab-bar");
  var mobileTabs = mobileTabBar ? mobileTabBar.querySelectorAll(".mobile-tab") : [];
  var mobileHomeBtn = document.getElementById("mobile-home-btn");

  function setMobileTabActive(tabName) {
    for (var i = 0; i < mobileTabs.length; i++) {
      if (mobileTabs[i].dataset.tab === tabName) {
        mobileTabs[i].classList.add("active");
      } else {
        mobileTabs[i].classList.remove("active");
      }
    }
    if (mobileHomeBtn) {
      if (tabName === "home") {
        mobileHomeBtn.classList.add("active");
      } else {
        mobileHomeBtn.classList.remove("active");
      }
    }
  }

  for (var t = 0; t < mobileTabs.length; t++) {
    (function (tab) {
      tab.addEventListener("click", function () {
        var name = tab.dataset.tab;

        if (name === "chat") {
          openMobileSheet("sessions");
          setMobileTabActive("chat");
        } else if (name === "search") {
          openCommandPalette();
          setMobileTabActive("search");
        } else if (name === "tools") {
          openMobileSheet("tools");
          setMobileTabActive("tools");
        } else if (name === "settings") {
          openMobileSheet("settings");
          setMobileTabActive("settings");
        }
      });
    })(mobileTabs[t]);
  }

  if (mobileHomeBtn) {
    mobileHomeBtn.addEventListener("click", function () {
      closeSidebar();
      setMobileTabActive("home");
      if (ctx.showHomeHub) ctx.showHomeHub();
    });
  }

  // --- User island width sync ---
  var userIsland = document.getElementById("user-island");
  var sidebarColumn = document.getElementById("sidebar-column");

  function syncUserIslandWidth() {
    if (!userIsland) return;
    var mateSidebarColumn = document.getElementById("mate-sidebar-column");
    var isMateDM = document.body.classList.contains("mate-dm-active");
    var col = (isMateDM && mateSidebarColumn && !mateSidebarColumn.classList.contains("hidden")) ? mateSidebarColumn : sidebarColumn;
    if (!col) return;
    var rect = col.getBoundingClientRect();
    userIsland.style.width = (rect.right - 8 - 8) + "px";
  }

  // --- Sidebar resize handle ---
  var resizeHandle = document.getElementById("sidebar-resize-handle");

  function syncResizeHandle() {
    if (!resizeHandle || !sidebarColumn) return;
    var rect = sidebarColumn.getBoundingClientRect();
    var parentRect = sidebarColumn.parentElement.getBoundingClientRect();
    resizeHandle.style.left = (rect.right - parentRect.left) + "px";
  }

  if (resizeHandle && sidebarColumn) {
    var dragging = false;

    function onResizeMove(e) {
      if (!dragging) return;
      e.preventDefault();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var iconStrip = document.getElementById("icon-strip");
      var stripWidth = iconStrip ? iconStrip.offsetWidth : 72;
      var newWidth = clientX - stripWidth;
      if (newWidth < 192) newWidth = 192;
      if (newWidth > 320) newWidth = 320;
      sidebarColumn.style.width = newWidth + "px";
      syncResizeHandle();
      syncUserIslandWidth();
    }

    function onResizeEnd() {
      if (!dragging) return;
      dragging = false;
      resizeHandle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", onResizeEnd);
      document.removeEventListener("touchmove", onResizeMove);
      document.removeEventListener("touchend", onResizeEnd);
      try { localStorage.setItem("sidebar-width", sidebarColumn.style.width); } catch (e) {}
    }

    function onResizeStart(e) {
      e.preventDefault();
      dragging = true;
      resizeHandle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeEnd);
      document.addEventListener("touchmove", onResizeMove, { passive: false });
      document.addEventListener("touchend", onResizeEnd);
    }

    resizeHandle.addEventListener("mousedown", onResizeStart);
    resizeHandle.addEventListener("touchstart", onResizeStart, { passive: false });

    // Restore saved width (skip transition so user-island syncs immediately)
    try {
      var savedWidth = localStorage.getItem("sidebar-width");
      if (savedWidth) {
        var px = parseInt(savedWidth, 10);
        if (px >= 192 && px <= 320) {
          sidebarColumn.style.transition = "none";
          sidebarColumn.style.width = px + "px";
          sidebarColumn.offsetWidth; // force reflow
          sidebarColumn.style.transition = "";
        }
      }
    } catch (e) {}

    syncResizeHandle();
    syncUserIslandWidth();
  }

  // Initial sync even if no resize handle
  syncUserIslandWidth();

  // --- User island tooltip on hover (collapsed sidebar) ---
  if (userIsland) {
    var profileArea = userIsland.querySelector(".user-island-profile");
    if (profileArea) {
      profileArea.addEventListener("mouseenter", function () {
        var layout = document.getElementById("layout");
        if (!layout || !layout.classList.contains("sidebar-collapsed")) return;
        var nameEl = userIsland.querySelector(".user-island-name");
        var text = nameEl ? nameEl.textContent : "";
        if (text) showIconTooltip(profileArea, text);
      });
      profileArea.addEventListener("mouseleave", function () {
        hideIconTooltip();
      });
    }
  }

  // --- Schedule countdown timer ---
  startCountdownTimer();
}

function startCountdownTimer() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(updateCountdowns, 1000);
}

function updateCountdowns() {
  if (!ctx || !ctx.getUpcomingSchedules || !ctx.sessionListEl) return;
  var upcoming = ctx.getUpcomingSchedules(3 * 60 * 1000); // 3 minutes

  // Remove stale container
  if (countdownContainer && !ctx.sessionListEl.contains(countdownContainer)) {
    countdownContainer = null;
  }

  if (upcoming.length === 0) {
    if (countdownContainer) {
      countdownContainer.remove();
      countdownContainer = null;
    }
    return;
  }

  if (!countdownContainer) {
    countdownContainer = document.createElement("div");
    countdownContainer.className = "session-countdown-group";
    ctx.sessionListEl.insertBefore(countdownContainer, ctx.sessionListEl.firstChild);
  }

  var html = "";
  var now = Date.now();
  for (var i = 0; i < upcoming.length; i++) {
    var u = upcoming[i];
    var remaining = Math.max(0, Math.ceil((u.nextRunAt - now) / 1000));
    var min = Math.floor(remaining / 60);
    var sec = remaining % 60;
    var timeStr = min + ":" + (sec < 10 ? "0" : "") + sec;
    var colorStyle = u.color ? " style=\"border-left-color:" + u.color + "\"" : "";
    html += '<div class="session-countdown-item"' + colorStyle + '>';
    html += '<span class="session-countdown-name">' + escapeHtml(u.name) + '</span>';
    html += '<span class="session-countdown-badge">' + timeStr + '</span>';
    html += '</div>';
  }
  countdownContainer.innerHTML = html;
}

// --- CLI session picker ---
function relativeTime(isoString) {
  if (!isoString) return "";
  var ms = Date.now() - new Date(isoString).getTime();
  var sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  var min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  var days = Math.floor(hr / 24);
  if (days < 30) return days + "d ago";
  return new Date(isoString).toLocaleDateString();
}

export function populateCliSessionList(sessions) {
  var pickerLoading = ctx.$("resume-picker-loading");
  var pickerEmpty = ctx.$("resume-picker-empty");
  var pickerList = ctx.$("resume-picker-list");
  if (!pickerLoading || !pickerList) return;

  pickerLoading.classList.add("hidden");

  if (!sessions || sessions.length === 0) {
    pickerEmpty.classList.remove("hidden");
    pickerList.classList.add("hidden");
    return;
  }

  pickerEmpty.classList.add("hidden");
  pickerList.classList.remove("hidden");
  pickerList.innerHTML = "";

  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var item = document.createElement("div");
    item.className = "cli-session-item";

    var title = document.createElement("div");
    title.className = "cli-session-title";
    title.textContent = s.firstPrompt || "Untitled session";
    item.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "cli-session-meta";
    if (s.lastActivity) {
      var time = document.createElement("span");
      time.textContent = relativeTime(s.lastActivity);
      meta.appendChild(time);
    }
    if (s.model) {
      var model = document.createElement("span");
      model.className = "badge";
      model.textContent = s.model;
      meta.appendChild(model);
    }
    if (s.gitBranch) {
      var branch = document.createElement("span");
      branch.className = "badge";
      branch.textContent = s.gitBranch;
      meta.appendChild(branch);
    }
    item.appendChild(meta);

    (function (sessionId) {
      item.addEventListener("click", function () {
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "resume_session", cliSessionId: sessionId }));
        }
        var modal = ctx.$("resume-modal");
        if (modal) modal.classList.add("hidden");
        closeSidebar();
      });
    })(s.sessionId);

    pickerList.appendChild(item);
  }
}

// --- Icon Strip (Discord-style project icons) ---
var iconStripTooltip = null;

function getProjectAbbrev(name) {
  if (!name) return "?";
  // Take first letter of each word, max 2 chars
  var words = name.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function showIconTooltip(el, text) {
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

function showIconTooltipHtml(el, html) {
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

function hideIconTooltip() {
  if (iconStripTooltip) {
    iconStripTooltip.remove();
    iconStripTooltip = null;
  }
}

// --- DM user context menu ---
var userCtxMenu = null;

function closeUserCtxMenu() {
  if (userCtxMenu) {
    userCtxMenu.remove();
    userCtxMenu = null;
  }
  document.removeEventListener("click", handleUserCtxOutsideClick, true);
}

function showUserCtxMenu(anchorEl, user) {
  closeUserCtxMenu();
  closeProjectCtxMenu();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  var removeItem = document.createElement("button");
  removeItem.className = "project-ctx-item project-ctx-delete";
  removeItem.innerHTML = iconHtml("user-minus") + " <span>Remove from favorites</span>";
  removeItem.addEventListener("click", function (e) {
    e.stopPropagation();
    // Spawn dust particles at the user icon position
    var iconRect = anchorEl.getBoundingClientRect();
    spawnDustParticles(iconRect.left + iconRect.width / 2, iconRect.top + iconRect.height / 2);
    closeUserCtxMenu();
    // Immediately mark as removed so strip re-render hides the icon,
    // even if the user was only visible via cachedDmConversations (not favorites)
    cachedDmRemovedUsers[user.id] = true;
    if (ctx.onDmRemoveUser) ctx.onDmRemoveUser(user.id);
    renderUserStrip(cachedAllUsers, cachedOnlineUserIds, cachedMyUserId, cachedDmFavorites, cachedDmConversations, cachedDmUnread, cachedDmRemovedUsers, cachedMates);
    if (ctx.sendWs) {
      ctx.sendWs({ type: "dm_remove_favorite", targetUserId: user.id });
    }
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
  closeProjectCtxMenu();

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
      if (ctx.sendWs) {
        ctx.sendWs({ type: "mate_update", mateId: mate.id, updates: updates });
      }
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
    spawnDustParticles(iconRect.left + iconRect.width / 2, iconRect.top + iconRect.height / 2);
    if (ctx.sendWs) {
      ctx.sendWs({ type: "dm_remove_favorite", targetUserId: mate.id });
    }
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

// --- Project context menu ---
var projectCtxMenu = null;

var EMOJI_CATEGORIES = [
  { id: "frequent", icon: "🕐", label: "Frequent", emojis: [
    "😀","😎","🤓","🧠","💡","🔥","⚡","🚀",
    "🎯","🎮","🎨","🎵","📦","📁","📝","💻",
    "🖥️","⌨️","🔧","🛠️","⚙️","🧪","🔬","🧬",
    "🌍","🌱","🌊","🌸","🍀","🌈","☀️","🌙",
    "🐱","🐶","🐼","🦊","🦋","🐝","🐙","🦄",
    "🍕","🍔","☕","🍩","🍎","🍇","🧁","🍣",
    "❤️","💜","💙","💚","💛","🧡","🤍","🖤",
    "⭐","✨","💎","🏆","👑","🎪","🎭","🃏",
  ]},
  { id: "smileys", icon: "😀", label: "Smileys & People", emojis: [
    "😀","😃","😄","😁","😆","😅","🤣","😂",
    "🙂","😊","😇","🥰","😍","🤩","😘","😗",
    "😚","😙","🥲","😋","😛","😜","🤪","😝",
    "🤑","🤗","🤭","🫢","🤫","🤔","🫡","🤐",
    "🤨","😐","😑","😶","🫥","😏","😒","🙄",
    "😬","🤥","😌","😔","😪","🤤","😴","😷",
    "🤒","🤕","🤢","🤮","🥴","😵","🤯","🥳",
    "🥸","😎","🤓","🧐","😕","🫤","😟","🙁",
    "😮","😯","😲","😳","🥺","🥹","😦","😧",
    "😨","😰","😥","😢","😭","😱","😖","😣",
    "😞","😓","😩","😫","🥱","😤","😡","😠",
    "🤬","😈","👿","💀","☠️","💩","🤡","👹",
    "👺","👻","👽","👾","🤖","😺","😸","😹",
    "😻","😼","😽","🙀","😿","😾","🙈","🙉",
    "🙊","👋","🤚","🖐️","✋","🖖","🫱","🫲",
    "🫳","🫴","👌","🤌","🤏","✌️","🤞","🫰",
    "🤟","🤘","🤙","👈","👉","👆","🖕","👇",
    "☝️","🫵","👍","👎","✊","👊","🤛","🤜",
    "👏","🙌","🫶","👐","🤲","🤝","🙏","💪",
  ]},
  { id: "animals", icon: "🐻", label: "Animals & Nature", emojis: [
    "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼",
    "🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐽","🐸",
    "🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦",
    "🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺",
    "🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌",
    "🐞","🐜","🪰","🪲","🪳","🦟","🦗","🕷️",
    "🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑",
    "🦐","🦞","🦀","🪸","🐡","🐠","🐟","🐬",
    "🐳","🐋","🦈","🐊","🐅","🐆","🦓","🫏",
    "🦍","🦧","🦣","🐘","🦛","🦏","🐪","🐫",
    "🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖",
    "🐏","🐑","🦙","🐐","🦌","🫎","🐕","🐩",
    "🦮","🐕‍🦺","🐈","🐈‍⬛","🪶","🐓","🦃","🦤",
    "🦚","🦜","🦢","🪿","🦩","🕊️","🐇","🦝",
    "🦨","🦡","🦫","🦦","🦥","🐁","🐀","🐿️",
    "🦔","🌵","🎄","🌲","🌳","🌴","🪵","🌱",
    "🌿","☘️","🍀","🎍","🪴","🎋","🍃","🍂",
    "🍁","🪺","🪹","🍄","🌾","💐","🌷","🌹",
    "🥀","🪻","🌺","🌸","🌼","🌻","🌞","🌝",
    "🌛","🌜","🌚","🌕","🌖","🌗","🌘","🌑",
    "🌒","🌓","🌔","🌙","🌎","🌍","🌏","🪐",
    "💫","⭐","🌟","✨","⚡","☄️","💥","🔥",
    "🌪️","🌈","☀️","🌤️","⛅","🌥️","☁️","🌦️",
    "🌧️","⛈️","🌩️","❄️","☃️","⛄","🌬️","💨",
    "💧","💦","🫧","☔","☂️","🌊","🌫️",
  ]},
  { id: "food", icon: "🍔", label: "Food & Drink", emojis: [
    "🍇","🍈","🍉","🍊","🍋","🍌","🍍","🥭",
    "🍎","🍏","🍐","🍑","🍒","🍓","🫐","🥝",
    "🍅","🫒","🥥","🥑","🍆","🥔","🥕","🌽",
    "🌶️","🫑","🥒","🥬","🥦","🧄","🧅","🥜",
    "🫘","🌰","🫚","🫛","🍞","🥐","🥖","🫓",
    "🥨","🥯","🥞","🧇","🧀","🍖","🍗","🥩",
    "🥓","🍔","🍟","🍕","🌭","🥪","🌮","🌯",
    "🫔","🥙","🧆","🥚","🍳","🥘","🍲","🫕",
    "🥣","🥗","🍿","🧈","🧂","🥫","🍱","🍘",
    "🍙","🍚","🍛","🍜","🍝","🍠","🍢","🍣",
    "🍤","🍥","🥮","🍡","🥟","🥠","🥡","🦀",
    "🦞","🦐","🦑","🦪","🍦","🍧","🍨","🍩",
    "🍪","🎂","🍰","🧁","🥧","🍫","🍬","🍭",
    "🍮","🍯","🍼","🥛","☕","🫖","🍵","🍶",
    "🍾","🍷","🍸","🍹","🍺","🍻","🥂","🥃",
    "🫗","🥤","🧋","🧃","🧉","🧊",
  ]},
  { id: "activity", icon: "⚽", label: "Activity", emojis: [
    "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉",
    "🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍",
    "🏏","🪃","🥅","⛳","🪁","🛝","🏹","🎣",
    "🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️",
    "🥌","🎿","⛷️","🏂","🪂","🏋️","🤸","🤺",
    "⛹️","🤾","🏌️","🏇","🧘","🏄","🏊","🤽",
    "🚣","🧗","🚵","🚴","🎪","🤹","🎭","🎨",
    "🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷",
    "🎺","🪗","🎸","🪕","🎻","🪈","🎲","♟️",
    "🎯","🎳","🎮","🕹️","🧩","🪩",
  ]},
  { id: "travel", icon: "🚗", label: "Travel & Places", emojis: [
    "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑",
    "🚒","🚐","🛻","🚚","🚛","🚜","🛵","🏍️",
    "🛺","🚲","🛴","🛹","🚏","🛣️","🛤️","⛽",
    "🛞","🚨","🚥","🚦","🛑","🚧","⚓","🛟",
    "⛵","🛶","🚤","🛳️","⛴️","🛥️","🚢","✈️",
    "🛩️","🛫","🛬","🪂","💺","🚁","🚟","🚠",
    "🚡","🛰️","🚀","🛸","🏠","🏡","🏘️","🏚️",
    "🏗️","🏭","🏢","🏬","🏣","🏤","🏥","🏦",
    "🏨","🏪","🏫","🏩","💒","🏛️","⛪","🕌",
    "🛕","🕍","⛩️","🕋","⛲","⛺","🌁","🌃",
    "🏙️","🌄","🌅","🌆","🌇","🌉","🗼","🗽",
    "🗻","🏕️","🎠","🎡","🎢","🏖️","🏝️","🏜️",
    "🌋","⛰️","🗺️","🧭","🏔️",
  ]},
  { id: "objects", icon: "💡", label: "Objects", emojis: [
    "⌚","📱","📲","💻","⌨️","🖥️","🖨️","🖱️",
    "🖲️","🕹️","🗜️","💽","💾","💿","📀","📼",
    "📷","📸","📹","🎥","📽️","🎞️","📞","☎️",
    "📟","📠","📺","📻","🎙️","🎚️","🎛️","🧭",
    "⏱️","⏲️","⏰","🕰️","⌛","⏳","📡","🔋",
    "🪫","🔌","💡","🔦","🕯️","🪔","🧯","🛢️",
    "🛍️","💰","💴","💵","💶","💷","🪙","💸",
    "💳","🧾","💹","✉️","📧","📨","📩","📤",
    "📥","📦","📫","📬","📭","📮","🗳️","✏️",
    "✒️","🖋️","🖊️","🖌️","🖍️","📝","💼","📁",
    "📂","🗂️","📅","📆","🗒️","🗓️","📇","📈",
    "📉","📊","📋","📌","📍","📎","🖇️","📏",
    "📐","✂️","🗃️","🗄️","🗑️","🔒","🔓","🔏",
    "🔐","🔑","🗝️","🔨","🪓","⛏️","⚒️","🛠️",
    "🗡️","⚔️","💣","🪃","🏹","🛡️","🪚","🔧",
    "🪛","🔩","⚙️","🗜️","⚖️","🦯","🔗","⛓️",
    "🪝","🧰","🧲","🪜","⚗️","🧪","🧫","🧬",
    "🔬","🔭","📡","💉","🩸","💊","🩹","🩼",
    "🩺","🩻","🚪","🛗","🪞","🪟","🛏️","🛋️",
    "🪑","🚽","🪠","🚿","🛁","🪤","🪒","🧴",
    "🧷","🧹","🧺","🧻","🪣","🧼","🫧","🪥",
    "🧽","🧯","🛒","🚬","⚰️","🪦","⚱️","🧿",
    "🪬","🗿","🪧","🪪",
  ]},
  { id: "symbols", icon: "❤️", label: "Symbols", emojis: [
    "❤️","🧡","💛","💚","💙","💜","🖤","🤍",
    "🤎","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓",
    "💗","💖","💘","💝","💟","☮️","✝️","☪️",
    "🕉️","☸️","🪯","✡️","🔯","🕎","☯️","☦️",
    "🛐","⛎","♈","♉","♊","♋","♌","♍",
    "♎","♏","♐","♑","♒","♓","🆔","⚛️",
    "🉑","☢️","☣️","📴","📳","🈶","🈚","🈸",
    "🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️",
    "🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑",
    "🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫",
    "💯","💢","♨️","🚷","🚯","🚳","🚱","🔞",
    "📵","🚭","❗","❕","❓","❔","‼️","⁉️",
    "🔅","🔆","〽️","⚠️","🚸","🔱","⚜️","🔰",
    "♻️","✅","🈯","💹","❇️","✳️","❎","🌐",
    "💠","Ⓜ️","🌀","💤","🏧","🚾","♿","🅿️",
    "🛗","🈳","🈂️","🛂","🛃","🛄","🛅","🚹",
    "🚺","🚼","⚧️","🚻","🚮","🎦","📶","🈁",
    "🔣","ℹ️","🔤","🔡","🔠","🆖","🆗","🆙",
    "🆒","🆕","🆓","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣",
    "5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🔢","#️⃣",
    "*️⃣","⏏️","▶️","⏸️","⏯️","⏹️","⏺️","⏭️",
    "⏮️","⏩","⏪","⏫","⏬","◀️","🔼","🔽",
    "➡️","⬅️","⬆️","⬇️","↗️","↘️","↙️","↖️",
    "↕️","↔️","↩️","↪️","⤴️","⤵️","🔀","🔁",
    "🔂","🔄","🔃","🎵","🎶","✖️","➕","➖",
    "➗","🟰","♾️","💲","💱","™️","©️","®️",
    "〰️","➰","➿","🔚","🔙","🔛","🔝","🔜",
    "✔️","☑️","🔘","🔴","🟠","🟡","🟢","🔵",
    "🟣","⚫","⚪","🟤","🔺","🔻","🔸","🔹",
    "🔶","🔷","🔳","🔲","▪️","▫️","◾","◽",
    "◼️","◻️","🟥","🟧","🟨","🟩","🟦","🟪",
    "⬛","⬜","🟫","🔈","🔇","🔉","🔊","🔔",
    "🔕","📣","📢","👁️‍🗨️","💬","💭","🗯️","♠️",
    "♣️","♥️","♦️","🃏","🎴","🀄","🕐","🕑",
    "🕒","🕓","🕔","🕕","🕖","🕗","🕘","🕙","🕚","🕛",
  ]},
  { id: "flags", icon: "🏁", label: "Flags", emojis: [
    "🏁","🚩","🎌","🏴","🏳️","🏳️‍🌈","🏳️‍⚧️","🏴‍☠️",
    "🇦🇨","🇦🇩","🇦🇪","🇦🇫","🇦🇬","🇦🇮","🇦🇱","🇦🇲",
    "🇦🇴","🇦🇶","🇦🇷","🇦🇸","🇦🇹","🇦🇺","🇦🇼","🇦🇽",
    "🇦🇿","🇧🇦","🇧🇧","🇧🇩","🇧🇪","🇧🇫","🇧🇬","🇧🇭",
    "🇧🇮","🇧🇯","🇧🇱","🇧🇲","🇧🇳","🇧🇴","🇧🇶","🇧🇷",
    "🇧🇸","🇧🇹","🇧🇻","🇧🇼","🇧🇾","🇧🇿","🇨🇦","🇨🇨",
    "🇨🇩","🇨🇫","🇨🇬","🇨🇭","🇨🇮","🇨🇰","🇨🇱","🇨🇲",
    "🇨🇳","🇨🇴","🇨🇵","🇨🇷","🇨🇺","🇨🇻","🇨🇼","🇨🇽",
    "🇨🇾","🇨🇿","🇩🇪","🇩🇬","🇩🇯","🇩🇰","🇩🇲","🇩🇴",
    "🇩🇿","🇪🇦","🇪🇨","🇪🇪","🇪🇬","🇪🇭","🇪🇷","🇪🇸",
    "🇪🇹","🇪🇺","🇫🇮","🇫🇯","🇫🇰","🇫🇲","🇫🇴","🇫🇷",
    "🇬🇦","🇬🇧","🇬🇩","🇬🇪","🇬🇫","🇬🇬","🇬🇭","🇬🇮",
    "🇬🇱","🇬🇲","🇬🇳","🇬🇵","🇬🇶","🇬🇷","🇬🇸","🇬🇹",
    "🇬🇺","🇬🇼","🇬🇾","🇭🇰","🇭🇲","🇭🇳","🇭🇷","🇭🇹",
    "🇭🇺","🇮🇨","🇮🇩","🇮🇪","🇮🇱","🇮🇲","🇮🇳","🇮🇴",
    "🇮🇶","🇮🇷","🇮🇸","🇮🇹","🇯🇪","🇯🇲","🇯🇴","🇯🇵",
    "🇰🇪","🇰🇬","🇰🇭","🇰🇮","🇰🇲","🇰🇳","🇰🇵","🇰🇷",
    "🇰🇼","🇰🇾","🇰🇿","🇱🇦","🇱🇧","🇱🇨","🇱🇮","🇱🇰",
    "🇱🇷","🇱🇸","🇱🇹","🇱🇺","🇱🇻","🇱🇾","🇲🇦","🇲🇨",
    "🇲🇩","🇲🇪","🇲🇫","🇲🇬","🇲🇭","🇲🇰","🇲🇱","🇲🇲",
    "🇲🇳","🇲🇴","🇲🇵","🇲🇶","🇲🇷","🇲🇸","🇲🇹","🇲🇺",
    "🇲🇻","🇲🇼","🇲🇽","🇲🇾","🇲🇿","🇳🇦","🇳🇨","🇳🇪",
    "🇳🇫","🇳🇬","🇳🇮","🇳🇱","🇳🇴","🇳🇵","🇳🇷","🇳🇺",
    "🇳🇿","🇴🇲","🇵🇦","🇵🇪","🇵🇫","🇵🇬","🇵🇭","🇵🇰",
    "🇵🇱","🇵🇲","🇵🇳","🇵🇷","🇵🇸","🇵🇹","🇵🇼","🇵🇾",
    "🇶🇦","🇷🇪","🇷🇴","🇷🇸","🇷🇺","🇷🇼","🇸🇦","🇸🇧",
    "🇸🇨","🇸🇩","🇸🇪","🇸🇬","🇸🇭","🇸🇮","🇸🇯","🇸🇰",
    "🇸🇱","🇸🇲","🇸🇳","🇸🇴","🇸🇷","🇸🇸","🇸🇹","🇸🇻",
    "🇸🇽","🇸🇾","🇸🇿","🇹🇦","🇹🇨","🇹🇩","🇹🇫","🇹🇬",
    "🇹🇭","🇹🇯","🇹🇰","🇹🇱","🇹🇲","🇹🇳","🇹🇴","🇹🇷",
    "🇹🇹","🇹🇻","🇹🇼","🇹🇿","🇺🇦","🇺🇬","🇺🇲","🇺🇳",
    "🇺🇸","🇺🇾","🇺🇿","🇻🇦","🇻🇨","🇻🇪","🇻🇬","🇻🇮",
    "🇻🇳","🇻🇺","🇼🇫","🇼🇸","🇽🇰","🇾🇪","🇾🇹","🇿🇦",
    "🇿🇲","🇿🇼",
  ]},
];

// --- Project Access Popover ---
var projectAccessPopover = null;

function closeProjectAccessPopover() {
  if (projectAccessPopover) {
    projectAccessPopover.remove();
    projectAccessPopover = null;
    document.removeEventListener("click", closeAccessOnOutside);
    document.removeEventListener("keydown", closeAccessOnEscape);
  }
}

function closeAccessOnOutside(e) {
  if (projectAccessPopover && !projectAccessPopover.contains(e.target)) closeProjectAccessPopover();
}
function closeAccessOnEscape(e) {
  if (e.key === "Escape") closeProjectAccessPopover();
}

function showProjectAccessPopover(anchorEl, slug) {
  closeProjectAccessPopover();

  var popover = document.createElement("div");
  popover.className = "project-access-popover";
  popover.innerHTML = '<div class="project-access-loading">Loading...</div>';
  popover.addEventListener("click", function (e) { e.stopPropagation(); });
  document.body.appendChild(popover);
  projectAccessPopover = popover;

  // Position near anchor
  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    popover.style.position = "fixed";
    popover.style.left = (rect.right + 8) + "px";
    popover.style.top = rect.top + "px";
    popover.style.zIndex = "9999";
    var popRect = popover.getBoundingClientRect();
    if (popRect.right > window.innerWidth - 8) {
      popover.style.left = (rect.left - popRect.width - 8) + "px";
    }
    if (popRect.bottom > window.innerHeight - 8) {
      popover.style.top = (window.innerHeight - popRect.height - 8) + "px";
    }
  });

  setTimeout(function () {
    document.addEventListener("click", closeAccessOnOutside);
    document.addEventListener("keydown", closeAccessOnEscape);
  }, 0);

  // Fetch access info and user list in parallel
  Promise.all([
    fetch("/api/admin/projects/" + encodeURIComponent(slug) + "/access").then(function (r) { return r.json(); }),
    fetch("/api/admin/users").then(function (r) { return r.json(); }),
  ]).then(function (results) {
    var access = results[0];
    var usersData = results[1];
    if (access.error || usersData.error) {
      popover.innerHTML = '<div class="project-access-loading">Failed to load</div>';
      return;
    }
    renderAccessPopover(popover, slug, access, usersData.users || []);
  }).catch(function () {
    popover.innerHTML = '<div class="project-access-loading">Failed to load</div>';
  });
}

function renderAccessPopover(popover, slug, access, allUsers) {
  var visibility = access.visibility || "public";
  var allowedUsers = access.allowedUsers || [];
  var ownerId = access.ownerId;

  // Filter out the owner from the user list (owner always has access)
  var selectableUsers = allUsers.filter(function (u) { return u.id !== ownerId; });

  var html = '';
  html += '<div class="project-access-header">';
  html += '<span class="project-access-title">Project Access</span>';
  html += '<button class="project-access-close">&times;</button>';
  html += '</div>';

  // Visibility toggle
  html += '<div class="project-access-section">';
  html += '<label class="project-access-label">Visibility</label>';
  html += '<div class="project-access-vis-row">';
  html += '<button class="project-access-vis-btn' + (visibility === "private" ? ' active' : '') + '" data-vis="private">';
  html += iconHtml("lock") + ' Private';
  html += '</button>';
  html += '<button class="project-access-vis-btn' + (visibility === "public" ? ' active' : '') + '" data-vis="public">';
  html += iconHtml("globe") + ' Public';
  html += '</button>';
  html += '</div>';
  html += '</div>';

  // Allowed users (only when private)
  html += '<div class="project-access-section project-access-users-section"' + (visibility !== "private" ? ' style="display:none"' : '') + '>';
  html += '<label class="project-access-label">Allowed Users</label>';
  html += '<div class="project-access-user-list">';
  for (var i = 0; i < selectableUsers.length; i++) {
    var u = selectableUsers[i];
    var checked = allowedUsers.indexOf(u.id) !== -1 ? " checked" : "";
    html += '<label class="project-access-user-item">';
    html += '<input type="checkbox" data-uid="' + u.id + '"' + checked + '>';
    html += '<span>' + escapeHtml(u.displayName || u.username || u.id) + '</span>';
    html += '</label>';
  }
  if (selectableUsers.length === 0) {
    html += '<div class="project-access-empty">No other users</div>';
  }
  html += '</div>';
  html += '</div>';

  popover.innerHTML = html;
  refreshIcons();

  // Close button
  popover.querySelector(".project-access-close").addEventListener("click", function () {
    closeProjectAccessPopover();
  });

  // Visibility toggle
  popover.querySelectorAll(".project-access-vis-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var newVis = btn.dataset.vis;
      popover.querySelectorAll(".project-access-vis-btn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var usersSection = popover.querySelector(".project-access-users-section");
      if (usersSection) usersSection.style.display = newVis === "private" ? "" : "none";
      fetch("/api/admin/projects/" + encodeURIComponent(slug) + "/visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: newVis }),
      });
    });
  });

  // User checkboxes
  popover.querySelectorAll('.project-access-user-item input[type="checkbox"]').forEach(function (cb) {
    cb.addEventListener("change", function () {
      var selected = [];
      popover.querySelectorAll('.project-access-user-item input[type="checkbox"]:checked').forEach(function (c) {
        selected.push(c.dataset.uid);
      });
      fetch("/api/admin/projects/" + encodeURIComponent(slug) + "/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedUsers: selected }),
      });
    });
  });
}

function closeProjectCtxMenu() {
  if (projectCtxMenu) {
    projectCtxMenu.remove();
    projectCtxMenu = null;
  }
}

function showIconCtxMenu(anchorEl, slug, name) {
  closeProjectCtxMenu();
  closeUserCtxMenu();
  closeEmojiPicker();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  var isWorktree = slug.indexOf("--") !== -1;

  if (isWorktree) {
    // Worktree context menu: only "Remove Worktree"
    var removeWtItem = document.createElement("button");
    removeWtItem.className = "project-ctx-item project-ctx-delete";
    removeWtItem.innerHTML = iconHtml("trash-2") + " <span>Remove Worktree</span>";
    removeWtItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeProjectCtxMenu();
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "remove_project_check", slug: slug, name: name || slug }));
      }
    });
    menu.appendChild(removeWtItem);
  } else {
    // Regular project context menu
    var iconItem = document.createElement("button");
    iconItem.className = "project-ctx-item";
    iconItem.innerHTML = iconHtml("smile") + " <span>Set Icon</span>";
    iconItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeProjectCtxMenu();
      showEmojiPicker(slug, anchorEl);
    });
    menu.appendChild(iconItem);

    // --- Add Worktree ---
    var wtItem = document.createElement("button");
    wtItem.className = "project-ctx-item";
    wtItem.innerHTML = iconHtml("git-branch") + " <span>Add Worktree</span>";
    wtItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeProjectCtxMenu();
      showWorktreeModal(slug, name || slug);
    });
    menu.appendChild(wtItem);
    // Remove Project intentionally omitted from right-click.
    // Destructive actions only live in the chevron menu.
  }

  document.body.appendChild(menu);
  projectCtxMenu = menu;
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
}

function showProjectCtxMenu(anchorEl, slug, name, icon, position) {
  closeProjectCtxMenu();
  closeUserCtxMenu();
  closeEmojiPicker();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  // --- Set Icon ---
  var iconItem = document.createElement("button");
  iconItem.className = "project-ctx-item";
  iconItem.innerHTML = iconHtml("smile") + " <span>Set Icon</span>";
  iconItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    showEmojiPicker(slug, anchorEl);
  });
  menu.appendChild(iconItem);

  // --- Project Settings ---
  if (!ctx.permissions || ctx.permissions.projectSettings !== false) {
    var settingsItem = document.createElement("button");
    settingsItem.className = "project-ctx-item";
    settingsItem.innerHTML = iconHtml("settings") + " <span>Project Settings</span>";
    settingsItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeProjectCtxMenu();
      openProjectSettings(slug, { slug: slug, name: name, icon: icon, projectOwnerId: ctx.projectOwnerId });
    });
    menu.appendChild(settingsItem);
  }

  // --- Separator: collaboration ---
  var sep1 = document.createElement("div");
  sep1.className = "project-ctx-separator";
  menu.appendChild(sep1);

  // --- Share ---
  var shareItem = document.createElement("button");
  shareItem.className = "project-ctx-item";
  shareItem.innerHTML = iconHtml("share") + " <span>Share</span>";
  shareItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    triggerShare();
  });
  menu.appendChild(shareItem);

  // --- Manage Access (owner or admin, multi-user only) ---
  if (ctx.multiUser && slug.indexOf("--") === -1) {
    var isProjectOwner = ctx.myUserId && ctx.projectOwnerId && ctx.myUserId === ctx.projectOwnerId;
    var isAdmin = ctx.permissions && ctx.permissions.projectSettings !== false;
    if (isProjectOwner || isAdmin) {
      var accessItem = document.createElement("button");
      accessItem.className = "project-ctx-item";
      accessItem.innerHTML = iconHtml("users") + " <span>Manage Access</span>";
      accessItem.addEventListener("click", function (e) {
        e.stopPropagation();
        closeProjectCtxMenu();
        showProjectAccessPopover(anchorEl, slug);
      });
      menu.appendChild(accessItem);
    }
  }

  // --- Separator: development ---
  var sep2 = document.createElement("div");
  sep2.className = "project-ctx-separator";
  menu.appendChild(sep2);

  // --- Add Worktree ---
  var wtItem = document.createElement("button");
  wtItem.className = "project-ctx-item";
  wtItem.innerHTML = iconHtml("git-branch") + " <span>Add Worktree</span>";
  wtItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    showWorktreeModal(slug, name || slug);
  });
  menu.appendChild(wtItem);

  if (!ctx.permissions || ctx.permissions.deleteProject !== false) {
    // --- Separator: danger zone ---
    var sep3 = document.createElement("div");
    sep3.className = "project-ctx-separator";
    menu.appendChild(sep3);

    // --- Remove Project ---
    var deleteItem = document.createElement("button");
    deleteItem.className = "project-ctx-item project-ctx-delete";
    deleteItem.innerHTML = iconHtml("trash-2") + " <span>Remove Project</span>";
    deleteItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeProjectCtxMenu();
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "remove_project_check", slug: slug, name: name }));
      }
    });
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);
  projectCtxMenu = menu;
  refreshIcons();

  // Position
  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    if (position === "below") {
      // Chevron dropdown: directly below the anchor
      menu.style.left = rect.left + "px";
      menu.style.top = (rect.bottom + 4) + "px";
    } else {
      // Icon strip right-click: to the right of the anchor
      menu.style.left = (rect.right + 6) + "px";
      menu.style.top = rect.top + "px";
    }
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      menu.style.left = (rect.left - menuRect.width - 6) + "px";
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
    }
  });
}

// --- Emoji picker ---
var emojiPickerEl = null;

function closeEmojiPicker() {
  if (emojiPickerEl) {
    emojiPickerEl.remove();
    emojiPickerEl = null;
  }
}

function showEmojiPicker(slug, anchorEl) {
  closeEmojiPicker();

  var picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.addEventListener("click", function (e) { e.stopPropagation(); });

  // --- Header ---
  var header = document.createElement("div");
  header.className = "emoji-picker-header";
  header.textContent = "Choose Icon";

  var removeBtn = document.createElement("button");
  removeBtn.className = "emoji-picker-remove";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    closeEmojiPicker();
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "set_project_icon", slug: slug, icon: null }));
    }
  });
  header.appendChild(removeBtn);
  picker.appendChild(header);

  // --- Category tabs ---
  var tabBar = document.createElement("div");
  tabBar.className = "emoji-picker-tabs";
  var tabBtns = [];

  for (var t = 0; t < EMOJI_CATEGORIES.length; t++) {
    (function (cat, idx) {
      var tab = document.createElement("button");
      tab.className = "emoji-picker-tab" + (idx === 0 ? " active" : "");
      tab.textContent = cat.icon;
      tab.title = cat.label;
      tab.addEventListener("click", function (e) {
        e.stopPropagation();
        switchCategory(idx);
      });
      tabBar.appendChild(tab);
      tabBtns.push(tab);
    })(EMOJI_CATEGORIES[t], t);
  }
  parseEmojis(tabBar);
  picker.appendChild(tabBar);

  // --- Scrollable grid area ---
  var scrollArea = document.createElement("div");
  scrollArea.className = "emoji-picker-scroll";

  var grid = document.createElement("div");
  grid.className = "emoji-picker-grid";
  scrollArea.appendChild(grid);
  picker.appendChild(scrollArea);

  function buildGrid(emojis) {
    grid.innerHTML = "";
    for (var i = 0; i < emojis.length; i++) {
      (function (emoji) {
        var btn = document.createElement("button");
        btn.className = "emoji-picker-item";
        btn.textContent = emoji;
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          closeEmojiPicker();
          if (ctx.ws && ctx.connected) {
            ctx.ws.send(JSON.stringify({ type: "set_project_icon", slug: slug, icon: emoji }));
          }
        });
        grid.appendChild(btn);
      })(emojis[i]);
    }
    parseEmojis(grid);
    scrollArea.scrollTop = 0;
  }

  function switchCategory(idx) {
    for (var j = 0; j < tabBtns.length; j++) {
      tabBtns[j].classList.toggle("active", j === idx);
    }
    buildGrid(EMOJI_CATEGORIES[idx].emojis);
  }

  // Start with first category (Frequent)
  buildGrid(EMOJI_CATEGORIES[0].emojis);



  document.body.appendChild(picker);
  emojiPickerEl = picker;

  // Position
  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    picker.style.left = (rect.right + 6) + "px";
    picker.style.top = rect.top + "px";
    var pRect = picker.getBoundingClientRect();
    if (pRect.right > window.innerWidth - 8) {
      picker.style.left = (rect.left - pRect.width - 6) + "px";
    }
    if (pRect.bottom > window.innerHeight - 8) {
      picker.style.top = (window.innerHeight - pRect.height - 8) + "px";
    }
  });
}

// --- Rename prompt ---
function showProjectRename(slug, currentName) {
  var nameEl = document.getElementById("title-bar-project-name");
  if (!nameEl) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "project-rename-input";
  input.value = currentName || "";

  var originalText = nameEl.textContent;
  nameEl.textContent = "";
  nameEl.appendChild(input);
  input.focus();
  input.select();

  var committed = false;

  function commitRename() {
    if (committed) return;
    committed = true;
    var newName = input.value.trim();
    if (newName && newName !== currentName && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "set_project_title", slug: slug, title: newName }));
      nameEl.textContent = newName;
    } else {
      nameEl.textContent = originalText;
    }
  }

  input.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); committed = true; nameEl.textContent = originalText; }
  });
  input.addEventListener("blur", commitRename);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

// Click outside to close
document.addEventListener("click", function () {
  closeProjectCtxMenu();
  closeEmojiPicker();
});

// --- Drag-and-drop state ---
var draggedSlug = null;
var draggedEl = null;

function showTrashZone() {
  var addBtn = document.getElementById("icon-strip-add");
  if (!addBtn) return;
  addBtn.style.display = "none";

  var existing = document.getElementById("icon-strip-trash");
  if (existing) existing.remove();

  var trash = document.createElement("div");
  trash.id = "icon-strip-trash";
  trash.className = "icon-strip-trash";
  trash.innerHTML = iconHtml("trash-2");
  addBtn.parentNode.insertBefore(trash, addBtn.nextSibling);
  refreshIcons();

  // Tooltip
  trash.addEventListener("mouseenter", function () { showIconTooltip(trash, "Remove project"); });
  trash.addEventListener("mouseleave", hideIconTooltip);

  trash.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    trash.classList.add("drag-hover");
  });
  trash.addEventListener("dragleave", function () {
    trash.classList.remove("drag-hover");
  });
  trash.addEventListener("drop", function (e) {
    e.preventDefault();
    trash.classList.remove("drag-hover");
    var slug = e.dataTransfer.getData("text/plain");
    if (slug && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "remove_project_check", slug: slug }));
    }
  });
}

function hideTrashZone() {
  var trash = document.getElementById("icon-strip-trash");
  if (trash) trash.remove();
  var addBtn = document.getElementById("icon-strip-add");
  if (addBtn) addBtn.style.display = "";
}

export function spawnDustParticles(cx, cy) {
  var colors = ["#8B7355", "#A0522D", "#D2B48C", "#C4A882", "#9E9E9E", "#B8860B", "#BC8F8F"];
  var count = 24;
  var container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "0";
  container.style.height = "0";
  container.style.pointerEvents = "none";
  container.style.zIndex = "10000";
  document.body.appendChild(container);

  for (var i = 0; i < count; i++) {
    var dot = document.createElement("div");
    dot.className = "dust-particle";
    var size = 3 + Math.random() * 5;
    var angle = Math.random() * Math.PI * 2;
    var dist = 30 + Math.random() * 60;
    var dx = Math.cos(angle) * dist;
    var dy = Math.sin(angle) * dist - 20; // bias upward
    var duration = 600 + Math.random() * 500;

    dot.style.width = size + "px";
    dot.style.height = size + "px";
    dot.style.left = cx + "px";
    dot.style.top = cy + "px";
    dot.style.background = colors[Math.floor(Math.random() * colors.length)];
    dot.style.setProperty("--dust-x", dx + "px");
    dot.style.setProperty("--dust-y", dy + "px");
    dot.style.setProperty("--dust-duration", duration + "ms");

    container.appendChild(dot);
  }

  setTimeout(function () { container.remove(); }, 1200);
}

function clearDragIndicators() {
  var items = document.querySelectorAll(".icon-strip-item.drag-over-above, .icon-strip-item.drag-over-below");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove("drag-over-above", "drag-over-below");
  }
}

function setupDragHandlers(el, slug) {
  el.setAttribute("draggable", "true");

  el.addEventListener("dragstart", function (e) {
    draggedSlug = slug;
    draggedEl = el;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", slug);

    // Custom drag image — just the 38px rounded icon, no pill/status
    var ghost = document.createElement("div");
    ghost.textContent = el.textContent.trim().split("\n")[0]; // abbreviation only
    ghost.style.cssText = "position:fixed;left:-200px;top:-200px;width:38px;height:38px;border-radius:12px;" +
      "background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;" +
      "font-size:15px;font-weight:600;pointer-events:none;z-index:-1;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 19, 19);
    setTimeout(function () { ghost.remove(); }, 0);

    setTimeout(function () { el.classList.add("dragging"); }, 0);
    hideIconTooltip();
    showTrashZone();
  });

  el.addEventListener("dragover", function (e) {
    e.preventDefault();
    if (!draggedSlug || draggedSlug === slug) return;
    e.dataTransfer.dropEffect = "move";

    clearDragIndicators();
    var rect = el.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      el.classList.add("drag-over-above");
    } else {
      el.classList.add("drag-over-below");
    }
  });

  el.addEventListener("dragleave", function () {
    el.classList.remove("drag-over-above", "drag-over-below");
  });

  el.addEventListener("drop", function (e) {
    e.preventDefault();
    clearDragIndicators();
    if (!draggedSlug || draggedSlug === slug) return;

    var rect = el.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    var insertBefore = e.clientY < midY;

    // Build new slug order
    var container = document.getElementById("icon-strip-projects");
    var items = container.querySelectorAll(".icon-strip-item");
    var slugs = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.slug !== draggedSlug) {
        slugs.push(items[i].dataset.slug);
      }
    }
    // Insert dragged slug at correct position
    var targetIdx = slugs.indexOf(slug);
    if (!insertBefore) targetIdx++;
    slugs.splice(targetIdx, 0, draggedSlug);

    // Send reorder to server
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "reorder_projects", slugs: slugs }));
    }
  });

  el.addEventListener("dragend", function () {
    el.classList.remove("dragging");
    clearDragIndicators();
    draggedSlug = null;
    draggedEl = null;
    hideTrashZone();
  });
}

export function renderSidebarPresence(onlineUsers) {
  var container = document.getElementById("sidebar-presence");
  if (!container) return;
  container.innerHTML = "";
  if (!onlineUsers || onlineUsers.length < 2) return;
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

// --- Worktree folder collapse state (persisted in localStorage) ---
var wtCollapsed = {};
try {
  wtCollapsed = JSON.parse(localStorage.getItem("clay-wt-collapsed") || "{}");
} catch (e) {}
function setWtCollapsed(slug, collapsed) {
  wtCollapsed[slug] = collapsed;
  try { localStorage.setItem("clay-wt-collapsed", JSON.stringify(wtCollapsed)); } catch (e) {}
}

// Group projects by parent/worktree relationship
function groupProjects(projects) {
  var parents = [];
  var wtByParent = {};
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    if (p.isWorktree && p.parentSlug) {
      if (!wtByParent[p.parentSlug]) wtByParent[p.parentSlug] = [];
      wtByParent[p.parentSlug].push(p);
    } else {
      parents.push(p);
    }
  }
  return { parents: parents, wtByParent: wtByParent };
}

// Create a standard icon-strip item element (shared between parent and worktree rendering)
function createIconItem(p, currentSlug) {
  var el = document.createElement("a");
  var isActive = p.slug === currentSlug && !currentDmUserId;
  el.className = "icon-strip-item" + (isActive ? " active" : "");
  el.href = "/p/" + p.slug + "/";
  el.dataset.slug = p.slug;

  if (p.icon) {
    var emojiSpan = document.createElement("span");
    emojiSpan.className = "project-emoji";
    emojiSpan.textContent = p.icon;
    parseEmojis(emojiSpan);
    el.appendChild(emojiSpan);
  } else {
    el.appendChild(document.createTextNode(getProjectAbbrev(p.name)));
  }

  var pill = document.createElement("span");
  pill.className = "icon-strip-pill";
  el.appendChild(pill);

  var statusDot = document.createElement("span");
  statusDot.className = "icon-strip-status";
  if (p.isProcessing) statusDot.classList.add("processing");
  el.appendChild(statusDot);

  var projectBadge = document.createElement("span");
  projectBadge.className = "icon-strip-project-badge";
  if (p.unread > 0 && !isActive) {
    projectBadge.textContent = p.unread > 99 ? "99+" : String(p.unread);
    projectBadge.classList.add("has-unread");
  }
  el.appendChild(projectBadge);

  // Pending permission shake for non-active projects
  if (p.pendingPermissions > 0 && !isActive) {
    el.classList.add("has-pending-perm");
  }

  (function (name, elem) {
    elem.addEventListener("mouseenter", function () { showIconTooltip(elem, name); });
    elem.addEventListener("mouseleave", hideIconTooltip);
  })(p.name, el);

  (function (slug) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (ctx.switchProject) ctx.switchProject(slug);
    });
  })(p.slug);

  return el;
}

// Worktree creation modal
function showWorktreeModal(parentSlug, parentName) {
  // Remove existing modal if any
  var existing = document.getElementById("wt-modal-container");
  if (existing) existing.remove();

  var container = document.createElement("div");
  container.id = "wt-modal-container";

  var overlay = document.createElement("div");
  overlay.className = "wt-modal-overlay";
  container.appendChild(overlay);

  var modal = document.createElement("div");
  modal.className = "wt-modal";

  var title = document.createElement("div");
  title.className = "wt-modal-title";
  title.textContent = "Add Worktree \u2014 " + parentName;
  modal.appendChild(title);

  var branchLabel = document.createElement("label");
  branchLabel.className = "wt-modal-label";
  branchLabel.textContent = "Branch name";
  modal.appendChild(branchLabel);

  var branchInput = document.createElement("input");
  branchInput.type = "text";
  branchInput.className = "wt-modal-input";
  branchInput.placeholder = "feat/my-feature";
  branchInput.autocomplete = "off";
  branchInput.spellcheck = false;
  modal.appendChild(branchInput);

  var baseLabel = document.createElement("label");
  baseLabel.className = "wt-modal-label";
  baseLabel.textContent = "Base branch";
  modal.appendChild(baseLabel);

  var baseSelect = document.createElement("select");
  baseSelect.className = "wt-modal-input";
  // Add "main" as default while loading
  var defaultOpt = document.createElement("option");
  defaultOpt.value = "main";
  defaultOpt.textContent = "main";
  baseSelect.appendChild(defaultOpt);
  modal.appendChild(baseSelect);

  // Fetch branches from target project via HTTP API
  fetch("/p/" + parentSlug + "/api/branches")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      baseSelect.innerHTML = "";
      var branches = data.branches || ["main"];
      var defBranch = data.defaultBranch || "main";
      for (var i = 0; i < branches.length; i++) {
        var opt = document.createElement("option");
        opt.value = branches[i];
        opt.textContent = branches[i];
        if (branches[i] === defBranch) opt.selected = true;
        baseSelect.appendChild(opt);
      }
    })
    .catch(function () {});

  var errorDiv = document.createElement("div");
  errorDiv.className = "wt-modal-error";
  modal.appendChild(errorDiv);

  var actions = document.createElement("div");
  actions.className = "wt-modal-actions";

  var cancelBtn = document.createElement("button");
  cancelBtn.className = "wt-modal-btn";
  cancelBtn.textContent = "Cancel";
  actions.appendChild(cancelBtn);

  var createBtn = document.createElement("button");
  createBtn.className = "wt-modal-btn primary";
  createBtn.textContent = "Create";
  actions.appendChild(createBtn);

  modal.appendChild(actions);
  container.appendChild(modal);
  document.body.appendChild(container);
  branchInput.focus();

  function closeModal() { container.remove(); }

  function doCreate() {
    var branch = branchInput.value.trim();
    var base = baseSelect.value.trim() || null;
    if (!branch) {
      errorDiv.textContent = "Branch name is required";
      errorDiv.classList.add("visible");
      return;
    }
    // Sanitize: replace slashes with dashes for directory name
    var dirName = branch.replace(/\//g, "-");
    createBtn.disabled = true;
    createBtn.textContent = "Creating...";
    errorDiv.classList.remove("visible");

    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({
        type: "create_worktree",
        branch: branch,
        dirName: dirName,
        baseBranch: base
      }));
    }

    // Listen for the result
    var handler = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === "create_worktree_result") {
        ctx.ws.removeEventListener("message", handler);
        if (msg.ok) {
          closeModal();
          if (msg.slug && ctx.switchProject) ctx.switchProject(msg.slug);
        } else {
          createBtn.disabled = false;
          createBtn.textContent = "Create";
          errorDiv.textContent = msg.error || "Failed to create worktree";
          errorDiv.classList.add("visible");
        }
      }
    };
    ctx.ws.addEventListener("message", handler);
  }

  overlay.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  createBtn.addEventListener("click", doCreate);
  branchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") doCreate();
    if (e.key === "Escape") closeModal();
  });
  baseSelect.addEventListener("keydown", function (e) {
    if (e.key === "Enter") doCreate();
    if (e.key === "Escape") closeModal();
  });
}

export function renderIconStrip(projects, currentSlug) {
  cachedProjectList = projects;
  cachedCurrentSlug = currentSlug;

  var container = document.getElementById("icon-strip-projects");
  if (!container) return;
  container.innerHTML = "";

  var grouped = groupProjects(projects);

  for (var i = 0; i < grouped.parents.length; i++) {
    var p = grouped.parents[i];
    var worktrees = grouped.wtByParent[p.slug] || [];
    var hasWorktrees = worktrees.length > 0;

    if (!hasWorktrees) {
      // Regular project, render as before
      var el = createIconItem(p, currentSlug);
      (function (slug, name, elem) {
        elem.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          e.stopPropagation();
          showIconCtxMenu(elem, slug, name);
        });
      })(p.slug, p.name || p.slug, el);
      setupDragHandlers(el, p.slug);
      container.appendChild(el);
      continue;
    }

    // Folder group for parent + worktrees
    var folder = document.createElement("div");
    folder.className = "icon-strip-group";
    folder.dataset.parentSlug = p.slug;
    if (wtCollapsed[p.slug]) folder.classList.add("collapsed");

    // Bubble up worktree processing state to parent
    if (!p.isProcessing) {
      for (var wpi = 0; wpi < worktrees.length; wpi++) {
        if (worktrees[wpi].isProcessing) { p.isProcessing = true; break; }
      }
    }

    // Parent icon as folder header
    var header = createIconItem(p, currentSlug);
    header.classList.add("folder-header");
    (function (slug, name, elem) {
      elem.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showIconCtxMenu(elem, slug, name);
      });
    })(p.slug, p.name || p.slug, header);
    setupDragHandlers(header, p.slug);

    // Chevron toggle
    var chevron = document.createElement("span");
    chevron.className = "icon-strip-group-chevron";
    chevron.innerHTML = '<i data-lucide="git-branch"></i>';
    (function (parentSlug, folderEl) {
      chevron.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var nowCollapsed = folderEl.classList.toggle("collapsed");
        setWtCollapsed(parentSlug, nowCollapsed);
      });
      chevron.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
    })(p.slug, folder);
    chevron.setAttribute("data-tip", "Toggle worktrees");
    header.appendChild(chevron);
    folder.appendChild(header);

    // Worktree items container
    var itemsContainer = document.createElement("div");
    itemsContainer.className = "icon-strip-group-items";

    for (var wi = 0; wi < worktrees.length; wi++) {
      (function (wt) {
        var wtEl = document.createElement("a");
        var isWtActive = wt.slug === currentSlug && !currentDmUserId;
        var isAccessible = wt.worktreeAccessible !== false;
        wtEl.className = "icon-strip-wt-item" + (isWtActive ? " active" : "") + (!isAccessible ? " wt-disabled" : "");
        wtEl.href = "/p/" + wt.slug + "/";
        wtEl.dataset.slug = wt.slug;

        var abbrev = document.createElement("span");
        abbrev.className = "wt-branch-abbrev";
        abbrev.textContent = getProjectAbbrev(wt.name);
        wtEl.appendChild(abbrev);

        var wtStatus = document.createElement("span");
        wtStatus.className = "icon-strip-status";
        if (wt.isProcessing) wtStatus.classList.add("processing");
        wtEl.appendChild(wtStatus);

        var tooltipText = wt.name;
        if (!isAccessible) {
          tooltipText += " (outside project path, cannot be accessed)";
        }
        (function (text, elem) {
          elem.addEventListener("mouseenter", function () { showIconTooltip(elem, text); });
          elem.addEventListener("mouseleave", hideIconTooltip);
        })(tooltipText, wtEl);

        if (isAccessible) {
          (function (slug) {
            wtEl.addEventListener("click", function (e) {
              e.preventDefault();
              if (ctx.switchProject) ctx.switchProject(slug);
            });
          })(wt.slug);
        } else {
          wtEl.addEventListener("click", function (e) {
            e.preventDefault();
          });
        }

        if (isAccessible) {
          (function (slug, name, elem) {
            elem.addEventListener("contextmenu", function (e) {
              e.preventDefault();
              e.stopPropagation();
              showIconCtxMenu(elem, slug, name);
            });
          })(wt.slug, wt.name, wtEl);
        } else {
          wtEl.addEventListener("contextmenu", function (e) {
            e.preventDefault();
            e.stopPropagation();
          });
        }

        // Pending permission shake for worktree items
        if (wt.pendingPermissions > 0 && !isWtActive) {
          wtEl.classList.add("has-pending-perm");
        }

        itemsContainer.appendChild(wtEl);
      })(worktrees[wi]);
    }

    // Force expand if any worktree has pending permissions
    var hasWtPendingPerm = false;
    for (var wpi2 = 0; wpi2 < worktrees.length; wpi2++) {
      if (worktrees[wpi2].pendingPermissions > 0) { hasWtPendingPerm = true; break; }
    }
    if (hasWtPendingPerm) folder.classList.remove("collapsed");

    // "+" button to add new worktree
    var addBtn = document.createElement("button");
    addBtn.className = "icon-strip-group-add";
    addBtn.textContent = "+";
    (function (parentSlug, parentName, btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showWorktreeModal(parentSlug, parentName);
      });
      btn.addEventListener("mouseenter", function () { showIconTooltip(btn, "New worktree"); });
      btn.addEventListener("mouseleave", hideIconTooltip);
    })(p.slug, p.name, addBtn);
    itemsContainer.appendChild(addBtn);

    folder.appendChild(itemsContainer);
    container.appendChild(folder);
  }

  // Update home icon active state
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) {
    if ((!currentSlug || projects.length === 0) && !currentDmUserId) {
      homeIcon.classList.add("active");
    } else {
      homeIcon.classList.remove("active");
    }
  }

  renderProjectList(projects, currentSlug);

  // Render Lucide icons added dynamically (e.g. worktree git-branch icon)
  try { lucide.createIcons({ nodes: [container] }); } catch (e) {}
}

function renderProjectList(projects, currentSlug) {
  var list = document.getElementById("project-list");
  if (!list) return;
  list.innerHTML = "";

  var grouped = groupProjects(projects);

  for (var i = 0; i < grouped.parents.length; i++) {
    var p = grouped.parents[i];
    var worktrees = grouped.wtByParent[p.slug] || [];

    if (worktrees.length === 0) {
      // Regular project
      list.appendChild(createMobileProjectItem(p, currentSlug, false));
      continue;
    }

    // Folder for parent + worktrees
    var folderDiv = document.createElement("div");
    folderDiv.className = "mobile-project-folder";
    if (wtCollapsed[p.slug]) folderDiv.classList.add("collapsed");

    var headerEl = createMobileProjectItem(p, currentSlug, false);
    var chevron = document.createElement("span");
    chevron.className = "mobile-folder-chevron";
    chevron.innerHTML = "&#9660;";
    (function (parentSlug, fDiv) {
      chevron.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var nowCollapsed = fDiv.classList.toggle("collapsed");
        setWtCollapsed(parentSlug, nowCollapsed);
      });
    })(p.slug, folderDiv);
    headerEl.appendChild(chevron);
    folderDiv.appendChild(headerEl);

    var wtList = document.createElement("div");
    wtList.className = "mobile-folder-items";
    for (var wi = 0; wi < worktrees.length; wi++) {
      var isAccessible = worktrees[wi].worktreeAccessible !== false;
      var wtItem = createMobileProjectItem(worktrees[wi], currentSlug, true);
      if (!isAccessible) wtItem.classList.add("wt-disabled");
      if (!isAccessible) {
        wtItem.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); });
      }
      wtList.appendChild(wtItem);
    }
    folderDiv.appendChild(wtList);
    list.appendChild(folderDiv);
  }
}

function createMobileProjectItem(p, currentSlug, isWorktree) {
  var el = document.createElement("button");
  el.className = "mobile-project-item" + (p.slug === currentSlug ? " active" : "") + (isWorktree ? " wt-item" : "");

  var abbrev = document.createElement("span");
  abbrev.className = "mobile-project-abbrev";
  if (p.icon) {
    abbrev.textContent = p.icon;
    parseEmojis(abbrev);
  } else {
    abbrev.textContent = getProjectAbbrev(p.name);
  }
  el.appendChild(abbrev);

  var name = document.createElement("span");
  name.className = "mobile-project-name";
  name.textContent = p.name;
  el.appendChild(name);

  if (p.isProcessing) {
    var dot = document.createElement("span");
    dot.className = "mobile-project-processing";
    el.appendChild(dot);
  }

  el.addEventListener("click", function () {
    if (ctx.switchProject) ctx.switchProject(p.slug);
    closeSidebar();
  });

  return el;
}

export function getEmojiCategories() { return EMOJI_CATEGORIES; }

// --- User strip (DM targets) ---
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

export function renderUserStrip(allUsers, onlineUserIds, myUserId, dmFavorites, dmConversations, dmUnread, dmRemovedUsers, matesList) {
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

  // Hide section if no other users (single-user mode or alone)
  if (allOthers.length === 0) {
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
        if (ctx.openDm) ctx.openDm(u.id);
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
  if (ctx && ctx.projectList) {
    var allProjects = ctx.projectList;
    for (var pi = 0; pi < allProjects.length; pi++) {
      if (allProjects[pi].isMate) {
        mateProjectStatus[allProjects[pi].slug] = allProjects[pi];
      }
    }
  }

  // Render mates (only favorites, built-in first, then user-created)
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
      el.appendChild(avatar);

      // Processing status dot (IO blink)
      var statusDot = document.createElement("span");
      statusDot.className = "icon-strip-status";
      if (mateProj.isProcessing) statusDot.classList.add("processing");
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
      el.addEventListener("mouseenter", function () {
        var html = '<div style="font-weight:600">' + escapeHtml(displayName);
        if (mate.primary) {
          html += ' <span style="font-size:10px;font-weight:600;color:#00b894;background:rgba(0,184,148,0.1);padding:1px 5px;border-radius:3px;margin-left:4px">SYSTEM</span>';
        }
        html += '</div>';
        if (mate.bio) {
          html += '<div style="font-weight:400;font-size:12px;color:var(--text-secondary);margin-top:2px">' + escapeHtml(mate.bio) + '</div>';
        }
        showIconTooltipHtml(el, html);
      });
      el.addEventListener("mouseleave", hideIconTooltip);

      // Click: open DM with mate
      el.addEventListener("click", function () {
        if (ctx.openDm) ctx.openDm(mate.id);
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

  // Search input
  var searchInput = document.createElement("input");
  searchInput.className = "dm-user-picker-search";
  searchInput.type = "text";
  searchInput.placeholder = "Search mates and users...";
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
          if (ctx.sendWs) {
            ctx.sendWs({ type: "dm_add_favorite", targetUserId: u.id });
          }
          closeDmUserPicker();
        });

        listEl.appendChild(item);
      })(available[i]);
    }
  }

  // --- MATES section ---
  var matesSectionLabel = document.createElement("div");
  matesSectionLabel.className = "dm-user-picker-section";
  matesSectionLabel.textContent = "Mates";
  picker.appendChild(matesSectionLabel);

  var matesListEl = document.createElement("div");
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

  function renderMatesList(filter) {
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
    var availBuiltins = (ctx.availableBuiltins && ctx.availableBuiltins()) || [];
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
            if (ctx.sendWs) ctx.sendWs({ type: "mate_readd_builtin", builtinKey: b.key });
            closeDmUserPicker();
          });
          bItem.appendChild(bAddBtn);
          bItem.addEventListener("click", function () {
            if (ctx.sendWs) ctx.sendWs({ type: "mate_readd_builtin", builtinKey: b.key });
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
              if (ctx.sendWs) ctx.sendWs({ type: "mate_delete", mateId: m.id });
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
            if (ctx.openDm) ctx.openDm(m.id);
            if (!isFav && ctx.sendWs) ctx.sendWs({ type: "dm_add_favorite", targetUserId: m.id });
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
  }

  // Create Mate option
  var createMateEl = document.createElement("div");
  createMateEl.className = "dm-user-picker-create-mate";
  var hasCustomMates = (cachedMates || []).some(function (m) { return !m.builtinKey; });
  var createMateLabel = hasCustomMates ? "Create a Mate" : "Create a Mate for what you're doing";
  createMateEl.innerHTML = iconHtml("bot") + " <span>" + createMateLabel + "</span>";
  createMateEl.addEventListener("click", function () {
    closeDmUserPicker();
    if (ctx.openMateWizard) ctx.openMateWizard();
  });
  picker.appendChild(createMateEl);

  // Divider
  var divider = document.createElement("div");
  divider.style.borderTop = "1px solid var(--border, #333)";
  divider.style.margin = "4px 0";
  picker.appendChild(divider);

  // Section label for users
  var sectionLabel = document.createElement("div");
  sectionLabel.className = "dm-user-picker-section";
  sectionLabel.textContent = "Users";
  picker.appendChild(sectionLabel);
  picker.appendChild(listEl);

  renderMatesList("");
  renderPickerList("");
  searchInput.addEventListener("input", function () {
    var val = searchInput.value;
    renderMatesList(val);
    renderPickerList(val);
  });

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

export function updateSessionBadge(sessionId, count) {
  var badge = document.querySelector('.session-unread-badge[data-session-id="' + sessionId + '"]');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.add("has-unread");
  } else {
    badge.textContent = "";
    badge.classList.remove("has-unread");
  }
}

export function updateProjectBadge(slug, count) {
  var icon = document.querySelector('.icon-strip-item[data-slug="' + slug + '"]');
  if (!icon) return;
  var badge = icon.querySelector(".icon-strip-project-badge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.add("has-unread");
  } else {
    badge.textContent = "";
    badge.classList.remove("has-unread");
  }
}

export function initIconStrip(_ctx) {
  var addBtn = document.getElementById("icon-strip-add");
  if (addBtn) {
    addBtn.addEventListener("click", function () {
      if (_ctx.openAddProjectModal) {
        _ctx.openAddProjectModal();
      } else {
        var modal = _ctx.$("add-project-modal");
        if (modal) modal.classList.remove("hidden");
      }
    });
    addBtn.addEventListener("mouseenter", function () { showIconTooltip(addBtn, "Add project"); });
    addBtn.addEventListener("mouseleave", hideIconTooltip);
  }

  var exploreBtn = document.getElementById("icon-strip-explore");
  if (exploreBtn) {
    exploreBtn.addEventListener("click", function () {
      // Toggle file browser
      var fileBrowserBtn = _ctx.$("file-browser-btn");
      if (fileBrowserBtn) fileBrowserBtn.click();
    });
    exploreBtn.addEventListener("mouseenter", function () { showIconTooltip(exploreBtn, "File browser"); });
    exploreBtn.addEventListener("mouseleave", hideIconTooltip);
  }

  // Tooltip + click for home icon
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) {
    homeIcon.addEventListener("mouseenter", function () { showIconTooltip(homeIcon, "Clay"); });
    homeIcon.addEventListener("mouseleave", hideIconTooltip);
    homeIcon.addEventListener("click", function (e) {
      e.preventDefault();
      if (_ctx.showHomeHub) _ctx.showHomeHub();
    });
    homeIcon.style.cursor = "pointer";
  }

  // Chevron dropdown on project name
  var dropdownBtn = document.getElementById("title-bar-project-dropdown");
  if (dropdownBtn) {
    dropdownBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      // Find current project info from cached list
      var current = null;
      for (var i = 0; i < cachedProjectList.length; i++) {
        if (cachedProjectList[i].slug === cachedCurrentSlug) {
          current = cachedProjectList[i];
          break;
        }
      }
      if (!current) return;

      // Toggle open state
      if (projectCtxMenu) {
        closeProjectCtxMenu();
        dropdownBtn.classList.remove("open");
        return;
      }
      dropdownBtn.classList.add("open");
      showProjectCtxMenu(dropdownBtn, current.slug, current.name, current.icon, "below");
      // Remove open class when menu closes
      var observer = new MutationObserver(function () {
        if (!projectCtxMenu) {
          dropdownBtn.classList.remove("open");
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true });
    });
  }
}
