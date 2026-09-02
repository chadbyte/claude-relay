// Project Logs — a dry, project-bound projection of Clay Knowledge.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';
import { showToast } from './utils.js';
import { closeScheduler } from './scheduler.js';
import { closeArchive, hideNotes } from './sticky-notes.js';
// The right workbench slot holds one tool at a time. These two modules reach
// back here through app-messages.js, so the import graph has a cycle; both
// bindings are hoisted function declarations that are only ever called at
// runtime, never during module evaluation, which is the same arrangement
// app-dm.js already relies on for closeFileViewer.
import { closeFileViewer } from './filebrowser.js';
import { closeTerminal } from './terminal.js';

var panel = null;
var listEl = null;
var detailEl = null;
var searchEl = null;
var searchTimer = null;
var requestCounter = 0;
var LOG_KINDS = ["decision", "investigation", "session-note", "runbook", "reference", "incident", "progress"];

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

function actorLabel(entry) {
  var actor = entry && (entry.updatedBy || entry.createdBy || entry.author) || {};
  return actor.displayName || actor.userName || actor.userId || "Unknown author";
}

function formatTime(value) {
  if (!value) return "";
  try { return new Date(value).toLocaleString(); }
  catch (e) { return ""; }
}

// Mounted as a sibling of #app inside #main-panels, exactly like the document
// viewer and the terminal. That is what makes Logs a bounded right-side
// workbench window rather than a surface that replaces the conversation.
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
      '<span class="project-logs-title"><i data-lucide="notebook-tabs"></i>Logs</span>' +
      '<span class="project-logs-subtitle">Project decisions, investigations, and records</span>' +
      '<div class="project-logs-window-actions" aria-label="Project Logs window controls">' +
        '<button id="project-logs-wide" class="project-logs-icon-btn" type="button" title="Widen panel" aria-label="Widen Logs panel" aria-pressed="false"><i data-lucide="chevrons-left-right"></i></button>' +
        '<button id="project-logs-fullscreen" class="project-logs-icon-btn" type="button" title="Toggle fullscreen" aria-label="Toggle Logs fullscreen" aria-pressed="false"><i data-lucide="maximize-2"></i></button>' +
        '<button id="project-logs-close" class="project-logs-icon-btn" type="button" title="Close Logs" aria-label="Close Logs"><i data-lucide="x"></i></button>' +
      '</div>' +
    '</header>' +
    '<div class="project-logs-layout">' +
      '<aside class="project-logs-index" aria-label="Log index">' +
        '<div class="project-logs-index-actions">' +
          '<label class="project-logs-search"><i data-lucide="search"></i><input id="project-logs-search" type="search" placeholder="Search logs" autocomplete="off"></label>' +
          '<button id="project-logs-new" class="project-logs-new" type="button"><i data-lucide="plus"></i>New log</button>' +
        '</div>' +
        '<div id="project-logs-list" class="project-logs-list" role="list"></div>' +
      '</aside>' +
      '<main id="project-logs-detail" class="project-logs-detail"></main>' +
    '</div>';
  panels.appendChild(panel);
  listEl = panel.querySelector("#project-logs-list");
  detailEl = panel.querySelector("#project-logs-detail");
  searchEl = panel.querySelector("#project-logs-search");
  panel.querySelector("#project-logs-close").addEventListener("click", closeProjectLogs);
  panel.querySelector("#project-logs-wide").addEventListener("click", function () {
    applyWindowState(!store.get('projectLogsWide'), store.get('projectLogsFullscreen'));
  });
  panel.querySelector("#project-logs-fullscreen").addEventListener("click", function () {
    applyWindowState(store.get('projectLogsWide'), !store.get('projectLogsFullscreen'));
  });
  panel.querySelector("#project-logs-new").addEventListener("click", function () { renderEditor(null); });
  searchEl.addEventListener("input", function () {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(requestList, 180);
  });
  refreshIcons();
}

// Width and fullscreen are transient view state, so they live in the store like
// every other mutable UI value. `panel-fullscreen` is the shared class the
// document viewer and terminal already use, so the existing rules that hide the
// conversation and the title bar apply without new layout code.
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

