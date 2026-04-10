// app-loop-ui.js - Ralph Loop UI, wizard, crafting/approval bars, preview modal
// Extracted from app.js (PR-31)

import { refreshIcons, iconHtml } from './icons.js';
import { escapeHtml } from './utils.js';

var _ctx = null;

// --- Module-owned state ---
var loopActive = false;
var loopAvailable = false;
var loopIteration = 0;
var loopMaxIterations = 0;
var loopBannerName = null;
var ralphPhase = "idle"; // idle | wizard | crafting | approval | executing | done
var ralphCraftingSessionId = null;
var ralphCraftingSource = null; // "ralph" or null (task)
var wizardStep = 1;
var wizardSource = "ralph"; // "ralph" or "task"
var wizardData = { name: "", task: "", maxIterations: 3, cron: null };
var ralphFilesReady = { promptReady: false, judgeReady: false, bothReady: false };
var ralphPreviewContent = { prompt: "", judge: "" };
var wizardMode = "draft"; // "draft" or "own"

// --- Getters / Setters ---
export function getLoopActive() { return loopActive; }
export function setLoopActive(v) { loopActive = v; }

export function getLoopAvailable() { return loopAvailable; }
export function setLoopAvailable(v) { loopAvailable = v; }

export function getLoopIteration() { return loopIteration; }
export function setLoopIteration(v) { loopIteration = v; }

export function getLoopMaxIterations() { return loopMaxIterations; }
export function setLoopMaxIterations(v) { loopMaxIterations = v; }

export function getLoopBannerName() { return loopBannerName; }
export function setLoopBannerName(v) { loopBannerName = v; }

export function getRalphPhase() { return ralphPhase; }
export function setRalphPhase(v) { ralphPhase = v; }

export function getRalphCraftingSessionId() { return ralphCraftingSessionId; }
export function setRalphCraftingSessionId(v) { ralphCraftingSessionId = v; }

export function getRalphCraftingSource() { return ralphCraftingSource; }
export function setRalphCraftingSource(v) { ralphCraftingSource = v; }

export function getRalphFilesReady() { return ralphFilesReady; }
export function setRalphFilesReady(v) { ralphFilesReady = v; }

export function getRalphPreviewContent() { return ralphPreviewContent; }
export function setRalphPreviewContent(v) { ralphPreviewContent = v; }

export function getWizardData() { return wizardData; }
export function setWizardData(v) { wizardData = v; }

// --- DOM refs for repeat picker (captured in init) ---
var repeatSelect = null;
var repeatTimeRow = null;
var repeatCustom = null;
var repeatUnitSelect = null;
var repeatDowRow = null;
var cronPreview = null;

