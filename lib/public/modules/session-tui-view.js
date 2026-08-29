// session-tui-view.js
//
// Renders a Claude Code TUI inside the main session view area when the
// active session is a `mode: 'tui'` session. The PTY itself is managed by
// the server's terminal-manager (same infra that powers the bottom-panel
// shell tabs); this module is responsible only for the embedded xterm and
// for relaying input/output/resize for the bound terminal.
//
// Lifecycle (driven by app-messages.js on session_switched):
//   attachTuiView(terminalId)  - mount xterm, send term_attach
//   detachTuiView()            - send term_detach, dispose xterm
//
// PTY survives detach (server keeps the terminal alive). On `/exit` or
// claude exit the server's onExit hook deletes the session and broadcasts
// the new session list; this view tears itself down via handleTermExited.

import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { getTerminalTheme } from './theme.js';
import { getTerminalFontFamily, getTerminalFontSize, onTerminalFontChange } from './terminal-prefs.js';
import { showHeaderTuiFont, hideHeaderTuiFont } from './header-tui-font.js';
import { attachTuiGrab, detachTuiGrab } from './tui-grab.js';
import { createKeyToolbar, TERMINAL_TOOLBAR_HTML } from './terminal-toolbar.js';
import { refreshIcons, iconHtml } from './icons.js';

// Claude TUI sessions always use Clay Studio Dark via getTerminalTheme().
// Theme switches reapply that fixed palette through setTuiSessionTheme().

var hostEl = null;       // container div mounted over #messages
var xtermContainerEl = null;
var keyToolbar = null;   // shared mobile control-key bar (terminal-toolbar.js)
var isTouchDevice = "ontouchstart" in window;
// Mobile input strategy: iOS WebKit (and other mobile IMEs) don't fire usable
// composition events on xterm's hidden helper textarea, so Korean/CJK input
// reaches the PTY as decomposed jamo. Rather than reinvent an input surface,
// we keep the regular GUI composer (#input) visible below the terminal on
// touch devices and forward its send into the PTY (input.js -> tuiSubmitText).
// xterm is render-only on mobile.

var xterm = null;        // xterm.js instance
var fitAddon = null;
var webglAddon = null;
var currentTermId = null;
// IME composition state. Mobile keyboards (and CJK input generally) compose
// a character from several keystrokes; xterm's onData fires for each
// intermediate jamo/kana, which on the PTY shows up as decomposed text
// (e.g. Korean "안녕" arriving as "ㅇㅏㄴㄴㅕㅇ"). We gate onData while a
// composition is active and emit the finished string on compositionend.
var imeComposing = false;
var imeLastComposed = "";
var imeLastComposedAt = 0;
var resizeObserver = null;
var windowResizeBound = false;
var resizeDebounce = null;
// Debounced fit+redraw: collapses a stream of resize events (60fps drag)
// into a single SIGWINCH/refresh pair at the end. Without this the TUI
// gets corrupted because claude starts redrawing at intermediate sizes
// before the user finishes resizing.
//
// The end-of-debounce sequence is intentionally split across two rAFs:
//
//   1. syncHostBounds() mutates hostEl.style.width. The xterm container
//      width derives from that via flex layout. We must wait one frame
//      so the style change has been applied to layout before
//      fitAddon.fit() reads clientWidth - otherwise fit() can compute
//      cols against the pre-resize container width.
//   2. A second rAF + second fit() pass converges any further layout
//      adjustments (scrollbar appear/disappear, the key toolbar
//      reflowing on narrower widths, etc.). This mirrors the two-pass
//      fit used on attach (fitNow + setTimeout(fitNow, 50)).
//   3. WebGL renderer caches a font atlas keyed on cell metrics. When
//      cell size shifts on resize the atlas can desync, producing the
//      "width looks broken" artifacts. clearTextureAtlas() forces a
//      rebuild so glyphs are re-rasterized at the new metrics.
function scheduleResize() {
  if (currentTermId == null) return;
  if (resizeDebounce) clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(function () {
    resizeDebounce = null;
    syncHostBounds();
    requestAnimationFrame(function () {
      fitNow();
      requestAnimationFrame(function () {
        fitNow();
        if (webglAddon && typeof webglAddon.clearTextureAtlas === "function") {
          try { webglAddon.clearTextureAtlas(); } catch (e) {}
        }
        if (xterm) {
          try { xterm.refresh(0, xterm.rows - 1); } catch (e) {}
        }
      });
    });
  }, 120);
}
function onWindowResize() { scheduleResize(); }

