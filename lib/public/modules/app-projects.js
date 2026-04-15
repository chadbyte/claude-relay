// app-projects.js - Project list, switching, add/remove project modals
// Extracted from app.js (PR-29)

import { escapeHtml } from './utils.js';
import { refreshIcons } from './icons.js';
import { parseEmojis } from './markdown.js';

var _ctx = null;

// --- Module-owned state ---
var cachedProjects = [];
var cachedProjectCount = 0;
var cachedRemovedProjects = [];
var pendingRemoveSlug = null;
var pendingRemoveName = null;

// Add-project modal state
var addProjectModal = null;
var addProjectInput = null;
var addProjectCreateInput = null;
var addProjectCloneInput = null;
var addProjectCloneProgress = null;
var addProjectSuggestions = null;
var addProjectError = null;
var addProjectOk = null;
var addProjectCancel = null;
var addProjectModeBtns = null;
var addProjectPanels = null;
var addProjectRemoved = null;
var addProjectPrefixEl = null;
var addProjectPrefixValue = "";
var addProjectDebounce = null;
var addProjectActiveIdx = -1;
var addProjectMode = "existing";

export function initProjects(ctx) {
  _ctx = ctx;

  // Init add-project modal DOM refs
  addProjectModal = document.getElementById("add-project-modal");
  addProjectInput = document.getElementById("add-project-input");
  addProjectCreateInput = document.getElementById("add-project-create-input");
  addProjectCloneInput = document.getElementById("add-project-clone-input");
  addProjectCloneProgress = document.getElementById("add-project-clone-progress");
  addProjectSuggestions = document.getElementById("add-project-suggestions");
  addProjectError = document.getElementById("add-project-error");
  addProjectOk = document.getElementById("add-project-ok");
  addProjectCancel = document.getElementById("add-project-cancel");
  addProjectModeBtns = addProjectModal.querySelectorAll(".add-project-mode-btn");
  addProjectPanels = addProjectModal.querySelectorAll(".add-project-panel");
  addProjectRemoved = document.getElementById("add-project-removed");
  addProjectPrefixEl = document.getElementById("add-project-prefix");

  // Mode button click listeners
  for (var mbi = 0; mbi < addProjectModeBtns.length; mbi++) {
    addProjectModeBtns[mbi].addEventListener("click", function () {
      if (this.disabled) return;
      switchAddProjectMode(this.dataset.mode);
    });
  }

  // Existing project input listeners
  addProjectInput.addEventListener("focus", function () {
    var val = addProjectInput.value;
    if ((val || addProjectPrefixValue) && addProjectSuggestions.children.length === 0) {
      requestBrowseDir(val);
    } else if (addProjectSuggestions.children.length > 0) {
      addProjectSuggestions.classList.remove("hidden");
    }
  });

  addProjectModal.querySelector(".confirm-dialog").addEventListener("click", function (e) {
    if (e.target === addProjectInput || addProjectInput.contains(e.target)) return;
    if (e.target === addProjectSuggestions || addProjectSuggestions.contains(e.target)) return;
    addProjectSuggestions.classList.add("hidden");
    addProjectActiveIdx = -1;
  });

  addProjectInput.addEventListener("input", function () {
    var val = addProjectInput.value;
    addProjectError.classList.add("hidden");
    if (addProjectDebounce) clearTimeout(addProjectDebounce);
    addProjectDebounce = setTimeout(function () {
      requestBrowseDir(val);
    }, 200);
  });

  addProjectInput.addEventListener("keydown", function (e) {
    var items = addProjectSuggestions.querySelectorAll(".add-project-suggestion-item");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) {
        var next = addProjectActiveIdx < items.length - 1 ? addProjectActiveIdx + 1 : 0;
        setActiveIdx(next);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        var prev = addProjectActiveIdx > 0 ? addProjectActiveIdx - 1 : items.length - 1;
        setActiveIdx(prev);
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      var target = addProjectActiveIdx >= 0 && addProjectActiveIdx < items.length
        ? items[addProjectActiveIdx]
        : items.length > 0 ? items[0] : null;
      if (target) {
        var fullP = target.dataset.path + "/";
        addProjectInput.value = stripPrefix(fullP);
        addProjectError.classList.add("hidden");
        requestBrowseDir(addProjectInput.value);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (addProjectActiveIdx >= 0 && addProjectActiveIdx < items.length) {
        var fullPicked = items[addProjectActiveIdx].dataset.path + "/";
        addProjectInput.value = stripPrefix(fullPicked);
        addProjectError.classList.add("hidden");
        requestBrowseDir(addProjectInput.value);
        return;
      }
      submitAddProject();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeAddProjectModal();
      return;
    }
  });

  // Enter key on create/clone inputs
  addProjectCreateInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submitAddProject(); }
    if (e.key === "Escape") { e.preventDefault(); closeAddProjectModal(); }
  });

  addProjectCloneInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submitAddProject(); }
    if (e.key === "Escape") { e.preventDefault(); closeAddProjectModal(); }
  });

  addProjectOk.addEventListener("click", function () { submitAddProject(); });
  addProjectCancel.addEventListener("click", function () { closeAddProjectModal(); });

  // Close on backdrop click
  addProjectModal.querySelector(".confirm-backdrop").addEventListener("click", function () {
    closeAddProjectModal();
  });

  // Project list add button
  var projectListAddBtn = _ctx.$("project-list-add");
  if (projectListAddBtn) {
    projectListAddBtn.addEventListener("click", function () {
      openAddProjectModal();
    });
  }
}

