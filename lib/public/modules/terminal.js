import { iconHtml, refreshIcons } from './icons.js';
import { closeSidebar } from './sidebar.js';
import { closeFileViewer } from './filebrowser.js';

var ctx;
var tabs = new Map(); // termId -> { id, title, exited, xterm, fitAddon, bodyEl }
var activeTabId = null;
var isOpen = false;
var ctrlActive = false;
var isTouchDevice = "ontouchstart" in window;
var viewportHandler = null;
var resizeObserver = null;
var toolbarBound = false;

// --- Init ---
export function initTerminal(_ctx) {
  ctx = _ctx;

  // Close panel button
  document.getElementById("terminal-close").addEventListener("click", function () {
    closeTerminal();
  });

  // Header toggle button
  var toggleBtn = document.getElementById("terminal-toggle-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      if (isOpen && !ctx.terminalContainerEl.classList.contains("hidden")) {
        closeTerminal();
      } else {
        openTerminal();
      }
    });
  }

  // Sidebar terminal button
  var sidebarTermBtn = document.getElementById("terminal-sidebar-btn");
  if (sidebarTermBtn) {
    sidebarTermBtn.addEventListener("click", function () {
      closeSidebar();
      openTerminal();
    });
  }

  // New tab button
  var newTabBtn = document.getElementById("terminal-new-tab");
  if (newTabBtn) {
    newTabBtn.addEventListener("click", function () {
      createNewTab();
    });
  }
}

// --- Open terminal panel ---
export function openTerminal() {
  var container = ctx.terminalContainerEl;

  // Hide file viewer if open (also unwatches)
  closeFileViewer();

  container.classList.remove("hidden");
  isOpen = true;

  // If no tabs exist, create one
  if (tabs.size === 0) {
    createNewTab();
    return; // createNewTab will handle the rest via term_created
  }

  // Attach to active tab (or first available)
  if (!activeTabId || !tabs.has(activeTabId)) {
    activeTabId = tabs.keys().next().value;
  }

  activateTab(activeTabId);

  // Mobile: close sidebar
  if (window.innerWidth <= 768) {
    closeSidebar();
  }

  refreshIcons();
}

// --- Close terminal panel (hide, detach, but keep PTYs alive) ---
export function closeTerminal() {
  var container = ctx.terminalContainerEl;
  container.classList.add("hidden");

  // Detach from active tab
  if (activeTabId && ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "term_detach", id: activeTabId }));
  }

  cleanupListeners();

  // Hide toolbar
  var toolbar = document.getElementById("terminal-toolbar");
  if (toolbar) {
    toolbar.classList.add("hidden");
    var ctrlBtn = toolbar.querySelector("[data-key='ctrl']");
    if (ctrlBtn) ctrlBtn.classList.remove("active");
  }
  ctrlActive = false;

  isOpen = false;
}

// --- Create new tab ---
function createNewTab() {
  if (!ctx.ws || !ctx.connected) return;

  // Get current terminal body dimensions for cols/rows
  var cols = 80;
  var rows = 24;
  if (activeTabId && tabs.has(activeTabId)) {
    var activeTab = tabs.get(activeTabId);
    if (activeTab.xterm) {
      cols = activeTab.xterm.cols || 80;
      rows = activeTab.xterm.rows || 24;
    }
  }

  ctx.ws.send(JSON.stringify({ type: "term_create", cols: cols, rows: rows }));
}

// --- Close a tab (kill PTY) ---
function closeTab(termId) {
  if (!ctx.ws || !ctx.connected) return;
  ctx.ws.send(JSON.stringify({ type: "term_close", id: termId }));
}

// --- Activate a tab (show xterm, attach) ---
function activateTab(termId) {
  var tab = tabs.get(termId);
  if (!tab) return;

  // Detach from old active
  if (activeTabId && activeTabId !== termId && ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "term_detach", id: activeTabId }));
  }

  // Hide all tab bodies
  for (var t of tabs.values()) {
    if (t.bodyEl) t.bodyEl.style.display = "none";
  }

  activeTabId = termId;

  // Lazy-create xterm instance
  if (!tab.xterm) {
    createXtermForTab(tab);
  }

  // Show this tab's body
  if (tab.bodyEl) tab.bodyEl.style.display = "";

  // Attach to server
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "term_attach", id: termId }));
  }

  // Fit and focus
  setupListeners();
  fitTerminal();

  if (tab.xterm) {
    tab.xterm.focus();
  }

  // Show toolbar on touch devices
  var toolbar = document.getElementById("terminal-toolbar");
  if (toolbar && isTouchDevice) {
    toolbar.classList.remove("hidden");
    initToolbar(toolbar);
  }

  // Mobile viewport handling
  if (window.visualViewport && !viewportHandler) {
    viewportHandler = function () {
      ctx.terminalContainerEl.style.height = window.visualViewport.height + "px";
      fitTerminal();
    };
    window.visualViewport.addEventListener("resize", viewportHandler);
  }

  renderTabBar();
}