function ensureHostEl() {
  if (hostEl) return hostEl;
  // Anchor the host to the chat content area (the bounding box of
  // #messages) rather than the viewport. Using `position: fixed` worked
  // visually but broke layout when the sidebar, header, or any side panel
  // was open - the xterm slid under them. Re-position on every show via
  // syncHostBounds() so resizes and panel toggles stay in sync.
  hostEl = document.createElement("div");
  hostEl.id = "tui-session-host";
  hostEl.style.position = "fixed";
  hostEl.style.display = "none";
  hostEl.style.flexDirection = "column";
  hostEl.style.background = "#000000";
  hostEl.style.zIndex = "5";
  hostEl.style.overflow = "hidden";
  hostEl.style.boxSizing = "border-box";
  // 4px inset on all sides so the terminal doesn't kiss the edges of the
  // content area. fitAddon computes against the xterm container's
  // clientWidth/clientHeight (which exclude padding + the key toolbar),
  // so cols/rows stay correct.
  hostEl.style.padding = "4px";

  // Mobile control-key bar at the top of the TUI: soft keyboards lack
  // Esc/Tab/Ctrl/arrows, which the Claude TUI relies on. Reuses the shared
  // terminal-toolbar component (same markup/keys as the bottom-panel shell).
  // Touch devices only; on desktop a hardware keyboard already has the keys.
  if (isTouchDevice) {
    var toolbarEl = document.createElement("div");
    toolbarEl.id = "tui-key-toolbar";
    toolbarEl.className = "term-toolbar";
    toolbarEl.innerHTML = TERMINAL_TOOLBAR_HTML;
    hostEl.appendChild(toolbarEl);
    keyToolbar = createKeyToolbar({
      toolbar: toolbarEl,
      send: sendTermInput,
    });
  }

  // Dedicated xterm container so the toolbar sits above the terminal
  // rather than xterm mounting at the host root (which would have it
  // side-by-side with the toolbar under flex layout).
  xtermContainerEl = document.createElement("div");
  xtermContainerEl.className = "tui-xterm-container";
  xtermContainerEl.style.flex = "1 1 auto";
  xtermContainerEl.style.minHeight = "0";
  xtermContainerEl.style.position = "relative";
  hostEl.appendChild(xtermContainerEl);

  // Mobile: route typing through the regular GUI composer (#input). Its
  // native textarea composes Korean/CJK correctly, unlike xterm's hidden
  // helper textarea on mobile WebKit. On touch devices the composer stays
  // visible below the terminal (see hideGuiChrome) and its send is
  // intercepted into the PTY (see input.js -> tuiSubmitText). Tapping the
  // terminal focuses the composer so the keyboard opens, and the toolbar's
  // sticky Ctrl is applied to composer letters here (Ctrl+C etc.).
  if (isTouchDevice) {
    xtermContainerEl.addEventListener("click", focusGuiComposer);
    var composer = document.getElementById("input");
    if (composer) {
      composer.addEventListener("keydown", function (e) {
        if (currentTermId == null) return;
        if (e.key && e.key.length === 1 && keyToolbar && keyToolbar.takeCtrl()) {
          var cc = e.key.toUpperCase().charCodeAt(0);
          if (cc >= 65 && cc <= 90) {
            e.preventDefault();
            sendTermInput(String.fromCharCode(cc - 64));
          }
        }
      }, true);
    }
  }

  // Paste-image handling. Two paths cover the common platforms:
  //
  //   1. `paste` event in capture phase - covers Cmd+V on macOS and
  //      Ctrl+V on Win/Linux, where the browser fires a paste event
  //      with clipboardData populated.
  //   2. `keydown` for Ctrl+V (no Meta) in capture phase - macOS does
  //      not fire `paste` for Ctrl+V (Ctrl isn't the OS paste modifier
  //      there), so the keystroke would otherwise reach claude CLI
  //      directly. We read the system clipboard via the async
  //      Clipboard API instead.
  //
  // In both paths an image hit is uploaded to /api/upload (same
  // endpoint the GUI input uses) and the returned absolute path is
  // injected as text into the PTY; claude CLI accepts file paths as
  // prompt input. Capture phase + stopImmediatePropagation keep xterm
  // from also processing the event (which would paste the filename
  // text alongside the path).
  hostEl.addEventListener("paste", handleTuiPaste, true);
  hostEl.addEventListener("keydown", handleTuiCtrlV, true);

  document.body.appendChild(hostEl);
  return hostEl;
}