// --- State accessors ---

export function getCachedProjects() { return cachedProjects; }
export function setCachedProjects(v) { cachedProjects = v; }
export function getCachedProjectCount() { return cachedProjectCount; }
export function setCachedProjectCount(v) { cachedProjectCount = v; }
export function getCachedRemovedProjects() { return cachedRemovedProjects; }
export function setCachedRemovedProjects(v) { cachedRemovedProjects = v; }

// --- Functions ---

export function updateProjectList(msg) {
  if (typeof msg.projectCount === "number") cachedProjectCount = msg.projectCount;
  if (msg.projects) cachedProjects = msg.projects;
  if (msg.removedProjects) cachedRemovedProjects = msg.removedProjects;
  else if (msg.removedProjects === undefined) { /* keep cached */ }
  else cachedRemovedProjects = [];
  var count = cachedProjectCount || 0;
  renderProjectList();
  var projectHint = _ctx.$("project-hint");
  if (count === 1 && projectHint) {
    try {
      if (!localStorage.getItem("clay-project-hint-dismissed")) {
        projectHint.classList.remove("hidden");
      }
    } catch (e) {}
  } else if (projectHint) {
    projectHint.classList.add("hidden");
  }
  // Update topbar with server-wide presence
  if (msg.serverUsers) {
    var newOnlineIds = msg.serverUsers.map(function (u) { return u.id; });
    var prevOnlineIds = _ctx.cachedOnlineIds || [];
    _ctx.setCachedOnlineIds(newOnlineIds);
    renderTopbarPresence(msg.serverUsers);
    // Only re-render user strip if online IDs actually changed
    if (!msg.allUsers && _ctx.cachedAllUsers.length > 0) {
      var onlineChanged = newOnlineIds.length !== prevOnlineIds.length || newOnlineIds.some(function (id, i) { return id !== prevOnlineIds[i]; });
      if (onlineChanged) {
        _ctx.renderUserStrip(_ctx.cachedAllUsers, newOnlineIds, _ctx.myUserId, _ctx.cachedDmFavorites, _ctx.cachedDmConversations, _ctx.dmUnread, _ctx.dmRemovedUsers, _ctx.cachedMatesList);
      }
    }
  }
  // Update user strip (DM targets) in icon strip
  if (msg.allUsers) {
    _ctx.setCachedAllUsers(msg.allUsers);
    if (msg.dmFavorites) _ctx.setCachedDmFavorites(msg.dmFavorites);
    if (msg.dmConversations) _ctx.setCachedDmConversations(msg.dmConversations);
    _ctx.renderUserStrip(msg.allUsers, _ctx.cachedOnlineIds, _ctx.myUserId, _ctx.cachedDmFavorites, _ctx.cachedDmConversations, _ctx.dmUnread, _ctx.dmRemovedUsers, _ctx.cachedMatesList);
    if (document.body.classList.contains("mate-dm-active") || document.body.classList.contains("wide-view")) {
      var refreshedMyUser = _ctx.cachedAllUsers.find(function (u) { return u.id === _ctx.myUserId; });
      if (refreshedMyUser) {
        document.body.dataset.myDisplayName = refreshedMyUser.displayName || refreshedMyUser.username || "";
        document.body.dataset.myAvatarUrl = _ctx.userAvatarUrl(refreshedMyUser, 36);
        try { localStorage.setItem("clay_my_user", JSON.stringify({ displayName: refreshedMyUser.displayName, username: refreshedMyUser.username, avatarStyle: refreshedMyUser.avatarStyle, avatarSeed: refreshedMyUser.avatarSeed, avatarCustom: refreshedMyUser.avatarCustom })); } catch(e) {}
      }
    }
    // Render my avatar (always present, hidden behind user-island)
    var meEl = document.getElementById("icon-strip-me");
    if (meEl && !meEl.hasChildNodes()) {
      var myUser = _ctx.cachedAllUsers.find(function (u) { return u.id === _ctx.myUserId; });
      if (myUser) {
        var meAvatar = document.createElement("img");
        meAvatar.className = "icon-strip-me-avatar";
        meAvatar.src = _ctx.userAvatarUrl(myUser, 34);
        meEl.appendChild(meAvatar);
      }
    }
  }
}

