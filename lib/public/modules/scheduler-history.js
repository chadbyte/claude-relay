/**
 * Scheduler history module — Run history rendering and schedule event handlers.
 *
 * Extracted from scheduler.js to keep module sizes manageable.
 */

import { renderMarkdown } from './markdown.js';

var histCtx = null;

// --- Init ---

export function initSchedulerHistory(_histCtx) {
  histCtx = _histCtx;
}

// --- History rendering ---

export function renderHistory(runs) {
  var el = document.getElementById("sched-history");
  if (!el || !runs || runs.length === 0) { if (el) el.innerHTML = '<div class="sched-history-empty">No runs yet</div>'; return; }
  var html = "";
  var sorted = runs.slice().reverse();
  for (var i = 0; i < sorted.length; i++) {
    var run = sorted[i];
    html += '<div class="sched-history-item"><span class="sched-history-dot ' + (run.result || "") + '"></span>';
    html += '<span class="sched-history-date">' + histCtx.formatDateTime(new Date(run.startedAt)) + '</span>';
    html += '<span class="sched-history-result">' + (run.result || "?") + '</span>';
    html += '<span class="sched-history-iterations">' + (run.iterations || 0) + ' iter</span></div>';
  }
  el.innerHTML = html;
}

// --- Message handlers ---

export function handleLoopRegistryUpdated(msg) {
  histCtx.setRecords(msg.records || []);
  if (histCtx.isPanelOpen()) {
    histCtx.renderSidebar();
    var mode = histCtx.getCurrentMode();
    if (mode === "calendar") histCtx.render();
    else if (mode === "detail") histCtx.renderDetail();
  }
}

// Cache last-received file content for edit mode
export var _lastFiles = { id: null, prompt: "", judge: "", settings: null };

export function handleLoopRegistryFiles(msg) {
  if (!histCtx.isPanelOpen() || histCtx.getCurrentMode() !== "detail") return;
  if (msg.id !== histCtx.getSelectedTaskId()) return;
  _lastFiles = { id: msg.id, prompt: msg.prompt || "", judge: msg.judge || "", settings: msg.settings || null };
  var bodyEl = document.getElementById("scheduler-detail-body");
  if (!bodyEl) return;
  var contentDetailEl = histCtx.getContentDetailEl();
  var activeTab = contentDetailEl ? contentDetailEl.querySelector(".scheduler-detail-tab.active") : null;
  var tab = activeTab ? activeTab.dataset.tab : "prompt";
  var content = tab === "prompt" ? _lastFiles.prompt : _lastFiles.judge;
  var fileLabel = tab === "prompt" ? "PROMPT.md" : "JUDGE.md";
  renderFileView(bodyEl, tab, content, fileLabel, msg.id);
  // Disable "Run now" if PROMPT.md is missing
  var runBtn = contentDetailEl ? contentDetailEl.querySelector('[data-action="run"]') : null;
  if (runBtn) {
    var filesReady = !!msg.prompt;
    runBtn.disabled = !filesReady;
    runBtn.title = filesReady ? "Run now" : "PROMPT.md is required to run";
  }
}

function renderFileView(bodyEl, tab, content, fileLabel, recId) {
  if (content) {
    bodyEl.innerHTML = '<div class="scheduler-file-toolbar"><button class="scheduler-file-edit-btn" title="Edit"><i data-lucide="pencil"></i> Edit</button></div>' +
      '<div class="md-content">' + renderMarkdown(content) + '</div>';
  } else {
    bodyEl.innerHTML = '<div class="scheduler-file-toolbar"><button class="scheduler-file-edit-btn" title="Edit"><i data-lucide="pencil"></i> Edit</button></div>' +
      '<div class="scheduler-empty">No ' + fileLabel + ' found</div>';
  }
  if (typeof lucide !== "undefined") lucide.createIcons({ attrs: { class: "lucide" } });
  var editBtn = bodyEl.querySelector(".scheduler-file-edit-btn");
  if (editBtn) {
    editBtn.addEventListener("click", function () {
      renderFileEdit(bodyEl, tab, content, recId);
    });
  }
}

function renderFileEdit(bodyEl, tab, content, recId) {
  bodyEl.innerHTML = '<div class="scheduler-file-toolbar">' +
    '<button class="scheduler-file-save-btn" title="Save"><i data-lucide="check"></i> Save</button>' +
    '<button class="scheduler-file-cancel-btn" title="Cancel"><i data-lucide="x"></i> Cancel</button>' +
    '</div>' +
    '<textarea class="scheduler-file-editor">' + escapeHtml(content) + '</textarea>';
  if (typeof lucide !== "undefined") lucide.createIcons({ attrs: { class: "lucide" } });
  var ta = bodyEl.querySelector(".scheduler-file-editor");
  if (ta) ta.focus();
  var saveBtn = bodyEl.querySelector(".scheduler-file-save-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      var newContent = ta.value;
      var data = { type: "loop_registry_save_files", id: recId };
      if (tab === "prompt") data.prompt = newContent;
      else data.judge = newContent;
      histCtx.send(data);
    });
  }
  var cancelBtn = bodyEl.querySelector(".scheduler-file-cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function () {
      var fileLabel = tab === "prompt" ? "PROMPT.md" : "JUDGE.md";
      renderFileView(bodyEl, tab, _lastFiles[tab], fileLabel, recId);
    });
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function handleScheduleRunStarted(msg) {
  if (histCtx.isPanelOpen()) histCtx.render();
}

export function handleScheduleRunFinished(msg) {
  histCtx.send({ type: "loop_registry_list" });
}

export function handleLoopScheduled(msg) {
  // A loop was just registered as scheduled (from approval bar)
  histCtx.send({ type: "loop_registry_list" });
}
