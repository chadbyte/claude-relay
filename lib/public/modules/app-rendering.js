// app-rendering.js - Message rendering, streaming, scroll management, system messages
// Extracted from app.js (PR-28)

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getMessagesEl, getInputEl, getSendBtn } from './dom-refs.js';
import { escapeHtml, copyToClipboard } from './utils.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks } from './markdown.js';
import { iconHtml, refreshIcons } from './icons.js';
import { userAvatarUrl } from './avatar.js';
import { closeToolGroup } from './tools.js';
import { showImageModal, showPasteModal } from './app-misc.js';
import { sendMessage, hasSendableContent } from './input.js';
import { getChatLayout } from './theme.js';
import { getScheduledMsgEl } from './app-rate-limit.js';

export var VENDOR_AVATARS = {
  claude: "/claude-code-avatar.png",
  codex: "/codex-avatar.png",
};
export var VENDOR_NAMES = {
  claude: "Claude Code",
  codex: "Codex",
};
var NEW_MSG_BTN_DEFAULT = "\u2193 Latest";
var NEW_MSG_BTN_ACTIVITY = "\u2193 New activity";

// --- Module-owned state (not in store) ---
var turnCounter = 0;
var prependAnchor = null;
var activityEl = null;
var matePreThinkingTimer = null;
var highlightTimer = null;
var streamBuffer = "";
var streamDrainTimer = null;
var isUserScrolledUp = false;
var scrollThreshold = 150;

// --- Sticky-bottom mode ---
// While armed, a ResizeObserver re-pins #messages to scrollHeight on every
// height change so deferred content (tools, syntax highlighting, images,
// IntersectionObserver-driven reflows) doesn't strand the user mid-page.
// The scroll listener in app.js consults getStickyBottom() and ignores
// growth-induced scroll events while armed.
//
// Disarm rules:
//   - Real user input (wheel / touchmove / PageUp / Home / ArrowUp): immediate.
//   - Quiet detector: armStickyBottom(durationMs) treats durationMs as the
//     QUIET WINDOW, not a hard timer. Each ResizeObserver callback resets
//     a debounce timer; sticky-bottom only disarms after no resize for
//     durationMs. Long-settling sessions (large todo widgets, slow code
//     highlighting) keep extending the window naturally.
//   - Hard ceiling: a separate cap prevents pathological lock-in.
var stickyBottom = false;
var stickyBottomQuietTimer = null;
var stickyBottomCeilingTimer = null;
var stickyBottomQuietMs = 750;
var stickyBottomCeilingMs = 8000;
var stickyBottomResizeObs = null;
var stickyBottomInputBound = false;

export function getStickyBottom() { return stickyBottom; }

