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
import { initSkillInstall, requireSkills as _siRequireSkills, requireClayMateInterview as _siRequireClayMateInterview, handleSkillInstallWs as _siHandleSkillInstallWs, getKnownInstalledSkills, setKnownInstalledSkills } from './modules/app-skills-install.js';
import { initDebateUi, showDebateConcludeConfirm as _debShowDebateConcludeConfirm, exitDebateConcludeMode as _debExitDebateConcludeMode, handleDebateConcludeSend as _debHandleDebateConcludeSend, showDebateEndedMode as _debShowDebateEndedMode, exitDebateEndedMode as _debExitDebateEndedMode, showDebateUserFloor as _debShowDebateUserFloor, exitDebateFloorMode as _debExitDebateFloorMode, handleDebateFloorSend as _debHandleDebateFloorSend, renderDebateUserFloorDone as _debRenderDebateUserFloorDone, showDebateSticky as _debShowDebateSticky, showDebateBottomBar as _debShowDebateBottomBar, removeDebateBottomBar as _debRemoveDebateBottomBar, sendDebateStickyComment as _debSendDebateStickyComment, updateDebateRound as _debUpdateDebateRound, getDebateStickyState, setDebateStickyState, getDebateFloorMode, getDebateConcludeMode, getDebateEndedMode } from './modules/app-debate-ui.js';
import { initLoopUi, updateLoopInputVisibility as _loopUpdateLoopInputVisibility, updateLoopButton as _loopUpdateLoopButton, showLoopBanner as _loopShowLoopBanner, updateLoopBanner as _loopUpdateLoopBanner, updateRalphBars as _loopUpdateRalphBars, openRalphWizard as _loopOpenRalphWizard, closeRalphWizard as _loopCloseRalphWizard, showRalphCraftingBar as _loopShowRalphCraftingBar, showRalphApprovalBar as _loopShowRalphApprovalBar, updateRalphApprovalStatus as _loopUpdateRalphApprovalStatus, openRalphPreviewModal as _loopOpenRalphPreviewModal, getLoopActive, setLoopActive, getLoopAvailable, setLoopAvailable, getLoopIteration, setLoopIteration, getLoopMaxIterations, setLoopMaxIterations, getLoopBannerName, setLoopBannerName, getRalphPhase, setRalphPhase, getRalphCraftingSessionId, setRalphCraftingSessionId, getRalphCraftingSource, setRalphCraftingSource, getRalphFilesReady, setRalphFilesReady, getRalphPreviewContent, setRalphPreviewContent, getWizardData } from './modules/app-loop-ui.js';
import { initPanels, updateConfigChip as _panUpdateConfigChip, getModelEffortLevels as _panGetModelEffortLevels, accumulateUsage as _panAccumulateUsage, updateUsagePanel as _panUpdateUsagePanel, resetUsage as _panResetUsage, toggleUsagePanel as _panToggleUsagePanel, formatTokens as _panFormatTokens, updateStatusPanel as _panUpdateStatusPanel, requestProcessStats as _panRequestProcessStats, toggleStatusPanel as _panToggleStatusPanel, accumulateContext as _panAccumulateContext, updateContextPanel as _panUpdateContextPanel, resetContext as _panResetContext, resetContextData as _panResetContextData, minimizeContext as _panMinimizeContext, expandContext as _panExpandContext, toggleContextPanel as _panToggleContextPanel, getContextView as _panGetContextView, renderCtxPopover as _panRenderCtxPopover, hideCtxPopover as _panHideCtxPopover, formatBytes as _panFormatBytes, formatUptime as _panFormatUptime, getModelSupportsEffort as _panGetModelSupportsEffort, getCurrentModel, setCurrentModel, getCurrentModels, setCurrentModels, getCurrentMode, setCurrentMode, getCurrentEffort, setCurrentEffort, getCurrentBetas, setCurrentBetas, getCurrentThinking, setCurrentThinking, getCurrentThinkingBudget, setCurrentThinkingBudget, getSessionUsage, setSessionUsage, getContextData, setContextData, getHeaderContextEl as _panGetHeaderContextEl, setHeaderContextEl as _panSetHeaderContextEl, getRichContextUsage, setRichContextUsage, getCtxPopoverVisible, setContextView as _panSetContextView, applyContextView as _panApplyContextView } from './modules/app-panels.js';
import { initProjects, updateProjectList as _projUpdateProjectList, renderProjectList as _projRenderProjectList, renderTopbarPresence as _projRenderTopbarPresence, switchProject as _projSwitchProject, resetClientState as _projResetClientState, confirmRemoveProject as _projConfirmRemoveProject, handleRemoveProjectCheckResult as _projHandleRemoveProjectCheckResult, handleRemoveProjectResult as _projHandleRemoveProjectResult, openAddProjectModal as _projOpenAddProjectModal, closeAddProjectModal as _projCloseAddProjectModal, handleBrowseDirResult as _projHandleBrowseDirResult, handleAddProjectResult as _projHandleAddProjectResult, handleCloneProgress as _projHandleCloneProgress, showUpdateAvailable as _projShowUpdateAvailable, getCachedProjects, setCachedProjects, getCachedProjectCount, getCachedRemovedProjects, setCachedRemovedProjects } from './modules/app-projects.js';
import { initRendering, addToMessages as _renAddToMessages, scrollToBottom as _renScrollToBottom, forceScrollToBottom as _renForceScrollToBottom, addUserMessage as _renAddUserMessage, getMsgTime as _renGetMsgTime, shouldGroupMessage as _renShouldGroupMessage, ensureAssistantBlock as _renEnsureAssistantBlock, addCopyHandler as _renAddCopyHandler, appendDelta as _renAppendDelta, flushStreamBuffer as _renFlushStreamBuffer, finalizeAssistantBlock as _renFinalizeAssistantBlock, addSystemMessage as _renAddSystemMessage, addConflictMessage as _renAddConflictMessage, addContextOverflowMessage as _renAddContextOverflowMessage, addAuthRequiredMessage as _renAddAuthRequiredMessage, showClaudePreThinking as _renShowClaudePreThinking, showMatePreThinking as _renShowMatePreThinking, removeMatePreThinking as _renRemoveMatePreThinking, showSuggestionChips as _renShowSuggestionChips, hideSuggestionChips as _renHideSuggestionChips, getCurrentMsgEl, setCurrentMsgEl, getCurrentFullText, setCurrentFullText, getTurnCounter, setTurnCounter, getPrependAnchor, setPrependAnchor, getActivityEl, setActivityEl, getMatePreThinkingEl, getCurrentMsgTs, setCurrentMsgTs, getIsUserScrolledUp, setIsUserScrolledUp, getReplayingHistory, setReplayingHistory } from './modules/app-rendering.js';
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
  // cachedProjects, cachedProjectCount, cachedRemovedProjects -> modules/app-projects.js
  var currentProjectOwnerId = null;
  var currentSlug = slugMatch ? slugMatch[1] : null;

  // updateProjectList, renderTopbarPresence, renderProjectList -> modules/app-projects.js
  function updateProjectList(msg) { _projUpdateProjectList(msg); }
  function renderTopbarPresence(serverUsers) { _projRenderTopbarPresence(serverUsers); }
  function renderProjectList() { _projRenderProjectList(); }
  // projectListAddBtn listener -> modules/app-projects.js (initProjects)

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
  // activityEl, currentMsgEl, currentFullText, highlightTimer -> modules/app-rendering.js
  // tools, currentThinking -> modules/tools.js
  var activeSessionId = null;
  var sessionDrafts = {};
  // loopActive, loopAvailable, loopIteration, loopMaxIterations, loopBannerName,
  // ralphPhase, ralphCraftingSessionId, ralphCraftingSource, wizardStep, wizardSource,
  // wizardData, ralphFilesReady, ralphPreviewContent -> modules/app-loop-ui.js
  var slashCommands = [];
  // slashActiveIdx, slashFiltered, pendingImages, pendingPastes -> modules/input.js
  // pendingPermissions -> modules/tools.js
  var cliSessionId = null;
  var projectName = "";
  // turnCounter -> modules/app-rendering.js

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
  // prependAnchor, replayingHistory, isUserScrolledUp, scrollThreshold -> modules/app-rendering.js
  var loadingMore = false;
  var historySentinelObserver = null;

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
    get projectList() { return getCachedProjects() || []; },
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
    projectList: function () { return getCachedProjects() || []; },
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
      if (!getActivityEl()) {
        var _actEl = document.createElement("div");
        _actEl.className = "activity-inline";
        _actEl.innerHTML =
          '<div class="mate-thinking-dots"><span></span><span></span><span></span></div>';
        setActivityEl(_actEl);
        addToMessages(_actEl);
      }
      scrollToBottom();
    } else {
      if (getActivityEl()) {
        getActivityEl().remove();
        setActivityEl(null);
      }
    }
  }

  // --- Pre-thinking (delegated to app-rendering.js) ---
  function showClaudePreThinking() { _renShowClaudePreThinking(); }
  function showMatePreThinking() { _renShowMatePreThinking(); }
  function removeMatePreThinking() { _renRemoveMatePreThinking(); }

  // --- Config chip, usage, status, context panels (delegated to app-panels.js) ---
  // currentModels, currentModel, currentMode, currentEffort, currentBetas,
  // currentThinking, currentThinkingBudget, sessionUsage, contextData,
  // headerContextEl, richContextUsage, ctxPopoverVisible -> modules/app-panels.js
  var skipPermsEnabled = false;
  var isOsUsers = false;

  function updateConfigChip() { _panUpdateConfigChip(); }
  function getModelEffortLevels() { return _panGetModelEffortLevels(); }
  function getModelSupportsEffort() { return _panGetModelSupportsEffort(); }
  function formatTokens(n) { return _panFormatTokens(n); }
  function updateUsagePanel() { _panUpdateUsagePanel(); }
  function accumulateUsage(cost, usage) { _panAccumulateUsage(cost, usage); }
  function resetUsage() { _panResetUsage(); }
  function toggleUsagePanel() { _panToggleUsagePanel(); }
  function formatBytes(n) { return _panFormatBytes(n); }
  function formatUptime(s) { return _panFormatUptime(s); }
  function updateStatusPanel(data) { _panUpdateStatusPanel(data); }
  function requestProcessStats() { _panRequestProcessStats(); }
  function toggleStatusPanel() { _panToggleStatusPanel(); }
  function updateContextPanel() { _panUpdateContextPanel(); }
  function accumulateContext(cost, usage, modelUsage, lastStreamInputTokens) { _panAccumulateContext(cost, usage, modelUsage, lastStreamInputTokens); }
  function resetContext() { _panResetContext(); }
  function resetContextData() { _panResetContextData(); }
  function minimizeContext() { _panMinimizeContext(); }
  function expandContext() { _panExpandContext(); }
  function toggleContextPanel() { _panToggleContextPanel(); }
  function getContextView() { return _panGetContextView(); }
  function renderCtxPopover() { _panRenderCtxPopover(); }
  function hideCtxPopover() { _panHideCtxPopover(); }

  // addToMessages, scrollToBottom, forceScrollToBottom -> modules/app-rendering.js
  function addToMessages(el) { _renAddToMessages(el); }

  var newMsgBtn = $("new-msg-btn");
  var newMsgBtnDefault = "\u2193 Latest";
  var newMsgBtnActivity = "\u2193 New activity";

  messagesEl.addEventListener("scroll", function () {
    var distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    var scrolledUp = distFromBottom > 150;
    setIsUserScrolledUp(scrolledUp);
    if (scrolledUp) {
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

  function scrollToBottom() { _renScrollToBottom(); }
  function forceScrollToBottom() { _renForceScrollToBottom(); }

  // --- Skill Install module ---
  initSkillInstall({
    get basePath() { return basePath; },
  });

  // --- Debate UI module ---
  initDebateUi({
    getWs: function () { return ws; },
    inputEl: inputEl,
    messagesEl: messagesEl,
    scrollToBottom: scrollToBottom,
    exportDebateAsPdf: exportDebateAsPdf,
  });

  // --- Loop UI module ---
  initLoopUi({
    getWs: function () { return ws; },
    get activeSessionId() { return activeSessionId; },
    get basePath() { return basePath; },
    showConfirm: showConfirm,
    requireSkills: requireSkills,
    openSchedulerToTab: openSchedulerToTab,
    showDebateSticky: showDebateSticky,
    get debateStickyState() { return getDebateStickyState(); },
  });

  // --- Panels module ---
  initPanels({
    $: $,
    getWs: function () { return ws; },
    get skipPermsEnabled() { return skipPermsEnabled; },
    getReplayingHistory: function () { return getReplayingHistory(); },
    refreshIcons: refreshIcons,
  });

  // --- Rendering module ---
  initRendering({
    messagesEl: messagesEl,
    inputEl: inputEl,
    sendBtn: sendBtn,
    suggestionChipsEl: suggestionChipsEl,
    newMsgBtn: newMsgBtn,
    newMsgBtnDefault: newMsgBtnDefault,
    newMsgBtnActivity: newMsgBtnActivity,
    CLAUDE_CODE_AVATAR: CLAUDE_CODE_AVATAR,
    // Functions
    getScheduledMsgEl: getScheduledMsgEl,
    renderMarkdown: renderMarkdown,
    highlightCodeBlocks: highlightCodeBlocks,
    renderMermaidBlocks: renderMermaidBlocks,
    closeToolGroup: closeToolGroup,
    copyToClipboard: copyToClipboard,
    escapeHtml: escapeHtml,
    iconHtml: iconHtml,
    refreshIcons: refreshIcons,
    showImageModal: showImageModal,
    showPasteModal: showPasteModal,
    userAvatarUrl: userAvatarUrl,
    sendMessage: sendMessage,
    openTerminal: function () { openTerminal(); },
    getChatLayout: getChatLayout,
    getWs: function () { return ws; },
    getDmTargetUser: function () { return dmTargetUser; },
    setPendingTermCommand: function (v) { pendingTermCommand = v; },
    getProcessing: function () { return processing; },
    get myUserId() { return myUserId; },
    get cachedAllUsers() { return cachedAllUsers; },
  });

  // --- Tools module ---
  initTools({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get turnCounter() { return getTurnCounter(); },
    messagesEl: messagesEl,
    inputEl: inputEl,
    finalizeAssistantBlock: function() { finalizeAssistantBlock(); },
    addToMessages: function(el) { addToMessages(el); },
    scrollToBottom: function() { scrollToBottom(); },
    setActivity: function(text) { setActivity(text); },
    stopUrgentBlink: function() { stopUrgentBlink(); },
    showImageModal: showImageModal,
    getContextPercent: function() {
      var cd = getContextData();
      return cd.contextWindow > 0 ? Math.round((cd.input / cd.contextWindow) * 100) : 0;
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

  // --- DOM: Messages (delegated to app-rendering.js) ---
  function addUserMessage(text, images, pastes, fromUserId, fromUserName) { _renAddUserMessage(text, images, pastes, fromUserId, fromUserName); }
  function getMsgTime() { return _renGetMsgTime(); }
  function shouldGroupMessage(senderClass) { return _renShouldGroupMessage(senderClass); }
  function ensureAssistantBlock() { return _renEnsureAssistantBlock(); }
  function addCopyHandler(msgEl, rawText) { _renAddCopyHandler(msgEl, rawText); }
  function appendDelta(text) { _renAppendDelta(text); }
  function flushStreamBuffer() { _renFlushStreamBuffer(); }
  function finalizeAssistantBlock() { _renFinalizeAssistantBlock(); }
  function addSystemMessage(text, isError) { _renAddSystemMessage(text, isError); }
  function addConflictMessage(msg) { _renAddConflictMessage(msg); }
  function addContextOverflowMessage(msg) { _renAddContextOverflowMessage(msg); }

  // Pending command to run in the next created terminal
  var pendingTermCommand = null;

  function addAuthRequiredMessage(msg) { _renAddAuthRequiredMessage(msg); }

  // --- Rate Limit ---


  // --- Rate Limit / Scheduled Messages / Fast Mode (delegated to app-rate-limit.js) ---
  function handleRateLimitEvent(msg) { _rlHandleRateLimitEvent(msg); }
  function updateRateLimitUsage(msg) { _rlUpdateRateLimitUsage(msg); }
  function addScheduledMessageBubble(text, resetsAt) { _rlAddScheduledMessageBubble(text, resetsAt); }
  function removeScheduledMessageBubble() { _rlRemoveScheduledMessageBubble(); }
  function handleFastModeState(state) { _rlHandleFastModeState(state); }

  // --- Prompt suggestion chips (delegated to app-rendering.js) ---
  function showSuggestionChips(suggestion) { _renShowSuggestionChips(suggestion); }
  function hideSuggestionChips() { _renHideSuggestionChips(); }

  // resetClientState, switchProject -> modules/app-projects.js
  function resetClientState() { _projResetClientState(); }
  function switchProject(slug) { _projSwitchProject(slug); }

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

  function showUpdateAvailable(msg) { _projShowUpdateAvailable(msg); }

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
    var savedMsgEl = getCurrentMsgEl();
    var savedActivity = getActivityEl();
    var savedFullText = getCurrentFullText();
    var savedTurnCounter = getTurnCounter();
    var savedToolsState = saveToolState();
    // Save context & usage so old result messages don't overwrite current values
    var savedContext = JSON.parse(JSON.stringify(getContextData()));
    var savedUsage = JSON.parse(JSON.stringify(getSessionUsage()));

    // Reset to initial values for clean rendering
    setCurrentMsgEl(null);
    setActivityEl(null);
    setCurrentFullText("");
    setTurnCounter(0);
    resetToolState();

    // Set prepend anchor to insert before existing content
    // Skip the sentinel itself when setting anchor
    var firstReal = messagesEl.querySelector(".history-sentinel");
    setPrependAnchor(firstReal ? firstReal.nextSibling : messagesEl.firstChild);

    // Remember the first existing content element and its position
    var anchorEl = getPrependAnchor();
    var anchorOffset = anchorEl ? anchorEl.getBoundingClientRect().top : 0;

    // Process each item through the rendering pipeline
    for (var i = 0; i < items.length; i++) {
      processMessage(items[i]);
    }

    // Finalize any open assistant block from the batch
    finalizeAssistantBlock();

    // Clear prepend mode
    setPrependAnchor(null);

    // Restore saved state
    setCurrentMsgEl(savedMsgEl);
    setActivityEl(savedActivity);
    setCurrentFullText(savedFullText);
    setTurnCounter(savedTurnCounter);
    restoreToolState(savedToolsState);
    // Restore context & usage (old result messages must not overwrite current values)
    setContextData(savedContext);
    setSessionUsage(savedUsage);
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
    setTurnCounter(turnEls.length);

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
    isDebateEndedMode: function () { return getDebateEndedMode(); },
    handleDebateEndedSend: function () { handleDebateEndedSend(); },
    isDebateConcludeMode: function () { return getDebateConcludeMode(); },
    handleDebateConcludeSend: function () { handleDebateConcludeSend(); },
    isDebateFloorMode: function () { return getDebateFloorMode(); },
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
    get projectList() { return getCachedProjects(); },
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
    get currentModels() { return getCurrentModels(); },
    set currentModels(v) { setCurrentModels(v); updateConfigChip(); },
    get currentModel() { return getCurrentModel(); },
    get currentMode() { return getCurrentMode(); },
    get currentEffort() { return getCurrentEffort(); },
    get currentBetas() { return getCurrentBetas(); },
    get currentThinking() { return getCurrentThinking(); },
    get currentThinkingBudget() { return getCurrentThinkingBudget(); },
    setContextView: function (v) { _panSetContextView(v); },
    applyContextView: function (v) { _panApplyContextView(v); },
  });

  // --- Project Settings ---
  initProjectSettings({
    get ws() { return ws; },
    get connected() { return connected; },
    get currentModels() { return getCurrentModels(); },
    get currentModel() { return getCurrentModel(); },
    get currentMode() { return getCurrentMode(); },
    get currentEffort() { return getCurrentEffort(); },
    get currentBetas() { return getCurrentBetas(); },
    get currentThinking() { return getCurrentThinking(); },
    get currentThinkingBudget() { return getCurrentThinkingBudget(); },
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

  // --- Ralph Loop UI (delegated to app-loop-ui.js) ---
  function updateLoopInputVisibility(loop) { _loopUpdateLoopInputVisibility(loop); }
  function updateLoopButton() { _loopUpdateLoopButton(); }
  function showLoopBanner(show) { _loopShowLoopBanner(show); }
  function updateLoopBanner(iteration, maxIterations, phase) { _loopUpdateLoopBanner(iteration, maxIterations, phase); }
  function updateRalphBars() { _loopUpdateRalphBars(); }
  function showRalphCraftingBar(show) { _loopShowRalphCraftingBar(show); }
  function showRalphApprovalBar(show) { _loopShowRalphApprovalBar(show); }
  function updateRalphApprovalStatus() { _loopUpdateRalphApprovalStatus(); }
  function openRalphPreviewModal() { _loopOpenRalphPreviewModal(); }

  // --- Skill install dialog (delegated to app-skills-install.js) ---
  // knownInstalledSkills, pendingSkillInstalls -> modules/app-skills-install.js
  function requireSkills(opts, cb) { _siRequireSkills(opts, cb); }
  function requireClayMateInterview(cb) { _siRequireClayMateInterview(cb); }
  function handleSkillInstallWs(msg) { _siHandleSkillInstallWs(msg); }


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

  // --- Ralph Wizard, Sticky bars, Approval (delegated to app-loop-ui.js) ---
  function openRalphWizard(source) { _loopOpenRalphWizard(source); }
  function closeRalphWizard() { _loopCloseRalphWizard(); }

  // --- Debate UI (delegated to app-debate-ui.js) ---
  // debateStickyState, debateHandRaiseOpen, debateFloorMode, debateConcludeMode, debateEndedMode -> modules/app-debate-ui.js
  function showDebateConcludeConfirm(msg) { _debShowDebateConcludeConfirm(msg); }
  function exitDebateConcludeMode() { _debExitDebateConcludeMode(); }
  function handleDebateConcludeSend() { _debHandleDebateConcludeSend(); }
  function showDebateEndedMode(msg) { _debShowDebateEndedMode(msg); }
  function exitDebateEndedMode() { _debExitDebateEndedMode(); }
  function showDebateUserFloor(msg) { _debShowDebateUserFloor(msg); }
  function exitDebateFloorMode() { _debExitDebateFloorMode(); }
  function handleDebateFloorSend() { _debHandleDebateFloorSend(); }
  function renderDebateUserFloorDone(msg) { _debRenderDebateUserFloorDone(msg); }
  function showDebateSticky(phase, msg) { _debShowDebateSticky(phase, msg); }
  function showDebateBottomBar(mode, msg) { _debShowDebateBottomBar(mode, msg); }
  function removeDebateBottomBar() { _debRemoveDebateBottomBar(); }
  function sendDebateStickyComment() { _debSendDebateStickyComment(); }
  function updateDebateRound(round) { _debUpdateDebateRound(round); }

  // --- Ralph Preview Modal (delegated to app-loop-ui.js) ---

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
    getProjects: function () { return getCachedProjects(); },
  });

  // --- Remove/Add project (delegated to app-projects.js) ---
  function confirmRemoveProject(slug, name) { _projConfirmRemoveProject(slug, name); }
  function handleRemoveProjectCheckResult(msg) { _projHandleRemoveProjectCheckResult(msg); }
  function handleRemoveProjectResult(msg) { _projHandleRemoveProjectResult(msg); }
  function openAddProjectModal() { _projOpenAddProjectModal(); }
  function closeAddProjectModal() { _projCloseAddProjectModal(); }
  function handleBrowseDirResult(msg) { _projHandleBrowseDirResult(msg); }
  function handleAddProjectResult(msg) { _projHandleAddProjectResult(msg); }
  function handleCloneProgress(msg) { _projHandleCloneProgress(msg); }

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

  // --- Projects module ---
  initProjects({
    $: $,
    messagesEl: messagesEl,
    newMsgBtn: newMsgBtn,
    connectOverlay: connectOverlay,
    userAvatarUrl: userAvatarUrl,
    renderUserStrip: renderUserStrip,
    renderIconStrip: renderIconStrip,
    updateCrossProjectBlink: updateCrossProjectBlink,
    showConfirm: showConfirm,
    showToast: showToast,
    showHomeHub: showHomeHub,
    hideHomeHub: hideHomeHub,
    isHomeHubVisible: isHomeHubVisible,
    spawnDustParticles: spawnDustParticles,
    getStatusDot: getStatusDot,
    // Rendering state accessors
    setCurrentMsgEl: setCurrentMsgEl,
    setCurrentFullText: setCurrentFullText,
    setTurnCounter: setTurnCounter,
    setPrependAnchor: setPrependAnchor,
    setActivityEl: setActivityEl,
    setIsUserScrolledUp: setIsUserScrolledUp,
    // Reset helpers
    closeSearch: function () { if (isSearchOpen()) closeSearch(); },
    resetToolState: resetToolState,
    clearPendingImages: clearPendingImages,
    setRewindMode: function (v) { setRewindMode(v); },
    setActivity: setActivity,
    setStatus: setStatus,
    enableMainInput: enableMainInput,
    resetUsage: resetUsage,
    resetTurnMetaCost: resetTurnMetaCost,
    resetContext: resetContext,
    resetRateLimitState: resetRateLimitState,
    hideSuggestionChips: hideSuggestionChips,
    closeSessionInfoPopover: closeSessionInfoPopover,
    stopUrgentBlink: stopUrgentBlink,
    resetDebateState: resetDebateState,
    removeDebateBottomBar: removeDebateBottomBar,
    // Project switching helpers
    exitDmMode: exitDmMode,
    resetFileBrowser: resetFileBrowser,
    closeArchive: closeArchive,
    hideMemory: hideMemory,
    isSchedulerOpen: isSchedulerOpen,
    closeScheduler: closeScheduler,
    resetScheduler: resetScheduler,
    connect: function () { connect(); },
    cancelReconnect: function () { _connCancelReconnect(); },
    getWs: function () { return ws; },
    setWs: function (v) { ws = v; },
    setConnected: function (v) { connected = v; },
    setProcessing: function (v) { processing = v; },
    setCurrentSlug: function (v) { currentSlug = v; },
    setBasePath: function (v) { basePath = v; },
    setWsPath: function (v) { wsPath = v; },
    setMessageUuidMap: function (v) { messageUuidMap = v; },
    setHistoryFrom: function (v) { historyFrom = v; },
    setHistoryTotal: function (v) { historyTotal = v; },
    setLoadingMore: function (v) { loadingMore = v; },
    getHeaderContextEl: function () { return _panGetHeaderContextEl(); },
    setHeaderContextEl: function (v) { _panSetHeaderContextEl(v); },
    setDebateStickyState: function (v) { setDebateStickyState(v); },
    setCachedOnlineIds: function (v) { cachedOnlineIds = v; },
    setCachedAllUsers: function (v) { cachedAllUsers = v; },
    setCachedDmFavorites: function (v) { cachedDmFavorites = v; },
    setCachedDmConversations: function (v) { cachedDmConversations = v; },
    get currentSlug() { return currentSlug; },
    get connected() { return connected; },
    get processing() { return processing; },
    get loopActive() { return getLoopActive(); },
    get dmMode() { return dmMode; },
    get dmTargetUser() { return dmTargetUser; },
    get activeSessionId() { return activeSessionId; },
    get isHeadlessMode() { return isHeadlessMode; },
    get isOsUsers() { return isOsUsers; },
    get mateProjectSlug() { return mateProjectSlug; },
    get savedMainSlug() { return savedMainSlug; },
    get myUserId() { return myUserId; },
    get cachedAllUsers() { return cachedAllUsers; },
    get cachedOnlineIds() { return cachedOnlineIds; },
    get cachedDmFavorites() { return cachedDmFavorites; },
    get cachedDmConversations() { return cachedDmConversations; },
    get dmUnread() { return dmUnread; },
    get dmRemovedUsers() { return dmRemovedUsers; },
    get cachedMatesList() { return cachedMatesList; },
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
    get cachedProjects() { return getCachedProjects(); },
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
    cachedProjects: function() { return getCachedProjects(); },
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
    currentMsgTs: function() { return getCurrentMsgTs(); }, _currentMsgTs: function(v) { setCurrentMsgTs(v); },
    dmMode: function() { return dmMode; }, _dmMode: function(v) { dmMode = v; },
    dmTargetUser: function() { return dmTargetUser; },
    ws: function() { return ws; },
    historyFrom: function() { return historyFrom; }, _historyFrom: function(v) { historyFrom = v; },
    historyTotal: function() { return historyTotal; }, _historyTotal: function(v) { historyTotal = v; },
    replayingHistory: function() { return getReplayingHistory(); }, _replayingHistory: function(v) { setReplayingHistory(v); },
    richContextUsage: function() { return getRichContextUsage(); }, _richContextUsage: function(v) { setRichContextUsage(v); },
    projectName: function() { return projectName; }, _projectName: function(v) { projectName = v; },
    currentSlug: function() { return currentSlug; }, _currentSlug: function(v) { currentSlug = v; },
    currentProjectOwnerId: function() { return currentProjectOwnerId; }, _currentProjectOwnerId: function(v) { currentProjectOwnerId = v; },
    isOsUsers: function() { return isOsUsers; }, _isOsUsers: function(v) { isOsUsers = v; },
    skipPermsEnabled: function() { return skipPermsEnabled; }, _skipPermsEnabled: function(v) { skipPermsEnabled = v; },
    currentModel: function() { return getCurrentModel(); }, _currentModel: function(v) { setCurrentModel(v); },
    currentModels: function() { return getCurrentModels(); }, _currentModels: function(v) { setCurrentModels(v); },
    currentMode: function() { return getCurrentMode(); }, _currentMode: function(v) { setCurrentMode(v); },
    currentEffort: function() { return getCurrentEffort(); }, _currentEffort: function(v) { setCurrentEffort(v); },
    currentBetas: function() { return getCurrentBetas(); }, _currentBetas: function(v) { setCurrentBetas(v); },
    currentThinking: function() { return getCurrentThinking(); }, _currentThinking: function(v) { setCurrentThinking(v); },
    currentThinkingBudget: function() { return getCurrentThinkingBudget(); }, _currentThinkingBudget: function(v) { setCurrentThinkingBudget(v); },
    slashCommands: function() { return slashCommands; }, _slashCommands: function(v) { slashCommands = v; },
    returningFromMateDm: function() { return returningFromMateDm; }, _returningFromMateDm: function(v) { returningFromMateDm = v; },
    processing: function() { return processing; }, _processing: function(v) { processing = v; },
    loopActive: function() { return getLoopActive(); }, _loopActive: function(v) { setLoopActive(v); },
    loopAvailable: function() { return getLoopAvailable(); }, _loopAvailable: function(v) { setLoopAvailable(v); },
    loopIteration: function() { return getLoopIteration(); }, _loopIteration: function(v) { setLoopIteration(v); },
    loopMaxIterations: function() { return getLoopMaxIterations(); }, _loopMaxIterations: function(v) { setLoopMaxIterations(v); },
    loopBannerName: function() { return getLoopBannerName(); }, _loopBannerName: function(v) { setLoopBannerName(v); },
    ralphPhase: function() { return getRalphPhase(); }, _ralphPhase: function(v) { setRalphPhase(v); },
    ralphCraftingSessionId: function() { return getRalphCraftingSessionId(); }, _ralphCraftingSessionId: function(v) { setRalphCraftingSessionId(v); },
    ralphCraftingSource: function() { return getRalphCraftingSource(); }, _ralphCraftingSource: function(v) { setRalphCraftingSource(v); },
    ralphFilesReady: function() { return getRalphFilesReady(); }, _ralphFilesReady: function(v) { setRalphFilesReady(v); },
    ralphPreviewContent: function() { return getRalphPreviewContent(); }, _ralphPreviewContent: function(v) { setRalphPreviewContent(v); },
    pendingMateInterview: function() { return pendingMateInterview; }, _pendingMateInterview: function(v) { pendingMateInterview = v; },
    pendingTermCommand: function() { return pendingTermCommand; }, _pendingTermCommand: function(v) { pendingTermCommand = v; },
    activeSessionId: function() { return activeSessionId; }, _activeSessionId: function(v) { activeSessionId = v; },
    cliSessionId: function() { return cliSessionId; }, _cliSessionId: function(v) { cliSessionId = v; },
    isHeadlessMode: function() { return isHeadlessMode; }, _isHeadlessMode: function(v) { isHeadlessMode = v; },
    cachedMatesList: function() { return cachedMatesList; }, _cachedMatesList: function(v) { cachedMatesList = v; },
    cachedDmFavorites: function() { return cachedDmFavorites; }, _cachedDmFavorites: function(v) { cachedDmFavorites = v; },
    cachedAvailableBuiltins: function() { return cachedAvailableBuiltins; }, _cachedAvailableBuiltins: function(v) { cachedAvailableBuiltins = v; },
    // Read-only mutable state (processMessage reads but doesn't reassign)
    currentMsgEl: function() { return getCurrentMsgEl(); },
    currentFullText: function() { return getCurrentFullText(); },
    debateFloorMode: function() { return getDebateFloorMode(); },
    debateConcludeMode: function() { return getDebateConcludeMode(); },
    debateEndedMode: function() { return getDebateEndedMode(); },
    ctxPopoverVisible: function() { return getCtxPopoverVisible(); },
    headerContextEl: function() { return _panGetHeaderContextEl(); },
    myUserId: function() { return myUserId; },
    mateProjectSlug: function() { return mateProjectSlug; },
    dmKey: function() { return dmKey; },
    isMultiUserMode: function() { return isMultiUserMode; },
    sessionDrafts: function() { return sessionDrafts; },
    messageUuidMap: function() { return messageUuidMap; },
    knownInstalledSkills: function() { return getKnownInstalledSkills(); },
    dmUnread: function() { return dmUnread; },
    dmRemovedUsers: function() { return dmRemovedUsers; },
    cachedAllUsers: function() { return cachedAllUsers; },
    cachedOnlineIds: function() { return cachedOnlineIds; },
    cachedDmConversations: function() { return cachedDmConversations; },
    matePreThinkingEl: function() { return getMatePreThinkingEl(); },
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
