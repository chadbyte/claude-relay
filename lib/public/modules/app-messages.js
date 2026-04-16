// app-messages.js - WebSocket message router
// Extracted from app.js (PR-23)
// All dependencies are direct imports; no context injection needed.

import { store } from './store.js';
import { getWs } from './ws-ref.js';

// --- Leaf module imports ---
import { showToast } from './utils.js';
import { refreshIcons, iconHtml } from './icons.js';
import { renderMarkdown } from './markdown.js';
import { updatePageTitle } from './sidebar.js';
import { renderSessionList, updateSessionPresence, populateCliSessionList, handleSearchResults, updateSessionBadge } from './sidebar-sessions.js';
import { renderUserStrip, updateDmBadge, renderSidebarPresence } from './sidebar-mates.js';
import { refreshMobileChatSheet } from './sidebar-mobile.js';
import { renderMateSessionList, handleMateSearchResults, updateMateSidebarProfile } from './mate-sidebar.js';
import { renderKnowledgeList, handleKnowledgeContent } from './mate-knowledge.js';
import { renderMemoryList } from './mate-memory.js';
import { handlePaletteSessionSwitch, setPaletteVersion } from './command-palette.js';
import { handleFindInSessionResults } from './session-search.js';
import { handleInputSync, autoResize, builtinCommands, setScheduleBtnDisabled } from './input.js';
import { startThinking, appendThinking, stopThinking, resetThinkingGroup, createToolItem, updateToolExecuting, updateToolResult, markAllToolsDone, closeToolGroup, removeToolFromGroup, resetToolState, getTools, getPlanContent, setPlanContent, renderPlanBanner, renderPlanCard, getTodoTools, handleTodoWrite, handleTaskCreate, handleTaskUpdate, isPlanFilePath, enableMainInput, addTurnMeta, updateSubagentActivity, addSubagentToolEntry, markSubagentDone, initSubagentStop, updateSubagentProgress, renderAskUserQuestion, markAskUserAnswered, renderPermissionRequest, markPermissionCancelled, markPermissionResolved, renderElicitationRequest, markElicitationResolved } from './tools.js';
import { showDoneNotification, playDoneSound, isNotifAlertEnabled, isNotifSoundEnabled } from './notifications.js';
import { handleFsList, handleFsRead, handleFileChanged, handleDirChanged, handleFileHistory, handleGitDiff, handleFileAt, refreshIfOpen, getPendingNavigate } from './filebrowser.js';
import { isProjectSettingsOpen, handleInstructionsRead, handleInstructionsWrite, handleProjectEnv, handleProjectEnvSaved, handleProjectSharedEnv, handleProjectSharedEnvSaved, handleProjectOwnerChanged } from './project-settings.js';
import { updateSettingsModels, updateSettingsStats, updateDaemonConfig, handleSetPinResult, handleKeepAwakeChanged, handleAutoContinueChanged, handleRestartResult, handleShutdownResult, handleSharedEnv, handleSharedEnvSaved, handleGlobalClaudeMdRead, handleGlobalClaudeMdWrite } from './server-settings.js';
import { handleTermList, handleTermCreated, sendTerminalCommand, handleTermOutput, handleTermResized, handleTermExited, handleTermClosed } from './terminal.js';
import { updateTerminalList, handleContextSourcesState } from './context-sources.js';
import { handleNotesList, handleNoteCreated, handleNoteUpdated, handleNoteDeleted } from './sticky-notes.js';
import { handleSkillInstalled, handleSkillUninstalled } from './skills.js';
import { showRewindModal, onRewindComplete, setRewindMode, onRewindError, clearPendingRewindUuid, addRewindButton } from './rewind.js';
import { checkAdminAccess } from './admin.js';
import { mateAvatarUrl } from './avatar.js';
import { showImageModal, sendExtensionCommand, handleMcpToolCallMessage } from './app-misc.js';
import { handleMcpServersState } from './mcp-ui.js';
import { handleLoopRegistryUpdated, handleScheduleRunStarted, handleScheduleRunFinished, handleLoopScheduled, isSchedulerOpen, enterCraftingMode, exitCraftingMode, handleLoopRegistryFiles } from './scheduler.js';

// --- App module imports ---
import { scrollToBottom, addToMessages, addUserMessage, addSystemMessage, removeMatePreThinking, appendDelta, finalizeAssistantBlock, addConflictMessage, addContextOverflowMessage, addAuthRequiredMessage, showSuggestionChips } from './app-rendering.js';
import { setActivity, startUrgentBlink, stopUrgentBlink, blinkSessionDot } from './app-favicon.js';
import { setStatus } from './app-connection.js';
import { updateConfigChip, getModelEffortLevels, accumulateUsage, updateUsagePanel, accumulateContext, updateContextPanel, renderCtxPopover, updateStatusPanel } from './app-panels.js';
import { updateProjectList, resetClientState, showUpdateAvailable, handleRemoveProjectCheckResult, handleRemoveProjectResult, handleBrowseDirResult, handleAddProjectResult, handleCloneProgress } from './app-projects.js';
import { updateHistorySentinel, prependOlderHistory } from './app-header.js';
import { hideHomeHub, handleHubSchedules } from './app-home-hub.js';
import { openDm, enterDmMode, exitDmMode, handleMateCreatedInApp, updateMateIconStatus, appendDmMessage, showDmTypingIndicator, buildMateInterviewPrompt } from './app-dm.js';
import { handleRateLimitEvent, updateRateLimitUsage, addScheduledMessageBubble, removeScheduledMessageBubble, handleFastModeState } from './app-rate-limit.js';
import { handleRemoteCursorMove, handleRemoteCursorLeave, handleRemoteSelection, clearRemoteCursors } from './app-cursors.js';
import { updateLoopButton, showLoopBanner, updateLoopBanner, updateRalphBars, updateLoopInputVisibility, showRalphApprovalBar, updateRalphApprovalStatus, openRalphPreviewModal, showExecModal, updateExecModalStatus } from './app-loop-ui.js';
import { showDebateSticky, showDebateConcludeConfirm, showDebateUserFloor, exitDebateFloorMode, exitDebateConcludeMode, exitDebateEndedMode, updateDebateRound, renderDebateUserFloorDone } from './app-debate-ui.js';
import { handleSkillInstallWs } from './app-skills-install.js';
import { handleNotificationsState, handleNotificationCreated, handleNotificationDismissed, handleNotificationDismissedAll } from './app-notifications.js';
import { handleDebatePreparing, handleDebateBriefReady, renderDebateBriefReady, handleDebateStarted, renderDebateStarted, handleDebateTurn, handleDebateActivity, handleDebateStream, handleDebateTurnDone, handleDebateCommentQueued, handleDebateCommentInjected, renderDebateCommentInjected, handleDebateResumed, handleDebateEnded, renderDebateEnded, handleDebateError, isDebateActive, renderMcpDebateProposal, renderDebateUserResume } from './debate.js';
import { handleMentionStart, handleMentionActivity, handleMentionStream, handleMentionDone, handleMentionError, renderMentionUser, renderMentionResponse } from './mention.js';

// --- DOM refs (cached once, stable for page lifetime) ---
var messagesEl = document.getElementById("messages");
var headerTitleEl = document.getElementById("header-title");
var inputEl = document.getElementById("input");
var connectOverlay = document.getElementById("connect-overlay");

