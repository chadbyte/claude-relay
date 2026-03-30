import { iconHtml, refreshIcons } from './icons.js';
import { hideKnowledge } from './mate-knowledge.js';
import { hideNotes } from './sticky-notes.js';
import { escapeHtml } from './utils.js';

var getMateWs = null;
var entriesEl = null;
var sidebarBtn = null;
var countBadge = null;
var visible = false;
var cachedEntries = [];

// Sidebar panels
var conversationsPanel = null;
var memoryPanel = null;
var memoryBackBtn = null;

// Viewer elements
var viewerEl = null;
var viewerTopicEl = null;
var viewerContentEl = null;
var viewerDeleteBtn = null;
var viewerCloseBtn = null;
var viewingIndex = -1;

// Confirm overlay
var confirmOverlay = null;

export function initMateMemory(mateWsGetter) {
  getMateWs = mateWsGetter;

  sidebarBtn = document.getElementById("mate-memory-btn");
  countBadge = document.getElementById("mate-memory-count");
  entriesEl = document.getElementById("mate-memory-entries");
  conversationsPanel = document.getElementById("mate-sidebar-conversations");
  memoryPanel = document.getElementById("mate-sidebar-memory");
  memoryBackBtn = document.getElementById("mate-memory-back-btn");

  viewerEl = document.getElementById("mate-memory-viewer");
  viewerTopicEl = document.getElementById("mate-memory-viewer-topic");
  viewerContentEl = document.getElementById("mate-memory-viewer-content");
  viewerDeleteBtn = document.getElementById("mate-memory-viewer-delete-btn");
  viewerCloseBtn = document.getElementById("mate-memory-viewer-close-btn");

  if (sidebarBtn) {
    sidebarBtn.addEventListener("click", function () {
      if (visible) { hideMemory(); } else { showMemory(); }
    });
  }

  if (memoryBackBtn) {
    memoryBackBtn.addEventListener("click", hideMemory);
  }

  if (viewerCloseBtn) {
    viewerCloseBtn.addEventListener("click", closeViewer);
  }

  if (viewerDeleteBtn) {
    viewerDeleteBtn.addEventListener("click", function () {
      if (viewingIndex >= 0) {
        confirmDelete(viewingIndex);
      }
    });
  }
}

export function showMemory() {
  visible = true;
  hideKnowledge();
  hideNotes();

  if (conversationsPanel) conversationsPanel.classList.add("hidden");
  if (memoryPanel) memoryPanel.classList.remove("hidden");
  if (sidebarBtn) sidebarBtn.classList.add("active");

  requestMemoryList();
}

export function hideMemory() {
  visible = false;

  if (conversationsPanel) conversationsPanel.classList.remove("hidden");
  if (memoryPanel) memoryPanel.classList.add("hidden");
  if (sidebarBtn) sidebarBtn.classList.remove("active");

  closeViewer();
  cachedEntries = [];

  if (countBadge) {
    countBadge.textContent = "";
    countBadge.classList.add("hidden");
  }
}

export function isMemoryVisible() {
  return visible;
}

function requestMemoryList() {
  var ws = getMateWs ? getMateWs() : null;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "memory_list" }));
  }
}

export function renderMemoryList(entries) {
  cachedEntries = entries || [];

  // Update badge
  if (countBadge) {
    if (cachedEntries.length > 0) {
      countBadge.textContent = cachedEntries.length;
      countBadge.classList.remove("hidden");
    } else {
      countBadge.textContent = "";
      countBadge.classList.add("hidden");
    }
  }

  if (!entriesEl) return;
  entriesEl.innerHTML = "";

  if (cachedEntries.length === 0) {
    var empty = document.createElement("div");
    empty.className = "mate-memory-empty";
    empty.textContent = "No memories yet";
    entriesEl.appendChild(empty);
    refreshIcons();
    return;
  }

  for (var i = 0; i < cachedEntries.length; i++) {
    entriesEl.appendChild(renderMemoryItem(cachedEntries[i], i));
  }
  refreshIcons();
}

