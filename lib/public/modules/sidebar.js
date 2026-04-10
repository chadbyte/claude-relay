import { mateAvatarUrl } from './avatar.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { parseEmojis } from './markdown.js';
import { getCurrentTheme, getChatLayout, setChatLayout } from './theme.js';
import { closeArchive } from './sticky-notes.js';
import { closeScheduler } from './scheduler.js';
import { openCommandPalette } from './command-palette.js';
import { getMateSessions } from './mate-sidebar.js';
import { openProjectSettings } from './project-settings.js';
import {
  initSidebarSessions,
  renderSessionList,
  handleSearchResults,
  updateSessionPresence,
  updateSessionBadge,
  populateCliSessionList,
  getDateGroup,
  highlightMatch,
  getCachedSessions,
  getSearchQuery,
  getSearchMatchIds,
  getExpandedLoopGroups,
  getExpandedLoopRuns
} from './sidebar-sessions.js';
import {
  initSidebarProjects,
  renderIconStrip,
  getEmojiCategories,
  updateProjectBadge,
  closeProjectCtxMenu,
  getProjectAbbrev,
  getCachedProjectList,
  getCachedCurrentSlug
} from './sidebar-projects.js';
import {
  initSidebarMates,
  renderUserStrip,
  closeDmUserPicker,
  setCurrentDmUser,
  updateDmBadge,
  renderSidebarPresence,
  showIconTooltip,
  showIconTooltipHtml,
  hideIconTooltip,
  closeUserCtxMenu,
  getCurrentDmUserId,
  getCachedMates,
  getCachedDmFavorites,
  getCachedDmUnread,
  getCachedDmRemovedUsers
} from './sidebar-mates.js';

var ctx;

// --- Mobile loop expansion state ---
var expandedMobileLoopGroups = new Set();
var expandedMobileLoopRuns = new Set();

var mobileChatSheetOpen = false; // track if chat sheet is showing

function dismissOverlayPanels() {
  closeArchive();
  closeScheduler();
}

// Re-export session functions for external consumers
export { renderSessionList, handleSearchResults, updateSessionPresence, updateSessionBadge, populateCliSessionList };

// Re-export project functions for external consumers
export { renderIconStrip, getEmojiCategories, updateProjectBadge };

// Re-export mate/user functions for external consumers
export { renderUserStrip, closeDmUserPicker, setCurrentDmUser, updateDmBadge, renderSidebarPresence };

// initIconStrip is now handled inside initSidebar via initSidebarProjects; keep as no-op for back-compat
export function initIconStrip() {}


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
  for (var i = 0; i < getCachedProjectList().length; i++) {
    (function (p) {
      var el = document.createElement("button");
      el.className = "mobile-project-item" + (p.slug === getCachedCurrentSlug() ? " active" : "");

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

      if (p.unread > 0 && p.slug !== getCachedCurrentSlug()) {
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
    })(getCachedProjectList()[i]);
  }
}

