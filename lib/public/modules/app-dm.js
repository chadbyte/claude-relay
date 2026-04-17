// app-dm.js - DM mode, mate project switching, mate onboarding
// Extracted from app.js (PR-24)

var _ctx = null;

var MATE_ONBOARDING_KEY = "clay-mate-onboarding-shown";
var CLAUDE_CODE_AVATAR = "/claude-code-avatar.png";
var bgMateIoTimers = {};
var dmTypingTimer = null;

export function initDm(ctx) {
  _ctx = ctx;

  // --- Mobile mate title bar click handlers ---
  var mobileBack = document.getElementById("mate-mobile-back");
  var mobileTitle = document.getElementById("mate-mobile-title");
  var mobileMore = document.getElementById("mate-mobile-more");
  if (mobileBack) {
    mobileBack.addEventListener("click", function (e) {
      e.stopPropagation();
      exitDmMode();
    });
  }
  if (mobileMore) {
    mobileMore.addEventListener("click", function (e) {
      e.stopPropagation();
      _ctx.openMobileSheet("mate-profile");
    });
  }
  if (mobileTitle) {
    mobileTitle.addEventListener("click", function () {
      _ctx.openMobileSheet("mate-profile");
    });
  }
}

export function openDm(targetUserId) {
  if (!_ctx.ws || _ctx.ws.readyState !== 1) return;
  // Persist DM state for refresh recovery
  try { localStorage.setItem("clay-active-dm", targetUserId); } catch (e) {}
  // Check mate skill updates before opening mate DM
  if (typeof targetUserId === "string" && targetUserId.indexOf("mate_") === 0) {
    showMateOnboarding(function () {
      _ctx.requireClayMateInterview(function () {
        _ctx.ws.send(JSON.stringify({ type: "dm_open", targetUserId: targetUserId }));
      });
    });
    return;
  }
  _ctx.ws.send(JSON.stringify({ type: "dm_open", targetUserId: targetUserId }));
}

function showMateOnboarding(callback) {
  try {
    if (localStorage.getItem(MATE_ONBOARDING_KEY)) { callback(); return; }
  } catch (e) {}

  var overlay = document.createElement("div");
  overlay.className = "mate-onboarding-overlay";
  overlay.innerHTML =
    '<div class="mate-onboarding-card">' +
      '<h2 class="mate-onboarding-title">Meet your Mates</h2>' +
      '<p class="mate-onboarding-desc">' +
        'Mates are AI teammates powered by your Claude Code.<br>Each one has a distinct role, builds its own knowledge, and gets sharper over time.' +
      '</p>' +
      '<ul class="mate-onboarding-features">' +
        '<li><span class="mate-onboarding-bullet">\uD83C\uDFAD</span><div><strong>Specialized personas</strong><br><span class="mate-onboarding-sub">Architect, reviewer, researcher, chief of staff, and more</span></div></li>' +
        '<li><span class="mate-onboarding-bullet">\uD83D\uDD04</span><div><strong>Persistent memory</strong><br><span class="mate-onboarding-sub">Every conversation makes them smarter about you and your work</span></div></li>' +
        '<li><span class="mate-onboarding-bullet">\uD83D\uDCAC</span><div><strong>Shared context across the team</strong><br><span class="mate-onboarding-sub">What one mate learns, the others can reference</span></div></li>' +
        '<li><span class="mate-onboarding-bullet">\uD83D\uDCDA</span><div><strong>Self-growing knowledge base</strong><br><span class="mate-onboarding-sub">They accumulate notes, decisions, and observations on their own</span></div></li>' +
      '</ul>' +
      '<button class="mate-onboarding-btn">Let\u2019s go</button>' +
    '</div>';

  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(function () {
    overlay.classList.add("visible");
  });

  function dismissOnboarding() {
    try { localStorage.setItem(MATE_ONBOARDING_KEY, "1"); } catch (e) {}
    fetch("/api/user/mate-onboarded", { method: "POST" }).catch(function () {});
    overlay.classList.remove("visible");
    setTimeout(function () { overlay.remove(); callback(); }, 200);
  }

  overlay.querySelector(".mate-onboarding-btn").addEventListener("click", dismissOnboarding);

  // Click outside to dismiss
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) dismissOnboarding();
  });
}