// ========================================================
// Init
// ========================================================
export function initLoopUi(ctx) {
  _ctx = ctx;

  // Repeat picker DOM refs
  repeatSelect = document.getElementById("ralph-repeat");
  repeatTimeRow = document.getElementById("ralph-time-row");
  repeatCustom = document.getElementById("ralph-custom-repeat");
  repeatUnitSelect = document.getElementById("ralph-repeat-unit");
  repeatDowRow = document.getElementById("ralph-custom-dow-row");
  cronPreview = document.getElementById("ralph-cron-preview");

  // --- Wizard button listeners ---
  var wizardCloseBtn = document.getElementById("ralph-wizard-close");
  var wizardBackdrop = document.querySelector(".ralph-wizard-backdrop");
  var wizardBackBtn = document.getElementById("ralph-wizard-back");
  var wizardSkipBtn = document.getElementById("ralph-wizard-skip");
  var wizardNextBtn = document.getElementById("ralph-wizard-next");

  if (wizardCloseBtn) wizardCloseBtn.addEventListener("click", closeRalphWizard);
  if (wizardBackdrop) wizardBackdrop.addEventListener("click", closeRalphWizard);
  if (wizardBackBtn) wizardBackBtn.addEventListener("click", wizardBack);
  if (wizardSkipBtn) wizardSkipBtn.addEventListener("click", wizardSkip);
  if (wizardNextBtn) wizardNextBtn.addEventListener("click", wizardNext);

  // --- Mode tab switching ---
  var modeTabs = document.querySelectorAll(".ralph-mode-tab");
  for (var mt = 0; mt < modeTabs.length; mt++) {
    modeTabs[mt].addEventListener("click", function () {
      wizardMode = this.getAttribute("data-mode");
      updateWizardModeTabs();
    });
  }

  // --- Repeat picker handlers ---
  if (repeatSelect) {
    repeatSelect.addEventListener("change", updateRepeatUI);
  }
  if (repeatUnitSelect) {
    repeatUnitSelect.addEventListener("change", function () {
      if (repeatDowRow) repeatDowRow.style.display = this.value === "week" ? "" : "none";
      updateRepeatUI();
    });
  }

  var timeInput = document.getElementById("ralph-time");
  if (timeInput) timeInput.addEventListener("change", updateRepeatUI);

  // DOW buttons in custom repeat
  var customDowBtns = document.querySelectorAll("#ralph-custom-repeat .sched-dow-btn");
  for (var di = 0; di < customDowBtns.length; di++) {
    customDowBtns[di].addEventListener("click", function () {
      this.classList.toggle("active");
      updateRepeatUI();
    });
  }

  // --- Preview modal listeners ---
  var previewBackdrop = document.querySelector("#ralph-preview-modal .confirm-backdrop");
  if (previewBackdrop) previewBackdrop.addEventListener("click", closeRalphPreviewModal);

  // Run now button in preview modal
  var previewRunBtn = document.getElementById("ralph-preview-run");
  if (previewRunBtn) {
    previewRunBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeRalphPreviewModal();
      // Trigger the same flow as the sticky start button
      var stickyStart = document.querySelector(".ralph-sticky-start");
      if (stickyStart) {
        stickyStart.click();
      }
    });
  }

  // Delete/cancel button in preview modal
  var previewDeleteBtn = document.getElementById("ralph-preview-delete");
  if (previewDeleteBtn) {
    previewDeleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeRalphPreviewModal();
      // Trigger the same flow as the sticky dismiss button
      var stickyDismiss = document.querySelector(".ralph-sticky-dismiss");
      if (stickyDismiss) {
        stickyDismiss.click();
      }
    });
  }

  var previewTabs = document.querySelectorAll(".ralph-tab");
  for (var ti = 0; ti < previewTabs.length; ti++) {
    previewTabs[ti].addEventListener("click", function() {
      showRalphPreviewTab(this.getAttribute("data-tab"));
    });
  }
}

// ========================================================
// Loop UI (exported)
// ========================================================

export function updateLoopInputVisibility(loop) {
  var inputArea = document.getElementById("input-area");
  if (!inputArea) return;
  if (loop && loop.active && loop.role !== "crafting") {
    inputArea.style.display = "none";
  } else {
    inputArea.style.display = "";
  }
}

