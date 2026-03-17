// settings-defaults.js — Shared rendering for model/mode/effort/thinking controls
// Used by both server-settings.js and project-settings.js

export var MODE_OPTIONS = [
  { value: "default", label: "Default", desc: "Claude asks for permission before running tools and editing files." },
  { value: "plan", label: "Plan", desc: "Claude creates a plan first and asks for approval before making changes." },
  { value: "acceptEdits", label: "Auto-accept edits", desc: "File edits are applied automatically. Claude still asks before running commands." },
];

export var EFFORT_LEVELS = [
  { value: "low", desc: "Quick, concise responses. Best for simple questions." },
  { value: "medium", desc: "Balanced responses with moderate reasoning. Good for most tasks." },
  { value: "high", desc: "Thorough responses with deeper analysis. Good for complex tasks." },
  { value: "max", desc: "Maximum reasoning depth. Best for the most difficult problems." },
];

export var THINKING_OPTIONS = [
  { value: "disabled", label: "Off", desc: "Disable extended thinking." },
  { value: "adaptive", label: "Adaptive", desc: "Claude decides when to use extended thinking." },
  { value: "budget", label: "Budget", desc: "Set a token budget for extended thinking." },
];

export var MODEL_DESCRIPTIONS = {
  "default": "Automatically selects the best model for the task.",
  "sonnet": "Fast and capable. Great balance of speed and intelligence.",
  "haiku": "Fastest model. Best for quick tasks and simple questions.",
  "opus": "Most powerful model. Best for complex reasoning and analysis.",
};

export function getModelDesc(model) {
  if (!model) return "";
  var lower = (model.value || model).toLowerCase();
  for (var key in MODEL_DESCRIPTIONS) {
    if (lower.indexOf(key) !== -1) return MODEL_DESCRIPTIONS[key];
  }
  return "";
}

export function isSonnetModel(model) {
  if (!model) return false;
  return model.toLowerCase().indexOf("sonnet") !== -1;
}

// --- Render functions ---
// Each takes an element ID prefix (e.g. "ss" or "ps"), a send function, and state getters.

/**
 * Render model list into `${prefix}-model-list`
 * @param {string} prefix - Element ID prefix
 * @param {object} opts - { models, currentModel, sendMsg, onModelSelect }
 */
export function renderModelList(prefix, opts) {
  var listEl = document.getElementById(prefix + "-model-list");
  if (!listEl) return;

  var models = opts.models || [];
  var currentModel = opts.currentModel || "";

  listEl.innerHTML = "";
  if (models.length === 0) {
    listEl.innerHTML = '<div style="font-size:13px;color:var(--text-dimmer);">No models available</div>';
    return;
  }

  for (var i = 0; i < models.length; i++) {
    (function (m) {
      var value = m.value || "";
      var label = m.displayName || value;
      var item = document.createElement("div");
      item.className = "settings-model-item" + (value === currentModel ? " active" : "");
      item.dataset.model = value;

      var nameSpan = document.createElement("span");
      nameSpan.className = "settings-model-name";
      nameSpan.textContent = label;
      item.appendChild(nameSpan);

      var desc = getModelDesc(value);
      if (desc) {
        var descSpan = document.createElement("span");
        descSpan.className = "settings-model-desc";
        descSpan.textContent = desc;
        item.appendChild(descSpan);
      }

      item.addEventListener("click", function () {
        opts.sendMsg(opts.modelMsgType, { model: value });
        var items = listEl.querySelectorAll(".settings-model-item");
        for (var j = 0; j < items.length; j++) items[j].classList.remove("active");
        item.classList.add("active");
        if (opts.onModelSelect) opts.onModelSelect(value);
      });

      listEl.appendChild(item);
    })(models[i]);
  }
}

/**
 * Render mode list into `${prefix}-mode-list`
 */
export function renderModeList(prefix, opts) {
  var listEl = document.getElementById(prefix + "-mode-list");
  if (!listEl) return;

  var currentMode = opts.currentMode || "default";
  listEl.innerHTML = "";

  for (var i = 0; i < MODE_OPTIONS.length; i++) {
    (function (opt) {
      var item = document.createElement("div");
      item.className = "settings-model-item" + (opt.value === currentMode ? " active" : "");

      var nameSpan = document.createElement("span");
      nameSpan.className = "settings-model-name";
      nameSpan.textContent = opt.label;
      item.appendChild(nameSpan);

      var descSpan = document.createElement("span");
      descSpan.className = "settings-model-desc";
      descSpan.textContent = opt.desc;
      item.appendChild(descSpan);

      item.addEventListener("click", function () {
        opts.sendMsg(opts.modeMsgType, { mode: opt.value });
        var items = listEl.querySelectorAll(".settings-model-item");
        for (var j = 0; j < items.length; j++) items[j].classList.remove("active");
        item.classList.add("active");
      });

      listEl.appendChild(item);
    })(MODE_OPTIONS[i]);
  }
}