var _lastTopbarUserIds = [];
export function renderTopbarPresence(serverUsers) {
  var countEl = document.getElementById("client-count");
  if (!countEl) return;
  if (serverUsers.length > 1) {
    // Skip re-render if user list unchanged
    var newIds = serverUsers.map(function (u) { return u.id; }).sort();
    if (newIds.length === _lastTopbarUserIds.length && newIds.every(function (id, i) { return id === _lastTopbarUserIds[i]; })) return;
    _lastTopbarUserIds = newIds;
    countEl.innerHTML = "";
    for (var cui = 0; cui < serverUsers.length; cui++) {
      var cu = serverUsers[cui];
      var cuImg = document.createElement("img");
      cuImg.className = "client-avatar";
      cuImg.src = _ctx.userAvatarUrl(cu, 24);
      cuImg.alt = cu.displayName;
      cuImg.dataset.tip = cu.displayName + " (@" + cu.username + ")";
      if (cui > 0) cuImg.style.marginLeft = "-6px";
      countEl.appendChild(cuImg);
    }
    countEl.classList.remove("hidden");
  } else {
    _lastTopbarUserIds = [];
    countEl.classList.add("hidden");
  }
}

export function renderProjectList() {
  var iconStripProjects = cachedProjects.filter(function (p) {
    return !p.isMate;
  }).map(function (p) {
    return {
      slug: p.slug,
      name: p.title || p.project,
      icon: p.icon || null,
      isProcessing: p.isProcessing,
      onlineUsers: p.onlineUsers || [],
      unread: p.unread || 0,
      pendingPermissions: p.pendingPermissions || 0,
      isWorktree: p.isWorktree || false,
      parentSlug: p.parentSlug || null,
      branch: p.branch || null,
      worktreeAccessible: p.worktreeAccessible !== undefined ? p.worktreeAccessible : true,
    };
  });
  var iconStripActiveSlug = (_ctx.mateProjectSlug && _ctx.savedMainSlug) ? _ctx.savedMainSlug : _ctx.currentSlug;
  _ctx.renderIconStrip(iconStripProjects, iconStripActiveSlug);
  // Update title bar project name and icon if it changed
  if (!_ctx.mateProjectSlug) {
    for (var pi = 0; pi < cachedProjects.length; pi++) {
      if (cachedProjects[pi].slug === _ctx.currentSlug) {
        var updatedName = cachedProjects[pi].title || cachedProjects[pi].project;
        var tbName = document.getElementById("title-bar-project-name");
        if (tbName && updatedName) tbName.textContent = updatedName;
        var tbIcon = document.getElementById("title-bar-project-icon");
        if (tbIcon) {
          var pIcon = cachedProjects[pi].icon || null;
          if (pIcon) {
            tbIcon.textContent = pIcon;
            parseEmojis(tbIcon);
            tbIcon.classList.add("has-icon");
            try { localStorage.setItem("clay-project-icon-" + (_ctx.currentSlug || "default"), pIcon); } catch (e) {}
          } else {
            tbIcon.textContent = "";
            tbIcon.classList.remove("has-icon");
            try { localStorage.removeItem("clay-project-icon-" + (_ctx.currentSlug || "default")); } catch (e) {}
          }
        }
        break;
      }
    }
  }
  // Re-apply current socket status to the active icon's dot
  var dot = _ctx.getStatusDot();
  if (dot) {
    if (_ctx.connected && _ctx.processing) { dot.classList.add("connected"); dot.classList.add("processing"); }
    else if (_ctx.connected) { dot.classList.add("connected"); }
  }
  _ctx.updateCrossProjectBlink();
}