export function enterDmMode(key, targetUser, messages) {
  console.log("[DEBUG enterDmMode] key=" + key, "isMate=" + (targetUser && targetUser.isMate), "messages=" + (messages ? messages.length : 0));
  // Clean up previous DM/mate state before entering new one
  if (_ctx.dmMode) {
    _ctx.hideMateSidebar();
    _ctx.hideKnowledge();
    _ctx.hideMemory();
    // Reset dm-header-bar
    var prevHeader = document.getElementById("dm-header-bar");
    if (prevHeader) {
      prevHeader.style.display = "";
      prevHeader.style.background = "";
      var prevTag = prevHeader.querySelector(".dm-header-mate-tag");
      if (prevTag) prevTag.remove();
    }
    // Remove dm-mode classes
    var prevMain = document.getElementById("main-column");
    if (prevMain) prevMain.classList.remove("dm-mode");
    var prevSidebar = document.getElementById("sidebar-column");
    if (prevSidebar) prevSidebar.classList.remove("dm-mode");
    var prevResize = document.getElementById("sidebar-resize-handle");
    if (prevResize) prevResize.classList.remove("dm-mode");
    // Reset chat title bar
    var prevTitleBar = document.querySelector(".title-bar-content");
    if (prevTitleBar) {
      prevTitleBar.style.background = "";
      prevTitleBar.classList.remove("mate-dm-active");
    }
  }

  _ctx.dmMode = true;
  _ctx.dmKey = key;
  _ctx.dmTargetUser = targetUser;

  // Notify server of active mate DM (server-side presence tracking)
  // IMPORTANT: set_mate_dm must go to the MAIN project, not a mate project WS.
  // When switching between mates, ws points to the current mate project,
  // so we defer sending set_mate_dm until we reconnect to the main project's context.
  // The server will also receive it via the mate project's onDmMessage handler,
  // but the presence should only be stored on the main project slug.
  if (targetUser && targetUser.isMate) {
    // Send to the current WS only if it's the main project (not another mate)
    if (!_ctx.mateProjectSlug && _ctx.ws && _ctx.ws.readyState === 1) {
      try { _ctx.ws.send(JSON.stringify({ type: "set_mate_dm", mateId: targetUser.id })); } catch(e) {}
    }
  }

  // Clear unread for this user
  if (targetUser) {
    _ctx.dmUnread[targetUser.id] = 0;
    _ctx.updateDmBadge(targetUser.id, 0);
  }

  // Update icon strip active state
  _ctx.setCurrentDmUser(targetUser ? targetUser.id : null);
  var activeProj = document.querySelector("#icon-strip-projects .icon-strip-item.active");
  if (activeProj) activeProj.classList.remove("active");
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) homeIcon.classList.remove("active");
  // Re-render user strip to show active state
  if (_ctx.cachedProjects && _ctx.cachedProjects.length > 0) {
    _ctx.renderProjectList();
  }

  // Hide home hub if visible
  _ctx.hideHomeHub();

  // Hide sticky notes if visible
  _ctx.hideNotes();

  var isMate = targetUser && targetUser.isMate;

  // Hide project UI + sidebar, show DM UI
  var mainCol = document.getElementById("main-column");
  if (mainCol && !isMate) mainCol.classList.add("dm-mode");
  var sidebarCol = document.getElementById("sidebar-column");
  if (sidebarCol) sidebarCol.classList.add("dm-mode");
  var resizeHandle = document.getElementById("sidebar-resize-handle");
  if (resizeHandle) resizeHandle.classList.add("dm-mode");
  // Sync resize handles after DM sidebar appears
  setTimeout(function () { if (_ctx.syncResizeHandles) _ctx.syncResizeHandles(); }, 50);
  if (isMate && targetUser.projectSlug) {
    // Mate DM: switch to mate's project (same as project switching)
    _ctx.showMateSidebar(targetUser.id, targetUser);
    // Close file viewer and terminal panel BEFORE switching WS (needs old WS still open)
    try { _ctx.closeFileViewer(); } catch(e) {}
    _ctx.closeTerminal();
    // Apply mate color to chat title bar and panels
    var mateColor = (targetUser.profile && targetUser.profile.avatarColor) || targetUser.avatarColor || "#7c3aed";
    document.body.style.setProperty("--mate-color", mateColor);
    document.body.style.setProperty("--mate-color-tint", mateColor + "0a");
    document.body.classList.add("mate-dm-active");
    // Build mate avatar URL for DM bubble injection
    var mp = targetUser.profile || {};
    var mateAvUrlDm = _ctx.mateAvatarUrl(targetUser, 36);
    var myUser = _ctx.cachedAllUsers.find(function (u) { return u.id === _ctx.myUserId; });
    if (!myUser) {
      try { var cached = JSON.parse(localStorage.getItem("clay_my_user") || "null"); if (cached) myUser = cached; } catch(e) {}
    }
    var myAvatarUrl = _ctx.userAvatarUrl(myUser || { id: _ctx.myUserId }, 36);
    var myDisplayName = (myUser && myUser.displayName) || "";
    document.body.dataset.mateAvatarUrl = mateAvUrlDm;
    document.body.dataset.mateName = mp.displayName || targetUser.displayName || targetUser.name || "";
    document.body.dataset.myAvatarUrl = myAvatarUrl;
    document.body.dataset.myDisplayName = myDisplayName;
    // Cache my info for restore after hard refresh
    if (myUser) {
      try { localStorage.setItem("clay_my_user", JSON.stringify({ displayName: myUser.displayName, avatarStyle: myUser.avatarStyle, avatarSeed: myUser.avatarSeed, avatarCustom: myUser.avatarCustom, username: myUser.username })); } catch(e) {}
    }
    var titleBarContent = document.querySelector(".title-bar-content");
    if (titleBarContent) {
      titleBarContent.style.background = mateColor;
      titleBarContent.classList.add("mate-dm-active");
    }
    // Populate mobile title bar for mate DM (CSS handles visibility via media query)
    var mateMobileTitle = document.getElementById("mate-mobile-title");
    if (mateMobileTitle) {
      var mateMobileAvatar = document.getElementById("mate-mobile-avatar");
      var mateMobileName = document.getElementById("mate-mobile-name");
      var mateMobileStatus = document.getElementById("mate-mobile-status");
      if (mateMobileAvatar) mateMobileAvatar.src = mateAvUrlDm;
      if (mateMobileName) mateMobileName.textContent = (mp.displayName || targetUser.displayName || targetUser.name || "");
      if (mateMobileStatus) mateMobileStatus.textContent = "online";
      mateMobileTitle.classList.remove("hidden");
      // Store mate data for profile sheet
      _ctx.setMobileSheetMateData({
          id: targetUser.id,
          displayName: mp.displayName || targetUser.displayName || targetUser.name || "",
          description: mp.description || targetUser.description || "",
          avatarUrl: mateAvUrlDm,
          color: mateColor
        });
    }
    // Switch to mate project WS LAST, after all UI setup is complete.
    // Must be last because connect() changes ws to CONNECTING state,
    // and earlier code (closeFileViewer etc.) needs the old WS still open.
    connectMateProject(targetUser.projectSlug);
  }

  // Hide user-island in human DM, keep visible in Mate DM
  var userIsland = document.getElementById("user-island");
  if (userIsland && !isMate) userIsland.classList.add("dm-hidden");

  // Render DM messages
  _ctx.dmMessageCache = messages ? messages.slice() : [];
  _ctx.messagesEl.innerHTML = "";
  if (messages && messages.length > 0) {
    for (var i = 0; i < messages.length; i++) {
      appendDmMessage(messages[i]);
    }
  }
  _ctx.scrollToBottom();

  // Focus input
  if (_ctx.inputEl) {
    var targetName = targetUser ? ((targetUser.profile && targetUser.profile.displayName) || targetUser.displayName || targetUser.name || "") : "";
    _ctx.inputEl.placeholder = "Message " + targetName;
    _ctx.inputEl.focus();
  }

  // Populate DM header bar with user avatar, name, and personal color
  if (targetUser) {
    var dmHeaderBar = document.getElementById("dm-header-bar");
    var dmAvatar = document.getElementById("dm-header-avatar");
    var dmName = document.getElementById("dm-header-name");
    if (isMate) {
      // Mate uses project chat title bar, hide DM header
      if (dmHeaderBar) dmHeaderBar.style.display = "none";
    } else {
      if (dmHeaderBar) dmHeaderBar.style.display = "";
      if (dmAvatar) {
        dmAvatar.src = _ctx.userAvatarUrl(targetUser, 28);
      }
      if (dmName) dmName.textContent = targetUser.displayName;
      if (dmHeaderBar && targetUser.avatarColor) {
        dmHeaderBar.style.background = targetUser.avatarColor;
      }
      // Remove mate tag for regular DM
      var existingTag = dmHeaderBar ? dmHeaderBar.querySelector(".dm-header-mate-tag") : null;
      if (existingTag) existingTag.remove();
    }
  }
}