function handleTuiCtrlV(e) {
  // Only handle plain Ctrl+V (no Meta/Alt/Shift). Cmd+V on macOS is
  // covered by the paste event handler. Without this intercept on macOS
  // a Ctrl+V keystroke would just be forwarded to claude CLI's own
  // paste path, which can't read image data out of the system
  // clipboard reliably ("no image found in clipboard").
  if (e.key !== "v" || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if (currentTermId == null) return;
  if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") return;

  // Stop the keystroke from also reaching xterm / the PTY. We take full
  // ownership of paste semantics: image -> upload + inject path, text
  // -> forward via term_input, nothing -> no-op.
  e.preventDefault();
  e.stopImmediatePropagation();

  navigator.clipboard.read().then(function (items) {
    for (var i = 0; i < items.length; i++) {
      var imgType = null;
      for (var t = 0; t < items[i].types.length; t++) {
        if (items[i].types[t].indexOf("image/") === 0) { imgType = items[i].types[t]; break; }
      }
      if (imgType) {
        items[i].getType(imgType).then(uploadAndInjectPath).catch(function () {});
        return; // handle the first image found
      }
    }
    // No image - fall back to text paste behavior.
    if (typeof navigator.clipboard.readText === "function") {
      navigator.clipboard.readText().then(function (text) {
        if (!text || currentTermId == null) return;
        var ws = getWs();
        if (!ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ type: "term_input", id: currentTermId, data: text }));
      }).catch(function () {});
    }
  }).catch(function () {
    // Permission denied or unsupported - silently fail. xterm received
    // no keystroke either because we already stopped propagation, so
    // the user can press the key again to retry.
  });
}

function handleTuiPaste(e) {
  var cd = e.clipboardData;
  if (!cd || currentTermId == null) return;

  // Collect image blobs from both cd.files (Safari/iOS friendly) and
  // cd.items. Plain-text-only paste is left untouched so xterm's built-in
  // text paste keeps working.
  var blobs = [];
  if (cd.files && cd.files.length > 0) {
    for (var i = 0; i < cd.files.length; i++) {
      if (cd.files[i] && cd.files[i].type.indexOf("image/") === 0) blobs.push(cd.files[i]);
    }
  }
  if (blobs.length === 0 && cd.items) {
    for (var j = 0; j < cd.items.length; j++) {
      if (cd.items[j] && cd.items[j].type && cd.items[j].type.indexOf("image/") === 0) {
        var b = cd.items[j].getAsFile();
        if (b) blobs.push(b);
      }
    }
  }
  if (blobs.length === 0) return; // text or other - let xterm handle

  // Stop xterm's textarea from also seeing this event and pasting the
  // file's text representation (filename) alongside our injected path.
  e.preventDefault();
  e.stopImmediatePropagation();
  for (var k = 0; k < blobs.length; k++) {
    uploadAndInjectPath(blobs[k]);
  }
}