function pinToBottomNow() {
  var messagesEl = getMessagesEl();
  if (!messagesEl) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function ensureStickyInfrastructure() {
  var messagesEl = getMessagesEl();
  if (!messagesEl) return;
  if (!stickyBottomResizeObs && typeof ResizeObserver !== "undefined") {
    stickyBottomResizeObs = new ResizeObserver(function () {
      if (!stickyBottom) return;
      // Re-pin on every layout change while armed.
      pinToBottomNow();
      // Reset the quiet timer — settling has not finished yet.
      if (stickyBottomQuietTimer) clearTimeout(stickyBottomQuietTimer);
      stickyBottomQuietTimer = setTimeout(disarmStickyBottom, stickyBottomQuietMs);
    });
    stickyBottomResizeObs.observe(messagesEl);
    // Also observe direct children so child-size changes (image loads, code
    // block highlighting, expanding tool groups) trigger a re-pin even when
    // they don't change the scroller's own size.
    var kids = messagesEl.children;
    for (var i = 0; i < kids.length; i++) stickyBottomResizeObs.observe(kids[i]);
  }
  if (!stickyBottomInputBound) {
    stickyBottomInputBound = true;
    var disarmOnUserScroll = function () { disarmStickyBottom(); };
    messagesEl.addEventListener("wheel", disarmOnUserScroll, { passive: true });
    messagesEl.addEventListener("touchmove", disarmOnUserScroll, { passive: true });
    document.addEventListener("keydown", function (e) {
      if (!stickyBottom) return;
      if (e.key === "PageUp" || e.key === "Home" || e.key === "ArrowUp") {
        disarmStickyBottom();
      }
    });
  }
}

export function armStickyBottom(durationMs) {
  if (prependAnchor) return; // never fight pagination
  ensureStickyInfrastructure();
  stickyBottom = true;
  isUserScrolledUp = false;
  var newMsgBtn = document.getElementById("new-msg-btn");
  if (newMsgBtn) {
    newMsgBtn.classList.add("hidden");
    newMsgBtn.textContent = NEW_MSG_BTN_DEFAULT;
  }
  pinToBottomNow();
  // After children may have been replaced since last arm, re-observe.
  if (stickyBottomResizeObs) {
    var messagesEl = getMessagesEl();
    if (messagesEl) {
      var kids = messagesEl.children;
      for (var i = 0; i < kids.length; i++) {
        try { stickyBottomResizeObs.observe(kids[i]); } catch (e) {}
      }
    }
  }
  // Quiet window: callers pass intended quiet duration; ResizeObserver
  // resets this each time layout changes, so the actual armed duration
  // stretches to "no resize for durationMs".
  stickyBottomQuietMs = durationMs || 750;
  if (stickyBottomQuietTimer) clearTimeout(stickyBottomQuietTimer);
  stickyBottomQuietTimer = setTimeout(disarmStickyBottom, stickyBottomQuietMs);
  // Hard ceiling so we never lock the scroller indefinitely if some
  // animation/observer keeps firing forever.
  if (stickyBottomCeilingTimer) clearTimeout(stickyBottomCeilingTimer);
  stickyBottomCeilingTimer = setTimeout(disarmStickyBottom, stickyBottomCeilingMs);
}

export function disarmStickyBottom() {
  stickyBottom = false;
  if (stickyBottomQuietTimer) { clearTimeout(stickyBottomQuietTimer); stickyBottomQuietTimer = null; }
  if (stickyBottomCeilingTimer) { clearTimeout(stickyBottomCeilingTimer); stickyBottomCeilingTimer = null; }
}

export function initRendering() {
  // Update input placeholder when vendor changes
  store.subscribe(function (state, prev) {
    if (state.currentVendor !== prev.currentVendor) {
      var inputEl = document.getElementById("input");
      if (inputEl) {
        inputEl.placeholder = "Message " + (VENDOR_NAMES[state.currentVendor] || VENDOR_NAMES.claude) + "...";
      }
    }
  });
}

// --- State accessors (module-local, not in store) ---
export function getTurnCounter() { return turnCounter; }
export function setTurnCounter(v) { turnCounter = v; }
export function getPrependAnchor() { return prependAnchor; }
export function setPrependAnchor(v) { prependAnchor = v; }
export function getActivityEl() { return activityEl; }
export function setActivityEl(v) { activityEl = v; }
export function getIsUserScrolledUp() { return isUserScrolledUp; }
export function setIsUserScrolledUp(v) { isUserScrolledUp = v; }

// --- Rendering functions ---

export function addToMessages(el) {
  var messagesEl = getMessagesEl();
  if (prependAnchor) messagesEl.insertBefore(el, prependAnchor);
  else messagesEl.appendChild(el);
  var _sme = getScheduledMsgEl();
  if (_sme && el !== _sme && _sme.parentNode === messagesEl) {
    messagesEl.appendChild(_sme);
  }
}

export function scrollToBottom() {
  if (prependAnchor) return;
  var newMsgBtn = document.getElementById("new-msg-btn");
  if (isUserScrolledUp) {
    newMsgBtn.textContent = NEW_MSG_BTN_ACTIVITY;
    newMsgBtn.classList.remove("hidden");
    return;
  }
  var messagesEl = getMessagesEl();
  requestAnimationFrame(function () {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

export function forceScrollToBottom() {
  if (prependAnchor) return;
  // Arm sticky-bottom mode so deferred layout (tool widgets, code highlighting,
  // image loads) can't strand the user partway down — single-rAF pin captures
  // a stale scrollHeight, then growth below pushes the bottom further away.
  // The quiet detector extends the window automatically while layout shifts.
  armStickyBottom(750);
}

export function getMsgTime() {
  var _ts = store.get('currentMsgTs');
  var d = _ts ? new Date(_ts) : new Date();
  var time = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  var now = new Date();
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return time;
  }
  return (d.getMonth() + 1) + "/" + d.getDate() + " " + time;
}

export function shouldGroupMessage(senderClass) {
  var _s = store.snap();
  if (_s.replayingHistory && !_s.currentMsgTs) return false;
  var prev = getMessagesEl().lastElementChild;
  if (!prev || !prev.classList.contains(senderClass)) return false;
  var prevTime = prev.querySelector(".dm-bubble-time");
  if (!prevTime) return false;
  return prevTime.textContent === getMsgTime();
}

export function ensureAssistantBlock() {
  var _el = store.get('currentMsgEl');
  if (!_el) {
    _el = document.createElement("div");
    _el.className = "msg-assistant";
    _el.dataset.turn = turnCounter;

    var grouped = shouldGroupMessage("msg-assistant");
    if (grouped) _el.classList.add("grouped");

    var _isDm2 = document.body.classList.contains("mate-dm-active") && document.body.dataset.mateAvatarUrl;
    var vendor = store.get('currentVendor') || "claude";
    var avi = document.createElement("img");
    avi.className = "dm-bubble-avatar dm-bubble-avatar-mate";
    avi.src = _isDm2 ? document.body.dataset.mateAvatarUrl : (VENDOR_AVATARS[vendor] || VENDOR_AVATARS.claude);
    _el.appendChild(avi);

    var contentWrap = document.createElement("div");
    contentWrap.className = "dm-bubble-content";

    var header = document.createElement("div");
    header.className = "dm-bubble-header";
    var nameSpan = document.createElement("span");
    nameSpan.className = "dm-bubble-name";
    var dmTarget = store.get('dmTargetUser');
    nameSpan.textContent = _isDm2 ? ((dmTarget && dmTarget.displayName) || "Mate") : (VENDOR_NAMES[vendor] || VENDOR_NAMES.claude);
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
    _el.appendChild(contentWrap);
    addToMessages(_el);
    store.set({ currentMsgEl: _el, currentFullText: "" });
  }
  return _el;
}

export function addCopyHandler(msgEl, rawText) {
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
    if (e.target.closest("a, pre, code")) return;
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

export function appendDelta(text) {
  ensureAssistantBlock();
  streamBuffer += text;
  if (!streamDrainTimer) {
    streamDrainTimer = requestAnimationFrame(drainStreamTick);
  }
}

function drainStreamTick() {
  streamDrainTimer = null;
  var _s = store.snap();
  if (!_s.currentMsgEl || streamBuffer.length === 0) return;

  var n;
  var len = streamBuffer.length;
  if (len > 200) { n = Math.ceil(len / 4); }
  else if (len > 80) { n = 8; }
  else if (len > 30) { n = 5; }
  else if (len > 10) { n = 2; }
  else { n = 1; }

  var chunk = streamBuffer.slice(0, n);
  streamBuffer = streamBuffer.slice(n);
  var newText = _s.currentFullText + chunk;
  store.set({ currentFullText: newText });

  var contentEl = _s.currentMsgEl.querySelector(".md-content");
  contentEl.innerHTML = renderMarkdown(newText);

  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(function () {
    highlightCodeBlocks(contentEl);
  }, 150);

  scrollToBottom();

  if (streamBuffer.length > 0) {
    streamDrainTimer = requestAnimationFrame(drainStreamTick);
  }
}

export function flushStreamBuffer() {
  if (streamDrainTimer) { cancelAnimationFrame(streamDrainTimer); streamDrainTimer = null; }
  if (streamBuffer.length > 0) {
    store.set({ currentFullText: store.get('currentFullText') + streamBuffer });
    streamBuffer = "";
  }
  var _s = store.snap();
  if (_s.currentMsgEl) {
    var contentEl = _s.currentMsgEl.querySelector(".md-content");
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(_s.currentFullText);
      highlightCodeBlocks(contentEl);
    }
  }
}

export function finalizeAssistantBlock() {
  flushStreamBuffer();
  var _s = store.snap();
  if (_s.currentMsgEl) {
    var contentEl = _s.currentMsgEl.querySelector(".md-content");
    if (contentEl) {
      highlightCodeBlocks(contentEl);
      renderMermaidBlocks(contentEl);
    }
    if (_s.currentFullText) {
      addCopyHandler(_s.currentMsgEl, _s.currentFullText);
    }
    closeToolGroup();
  }
  store.set({ currentMsgEl: null, currentFullText: "" });
}

export function addUserMessage(text, images, pastes, fromUserId, fromUserName) {
  if (!text && (!images || images.length === 0) && (!pastes || pastes.length === 0)) return;
  var myUserId = store.get('myUserId');
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


  var cachedAllUsers = store.get('cachedAllUsers');
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

  var actions = document.createElement("div");
  actions.className = "msg-actions";
  actions.innerHTML =
    '<span class="msg-action-time">' + getMsgTime() + '</span>' +
    '<button class="msg-action-btn msg-action-copy" type="button" title="Copy">' + iconHtml("copy") + '</button>' +
    '<button class="msg-action-btn msg-action-fork" type="button" title="Fork">' + iconHtml("git-branch") + '</button>' +
    (((store.get('vendorCapabilities') || {}).rewind !== false) ? '<button class="msg-action-btn msg-action-rewind msg-user-rewind-btn" type="button" title="Rewind">' + iconHtml("rotate-ccw") + '</button>' : '') +
    '<button class="msg-action-btn msg-action-hidden msg-action-edit" type="button" title="Edit">' + iconHtml("pencil") + '</button>';
  div.appendChild(actions);

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

export function addSystemMessage(text, isError) {
  var div = document.createElement("div");
  div.className = "sys-msg" + (isError ? " error" : "");
  div.innerHTML = '<span class="sys-text"></span>';
  div.querySelector(".sys-text").textContent = text;
  addToMessages(div);
  scrollToBottom();
}

export function addConflictMessage(msg) {
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
      getWs().send(JSON.stringify({ type: "kill_process", pid: pid }));
      this.disabled = true;
      this.textContent = "Killing...";
    });
    row.appendChild(killBtn);
    div.appendChild(row);
  }

  addToMessages(div);
  scrollToBottom();
}

export function addContextOverflowMessage(msg) {
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
    getWs().send(JSON.stringify({ type: "new_session" }));
  });
  div.appendChild(btn);

  addToMessages(div);
  scrollToBottom();
}