export function exitDmMode(skipProjectSwitch) {
  if (!_ctx.dmMode) return;
  var wasMate = _ctx.dmTargetUser && _ctx.dmTargetUser.isMate;
  _ctx.dmMode = false;
  _ctx.dmKey = null;
  _ctx.dmTargetUser = null;
  try { localStorage.removeItem("clay-active-dm"); } catch (e) {}
  _ctx.setCurrentDmUser(null);

  var mainCol = document.getElementById("main-column");
  if (mainCol) mainCol.classList.remove("dm-mode");
  var sidebarCol = document.getElementById("sidebar-column");
  if (sidebarCol) sidebarCol.classList.remove("dm-mode");
  var resizeHandle = document.getElementById("sidebar-resize-handle");
  if (resizeHandle) resizeHandle.classList.remove("dm-mode");
  // Re-sync resize handle positions after DM width changes
  if (_ctx.syncResizeHandles) _ctx.syncResizeHandles();
  _ctx.hideMateSidebar();
  _ctx.hideKnowledge();
  _ctx.hideMemory();
  if (_ctx.isSchedulerOpen()) _ctx.closeScheduler();
  // Reset DM header
  var dmHeaderBar = document.getElementById("dm-header-bar");
  if (dmHeaderBar) {
    dmHeaderBar.style.display = "";
    dmHeaderBar.style.background = "";
    var mateTag = dmHeaderBar.querySelector(".dm-header-mate-tag");
    if (mateTag) mateTag.remove();
  }
  // Reset chat title bar and mate color
  document.body.style.removeProperty("--mate-color");
  document.body.style.removeProperty("--mate-color-tint");
  document.body.classList.remove("mate-dm-active");
  delete document.body.dataset.mateAvatarUrl;
  delete document.body.dataset.mateName;
  delete document.body.dataset.myAvatarUrl;
  // Remove injected DM bubble avatars
  var bubbleAvatars = _ctx.messagesEl.querySelectorAll(".dm-bubble-avatar");
  for (var ba = 0; ba < bubbleAvatars.length; ba++) bubbleAvatars[ba].remove();
  var titleBarContent = document.querySelector(".title-bar-content");
  if (titleBarContent) {
    titleBarContent.style.background = "";
    titleBarContent.classList.remove("mate-dm-active");
  }
  // Hide mobile mate title bar
  var mateMobileTitle = document.getElementById("mate-mobile-title");
  if (mateMobileTitle) mateMobileTitle.classList.add("hidden");

  // Restore user-island (covers my avatar again)
  var userIsland = document.getElementById("user-island");
  if (userIsland) userIsland.classList.remove("dm-hidden");

  if (_ctx.inputEl) _ctx.inputEl.placeholder = "";

  // Switch back to main project (same as project switching)
  if (wasMate && !skipProjectSwitch) {
    disconnectMateProject();
  } else if (wasMate && skipProjectSwitch) {
    // Just clean up mate state, caller will handle project switch
    _ctx.returningFromMateDm = true;
    _ctx.mateProjectSlug = null;
    _ctx.savedMainSlug = null;
    _ctx.showDebateSticky("hide", null);
    var debateFloat = document.getElementById("debate-info-float");
    if (debateFloat) { debateFloat.classList.add("hidden"); debateFloat.innerHTML = ""; }
  } else {
    // Human DM: just re-request state from main project
    if (_ctx.ws && _ctx.ws.readyState === 1) {
      _ctx.ws.send(JSON.stringify({ type: "switch_session", id: _ctx.activeSessionId }));
      _ctx.ws.send(JSON.stringify({ type: "note_list_request" }));
    }
  }
  _ctx.renderProjectList();
}

