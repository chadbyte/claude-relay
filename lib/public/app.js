import { copyToClipboard, escapeHtml } from './modules/utils.js';
import { refreshIcons, iconHtml, randomThinkingVerb } from './modules/icons.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks, closeMermaidModal } from './modules/markdown.js';
import { initSidebar, renderSessionList, updatePageTitle } from './modules/sidebar.js';
import { initRewind, setRewindMode, showRewindModal, clearPendingRewindUuid } from './modules/rewind.js';
import { initNotifications, showDoneNotification, playDoneSound, isNotifAlertEnabled, isNotifSoundEnabled } from './modules/notifications.js';
import { initInput, clearPendingImages, handleInputSync } from './modules/input.js';
import { initQrCode } from './modules/qrcode.js';
import { initFileBrowser, loadRootDirectory, handleFsList, handleFsRead, refreshIfOpen } from './modules/filebrowser.js';
import { initTerminal, openTerminal, handleTermOutput, handleTermExited, closeTerminal } from './modules/terminal.js';
import { initTools, resetToolState, saveToolState, restoreToolState, renderAskUserQuestion, markAskUserAnswered, renderPermissionRequest, markPermissionResolved, markPermissionCancelled, renderPlanBanner, renderPlanCard, handleTodoWrite, handleTaskCreate, handleTaskUpdate, startThinking, appendThinking, stopThinking, createToolItem, updateToolExecuting, updateToolResult, markAllToolsDone, addTurnMeta, enableMainInput, getTools, getPlanContent, setPlanContent, isPlanFilePath, getTodoTools } from './modules/tools.js';

// --- Base path for multi-project routing ---
  var slugMatch = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
  var basePath = slugMatch ? "/p/" + slugMatch[1] + "/" : "/";
  var wsPath = slugMatch ? "/p/" + slugMatch[1] + "/ws" : "/ws";