/**
 * Render effort bar into `${prefix}-effort-bar`
 */
export function renderEffortBar(prefix, opts) {
  var bar = document.getElementById(prefix + "-effort-bar");
  if (!bar) return;

  var currentEffort = opts.currentEffort || "medium";
  bar.innerHTML = "";

  for (var i = 0; i < EFFORT_LEVELS.length; i++) {
    (function (lvl) {
      var btn = document.createElement("button");
      btn.className = "settings-btn-option" + (lvl.value === currentEffort ? " active" : "");
      btn.textContent = lvl.value.charAt(0).toUpperCase() + lvl.value.slice(1);
      btn.title = lvl.desc;
      btn.addEventListener("click", function () {
        opts.sendMsg(opts.effortMsgType, { effort: lvl.value });
        var btns = bar.querySelectorAll(".settings-btn-option");
        for (var j = 0; j < btns.length; j++) btns[j].classList.remove("active");
        btn.classList.add("active");
      });
      bar.appendChild(btn);
    })(EFFORT_LEVELS[i]);
  }
}

/**
 * Render thinking bar into `${prefix}-thinking-bar`
 */
export function renderThinkingBar(prefix, opts) {
  var bar = document.getElementById(prefix + "-thinking-bar");
  if (!bar) return;

  var currentThinking = opts.currentThinking || "adaptive";
  var currentBudget = opts.currentThinkingBudget || 10000;
  var budgetRow = document.getElementById(prefix + "-thinking-budget-row");
  var budgetInput = document.getElementById(prefix + "-thinking-budget");
  bar.innerHTML = "";

  for (var i = 0; i < THINKING_OPTIONS.length; i++) {
    (function (opt) {
      var btn = document.createElement("button");
      btn.className = "settings-btn-option" + (opt.value === currentThinking ? " active" : "");
      btn.textContent = opt.label;
      btn.title = opt.desc;
      btn.addEventListener("click", function () {
        var msg = { thinking: opt.value };
        if (opt.value === "budget") {
          msg.budgetTokens = budgetInput ? parseInt(budgetInput.value, 10) || 10000 : 10000;
        }
        opts.sendMsg("set_thinking", msg);
        var btns = bar.querySelectorAll(".settings-btn-option");
        for (var j = 0; j < btns.length; j++) btns[j].classList.remove("active");
        btn.classList.add("active");
        if (budgetRow) budgetRow.style.display = opt.value === "budget" ? "" : "none";
      });
      bar.appendChild(btn);
    })(THINKING_OPTIONS[i]);
  }

  if (budgetRow) budgetRow.style.display = currentThinking === "budget" ? "" : "none";
  if (budgetInput) {
    budgetInput.value = currentBudget;
    budgetInput.addEventListener("change", function () {
      var val = Math.max(1024, Math.min(128000, parseInt(this.value, 10) || 10000));
      this.value = val;
      opts.sendMsg("set_thinking", { thinking: "budget", budgetTokens: val });
    });
  }
}

/**
 * Update beta card visibility and bind toggle
 */
export function renderBetaCard(prefix, opts) {
  var model = opts.overrideModel || opts.currentModel || "";
  var card = document.getElementById(prefix + "-beta-card");
  if (card) {
    card.style.display = isSonnetModel(model) ? "" : "none";
  }

  var toggle = document.getElementById(prefix + "-beta-1m");
  if (toggle) {
    var betas = opts.currentBetas || [];
    var hasBeta = false;
    for (var i = 0; i < betas.length; i++) {
      if (betas[i].indexOf("context-1m") !== -1) { hasBeta = true; break; }
    }
    toggle.checked = hasBeta;
    toggle.onchange = function () {
      var currentBetas = opts.currentBetas || [];
      var newBetas;
      if (this.checked) {
        newBetas = currentBetas.slice();
        newBetas.push("context-1m-2025-08-07");
      } else {
        newBetas = [];
        for (var j = 0; j < currentBetas.length; j++) {
          if (currentBetas[j].indexOf("context-1m") === -1) {
            newBetas.push(currentBetas[j]);
          }
        }
      }
      opts.sendMsg("set_betas", { betas: newBetas });
    };
  }
}