export function handleMateCreatedInApp(mate, msg) {
  if (!mate) return;
  _ctx.cachedMatesList.push(mate);
  if (msg && msg.availableBuiltins) _ctx.cachedAvailableBuiltins = msg.availableBuiltins;
  if (msg && msg.dmFavorites) _ctx.cachedDmFavorites = msg.dmFavorites;
  _ctx.renderUserStrip(_ctx.cachedAllUsers, _ctx.cachedOnlineIds, _ctx.myUserId, _ctx.cachedDmFavorites, _ctx.cachedDmConversations, _ctx.dmUnread, _ctx.dmRemovedUsers, _ctx.cachedMatesList);
  // Built-in mates handle their own onboarding via CLAUDE.md, skip auto-interview
  if (!mate.builtinKey) {
    _ctx.pendingMateInterview = mate;
  }
  openDm(mate.id);
}

export function renderAvailableBuiltins(builtins) {
  // Append deleted built-in mates to the mates list in the picker
  var matesList = document.querySelector(".dm-mates-list");
  if (!matesList) return;
  if (!builtins || builtins.length === 0) return;

  for (var i = 0; i < builtins.length; i++) {
    (function (b) {
      var item = document.createElement("div");
      item.className = "dm-user-picker-item dm-user-picker-builtin-item";
      item.style.opacity = "0.5";

      var av = document.createElement("img");
      av.className = "dm-user-picker-avatar";
      av.src = b.avatarCustom || "";
      av.alt = b.displayName;
      item.appendChild(av);

      var nameWrap = document.createElement("div");
      nameWrap.style.cssText = "flex:1;min-width:0;";
      var nameEl = document.createElement("span");
      nameEl.className = "dm-user-picker-name";
      nameEl.textContent = b.displayName;
      nameWrap.appendChild(nameEl);
      var bioEl = document.createElement("div");
      bioEl.style.cssText = "font-size:11px;color:var(--text-dimmer);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      bioEl.textContent = "Deleted";
      nameWrap.appendChild(bioEl);
      item.appendChild(nameWrap);

      var addBtn = document.createElement("button");
      addBtn.style.cssText = "border:none;background:none;cursor:pointer;padding:2px 6px;color:var(--accent, #6366f1);font-size:12px;font-weight:600;";
      addBtn.textContent = "+ Add";
      addBtn.title = "Re-add " + b.displayName;
      addBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (_ctx.ws && _ctx.ws.readyState === 1) {
          _ctx.ws.send(JSON.stringify({ type: "mate_readd_builtin", builtinKey: b.key }));
        }
        _ctx.closeDmUserPicker();
      });
      item.appendChild(addBtn);

      item.addEventListener("click", function () {
        if (_ctx.ws && _ctx.ws.readyState === 1) {
          _ctx.ws.send(JSON.stringify({ type: "mate_readd_builtin", builtinKey: b.key }));
        }
        _ctx.closeDmUserPicker();
      });

      matesList.appendChild(item);
    })(builtins[i]);
  }
}