// --- DOM refs ---
  var $ = function (id) { return document.getElementById(id); };
  var messagesEl = $("messages");
  var inputEl = $("input");
  var sendBtn = $("send-btn");
  var statusDot = $("status-dot");
  var projectNameEl = $("project-name");
  var slashMenu = $("slash-menu");
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
  var connectVerbEl = $("connect-verb");
  var connectStatusEl = $("connect-status");

  // --- Project Switcher ---
  var projectSwitcher = $("project-switcher");
  var projectSwitcherBtn = $("project-switcher-btn");
  var projectDropdown = $("project-dropdown");
  var projectDropdownList = $("project-dropdown-list");
  var projectSwitcherName = $("project-switcher-name");
  var projectSwitcherCount = $("project-switcher-count");
  var projectHint = $("project-hint");
  var projectHintDismiss = $("project-hint-dismiss");
  var cachedProjects = [];
  var cachedProjectCount = 0;
  var currentSlug = slugMatch ? slugMatch[1] : null;

  function updateProjectSwitcher(msg) {
    if (typeof msg.projectCount === "number") cachedProjectCount = msg.projectCount;
    if (msg.projects) cachedProjects = msg.projects;
    var count = cachedProjectCount || 0;
    projectSwitcherName.textContent = projectName || "Project";
    projectSwitcherCount.textContent = count ? count + (count === 1 ? " project" : " projects") : "";
    if (count === 1 && projectHint) {
      try {
        if (!localStorage.getItem("claude-relay-project-hint-dismissed")) {
          projectHint.classList.remove("hidden");
        }
      } catch (e) {}
    } else if (projectHint) {
      projectHint.classList.add("hidden");
    }
  }

  function renderProjectDropdown() {
    projectDropdownList.innerHTML = "";
    for (var i = 0; i < cachedProjects.length; i++) {
      var p = cachedProjects[i];
      var isCurrent = p.slug === currentSlug;
      var displayName = p.title || p.project;
      var item = document.createElement("a");
      item.className = "project-dropdown-item" + (isCurrent ? " current" : "");
      item.href = "/p/" + p.slug + "/";

      var indicator = document.createElement("span");
      indicator.className = "pd-indicator " + (isCurrent ? "active" : "inactive");
      item.appendChild(indicator);

      var name = document.createElement("span");
      name.className = "pd-name";
      name.textContent = displayName;
      item.appendChild(name);

      var count = document.createElement("span");
      count.className = "pd-count";
      count.textContent = p.sessions;
      item.appendChild(count);

      projectDropdownList.appendChild(item);
    }

    // Add project button logic
    var addBtn = document.getElementById("project-dropdown-add");
    if (addBtn) {
      addBtn.onclick = function () {
        closeProjectDropdown();
        var hint = document.getElementById("project-hint");
        if (hint) {
          hint.classList.remove("hidden");
          try { localStorage.removeItem("claude-relay-project-hint-dismissed"); } catch (e) {}
        }
      };
    }
    refreshIcons();
  }

  function toggleProjectDropdown() {
    if (projectDropdown.classList.contains("hidden")) {
      renderProjectDropdown();
      projectDropdown.classList.remove("hidden");
      projectSwitcher.classList.add("open");
    } else {
      closeProjectDropdown();
    }
  }

  function closeProjectDropdown() {
    projectDropdown.classList.add("hidden");
    projectSwitcher.classList.remove("open");
  }

  if (projectSwitcherBtn) {
    projectSwitcherBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleProjectDropdown();
    });
  }

  document.addEventListener("click", function (e) {
    if (projectSwitcher && !projectSwitcher.contains(e.target)) {
      closeProjectDropdown();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeProjectDropdown();
  });

  if (projectHintDismiss) {
    projectHintDismiss.addEventListener("click", function () {
      projectHint.classList.add("hidden");
      try { localStorage.setItem("claude-relay-project-hint-dismissed", "1"); } catch (e) {}
    });
  }

  // Modal close handlers (replaces inline onclick)
  $("paste-modal").querySelector(".confirm-backdrop").addEventListener("click", function() {
    $("paste-modal").classList.add("hidden");
  });
  $("paste-modal").querySelector(".paste-modal-close").addEventListener("click", function() {
    $("paste-modal").classList.add("hidden");
  });
  $("mermaid-modal").querySelector(".confirm-backdrop").addEventListener("click", closeMermaidModal);
  $("mermaid-modal").querySelector(".mermaid-modal-btn[title='Close']").addEventListener("click", closeMermaidModal);

  // --- State ---
  var ws = null;
  var connected = false;
  var wasConnected = false;
  var verbCycleTimer = null;
  var processing = false;
  // isComposing -> modules/input.js
  var reconnectTimer = null;
  var reconnectDelay = 1000;
  var activityEl = null;
  var currentMsgEl = null;
  var currentFullText = "";
  // tools, currentThinking -> modules/tools.js
  var highlightTimer = null;
  var activeSessionId = null;
  var slashCommands = [];
  // slashActiveIdx, slashFiltered, pendingImages, pendingPastes -> modules/input.js
  // pendingPermissions -> modules/tools.js
  var cliSessionId = null;
  var projectName = "";
  var turnCounter = 0;
  var messageUuidMap = [];
  // pendingRewindUuid is now in modules/rewind.js
  // rewindMode is now in modules/rewind.js

  // --- Progressive history loading ---
  var historyFrom = 0;
  var historyTotal = 0;
  var prependAnchor = null;
  var loadingMore = false;
  var historySentinelObserver = null;

  // --- Scroll lock ---
  var isUserScrolledUp = false;
  var scrollThreshold = 150;

  // builtinCommands -> modules/input.js

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

  function showConfirm(text, onConfirm) {
    confirmText.textContent = text;
    confirmCallback = onConfirm;
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

  // --- Sidebar (module) ---
  initSidebar({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get projectName() { return projectName; },
    sessionListEl: sessionListEl,
    sidebar: sidebar,
    sidebarOverlay: sidebarOverlay,
    sidebarToggleBtn: sidebarToggleBtn,
    sidebarExpandBtn: sidebarExpandBtn,
    hamburgerBtn: hamburgerBtn,
    newSessionBtn: newSessionBtn,
    resumeSessionBtn: resumeSessionBtn,
    showConfirm: showConfirm,
    onFilesTabOpen: function () { loadRootDirectory(); },
  });

  // --- Connect overlay verb cycling ---
  function startVerbCycle() {
    if (verbCycleTimer) return;
    connectVerbEl.textContent = randomThinkingVerb() + "...";
    connectVerbEl.classList.remove("fade-out");
    connectVerbEl.classList.add("fade-in");
    verbCycleTimer = setInterval(function () {
      connectVerbEl.classList.remove("fade-in");
      connectVerbEl.classList.add("fade-out");
      setTimeout(function () {
        connectVerbEl.textContent = randomThinkingVerb() + "...";
        connectVerbEl.classList.remove("fade-out");
        connectVerbEl.classList.add("fade-in");
      }, 400);
    }, 10000);
  }

  function stopVerbCycle() {
    if (verbCycleTimer) {
      clearInterval(verbCycleTimer);
      verbCycleTimer = null;
    }
    stopPixelAnim();
  }

  // --- Pixel character animation ---
  var pixelAnimTimer = null;
  var pixelBlocks = [];
  var antennaBlocks = [];

  (function initPixelAnim() {
    var canvas = document.getElementById("pixel-canvas");
    if (!canvas) return;

    // Character grid: 1 = body, 2 = eye, 0 = empty
    // 12 cols x 9 rows
    // 0=empty, 1=body, 2=eye, 3=antenna
    var grid = [
      [0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 0, 1, 2, 1, 1, 1, 1, 2, 1, 0, 0],
      [0, 0, 1, 2, 1, 1, 1, 1, 2, 1, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0],
      [0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0],
    ];

    var CELL = 12;
    var accent = "#DA7756";
    var eye = "#2F2E2B";
    var antenna = "#E8E5DE";

    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < grid[r].length; c++) {
        if (grid[r][c] === 0) continue;
        var el = document.createElement("div");
        el.className = "px";
        var v = grid[r][c];
        el.style.background = v === 2 ? eye : v === 3 ? antenna : accent;
        el.style.left = c * CELL + "px";
        el.style.top = r * CELL + "px";
        if (v === 3) antennaBlocks.push(el);
        canvas.appendChild(el);
        pixelBlocks.push(el);
      }
    }
  })();

  function pixelScatter() {
    stopSpark();
    for (var i = 0; i < pixelBlocks.length; i++) {
      var el = pixelBlocks[i];
      var angle = Math.random() * Math.PI * 2;
      var dist = 80 + Math.random() * 120;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist;
      var rot = (Math.random() - 0.5) * 360;
      el.className = "px scatter";
      el.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + rot + "deg)";
      el.style.opacity = "0";
    }
  }

  var sparkTimer = null;

  function pixelAssemble() {
    for (var i = 0; i < pixelBlocks.length; i++) {
      (function (el, delay) {
        setTimeout(function () {
          el.className = "px settle";
          el.style.transform = "translate(0,0) rotate(0deg)";
          el.style.opacity = "1";
        }, delay);
      })(pixelBlocks[i], Math.random() * 300);
    }
    startSpark();
  }

  function startSpark() {
    stopSpark();
    var count = 0;
    sparkTimer = setInterval(function () {
      for (var i = 0; i < antennaBlocks.length; i++) {
        if (Math.random() < 0.4) {
          antennaBlocks[i].style.background = "#FFF";
          antennaBlocks[i].style.boxShadow = "0 0 6px 2px rgba(255,255,255,0.6)";
        } else {
          antennaBlocks[i].style.background = "#E8E5DE";
          antennaBlocks[i].style.boxShadow = "none";
        }
      }
      count++;
      if (count > 20) stopSpark();
    }, 80);
  }

  function stopSpark() {
    if (sparkTimer) {
      clearInterval(sparkTimer);
      sparkTimer = null;
    }
    for (var i = 0; i < antennaBlocks.length; i++) {
      antennaBlocks[i].style.background = "#E8E5DE";
      antennaBlocks[i].style.boxShadow = "none";
    }
  }

  function startPixelAnim() {
    if (pixelAnimTimer) return;
    // Start scattered
    for (var i = 0; i < pixelBlocks.length; i++) {
      var angle = Math.random() * Math.PI * 2;
      var dist = 80 + Math.random() * 120;
      pixelBlocks[i].className = "px";
      pixelBlocks[i].style.transform = "translate(" + (Math.cos(angle) * dist) + "px," + (Math.sin(angle) * dist) + "px) rotate(" + ((Math.random() - 0.5) * 360) + "deg)";
      pixelBlocks[i].style.opacity = "0";
    }
    function cycle() {
      pixelAssemble();
      pixelAnimTimer = setTimeout(function () {
        pixelScatter();
        pixelAnimTimer = setTimeout(cycle, 800);
      }, 2200);
    }
    pixelAnimTimer = setTimeout(cycle, 300);
  }

  function stopPixelAnim() {
    if (pixelAnimTimer) {
      clearTimeout(pixelAnimTimer);
      pixelAnimTimer = null;
    }
  }

  // --- Dynamic favicon ---
  var faviconSvg = null;
  var faviconLink = document.querySelector('link[rel="icon"]');

  function updateFavicon(bgColor) {
    if (!faviconLink) return;
    if (!faviconSvg) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", basePath + "favicon.svg", false);
      xhr.send();
      if (xhr.status === 200) faviconSvg = xhr.responseText;
      else return;
    }
    var svg = faviconSvg.replace(/fill="#57AB5A"/, 'fill="' + bgColor + '"');
    faviconLink.href = "data:image/svg+xml," + encodeURIComponent(svg);
  }

  // --- Status & Activity ---
  function setSendBtnMode(mode) {
    if (mode === "stop") {
      sendBtn.disabled = false;
      sendBtn.classList.add("stop");
      sendBtn.innerHTML = '<i data-lucide="square"></i>';
    } else {
      sendBtn.classList.remove("stop");
      sendBtn.innerHTML = '<i data-lucide="arrow-up"></i>';
    }
    refreshIcons();
  }

  var ioTimer = null;
  var faviconIoTimer = null;
  function blinkIO() {
    if (!processing) return;
    statusDot.classList.add("io");
    clearTimeout(ioTimer);
    ioTimer = setTimeout(function () { statusDot.classList.remove("io"); }, 60);

    // Blink favicon: dim then restore
    updateFavicon("#3D6B3E");
    clearTimeout(faviconIoTimer);
    faviconIoTimer = setTimeout(function () { updateFavicon("#57AB5A"); }, 60);
  }

  // --- Urgent favicon blink (permission / ask user) ---
  var urgentBlinkTimer = null;
  var savedTitle = null;
  function startUrgentBlink() {
    if (urgentBlinkTimer) return;
    savedTitle = document.title;
    var colors = ["#DA7756", "#57AB5A", "#DA7756", "#E8E5DE", "#DA7756", "#57AB5A"];
    var tick = 0;
    urgentBlinkTimer = setInterval(function () {
      updateFavicon(colors[tick % colors.length]);
      document.title = tick % 2 === 0 ? "\u26A0 Input needed" : savedTitle;
      tick++;
    }, 250);
  }
  function stopUrgentBlink() {
    if (!urgentBlinkTimer) return;
    clearInterval(urgentBlinkTimer);
    urgentBlinkTimer = null;
    updateFavicon("#57AB5A");
    if (savedTitle) document.title = savedTitle;
    savedTitle = null;
  }

  function setStatus(status) {
    statusDot.className = "status-dot";
    if (status === "connected") {
      statusDot.classList.add("connected");
      connected = true;
      processing = false;
      sendBtn.disabled = false;
      setSendBtnMode("send");
      connectOverlay.classList.add("hidden");
      stopVerbCycle();
      updateFavicon("#57AB5A");
    } else if (status === "processing") {
      statusDot.classList.add("processing");
      processing = true;
      setSendBtnMode("stop");
      updateFavicon("#57AB5A");
    } else {
      connected = false;
      sendBtn.disabled = true;
      connectOverlay.classList.remove("hidden");
      connectStatusEl.textContent = "Reconnecting...";
      startVerbCycle();
      startPixelAnim();
      updateFavicon("#E5534B");
    }
  }

  function setActivity(text) {
    if (text) {
      if (!activityEl) {
        activityEl = document.createElement("div");
        activityEl.className = "activity-inline";
        activityEl.innerHTML =
          '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
          '<span class="activity-text"></span>';
        addToMessages(activityEl);
        refreshIcons();
      }
      activityEl.querySelector(".activity-text").textContent = text;
      scrollToBottom();
    } else {
      if (activityEl) {
        activityEl.remove();
        activityEl = null;
      }
    }
  }

  function addToMessages(el) {
    if (prependAnchor) messagesEl.insertBefore(el, prependAnchor);
    else messagesEl.appendChild(el);
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
  });

  // isPlanFile, toolSummary, toolActivityText, shortPath -> modules/tools.js

  // AskUserQuestion, PermissionRequest, Plan, Todo, Thinking, Tool items -> modules/tools.js

  // --- DOM: Messages ---
  function addUserMessage(text, images, pastes) {
    var div = document.createElement("div");
    div.className = "msg-user";
    div.dataset.turn = ++turnCounter;
    var bubble = document.createElement("div");
    bubble.className = "bubble";

    if (images && images.length > 0) {
      var imgRow = document.createElement("div");
      imgRow.className = "bubble-images";
      for (var i = 0; i < images.length; i++) {
        var img = document.createElement("img");
        img.src = "data:" + images[i].mediaType + ";base64," + images[i].data;
        img.className = "bubble-img";
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

    div.appendChild(bubble);
    addToMessages(div);
    forceScrollToBottom();
  }

  function ensureAssistantBlock() {
    if (!currentMsgEl) {
      currentMsgEl = document.createElement("div");
      currentMsgEl.className = "msg-assistant";
      currentMsgEl.dataset.turn = turnCounter;
      currentMsgEl.innerHTML = '<div class="md-content"></div>';
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

  function appendDelta(text) {
    ensureAssistantBlock();
    currentFullText += text;
    var contentEl = currentMsgEl.querySelector(".md-content");
    contentEl.innerHTML = renderMarkdown(currentFullText);

    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(function () {
      highlightCodeBlocks(contentEl);
    }, 150);

    scrollToBottom();
  }

  function finalizeAssistantBlock() {
    if (currentMsgEl) {
      var contentEl = currentMsgEl.querySelector(".md-content");
      if (contentEl) {
        highlightCodeBlocks(contentEl);
        renderMermaidBlocks(contentEl);
      }
      if (currentFullText) {
        addCopyHandler(currentMsgEl, currentFullText);
      }
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

  function resetClientState() {
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
    enableMainInput();
  }

  // --- WebSocket ---
  var connectTimeoutId = null;

  function connect() {
    if (ws) { ws.onclose = null; ws.close(); }
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }

    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + wsPath);

    connectStatusEl.textContent = "Connecting...";

    // If not connected within 3s, force retry
    connectTimeoutId = setTimeout(function () {
      if (!connected) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        connect();
      }
    }, 3000);

    ws.onopen = function () {
      if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
      // Local notification on reconnect (only if not focused)
      if (wasConnected && !document.hasFocus() && "serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then(function (reg) {
          reg.showNotification("Claude Relay", {
            body: "Server connection restored",
            tag: "claude-disconnect",
          });
        }).catch(function () {});
      }
      wasConnected = true;
      setStatus("connected");
      reconnectDelay = 1000;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

      // Re-send push subscription on reconnect
      if (window._pushSubscription) {
        try {
          ws.send(JSON.stringify({
            type: "push_subscribe",
            subscription: window._pushSubscription.toJSON(),
          }));
        } catch(e) {}
      }
    };

    ws.onclose = function (e) {
      if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
      connectStatusEl.textContent = "Connection lost. Retrying...";
      setStatus("disconnected");
      processing = false;
      setActivity(null);
      // Local notification when connection drops (only if not focused)
      if (!document.hasFocus() && "serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then(function (reg) {
          reg.showNotification("Claude Relay", {
            body: "Server connection lost",
            tag: "claude-disconnect",
          });
        }).catch(function () {});
      }
      scheduleReconnect();
    };

    ws.onerror = function () {
      connectStatusEl.textContent = "Connection error. Retrying...";
    };

    ws.onmessage = function (event) {
      // Backup: if we're receiving messages, we're connected
      if (!connected) {
        setStatus("connected");
        reconnectDelay = 1000;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      }

      blinkIO();
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      processMessage(msg);
    };
  }

  function processMessage(msg) {
      switch (msg.type) {
        case "history_meta":
          historyFrom = msg.from;
          historyTotal = msg.total;
          updateHistorySentinel();
          break;

        case "history_prepend":
          prependOlderHistory(msg.items, msg.meta);
          break;

        case "info":
          projectName = msg.project || msg.cwd;
          if (msg.slug) currentSlug = msg.slug;
          projectNameEl.textContent = projectName;
          updatePageTitle();
          if (msg.version) {
            var vEl = $("footer-version");
            if (vEl) vEl.textContent = "v" + msg.version;
          }
          if (msg.debug) {
            var debugWrap = $("debug-menu-wrap");
            if (debugWrap) debugWrap.classList.remove("hidden");
          }
          updateProjectSwitcher(msg);
          break;

        case "update_available":
          var updateBanner = $("update-banner");
          var updateVersion = $("update-version");
          if (updateBanner && updateVersion && msg.version) {
            updateVersion.textContent = "v" + msg.version;
            updateBanner.classList.remove("hidden");
            refreshIcons();
          }
          // Show badge on footer update check item
          var footerUpdateBtn = $("footer-update-check");
          if (footerUpdateBtn && msg.version) {
            var labelSpan = footerUpdateBtn.querySelector("span");
            if (labelSpan) labelSpan.textContent = "Update available";
            footerUpdateBtn.classList.add("has-badge");
            var existingBadge = footerUpdateBtn.querySelector(".menu-badge");
            if (!existingBadge) {
              var badge = document.createElement("span");
              badge.className = "menu-badge";
              badge.textContent = "v" + msg.version;
              footerUpdateBtn.appendChild(badge);
            }
          }
          break;

        case "slash_commands":
          slashCommands = (msg.commands || []).map(function (name) {
            return { name: name, desc: "Skill" };
          });
          break;

        case "client_count":
          var countEl = document.getElementById("client-count");
          if (countEl) {
            if (msg.count > 1) {
              countEl.textContent = msg.count;
              countEl.dataset.tip = msg.count + " devices connected";
              countEl.classList.remove("hidden");
            } else {
              countEl.classList.add("hidden");
            }
          }
          break;

        case "input_sync":
          handleInputSync(msg.text);
          break;

        case "session_list":
          renderSessionList(msg.sessions || []);
          break;

        case "session_switched":
          activeSessionId = msg.id;
          cliSessionId = msg.cliSessionId || null;
          resetClientState();
          break;

        case "session_id":
          cliSessionId = msg.cliSessionId;
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
          }
          messageUuidMap.push({ uuid: msg.uuid, type: msg.messageType });
          break;

        case "user_message":
          addUserMessage(msg.text, msg.images || null, msg.pastes || null);
          break;

        case "status":
          if (msg.status === "processing") {
            setStatus("processing");
            setActivity(randomThinkingVerb() + "...");
          }
          break;

        case "thinking_start":
          startThinking();
          break;

        case "thinking_delta":
          if (typeof msg.text === "string") appendThinking(msg.text);
          break;

        case "thinking_stop":
          stopThinking();
          setActivity(randomThinkingVerb() + "...");
          break;

        case "delta":
          if (typeof msg.text !== "string") break;
          stopThinking();
          setActivity(null);
          appendDelta(msg.text);
          break;

        case "tool_start":
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
          } else if (getTodoTools()[msg.name]) {
            getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else {
            createToolItem(msg.id, msg.name);
          }
          break;

        case "tool_executing":
          if (msg.name === "AskUserQuestion" && msg.input && msg.input.questions) {
            var askTool = getTools()[msg.id];
            if (askTool) {
              if (askTool.el) askTool.el.style.display = "none";
              askTool.done = true;
            }
            renderAskUserQuestion(msg.id, msg.input);
            startUrgentBlink();
          } else if (msg.name === "Write" && msg.input && isPlanFilePath(msg.input.file_path)) {
            setPlanContent(msg.input.content || "");
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
            if (msg.content != null || (tr && tr.name === "Edit" && tr.input && tr.input.old_string)) {
              updateToolResult(msg.id, msg.content || "", msg.is_error || false);
            }
            // Refresh file browser if an Edit/Write tool modified the open file
            if (!msg.is_error && tr && (tr.name === "Edit" || tr.name === "Write") && tr.input && tr.input.file_path) {
              refreshIfOpen(tr.input.file_path);
            }
          }
          break;

        case "ask_user_answered":
          markAskUserAnswered(msg.toolId);
          stopUrgentBlink();
          break;

        case "permission_request":
          renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason);
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
          renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason);
          startUrgentBlink();
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

        case "result":
          setActivity(null);
          stopThinking();
          markAllToolsDone();
          finalizeAssistantBlock();
          addTurnMeta(msg.cost, msg.duration);
          break;

        case "done":
          setActivity(null);
          stopThinking();
          markAllToolsDone();
          finalizeAssistantBlock();
          processing = false;
          setStatus("connected");
          enableMainInput();
          resetToolState();
          if (document.hidden) {
            if (isNotifAlertEnabled()) showDoneNotification();
            if (isNotifSoundEnabled()) playDoneSound();
          }
          break;

        case "stderr":
          addSystemMessage(msg.text, false);
          break;

        case "info":
          addSystemMessage(msg.text, false);
          break;

        case "error":
          setActivity(null);
          addSystemMessage(msg.text, true);
          updateFavicon("#E5534B");
          break;

        case "rewind_preview_result":
          showRewindModal(msg);
          break;

        case "rewind_complete":
          setRewindMode(false);
          addSystemMessage("Rewound to earlier point. Files have been restored.", false);
          break;

        case "rewind_error":
          clearPendingRewindUuid();
          addSystemMessage(msg.text || "Rewind failed.", true);
          break;

        case "fs_list_result":
          handleFsList(msg);
          break;

        case "fs_read_result":
          handleFsRead(msg);
          break;

        case "term_output":
          handleTermOutput(msg);
          break;

        case "term_exited":
          handleTermExited();
          break;
      }
  }

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
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
  }

  // --- Input module (sendMessage, autoResize, paste/image, slash menu, input handlers) ---
  initInput({
    get ws() { return ws; },
    get connected() { return connected; },
    get processing() { return processing; },
    inputEl: inputEl,
    sendBtn: sendBtn,
    slashMenu: slashMenu,
    messagesEl: messagesEl,
    imagePreviewBar: imagePreviewBar,
    slashCommands: function() { return slashCommands; },
    messageUuidMap: function() { return messageUuidMap; },
    addUserMessage: addUserMessage,
    addSystemMessage: addSystemMessage,
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
  });

  // --- QR code ---
  initQrCode();

  // --- File browser ---
  initFileBrowser({
    get ws() { return ws; },
    get connected() { return connected; },
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

  // --- Init ---
  lucide.createIcons();
  startVerbCycle();
  startPixelAnim();
  connect();
  inputEl.focus();