export function updateLoopButton() {
  var section = document.getElementById("ralph-loop-section");
  if (!section) return;

  var busy = loopActive || ralphPhase === "executing";
  var phase = busy ? "executing" : ralphPhase;

  var statusHtml = "";
  var statusClass = "";
  var clickAction = "wizard"; // default

  if (phase === "crafting") {
    statusHtml = '<span class="ralph-section-status crafting">' + iconHtml("loader", "icon-spin") + ' Crafting\u2026</span>';
    clickAction = "none";
  } else if (phase === "approval") {
    statusHtml = '<span class="ralph-section-status ready">Ready</span>';
    statusClass = "ralph-section-ready";
    clickAction = "none";
  } else if (phase === "executing") {
    var iterText = loopIteration > 0 ? "Running \u00b7 iteration " + loopIteration + "/" + loopMaxIterations : "Starting\u2026";
    statusHtml = '<span class="ralph-section-status running">' + iconHtml("loader", "icon-spin") + ' ' + iterText + '</span>';
    statusClass = "ralph-section-running";
    clickAction = "popover";
  } else if (phase === "done") {
    statusHtml = '<span class="ralph-section-status done">\u2713 Done</span>';
    statusHtml += '<a href="#" class="ralph-section-tasks-link">View in Scheduled Tasks</a>';
    statusClass = "ralph-section-done";
    clickAction = "wizard";
  } else {
    // idle
    statusHtml = '<span class="ralph-section-hint">Start a new loop</span>';
  }

  section.className = "ralph-loop-section" + (statusClass ? " " + statusClass : "");
  section.innerHTML =
    '<div class="ralph-section-inner">' +
      '<div class="ralph-section-header">' +
        '<span class="ralph-section-icon">' + iconHtml("repeat") + '</span>' +
        '<span class="ralph-section-label">Ralph Loop</span>' +
        '<span class="loop-experimental"><i data-lucide="flask-conical"></i> experimental</span>' +
      '</div>' +
      '<div class="ralph-section-body">' + statusHtml + '</div>' +
    '</div>';

  refreshIcons();

  // Click handler on header
  var header = section.querySelector(".ralph-section-header");
  if (header) {
    header.style.cursor = clickAction === "none" ? "default" : "pointer";
    header.addEventListener("click", function() {
      if (clickAction === "popover") {
        toggleLoopPopover();
      } else if (clickAction === "wizard") {
        openRalphWizard();
      }
    });
  }

  // "View in Scheduled Tasks" link
  var tasksLink = section.querySelector(".ralph-section-tasks-link");
  if (tasksLink) {
    tasksLink.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      _ctx.openSchedulerToTab("library");
    });
  }
}

export function showLoopBanner(show) {
  var stickyEl = document.getElementById("ralph-sticky");
  if (!stickyEl) { updateLoopButton(); return; }
  if (!show) {
    stickyEl.classList.add("hidden");
    stickyEl.classList.remove("ralph-running");
    stickyEl.innerHTML = "";
    updateLoopButton();
    return;
  }

  var ws = _ctx.getWs();
  var bannerLabel = loopBannerName || "Loop";
  stickyEl.innerHTML =
    '<div class="ralph-sticky-inner">' +
      '<div class="ralph-sticky-header">' +
        '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
        '<span class="ralph-sticky-label">' + escapeHtml(bannerLabel) + '</span>' +
        '<span class="ralph-sticky-status" id="loop-status">Starting\u2026</span>' +
        '<button class="ralph-sticky-action ralph-sticky-stop" title="Stop loop">' + iconHtml("square") + '</button>' +
      '</div>' +
    '</div>';
  stickyEl.classList.remove("hidden", "ralph-ready");
  stickyEl.classList.add("ralph-running");
  refreshIcons();

  stickyEl.querySelector(".ralph-sticky-stop").addEventListener("click", function(e) {
    e.stopPropagation();
    var w = _ctx.getWs();
    if (w && w.readyState === 1) {
      w.send(JSON.stringify({ type: "loop_stop" }));
    }
  });
  updateLoopButton();
}

export function updateLoopBanner(iteration, maxIterations, phase) {
  var statusEl = document.getElementById("loop-status");
  if (!statusEl) return;
  var text;
  if (phase === "stopping") {
    text = "Stopping\u2026";
  } else if (maxIterations <= 1) {
    text = phase === "judging" ? "judging\u2026" : "running";
  } else {
    text = "#" + iteration + "/" + maxIterations;
    if (phase === "judging") text += " judging\u2026";
    else text += " running";
  }
  statusEl.textContent = text;
}

export function updateRalphBars() {
  // Task source uses the scheduler panel, not the sticky bar
  var isTaskSource = ralphCraftingSource !== "ralph";
  var onCraftingSession = ralphCraftingSessionId && _ctx.activeSessionId === ralphCraftingSessionId;
  // If approval phase but no craftingSessionId (recovered after server restart), show bar anyway
  var recoveredApproval = ralphPhase === "approval" && !ralphCraftingSessionId;
  if (!isTaskSource && ralphPhase === "crafting" && onCraftingSession) {
    showRalphCraftingBar(true);
  } else {
    showRalphCraftingBar(false);
  }
  if (!isTaskSource && ralphPhase === "approval" && (onCraftingSession || recoveredApproval)) {
    showRalphApprovalBar(true);
  } else {
    showRalphApprovalBar(false);
  }
  // Restore running loop banner on session switch
  if (loopActive && ralphPhase === "executing") {
    showLoopBanner(true);
    if (loopIteration > 0) {
      updateLoopBanner(loopIteration, loopMaxIterations, "running");
    }
  }

  // Restore debate sticky on session switch
  var debateStickyState = _ctx.debateStickyState;
  if (debateStickyState && debateStickyState.phase) {
    _ctx.showDebateSticky(debateStickyState.phase, debateStickyState.msg);
  } else {
    _ctx.showDebateSticky("hide", null);
  }
}