function uploadAndInjectPath(blob) {
  var ext = ".png";
  if (blob.type === "image/jpeg") ext = ".jpg";
  else if (blob.type === "image/gif") ext = ".gif";
  else if (blob.type === "image/webp") ext = ".webp";
  var name = blob.name || ("pasted-" + Date.now() + ext);

  var reader = new FileReader();
  reader.onload = function (ev) {
    var dataUrl = ev.target.result;
    var commaIdx = dataUrl.indexOf(",");
    var b64 = commaIdx !== -1 ? dataUrl.substring(commaIdx + 1) : "";
    var basePath = store.get("basePath") || "/";
    var xhr = new XMLHttpRequest();
    xhr.open("POST", basePath + "api/upload");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function () {
      if (xhr.status !== 200) return;
      try {
        var resp = JSON.parse(xhr.responseText);
        if (!resp || !resp.path || currentTermId == null) return;
        var ws = getWs();
        if (!ws || ws.readyState !== 1) return;
        // Wrap in double quotes if the path contains whitespace so the
        // shell / claude CLI treats it as a single token.
        var injected = /\s/.test(resp.path) ? '"' + resp.path + '"' : resp.path;
        ws.send(JSON.stringify({ type: "term_input", id: currentTermId, data: injected }));
      } catch (e) {}
    };
    xhr.send(JSON.stringify({ name: name, data: b64 }));
  };
  reader.readAsDataURL(blob);
}

function syncHostBounds() {
  if (!hostEl) return;
  var messagesEl = document.getElementById("messages");
  if (!messagesEl) return;
  var r = messagesEl.getBoundingClientRect();
  hostEl.style.top = r.top + "px";
  hostEl.style.left = r.left + "px";
  hostEl.style.width = r.width + "px";
  // Desktop hides the GUI composer and extends the terminal to the viewport
  // bottom (covering the band where #input-area used to sit). Mobile keeps
  // the composer visible below the terminal, so end the host at #messages'
  // own bottom and leave the composer its space.
  if (isTouchDevice) {
    hostEl.style.height = r.height + "px";
  } else {
    hostEl.style.height = Math.max(0, window.innerHeight - r.top) + "px";
  }
}

function hideGuiChrome(hide) {
  var messagesEl = document.getElementById("messages");
  var inputArea = document.getElementById("input-area");
  if (messagesEl) messagesEl.style.visibility = hide ? "hidden" : "";
  // Mobile keeps the composer visible during TUI so the native IME can
  // compose Korean/CJK; its send is routed to the PTY. Desktop hides it and
  // types straight into xterm.
  if (inputArea && !isTouchDevice) inputArea.style.display = hide ? "none" : "";
  var newMsgBtn = document.getElementById("new-msg-btn");
  if (newMsgBtn) newMsgBtn.style.display = hide ? "none" : "";
  // On mobile, mark the body while the composer is acting as a TUI conduit so
  // CSS hides composer controls that don't apply (schedule, mention, model/
  // vendor config). Attach + voice stay available.
  if (isTouchDevice && document.body) {
    document.body.classList.toggle("tui-composer-active", hide);
  }
}

function fitNow() {
  if (!xterm || !fitAddon || !hostEl) return;
  syncHostBounds();
  try {
    var prevCols = xterm.cols;
    var prevRows = xterm.rows;
    fitAddon.fit();
    var dimsChanged = (xterm.cols !== prevCols || xterm.rows !== prevRows);
    // Inform the server so its PTY's idea of cols/rows matches what xterm
    // just rendered. Without this, claude TUI redraws using stale dims.
    if (currentTermId != null && getWs() && getWs().readyState === 1) {
      getWs().send(JSON.stringify({
        type: "term_resize",
        id: currentTermId,
        cols: xterm.cols,
        rows: xterm.rows,
      }));
    }
    // After cols/rows change, the previous frame in xterm's buffer is now
    // reflowed/truncated against the new geometry. Claude TUI (ink) repaints
    // using absolute cursor positioning and only writes cells it considers
    // dirty - cells outside the old bounding box stay showing stale or empty
    // content (the "right half is blank after window enlarges" symptom).
    // Wipe the screen here so the next SIGWINCH-driven redraw lands on a
    // clean canvas.
    if (dimsChanged) xterm.write("\x1b[2J\x1b[H");
  } catch (e) {}
}

