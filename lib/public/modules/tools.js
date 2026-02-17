import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons, randomThinkingVerb } from './icons.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks } from './markdown.js';
import { renderDiffPre } from './rewind.js';

var ctx;

// --- Plan mode state ---
var inPlanMode = false;
var planContent = null;

// --- Todo state ---
var todoItems = [];
var todoWidgetEl = null;

// --- Tool tracking ---
var tools = {};
var currentThinking = null;
var pendingPermissions = {};

// --- Tool helpers ---
var PLAN_MODE_TOOLS = { EnterPlanMode: 1, ExitPlanMode: 1 };
var TODO_TOOLS = { TodoWrite: 1, TaskCreate: 1, TaskUpdate: 1, TaskList: 1, TaskGet: 1 };
var HIDDEN_RESULT_TOOLS = { EnterPlanMode: 1, ExitPlanMode: 1, TaskCreate: 1, TaskUpdate: 1, TaskList: 1, TaskGet: 1, TodoWrite: 1 };

function isPlanFile(filePath) {
  return filePath && filePath.indexOf(".claude/plans/") !== -1;
}

export function toolSummary(name, input) {
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

export function toolActivityText(name, input) {
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
export function renderAskUserQuestion(toolId, input) {
  ctx.finalizeAssistantBlock();
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
    qDiv.appendChild(otherDiv);
    container.appendChild(qDiv);
  });

  // Single submit button at the bottom (only for multi-question)
  if (questions.length > 1) {
    var submitBtn = document.createElement("button");
    submitBtn.className = "ask-user-submit";
    submitBtn.textContent = "Submit";
    submitBtn.addEventListener("click", function () {
      submitAskUserAnswer(container, toolId, questions, answers, multiSelections);
    });
    container.appendChild(submitBtn);
  }

  // Skip button
  var skipBtn = document.createElement("button");
  skipBtn.className = "ask-user-skip";
  skipBtn.textContent = "Skip";
  skipBtn.addEventListener("click", function () {
    if (container.classList.contains("answered")) return;
    container.classList.add("answered");
    enableMainInput();
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "stop" }));
    }
  });
  container.appendChild(skipBtn);

  ctx.addToMessages(container);
  disableMainInput();
  ctx.setActivity(null);
  ctx.scrollToBottom();
}

export function disableMainInput() {
  ctx.inputEl.disabled = true;
  ctx.inputEl.placeholder = "Answer the question above to continue...";
}

export function enableMainInput() {
  ctx.inputEl.disabled = false;
  ctx.inputEl.placeholder = "Message Claude Code...";
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
  if (ctx.stopUrgentBlink) ctx.stopUrgentBlink();

  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({
      type: "ask_user_response",
      toolId: toolId,
      answers: result,
    }));
  }
}

export function markAskUserAnswered(toolId) {
  var container = document.querySelector('.ask-user-container[data-tool-id="' + toolId + '"]');
  if (container && !container.classList.contains("answered")) {
    container.classList.add("answered");
    enableMainInput();
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

export function renderPermissionRequest(requestId, toolName, toolInput, decisionReason) {
  ctx.finalizeAssistantBlock();
  stopThinking();

  // ExitPlanMode: render as plan confirmation instead of generic permission
  if (toolName === "ExitPlanMode") {
    renderPlanPermission(requestId);
    return;
  }

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
  ctx.addToMessages(container);

  pendingPermissions[requestId] = container;
  refreshIcons();
  ctx.setActivity(null);
  ctx.scrollToBottom();
}

function renderPlanPermission(requestId) {
  var container = document.createElement("div");
  container.className = "permission-container plan-permission";
  container.dataset.requestId = requestId;

  // Header
  var header = document.createElement("div");
  header.className = "permission-header plan-permission-header";
  header.innerHTML =
    '<span class="permission-icon">' + iconHtml("check-circle") + '</span>' +
    '<span class="permission-title">Plan Approval</span>';

  // Body with plan content
  var body = document.createElement("div");
  body.className = "permission-body";

  if (planContent) {
    var planBody = document.createElement("div");
    planBody.className = "plan-permission-content";
    planBody.innerHTML = renderMarkdown(planContent);
    highlightCodeBlocks(planBody);
    renderMermaidBlocks(planBody);
    body.appendChild(planBody);
  } else {
    var noContent = document.createElement("div");
    noContent.className = "permission-reason";
    noContent.textContent = "Claude has prepared a plan. Approve to proceed with implementation.";
    body.appendChild(noContent);
  }

  // Actions
  var actions = document.createElement("div");
  actions.className = "permission-actions";

  var approveBtn = document.createElement("button");
  approveBtn.className = "permission-btn permission-allow";
  approveBtn.textContent = "Approve Plan";
  approveBtn.addEventListener("click", function () {
    sendPermissionResponse(container, requestId, "allow");
  });

  var rejectBtn = document.createElement("button");
  rejectBtn.className = "permission-btn permission-deny";
  rejectBtn.textContent = "Reject Plan";
  rejectBtn.addEventListener("click", function () {
    sendPermissionResponse(container, requestId, "deny");
  });

  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);

  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(actions);
  ctx.addToMessages(container);

  pendingPermissions[requestId] = container;
  refreshIcons();
  ctx.setActivity(null);
  ctx.scrollToBottom();
}

function sendPermissionResponse(container, requestId, decision) {
  if (container.classList.contains("resolved")) return;
  container.classList.add("resolved");
  if (ctx.stopUrgentBlink) ctx.stopUrgentBlink();

  var label = decision === "deny" ? "Denied" : "Allowed";
  var resolvedClass = decision === "deny" ? "resolved-denied" : "resolved-allowed";
  container.classList.add(resolvedClass);

  // Replace actions with decision label
  var actions = container.querySelector(".permission-actions");
  if (actions) {
    actions.innerHTML = '<span class="permission-decision-label">' + label + '</span>';
  }

  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({
      type: "permission_response",
      requestId: requestId,
      decision: decision,
    }));
  }

  delete pendingPermissions[requestId];
}