export function buildMateInterviewPrompt(mate) {
  var sd = mate.seedData || {};
  var parts = [];
  var spokenLang = _ctx.getProfileLang() || "en-US";
  parts.push("Spoken Language: " + spokenLang);
  if (sd.relationship) parts.push("Relationship: " + sd.relationship);
  if (sd.activity && sd.activity.length > 0) parts.push("Activities: " + sd.activity.join(", "));
  if (sd.communicationStyle && sd.communicationStyle.length > 0) {
    var styleLabels = {
      direct_concise: "direct and concise",
      soft_detailed: "soft and detailed",
      witty: "witty",
      encouraging: "encouraging",
      formal: "formal",
      no_nonsense: "no-nonsense",
    };
    var styles = sd.communicationStyle.map(function (s) { return styleLabels[s] || s.replace(/_/g, " "); });
    parts.push("Communication: " + styles.join(", "));
  }
  if (sd.autonomy) parts.push("Autonomy: " + sd.autonomy.replace(/_/g, " "));

  return "Use the /clay-mate-interview skill to start the interview.\n\n" +
    "Mate ID: " + mate.id + "\n" +
    "Mate Directory: .claude/mates/" + mate.id + "\n\n" +
    "Seed Data:\n" + parts.join("\n");
}

export function updateMateIconStatus(msg) {
  if (!_ctx.mateProjectSlug) return;
  var slug = _ctx.mateProjectSlug;
  if (msg.type === "content" || msg.type === "tool" || msg.type === "tool_use" || msg.type === "thinking") {
    var ioDot = document.querySelector('.icon-strip-mate[data-mate-slug="' + slug + '"] .icon-strip-status');
    if (ioDot) {
      ioDot.classList.add("io");
      clearTimeout(bgMateIoTimers[slug]);
      bgMateIoTimers[slug] = setTimeout(function () { ioDot.classList.remove("io"); }, 80);
    }
  }
  if (msg.type === "status" && msg.status === "processing") {
    var dot = document.querySelector('.icon-strip-mate[data-mate-slug="' + slug + '"] .icon-strip-status');
    if (dot) dot.classList.add("processing");
    var mateSessionDot = document.querySelector(".mate-session-item.active .session-processing");
    if (mateSessionDot) mateSessionDot.style.display = "";
  }
  if (msg.type === "done") {
    var dot = document.querySelector('.icon-strip-mate[data-mate-slug="' + slug + '"] .icon-strip-status');
    if (dot) dot.classList.remove("processing");
    var mateSessionDot = document.querySelector(".mate-session-item.active .session-processing");
    if (mateSessionDot) mateSessionDot.style.display = "none";
  }
}