function showEmpty(message) {
  if (!detailEl) return;
  detailEl.innerHTML = '<div class="project-logs-empty"><i data-lucide="notebook-tabs"></i><h2>Project Logs</h2><p>' +
    (message || "Keep durable decisions, investigations, runbooks, and progress here. Project sessions can read and add to the same record.") +
    '</p><button type="button" id="project-logs-empty-new">Create the first log</button></div>';
  detailEl.querySelector("#project-logs-empty-new").addEventListener("click", function () { renderEditor(null); });
  refreshIcons();
}

function renderList() {
  if (!listEl) return;
  var entries = store.get('projectLogsEntries') || [];
  var selected = store.get('projectLogsSelectedRef');
  listEl.innerHTML = "";
  if (!entries.length) {
    listEl.innerHTML = '<div class="project-logs-list-empty">No logs found</div>';
    if (!selected) showEmpty();
    return;
  }
  for (var i = 0; i < entries.length; i++) {
    (function (entry) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "project-log-row" + (entry.ref === selected ? " active" : "");
      button.setAttribute("role", "listitem");
      button.innerHTML = '<span class="project-log-row-title"></span><span class="project-log-row-meta"></span>';
      button.querySelector(".project-log-row-title").textContent = entry.title || "Untitled log";
      button.querySelector(".project-log-row-meta").textContent = (entry.kind || "record") + " · v" + (entry.revisions || entry.revision || 1) + " · " + actorLabel(entry);
      button.addEventListener("click", function () { requestEntry(entry.ref); });
      listEl.appendChild(button);
    })(entries[i]);
  }
}

function renderEntry(entry) {
  if (!detailEl || !entry) return;
  detailEl.innerHTML =
    '<article class="project-log-document">' +
      '<header><div><h1></h1><p class="project-log-byline"></p></div><button id="project-log-edit" type="button"><i data-lucide="pencil"></i>Edit</button></header>' +
      '<div class="project-log-markdown md-content"></div>' +
    '</article>';
  detailEl.querySelector("h1").textContent = entry.title || "Untitled log";
  detailEl.querySelector(".project-log-byline").textContent = (entry.kind || "record") + " · Revision " + (entry.revisions || entry.revision || 1) + " · " + actorLabel(entry) + (formatTime(entry.updatedAt || entry.createdAt) ? " · " + formatTime(entry.updatedAt || entry.createdAt) : "");
  var markdown = detailEl.querySelector(".project-log-markdown");
  markdown.innerHTML = renderMarkdown(entry.content || entry.body || "");
  highlightCodeBlocks(markdown);
  detailEl.querySelector("#project-log-edit").addEventListener("click", function () { renderEditor(entry); });
  refreshIcons();
}

function renderEditor(entry) {
  if (!detailEl) return;
  var existing = entry || null;
  detailEl.innerHTML =
    '<form class="project-log-editor">' +
      '<label>Title<input id="project-log-title-input" maxlength="180" required placeholder="Decision or record title"></label>' +
      '<label>Kind<select id="project-log-kind-input"></select></label>' +
      '<label>Record<textarea id="project-log-content-input" rows="18" required placeholder="Write the durable facts, context, and outcome."></textarea></label>' +
      '<p id="project-log-editor-status" class="project-log-editor-status" role="status"></p>' +
      '<div class="project-log-editor-actions"><button id="project-log-cancel" type="button">Cancel</button><button class="primary" type="submit">Save log</button></div>' +
    '</form>';
  var title = detailEl.querySelector("#project-log-title-input");
  var kind = detailEl.querySelector("#project-log-kind-input");
  var content = detailEl.querySelector("#project-log-content-input");
  for (var i = 0; i < LOG_KINDS.length; i++) {
    var option = document.createElement("option");
    option.value = LOG_KINDS[i];
    option.textContent = LOG_KINDS[i].replace("-", " ");
    kind.appendChild(option);
  }
  title.value = existing ? (existing.title || "") : "";
  kind.value = existing ? (existing.kind || "session-note") : "session-note";
  content.value = existing ? (existing.content || existing.body || "") : "";
  detailEl.querySelector("#project-log-cancel").addEventListener("click", function () {
    if (existing) renderEntry(existing); else showEmpty();
  });
  detailEl.querySelector("form").addEventListener("submit", function (event) {
    event.preventDefault();
    var titleValue = title.value.trim();
    var contentValue = content.value.trim();
    var status = detailEl.querySelector("#project-log-editor-status");
    if (!titleValue || !contentValue) { status.textContent = "Title and record are required."; return; }
    var requestId = nextRequestId("save-log");
    store.set({ projectLogsSaveRequestId: requestId });
    var message = { type: existing ? "project_log_update" : "project_log_create", requestId: requestId, kind: kind.value, title: titleValue, body: contentValue };
    if (existing) message.ref = existing.ref;
    if (!send(message)) status.textContent = "Logs are unavailable while disconnected.";
    else status.textContent = "Saving...";
  });
  title.focus({ preventScroll: true });
}

