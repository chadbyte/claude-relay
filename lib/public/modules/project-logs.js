// Project Logs — the project's ledger of agent-authored decisions and work.
//
// A bounded right-side workbench pane, like the document viewer and terminal.
// Inside it there is one navigation stack rather than a master/detail split:
// the list fills the pane, opening an entry replaces it with the full-pane
// record, and Back returns to the list with the query, filter, and scroll
// position intact.
//
// People read and comment. Canonical entries are created and revised only by
// this project's agent sessions through the clay-logs MCP tools, so this
// module has no create or edit affordance at all.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { closeScheduler } from './scheduler.js';
import { hideNotes } from './sticky-notes.js';
import { closeNotesBrowser } from './sticky-notes-browser.js';
import { closeFileViewer } from './filebrowser.js';
import { closeTerminal } from './terminal.js';
import { renderFilter, renderList, renderDetail } from './project-logs-render.js';
import {
  initProjectLogsAmbient, bindPanelHover, noteCanonicalUpdate,
  acknowledgeUpdates, resetAmbient, syncAmbient, hidePreview, pinFromPreview
} from './project-logs-ambient.js';

var panel = null;
var listEl = null;
var detailEl = null;
var searchEl = null;
var filterEl = null;
var backBtn = null;
var searchTimer = null;
var requestCounter = 0;

function nextRequestId(prefix) {
  requestCounter += 1;
  return prefix + "-" + Date.now() + "-" + requestCounter;
}

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function ensurePanel() {
  if (panel) return;
  var panels = document.getElementById("main-panels");
  if (!panels) return;
  panel = document.createElement("section");
  panel.id = "project-logs-panel";
  panel.className = "project-logs-panel hidden";
  panel.setAttribute("aria-label", "Project Logs");
  panel.innerHTML =
    '<header class="project-logs-topbar">' +
      '<button id="project-logs-back" class="project-logs-icon-btn hidden" type="button" title="Back to the log list" aria-label="Back to the log list"><i data-lucide="arrow-left"></i></button>' +
      '<span class="project-logs-title"><i data-lucide="notebook-tabs"></i>Logs</span>' +
      '<span class="project-logs-subtitle">Decisions and work recorded by this project</span>' +
      '<div class="project-logs-window-actions" aria-label="Project Logs window controls">' +
        '<button id="project-logs-wide" class="project-logs-icon-btn" type="button" title="Widen panel" aria-label="Widen Logs panel" aria-pressed="false"><i data-lucide="chevrons-left-right"></i></button>' +
        '<button id="project-logs-fullscreen" class="project-logs-icon-btn" type="button" title="Toggle fullscreen" aria-label="Toggle Logs fullscreen" aria-pressed="false"><i data-lucide="maximize-2"></i></button>' +
        '<button id="project-logs-close" class="project-logs-icon-btn" type="button" title="Close Logs" aria-label="Close Logs"><i data-lucide="x"></i></button>' +
      '</div>' +
    '</header>' +
    '<div id="project-logs-toolbar" class="project-logs-toolbar">' +
      '<label class="project-logs-search"><i data-lucide="search"></i><input id="project-logs-search" type="search" placeholder="Search logs" autocomplete="off"></label>' +
      '<div id="project-logs-filter-slot"></div>' +
    '</div>' +
    '<div id="project-logs-list" class="project-logs-list" role="list"></div>' +
    '<main id="project-logs-detail" class="project-logs-detail hidden"></main>';
  panels.appendChild(panel);

  listEl = panel.querySelector("#project-logs-list");
  detailEl = panel.querySelector("#project-logs-detail");
  searchEl = panel.querySelector("#project-logs-search");
  filterEl = panel.querySelector("#project-logs-filter-slot");
  backBtn = panel.querySelector("#project-logs-back");

  panel.querySelector("#project-logs-close").addEventListener("click", closeProjectLogs);
  backBtn.addEventListener("click", function () { pinOnInteraction(); showList(); });
  // Any meaningful interaction inside a preview commits to it.
  searchEl.addEventListener("focus", pinOnInteraction);
  panel.addEventListener("pointerdown", pinOnInteraction);
  bindPanelHover(panel);
  panel.querySelector("#project-logs-wide").addEventListener("click", function () {
    applyWindowState(!store.get('projectLogsWide'), store.get('projectLogsFullscreen'));
  });
  panel.querySelector("#project-logs-fullscreen").addEventListener("click", function () {
    applyWindowState(store.get('projectLogsWide'), !store.get('projectLogsFullscreen'));
  });
  searchEl.addEventListener("input", function () {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(requestList, 180);
  });
  refreshIcons();
}