function createXterm() {
  if (typeof Terminal === "undefined") return null;
  var theme = getTerminalTheme();
  // Match the host background to the xterm theme so any sub-cell gap
  // between the last rendered row and the host's bottom blends in.
  if (hostEl) hostEl.style.background = theme.background;
  var term = new Terminal({
    cursorBlink: true,
    fontSize: getTerminalFontSize(),
    fontFamily: getTerminalFontFamily(),
    theme: theme,
    scrollback: 5000,
  });
  if (typeof FitAddon !== "undefined") {
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
  }
  if (typeof WebLinksAddon !== "undefined") {
    try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch (e) {}
  }
  term.open(xtermContainerEl || hostEl);
  bindImeComposition(term);
  if (keyToolbar) keyToolbar.bindXterm(term);
  if (typeof WebglAddon !== "undefined") {
    try {
      webglAddon = new WebglAddon.WebglAddon();
      webglAddon.onContextLoss(function () {
        try { webglAddon.dispose(); } catch (e) {}
        webglAddon = null;
      });
      term.loadAddon(webglAddon);
    } catch (e) {}
  }
  // Route keystrokes back to the PTY. Suppress while an IME composition is
  // in flight (the intermediate jamo/kana would otherwise reach the PTY as
  // decomposed text); the finished string is sent from compositionend.
  term.onData(function (data) {
    if (currentTermId == null) return;
    if (imeComposing) return;
    // Drop xterm's own echo of the just-composed string (it re-emits the
    // finalized text via onData right after compositionend).
    if (data && data === imeLastComposed && (Date.now() - imeLastComposedAt) < 120) {
      imeLastComposed = "";
      return;
    }
    sendTermInput(data);
  });
  return term;
}

function sendTermInput(data) {
  if (currentTermId == null || !data) return;
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "term_input", id: currentTermId, data: data }));
  }
}

// Focus the GUI composer (touch) or xterm (desktop). On mobile the composer
// owns input so the IME composes in a real textarea; focusing xterm's hidden
// textarea is what breaks Korean composition in the first place.
function focusGuiComposer() {
  try {
    if (isTouchDevice) {
      var composer = document.getElementById("input");
      if (composer) composer.focus();
    } else if (xterm) {
      xterm.focus();
    }
  } catch (e) {}
}

// --- Title-bar "Close" button (live TUI only) ---
// Explicitly closes the running PTY now (suspend_tui_session) instead of
// waiting for the idle sweep; the session drops to read-only history + Resume.
var closeBtnBound = false;
function bindCloseBtn() {
  if (closeBtnBound) return;
  var btn = document.getElementById("header-tui-close-btn");
  if (!btn) return;
  closeBtnBound = true;
  btn.addEventListener("click", function () {
    var sid = store.get("activeSessionId");
    if (sid == null) return;
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "suspend_tui_session", id: sid }));
    }
  });
}
function showHeaderTuiClose() {
  bindCloseBtn();
  var btn = document.getElementById("header-tui-close-btn");
  if (btn) btn.classList.remove("hidden");
}
function hideHeaderTuiClose() {
  var btn = document.getElementById("header-tui-close-btn");
  if (btn) btn.classList.add("hidden");
}

// True while a TUI session is mounted. input.js uses this to route the GUI
// composer's send into the PTY instead of the normal SDK message path.
export function tuiIsActive() {
  return currentTermId != null;
}