export function resetClientState() {
  _ctx.closeSearch();
  _ctx.messagesEl.innerHTML = "";
  _ctx.setCurrentMsgEl(null);
  _ctx.setCurrentFullText("");
  _ctx.resetToolState();
  _ctx.clearPendingImages();
  _ctx.setActivityEl(null);
  _ctx.setProcessing(false);
  _ctx.setTurnCounter(0);
  _ctx.setMessageUuidMap([]);
  _ctx.setHistoryFrom(0);
  _ctx.setHistoryTotal(0);
  _ctx.setPrependAnchor(null);
  _ctx.setLoadingMore(false);
  _ctx.setIsUserScrolledUp(false);
  _ctx.newMsgBtn.classList.add("hidden");
  _ctx.setRewindMode(false);
  _ctx.setActivity(null);
  _ctx.setStatus("connected");
  if (!_ctx.loopActive) _ctx.enableMainInput();
  _ctx.resetUsage();
  _ctx.resetTurnMetaCost();
  _ctx.resetContext();
  _ctx.resetRateLimitState();
  if (_ctx.getHeaderContextEl()) { _ctx.getHeaderContextEl().remove(); _ctx.setHeaderContextEl(null); }
  _ctx.hideSuggestionChips();
  _ctx.closeSessionInfoPopover();
  _ctx.stopUrgentBlink();
  // Clear debate UI and state from previous session
  _ctx.setDebateStickyState(null);
  _ctx.resetDebateState();
  var debateBadges = document.querySelectorAll(".debate-header-badge");
  for (var dbi = 0; dbi < debateBadges.length; dbi++) debateBadges[dbi].remove();
  _ctx.removeDebateBottomBar();
  var handBar = document.getElementById("debate-hand-raise-bar");
  if (handBar) handBar.remove();
  var debateSticky = document.getElementById("debate-sticky");
  if (debateSticky) { debateSticky.classList.add("hidden"); debateSticky.innerHTML = ""; }
  var debateFloat = document.getElementById("debate-info-float");
  if (debateFloat) { debateFloat.classList.add("hidden"); debateFloat.innerHTML = ""; }
}

export function switchProject(slug) {
  if (!slug) return;
  var wasDm = _ctx.dmMode;
  var wasMate = _ctx.dmMode && _ctx.dmTargetUser && _ctx.dmTargetUser.isMate;
  if (_ctx.dmMode) _ctx.exitDmMode(wasMate);
  if (_ctx.isHomeHubVisible()) {
    _ctx.hideHomeHub();
    if (slug === _ctx.currentSlug) return;
  }
  if (slug === _ctx.currentSlug) {
    if (wasDm && _ctx.getWs() && _ctx.getWs().readyState === 1) {
      _ctx.getWs().send(JSON.stringify({ type: "switch_session", id: _ctx.activeSessionId }));
    }
    return;
  }
  _ctx.resetFileBrowser();
  _ctx.closeArchive();
  _ctx.hideMemory();
  if (_ctx.isSchedulerOpen()) _ctx.closeScheduler();
  _ctx.resetScheduler(slug);
  _ctx.setCurrentSlug(slug);
  _ctx.setBasePath("/p/" + slug + "/");
  _ctx.setWsPath("/p/" + slug + "/ws");
  if (document.documentElement.classList.contains("pwa-standalone")) {
    history.replaceState(null, "", "/p/" + slug + "/");
  } else {
    history.pushState(null, "", "/p/" + slug + "/");
  }
  resetClientState();
  _ctx.connect();
}

