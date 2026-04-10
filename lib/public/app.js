import { avatarUrl, userAvatarUrl, mateAvatarUrl } from './modules/avatar.js';
import { showToast, copyToClipboard, escapeHtml } from './modules/utils.js';
import { refreshIcons, iconHtml } from './modules/icons.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks, closeMermaidModal, parseEmojis } from './modules/markdown.js';
import { initSidebar, renderSessionList, handleSearchResults, updateSessionPresence, updatePageTitle, populateCliSessionList, renderIconStrip, renderSidebarPresence, initIconStrip, getEmojiCategories, renderUserStrip, setCurrentDmUser, updateDmBadge, updateSessionBadge, updateProjectBadge, closeDmUserPicker, spawnDustParticles, openMobileSheet, setMobileSheetMateData, refreshMobileChatSheet } from './modules/sidebar.js';
import { initMateSidebar, showMateSidebar, hideMateSidebar, renderMateSessionList, updateMateSidebarProfile, handleMateSearchResults } from './modules/mate-sidebar.js';
import { initMateKnowledge, requestKnowledgeList, renderKnowledgeList, handleKnowledgeContent, hideKnowledge } from './modules/mate-knowledge.js';
import { initMateMemory, renderMemoryList, hideMemory } from './modules/mate-memory.js';
import { initRewind, setRewindMode, showRewindModal, clearPendingRewindUuid, addRewindButton, onRewindComplete, onRewindError } from './modules/rewind.js';
import { initNotifications, showDoneNotification, playDoneSound, isNotifAlertEnabled, isNotifSoundEnabled } from './modules/notifications.js';
import { initInput, clearPendingImages, handleInputSync, autoResize, builtinCommands, sendMessage, hasSendableContent, setScheduleBtnDisabled, setScheduleDelayMs, clearScheduleDelay } from './modules/input.js';
import { initQrCode, triggerShare } from './modules/qrcode.js';
import { initFileBrowser, loadRootDirectory, refreshTree, handleFsList, handleFsRead, handleDirChanged, refreshIfOpen, handleFileChanged, handleFileHistory, handleGitDiff, handleFileAt, getPendingNavigate, closeFileViewer, resetFileBrowser } from './modules/filebrowser.js';
import { initTerminal, openTerminal, closeTerminal, resetTerminals, handleTermList, handleTermCreated, handleTermOutput, handleTermResized, handleTermExited, handleTermClosed, sendTerminalCommand } from './modules/terminal.js';
import { initContextSources, updateTerminalList, updateBrowserTabList, handleContextSourcesState, getActiveSources, hasActiveSources } from './modules/context-sources.js';
import { initStickyNotes, handleNotesList, handleNoteCreated, handleNoteUpdated, handleNoteDeleted, openArchive, closeArchive, isArchiveOpen, hideNotes, showNotes, isNotesVisible } from './modules/sticky-notes.js';
import { initTheme, getThemeColor, getComputedVar, onThemeChange, getCurrentTheme, getChatLayout } from './modules/theme.js';
import { initTools, resetToolState, saveToolState, restoreToolState, renderAskUserQuestion, markAskUserAnswered, renderPermissionRequest, markPermissionResolved, markPermissionCancelled, renderElicitationRequest, markElicitationResolved, renderPlanBanner, renderPlanCard, handleTodoWrite, handleTaskCreate, handleTaskUpdate, startThinking, appendThinking, stopThinking, resetThinkingGroup, createToolItem, updateToolExecuting, updateToolResult, markAllToolsDone, addTurnMeta, resetTurnMetaCost, enableMainInput, getTools, getPlanContent, setPlanContent, isPlanFilePath, getTodoTools, updateSubagentActivity, addSubagentToolEntry, markSubagentDone, updateSubagentProgress, initSubagentStop, closeToolGroup, removeToolFromGroup } from './modules/tools.js';
import { initServerSettings, updateSettingsStats, updateSettingsModels, updateDaemonConfig, handleSetPinResult, handleKeepAwakeChanged, handleAutoContinueChanged, handleRestartResult, handleShutdownResult, handleSharedEnv, handleSharedEnvSaved, handleGlobalClaudeMdRead, handleGlobalClaudeMdWrite } from './modules/server-settings.js';
import { initProjectSettings, handleInstructionsRead, handleInstructionsWrite, handleProjectEnv, handleProjectEnvSaved, isProjectSettingsOpen, handleProjectSharedEnv, handleProjectSharedEnvSaved, handleProjectOwnerChanged } from './modules/project-settings.js';
import { initSkills, handleSkillInstalled, handleSkillUninstalled } from './modules/skills.js';
import { initScheduler, resetScheduler, handleLoopRegistryUpdated, handleScheduleRunStarted, handleScheduleRunFinished, handleLoopScheduled, openSchedulerToTab, isSchedulerOpen, closeScheduler, enterCraftingMode, exitCraftingMode, handleLoopRegistryFiles, getUpcomingSchedules } from './modules/scheduler.js';
import { initAsciiLogo, startLogoAnimation, stopLogoAnimation } from './modules/ascii-logo.js';
import { initPlaybook, openPlaybook, getPlaybooks, getPlaybookForTip, isCompleted as isPlaybookCompleted } from './modules/playbook.js';
import { initSTT } from './modules/stt.js';
import { initProfile, getProfileLang } from './modules/profile.js';
import { initUserSettings } from './modules/user-settings.js';
import { initAdmin, checkAdminAccess } from './modules/admin.js';
import { initSessionSearch, toggleSearch, closeSearch, isSearchOpen, handleFindInSessionResults, onHistoryPrepended as onSessionSearchHistoryPrepended } from './modules/session-search.js';
import { initTooltips, registerTooltip } from './modules/tooltip.js';
import { initMateWizard, openMateWizard, closeMateWizard, handleMateCreated } from './modules/mate-wizard.js';
import { initCommandPalette, handlePaletteSessionSwitch, setPaletteVersion } from './modules/command-palette.js';
import { initLongPress } from './modules/longpress.js';
import { initConnection, connect as _connConnect, setStatus as _connSetStatus, scheduleReconnect as _connScheduleReconnect, cancelReconnect as _connCancelReconnect } from './modules/app-connection.js';
import { initMessages, processMessage as _msgProcessMessage } from './modules/app-messages.js';
import { initHomeHub, showHomeHub as _hubShowHomeHub, hideHomeHub as _hubHideHomeHub, handleHubSchedules as _hubHandleHubSchedules, renderHomeHub as _hubRenderHomeHub, isHomeHubVisible } from './modules/app-home-hub.js';
import { initRateLimit, handleRateLimitEvent as _rlHandleRateLimitEvent, updateRateLimitUsage as _rlUpdateRateLimitUsage, addScheduledMessageBubble as _rlAddScheduledMessageBubble, removeScheduledMessageBubble as _rlRemoveScheduledMessageBubble, handleFastModeState as _rlHandleFastModeState, getScheduledMsgEl, resetRateLimitState } from './modules/app-rate-limit.js';
import { initCursors, handleRemoteCursorMove as _curHandleRemoteCursorMove, handleRemoteCursorLeave as _curHandleRemoteCursorLeave, handleRemoteSelection as _curHandleRemoteSelection, clearRemoteCursors as _curClearRemoteCursors, initCursorToggle } from './modules/app-cursors.js';
import { initDm, openDm as _dmOpenDm, enterDmMode as _dmEnterDmMode, exitDmMode as _dmExitDmMode, handleMateCreatedInApp as _dmHandleMateCreatedInApp, renderAvailableBuiltins as _dmRenderAvailableBuiltins, buildMateInterviewPrompt as _dmBuildMateInterviewPrompt, updateMateIconStatus as _dmUpdateMateIconStatus, connectMateProject as _dmConnectMateProject, disconnectMateProject as _dmDisconnectMateProject, appendDmMessage as _dmAppendDmMessage, showDmTypingIndicator as _dmShowDmTypingIndicator, handleDmSend as _dmHandleDmSend } from './modules/app-dm.js';
import { initMention, handleMentionStart, handleMentionStream, handleMentionDone, handleMentionError, handleMentionActivity, renderMentionUser, renderMentionResponse } from './modules/mention.js';
import { initDebate, handleDebatePreparing, handleDebateStarted, handleDebateResumed, handleDebateTurn, handleDebateActivity, handleDebateStream, handleDebateTurnDone, handleDebateCommentQueued, handleDebateCommentInjected, handleDebateEnded, handleDebateError, renderDebateStarted, renderDebateTurnDone, renderDebateEnded, renderDebateCommentInjected, renderDebateUserResume, openDebateModal, closeDebateModal, handleDebateBriefReady, renderDebateBriefReady, isDebateActive, resetDebateState, exportDebateAsPdf, renderMcpDebateProposal } from './modules/debate.js';

// --- Base path for multi-project routing ---
  var slugMatch = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
  var basePath = slugMatch ? "/p/" + slugMatch[1] + "/" : "/";
  var wsPath = slugMatch ? "/p/" + slugMatch[1] + "/ws" : "/ws";