function renderMemoryItem(entry, listIndex) {
  var item = document.createElement("div");
  item.className = "mate-memory-item";

  // Top row: date + type badge
  var topRow = document.createElement("div");
  topRow.className = "mate-memory-item-top";

  var dateEl = document.createElement("span");
  dateEl.className = "mate-memory-date";
  dateEl.textContent = entry.date || "?";
  topRow.appendChild(dateEl);

  if (entry.type) {
    var badge = document.createElement("span");
    badge.className = "mate-memory-type-badge";
    badge.textContent = entry.type;
    topRow.appendChild(badge);
  }

  // Delete button
  var delBtn = document.createElement("button");
  delBtn.className = "mate-memory-delete-btn";
  delBtn.title = "Delete";
  delBtn.innerHTML = iconHtml("trash-2");
  delBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    confirmDelete(entry.index);
  });
  topRow.appendChild(delBtn);

  item.appendChild(topRow);

  // Topic
  var topicEl = document.createElement("div");
  topicEl.className = "mate-memory-topic";
  topicEl.textContent = entry.topic || "(no topic)";
  item.appendChild(topicEl);

  // Position preview
  if (entry.my_position) {
    var posEl = document.createElement("div");
    posEl.className = "mate-memory-position";
    var preview = entry.my_position;
    if (preview.length > 100) preview = preview.substring(0, 100) + "...";
    posEl.textContent = preview;
    item.appendChild(posEl);
  }

  item.addEventListener("click", function () {
    openViewer(entry, listIndex);
  });

  return item;
}

function openViewer(entry, listIndex) {
  viewingIndex = entry.index;
  if (!viewerEl) return;

  if (viewerTopicEl) viewerTopicEl.textContent = entry.topic || "Memory";
  if (viewerContentEl) {
    var html = "";
    html += renderField("Date", entry.date);
    if (entry.type) html += renderField("Type", entry.type);
    html += renderField("Topic", entry.topic);
    html += renderField("My Position", entry.my_position);
    if (entry.user_intent) html += renderField("User Intent", entry.user_intent);
    if (entry.other_perspectives) html += renderField("Other Perspectives", entry.other_perspectives);
    html += renderField("Decisions", entry.decisions);
    html += renderField("Open Items", entry.open_items);
    if (entry.user_sentiment) html += renderField("User Sentiment", entry.user_sentiment);
    if (entry.my_role) html += renderField("My Role", entry.my_role);
    if (entry.outcome) html += renderField("Outcome", entry.outcome);
    viewerContentEl.innerHTML = html;
  }

  // Mark active in list
  if (entriesEl) {
    var items = entriesEl.querySelectorAll(".mate-memory-item");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle("active", i === listIndex);
    }
  }

  viewerEl.classList.remove("hidden");
  refreshIcons();
}

function renderField(label, value) {
  if (!value || value === "null") return "";
  return '<div class="mate-memory-detail">' +
    '<div class="mate-memory-detail-label">' + escapeHtml(label) + '</div>' +
    '<div class="mate-memory-detail-value">' + escapeHtml(value) + '</div>' +
    '</div>';
}

function closeViewer() {
  viewingIndex = -1;
  if (viewerEl) viewerEl.classList.add("hidden");
  if (entriesEl) {
    var items = entriesEl.querySelectorAll(".mate-memory-item");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove("active");
    }
  }
  dismissConfirm();
}

function confirmDelete(index) {
  dismissConfirm();

  confirmOverlay = document.createElement("div");
  confirmOverlay.className = "mate-memory-confirm-overlay";

  var dialog = document.createElement("div");
  dialog.className = "mate-memory-confirm-dialog";

  var msg = document.createElement("div");
  msg.className = "mate-memory-confirm-msg";
  msg.textContent = "Delete this memory?";
  dialog.appendChild(msg);

  var actions = document.createElement("div");
  actions.className = "mate-memory-confirm-actions";

  var cancelBtn = document.createElement("button");
  cancelBtn.className = "mate-memory-confirm-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", dismissConfirm);
  actions.appendChild(cancelBtn);

  var deleteBtn = document.createElement("button");
  deleteBtn.className = "mate-memory-confirm-delete";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", function () {
    var ws = getMateWs ? getMateWs() : null;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "memory_delete", index: index }));
    }
    if (viewingIndex === index) closeViewer();
    dismissConfirm();
  });
  actions.appendChild(deleteBtn);

  dialog.appendChild(actions);
  confirmOverlay.appendChild(dialog);
  confirmOverlay.addEventListener("click", function (e) {
    if (e.target === confirmOverlay) dismissConfirm();
  });
  document.body.appendChild(confirmOverlay);
}

function dismissConfirm() {
  if (confirmOverlay && confirmOverlay.parentNode) {
    confirmOverlay.parentNode.removeChild(confirmOverlay);
  }
  confirmOverlay = null;
}

export function handleMemoryDeleted() {
  // List update follows via memory_list
}