// --- Pre-thinking (instant dots before server responds) ---

export function showClaudePreThinking() {
  if (getChatLayout() !== "channel") return;
  var vendor = store.get('currentVendor') || "claude";
  var vendorAvatar = VENDOR_AVATARS[vendor] || VENDOR_AVATARS.claude;
  var vendorName = VENDOR_NAMES[vendor] || VENDOR_NAMES.claude;
  doShowMatePreThinking(vendorName, vendorAvatar);
}

export function showMatePreThinking() {
  removeMatePreThinking();
  var dmTarget = store.get('dmTargetUser');
  var mateName = dmTarget ? (dmTarget.displayName || "Mate") : "Mate";
  var mateAvatar = document.body.dataset.mateAvatarUrl || "";
  doShowMatePreThinking(mateName, mateAvatar);
}

function doShowMatePreThinking(mateName, mateAvatar) {
  var _el = document.createElement("div");
  _el.className = "thinking-item mate-thinking mate-pre-thinking";
  _el.innerHTML =
    '<img class="dm-bubble-avatar dm-bubble-avatar-mate" src="' + escapeHtml(mateAvatar) + '" alt="" style="display:block">' +
    '<div class="dm-bubble-content">' +
    '<div class="dm-bubble-header"><span class="dm-bubble-name">' + escapeHtml(mateName) + '</span></div>' +
    '<div class="mate-thinking-dots"><span></span><span></span><span></span></div>' +
    '</div>';
  store.set({ matePreThinkingEl: _el });
  if (activityEl && activityEl.parentNode) {
    activityEl.parentNode.insertBefore(_el, activityEl);
  } else {
    addToMessages(_el);
  }
  refreshIcons();
  scrollToBottom();
}

