import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './utils.js';

var expanded = false;

export function initBackgroundTasksUi() {
  store.subscribe(function(state, prev) {
    if (state.activeBackgroundTasks !== prev.activeBackgroundTasks) renderBackgroundTasks();
  });
  renderBackgroundTasks();
}

function renderBackgroundTasks() {
  var tasks = store.get('activeBackgroundTasks') || [];
  var existing = document.getElementById('background-tasks-bar');
  if (tasks.length === 0) {
    if (existing) existing.remove();
    expanded = false;
    return;
  }
  var inputArea = document.getElementById('input-area');
  if (!inputArea || !inputArea.parentNode) return;
  var bar = existing || document.createElement('div');
  bar.id = 'background-tasks-bar';
  bar.className = 'background-tasks-bar';
  var taskLabel = tasks.length === 1 ? 'background task' : 'background tasks';
  var html = '<button type="button" class="background-tasks-toggle" aria-expanded="' + expanded + '">' +
    '<span aria-hidden="true">⏳</span><span class="background-tasks-chip">' + tasks.length + '</span>' +
    '<span>' + tasks.length + ' ' + taskLabel + '</span></button>';
  if (expanded) {
    html += '<div class="background-tasks-list">';
    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      html += '<div class="background-task-row"><span class="background-task-description" title="' + escapeHtml(task.description || '') + '">' +
        escapeHtml(task.description || 'Background task') + '</span><span class="background-task-type">' +
        escapeHtml(task.task_type || 'other') + '</span><button type="button" class="background-task-stop" data-task-id="' +
        escapeHtml(task.task_id || '') + '">Stop</button></div>';
    }
    html += '</div>';
  }
  bar.innerHTML = html;
  if (!existing) inputArea.parentNode.insertBefore(bar, inputArea);
  bar.querySelector('.background-tasks-toggle').addEventListener('click', function() {
    expanded = !expanded;
    renderBackgroundTasks();
  });
  var stopButtons = bar.querySelectorAll('.background-task-stop');
  for (var j = 0; j < stopButtons.length; j++) {
    stopButtons[j].addEventListener('click', function() {
      var ws = getWs();
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'stop_task', taskId: this.dataset.taskId }));
    });
  }
}