// --- DOM refs ---
  var $ = function (id) { return document.getElementById(id); };
  var messagesEl = $("messages");
  var inputEl = $("input");
  var sendBtn = $("send-btn");
  function getStatusDot() {
    return document.querySelector("#icon-strip-projects .icon-strip-item.active .icon-strip-status") ||
           document.querySelector("#icon-strip-projects .icon-strip-wt-item.active .icon-strip-status") ||
           document.querySelector("#icon-strip-users .icon-strip-mate.active .icon-strip-status");
  }
  var headerTitleEl = $("header-title");
  var headerRenameBtn = $("header-rename-btn");
  var slashMenu = $("slash-menu");
  var suggestionChipsEl = $("suggestion-chips");
  var sidebar = $("sidebar");
  var sidebarOverlay = $("sidebar-overlay");
  var sessionListEl = $("session-list");
  var newSessionBtn = $("new-session-btn");
  var hamburgerBtn = $("hamburger-btn");
  var sidebarToggleBtn = $("sidebar-toggle-btn");
  var sidebarExpandBtn = $("sidebar-expand-btn");
  var resumeSessionBtn = $("resume-session-btn");
  var imagePreviewBar = $("image-preview-bar");
  var connectOverlay = $("connect-overlay");

  // --- DM Mode ---
  var dmMode = false;
  var dmKey = null;
  var dmTargetUser = null;
  var dmMessageCache = []; // cached DM messages for quick debate context
  var dmUnread = {}; // { otherUserId: count }
  var cachedAllUsers = [];
  var cachedOnlineIds = [];
  var cachedDmFavorites = [];
  var cachedDmConversations = [];
  var dmRemovedUsers = {};       // { userId: true } - users explicitly removed from favorites
  var cachedMatesList = [];       // Cached list of mates for user strip
  var cachedAvailableBuiltins = []; // Deleted built-in mates available for re-add

  var CLAUDE_CODE_AVATAR = "/claude-code-avatar.png";

  // --- Mate project switching ---
  var mateProjectSlug = null;
  var savedMainSlug = null; // main project slug saved during mate DM
  var returningFromMateDm = false; // suppress restore_mate_dm after intentional exit
  var pendingMateInterview = null;


  // --- Home Hub (delegated to app-home-hub.js) ---
  function showHomeHub() { _hubShowHomeHub(); }
  function hideHomeHub() { _hubHideHomeHub(); }
  function handleHubSchedules(msg) { _hubHandleHubSchedules(msg); }
  function renderHomeHub(projects) { _hubRenderHomeHub(projects); }

  // --- Project List ---
  var projectListSection = $("project-list-section");
  var projectListEl = $("project-list");
  var projectListAddBtn = $("project-list-add");
  var projectHint = $("project-hint");
  var projectHintDismiss = $("project-hint-dismiss");
  var cachedProjects = [];
  var cachedProjectCount = 0;
  var cachedRemovedProjects = [];
  var currentProjectOwnerId = null;
  var currentSlug = slugMatch ? slugMatch[1] : null;

  function updateProjectList(msg) {
    if (typeof msg.projectCount === "number") cachedProjectCount = msg.projectCount;
    if (msg.projects) cachedProjects = msg.projects;
    if (msg.removedProjects) cachedRemovedProjects = msg.removedProjects;
    else if (msg.removedProjects === undefined) { /* keep cached */ }
    else cachedRemovedProjects = [];
    var count = cachedProjectCount || 0;
    renderProjectList();
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
      cachedOnlineIds = msg.serverUsers.map(function (u) { return u.id; });
      renderTopbarPresence(msg.serverUsers);
      // Re-render user strip online dots even without allUsers update
      if (!msg.allUsers && cachedAllUsers.length > 0) {
        renderUserStrip(cachedAllUsers, cachedOnlineIds, myUserId, cachedDmFavorites, cachedDmConversations, dmUnread, dmRemovedUsers, cachedMatesList);
      }
    }
    // Update user strip (DM targets) in icon strip
    if (msg.allUsers) {
      cachedAllUsers = msg.allUsers;
      if (msg.dmFavorites) cachedDmFavorites = msg.dmFavorites;
      if (msg.dmConversations) cachedDmConversations = msg.dmConversations;
      renderUserStrip(msg.allUsers, cachedOnlineIds, myUserId, cachedDmFavorites, cachedDmConversations, dmUnread, dmRemovedUsers, cachedMatesList);
      // Update my info in body.dataset if in mate DM or wide view (fixes stale data after refresh)
      if (document.body.classList.contains("mate-dm-active") || document.body.classList.contains("wide-view")) {
        var refreshedMyUser = cachedAllUsers.find(function (u) { return u.id === myUserId; });
        if (refreshedMyUser) {
          document.body.dataset.myDisplayName = refreshedMyUser.displayName || refreshedMyUser.username || "";
          document.body.dataset.myAvatarUrl = userAvatarUrl(refreshedMyUser, 36);
          try { localStorage.setItem("clay_my_user", JSON.stringify({ displayName: refreshedMyUser.displayName, username: refreshedMyUser.username, avatarStyle: refreshedMyUser.avatarStyle, avatarSeed: refreshedMyUser.avatarSeed, avatarCustom: refreshedMyUser.avatarCustom })); } catch(e) {}
        }
      }
      // Render my avatar (always present, hidden behind user-island)
      var meEl = document.getElementById("icon-strip-me");
      if (meEl && !meEl.hasChildNodes()) {
        var myUser = cachedAllUsers.find(function (u) { return u.id === myUserId; });
        if (myUser) {
          var meAvatar = document.createElement("img");
          meAvatar.className = "icon-strip-me-avatar";
          meAvatar.src = userAvatarUrl(myUser, 34);
          meEl.appendChild(meAvatar);
        }
      }
    }
  }

  function renderTopbarPresence(serverUsers) {
    var countEl = document.getElementById("client-count");
    if (!countEl) return;
    if (serverUsers.length > 1) {
      countEl.innerHTML = "";
      for (var cui = 0; cui < serverUsers.length; cui++) {
        var cu = serverUsers[cui];
        var cuImg = document.createElement("img");
        cuImg.className = "client-avatar";
        cuImg.src = userAvatarUrl(cu, 24);
        cuImg.alt = cu.displayName;
        cuImg.dataset.tip = cu.displayName + " (@" + cu.username + ")";
        if (cui > 0) cuImg.style.marginLeft = "-6px";
        countEl.appendChild(cuImg);
      }
      countEl.classList.remove("hidden");
    } else {
      countEl.classList.add("hidden");
    }
  }

  function renderProjectList() {
    // Render icon strip projects (exclude mate projects)
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
    // In mate DM, highlight the saved main project in the icon strip (not the mate slug)
    var iconStripActiveSlug = (mateProjectSlug && savedMainSlug) ? savedMainSlug : currentSlug;
    renderIconStrip(iconStripProjects, iconStripActiveSlug);
    // Update title bar project name and icon if it changed
    // Skip when in mate DM mode (mate name/color is managed by enterDmMode)
    if (!mateProjectSlug) {
      for (var pi = 0; pi < cachedProjects.length; pi++) {
        if (cachedProjects[pi].slug === currentSlug) {
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
              try { localStorage.setItem("clay-project-icon-" + (currentSlug || "default"), pIcon); } catch (e) {}
            } else {
              tbIcon.textContent = "";
              tbIcon.classList.remove("has-icon");
              try { localStorage.removeItem("clay-project-icon-" + (currentSlug || "default")); } catch (e) {}
            }
          }
          break;
        }
      }
    }
    // Re-apply current socket status to the active icon's dot
    var dot = getStatusDot();
    if (dot) {
      if (connected && processing) { dot.classList.add("connected"); dot.classList.add("processing"); }
      else if (connected) { dot.classList.add("connected"); }
    }
    // Start/stop cross-project IO blink for non-active processing projects
    updateCrossProjectBlink();
    // Re-render user strip so mate processing/permission states update
    if (cachedMatesList.length > 0) {
      renderUserStrip(cachedAllUsers, cachedOnlineIds, myUserId, cachedDmFavorites, cachedDmConversations, dmUnread, dmRemovedUsers, cachedMatesList);
      // Mate icons are drawn after blink timer started, so restart blink to include them
      updateCrossProjectBlink();
    }
  }

  if (projectListAddBtn) {
    projectListAddBtn.addEventListener("click", function () {
      openAddProjectModal();
    });
  }

  // Prevent Cmd+Z / Cmd+Shift+Z from triggering browser back/forward (Arc, etc.)
  // Always block browser default for Cmd+Z and manually invoke undo/redo via execCommand
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      var el = document.activeElement;
      var tag = el && el.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || (el && el.isContentEditable)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          document.execCommand("redo", false, null);
        } else {
          document.execCommand("undo", false, null);
        }
      }
    }
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (isHomeHubVisible() && currentSlug) {
        hideHomeHub();
        if (document.documentElement.classList.contains("pwa-standalone")) {
          history.replaceState(null, "", "/p/" + currentSlug + "/");
        } else {
          history.pushState(null, "", "/p/" + currentSlug + "/");
        }
        var homeIcon = document.querySelector(".icon-strip-home");
        if (homeIcon) homeIcon.classList.remove("active");
        renderProjectList();
        return;
      }
      closeImageModal();
    }
  });

  if (projectHintDismiss) {
    projectHintDismiss.addEventListener("click", function () {
      projectHint.classList.add("hidden");
      try { localStorage.setItem("clay-project-hint-dismissed", "1"); } catch (e) {}
    });
  }

  // Modal close handlers (replaces inline onclick)
  $("paste-modal").querySelector(".confirm-backdrop").addEventListener("click", function() {
    $("paste-modal").classList.add("hidden");
  });
  $("paste-modal").querySelector(".paste-modal-close").addEventListener("click", function() {
    $("paste-modal").classList.add("hidden");
  });
  $("paste-modal").querySelector(".paste-modal-copy").addEventListener("click", function() {
    var body = $("paste-modal-body");
    if (body) copyToClipboard(body.textContent, "Copied to clipboard");
  });
  $("mermaid-modal").querySelector(".confirm-backdrop").addEventListener("click", closeMermaidModal);
  $("mermaid-modal").querySelector(".mermaid-modal-btn[title='Close']").addEventListener("click", closeMermaidModal);
  $("image-modal").querySelector(".confirm-backdrop").addEventListener("click", closeImageModal);
  $("image-modal").querySelector(".image-modal-close").addEventListener("click", closeImageModal);

  function showImageModal(src) {
    var modal = $("image-modal");
    var img = $("image-modal-img");
    if (!modal || !img) return;
    img.src = src;
    modal.classList.remove("hidden");
    refreshIcons(modal);
  }

  function closeImageModal() {
    var modal = $("image-modal");
    if (modal) modal.classList.add("hidden");
  }

  // --- State ---
  var ws = null;
  var connected = false;
  var processing = false;
  // rateLimitResetsAt, rateLimitResetTimer -> modules/app-rate-limit.js
  // isComposing -> modules/input.js
  // wasConnected, reconnectTimer, reconnectDelay, disconnectNotifTimer, disconnectNotifShown -> modules/app-connection.js
  var activityEl = null;
  var currentMsgEl = null;
  var currentFullText = "";
  // tools, currentThinking -> modules/tools.js
  var highlightTimer = null;
  var activeSessionId = null;
  var sessionDrafts = {};
  var loopActive = false;
  var loopAvailable = false;
  var loopIteration = 0;
  var loopMaxIterations = 0;
  var loopBannerName = null;
  var ralphPhase = "idle"; // idle | wizard | crafting | approval | executing | done
  var ralphCraftingSessionId = null;
  var ralphCraftingSource = null; // "ralph" or null (task)
  var wizardStep = 1;
  var wizardSource = "ralph"; // "ralph" or "task"
  var wizardData = { name: "", task: "", maxIterations: 3, cron: null };
  var ralphFilesReady = { promptReady: false, judgeReady: false, bothReady: false };
  var ralphPreviewContent = { prompt: "", judge: "" };
  var slashCommands = [];
  // slashActiveIdx, slashFiltered, pendingImages, pendingPastes -> modules/input.js
  // pendingPermissions -> modules/tools.js
  var cliSessionId = null;
  var projectName = "";
  var turnCounter = 0;

  // Restore cached project name and icon for instant display (before WS connects)
  try {
    var _cachedProjectName = localStorage.getItem("clay-project-name-" + (currentSlug || "default"));
    if (_cachedProjectName) {
      projectName = _cachedProjectName;
      if (headerTitleEl) headerTitleEl.textContent = _cachedProjectName;
      var _tbp = $("title-bar-project-name");
      if (_tbp) _tbp.textContent = _cachedProjectName;
    }
    var _cachedProjectIcon = localStorage.getItem("clay-project-icon-" + (currentSlug || "default"));
    if (_cachedProjectIcon) {
      var _tbi = $("title-bar-project-icon");
      if (_tbi) {
        _tbi.textContent = _cachedProjectIcon;
        parseEmojis(_tbi);
        _tbi.classList.add("has-icon");
      }
    }
  } catch (e) {}
  var messageUuidMap = [];
  // pendingRewindUuid is now in modules/rewind.js
  // rewindMode is now in modules/rewind.js

  // --- Progressive history loading ---
  var historyFrom = 0;
  var historyTotal = 0;
  var prependAnchor = null;
  var loadingMore = false;
  var historySentinelObserver = null;
  var replayingHistory = false;

  // --- Scroll lock ---
  var isUserScrolledUp = false;
  var scrollThreshold = 150;

  // builtinCommands -> modules/input.js

  // --- Header session rename ---
  if (headerRenameBtn) {
    headerRenameBtn.addEventListener("click", function () {
      if (!activeSessionId) return;
      var currentText = headerTitleEl.textContent;
      var input = document.createElement("input");
      input.type = "text";
      input.className = "header-rename-input";
      input.value = currentText;
      headerTitleEl.style.display = "none";
      headerRenameBtn.style.display = "none";
      headerTitleEl.parentNode.insertBefore(input, headerTitleEl.nextSibling);
      input.focus();
      input.select();

      function commit() {
        var newTitle = input.value.trim();
        if (newTitle && newTitle !== currentText && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "rename_session", id: activeSessionId, title: newTitle }));
          headerTitleEl.textContent = newTitle;
        }
        input.remove();
        headerTitleEl.style.display = "";
        headerRenameBtn.style.display = "";
      }

      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") {
          e.preventDefault();
          input.remove();
          headerTitleEl.style.display = "";
          headerRenameBtn.style.display = "";
        }
      });
      input.addEventListener("blur", commit);
    });
  }

  // --- Session info popover ---
  var headerInfoBtn = $("header-info-btn");
  var sessionInfoPopover = null;

  function closeSessionInfoPopover() {
    if (sessionInfoPopover) {
      sessionInfoPopover.remove();
      sessionInfoPopover = null;
    }
  }

  if (headerInfoBtn) {
    headerInfoBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (sessionInfoPopover) { closeSessionInfoPopover(); return; }

      var pop = document.createElement("div");
      pop.className = "session-info-popover";

      function addRow(label, value) {
        var val = value == null ? "-" : String(value);
        var row = document.createElement("div");
        row.className = "info-row";
        row.innerHTML =
          '<span class="info-label">' + label + '</span>' +
          '<span class="info-value">' + escapeHtml(val) + '</span>' +
          '<button class="info-copy-btn" title="Copy">' + iconHtml("copy") + '</button>';
        var btn = row.querySelector(".info-copy-btn");
        btn.addEventListener("click", function () {
          copyToClipboard(value || "").then(function () {
            btn.innerHTML = iconHtml("check");
            refreshIcons();
            setTimeout(function () { btn.innerHTML = iconHtml("copy"); refreshIcons(); }, 1200);
          });
        });
        pop.appendChild(row);
      }

      if (cliSessionId) addRow("Session ID", cliSessionId);
      if (activeSessionId) addRow("Local ID", activeSessionId);
      if (cliSessionId) addRow("Resume", "claude --resume " + cliSessionId);

      document.body.appendChild(pop);
      sessionInfoPopover = pop;
      refreshIcons();

      var btnRect = headerInfoBtn.getBoundingClientRect();
      pop.style.top = (btnRect.bottom + 6) + "px";
      pop.style.left = btnRect.left + "px";
      var popRect = pop.getBoundingClientRect();
      if (popRect.right > window.innerWidth - 8) {
        pop.style.left = (window.innerWidth - popRect.width - 8) + "px";
      }
    });

    document.addEventListener("click", function (e) {
      if (sessionInfoPopover && !sessionInfoPopover.contains(e.target) && !e.target.closest("#header-info-btn")) {
        closeSessionInfoPopover();
      }
    });
  }

  // --- Confirm modal ---
  var confirmModal = $("confirm-modal");
  var confirmText = $("confirm-text");
  var confirmOk = $("confirm-ok");
  var confirmCancel = $("confirm-cancel");
  // --- Paste content viewer modal ---
  function showPasteModal(text) {
    var modal = $("paste-modal");
    var body = $("paste-modal-body");
    if (!modal || !body) return;
    body.textContent = text;
    modal.classList.remove("hidden");
  }

  function closePasteModal() {
    var modal = $("paste-modal");
    if (modal) modal.classList.add("hidden");
  }

  var confirmCallback = null;

  function showConfirm(text, onConfirm, okLabel, destructive) {
    confirmText.textContent = text;
    confirmCallback = onConfirm;
    confirmOk.textContent = okLabel || "Delete";
    confirmOk.className = "confirm-btn " + (destructive === false ? "confirm-ok" : "confirm-delete");
    confirmModal.classList.remove("hidden");
  }

  function hideConfirm() {
    confirmModal.classList.add("hidden");
    confirmCallback = null;
  }

  confirmOk.addEventListener("click", function () {
    if (confirmCallback) confirmCallback();
    hideConfirm();
  });

  confirmCancel.addEventListener("click", hideConfirm);
  confirmModal.querySelector(".confirm-backdrop").addEventListener("click", hideConfirm);

  // --- Rewind (module) ---
  initRewind({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get processing() { return processing; },
    messagesEl: messagesEl,
    addSystemMessage: addSystemMessage,
  });

  // --- Theme (module) ---
  initTheme();

  // --- Tooltips ---
  initTooltips();

  // --- Long-press context menu for touch devices ---
  initLongPress();

  // --- Sidebar (module) ---
  var sidebarCtx = {
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get projectName() { return projectName; },
    messagesEl: messagesEl,
    sessionListEl: sessionListEl,
    sidebar: sidebar,
    sidebarOverlay: sidebarOverlay,
    sidebarToggleBtn: sidebarToggleBtn,
    sidebarExpandBtn: sidebarExpandBtn,
    hamburgerBtn: hamburgerBtn,
    newSessionBtn: newSessionBtn,
    resumeSessionBtn: resumeSessionBtn,
    headerTitleEl: headerTitleEl,
    showConfirm: showConfirm,
    onFilesTabOpen: function () { loadRootDirectory(); },
    requestKnowledgeList: function () { requestKnowledgeList(); },
    switchProject: function (slug) { switchProject(slug); },
    openTerminal: function () { openTerminal(); },
    showHomeHub: function () { showHomeHub(); },
    openRalphWizard: function (source) { openRalphWizard(source); },
    getUpcomingSchedules: getUpcomingSchedules,
    get multiUser() { return isMultiUserMode; },
    get myUserId() { return myUserId; },
    get projectOwnerId() { return currentProjectOwnerId; },
    openDm: function (userId) { openDm(userId); },
    openMateWizard: function () { requireClayMateInterview(function () { openMateWizard(); }); },
    openAddProjectModal: function () { openAddProjectModal(); },
    sendWs: function (msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    onDmRemoveUser: function (userId) { dmRemovedUsers[userId] = true; },
    getHistoryFrom: function () { return historyFrom; },
    get permissions() { return myPermissions; },
    get projectList() { return cachedProjects || []; },
    availableBuiltins: function () { return cachedAvailableBuiltins || []; },
  };
  initSidebar(sidebarCtx);
  initIconStrip(sidebarCtx);
  var wsGetter = function () { return ws; };
  initMateSidebar(wsGetter);
  initMateKnowledge(wsGetter);
  initMateMemory(wsGetter, { onShow: function () { hideKnowledge(); hideNotes(); } });
  initMateWizard(
    function (msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    function (mate) { handleMateCreatedInApp(mate); }
  );

  initCommandPalette({
    switchProject: function (slug) { switchProject(slug); },
    currentSlug: function () { return currentSlug; },
    projectList: function () { return cachedProjects || []; },
    matesList: function () { return cachedMatesList || []; },
    availableBuiltins: function () { return cachedAvailableBuiltins || []; },
    allUsers: function () { return cachedAllUsers || []; },
    dmConversations: function () { return cachedDmConversations || []; },
    myUserId: function () { return myUserId; },
    selectSession: function (id) {
      // Close any open panels before switching
      if (isSchedulerOpen()) closeScheduler();
      var stickyPanel = document.getElementById("sticky-notes-panel");
      if (stickyPanel && !stickyPanel.classList.contains("hidden")) {
        var stickyBtn = document.getElementById("sticky-notes-sidebar-btn");
        if (stickyBtn) stickyBtn.click();
      }
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "switch_session", id: id }));
      }
    },
    openDm: function (userId) { openDm(userId); },
    runAction: function (action) {
      switch (action) {
        case "createMate": openMateWizard(); break;
        case "openSettings":
          var sb = document.getElementById("server-settings-btn");
          if (sb) sb.click();
          break;
        case "showHome": showHomeHub(); break;
      }
    },
  });

  // --- Connect overlay (animated ASCII logo) ---
  var asciiLogoCanvas = $("ascii-logo-canvas");
  initAsciiLogo(asciiLogoCanvas);
  startLogoAnimation();
  function startVerbCycle() { startLogoAnimation(); }
  function stopVerbCycle() { stopLogoAnimation(); }

  // Reset favicon cache when theme changes
  onThemeChange(function () {
    faviconOrigHref = null;
  });

  function startPixelAnim() {}
  function stopPixelAnim() {}

  // --- Dynamic favicon (canvas-based banded C with color flow animation) ---
  var faviconLink = document.querySelector('link[rel="icon"]');
  var faviconOrigHref = null;
  var faviconCanvas = document.createElement("canvas");
  faviconCanvas.width = 32;
  faviconCanvas.height = 32;
  var faviconCtx = faviconCanvas.getContext("2d");
  var faviconImg = null;
  var faviconImgReady = false;

  // Banded colors from the Clay CLI logo gradient
  var BAND_COLORS = [
    [0, 235, 160],
    [0, 200, 220],
    [30, 100, 255],
    [88, 50, 255],
    [200, 60, 180],
    [255, 90, 50],
  ];

  // Load the banded favicon image for masking
  (function () {
    faviconImg = new Image();
    faviconImg.onload = function () { faviconImgReady = true; };
    faviconImg.src = basePath + "favicon-banded.png";
  })();

  function updateFavicon(bgColor) {
    if (!faviconLink) return;
    if (!bgColor) {
      if (faviconOrigHref) { faviconLink.href = faviconOrigHref; faviconOrigHref = null; }
      return;
    }
    if (!faviconOrigHref) faviconOrigHref = faviconLink.href;
    // Simple solid-color favicon for non-animated states
    faviconCtx.clearRect(0, 0, 32, 32);
    faviconCtx.fillStyle = bgColor;
    faviconCtx.beginPath();
    faviconCtx.arc(16, 16, 14, 0, Math.PI * 2);
    faviconCtx.fill();
    faviconCtx.fillStyle = "#fff";
    faviconCtx.font = "bold 22px Nunito, sans-serif";
    faviconCtx.textAlign = "center";
    faviconCtx.textBaseline = "middle";
    faviconCtx.fillText("C", 16, 17);
    faviconLink.href = faviconCanvas.toDataURL("image/png");
  }

  // Animated favicon: banded colors flow top-to-bottom
  var faviconAnimTimer = null;
  var faviconAnimFrame = 0;

  function drawFaviconAnimFrame() {
    if (!faviconImgReady) return;
    var S = 32;
    var bands = BAND_COLORS.length;
    var totalFrames = bands * 2;
    var offset = faviconAnimFrame % totalFrames;

    // Draw flowing color bands as background
    faviconCtx.clearRect(0, 0, S, S);
    var bandH = Math.ceil(S / bands);
    for (var i = 0; i < bands + totalFrames; i++) {
      var ci = ((i + offset) % bands + bands) % bands;
      var c = BAND_COLORS[ci];
      faviconCtx.fillStyle = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
      faviconCtx.fillRect(0, (i - offset) * bandH, S, bandH);
    }

    // Use the banded C image as a mask — draw it on top with destination-in
    faviconCtx.globalCompositeOperation = "destination-in";
    faviconCtx.drawImage(faviconImg, 0, 0, S, S);
    faviconCtx.globalCompositeOperation = "source-over";

    faviconLink.href = faviconCanvas.toDataURL("image/png");
    faviconAnimFrame++;
  }

  // --- Status & Activity ---
  function setSendBtnMode(mode) {
    if (mode === "stop") {
      sendBtn.disabled = false;
      sendBtn.classList.add("stop");
      sendBtn.innerHTML = '<i data-lucide="square"></i>';
    } else {
      sendBtn.disabled = false;
      sendBtn.classList.remove("stop");
      sendBtn.innerHTML = '<i data-lucide="arrow-up"></i>';
    }
    refreshIcons();
  }

  var ioTimer = null;
  function blinkIO() {
    if (!connected) return;
    var dot = getStatusDot();
    if (dot) dot.classList.add("io");
    // Also blink the active session's processing dot in sidebar (project or mate)
    var sessionDot = document.querySelector(".session-item.active .session-processing") ||
                     document.querySelector(".mate-session-item.active .session-processing");
    if (sessionDot) sessionDot.classList.add("io");
    // If active project is a worktree, also blink the parent project dot
    var activeWt = document.querySelector("#icon-strip-projects .icon-strip-wt-item.active");
    var parentDot = null;
    if (activeWt) {
      var group = activeWt.closest(".icon-strip-group");
      if (group) parentDot = group.querySelector(".folder-header .icon-strip-status");
      if (parentDot) parentDot.classList.add("io");
    }
    // Mobile chat chip dot + mobile session dot
    var mobileChipDot = null;
    if (dmMode && dmTargetUser && dmTargetUser.isMate) {
      mobileChipDot = document.querySelector('.mobile-chat-chip[data-mate-id="' + dmTargetUser.id + '"] .mobile-chat-chip-dot');
    } else {
      mobileChipDot = document.querySelector('.mobile-chat-chip[data-slug="' + currentSlug + '"] .mobile-chat-chip-dot');
    }
    if (mobileChipDot) mobileChipDot.classList.add("io");
    var mobileSessionDot = document.querySelector('.mobile-session-item.active .mobile-session-dot');
    if (mobileSessionDot) mobileSessionDot.classList.add("io");
    clearTimeout(ioTimer);
    ioTimer = setTimeout(function () {
      var d = getStatusDot();
      if (d) d.classList.remove("io");
      var sd = document.querySelector(".session-item.active .session-processing.io") ||
               document.querySelector(".mate-session-item.active .session-processing.io");
      if (sd) sd.classList.remove("io");
      if (parentDot) parentDot.classList.remove("io");
      if (mobileChipDot) mobileChipDot.classList.remove("io");
      if (mobileSessionDot) mobileSessionDot.classList.remove("io");
    }, 80);
  }

  // --- Per-session IO blink for non-active sessions ---
  var sessionIoTimers = {};
  function blinkSessionDot(sessionId) {
    var el = document.querySelector('.session-item[data-session-id="' + sessionId + '"] .session-processing');
    if (!el) return;
    el.classList.add("io");
    clearTimeout(sessionIoTimers[sessionId]);
    sessionIoTimers[sessionId] = setTimeout(function () {
      el.classList.remove("io");
      delete sessionIoTimers[sessionId];
    }, 80);
  }

  // --- Cross-project IO blink for non-active processing projects ---
  var crossProjectBlinkTimer = null;
  function updateCrossProjectBlink() {
    if (crossProjectBlinkTimer) { clearTimeout(crossProjectBlinkTimer); crossProjectBlinkTimer = null; }
    function doBlink() {
      var dots = document.querySelectorAll("#icon-strip-projects .icon-strip-item:not(.active) .icon-strip-status.processing, #icon-strip-projects .icon-strip-wt-item:not(.active) .icon-strip-status.processing, #icon-strip-users .icon-strip-mate:not(.active) .icon-strip-status.processing");
      // Also blink mobile chat chip dots (same icon-strip-status class inside chips)
      var mobileDots = document.querySelectorAll(".mobile-chat-chip .icon-strip-status.processing");
      var allDots = [];
      for (var i = 0; i < dots.length; i++) allDots.push(dots[i]);
      for (var m = 0; m < mobileDots.length; m++) allDots.push(mobileDots[m]);
      if (allDots.length === 0) { crossProjectBlinkTimer = null; return; }
      for (var i2 = 0; i2 < allDots.length; i2++) { allDots[i2].classList.add("io"); }
      setTimeout(function () {
        for (var j = 0; j < allDots.length; j++) { allDots[j].classList.remove("io"); }
        crossProjectBlinkTimer = setTimeout(doBlink, 150 + Math.random() * 350);
      }, 80);
    }
    crossProjectBlinkTimer = setTimeout(doBlink, 50);
  }

  // --- Urgent favicon animation (banded color flow + title blink) ---
  var urgentBlinkTimer = null;
  var urgentTitleTimer = null;
  var savedTitle = null;
  function startUrgentBlink() {
    if (urgentBlinkTimer) return;
    savedTitle = document.title;
    if (!faviconOrigHref && faviconLink) faviconOrigHref = faviconLink.href;
    faviconAnimFrame = 0;
    // Color flow animation at ~12fps
    urgentBlinkTimer = setInterval(drawFaviconAnimFrame, 83);
    // Title blink separately
    var titleTick = 0;
    urgentTitleTimer = setInterval(function () {
      document.title = titleTick % 2 === 0 ? "\u26A0 Input needed" : savedTitle;
      titleTick++;
    }, 500);
  }
  function stopUrgentBlink() {
    if (!urgentBlinkTimer) return;
    clearInterval(urgentBlinkTimer);
    clearInterval(urgentTitleTimer);
    urgentBlinkTimer = null;
    urgentTitleTimer = null;
    faviconAnimFrame = 0;
    updateFavicon(null);
    if (savedTitle) document.title = savedTitle;
    savedTitle = null;
  }

  function setStatus(status) { _connSetStatus(status); }

  function setActivity(text) {
    if (text) {
      if (!activityEl) {
        activityEl = document.createElement("div");
        activityEl.className = "activity-inline";
        activityEl.innerHTML =
          '<div class="mate-thinking-dots"><span></span><span></span><span></span></div>';
        addToMessages(activityEl);
      }
      scrollToBottom();
    } else {
      if (activityEl) {
        activityEl.remove();
        activityEl = null;
      }
    }
  }

  // --- Pre-thinking (instant dots before server responds) ---
  var matePreThinkingEl = null;
  var matePreThinkingTimer = null;
  function showClaudePreThinking() {
    if (getChatLayout() !== "channel") return;
    var claudeAvatar = CLAUDE_CODE_AVATAR;
    doShowMatePreThinking("Claude Code", claudeAvatar);
  }
  function showMatePreThinking() {
    removeMatePreThinking();
    var mateName = dmTargetUser ? (dmTargetUser.displayName || "Mate") : "Mate";
    var mateAvatar = document.body.dataset.mateAvatarUrl || "";
    doShowMatePreThinking(mateName, mateAvatar);
  }
  function doShowMatePreThinking(mateName, mateAvatar) {
    matePreThinkingEl = document.createElement("div");
    matePreThinkingEl.className = "thinking-item mate-thinking mate-pre-thinking";
    matePreThinkingEl.innerHTML =
      '<img class="dm-bubble-avatar dm-bubble-avatar-mate" src="' + escapeHtml(mateAvatar) + '" alt="" style="display:block">' +
      '<div class="dm-bubble-content">' +
      '<div class="dm-bubble-header"><span class="dm-bubble-name">' + escapeHtml(mateName) + '</span></div>' +
      '<div class="mate-thinking-dots"><span></span><span></span><span></span></div>' +
      '</div>';
    if (activityEl && activityEl.parentNode) {
      activityEl.parentNode.insertBefore(matePreThinkingEl, activityEl);
    } else {
      addToMessages(matePreThinkingEl);
    }
    refreshIcons();
    scrollToBottom();
  }
  function removeMatePreThinking() {
    if (matePreThinkingTimer) {
      clearTimeout(matePreThinkingTimer);
      matePreThinkingTimer = null;
    }
    if (matePreThinkingEl) {
      matePreThinkingEl.remove();
      matePreThinkingEl = null;
    }
  }

  // --- Config chip (model + mode + effort) ---
  var configChipWrap = $("config-chip-wrap");
  var configChip = $("config-chip");
  var configChipLabel = $("config-chip-label");
  var configPopover = $("config-popover");
  var configModelList = $("config-model-list");
  var configModeList = $("config-mode-list");
  var configEffortSection = $("config-effort-section");
  var configEffortBar = $("config-effort-bar");

  var configBetaSection = $("config-beta-section");
  var configBeta1mBtn = $("config-beta-1m");

  var configThinkingSection = $("config-thinking-section");
  var configThinkingBar = $("config-thinking-bar");
  var configThinkingBudgetRow = $("config-thinking-budget-row");
  var configThinkingBudgetInput = $("config-thinking-budget");

  var currentModels = [];
  var currentModel = "";
  var currentMode = "default";
  var currentEffort = "medium";
  var currentBetas = [];
  var currentThinking = "adaptive";
  var currentThinkingBudget = 10000;
  var skipPermsEnabled = false;
  var isOsUsers = false;

  var MODE_OPTIONS = [
    { value: "default", label: "Default" },
    { value: "plan", label: "Plan" },
    { value: "acceptEdits", label: "Auto-accept edits" },
  ];
  var MODE_FULL_AUTO = { value: "bypassPermissions", label: "Full auto" };

  var EFFORT_LEVELS = ["low", "medium", "high", "max"];
  var THINKING_OPTIONS = ["disabled", "adaptive", "budget"];

  function modelDisplayName(value, models) {
    if (!value) return "";
    if (models) {
      for (var i = 0; i < models.length; i++) {
        if (models[i].value === value && models[i].displayName) return models[i].displayName;
      }
    }
    return value;
  }

  function modeDisplayName(value) {
    for (var i = 0; i < MODE_OPTIONS.length; i++) {
      if (MODE_OPTIONS[i].value === value) return MODE_OPTIONS[i].label;
    }
    if (value === "bypassPermissions") return "Full auto";
    if (value === "dontAsk") return "Don\u2019t ask";
    return value;
  }

  function effortDisplayName(value) {
    if (!value) return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function thinkingDisplayName(value) {
    if (value === "disabled") return "Off";
    if (value === "adaptive") return "Adaptive";
    if (value === "budget") return "Budget";
    return value || "Adaptive";
  }

  function isSonnetModel(model) {
    if (!model) return false;
    var lower = model.toLowerCase();
    return lower.indexOf("sonnet") !== -1;
  }

  function hasBeta(name) {
    for (var i = 0; i < currentBetas.length; i++) {
      if (currentBetas[i].indexOf(name) !== -1) return true;
    }
    return false;
  }

  function updateConfigChip() {
    if (!configChipWrap || !configChip) return;
    configChipWrap.classList.remove("hidden");
    var parts = [modelDisplayName(currentModel, currentModels)];
    parts.push(modeDisplayName(currentMode));
    // Only show effort if model supports it
    var modelSupportsEffort = getModelSupportsEffort();
    if (modelSupportsEffort) {
      parts.push(effortDisplayName(currentEffort));
    }
    if (currentThinking && currentThinking !== "adaptive") {
      parts.push(thinkingDisplayName(currentThinking));
    }
    if (hasBeta("context-1m")) {
      parts.push("1M");
    }
    configChipLabel.textContent = parts.join(" \u00b7 ");
    rebuildModelList();
    rebuildModeList();
    rebuildEffortBar();
    rebuildThinkingSection();
    rebuildBetaSection();
  }

  function getModelSupportsEffort() {
    if (!currentModels || currentModels.length === 0) return true; // assume yes if no info
    for (var i = 0; i < currentModels.length; i++) {
      if (currentModels[i].value === currentModel) {
        if (currentModels[i].supportsEffort === false) return false;
        return true;
      }
    }
    return true;
  }

  function getModelEffortLevels() {
    if (!currentModels || currentModels.length === 0) return EFFORT_LEVELS;
    for (var i = 0; i < currentModels.length; i++) {
      if (currentModels[i].value === currentModel) {
        if (currentModels[i].supportedEffortLevels && currentModels[i].supportedEffortLevels.length > 0) {
          return currentModels[i].supportedEffortLevels;
        }
        return EFFORT_LEVELS;
      }
    }
    return EFFORT_LEVELS;
  }

  function rebuildModelList() {
    if (!configModelList) return;
    configModelList.innerHTML = "";
    var list = currentModels.length > 0 ? currentModels : (currentModel ? [{ value: currentModel, displayName: currentModel }] : []);
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var value = item.value || "";
      var label = item.displayName || value;
      var btn = document.createElement("button");
      btn.className = "config-radio-item";
      if (value === currentModel) btn.classList.add("active");
      btn.dataset.model = value;
      btn.textContent = label;
      btn.addEventListener("click", function () {
        var model = this.dataset.model;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_model", model: model }));
        }
        configPopover.classList.add("hidden");
        configChip.classList.remove("active");
      });
      configModelList.appendChild(btn);
    }
  }

  function rebuildModeList() {
    if (!configModeList) return;
    configModeList.innerHTML = "";
    var options = MODE_OPTIONS.slice();
    if (skipPermsEnabled) {
      options.push(MODE_FULL_AUTO);
    }
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var btn = document.createElement("button");
      btn.className = "config-radio-item";
      if (opt.value === currentMode) btn.classList.add("active");
      btn.dataset.mode = opt.value;
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        var mode = this.dataset.mode;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_permission_mode", mode: mode }));
        }
        configPopover.classList.add("hidden");
        configChip.classList.remove("active");
      });
      configModeList.appendChild(btn);
    }
  }

  function rebuildEffortBar() {
    if (!configEffortBar || !configEffortSection) return;
    var supportsEffort = getModelSupportsEffort();
    if (!supportsEffort) {
      configEffortSection.style.display = "none";
      return;
    }
    configEffortSection.style.display = "";
    configEffortBar.innerHTML = "";
    var levels = getModelEffortLevels();
    for (var i = 0; i < levels.length; i++) {
      var level = levels[i];
      var btn = document.createElement("button");
      btn.className = "config-segment-btn";
      if (level === currentEffort) btn.classList.add("active");
      btn.dataset.effort = level;
      btn.textContent = effortDisplayName(level);
      btn.addEventListener("click", function () {
        var effort = this.dataset.effort;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_effort", effort: effort }));
        }
        configPopover.classList.add("hidden");
        configChip.classList.remove("active");
      });
      configEffortBar.appendChild(btn);
    }
  }

  function rebuildBetaSection() {
    if (!configBetaSection || !configBeta1mBtn) return;
    // Only show for Sonnet models
    if (!isSonnetModel(currentModel)) {
      configBetaSection.style.display = "none";
      return;
    }
    configBetaSection.style.display = "";
    var active = hasBeta("context-1m");
    configBeta1mBtn.classList.toggle("active", active);
    configBeta1mBtn.setAttribute("aria-checked", active ? "true" : "false");
  }

  function rebuildThinkingSection() {
    if (!configThinkingBar || !configThinkingSection) return;
    configThinkingSection.style.display = "";
    configThinkingBar.innerHTML = "";
    for (var i = 0; i < THINKING_OPTIONS.length; i++) {
      var opt = THINKING_OPTIONS[i];
      var btn = document.createElement("button");
      btn.className = "config-segment-btn";
      if (opt === currentThinking) btn.classList.add("active");
      btn.dataset.thinking = opt;
      btn.textContent = thinkingDisplayName(opt);
      btn.addEventListener("click", function () {
        var thinking = this.dataset.thinking;
        var msg = { type: "set_thinking", thinking: thinking };
        if (thinking === "budget") {
          msg.budgetTokens = currentThinkingBudget;
        }
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify(msg));
        }
      });
      configThinkingBar.appendChild(btn);
    }
    // Show/hide budget input
    if (configThinkingBudgetRow) {
      configThinkingBudgetRow.style.display = currentThinking === "budget" ? "" : "none";
    }
    if (configThinkingBudgetInput) {
      configThinkingBudgetInput.value = currentThinkingBudget;
    }
  }

  if (configThinkingBudgetInput) {
    configThinkingBudgetInput.addEventListener("change", function () {
      var val = parseInt(this.value, 10);
      if (isNaN(val) || val < 1024) val = 1024;
      if (val > 128000) val = 128000;
      currentThinkingBudget = val;
      this.value = val;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "set_thinking", thinking: "budget", budgetTokens: val }));
      }
    });
  }

  configBeta1mBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var active = hasBeta("context-1m");
    var newBetas;
    if (active) {
      // Remove context-1m beta
      newBetas = [];
      for (var i = 0; i < currentBetas.length; i++) {
        if (currentBetas[i].indexOf("context-1m") === -1) {
          newBetas.push(currentBetas[i]);
        }
      }
    } else {
      // Add context-1m beta
      newBetas = currentBetas.slice();
      newBetas.push("context-1m-2025-08-07");
    }
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "set_betas", betas: newBetas }));
    }
  });

  configChip.addEventListener("click", function (e) {
    e.stopPropagation();
    var wasHidden = configPopover.classList.toggle("hidden");
    configChip.classList.toggle("active", !wasHidden);
  });

  document.addEventListener("click", function (e) {
    if (!configPopover.contains(e.target) && e.target !== configChip) {
      configPopover.classList.add("hidden");
      configChip.classList.remove("active");
    }
  });

  // --- Usage panel ---
  var usagePanel = $("usage-panel");
  var usagePanelClose = $("usage-panel-close");
  var usageCostEl = $("usage-cost");
  var usageInputEl = $("usage-input");
  var usageOutputEl = $("usage-output");
  var usageCacheReadEl = $("usage-cache-read");
  var usageCacheWriteEl = $("usage-cache-write");
  var usageTurnsEl = $("usage-turns");
  var sessionUsage = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };

  function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  function updateUsagePanel() {
    if (!usageCostEl) return;
    usageCostEl.textContent = "$" + sessionUsage.cost.toFixed(4);
    usageInputEl.textContent = formatTokens(sessionUsage.input);
    usageOutputEl.textContent = formatTokens(sessionUsage.output);
    usageCacheReadEl.textContent = formatTokens(sessionUsage.cacheRead);
    usageCacheWriteEl.textContent = formatTokens(sessionUsage.cacheWrite);
    usageTurnsEl.textContent = String(sessionUsage.turns);
  }

  function accumulateUsage(cost, usage) {
    // cost is the SDK's total_cost_usd — a cumulative running total, not a delta.
    // Assign directly instead of summing to avoid overcounting.
    if (cost != null) sessionUsage.cost = cost;
    if (usage) {
      sessionUsage.input += usage.input_tokens || usage.inputTokens || 0;
      sessionUsage.output += usage.output_tokens || usage.outputTokens || 0;
      sessionUsage.cacheRead += usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
      sessionUsage.cacheWrite += usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
    }
    sessionUsage.turns++;
    if (!replayingHistory) updateUsagePanel();
  }

  function resetUsage() {
    sessionUsage = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    updateUsagePanel();
    if (usagePanel) usagePanel.classList.add("hidden");
  }

  function toggleUsagePanel() {
    if (!usagePanel) return;
    usagePanel.classList.toggle("hidden");
    refreshIcons();
  }

  if (usagePanelClose) {
    usagePanelClose.addEventListener("click", function () {
      usagePanel.classList.add("hidden");
    });
  }

  // --- Status panel ---
  var statusPanel = $("status-panel");
  var statusPanelClose = $("status-panel-close");
  var statusPidEl = $("status-pid");
  var statusUptimeEl = $("status-uptime");
  var statusRssEl = $("status-rss");
  var statusHeapUsedEl = $("status-heap-used");
  var statusHeapTotalEl = $("status-heap-total");
  var statusExternalEl = $("status-external");
  var statusSessionsEl = $("status-sessions");
  var statusProcessingEl = $("status-processing");
  var statusClientsEl = $("status-clients");
  var statusTerminalsEl = $("status-terminals");
  var statusRefreshTimer = null;

  function formatBytes(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
    return n + " B";
  }

  function formatUptime(seconds) {
    var d = Math.floor(seconds / 86400);
    var h = Math.floor((seconds % 86400) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    if (d > 0) return d + "d " + h + "h " + m + "m";
    if (h > 0) return h + "h " + m + "m " + s + "s";
    return m + "m " + s + "s";
  }

  function updateStatusPanel(data) {
    if (!statusPidEl) return;
    statusPidEl.textContent = String(data.pid);
    statusUptimeEl.textContent = formatUptime(data.uptime);
    statusRssEl.textContent = formatBytes(data.memory.rss);
    statusHeapUsedEl.textContent = formatBytes(data.memory.heapUsed);
    statusHeapTotalEl.textContent = formatBytes(data.memory.heapTotal);
    statusExternalEl.textContent = formatBytes(data.memory.external);
    statusSessionsEl.textContent = String(data.sessions);
    statusProcessingEl.textContent = String(data.processing);
    statusClientsEl.textContent = String(data.clients);
    statusTerminalsEl.textContent = String(data.terminals);
  }

  function requestProcessStats() {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "process_stats" }));
    }
  }

  function toggleStatusPanel() {
    if (!statusPanel) return;
    var opening = statusPanel.classList.contains("hidden");
    statusPanel.classList.toggle("hidden");
    if (opening) {
      requestProcessStats();
      statusRefreshTimer = setInterval(requestProcessStats, 5000);
    } else {
      if (statusRefreshTimer) {
        clearInterval(statusRefreshTimer);
        statusRefreshTimer = null;
      }
    }
    refreshIcons();
  }

  if (statusPanelClose) {
    statusPanelClose.addEventListener("click", function () {
      statusPanel.classList.add("hidden");
      if (statusRefreshTimer) {
        clearInterval(statusRefreshTimer);
        statusRefreshTimer = null;
      }
    });
  }

  // --- Context panel ---
  var contextPanel = $("context-panel");
  var contextPanelClose = $("context-panel-close");
  var contextPanelMinimize = $("context-panel-minimize");
  var contextBarFill = $("context-bar-fill");
  var contextBarPct = $("context-bar-pct");
  var contextUsedEl = $("context-used");
  var contextWindowEl = $("context-window");
  var contextMaxOutputEl = $("context-max-output");
  var contextInputEl = $("context-input");
  var contextOutputEl = $("context-output");
  var contextCacheReadEl = $("context-cache-read");
  var contextCacheWriteEl = $("context-cache-write");
  var contextModelEl = $("context-model");
  var contextCostEl = $("context-cost");
  var contextTurnsEl = $("context-turns");
  var contextMini = $("context-mini");
  var contextMiniFill = $("context-mini-fill");
  var contextMiniLabel = $("context-mini-label");
  var contextData = { contextWindow: 0, maxOutputTokens: 0, model: "-", cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  var headerContextEl = null;
  var richContextUsage = null;
  var ctxPopoverEl = null;
  var ctxPopoverVisible = false;

  // Known context window sizes per model (fallback when SDK omits feature flag)
  var KNOWN_CONTEXT_WINDOWS = {
    "opus-4-6": 1000000,
    "claude-sonnet-4": 1000000
  };

  function resolveContextWindow(model, sdkValue) {
    if (sdkValue) return sdkValue;
    var lc = (model || "").toLowerCase();
    for (var key in KNOWN_CONTEXT_WINDOWS) {
      if (lc.includes(key)) return KNOWN_CONTEXT_WINDOWS[key];
    }
    return 200000;
  }

  function contextPctClass(pct) {
    return pct >= 85 ? " danger" : pct >= 60 ? " warn" : "";
  }

  function updateContextPanel() {
    if (!contextUsedEl) return;
    // Context window usage = input tokens only (includes cache read/write)
    var used = contextData.input;
    var win = contextData.contextWindow;
    var pct = win > 0 ? Math.min(100, (used / win) * 100) : 0;
    var cls = contextPctClass(pct);
    // Panel bar
    contextBarFill.style.width = pct.toFixed(1) + "%";
    contextBarFill.className = "context-bar-fill" + cls;
    contextBarPct.textContent = pct.toFixed(0) + "%";
    // Mini bar
    if (contextMiniFill) {
      contextMiniFill.style.width = pct.toFixed(1) + "%";
      contextMiniFill.className = "context-mini-fill" + cls;
    }
    if (contextMiniLabel) {
      contextMiniLabel.textContent = (win > 0 ? formatTokens(used) + "/" + formatTokens(win) : "0%");
    }
    // Header bar
    if (pct > 0) {
      var statusArea = document.querySelector(".title-bar-content .status");
      if (statusArea && !headerContextEl) {
        headerContextEl = document.createElement("div");
        headerContextEl.className = "header-context";
        headerContextEl.innerHTML = '<div class="header-context-bar"><div class="header-context-fill"></div></div><span class="header-context-label"></span>';
        statusArea.insertBefore(headerContextEl, statusArea.firstChild);
        headerContextEl.addEventListener("mouseenter", function() {
          if (richContextUsage) {
            showCtxPopover();
          }
        });
        headerContextEl.addEventListener("mouseleave", function() {
          ctxHoverTimer = setTimeout(hideCtxPopover, 120);
        });
      }
      if (headerContextEl) {
        var hFill = headerContextEl.querySelector(".header-context-fill");
        var hLabel = headerContextEl.querySelector(".header-context-label");
        hFill.style.width = pct.toFixed(1) + "%";
        hFill.className = "header-context-fill" + cls;
        hLabel.textContent = pct.toFixed(0) + "%";
        // Use data-tip as fallback when rich data is not yet loaded
        if (richContextUsage) {
          headerContextEl.removeAttribute("data-tip");
        } else {
          headerContextEl.dataset.tip = "Context window " + pct.toFixed(0) + "% used (" + formatTokens(used) + " / " + formatTokens(win) + " tokens)";
        }
      }
    }
    contextUsedEl.textContent = formatTokens(used);
    contextWindowEl.textContent = win > 0 ? formatTokens(win) : "-";
    contextMaxOutputEl.textContent = contextData.maxOutputTokens > 0 ? formatTokens(contextData.maxOutputTokens) : "-";
    contextInputEl.textContent = formatTokens(contextData.input);
    contextOutputEl.textContent = formatTokens(contextData.output);
    contextCacheReadEl.textContent = formatTokens(contextData.cacheRead);
    contextCacheWriteEl.textContent = formatTokens(contextData.cacheWrite);
    contextModelEl.textContent = contextData.model;
    contextCostEl.textContent = "$" + contextData.cost.toFixed(4);
    contextTurnsEl.textContent = String(contextData.turns);
  }

  function accumulateContext(cost, usage, modelUsage, lastStreamInputTokens) {
    // cost is the SDK's total_cost_usd — a cumulative running total, not a delta.
    if (cost != null) contextData.cost = cost;
    // Use latest turn values (not cumulative) since each turn's input_tokens
    // already includes the full conversation context up to that point
    if (usage) {
      // Prefer per-call input_tokens from the last stream message_start event
      // when available — result.usage.input_tokens sums all API calls in a turn,
      // inflating context usage when tools are involved.
      // Falls back to the summed value for setups that don't emit message_start.
      if (lastStreamInputTokens) {
        contextData.input = lastStreamInputTokens;
      } else {
        contextData.input = (usage.input_tokens || usage.inputTokens || 0)
            + (usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0);
      }
      contextData.output = usage.output_tokens || usage.outputTokens || 0;
      contextData.cacheRead = usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
      contextData.cacheWrite = usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
    }
    contextData.turns++;
    if (modelUsage) {
      var models = Object.keys(modelUsage);
      if (models.length > 0) {
        var m = models[0];
        var mu = modelUsage[m];
        contextData.model = m;
        contextData.contextWindow = resolveContextWindow(m, mu.contextWindow);
        if (mu.maxOutputTokens) contextData.maxOutputTokens = mu.maxOutputTokens;
      }
    }
    if (!replayingHistory) updateContextPanel();
  }

  // contextView: "off" | "mini" | "panel"
  function getContextView() {
    try { return localStorage.getItem("clay-context-view") || "off"; } catch (e) { return "off"; }
  }
  function setContextView(v) {
    try { localStorage.setItem("clay-context-view", v); } catch (e) {}
  }

  function applyContextView(view) {
    if (contextPanel) contextPanel.classList.toggle("hidden", view !== "panel");
    if (contextMini) contextMini.classList.toggle("hidden", view !== "mini");
    if (view === "panel") refreshIcons();
  }

  function resetContextData() {
    contextData = { contextWindow: 0, maxOutputTokens: 0, model: "-", cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    richContextUsage = null;
    hideCtxPopover();
    updateContextPanel();
  }

  // --- Rich context usage popover ---

  var ctxHoverTimer = null;

  function ensureCtxPopover() {
    if (ctxPopoverEl) return;
    ctxPopoverEl = document.createElement("div");
    ctxPopoverEl.className = "context-usage-popover hidden";
    // Keep popover open when hovering over it
    ctxPopoverEl.addEventListener("mouseenter", function() {
      if (ctxHoverTimer) { clearTimeout(ctxHoverTimer); ctxHoverTimer = null; }
    });
    ctxPopoverEl.addEventListener("mouseleave", function() {
      hideCtxPopover();
    });
  }

  function showCtxPopover() {
    if (!headerContextEl || !richContextUsage) return;
    if (ctxHoverTimer) { clearTimeout(ctxHoverTimer); ctxHoverTimer = null; }
    ensureCtxPopover();
    headerContextEl.appendChild(ctxPopoverEl);
    renderCtxPopover();
    ctxPopoverEl.classList.remove("hidden");
    ctxPopoverVisible = true;
  }

  function hideCtxPopover() {
    if (!ctxPopoverEl) return;
    ctxPopoverEl.classList.add("hidden");
    ctxPopoverVisible = false;
  }

  // Categories to hide from the legend (noise, not actionable)
  var CTX_HIDDEN_CATS = { "Free space": 1, "Autocompact buffer": 1 };

  function renderCtxPopover() {
    if (!ctxPopoverEl || !richContextUsage) return;
    var d = richContextUsage;
    var cats = d.categories || [];
    var total = d.totalTokens || 0;
    var max = d.maxTokens || 0;
    var pct = d.percentage != null ? d.percentage : (max > 0 ? (total / max) * 100 : 0);

    var html = "";

    // Header
    html += '<div class="ctx-pop-header">';
    html += '<span class="ctx-pop-model">' + escHtml(d.model || contextData.model || "-") + '</span>';
    html += '<span class="ctx-pop-pct">' + pct.toFixed(0) + '%';
    html += '<span class="ctx-pop-tokens">' + formatTokens(total) + ' / ' + formatTokens(max) + '</span>';
    html += '</span>';
    html += '</div>';

    // Category emoji map
    var CTX_EMOJI = {
      "System prompt": "\ud83d\udcdc", "System tools": "\ud83d\udee0\ufe0f",
      "Memory files": "\ud83d\udcc1", "Skills": "\u26a1", "Messages": "\ud83d\udcac",
      "MCP tools": "\ud83d\udd0c", "Agents": "\ud83e\udd16", "Deferred tools": "\ud83d\udce6"
    };

    // Stacked bar
    if (cats.length > 0 && max > 0) {
      html += '<div class="ctx-cat-bar">';
      for (var i = 0; i < cats.length; i++) {
        var cat = cats[i];
        if (cat.isDeferred || !cat.tokens || CTX_HIDDEN_CATS[cat.name]) continue;
        var w = Math.max(0.3, (cat.tokens / max) * 100);
        html += '<div style="width:' + w.toFixed(2) + '%;background:' + escHtml(cat.color) + '"></div>';
      }
      html += '</div>';

      // Legend
      html += '<div class="ctx-cat-legend">';
      for (var j = 0; j < cats.length; j++) {
        var c = cats[j];
        if (c.isDeferred || !c.tokens || CTX_HIDDEN_CATS[c.name]) continue;
        var emoji = CTX_EMOJI[c.name] || "\ud83d\udcca";
        html += '<div class="ctx-cat-item">';
        html += '<span class="ctx-cat-name">' + em(emoji) + ' ' + escHtml(c.name) + '</span>';
        html += '<span class="ctx-cat-value">' + formatTokens(c.tokens) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Message breakdown
    var mb = d.messageBreakdown;
    if (mb) {
      html += '<div class="ctx-pop-divider"></div>';
      html += '<div class="ctx-pop-section-label">' + em("\ud83d\udcac") + ' Messages</div>';
      if (mb.userMessageTokens) {
        html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83d\udc64") + ' User</span><span class="ctx-pop-row-value">' + formatTokens(mb.userMessageTokens) + '</span></div>';
      }
      if (mb.assistantMessageTokens) {
        html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83e\udd16") + ' Assistant</span><span class="ctx-pop-row-value">' + formatTokens(mb.assistantMessageTokens) + '</span></div>';
      }
      if (mb.toolCallTokens) {
        html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83d\udee0\ufe0f") + ' Tool calls</span><span class="ctx-pop-row-value">' + formatTokens(mb.toolCallTokens) + '</span></div>';
      }
      if (mb.toolResultTokens) {
        html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83d\udccb") + ' Tool results</span><span class="ctx-pop-row-value">' + formatTokens(mb.toolResultTokens) + '</span></div>';
      }
      if (mb.attachmentTokens) {
        html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83d\udcce") + ' Attachments</span><span class="ctx-pop-row-value">' + formatTokens(mb.attachmentTokens) + '</span></div>';
      }
    }

    // Memory files
    var mf = d.memoryFiles;
    if (mf && mf.length > 0) {
      html += '<div class="ctx-pop-divider"></div>';
      html += '<div class="ctx-pop-section-label">' + em("\ud83d\udcc1") + ' Memory Files</div>';
      var baseCount = {};
      for (var mc = 0; mc < mf.length; mc++) {
        var bn = mf[mc].path.split("/").pop() || mf[mc].path;
        baseCount[bn] = (baseCount[bn] || 0) + 1;
      }
      for (var mi = 0; mi < mf.length; mi++) {
        var fpath = mf[mi].path;
        var fname = fpath.split("/").pop() || fpath;
        if (baseCount[fname] > 1) {
          var parts = fpath.split("/");
          fname = parts.length >= 2 ? parts[parts.length - 2] + "/" + fname : fpath;
        }
        html += '<div class="ctx-pop-row"><span class="ctx-pop-row-label">' + em("\ud83d\udcc4") + ' ' + escHtml(fname) + '</span><span class="ctx-pop-row-value">' + formatTokens(mf[mi].tokens) + '</span></div>';
      }
    }

    // Auto-compact note
    if (d.isAutoCompactEnabled && d.autoCompactThreshold) {
      html += '<div class="ctx-pop-note">' + em("\u267b\ufe0f") + ' Auto-compact at ' + formatTokens(d.autoCompactThreshold) + '</div>';
    }

    ctxPopoverEl.innerHTML = html;
  }

  function escHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function em(emoji) {
    return '<span class="ctx-emoji">' + emoji + '</span>';
  }

  function resetContext() {
    resetContextData();
    // Keep view state, just reset data
    applyContextView(getContextView());
  }

  function minimizeContext() {
    setContextView("mini");
    applyContextView("mini");
  }

  function expandContext() {
    setContextView("panel");
    applyContextView("panel");
  }

  function toggleContextPanel() {
    if (!contextPanel) return;
    var view = getContextView();
    if (view === "panel") {
      setContextView("mini");
      applyContextView("mini");
    } else {
      setContextView("panel");
      applyContextView("panel");
    }
  }

  if (contextPanelClose) {
    contextPanelClose.addEventListener("click", function () {
      setContextView("off");
      applyContextView("off");
    });
  }

  if (contextPanelMinimize) {
    contextPanelMinimize.addEventListener("click", minimizeContext);
  }

  // Restore context view on load
  applyContextView(getContextView());

  if (contextMini) {
    contextMini.addEventListener("click", expandContext);
  }

  function addToMessages(el) {
    if (prependAnchor) messagesEl.insertBefore(el, prependAnchor);
    else messagesEl.appendChild(el);
    var _sme = getScheduledMsgEl();
    if (_sme && el !== _sme && _sme.parentNode === messagesEl) {
      messagesEl.appendChild(_sme);
    }
  }

  var newMsgBtn = $("new-msg-btn");
  var newMsgBtnDefault = "\u2193 Latest";
  var newMsgBtnActivity = "\u2193 New activity";

  messagesEl.addEventListener("scroll", function () {
    var distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    isUserScrolledUp = distFromBottom > scrollThreshold;
    if (isUserScrolledUp) {
      if (newMsgBtn.classList.contains("hidden")) {
        newMsgBtn.textContent = newMsgBtnDefault;
      }
      newMsgBtn.classList.remove("hidden");
    } else {
      newMsgBtn.classList.add("hidden");
      newMsgBtn.textContent = newMsgBtnDefault;
    }
  });

  newMsgBtn.addEventListener("click", function () {
    forceScrollToBottom();
  });

  // Fork session from a user message
  messagesEl.addEventListener("click", function(e) {
    var btn = e.target.closest(".msg-action-fork");
    if (!btn) return;
    var msgEl = btn.closest("[data-uuid]");
    if (!msgEl || !msgEl.dataset.uuid) return;
    var forkUuid = msgEl.dataset.uuid;
    showConfirm("Fork session from this message?", function() {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "fork_session", uuid: forkUuid }));
      }
    }, "Fork", false);
  });

  function scrollToBottom() {
    if (prependAnchor) return;
    if (isUserScrolledUp) {
      newMsgBtn.textContent = newMsgBtnActivity;
      newMsgBtn.classList.remove("hidden");
      return;
    }
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function forceScrollToBottom() {
    if (prependAnchor) return;
    isUserScrolledUp = false;
    newMsgBtn.classList.add("hidden");
    newMsgBtn.textContent = newMsgBtnDefault;
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // --- Tools module ---
  initTools({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get turnCounter() { return turnCounter; },
    messagesEl: messagesEl,
    inputEl: inputEl,
    finalizeAssistantBlock: function() { finalizeAssistantBlock(); },
    addToMessages: function(el) { addToMessages(el); },
    scrollToBottom: function() { scrollToBottom(); },
    setActivity: function(text) { setActivity(text); },
    stopUrgentBlink: function() { stopUrgentBlink(); },
    showImageModal: showImageModal,
    getContextPercent: function() {
      var used = contextData.input;
      var win = contextData.contextWindow;
      return win > 0 ? Math.round((used / win) * 100) : 0;
    },
    isMateDm: function () { return dmMode && dmTargetUser && dmTargetUser.isMate; },
    getMateName: function () { return dmTargetUser ? (dmTargetUser.displayName || "Mate") : "Mate"; },
    getMateAvatarUrl: function () { return document.body.dataset.mateAvatarUrl || ""; },
    getClaudeAvatar: function () { return CLAUDE_CODE_AVATAR; },
    getMateById: function (id) {
      if (!id || !cachedMatesList) return null;
      for (var i = 0; i < cachedMatesList.length; i++) {
        if (cachedMatesList[i].id === id) return cachedMatesList[i];
      }
      return null;
    },
  });

  // isPlanFile, toolSummary, toolActivityText, shortPath -> modules/tools.js

  // AskUserQuestion, PermissionRequest, Plan, Todo, Thinking, Tool items -> modules/tools.js

  // --- DOM: Messages ---
  function addUserMessage(text, images, pastes, fromUserId, fromUserName) {
    if (!text && (!images || images.length === 0) && (!pastes || pastes.length === 0)) return;
    var isOtherUser = fromUserId && fromUserId !== myUserId;
    var div = document.createElement("div");
    div.className = "msg-user" + (isOtherUser ? " msg-user-other" : "");
    div.dataset.turn = ++turnCounter;
    if (shouldGroupMessage("msg-user")) div.classList.add("grouped");
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.dir = "auto";

    if (images && images.length > 0) {
      var imgRow = document.createElement("div");
      imgRow.className = "bubble-images";
      for (var i = 0; i < images.length; i++) {
        var img = document.createElement("img");
        if (images[i].url) {
          img.src = images[i].url;
        } else if (images[i].data) {
          img.src = "data:" + images[i].mediaType + ";base64," + images[i].data;
        }
        img.loading = "lazy";
        img.className = "bubble-img";
        img.addEventListener("click", function () { showImageModal(this.src); });
        img.addEventListener("error", function () {
          var placeholder = document.createElement("div");
          placeholder.className = "bubble-img-expired";
          placeholder.textContent = "Image deleted";
          this.parentNode.replaceChild(placeholder, this);
        });
        imgRow.appendChild(img);
      }
      bubble.appendChild(imgRow);
    }

    if (pastes && pastes.length > 0) {
      var pasteRow = document.createElement("div");
      pasteRow.className = "bubble-pastes";
      for (var p = 0; p < pastes.length; p++) {
        (function (pasteText) {
          var chip = document.createElement("div");
          chip.className = "bubble-paste";
          var preview = pasteText.substring(0, 60).replace(/\n/g, " ");
          if (pasteText.length > 60) preview += "...";
          chip.innerHTML = '<span class="bubble-paste-preview">' + escapeHtml(preview) + '</span><span class="bubble-paste-label">PASTED</span>';
          chip.addEventListener("click", function (e) {
            e.stopPropagation();
            showPasteModal(pasteText);
          });
          pasteRow.appendChild(chip);
        })(pastes[p]);
      }
      bubble.appendChild(pasteRow);
    }

    if (text) {
      var textEl = document.createElement("span");
      textEl.textContent = text;
      bubble.appendChild(textEl);
    }


    // Always render avatar + header structure (CSS controls visibility)
    var _targetUser;
    var _displayName;
    if (isOtherUser) {
      _targetUser = cachedAllUsers.find(function (u) { return u.id === fromUserId; });
      _displayName = fromUserName || (_targetUser && (_targetUser.displayName || _targetUser.username)) || "User";
    } else {
      _targetUser = cachedAllUsers.find(function (u) { return u.id === myUserId; });
      if (!_targetUser) {
        try { _targetUser = JSON.parse(localStorage.getItem("clay_my_user") || "null"); } catch(e) {}
      }
      _displayName = document.body.dataset.myDisplayName || "";
      if (!_displayName) {
        _displayName = (_targetUser && (_targetUser.displayName || _targetUser.username)) || "Me";
      }
    }

    var avi = document.createElement("img");
    avi.className = "dm-bubble-avatar" + (isOtherUser ? " dm-bubble-avatar-other" : " dm-bubble-avatar-me");
    avi.src = isOtherUser
      ? userAvatarUrl(_targetUser || { id: fromUserId }, 36)
      : (document.body.dataset.myAvatarUrl || userAvatarUrl(_targetUser || { id: myUserId }, 36));
    div.appendChild(avi);

    var contentWrap = document.createElement("div");
    contentWrap.className = "dm-bubble-content";

    var header = document.createElement("div");
    header.className = "dm-bubble-header";
    var nameSpan = document.createElement("span");
    nameSpan.className = "dm-bubble-name";
    nameSpan.textContent = _displayName;
    header.appendChild(nameSpan);
    var timeSpan = document.createElement("span");
    timeSpan.className = "dm-bubble-time";
    timeSpan.textContent = getMsgTime();
    header.appendChild(timeSpan);
    contentWrap.appendChild(header);
    contentWrap.appendChild(bubble);
    div.appendChild(contentWrap);

    // Action bar below bubble (icons visible on hover)
    var actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML =
      '<span class="msg-action-time">' + getMsgTime() + '</span>' +
      '<button class="msg-action-btn msg-action-copy" type="button" title="Copy">' + iconHtml("copy") + '</button>' +
      '<button class="msg-action-btn msg-action-fork" type="button" title="Fork">' + iconHtml("git-branch") + '</button>' +
      '<button class="msg-action-btn msg-action-rewind msg-user-rewind-btn" type="button" title="Rewind">' + iconHtml("rotate-ccw") + '</button>' +
      '<button class="msg-action-btn msg-action-hidden msg-action-edit" type="button" title="Edit">' + iconHtml("pencil") + '</button>';
    div.appendChild(actions);

    // Copy handler
    actions.querySelector(".msg-action-copy").addEventListener("click", function () {
      var self = this;
      copyToClipboard(text || "");
      self.innerHTML = iconHtml("check");
      refreshIcons();
      setTimeout(function () { self.innerHTML = iconHtml("copy"); refreshIcons(); }, 1200);
    });

    addToMessages(div);
    refreshIcons();
    forceScrollToBottom();
  }

  // Track the timestamp of the current message being processed (from history _ts or now)
  var currentMsgTs = null;

  function getMsgTime() {
    var d = currentMsgTs ? new Date(currentMsgTs) : new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function shouldGroupMessage(senderClass) {
    // Skip grouping during history replay if no timestamp data
    if (replayingHistory && !currentMsgTs) return false;
    var prev = messagesEl.lastElementChild;
    if (!prev || !prev.classList.contains(senderClass)) return false;
    var prevTime = prev.querySelector(".dm-bubble-time");
    if (!prevTime) return false;
    return prevTime.textContent === getMsgTime();
  }

  function ensureAssistantBlock() {
    if (!currentMsgEl) {
      currentMsgEl = document.createElement("div");
      currentMsgEl.className = "msg-assistant";
      currentMsgEl.dataset.turn = turnCounter;

      var grouped = shouldGroupMessage("msg-assistant");
      if (grouped) currentMsgEl.classList.add("grouped");

      // Always render avatar + header structure (CSS controls visibility)
      var _isDm2 = document.body.classList.contains("mate-dm-active") && document.body.dataset.mateAvatarUrl;
      var avi = document.createElement("img");
      avi.className = "dm-bubble-avatar dm-bubble-avatar-mate";
      avi.src = _isDm2 ? document.body.dataset.mateAvatarUrl : CLAUDE_CODE_AVATAR;
      currentMsgEl.appendChild(avi);

      var contentWrap = document.createElement("div");
      contentWrap.className = "dm-bubble-content";

      var header = document.createElement("div");
      header.className = "dm-bubble-header";
      var nameSpan = document.createElement("span");
      nameSpan.className = "dm-bubble-name";
      nameSpan.textContent = _isDm2 ? ((dmTargetUser && dmTargetUser.displayName) || "Mate") : "Claude Code";
      header.appendChild(nameSpan);
      var timeSpan = document.createElement("span");
      timeSpan.className = "dm-bubble-time";
      timeSpan.textContent = getMsgTime();
      header.appendChild(timeSpan);
      contentWrap.appendChild(header);

      var mdDiv = document.createElement("div");
      mdDiv.className = "md-content";
      mdDiv.dir = "auto";
      contentWrap.appendChild(mdDiv);
      currentMsgEl.appendChild(contentWrap);
      addToMessages(currentMsgEl);
      currentFullText = "";
    }
    return currentMsgEl;
  }

  function addCopyHandler(msgEl, rawText) {
    var primed = false;
    var resetTimer = null;

    var isTouchDevice = "ontouchstart" in window;

    var hint = document.createElement("div");
    hint.className = "msg-copy-hint";
    hint.textContent = (isTouchDevice ? "Tap" : "Click") + " to grab this";
    msgEl.appendChild(hint);

    function reset() {
      primed = false;
      msgEl.classList.remove("copy-primed", "copy-done");
      hint.textContent = (isTouchDevice ? "Tap" : "Click") + " to grab this";
    }

    msgEl.addEventListener("click", function (e) {
      // Don't intercept clicks on links or code blocks
      if (e.target.closest("a, pre, code")) return;
      // Don't intercept text selection
      var sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;

      if (!primed) {
        primed = true;
        msgEl.classList.add("copy-primed");
        hint.textContent = isTouchDevice ? "Tap again to grab" : "Click again to grab";
        clearTimeout(resetTimer);
        resetTimer = setTimeout(reset, 3000);
      } else {
        clearTimeout(resetTimer);
        copyToClipboard(rawText).then(function () {
          msgEl.classList.remove("copy-primed");
          msgEl.classList.add("copy-done");
          hint.textContent = "Grabbed!";
          resetTimer = setTimeout(reset, 1500);
        });
      }
    });

    document.addEventListener("click", function (e) {
      if (primed && !msgEl.contains(e.target)) reset();
    });
  }

  // --- Stream smoothing: buffer deltas and drain at a steady frame rate ---
  var streamBuffer = "";
  var streamDrainTimer = null;

  function appendDelta(text) {
    ensureAssistantBlock();
    streamBuffer += text;
    if (!streamDrainTimer) {
      streamDrainTimer = requestAnimationFrame(drainStreamTick);
    }
  }

  function drainStreamTick() {
    streamDrainTimer = null;
    if (!currentMsgEl || streamBuffer.length === 0) return;

    // Adaptive chunk size: drain just enough per frame to keep up
    // without letting the buffer grow unbounded.
    // At 60fps, typical streaming (~300 chars/sec) needs ~5 chars/frame.
    var n;
    var len = streamBuffer.length;
    if (len > 200) { n = Math.ceil(len / 4); }
    else if (len > 80) { n = 8; }
    else if (len > 30) { n = 5; }
    else if (len > 10) { n = 2; }
    else { n = 1; }

    var chunk = streamBuffer.slice(0, n);
    streamBuffer = streamBuffer.slice(n);
    currentFullText += chunk;

    // Full markdown render every frame — keeps structure (tables, lists)
    // intact and avoids cursor-span jumping artifacts.
    var contentEl = currentMsgEl.querySelector(".md-content");
    contentEl.innerHTML = renderMarkdown(currentFullText);

    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(function () {
      highlightCodeBlocks(contentEl);
    }, 150);

    scrollToBottom();

    if (streamBuffer.length > 0) {
      streamDrainTimer = requestAnimationFrame(drainStreamTick);
    }
  }

  function flushStreamBuffer() {
    if (streamDrainTimer) { cancelAnimationFrame(streamDrainTimer); streamDrainTimer = null; }
    if (streamBuffer.length > 0) {
      currentFullText += streamBuffer;
      streamBuffer = "";
    }
    if (currentMsgEl) {
      var contentEl = currentMsgEl.querySelector(".md-content");
      if (contentEl) {
        contentEl.innerHTML = renderMarkdown(currentFullText);
        highlightCodeBlocks(contentEl);
      }
    }
  }

  function finalizeAssistantBlock() {
    flushStreamBuffer();
    if (currentMsgEl) {
      var contentEl = currentMsgEl.querySelector(".md-content");
      if (contentEl) {
        highlightCodeBlocks(contentEl);
        renderMermaidBlocks(contentEl);
      }
      if (currentFullText) {
        addCopyHandler(currentMsgEl, currentFullText);
      }
      // Assistant text appeared, so break the current tool group
      closeToolGroup();
    }
    currentMsgEl = null;
    currentFullText = "";
  }

  function addSystemMessage(text, isError) {
    var div = document.createElement("div");
    div.className = "sys-msg" + (isError ? " error" : "");
    div.innerHTML = '<span class="sys-text"></span>';
    div.querySelector(".sys-text").textContent = text;
    addToMessages(div);
    scrollToBottom();
  }

  function addConflictMessage(msg) {
    var div = document.createElement("div");
    div.className = "conflict-msg";
    var header = document.createElement("div");
    header.className = "conflict-header";
    header.textContent = msg.text || "Another Claude Code process is already running.";
    div.appendChild(header);

    var hint = document.createElement("div");
    hint.className = "conflict-hint";
    hint.textContent = "Kill the conflicting process to continue, or use the existing Claude Code session.";
    div.appendChild(hint);

    for (var i = 0; i < msg.processes.length; i++) {
      var p = msg.processes[i];
      var row = document.createElement("div");
      row.className = "conflict-process";

      var info = document.createElement("span");
      info.className = "conflict-pid";
      info.textContent = "PID " + p.pid;
      row.appendChild(info);

      var cmd = document.createElement("code");
      cmd.className = "conflict-cmd";
      cmd.textContent = p.command.length > 80 ? p.command.substring(0, 80) + "..." : p.command;
      cmd.title = p.command;
      row.appendChild(cmd);

      var killBtn = document.createElement("button");
      killBtn.className = "conflict-kill-btn";
      killBtn.textContent = "Kill Process";
      killBtn.setAttribute("data-pid", p.pid);
      killBtn.addEventListener("click", function() {
        var pid = parseInt(this.getAttribute("data-pid"), 10);
        ws.send(JSON.stringify({ type: "kill_process", pid: pid }));
        this.disabled = true;
        this.textContent = "Killing...";
      });
      row.appendChild(killBtn);
      div.appendChild(row);
    }

    addToMessages(div);
    scrollToBottom();
  }

  function addContextOverflowMessage(msg) {
    var div = document.createElement("div");
    div.className = "context-overflow-msg";

    var header = document.createElement("div");
    header.className = "context-overflow-header";
    header.textContent = msg.text || "Conversation too long to continue.";
    div.appendChild(header);

    var hint = document.createElement("div");
    hint.className = "context-overflow-hint";
    hint.textContent = "The conversation has exceeded the model's context limit. Please start a new conversation to continue.";
    div.appendChild(hint);

    var btn = document.createElement("button");
    btn.className = "context-overflow-btn";
    btn.textContent = "New Conversation";
    btn.addEventListener("click", function() {
      ws.send(JSON.stringify({ type: "new_session" }));
    });
    div.appendChild(btn);

    addToMessages(div);
    scrollToBottom();
  }

  // Pending command to run in the next created terminal
  var pendingTermCommand = null;

  function addAuthRequiredMessage(msg) {
    // Capture the last user message text so we can resend it after login
    var lastUserMsg = messagesEl ? messagesEl.querySelectorAll(".msg-user .bubble > span") : [];
    var lastUserText = lastUserMsg.length > 0 ? lastUserMsg[lastUserMsg.length - 1].textContent : "";

    var div = document.createElement("div");
    div.className = "auth-required-msg";

    var header = document.createElement("div");
    header.className = "auth-required-header";
    header.textContent = msg.text || "Claude Code is not logged in.";
    div.appendChild(header);

    var hint = document.createElement("div");
    hint.className = "auth-required-hint";

    // Shared handler: restore input with the failed message text
    function resumeAfterLogin() {
      var inputArea = document.getElementById("input-area");
      if (inputArea) inputArea.classList.remove("hidden");
      inputEl.disabled = false;
      inputEl.placeholder = "";
      sendBtn.disabled = false;
      div.remove();
      // Restore the failed message text into the input so the user can resend
      if (lastUserText) {
        inputEl.value = lastUserText;
        autoResize();
      }
      if (!("ontouchstart" in window)) {
        inputEl.focus();
      }
    }

    if (msg.canAutoLogin) {
      // Auto-open terminal and run claude
      if (msg.linuxUser) {
        hint.textContent = "Opening a terminal as " + msg.linuxUser + " to log in...";
      } else {
        hint.textContent = "Opening a terminal to log in...";
      }
      div.appendChild(hint);

      var guide = document.createElement("div");
      guide.className = "auth-required-guide";
      guide.textContent = "When a login URL appears in the terminal, click it to open in your browser. Do not press 'c' as it will try to open the browser on the server.";
      div.appendChild(guide);

      var sessionHint = document.createElement("div");
      sessionHint.className = "auth-required-guide";
      sessionHint.textContent = "After logging in, click \"Continue\" to proceed.";
      div.appendChild(sessionHint);

      var btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:8px;margin-top:8px;";

      var loginBtn = document.createElement("button");
      loginBtn.className = "auth-required-btn";
      loginBtn.textContent = "Open terminal & log in";
      loginBtn.addEventListener("click", function () {
        pendingTermCommand = "claude\n";
        ws.send(JSON.stringify({ type: "term_create", cols: 80, rows: 24 }));
        openTerminal();
      });
      btnRow.appendChild(loginBtn);

      var continueBtn = document.createElement("button");
      continueBtn.className = "auth-required-btn";
      continueBtn.textContent = "Continue";
      continueBtn.addEventListener("click", resumeAfterLogin);
      btnRow.appendChild(continueBtn);

      div.appendChild(btnRow);

      addToMessages(div);
      scrollToBottom();

      // Hide input area on this session since it cannot be used until login
      var inputArea = document.getElementById("input-area");
      if (inputArea) inputArea.classList.add("hidden");

      // Only auto-open terminal on live events, not history replay
      if (!replayingHistory) {
        pendingTermCommand = "claude\n";
        ws.send(JSON.stringify({ type: "term_create", cols: 80, rows: 24 }));
        openTerminal();
      }
    } else {
      // Multi-user regular user: show message only, no auto-login
      hint.textContent = "Please ask an administrator to log in to Claude Code.";
      div.appendChild(hint);

      var continueBtn2 = document.createElement("button");
      continueBtn2.className = "auth-required-btn";
      continueBtn2.textContent = "Continue";
      continueBtn2.style.marginTop = "8px";
      continueBtn2.addEventListener("click", resumeAfterLogin);
      div.appendChild(continueBtn2);

      addToMessages(div);
      scrollToBottom();

      inputEl.disabled = true;
      inputEl.placeholder = "Login required. Click Continue after logging in.";
      sendBtn.disabled = true;
    }
  }

  // --- Rate Limit ---


  // --- Rate Limit / Scheduled Messages / Fast Mode (delegated to app-rate-limit.js) ---
  function handleRateLimitEvent(msg) { _rlHandleRateLimitEvent(msg); }
  function updateRateLimitUsage(msg) { _rlUpdateRateLimitUsage(msg); }
  function addScheduledMessageBubble(text, resetsAt) { _rlAddScheduledMessageBubble(text, resetsAt); }
  function removeScheduledMessageBubble() { _rlRemoveScheduledMessageBubble(); }
  function handleFastModeState(state) { _rlHandleFastModeState(state); }

  // --- Prompt suggestion chips ---
  function showSuggestionChips(suggestion) {
    if (!suggestion || processing) return;
    suggestionChipsEl.innerHTML = "";
    var chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.innerHTML = iconHtml("sparkles") +
      '<span class="suggestion-chip-text">' + escapeHtml(suggestion) + '</span>';
    chip.addEventListener("click", function () {
      inputEl.value = suggestion;
      hideSuggestionChips();
      sendMessage();
    });
    suggestionChipsEl.appendChild(chip);
    suggestionChipsEl.classList.remove("hidden");
    refreshIcons();
    // Add bottom padding to messages so chips don't cover the last message
    requestAnimationFrame(function () {
      var chipHeight = suggestionChipsEl.offsetHeight || 0;
      if (chipHeight > 0) {
        messagesEl.style.paddingBottom = chipHeight + "px";
        scrollToBottom();
      }
    });
  }

  function hideSuggestionChips() {
    suggestionChipsEl.innerHTML = "";
    suggestionChipsEl.classList.add("hidden");
    messagesEl.style.paddingBottom = "";
  }

  function resetClientState() {
    if (isSearchOpen()) closeSearch();
    messagesEl.innerHTML = "";
    currentMsgEl = null;
    currentFullText = "";
    resetToolState();
    clearPendingImages();
    activityEl = null;
    processing = false;
    turnCounter = 0;
    messageUuidMap = [];
    historyFrom = 0;
    historyTotal = 0;
    prependAnchor = null;
    loadingMore = false;
    isUserScrolledUp = false;
    newMsgBtn.classList.add("hidden");
    setRewindMode(false);
    setActivity(null);
    setStatus("connected");
    if (!loopActive) enableMainInput();
    resetUsage();
    resetTurnMetaCost();
    resetContext();
    // Clear header indicators
    resetRateLimitState();
    if (headerContextEl) { headerContextEl.remove(); headerContextEl = null; }
    hideSuggestionChips();
    closeSessionInfoPopover();
    stopUrgentBlink();
    // Clear debate UI and state from previous session
    debateStickyState = null;
    resetDebateState();
    var debateBadges = document.querySelectorAll(".debate-header-badge");
    for (var dbi = 0; dbi < debateBadges.length; dbi++) debateBadges[dbi].remove();
    removeDebateBottomBar();
    var handBar = document.getElementById("debate-hand-raise-bar");
    if (handBar) handBar.remove();
    var debateSticky = document.getElementById("debate-sticky");
    if (debateSticky) { debateSticky.classList.add("hidden"); debateSticky.innerHTML = ""; }
    var debateFloat = document.getElementById("debate-info-float");
    if (debateFloat) { debateFloat.classList.add("hidden"); debateFloat.innerHTML = ""; }
  }

  // --- Project switching (no full reload) ---
  function switchProject(slug) {
    if (!slug) return;
    var wasDm = dmMode;
    var wasMate = dmMode && dmTargetUser && dmTargetUser.isMate;
    if (dmMode) exitDmMode(/* skipProjectSwitch */ wasMate);
    if (isHomeHubVisible()) {
      hideHomeHub();
      if (slug === currentSlug) return;
    }
    if (slug === currentSlug) {
      // Returning from DM mode to the same project: re-switch to restore session
      if (wasDm && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "switch_session", id: activeSessionId }));
      }
      return;
    }
    resetFileBrowser();
    closeArchive();
    hideMemory();
    if (isSchedulerOpen()) closeScheduler();
    resetScheduler(slug);
    currentSlug = slug;
    basePath = "/p/" + slug + "/";
    wsPath = "/p/" + slug + "/ws";
    if (document.documentElement.classList.contains("pwa-standalone")) {
      history.replaceState(null, "", basePath);
    } else {
      history.pushState(null, "", basePath);
    }
    resetClientState();
    connect();
  }

  window.addEventListener("popstate", function () {
    var m = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
    var newSlug = m ? m[1] : null;
    if (newSlug && newSlug !== currentSlug) {
      resetFileBrowser();
      closeArchive();
      if (isSchedulerOpen()) closeScheduler();
      resetScheduler(newSlug);
      currentSlug = newSlug;
      basePath = "/p/" + newSlug + "/";
      wsPath = "/p/" + newSlug + "/ws";
      resetClientState();
      connect();
    }
  });

  // --- WebSocket (delegated to app-connection.js) ---
  function connect() { _connConnect(); }
  function scheduleReconnect() { _connScheduleReconnect(); }

  function showUpdateAvailable(msg) {
      var updatePillWrap = $("update-pill-wrap");
      var updateVersion = $("update-version");
      if (updatePillWrap && updateVersion && msg.version) {
        updateVersion.textContent = "v" + msg.version;
        updatePillWrap.classList.remove("hidden");
        var updPill = $("update-pill");
        var updResetBtn = $("update-now");
        if (isHeadlessMode) {
          // In headless mode, hide auto-update button and show manual guide only
          if (updPill) updPill.innerHTML = '<i data-lucide="arrow-up-circle"></i> <span id="update-version">v' + msg.version + '</span> available. Update manually';
          if (updResetBtn) updResetBtn.style.display = "none";
        } else {
          // Reset button state (may be stuck on "Updating..." after restart)
          if (updResetBtn) {
            updResetBtn.innerHTML = '<i data-lucide="download"></i> Update now';
            updResetBtn.disabled = false;
            updResetBtn.style.display = "";
          }
        }
        // Update manual command based on version (beta vs stable)
        var updManualCmd = $("update-manual-cmd");
        if (updManualCmd) {
          var updTag = msg.version.indexOf("-beta") !== -1 ? "beta" : "latest";
          updManualCmd.textContent = "npx clay-server@" + updTag;
        }
        refreshIcons();
      }
      // Update the settings check-for-updates button
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

  function processMessage(msg) { _msgProcessMessage(msg); }

  // processMessage body moved to modules/app-messages.js (PR-23)


  // --- Progressive history loading ---
  function updateHistorySentinel() {
    var existing = messagesEl.querySelector(".history-sentinel");
    if (historyFrom > 0) {
      if (!existing) {
        var sentinel = document.createElement("div");
        sentinel.className = "history-sentinel";
        sentinel.innerHTML = '<button class="load-more-btn">Load earlier messages</button>';
        sentinel.querySelector(".load-more-btn").addEventListener("click", function () {
          requestMoreHistory();
        });
        messagesEl.insertBefore(sentinel, messagesEl.firstChild);

        // Auto-load when sentinel scrolls into view
        if (historySentinelObserver) historySentinelObserver.disconnect();
        historySentinelObserver = new IntersectionObserver(function (entries) {
          if (entries[0].isIntersecting && !loadingMore && historyFrom > 0) {
            requestMoreHistory();
          }
        }, { root: messagesEl, rootMargin: "200px 0px 0px 0px" });
        historySentinelObserver.observe(sentinel);
      }
    } else {
      if (existing) existing.remove();
      if (historySentinelObserver) { historySentinelObserver.disconnect(); historySentinelObserver = null; }
    }
  }

  function requestMoreHistory() {
    if (loadingMore || historyFrom <= 0 || !ws || !connected) return;
    loadingMore = true;
    var btn = messagesEl.querySelector(".load-more-btn");
    if (btn) btn.classList.add("loading");
    ws.send(JSON.stringify({ type: "load_more_history", before: historyFrom }));
  }

  function prependOlderHistory(items, meta) {
    // Save current rendering state
    var savedMsgEl = currentMsgEl;
    var savedActivity = activityEl;
    var savedFullText = currentFullText;
    var savedTurnCounter = turnCounter;
    var savedToolsState = saveToolState();
    // Save context & usage so old result messages don't overwrite current values
    var savedContext = JSON.parse(JSON.stringify(contextData));
    var savedUsage = JSON.parse(JSON.stringify(sessionUsage));

    // Reset to initial values for clean rendering
    currentMsgEl = null;
    activityEl = null;
    currentFullText = "";
    turnCounter = 0;
    resetToolState();

    // Set prepend anchor to insert before existing content
    // Skip the sentinel itself when setting anchor
    var firstReal = messagesEl.querySelector(".history-sentinel");
    prependAnchor = firstReal ? firstReal.nextSibling : messagesEl.firstChild;

    // Remember the first existing content element and its position
    var anchorEl = prependAnchor;
    var anchorOffset = anchorEl ? anchorEl.getBoundingClientRect().top : 0;

    // Process each item through the rendering pipeline
    for (var i = 0; i < items.length; i++) {
      processMessage(items[i]);
    }

    // Finalize any open assistant block from the batch
    finalizeAssistantBlock();

    // Clear prepend mode
    prependAnchor = null;

    // Restore saved state
    currentMsgEl = savedMsgEl;
    activityEl = savedActivity;
    currentFullText = savedFullText;
    turnCounter = savedTurnCounter;
    restoreToolState(savedToolsState);
    // Restore context & usage (old result messages must not overwrite current values)
    contextData = savedContext;
    sessionUsage = savedUsage;
    updateContextPanel();
    updateUsagePanel();

    // Fix scroll: restore anchor element to same visual position
    if (anchorEl) {
      var newTop = anchorEl.getBoundingClientRect().top;
      messagesEl.scrollTop += (newTop - anchorOffset);
    }

    // Update state
    historyFrom = meta.from;
    loadingMore = false;

    // Renumber data-turn attributes in DOM order
    var turnEls = messagesEl.querySelectorAll("[data-turn]");
    for (var t = 0; t < turnEls.length; t++) {
      turnEls[t].dataset.turn = t + 1;
    }
    turnCounter = turnEls.length;

    // Update sentinel
    if (meta.hasMore) {
      var btn = messagesEl.querySelector(".load-more-btn");
      if (btn) btn.classList.remove("loading");
    } else {
      updateHistorySentinel();
    }

    // Notify in-session search that history was prepended (for pending scroll targets)
    onSessionSearchHistoryPrepended();
  }

  // --- Input module (sendMessage, autoResize, paste/image, slash menu, input handlers) ---
  initInput({
    get ws() { return ws; },
    get connected() { return connected; },
    get processing() { return processing; },
    get basePath() { return basePath; },
    inputEl: inputEl,
    sendBtn: sendBtn,
    slashMenu: slashMenu,
    messagesEl: messagesEl,
    imagePreviewBar: imagePreviewBar,
    slashCommands: function() { return slashCommands; },
    messageUuidMap: function() { return messageUuidMap; },
    addUserMessage: addUserMessage,
    addSystemMessage: addSystemMessage,
    toggleUsagePanel: toggleUsagePanel,
    toggleStatusPanel: toggleStatusPanel,
    toggleContextPanel: toggleContextPanel,
    resetContextData: resetContextData,
    showImageModal: showImageModal,
    hideSuggestionChips: hideSuggestionChips,
    setSendBtnMode: setSendBtnMode,
    isDmMode: function () { return dmMode && !(dmTargetUser && dmTargetUser.isMate); },
    getDmKey: function () { return dmKey; },
    handleDmSend: function () { handleDmSend(); },
    isDebateEndedMode: function () { return debateEndedMode; },
    handleDebateEndedSend: function () { handleDebateEndedSend(); },
    isDebateConcludeMode: function () { return debateConcludeMode; },
    handleDebateConcludeSend: function () { handleDebateConcludeSend(); },
    isDebateFloorMode: function () { return debateFloorMode; },
    handleDebateFloorSend: function () { handleDebateFloorSend(); },
    isMateDm: function () { return dmMode && dmTargetUser && dmTargetUser.isMate; },
    getMateName: function () { return dmTargetUser ? (dmTargetUser.displayName || "Mate") : "Mate"; },
    getMateAvatarUrl: function () { return document.body.dataset.mateAvatarUrl || ""; },
    showMatePreThinking: function () { showMatePreThinking(); },
    showClaudePreThinking: function () { showClaudePreThinking(); },
  });

  // --- @Mention module ---
  initMention({
    get ws() { return ws; },
    get connected() { return connected; },
    inputEl: inputEl,
    messagesEl: messagesEl,
    matesList: function () { return cachedMatesList || []; },
    availableBuiltins: function () { return cachedAvailableBuiltins || []; },
    scrollToBottom: scrollToBottom,
    addUserMessage: addUserMessage,
    addCopyHandler: addCopyHandler,
    addToMessages: addToMessages,
    showImageModal: showImageModal,
    showPasteModal: showPasteModal,
  });

  // --- Debate module ---
  initDebate({
    get ws() { return ws; },
    sendWs: function (obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    messagesEl: messagesEl,
    addToMessages: function (el) { addToMessages(el); },
    scrollToBottom: scrollToBottom,
    addCopyHandler: addCopyHandler,
    matesList: function () { return cachedMatesList || []; },
    availableBuiltins: function () { return cachedAvailableBuiltins || []; },
    currentMateId: function () { return (dmTargetUser && dmTargetUser.isMate) ? dmTargetUser.id : null; },
    requireSkills: requireSkills,
    showDebateEndedMode: function (msg) { showDebateEndedMode(msg); },
  });

  // --- STT module (voice input via Web Speech API) ---
  initSTT({
    inputEl: inputEl,
    addSystemMessage: addSystemMessage,
    scrollToBottom: scrollToBottom,
  });

  // --- User profile (Discord-style popover on user island) ---
  initProfile({
    basePath: basePath,
  });

  // --- User settings (full-screen overlay) ---
  initUserSettings({
    basePath: basePath,
  });

  // --- Force PIN change overlay (for admin-created accounts with temp PIN) ---
  function showForceChangePinOverlay() {
    var ov = document.createElement("div");
    ov.id = "force-change-pin-overlay";
    ov.style.cssText = "position:fixed;inset:0;background:var(--bg,#0e0e10);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column";
    ov.innerHTML = '<div style="width:100%;max-width:380px;padding:24px;text-align:center">' +
      '<h2 style="margin:0 0 8px;color:var(--text,#fff);font-size:22px">Set your new PIN</h2>' +
      '<p style="margin:0 0 24px;color:var(--text-secondary,#aaa);font-size:14px">Your temporary PIN has expired. Please set a new 6-digit PIN to continue.</p>' +
      '<div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px" id="fcp-boxes">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-alt,#f5f5f5);color:var(--text,#fff);outline:none">' +
      '</div>' +
      '<button id="fcp-save" disabled style="width:100%;padding:12px;border:none;border-radius:10px;background:var(--accent,#7c3aed);color:#fff;font-size:15px;font-weight:600;cursor:pointer;opacity:0.5">Save PIN</button>' +
      '<div id="fcp-err" style="margin-top:12px;color:#ef4444;font-size:13px"></div>' +
      '</div>';
    document.body.appendChild(ov);

    var boxes = ov.querySelectorAll(".fcp-digit");
    var saveBtn = ov.querySelector("#fcp-save");
    var errEl = ov.querySelector("#fcp-err");
    var pinValues = ["", "", "", "", "", ""];

    function setDigit(idx, v) {
      pinValues[idx] = v;
      boxes[idx].value = v ? "\u2022" : "";
      boxes[idx].classList.toggle("filled", v.length > 0);
    }

    function getPin() {
      return pinValues.join("");
    }

    function updateBtn() {
      var ready = getPin().length === 6;
      saveBtn.disabled = !ready;
      saveBtn.style.opacity = ready ? "1" : "0.5";
    }

    for (var i = 0; i < boxes.length; i++) {
      (function (idx) {
        boxes[idx].addEventListener("input", function () {
          var raw = this.value.replace(/[^0-9]/g, "");
          if (!raw) { setDigit(idx, ""); updateBtn(); return; }
          var v = raw.charAt(raw.length - 1);
          setDigit(idx, v);
          if (v && idx < 5) boxes[idx + 1].focus();
          updateBtn();
        });
        boxes[idx].addEventListener("keydown", function (e) {
          if (e.key === "Backspace") {
            if (!pinValues[idx] && idx > 0) {
              setDigit(idx - 1, "");
              boxes[idx - 1].focus();
            } else {
              setDigit(idx, "");
            }
            updateBtn();
          }
          if (e.key === "ArrowLeft" && idx > 0) boxes[idx - 1].focus();
          if (e.key === "ArrowRight" && idx < 5) boxes[idx + 1].focus();
          if (e.key === "Enter" && !saveBtn.disabled) doSave();
          e.stopPropagation();
        });
        boxes[idx].addEventListener("keyup", function (e) { e.stopPropagation(); });
        boxes[idx].addEventListener("keypress", function (e) { e.stopPropagation(); });
        boxes[idx].addEventListener("paste", function (e) {
          e.preventDefault();
          var text = (e.clipboardData || window.clipboardData).getData("text").replace(/[^0-9]/g, "").substring(0, 6);
          for (var j = 0; j < text.length && (idx + j) < 6; j++) {
            setDigit(idx + j, text.charAt(j));
          }
          if (text.length > 0) {
            var focusIdx = Math.min(idx + text.length, 5);
            boxes[focusIdx].focus();
          }
          updateBtn();
        });
        boxes[idx].addEventListener("focus", function () { this.select(); });
      })(i);
    }
    boxes[0].focus();

    function doSave() {
      var pin = getPin();
      if (pin.length !== 6) return;
      saveBtn.disabled = true;
      saveBtn.style.opacity = "0.5";
      errEl.textContent = "";
      fetch("/api/user/pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPin: pin }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) {
          ov.remove();
          return;
        }
        errEl.textContent = d.error || "Failed to save PIN";
        saveBtn.disabled = false;
        saveBtn.style.opacity = "1";
      }).catch(function () {
        errEl.textContent = "Connection error";
        saveBtn.disabled = false;
        saveBtn.style.opacity = "1";
      });
    }
    saveBtn.addEventListener("click", doSave);
  }

  // --- Admin (multi-user mode) ---
  var isMultiUserMode = false;
  var isHeadlessMode = false;
  var myUserId = null;
  initAdmin({
    get projectList() { return cachedProjects; },
  });
  var myPermissions = null; // null = single-user, all allowed
  fetch("/api/me").then(function (r) { return r.json(); }).then(function (d) {
    if (d.multiUser) isMultiUserMode = true;
    if (d.user && d.user.id) myUserId = d.user.id;
    if (d.permissions) myPermissions = d.permissions;
    if (d.mustChangePin) showForceChangePinOverlay();
    // Single-user mode: clear user strip skeletons immediately (no presence message will arrive)
    if (!isMultiUserMode) {
      var usersContainer = document.getElementById("icon-strip-users");
      if (usersContainer) {
        usersContainer.innerHTML = "";
        usersContainer.classList.add("hidden");
      }
    }
    initCursorToggle();
    // Apply RBAC UI gating
    if (myPermissions) {
      if (!myPermissions.terminal) {
        var termBtn = document.getElementById("terminal-toggle-btn");
        if (termBtn) termBtn.style.display = "none";
        var termSideBtn = document.getElementById("terminal-sidebar-btn");
        if (termSideBtn) termSideBtn.style.display = "none";
      }
      if (!myPermissions.fileBrowser) {
        var fbBtn = document.getElementById("file-browser-btn");
        if (fbBtn) fbBtn.style.display = "none";
      }
      if (!myPermissions.skills) {
        var sBtn = document.getElementById("skills-btn");
        if (sBtn) sBtn.style.display = "none";
        var msBtn = document.getElementById("mate-skills-btn");
        if (msBtn) msBtn.style.display = "none";
      }
      if (!myPermissions.scheduledTasks) {
        var schBtn = document.getElementById("scheduler-btn");
        if (schBtn) schBtn.style.display = "none";
        var mateSchBtn = document.getElementById("mate-scheduler-btn");
        if (mateSchBtn) mateSchBtn.style.display = "none";
      }
      if (!myPermissions.createProject) {
        var addProjBtn = document.getElementById("icon-strip-add");
        if (addProjBtn) addProjBtn.style.display = "none";
      }
    }
  }).catch(function () {});
  // Hide server settings and update controls for non-admin users in multi-user mode
  checkAdminAccess().then(function (isAdmin) {
    if (isMultiUserMode && !isAdmin) {
      var settingsBtn = document.getElementById("server-settings-btn");
      if (settingsBtn) settingsBtn.style.display = "none";
      var updatePill = document.getElementById("update-pill-wrap");
      if (updatePill) updatePill.style.display = "none";
    }
  });

  // --- Notifications module (viewport, banners, notifications, debug, service worker) ---
  initNotifications({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    messagesEl: messagesEl,
    sessionListEl: sessionListEl,
    scrollToBottom: scrollToBottom,
    basePath: basePath,
    toggleUsagePanel: toggleUsagePanel,
    toggleStatusPanel: toggleStatusPanel,
  });

  // --- Server Settings ---
  initServerSettings({
    get ws() { return ws; },
    get projectName() { return projectName; },
    get currentSlug() { return currentSlug; },
    wsPath: wsPath,
    get currentModels() { return currentModels; },
    set currentModels(v) { currentModels = v; updateConfigChip(); },
    get currentModel() { return currentModel; },
    get currentMode() { return currentMode; },
    get currentEffort() { return currentEffort; },
    get currentBetas() { return currentBetas; },
    get currentThinking() { return currentThinking; },
    get currentThinkingBudget() { return currentThinkingBudget; },
    setContextView: setContextView,
    applyContextView: applyContextView,
  });

  // --- Project Settings ---
  initProjectSettings({
    get ws() { return ws; },
    get connected() { return connected; },
    get currentModels() { return currentModels; },
    get currentModel() { return currentModel; },
    get currentMode() { return currentMode; },
    get currentEffort() { return currentEffort; },
    get currentBetas() { return currentBetas; },
    get currentThinking() { return currentThinking; },
    get currentThinkingBudget() { return currentThinkingBudget; },
  }, getEmojiCategories());

  // --- QR code ---
  initQrCode();
  var sharePill = document.getElementById("share-pill");
  if (sharePill) sharePill.addEventListener("click", triggerShare);

  // --- File browser ---
  initFileBrowser({
    get ws() { return ws; },
    get connected() { return connected; },
    get activeSessionId() { return activeSessionId; },
    messagesEl: messagesEl,
    fileTreeEl: $("file-tree"),
    fileViewerEl: $("file-viewer"),
  });

  // --- Terminal ---
  initTerminal({
    get ws() { return ws; },
    get connected() { return connected; },
    terminalContainerEl: $("terminal-container"),
    terminalBodyEl: $("terminal-body"),
    fileViewerEl: $("file-viewer"),
  });

  // --- Context Sources ---
  initContextSources({
    get ws() { return ws; },
    get connected() { return connected; },
  });

  // --- Chrome Extension Bridge ---
  var _extRequestCallbacks = {}; // requestId -> callback function

  function sendExtensionCommand(command, args, requestId) {
    window.postMessage({
      source: "clay-page",
      payload: {
        type: "clay_ext_command",
        command: command,
        args: args,
        requestId: requestId
      }
    }, "*");
  }

  function handleExtensionResult(requestId, result) {
    // Check local callback first (for server-initiated requests)
    var cb = _extRequestCallbacks[requestId];
    if (cb) {
      delete _extRequestCallbacks[requestId];
      cb(result);
      return;
    }
    // Forward to server
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: "extension_result",
        requestId: requestId,
        result: result
      }));
    }
  }

  window.addEventListener("message", function(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "clay-chrome-extension") return;
    var msg = event.data.payload;

    if (msg.type === "clay_ext_tab_list") {
      updateBrowserTabList(msg.tabs);
      // Also inform server about tab list
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "browser_tab_list",
          tabs: msg.tabs
        }));
      }
    }
    if (msg.type === "clay_ext_result") {
      handleExtensionResult(msg.requestId, msg.result);
    }
  });

  // --- Playbook Engine ---
  initPlaybook();

  // Auto-open playbook from URL param (e.g. ?playbook=push-notifications)
  (function () {
    var params = new URLSearchParams(window.location.search);
    var pbId = params.get("playbook");
    if (pbId) {
      // Small delay to ensure DOM and playbook registry are ready
      setTimeout(function () { openPlaybook(pbId); }, 300);
      // Clean up URL
      params.delete("playbook");
      var clean = params.toString();
      var newUrl = window.location.pathname + (clean ? "?" + clean : "") + window.location.hash;
      window.history.replaceState(null, "", newUrl);
    }
  })();

  // --- In-session search (Cmd+F / Ctrl+F) ---
  initSessionSearch({
    messagesEl: messagesEl,
    get ws() { return ws; },
    getHistoryFrom: function () { return historyFrom; },
  });
  var findInSessionBtn = $("find-in-session-btn");
  if (findInSessionBtn) {
    findInSessionBtn.addEventListener("click", function () {
      toggleSearch();
    });
  }

  // --- Sticky Notes ---
  initStickyNotes({
    get ws() { return ws; },
    get connected() { return connected; },
  });

  // --- Sticky Notes sidebar button (archive view) ---
  var stickyNotesSidebarBtn = $("sticky-notes-sidebar-btn");
  if (stickyNotesSidebarBtn) {
    stickyNotesSidebarBtn.addEventListener("click", function () {
      if (isSchedulerOpen()) closeScheduler();
      if (isArchiveOpen()) {
        closeArchive();
      } else {
        openArchive();
      }
    });
  }

  // Close archive / scheduler panel when switching to other sidebar panels
  var fileBrowserBtn = $("file-browser-btn");
  var terminalSidebarBtn = $("terminal-sidebar-btn");
  if (fileBrowserBtn) fileBrowserBtn.addEventListener("click", function () { if (isArchiveOpen()) closeArchive(); if (isSchedulerOpen()) closeScheduler(); });
  if (terminalSidebarBtn) terminalSidebarBtn.addEventListener("click", function () { if (isArchiveOpen()) closeArchive(); if (isSchedulerOpen()) closeScheduler(); });

  // --- Ralph Loop UI ---
  function updateLoopInputVisibility(loop) {
    var inputArea = document.getElementById("input-area");
    if (!inputArea) return;
    if (loop && loop.active && loop.role !== "crafting") {
      inputArea.style.display = "none";
    } else {
      inputArea.style.display = "";
    }
  }

  function updateLoopButton() {
    var section = document.getElementById("ralph-loop-section");
    if (!section) return;

    var busy = loopActive || ralphPhase === "executing";
    var phase = busy ? "executing" : ralphPhase;

    var statusHtml = "";
    var statusClass = "";
    var clickAction = "wizard"; // default

    if (phase === "crafting") {
      statusHtml = '<span class="ralph-section-status crafting">' + iconHtml("loader", "icon-spin") + ' Crafting\u2026</span>';
      clickAction = "none";
    } else if (phase === "approval") {
      statusHtml = '<span class="ralph-section-status ready">Ready</span>';
      statusClass = "ralph-section-ready";
      clickAction = "none";
    } else if (phase === "executing") {
      var iterText = loopIteration > 0 ? "Running \u00b7 iteration " + loopIteration + "/" + loopMaxIterations : "Starting\u2026";
      statusHtml = '<span class="ralph-section-status running">' + iconHtml("loader", "icon-spin") + ' ' + iterText + '</span>';
      statusClass = "ralph-section-running";
      clickAction = "popover";
    } else if (phase === "done") {
      statusHtml = '<span class="ralph-section-status done">\u2713 Done</span>';
      statusHtml += '<a href="#" class="ralph-section-tasks-link">View in Scheduled Tasks</a>';
      statusClass = "ralph-section-done";
      clickAction = "wizard";
    } else {
      // idle
      statusHtml = '<span class="ralph-section-hint">Start a new loop</span>';
    }

    section.className = "ralph-loop-section" + (statusClass ? " " + statusClass : "");
    section.innerHTML =
      '<div class="ralph-section-inner">' +
        '<div class="ralph-section-header">' +
          '<span class="ralph-section-icon">' + iconHtml("repeat") + '</span>' +
          '<span class="ralph-section-label">Ralph Loop</span>' +
          '<span class="loop-experimental"><i data-lucide="flask-conical"></i> experimental</span>' +
        '</div>' +
        '<div class="ralph-section-body">' + statusHtml + '</div>' +
      '</div>';

    refreshIcons();

    // Click handler on header
    var header = section.querySelector(".ralph-section-header");
    if (header) {
      header.style.cursor = clickAction === "none" ? "default" : "pointer";
      header.addEventListener("click", function() {
        if (clickAction === "popover") {
          toggleLoopPopover();
        } else if (clickAction === "wizard") {
          openRalphWizard();
        }
      });
    }

    // "View in Scheduled Tasks" link
    var tasksLink = section.querySelector(".ralph-section-tasks-link");
    if (tasksLink) {
      tasksLink.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        openSchedulerToTab("library");
      });
    }
  }

  function toggleLoopPopover() {
    var existing = document.getElementById("loop-status-modal");
    if (existing) {
      existing.remove();
      return;
    }

    var taskPreview = wizardData.task || "—";
    if (taskPreview.length > 120) taskPreview = taskPreview.substring(0, 120) + "\u2026";
    var statusText = "Iteration #" + loopIteration + " / " + loopMaxIterations;

    var modal = document.createElement("div");
    modal.id = "loop-status-modal";
    modal.className = "loop-status-modal";
    modal.innerHTML =
      '<div class="loop-status-backdrop"></div>' +
      '<div class="loop-status-dialog">' +
        '<div class="loop-status-dialog-header">' +
          '<span class="loop-status-dialog-icon">' + iconHtml("repeat") + '</span>' +
          '<span class="loop-status-dialog-title">Ralph Loop</span>' +
          '<button class="loop-status-dialog-close" title="Close">' + iconHtml("x") + '</button>' +
        '</div>' +
        '<div class="loop-status-dialog-body">' +
          '<div class="loop-status-dialog-row">' +
            '<span class="loop-status-dialog-label">Progress</span>' +
            '<span class="loop-status-dialog-value">' + escapeHtml(statusText) + '</span>' +
          '</div>' +
          '<div class="loop-status-dialog-row">' +
            '<span class="loop-status-dialog-label">Task</span>' +
            '<span class="loop-status-dialog-value loop-status-dialog-task">' + escapeHtml(taskPreview) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="loop-status-dialog-footer">' +
          '<button class="loop-status-dialog-stop">' + iconHtml("square") + ' Stop loop</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    refreshIcons();

    function closeModal() { modal.remove(); }

    modal.querySelector(".loop-status-backdrop").addEventListener("click", closeModal);
    modal.querySelector(".loop-status-dialog-close").addEventListener("click", closeModal);

    modal.querySelector(".loop-status-dialog-stop").addEventListener("click", function(e) {
      e.stopPropagation();
      closeModal();
      showConfirm("Stop the running " + (loopBannerName || "loop") + "?", function() {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "loop_stop" }));
        }
      });
    });
  }

  function showLoopBanner(show) {
    var stickyEl = document.getElementById("ralph-sticky");
    if (!stickyEl) { updateLoopButton(); return; }
    if (!show) {
      stickyEl.classList.add("hidden");
      stickyEl.classList.remove("ralph-running");
      stickyEl.innerHTML = "";
      updateLoopButton();
      return;
    }

    var bannerLabel = loopBannerName || "Loop";
    stickyEl.innerHTML =
      '<div class="ralph-sticky-inner">' +
        '<div class="ralph-sticky-header">' +
          '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
          '<span class="ralph-sticky-label">' + escapeHtml(bannerLabel) + '</span>' +
          '<span class="ralph-sticky-status" id="loop-status">Starting\u2026</span>' +
          '<button class="ralph-sticky-action ralph-sticky-stop" title="Stop loop">' + iconHtml("square") + '</button>' +
        '</div>' +
      '</div>';
    stickyEl.classList.remove("hidden", "ralph-ready");
    stickyEl.classList.add("ralph-running");
    refreshIcons();

    stickyEl.querySelector(".ralph-sticky-stop").addEventListener("click", function(e) {
      e.stopPropagation();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "loop_stop" }));
      }
    });
    updateLoopButton();
  }

  function updateLoopBanner(iteration, maxIterations, phase) {
    var statusEl = document.getElementById("loop-status");
    if (!statusEl) return;
    var text;
    if (phase === "stopping") {
      text = "Stopping\u2026";
    } else if (maxIterations <= 1) {
      text = phase === "judging" ? "judging\u2026" : "running";
    } else {
      text = "#" + iteration + "/" + maxIterations;
      if (phase === "judging") text += " judging\u2026";
      else text += " running";
    }
    statusEl.textContent = text;
  }

  function updateRalphBars() {
    // Task source uses the scheduler panel, not the sticky bar
    var isTaskSource = ralphCraftingSource !== "ralph";
    var onCraftingSession = ralphCraftingSessionId && activeSessionId === ralphCraftingSessionId;
    // If approval phase but no craftingSessionId (recovered after server restart), show bar anyway
    var recoveredApproval = ralphPhase === "approval" && !ralphCraftingSessionId;
    if (!isTaskSource && ralphPhase === "crafting" && onCraftingSession) {
      showRalphCraftingBar(true);
    } else {
      showRalphCraftingBar(false);
    }
    if (!isTaskSource && ralphPhase === "approval" && (onCraftingSession || recoveredApproval)) {
      showRalphApprovalBar(true);
    } else {
      showRalphApprovalBar(false);
    }
    // Restore running loop banner on session switch
    if (loopActive && ralphPhase === "executing") {
      showLoopBanner(true);
      if (loopIteration > 0) {
        updateLoopBanner(loopIteration, loopMaxIterations, "running");
      }
    }

    // Restore debate sticky on session switch
    if (debateStickyState && debateStickyState.phase) {
      showDebateSticky(debateStickyState.phase, debateStickyState.msg);
    } else {
      showDebateSticky("hide", null);
    }
  }

  // --- Skill install dialog (generic) ---
  var skillInstallModal = document.getElementById("skill-install-modal");
  var skillInstallTitle = document.getElementById("skill-install-title");
  var skillInstallReason = document.getElementById("skill-install-reason");
  var skillInstallList = document.getElementById("skill-install-list");
  var skillInstallOk = document.getElementById("skill-install-ok");
  var skillInstallCancel = document.getElementById("skill-install-cancel");
  var skillInstallStatus = document.getElementById("skill-install-status");

  var pendingSkillInstalls = []; // [{ name, url, scope, installed }]
  var skillInstallCallback = null;
  var skillInstalling = false;
  var knownInstalledSkills = {}; // client-side cache of installed skills

  function renderSkillInstallDialog(opts, missing) {
    var hasOutdated = false;
    var hasMissing = false;
    for (var c = 0; c < missing.length; c++) {
      if (missing[c].status === "outdated") hasOutdated = true;
      else hasMissing = true;
    }
    var defaultTitle = hasMissing ? "Skill Installation Required" : "Skill Update Available";
    var defaultReason = hasMissing
      ? "This feature requires the following skill(s) to be installed."
      : "Newer versions of the following skill(s) are available.";
    if (hasMissing && hasOutdated) {
      defaultTitle = "Skill Installation / Update Required";
      defaultReason = "Some skills need to be installed or updated.";
    }
    skillInstallTitle.textContent = opts.title || defaultTitle;
    skillInstallReason.textContent = opts.reason || defaultReason;
    skillInstallList.innerHTML = "";
    for (var i = 0; i < missing.length; i++) {
      var s = missing[i];
      var badge = s.status === "outdated"
        ? '<span class="skill-badge skill-badge-update">Update ' + escapeHtml(s.installedVersion || "") + ' → ' + escapeHtml(s.remoteVersion || "") + '</span>'
        : '<span class="skill-badge skill-badge-new">New</span>';
      var item = document.createElement("div");
      item.className = "skill-install-item";
      item.setAttribute("data-skill", s.name);
      item.innerHTML = '<span class="skill-icon">&#x1f9e9;</span>' +
        '<div class="skill-info">' +
          '<span class="skill-name">' + escapeHtml(s.name) + '</span>' +
          badge +
        '</div>' +
        '<span class="skill-status"></span>';
      skillInstallList.appendChild(item);
    }
    skillInstallStatus.classList.add("hidden");
    skillInstallStatus.innerHTML = "";
    skillInstallOk.disabled = false;
    var btnLabel = hasMissing ? "Install" : "Update";
    if (hasMissing && hasOutdated) btnLabel = "Install / Update";
    skillInstallOk.textContent = btnLabel;
    skillInstallOk.className = "confirm-btn confirm-delete";
    skillInstallModal.classList.remove("hidden");
  }

  function hideSkillInstallModal() {
    skillInstallModal.classList.add("hidden");
    skillInstallCallback = null;
    pendingSkillInstalls = [];
    skillInstalling = false;
    skillInstallDone = false;
  }

  skillInstallCancel.addEventListener("click", hideSkillInstallModal);
  skillInstallModal.querySelector(".confirm-backdrop").addEventListener("click", hideSkillInstallModal);

  var skillInstallDone = false;

  skillInstallOk.addEventListener("click", function () {
    // "Proceed" state — all done, close and invoke callback
    if (skillInstallDone) {
      var proceedCb = skillInstallCallback;
      skillInstallCallback = null;
      hideSkillInstallModal();
      if (proceedCb) proceedCb();
      return;
    }
    if (skillInstalling) return;
    skillInstalling = true;
    skillInstallOk.disabled = true;
    skillInstallOk.textContent = "Installing...";

    var total = 0;
    for (var i = 0; i < pendingSkillInstalls.length; i++) {
      if (!pendingSkillInstalls[i].installed) total++;
    }
    skillInstallStatus.classList.remove("hidden");
    updateSkillInstallProgress(0, total);

    for (var j = 0; j < pendingSkillInstalls.length; j++) {
      var s = pendingSkillInstalls[j];
      if (s.installed) continue;
      fetch(basePath + "api/install-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: s.url, skill: s.name, scope: s.scope || "global" }),
      }).catch(function () {});
    }
  });

  function updateSkillInstallProgress(done, total) {
    var hasUpdates = false;
    for (var u = 0; u < pendingSkillInstalls.length; u++) {
      if (pendingSkillInstalls[u].status === "outdated") { hasUpdates = true; break; }
    }
    var label = hasUpdates ? "Updating" : "Installing";
    skillInstallStatus.innerHTML = '<div class="skills-spinner small"></div> ' + label + ' skills... (' + done + '/' + total + ')';
  }

  function updateSkillListItems() {
    var items = skillInstallList.querySelectorAll(".skill-install-item");
    for (var i = 0; i < items.length; i++) {
      var name = items[i].getAttribute("data-skill");
      for (var j = 0; j < pendingSkillInstalls.length; j++) {
        if (pendingSkillInstalls[j].name === name) {
          var statusEl = items[i].querySelector(".skill-status");
          if (pendingSkillInstalls[j].installed) {
            if (statusEl) {
              statusEl.innerHTML = '<span class="skill-status-ok">' + iconHtml("circle-check") + '</span>';
              refreshIcons();
            }
          }
          break;
        }
      }
    }
  }

  function handleSkillInstallWs(msg) {
    if (!skillInstalling || pendingSkillInstalls.length === 0) return;
    for (var i = 0; i < pendingSkillInstalls.length; i++) {
      if (pendingSkillInstalls[i].name === msg.skill) {
        if (msg.success) {
          pendingSkillInstalls[i].installed = true;
          knownInstalledSkills[msg.skill] = true;
        } else {
          skillInstalling = false;
          skillInstallOk.disabled = false;
          skillInstallOk.textContent = "Install";
          skillInstallStatus.innerHTML = "Failed to install " + escapeHtml(msg.skill) + ". Try again.";
          updateSkillListItems();
          return;
        }
      }
    }

    var doneCount = 0;
    var totalCount = pendingSkillInstalls.length;
    for (var k = 0; k < pendingSkillInstalls.length; k++) {
      if (pendingSkillInstalls[k].installed) doneCount++;
    }
    updateSkillListItems();
    updateSkillInstallProgress(doneCount, totalCount);

    if (doneCount === totalCount) {
      skillInstallDone = true;
      var hasUpdates = false;
      for (var u = 0; u < pendingSkillInstalls.length; u++) {
        if (pendingSkillInstalls[u].status === "outdated") { hasUpdates = true; break; }
      }
      var doneMsg = hasUpdates ? "All skills updated successfully." : "All skills installed successfully.";
      skillInstallStatus.innerHTML = '<span class="skill-status-ok">' + iconHtml("circle-check") + '</span> ' + doneMsg;
      refreshIcons();
      skillInstallOk.disabled = false;
      skillInstallOk.textContent = "Proceed";
      skillInstallOk.className = "confirm-btn confirm-proceed";
    }
  }

  function requireSkills(opts, cb) {
    fetch(basePath + "api/check-skill-updates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skills: opts.skills }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var results = data.results || [];
        var actionable = [];
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          if (r.status === "missing" || r.status === "outdated") {
            // Find the original skill entry for url/scope
            var orig = null;
            for (var j = 0; j < opts.skills.length; j++) {
              if (opts.skills[j].name === r.name) { orig = opts.skills[j]; break; }
            }
            if (!orig) continue;
            actionable.push({
              name: r.name,
              url: orig.url,
              scope: orig.scope || "global",
              installed: false,
              status: r.status,
              installedVersion: r.installedVersion,
              remoteVersion: r.remoteVersion,
            });
          }
        }
        if (actionable.length === 0) { cb(); return; }
        pendingSkillInstalls = actionable;
        skillInstallCallback = cb;
        renderSkillInstallDialog(opts, actionable);
      })
      .catch(function () { cb(); });
  }

  function requireClayRalph(cb) {
    requireSkills({
      title: "Skill Installation Required",
      reason: "This feature requires the following skill to be installed.",
      skills: [{ name: "clay-ralph", url: "https://github.com/chadbyte/clay-ralph", scope: "global" }]
    }, cb);
  }

  function requireClayMateInterview(cb) {
    requireSkills({
      title: "Skill Installation Required",
      reason: "The Mate Interview skill is required to create a new Mate.",
      skills: [{ name: "clay-mate-interview", url: "https://github.com/chadbyte/clay-mate-interview", scope: "global" }]
    }, cb);
  }


  // Debate button in mate sidebar (only visible in DM mode)
  var debateBtn = document.getElementById("mate-debate-btn");
  if (debateBtn) {
    debateBtn.addEventListener("click", function () {
      var contextMessages = dmMessageCache.map(function (m) {
        return { text: m.text, isMate: m.from !== myUserId };
      });
      openDebateModal({ dmContext: contextMessages });
    });
  }

  // --- Ralph Wizard ---

  var wizardMode = "draft"; // "draft" or "own"

  function openRalphWizard(source) {
    requireClayRalph(function () {
      wizardSource = source || "ralph";
      wizardData = { name: "", task: "", maxIterations: 3 };
      var el = document.getElementById("ralph-wizard");
      if (!el) return;

      var taskEl = document.getElementById("ralph-task");
      if (taskEl) taskEl.value = "";
      var promptInput = document.getElementById("ralph-prompt-input");
      if (promptInput) promptInput.value = "";
      var judgeInput = document.getElementById("ralph-judge-input");
      if (judgeInput) judgeInput.value = "";
      var iterEl = document.getElementById("ralph-max-iterations");
      if (iterEl) iterEl.value = "25";

      // Update text based on source
      var isTask = wizardSource === "task";
      var headerSpan = el.querySelector(".ralph-wizard-header > span");
      if (headerSpan) headerSpan.textContent = isTask ? "New Task" : "New Ralph Loop";

      var step2heading = el.querySelector('.ralph-step[data-step="2"] h3');
      if (step2heading) step2heading.textContent = isTask ? "Describe your task" : "What do you want to build?";

      var draftHint = el.querySelector('.ralph-mode-panel[data-mode="draft"] .ralph-hint');
      if (draftHint) draftHint.textContent = isTask
        ? "Describe what you want done. Clay will craft a precise prompt and you can review it before scheduling."
        : "Write a rough idea, Clay will refine it into detailed instructions. You can review and edit everything before the loop starts.";

      var ownHint = el.querySelector('.ralph-mode-panel[data-mode="own"] .ralph-hint');
      if (ownHint) ownHint.textContent = isTask
        ? "Paste the prompt to run. It will execute as-is when triggered."
        : "Paste your PROMPT.md content. JUDGE.md is optional; if omitted, Clay will generate it for you.";

      // Update task description placeholder
      if (taskEl) taskEl.placeholder = isTask
        ? "e.g. Check for dependency updates and create a summary"
        : "e.g. Add dark mode toggle to the settings page";

      wizardMode = "draft";
      updateWizardModeTabs();

      if (wizardSource === "task") {
        // Tasks skip step 1 (Ralph intro), go directly to step 2
        wizardStep = 2;
      } else {
        wizardStep = 1;
      }
      el.classList.remove("hidden");
      var statusEl = document.getElementById("ralph-install-status");
      if (statusEl) { statusEl.classList.add("hidden"); statusEl.innerHTML = ""; }
      updateWizardStep();
    });
  }

  function updateWizardModeTabs() {
    var tabs = document.querySelectorAll(".ralph-mode-tab");
    var panels = document.querySelectorAll(".ralph-mode-panel");
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute("data-mode") === wizardMode) {
        tabs[i].classList.add("active");
      } else {
        tabs[i].classList.remove("active");
      }
    }
    for (var j = 0; j < panels.length; j++) {
      if (panels[j].getAttribute("data-mode") === wizardMode) {
        panels[j].classList.add("active");
      } else {
        panels[j].classList.remove("active");
      }
    }
  }

  function closeRalphWizard() {
    var el = document.getElementById("ralph-wizard");
    if (el) el.classList.add("hidden");
  }

  function updateWizardStep() {
    var steps = document.querySelectorAll(".ralph-step");
    for (var i = 0; i < steps.length; i++) {
      var stepNum = parseInt(steps[i].getAttribute("data-step"), 10);
      if (stepNum === wizardStep) {
        steps[i].classList.add("active");
      } else {
        steps[i].classList.remove("active");
      }
    }
    var dots = document.querySelectorAll(".ralph-dot");
    for (var j = 0; j < dots.length; j++) {
      var dotStep = parseInt(dots[j].getAttribute("data-step"), 10);
      dots[j].classList.remove("active", "done");
      if (dotStep === wizardStep) dots[j].classList.add("active");
      else if (dotStep < wizardStep) dots[j].classList.add("done");
    }

    var backBtn = document.getElementById("ralph-wizard-back");
    var skipBtn = document.getElementById("ralph-wizard-skip");
    var nextBtn = document.getElementById("ralph-wizard-next");
    if (backBtn) {
      backBtn.style.visibility = (wizardStep === 1 && wizardSource !== "task") ? "hidden" : "visible";
      backBtn.textContent = (wizardSource === "task" && wizardStep <= 2) ? "Cancel" : "Back";
    }
    if (skipBtn) skipBtn.style.display = "none";
    if (nextBtn) nextBtn.textContent = wizardStep === 2 ? "Launch" : "Get Started";
  }

  function collectWizardData() {
    var iterEl = document.getElementById("ralph-max-iterations");
    wizardData.name = "";
    wizardData.maxIterations = iterEl ? parseInt(iterEl.value, 10) || 3 : 3;
    wizardData.cron = null;
    wizardData.mode = wizardMode;

    if (wizardMode === "draft") {
      var taskEl = document.getElementById("ralph-task");
      wizardData.task = taskEl ? taskEl.value.trim() : "";
      wizardData.promptText = null;
      wizardData.judgeText = null;
    } else {
      var promptInput = document.getElementById("ralph-prompt-input");
      var judgeInput = document.getElementById("ralph-judge-input");
      wizardData.task = "";
      wizardData.promptText = promptInput ? promptInput.value.trim() : "";
      wizardData.judgeText = judgeInput ? judgeInput.value.trim() : "";
    }
  }

  function buildWizardCron() {
    var repeatEl = document.getElementById("ralph-repeat");
    if (!repeatEl) return null;
    var preset = repeatEl.value;
    if (preset === "none") return null;

    var timeEl = document.getElementById("ralph-time");
    var timeVal = timeEl ? timeEl.value : "09:00";
    var timeParts = timeVal.split(":");
    var hour = parseInt(timeParts[0], 10) || 9;
    var minute = parseInt(timeParts[1], 10) || 0;

    if (preset === "daily") return minute + " " + hour + " * * *";
    if (preset === "weekdays") return minute + " " + hour + " * * 1-5";
    if (preset === "weekly") return minute + " " + hour + " * * " + new Date().getDay();
    if (preset === "monthly") return minute + " " + hour + " " + new Date().getDate() + " * *";

    if (preset === "custom") {
      var unitEl = document.getElementById("ralph-repeat-unit");
      var unit = unitEl ? unitEl.value : "day";
      if (unit === "day") return minute + " " + hour + " * * *";
      if (unit === "month") return minute + " " + hour + " " + new Date().getDate() + " * *";
      // week: collect selected days
      var dowBtns = document.querySelectorAll("#ralph-custom-repeat .sched-dow-btn.active");
      var days = [];
      for (var i = 0; i < dowBtns.length; i++) {
        days.push(dowBtns[i].dataset.dow);
      }
      if (days.length === 0) days.push(String(new Date().getDay()));
      return minute + " " + hour + " * * " + days.join(",");
    }
    return null;
  }

  function cronToHumanText(cron) {
    if (!cron) return "";
    var parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return cron;
    var m = parts[0], h = parts[1], dom = parts[2], dow = parts[4];
    var pad = function(n) { return (parseInt(n,10) < 10 ? "0" : "") + parseInt(n,10); };
    var t = pad(h) + ":" + pad(m);
    var dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    if (dow === "*" && dom === "*") return "Every day at " + t;
    if (dow === "1-5" && dom === "*") return "Weekdays at " + t;
    if (dom !== "*" && dow === "*") return "Monthly on day " + dom + " at " + t;
    if (dow !== "*" && dom === "*") {
      var ds = dow.split(",").map(function(d) { return dayNames[parseInt(d,10)] || d; });
      return "Every " + ds.join(", ") + " at " + t;
    }
    return cron;
  }

  function wizardNext() {
    collectWizardData();

    if (wizardStep === 1) {
      wizardStep++;
      updateWizardStep();
      return;
    }

    if (wizardStep === 2) {
      if (wizardMode === "draft") {
        var taskEl = document.getElementById("ralph-task");
        if (!wizardData.task) {
          if (taskEl) { taskEl.focus(); taskEl.style.borderColor = "#e74c3c"; setTimeout(function() { taskEl.style.borderColor = ""; }, 2000); }
          return;
        }
      } else {
        var promptInput = document.getElementById("ralph-prompt-input");
        if (!wizardData.promptText) {
          if (promptInput) { promptInput.focus(); promptInput.style.borderColor = "#e74c3c"; setTimeout(function() { promptInput.style.borderColor = ""; }, 2000); }
          return;
        }
      }
      wizardSubmit();
      return;
    }
    wizardStep++;
    updateWizardStep();
  }

  function wizardBack() {
    if (wizardSource === "task" && wizardStep <= 2) {
      closeRalphWizard();
      return;
    }
    if (wizardStep > 1) {
      collectWizardData();
      wizardStep--;
      updateWizardStep();
    }
  }

  function wizardSkip() {
    if (wizardStep < 2) {
      wizardStep++;
      updateWizardStep();
    }
  }

  function wizardSubmit() {
    collectWizardData();
    wizardData.source = wizardSource === "task" ? "task" : undefined;
    closeRalphWizard();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ralph_wizard_complete", data: wizardData }));
    }
  }

  // Wizard button listeners
  var wizardCloseBtn = document.getElementById("ralph-wizard-close");
  var wizardBackdrop = document.querySelector(".ralph-wizard-backdrop");
  var wizardBackBtn = document.getElementById("ralph-wizard-back");
  var wizardSkipBtn = document.getElementById("ralph-wizard-skip");
  var wizardNextBtn = document.getElementById("ralph-wizard-next");

  if (wizardCloseBtn) wizardCloseBtn.addEventListener("click", closeRalphWizard);
  if (wizardBackdrop) wizardBackdrop.addEventListener("click", closeRalphWizard);
  if (wizardBackBtn) wizardBackBtn.addEventListener("click", wizardBack);
  if (wizardSkipBtn) wizardSkipBtn.addEventListener("click", wizardSkip);
  if (wizardNextBtn) wizardNextBtn.addEventListener("click", wizardNext);

  // Mode tab switching
  var modeTabs = document.querySelectorAll(".ralph-mode-tab");
  for (var mt = 0; mt < modeTabs.length; mt++) {
    modeTabs[mt].addEventListener("click", function () {
      wizardMode = this.getAttribute("data-mode");
      updateWizardModeTabs();
    });
  }

  // --- Repeat picker handlers ---
  var repeatSelect = document.getElementById("ralph-repeat");
  var repeatTimeRow = document.getElementById("ralph-time-row");
  var repeatCustom = document.getElementById("ralph-custom-repeat");
  var repeatUnitSelect = document.getElementById("ralph-repeat-unit");
  var repeatDowRow = document.getElementById("ralph-custom-dow-row");
  var cronPreview = document.getElementById("ralph-cron-preview");

  function updateRepeatUI() {
    if (!repeatSelect) return;
    var val = repeatSelect.value;
    var isScheduled = val !== "none";
    if (repeatTimeRow) repeatTimeRow.style.display = isScheduled ? "" : "none";
    if (repeatCustom) repeatCustom.style.display = val === "custom" ? "" : "none";
    if (cronPreview) cronPreview.style.display = isScheduled ? "" : "none";
    if (isScheduled) {
      var cron = buildWizardCron();
      var humanEl = document.getElementById("ralph-cron-human");
      var cronEl = document.getElementById("ralph-cron-expr");
      if (humanEl) humanEl.textContent = cronToHumanText(cron);
      if (cronEl) cronEl.textContent = cron || "";
    }
  }

  if (repeatSelect) {
    repeatSelect.addEventListener("change", updateRepeatUI);
  }
  if (repeatUnitSelect) {
    repeatUnitSelect.addEventListener("change", function () {
      if (repeatDowRow) repeatDowRow.style.display = this.value === "week" ? "" : "none";
      updateRepeatUI();
    });
  }

  var timeInput = document.getElementById("ralph-time");
  if (timeInput) timeInput.addEventListener("change", updateRepeatUI);

  // DOW buttons in custom repeat
  var customDowBtns = document.querySelectorAll("#ralph-custom-repeat .sched-dow-btn");
  for (var di = 0; di < customDowBtns.length; di++) {
    customDowBtns[di].addEventListener("click", function () {
      this.classList.toggle("active");
      updateRepeatUI();
    });
  }

  // --- Ralph Sticky (title-bar island) ---
  function showRalphCraftingBar(show) {
    var stickyEl = document.getElementById("ralph-sticky");
    if (!stickyEl) return;
    if (!show) {
      stickyEl.classList.add("hidden");
      stickyEl.innerHTML = "";
      return;
    }
    stickyEl.innerHTML =
      '<div class="ralph-sticky-inner">' +
        '<div class="ralph-sticky-header">' +
          '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
          '<span class="ralph-sticky-label">Ralph</span>' +
          '<span class="ralph-sticky-status">' + iconHtml("loader", "icon-spin") + ' Preparing\u2026</span>' +
          '<button class="ralph-sticky-cancel" title="Cancel">' + iconHtml("x") + '</button>' +
        '</div>' +
      '</div>';
    stickyEl.classList.remove("hidden");
    refreshIcons();

    var cancelBtn = stickyEl.querySelector(".ralph-sticky-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "ralph_cancel_crafting" }));
        }
        showRalphCraftingBar(false);
        showRalphApprovalBar(false);
      });
    }
  }

  // --- Ralph Approval Bar (also uses sticky island) ---
  function showRalphApprovalBar(show) {
    var stickyEl = document.getElementById("ralph-sticky");
    if (!stickyEl) return;
    if (!show) {
      // Only clear if we're in approval mode (don't clobber crafting)
      if (ralphPhase !== "crafting") {
        stickyEl.classList.add("hidden");
        stickyEl.innerHTML = "";
      }
      return;
    }

    stickyEl.innerHTML =
      '<div class="ralph-sticky-inner">' +
        '<div class="ralph-sticky-header" id="ralph-sticky-header">' +
          '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
          '<span class="ralph-sticky-label">Ralph</span>' +
          '<span class="ralph-sticky-status" id="ralph-sticky-status">Ready</span>' +
          '<button class="ralph-sticky-action ralph-sticky-preview" title="Preview files">' + iconHtml("eye") + '</button>' +
          '<button class="ralph-sticky-action ralph-sticky-start" title="' + (wizardData.cron ? 'Schedule' : 'Start loop') + '">' + iconHtml(wizardData.cron ? "calendar-clock" : "play") + '</button>' +
          '<button class="ralph-sticky-action ralph-sticky-dismiss" title="Cancel and discard">' + iconHtml("x") + '</button>' +
        '</div>' +
      '</div>';
    stickyEl.classList.remove("hidden");
    refreshIcons();

    stickyEl.querySelector(".ralph-sticky-preview").addEventListener("click", function(e) {
      e.stopPropagation();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "ralph_preview_files" }));
      }
    });

    stickyEl.querySelector(".ralph-sticky-start").addEventListener("click", function(e) {
      e.stopPropagation();
      // Check for uncommitted changes before starting
      fetch(basePath + "api/git-dirty")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.dirty) {
            showConfirm("You have uncommitted changes. Ralph Loop uses git diff to track progress \u2014 uncommitted files may cause unexpected results.\n\nStart anyway?", function () {
              if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "loop_start" }));
              }
              stickyEl.classList.add("hidden");
              stickyEl.innerHTML = "";
            });
          } else {
            if (ws && ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "loop_start" }));
            }
            stickyEl.classList.add("hidden");
            stickyEl.innerHTML = "";
          }
        })
        .catch(function () {
          // If check fails, just start
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "loop_start" }));
          }
          stickyEl.classList.add("hidden");
          stickyEl.innerHTML = "";
        });
    });

    stickyEl.querySelector(".ralph-sticky-dismiss").addEventListener("click", function(e) {
      e.stopPropagation();
      showConfirm("Discard this Ralph Loop setup?", function() {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "ralph_wizard_cancel" }));
        }
        stickyEl.classList.add("hidden");
        stickyEl.classList.remove("ralph-ready");
        stickyEl.innerHTML = "";
      });
    });

    updateRalphApprovalStatus();
  }

  function updateRalphApprovalStatus() {
    var stickyEl = document.getElementById("ralph-sticky");
    var statusEl = document.getElementById("ralph-sticky-status");
    var startBtn = document.querySelector(".ralph-sticky-start");
    if (!statusEl) return;

    if (ralphFilesReady.bothReady) {
      statusEl.textContent = "Ready";
      if (startBtn) startBtn.disabled = false;
      if (stickyEl) stickyEl.classList.add("ralph-ready");
    } else if (ralphFilesReady.promptReady || ralphFilesReady.judgeReady) {
      statusEl.textContent = "Partial\u2026";
      if (startBtn) startBtn.disabled = true;
      if (stickyEl) stickyEl.classList.remove("ralph-ready");
    } else {
      statusEl.textContent = "Waiting\u2026";
      if (startBtn) startBtn.disabled = true;
      if (stickyEl) stickyEl.classList.remove("ralph-ready");
    }
  }

  // --- Debate Sticky Banner ---
  var debateStickyState = null;
  var debateHandRaiseOpen = false;

  function showDebateConcludeConfirm(msg) {
    showDebateConcludeMode();
  }

  var debateFloorMode = false;
  var debateConcludeMode = false;

  function showDebateConcludeMode() {
    removeDebateBottomBar();
    debateConcludeMode = true;
    var inputArea = document.getElementById("input-area");
    if (inputArea) {
      inputArea.classList.add("debate-floor-mode");
      inputArea.style.display = "";
    }
    var existingBanner = document.getElementById("debate-floor-banner");
    if (existingBanner) existingBanner.remove();
    var banner = document.createElement("div");
    banner.id = "debate-floor-banner";
    banner.className = "debate-floor-banner";
    banner.innerHTML = iconHtml("check-circle") + " <span>The moderator is ready to conclude</span>" +
      '<button class="debate-floor-done-btn debate-floor-end-btn" id="debate-floor-end-btn">End Debate</button>';
    if (inputArea && inputArea.parentNode) {
      inputArea.parentNode.insertBefore(banner, inputArea);
    }
    refreshIcons();
    var endBtn = document.getElementById("debate-floor-end-btn");
    if (endBtn) {
      endBtn.addEventListener("click", function () {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "debate_conclude_response", action: "end" }));
        }
        exitDebateConcludeMode();
      });
    }
    var inputEl = document.getElementById("input");
    if (inputEl) {
      inputEl._origPlaceholder = inputEl._origPlaceholder || inputEl.placeholder;
      inputEl.placeholder = "Add a direction to continue the debate...";
      inputEl.focus();
    }
    scrollToBottom();
  }

  function exitDebateConcludeMode() {
    debateConcludeMode = false;
    var inputArea = document.getElementById("input-area");
    if (inputArea) inputArea.classList.remove("debate-floor-mode");
    var banner = document.getElementById("debate-floor-banner");
    if (banner) banner.remove();
    var inputEl = document.getElementById("input");
    if (inputEl && inputEl._origPlaceholder) {
      inputEl.placeholder = inputEl._origPlaceholder;
      delete inputEl._origPlaceholder;
    }
  }

  function handleDebateConcludeSend() {
    var text = inputEl.value.trim();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "debate_conclude_response", action: "continue", text: text }));
    }
    inputEl.value = "";
    exitDebateConcludeMode();
    showDebateBottomBar("live");
  }

  var debateEndedMode = false;

  function showDebateEndedMode(msg) {
    removeDebateBottomBar();
    debateEndedMode = true;
    var inputArea = document.getElementById("input-area");
    if (inputArea) {
      inputArea.classList.add("debate-floor-mode");
      inputArea.style.display = "";
    }
    var existingBanner = document.getElementById("debate-floor-banner");
    if (existingBanner) existingBanner.remove();
    var banner = document.createElement("div");
    banner.id = "debate-floor-banner";
    banner.className = "debate-floor-banner";
    banner.innerHTML = iconHtml("check-circle") + " <span>Debate ended</span>" +
      '<button class="debate-floor-done-btn" id="debate-ended-resume-btn">Resume</button>' +
      '<button class="debate-floor-done-btn" id="debate-ended-pdf-btn">' + iconHtml("download") + ' PDF</button>';
    if (inputArea && inputArea.parentNode) {
      inputArea.parentNode.insertBefore(banner, inputArea);
    }
    refreshIcons();
    // Resume button
    var resumeBtn = document.getElementById("debate-ended-resume-btn");
    if (resumeBtn) {
      resumeBtn.addEventListener("click", function () {
        handleDebateEndedSend();
      });
    }
    // PDF button
    var pdfBtn = document.getElementById("debate-ended-pdf-btn");
    if (pdfBtn) {
      pdfBtn.addEventListener("click", function () {
        pdfBtn.disabled = true;
        exportDebateAsPdf().then(function () { pdfBtn.disabled = false; }).catch(function () { pdfBtn.disabled = false; });
      });
    }
    var inputEl2 = document.getElementById("input");
    if (inputEl2) {
      inputEl2._origPlaceholder = inputEl2._origPlaceholder || inputEl2.placeholder;
      inputEl2.placeholder = "Continue with a new direction...";
    }
    scrollToBottom();
  }

  function exitDebateEndedMode() {
    debateEndedMode = false;
    var inputArea = document.getElementById("input-area");
    if (inputArea) inputArea.classList.remove("debate-floor-mode");
    var banner = document.getElementById("debate-floor-banner");
    if (banner) banner.remove();
    var inputEl2 = document.getElementById("input");
    if (inputEl2 && inputEl2._origPlaceholder) {
      inputEl2.placeholder = inputEl2._origPlaceholder;
      delete inputEl2._origPlaceholder;
    }
  }

  function handleDebateEndedSend() {
    var text = inputEl.value.trim();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "debate_conclude_response", action: "continue", text: text }));
    }
    inputEl.value = "";
    exitDebateEndedMode();
  }

  function showDebateUserFloor(msg) {
    // Remove debate bottom bar and show input area in floor mode
    removeDebateBottomBar();
    debateFloorMode = true;
    var inputArea = document.getElementById("input-area");
    if (inputArea) {
      inputArea.classList.add("debate-floor-mode");
      inputArea.style.display = "";
    }
    // Add floor banner above input
    var existingBanner = document.getElementById("debate-floor-banner");
    if (existingBanner) existingBanner.remove();
    var banner = document.createElement("div");
    banner.id = "debate-floor-banner";
    banner.className = "debate-floor-banner";
    banner.innerHTML = iconHtml("mic") + " <span>You have the floor</span>" +
      '<button class="debate-floor-done-btn" id="debate-floor-done-btn">Pass</button>';
    if (inputArea && inputArea.parentNode) {
      inputArea.parentNode.insertBefore(banner, inputArea);
    }
    refreshIcons();
    // Done button: exit floor mode without sending
    var doneBtn = document.getElementById("debate-floor-done-btn");
    if (doneBtn) {
      doneBtn.addEventListener("click", function () {
        // Pass without speaking: resume debate
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "debate_user_floor_response", text: "(The user passed without speaking)" }));
        }
        exitDebateFloorMode();
        showDebateBottomBar("live");
      });
    }
    // Update placeholder
    var inputEl = document.getElementById("input");
    if (inputEl) {
      inputEl._origPlaceholder = inputEl.placeholder;
      inputEl.placeholder = "Share your thoughts with the panel...";
      inputEl.focus();
    }
    scrollToBottom();
  }

  function exitDebateFloorMode() {
    debateFloorMode = false;
    var inputArea = document.getElementById("input-area");
    if (inputArea) inputArea.classList.remove("debate-floor-mode");
    var banner = document.getElementById("debate-floor-banner");
    if (banner) banner.remove();
    var inputEl = document.getElementById("input");
    if (inputEl && inputEl._origPlaceholder) {
      inputEl.placeholder = inputEl._origPlaceholder;
      delete inputEl._origPlaceholder;
    }
  }

  function handleDebateFloorSend() {
    var text = inputEl.value.trim();
    if (!text) return;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "debate_user_floor_response", text: text }));
    }
    inputEl.value = "";
    exitDebateFloorMode();
    showDebateBottomBar("live");
  }

  function renderDebateUserFloorDone(msg) {
    if (!messagesEl) return;
    var el = document.createElement("div");
    el.className = "debate-user-comment";
    var label = document.createElement("span");
    label.className = "debate-comment-label";
    label.innerHTML = iconHtml("mic") + " User:";
    var textEl = document.createElement("div");
    textEl.className = "debate-comment-text";
    textEl.textContent = msg.text || "";
    el.appendChild(label);
    el.appendChild(textEl);
    messagesEl.appendChild(el);
    refreshIcons();
    scrollToBottom();
  }

  // Legacy handler kept for compatibility
  function showDebateSticky(phase, msg) {
    if (phase === "ended" || phase === "hide") {
      debateStickyState = null;
    } else {
      debateStickyState = { phase: phase, msg: msg };
    }

    // Hide the old sticky element (no longer used for content)
    var stickyEl = document.getElementById("debate-sticky");
    if (stickyEl) { stickyEl.classList.add("hidden"); stickyEl.innerHTML = ""; }

    // Remove existing header badges
    var oldBadges = document.querySelectorAll(".debate-header-badge");
    for (var i = 0; i < oldBadges.length; i++) oldBadges[i].remove();

    if (phase === "ended" || phase === "hide") {
      debateHandRaiseOpen = false;
      removeDebateBottomBar();
      return;
    }

    // Show bottom bar regardless of header availability
    if (phase === "live") {
      debateHandRaiseOpen = false;
      showDebateBottomBar("live");
    }

    // Add badges next to header title (optional, may not exist on mobile)
    var headerTitle = document.getElementById("header-title");
    if (!headerTitle) return;

    if (phase === "preparing") {
      var badge = document.createElement("span");
      badge.className = "debate-header-badge preparing";
      badge.textContent = "Setting up\u2026";
      headerTitle.after(badge);
    } else if (phase === "live") {
      var liveBadge = document.createElement("span");
      liveBadge.className = "debate-header-badge live";
      liveBadge.textContent = "Live";
      headerTitle.after(liveBadge);

      var roundBadge = document.createElement("span");
      roundBadge.className = "debate-header-badge round";
      roundBadge.id = "debate-header-round";
      roundBadge.textContent = "R" + ((msg && msg.round) || 1);
      liveBadge.after(roundBadge);
    }
  }

  // --- Debate bottom bar (replaces input-area during debate) ---
  function showDebateBottomBar(mode, msg) {
    removeDebateBottomBar();

    var inputArea = document.getElementById("input-area");
    if (!inputArea || !inputArea.parentNode) return;

    var bar = document.createElement("div");
    bar.id = "debate-bottom-bar";
    bar.className = "debate-bottom-bar";

    if (mode === "live") {
      bar.innerHTML =
        '<div class="debate-bottom-inner">' +
          '<button class="debate-bottom-hand" id="debate-bottom-hand">' + iconHtml("hand") + ' Raise hand</button>' +
          '<span class="debate-bottom-waiting hidden" id="debate-bottom-waiting">' + iconHtml("loader") + ' You will get the floor after the current speaker</span>' +
          '<button class="debate-bottom-stop" id="debate-bottom-stop">' + iconHtml("square") + ' Stop</button>' +
        '</div>';

      inputArea.parentNode.insertBefore(bar, inputArea);
      inputArea.style.display = "none";
      refreshIcons();

      // Restore raised state if hand was already raised
      if (debateHandRaiseOpen) {
        var handBtn = document.getElementById("debate-bottom-hand");
        var waitingEl = document.getElementById("debate-bottom-waiting");
        if (handBtn) { handBtn.classList.add("raised"); handBtn.classList.add("hidden"); }
        if (waitingEl) waitingEl.classList.remove("hidden");
      }

      document.getElementById("debate-bottom-hand").addEventListener("click", function () {
        toggleDebateHandRaise();
      });
      document.getElementById("debate-bottom-stop").addEventListener("click", function () {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "debate_stop" }));
          var stopBtn = document.getElementById("debate-bottom-stop");
          if (stopBtn) {
            stopBtn.disabled = true;
            stopBtn.innerHTML = iconHtml("loader") + " Stopping...";
            refreshIcons();
          }
          var waitingEl = document.getElementById("debate-bottom-waiting");
          if (waitingEl) {
            waitingEl.textContent = "Stopping after current turn...";
            waitingEl.classList.remove("hidden");
          }
        }
      });
    }
  }

  function debateAutoResize(textarea, maxRows) {
    textarea.style.height = "auto";
    var lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
    var maxHeight = lineHeight * maxRows;
    var newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = newHeight + "px";
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function removeDebateBottomBar() {
    var existing = document.getElementById("debate-bottom-bar");
    if (existing) existing.remove();
    // Also remove hand raise bar if open
    var handBar = document.getElementById("debate-hand-raise-bar");
    if (handBar) handBar.remove();
    debateHandRaiseOpen = false;
    // Clean up floor/conclude/ended modes
    if (debateFloorMode) exitDebateFloorMode();
    if (debateConcludeMode) exitDebateConcludeMode();
    if (debateEndedMode) exitDebateEndedMode();
    // Restore input area
    var inputArea = document.getElementById("input-area");
    if (inputArea) inputArea.style.display = "";
  }

  function toggleDebateHandRaise(forceState) {
    var raise = typeof forceState === "boolean" ? forceState : !debateHandRaiseOpen;
    debateHandRaiseOpen = raise;

    // Update UI: hide hand button, show waiting message
    var handBtn = document.getElementById("debate-bottom-hand");
    var waitingEl = document.getElementById("debate-bottom-waiting");
    if (raise) {
      if (handBtn) { handBtn.classList.add("raised"); handBtn.classList.add("hidden"); }
      if (waitingEl) waitingEl.classList.remove("hidden");
    } else {
      if (handBtn) { handBtn.classList.remove("raised"); handBtn.classList.remove("hidden"); }
      if (waitingEl) waitingEl.classList.add("hidden");
    }

    if (raise && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "debate_hand_raise" }));
    }
    // Floor mode will be activated when server sends debate_user_floor
  }

  function sendDebateStickyComment() {
    // Legacy fallback (kept for compatibility)
    var commentInput = document.getElementById("debate-sticky-comment");
    if (!commentInput) return;
    var text = commentInput.value.trim();
    if (!text) return;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "debate_comment", text: text }));
    }
    toggleDebateHandRaise(false);
  }

  function updateDebateRound(round) {
    var roundEl = document.getElementById("debate-header-round");
    if (roundEl) roundEl.textContent = "R" + round;
  }

  // --- Ralph Preview Modal ---
  function openRalphPreviewModal() {
    var modal = document.getElementById("ralph-preview-modal");
    if (!modal) return;
    modal.classList.remove("hidden");

    // Set name from wizard data
    var nameEl = document.getElementById("ralph-preview-name");
    if (nameEl) {
      var name = (wizardData && wizardData.name) || "Ralph Loop";
      nameEl.textContent = name;
    }

    // Update run button label based on cron
    var runBtn = document.getElementById("ralph-preview-run");
    if (runBtn) {
      var hasCron = wizardData && wizardData.cron;
      runBtn.innerHTML = iconHtml(hasCron ? "calendar-clock" : "play") + " " + (hasCron ? "Schedule" : "Run now");
      runBtn.disabled = !(ralphFilesReady && ralphFilesReady.bothReady);
    }

    showRalphPreviewTab("prompt");
    refreshIcons();
  }

  function closeRalphPreviewModal() {
    var modal = document.getElementById("ralph-preview-modal");
    if (modal) modal.classList.add("hidden");
  }

  function showRalphPreviewTab(tab) {
    var tabs = document.querySelectorAll("#ralph-preview-modal .ralph-tab");
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute("data-tab") === tab) {
        tabs[i].classList.add("active");
      } else {
        tabs[i].classList.remove("active");
      }
    }
    var body = document.getElementById("ralph-preview-body");
    if (!body) return;
    var content = tab === "prompt" ? ralphPreviewContent.prompt : ralphPreviewContent.judge;
    if (typeof marked !== "undefined" && marked.parse) {
      body.innerHTML = '<div class="md-content">' + DOMPurify.sanitize(marked.parse(content)) + '</div>';
    } else {
      body.textContent = content;
    }
  }

  // Preview modal listeners
  var previewBackdrop = document.querySelector("#ralph-preview-modal .confirm-backdrop");
  if (previewBackdrop) previewBackdrop.addEventListener("click", closeRalphPreviewModal);

  // Run now button in preview modal
  var previewRunBtn = document.getElementById("ralph-preview-run");
  if (previewRunBtn) {
    previewRunBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeRalphPreviewModal();
      // Trigger the same flow as the sticky start button
      var stickyStart = document.querySelector(".ralph-sticky-start");
      if (stickyStart) {
        stickyStart.click();
      }
    });
  }

  // Delete/cancel button in preview modal
  var previewDeleteBtn = document.getElementById("ralph-preview-delete");
  if (previewDeleteBtn) {
    previewDeleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeRalphPreviewModal();
      // Trigger the same flow as the sticky dismiss button
      var stickyDismiss = document.querySelector(".ralph-sticky-dismiss");
      if (stickyDismiss) {
        stickyDismiss.click();
      }
    });
  }

  var previewTabs = document.querySelectorAll(".ralph-tab");
  for (var ti = 0; ti < previewTabs.length; ti++) {
    previewTabs[ti].addEventListener("click", function() {
      showRalphPreviewTab(this.getAttribute("data-tab"));
    });
  }

  // --- Skills ---
  initSkills({
    get ws() { return ws; },
    get connected() { return connected; },
    basePath: basePath,
    openTerminal: function () { openTerminal(); },
    sendTerminalCommand: function (cmd) { sendTerminalCommand(cmd); },
  });

  // --- Scheduler ---
  initScheduler({
    get ws() { return ws; },
    get connected() { return connected; },
    get activeSessionId() { return activeSessionId; },
    basePath: basePath,
    currentSlug: currentSlug,
    openRalphWizard: function (source) { openRalphWizard(source); },
    requireClayRalph: function (cb) { requireClayRalph(cb); },
    getProjects: function () { return cachedProjects; },
  });

  // --- Remove project ---
  var pendingRemoveSlug = null;
  var pendingRemoveName = null;

  function confirmRemoveProject(slug, name) {
    // First check if the project has tasks/schedules
    pendingRemoveSlug = slug;
    pendingRemoveName = name;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "remove_project_check", slug: slug }));
    }
  }

  function handleRemoveProjectCheckResult(msg) {
    var slug = msg.slug || pendingRemoveSlug;
    var name = msg.name || pendingRemoveName || slug;
    if (!slug) return;

    if (msg.count > 0) {
      // Project has tasks — show dialog with options
      showRemoveProjectTaskDialog(slug, name, msg.count);
    } else {
      // No tasks — confirm then particle burst + remove
      var isWt = slug.indexOf("--") !== -1;
      var confirmMsg = isWt
        ? 'Delete worktree "' + name + '"? The branch and working directory will be removed from disk.'
        : 'Remove "' + name + '"? You can re-add it later.';
      showConfirm(confirmMsg, function () {
        // Find the icon strip item to anchor the particle burst
        var iconEl = document.querySelector('.icon-strip-item[data-slug="' + slug + '"]');
        if (iconEl) {
          var rect = iconEl.getBoundingClientRect();
          spawnDustParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }
        setTimeout(function () {
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "remove_project", slug: slug }));
          }
        }, 1000);
      }, "Remove", true);
    }
    pendingRemoveSlug = null;
    pendingRemoveName = null;
  }

  function showRemoveProjectTaskDialog(slug, name, taskCount) {
    // Build list of other projects to move tasks to
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
        if (ws && ws.readyState === 1 && targetSlug) {
          ws.send(JSON.stringify({ type: "remove_project", slug: slug, moveTasksTo: targetSlug }));
        }
        close();
      });
    }

    deleteBtn.addEventListener("click", function () {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "remove_project", slug: slug }));
      }
      close();
    });
  }

  function handleRemoveProjectResult(msg) {
    if (msg.ok) {
      // If we removed the current project, navigate away
      if (msg.slug === currentSlug) {
        // Check if this is a worktree: navigate to parent project instead of home hub
        var isWorktree = msg.slug.indexOf("--") !== -1;
        var parentSlug = isWorktree ? msg.slug.split("--")[0] : null;

        showToast(isWorktree ? "Worktree removed" : "Project removed", "success");

        // Suppress disconnect overlay and reconnect by detaching the WS
        if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
        _connCancelReconnect();
        connected = false;
        connectOverlay.classList.add("hidden");
        if (!isWorktree) {
          // Add to cached removed projects for re-add UI
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
        // Remove from cached projects and re-render icon strip
        cachedProjects = cachedProjects.filter(function (p) { return p.slug !== msg.slug; });
        cachedProjectCount = cachedProjects.length;
        currentSlug = null;
        renderProjectList();
        resetClientState();

        if (parentSlug && switchProject) {
          switchProject(parentSlug);
        } else {
          showHomeHub();
        }
      } else {
        showToast(msg.slug.indexOf("--") !== -1 ? "Worktree removed" : "Project removed", "success");
      }
    } else {
      showToast(msg.error || "Failed to remove project", "error");
    }
  }

  // --- Add project modal ---
  var addProjectModal = document.getElementById("add-project-modal");
  var addProjectInput = document.getElementById("add-project-input");
  var addProjectCreateInput = document.getElementById("add-project-create-input");
  var addProjectCloneInput = document.getElementById("add-project-clone-input");
  var addProjectCloneProgress = document.getElementById("add-project-clone-progress");
  var addProjectSuggestions = document.getElementById("add-project-suggestions");
  var addProjectError = document.getElementById("add-project-error");
  var addProjectOk = document.getElementById("add-project-ok");
  var addProjectCancel = document.getElementById("add-project-cancel");
  var addProjectModeBtns = addProjectModal.querySelectorAll(".add-project-mode-btn");
  var addProjectPanels = addProjectModal.querySelectorAll(".add-project-panel");
  var addProjectRemoved = document.getElementById("add-project-removed");
  var addProjectDebounce = null;
  var addProjectActiveIdx = -1;
  var addProjectMode = "existing";

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
    // Update OK button text
    if (mode === "existing") {
      addProjectOk.textContent = "Add";
    } else if (mode === "create") {
      addProjectOk.textContent = "Create";
    } else if (mode === "clone") {
      addProjectOk.textContent = "Clone";
    }
    // Focus the right input
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

  for (var mbi = 0; mbi < addProjectModeBtns.length; mbi++) {
    addProjectModeBtns[mbi].addEventListener("click", function () {
      if (this.disabled) return;
      switchAddProjectMode(this.dataset.mode);
    });
  }

  function openAddProjectModal() {
    addProjectModal.classList.remove("hidden");
    addProjectInput.value = "/";
    addProjectCreateInput.value = "";
    addProjectCloneInput.value = "";
    addProjectError.classList.add("hidden");
    addProjectError.textContent = "";
    addProjectCloneProgress.classList.add("hidden");
    addProjectSuggestions.classList.add("hidden");
    addProjectSuggestions.innerHTML = "";
    addProjectActiveIdx = -1;
    addProjectOk.disabled = false;
    // In osUsers mode, disable "existing" and default to "create"
    var existingBtn = addProjectModal.querySelector('.add-project-mode-btn[data-mode="existing"]');
    if (isOsUsers) {
      existingBtn.disabled = true;
      switchAddProjectMode("create");
    } else {
      existingBtn.disabled = false;
      switchAddProjectMode("existing");
    }
    // Render removed projects for re-add
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
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "add_project", path: p }));
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

  function closeAddProjectModal() {
    addProjectModal.classList.add("hidden");
    addProjectInput.value = "";
    addProjectCreateInput.value = "";
    addProjectCloneInput.value = "";
    addProjectSuggestions.classList.add("hidden");
    addProjectSuggestions.innerHTML = "";
    addProjectError.classList.add("hidden");
    addProjectCloneProgress.classList.add("hidden");
    addProjectActiveIdx = -1;
    if (addProjectDebounce) { clearTimeout(addProjectDebounce); addProjectDebounce = null; }
  }

  function requestBrowseDir(val) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "browse_dir", path: val }));
  }

  function handleBrowseDirResult(msg) {
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
        var p = this.dataset.path + "/";
        addProjectInput.value = p;
        addProjectInput.focus();
        addProjectError.classList.add("hidden");
        requestBrowseDir(p);
      });
      addProjectSuggestions.appendChild(item);
    }
    addProjectSuggestions.classList.remove("hidden");
    refreshIcons();
  }

  function handleAddProjectResult(msg) {
    addProjectCloneProgress.classList.add("hidden");
    if (msg.ok) {
      closeAddProjectModal();
      if (msg.existing) {
        showToast("Project already registered", "info");
      } else {
        var toastMsg = addProjectMode === "create" ? "Project created" : addProjectMode === "clone" ? "Project cloned" : "Project added";
        showToast(toastMsg, "success");
        // Navigate to the new project
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

  function handleCloneProgress(msg) {
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

  addProjectInput.addEventListener("focus", function () {
    var val = addProjectInput.value;
    if (val && addProjectSuggestions.children.length === 0) {
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
        var p = target.dataset.path + "/";
        addProjectInput.value = p;
        addProjectError.classList.add("hidden");
        requestBrowseDir(p);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      // If a suggestion is highlighted, pick it first
      if (addProjectActiveIdx >= 0 && addProjectActiveIdx < items.length) {
        var picked = items[addProjectActiveIdx].dataset.path + "/";
        addProjectInput.value = picked;
        addProjectError.classList.add("hidden");
        requestBrowseDir(picked);
        return;
      }
      // Otherwise submit
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

  function submitAddProject() {
    addProjectError.classList.add("hidden");
    addProjectOk.disabled = true;

    if (addProjectMode === "existing") {
      var val = addProjectInput.value.replace(/\/+$/, "");
      if (!val) { addProjectOk.disabled = false; return; }
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "add_project", path: val }));
      }
    } else if (addProjectMode === "create") {
      var name = addProjectCreateInput.value.trim();
      if (!name) { addProjectOk.disabled = false; return; }
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "create_project", name: name }));
      }
    } else if (addProjectMode === "clone") {
      var url = addProjectCloneInput.value.trim();
      if (!url) { addProjectOk.disabled = false; return; }
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "clone_project", url: url }));
      }
    }
  }

  addProjectOk.addEventListener("click", function () { submitAddProject(); });
  addProjectCancel.addEventListener("click", function () { closeAddProjectModal(); });

  // Close on backdrop click
  addProjectModal.querySelector(".confirm-backdrop").addEventListener("click", function () {
    closeAddProjectModal();
  });

  // --- PWA install prompt ---
  (function () {
    var installPill = document.getElementById("pwa-install-pill");
    var modal = document.getElementById("pwa-install-modal");
    var confirmBtn = document.getElementById("pwa-modal-confirm");
    var cancelBtn = document.getElementById("pwa-modal-cancel");
    if (!installPill || !modal) return;

    // Already standalone — never show
    if (document.documentElement.classList.contains("pwa-standalone")) return;

    // Show pill on mobile browsers (the primary target for PWA install)
    var isMobile = /Mobi|Android|iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isMobile) {
      installPill.classList.remove("hidden");
    }

    // Also show on desktop if beforeinstallprompt fires
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      installPill.classList.remove("hidden");
    });

    function openModal() {
      modal.classList.remove("hidden");
      lucide.createIcons({ nodes: [modal] });
    }

    function closeModal() {
      modal.classList.add("hidden");
    }

    installPill.addEventListener("click", openModal);
    cancelBtn.addEventListener("click", closeModal);
    modal.querySelector(".pwa-modal-backdrop").addEventListener("click", closeModal);

    confirmBtn.addEventListener("click", function () {
      // Builtin cert (*.d.clay.studio): open PWA setup guide
      if (location.hostname.endsWith(".d.clay.studio")) {
        closeModal();
        location.href = "/pwa";
        return;
      }
      // mkcert / other: redirect to onboarding setup page
      var port = parseInt(location.port, 10);
      var setupUrl;
      if (!port) {
        // Standard port (443/80), behind a reverse proxy with real cert
        setupUrl = location.protocol + "//" + location.hostname + "/setup";
      } else {
        // Non-standard port, Clay serving directly with onboarding server on port+1
        setupUrl = "http://" + location.hostname + ":" + (port + 1) + "/setup";
      }
      location.href = setupUrl;
    });

    // Hide after install
    window.addEventListener("appinstalled", function () {
      installPill.classList.add("hidden");
      closeModal();
    });
  })();


  // --- Remote Cursors (delegated to app-cursors.js) ---
  function handleRemoteCursorMove(msg) { _curHandleRemoteCursorMove(msg); }
  function handleRemoteCursorLeave(msg) { _curHandleRemoteCursorLeave(msg); }
  function handleRemoteSelection(msg) { _curHandleRemoteSelection(msg); }
  function clearRemoteCursors() { _curClearRemoteCursors(); }

  // --- Cursors module ---
  initCursors({
    messagesEl: messagesEl,
    registerTooltip: registerTooltip,
    get ws() { return ws; },
    get isMultiUserMode() { return isMultiUserMode; },
  });

  // --- Rate Limit module ---
  initRateLimit({
    iconHtml: iconHtml,
    refreshIcons: refreshIcons,
    addToMessages: addToMessages,
    scrollToBottom: scrollToBottom,
    userAvatarUrl: userAvatarUrl,
    setScheduleDelayMs: setScheduleDelayMs,
    clearScheduleDelay: clearScheduleDelay,
    get ws() { return ws; },
    get cachedAllUsers() { return cachedAllUsers; },
    get myUserId() { return myUserId; },
  });

  // --- Home Hub module ---
  initHomeHub({
    $: $,
    exitDmMode: exitDmMode,
    openDm: openDm,
    mateAvatarUrl: mateAvatarUrl,
    escapeHtml: escapeHtml,
    switchProject: switchProject,
    openSchedulerToTab: openSchedulerToTab,
    getPlaybooks: getPlaybooks,
    openPlaybook: openPlaybook,
    getPlaybookForTip: getPlaybookForTip,
    renderProjectList: renderProjectList,
    get dmMode() { return dmMode; },
    get ws() { return ws; },
    get currentSlug() { return currentSlug; },
    get cachedProjects() { return cachedProjects; },
    get cachedMatesList() { return cachedMatesList; },
  });

  // --- DM module ---
  var _dmCtx = {
    // Functions
    connect: connect,
    resetClientState: resetClientState,
    scrollToBottom: scrollToBottom,
    autoResize: autoResize,
    showDebateSticky: showDebateSticky,
    updateDmBadge: updateDmBadge,
    setCurrentDmUser: setCurrentDmUser,
    renderProjectList: renderProjectList,
    hideHomeHub: hideHomeHub,
    hideNotes: hideNotes,
    showMateSidebar: showMateSidebar,
    hideMateSidebar: hideMateSidebar,
    hideKnowledge: hideKnowledge,
    hideMemory: hideMemory,
    closeFileViewer: closeFileViewer,
    closeTerminal: closeTerminal,
    mateAvatarUrl: mateAvatarUrl,
    userAvatarUrl: userAvatarUrl,
    renderUserStrip: renderUserStrip,
    openMobileSheet: openMobileSheet,
    setMobileSheetMateData: setMobileSheetMateData,
    closeDmUserPicker: closeDmUserPicker,
    getProfileLang: getProfileLang,
    isSchedulerOpen: isSchedulerOpen,
    closeScheduler: closeScheduler,
    requireClayMateInterview: requireClayMateInterview,
    // DOM refs
    messagesEl: messagesEl,
    inputEl: inputEl,
  };
  // Mutable state for DM module
  var _dmStateProps = {
    ws: function() { return ws; },
    dmMode: function() { return dmMode; }, _dmMode: function(v) { dmMode = v; },
    dmKey: function() { return dmKey; }, _dmKey: function(v) { dmKey = v; },
    dmTargetUser: function() { return dmTargetUser; }, _dmTargetUser: function(v) { dmTargetUser = v; },
    dmMessageCache: function() { return dmMessageCache; }, _dmMessageCache: function(v) { dmMessageCache = v; },
    dmUnread: function() { return dmUnread; },
    dmRemovedUsers: function() { return dmRemovedUsers; },
    cachedAllUsers: function() { return cachedAllUsers; },
    cachedOnlineIds: function() { return cachedOnlineIds; },
    cachedDmFavorites: function() { return cachedDmFavorites; }, _cachedDmFavorites: function(v) { cachedDmFavorites = v; },
    cachedDmConversations: function() { return cachedDmConversations; },
    cachedMatesList: function() { return cachedMatesList; },
    cachedAvailableBuiltins: function() { return cachedAvailableBuiltins; }, _cachedAvailableBuiltins: function(v) { cachedAvailableBuiltins = v; },
    cachedProjects: function() { return cachedProjects; },
    mateProjectSlug: function() { return mateProjectSlug; }, _mateProjectSlug: function(v) { mateProjectSlug = v; },
    savedMainSlug: function() { return savedMainSlug; }, _savedMainSlug: function(v) { savedMainSlug = v; },
    returningFromMateDm: function() { return returningFromMateDm; }, _returningFromMateDm: function(v) { returningFromMateDm = v; },
    pendingMateInterview: function() { return pendingMateInterview; }, _pendingMateInterview: function(v) { pendingMateInterview = v; },
    currentSlug: function() { return currentSlug; }, _currentSlug: function(v) { currentSlug = v; },
    wsPath: function() { return wsPath; }, _wsPath: function(v) { wsPath = v; },
    basePath: function() { return basePath; }, _basePath: function(v) { basePath = v; },
    activeSessionId: function() { return activeSessionId; },
    myUserId: function() { return myUserId; },
  };
  Object.keys(_dmStateProps).forEach(function(key) {
    if (key.charAt(0) === "_") return;
    var getter = _dmStateProps[key];
    var setter = _dmStateProps["_" + key];
    var desc = { get: getter, enumerable: true };
    if (setter) desc.set = setter;
    Object.defineProperty(_dmCtx, key, desc);
  });
  initDm(_dmCtx);

  // --- Messages module ---
  var _msgCtx = {
    // DOM refs
    messagesEl: messagesEl,
    headerTitleEl: headerTitleEl,
    inputEl: inputEl,
    connectOverlay: connectOverlay,
    $: $,
    // Functions - sidebar/session
    renderMateSessionList: renderMateSessionList,
    refreshMobileChatSheet: refreshMobileChatSheet,
    handleMateSearchResults: handleMateSearchResults,
    renderKnowledgeList: renderKnowledgeList,
    handleKnowledgeContent: handleKnowledgeContent,
    renderMemoryList: renderMemoryList,
    updateMateSidebarProfile: updateMateSidebarProfile,
    renderSessionList: renderSessionList,
    handlePaletteSessionSwitch: handlePaletteSessionSwitch,
    updateSessionPresence: updateSessionPresence,
    populateCliSessionList: populateCliSessionList,
    handleSearchResults: handleSearchResults,
    handleFindInSessionResults: handleFindInSessionResults,
    blinkSessionDot: blinkSessionDot,
    updateSessionBadge: updateSessionBadge,
    updatePageTitle: updatePageTitle,
    setPaletteVersion: setPaletteVersion,
    hideHomeHub: hideHomeHub,
    clearRemoteCursors: clearRemoteCursors,
    resetClientState: resetClientState,
    // Functions - rendering
    scrollToBottom: scrollToBottom,
    addToMessages: addToMessages,
    addUserMessage: addUserMessage,
    addSystemMessage: addSystemMessage,
    renderMarkdown: renderMarkdown,
    refreshIcons: refreshIcons,
    iconHtml: iconHtml,
    showImageModal: showImageModal,
    showToast: showToast,
    autoResize: autoResize,
    // Functions - tools/thinking
    startThinking: startThinking,
    appendThinking: appendThinking,
    stopThinking: stopThinking,
    resetThinkingGroup: resetThinkingGroup,
    removeMatePreThinking: removeMatePreThinking,
    appendDelta: appendDelta,
    createToolItem: createToolItem,
    updateToolExecuting: updateToolExecuting,
    updateToolResult: updateToolResult,
    markAllToolsDone: markAllToolsDone,
    closeToolGroup: closeToolGroup,
    removeToolFromGroup: removeToolFromGroup,
    resetToolState: resetToolState,
    getTools: getTools,
    getPlanContent: getPlanContent,
    setPlanContent: setPlanContent,
    renderPlanBanner: renderPlanBanner,
    renderPlanCard: renderPlanCard,
    getTodoTools: getTodoTools,
    handleTodoWrite: handleTodoWrite,
    handleTaskCreate: handleTaskCreate,
    handleTaskUpdate: handleTaskUpdate,
    isPlanFilePath: isPlanFilePath,
    enableMainInput: enableMainInput,
    addTurnMeta: addTurnMeta,
    // Functions - subagents
    updateSubagentActivity: updateSubagentActivity,
    addSubagentToolEntry: addSubagentToolEntry,
    markSubagentDone: markSubagentDone,
    initSubagentStop: initSubagentStop,
    updateSubagentProgress: updateSubagentProgress,
    // Functions - permissions/elicitation
    renderAskUserQuestion: renderAskUserQuestion,
    markAskUserAnswered: markAskUserAnswered,
    renderPermissionRequest: renderPermissionRequest,
    markPermissionCancelled: markPermissionCancelled,
    markPermissionResolved: markPermissionResolved,
    renderElicitationRequest: renderElicitationRequest,
    markElicitationResolved: markElicitationResolved,
    // Functions - status
    setStatus: setStatus,
    setActivity: setActivity,
    setSendBtnMode: setSendBtnMode,
    hasSendableContent: hasSendableContent,
    startUrgentBlink: startUrgentBlink,
    stopUrgentBlink: stopUrgentBlink,
    finalizeAssistantBlock: finalizeAssistantBlock,
    // Functions - usage/context
    accumulateUsage: accumulateUsage,
    accumulateContext: accumulateContext,
    updateContextPanel: updateContextPanel,
    updateUsagePanel: updateUsagePanel,
    renderCtxPopover: renderCtxPopover,
    // Functions - notifications
    showDoneNotification: showDoneNotification,
    playDoneSound: playDoneSound,
    isNotifAlertEnabled: isNotifAlertEnabled,
    isNotifSoundEnabled: isNotifSoundEnabled,
    // Functions - filesystem
    handleFsList: handleFsList,
    handleFsRead: handleFsRead,
    isProjectSettingsOpen: isProjectSettingsOpen,
    handleInstructionsRead: handleInstructionsRead,
    handleInstructionsWrite: handleInstructionsWrite,
    handleProjectEnv: handleProjectEnv,
    handleProjectEnvSaved: handleProjectEnvSaved,
    handleGlobalClaudeMdRead: handleGlobalClaudeMdRead,
    handleGlobalClaudeMdWrite: handleGlobalClaudeMdWrite,
    handleSharedEnv: handleSharedEnv,
    handleProjectSharedEnv: handleProjectSharedEnv,
    handleSharedEnvSaved: handleSharedEnvSaved,
    handleProjectSharedEnvSaved: handleProjectSharedEnvSaved,
    handleFileChanged: handleFileChanged,
    handleDirChanged: handleDirChanged,
    handleFileHistory: handleFileHistory,
    handleGitDiff: handleGitDiff,
    handleFileAt: handleFileAt,
    refreshIfOpen: refreshIfOpen,
    getPendingNavigate: getPendingNavigate,
    // Functions - terminals
    handleTermList: handleTermList,
    updateTerminalList: updateTerminalList,
    handleContextSourcesState: handleContextSourcesState,
    sendExtensionCommand: sendExtensionCommand,
    handleTermCreated: handleTermCreated,
    sendTerminalCommand: sendTerminalCommand,
    handleTermOutput: handleTermOutput,
    handleTermResized: handleTermResized,
    handleTermExited: handleTermExited,
    handleTermClosed: handleTermClosed,
    // Functions - notes
    handleNotesList: handleNotesList,
    handleNoteCreated: handleNoteCreated,
    handleNoteUpdated: handleNoteUpdated,
    handleNoteDeleted: handleNoteDeleted,
    // Functions - projects
    updateProjectList: updateProjectList,
    handleBrowseDirResult: handleBrowseDirResult,
    handleAddProjectResult: handleAddProjectResult,
    handleCloneProgress: handleCloneProgress,
    handleRemoveProjectResult: handleRemoveProjectResult,
    handleRemoveProjectCheckResult: handleRemoveProjectCheckResult,
    handleProjectOwnerChanged: handleProjectOwnerChanged,
    // Functions - settings/config
    updateConfigChip: updateConfigChip,
    getModelEffortLevels: getModelEffortLevels,
    updateSettingsModels: updateSettingsModels,
    updateSettingsStats: updateSettingsStats,
    updateStatusPanel: updateStatusPanel,
    updateDaemonConfig: updateDaemonConfig,
    handleSetPinResult: handleSetPinResult,
    handleKeepAwakeChanged: handleKeepAwakeChanged,
    handleAutoContinueChanged: handleAutoContinueChanged,
    handleRestartResult: handleRestartResult,
    handleShutdownResult: handleShutdownResult,
    showUpdateAvailable: showUpdateAvailable,
    checkAdminAccess: checkAdminAccess,
    renderSidebarPresence: renderSidebarPresence,
    // Functions - skills
    handleSkillInstalled: handleSkillInstalled,
    handleSkillInstallWs: handleSkillInstallWs,
    handleSkillUninstalled: handleSkillUninstalled,
    // Functions - DM
    enterDmMode: enterDmMode,
    exitDmMode: exitDmMode,
    openDm: openDm,
    appendDmMessage: appendDmMessage,
    showDmTypingIndicator: showDmTypingIndicator,
    buildMateInterviewPrompt: buildMateInterviewPrompt,
    handleMateCreatedInApp: handleMateCreatedInApp,
    updateMateIconStatus: updateMateIconStatus,
    updateDmBadge: updateDmBadge,
    renderUserStrip: renderUserStrip,
    mateAvatarUrl: mateAvatarUrl,
    // Functions - mention
    handleMentionStart: handleMentionStart,
    handleMentionActivity: handleMentionActivity,
    handleMentionStream: handleMentionStream,
    handleMentionDone: handleMentionDone,
    handleMentionError: handleMentionError,
    renderMentionUser: renderMentionUser,
    renderMentionResponse: renderMentionResponse,
    // Functions - debate
    showDebateSticky: showDebateSticky,
    handleDebatePreparing: handleDebatePreparing,
    handleDebateBriefReady: handleDebateBriefReady,
    renderDebateBriefReady: renderDebateBriefReady,
    handleDebateStarted: handleDebateStarted,
    renderDebateStarted: renderDebateStarted,
    handleDebateTurn: handleDebateTurn,
    updateDebateRound: updateDebateRound,
    handleDebateActivity: handleDebateActivity,
    handleDebateStream: handleDebateStream,
    handleDebateTurnDone: handleDebateTurnDone,
    handleDebateCommentQueued: handleDebateCommentQueued,
    handleDebateCommentInjected: handleDebateCommentInjected,
    renderDebateCommentInjected: renderDebateCommentInjected,
    showDebateConcludeConfirm: showDebateConcludeConfirm,
    showDebateUserFloor: showDebateUserFloor,
    renderDebateUserFloorDone: renderDebateUserFloorDone,
    renderDebateUserResume: renderDebateUserResume,
    handleDebateResumed: handleDebateResumed,
    handleDebateEnded: handleDebateEnded,
    renderDebateEnded: renderDebateEnded,
    handleDebateError: handleDebateError,
    isDebateActive: isDebateActive,
    exitDebateFloorMode: exitDebateFloorMode,
    exitDebateConcludeMode: exitDebateConcludeMode,
    exitDebateEndedMode: exitDebateEndedMode,
    renderMcpDebateProposal: renderMcpDebateProposal,
    // Functions - loop/ralph
    updateLoopButton: updateLoopButton,
    showLoopBanner: showLoopBanner,
    updateLoopBanner: updateLoopBanner,
    updateRalphBars: updateRalphBars,
    updateLoopInputVisibility: updateLoopInputVisibility,
    showRalphApprovalBar: showRalphApprovalBar,
    updateRalphApprovalStatus: updateRalphApprovalStatus,
    openRalphPreviewModal: openRalphPreviewModal,
    enterCraftingMode: enterCraftingMode,
    exitCraftingMode: exitCraftingMode,
    isSchedulerOpen: isSchedulerOpen,
    handleLoopRegistryUpdated: handleLoopRegistryUpdated,
    handleScheduleRunStarted: handleScheduleRunStarted,
    handleScheduleRunFinished: handleScheduleRunFinished,
    handleLoopScheduled: handleLoopScheduled,
    handleHubSchedules: handleHubSchedules,
    handleLoopRegistryFiles: handleLoopRegistryFiles,
    // Functions - input/misc
    handleInputSync: handleInputSync,
    handleRateLimitEvent: handleRateLimitEvent,
    updateRateLimitUsage: updateRateLimitUsage,
    addScheduledMessageBubble: addScheduledMessageBubble,
    removeScheduledMessageBubble: removeScheduledMessageBubble,
    setScheduleBtnDisabled: setScheduleBtnDisabled,
    showSuggestionChips: showSuggestionChips,
    handleFastModeState: handleFastModeState,
    addConflictMessage: addConflictMessage,
    addContextOverflowMessage: addContextOverflowMessage,
    addAuthRequiredMessage: addAuthRequiredMessage,
    // Functions - rewind
    showRewindModal: showRewindModal,
    onRewindComplete: onRewindComplete,
    setRewindMode: setRewindMode,
    onRewindError: onRewindError,
    clearPendingRewindUuid: clearPendingRewindUuid,
    addRewindButton: addRewindButton,
    // Functions - cursors
    handleRemoteCursorMove: handleRemoteCursorMove,
    handleRemoteCursorLeave: handleRemoteCursorLeave,
    handleRemoteSelection: handleRemoteSelection,
    // Functions - history
    updateHistorySentinel: updateHistorySentinel,
    prependOlderHistory: prependOlderHistory,
    // Functions - builtinCommands
    builtinCommands: builtinCommands,
  };
  // Add mutable state with live get/set accessors
  var _msgStateProps = {
    currentMsgTs: function() { return currentMsgTs; }, _currentMsgTs: function(v) { currentMsgTs = v; },
    dmMode: function() { return dmMode; }, _dmMode: function(v) { dmMode = v; },
    dmTargetUser: function() { return dmTargetUser; },
    ws: function() { return ws; },
    historyFrom: function() { return historyFrom; }, _historyFrom: function(v) { historyFrom = v; },
    historyTotal: function() { return historyTotal; }, _historyTotal: function(v) { historyTotal = v; },
    replayingHistory: function() { return replayingHistory; }, _replayingHistory: function(v) { replayingHistory = v; },
    richContextUsage: function() { return richContextUsage; }, _richContextUsage: function(v) { richContextUsage = v; },
    projectName: function() { return projectName; }, _projectName: function(v) { projectName = v; },
    currentSlug: function() { return currentSlug; }, _currentSlug: function(v) { currentSlug = v; },
    currentProjectOwnerId: function() { return currentProjectOwnerId; }, _currentProjectOwnerId: function(v) { currentProjectOwnerId = v; },
    isOsUsers: function() { return isOsUsers; }, _isOsUsers: function(v) { isOsUsers = v; },
    skipPermsEnabled: function() { return skipPermsEnabled; }, _skipPermsEnabled: function(v) { skipPermsEnabled = v; },
    currentModel: function() { return currentModel; }, _currentModel: function(v) { currentModel = v; },
    currentModels: function() { return currentModels; }, _currentModels: function(v) { currentModels = v; },
    currentMode: function() { return currentMode; }, _currentMode: function(v) { currentMode = v; },
    currentEffort: function() { return currentEffort; }, _currentEffort: function(v) { currentEffort = v; },
    currentBetas: function() { return currentBetas; }, _currentBetas: function(v) { currentBetas = v; },
    currentThinking: function() { return currentThinking; }, _currentThinking: function(v) { currentThinking = v; },
    currentThinkingBudget: function() { return currentThinkingBudget; }, _currentThinkingBudget: function(v) { currentThinkingBudget = v; },
    slashCommands: function() { return slashCommands; }, _slashCommands: function(v) { slashCommands = v; },
    returningFromMateDm: function() { return returningFromMateDm; }, _returningFromMateDm: function(v) { returningFromMateDm = v; },
    processing: function() { return processing; }, _processing: function(v) { processing = v; },
    loopActive: function() { return loopActive; }, _loopActive: function(v) { loopActive = v; },
    loopAvailable: function() { return loopAvailable; }, _loopAvailable: function(v) { loopAvailable = v; },
    loopIteration: function() { return loopIteration; }, _loopIteration: function(v) { loopIteration = v; },
    loopMaxIterations: function() { return loopMaxIterations; }, _loopMaxIterations: function(v) { loopMaxIterations = v; },
    loopBannerName: function() { return loopBannerName; }, _loopBannerName: function(v) { loopBannerName = v; },
    ralphPhase: function() { return ralphPhase; }, _ralphPhase: function(v) { ralphPhase = v; },
    ralphCraftingSessionId: function() { return ralphCraftingSessionId; }, _ralphCraftingSessionId: function(v) { ralphCraftingSessionId = v; },
    ralphCraftingSource: function() { return ralphCraftingSource; }, _ralphCraftingSource: function(v) { ralphCraftingSource = v; },
    ralphFilesReady: function() { return ralphFilesReady; }, _ralphFilesReady: function(v) { ralphFilesReady = v; },
    ralphPreviewContent: function() { return ralphPreviewContent; }, _ralphPreviewContent: function(v) { ralphPreviewContent = v; },
    pendingMateInterview: function() { return pendingMateInterview; }, _pendingMateInterview: function(v) { pendingMateInterview = v; },
    pendingTermCommand: function() { return pendingTermCommand; }, _pendingTermCommand: function(v) { pendingTermCommand = v; },
    activeSessionId: function() { return activeSessionId; }, _activeSessionId: function(v) { activeSessionId = v; },
    cliSessionId: function() { return cliSessionId; }, _cliSessionId: function(v) { cliSessionId = v; },
    isHeadlessMode: function() { return isHeadlessMode; }, _isHeadlessMode: function(v) { isHeadlessMode = v; },
    cachedMatesList: function() { return cachedMatesList; }, _cachedMatesList: function(v) { cachedMatesList = v; },
    cachedDmFavorites: function() { return cachedDmFavorites; }, _cachedDmFavorites: function(v) { cachedDmFavorites = v; },
    cachedAvailableBuiltins: function() { return cachedAvailableBuiltins; }, _cachedAvailableBuiltins: function(v) { cachedAvailableBuiltins = v; },
    // Read-only mutable state (processMessage reads but doesn't reassign)
    currentMsgEl: function() { return currentMsgEl; },
    currentFullText: function() { return currentFullText; },
    debateFloorMode: function() { return debateFloorMode; },
    debateConcludeMode: function() { return debateConcludeMode; },
    debateEndedMode: function() { return debateEndedMode; },
    ctxPopoverVisible: function() { return ctxPopoverVisible; },
    headerContextEl: function() { return headerContextEl; },
    myUserId: function() { return myUserId; },
    mateProjectSlug: function() { return mateProjectSlug; },
    dmKey: function() { return dmKey; },
    isMultiUserMode: function() { return isMultiUserMode; },
    sessionDrafts: function() { return sessionDrafts; },
    messageUuidMap: function() { return messageUuidMap; },
    knownInstalledSkills: function() { return knownInstalledSkills; },
    dmUnread: function() { return dmUnread; },
    dmRemovedUsers: function() { return dmRemovedUsers; },
    cachedAllUsers: function() { return cachedAllUsers; },
    cachedOnlineIds: function() { return cachedOnlineIds; },
    cachedDmConversations: function() { return cachedDmConversations; },
    matePreThinkingEl: function() { return matePreThinkingEl; },
  };
  // Wire up defineProperty for each state var
  Object.keys(_msgStateProps).forEach(function(key) {
    if (key.charAt(0) === "_") return; // skip setter helpers
    var getter = _msgStateProps[key];
    var setter = _msgStateProps["_" + key];
    var desc = { get: getter, enumerable: true };
    if (setter) desc.set = setter;
    Object.defineProperty(_msgCtx, key, desc);
  });
  initMessages(_msgCtx);

  // --- Connection module ---
  initConnection({
    getWs: function () { return ws; },
    setWs: function (v) { ws = v; },
    isConnected: function () { return connected; },
    setConnected: function (v) { connected = v; },
    setProcessing: function (v) { processing = v; },
    getWsPath: function () { return wsPath; },
    getStatusDot: getStatusDot,
    sendBtn: sendBtn,
    connectOverlay: connectOverlay,
    setSendBtnMode: setSendBtnMode,
    hasSendableContent: hasSendableContent,
    startVerbCycle: startVerbCycle,
    stopVerbCycle: stopVerbCycle,
    blinkIO: blinkIO,
    isNotifAlertEnabled: isNotifAlertEnabled,
    closeDmUserPicker: closeDmUserPicker,
    setActivity: setActivity,
    processMessage: processMessage,
    onConnected: function () {
      // Reset terminal xterm instances (server will send fresh term_list)
      resetTerminals();

      // Re-send push subscription on reconnect
      if (window._pushSubscription) {
        try {
          ws.send(JSON.stringify({
            type: "push_subscribe",
            subscription: window._pushSubscription.toJSON(),
          }));
        } catch(e) {}
      }

      // Request mates list
      try {
        ws.send(JSON.stringify({ type: "mate_list" }));
      } catch(e) {}

      // If connecting to a mate project, request knowledge list for badge
      if (mateProjectSlug) {
        try { ws.send(JSON.stringify({ type: "knowledge_list" })); } catch(e) {}
      }

      // Session restore is now server-driven (user-presence.json).
      // Mate DM restore is also server-driven via "restore_mate_dm" message.
      // Fallback: if server doesn't restore DM within 2s, try localStorage
      var savedDm = null;
      try { savedDm = localStorage.getItem("clay-active-dm"); } catch (e) {}
      if (savedDm && !dmMode && !mateProjectSlug) {
        var dmFallbackTimer = setTimeout(function () {
          if (!dmMode && savedDm) {
            console.log("[dm-restore] Server did not restore DM, using localStorage fallback:", savedDm);
            openDm(savedDm);
          }
        }, 2000);
        // Cancel fallback if server restores DM first
        var patchedOnce = false;
        var checkRestore = function (evt) {
          try {
            var d = JSON.parse(evt.data);
            if (d.type === "restore_mate_dm" && !patchedOnce) {
              patchedOnce = true;
              clearTimeout(dmFallbackTimer);
            }
          } catch (e) {}
        };
        ws.addEventListener("message", checkRestore);
        setTimeout(function () { ws.removeEventListener("message", checkRestore); }, 3000);
      }
      // Safety: clear returningFromMateDm after initial messages settle
      if (returningFromMateDm) {
        setTimeout(function () {
          if (returningFromMateDm) {
            returningFromMateDm = false;
          }
        }, 2000);
      }
    },
  });

  // --- Init ---
  lucide.createIcons();
  connect();
  if (!currentSlug) {
    showHomeHub();
  } else if (location.hash === "#scheduler") {
    // Restore scheduler view after refresh
    setTimeout(function () { openSchedulerToTab("calendar"); }, 500);
  } else {
    inputEl.focus();
  }
