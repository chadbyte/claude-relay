// app-messages.js - WebSocket message router
// Extracted from app.js (PR-23)

var _ctx = null;

export function initMessages(ctx) {
  _ctx = ctx;
}

export function processMessage(msg) {
    // Preserve original timestamp from history replay
    _ctx.currentMsgTs = msg._ts || null;
    var isMateDm = _ctx.dmMode && _ctx.dmTargetUser && _ctx.dmTargetUser.isMate;

    // DEBUG: trace session/history loading
    if (msg.type === "session_switched" || msg.type === "history_meta" || msg.type === "history_done" || msg.type === "mention_user" || msg.type === "mention_response") {
      console.log("[DEBUG msg]", msg.type, msg.type === "session_switched" ? "id=" + msg.id + " cli=" + (msg.cliSessionId || "").substring(0, 8) : "", msg.type === "history_meta" ? "from=" + msg.from + " total=" + msg.total : "", msg.type === "mention_user" ? "mate=" + msg.mateName : "", "dmMode=" + _ctx.dmMode);
    }

    // Mate DM: update mate icon status indicators
    if (isMateDm) _ctx.updateMateIconStatus(msg);

    // Mate DM: intercept mate-specific messages
    if (isMateDm) {
      if (msg.type === "session_list") {
        _ctx.renderMateSessionList(msg.sessions || []);
        _ctx.refreshMobileChatSheet();
        // Override title bar with mate name and re-apply color
        var _mdn = (_ctx.dmTargetUser.displayName || "New Mate");
        if (_ctx.headerTitleEl) _ctx.headerTitleEl.textContent = _mdn;
        var _tbpn = document.getElementById("title-bar-project-name");
        if (_tbpn) _tbpn.textContent = _mdn;
        var _mc2 = (_ctx.dmTargetUser.profile && _ctx.dmTargetUser.profile.avatarColor) || _ctx.dmTargetUser.avatarColor || "#7c3aed";
        var _tbc2 = document.querySelector(".title-bar-content");
        if (_tbc2) { _tbc2.style.background = _mc2; _tbc2.classList.add("mate-dm-active"); }
        document.body.classList.add("mate-dm-active");
        // Still let normal session_list handler run below
      }
      if (msg.type === "search_results") {
        _ctx.handleMateSearchResults(msg);
        return;
      }
      if (msg.type === "knowledge_list") {
        _ctx.renderKnowledgeList(msg.files);
        return;
      }
      if (msg.type === "knowledge_content") {
        _ctx.handleKnowledgeContent(msg);
        return;
      }
      if (msg.type === "knowledge_saved" || msg.type === "knowledge_deleted" || msg.type === "knowledge_promoted" || msg.type === "knowledge_depromoted") {
        return;
      }
      if (msg.type === "memory_list") {
        _ctx.renderMemoryList(msg.entries, msg.summary);
        return;
      }
      if (msg.type === "memory_deleted") {
        return;
      }
      // On done: scan DOM for [[MATE_READY: name]], update name, strip marker
      if (msg.type === "done") {
        setTimeout(function () { _ctx.scrollToBottom(); }, 100);
        setTimeout(function () { _ctx.scrollToBottom(); }, 400);
        setTimeout(function () {
          var fullText = _ctx.messagesEl ? _ctx.messagesEl.textContent : "";
          var readyMatch = fullText.match(/\[\[MATE_READY:\s*(.+?)\]\]/);
          if (readyMatch) {
            var newName = readyMatch[1].trim();
            _ctx.dmTargetUser.displayName = newName;
            _ctx.updateMateSidebarProfile({ profile: { displayName: newName, avatarColor: _ctx.dmTargetUser.avatarColor, avatarStyle: _ctx.dmTargetUser.avatarStyle, avatarSeed: _ctx.dmTargetUser.avatarSeed } });
            if (_ctx.ws && _ctx.ws.readyState === 1) {
              _ctx.ws.send(JSON.stringify({
                type: "mate_update",
                mateId: _ctx.dmTargetUser.id,
                updates: { name: newName, status: "ready", profile: { displayName: newName } },
              }));
            }
          }
          var walker = document.createTreeWalker(_ctx.messagesEl, NodeFilter.SHOW_TEXT, null, false);
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
        _ctx.historyFrom = msg.from;
        _ctx.historyTotal = msg.total;
        _ctx.replayingHistory = true;
        _ctx.updateHistorySentinel();
        break;

      case "history_prepend":
        _ctx.prependOlderHistory(msg.items, msg.meta);
        break;

      case "history_done":
        _ctx.replayingHistory = false;
        // Restore cached rich context usage BEFORE updateContextPanel runs
        if (msg.contextUsage) {
          _ctx.richContextUsage = msg.contextUsage;
        }
        // Restore accurate context data from the last result in full history
        if (msg.lastUsage || msg.lastModelUsage) {
          _ctx.accumulateContext(msg.lastCost, msg.lastUsage, msg.lastModelUsage, msg.lastStreamInputTokens);
        }
        _ctx.updateContextPanel();
        _ctx.updateUsagePanel();
        // Render + finalize any incomplete turn from the replayed history
        if (_ctx.currentMsgEl && _ctx.currentFullText) {
          var replayContentEl = _ctx.currentMsgEl.querySelector(".md-content");
          if (replayContentEl) {
            replayContentEl.innerHTML = _ctx.renderMarkdown(_ctx.currentFullText);
          }
        }
        _ctx.markAllToolsDone();
        _ctx.finalizeAssistantBlock();
        _ctx.stopUrgentBlink();
        // Clean up debate UI if debate is not active after replay
        if (!_ctx.isDebateActive()) {
          var dbBar = document.getElementById("debate-bottom-bar");
          if (dbBar) dbBar.remove();
          var dhBar = document.getElementById("debate-hand-raise-bar");
          if (dhBar) dhBar.remove();
          var dbBadges = document.querySelectorAll(".debate-header-badge");
          for (var dbi = 0; dbi < dbBadges.length; dbi++) dbBadges[dbi].remove();
          // Clean up all debate mode banners if debate is not active on this session
          if (_ctx.debateFloorMode) _ctx.exitDebateFloorMode();
          if (_ctx.debateConcludeMode) _ctx.exitDebateConcludeMode();
          if (_ctx.debateEndedMode) _ctx.exitDebateEndedMode();
          var dbBanner = document.getElementById("debate-floor-banner");
          if (dbBanner) dbBanner.remove();
        }
        _ctx.scrollToBottom();
        // Scroll to tool element if navigating from file edit history
        var nav = _ctx.getPendingNavigate();
        if (nav && (nav.toolId || nav.assistantUuid)) {
          requestAnimationFrame(function() {
            // Prefer scrolling to the exact tool element
            var target = nav.toolId ? _ctx.messagesEl.querySelector('[data-tool-id="' + nav.toolId + '"]') : null;
            if (!target && nav.assistantUuid) {
              target = _ctx.messagesEl.querySelector('[data-uuid="' + nav.assistantUuid + '"]');
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
        if (msg.mateId && !_ctx.returningFromMateDm) {
          // Server-driven mate DM restore on reconnect
          // Note: do NOT remove mate-dm-active here; openDm is async (skill check)
          // and removing the class causes a flash where mate UI is lost.
          // enterDmMode will properly set/reset the class when DM is entered.
          if (_ctx.dmMode) {
            _ctx.dmMode = false;
          }
          _ctx.messagesEl.innerHTML = "";
          _ctx.openDm(msg.mateId);
        }
        // Clear the flag and notify server that mate DM is closed
        if (_ctx.returningFromMateDm) {
          _ctx.returningFromMateDm = false;
          if (_ctx.ws && _ctx.ws.readyState === 1) {
            try { _ctx.ws.send(JSON.stringify({ type: "set_mate_dm", mateId: null })); } catch(e) {}
          }
        }
        break;

      case "info":
        if (msg.text && !msg.project && !msg.cwd) {
          _ctx.addSystemMessage(msg.text, false);
          break;
        }
        _ctx.projectName = msg.project || msg.cwd;
        if (msg.slug) _ctx.currentSlug = msg.slug;
        try { localStorage.setItem("clay-project-name-" + (_ctx.currentSlug || "default"), _ctx.projectName); } catch (e) {}
        // In mate DM, keep title as mate name and re-apply mate color
        if (_ctx.dmMode && _ctx.dmTargetUser && _ctx.dmTargetUser.isMate) {
          var _mateDN = _ctx.dmTargetUser.displayName || "New Mate";
          _ctx.headerTitleEl.textContent = _mateDN;
          var tbProjectName = _ctx.$("title-bar-project-name");
          if (tbProjectName) tbProjectName.textContent = _mateDN;
          // Re-apply mate title bar styling (may be lost during project switch)
          var _mc = (_ctx.dmTargetUser.profile && _ctx.dmTargetUser.profile.avatarColor) || _ctx.dmTargetUser.avatarColor || "#7c3aed";
          var _tbc = document.querySelector(".title-bar-content");
          if (_tbc) { _tbc.style.background = _mc; _tbc.classList.add("mate-dm-active"); }
          document.body.classList.add("mate-dm-active");
        } else {
          _ctx.headerTitleEl.textContent = _ctx.projectName;
          var tbProjectName = _ctx.$("title-bar-project-name");
          if (tbProjectName) tbProjectName.textContent = msg.title || _ctx.projectName;
        }
        _ctx.updatePageTitle();
        if (msg.version) {
          _ctx.setPaletteVersion(msg.version);
          var serverVersionEl = document.getElementById("settings-server-version");
          if (serverVersionEl) serverVersionEl.textContent = msg.version;
        }
        if (msg.projectOwnerId !== undefined) _ctx.currentProjectOwnerId = msg.projectOwnerId;
        if (msg.osUsers !== undefined) _ctx.isOsUsers = !!msg.osUsers;
        if (msg.lanHost) window.__lanHost = msg.lanHost;
        if (msg.dangerouslySkipPermissions) {
          _ctx.skipPermsEnabled = true;
          var spBanner = _ctx.$("skip-perms-pill");
          if (spBanner) spBanner.classList.remove("hidden");
        }
        _ctx.updateProjectList(msg);
        break;

      case "update_available":
        // In multi-user mode, only show update UI to admins
        if (_ctx.isMultiUserMode) {
          _ctx.checkAdminAccess().then(function (isAdmin) {
            if (!isAdmin) return;
            _ctx.showUpdateAvailable(msg);
          });
        } else {
          _ctx.showUpdateAvailable(msg);
        }
        break;

      case "up_to_date":
        var utdBtn = _ctx.$("settings-update-check");
        if (utdBtn) {
          utdBtn.innerHTML = "";
          var utdIcon = document.createElement("i");
          utdIcon.setAttribute("data-lucide", "check");
          utdBtn.appendChild(utdIcon);
          utdBtn.appendChild(document.createTextNode(" Up to date (v" + msg.version + ")"));
          utdBtn.disabled = true;
          _ctx.refreshIcons();
          setTimeout(function () {
            utdBtn.innerHTML = "";
            var rwIcon = document.createElement("i");
            rwIcon.setAttribute("data-lucide", "refresh-cw");
            utdBtn.appendChild(rwIcon);
            utdBtn.appendChild(document.createTextNode(" Check for updates"));
            utdBtn.disabled = false;
            utdBtn.classList.remove("settings-btn-update-available");
            _ctx.refreshIcons();
          }, 3000);
        }
        break;

      case "update_started":
        var updNowBtn = _ctx.$("update-now");
        if (updNowBtn) {
          updNowBtn.innerHTML = '<i data-lucide="loader"></i> Updating...';
          updNowBtn.disabled = true;
          _ctx.refreshIcons();
          var spinIcon = updNowBtn.querySelector(".lucide");
          if (spinIcon) spinIcon.classList.add("icon-spin-inline");
        }
        // Block the entire screen with the connect overlay
        _ctx.connectOverlay.classList.remove("hidden");
        break;

      case "slash_commands":
        var reserved = new Set(_ctx.builtinCommands.map(function (c) { return c.name; }));
        _ctx.slashCommands = (msg.commands || []).filter(function (name) {
          return !reserved.has(name);
        }).map(function (name) {
          return { name: name, desc: "Skill" };
        });
        break;

      case "model_info":
        _ctx.currentModel = msg.model || _ctx.currentModel;
        _ctx.currentModels = msg.models || [];
        _ctx.updateConfigChip();
        _ctx.updateSettingsModels(msg.model, msg.models || []);
        break;

      case "config_state":
        if (msg.model) _ctx.currentModel = msg.model;
        if (msg.mode) _ctx.currentMode = msg.mode;
        if (msg.effort) _ctx.currentEffort = msg.effort;
        if (msg.betas) _ctx.currentBetas = msg.betas;
        if (msg.thinking) _ctx.currentThinking = msg.thinking;
        if (msg.thinkingBudget) _ctx.currentThinkingBudget = msg.thinkingBudget;
        // Validate effort against current model's supported levels
        if (_ctx.currentModels.length > 0) {
          var levels = _ctx.getModelEffortLevels();
          var effortValid = false;
          for (var ei = 0; ei < levels.length; ei++) {
            if (levels[ei] === _ctx.currentEffort) { effortValid = true; break; }
          }
          if (!effortValid) _ctx.currentEffort = "medium";
        }
        _ctx.updateConfigChip();
        break;

      case "client_count":
        // Sidebar presence: current project's online users
        if (msg.users) {
          _ctx.renderSidebarPresence(msg.users);
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
        _ctx.showToast(msg.message, msg.level, msg.detail);
        break;

      case "skill_installed":
        _ctx.handleSkillInstalled(msg);
        if (msg.success) _ctx.knownInstalledSkills[msg.skill] = true;
        _ctx.handleSkillInstallWs(msg);
        break;

      case "skill_uninstalled":
        _ctx.handleSkillUninstalled(msg);
        if (msg.success) delete _ctx.knownInstalledSkills[msg.skill];
        break;

      case "loop_registry_updated":
        _ctx.handleLoopRegistryUpdated(msg);
        break;

      case "schedule_run_started":
        _ctx.handleScheduleRunStarted(msg);
        break;

      case "schedule_run_finished":
        _ctx.handleScheduleRunFinished(msg);
        break;

      case "loop_scheduled":
        _ctx.handleLoopScheduled(msg);
        break;

      case "schedule_move_result":
        if (msg.ok) {
          _ctx.showToast("Task moved", "success");
        } else {
          _ctx.showToast(msg.error || "Failed to move task", "error");
        }
        break;

      case "remove_project_check_result":
        _ctx.handleRemoveProjectCheckResult(msg);
        break;

      case "hub_schedules":
        _ctx.handleHubSchedules(msg);
        break;

      case "input_sync":
        if (!_ctx.dmMode) _ctx.handleInputSync(msg.text);
        break;

      case "session_list":
        _ctx.renderMateSessionList(msg.sessions || []);
        _ctx.renderSessionList(msg.sessions || []);
        _ctx.handlePaletteSessionSwitch();
        break;

      case "session_presence":
        _ctx.updateSessionPresence(msg.presence || {});
        break;

      case "cursor_move":
        _ctx.handleRemoteCursorMove(msg);
        break;

      case "cursor_leave":
        _ctx.handleRemoteCursorLeave(msg);
        break;

      case "text_select":
        _ctx.handleRemoteSelection(msg);
        break;

      case "session_io":
        _ctx.blinkSessionDot(msg.id);
        break;

      case "session_unread":
        _ctx.updateSessionBadge(msg.id, msg.count);
        break;

      case "search_results":
        _ctx.handleSearchResults(msg);
        break;

      case "search_content_results":
        if (msg.source === "find_in_session") {
          _ctx.handleFindInSessionResults(msg);
        }
        break;

      case "cli_session_list":
        _ctx.populateCliSessionList(msg.sessions || []);
        break;

      case "session_switched":
        _ctx.hideHomeHub();
        // Save draft from outgoing session
        if (_ctx.activeSessionId && _ctx.inputEl.value) {
          _ctx.sessionDrafts[_ctx.activeSessionId] = _ctx.inputEl.value;
        } else if (_ctx.activeSessionId) {
          delete _ctx.sessionDrafts[_ctx.activeSessionId];
        }
        _ctx.activeSessionId = msg.id;
        _ctx.cliSessionId = msg.cliSessionId || null;
        // Session presence is now tracked server-side (user-presence.json)
        _ctx.clearRemoteCursors();
        _ctx.resetClientState();
        _ctx.updateRalphBars();
        _ctx.updateLoopInputVisibility(msg.loop);
        // Restore input area visibility (may have been hidden by auth_required)
        var inputAreaSw = document.getElementById("input-area");
        if (inputAreaSw) inputAreaSw.classList.remove("hidden");
        // Restore draft for incoming session
        var draft = _ctx.sessionDrafts[_ctx.activeSessionId] || "";
        _ctx.inputEl.value = draft;
        _ctx.autoResize();
        if (!("ontouchstart" in window)) {
          _ctx.inputEl.focus();
        }
        break;

      case "session_id":
        _ctx.cliSessionId = msg.cliSessionId;
        break;

      case "message_uuid":
        var uuidTarget;
        if (msg.messageType === "user") {
          var allUsers = _ctx.messagesEl.querySelectorAll(".msg-user:not([data-uuid])");
          if (allUsers.length > 0) uuidTarget = allUsers[allUsers.length - 1];
        } else {
          var allAssistants = _ctx.messagesEl.querySelectorAll(".msg-assistant:not([data-uuid])");
          if (allAssistants.length > 0) uuidTarget = allAssistants[allAssistants.length - 1];
        }
        if (uuidTarget) {
          uuidTarget.dataset.uuid = msg.uuid;
          if (msg.messageType === "user") _ctx.addRewindButton(uuidTarget);
        }
        _ctx.messageUuidMap.push({ uuid: msg.uuid, type: msg.messageType });
        break;

      case "user_message":
        if (msg._internal) break;
        _ctx.resetThinkingGroup();
        if (msg.planContent) {
          _ctx.setPlanContent(msg.planContent);
          _ctx.renderPlanCard(msg.planContent);
          _ctx.addUserMessage("Execute the following plan. Do NOT re-enter plan mode — just implement it step by step.", msg.images || null, msg.pastes || null, msg.from, msg.fromName);
        } else {
          _ctx.addUserMessage(msg.text, msg.images || null, msg.pastes || null, msg.from, msg.fromName);
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
          icon.innerHTML = _ctx.iconHtml("globe");
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
            img.addEventListener("click", function () { _ctx.showImageModal(this.src); });
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

          _ctx.messagesEl.appendChild(card);
          _ctx.scrollToBottom();
        }
        break;

      case "status":
        if (msg.status === "processing") {
          _ctx.setStatus("processing");
          if (!(_ctx.dmMode && _ctx.dmTargetUser && _ctx.dmTargetUser.isMate) && !_ctx.matePreThinkingEl) {
            _ctx.setActivity("thinking");
          }
        }
        break;

      case "compacting":
        if (msg.active) {
          _ctx.setActivity("compacting");
        } else if (!(_ctx.dmMode && _ctx.dmTargetUser && _ctx.dmTargetUser.isMate)) {
          _ctx.setActivity("thinking");
        }
        break;

      case "thinking_start":
        _ctx.removeMatePreThinking();
        _ctx.startThinking();
        break;

      case "thinking_delta":
        if (typeof msg.text === "string") _ctx.appendThinking(msg.text);
        break;

      case "thinking_stop":
        _ctx.stopThinking(msg.duration);
        if (!(_ctx.dmMode && _ctx.dmTargetUser && _ctx.dmTargetUser.isMate)) {
          _ctx.setActivity("thinking");
        }
        break;

      case "delta":
        if (typeof msg.text !== "string") break;
        _ctx.removeMatePreThinking();
        _ctx.stopThinking();
        _ctx.resetThinkingGroup();
        _ctx.setActivity(null);
        _ctx.appendDelta(msg.text);
        break;

      case "tool_start":
        _ctx.removeMatePreThinking();
        _ctx.stopThinking();
        _ctx.markAllToolsDone();
        if (msg.name === "EnterPlanMode") {
          _ctx.renderPlanBanner("enter");
          _ctx.getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (msg.name === "ExitPlanMode") {
          if (_ctx.getPlanContent()) {
            _ctx.renderPlanCard(_ctx.getPlanContent());
          }
          _ctx.renderPlanBanner("exit");
          _ctx.getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (msg.name === "propose_debate" || (msg.name && msg.name.indexOf("propose_debate") !== -1)) {
          _ctx.getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (_ctx.getTodoTools()[msg.name]) {
          _ctx.getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else {
          _ctx.createToolItem(msg.id, msg.name);
        }
        break;

      case "tool_executing":
        if ((msg.name === "propose_debate" || (msg.name && msg.name.indexOf("propose_debate") !== -1)) && msg.input) {
          var _dpTool = _ctx.getTools()[msg.id];
          if (_dpTool) {
            if (_dpTool.el) _dpTool.el.style.display = "none";
            _dpTool.done = true;
            _dpTool.hidden = true;
            _ctx.removeToolFromGroup(msg.id);
          }
          _ctx.finalizeAssistantBlock();
          _ctx.renderMcpDebateProposal(msg.id, msg.input);
          _ctx.startUrgentBlink();
        } else if (msg.name === "AskUserQuestion" && msg.input && msg.input.questions) {
          var askTool = _ctx.getTools()[msg.id];
          if (askTool) {
            if (askTool.el) askTool.el.style.display = "none";
            askTool.done = true;
            _ctx.removeToolFromGroup(msg.id);
          }
          _ctx.renderAskUserQuestion(msg.id, msg.input);
          _ctx.startUrgentBlink();
        } else if (msg.name === "Write" && msg.input && _ctx.isPlanFilePath(msg.input.file_path)) {
          _ctx.setPlanContent(msg.input.content || "");
          _ctx.updateToolExecuting(msg.id, msg.name, msg.input);
        } else if (msg.name === "Edit" && msg.input && _ctx.isPlanFilePath(msg.input.file_path)) {
          var pc = _ctx.getPlanContent() || "";
          if (msg.input.old_string && pc.indexOf(msg.input.old_string) !== -1) {
            if (msg.input.replace_all) {
              _ctx.setPlanContent(pc.split(msg.input.old_string).join(msg.input.new_string || ""));
            } else {
              _ctx.setPlanContent(pc.replace(msg.input.old_string, msg.input.new_string || ""));
            }
          }
          _ctx.updateToolExecuting(msg.id, msg.name, msg.input);
        } else if (msg.name === "TodoWrite") {
          _ctx.handleTodoWrite(msg.input);
        } else if (msg.name === "TaskCreate") {
          _ctx.handleTaskCreate(msg.input);
        } else if (msg.name === "TaskUpdate") {
          _ctx.handleTaskUpdate(msg.input);
        } else if (_ctx.getTodoTools()[msg.name]) {
          // TaskList, TaskGet - silently skip
        } else {
          var t = _ctx.getTools()[msg.id];
          if (t && t.hidden) break;
          _ctx.updateToolExecuting(msg.id, msg.name, msg.input);
        }
        break;

      case "tool_result": {
          var tr = _ctx.getTools()[msg.id];
          if (tr && tr.hidden) break; // skip hidden plan tools
          // Always call updateToolResult for Edit (to show diff from input), or when content exists
          if (msg.content != null || msg.images || (tr && tr.name === "Edit" && tr.input && tr.input.old_string)) {
            _ctx.updateToolResult(msg.id, msg.content || "", msg.is_error || false, msg.images);
          }
          // Refresh file browser if an Edit/Write tool modified the open file
          if (!msg.is_error && tr && (tr.name === "Edit" || tr.name === "Write") && tr.input && tr.input.file_path) {
            _ctx.refreshIfOpen(tr.input.file_path);
          }
        }
        break;

      case "ask_user_answered":
        _ctx.markAskUserAnswered(msg.toolId, msg.answers);
        _ctx.stopUrgentBlink();
        break;

      case "permission_request":
        _ctx.renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason, msg.mateId);
        _ctx.startUrgentBlink();
        break;

      case "permission_cancel":
        _ctx.markPermissionCancelled(msg.requestId);
        _ctx.stopUrgentBlink();
        break;

      case "permission_resolved":
        _ctx.markPermissionResolved(msg.requestId, msg.decision);
        _ctx.stopUrgentBlink();
        break;

      case "permission_request_pending":
        _ctx.renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason, msg.mateId);
        _ctx.startUrgentBlink();
        break;

      case "elicitation_request":
        _ctx.renderElicitationRequest(msg);
        _ctx.startUrgentBlink();
        break;

      case "elicitation_resolved":
        _ctx.markElicitationResolved(msg.requestId, msg.action);
        _ctx.stopUrgentBlink();
        break;

      case "slash_command_result":
        _ctx.finalizeAssistantBlock();
        var cmdBlock = document.createElement("div");
        cmdBlock.className = "assistant-block";
        cmdBlock.style.maxWidth = "var(--content-width)";
        cmdBlock.style.margin = "12px auto";
        cmdBlock.style.padding = "0 20px";
        var pre = document.createElement("pre");
        pre.style.cssText = "background:var(--code-bg);border:1px solid var(--border-subtle);border-radius:10px;padding:12px 14px;font-family:'SF Mono',Menlo,Monaco,monospace;font-size:12px;line-height:1.55;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;max-height:400px;overflow-y:auto;margin:0";
        pre.textContent = msg.text;
        cmdBlock.appendChild(pre);
        _ctx.addToMessages(cmdBlock);
        _ctx.scrollToBottom();
        break;

      case "subagent_activity":
        _ctx.updateSubagentActivity(msg.parentToolId, msg.text);
        break;

      case "subagent_tool":
        _ctx.addSubagentToolEntry(msg.parentToolId, msg.toolName, msg.toolId, msg.text);
        break;

      case "subagent_done":
        _ctx.markSubagentDone(msg.parentToolId, msg.status, msg.summary, msg.usage);
        break;

      case "task_started":
        _ctx.initSubagentStop(msg.parentToolId, msg.taskId);
        break;

      case "task_progress":
        _ctx.updateSubagentProgress(msg.parentToolId, msg.usage, msg.lastToolName, msg.summary);
        break;

      case "result":
        _ctx.setActivity(null);
        _ctx.stopThinking();
        _ctx.markAllToolsDone();
        _ctx.closeToolGroup();
        _ctx.finalizeAssistantBlock();
        _ctx.addTurnMeta(msg.cost, msg.duration);
        _ctx.accumulateUsage(msg.cost, msg.usage);
        _ctx.accumulateContext(msg.cost, msg.usage, msg.modelUsage, msg.lastStreamInputTokens);
        break;

      case "context_usage":
        if (msg.data && !_ctx.replayingHistory) {
          _ctx.richContextUsage = msg.data;
          if (_ctx.headerContextEl) _ctx.headerContextEl.removeAttribute("data-tip");
          if (_ctx.ctxPopoverVisible) _ctx.renderCtxPopover();
        }
        break;

      case "done":
        _ctx.setActivity(null);
        _ctx.stopThinking();
        _ctx.markAllToolsDone();
        _ctx.closeToolGroup();
        _ctx.finalizeAssistantBlock();
        _ctx.processing = false;
        _ctx.setStatus("connected");
        if (!_ctx.loopActive) _ctx.enableMainInput();
        _ctx.resetToolState();
        _ctx.stopUrgentBlink();
        if (document.hidden) {
          if (_ctx.isNotifAlertEnabled() && !window._pushSubscription) _ctx.showDoneNotification();
          if (_ctx.isNotifSoundEnabled()) _ctx.playDoneSound();
        }
        break;

      case "stderr":
        _ctx.addSystemMessage(msg.text, false);
        break;

      case "error":
        _ctx.setActivity(null);
        _ctx.addSystemMessage(msg.text, true);
        break;

      case "process_conflict":
        _ctx.setActivity(null);
        _ctx.addConflictMessage(msg);
        break;

      case "context_overflow":
        _ctx.setActivity(null);
        _ctx.addContextOverflowMessage(msg);
        break;

      case "auth_required":
        _ctx.setActivity(null);
        _ctx.addAuthRequiredMessage(msg);
        break;

      case "rate_limit":
        _ctx.handleRateLimitEvent(msg);
        break;

      case "rate_limit_usage":
        _ctx.updateRateLimitUsage(msg);
        break;

      case "scheduled_message_queued":
        _ctx.addScheduledMessageBubble(msg.text, msg.resetsAt);
        _ctx.setScheduleBtnDisabled(true);
        break;

      case "scheduled_message_sent":
        _ctx.removeScheduledMessageBubble();
        _ctx.setScheduleBtnDisabled(false);
        _ctx.processing = true;
        _ctx.setStatus("processing");
        break;

      case "scheduled_message_cancelled":
        _ctx.removeScheduledMessageBubble();
        _ctx.setScheduleBtnDisabled(false);
        break;

      case "auto_continue_scheduled":
        // Scheduler auto-continue, just show info
        break;

      case "auto_continue_fired":
        _ctx.processing = true;
        _ctx.setStatus("processing");
        break;

      case "prompt_suggestion":
        _ctx.showSuggestionChips(msg.suggestion);
        break;

      case "fast_mode_state":
        _ctx.handleFastModeState(msg.state);
        break;

      case "process_killed":
        _ctx.addSystemMessage("Process " + msg.pid + " has been terminated. You can retry your message now.", false);
        break;

      case "rewind_preview_result":
        _ctx.showRewindModal(msg);
        break;

      case "rewind_complete":
        _ctx.onRewindComplete();
        _ctx.setRewindMode(false);
        var rewindText = "Rewound to earlier point. Files have been restored.";
        if (msg.mode === "chat") rewindText = "Conversation rewound to earlier point.";
        else if (msg.mode === "files") rewindText = "Files restored to earlier point.";
        _ctx.addSystemMessage(rewindText, false);
        break;

      case "rewind_error":
        _ctx.onRewindError();
        _ctx.clearPendingRewindUuid();
        _ctx.addSystemMessage(msg.text || "Rewind failed.", true);
        break;

      case "fork_complete":
        _ctx.addSystemMessage("Session forked successfully.");
        break;

      case "fs_list_result":
        _ctx.handleFsList(msg);
        break;

      case "fs_read_result":
        if (msg.path === "CLAUDE.md" && _ctx.isProjectSettingsOpen()) {
          _ctx.handleInstructionsRead(msg);
        } else {
          _ctx.handleFsRead(msg);
        }
        break;

      case "fs_write_result":
        _ctx.handleInstructionsWrite(msg);
        break;

      case "project_env_result":
        _ctx.handleProjectEnv(msg);
        break;

      case "set_project_env_result":
        _ctx.handleProjectEnvSaved(msg);
        break;

      case "global_claude_md_result":
        _ctx.handleGlobalClaudeMdRead(msg);
        break;

      case "write_global_claude_md_result":
        _ctx.handleGlobalClaudeMdWrite(msg);
        break;

      case "shared_env_result":
        _ctx.handleSharedEnv(msg);
        _ctx.handleProjectSharedEnv(msg);
        break;

      case "set_shared_env_result":
        _ctx.handleSharedEnvSaved(msg);
        _ctx.handleProjectSharedEnvSaved(msg);
        break;

      case "fs_file_changed":
        _ctx.handleFileChanged(msg);
        break;

      case "fs_dir_changed":
        _ctx.handleDirChanged(msg);
        break;

      case "fs_file_history_result":
        _ctx.handleFileHistory(msg);
        break;

      case "fs_git_diff_result":
        _ctx.handleGitDiff(msg);
        break;

      case "fs_file_at_result":
        _ctx.handleFileAt(msg);
        break;

      case "term_list":
        _ctx.handleTermList(msg);
        _ctx.updateTerminalList(msg.terminals);
        break;

      case "context_sources_state":
        _ctx.handleContextSourcesState(msg);
        break;

      case "extension_command":
        _ctx.sendExtensionCommand(msg.command, msg.args, msg.requestId);
        break;

      case "term_created":
        _ctx.handleTermCreated(msg);
        if (_ctx.pendingTermCommand) {
          var cmd = _ctx.pendingTermCommand;
          _ctx.pendingTermCommand = null;
          // Small delay to let terminal initialize
          setTimeout(function() {
            _ctx.sendTerminalCommand(cmd);
          }, 300);
        }
        break;

      case "term_output":
        _ctx.handleTermOutput(msg);
        break;

      case "term_resized":
        _ctx.handleTermResized(msg);
        break;

      case "term_exited":
        _ctx.handleTermExited(msg);
        break;

      case "term_closed":
        _ctx.handleTermClosed(msg);
        break;

      case "notes_list":
        _ctx.handleNotesList(msg);
        break;

      case "note_created":
        _ctx.handleNoteCreated(msg);
        break;

      case "note_updated":
        _ctx.handleNoteUpdated(msg);
        break;

      case "note_deleted":
        _ctx.handleNoteDeleted(msg);
        break;

      case "process_stats":
        _ctx.updateStatusPanel(msg);
        _ctx.updateSettingsStats(msg);
        break;

      case "browse_dir_result":
        _ctx.handleBrowseDirResult(msg);
        break;

      case "add_project_result":
        _ctx.handleAddProjectResult(msg);
        break;

      case "clone_project_progress":
        _ctx.handleCloneProgress(msg);
        break;

      case "remove_project_result":
        _ctx.handleRemoveProjectResult(msg);
        break;

      case "reorder_projects_result":
        if (!msg.ok) {
          _ctx.showToast(msg.error || "Failed to reorder projects", "error");
        }
        break;

      case "set_project_title_result":
        if (!msg.ok) {
          _ctx.showToast(msg.error || "Failed to rename project", "error");
        }
        break;

      case "set_project_icon_result":
        if (!msg.ok) {
          _ctx.showToast(msg.error || "Failed to set icon", "error");
        }
        break;

      case "projects_updated":
        _ctx.updateProjectList(msg);
        break;

      case "project_owner_changed":
        _ctx.currentProjectOwnerId = msg.ownerId;
        _ctx.handleProjectOwnerChanged(msg);
        break;

      // --- DM ---
      case "dm_history":
        // Attach projectSlug to targetUser for mate DMs
        if (msg.projectSlug && msg.targetUser) {
          msg.targetUser.projectSlug = msg.projectSlug;
        }
        _ctx.enterDmMode(msg.dmKey, msg.targetUser, msg.messages);
        // Auto-send first interview prompt after mate DM opens
        if (_ctx.pendingMateInterview && msg.targetUser && msg.targetUser.isMate && msg.projectSlug) {
          var interviewMate = _ctx.pendingMateInterview;
          _ctx.pendingMateInterview = null;
          // Wait for mate project WS to connect, then send interview prompt
          var checkMateReady = setInterval(function () {
            if (_ctx.ws && _ctx.ws.readyState === 1 && _ctx.mateProjectSlug) {
              clearInterval(checkMateReady);
              var interviewText = _ctx.buildMateInterviewPrompt(interviewMate);
              _ctx.ws.send(JSON.stringify({ type: "message", text: interviewText }));
            }
          }, 100);
          setTimeout(function () { clearInterval(checkMateReady); }, 5000);
        }
        break;

      case "dm_message":
        if (_ctx.dmMode && msg.dmKey === _ctx.dmKey) {
          _ctx.showDmTypingIndicator(false); // hide typing when message arrives
          _ctx.appendDmMessage(msg.message);
          _ctx.scrollToBottom();
        } else if (msg.message) {
          // DM notification when not in that DM
          var fromId = msg.message.from;
          if (fromId && fromId !== _ctx.myUserId) {
            _ctx.dmUnread[fromId] = (_ctx.dmUnread[fromId] || 0) + 1;
            // Re-render strip so non-favorited sender appears
            _ctx.renderUserStrip(_ctx.cachedAllUsers, _ctx.cachedOnlineIds, _ctx.myUserId, _ctx.cachedDmFavorites, _ctx.cachedDmConversations, _ctx.dmUnread, _ctx.dmRemovedUsers, _ctx.cachedMatesList);
            _ctx.updateDmBadge(fromId, _ctx.dmUnread[fromId]);
          }
        }
        break;

      case "dm_typing":
        if (_ctx.dmMode && msg.dmKey === _ctx.dmKey) {
          _ctx.showDmTypingIndicator(msg.typing);
        }
        break;

      case "dm_list":
        // Could be used for DM list view later
        break;

      case "dm_favorites_updated":
        // Track users explicitly removed from favorites
        if (_ctx.cachedDmFavorites && msg.dmFavorites) {
          for (var ri = 0; ri < _ctx.cachedDmFavorites.length; ri++) {
            if (msg.dmFavorites.indexOf(_ctx.cachedDmFavorites[ri]) === -1) {
              _ctx.dmRemovedUsers[_ctx.cachedDmFavorites[ri]] = true;
            }
          }
        }
        // Clear removed flag for users being added back
        if (msg.dmFavorites) {
          for (var ai = 0; ai < msg.dmFavorites.length; ai++) {
            delete _ctx.dmRemovedUsers[msg.dmFavorites[ai]];
          }
        }
        _ctx.cachedDmFavorites = msg.dmFavorites || [];
        _ctx.renderUserStrip(_ctx.cachedAllUsers, _ctx.cachedOnlineIds, _ctx.myUserId, _ctx.cachedDmFavorites, _ctx.cachedDmConversations, _ctx.dmUnread, _ctx.dmRemovedUsers, _ctx.cachedMatesList);
        break;

      case "mate_created":
        _ctx.handleMateCreatedInApp(msg.mate, msg);
        break;

      case "mate_deleted":
        _ctx.cachedMatesList = _ctx.cachedMatesList.filter(function (m) { return m.id !== msg.mateId; });
        if (msg.availableBuiltins) _ctx.cachedAvailableBuiltins = msg.availableBuiltins;
        _ctx.renderUserStrip(_ctx.cachedAllUsers, _ctx.cachedOnlineIds, _ctx.myUserId, _ctx.cachedDmFavorites, _ctx.cachedDmConversations, _ctx.dmUnread, _ctx.dmRemovedUsers, _ctx.cachedMatesList);
        // If currently in DM with this mate, exit DM mode
        if (_ctx.dmMode && _ctx.dmTargetUser && _ctx.dmTargetUser.id === msg.mateId) {
          _ctx.exitDmMode();
        }
        break;

      case "mate_updated":
        if (msg.mate) {
          for (var mi = 0; mi < _ctx.cachedMatesList.length; mi++) {
            if (_ctx.cachedMatesList[mi].id === msg.mate.id) {
              _ctx.cachedMatesList[mi] = msg.mate;
              break;
            }
          }
          _ctx.renderUserStrip(_ctx.cachedAllUsers, _ctx.cachedOnlineIds, _ctx.myUserId, _ctx.cachedDmFavorites, _ctx.cachedDmConversations, _ctx.dmUnread, _ctx.dmRemovedUsers, _ctx.cachedMatesList);
          // Update mate sidebar if currently viewing this mate
          if (_ctx.dmMode && _ctx.dmTargetUser && _ctx.dmTargetUser.isMate && _ctx.dmTargetUser.id === msg.mate.id) {
            _ctx.updateMateSidebarProfile(msg.mate);
            // Sync dmTargetUser so subsequent renders use fresh data
            var mp2 = msg.mate.profile || {};
            _ctx.dmTargetUser.displayName = mp2.displayName || msg.mate.name || _ctx.dmTargetUser.displayName;
            _ctx.dmTargetUser.avatarStyle = mp2.avatarStyle || _ctx.dmTargetUser.avatarStyle;
            _ctx.dmTargetUser.avatarSeed = mp2.avatarSeed || _ctx.dmTargetUser.avatarSeed;
            _ctx.dmTargetUser.avatarColor = mp2.avatarColor || _ctx.dmTargetUser.avatarColor;
            _ctx.dmTargetUser.avatarCustom = mp2.avatarCustom || "";
            _ctx.dmTargetUser.profile = mp2;
            // Refresh body dataset so new chat bubbles use the updated avatar
            document.body.dataset.mateAvatarUrl = _ctx.mateAvatarUrl(_ctx.dmTargetUser, 36);
            document.body.dataset.mateName = mp2.displayName || msg.mate.name || "";
            // Update existing chat bubble avatars
            var mateAvis = document.querySelectorAll(".dm-bubble-avatar-mate");
            for (var mbi = 0; mbi < mateAvis.length; mbi++) {
              mateAvis[mbi].src = document.body.dataset.mateAvatarUrl;
            }
          }
          // Update DM header if currently chatting with this mate
          if (_ctx.dmMode && _ctx.dmTargetUser && _ctx.dmTargetUser.id === msg.mate.id) {
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
        _ctx.cachedMatesList = msg.mates || [];
        _ctx.cachedAvailableBuiltins = msg.availableBuiltins || [];
        _ctx.renderUserStrip(_ctx.cachedAllUsers, _ctx.cachedOnlineIds, _ctx.myUserId, _ctx.cachedDmFavorites, _ctx.cachedDmConversations, _ctx.dmUnread, _ctx.dmRemovedUsers, _ctx.cachedMatesList);
        break;

      case "mate_available_builtins":
        // Handled via mate_list.availableBuiltins now
        break;

      case "mate_error":
        _ctx.showToast(msg.error || "Mate operation failed", "error");
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
        _ctx.handleMentionStart(msg);
        break;

      case "mention_activity":
        _ctx.handleMentionActivity(msg);
        break;

      case "mention_stream":
        _ctx.handleMentionStream(msg);
        break;

      case "mention_done":
        _ctx.handleMentionDone(msg);
        break;

      case "mention_error":
        _ctx.handleMentionError(msg);
        if (msg.error) _ctx.showToast("@Mention: " + msg.error, "error");
        break;

      case "mention_user":
        // Finalize current assistant block so mention renders in correct DOM position
        _ctx.finalizeAssistantBlock();
        _ctx.renderMentionUser(msg);
        break;

      case "mention_response":
        _ctx.finalizeAssistantBlock();
        _ctx.renderMentionResponse(msg);
        break;

      // --- Debate ---
      case "debate_preparing":
        if (!_ctx.replayingHistory) _ctx.showDebateSticky("preparing", msg);
        _ctx.handleDebatePreparing(msg);
        break;

      case "debate_brief_ready":
        if (_ctx.replayingHistory) {
          _ctx.renderDebateBriefReady(msg);
        } else {
          _ctx.handleDebateBriefReady(msg);
        }
        break;

      case "debate_started":
        if (!_ctx.replayingHistory) _ctx.showDebateSticky("live", msg);
        if (_ctx.replayingHistory) {
          _ctx.renderDebateStarted(msg);
        } else {
          _ctx.handleDebateStarted(msg);
        }
        break;

      case "debate_turn":
        _ctx.handleDebateTurn(msg);
        if (msg.round) _ctx.updateDebateRound(msg.round);
        break;

      case "debate_activity":
        _ctx.handleDebateActivity(msg);
        break;

      case "debate_stream":
        _ctx.handleDebateStream(msg);
        break;

      case "debate_turn_done":
        if (msg.round) _ctx.updateDebateRound(msg.round);
        _ctx.handleDebateTurnDone(msg);
        break;

      case "debate_hand_raised":
        // Visual feedback: hand is raised, waiting for floor
        break;

      case "debate_comment_queued":
        _ctx.handleDebateCommentQueued(msg);
        break;

      case "debate_comment_injected":
        if (_ctx.replayingHistory) {
          _ctx.renderDebateCommentInjected(msg);
        } else {
          _ctx.handleDebateCommentInjected(msg);
        }
        break;

      case "debate_conclude_confirm":
        if (!_ctx.replayingHistory) _ctx.showDebateConcludeConfirm(msg);
        break;

      case "debate_user_floor":
        if (!_ctx.replayingHistory) _ctx.showDebateUserFloor(msg);
        break;

      case "debate_user_floor_done":
        _ctx.renderDebateUserFloorDone(msg);
        break;

      case "debate_user_resume":
        _ctx.renderDebateUserResume(msg);
        break;

      case "debate_resumed":
        _ctx.handleDebateResumed(msg);
        if (!_ctx.replayingHistory) _ctx.showDebateSticky("live", msg);
        break;

      case "debate_ended":
        if (!_ctx.replayingHistory) _ctx.showDebateSticky("ended", msg);
        if (_ctx.replayingHistory) {
          _ctx.renderDebateEnded(msg);
        } else {
          _ctx.handleDebateEnded(msg);
        }
        break;

      case "debate_error":
        _ctx.handleDebateError(msg);
        if (msg.error) _ctx.showToast("Debate: " + msg.error, "error");
        break;

      case "daemon_config":
        if (msg.config && msg.config.headless) _ctx.isHeadlessMode = true;
        _ctx.updateDaemonConfig(msg.config);
        break;

      case "set_pin_result":
        _ctx.handleSetPinResult(msg);
        break;

      case "set_keep_awake_result":
        _ctx.handleKeepAwakeChanged(msg);
        break;

      case "keep_awake_changed":
        _ctx.handleKeepAwakeChanged(msg);
        break;

      case "set_auto_continue_result":
      case "auto_continue_changed":
        _ctx.handleAutoContinueChanged(msg);
        break;

      case "restart_server_result":
        _ctx.handleRestartResult(msg);
        break;

      case "shutdown_server_result":
        _ctx.handleShutdownResult(msg);
        break;

      // --- Ralph Loop ---
      case "loop_available":
        _ctx.loopAvailable = msg.available;
        _ctx.loopActive = msg.active;
        _ctx.loopIteration = msg.iteration || 0;
        _ctx.loopMaxIterations = msg.maxIterations || 20;
        _ctx.loopBannerName = msg.name || null;
        _ctx.updateLoopButton();
        if (_ctx.loopActive) {
          _ctx.showLoopBanner(true);
          if (_ctx.loopIteration > 0) {
            _ctx.updateLoopBanner(_ctx.loopIteration, _ctx.loopMaxIterations, "running");
          }
          _ctx.inputEl.disabled = true;
          _ctx.inputEl.placeholder = (_ctx.loopBannerName || "Loop") + " is running...";
        }
        break;

      case "loop_started":
        _ctx.loopActive = true;
        _ctx.ralphPhase = "executing";
        _ctx.loopIteration = 0;
        _ctx.loopMaxIterations = msg.maxIterations;
        _ctx.loopBannerName = msg.name || null;
        _ctx.showLoopBanner(true);
        _ctx.updateLoopButton();
        _ctx.addSystemMessage((_ctx.loopBannerName || "Loop") + " started (max " + msg.maxIterations + " iterations)", false);
        _ctx.inputEl.disabled = true;
        _ctx.inputEl.placeholder = (_ctx.loopBannerName || "Loop") + " is running...";
        break;

      case "loop_iteration":
        _ctx.loopIteration = msg.iteration;
        _ctx.loopMaxIterations = msg.maxIterations;
        _ctx.updateLoopBanner(msg.iteration, msg.maxIterations, "running");
        _ctx.updateLoopButton();
        _ctx.addSystemMessage((_ctx.loopBannerName || "Loop") + " iteration #" + msg.iteration + " started", false);
        _ctx.inputEl.disabled = true;
        _ctx.inputEl.placeholder = (_ctx.loopBannerName || "Loop") + " is running...";
        break;

      case "loop_judging":
        _ctx.updateLoopBanner(_ctx.loopIteration, _ctx.loopMaxIterations, "judging");
        _ctx.addSystemMessage("Judging iteration #" + msg.iteration + "...", false);
        _ctx.inputEl.disabled = true;
        _ctx.inputEl.placeholder = (_ctx.loopBannerName || "Loop") + " is judging...";
        break;

      case "loop_verdict":
        _ctx.addSystemMessage("Judge: " + msg.verdict.toUpperCase() + " - " + (msg.summary || ""), false);
        break;

      case "loop_stopping":
        _ctx.updateLoopBanner(_ctx.loopIteration, _ctx.loopMaxIterations, "stopping");
        break;

      case "loop_finished":
        _ctx.loopActive = false;
        _ctx.ralphPhase = "done";
        _ctx.loopBannerName = null;
        _ctx.showLoopBanner(false);
        _ctx.updateLoopButton();
        _ctx.enableMainInput();
        var loopLabel = _ctx.loopBannerName || "Loop";
        var finishMsg = msg.reason === "pass"
          ? loopLabel + " completed successfully after " + msg.iterations + " iteration(s)."
          : msg.reason === "max_iterations"
            ? loopLabel + " reached maximum iterations (" + msg.iterations + ")."
            : msg.reason === "stopped"
              ? loopLabel + " stopped."
              : loopLabel + " ended with error.";
        _ctx.addSystemMessage(finishMsg, false);
        break;

      case "loop_error":
        _ctx.addSystemMessage((_ctx.loopBannerName || "Loop") + " error: " + msg.text, true);
        break;

      // --- Ralph Wizard / Crafting ---
      case "ralph_phase":
        _ctx.ralphPhase = msg.phase || "idle";
        if (msg.craftingSessionId) _ctx.ralphCraftingSessionId = msg.craftingSessionId;
        if (msg.source !== undefined) _ctx.ralphCraftingSource = msg.source;
        _ctx.updateLoopButton();
        _ctx.updateRalphBars();
        break;

      case "ralph_crafting_started":
        _ctx.ralphPhase = "crafting";
        _ctx.ralphCraftingSessionId = msg.sessionId || _ctx.activeSessionId;
        _ctx.ralphCraftingSource = msg.source || null;
        _ctx.updateLoopButton();
        _ctx.updateRalphBars();
        if (msg.source !== "ralph") {
          // Task sessions open in the scheduler calendar window
          _ctx.enterCraftingMode(msg.sessionId, msg.taskId);
        }
        // Ralph crafting sessions show in session list as part of the loop group
        break;

      case "ralph_files_status":
        _ctx.ralphFilesReady = {
          promptReady: msg.promptReady,
          judgeReady: msg.judgeReady,
          bothReady: msg.bothReady,
        };
        if (msg.bothReady && (_ctx.ralphPhase === "crafting" || _ctx.ralphPhase === "approval")) {
          _ctx.ralphPhase = "approval";
          if (_ctx.ralphCraftingSource !== "ralph" || _ctx.isSchedulerOpen()) {
            // Task crafting in scheduler: switch from crafting chat to detail view showing files
            _ctx.exitCraftingMode(msg.taskId);
          } else {
            _ctx.showRalphApprovalBar(true);
          }
        }
        _ctx.updateRalphApprovalStatus();
        break;

      case "loop_registry_files_content":
        _ctx.handleLoopRegistryFiles(msg);
        break;

      case "ralph_files_content":
        _ctx.ralphPreviewContent = { prompt: msg.prompt || "", judge: msg.judge || "" };
        _ctx.openRalphPreviewModal();
        break;

      case "loop_registry_error":
        _ctx.addSystemMessage("Error: " + msg.text, true);
        break;
    }
}