function renderSheetSessions(listEl) {
  // --- Context filter bar (horizontal scroll) ---
  var filterBar = document.createElement("div");
  filterBar.className = "mobile-chat-filter-bar";

  // Current project chip (always first, pre-selected)
  var currentProject = null;
  for (var pi = 0; pi < getCachedProjectList().length; pi++) {
    if (getCachedProjectList()[pi].slug === getCachedCurrentSlug()) {
      currentProject = getCachedProjectList()[pi];
      break;
    }
  }

  // Build chips: projects first, then mates
  var chips = [];

  for (var ci = 0; ci < getCachedProjectList().length; ci++) {
    (function (p) {
      var chip = document.createElement("button");
      chip.className = "mobile-chat-chip";
      var isDmActive = document.body.classList.contains("mate-dm-active");
      if (p.slug === getCachedCurrentSlug() && !isDmActive) chip.classList.add("active");
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

      if (p.unread > 0 && p.slug !== getCachedCurrentSlug()) {
        var badge = document.createElement("span");
        badge.className = "mobile-chat-chip-badge";
        badge.textContent = p.unread > 99 ? "99+" : String(p.unread);
        chip.appendChild(badge);
      }

      chips.push(chip);
    })(getCachedProjectList()[ci]);
  }

  var favoriteChipMates = getCachedMates().filter(function (m) {
    if (getCachedDmRemovedUsers()[m.id]) return false;
    if (getCachedDmFavorites().indexOf(m.id) !== -1) return true;
    if (getCachedDmUnread()[m.id] && getCachedDmUnread()[m.id] > 0) return true;
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
      if (getCurrentDmUserId() === mate.id) chip.classList.add("active");
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

      var unreadCount = getCachedDmUnread()[mate.id] || 0;
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
      // Mate DM: open the DM and show mate actions
      if (ctx.openDm) ctx.openDm(mateId);
      renderMateMobileActions(sessionListEl);
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
          var isDmNow = !!getCurrentDmUserId();
          if (slug !== getCachedCurrentSlug() || isDmNow) {
            // Switch project (or exit DM back to same project)
            sessionListEl.innerHTML = "";
            if (slug !== getCachedCurrentSlug()) {
              var loading = document.createElement("div");
              loading.className = "mobile-chat-context-note";
              loading.textContent = "Loading sessions...";
              sessionListEl.appendChild(loading);
            }
            if (ctx.switchProject) ctx.switchProject(slug);
            if (!isDmNow || slug !== getCachedCurrentSlug()) {
              // renderSessionList will be called by WS, which calls refreshMobileChatSheet
            } else {
              // Exited DM, same project - render sessions now
              renderSessionsForContext("project", slug, null);
            }
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

  // --- Initial render: show mate actions if DM active, otherwise project sessions ---
  if (getCurrentDmUserId()) {
    renderSessionsForContext("mate", null, getCurrentDmUserId());
  } else {
    renderSessionsForContext("project", getCachedCurrentSlug(), null);
  }
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

function renderMateMobileActions(container) {
  var newSessionBtn = document.createElement("button");
  newSessionBtn.className = "mobile-session-new";
  newSessionBtn.innerHTML = '<i data-lucide="plus" style="width:16px;height:16px"></i> New session';
  newSessionBtn.addEventListener("click", function () {
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
    }
    closeMobileSheet();
  });
  container.appendChild(newSessionBtn);

  var debateBtn = document.createElement("button");
  debateBtn.className = "mobile-session-new";
  debateBtn.innerHTML = '<i data-lucide="mic" style="width:16px;height:16px"></i> New debate';
  debateBtn.addEventListener("click", function () {
    closeMobileSheet();
    var targetBtn = document.getElementById("mate-debate-btn");
    if (targetBtn) setTimeout(function () { targetBtn.click(); }, 250);
  });
  container.appendChild(debateBtn);

  // Render mate session list
  var mateSessions = getMateSessions();
  if (mateSessions.length > 0) {
    var sorted = mateSessions.slice().sort(function (a, b) {
      return (b.lastActivity || 0) - (a.lastActivity || 0);
    });

    var currentGroup = "";
    for (var i = 0; i < sorted.length; i++) {
      var s = sorted[i];
      var group = getDateGroup(s.lastActivity || 0);
      if (group !== currentGroup) {
        currentGroup = group;
        var header = document.createElement("div");
        header.className = "mobile-sheet-group";
        header.textContent = group;
        container.appendChild(header);
      }
      var mateItem = createMobileSessionItem(s);
      container.appendChild(mateItem);
    }
  }

  refreshIcons();
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
  var sessions = getCachedSessions();
  var loopGroups = {};
  var normalSessions = [];
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    if (s.loop && s.loop.loopId && s.loop.role === "crafting" && s.loop.source !== "ralph" && s.loop.source !== "debate") {
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
export function refreshMobileChatSheet() {
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
    var isDmActive = !!getCurrentDmUserId();
    if (chip.dataset.type === "project" && chip.dataset.slug === getCachedCurrentSlug() && !isDmActive) {
      chip.classList.add("active");
    } else if (chip.dataset.type === "mate" && chip.dataset.mateId === getCurrentDmUserId()) {
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

  // Re-render sessions for current context
  sessionListEl.innerHTML = "";
  if (getCurrentDmUserId()) {
    renderMateMobileActions(sessionListEl);
  } else {
    renderMobileSessionsInto(sessionListEl);
  }

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
  var sorted = getCachedSessions().slice().sort(function (a, b) {
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
    { icon: "brain", label: "Memory", action: "mate-memory" },
    { icon: "book-open", label: "Knowledge", action: "mate-knowledge" },
    { icon: "sticky-note", label: "Sticky Notes", action: "mate-sticky" },
    { icon: "puzzle", label: "Skills", action: "mate-skills" },
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
          targetId = "mate-sticky-notes-btn";
        } else if (item.action === "mate-skills") {
          targetId = "mate-skills-btn";
        } else if (item.action === "mate-memory") {
          targetId = "mate-memory-btn";
        } else if (item.action === "mate-scheduler") {
          targetId = "mate-scheduler-btn";
        } else if (item.action === "mate-debate") {
          targetId = "mate-debate-btn";
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
            for (var pi = 0; pi < getCachedProjectList().length; pi++) {
              if (getCachedProjectList()[pi].slug === getCachedCurrentSlug()) {
                proj = getCachedProjectList()[pi];
                break;
              }
            }
            // For mate projects, use mate display name instead of slug
            if (proj && proj.isMate && getCachedMates().length > 0) {
              var mateId = getCachedCurrentSlug().replace("mate-", "");
              var _mates = getCachedMates();
              for (var mi = 0; mi < _mates.length; mi++) {
                var mp = _mates[mi].profile || {};
                if (_mates[mi].id === mateId) {
                  proj = Object.assign({}, proj, { name: mp.displayName || _mates[mi].name || proj.name });
                  break;
                }
              }
            }
            openProjectSettings(getCachedCurrentSlug(), proj);
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

  // Initialize session sub-module with sidebar callbacks
  ctx.closeSidebar = closeSidebar;
  ctx.dismissOverlayPanels = dismissOverlayPanels;
  ctx.refreshMobileChatSheet = refreshMobileChatSheet;
  ctx.updatePageTitle = updatePageTitle;
  ctx.showIconTooltip = showIconTooltip;
  ctx.showIconTooltipHtml = showIconTooltipHtml;
  ctx.hideIconTooltip = hideIconTooltip;
  ctx.closeUserCtxMenu = closeUserCtxMenu;
  ctx.closeProjectCtxMenu = closeProjectCtxMenu;
  ctx.getCurrentDmUserId = getCurrentDmUserId;
  ctx.spawnDustParticles = spawnDustParticles;
  initSidebarSessions(ctx);
  initSidebarProjects(ctx);
  initSidebarMates(ctx);

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




