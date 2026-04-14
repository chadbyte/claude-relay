import { avatarUrl, userAvatarUrl, mateAvatarUrl } from './modules/avatar.js';
import { showToast, copyToClipboard, escapeHtml } from './modules/utils.js';
import { refreshIcons, iconHtml } from './modules/icons.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks, closeMermaidModal, parseEmojis } from './modules/markdown.js';
import { initSidebar, updatePageTitle, spawnDustParticles } from './modules/sidebar.js';
import {
  renderSessionList, handleSearchResults, updateSessionPresence,
  updateSessionBadge, populateCliSessionList
} from './modules/sidebar-sessions.js';
import {
  renderIconStrip, getEmojiCategories, updateProjectBadge
} from './modules/sidebar-projects.js';
import {
  renderUserStrip, closeDmUserPicker, setCurrentDmUser,
  updateDmBadge, renderSidebarPresence
} from './modules/sidebar-mates.js';
import {
  openMobileSheet, setMobileSheetMateData, refreshMobileChatSheet
} from './modules/sidebar-mobile.js';
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
import { initFavicon, updateFavicon as _favUpdateFavicon, setSendBtnMode as _favSetSendBtnMode, blinkIO as _favBlinkIO, blinkSessionDot as _favBlinkSessionDot, updateCrossProjectBlink as _favUpdateCrossProjectBlink, startUrgentBlink as _favStartUrgentBlink, stopUrgentBlink as _favStopUrgentBlink, setActivity as _favSetActivity, drawFaviconAnimFrame as _favDrawFaviconAnimFrame } from './modules/app-favicon.js';
import { initHeader, closeSessionInfoPopover as _hdrCloseSessionInfoPopover, updateHistorySentinel as _hdrUpdateHistorySentinel, requestMoreHistory as _hdrRequestMoreHistory, prependOlderHistory as _hdrPrependOlderHistory } from './modules/app-header.js';
import { initMisc, showImageModal as _miscShowImageModal, closeImageModal as _miscCloseImageModal, showPasteModal as _miscShowPasteModal, closePasteModal as _miscClosePasteModal, showConfirm as _miscShowConfirm, hideConfirm as _miscHideConfirm, showForceChangePinOverlay as _miscShowForceChangePinOverlay, sendExtensionCommand as _miscSendExtensionCommand, handleExtensionResult as _miscHandleExtensionResult } from './modules/app-misc.js';
import { initSkillInstall, requireSkills as _siRequireSkills, requireClayMateInterview as _siRequireClayMateInterview, handleSkillInstallWs as _siHandleSkillInstallWs, getKnownInstalledSkills, setKnownInstalledSkills } from './modules/app-skills-install.js';
import { initDebateUi, showDebateConcludeConfirm as _debShowDebateConcludeConfirm, exitDebateConcludeMode as _debExitDebateConcludeMode, handleDebateConcludeSend as _debHandleDebateConcludeSend, showDebateEndedMode as _debShowDebateEndedMode, exitDebateEndedMode as _debExitDebateEndedMode, showDebateUserFloor as _debShowDebateUserFloor, exitDebateFloorMode as _debExitDebateFloorMode, handleDebateFloorSend as _debHandleDebateFloorSend, renderDebateUserFloorDone as _debRenderDebateUserFloorDone, showDebateSticky as _debShowDebateSticky, showDebateBottomBar as _debShowDebateBottomBar, removeDebateBottomBar as _debRemoveDebateBottomBar, sendDebateStickyComment as _debSendDebateStickyComment, updateDebateRound as _debUpdateDebateRound, getDebateStickyState, setDebateStickyState, getDebateFloorMode, getDebateConcludeMode, getDebateEndedMode } from './modules/app-debate-ui.js';
import { initLoopUi, updateLoopInputVisibility as _loopUpdateLoopInputVisibility, updateLoopButton as _loopUpdateLoopButton, showLoopBanner as _loopShowLoopBanner, updateLoopBanner as _loopUpdateLoopBanner, updateRalphBars as _loopUpdateRalphBars, showRalphCraftingBar as _loopShowRalphCraftingBar, showRalphApprovalBar as _loopShowRalphApprovalBar, updateRalphApprovalStatus as _loopUpdateRalphApprovalStatus, openRalphPreviewModal as _loopOpenRalphPreviewModal, showExecModal as _loopShowExecModal, closeExecModal as _loopCloseExecModal, updateExecModalStatus as _loopUpdateExecModalStatus, getLoopActive, setLoopActive, getLoopAvailable, setLoopAvailable, getLoopIteration, setLoopIteration, getLoopMaxIterations, setLoopMaxIterations, getLoopBannerName, setLoopBannerName, getRalphPhase, setRalphPhase, getRalphCraftingSessionId, setRalphCraftingSessionId, getRalphCraftingSource, setRalphCraftingSource, getRalphFilesReady, setRalphFilesReady, getRalphPreviewContent, setRalphPreviewContent, getExecModalShown, setExecModalShown } from './modules/app-loop-ui.js';
import { initLoopWizard, openRalphWizard as _loopOpenRalphWizard, closeRalphWizard as _loopCloseRalphWizard, getWizardData, setWizardData, getWizardSource as _loopGetWizardSource } from './modules/app-loop-wizard.js';
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

  // --- DM (delegated to app-dm.js) ---
  function openDm(userId) { _dmOpenDm(userId); }
  function enterDmMode(key, targetUser, messages) { _dmEnterDmMode(key, targetUser, messages); }
  function exitDmMode(skipProjectSwitch) { _dmExitDmMode(skipProjectSwitch); }
  function handleMateCreatedInApp(mate, msg) { _dmHandleMateCreatedInApp(mate, msg); }
  function renderAvailableBuiltins(builtins) { _dmRenderAvailableBuiltins(builtins); }
  function buildMateInterviewPrompt(mate) { return _dmBuildMateInterviewPrompt(mate); }
  function updateMateIconStatus(msg) { _dmUpdateMateIconStatus(msg); }
  function connectMateProject(slug) { _dmConnectMateProject(slug); }
  function disconnectMateProject() { _dmDisconnectMateProject(); }
  function appendDmMessage(msg) { _dmAppendDmMessage(msg); }
  function showDmTypingIndicator(show) { _dmShowDmTypingIndicator(show); }
  function handleDmSend() { _dmHandleDmSend(); }

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

  // showImageModal, closeImageModal -> modules/app-misc.js
  function showImageModal(src) { _miscShowImageModal(src); }
  function closeImageModal() { _miscCloseImageModal(); }

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
  // ralphPhase, ralphCraftingSessionId, ralphCraftingSource, ralphFilesReady, ralphPreviewContent -> modules/app-loop-ui.js
  // wizardStep, wizardSource, wizardData, loopModeChoice, promptAuthor, judgeAuthor -> modules/app-loop-wizard.js
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
  // historySentinelObserver -> modules/app-header.js

  // builtinCommands -> modules/input.js

  // --- Header session rename, session info popover -> modules/app-header.js
  function closeSessionInfoPopover() { _hdrCloseSessionInfoPopover(); }

  // --- Modals (confirm, paste) -> modules/app-misc.js
  function showPasteModal(text) { _miscShowPasteModal(text); }
  function closePasteModal() { _miscClosePasteModal(); }
  function showConfirm(text, onConfirm, okLabel, destructive) { _miscShowConfirm(text, onConfirm, okLabel, destructive); }
  function hideConfirm() { _miscHideConfirm(); }

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

  // --- Favicon, IO blink, status/activity -> modules/app-favicon.js
  function startPixelAnim() {}
  function stopPixelAnim() {}
  function updateFavicon(bgColor) { _favUpdateFavicon(bgColor); }
  function setSendBtnMode(mode) { _favSetSendBtnMode(mode); }
  function blinkIO() { _favBlinkIO(); }
  function blinkSessionDot(sessionId) { _favBlinkSessionDot(sessionId); }
  function updateCrossProjectBlink() { _favUpdateCrossProjectBlink(); }
  function startUrgentBlink() { _favStartUrgentBlink(); }
  function stopUrgentBlink() { _favStopUrgentBlink(); }
  function setStatus(status) { _connSetStatus(status); }
  function setActivity(text) { _favSetActivity(text); }

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

  // --- Misc module (modals, PWA, extension bridge, force PIN) ---
  initMisc({
    $: $,
    getWs: function () { return ws; },
    updateBrowserTabList: updateBrowserTabList,
  });

  // --- Favicon module ---
  initFavicon({
    sendBtn: sendBtn,
    get basePath() { return basePath; },
    onThemeChange: onThemeChange,
    getStatusDot: getStatusDot,
    addToMessages: addToMessages,
    scrollToBottom: scrollToBottom,
    getActivityEl: getActivityEl,
    setActivityEl: setActivityEl,
    get connected() { return connected; },
    get dmMode() { return dmMode; },
    get dmTargetUser() { return dmTargetUser; },
    get currentSlug() { return currentSlug; },
  });

  // --- Header module (rename, info popover, history) ---
  initHeader({
    $: $,
    messagesEl: messagesEl,
    headerTitleEl: headerTitleEl,
    headerRenameBtn: headerRenameBtn,
    headerInfoBtn: $("header-info-btn"),
    getWs: function () { return ws; },
    get connected() { return connected; },
    get activeSessionId() { return activeSessionId; },
    get cliSessionId() { return cliSessionId; },
    get historyFrom() { return historyFrom; },
    set historyFrom(v) { historyFrom = v; },
    get loadingMore() { return loadingMore; },
    set loadingMore(v) { loadingMore = v; },
    // Rendering state accessors for prependOlderHistory
    getCurrentMsgEl: getCurrentMsgEl, setCurrentMsgEl: setCurrentMsgEl,
    getActivityEl: getActivityEl, setActivityEl: setActivityEl,
    getCurrentFullText: getCurrentFullText, setCurrentFullText: setCurrentFullText,
    getTurnCounter: getTurnCounter, setTurnCounter: setTurnCounter,
    saveToolState: saveToolState, resetToolState: resetToolState, restoreToolState: restoreToolState,
    getContextData: getContextData, setContextData: setContextData,
    getSessionUsage: getSessionUsage, setSessionUsage: setSessionUsage,
    setPrependAnchor: setPrependAnchor, getPrependAnchor: getPrependAnchor,
    processMessage: processMessage,
    finalizeAssistantBlock: finalizeAssistantBlock,
    updateContextPanel: updateContextPanel,
    updateUsagePanel: updateUsagePanel,
    onSessionSearchHistoryPrepended: onSessionSearchHistoryPrepended,
  });

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
  var loopUiCtx = {
    getWs: function () { return ws; },
    get activeSessionId() { return activeSessionId; },
    get basePath() { return basePath; },
    showConfirm: showConfirm,
    requireSkills: requireSkills,
    openSchedulerToTab: openSchedulerToTab,
    openRalphWizard: openRalphWizard,
    showDebateSticky: showDebateSticky,
    get debateStickyState() { return getDebateStickyState(); },
    getWizardData: function () { return getWizardData(); },
    getExecModalShown: function () { return getExecModalShown(); },
    setExecModalShown: function (v) { setExecModalShown(v); },
  };
  initLoopUi(loopUiCtx);

  initLoopWizard({
    getWs: function () { return ws; },
    requireSkills: requireSkills,
    setExecModalShown: function (v) { setExecModalShown(v); },
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


  // --- Progressive history loading -> modules/app-header.js
  function updateHistorySentinel() { _hdrUpdateHistorySentinel(); }
  function requestMoreHistory() { _hdrRequestMoreHistory(); }
  function prependOlderHistory(items, meta) { _hdrPrependOlderHistory(items, meta); }

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
    getDmMateId: function () { return (dmMode && dmTargetUser && dmTargetUser.isMate) ? dmTargetUser.id : null; },
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

  // --- Force PIN change overlay -> modules/app-misc.js
  function showForceChangePinOverlay() { _miscShowForceChangePinOverlay(); }

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

  // --- Chrome Extension Bridge -> modules/app-misc.js
  function sendExtensionCommand(command, args, requestId) { _miscSendExtensionCommand(command, args, requestId); }
  function handleExtensionResult(requestId, result) { _miscHandleExtensionResult(requestId, result); }

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

  // --- Ralph Loop UI (delegated to app-loop-ui.js + app-loop-wizard.js) ---
  function updateLoopInputVisibility(loop) { _loopUpdateLoopInputVisibility(loop); }
  function updateLoopButton() { _loopUpdateLoopButton(); }
  function showLoopBanner(show) { _loopShowLoopBanner(show); }
  function updateLoopBanner(iteration, maxIterations, phase) { _loopUpdateLoopBanner(iteration, maxIterations, phase); }
  function updateRalphBars() { _loopUpdateRalphBars(); }
  function showRalphCraftingBar(show) { _loopShowRalphCraftingBar(show); }
  function showRalphApprovalBar(show) { _loopShowRalphApprovalBar(show); }
  function updateRalphApprovalStatus() { _loopUpdateRalphApprovalStatus(); }
  function openRalphPreviewModal() { _loopOpenRalphPreviewModal(); }
  function showExecModal() { _loopShowExecModal(); }
  function closeExecModal() { _loopCloseExecModal(); }
  function updateExecModalStatus() { _loopUpdateExecModalStatus(); }

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

  // --- Ralph Wizard (delegated to app-loop-wizard.js) ---
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
    requireClayRalph: function (cb) {
      requireSkills({
        title: "Skill Installation Required",
        reason: "This feature requires the following skill to be installed.",
        skills: [{ name: "clay-ralph", url: "https://github.com/chadbyte/clay-ralph", scope: "global" }]
      }, cb);
    },
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

  // --- PWA install prompt -> modules/app-misc.js (set up in initMisc)


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
    checkAdminAccess: checkAdminAccess,
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
    showExecModal: showExecModal,
    closeExecModal: closeExecModal,
    updateExecModalStatus: updateExecModalStatus,
    getExecModalShown: function () { return getExecModalShown(); },
    setWizardData: function (v) { setWizardData(v); },
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