// Submit a line typed in the GUI composer to the TUI's PTY (text + Enter).
export function tuiSubmitText(text) {
  if (currentTermId == null) return;
  if (text) sendTermInput(text);
  sendTermInput("\r");
}

// --- Lazy-resume "suspended" view ---
// A born-TUI session whose PTY isn't running is shown as a read-only
// transcript (server hydrates history) with the composer hidden and a Resume
// bar in its place. Clicking Resume asks the server to spawn `claude --resume`
// (resume_tui_session); the follow-up session_switched then attaches xterm.
var resumeBarEl = null;
var resumeBarSessionId = null;

function ensureResumeBar() {
  if (resumeBarEl) return resumeBarEl;
  resumeBarEl = document.createElement("div");
  resumeBarEl.id = "tui-resume-bar";
  resumeBarEl.innerHTML =
    '<button type="button" class="tui-resume-btn">' +
    iconHtml("play") + '<span>Resume in terminal</span></button>' +
    '<span class="tui-resume-hint">Read-only history · resume to continue in the terminal</span>';
  resumeBarEl.querySelector(".tui-resume-btn").addEventListener("click", function () {
    if (resumeBarSessionId == null) return;
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "resume_tui_session", id: resumeBarSessionId }));
    }
  });
  var inputArea = document.getElementById("input-area");
  if (inputArea && inputArea.parentNode) {
    inputArea.parentNode.insertBefore(resumeBarEl, inputArea.nextSibling);
  } else {
    document.body.appendChild(resumeBarEl);
  }
  return resumeBarEl;
}

// Toggle the read-only/Resume presentation. `active` true hides the composer
// and shows the Resume bar for `sessionId`; false restores normal chrome.
export function setTuiSuspendedView(active, sessionId) {
  if (active) {
    ensureResumeBar();
    resumeBarSessionId = sessionId;
    if (document.body) document.body.classList.add("tui-suspended");
    refreshIcons();
  } else {
    resumeBarSessionId = null;
    if (document.body) document.body.classList.remove("tui-suspended");
  }
}

// Bind IME composition handlers to xterm's helper textarea so CJK / mobile
// composed input is sent as whole characters instead of per-keystroke jamo.
function bindImeComposition(term) {
  var ta = term && term.textarea;
  if (!ta) return;
  ta.addEventListener("compositionstart", function () {
    imeComposing = true;
  });
  ta.addEventListener("compositionend", function (e) {
    imeComposing = false;
    var composed = (e && e.data) || "";
    if (!composed) return;
    imeLastComposed = composed;
    imeLastComposedAt = Date.now();
    sendTermInput(composed);
  });
}

function teardownXterm() {
  if (webglAddon) {
    try { webglAddon.dispose(); } catch (e) {}
    webglAddon = null;
  }
  if (xterm) {
    try { xterm.dispose(); } catch (e) {}
    xterm = null;
  }
  fitAddon = null;
  imeComposing = false;
  imeLastComposed = "";
  imeLastComposedAt = 0;
}