export function showUpdateAvailable(msg) {
  var $ = _ctx.$;
  var updatePillWrap = $("update-pill-wrap");
  var updateVersion = $("update-version");
  if (updatePillWrap && updateVersion && msg.version) {
    updateVersion.textContent = "v" + msg.version;
    updatePillWrap.classList.remove("hidden");
    var updPill = $("update-pill");
    var updResetBtn = $("update-now");
    if (_ctx.isHeadlessMode) {
      if (updPill) updPill.innerHTML = '<i data-lucide="arrow-up-circle"></i> <span id="update-version">v' + msg.version + '</span> available. Update manually';
      if (updResetBtn) updResetBtn.style.display = "none";
    } else {
      if (updResetBtn) {
        updResetBtn.innerHTML = '<i data-lucide="download"></i> Update now';
        updResetBtn.disabled = false;
        updResetBtn.style.display = "";
      }
    }
    var updManualCmd = $("update-manual-cmd");
    if (updManualCmd) {
      var updTag = msg.version.indexOf("-beta") !== -1 ? "beta" : "latest";
      updManualCmd.textContent = "npx clay-server@" + updTag;
    }
    refreshIcons();
  }
  var settingsUpdBtn = $("settings-update-check");
  if (settingsUpdBtn && msg.version) {
    settingsUpdBtn.innerHTML = "";
    var ic = document.createElement("i");
    ic.setAttribute("data-lucide", "arrow-up-circle");
    settingsUpdBtn.appendChild(ic);
    settingsUpdBtn.appendChild(document.createTextNode(" Update available (v" + msg.version + ")"));
    settingsUpdBtn.classList.add("settings-btn-update-available");
    settingsUpdBtn.disabled = false;
    refreshIcons();
  }
}

// --- Remove project ---

export function confirmRemoveProject(slug, name) {
  pendingRemoveSlug = slug;
  pendingRemoveName = name;
  if (_ctx.getWs() && _ctx.getWs().readyState === 1) {
    _ctx.getWs().send(JSON.stringify({ type: "remove_project_check", slug: slug }));
  }
}

export function handleRemoveProjectCheckResult(msg) {
  var slug = msg.slug || pendingRemoveSlug;
  var name = msg.name || pendingRemoveName || slug;
  if (!slug) return;

  if (msg.count > 0) {
    showRemoveProjectTaskDialog(slug, name, msg.count);
  } else {
    var isWt = slug.indexOf("--") !== -1;
    var confirmMsg = isWt
      ? 'Delete worktree "' + name + '"? The branch and working directory will be removed from disk.'
      : 'Remove "' + name + '"? You can re-add it later.';
    _ctx.showConfirm(confirmMsg, function () {
      var iconEl = document.querySelector('.icon-strip-item[data-slug="' + slug + '"]');
      if (iconEl) {
        var rect = iconEl.getBoundingClientRect();
        _ctx.spawnDustParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      setTimeout(function () {
        if (_ctx.getWs() && _ctx.getWs().readyState === 1) {
          _ctx.getWs().send(JSON.stringify({ type: "remove_project", slug: slug }));
        }
      }, 1000);
    }, "Remove", true);
  }
  pendingRemoveSlug = null;
  pendingRemoveName = null;
}

function showRemoveProjectTaskDialog(slug, name, taskCount) {
  var otherProjects = cachedProjects.filter(function (p) { return p.slug !== slug; });

  var modal = document.createElement("div");
  modal.className = "remove-project-task-modal";
  modal.innerHTML =
    '<div class="remove-project-task-backdrop"></div>' +
    '<div class="remove-project-task-dialog">' +
      '<div class="remove-project-task-title">Remove project "' + (name || slug) + '"</div>' +
      '<div class="remove-project-task-text">This project has <strong>' + taskCount + '</strong> task' + (taskCount > 1 ? 's' : '') + '/schedule' + (taskCount > 1 ? 's' : '') + '.</div>' +
      '<div class="remove-project-task-options">' +
        (otherProjects.length > 0
          ? '<div class="remove-project-task-label">Move tasks to:</div>' +
            '<select class="remove-project-task-select" id="rpt-move-target">' +
              otherProjects.map(function (p) {
                return '<option value="' + p.slug + '">' + (p.title || p.project || p.slug) + '</option>';
              }).join("") +
            '</select>' +
            '<button class="remove-project-task-btn move" id="rpt-move-btn">Move &amp; Remove</button>'
          : '') +
        '<button class="remove-project-task-btn delete" id="rpt-delete-btn">Delete all &amp; Remove</button>' +
        '<button class="remove-project-task-btn cancel" id="rpt-cancel-btn">Cancel</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);

  var backdrop = modal.querySelector(".remove-project-task-backdrop");
  var moveBtn = modal.querySelector("#rpt-move-btn");
  var deleteBtn = modal.querySelector("#rpt-delete-btn");
  var cancelBtn = modal.querySelector("#rpt-cancel-btn");
  var selectEl = modal.querySelector("#rpt-move-target");

  function close() { modal.remove(); }
  backdrop.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);

  if (moveBtn) {
    moveBtn.addEventListener("click", function () {
      var targetSlug = selectEl ? selectEl.value : null;
      if (_ctx.getWs() && _ctx.getWs().readyState === 1 && targetSlug) {
        _ctx.getWs().send(JSON.stringify({ type: "remove_project", slug: slug, moveTasksTo: targetSlug }));
      }
      close();
    });
  }

  deleteBtn.addEventListener("click", function () {
    if (_ctx.getWs() && _ctx.getWs().readyState === 1) {
      _ctx.getWs().send(JSON.stringify({ type: "remove_project", slug: slug }));
    }
    close();
  });
}

