(function () {
  "use strict";

  // --- DOM refs ---
  var $ = function (id) { return document.getElementById(id); };
  var messagesEl = $("messages");
  var inputEl = $("input");
  var sendBtn = $("send-btn");
  var statusDot = $("status-dot");
  var statusTextEl = $("status-text");
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

  // --- State ---
  var ws = null;
  var connected = false;
  var verbCycleTimer = null;
  var processing = false;
  var isComposing = false;
  var reconnectTimer = null;
  var reconnectDelay = 1000;
  var activityEl = null;
  var currentMsgEl = null;
  var currentFullText = "";
  var tools = {};
  var currentThinking = null;
  var highlightTimer = null;
  var activeSessionId = null;
  var slashCommands = [];
  var slashActiveIdx = -1;
  var slashFiltered = [];
  var pendingImages = []; // [{data: base64, mediaType: "image/png"}]
  var pendingPermissions = {}; // requestId -> container element
  var cliSessionId = null;
  var projectName = "";
  var turnCounter = 0;
  var messageUuidMap = [];
  var pendingRewindUuid = null;
  var rewindMode = false;

  // --- Progressive history loading ---
  var historyFrom = 0;
  var historyTotal = 0;
  var prependAnchor = null;
  var loadingMore = false;
  var historySentinelObserver = null;

  var builtinCommands = [
    { name: "clear", desc: "Clear conversation" },
    { name: "cost", desc: "Show session cost" },
    { name: "rewind", desc: "Toggle rewind mode" },
  ];

  // --- Lucide icon helper ---
  var _iconTimer = null;
  function refreshIcons() {
    if (_iconTimer) return;
    _iconTimer = requestAnimationFrame(function () {
      _iconTimer = null;
      lucide.createIcons();
    });
  }

  function iconHtml(name, wrapperClass) {
    if (wrapperClass) {
      return '<span class="' + wrapperClass + '"><i data-lucide="' + name + '"></i></span>';
    }
    return '<i data-lucide="' + name + '"></i>';
  }

  // --- Activity verbs ---
  var thinkingVerbs = [
    "Accomplishing", "Actioning", "Actualizing", "Architecting", "Baking", "Beaming",
    "Beboppin'", "Befuddling", "Billowing", "Blanching", "Bloviating", "Boogieing",
    "Boondoggling", "Booping", "Bootstrapping", "Brewing", "Burrowing", "Calculating",
    "Canoodling", "Caramelizing", "Cascading", "Catapulting", "Cerebrating", "Channeling",
    "Channelling", "Choreographing", "Churning", "Clauding", "Coalescing", "Cogitating",
    "Combobulating", "Composing", "Computing", "Concocting", "Considering", "Contemplating",
    "Cooking", "Crafting", "Creating", "Crunching", "Crystallizing", "Cultivating",
    "Deciphering", "Deliberating", "Determining", "Dilly-dallying", "Discombobulating",
    "Doing", "Doodling", "Drizzling", "Ebbing", "Effecting", "Elucidating", "Embellishing",
    "Enchanting", "Envisioning", "Evaporating", "Fermenting", "Fiddle-faddling", "Finagling",
    "Flambing", "Flibbertigibbeting", "Flowing", "Flummoxing", "Fluttering", "Forging",
    "Forming", "Frolicking", "Frosting", "Gallivanting", "Galloping", "Garnishing",
    "Generating", "Germinating", "Gitifying", "Grooving", "Gusting", "Harmonizing",
    "Hashing", "Hatching", "Herding", "Honking", "Hullaballooing", "Hyperspacing",
    "Ideating", "Imagining", "Improvising", "Incubating", "Inferring", "Infusing",
    "Ionizing", "Jitterbugging", "Julienning", "Kneading", "Leavening", "Levitating",
    "Lollygagging", "Manifesting", "Marinating", "Meandering", "Metamorphosing", "Misting",
    "Moonwalking", "Moseying", "Mulling", "Mustering", "Musing", "Nebulizing", "Nesting",
    "Newspapering", "Noodling", "Nucleating", "Orbiting", "Orchestrating", "Osmosing",
    "Perambulating", "Percolating", "Perusing", "Philosophising", "Photosynthesizing",
    "Pollinating", "Pondering", "Pontificating", "Pouncing", "Precipitating",
    "Prestidigitating", "Processing", "Proofing", "Propagating", "Puttering", "Puzzling",
    "Quantumizing", "Razzle-dazzling", "Razzmatazzing", "Recombobulating", "Reticulating",
    "Roosting", "Ruminating", "Sauting", "Scampering", "Schlepping", "Scurrying", "Seasoning",
    "Shenaniganing", "Shimmying", "Simmering", "Skedaddling", "Sketching", "Slithering",
    "Smooshing", "Sock-hopping", "Spelunking", "Spinning", "Sprouting", "Stewing",
    "Sublimating", "Swirling", "Swooping", "Symbioting", "Synthesizing", "Tempering",
    "Thinking", "Thundering", "Tinkering", "Tomfoolering", "Topsy-turvying", "Transfiguring",
    "Transmuting", "Twisting", "Undulating", "Unfurling", "Unravelling", "Vibing", "Waddling",
    "Wandering", "Warping", "Whatchamacalliting", "Whirlpooling", "Whirring", "Whisking",
    "Wibbling", "Working", "Wrangling", "Zesting", "Zigzagging"
  ];

  function randomThinkingVerb() {
    return thinkingVerbs[Math.floor(Math.random() * thinkingVerbs.length)];
  }

  // --- Markdown setup ---
  marked.use({ gfm: true, breaks: false });

  function renderMarkdown(text) {
    return DOMPurify.sanitize(marked.parse(text));
  }

  function highlightCodeBlocks(el) {
    el.querySelectorAll("pre code:not(.hljs)").forEach(function (block) {
      hljs.highlightElement(block);
    });
    el.querySelectorAll("pre:not(.has-copy-btn)").forEach(function (pre) {
      // Skip non-content code blocks (tool details, diffs, etc.)
      if (!pre.querySelector("code")) return;
      pre.classList.add("has-copy-btn");
      pre.style.position = "relative";
      var btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.title = "Copy";
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var code = pre.querySelector("code");
        var text = code ? code.textContent : pre.textContent;
        navigator.clipboard.writeText(text).then(function () {
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
          setTimeout(function () {
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
          }, 1500);
        });
      });
      pre.appendChild(btn);
    });
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // --- Confirm modal ---
  var confirmModal = $("confirm-modal");
  var confirmText = $("confirm-text");
  var confirmOk = $("confirm-ok");
  var confirmCancel = $("confirm-cancel");
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

  // --- Rewind mode ---
  var rewindModal = $("rewind-modal");
  var rewindSummary = $("rewind-summary");
  var rewindFilesList = $("rewind-files-list");
  var rewindConfirmBtn = $("rewind-confirm");
  var rewindCancelBtn = $("rewind-cancel");
  var rewindBannerEl = null;

  function setRewindMode(on) {
    rewindMode = on;
    var appEl = $("app");
    if (on) {
      appEl.classList.add("rewind-mode");
      if (!rewindBannerEl) {
        rewindBannerEl = document.createElement("div");
        rewindBannerEl.className = "rewind-mode-banner";
        rewindBannerEl.innerHTML =
          '<i data-lucide="rotate-ccw"></i>' +
          '<span class="rewind-banner-text">Select a message to rewind to</span>' +
          '<button class="rewind-exit-btn" title="Exit rewind mode"><i data-lucide="x"></i></button>';
        rewindBannerEl.querySelector(".rewind-exit-btn").addEventListener("click", function() {
          setRewindMode(false);
        });
        $("app").appendChild(rewindBannerEl);
        refreshIcons();
      }
      buildRewindTimeline();
    } else {
      appEl.classList.remove("rewind-mode");
      if (rewindBannerEl) {
        rewindBannerEl.remove();
        rewindBannerEl = null;
      }
      removeRewindTimeline();
    }
  }

  // Click on user message bubble to rewind
  messagesEl.addEventListener("click", function(e) {
    var bubble = e.target.closest(".msg-user[data-uuid] .bubble");
    if (!bubble) return;
    var msgEl = bubble.closest(".msg-user[data-uuid]");
    if (msgEl) initiateRewind(msgEl.dataset.uuid);
  });

  function initiateRewind(uuid) {
    if (processing) {
      addSystemMessage("Cannot rewind while processing. Stop the current operation first.", true);
      return;
    }
    if (!uuid) {
      addSystemMessage("No rewind point found for this turn.", true);
      return;
    }
    pendingRewindUuid = uuid;
    if (ws && connected) {
      ws.send(JSON.stringify({ type: "rewind_preview", uuid: uuid }));
    }
  }

  function showRewindModal(data) {
    var p = data.preview || data;
    var filePaths = p.filesChanged || p.filePaths || p.files || [];
    var fileCount = filePaths.length;
    var insertions = p.insertions || 0;
    var deletions = p.deletions || 0;
    if (fileCount > 0) {
      var summary = fileCount + " file" + (fileCount !== 1 ? "s" : "") + " will be restored.";
      if (insertions || deletions) summary += " (+" + insertions + " / -" + deletions + " lines)";
      rewindSummary.textContent = summary;
    } else {
      rewindSummary.textContent = "No file changes to restore. Conversation will be rewound.";
    }

    var diffs = data.diffs || {};
    rewindFilesList.innerHTML = "";
    if (filePaths.length > 0) {
      rewindFilesList.style.display = "";
      for (var i = 0; i < filePaths.length; i++) {
        var fp = filePaths[i];
        var section = document.createElement("div");
        section.className = "rewind-file-section expanded";

        var header = document.createElement("div");
        header.className = "rewind-file-header";
        header.innerHTML = '<span class="rewind-file-chevron"><i data-lucide="chevron-right"></i></span>';

        var pathSpan = document.createElement("span");
        pathSpan.className = "rewind-file-path";
        pathSpan.textContent = fp;
        pathSpan.title = fp;
        header.appendChild(pathSpan);

        header.addEventListener("click", function(sec) {
          return function() { sec.classList.toggle("expanded"); };
        }(section));

        section.appendChild(header);

        var diffContainer = document.createElement("div");
        diffContainer.className = "rewind-file-diff";
        var diffText = diffs[fp];
        if (diffText) {
          diffContainer.appendChild(renderDiffPre(diffText));
        } else {
          var noDiff = document.createElement("div");
          noDiff.className = "rewind-no-diff";
          noDiff.textContent = "No diff available (file may be untracked)";
          diffContainer.appendChild(noDiff);
        }
        section.appendChild(diffContainer);

        rewindFilesList.appendChild(section);
      }
      refreshIcons();
    } else {
      rewindFilesList.style.display = "none";
    }

    rewindModal.classList.remove("hidden");
  }

  function hideRewindModal() {
    rewindModal.classList.add("hidden");
    pendingRewindUuid = null;
  }

  rewindConfirmBtn.addEventListener("click", function() {
    if (pendingRewindUuid && ws && connected) {
      ws.send(JSON.stringify({ type: "rewind_execute", uuid: pendingRewindUuid }));
    }
    hideRewindModal();
  });

  rewindCancelBtn.addEventListener("click", hideRewindModal);
  rewindModal.querySelector(".confirm-backdrop").addEventListener("click", hideRewindModal);

  // --- Rewind timeline ---
  var rewindScrollHandler = null;

  function buildRewindTimeline() {
    removeRewindTimeline();

    var userMsgs = messagesEl.querySelectorAll(".msg-user[data-uuid]");
    if (userMsgs.length === 0) return;

    var timeline = document.createElement("div");
    timeline.className = "rewind-timeline";
    timeline.id = "rewind-timeline";

    var track = document.createElement("div");
    track.className = "rewind-timeline-track";

    var viewport = document.createElement("div");
    viewport.className = "rewind-timeline-viewport";
    track.appendChild(viewport);

    for (var i = 0; i < userMsgs.length; i++) {
      var msg = userMsgs[i];
      var pct = userMsgs.length === 1 ? 50 : 6 + (i / (userMsgs.length - 1)) * 88;

      var bubble = msg.querySelector(".bubble");
      var msgText = bubble ? bubble.textContent.trim() : "";
      if (msgText.length > 18) msgText = msgText.substring(0, 18) + "\u2026";

      var marker = document.createElement("div");
      marker.className = "rewind-timeline-marker";
      marker.innerHTML = '<i data-lucide="message-square"></i><span class="marker-text">' + escapeHtml(msgText) + '</span>';
      marker.style.top = pct + "%";
      marker.dataset.uuid = msg.dataset.uuid;
      marker.dataset.offsetTop = msg.offsetTop;

      (function(targetMsg, markerEl) {
        markerEl.addEventListener("click", function() {
          targetMsg.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      })(msg, marker);

      track.appendChild(marker);
    }

    timeline.appendChild(track);

    // Position timeline to align with messages area
    var appEl = $("app");
    var headerEl = $("header");
    var inputEl = $("input-area");
    var appRect = appEl.getBoundingClientRect();
    var headerRect = headerEl.getBoundingClientRect();
    var inputRect = inputEl.getBoundingClientRect();

    timeline.style.top = (headerRect.bottom - appRect.top + 4) + "px";
    timeline.style.bottom = (appRect.bottom - inputRect.top + 4) + "px";

    appEl.appendChild(timeline);
    refreshIcons();

    rewindScrollHandler = function() { updateTimelineViewport(track, viewport); };
    messagesEl.addEventListener("scroll", rewindScrollHandler);
    updateTimelineViewport(track, viewport);
  }

  function updateTimelineViewport(track, viewport) {
    if (!track) return;
    var scrollH = messagesEl.scrollHeight;
    var viewH = messagesEl.clientHeight;
    if (scrollH <= viewH) {
      viewport.style.top = "0";
      viewport.style.height = "100%";
    } else {
      var viewTop = messagesEl.scrollTop / scrollH;
      var viewBot = (messagesEl.scrollTop + viewH) / scrollH;
      viewport.style.top = (viewTop * 100) + "%";
      viewport.style.height = ((viewBot - viewTop) * 100) + "%";
    }

    var markers = track.querySelectorAll(".rewind-timeline-marker");
    var vTop = messagesEl.scrollTop;
    var vBot = vTop + viewH;

    for (var i = 0; i < markers.length; i++) {
      var msgTop = parseInt(markers[i].dataset.offsetTop, 10);
      if (msgTop >= vTop && msgTop <= vBot) {
        markers[i].classList.add("in-view");
      } else {
        markers[i].classList.remove("in-view");
      }
    }
  }

  function removeRewindTimeline() {
    var existing = document.getElementById("rewind-timeline");
    if (existing) existing.remove();
    if (rewindScrollHandler) {
      messagesEl.removeEventListener("scroll", rewindScrollHandler);
      rewindScrollHandler = null;
    }
  }

  // --- Sidebar ---
  function renderSessionList(sessions) {
    sessionListEl.innerHTML = "";
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var el = document.createElement("div");
      el.className = "session-item" + (s.active ? " active" : "");
      el.dataset.sessionId = s.id;

      var textSpan = document.createElement("span");
      textSpan.className = "session-item-text";
      var textHtml = "";
      if (s.isProcessing) {
        textHtml += '<span class="session-processing"></span>';
      }
      textHtml += escapeHtml(s.title || "New Session");
      textSpan.innerHTML = textHtml;
      el.appendChild(textSpan);

      var deleteBtn = document.createElement("button");
      deleteBtn.className = "session-delete-btn";
      deleteBtn.innerHTML = iconHtml("trash-2");
      deleteBtn.title = "Delete session";
      deleteBtn.addEventListener("click", (function(id, title) {
        return function(e) {
          e.stopPropagation();
          showConfirm('Delete "' + (title || "New Session") + '"? This session and its history will be permanently removed.', function () {
            if (ws && connected) {
              ws.send(JSON.stringify({ type: "delete_session", id: id }));
            }
          });
        };
      })(s.id, s.title));
      el.appendChild(deleteBtn);

      el.addEventListener("click", (function (id) {
        return function () {
          if (ws && connected) {
            ws.send(JSON.stringify({ type: "switch_session", id: id }));
            closeSidebar();
          }
        };
      })(s.id));

      sessionListEl.appendChild(el);
    }
    refreshIcons();
    updatePageTitle();
  }

  function updatePageTitle() {
    var sessionTitle = "";
    var activeItem = sessionListEl.querySelector(".session-item.active .session-item-text");
    if (activeItem) sessionTitle = activeItem.textContent;
    if (projectName && sessionTitle) {
      document.title = projectName + " - " + sessionTitle;
    } else if (projectName) {
      document.title = projectName;
    } else {
      document.title = "Claude Relay";
    }
  }

  function openSidebar() {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("visible");
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("visible");
  }

  hamburgerBtn.addEventListener("click", function () {
    sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });

  sidebarOverlay.addEventListener("click", closeSidebar);

  // --- Desktop sidebar collapse/expand ---
  function toggleSidebarCollapse() {
    var layout = $("layout");
    var collapsed = layout.classList.toggle("sidebar-collapsed");
    try { localStorage.setItem("sidebar-collapsed", collapsed ? "1" : ""); } catch (e) {}
  }

  sidebarToggleBtn.addEventListener("click", toggleSidebarCollapse);
  sidebarExpandBtn.addEventListener("click", toggleSidebarCollapse);

  // Restore collapsed state from localStorage
  (function () {
    try {
      if (localStorage.getItem("sidebar-collapsed") === "1") {
        $("layout").classList.add("sidebar-collapsed");
      }
    } catch (e) {}
  })();

  newSessionBtn.addEventListener("click", function () {
    if (ws && connected) {
      ws.send(JSON.stringify({ type: "new_session" }));
      closeSidebar();
    }
  });

  // --- Resume session modal ---
  var resumeModal = $("resume-modal");
  var resumeInput = $("resume-session-input");
  var resumeOk = $("resume-ok");
  var resumeCancel = $("resume-cancel");

  function openResumeModal() {
    resumeModal.classList.remove("hidden");
    resumeInput.value = "";
    setTimeout(function () { resumeInput.focus(); }, 50);
  }

  function closeResumeModal() {
    resumeModal.classList.add("hidden");
    resumeInput.value = "";
  }

  function submitResume() {
    var val = resumeInput.value.trim();
    if (!val) return;
    if (ws && connected) {
      ws.send(JSON.stringify({ type: "resume_session", cliSessionId: val }));
    }
    closeResumeModal();
    closeSidebar();
  }

  resumeSessionBtn.addEventListener("click", openResumeModal);
  resumeOk.addEventListener("click", submitResume);
  resumeCancel.addEventListener("click", closeResumeModal);
  resumeModal.querySelector(".confirm-backdrop").addEventListener("click", closeResumeModal);

  resumeInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitResume();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeResumeModal();
    }
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
      xhr.open("GET", "/favicon.svg", false);
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

  function setStatus(status) {
    statusDot.className = "status-dot";
    if (status === "connected") {
      statusDot.classList.add("connected");
      statusTextEl.textContent = "Connected";
      connected = true;
      processing = false;
      sendBtn.disabled = false;
      setSendBtnMode("send");
      connectOverlay.classList.add("hidden");
      stopVerbCycle();
      updateFavicon("#57AB5A");
    } else if (status === "processing") {
      statusDot.classList.add("processing");
      statusTextEl.textContent = "";
      processing = true;
      setSendBtnMode("stop");
      updateFavicon("#E0943A");
    } else {
      statusTextEl.textContent = "Disconnected";
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

  function scrollToBottom() {
    if (prependAnchor) return;
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // --- Plan mode state ---
  var inPlanMode = false;
  var planContent = null; // stores plan markdown from Write tool

  // --- Todo state ---
  var todoItems = []; // [{id, content, status, activeForm}]
  var todoWidgetEl = null;

  // --- Tool helpers ---
  var PLAN_MODE_TOOLS = { EnterPlanMode: 1, ExitPlanMode: 1 };
  var TODO_TOOLS = { TodoWrite: 1, TaskCreate: 1, TaskUpdate: 1, TaskList: 1, TaskGet: 1 };
  var HIDDEN_RESULT_TOOLS = { EnterPlanMode: 1, ExitPlanMode: 1, TaskCreate: 1, TaskUpdate: 1, TaskList: 1, TaskGet: 1, TodoWrite: 1 };

  function isPlanFile(filePath) {
    return filePath && filePath.indexOf(".claude/plans/") !== -1;
  }

  function toolSummary(name, input) {
    if (!input || typeof input !== "object") return "";
    switch (name) {
      case "Read": return shortPath(input.file_path);
      case "Edit": return shortPath(input.file_path);
      case "Write": return shortPath(input.file_path);
      case "Bash": return (input.command || "").substring(0, 80);
      case "Glob": return input.pattern || "";
      case "Grep": return (input.pattern || "") + (input.path ? " in " + shortPath(input.path) : "");
      case "WebFetch": return input.url || "";
      case "WebSearch": return input.query || "";
      case "Task": return input.description || "";
      case "EnterPlanMode": return "";
      case "ExitPlanMode": return "";
      default: return JSON.stringify(input).substring(0, 60);
    }
  }

  function toolActivityText(name, input) {
    if (name === "Bash" && input && input.description) return input.description;
    if (name === "Read" && input && input.file_path) return "Reading " + shortPath(input.file_path);
    if (name === "Edit" && input && input.file_path) return "Editing " + shortPath(input.file_path);
    if (name === "Write" && input && input.file_path) return "Writing " + shortPath(input.file_path);
    if (name === "Grep" && input && input.pattern) return "Searching for " + input.pattern;
    if (name === "Glob" && input && input.pattern) return "Finding " + input.pattern;
    if (name === "WebSearch" && input && input.query) return "Searching: " + input.query;
    if (name === "WebFetch") return "Fetching URL...";
    if (name === "Task" && input && input.description) return input.description;
    if (name === "EnterPlanMode") return "Entering plan mode...";
    if (name === "ExitPlanMode") return "Finalizing the plan...";
    return "Running " + name + "...";
  }

  function shortPath(p) {
    if (!p) return "";
    var parts = p.split("/");
    return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
  }

  // --- AskUserQuestion ---
  function renderAskUserQuestion(toolId, input) {
    finalizeAssistantBlock();
    stopThinking();

    var questions = input.questions || [];
    if (questions.length === 0) return;

    var container = document.createElement("div");
    container.className = "ask-user-container";
    container.dataset.toolId = toolId;

    var answers = {};
    var multiSelections = {};

    questions.forEach(function (q, qIdx) {
      var qDiv = document.createElement("div");
      qDiv.className = "ask-user-question";

      var qText = document.createElement("div");
      qText.className = "ask-user-question-text";
      qText.textContent = q.question || "";
      qDiv.appendChild(qText);

      var optionsDiv = document.createElement("div");
      optionsDiv.className = "ask-user-options";

      var isMulti = q.multiSelect || false;
      if (isMulti) multiSelections[qIdx] = new Set();

      (q.options || []).forEach(function (opt) {
        var btn = document.createElement("button");
        btn.className = "ask-user-option";
        btn.innerHTML =
          '<div class="option-label"></div>' +
          (opt.description ? '<div class="option-desc"></div>' : '');
        btn.querySelector(".option-label").textContent = opt.label;
        if (opt.description) btn.querySelector(".option-desc").textContent = opt.description;

        btn.addEventListener("click", function () {
          if (container.classList.contains("answered")) return;

          if (isMulti) {
            var set = multiSelections[qIdx];
            if (set.has(opt.label)) {
              set.delete(opt.label);
              btn.classList.remove("selected");
            } else {
              set.add(opt.label);
              btn.classList.add("selected");
            }
          } else {
            optionsDiv.querySelectorAll(".ask-user-option").forEach(function (b) {
              b.classList.remove("selected");
            });
            btn.classList.add("selected");
            answers[qIdx] = opt.label;
            var otherInput = qDiv.querySelector(".ask-user-other input");
            if (otherInput) otherInput.value = "";
            if (questions.length === 1) {
              submitAskUserAnswer(container, toolId, questions, answers, multiSelections);
            }
          }
        });

        optionsDiv.appendChild(btn);
      });

      qDiv.appendChild(optionsDiv);

      // "Other" text input
      var otherDiv = document.createElement("div");
      otherDiv.className = "ask-user-other";
      var otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.placeholder = "Other...";
      otherInput.addEventListener("input", function () {
        if (container.classList.contains("answered")) return;
        if (otherInput.value.trim()) {
          optionsDiv.querySelectorAll(".ask-user-option").forEach(function (b) {
            b.classList.remove("selected");
          });
          if (isMulti) multiSelections[qIdx] = new Set();
          answers[qIdx] = otherInput.value.trim();
        }
      });
      otherInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitAskUserAnswer(container, toolId, questions, answers, multiSelections);
        }
      });
      otherDiv.appendChild(otherInput);

      var submitBtn = document.createElement("button");
      submitBtn.className = "ask-user-submit";
      submitBtn.textContent = "Submit";
      submitBtn.addEventListener("click", function () {
        submitAskUserAnswer(container, toolId, questions, answers, multiSelections);
      });
      otherDiv.appendChild(submitBtn);

      qDiv.appendChild(otherDiv);
      container.appendChild(qDiv);
    });

    // Skip button
    var skipBtn = document.createElement("button");
    skipBtn.className = "ask-user-skip";
    skipBtn.textContent = "Skip";
    skipBtn.addEventListener("click", function () {
      if (container.classList.contains("answered")) return;
      container.classList.add("answered");
      enableMainInput();
      if (ws && connected) {
        ws.send(JSON.stringify({ type: "stop" }));
      }
    });
    container.appendChild(skipBtn);

    addToMessages(container);
    disableMainInput();
    setActivity(null);
    scrollToBottom();
  }

  function disableMainInput() {
    inputEl.disabled = true;
    inputEl.placeholder = "Answer the question above to continue...";
  }

  function enableMainInput() {
    inputEl.disabled = false;
    inputEl.placeholder = "Message Claude Code...";
  }

  function submitAskUserAnswer(container, toolId, questions, answers, multiSelections) {
    if (container.classList.contains("answered")) return;

    var result = {};
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      if (q.multiSelect && multiSelections[i] && multiSelections[i].size > 0) {
        result[i] = Array.from(multiSelections[i]).join(", ");
      } else if (answers[i]) {
        result[i] = answers[i];
      }
    }

    if (Object.keys(result).length === 0) return;

    container.classList.add("answered");
    enableMainInput();

    if (ws && connected) {
      ws.send(JSON.stringify({
        type: "ask_user_response",
        toolId: toolId,
        answers: result,
      }));
    }
  }

  // --- Permission request ---
  function permissionInputSummary(toolName, input) {
    if (!input || typeof input !== "object") return "";
    switch (toolName) {
      case "Bash": return input.command || input.description || "";
      case "Edit": return shortPath(input.file_path);
      case "Write": return shortPath(input.file_path);
      case "Read": return shortPath(input.file_path);
      case "Glob": return input.pattern || "";
      case "Grep": return (input.pattern || "") + (input.path ? " in " + shortPath(input.path) : "");
      default: return toolSummary(toolName, input);
    }
  }

  function renderPermissionRequest(requestId, toolName, toolInput, decisionReason) {
    finalizeAssistantBlock();
    stopThinking();

    var container = document.createElement("div");
    container.className = "permission-container";
    container.dataset.requestId = requestId;

    // Header
    var header = document.createElement("div");
    header.className = "permission-header";
    header.innerHTML =
      '<span class="permission-icon">' + iconHtml("shield") + '</span>' +
      '<span class="permission-title">Permission Required</span>';

    // Body
    var body = document.createElement("div");
    body.className = "permission-body";

    var summary = document.createElement("div");
    summary.className = "permission-summary";
    var summaryText = permissionInputSummary(toolName, toolInput);
    summary.innerHTML =
      '<span class="permission-tool-name"></span>' +
      (summaryText ? '<span class="permission-tool-desc"></span>' : '');
    summary.querySelector(".permission-tool-name").textContent = toolName;
    if (summaryText) {
      summary.querySelector(".permission-tool-desc").textContent = summaryText;
    }
    body.appendChild(summary);

    if (decisionReason) {
      var reason = document.createElement("div");
      reason.className = "permission-reason";
      reason.textContent = decisionReason;
      body.appendChild(reason);
    }

    // Collapsible details
    var details = document.createElement("details");
    details.className = "permission-details";
    var detailsSummary = document.createElement("summary");
    detailsSummary.textContent = "Details";
    var detailsPre = document.createElement("pre");
    detailsPre.textContent = JSON.stringify(toolInput, null, 2);
    details.appendChild(detailsSummary);
    details.appendChild(detailsPre);
    body.appendChild(details);

    // Actions
    var actions = document.createElement("div");
    actions.className = "permission-actions";

    var allowBtn = document.createElement("button");
    allowBtn.className = "permission-btn permission-allow";
    allowBtn.textContent = "Allow Once";
    allowBtn.addEventListener("click", function () {
      sendPermissionResponse(container, requestId, "allow");
    });

    var allowAlwaysBtn = document.createElement("button");
    allowAlwaysBtn.className = "permission-btn permission-allow-session";
    allowAlwaysBtn.textContent = "Always Allow";
    allowAlwaysBtn.addEventListener("click", function () {
      sendPermissionResponse(container, requestId, "allow_always");
    });

    var denyBtn = document.createElement("button");
    denyBtn.className = "permission-btn permission-deny";
    denyBtn.textContent = "Deny";
    denyBtn.addEventListener("click", function () {
      sendPermissionResponse(container, requestId, "deny");
    });

    actions.appendChild(allowBtn);
    actions.appendChild(allowAlwaysBtn);
    actions.appendChild(denyBtn);

    container.appendChild(header);
    container.appendChild(body);
    container.appendChild(actions);
    addToMessages(container);

    pendingPermissions[requestId] = container;
    refreshIcons();
    setActivity(null);
    scrollToBottom();
  }

  function sendPermissionResponse(container, requestId, decision) {
    if (container.classList.contains("resolved")) return;
    container.classList.add("resolved");

    var label = decision === "deny" ? "Denied" : "Allowed";
    var resolvedClass = decision === "deny" ? "resolved-denied" : "resolved-allowed";
    container.classList.add(resolvedClass);

    // Replace actions with decision label
    var actions = container.querySelector(".permission-actions");
    if (actions) {
      actions.innerHTML = '<span class="permission-decision-label">' + label + '</span>';
    }

    if (ws && connected) {
      ws.send(JSON.stringify({
        type: "permission_response",
        requestId: requestId,
        decision: decision,
      }));
    }

    delete pendingPermissions[requestId];
  }

  function markPermissionResolved(requestId, decision) {
    var container = pendingPermissions[requestId];
    if (!container) {
      // Find by data attribute (history replay)
      container = messagesEl.querySelector('[data-request-id="' + requestId + '"]');
    }
    if (!container || container.classList.contains("resolved")) return;

    container.classList.add("resolved");
    var resolvedClass = decision === "deny" ? "resolved-denied" : "resolved-allowed";
    container.classList.add(resolvedClass);

    var label = decision === "deny" ? "Denied" : "Allowed";
    var actions = container.querySelector(".permission-actions");
    if (actions) {
      actions.innerHTML = '<span class="permission-decision-label">' + label + '</span>';
    }

    delete pendingPermissions[requestId];
  }

  function markPermissionCancelled(requestId) {
    var container = pendingPermissions[requestId];
    if (!container) {
      container = messagesEl.querySelector('[data-request-id="' + requestId + '"]');
    }
    if (!container || container.classList.contains("resolved")) return;

    container.classList.add("resolved", "resolved-cancelled");
    var actions = container.querySelector(".permission-actions");
    if (actions) {
      actions.innerHTML = '<span class="permission-decision-label">Cancelled</span>';
    }

    delete pendingPermissions[requestId];
  }

  // --- Plan mode rendering ---
  function renderPlanBanner(type) {
    finalizeAssistantBlock();
    stopThinking();

    var el = document.createElement("div");
    el.className = "plan-banner";

    if (type === "enter") {
      inPlanMode = true;
      planContent = null;
      el.innerHTML =
        '<span class="plan-banner-icon">' + iconHtml("map") + '</span>' +
        '<span class="plan-banner-text">Entered plan mode</span>' +
        '<span class="plan-banner-hint">Exploring codebase and designing implementation...</span>';
      el.classList.add("plan-enter");
    } else {
      inPlanMode = false;
      el.innerHTML =
        '<span class="plan-banner-icon">' + iconHtml("check-circle") + '</span>' +
        '<span class="plan-banner-text">Plan ready for review</span>';
      el.classList.add("plan-exit");
    }

    addToMessages(el);
    refreshIcons();
    scrollToBottom();
    return el;
  }

  function renderPlanCard(content) {
    finalizeAssistantBlock();

    var el = document.createElement("div");
    el.className = "plan-card";

    var header = document.createElement("div");
    header.className = "plan-card-header";
    header.innerHTML =
      '<span class="plan-card-icon">' + iconHtml("file-text") + '</span>' +
      '<span class="plan-card-title">Implementation Plan</span>' +
      '<span class="plan-card-chevron">' + iconHtml("chevron-down") + '</span>';

    var body = document.createElement("div");
    body.className = "plan-card-body";
    body.innerHTML = renderMarkdown(content);
    highlightCodeBlocks(body);

    header.addEventListener("click", function () {
      el.classList.toggle("collapsed");
    });

    el.appendChild(header);
    el.appendChild(body);
    addToMessages(el);
    refreshIcons();
    scrollToBottom();
    return el;
  }

  // --- Todo rendering ---
  function todoStatusIcon(status) {
    switch (status) {
      case "completed": return iconHtml("check-circle");
      case "in_progress": return iconHtml("loader", "icon-spin");
      default: return iconHtml("circle");
    }
  }

  function handleTodoWrite(input) {
    if (!input || !Array.isArray(input.todos)) return;
    todoItems = input.todos.map(function (t, i) {
      return {
        id: t.id || String(i + 1),
        content: t.content || t.subject || "",
        status: t.status || "pending",
        activeForm: t.activeForm || "",
      };
    });
    renderTodoWidget();
  }

  function handleTaskCreate(input) {
    if (!input) return;
    var id = String(todoItems.length + 1);
    todoItems.push({
      id: id,
      content: input.subject || input.description || "",
      status: "pending",
      activeForm: input.activeForm || "",
    });
    renderTodoWidget();
  }

  function handleTaskUpdate(input) {
    if (!input || !input.taskId) return;
    for (var i = 0; i < todoItems.length; i++) {
      if (todoItems[i].id === input.taskId) {
        if (input.status === "deleted") {
          todoItems.splice(i, 1);
        } else {
          if (input.status) todoItems[i].status = input.status;
          if (input.subject) todoItems[i].content = input.subject;
          if (input.activeForm) todoItems[i].activeForm = input.activeForm;
        }
        break;
      }
    }
    renderTodoWidget();
  }

  function renderTodoWidget() {
    if (todoItems.length === 0) {
      if (todoWidgetEl) { todoWidgetEl.remove(); todoWidgetEl = null; }
      return;
    }

    var isNew = !todoWidgetEl;
    if (isNew) {
      todoWidgetEl = document.createElement("div");
      todoWidgetEl.className = "todo-widget";
    }

    var completed = 0;
    for (var i = 0; i < todoItems.length; i++) {
      if (todoItems[i].status === "completed") completed++;
    }

    var html = '<div class="todo-header">' +
      '<span class="todo-header-icon">' + iconHtml("list-checks") + '</span>' +
      '<span class="todo-header-title">Tasks</span>' +
      '<span class="todo-header-count">' + completed + '/' + todoItems.length + '</span>' +
      '</div>';
    html += '<div class="todo-progress"><div class="todo-progress-bar" style="width:' +
      (todoItems.length > 0 ? Math.round(completed / todoItems.length * 100) : 0) + '%"></div></div>';
    html += '<div class="todo-items">';
    for (var i = 0; i < todoItems.length; i++) {
      var t = todoItems[i];
      var statusClass = t.status === "completed" ? "completed" : t.status === "in_progress" ? "in-progress" : "pending";
      html += '<div class="todo-item ' + statusClass + '">' +
        '<span class="todo-item-icon">' + todoStatusIcon(t.status) + '</span>' +
        '<span class="todo-item-text">' + escapeHtml(t.status === "in_progress" && t.activeForm ? t.activeForm : t.content) + '</span>' +
        '</div>';
    }
    html += '</div>';

    todoWidgetEl.innerHTML = html;

    if (isNew) {
      addToMessages(todoWidgetEl);
    }
    refreshIcons();
    scrollToBottom();
  }

  // --- DOM: Messages ---
  function addUserMessage(text, images) {
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

    if (text) {
      var textEl = document.createElement("span");
      textEl.textContent = text;
      bubble.appendChild(textEl);
    }

    div.appendChild(bubble);
    addToMessages(div);
    scrollToBottom();
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
        navigator.clipboard.writeText(rawText).then(function () {
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
      if (contentEl) highlightCodeBlocks(contentEl);
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

  function updateTerminalBtn() {
    var btn = document.getElementById("terminal-btn");
    if (!btn) return;
    if (cliSessionId) {
      btn.classList.add("visible");
    } else {
      btn.classList.remove("visible");
    }
  }

  function resetClientState() {
    messagesEl.innerHTML = "";
    currentMsgEl = null;
    currentFullText = "";
    tools = {};
    currentThinking = null;
    activityEl = null;
    processing = false;
    inPlanMode = false;
    planContent = null;
    todoItems = [];
    todoWidgetEl = null;
    pendingPermissions = {};
    turnCounter = 0;
    messageUuidMap = [];
    pendingRewindUuid = null;
    historyFrom = 0;
    historyTotal = 0;
    prependAnchor = null;
    loadingMore = false;
    setRewindMode(false);
    setActivity(null);
    setStatus("connected");
  }

  // --- Thinking ---
  function startThinking() {
    finalizeAssistantBlock();

    var el = document.createElement("div");
    el.className = "thinking-item";
    el.innerHTML =
      '<div class="thinking-header">' +
      '<span class="thinking-chevron">' + iconHtml("chevron-right") + '</span>' +
      '<span class="thinking-label">Thinking</span>' +
      '<span class="thinking-duration"></span>' +
      '<span class="thinking-spinner">' + iconHtml("loader", "icon-spin") + '</span>' +
      '</div>' +
      '<div class="thinking-content"></div>';

    el.querySelector(".thinking-header").addEventListener("click", function () {
      el.classList.toggle("expanded");
    });

    addToMessages(el);
    refreshIcons();
    scrollToBottom();
    currentThinking = { el: el, fullText: "", startTime: Date.now() };
    setActivity(randomThinkingVerb() + "...");
  }

  function appendThinking(text) {
    if (!currentThinking) return;
    currentThinking.fullText += text;
    currentThinking.el.querySelector(".thinking-content").textContent = currentThinking.fullText;
    scrollToBottom();
  }

  function stopThinking() {
    if (!currentThinking) return;
    var secs = ((Date.now() - currentThinking.startTime) / 1000).toFixed(1);
    currentThinking.el.classList.add("done");
    currentThinking.el.querySelector(".thinking-duration").textContent = " " + secs + "s";
    currentThinking = null;
  }

  // --- Tool items ---
  function createToolItem(id, name) {
    finalizeAssistantBlock();
    stopThinking();

    var el = document.createElement("div");
    el.className = "tool-item";
    el.dataset.toolId = id;
    el.innerHTML =
      '<div class="tool-header">' +
      '<span class="tool-chevron">' + iconHtml("chevron-right") + '</span>' +
      '<span class="tool-bullet"></span>' +
      '<span class="tool-name"></span>' +
      '<span class="tool-desc"></span>' +
      '<span class="tool-status-icon">' + iconHtml("loader", "icon-spin") + '</span>' +
      '</div>' +
      '<div class="tool-subtitle">' +
      '<span class="tool-connector">&#9492;</span>' +
      '<span class="tool-subtitle-text">Running...</span>' +
      '</div>';

    el.querySelector(".tool-name").textContent = name;

    addToMessages(el);
    refreshIcons();
    scrollToBottom();

    tools[id] = { el: el, name: name, input: null, done: false };
    setActivity("Running " + name + "...");
  }

  function updateToolExecuting(id, name, input) {
    var tool = tools[id];
    if (!tool) return;

    tool.input = input;
    tool.el.querySelector(".tool-desc").textContent = toolSummary(name, input);
    setActivity(toolActivityText(name, input));

    var subtitleText = tool.el.querySelector(".tool-subtitle-text");
    if (subtitleText) subtitleText.textContent = toolActivityText(name, input);

    scrollToBottom();
  }

  function isDiffContent(text) {
    var lines = text.split("\n");
    var diffMarkers = 0;
    for (var i = 0; i < Math.min(lines.length, 20); i++) {
      var l = lines[i];
      if (l.startsWith("@@") || l.startsWith("---") || l.startsWith("+++")) {
        diffMarkers++;
      }
    }
    return diffMarkers >= 2;
  }

  function renderDiffPre(text) {
    var pre = document.createElement("pre");
    pre.className = "diff-content";
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var span = document.createElement("span");
      if (line.startsWith("@@")) {
        span.className = "diff-hunk";
      } else if (line.startsWith("---") || line.startsWith("+++")) {
        span.className = "diff-file-header";
      } else if (line.startsWith("+")) {
        span.className = "diff-add";
      } else if (line.startsWith("-")) {
        span.className = "diff-del";
      } else {
        span.className = "diff-ctx";
      }
      span.textContent = line;
      pre.appendChild(span);
      if (i < lines.length - 1) pre.appendChild(document.createTextNode("\n"));
    }
    return pre;
  }

  function getLanguageFromPath(filePath) {
    if (!filePath) return null;
    var parts = filePath.split("/");
    var filename = parts[parts.length - 1].toLowerCase();
    var dotIdx = filename.lastIndexOf(".");
    if (dotIdx === -1 || dotIdx === filename.length - 1) return null;
    var ext = filename.substring(dotIdx + 1);
    var map = {
      js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
      ts: "typescript", tsx: "typescript", mts: "typescript",
      py: "python", rb: "ruby", rs: "rust", go: "go",
      java: "java", kt: "kotlin", kts: "kotlin",
      cs: "csharp", cpp: "cpp", cc: "cpp", c: "c", h: "c", hpp: "cpp",
      css: "css", scss: "scss", less: "less",
      html: "xml", htm: "xml", xml: "xml", svg: "xml",
      json: "json", yaml: "yaml", yml: "yaml",
      md: "markdown", sh: "bash", bash: "bash", zsh: "bash",
      sql: "sql", swift: "swift", php: "php",
      toml: "ini", ini: "ini", conf: "ini",
      lua: "lua", r: "r", pl: "perl",
      ex: "elixir", exs: "elixir",
      erl: "erlang", hs: "haskell",
      graphql: "graphql", gql: "graphql",
    };
    return map[ext] || null;
  }

  function parseLineNumberedContent(text) {
    var lines = text.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    if (lines.length === 0) return null;

    var pattern = /^\s*(\d+)[→\t](.*)$/;
    var checkCount = Math.min(lines.length, 5);
    var matchCount = 0;
    for (var i = 0; i < checkCount; i++) {
      if (pattern.test(lines[i])) matchCount++;
    }
    if (matchCount < Math.ceil(checkCount * 0.6)) return null;

    var numbers = [];
    var code = [];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(pattern);
      if (m) {
        numbers.push(m[1]);
        code.push(m[2]);
      } else {
        numbers.push("");
        code.push(lines[i]);
      }
    }
    return { numbers: numbers, code: code };
  }

  function updateToolResult(id, content, isError) {
    var tool = tools[id];
    if (!tool) return;

    var subtitleText = tool.el.querySelector(".tool-subtitle-text");
    if (subtitleText && tool.input) {
      subtitleText.textContent = toolActivityText(tool.name, tool.input);
    }

    var resultBlock = document.createElement("div");
    var displayContent = content || "(no output)";
    displayContent = displayContent.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
    if (displayContent.length > 10000) displayContent = displayContent.substring(0, 10000) + "\n... (truncated)";

    var expandByDefault = !isError && tool.name === "Edit" && isDiffContent(displayContent);
    if (expandByDefault) {
      resultBlock.className = "tool-result-block";
      tool.el.classList.add("expanded");
    } else {
      resultBlock.className = "tool-result-block collapsed";
    }

    if (!isError && isDiffContent(displayContent)) {
      resultBlock.appendChild(renderDiffPre(displayContent));
    } else if (!isError && tool.name === "Read" && tool.input && tool.input.file_path) {
      var parsed = parseLineNumberedContent(displayContent);
      if (parsed) {
        var lang = getLanguageFromPath(tool.input.file_path);
        var viewer = document.createElement("div");
        viewer.className = "code-viewer";

        var gutter = document.createElement("pre");
        gutter.className = "code-gutter";
        gutter.textContent = parsed.numbers.join("\n");

        var codeBlock = document.createElement("pre");
        codeBlock.className = "code-content";
        var codeText = parsed.code.join("\n");

        if (lang) {
          try {
            var highlighted = hljs.highlight(codeText, { language: lang });
            var codeEl = document.createElement("code");
            codeEl.className = "hljs language-" + lang;
            codeEl.innerHTML = highlighted.value;
            codeBlock.appendChild(codeEl);
          } catch (e) {
            codeBlock.textContent = codeText;
          }
        } else {
          codeBlock.textContent = codeText;
        }

        viewer.appendChild(gutter);
        viewer.appendChild(codeBlock);

        // Sync vertical scroll between gutter and code
        viewer.addEventListener("scroll", function () {
          gutter.scrollTop = viewer.scrollTop;
          codeBlock.scrollTop = viewer.scrollTop;
        });

        resultBlock.appendChild(viewer);
      } else {
        var pre = document.createElement("pre");
        pre.textContent = displayContent;
        resultBlock.appendChild(pre);
      }
    } else {
      var pre = document.createElement("pre");
      if (isError) pre.className = "is-error";
      pre.textContent = displayContent;
      resultBlock.appendChild(pre);
    }
    tool.el.appendChild(resultBlock);

    tool.el.querySelector(".tool-header").addEventListener("click", function () {
      resultBlock.classList.toggle("collapsed");
      tool.el.classList.toggle("expanded");
    });

    markToolDone(id, isError);
    scrollToBottom();
  }

  function markToolDone(id, isError) {
    var tool = tools[id];
    if (!tool || tool.done) return;

    tool.done = true;
    if (!tool.el) return; // hidden tool (plan mode)

    tool.el.classList.add("done");
    if (isError) tool.el.classList.add("error");

    var icon = tool.el.querySelector(".tool-status-icon");
    if (isError) {
      icon.innerHTML = '<span class="err-icon">' + iconHtml("alert-triangle") + '</span>';
    } else {
      icon.innerHTML = '<span class="check">' + iconHtml("check") + '</span>';
    }
    refreshIcons();
  }

  function markAllToolsDone() {
    for (var id in tools) {
      if (tools.hasOwnProperty(id) && !tools[id].done) {
        markToolDone(id, false);
      }
    }
  }

  function addTurnMeta(cost, duration) {
    var div = document.createElement("div");
    div.className = "turn-meta";
    div.dataset.turn = turnCounter;
    var parts = [];
    if (cost != null) parts.push("$" + cost.toFixed(4));
    if (duration != null) parts.push((duration / 1000).toFixed(1) + "s");
    if (parts.length) {
      div.textContent = parts.join(" \u00b7 ");
      addToMessages(div);
      scrollToBottom();
    }
  }

  // --- WebSocket ---
  var connectTimeoutId = null;

  function connect() {
    if (ws) { ws.onclose = null; ws.close(); }
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }

    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host);

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
          projectNameEl.textContent = projectName;
          updatePageTitle();
          break;

        case "update_available":
          var updateBanner = $("update-banner");
          var updateVersion = $("update-version");
          if (updateBanner && updateVersion && msg.version) {
            updateVersion.textContent = "v" + msg.version;
            updateBanner.classList.remove("hidden");
            refreshIcons();
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
          isRemoteInput = true;
          inputEl.value = msg.text;
          autoResize();
          isRemoteInput = false;
          break;

        case "session_list":
          renderSessionList(msg.sessions || []);
          break;

        case "session_switched":
          activeSessionId = msg.id;
          cliSessionId = msg.cliSessionId || null;
          resetClientState();
          updateTerminalBtn();
          break;

        case "session_id":
          cliSessionId = msg.cliSessionId;
          updateTerminalBtn();
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
          addUserMessage(msg.text, msg.images || null);
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
            tools[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else if (msg.name === "ExitPlanMode") {
            if (planContent) {
              renderPlanCard(planContent);
            }
            renderPlanBanner("exit");
            tools[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else if (TODO_TOOLS[msg.name]) {
            tools[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else {
            createToolItem(msg.id, msg.name);
          }
          break;

        case "tool_executing":
          if (msg.name === "AskUserQuestion" && msg.input && msg.input.questions) {
            var askTool = tools[msg.id];
            if (askTool) {
              if (askTool.el) askTool.el.style.display = "none";
              askTool.done = true;
            }
            renderAskUserQuestion(msg.id, msg.input);
          } else if (msg.name === "Write" && msg.input && isPlanFile(msg.input.file_path)) {
            planContent = msg.input.content || "";
            updateToolExecuting(msg.id, msg.name, msg.input);
          } else if (msg.name === "TodoWrite") {
            handleTodoWrite(msg.input);
          } else if (msg.name === "TaskCreate") {
            handleTaskCreate(msg.input);
          } else if (msg.name === "TaskUpdate") {
            handleTaskUpdate(msg.input);
          } else if (TODO_TOOLS[msg.name]) {
            // TaskList, TaskGet - silently skip
          } else {
            var t = tools[msg.id];
            if (t && t.hidden) break;
            updateToolExecuting(msg.id, msg.name, msg.input);
          }
          break;

        case "tool_result":
          if (msg.content != null) {
            var tr = tools[msg.id];
            if (tr && tr.hidden) break; // skip hidden plan tools
            updateToolResult(msg.id, msg.content, msg.is_error || false);
          }
          break;

        case "permission_request":
          renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason);
          break;

        case "permission_cancel":
          markPermissionCancelled(msg.requestId);
          break;

        case "permission_resolved":
          markPermissionResolved(msg.requestId, msg.decision);
          break;

        case "permission_request_pending":
          renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason);
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
          tools = {};
          if (document.hidden) {
            if (notifAlertEnabled && notifPermission === "granted") showDoneNotification();
            if (notifSoundEnabled) playDoneSound();
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
          pendingRewindUuid = null;
          addSystemMessage(msg.text || "Rewind failed.", true);
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
    var savedThinking = currentThinking;
    var savedTurnCounter = turnCounter;
    var savedTools = tools;
    var savedTodoWidgetEl = todoWidgetEl;
    var savedInPlanMode = inPlanMode;
    var savedPlanContent = planContent;

    // Reset to initial values for clean rendering
    currentMsgEl = null;
    activityEl = null;
    currentFullText = "";
    currentThinking = null;
    turnCounter = 0;
    tools = {};
    todoWidgetEl = null;
    inPlanMode = false;
    planContent = null;

    // Set prepend anchor to insert before existing content
    // Skip the sentinel itself when setting anchor
    var firstReal = messagesEl.querySelector(".history-sentinel");
    prependAnchor = firstReal ? firstReal.nextSibling : messagesEl.firstChild;

    // Save scroll state
    var oldH = messagesEl.scrollHeight;

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
    currentThinking = savedThinking;
    turnCounter = savedTurnCounter;
    tools = savedTools;
    todoWidgetEl = savedTodoWidgetEl;
    inPlanMode = savedInPlanMode;
    planContent = savedPlanContent;

    // Fix scroll position so the user stays in place
    messagesEl.scrollTop += (messagesEl.scrollHeight - oldH);

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

  // --- Sending messages ---
  function sendMessage() {
    var text = inputEl.value.trim();
    var images = pendingImages.slice();
    if (!text && images.length === 0) return;
    hideSlashMenu();

    if (text === "/clear") {
      messagesEl.innerHTML = "";
      inputEl.value = "";
      clearPendingImages();
      autoResize();
      return;
    }

    if (text === "/rewind") {
      inputEl.value = "";
      clearPendingImages();
      autoResize();
      if (messageUuidMap.length === 0) {
        addSystemMessage("No rewind points available in this session.", true);
      } else {
        setRewindMode(!rewindMode);
      }
      return;
    }

    if (!connected || processing) return;

    addUserMessage(text, images.length > 0 ? images : null);

    var payload = { type: "message", text: text || "" };
    if (images.length > 0) {
      payload.images = images;
    }
    ws.send(JSON.stringify(payload));

    inputEl.value = "";
    sendInputSync();
    clearPendingImages();
    autoResize();
    inputEl.focus();
  }

  function autoResize() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  }

  // --- Image paste ---
  function addPendingImage(dataUrl) {
    // dataUrl = "data:image/png;base64,xxxx..."
    var commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) return;
    var header = dataUrl.substring(0, commaIdx); // "data:image/png;base64"
    var data = dataUrl.substring(commaIdx + 1);
    var typeMatch = header.match(/data:(image\/[^;,]+)/);
    if (!typeMatch || !data) return;
    pendingImages.push({ mediaType: typeMatch[1], data: data });
    renderImagePreviews();
  }

  function removePendingImage(idx) {
    pendingImages.splice(idx, 1);
    renderImagePreviews();
  }

  function clearPendingImages() {
    pendingImages = [];
    renderImagePreviews();
  }

  function renderImagePreviews() {
    imagePreviewBar.innerHTML = "";
    if (pendingImages.length === 0) {
      imagePreviewBar.classList.remove("visible");
      return;
    }
    imagePreviewBar.classList.add("visible");
    for (var i = 0; i < pendingImages.length; i++) {
      (function (idx) {
        var wrap = document.createElement("div");
        wrap.className = "image-preview-thumb";
        var img = document.createElement("img");
        img.src = "data:" + pendingImages[idx].mediaType + ";base64," + pendingImages[idx].data;
        var removeBtn = document.createElement("button");
        removeBtn.className = "image-preview-remove";
        removeBtn.innerHTML = iconHtml("x");
        removeBtn.addEventListener("click", function () {
          removePendingImage(idx);
        });
        wrap.appendChild(img);
        wrap.appendChild(removeBtn);
        imagePreviewBar.appendChild(wrap);
      })(i);
    }
    refreshIcons();
  }

  function readImageBlob(blob) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      addPendingImage(ev.target.result);
    };
    reader.readAsDataURL(blob);
  }

  document.addEventListener("paste", function (e) {
    var cd = e.clipboardData;
    if (!cd) return;

    var found = false;

    // Try clipboardData.files first (better Safari/iOS support)
    if (cd.files && cd.files.length > 0) {
      for (var i = 0; i < cd.files.length; i++) {
        if (cd.files[i].type.indexOf("image/") === 0) {
          found = true;
          readImageBlob(cd.files[i]);
        }
      }
    }

    // Fall back to clipboardData.items
    if (!found && cd.items) {
      for (var i = 0; i < cd.items.length; i++) {
        if (cd.items[i].type.indexOf("image/") === 0) {
          var blob = cd.items[i].getAsFile();
          if (blob) {
            found = true;
            readImageBlob(blob);
          }
        }
      }
    }

    if (found) e.preventDefault();
  });

  // --- Slash menu ---
  function getAllCommands() {
    return builtinCommands.concat(slashCommands);
  }

  function showSlashMenu(filter) {
    var query = filter.toLowerCase();
    slashFiltered = getAllCommands().filter(function (c) {
      return c.name.toLowerCase().indexOf(query) !== -1;
    });
    if (slashFiltered.length === 0) { hideSlashMenu(); return; }

    slashActiveIdx = 0;
    slashMenu.innerHTML = slashFiltered.map(function (c, i) {
      return '<div class="slash-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' +
        '<span class="slash-cmd">/' + c.name + '</span>' +
        '<span class="slash-desc">' + c.desc + '</span>' +
        '</div>';
    }).join("");
    slashMenu.classList.add("visible");

    slashMenu.querySelectorAll(".slash-item").forEach(function (el) {
      el.addEventListener("click", function () {
        selectSlashItem(parseInt(el.dataset.idx));
      });
    });
  }

  function hideSlashMenu() {
    slashMenu.classList.remove("visible");
    slashMenu.innerHTML = "";
    slashActiveIdx = -1;
    slashFiltered = [];
  }

  function selectSlashItem(idx) {
    if (idx < 0 || idx >= slashFiltered.length) return;
    var cmd = slashFiltered[idx];
    inputEl.value = "/" + cmd.name + " ";
    hideSlashMenu();
    autoResize();
    inputEl.focus();
  }

  function updateSlashHighlight() {
    slashMenu.querySelectorAll(".slash-item").forEach(function (el, i) {
      el.classList.toggle("active", i === slashActiveIdx);
    });
    var activeEl = slashMenu.querySelector(".slash-item.active");
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }

  // --- Input sync across devices ---
  var isRemoteInput = false;

  function sendInputSync() {
    if (isRemoteInput) return;
    if (ws && connected) {
      ws.send(JSON.stringify({ type: "input_sync", text: inputEl.value }));
    }
  }

  // --- Input handlers ---
  inputEl.addEventListener("input", function () {
    autoResize();
    sendInputSync();
    var val = inputEl.value;
    if (val.startsWith("/") && !val.includes(" ") && val.length > 1) {
      showSlashMenu(val.substring(1));
    } else if (val === "/") {
      showSlashMenu("");
    } else {
      hideSlashMenu();
    }
  });

  inputEl.addEventListener("compositionstart", function () { isComposing = true; });
  inputEl.addEventListener("compositionend", function () { isComposing = false; });

  inputEl.addEventListener("keydown", function (e) {
    if (slashFiltered.length > 0 && slashMenu.classList.contains("visible")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        slashActiveIdx = (slashActiveIdx + 1) % slashFiltered.length;
        updateSlashHighlight();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        slashActiveIdx = (slashActiveIdx - 1 + slashFiltered.length) % slashFiltered.length;
        updateSlashHighlight();
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectSlashItem(slashActiveIdx);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hideSlashMenu();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener("click", function () {
    if (processing && connected) {
      ws.send(JSON.stringify({ type: "stop" }));
      return;
    }
    sendMessage();
  });
  sendBtn.addEventListener("dblclick", function (e) { e.preventDefault(); });

  // --- Terminal button (expand -> copy resume command) ---
  var terminalBtn = document.getElementById("terminal-btn");
  var terminalCmd = terminalBtn ? terminalBtn.querySelector(".terminal-cmd") : null;
  if (terminalBtn) {
    terminalBtn.addEventListener("click", function () {
      if (!cliSessionId) return;
      var cmd = "claude --resume " + cliSessionId;

      if (!terminalBtn.classList.contains("expanded")) {
        // First click: expand to show label
        terminalCmd.textContent = "Copy resume command";
        terminalBtn.classList.add("expanded");
      } else {
        // Second click: copy
        navigator.clipboard.writeText(cmd).then(function () {
          terminalBtn.classList.add("copied");
          terminalCmd.textContent = "Copied!";
          setTimeout(function () {
            terminalBtn.classList.remove("copied", "expanded");
          }, 1500);
        });
      }
    });

    // Close when clicking elsewhere
    document.addEventListener("click", function (e) {
      if (!terminalBtn.contains(e.target) && terminalBtn.classList.contains("expanded")) {
        terminalBtn.classList.remove("expanded");
        terminalCmd.textContent = "";
      }
    });
  }

  // --- Mobile viewport (iOS keyboard handling) ---
  if (window.visualViewport) {
    var layout = $("layout");
    function onViewportChange() {
      layout.style.height = window.visualViewport.height + "px";
      document.documentElement.scrollTop = 0;
      scrollToBottom();
    }
    window.visualViewport.addEventListener("resize", onViewportChange);
    window.visualViewport.addEventListener("scroll", onViewportChange);
  }

  // --- Update banner ---
  (function () {
    var banner = $("update-banner");
    var closeBtn = $("update-banner-close");
    var howBtn = $("update-how");
    if (!banner) return;

    // Build popover
    var popover = document.createElement("div");
    popover.id = "update-popover";
    popover.innerHTML =
      '<div class="popover-label">Run in your terminal:</div>' +
      '<div class="popover-cmd">' +
      '<code>npx claude-relay@latest</code>' +
      '<button class="popover-copy" title="Copy">' + iconHtml("copy") + '</button>' +
      '</div>';
    banner.appendChild(popover);
    refreshIcons();

    var copyBtn = popover.querySelector(".popover-copy");
    copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText("npx claude-relay@latest").then(function () {
        copyBtn.classList.add("copied");
        copyBtn.innerHTML = iconHtml("check");
        refreshIcons();
        setTimeout(function () {
          copyBtn.classList.remove("copied");
          copyBtn.innerHTML = iconHtml("copy");
          refreshIcons();
        }, 1500);
      });
    });

    howBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      popover.classList.toggle("visible");
    });

    document.addEventListener("click", function (e) {
      if (!popover.contains(e.target) && e.target !== howBtn) {
        popover.classList.remove("visible");
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        banner.classList.add("hidden");
        popover.classList.remove("visible");
      });
    }
  })();

  // --- HTTPS banner / auto-redirect ---
  (function () {
    if (location.protocol === "https:") return;
    var banner = $("https-banner");
    var link = $("https-banner-link");
    var closeBtn = $("https-banner-close");
    if (!banner) return;

    fetch("/https-info").then(function (r) { return r.json(); }).then(function (info) {
      if (!info.httpsUrl) return;

      // Try connecting to HTTPS - if cert is trusted, redirect
      var ac = new AbortController();
      setTimeout(function () { ac.abort(); }, 2000);
      fetch(info.httpsUrl + "/info", { signal: ac.signal })
        .then(function () { location.replace(info.httpsUrl); })
        .catch(function () {
          // Cert not trusted, show banner
          link.href = "/setup";
          banner.classList.remove("hidden");
          refreshIcons();
        });
    }).catch(function () { });

    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        banner.classList.add("hidden");
      });
    }
  })();

  // --- Tooltip ---
  var tooltipEl = document.createElement("div");
  tooltipEl.className = "tooltip";
  document.body.appendChild(tooltipEl);
  var tooltipTimer = null;

  document.addEventListener("click", function (e) {
    var target = e.target.closest("[data-tip]");
    if (target) {
      tooltipEl.textContent = target.dataset.tip;
      var rect = target.getBoundingClientRect();
      tooltipEl.style.top = (rect.bottom + 8) + "px";
      tooltipEl.style.left = (rect.left + rect.width / 2) + "px";
      tooltipEl.classList.add("visible");
      clearTimeout(tooltipTimer);
      tooltipTimer = setTimeout(function () {
        tooltipEl.classList.remove("visible");
      }, 2000);
    } else {
      tooltipEl.classList.remove("visible");
    }
  });

  // --- Browser notifications ---
  var notifPermission = ("Notification" in window) ? Notification.permission : "denied";
  var notifAlertEnabled = localStorage.getItem("notif-alert") !== "0";
  var notifSoundEnabled = localStorage.getItem("notif-sound") !== "0";

  var notifBtn = $("notif-btn");
  var notifMenu = $("notif-menu");
  var notifToggleAlert = $("notif-toggle-alert");
  var notifToggleSound = $("notif-toggle-sound");

  if (notifAlertEnabled && "Notification" in window && Notification.permission === "denied") {
    notifAlertEnabled = false;
    localStorage.setItem("notif-alert", "0");
  }
  notifToggleAlert.checked = notifAlertEnabled;
  notifToggleSound.checked = notifSoundEnabled;

  notifBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var open = notifMenu.classList.toggle("hidden");
    notifBtn.classList.toggle("active", !open);
  });

  document.addEventListener("click", function (e) {
    if (!notifMenu.contains(e.target) && e.target !== notifBtn) {
      notifMenu.classList.add("hidden");
      notifBtn.classList.remove("active");
    }
  });

  var notifBlockedHint = $("notif-blocked-hint");

  notifToggleAlert.addEventListener("change", function () {
    notifAlertEnabled = notifToggleAlert.checked;
    localStorage.setItem("notif-alert", notifAlertEnabled ? "1" : "0");
    notifBlockedHint.classList.add("hidden");
    if (notifAlertEnabled && notifPermission !== "granted") {
      if ("Notification" in window && Notification.permission === "denied") {
        notifAlertEnabled = false;
        notifToggleAlert.checked = false;
        localStorage.setItem("notif-alert", "0");
        notifBlockedHint.classList.remove("hidden");
        refreshIcons();
        return;
      }
      Notification.requestPermission().then(function (p) {
        notifPermission = p;
        if (p !== "granted") {
          notifAlertEnabled = false;
          notifToggleAlert.checked = false;
          localStorage.setItem("notif-alert", "0");
          notifBlockedHint.classList.remove("hidden");
          refreshIcons();
        }
      });
    }
  });

  // --- Notification help modal ---
  var notifHelpModal = $("notif-help-modal");
  var notifHelpClose = $("notif-help-close");
  var notifLearnMore = $("notif-learn-more");
  var notifUrlCopy = $("notif-url-copy");
  var notifSettingsUrl = $("notif-settings-url");

  // Detect browser and set correct settings URL
  (function () {
    var url = "chrome://settings/content/notifications";
    var ua = navigator.userAgent;
    if (ua.indexOf("Firefox") !== -1) url = "about:preferences#privacy";
    else if (ua.indexOf("Edg/") !== -1) url = "edge://settings/content/notifications";
    else if (ua.indexOf("Arc") !== -1) url = "arc://settings/content/notifications";
    notifSettingsUrl.textContent = url;
  })();

  notifLearnMore.addEventListener("click", function (e) {
    e.preventDefault();
    notifHelpModal.classList.remove("hidden");
    refreshIcons();
  });

  notifHelpClose.addEventListener("click", function () {
    notifHelpModal.classList.add("hidden");
  });

  notifHelpModal.querySelector(".confirm-backdrop").addEventListener("click", function () {
    notifHelpModal.classList.add("hidden");
  });

  notifUrlCopy.addEventListener("click", function () {
    navigator.clipboard.writeText(notifSettingsUrl.textContent).then(function () {
      notifUrlCopy.classList.add("copied");
      notifUrlCopy.innerHTML = iconHtml("check");
      refreshIcons();
      setTimeout(function () {
        notifUrlCopy.classList.remove("copied");
        notifUrlCopy.innerHTML = iconHtml("copy");
        refreshIcons();
      }, 1500);
    });
  });

  notifToggleSound.addEventListener("change", function () {
    notifSoundEnabled = notifToggleSound.checked;
    localStorage.setItem("notif-sound", notifSoundEnabled ? "1" : "0");
  });

  var audioCtx = null;

  function playDoneSound() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.1;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
      osc.stop(audioCtx.currentTime + 0.3);
    } catch(e) {}
  }

  function showDoneNotification() {
    var lastAssistant = messagesEl.querySelector(".msg-assistant:last-of-type .md-content");
    var preview = lastAssistant ? lastAssistant.textContent.substring(0, 100) : "Response ready";

    var sessionTitle = "Claude";
    var activeItem = sessionListEl.querySelector(".session-item.active");
    if (activeItem) {
      var textEl = activeItem.querySelector(".session-item-text");
      if (textEl) sessionTitle = textEl.textContent || "Claude";
      else sessionTitle = activeItem.textContent || "Claude";
    }

    var n = new Notification(sessionTitle, {
      body: preview,
      tag: "claude-done",
    });

    n.onclick = function() {
      window.focus();
      n.close();
    };

    setTimeout(function() { n.close(); }, 5000);
  }

  // --- Service Worker & Push Subscription ---
  (function initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;

    navigator.serviceWorker.register("/sw.js")
      .then(function () { return navigator.serviceWorker.ready; })
      .then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          if (sub) return sub;
          return fetch("/api/vapid-public-key")
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (!data.publicKey) return null;
              var raw = atob(data.publicKey.replace(/-/g, "+").replace(/_/g, "/"));
              var key = new Uint8Array(raw.length);
              for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
              return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
            });
        });
      })
      .then(function (sub) {
        if (!sub) return;
        window._pushSubscription = sub;
        var json = sub.toJSON();
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "push_subscribe", subscription: json }));
        } else {
          fetch("/api/push-subscribe", {
            method: "POST", headers: { "Content-Type": "application/json" },
            credentials: "same-origin", body: JSON.stringify(json),
          });
        }
      })
      .catch(function () {});
  })();

  // --- Init ---
  lucide.createIcons();
  startVerbCycle();
  startPixelAnim();
  connect();
  inputEl.focus();
})();