export function attachTuiView(terminalId, localId, vendor) {
  if (typeof terminalId !== "number") return;
  // Re-attaching to the same terminal: just refit and refocus.
  if (currentTermId === terminalId && xterm) {
    if (hostEl) hostEl.style.display = "flex";
    hideGuiChrome(true);
    showHeaderTuiFont();
    showHeaderTuiClose();
    fitNow();
    focusGuiComposer();
    // Re-arm hover-grab against the same xterm in case the session
    // metadata (localId / vendor) changed since the last attach.
    if (localId) attachTuiGrab(xterm, xtermContainerEl, localId, { vendor: vendor });
    return;
  }
  // Switching to a different TUI terminal: tear down the old one cleanly.
  if (currentTermId != null && currentTermId !== terminalId) {
    detachTuiView();
  }
  if (!ensureHostEl()) return;
  hostEl.style.display = "flex";
  hideGuiChrome(true);
  showHeaderTuiFont();
  showHeaderTuiClose();
  syncHostBounds();

  currentTermId = terminalId;
  if (!xterm) xterm = createXterm();
  if (!xterm) return;
  // PC통신-style hover-and-click grab over the rendered output. Pulls
  // its index from the on-disk JSONL transcript via tui_transcript_*
  // messages; no-ops for Codex sessions.
  if (localId) attachTuiGrab(xterm, xtermContainerEl, localId, { vendor: vendor });

  // Subscribe to the terminal's output stream on the server. The server
  // replays its scrollback buffer on attach so we never start blank.
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "term_attach", id: terminalId }));
  }

  // First fit pass; defer a second pass for layout to settle.
  fitNow();
  setTimeout(fitNow, 50);
  focusGuiComposer();

  if (!resizeObserver && typeof ResizeObserver !== "undefined") {
    // Watch the chat-content area, not the host: the host's size is
    // derived from #messages via syncHostBounds, so observing it would
    // miss the actual source of truth (sidebar toggles, panel opens, etc.)
    var msgEl = document.getElementById("messages");
    if (msgEl) {
      resizeObserver = new ResizeObserver(function () { scheduleResize(); });
      resizeObserver.observe(msgEl);
    }
  }
  if (!windowResizeBound) {
    window.addEventListener("resize", onWindowResize);
    windowResizeBound = true;
  }
}

export function detachTuiView() {
  if (resizeObserver) {
    try { resizeObserver.disconnect(); } catch (e) {}
    resizeObserver = null;
  }
  detachTuiGrab();
  if (currentTermId != null) {
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify({ type: "term_detach", id: currentTermId })); } catch (e) {}
    }
  }
  currentTermId = null;
  teardownXterm();
  if (keyToolbar) keyToolbar.reset();
  if (hostEl) hostEl.style.display = "none";
  hideGuiChrome(false);
  hideHeaderTuiFont();
  hideHeaderTuiClose();
}

// Route a term_output frame to the embedded xterm if it belongs to the
// current TUI session. Returns true if consumed so app-messages can skip
// the bottom-panel handler.
export function tuiHandleTermOutput(msg) {
  if (!msg || msg.id !== currentTermId || !xterm || !msg.data) return false;
  xterm.write(msg.data);
  return true;
}

export function tuiHandleTermResized(msg) {
  if (!msg || msg.id !== currentTermId || !xterm) return false;
  if (msg.cols > 0 && msg.rows > 0) {
    try { xterm.resize(msg.cols, msg.rows); } catch (e) {}
  }
  return true;
}

export function tuiHandleTermExited(msg) {
  if (!msg || msg.id !== currentTermId) return false;
  if (xterm) {
    try { xterm.write("\r\n\x1b[90m[claude exited - session will close]\x1b[0m\r\n"); } catch (e) {}
  }
  // The server's onExit hook deletes the session record and broadcasts a
  // fresh session_list. The next session_switched (or empty state) will
  // call detachTuiView for us.
  return true;
}

export function tuiHandleTermClosed(msg) {
  if (!msg || msg.id !== currentTermId) return false;
  detachTuiView();
  return true;
}

export function getActiveTuiTerminalId() {
  return currentTermId;
}

// Live theme update. Called by theme.js applyTheme() whenever the user
// switches themes - rewrites xterm colors in place and re-syncs the
// host background so transitions are seamless without re-mounting the
// PTY.
export function setTuiSessionTheme(xtermTheme) {
  if (xterm) {
    try { xterm.options.theme = xtermTheme; } catch (e) {}
  }
  if (hostEl && xtermTheme && xtermTheme.background) {
    hostEl.style.background = xtermTheme.background;
  }
}

// Live font update. Cell metrics shift with font size, so we refit
// after applying and let the existing resize debounce notify the PTY
// of the new cols/rows.
onTerminalFontChange(function (family, size) {
  if (!xterm) return;
  try {
    if (family) xterm.options.fontFamily = family;
    if (size) xterm.options.fontSize = size;
  } catch (e) {}
  scheduleResize();
});