export function processMessage(msg) {
    // Preserve original timestamp from history replay
    store.setState({ currentMsgTs: msg._ts || null });
    var isMateDm = store.getState().dmMode && store.getState().dmTargetUser && store.getState().dmTargetUser.isMate;

    // DEBUG: trace session/history loading
    if (msg.type === "session_switched" || msg.type === "history_meta" || msg.type === "history_done" || msg.type === "mention_user" || msg.type === "mention_response") {
      console.log("[DEBUG msg]", msg.type, msg.type === "session_switched" ? "id=" + msg.id + " cli=" + (msg.cliSessionId || "").substring(0, 8) : "", msg.type === "history_meta" ? "from=" + msg.from + " total=" + msg.total : "", msg.type === "mention_user" ? "mate=" + msg.mateName : "", "dmMode=" + store.getState().dmMode);
    }

    // Mate DM: update mate icon status indicators
    if (isMateDm) updateMateIconStatus(msg);

    // Mate DM: intercept mate-specific messages
    if (isMateDm) {
      if (msg.type === "session_list") {
        renderMateSessionList(msg.sessions || []);
        refreshMobileChatSheet();
        // Override title bar with mate name and re-apply color
        var _mdn = (store.getState().dmTargetUser.displayName || "New Mate");
        if (headerTitleEl) headerTitleEl.textContent = _mdn;
        var _tbpn = document.getElementById("title-bar-project-name");
        if (_tbpn) _tbpn.textContent = _mdn;
        var _mc2 = (store.getState().dmTargetUser.profile && store.getState().dmTargetUser.profile.avatarColor) || store.getState().dmTargetUser.avatarColor || "#7c3aed";
        var _tbc2 = document.querySelector(".title-bar-content");
        if (_tbc2) { _tbc2.style.background = _mc2; _tbc2.classList.add("mate-dm-active"); }
        document.body.classList.add("mate-dm-active");
        // Still let normal session_list handler run below
      }
      if (msg.type === "search_results") {
        handleMateSearchResults(msg);
        return;
      }
      if (msg.type === "knowledge_list") {
        renderKnowledgeList(msg.files);
        return;
      }
      if (msg.type === "knowledge_content") {
        handleKnowledgeContent(msg);
        return;
      }
      if (msg.type === "knowledge_saved" || msg.type === "knowledge_deleted" || msg.type === "knowledge_promoted" || msg.type === "knowledge_depromoted") {
        return;
      }
      if (msg.type === "memory_list") {
        renderMemoryList(msg.entries, msg.summary);
        return;
      }
      if (msg.type === "memory_deleted") {
        return;
      }
      // On done: scan DOM for [[MATE_READY: name]], update name, strip marker
      if (msg.type === "done") {
        setTimeout(function () { scrollToBottom(); }, 100);
        setTimeout(function () { scrollToBottom(); }, 400);
        setTimeout(function () {
          var fullText = messagesEl ? messagesEl.textContent : "";
          var readyMatch = fullText.match(/\[\[MATE_READY:\s*(.+?)\]\]/);
          if (readyMatch) {
            var newName = readyMatch[1].trim();
            store.getState().dmTargetUser.displayName = newName;
            updateMateSidebarProfile({ profile: { displayName: newName, avatarColor: store.getState().dmTargetUser.avatarColor, avatarStyle: store.getState().dmTargetUser.avatarStyle, avatarSeed: store.getState().dmTargetUser.avatarSeed } });
            if (getWs() && getWs().readyState === 1) {
              getWs().send(JSON.stringify({
                type: "mate_update",
                mateId: store.getState().dmTargetUser.id,
                updates: { name: newName, status: "ready", profile: { displayName: newName } },
              }));
            }
          }
          var walker = document.createTreeWalker(messagesEl, NodeFilter.SHOW_TEXT, null, false);
          var node;
          while (node = walker.nextNode()) {
            if (node.nodeValue.indexOf("[[MATE_READY:") !== -1) {
              node.nodeValue = node.nodeValue.replace(/\[\[MATE_READY:\s*.+?\]\]/g, "").trim();
            }
          }
        }, 100);
      }
    }

    switch (msg.type) {
      case "history_meta":
        store.setState({ historyFrom: msg.from, historyTotal: msg.total, replayingHistory: true });
        updateHistorySentinel();
        break;

      case "history_prepend":
        prependOlderHistory(msg.items, msg.meta);
        break;

      case "history_done":
        store.setState({ replayingHistory: false });
        // Restore cached rich context usage BEFORE updateContextPanel runs
        if (msg.contextUsage) {
          store.setState({ richContextUsage: msg.contextUsage });
        }
        // Restore accurate context data from the last result in full history
        if (msg.lastUsage || msg.lastModelUsage) {
          accumulateContext(msg.lastCost, msg.lastUsage, msg.lastModelUsage, msg.lastStreamInputTokens);
        }
        updateContextPanel();
        updateUsagePanel();
        // Render + finalize any incomplete turn from the replayed history
        var _hs = store.getState();
        if (_hs.currentMsgEl && _hs.currentFullText) {
          var replayContentEl = _hs.currentMsgEl.querySelector(".md-content");
          if (replayContentEl) {
            replayContentEl.innerHTML = renderMarkdown(_hs.currentFullText);
          }
        }
        markAllToolsDone();
        finalizeAssistantBlock();
        stopUrgentBlink();
        // Clean up debate UI if debate is not active after replay
        if (!isDebateActive()) {
          var dbBar = document.getElementById("debate-bottom-bar");
          if (dbBar) dbBar.remove();
          var dhBar = document.getElementById("debate-hand-raise-bar");
          if (dhBar) dhBar.remove();
          var dbBadges = document.querySelectorAll(".debate-header-badge");
          for (var dbi = 0; dbi < dbBadges.length; dbi++) dbBadges[dbi].remove();
          // Clean up all debate mode banners if debate is not active on this session
          var _ds = store.getState();
          if (_ds.debateFloorMode) exitDebateFloorMode();
          if (_ds.debateConcludeMode) exitDebateConcludeMode();
          if (_ds.debateEndedMode) exitDebateEndedMode();
          var dbBanner = document.getElementById("debate-floor-banner");
          if (dbBanner) dbBanner.remove();
        }
        scrollToBottom();
        // Scroll to tool element if navigating from file edit history
        var nav = getPendingNavigate();
        if (nav && (nav.toolId || nav.assistantUuid)) {
          requestAnimationFrame(function() {
            // Prefer scrolling to the exact tool element
            var target = nav.toolId ? messagesEl.querySelector('[data-tool-id="' + nav.toolId + '"]') : null;
            if (!target && nav.assistantUuid) {
              target = messagesEl.querySelector('[data-uuid="' + nav.assistantUuid + '"]');
            }
            if (target) {
              // Auto-expand parent tool group if collapsed
              var parentGroup = target.closest(".tool-group");
              if (parentGroup) parentGroup.classList.remove("collapsed");
              target.scrollIntoView({ behavior: "smooth", block: "center" });
              target.classList.add("message-blink");
              setTimeout(function() { target.classList.remove("message-blink"); }, 2000);
            }
          });
        }
        break;

      case "restore_mate_dm":
        if (msg.mateId && !store.getState().returningFromMateDm) {
          // Server-driven mate DM restore on reconnect
          // Note: do NOT remove mate-dm-active here; openDm is async (skill check)
          // and removing the class causes a flash where mate UI is lost.
          // enterDmMode will properly set/reset the class when DM is entered.
          if (store.getState().dmMode) {
            store.setState({ dmMode: false });
          }
          messagesEl.innerHTML = "";
          openDm(msg.mateId);
        }
        // Clear the flag and notify server that mate DM is closed
        if (store.getState().returningFromMateDm) {
          store.setState({ returningFromMateDm: false });
          if (getWs() && getWs().readyState === 1) {
            try { getWs().send(JSON.stringify({ type: "set_mate_dm", mateId: null })); } catch(e) {}
          }
        }
        break;

      case "info":
        if (msg.text && !msg.project && !msg.cwd) {
          addSystemMessage(msg.text, false);
          break;
        }
        store.setState({ projectName: msg.project || msg.cwd });
        if (msg.slug) store.setState({ currentSlug: msg.slug });
        try { var _is = store.getState(); localStorage.setItem("clay-project-name-" + (_is.currentSlug || "default"), _is.projectName); } catch (e) {}
        // In mate DM, keep title as mate name and re-apply mate color
        if (store.getState().dmMode && store.getState().dmTargetUser && store.getState().dmTargetUser.isMate) {
          var _mateDN = store.getState().dmTargetUser.displayName || "New Mate";
          headerTitleEl.textContent = _mateDN;
          var tbProjectName = document.getElementById("title-bar-project-name");
          if (tbProjectName) tbProjectName.textContent = _mateDN;
          // Re-apply mate title bar styling (may be lost during project switch)
          var _mc = (store.getState().dmTargetUser.profile && store.getState().dmTargetUser.profile.avatarColor) || store.getState().dmTargetUser.avatarColor || "#7c3aed";
          var _tbc = document.querySelector(".title-bar-content");
          if (_tbc) { _tbc.style.background = _mc; _tbc.classList.add("mate-dm-active"); }
          document.body.classList.add("mate-dm-active");
        } else {
          headerTitleEl.textContent = store.getState().projectName;
          var tbProjectName = document.getElementById("title-bar-project-name");
          if (tbProjectName) tbProjectName.textContent = msg.title || store.getState().projectName;
        }
        updatePageTitle();
        if (msg.version) {
          setPaletteVersion(msg.version);
          var serverVersionEl = document.getElementById("settings-server-version");
          if (serverVersionEl) serverVersionEl.textContent = msg.version;
        }
        if (msg.projectOwnerId !== undefined) store.setState({ currentProjectOwnerId: msg.projectOwnerId });
        if (msg.ownerLocked !== undefined) store.setState({ ownerLocked: !!msg.ownerLocked });
        if (msg.osUsers !== undefined) store.setState({ isOsUsers: !!msg.osUsers });
        if (msg.lanHost) window.__lanHost = msg.lanHost;
        if (msg.dangerouslySkipPermissions) {
          store.setState({ skipPermsEnabled: true });
          var spBanner = document.getElementById("skip-perms-pill");
          if (spBanner) spBanner.classList.remove("hidden");
        }
        updateProjectList(msg);
        break;

      case "update_available":
        // In multi-user mode, only show update UI to admins
        if (store.getState().isMultiUserMode) {
          checkAdminAccess().then(function (isAdmin) {
            if (!isAdmin) return;
            showUpdateAvailable(msg);
          });
        } else {
          showUpdateAvailable(msg);
        }
        break;

      case "up_to_date":
        var utdBtn = document.getElementById("settings-update-check");
        if (utdBtn) {
          utdBtn.innerHTML = "";
          var utdIcon = document.createElement("i");
          utdIcon.setAttribute("data-lucide", "check");
          utdBtn.appendChild(utdIcon);
          utdBtn.appendChild(document.createTextNode(" Up to date (v" + msg.version + ")"));
          utdBtn.disabled = true;
          refreshIcons();
          setTimeout(function () {
            utdBtn.innerHTML = "";
            var rwIcon = document.createElement("i");
            rwIcon.setAttribute("data-lucide", "refresh-cw");
            utdBtn.appendChild(rwIcon);
            utdBtn.appendChild(document.createTextNode(" Check for updates"));
            utdBtn.disabled = false;
            utdBtn.classList.remove("settings-btn-update-available");
            refreshIcons();
          }, 3000);
        }
        break;

      case "update_started":
        var updNowBtn = document.getElementById("update-now");
        if (updNowBtn) {
          updNowBtn.innerHTML = '<i data-lucide="loader"></i> Updating...';
          updNowBtn.disabled = true;
          refreshIcons();
          var spinIcon = updNowBtn.querySelector(".lucide");
          if (spinIcon) spinIcon.classList.add("icon-spin-inline");
        }
        // Block the entire screen with the connect overlay
        connectOverlay.classList.remove("hidden");
        break;

      case "slash_commands":
        var reserved = new Set(builtinCommands.map(function (c) { return c.name; }));
        store.setState({ slashCommands: (msg.commands || []).filter(function (name) {
          return !reserved.has(name);
        }).map(function (name) {
          return { name: name, desc: "Skill" };
        }) });
        break;

      case "model_info":
        store.setState({ currentModel: msg.model || store.getState().currentModel, currentModels: msg.models || [] });
        updateConfigChip();
        updateSettingsModels(msg.model, msg.models || []);
        break;

      case "config_state": {
        var _cs = {};
        if (msg.model) _cs.currentModel = msg.model;
        if (msg.mode) _cs.currentMode = msg.mode;
        if (msg.effort) _cs.currentEffort = msg.effort;
        if (msg.betas) _cs.currentBetas = msg.betas;
        if (msg.thinking) _cs.currentThinking = msg.thinking;
        if (msg.thinkingBudget) _cs.currentThinkingBudget = msg.thinkingBudget;
        store.setState(_cs);
        // Validate effort against current model's supported levels
        var _csRead = store.getState();
        if (_csRead.currentModels.length > 0) {
          var levels = getModelEffortLevels();
          var effortValid = false;
          for (var ei = 0; ei < levels.length; ei++) {
            if (levels[ei] === _csRead.currentEffort) { effortValid = true; break; }
          }
          if (!effortValid) store.setState({ currentEffort: "medium" });
        }
        updateConfigChip();
        } break;

      case "client_count":
        // Sidebar presence: current project's online users
        if (msg.users) {
          renderSidebarPresence(msg.users);
        }
        // Non-multi-user mode: simple count in topbar
        if (!msg.users) {
          var countEl = document.getElementById("client-count");
          var countTextEl = document.getElementById("client-count-text");
          if (countEl && countTextEl) {
            if (msg.count > 1) {
              countTextEl.textContent = msg.count + " connected";
              countEl.classList.remove("hidden");
            } else {
              countEl.classList.add("hidden");
            }
          }
        }
        break;

      case "toast":
        showToast(msg.message, msg.level, msg.detail);
        break;

      case "skill_installed":
        handleSkillInstalled(msg);
        if (msg.success) { var _kis = Object.assign({}, store.getState().knownInstalledSkills); _kis[msg.skill] = true; store.setState({ knownInstalledSkills: _kis }); }
        handleSkillInstallWs(msg);
        break;

      case "skill_uninstalled":
        handleSkillUninstalled(msg);
        if (msg.success) { var _kis2 = Object.assign({}, store.getState().knownInstalledSkills); delete _kis2[msg.skill]; store.setState({ knownInstalledSkills: _kis2 }); }
        break;

      case "loop_registry_updated":
        handleLoopRegistryUpdated(msg);
        break;

      case "schedule_run_started":
        handleScheduleRunStarted(msg);
        break;

      case "schedule_run_finished":
        handleScheduleRunFinished(msg);
        break;

      case "loop_scheduled":
        handleLoopScheduled(msg);
        break;

      case "schedule_move_result":
        if (msg.ok) {
          showToast("Task moved", "success");
        } else {
          showToast(msg.error || "Failed to move task", "error");
        }
        break;

      case "remove_project_check_result":
        handleRemoveProjectCheckResult(msg);
        break;

      case "hub_schedules":
        handleHubSchedules(msg);
        break;

      case "input_sync":
        if (!store.getState().dmMode) handleInputSync(msg.text);
        break;

      case "session_list":
        renderMateSessionList(msg.sessions || []);
        renderSessionList(msg.sessions || []);
        handlePaletteSessionSwitch();
        break;

      case "session_presence":
        updateSessionPresence(msg.presence || {});
        break;

      case "cursor_move":
        handleRemoteCursorMove(msg);
        break;

      case "cursor_leave":
        handleRemoteCursorLeave(msg);
        break;

      case "text_select":
        handleRemoteSelection(msg);
        break;

      case "session_io":
        blinkSessionDot(msg.id);
        break;

      case "session_unread":
        updateSessionBadge(msg.id, msg.count);
        break;

      case "search_results":
        handleSearchResults(msg);
        break;

      case "search_content_results":
        if (msg.source === "find_in_session") {
          handleFindInSessionResults(msg);
        }
        break;

      case "cli_session_list":
        populateCliSessionList(msg.sessions || []);
        break;

      case "session_switched":
        hideHomeHub();
        // Save draft from outgoing session
        var _prevSid = store.getState().activeSessionId;
        if (_prevSid && inputEl.value) {
          store.getState().sessionDrafts[_prevSid] = inputEl.value;
        } else if (_prevSid) {
          delete store.getState().sessionDrafts[_prevSid];
        }
        store.setState({ activeSessionId: msg.id, cliSessionId: msg.cliSessionId || null });
        // Session presence is now tracked server-side (user-presence.json)
        clearRemoteCursors();
        resetClientState();
        updateRalphBars();
        updateLoopInputVisibility(msg.loop);
        // Restore input area visibility (may have been hidden by auth_required)
        var inputAreaSw = document.getElementById("input-area");
        if (inputAreaSw) inputAreaSw.classList.remove("hidden");
        // Restore draft for incoming session
        var draft = store.getState().sessionDrafts[store.getState().activeSessionId] || "";
        inputEl.value = draft;
        autoResize();
        if (!("ontouchstart" in window)) {
          inputEl.focus();
        }
        break;

      case "session_id":
        store.setState({ cliSessionId: msg.cliSessionId });
        break;

      case "message_uuid":
        var uuidTarget;
        if (msg.messageType === "user") {
          var allUsers = messagesEl.querySelectorAll(".msg-user:not([data-uuid])");
          if (allUsers.length > 0) uuidTarget = allUsers[allUsers.length - 1];
        } else {
          var allAssistants = messagesEl.querySelectorAll(".msg-assistant:not([data-uuid])");
          if (allAssistants.length > 0) uuidTarget = allAssistants[allAssistants.length - 1];
        }
        if (uuidTarget) {
          uuidTarget.dataset.uuid = msg.uuid;
          if (msg.messageType === "user") addRewindButton(uuidTarget);
        }
        store.getState().messageUuidMap.push({ uuid: msg.uuid, type: msg.messageType });
        break;

      case "user_message":
        if (msg._internal) break;
        resetThinkingGroup();
        if (msg.planContent) {
          setPlanContent(msg.planContent);
          renderPlanCard(msg.planContent);
          addUserMessage("Execute the following plan. Do NOT re-enter plan mode — just implement it step by step.", msg.images || null, msg.pastes || null, msg.from, msg.fromName);
        } else {
          addUserMessage(msg.text, msg.images || null, msg.pastes || null, msg.from, msg.fromName);
        }
        break;

      case "context_preview":
        // Show a Context Card with tab screenshot between user message and assistant response
        if (msg.tab) {
          var card = document.createElement("div");
          card.className = "context-card";

          // Header
          var header = document.createElement("div");
          header.className = "context-card-header";
          var icon = document.createElement("span");
          icon.className = "context-card-icon";
          icon.innerHTML = iconHtml("globe");
          header.appendChild(icon);
          var label = document.createElement("span");
          label.textContent = "Viewing tab";
          header.appendChild(label);
          card.appendChild(header);

          // Screenshot
          if (msg.tab.screenshotUrl) {
            var img = document.createElement("img");
            img.className = "context-card-screenshot";
            img.src = msg.tab.screenshotUrl;
            img.loading = "lazy";
            img.addEventListener("click", function () { showImageModal(this.src); });
            card.appendChild(img);
          }

          // Meta: title + domain
          var tabTitle = msg.tab.title || "";
          var tabDomain = "";
          try { tabDomain = new URL(msg.tab.url).hostname; } catch (e) {}
          if (tabTitle || tabDomain) {
            var meta = document.createElement("div");
            meta.className = "context-card-meta";
            if (msg.tab.favIconUrl) {
              var fav = document.createElement("img");
              fav.className = "context-card-favicon";
              fav.src = msg.tab.favIconUrl;
              fav.width = 14;
              fav.height = 14;
              fav.onerror = function () { this.style.display = "none"; };
              meta.appendChild(fav);
            }
            var titleEl = document.createElement("span");
            titleEl.className = "context-card-title";
            titleEl.textContent = tabTitle;
            meta.appendChild(titleEl);
            if (tabDomain) {
              var domainEl = document.createElement("span");
              domainEl.className = "context-card-domain";
              domainEl.textContent = tabDomain;
              meta.appendChild(domainEl);
            }
            card.appendChild(meta);
          }

          messagesEl.appendChild(card);
          scrollToBottom();
        }
        break;

      case "status":
        if (msg.status === "processing") {
          setStatus("processing");
          if (!(store.getState().dmMode && store.getState().dmTargetUser && store.getState().dmTargetUser.isMate) && !store.getState().matePreThinkingEl) {
            setActivity("thinking");
          }
        }
        break;

      case "compacting":
        if (msg.active) {
          setActivity("compacting");
        } else if (!(store.getState().dmMode && store.getState().dmTargetUser && store.getState().dmTargetUser.isMate)) {
          setActivity("thinking");
        }
        break;

      case "thinking_start":
        removeMatePreThinking();
        startThinking();
        break;

      case "thinking_delta":
        if (typeof msg.text === "string") appendThinking(msg.text);
        break;

      case "thinking_stop":
        stopThinking(msg.duration);
        if (!(store.getState().dmMode && store.getState().dmTargetUser && store.getState().dmTargetUser.isMate)) {
          setActivity("thinking");
        }
        break;

      case "delta":
        if (typeof msg.text !== "string") break;
        removeMatePreThinking();
        stopThinking();
        resetThinkingGroup();
        setActivity(null);
        appendDelta(msg.text);
        break;

      case "tool_start":
        removeMatePreThinking();
        stopThinking();
        markAllToolsDone();
        if (msg.name === "EnterPlanMode") {
          renderPlanBanner("enter");
          getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (msg.name === "ExitPlanMode") {
          if (getPlanContent()) {
            renderPlanCard(getPlanContent());
          }
          renderPlanBanner("exit");
          getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (msg.name === "propose_debate" || (msg.name && msg.name.indexOf("propose_debate") !== -1)) {
          getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (getTodoTools()[msg.name]) {
          getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else {
          createToolItem(msg.id, msg.name);
        }
        break;

      case "tool_executing":
        if ((msg.name === "propose_debate" || (msg.name && msg.name.indexOf("propose_debate") !== -1)) && msg.input) {
          var _dpTool = getTools()[msg.id];
          if (_dpTool) {
            if (_dpTool.el) _dpTool.el.style.display = "none";
            _dpTool.done = true;
            _dpTool.hidden = true;
            removeToolFromGroup(msg.id);
          }
          finalizeAssistantBlock();
          renderMcpDebateProposal(msg.id, msg.input);
          startUrgentBlink();
        } else if (msg.name === "AskUserQuestion" && msg.input && msg.input.questions) {
          var askTool = getTools()[msg.id];
          if (askTool) {
            if (askTool.el) askTool.el.style.display = "none";
            askTool.done = true;
            removeToolFromGroup(msg.id);
          }
          renderAskUserQuestion(msg.id, msg.input);
          startUrgentBlink();
        } else if (msg.name === "Write" && msg.input && isPlanFilePath(msg.input.file_path)) {
          setPlanContent(msg.input.content || "");
          updateToolExecuting(msg.id, msg.name, msg.input);
        } else if (msg.name === "Edit" && msg.input && isPlanFilePath(msg.input.file_path)) {
          var pc = getPlanContent() || "";
          if (msg.input.old_string && pc.indexOf(msg.input.old_string) !== -1) {
            if (msg.input.replace_all) {
              setPlanContent(pc.split(msg.input.old_string).join(msg.input.new_string || ""));
            } else {
              setPlanContent(pc.replace(msg.input.old_string, msg.input.new_string || ""));
            }
          }
          updateToolExecuting(msg.id, msg.name, msg.input);
        } else if (msg.name === "TodoWrite") {
          handleTodoWrite(msg.input);
        } else if (msg.name === "TaskCreate") {
          handleTaskCreate(msg.input);
        } else if (msg.name === "TaskUpdate") {
          handleTaskUpdate(msg.input);
        } else if (getTodoTools()[msg.name]) {
          // TaskList, TaskGet - silently skip
        } else {
          var t = getTools()[msg.id];
          if (t && t.hidden) break;
          updateToolExecuting(msg.id, msg.name, msg.input);
        }
        break;

      case "tool_result": {
          var tr = getTools()[msg.id];
          if (tr && tr.hidden) break; // skip hidden plan tools
          // Always call updateToolResult for Edit (to show diff from input), or when content exists
          if (msg.content != null || msg.images || (tr && tr.name === "Edit" && tr.input && tr.input.old_string)) {
            updateToolResult(msg.id, msg.content || "", msg.is_error || false, msg.images);
          }
          // Refresh file browser if an Edit/Write tool modified the open file
          if (!msg.is_error && tr && (tr.name === "Edit" || tr.name === "Write") && tr.input && tr.input.file_path) {
            refreshIfOpen(tr.input.file_path);
          }
        }
        break;

      case "ask_user_answered":
        markAskUserAnswered(msg.toolId, msg.answers);
        stopUrgentBlink();
        break;

      case "permission_request":
        renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason, msg.mateId);
        startUrgentBlink();
        break;

      case "permission_cancel":
        markPermissionCancelled(msg.requestId);
        stopUrgentBlink();
        break;

      case "permission_resolved":
        markPermissionResolved(msg.requestId, msg.decision);
        stopUrgentBlink();
        break;

      case "permission_request_pending":
        renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason, msg.mateId);
        startUrgentBlink();
        break;

      case "elicitation_request":
        renderElicitationRequest(msg);
        startUrgentBlink();
        break;

      case "elicitation_resolved":
        markElicitationResolved(msg.requestId, msg.action);
        stopUrgentBlink();
        break;

      case "slash_command_result":
        finalizeAssistantBlock();
        var cmdBlock = document.createElement("div");
        cmdBlock.className = "assistant-block";
        cmdBlock.style.maxWidth = "var(--content-width)";
        cmdBlock.style.margin = "12px auto";
        cmdBlock.style.padding = "0 20px";
        var pre = document.createElement("pre");
        pre.style.cssText = "background:var(--code-bg);border:1px solid var(--border-subtle);border-radius:10px;padding:12px 14px;font-family:'SF Mono',Menlo,Monaco,monospace;font-size:12px;line-height:1.55;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;max-height:400px;overflow-y:auto;margin:0";
        pre.textContent = msg.text;
        cmdBlock.appendChild(pre);
        addToMessages(cmdBlock);
        scrollToBottom();
        break;

      case "subagent_activity":
        updateSubagentActivity(msg.parentToolId, msg.text);
        break;

      case "subagent_tool":
        addSubagentToolEntry(msg.parentToolId, msg.toolName, msg.toolId, msg.text);
        break;

      case "subagent_done":
        markSubagentDone(msg.parentToolId, msg.status, msg.summary, msg.usage);
        break;

      case "task_started":
        initSubagentStop(msg.parentToolId, msg.taskId);
        break;

      case "task_progress":
        updateSubagentProgress(msg.parentToolId, msg.usage, msg.lastToolName, msg.summary);
        break;

      case "result":
        setActivity(null);
        stopThinking();
        markAllToolsDone();
        closeToolGroup();
        finalizeAssistantBlock();
        addTurnMeta(msg.cost, msg.duration);
        accumulateUsage(msg.cost, msg.usage);
        accumulateContext(msg.cost, msg.usage, msg.modelUsage, msg.lastStreamInputTokens);
        break;

      case "context_usage":
        if (msg.data && !store.getState().replayingHistory) {
          store.setState({ richContextUsage: msg.data });
          var _hce = store.getState().headerContextEl;
          if (_hce) _hce.removeAttribute("data-tip");
          if (store.getState().ctxPopoverVisible) renderCtxPopover();
        }
        break;

      case "done":
        setActivity(null);
        stopThinking();
        markAllToolsDone();
        closeToolGroup();
        finalizeAssistantBlock();
        store.setState({ processing: false });
        setStatus("connected");
        if (!store.getState().loopActive) enableMainInput();
        resetToolState();
        stopUrgentBlink();
        if (document.hidden) {
          if (isNotifAlertEnabled() && !window._pushSubscription) showDoneNotification();
          if (isNotifSoundEnabled()) playDoneSound();
        }
        break;

      case "stderr":
        addSystemMessage(msg.text, false);
        break;

      case "error":
        setActivity(null);
        addSystemMessage(msg.text, true);
        break;

      case "system_info":
        addSystemMessage(msg.text, false);
        break;

      case "process_conflict":
        setActivity(null);
        addConflictMessage(msg);
        break;

      case "context_overflow":
        setActivity(null);
        addContextOverflowMessage(msg);
        break;

      case "auth_required":
        setActivity(null);
        addAuthRequiredMessage(msg);
        break;

      case "rate_limit":
        handleRateLimitEvent(msg);
        break;

      case "rate_limit_usage":
        updateRateLimitUsage(msg);
        break;

      case "scheduled_message_queued":
        addScheduledMessageBubble(msg.text, msg.resetsAt);
        setScheduleBtnDisabled(true);
        break;

      case "scheduled_message_sent":
        removeScheduledMessageBubble();
        setScheduleBtnDisabled(false);
        store.setState({ processing: true });
        setStatus("processing");
        break;

      case "scheduled_message_cancelled":
        removeScheduledMessageBubble();
        setScheduleBtnDisabled(false);
        break;

      case "auto_continue_scheduled":
        // Scheduler auto-continue, just show info
        break;

      case "auto_continue_fired":
        store.setState({ processing: true });
        setStatus("processing");
        break;

      case "prompt_suggestion":
        showSuggestionChips(msg.suggestion);
        break;

      case "fast_mode_state":
        handleFastModeState(msg.state);
        break;

      case "process_killed":
        addSystemMessage("Process " + msg.pid + " has been terminated. You can retry your message now.", false);
        break;

      case "rewind_preview_result":
        showRewindModal(msg);
        break;

      case "rewind_complete":
        onRewindComplete();
        setRewindMode(false);
        var rewindText = "Rewound to earlier point. Files have been restored.";
        if (msg.mode === "chat") rewindText = "Conversation rewound to earlier point.";
        else if (msg.mode === "files") rewindText = "Files restored to earlier point.";
        addSystemMessage(rewindText, false);
        break;

      case "rewind_error":
        onRewindError();
        clearPendingRewindUuid();
        addSystemMessage(msg.text || "Rewind failed.", true);
        break;

      case "fork_complete":
        addSystemMessage("Session forked successfully.");
        break;

      case "fs_list_result":
        handleFsList(msg);
        break;

      case "fs_read_result":
        if (msg.path === "CLAUDE.md" && isProjectSettingsOpen()) {
          handleInstructionsRead(msg);
        } else {
          handleFsRead(msg);
        }
        break;

      case "fs_write_result":
        handleInstructionsWrite(msg);
        break;

      case "project_env_result":
        handleProjectEnv(msg);
        break;

      case "set_project_env_result":
        handleProjectEnvSaved(msg);
        break;

      case "global_claude_md_result":
        handleGlobalClaudeMdRead(msg);
        break;

      case "write_global_claude_md_result":
        handleGlobalClaudeMdWrite(msg);
        break;

      case "shared_env_result":
        handleSharedEnv(msg);
        handleProjectSharedEnv(msg);
        break;

      case "set_shared_env_result":
        handleSharedEnvSaved(msg);
        handleProjectSharedEnvSaved(msg);
        break;

      case "fs_file_changed":
        handleFileChanged(msg);
        break;

      case "fs_dir_changed":
        handleDirChanged(msg);
        break;

      case "fs_file_history_result":
        handleFileHistory(msg);
        break;

      case "fs_git_diff_result":
        handleGitDiff(msg);
        break;

      case "fs_file_at_result":
        handleFileAt(msg);
        break;

      case "term_list":
        handleTermList(msg);
        updateTerminalList(msg.terminals);
        break;

      case "context_sources_state":
        handleContextSourcesState(msg);
        break;

      case "extension_command":
        sendExtensionCommand(msg.command, msg.args, msg.requestId);
        break;

      case "mcp_tool_call":
        handleMcpToolCallMessage(msg);
        break;

      case "mcp_servers_state":
        handleMcpServersState(msg);
        break;

      case "term_created":
        handleTermCreated(msg);
        if (store.getState().pendingTermCommand) {
          var cmd = store.getState().pendingTermCommand;
          store.setState({ pendingTermCommand: null });
          // Small delay to let terminal initialize
          setTimeout(function() {
            sendTerminalCommand(cmd);
          }, 300);
        }
        break;

      case "term_output":
        handleTermOutput(msg);
        break;

      case "term_resized":
        handleTermResized(msg);
        break;

      case "term_exited":
        handleTermExited(msg);
        break;

      case "term_closed":
        handleTermClosed(msg);
        break;

      case "notes_list":
        handleNotesList(msg);
        break;

      case "note_created":
        handleNoteCreated(msg);
        break;

      case "note_updated":
        handleNoteUpdated(msg);
        break;

      case "note_deleted":
        handleNoteDeleted(msg);
        break;

      case "process_stats":
        updateStatusPanel(msg);
        updateSettingsStats(msg);
        break;

      case "browse_dir_result":
        handleBrowseDirResult(msg);
        break;

      case "add_project_result":
        handleAddProjectResult(msg);
        break;

      case "clone_project_progress":
        handleCloneProgress(msg);
        break;

      case "remove_project_result":
        handleRemoveProjectResult(msg);
        break;

      case "reorder_projects_result":
        if (!msg.ok) {
          showToast(msg.error || "Failed to reorder projects", "error");
        }
        break;

      case "set_project_title_result":
        if (!msg.ok) {
          showToast(msg.error || "Failed to rename project", "error");
        }
        break;

      case "set_project_icon_result":
        if (!msg.ok) {
          showToast(msg.error || "Failed to set icon", "error");
        }
        break;

      case "projects_updated":
        updateProjectList(msg);
        break;

      case "project_owner_changed":
        store.setState({ currentProjectOwnerId: msg.ownerId });
        handleProjectOwnerChanged(msg);
        break;

      // --- DM ---
      case "dm_history":
        // Attach projectSlug to targetUser for mate DMs
        if (msg.projectSlug && msg.targetUser) {
          msg.targetUser.projectSlug = msg.projectSlug;
        }
        enterDmMode(msg.dmKey, msg.targetUser, msg.messages);
        // Auto-send first interview prompt after mate DM opens
        if (store.getState().pendingMateInterview && msg.targetUser && msg.targetUser.isMate && msg.projectSlug) {
          var interviewMate = store.getState().pendingMateInterview;
          store.setState({ pendingMateInterview: null });
          // Wait for mate project WS to connect, then send interview prompt
          var checkMateReady = setInterval(function () {
            if (getWs() && getWs().readyState === 1 && store.getState().mateProjectSlug) {
              clearInterval(checkMateReady);
              var interviewText = buildMateInterviewPrompt(interviewMate);
              getWs().send(JSON.stringify({ type: "message", text: interviewText }));
            }
          }, 100);
          setTimeout(function () { clearInterval(checkMateReady); }, 5000);
        }
        break;

      case "dm_message":
        if (store.getState().dmMode && msg.dmKey === store.getState().dmKey) {
          showDmTypingIndicator(false); // hide typing when message arrives
          appendDmMessage(msg.message);
          scrollToBottom();
        } else if (msg.message) {
          // DM notification when not in that DM
          var fromId = msg.message.from;
          var _s1 = store.getState();
          if (fromId && fromId !== _s1.myUserId) {
            _s1.dmUnread[fromId] = (_s1.dmUnread[fromId] || 0) + 1;
            // Re-render strip so non-favorited sender appears
            renderUserStrip(_s1.cachedAllUsers, _s1.cachedOnlineIds, _s1.myUserId, _s1.cachedDmFavorites, _s1.cachedDmConversations, _s1.dmUnread, _s1.dmRemovedUsers, _s1.cachedMatesList);
            updateDmBadge(fromId, _s1.dmUnread[fromId]);
          }
        }
        break;

      case "dm_typing":
        if (store.getState().dmMode && msg.dmKey === store.getState().dmKey) {
          showDmTypingIndicator(msg.typing);
        }
        break;

      case "dm_list":
        // Could be used for DM list view later
        break;

      case "dm_favorites_updated":
        // Track users explicitly removed from favorites
        var _cdf = store.getState().cachedDmFavorites;
        if (_cdf && msg.dmFavorites) {
          for (var ri = 0; ri < _cdf.length; ri++) {
            if (msg.dmFavorites.indexOf(_cdf[ri]) === -1) {
              store.getState().dmRemovedUsers[_cdf[ri]] = true;
            }
          }
        }
        // Clear removed flag for users being added back
        if (msg.dmFavorites) {
          for (var ai = 0; ai < msg.dmFavorites.length; ai++) {
            delete store.getState().dmRemovedUsers[msg.dmFavorites[ai]];
          }
        }
        store.setState({ cachedDmFavorites: msg.dmFavorites || [] });
        var _s2 = store.getState();
        renderUserStrip(_s2.cachedAllUsers, _s2.cachedOnlineIds, _s2.myUserId, _s2.cachedDmFavorites, _s2.cachedDmConversations, _s2.dmUnread, _s2.dmRemovedUsers, _s2.cachedMatesList);
        break;

      case "mate_created":
        handleMateCreatedInApp(msg.mate, msg);
        break;

      case "mate_deleted":
        store.setState({ cachedMatesList: store.getState().cachedMatesList.filter(function (m) { return m.id !== msg.mateId; }) });
        if (msg.availableBuiltins) store.setState({ cachedAvailableBuiltins: msg.availableBuiltins });
        var _s3 = store.getState();
        renderUserStrip(_s3.cachedAllUsers, _s3.cachedOnlineIds, _s3.myUserId, _s3.cachedDmFavorites, _s3.cachedDmConversations, _s3.dmUnread, _s3.dmRemovedUsers, _s3.cachedMatesList);
        // If currently in DM with this mate, exit DM mode
        if (_s3.dmMode && store.getState().dmTargetUser && store.getState().dmTargetUser.id === msg.mateId) {
          exitDmMode();
        }
        break;

      case "mate_updated":
        if (msg.mate) {
          var _cml = store.getState().cachedMatesList.slice();
          for (var mi = 0; mi < _cml.length; mi++) {
            if (_cml[mi].id === msg.mate.id) {
              _cml[mi] = msg.mate;
              break;
            }
          }
          store.setState({ cachedMatesList: _cml });
          var _s4 = store.getState();
          renderUserStrip(_s4.cachedAllUsers, _s4.cachedOnlineIds, _s4.myUserId, _s4.cachedDmFavorites, _s4.cachedDmConversations, _s4.dmUnread, _s4.dmRemovedUsers, _cml);
          // Update mate sidebar if currently viewing this mate
          if (store.getState().dmMode && store.getState().dmTargetUser && store.getState().dmTargetUser.isMate && store.getState().dmTargetUser.id === msg.mate.id) {
            updateMateSidebarProfile(msg.mate);
            // Sync dmTargetUser so subsequent renders use fresh data
            var mp2 = msg.mate.profile || {};
            store.getState().dmTargetUser.displayName = mp2.displayName || msg.mate.name || store.getState().dmTargetUser.displayName;
            store.getState().dmTargetUser.avatarStyle = mp2.avatarStyle || store.getState().dmTargetUser.avatarStyle;
            store.getState().dmTargetUser.avatarSeed = mp2.avatarSeed || store.getState().dmTargetUser.avatarSeed;
            store.getState().dmTargetUser.avatarColor = mp2.avatarColor || store.getState().dmTargetUser.avatarColor;
            store.getState().dmTargetUser.avatarCustom = mp2.avatarCustom || "";
            store.getState().dmTargetUser.profile = mp2;
            // Refresh body dataset so new chat bubbles use the updated avatar
            document.body.dataset.mateAvatarUrl = mateAvatarUrl(store.getState().dmTargetUser, 36);
            document.body.dataset.mateName = mp2.displayName || msg.mate.name || "";
            // Update existing chat bubble avatars
            var mateAvis = document.querySelectorAll(".dm-bubble-avatar-mate");
            for (var mbi = 0; mbi < mateAvis.length; mbi++) {
              mateAvis[mbi].src = document.body.dataset.mateAvatarUrl;
            }
          }
          // Update DM header if currently chatting with this mate
          if (store.getState().dmMode && store.getState().dmTargetUser && store.getState().dmTargetUser.id === msg.mate.id) {
            var updatedName = (msg.mate.profile && msg.mate.profile.displayName) || msg.mate.name;
            if (updatedName) {
              var dmHeaderName = document.getElementById("dm-header-name");
              if (dmHeaderName) dmHeaderName.textContent = updatedName;
              var dmInput = document.getElementById("dm-input");
              if (dmInput) dmInput.placeholder = "Message " + updatedName;
            }
          }
        }
        break;

      case "mate_list":
        store.setState({ cachedMatesList: msg.mates || [], cachedAvailableBuiltins: msg.availableBuiltins || [] });
        var _s5 = store.getState();
        renderUserStrip(_s5.cachedAllUsers, _s5.cachedOnlineIds, _s5.myUserId, _s5.cachedDmFavorites, _s5.cachedDmConversations, _s5.dmUnread, _s5.dmRemovedUsers, _s5.cachedMatesList);
        break;

      case "mate_available_builtins":
        // Handled via mate_list.availableBuiltins now
        break;

      case "mate_error":
        showToast(msg.error || "Mate operation failed", "error");
        break;

      // --- @Mention ---
      case "mention_processing":
        // Broadcast: show/hide activity dot on mate avatar across all tabs
        if (msg.mateId) {
          var mateContainers = document.querySelectorAll('.icon-strip-mate[data-user-id="' + msg.mateId + '"]');
          for (var mi = 0; mi < mateContainers.length; mi++) {
            var dot = mateContainers[mi].querySelector(".icon-strip-status");
            if (msg.active) {
              if (dot) dot.classList.add("processing");
              mateContainers[mi].classList.add("mention-active");
            } else {
              if (dot) dot.classList.remove("processing");
              mateContainers[mi].classList.remove("mention-active");
            }
          }
        }
        break;

      case "mention_start":
        handleMentionStart(msg);
        break;

      case "mention_activity":
        handleMentionActivity(msg);
        break;

      case "mention_stream":
        handleMentionStream(msg);
        break;

      case "mention_done":
        handleMentionDone(msg);
        break;

      case "mention_error":
        handleMentionError(msg);
        if (msg.error) showToast("@Mention: " + msg.error, "error");
        break;

      case "mention_user":
        // Finalize current assistant block so mention renders in correct DOM position
        finalizeAssistantBlock();
        renderMentionUser(msg);
        break;

      case "mention_response":
        finalizeAssistantBlock();
        renderMentionResponse(msg);
        break;

      // --- Debate ---
      case "debate_preparing":
        if (!store.getState().replayingHistory) showDebateSticky("preparing", msg);
        handleDebatePreparing(msg);
        break;

      case "debate_brief_ready":
        if (store.getState().replayingHistory) {
          renderDebateBriefReady(msg);
        } else {
          handleDebateBriefReady(msg);
        }
        break;

      case "debate_started":
        if (!store.getState().replayingHistory) showDebateSticky("live", msg);
        if (store.getState().replayingHistory) {
          renderDebateStarted(msg);
        } else {
          handleDebateStarted(msg);
        }
        break;

      case "debate_turn":
        handleDebateTurn(msg);
        if (msg.round) updateDebateRound(msg.round);
        break;

      case "debate_activity":
        handleDebateActivity(msg);
        break;

      case "debate_stream":
        handleDebateStream(msg);
        break;

      case "debate_turn_done":
        if (msg.round) updateDebateRound(msg.round);
        handleDebateTurnDone(msg);
        break;

      case "debate_hand_raised":
        // Visual feedback: hand is raised, waiting for floor
        break;

      case "debate_comment_queued":
        handleDebateCommentQueued(msg);
        break;

      case "debate_comment_injected":
        if (store.getState().replayingHistory) {
          renderDebateCommentInjected(msg);
        } else {
          handleDebateCommentInjected(msg);
        }
        break;

      case "debate_conclude_confirm":
        if (!store.getState().replayingHistory) showDebateConcludeConfirm(msg);
        break;

      case "debate_user_floor":
        if (!store.getState().replayingHistory) showDebateUserFloor(msg);
        break;

      case "debate_user_floor_done":
        renderDebateUserFloorDone(msg);
        break;

      case "debate_user_resume":
        renderDebateUserResume(msg);
        break;

      case "debate_resumed":
        handleDebateResumed(msg);
        if (!store.getState().replayingHistory) showDebateSticky("live", msg);
        break;

      case "debate_ended":
        if (!store.getState().replayingHistory) showDebateSticky("ended", msg);
        if (store.getState().replayingHistory) {
          renderDebateEnded(msg);
        } else {
          handleDebateEnded(msg);
        }
        break;

      case "debate_error":
        handleDebateError(msg);
        if (msg.error) showToast("Debate: " + msg.error, "error");
        break;

      case "daemon_config":
        if (msg.config && msg.config.headless) store.setState({ isHeadlessMode: true });
        updateDaemonConfig(msg.config);
        break;

      case "set_pin_result":
        handleSetPinResult(msg);
        break;

      case "set_keep_awake_result":
        handleKeepAwakeChanged(msg);
        break;

      case "keep_awake_changed":
        handleKeepAwakeChanged(msg);
        break;

      case "set_auto_continue_result":
      case "auto_continue_changed":
        handleAutoContinueChanged(msg);
        break;

      case "restart_server_result":
        handleRestartResult(msg);
        break;

      case "shutdown_server_result":
        handleShutdownResult(msg);
        break;

      // --- Ralph Loop ---
      case "loop_available":
        store.setState({ loopAvailable: msg.available, loopActive: msg.active, loopIteration: msg.iteration || 0, loopMaxIterations: msg.maxIterations || 20, loopBannerName: msg.name || null });
        updateLoopButton();
        var _la = store.getState();
        if (_la.loopActive) {
          showLoopBanner(true);
          if (_la.loopIteration > 0) {
            updateLoopBanner(_la.loopIteration, _la.loopMaxIterations, "running");
          }
          inputEl.disabled = true;
          inputEl.placeholder = (_la.loopBannerName || "Loop") + " is running...";
        }
        break;

      case "loop_started":
        store.setState({ loopActive: true, ralphPhase: "executing", loopIteration: 0, loopMaxIterations: msg.maxIterations, loopBannerName: msg.name || null });
        showLoopBanner(true);
        updateLoopButton();
        var _lbn = store.getState().loopBannerName;
        addSystemMessage((_lbn || "Loop") + " started (max " + msg.maxIterations + " iterations)", false);
        inputEl.disabled = true;
        inputEl.placeholder = (_lbn || "Loop") + " is running...";
        break;

      case "loop_iteration":
        store.setState({ loopIteration: msg.iteration, loopMaxIterations: msg.maxIterations });
        updateLoopBanner(msg.iteration, msg.maxIterations, "running");
        updateLoopButton();
        var _libn = store.getState().loopBannerName;
        addSystemMessage((_libn || "Loop") + " iteration #" + msg.iteration + " started", false);
        inputEl.disabled = true;
        inputEl.placeholder = (_libn || "Loop") + " is running...";
        break;

      case "loop_judging":
        var _ljs = store.getState();
        updateLoopBanner(_ljs.loopIteration, _ljs.loopMaxIterations, "judging");
        addSystemMessage("Judging iteration #" + msg.iteration + "...", false);
        inputEl.disabled = true;
        inputEl.placeholder = (_ljs.loopBannerName || "Loop") + " is judging...";
        break;

      case "loop_verdict":
        addSystemMessage("Judge: " + msg.verdict.toUpperCase() + " - " + (msg.summary || ""), false);
        break;

      case "loop_stopping":
        var _lss = store.getState();
        updateLoopBanner(_lss.loopIteration, _lss.loopMaxIterations, "stopping");
        break;

      case "loop_finished":
        var _lfbn = store.getState().loopBannerName;
        store.setState({ loopActive: false, ralphPhase: "done", loopBannerName: null });
        showLoopBanner(false);
        updateLoopButton();
        enableMainInput();
        updateLoopInputVisibility(null);
        var loopLabel = _lfbn || "Loop";
        var finishMsg = msg.reason === "pass"
          ? loopLabel + " completed successfully after " + msg.iterations + " iteration(s)."
          : msg.reason === "max_iterations"
            ? loopLabel + " reached maximum iterations (" + msg.iterations + ")."
            : msg.reason === "stopped"
              ? loopLabel + " stopped."
              : loopLabel + " ended with error.";
        addSystemMessage(finishMsg, false);
        break;

      case "loop_error":
        addSystemMessage((store.getState().loopBannerName || "Loop") + " error: " + msg.text, true);
        break;

      // --- Ralph Wizard / Crafting ---
      case "ralph_phase":
        var _rps = { ralphPhase: msg.phase || "idle" };
        if (msg.craftingSessionId) _rps.ralphCraftingSessionId = msg.craftingSessionId;
        if (msg.source !== undefined) _rps.ralphCraftingSource = msg.source;
        store.setState(_rps);
        if (msg.wizardData) store.setState({ wizardData: msg.wizardData });
        updateLoopButton();
        updateRalphBars();
        break;

      case "ralph_crafting_started":
        store.setState({ ralphPhase: "crafting", ralphCraftingSessionId: msg.sessionId || store.getState().activeSessionId, ralphCraftingSource: msg.source || null });
        updateLoopButton();
        updateRalphBars();
        if (msg.source !== "ralph") {
          // Task sessions open in the scheduler calendar window
          enterCraftingMode(msg.sessionId, msg.taskId);
        }
        // Ralph crafting sessions show in session list as part of the loop group
        break;

      case "ralph_files_status":
        store.setState({ ralphFilesReady: {
          promptReady: msg.promptReady,
          judgeReady: msg.judgeReady,
          bothReady: msg.bothReady,
        } });
        if (msg.bothReady) {
          var _rfs = store.getState();
          if (_rfs.ralphPhase === "crafting" || _rfs.ralphPhase === "approval") {
            store.setState({ ralphPhase: "approval" });
            if (_rfs.ralphCraftingSource !== "ralph" || isSchedulerOpen()) {
              // Task crafting in scheduler: switch from crafting chat to detail view showing files
              exitCraftingMode(msg.taskId);
            } else {
              showRalphApprovalBar(true);
              // Auto-show execution modal (one-time) for Ralph source
              if (!store.getState().execModalShown && _rfs.ralphCraftingSource === "ralph") {
                showExecModal();
              }
            }
          }
        }
        updateRalphApprovalStatus();
        updateExecModalStatus();
        break;

      case "loop_registry_files_content":
        handleLoopRegistryFiles(msg);
        break;

      case "ralph_files_content":
        store.setState({ ralphPreviewContent: { prompt: msg.prompt || "", judge: msg.judge || "" } });
        openRalphPreviewModal();
        break;

      case "loop_registry_error":
        addSystemMessage("Error: " + msg.text, true);
        break;

      // --- Notifications ---
      case "notifications_state":
        handleNotificationsState(msg);
        break;
      case "notification_created":
        handleNotificationCreated(msg);
        break;
      case "notification_dismissed":
        handleNotificationDismissed(msg);
        break;
      case "notification_dismissed_all":
        handleNotificationDismissedAll();
        break;
    }
}