export function handleRemoveProjectResult(msg) {
  if (msg.ok) {
    if (msg.slug === _ctx.currentSlug) {
      var isWorktree = msg.slug.indexOf("--") !== -1;
      var parentSlug = isWorktree ? msg.slug.split("--")[0] : null;

      _ctx.showToast(isWorktree ? "Worktree removed" : "Project removed", "success");

      // Suppress disconnect overlay and reconnect by detaching the WS
      var ws = _ctx.getWs();
      if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); _ctx.setWs(null); }
      _ctx.cancelReconnect();
      _ctx.setConnected(false);
      _ctx.connectOverlay.classList.add("hidden");
      if (!isWorktree) {
        var removedProj = null;
        for (var ri = 0; ri < cachedProjects.length; ri++) {
          if (cachedProjects[ri].slug === msg.slug) { removedProj = cachedProjects[ri]; break; }
        }
        if (removedProj) {
          cachedRemovedProjects.push({
            path: removedProj.path || "",
            title: removedProj.title || null,
            icon: removedProj.icon || null,
            removedAt: Date.now(),
          });
        }
      }
      cachedProjects = cachedProjects.filter(function (p) { return p.slug !== msg.slug; });
      cachedProjectCount = cachedProjects.length;
      _ctx.setCurrentSlug(null);
      renderProjectList();
      resetClientState();

      if (parentSlug) {
        switchProject(parentSlug);
      } else {
        _ctx.showHomeHub();
      }
    } else {
      _ctx.showToast(msg.slug.indexOf("--") !== -1 ? "Worktree removed" : "Project removed", "success");
    }
  } else {
    _ctx.showToast(msg.error || "Failed to remove project", "error");
  }
}

// --- Add project modal ---