// A preview reveals the pane without committing to it: no acknowledgement, no
// open state, and no list refresh beyond what is already on screen.
function revealPreview() {
  ensurePanel();
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.classList.add("project-logs-previewing");
  applyWindowState(store.get('projectLogsWide'), false);
  if (!store.get('projectLogsEntries') || !store.get('projectLogsEntries').length) requestList();
}

function hideRevealedPreview() {
  if (!panel) return;
  panel.classList.remove("project-logs-previewing");
  if (store.get('projectLogsOpen')) return;
  panel.classList.add("hidden");
}

// Width and fullscreen are transient view state, so they live in the store like
// every other mutable UI value. `panel-fullscreen` is the shared class the
// document viewer and terminal already use.
function applyWindowState(wide, fullscreen) {
  store.set({ projectLogsWide: !!wide, projectLogsFullscreen: !!fullscreen });
  if (!panel) return;
  panel.classList.toggle("project-logs-wide", !!wide && !fullscreen);
  panel.classList.toggle("panel-fullscreen", !!fullscreen);
  var wideBtn = panel.querySelector("#project-logs-wide");
  var fullBtn = panel.querySelector("#project-logs-fullscreen");
  if (wideBtn) {
    wideBtn.setAttribute("aria-pressed", wide ? "true" : "false");
    wideBtn.disabled = !!fullscreen;
  }
  if (fullBtn) fullBtn.setAttribute("aria-pressed", fullscreen ? "true" : "false");
}

// --- Navigation stack ----------------------------------------------------

function showList() {
  if (!panel) return;
  store.set({ projectLogsView: "list", projectLogsSelectedRef: null });
  detailEl.classList.add("hidden");
  listEl.classList.remove("hidden");
  panel.querySelector("#project-logs-toolbar").classList.remove("hidden");
  backBtn.classList.add("hidden");
  // The list is re-shown rather than rebuilt, so the query and filter survive;
  // the scroll offset is restored from where the user left it.
  listEl.scrollTop = store.get('projectLogsListScroll') || 0;
}

// A preview becomes a real open the moment the user does something with it.
function pinOnInteraction() {
  if (store.get('projectLogsOpen')) return;
  if (!store.get('projectLogsPreview')) return;
  pinFromPreview();
}

function showDetail(entry) {
  if (!panel || !entry) return;
  store.set({ projectLogsListScroll: listEl.scrollTop, projectLogsView: "detail", projectLogsSelectedRef: entry.ref });
  listEl.classList.add("hidden");
  panel.querySelector("#project-logs-toolbar").classList.add("hidden");
  detailEl.classList.remove("hidden");
  detailEl.scrollTop = 0;
  backBtn.classList.remove("hidden");
  renderDetail(detailEl, entry, { onComment: submitComment });
}

// --- Requests ------------------------------------------------------------

function requestList() {
  var requestId = nextRequestId("list-logs");
  store.set({ projectLogsListRequestId: requestId });
  send({
    type: "project_logs_list",
    requestId: requestId,
    query: searchEl ? searchEl.value.trim() : "",
    category: store.get('projectLogsCategory') || "",
  });
}

function requestEntry(ref) {
  var requestId = nextRequestId("read-log");
  store.set({ projectLogsReadRequestId: requestId });
  send({ type: "project_log_read", requestId: requestId, ref: ref });
}

function submitComment(ref, body, statusEl, inputEl) {
  pinOnInteraction();
  var requestId = nextRequestId("comment-log");
  store.set({ projectLogsCommentRequestId: requestId, projectLogsCommentInput: inputEl || null });
  if (!send({ type: "project_log_comment", requestId: requestId, ref: ref, body: body })) {
    statusEl.textContent = "Logs are unavailable while disconnected.";
    return;
  }
  statusEl.textContent = "Posting...";
  store.set({ projectLogsCommentStatusEl: statusEl });
}

function applyFilter(category) {
  pinOnInteraction();
  store.set({ projectLogsCategory: category || "" });
  requestList();
}

// --- Lifecycle -----------------------------------------------------------