// --- Create xterm.js instance for a tab ---
function createXtermForTab(tab) {
  if (typeof Terminal === "undefined") return;

  var xterm = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
    theme: {
      background: "#1a1a1a",
      foreground: "#d4d4d4",
      cursor: "#d4d4d4",
      selectionBackground: "rgba(255,255,255,0.2)",
      black: "#1a1a1a",
      red: "#f44747",
      green: "#6a9955",
      yellow: "#d7ba7d",
      blue: "#569cd6",
      magenta: "#c586c0",
      cyan: "#4ec9b0",
      white: "#d4d4d4",
      brightBlack: "#808080",
      brightRed: "#f44747",
      brightGreen: "#6a9955",
      brightYellow: "#d7ba7d",
      brightBlue: "#569cd6",
      brightMagenta: "#c586c0",
      brightCyan: "#4ec9b0",
      brightWhite: "#ffffff",
    },
  });

  var fitAddon = null;
  if (typeof FitAddon !== "undefined") {
    fitAddon = new FitAddon.FitAddon();
    xterm.loadAddon(fitAddon);
  }

  // Create a container div for this tab's terminal
  var bodyEl = document.createElement("div");
  bodyEl.className = "terminal-tab-body";
  ctx.terminalBodyEl.appendChild(bodyEl);

  xterm.open(bodyEl);

  // Route input to server
  xterm.onData(function (data) {
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "term_input", id: tab.id, data: data }));
    }
  });

  tab.xterm = xterm;
  tab.fitAddon = fitAddon;
  tab.bodyEl = bodyEl;
}

// --- Fit active terminal ---
function fitTerminal() {
  if (!activeTabId) return;
  var tab = tabs.get(activeTabId);
  if (!tab || !tab.fitAddon || !tab.xterm) return;

  try {
    tab.fitAddon.fit();
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({
        type: "term_resize",
        id: activeTabId,
        cols: tab.xterm.cols,
        rows: tab.xterm.rows,
      }));
    }
  } catch (e) {}
}

// --- Setup/cleanup resize listeners ---
function setupListeners() {
  cleanupListeners();

  window.addEventListener("resize", fitTerminal);

  if (typeof ResizeObserver !== "undefined" && ctx.terminalBodyEl) {
    resizeObserver = new ResizeObserver(function () {
      fitTerminal();
    });
    resizeObserver.observe(ctx.terminalBodyEl);
  }
}

function cleanupListeners() {
  window.removeEventListener("resize", fitTerminal);

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  if (viewportHandler && window.visualViewport) {
    window.visualViewport.removeEventListener("resize", viewportHandler);
    viewportHandler = null;
  }
  ctx.terminalContainerEl.style.height = "";
}

// --- Render tab bar ---
function renderTabBar() {
  var tabsEl = document.getElementById("terminal-tabs");
  if (!tabsEl) return;

  tabsEl.innerHTML = "";

  for (var tab of tabs.values()) {
    (function (t) {
      var el = document.createElement("div");
      el.className = "terminal-tab";
      if (t.id === activeTabId) el.classList.add("active");
      if (t.exited) el.classList.add("exited");

      var label = document.createElement("span");
      label.className = "terminal-tab-label";
      label.textContent = t.title;
      el.appendChild(label);

      // Double-click label to rename
      label.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        startRenameTab(t, label);
      });

      var closeBtn = document.createElement("button");
      closeBtn.className = "terminal-tab-close";
      closeBtn.innerHTML = '<i data-lucide="x" style="width:12px;height:12px"></i>';
      closeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        closeTab(t.id);
      });
      el.appendChild(closeBtn);

      el.addEventListener("click", function () {
        if (t.id !== activeTabId) {
          activateTab(t.id);
        }
      });

      tabsEl.appendChild(el);
    })(tab);
  }

  updateTerminalBadge();
  refreshIcons();
}

// --- Rename tab inline ---
function startRenameTab(tab, labelEl) {
  var input = document.createElement("input");
  input.className = "terminal-tab-rename";
  input.value = tab.title;
  input.maxLength = 50;

  labelEl.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    var newTitle = input.value.trim();
    if (newTitle && newTitle !== tab.title) {
      tab.title = newTitle;
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "term_rename", id: tab.id, title: newTitle }));
      }
    }
    renderTabBar();
  }

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { input.blur(); }
    if (e.key === "Escape") {
      input.value = tab.title; // revert
      input.blur();
    }
    e.stopPropagation();
  });
}

// --- Update terminal count badge ---
function updateTerminalBadge() {
  var countEl = document.getElementById("terminal-count");
  if (!countEl) return;

  var count = 0;
  for (var t of tabs.values()) {
    if (!t.exited) count++;
  }

  if (count > 0) {
    countEl.textContent = count;
    countEl.classList.remove("hidden");
  } else {
    countEl.classList.add("hidden");
  }
}

// --- Handle server messages ---