export function connectMateProject(slug) {
  _ctx.mateProjectSlug = slug;
  // Only save the main slug on the FIRST mate switch (preserve original main project)
  if (!_ctx.savedMainSlug) _ctx.savedMainSlug = _ctx.currentSlug;
  _ctx.currentSlug = slug;
  _ctx.wsPath = "/p/" + slug + "/ws";
  _ctx.resetClientState();
  _ctx.connect();
}

export function disconnectMateProject() {
  _ctx.mateProjectSlug = null;
  // Hide debate sticky when leaving mate DM
  _ctx.showDebateSticky("hide", null);
  // Hide debate info float
  var debateFloat = document.getElementById("debate-info-float");
  if (debateFloat) { debateFloat.classList.add("hidden"); debateFloat.innerHTML = ""; }
  // Switch back to main project
  if (_ctx.savedMainSlug) {
    _ctx.returningFromMateDm = true;
    _ctx.currentSlug = _ctx.savedMainSlug;
    _ctx.basePath = "/p/" + _ctx.savedMainSlug + "/";
    _ctx.wsPath = "/p/" + _ctx.savedMainSlug + "/ws";
    _ctx.savedMainSlug = null;
    _ctx.resetClientState();
    _ctx.connect();
  }
}

export function appendDmMessage(msg) {
  if (_ctx.dmMode) _ctx.dmMessageCache.push(msg);
  var isMe = msg.from === _ctx.myUserId;
  var d = new Date(msg.ts);
  var timeStr = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");

  // Check if we can compact (same sender as previous, within 5 min)
  var prev = _ctx.messagesEl.lastElementChild;
  var compact = false;
  if (prev && prev.dataset.from === msg.from) {
    var prevTs = parseInt(prev.dataset.ts || "0", 10);
    if (msg.ts - prevTs < 300000) compact = true;
  }

  var div = document.createElement("div");
  div.className = "dm-msg" + (compact ? " dm-msg-compact" : "");
  div.dataset.from = msg.from;
  div.dataset.ts = msg.ts;

  if (compact) {
    // Compact: just hover-time + text, no avatar/name
    var hoverTime = document.createElement("span");
    hoverTime.className = "dm-msg-hover-time";
    hoverTime.textContent = timeStr;
    div.appendChild(hoverTime);

    var body = document.createElement("div");
    body.className = "dm-msg-body";
    body.textContent = msg.text;
    div.appendChild(body);
  } else {
    // Full: avatar + header(name, time) + text
    var avatar = document.createElement("img");
    avatar.className = "dm-msg-avatar";
    if (isMe) {
      var myUser = _ctx.cachedAllUsers.find(function (u) { return u.id === _ctx.myUserId; });
      avatar.src = _ctx.userAvatarUrl(myUser || { id: _ctx.myUserId }, 36);
    } else if (_ctx.dmTargetUser) {
      avatar.src = _ctx.userAvatarUrl(_ctx.dmTargetUser, 36);
    }
    div.appendChild(avatar);

    var content = document.createElement("div");
    content.className = "dm-msg-content";

    var header = document.createElement("div");
    header.className = "dm-msg-header";

    var name = document.createElement("span");
    name.className = "dm-msg-name";
    if (isMe) {
      var mu = _ctx.cachedAllUsers.find(function (u) { return u.id === _ctx.myUserId; });
      name.textContent = mu ? mu.displayName : "Me";
    } else {
      name.textContent = _ctx.dmTargetUser ? _ctx.dmTargetUser.displayName : "User";
    }
    header.appendChild(name);

    var time = document.createElement("span");
    time.className = "dm-msg-time";
    time.textContent = timeStr;
    header.appendChild(time);

    content.appendChild(header);

    var body = document.createElement("div");
    body.className = "dm-msg-body";
    body.textContent = msg.text;
    content.appendChild(body);

    div.appendChild(content);
  }

  _ctx.messagesEl.appendChild(div);
}