function requestList() {
  var requestId = nextRequestId("list-logs");
  store.set({ projectLogsListRequestId: requestId });
  send({ type: "project_logs_list", requestId: requestId, query: searchEl ? searchEl.value.trim() : "" });
}

function requestEntry(ref) {
  var requestId = nextRequestId("read-log");
  store.set({ projectLogsReadRequestId: requestId, projectLogsSelectedRef: ref });
  renderList();
  send({ type: "project_log_read", requestId: requestId, ref: ref });
}

export function initProjectLogs() {
  var button = document.getElementById("project-logs-btn");
  if (!button) return;
  button.addEventListener("click", function () {
    if (store.get('projectLogsOpen')) closeProjectLogs();
    else openProjectLogs();
  });
  store.subscribe(function (state, previous) {
    if (state.currentSlug === previous.currentSlug) return;
    closeProjectLogs();
    applyWindowState(false, false);
    store.set({
      projectLogsEntries: [],
      projectLogsSelectedRef: null,
      projectLogsListRequestId: null,
      projectLogsReadRequestId: null,
      projectLogsSaveRequestId: null
    });
  });
}

// The conversation, composer, and title bar stay mounted and visible: Logs
// opens beside them, it does not replace them.
export function openProjectLogs() {
  ensurePanel();
  if (!panel) return;
  closeScheduler();
  closeArchive();
  hideNotes();
  // Claim the single right workbench slot. The File Viewer and Terminal
  // buttons already close Logs in the reverse direction, so this completes the
  // pairing rather than letting two panes squeeze the conversation.
  try { closeFileViewer(); } catch (e) {}
  try { closeTerminal(); } catch (e) {}
  panel.classList.remove("hidden");
  applyWindowState(store.get('projectLogsWide'), false);
  var button = document.getElementById("project-logs-btn");
  if (button) button.classList.add("active");
  store.set({ projectLogsOpen: true });
  showEmpty();
  requestList();
}

export function closeProjectLogs() {
  if (!store.get('projectLogsOpen')) return;
  if (panel) panel.classList.add("hidden");
  // Fullscreen is always dropped on close so the next open is a bounded pane
  // and never silently hides the conversation.
  applyWindowState(store.get('projectLogsWide'), false);
  var button = document.getElementById("project-logs-btn");
  if (button) button.classList.remove("active");
  store.set({ projectLogsOpen: false });
}

export function handleProjectLogsState(msg) {
  if (msg.requestId && msg.requestId !== store.get('projectLogsListRequestId')) return;
  store.set({ projectLogsEntries: msg.entries || [] });
  renderList();
}

export function handleProjectLogEntry(msg) {
  if (msg.requestId && msg.requestId !== store.get('projectLogsReadRequestId')) return;
  if (!msg.entry) return;
  store.set({ projectLogsSelectedRef: msg.entry.ref });
  renderList();
  renderEntry(msg.entry);
}

export function handleProjectLogSaved(msg) {
  if (msg.requestId && msg.requestId !== store.get('projectLogsSaveRequestId')) return;
  if (msg.entry) {
    store.set({ projectLogsSelectedRef: msg.entry.ref });
    renderEntry(msg.entry);
  }
  requestList();
}

export function handleProjectLogsError(msg) {
  var pending = [store.get('projectLogsListRequestId'), store.get('projectLogsReadRequestId'), store.get('projectLogsSaveRequestId')];
  if (msg.requestId && pending.indexOf(msg.requestId) === -1) return;
  showToast(msg.message || "Project Logs could not complete the request.", "error");
}