// ========================================================
// Internal: toggleLoopPopover
// ========================================================

function toggleLoopPopover() {
  var existing = document.getElementById("loop-status-modal");
  if (existing) {
    existing.remove();
    return;
  }

  var ws = _ctx.getWs();
  var taskPreview = wizardData.task || "\u2014";
  if (taskPreview.length > 120) taskPreview = taskPreview.substring(0, 120) + "\u2026";
  var statusText = "Iteration #" + loopIteration + " / " + loopMaxIterations;

  var modal = document.createElement("div");
  modal.id = "loop-status-modal";
  modal.className = "loop-status-modal";
  modal.innerHTML =
    '<div class="loop-status-backdrop"></div>' +
    '<div class="loop-status-dialog">' +
      '<div class="loop-status-dialog-header">' +
        '<span class="loop-status-dialog-icon">' + iconHtml("repeat") + '</span>' +
        '<span class="loop-status-dialog-title">Ralph Loop</span>' +
        '<button class="loop-status-dialog-close" title="Close">' + iconHtml("x") + '</button>' +
      '</div>' +
      '<div class="loop-status-dialog-body">' +
        '<div class="loop-status-dialog-row">' +
          '<span class="loop-status-dialog-label">Progress</span>' +
          '<span class="loop-status-dialog-value">' + escapeHtml(statusText) + '</span>' +
        '</div>' +
        '<div class="loop-status-dialog-row">' +
          '<span class="loop-status-dialog-label">Task</span>' +
          '<span class="loop-status-dialog-value loop-status-dialog-task">' + escapeHtml(taskPreview) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="loop-status-dialog-footer">' +
        '<button class="loop-status-dialog-stop">' + iconHtml("square") + ' Stop loop</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
  refreshIcons();

  function closeModal() { modal.remove(); }

  modal.querySelector(".loop-status-backdrop").addEventListener("click", closeModal);
  modal.querySelector(".loop-status-dialog-close").addEventListener("click", closeModal);

  modal.querySelector(".loop-status-dialog-stop").addEventListener("click", function(e) {
    e.stopPropagation();
    closeModal();
    _ctx.showConfirm("Stop the running " + (loopBannerName || "loop") + "?", function() {
      var w = _ctx.getWs();
      if (w && w.readyState === 1) {
        w.send(JSON.stringify({ type: "loop_stop" }));
      }
    });
  });
}

// ========================================================
// Internal: requireClayRalph
// ========================================================

function requireClayRalph(cb) {
  _ctx.requireSkills({
    title: "Skill Installation Required",
    reason: "This feature requires the following skill to be installed.",
    skills: [{ name: "clay-ralph", url: "https://github.com/chadbyte/clay-ralph", scope: "global" }]
  }, cb);
}

// ========================================================
// Ralph Wizard (exported: openRalphWizard, closeRalphWizard)
// ========================================================

