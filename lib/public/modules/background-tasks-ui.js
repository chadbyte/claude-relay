// background-tasks-ui.js - Background task status line above the composer.
//
// Collapsed it reads as a quiet status line, not a button demanding attention:
// a muted activity indicator, a count, and a chevron. Expanding lists each task
// with its elapsed time and a Stop control.
//
// Elapsed time comes from `started_at` (epoch ms) which the server stamps in
// lib/background-task-timing.js. The ticker only runs while the list is
// expanded, so a collapsed bar costs nothing.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var expanded = false;
var elapsedTimer = null;

// Lucide icon per vendor-neutral task type (see normalizeBackgroundTasks in
// yoke/adapters/claude.js for where these types are assigned).
var TASK_TYPE_ICONS = { shell: "terminal", agent: "sparkles", other: "circle-dot" };

export function initBackgroundTasksUi() {
  store.subscribe(function (state, prev) {
    if (state.activeBackgroundTasks !== prev.activeBackgroundTasks) renderBackgroundTasks();
  });
  renderBackgroundTasks();
}

// "45s", "2m 14s", "1h 03m" - short enough to sit in a row without wrapping.
export function formatElapsed(startedAt, now) {
  if (typeof startedAt !== "number" || !isFinite(startedAt) || startedAt <= 0) return "";
  var current = typeof now === "number" ? now : Date.now();
  var totalSeconds = Math.floor((current - startedAt) / 1000);
  if (totalSeconds < 0) totalSeconds = 0;
  if (totalSeconds < 60) return totalSeconds + "s";
  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  if (minutes < 60) return minutes + "m " + pad(seconds) + "s";
  var hours = Math.floor(minutes / 60);
  return hours + "h " + pad(minutes % 60) + "m";
}

function pad(value) {
  return value < 10 ? "0" + value : String(value);
}

function stopElapsedTimer() {
  if (!elapsedTimer) return;
  clearInterval(elapsedTimer);
  elapsedTimer = null;
}

// Ticks at most once a second and only touches the time cells, so expanding
// the list never re-renders (and never steals focus from) the rows.
function startElapsedTimer() {
  stopElapsedTimer();
  elapsedTimer = setInterval(updateElapsedCells, 1000);
}

function updateElapsedCells() {
  var bar = document.getElementById('background-tasks-bar');
  if (!bar || !expanded) {
    stopElapsedTimer();
    return;
  }
  var now = Date.now();
  var cells = bar.querySelectorAll('.background-task-elapsed');
  for (var i = 0; i < cells.length; i++) {
    var startedAt = Number(cells[i].dataset.startedAt);
    cells[i].textContent = formatElapsed(startedAt, now);
  }
}

function activityDotsHtml() {
  return '<span class="background-tasks-activity" aria-hidden="true"><i></i><i></i><i></i></span>';
}

// Ambient tasks are the CLI's own housekeeping. The SDK asks hosts to keep
// them out of activity indicators; Clay still lists them so the user can see
// what runs on their behalf. Absent means false (Codex has no ambient concept,
// and older CLI builds report only user work).
export function isAmbientTask(task) {
  return !!(task && task.ambient === true);
}

export function splitTasks(tasks) {
  var user = [];
  var ambient = [];
  var list = Array.isArray(tasks) ? tasks : [];
  for (var i = 0; i < list.length; i++) {
    if (!list[i]) continue;
    if (isAmbientTask(list[i])) ambient.push(list[i]);
    else user.push(list[i]);
  }
  return { user: user, ambient: ambient };
}

function taskRowHtml(task, now) {
  var taskType = task.task_type || 'other';
  var icon = TASK_TYPE_ICONS[taskType] || TASK_TYPE_ICONS.other;
  var description = task.description || 'Background task';
  var startedAt = typeof task.started_at === 'number' ? task.started_at : 0;
  var elapsed = formatElapsed(startedAt, now);
  return '<div class="background-task-row' + (isAmbientTask(task) ? ' ambient' : '') + '">' +
    '<span class="background-task-icon" title="' + escapeHtml(taskType) + '">' + iconHtml(icon) + '</span>' +
    '<span class="background-task-description" title="' + escapeHtml(description) + '">' +
      escapeHtml(description) + '</span>' +
    '<span class="background-task-meta">' +
      '<span class="background-task-type">' + escapeHtml(taskType) + '</span>' +
      '<span class="background-task-elapsed" data-started-at="' + startedAt + '">' + escapeHtml(elapsed) + '</span>' +
    '</span>' +
    '<button type="button" class="background-task-stop" data-task-id="' + escapeHtml(task.task_id || '') + '" ' +
      'aria-label="Stop ' + escapeHtml(description) + '">Stop</button>' +
    '</div>';
}

function renderBackgroundTasks() {
  var tasks = store.get('activeBackgroundTasks') || [];
  var split = splitTasks(tasks);
  var existing = document.getElementById('background-tasks-bar');
  // Ambient-only means nothing the user asked for is running, so the composer
  // stays quiet: no bar, no dots, no count.
  if (split.user.length === 0) {
    if (existing) existing.remove();
    expanded = false;
    stopElapsedTimer();
    return;
  }
  var inputArea = document.getElementById('input-area');
  if (!inputArea || !inputArea.parentNode) return;

  var bar = existing || document.createElement('div');
  bar.id = 'background-tasks-bar';
  bar.className = 'background-tasks-bar' + (expanded ? ' expanded' : '');

  var taskLabel = split.user.length === 1 ? 'background task' : 'background tasks';
  var summary = split.user.length + ' ' + taskLabel;
  var html = '<button type="button" class="background-tasks-toggle" aria-expanded="' + expanded + '"' +
    ' aria-controls="background-tasks-list" aria-label="' + summary + ', ' +
    (expanded ? 'collapse' : 'expand') + ' details">' +
    activityDotsHtml() +
    '<span class="background-tasks-summary">' + summary + '</span>' +
    '<span class="background-tasks-chevron" aria-hidden="true">' + iconHtml('chevron-right') + '</span>' +
    '</button>';

  if (expanded) {
    var now = Date.now();
    html += '<div class="background-tasks-list" id="background-tasks-list">';
    for (var i = 0; i < split.user.length; i++) html += taskRowHtml(split.user[i], now);
    // Housekeeping is shown, not hidden: the user can see what Clay runs on
    // its own and stop a runaway one. Kept visually subordinate to real work.
    if (split.ambient.length > 0) {
      html += '<div class="background-tasks-section-label">Housekeeping</div>';
      for (var a = 0; a < split.ambient.length; a++) html += taskRowHtml(split.ambient[a], now);
    }
    html += '</div>';
  }
  bar.innerHTML = html;
  if (!existing) inputArea.parentNode.insertBefore(bar, inputArea);
  refreshIcons();

  bar.querySelector('.background-tasks-toggle').addEventListener('click', function () {
    expanded = !expanded;
    renderBackgroundTasks();
  });

  var stopButtons = bar.querySelectorAll('.background-task-stop');
  for (var j = 0; j < stopButtons.length; j++) {
    stopButtons[j].addEventListener('click', function () {
      var ws = getWs();
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'stop_task', taskId: this.dataset.taskId }));
    });
  }

  if (expanded) startElapsedTimer();
  else stopElapsedTimer();
}