export function markPermissionResolved(requestId, decision) {
  var container = pendingPermissions[requestId];
  if (!container) {
    // Find by data attribute (history replay)
    container = ctx.messagesEl.querySelector('[data-request-id="' + requestId + '"]');
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

export function markPermissionCancelled(requestId) {
  var container = pendingPermissions[requestId];
  if (!container) {
    container = ctx.messagesEl.querySelector('[data-request-id="' + requestId + '"]');
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
export function renderPlanBanner(type) {
  ctx.finalizeAssistantBlock();
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

  ctx.addToMessages(el);
  refreshIcons();
  ctx.scrollToBottom();
  return el;
}

export function renderPlanCard(content) {
  ctx.finalizeAssistantBlock();

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
  renderMermaidBlocks(body);

  header.addEventListener("click", function () {
    el.classList.toggle("collapsed");
  });

  el.appendChild(header);
  el.appendChild(body);
  ctx.addToMessages(el);
  refreshIcons();
  ctx.scrollToBottom();
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

export function handleTodoWrite(input) {
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

export function handleTaskCreate(input) {
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

export function handleTaskUpdate(input) {
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
    updateTodoSticky();
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
    ctx.addToMessages(todoWidgetEl);
  }
  updateTodoSticky();
  refreshIcons();
  ctx.scrollToBottom();
}

function updateTodoSticky() {
  var stickyEl = document.getElementById("todo-sticky");
  if (!stickyEl) return;

  // Hide if no active tasks (all completed or empty)
  var hasActive = false;
  for (var i = 0; i < todoItems.length; i++) {
    if (todoItems[i].status !== "completed") { hasActive = true; break; }
  }
  if (!hasActive) {
    stickyEl.classList.add("hidden");
    return;
  }

  var completed = 0;
  for (var i = 0; i < todoItems.length; i++) {
    if (todoItems[i].status === "completed") completed++;
  }
  var pct = Math.round(completed / todoItems.length * 100);
  var wasCollapsed = stickyEl.classList.contains("collapsed");

  var html = '<div class="todo-sticky-inner">' +
    '<div class="todo-sticky-header">' +
    '<span class="todo-sticky-icon">' + iconHtml("list-checks") + '</span>' +
    '<span class="todo-sticky-title">Tasks</span>' +
    '<span class="todo-sticky-count">' + completed + '/' + todoItems.length + '</span>' +
    '<span class="todo-sticky-chevron">' + iconHtml("chevron-down") + '</span>' +
    '</div>' +
    '<div class="todo-sticky-progress"><div class="todo-sticky-progress-bar" style="width:' + pct + '%"></div></div>' +
    '<div class="todo-sticky-items">';

  for (var i = 0; i < todoItems.length; i++) {
    var t = todoItems[i];
    var statusClass = t.status === "completed" ? "completed" : t.status === "in_progress" ? "in-progress" : "pending";
    html += '<div class="todo-sticky-item ' + statusClass + '">' +
      '<span class="todo-sticky-item-icon">' + todoStatusIcon(t.status) + '</span>' +
      '<span class="todo-sticky-item-text">' + escapeHtml(t.status === "in_progress" && t.activeForm ? t.activeForm : t.content) + '</span>' +
      '</div>';
  }

  html += '</div></div>';
  stickyEl.innerHTML = html;
  stickyEl.classList.remove("hidden");
  if (wasCollapsed) stickyEl.classList.add("collapsed");

  stickyEl.querySelector(".todo-sticky-header").addEventListener("click", function () {
    stickyEl.classList.toggle("collapsed");
  });

  refreshIcons();
}

// --- Thinking ---
export function startThinking() {
  ctx.finalizeAssistantBlock();

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

  ctx.addToMessages(el);
  refreshIcons();
  ctx.scrollToBottom();
  currentThinking = { el: el, fullText: "", startTime: Date.now() };
  ctx.setActivity(randomThinkingVerb() + "...");
}

export function appendThinking(text) {
  if (!currentThinking) return;
  currentThinking.fullText += text;
  currentThinking.el.querySelector(".thinking-content").textContent = currentThinking.fullText;
  ctx.scrollToBottom();
}

export function stopThinking() {
  if (!currentThinking) return;
  var secs = ((Date.now() - currentThinking.startTime) / 1000).toFixed(1);
  currentThinking.el.classList.add("done");
  currentThinking.el.querySelector(".thinking-duration").textContent = " " + secs + "s";
  currentThinking = null;
}

// --- Tool items ---
export function createToolItem(id, name) {
  ctx.finalizeAssistantBlock();
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

  ctx.addToMessages(el);
  refreshIcons();
  ctx.scrollToBottom();

  tools[id] = { el: el, name: name, input: null, done: false };
  ctx.setActivity("Running " + name + "...");
}

export function updateToolExecuting(id, name, input) {
  var tool = tools[id];
  if (!tool) return;

  tool.input = input;
  tool.el.querySelector(".tool-desc").textContent = toolSummary(name, input);
  ctx.setActivity(toolActivityText(name, input));

  var subtitleText = tool.el.querySelector(".tool-subtitle-text");
  if (subtitleText) subtitleText.textContent = toolActivityText(name, input);

  ctx.scrollToBottom();
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

export function updateToolResult(id, content, isError) {
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
  ctx.scrollToBottom();
}

export function markToolDone(id, isError) {
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

export function markAllToolsDone() {
  for (var id in tools) {
    if (tools.hasOwnProperty(id) && !tools[id].done) {
      markToolDone(id, false);
    }
  }
}

export function addTurnMeta(cost, duration) {
  var div = document.createElement("div");
  div.className = "turn-meta";
  div.dataset.turn = ctx.turnCounter;
  var parts = [];
  if (cost != null) parts.push("$" + cost.toFixed(4));
  if (duration != null) parts.push((duration / 1000).toFixed(1) + "s");
  if (parts.length) {
    div.textContent = parts.join(" \u00b7 ");
    ctx.addToMessages(div);
    ctx.scrollToBottom();
  }
}

// Expose state getters and reset
export function getTools() { return tools; }
export function isInPlanMode() { return inPlanMode; }
export function getPlanContent() { return planContent; }
export function setPlanContent(c) { planContent = c; }
export function isPlanFilePath(fp) { return isPlanFile(fp); }
export function getPlanModeTools() { return PLAN_MODE_TOOLS; }
export function getTodoTools() { return TODO_TOOLS; }
export function getHiddenResultTools() { return HIDDEN_RESULT_TOOLS; }

export function saveToolState() {
  return {
    tools: tools,
    currentThinking: currentThinking,
    todoWidgetEl: todoWidgetEl,
    inPlanMode: inPlanMode,
    planContent: planContent,
  };
}

export function restoreToolState(saved) {
  tools = saved.tools;
  currentThinking = saved.currentThinking;
  todoWidgetEl = saved.todoWidgetEl;
  inPlanMode = saved.inPlanMode;
  planContent = saved.planContent;
}

export function resetToolState() {
  tools = {};
  currentThinking = null;
  inPlanMode = false;
  planContent = null;
  todoItems = [];
  todoWidgetEl = null;
  pendingPermissions = {};
  var stickyEl = document.getElementById("todo-sticky");
  if (stickyEl) { stickyEl.classList.add("hidden"); stickyEl.innerHTML = ""; }
}

export function initTools(_ctx) {
  ctx = _ctx;
}