export function openRalphWizard(source) {
  requireClayRalph(function () {
    wizardSource = source || "ralph";
    wizardData = { name: "", task: "", maxIterations: 3 };
    var el = document.getElementById("ralph-wizard");
    if (!el) return;

    var taskEl = document.getElementById("ralph-task");
    if (taskEl) taskEl.value = "";
    var promptInput = document.getElementById("ralph-prompt-input");
    if (promptInput) promptInput.value = "";
    var judgeInput = document.getElementById("ralph-judge-input");
    if (judgeInput) judgeInput.value = "";
    var iterEl = document.getElementById("ralph-max-iterations");
    if (iterEl) iterEl.value = "25";

    // Update text based on source
    var isTask = wizardSource === "task";
    var headerSpan = el.querySelector(".ralph-wizard-header > span");
    if (headerSpan) headerSpan.textContent = isTask ? "New Task" : "New Ralph Loop";

    var step2heading = el.querySelector('.ralph-step[data-step="2"] h3');
    if (step2heading) step2heading.textContent = isTask ? "Describe your task" : "What do you want to build?";

    var draftHint = el.querySelector('.ralph-mode-panel[data-mode="draft"] .ralph-hint');
    if (draftHint) draftHint.textContent = isTask
      ? "Describe what you want done. Clay will craft a precise prompt and you can review it before scheduling."
      : "Write a rough idea, Clay will refine it into detailed instructions. You can review and edit everything before the loop starts.";

    var ownHint = el.querySelector('.ralph-mode-panel[data-mode="own"] .ralph-hint');
    if (ownHint) ownHint.textContent = isTask
      ? "Paste the prompt to run. It will execute as-is when triggered."
      : "Paste your PROMPT.md content. JUDGE.md is optional; if omitted, Clay will generate it for you.";

    // Update task description placeholder
    if (taskEl) taskEl.placeholder = isTask
      ? "e.g. Check for dependency updates and create a summary"
      : "e.g. Add dark mode toggle to the settings page";

    wizardMode = "draft";
    updateWizardModeTabs();

    if (wizardSource === "task") {
      // Tasks skip step 1 (Ralph intro), go directly to step 2
      wizardStep = 2;
    } else {
      wizardStep = 1;
    }
    el.classList.remove("hidden");
    var statusEl = document.getElementById("ralph-install-status");
    if (statusEl) { statusEl.classList.add("hidden"); statusEl.innerHTML = ""; }
    updateWizardStep();
  });
}

export function closeRalphWizard() {
  var el = document.getElementById("ralph-wizard");
  if (el) el.classList.add("hidden");
}

// --- Internal wizard helpers ---

function updateWizardModeTabs() {
  var tabs = document.querySelectorAll(".ralph-mode-tab");
  var panels = document.querySelectorAll(".ralph-mode-panel");
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute("data-mode") === wizardMode) {
      tabs[i].classList.add("active");
    } else {
      tabs[i].classList.remove("active");
    }
  }
  for (var j = 0; j < panels.length; j++) {
    if (panels[j].getAttribute("data-mode") === wizardMode) {
      panels[j].classList.add("active");
    } else {
      panels[j].classList.remove("active");
    }
  }
}

function updateWizardStep() {
  var steps = document.querySelectorAll(".ralph-step");
  for (var i = 0; i < steps.length; i++) {
    var stepNum = parseInt(steps[i].getAttribute("data-step"), 10);
    if (stepNum === wizardStep) {
      steps[i].classList.add("active");
    } else {
      steps[i].classList.remove("active");
    }
  }
  var dots = document.querySelectorAll(".ralph-dot");
  for (var j = 0; j < dots.length; j++) {
    var dotStep = parseInt(dots[j].getAttribute("data-step"), 10);
    dots[j].classList.remove("active", "done");
    if (dotStep === wizardStep) dots[j].classList.add("active");
    else if (dotStep < wizardStep) dots[j].classList.add("done");
  }

  var backBtn = document.getElementById("ralph-wizard-back");
  var skipBtn = document.getElementById("ralph-wizard-skip");
  var nextBtn = document.getElementById("ralph-wizard-next");
  if (backBtn) {
    backBtn.style.visibility = (wizardStep === 1 && wizardSource !== "task") ? "hidden" : "visible";
    backBtn.textContent = (wizardSource === "task" && wizardStep <= 2) ? "Cancel" : "Back";
  }
  if (skipBtn) skipBtn.style.display = "none";
  if (nextBtn) nextBtn.textContent = wizardStep === 2 ? "Launch" : "Get Started";
}