export function removeMatePreThinking() {
  if (matePreThinkingTimer) {
    clearTimeout(matePreThinkingTimer);
    matePreThinkingTimer = null;
  }
  var _el = store.get('matePreThinkingEl');
  if (_el) {
    _el.remove();
    store.set({ matePreThinkingEl: null });
  }
}

// --- Ghost suggestion (prompt recommendation as ghost text) ---

var _ghostSuggestionText = "";

export function getGhostSuggestion() {
  return _ghostSuggestionText;
}

export function showSuggestionChips(suggestion) {
  if (!suggestion || store.get('processing')) return;
  // Only show ghost text when there is no sendable content — typed text,
  // pending pastes, pending images, or pending files all suppress the
  // suggestion so Enter can't accidentally send it instead of the user's
  // actual attached content.
  if (hasSendableContent()) return;
  _ghostSuggestionText = suggestion;
  var ghostEl = document.getElementById("ghost-suggestion");
  if (!ghostEl) return;
  ghostEl.innerHTML = escapeHtml(suggestion) +
    ' <span class="ghost-hint"><kbd>Enter</kbd> to send</span>';
  ghostEl.classList.remove("hidden");
}

export function hideSuggestionChips() {
  _ghostSuggestionText = "";
  var ghostEl = document.getElementById("ghost-suggestion");
  if (ghostEl) {
    ghostEl.innerHTML = "";
    ghostEl.classList.add("hidden");
  }
}
