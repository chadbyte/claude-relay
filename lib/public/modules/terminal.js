import { refreshIcons } from './icons.js';
import { closeSidebar } from './sidebar.js';

var ctx;
var term = null;
var viewportHandler = null;
var fitAddon = null;
var resizeObserver = null;
var isOpen = false;
var ctrlActive = false;
var isTouchDevice = "ontouchstart" in window;

export function initTerminal(_ctx) {
  ctx = _ctx;

  // Close button
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
}

export function openTerminal() {
  var container = ctx.terminalContainerEl;
  var body = ctx.terminalBodyEl;

  // Hide file viewer if open
  ctx.fileViewerEl.classList.add("hidden");

  // If already open, just show it
  if (isOpen && term) {
    container.classList.remove("hidden");
    term.focus();
    fitTerminal();
    return;
  }

  container.classList.remove("hidden");

  // Create xterm instance
  if (typeof Terminal === "undefined") {
    body.innerHTML = '<div class="terminal-hint">xterm.js not loaded</div>';
    return;
  }

  term = new Terminal({
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

  if (typeof FitAddon !== "undefined") {
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
  }

  term.open(body);

  // Send user input to server
  term.onData(function (data) {
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "term_input", data: data }));
    }
  });

  // Fit terminal to container
  fitTerminal();

  // Open PTY on server
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "term_open" }));
  }

  // Auto-fit on resize
  window.addEventListener("resize", fitTerminal);

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(function () {
      fitTerminal();
    });
    resizeObserver.observe(body);
  }

  // Mobile: constrain terminal height to visible area above keyboard
  if (window.visualViewport) {
    viewportHandler = function () {
      var container = ctx.terminalContainerEl;
      container.style.height = window.visualViewport.height + "px";
      fitTerminal();
    };
    window.visualViewport.addEventListener("resize", viewportHandler);
  }

  // Show toolbar on touch devices
  var toolbar = document.getElementById("terminal-toolbar");
  if (toolbar && isTouchDevice) {
    toolbar.classList.remove("hidden");
    initToolbar(toolbar);
  }

  isOpen = true;
  term.focus();

  // Mobile: close sidebar
  if (window.innerWidth <= 768) {
    closeSidebar();
  }

  refreshIcons();
}

export function handleTermOutput(msg) {
  if (term && msg.data) {
    term.write(msg.data);
  }
}

export function handleTermExited() {
  if (term) {
    term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
  }
}

export function closeTerminal() {
  var container = ctx.terminalContainerEl;
  container.classList.add("hidden");

  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "term_close" }));
  }

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  window.removeEventListener("resize", fitTerminal);

  if (viewportHandler && window.visualViewport) {
    window.visualViewport.removeEventListener("resize", viewportHandler);
    viewportHandler = null;
  }
  ctx.terminalContainerEl.style.height = "";

  if (term) {
    term.dispose();
    term = null;
    fitAddon = null;
  }

  // Hide toolbar and reset state
  var toolbar = document.getElementById("terminal-toolbar");
  if (toolbar) {
    toolbar.classList.add("hidden");
    var ctrlBtn = toolbar.querySelector("[data-key='ctrl']");
    if (ctrlBtn) ctrlBtn.classList.remove("active");
  }
  ctrlActive = false;

  // Clear the body for fresh open next time
  ctx.terminalBodyEl.innerHTML = "";
  isOpen = false;
}

function fitTerminal() {
  if (!fitAddon || !term) return;
  try {
    fitAddon.fit();
    // Tell server about the new size
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({
        type: "term_resize",
        cols: term.cols,
        rows: term.rows,
      }));
    }
  } catch (e) {
    // ignore fit errors (element not visible, etc.)
  }
}

var KEY_MAP = {
  tab: "\t",
  esc: "\x1b",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
};

var toolbarBound = false;

function initToolbar(toolbar) {
  // Bind click handler once (toolbar element persists across opens)
  if (!toolbarBound) {
    toolbarBound = true;

    // Prevent toolbar taps from stealing focus from terminal
    toolbar.addEventListener("mousedown", function (e) { e.preventDefault(); });

    toolbar.addEventListener("click", function (e) {
      var btn = e.target.closest(".term-key");
      if (!btn || !term) return;

      var key = btn.dataset.key;
      if (!key) return;

      // Ctrl toggle
      if (key === "ctrl") {
        ctrlActive = !ctrlActive;
        btn.classList.toggle("active", ctrlActive);
        return;
      }

      var seq = KEY_MAP[key];
      if (!seq) return;

      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "term_input", data: seq }));
      }

      // Deactivate Ctrl after sending a key
      if (ctrlActive) {
        ctrlActive = false;
        var ctrlBtn = toolbar.querySelector("[data-key='ctrl']");
        if (ctrlBtn) ctrlBtn.classList.remove("active");
      }
    });
  }

  // Attach Ctrl key handler to current terminal instance
  if (term) {
    term.attachCustomKeyEventHandler(function (ev) {
      if (ctrlActive && ev.type === "keydown" && ev.key.length === 1) {
        var charCode = ev.key.toUpperCase().charCodeAt(0);
        if (charCode >= 65 && charCode <= 90) {
          var ctrlChar = String.fromCharCode(charCode - 64);
          if (ctx.ws && ctx.connected) {
            ctx.ws.send(JSON.stringify({ type: "term_input", data: ctrlChar }));
          }
          ctrlActive = false;
          var ctrlBtn = toolbar.querySelector("[data-key='ctrl']");
          if (ctrlBtn) ctrlBtn.classList.remove("active");
          return false;
        }
      }
      return true;
    });
  }
}