function collectWizardData() {
  var iterEl = document.getElementById("ralph-max-iterations");
  wizardData.name = "";
  wizardData.maxIterations = iterEl ? parseInt(iterEl.value, 10) || 3 : 3;
  wizardData.cron = null;
  wizardData.mode = wizardMode;

  if (wizardMode === "draft") {
    var taskEl = document.getElementById("ralph-task");
    wizardData.task = taskEl ? taskEl.value.trim() : "";
    wizardData.promptText = null;
    wizardData.judgeText = null;
  } else {
    var promptInput = document.getElementById("ralph-prompt-input");
    var judgeInput = document.getElementById("ralph-judge-input");
    wizardData.task = "";
    wizardData.promptText = promptInput ? promptInput.value.trim() : "";
    wizardData.judgeText = judgeInput ? judgeInput.value.trim() : "";
  }
}

function buildWizardCron() {
  if (!repeatSelect) return null;
  var preset = repeatSelect.value;
  if (preset === "none") return null;

  var timeEl = document.getElementById("ralph-time");
  var timeVal = timeEl ? timeEl.value : "09:00";
  var timeParts = timeVal.split(":");
  var hour = parseInt(timeParts[0], 10) || 9;
  var minute = parseInt(timeParts[1], 10) || 0;

  if (preset === "daily") return minute + " " + hour + " * * *";
  if (preset === "weekdays") return minute + " " + hour + " * * 1-5";
  if (preset === "weekly") return minute + " " + hour + " * * " + new Date().getDay();
  if (preset === "monthly") return minute + " " + hour + " " + new Date().getDate() + " * *";

  if (preset === "custom") {
    var unitEl = document.getElementById("ralph-repeat-unit");
    var unit = unitEl ? unitEl.value : "day";
    if (unit === "day") return minute + " " + hour + " * * *";
    if (unit === "month") return minute + " " + hour + " " + new Date().getDate() + " * *";
    // week: collect selected days
    var dowBtns = document.querySelectorAll("#ralph-custom-repeat .sched-dow-btn.active");
    var days = [];
    for (var i = 0; i < dowBtns.length; i++) {
      days.push(dowBtns[i].dataset.dow);
    }
    if (days.length === 0) days.push(String(new Date().getDay()));
    return minute + " " + hour + " * * " + days.join(",");
  }
  return null;
}

function cronToHumanText(cron) {
  if (!cron) return "";
  var parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  var m = parts[0], h = parts[1], dom = parts[2], dow = parts[4];
  var pad = function(n) { return (parseInt(n,10) < 10 ? "0" : "") + parseInt(n,10); };
  var t = pad(h) + ":" + pad(m);
  var dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  if (dow === "*" && dom === "*") return "Every day at " + t;
  if (dow === "1-5" && dom === "*") return "Weekdays at " + t;
  if (dom !== "*" && dow === "*") return "Monthly on day " + dom + " at " + t;
  if (dow !== "*" && dom === "*") {
    var ds = dow.split(",").map(function(d) { return dayNames[parseInt(d,10)] || d; });
    return "Every " + ds.join(", ") + " at " + t;
  }
  return cron;
}

function wizardNext() {
  collectWizardData();

  if (wizardStep === 1) {
    wizardStep++;
    updateWizardStep();
    return;
  }

  if (wizardStep === 2) {
    if (wizardMode === "draft") {
      var taskEl = document.getElementById("ralph-task");
      if (!wizardData.task) {
        if (taskEl) { taskEl.focus(); taskEl.style.borderColor = "#e74c3c"; setTimeout(function() { taskEl.style.borderColor = ""; }, 2000); }
        return;
      }
    } else {
      var promptInput = document.getElementById("ralph-prompt-input");
      if (!wizardData.promptText) {
        if (promptInput) { promptInput.focus(); promptInput.style.borderColor = "#e74c3c"; setTimeout(function() { promptInput.style.borderColor = ""; }, 2000); }
        return;
      }
    }
    wizardSubmit();
    return;
  }
  wizardStep++;
  updateWizardStep();
}