export function initProjectLogs() {
  var button = document.getElementById("project-logs-btn");
  if (!button) return;
  button.addEventListener("click", function () {
    if (store.get('projectLogsOpen')) closeProjectLogs();
    else openProjectLogs();
  });
  initProjectLogsAmbient({
    reveal: revealPreview,
    hide: hideRevealedPreview,
    pin: openProjectLogs,
  });
  store.subscribe(function (state, previous) {
    if (state.currentSlug === previous.currentSlug) return;
    closeProjectLogs();
    applyWindowState(false, false);
    // A different project must never inherit the previous project's unread
    // state or animate its updates.
    resetAmbient();
    store.set({
      projectLogsEntries: [],
      projectLogsSelectedRef: null,
      projectLogsView: "list",
      projectLogsCategory: "",
      projectLogsListScroll: 0,
      projectLogsListRequestId: null,
      projectLogsReadRequestId: null,
      projectLogsCommentRequestId: null
    });
  });
}

// The conversation, composer, and title bar stay mounted and visible: Logs
// opens beside them, it does not replace them.
export function openProjectLogs() {
  ensurePanel();
  if (!panel) return;
  closeScheduler();
  closeNotesBrowser();
  hideNotes();
  // Claim the single right workbench slot.
  try { closeFileViewer(); } catch (e) {}
  try { closeTerminal(); } catch (e) {}
  panel.classList.remove("hidden");
  panel.classList.remove("project-logs-previewing");
  applyWindowState(store.get('projectLogsWide'), false);
  var button = document.getElementById("project-logs-btn");
  if (button) button.classList.add("active");
  store.set({ projectLogsOpen: true, projectLogsPinned: true, projectLogsPreview: false });
  // Opening the ledger is the acknowledgement; the ambient cues clear here and
  // nowhere else.
  acknowledgeUpdates();
  showList();
  requestList();
}

export function closeProjectLogs() {
  hidePreview();
  if (!store.get('projectLogsOpen')) return;
  if (panel) {
    panel.classList.add("hidden");
    panel.classList.remove("project-logs-previewing");
  }
  // Fullscreen is always dropped on close so the next open is a bounded pane
  // and never silently hides the conversation.
  applyWindowState(store.get('projectLogsWide'), false);
  var button = document.getElementById("project-logs-btn");
  if (button) button.classList.remove("active");
  store.set({ projectLogsOpen: false, projectLogsPinned: false });
  syncAmbient();
}

// --- Server messages -----------------------------------------------------

export function handleProjectLogsState(msg) {
  if (msg.requestId && msg.requestId !== store.get('projectLogsListRequestId')) return;
  store.set({ projectLogsEntries: msg.entries || [] });
  if (!listEl) return;
  if (filterEl && Array.isArray(msg.categories)) {
    renderFilter(filterEl, msg.categories, store.get('projectLogsCategory'), applyFilter);
  }
  renderList(listEl, msg.entries || [], requestEntry);
  if (store.get('projectLogsView') !== "detail") listEl.scrollTop = store.get('projectLogsListScroll') || 0;
}

export function handleProjectLogEntry(msg) {
  if (msg.requestId && msg.requestId !== store.get('projectLogsReadRequestId')) return;
  if (!msg.entry) return;
  showDetail(msg.entry);
}

export function handleProjectLogCommented(msg) {
  if (msg.requestId && msg.requestId !== store.get('projectLogsCommentRequestId')) return;
  if (!msg.entry) return;
  // The comment is a proposal, not a change, so say so plainly rather than
  // leaving the composer reading "Posting..." forever.
  var pendingStatus = store.get('projectLogsCommentStatusEl');
  if (pendingStatus) pendingStatus.textContent = "Awaiting Project Driver review";
  store.set({ projectLogsCommentStatusEl: null });
  // Re-render the open entry so the new comment and its attribution appear,
  // then refresh the ledger so the comment count is current.
  showDetail(msg.entry);
  requestList();
}

// A canonical revision landed. This marks the ambient cues and never opens,
// focuses, or scrolls anything.
export function handleProjectLogUpdated(msg) {
  noteCanonicalUpdate(msg);
  // Refresh the ledger only when it is already on screen, so the row moves to
  // the top the moment its canonical update arrives.
  if (store.get('projectLogsOpen') && store.get('projectLogsView') !== "detail") requestList();
}

export function handleProjectLogsError(msg) {
  var pending = [
    store.get('projectLogsListRequestId'),
    store.get('projectLogsReadRequestId'),
    store.get('projectLogsCommentRequestId')
  ];
  if (msg.requestId && pending.indexOf(msg.requestId) === -1) return;
  showToast(msg.message || "Project Logs could not complete the request.", "error");
}
