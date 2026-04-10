// app-header.js - Session rename, session info popover, progressive history loading
// Extracted from app.js (PR-34)

import { refreshIcons, iconHtml } from './icons.js';
import { escapeHtml, copyToClipboard } from './utils.js';

var _ctx = null;

// --- Module-owned state ---
var sessionInfoPopover = null;
var historySentinelObserver = null;

export function initHeader(ctx) {
  _ctx = ctx;

  // --- Header session rename ---
  if (_ctx.headerRenameBtn) {
    _ctx.headerRenameBtn.addEventListener("click", function () {
      if (!_ctx.activeSessionId) return;
      var currentText = _ctx.headerTitleEl.textContent;
      var input = document.createElement("input");
      input.type = "text";
      input.className = "header-rename-input";
      input.value = currentText;
      _ctx.headerTitleEl.style.display = "none";
      _ctx.headerRenameBtn.style.display = "none";
      _ctx.headerTitleEl.parentNode.insertBefore(input, _ctx.headerTitleEl.nextSibling);
      input.focus();
      input.select();

      function commit() {
        var newTitle = input.value.trim();
        var ws = _ctx.getWs();
        if (newTitle && newTitle !== currentText && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "rename_session", id: _ctx.activeSessionId, title: newTitle }));
          _ctx.headerTitleEl.textContent = newTitle;
        }
        input.remove();
        _ctx.headerTitleEl.style.display = "";
        _ctx.headerRenameBtn.style.display = "";
      }

      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") {
          e.preventDefault();
          input.remove();
          _ctx.headerTitleEl.style.display = "";
          _ctx.headerRenameBtn.style.display = "";
        }
      });
      input.addEventListener("blur", commit);
    });
  }

  // --- Session info popover ---
  if (_ctx.headerInfoBtn) {
    _ctx.headerInfoBtn.addEventListener("click", function (e) {
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

      if (_ctx.cliSessionId) addRow("Session ID", _ctx.cliSessionId);
      if (_ctx.activeSessionId) addRow("Local ID", _ctx.activeSessionId);
      if (_ctx.cliSessionId) addRow("Resume", "claude --resume " + _ctx.cliSessionId);

      document.body.appendChild(pop);
      sessionInfoPopover = pop;
      refreshIcons();

      var btnRect = _ctx.headerInfoBtn.getBoundingClientRect();
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
}

export function closeSessionInfoPopover() {
  if (sessionInfoPopover) {
    sessionInfoPopover.remove();
    sessionInfoPopover = null;
  }
}

export function updateHistorySentinel() {
  var existing = _ctx.messagesEl.querySelector(".history-sentinel");
  if (_ctx.historyFrom > 0) {
    if (!existing) {
      var sentinel = document.createElement("div");
      sentinel.className = "history-sentinel";
      sentinel.innerHTML = '<button class="load-more-btn">Load earlier messages</button>';
      sentinel.querySelector(".load-more-btn").addEventListener("click", function () {
        requestMoreHistory();
      });
      _ctx.messagesEl.insertBefore(sentinel, _ctx.messagesEl.firstChild);

      // Auto-load when sentinel scrolls into view
      if (historySentinelObserver) historySentinelObserver.disconnect();
      historySentinelObserver = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !_ctx.loadingMore && _ctx.historyFrom > 0) {
          requestMoreHistory();
        }
      }, { root: _ctx.messagesEl, rootMargin: "200px 0px 0px 0px" });
      historySentinelObserver.observe(sentinel);
    }
  } else {
    if (existing) existing.remove();
    if (historySentinelObserver) { historySentinelObserver.disconnect(); historySentinelObserver = null; }
  }
}

export function requestMoreHistory() {
  var ws = _ctx.getWs();
  if (_ctx.loadingMore || _ctx.historyFrom <= 0 || !ws || !_ctx.connected) return;
  _ctx.setLoadingMore(true);
  var btn = _ctx.messagesEl.querySelector(".load-more-btn");
  if (btn) btn.classList.add("loading");
  ws.send(JSON.stringify({ type: "load_more_history", before: _ctx.historyFrom }));
}

export function prependOlderHistory(items, meta) {
  // Save current rendering state
  var savedMsgEl = _ctx.getCurrentMsgEl();
  var savedActivity = _ctx.getActivityEl();
  var savedFullText = _ctx.getCurrentFullText();
  var savedTurnCounter = _ctx.getTurnCounter();
  var savedToolsState = _ctx.saveToolState();
  // Save context & usage so old result messages don't overwrite current values
  var savedContext = JSON.parse(JSON.stringify(_ctx.getContextData()));
  var savedUsage = JSON.parse(JSON.stringify(_ctx.getSessionUsage()));

  // Reset to initial values for clean rendering
  _ctx.setCurrentMsgEl(null);
  _ctx.setActivityEl(null);
  _ctx.setCurrentFullText("");
  _ctx.setTurnCounter(0);
  _ctx.resetToolState();

  // Set prepend anchor to insert before existing content
  // Skip the sentinel itself when setting anchor
  var firstReal = _ctx.messagesEl.querySelector(".history-sentinel");
  _ctx.setPrependAnchor(firstReal ? firstReal.nextSibling : _ctx.messagesEl.firstChild);

  // Remember the first existing content element and its position
  var anchorEl = _ctx.getPrependAnchor();
  var anchorOffset = anchorEl ? anchorEl.getBoundingClientRect().top : 0;

  // Process each item through the rendering pipeline
  for (var i = 0; i < items.length; i++) {
    _ctx.processMessage(items[i]);
  }

  // Finalize any open assistant block from the batch
  _ctx.finalizeAssistantBlock();

  // Clear prepend mode
  _ctx.setPrependAnchor(null);

  // Restore saved state
  _ctx.setCurrentMsgEl(savedMsgEl);
  _ctx.setActivityEl(savedActivity);
  _ctx.setCurrentFullText(savedFullText);
  _ctx.setTurnCounter(savedTurnCounter);
  _ctx.restoreToolState(savedToolsState);
  // Restore context & usage (old result messages must not overwrite current values)
  _ctx.setContextData(savedContext);
  _ctx.setSessionUsage(savedUsage);
  _ctx.updateContextPanel();
  _ctx.updateUsagePanel();

  // Fix scroll: restore anchor element to same visual position
  if (anchorEl) {
    var newTop = anchorEl.getBoundingClientRect().top;
    _ctx.messagesEl.scrollTop += (newTop - anchorOffset);
  }

  // Update state
  _ctx.setHistoryFrom(meta.from);
  _ctx.setLoadingMore(false);

  // Renumber data-turn attributes in DOM order
  var turnEls = _ctx.messagesEl.querySelectorAll("[data-turn]");
  for (var t = 0; t < turnEls.length; t++) {
    turnEls[t].dataset.turn = t + 1;
  }
  _ctx.setTurnCounter(turnEls.length);

  // Update sentinel
  if (meta.hasMore) {
    var btn = _ctx.messagesEl.querySelector(".load-more-btn");
    if (btn) btn.classList.remove("loading");
  } else {
    updateHistorySentinel();
  }

  // Notify in-session search that history was prepended (for pending scroll targets)
  _ctx.onSessionSearchHistoryPrepended();
}