function wizardBack() {
  if (wizardSource === "task" && wizardStep <= 2) {
    closeRalphWizard();
    return;
  }
  if (wizardStep > 1) {
    collectWizardData();
    wizardStep--;
    updateWizardStep();
  }
}

function wizardSkip() {
  if (wizardStep < 2) {
    wizardStep++;
    updateWizardStep();
  }
}

function wizardSubmit() {
  collectWizardData();
  wizardData.source = wizardSource === "task" ? "task" : undefined;
  closeRalphWizard();
  var ws = _ctx.getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "ralph_wizard_complete", data: wizardData }));
  }
}

function updateRepeatUI() {
  if (!repeatSelect) return;
  var val = repeatSelect.value;
  var isScheduled = val !== "none";
  if (repeatTimeRow) repeatTimeRow.style.display = isScheduled ? "" : "none";
  if (repeatCustom) repeatCustom.style.display = val === "custom" ? "" : "none";
  if (cronPreview) cronPreview.style.display = isScheduled ? "" : "none";
  if (isScheduled) {
    var cron = buildWizardCron();
    var humanEl = document.getElementById("ralph-cron-human");
    var cronEl = document.getElementById("ralph-cron-expr");
    if (humanEl) humanEl.textContent = cronToHumanText(cron);
    if (cronEl) cronEl.textContent = cron || "";
  }
}

// ========================================================
// Crafting / Approval bars (exported)
// ========================================================

export function showRalphCraftingBar(show) {
  var stickyEl = document.getElementById("ralph-sticky");
  if (!stickyEl) return;
  if (!show) {
    stickyEl.classList.add("hidden");
    stickyEl.innerHTML = "";
    return;
  }
  stickyEl.innerHTML =
    '<div class="ralph-sticky-inner">' +
      '<div class="ralph-sticky-header">' +
        '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
        '<span class="ralph-sticky-label">Ralph</span>' +
        '<span class="ralph-sticky-status">' + iconHtml("loader", "icon-spin") + ' Preparing\u2026</span>' +
        '<button class="ralph-sticky-cancel" title="Cancel">' + iconHtml("x") + '</button>' +
      '</div>' +
    '</div>';
  stickyEl.classList.remove("hidden");
  refreshIcons();

  var cancelBtn = stickyEl.querySelector(".ralph-sticky-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      var ws = _ctx.getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "ralph_cancel_crafting" }));
      }
      showRalphCraftingBar(false);
      showRalphApprovalBar(false);
    });
  }
}

export function showRalphApprovalBar(show) {
  var stickyEl = document.getElementById("ralph-sticky");
  if (!stickyEl) return;
  if (!show) {
    // Only clear if we're in approval mode (don't clobber crafting)
    if (ralphPhase !== "crafting") {
      stickyEl.classList.add("hidden");
      stickyEl.innerHTML = "";
    }
    return;
  }

  var basePath = _ctx.basePath;
  stickyEl.innerHTML =
    '<div class="ralph-sticky-inner">' +
      '<div class="ralph-sticky-header" id="ralph-sticky-header">' +
        '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
        '<span class="ralph-sticky-label">Ralph</span>' +
        '<span class="ralph-sticky-status" id="ralph-sticky-status">Ready</span>' +
        '<button class="ralph-sticky-action ralph-sticky-preview" title="Preview files">' + iconHtml("eye") + '</button>' +
        '<button class="ralph-sticky-action ralph-sticky-start" title="' + (wizardData.cron ? 'Schedule' : 'Start loop') + '">' + iconHtml(wizardData.cron ? "calendar-clock" : "play") + '</button>' +
        '<button class="ralph-sticky-action ralph-sticky-dismiss" title="Cancel and discard">' + iconHtml("x") + '</button>' +
      '</div>' +
    '</div>';
  stickyEl.classList.remove("hidden");
  refreshIcons();

  stickyEl.querySelector(".ralph-sticky-preview").addEventListener("click", function(e) {
    e.stopPropagation();
    var ws = _ctx.getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ralph_preview_files" }));
    }
  });

  stickyEl.querySelector(".ralph-sticky-start").addEventListener("click", function(e) {
    e.stopPropagation();
    // Check for uncommitted changes before starting
    fetch(basePath + "api/git-dirty")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.dirty) {
          _ctx.showConfirm("You have uncommitted changes. Ralph Loop uses git diff to track progress \u2014 uncommitted files may cause unexpected results.\n\nStart anyway?", function () {
            var ws = _ctx.getWs();
            if (ws && ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "loop_start" }));
            }
            stickyEl.classList.add("hidden");
            stickyEl.innerHTML = "";
          });
        } else {
          var ws = _ctx.getWs();
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "loop_start" }));
          }
          stickyEl.classList.add("hidden");
          stickyEl.innerHTML = "";
        }
      })
      .catch(function () {
        // If check fails, just start
        var ws = _ctx.getWs();
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "loop_start" }));
        }
        stickyEl.classList.add("hidden");
        stickyEl.innerHTML = "";
      });
  });

  stickyEl.querySelector(".ralph-sticky-dismiss").addEventListener("click", function(e) {
    e.stopPropagation();
    _ctx.showConfirm("Discard this Ralph Loop setup?", function() {
      var ws = _ctx.getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "ralph_wizard_cancel" }));
      }
      stickyEl.classList.add("hidden");
      stickyEl.classList.remove("ralph-ready");
      stickyEl.innerHTML = "";
    });
  });

  updateRalphApprovalStatus();
}