function switchAddProjectMode(mode) {
  addProjectMode = mode;
  for (var mi = 0; mi < addProjectModeBtns.length; mi++) {
    var btn = addProjectModeBtns[mi];
    if (btn.dataset.mode === mode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  }
  for (var pi = 0; pi < addProjectPanels.length; pi++) {
    var panel = addProjectPanels[pi];
    if (panel.dataset.panel === mode) {
      panel.classList.add("active");
    } else {
      panel.classList.remove("active");
    }
  }
  addProjectError.classList.add("hidden");
  addProjectCloneProgress.classList.add("hidden");
  if (mode === "existing") {
    addProjectOk.textContent = "Add";
  } else if (mode === "create") {
    addProjectOk.textContent = "Create";
  } else if (mode === "clone") {
    addProjectOk.textContent = "Clone";
  }
  setTimeout(function () {
    if (mode === "existing") {
      addProjectInput.focus();
    } else if (mode === "create") {
      addProjectCreateInput.focus();
    } else if (mode === "clone") {
      addProjectCloneInput.focus();
    }
  }, 50);
}

export function openAddProjectModal() {
  addProjectModal.classList.remove("hidden");
  addProjectCreateInput.value = "";
  addProjectCloneInput.value = "";
  addProjectError.classList.add("hidden");
  addProjectError.textContent = "";
  addProjectCloneProgress.classList.add("hidden");
  addProjectSuggestions.classList.add("hidden");
  addProjectSuggestions.innerHTML = "";
  addProjectActiveIdx = -1;
  addProjectOk.disabled = false;
  var existingBtn = addProjectModal.querySelector('.add-project-mode-btn[data-mode="existing"]');
  if (_ctx.isOsUsers) {
    existingBtn.disabled = false;
    var myUser = _ctx.cachedAllUsers.find(function (u) { return u.id === _ctx.myUserId; });
    var isAdmin = myUser && myUser.role === "admin";
    if (!isAdmin && myUser && myUser.linuxUser) {
      // Non-admin: lock prefix to home directory
      addProjectPrefixValue = "/home/" + myUser.linuxUser + "/";
      addProjectPrefixEl.textContent = addProjectPrefixValue;
      addProjectPrefixEl.classList.remove("hidden");
      addProjectInput.value = "";
      addProjectInput.placeholder = "subdirectory";
    } else {
      // Admin: no prefix restriction
      addProjectPrefixValue = "";
      addProjectPrefixEl.classList.add("hidden");
      addProjectInput.value = "/";
      addProjectInput.placeholder = "/";
    }
    switchAddProjectMode("existing");
  } else {
    addProjectPrefixValue = "";
    addProjectPrefixEl.classList.add("hidden");
    addProjectInput.value = "/";
    addProjectInput.placeholder = "/";
    existingBtn.disabled = false;
    switchAddProjectMode("existing");
  }
  renderRemovedProjectsList();
}

function renderRemovedProjectsList() {
  if (!addProjectRemoved) return;
  addProjectRemoved.innerHTML = "";
  if (!cachedRemovedProjects || cachedRemovedProjects.length === 0) {
    addProjectRemoved.classList.add("hidden");
    return;
  }
  addProjectRemoved.classList.remove("hidden");
  for (var ri = 0; ri < cachedRemovedProjects.length; ri++) {
    var rp = cachedRemovedProjects[ri];
    var item = document.createElement("div");
    item.className = "add-project-removed-item";
    item.dataset.path = rp.path;
    item.addEventListener("click", function () {
      var p = this.dataset.path;
      if (_ctx.getWs() && _ctx.getWs().readyState === 1) {
        _ctx.getWs().send(JSON.stringify({ type: "add_project", path: p }));
      }
      closeAddProjectModal();
    });
    var iconEl = document.createElement("span");
    iconEl.className = "add-project-removed-icon";
    iconEl.textContent = rp.icon || "📁";
    item.appendChild(iconEl);
    var info = document.createElement("div");
    info.className = "add-project-removed-info";
    var nameEl = document.createElement("div");
    nameEl.className = "add-project-removed-name";
    nameEl.textContent = rp.title || rp.path.split("/").pop() || rp.path;
    info.appendChild(nameEl);
    var pathEl = document.createElement("div");
    pathEl.className = "add-project-removed-path";
    pathEl.textContent = rp.path;
    info.appendChild(pathEl);
    item.appendChild(info);
    addProjectRemoved.appendChild(item);
  }
  try { parseEmojis(addProjectRemoved); } catch (e) {}
}

export function closeAddProjectModal() {
  addProjectModal.classList.add("hidden");
  addProjectInput.value = "";
  addProjectCreateInput.value = "";
  addProjectCloneInput.value = "";
  addProjectSuggestions.classList.add("hidden");
  addProjectSuggestions.innerHTML = "";
  addProjectError.classList.add("hidden");
  addProjectCloneProgress.classList.add("hidden");
  addProjectActiveIdx = -1;
  addProjectPrefixValue = "";
  addProjectPrefixEl.classList.add("hidden");
  if (addProjectDebounce) { clearTimeout(addProjectDebounce); addProjectDebounce = null; }
}

function getFullPath(inputVal) {
  return addProjectPrefixValue + inputVal;
}

function stripPrefix(fullPath) {
  if (addProjectPrefixValue && fullPath.indexOf(addProjectPrefixValue) === 0) {
    return fullPath.slice(addProjectPrefixValue.length);
  }
  return fullPath;
}

function requestBrowseDir(val) {
  if (!_ctx.getWs() || _ctx.getWs().readyState !== 1) return;
  _ctx.getWs().send(JSON.stringify({ type: "browse_dir", path: getFullPath(val) }));
}

export function handleBrowseDirResult(msg) {
  addProjectSuggestions.innerHTML = "";
  addProjectActiveIdx = -1;
  if (msg.error) {
    addProjectSuggestions.classList.add("hidden");
    return;
  }
  var entries = msg.entries || [];
  if (entries.length === 0) {
    addProjectSuggestions.classList.add("hidden");
    return;
  }
  for (var si = 0; si < entries.length; si++) {
    var entry = entries[si];
    var item = document.createElement("div");
    item.className = "add-project-suggestion-item";
    item.dataset.path = entry.path;
    item.innerHTML = '<i data-lucide="folder"></i><span class="add-project-suggestion-name">' +
      escapeHtml(entry.name) + '</span>';
    item.addEventListener("click", function (e) {
      var fullP = this.dataset.path + "/";
      addProjectInput.value = stripPrefix(fullP);
      addProjectInput.focus();
      addProjectError.classList.add("hidden");
      requestBrowseDir(addProjectInput.value);
    });
    addProjectSuggestions.appendChild(item);
  }
  addProjectSuggestions.classList.remove("hidden");
  refreshIcons();
}

export function handleAddProjectResult(msg) {
  addProjectCloneProgress.classList.add("hidden");
  if (msg.ok) {
    closeAddProjectModal();
    if (msg.existing) {
      _ctx.showToast("Project already registered", "info");
    } else {
      var toastMsg = addProjectMode === "create" ? "Project created" : addProjectMode === "clone" ? "Project cloned" : "Project added";
      _ctx.showToast(toastMsg, "success");
      if (msg.slug) {
        switchProject(msg.slug);
      }
    }
  } else {
    addProjectError.textContent = msg.error || "Failed to add project";
    addProjectError.classList.remove("hidden");
    addProjectOk.disabled = false;
  }
}

export function handleCloneProgress(msg) {
  if (msg.status === "cloning") {
    addProjectCloneProgress.classList.remove("hidden");
  }
}

function setActiveIdx(idx) {
  var items = addProjectSuggestions.querySelectorAll(".add-project-suggestion-item");
  addProjectActiveIdx = idx;
  for (var ai = 0; ai < items.length; ai++) {
    if (ai === idx) {
      items[ai].classList.add("active");
      items[ai].scrollIntoView({ block: "nearest" });
    } else {
      items[ai].classList.remove("active");
    }
  }
}

function submitAddProject() {
  addProjectError.classList.add("hidden");
  addProjectOk.disabled = true;

  if (addProjectMode === "existing") {
    var val = getFullPath(addProjectInput.value).replace(/\/+$/, "");
    if (!val) { addProjectOk.disabled = false; return; }
    if (_ctx.getWs() && _ctx.getWs().readyState === 1) {
      _ctx.getWs().send(JSON.stringify({ type: "add_project", path: val }));
    }
  } else if (addProjectMode === "create") {
    var name = addProjectCreateInput.value.trim();
    if (!name) { addProjectOk.disabled = false; return; }
    if (_ctx.getWs() && _ctx.getWs().readyState === 1) {
      _ctx.getWs().send(JSON.stringify({ type: "create_project", name: name }));
    }
  } else if (addProjectMode === "clone") {
    var url = addProjectCloneInput.value.trim();
    if (!url) { addProjectOk.disabled = false; return; }
    if (_ctx.getWs() && _ctx.getWs().readyState === 1) {
      _ctx.getWs().send(JSON.stringify({ type: "clone_project", url: url }));
    }
  }
}