export function handleTermList(msg) {
  var serverTerminals = msg.terminals || [];
  var serverIds = new Set();

  // Add/update tabs from server list
  for (var i = 0; i < serverTerminals.length; i++) {
    var st = serverTerminals[i];
    serverIds.add(st.id);

    if (tabs.has(st.id)) {
      var existing = tabs.get(st.id);
      existing.title = st.title;
      existing.exited = st.exited;
    } else {
      tabs.set(st.id, {
        id: st.id,
        title: st.title,
        exited: st.exited,
        xterm: null,
        fitAddon: null,
        bodyEl: null,
      });
    }
  }

  // Remove tabs no longer on server
  for (var id of tabs.keys()) {
    if (!serverIds.has(id)) {
      var removed = tabs.get(id);
      if (removed.xterm) {
        removed.xterm.dispose();
      }
      if (removed.bodyEl && removed.bodyEl.parentNode) {
        removed.bodyEl.parentNode.removeChild(removed.bodyEl);
      }
      tabs.delete(id);
    }
  }

  // If active tab was removed, switch to first available
  if (activeTabId && !tabs.has(activeTabId)) {
    activeTabId = null;
  }

  renderTabBar();

  // If panel is open and we have tabs, re-attach
  if (isOpen && tabs.size > 0) {
    if (!activeTabId) {
      activeTabId = tabs.keys().next().value;
    }
    activateTab(activeTabId);
  }

  // If panel is open and all tabs are gone, close panel
  if (isOpen && tabs.size === 0) {
    closeTerminal();
  }
}

export function handleTermCreated(msg) {
  // Switch to the newly created tab
  if (msg.id && tabs.has(msg.id)) {
    activateTab(msg.id);
  }
}

export function handleTermOutput(msg) {
  if (!msg.id) return;
  var tab = tabs.get(msg.id);
  if (tab && tab.xterm && msg.data) {
    tab.xterm.write(msg.data);
  }
}

export function handleTermExited(msg) {
  if (!msg.id) return;
  var tab = tabs.get(msg.id);
  if (tab) {
    tab.exited = true;
    if (tab.xterm) {
      tab.xterm.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
    }
    renderTabBar();
  }
}

export function handleTermClosed(msg) {
  if (!msg.id) return;
  var tab = tabs.get(msg.id);
  if (tab) {
    if (tab.xterm) tab.xterm.dispose();
    if (tab.bodyEl && tab.bodyEl.parentNode) {
      tab.bodyEl.parentNode.removeChild(tab.bodyEl);
    }
    tabs.delete(msg.id);

    if (activeTabId === msg.id) {
      activeTabId = null;
      if (tabs.size > 0) {
        activeTabId = tabs.keys().next().value;
        activateTab(activeTabId);
      }
    }

    renderTabBar();

    // Close panel if no tabs left
    if (isOpen && tabs.size === 0) {
      closeTerminal();
    }
  }
}

// --- Reset on reconnect ---
export function resetTerminals() {
  // Dispose all xterm instances (server state survives, client re-syncs via term_list)
  for (var tab of tabs.values()) {
    if (tab.xterm) {
      tab.xterm.dispose();
      tab.xterm = null;
      tab.fitAddon = null;
    }
    if (tab.bodyEl && tab.bodyEl.parentNode) {
      tab.bodyEl.parentNode.removeChild(tab.bodyEl);
      tab.bodyEl = null;
    }
  }
  tabs.clear();
  activeTabId = null;
  cleanupListeners();
  renderTabBar();
}

// --- Mobile toolbar ---
var KEY_MAP = {
  tab: "\t",
  esc: "\x1b",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
};

function initToolbar(toolbar) {
  if (!toolbarBound) {
    toolbarBound = true;

    toolbar.addEventListener("mousedown", function (e) { e.preventDefault(); });

    toolbar.addEventListener("click", function (e) {
      var btn = e.target.closest(".term-key");
      if (!btn) return;

      var tab = activeTabId ? tabs.get(activeTabId) : null;
      if (!tab || !tab.xterm) return;

      var key = btn.dataset.key;
      if (!key) return;

      if (key === "ctrl") {
        ctrlActive = !ctrlActive;
        btn.classList.toggle("active", ctrlActive);
        return;
      }

      var seq = KEY_MAP[key];
      if (!seq) return;

      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "term_input", id: activeTabId, data: seq }));
      }

      if (ctrlActive) {
        ctrlActive = false;
        var ctrlBtn = toolbar.querySelector("[data-key='ctrl']");
        if (ctrlBtn) ctrlBtn.classList.remove("active");
      }
    });
  }

  // Attach Ctrl handler to active terminal
  var tab = activeTabId ? tabs.get(activeTabId) : null;
  if (tab && tab.xterm) {
    tab.xterm.attachCustomKeyEventHandler(function (ev) {
      if (ctrlActive && ev.type === "keydown" && ev.key.length === 1) {
        var charCode = ev.key.toUpperCase().charCodeAt(0);
        if (charCode >= 65 && charCode <= 90) {
          var ctrlChar = String.fromCharCode(charCode - 64);
          if (ctx.ws && ctx.connected) {
            ctx.ws.send(JSON.stringify({ type: "term_input", id: activeTabId, data: ctrlChar }));
          }
          ctrlActive = false;
          var ctrlBtn = document.querySelector("#terminal-toolbar [data-key='ctrl']");
          if (ctrlBtn) ctrlBtn.classList.remove("active");
          return false;
        }
      }
      return true;
    });
  }
}