export function updateRalphApprovalStatus() {
  var stickyEl = document.getElementById("ralph-sticky");
  var statusEl = document.getElementById("ralph-sticky-status");
  var startBtn = document.querySelector(".ralph-sticky-start");
  if (!statusEl) return;

  if (ralphFilesReady.bothReady) {
    statusEl.textContent = "Ready";
    if (startBtn) startBtn.disabled = false;
    if (stickyEl) stickyEl.classList.add("ralph-ready");
  } else if (ralphFilesReady.promptReady || ralphFilesReady.judgeReady) {
    statusEl.textContent = "Partial\u2026";
    if (startBtn) startBtn.disabled = true;
    if (stickyEl) stickyEl.classList.remove("ralph-ready");
  } else {
    statusEl.textContent = "Waiting\u2026";
    if (startBtn) startBtn.disabled = true;
    if (stickyEl) stickyEl.classList.remove("ralph-ready");
  }
}

// ========================================================
// Preview modal (exported: openRalphPreviewModal)
// ========================================================

export function openRalphPreviewModal() {
  var modal = document.getElementById("ralph-preview-modal");
  if (!modal) return;
  modal.classList.remove("hidden");

  // Set name from wizard data
  var nameEl = document.getElementById("ralph-preview-name");
  if (nameEl) {
    var name = (wizardData && wizardData.name) || "Ralph Loop";
    nameEl.textContent = name;
  }

  // Update run button label based on cron
  var runBtn = document.getElementById("ralph-preview-run");
  if (runBtn) {
    var hasCron = wizardData && wizardData.cron;
    runBtn.innerHTML = iconHtml(hasCron ? "calendar-clock" : "play") + " " + (hasCron ? "Schedule" : "Run now");
    runBtn.disabled = !(ralphFilesReady && ralphFilesReady.bothReady);
  }

  showRalphPreviewTab("prompt");
  refreshIcons();
}

function closeRalphPreviewModal() {
  var modal = document.getElementById("ralph-preview-modal");
  if (modal) modal.classList.add("hidden");
}

function showRalphPreviewTab(tab) {
  var tabs = document.querySelectorAll("#ralph-preview-modal .ralph-tab");
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute("data-tab") === tab) {
      tabs[i].classList.add("active");
    } else {
      tabs[i].classList.remove("active");
    }
  }
  var body = document.getElementById("ralph-preview-body");
  if (!body) return;
  var content = tab === "prompt" ? ralphPreviewContent.prompt : ralphPreviewContent.judge;
  if (typeof marked !== "undefined" && marked.parse) {
    body.innerHTML = '<div class="md-content">' + DOMPurify.sanitize(marked.parse(content)) + '</div>';
  } else {
    body.textContent = content;
  }
}