export function showDmTypingIndicator(typing) {
  var existing = document.getElementById("dm-typing-indicator");
  if (!typing) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return; // already showing
  if (!_ctx.dmTargetUser) return;

  var div = document.createElement("div");
  div.id = "dm-typing-indicator";
  div.className = "dm-msg dm-typing-indicator";

  var avatar = document.createElement("img");
  avatar.className = "dm-msg-avatar";
  avatar.src = _ctx.userAvatarUrl(_ctx.dmTargetUser, 36);
  div.appendChild(avatar);

  var dots = document.createElement("div");
  dots.className = "dm-typing-dots";
  dots.innerHTML = "<span></span><span></span><span></span>";
  div.appendChild(dots);

  _ctx.messagesEl.appendChild(div);
  _ctx.scrollToBottom();

  // Auto-hide after 5s in case stop signal is missed
  clearTimeout(dmTypingTimer);
  dmTypingTimer = setTimeout(function () {
    showDmTypingIndicator(false);
  }, 5000);
}

export function handleDmSend() {
  if (!_ctx.dmMode || !_ctx.dmKey || !_ctx.inputEl) return false;
  var text = _ctx.inputEl.value.trim();
  if (!text) return false;
  _ctx.ws.send(JSON.stringify({ type: "dm_send", dmKey: _ctx.dmKey, text: text }));
  _ctx.inputEl.value = "";
  _ctx.autoResize();
  return true;
}
