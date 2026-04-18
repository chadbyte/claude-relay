// app-loop-wizard.js - Ralph Loop wizard: step navigation, data collection, repeat picker
// Extracted from app-loop-ui.js

import { refreshIcons } from './icons.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { requireSkills } from './app-skills-install.js';

// --- Module-owned state (not in store) ---
var wizardStep = 1;
var wizardSource = "ralph"; // "ralph" or "task"
var wizardMode = "draft"; // "draft" or "own"
var loopModeChoice = "judge"; // "simple" | "judge"
var promptAuthor = "clay"; // "clay" | "me"
var judgeAuthor = "clay"; // "clay" | "me"

// --- Module-local state accessors ---
export function getWizardSource() { return wizardSource; }

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
export function initLoopWizard() {
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

  // --- Mode cards (step 1: loop mode) ---
  var modeCards = document.querySelectorAll(".ralph-mode-card");
  for (var mc = 0; mc < modeCards.length; mc++) {
    modeCards[mc].addEventListener("click", function () {
      loopModeChoice = this.getAttribute("data-loop-mode");
      var all = document.querySelectorAll(".ralph-mode-card");
      for (var i = 0; i < all.length; i++) all[i].classList.remove("active");
      this.classList.add("active");
      updateModePreview();
    });
  }

  // --- Authorship toggles (step 3) ---
  var authorBtns = document.querySelectorAll(".ralph-authorship-toggle .config-segment-btn");
  for (var ab = 0; ab < authorBtns.length; ab++) {
    authorBtns[ab].addEventListener("click", function () {
      var toggle = this.parentElement;
      var file = toggle.getAttribute("data-file");
      var author = this.getAttribute("data-author");
      var siblings = toggle.querySelectorAll(".config-segment-btn");
      for (var s = 0; s < siblings.length; s++) siblings[s].classList.remove("active");
      this.classList.add("active");
      if (file === "prompt") promptAuthor = author;
      if (file === "judge") judgeAuthor = author;
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
}

// ========================================================
// Mode preview toggle
// ========================================================

function updateModePreview() {
  var judgePreview = document.querySelector(".ralph-mode-preview-judge");
  var simplePreview = document.querySelector(".ralph-mode-preview-simple");
  if (judgePreview) judgePreview.style.display = loopModeChoice === "judge" ? "" : "none";
  if (simplePreview) simplePreview.style.display = loopModeChoice === "simple" ? "" : "none";
}

// ========================================================
// requireClayRalph
// ========================================================

function requireClayRalph(cb) {
  requireSkills({
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
    store.set({ wizardData: { name: "", task: "", maxIterations: null } });
    loopModeChoice = "judge";
    promptAuthor = "clay";
    judgeAuthor = "clay";

    var el = document.getElementById("ralph-wizard");
    if (!el) return;

    // Reset inputs
    var taskEl = document.getElementById("ralph-task");
    if (taskEl) taskEl.value = "";
    var promptInput = document.getElementById("ralph-prompt-input");
    if (promptInput) promptInput.value = "";
    var judgeInput = document.getElementById("ralph-judge-input");
    if (judgeInput) judgeInput.value = "";

    // Reset mode cards
    var modeCards = document.querySelectorAll(".ralph-mode-card");
    for (var mc = 0; mc < modeCards.length; mc++) {
      if (modeCards[mc].getAttribute("data-loop-mode") === "judge") {
        modeCards[mc].classList.add("active");
      } else {
        modeCards[mc].classList.remove("active");
      }
    }

    // Reset authorship toggles
    var authorToggles = document.querySelectorAll(".ralph-authorship-toggle");
    for (var at = 0; at < authorToggles.length; at++) {
      var btns = authorToggles[at].querySelectorAll(".config-segment-btn");
      for (var b = 0; b < btns.length; b++) {
        if (btns[b].getAttribute("data-author") === "clay") {
          btns[b].classList.add("active");
        } else {
          btns[b].classList.remove("active");
        }
      }
    }

    // Update text based on source
    var isTask = wizardSource === "task";
    var headerSpan = el.querySelector(".ralph-wizard-header > span");
    if (headerSpan) headerSpan.textContent = isTask ? "New Task" : "New Loop";

    if (wizardSource === "task") {
      // Tasks skip step 1 (loop mode), go to step 2
      wizardStep = 2;
    } else {
      wizardStep = 1;
    }
    el.classList.remove("hidden");
    var statusEl = document.getElementById("ralph-install-status");
    if (statusEl) { statusEl.classList.add("hidden"); statusEl.innerHTML = ""; }

    // Reset exec modal flag
    store.set({ execModalShown: false });

    updateModePreview();
    updateWizardStep();
  });
}

export function closeRalphWizard() {
  var el = document.getElementById("ralph-wizard");
  if (el) el.classList.add("hidden");
}

// --- Internal wizard helpers ---

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

  // Show/hide JUDGE authorship row based on loop mode
  var judgeRow = document.getElementById("ralph-judge-authorship-row");
  if (judgeRow) judgeRow.style.display = loopModeChoice === "simple" ? "none" : "";

  // Update step 3 input visibility
  if (wizardStep === 3) updateInputVisibility();

  var backBtn = document.getElementById("ralph-wizard-back");
  var skipBtn = document.getElementById("ralph-wizard-skip");
  var nextBtn = document.getElementById("ralph-wizard-next");
  if (backBtn) {
    var firstStep = (wizardSource === "task") ? 2 : 1;
    backBtn.style.visibility = (wizardStep === firstStep) ? "hidden" : "visible";
    backBtn.textContent = (wizardSource === "task" && wizardStep <= 2) ? "Cancel" : "Back";
  }
  if (skipBtn) skipBtn.style.display = "none";
  if (nextBtn) {
    if (wizardStep === 3) nextBtn.textContent = "Launch";
    else nextBtn.textContent = "Next";
  }
}

function updateInputVisibility() {
  var taskSection = document.getElementById("ralph-input-task-section");
  var promptSection = document.getElementById("ralph-input-prompt-section");
  var judgeSection = document.getElementById("ralph-input-judge-section");

  var needsTask = (promptAuthor === "clay");
  var needsPrompt = (promptAuthor === "me");
  var needsJudge = (loopModeChoice === "judge" && judgeAuthor === "me");

  if (taskSection) {
    if (needsTask) taskSection.classList.remove("hidden");
    else taskSection.classList.add("hidden");
  }
  if (promptSection) {
    if (needsPrompt) promptSection.classList.remove("hidden");
    else promptSection.classList.add("hidden");
  }
  if (judgeSection) {
    if (needsJudge) judgeSection.classList.remove("hidden");
    else judgeSection.classList.add("hidden");
  }

  var heading = document.querySelector('.ralph-step[data-step="3"] h3');
  if (heading) {
    if (needsTask && !needsJudge) heading.textContent = "Describe your task";
    else if (needsPrompt && !needsJudge) heading.textContent = "Provide your prompt";
    else if (needsPrompt && needsJudge) heading.textContent = "Provide your files";
    else if (needsTask && needsJudge) heading.textContent = "Provide details";
    else heading.textContent = "Provide details";
  }
}

function collectWizardData() {
  var wd = {
    name: "",
    maxIterations: null,
    cron: buildWizardCron(),
    loopMode: loopModeChoice,
    promptAuthor: promptAuthor,
    judgeAuthor: (loopModeChoice === "judge") ? judgeAuthor : null,
    mode: (promptAuthor === "me") ? "own" : "draft"
  };

  if (promptAuthor === "clay") {
    var taskEl = document.getElementById("ralph-task");
    wd.task = taskEl ? taskEl.value.trim() : "";
    wd.promptText = null;
  } else {
    var promptInput = document.getElementById("ralph-prompt-input");
    wd.task = "";
    wd.promptText = promptInput ? promptInput.value.trim() : "";
  }

  if (loopModeChoice === "judge" && judgeAuthor === "me") {
    var judgeInput = document.getElementById("ralph-judge-input");
    wd.judgeText = judgeInput ? judgeInput.value.trim() : "";
  } else {
    wd.judgeText = null;
  }

  store.set({ wizardData: wd });
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

var LAST_STEP = 3;

function validateLastStep() {
  var wd = store.get('wizardData');
  if (promptAuthor === "clay") {
    var taskEl = document.getElementById("ralph-task");
    if (!wd.task) {
      if (taskEl) { taskEl.focus(); taskEl.style.borderColor = "#e74c3c"; setTimeout(function() { taskEl.style.borderColor = ""; }, 2000); }
      return false;
    }
  } else {
    var promptInput = document.getElementById("ralph-prompt-input");
    if (!wd.promptText) {
      if (promptInput) { promptInput.focus(); promptInput.style.borderColor = "#e74c3c"; setTimeout(function() { promptInput.style.borderColor = ""; }, 2000); }
      return false;
    }
  }
  if (loopModeChoice === "judge" && judgeAuthor === "me") {
    var judgeInput = document.getElementById("ralph-judge-input");
    if (!wd.judgeText) {
      if (judgeInput) { judgeInput.focus(); judgeInput.style.borderColor = "#e74c3c"; setTimeout(function() { judgeInput.style.borderColor = ""; }, 2000); }
      return false;
    }
  }
  return true;
}

function wizardNext() {
  collectWizardData();
  if (wizardStep < LAST_STEP) {
    wizardStep++;
    updateWizardStep();
    return;
  }
  if (validateLastStep()) wizardSubmit();
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
  if (wizardStep < 3) {
    wizardStep++;
    updateWizardStep();
  }
}

function wizardSubmit() {
  collectWizardData();
  var wd = Object.assign({}, store.get('wizardData'));
  wd.source = wizardSource === "task" ? "task" : undefined;
  store.set({ wizardData: wd });
  closeRalphWizard();
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "ralph_wizard_complete", data: wd }));
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
