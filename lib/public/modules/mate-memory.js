import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml } from './utils.js';

var getMateWs = null;
var visible = false;
var cachedEntries = [];
var cachedSummary = "";

// DOM elements
var sidebarBtn = null;
var countBadge = null;
var viewerEl = null;
var closeBtn = null;
var summaryContentEl = null;
var digestListEl = null;
var digestDetailEl = null;
var tabSummary = null;
var tabDigests = null;
var tabBodySummary = null;
var tabBodyDigests = null;

// Confirm overlay
var confirmOverlay = null;

export function initMateMemory(mateWsGetter) {
  getMateWs = mateWsGetter;

  sidebarBtn = document.getElementById("mate-memory-btn");
  countBadge = document.getElementById("mate-memory-count");
  viewerEl = document.getElementById("mate-memory-viewer");
  closeBtn = document.getElementById("mate-memory-viewer-close-btn");
  summaryContentEl = document.getElementById("mate-memory-summary-content");
  digestListEl = document.getElementById("mate-memory-digest-list");
  digestDetailEl = document.getElementById("mate-memory-digest-detail");
  tabBodySummary = document.getElementById("mate-memory-tab-summary");
  tabBodyDigests = document.getElementById("mate-memory-tab-digests");

  // Tab buttons
  var tabs = viewerEl ? viewerEl.querySelectorAll(".mate-memory-tab") : [];
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].dataset.tab === "summary") tabSummary = tabs[i];
    if (tabs[i].dataset.tab === "digests") tabDigests = tabs[i];
    (function (tab) {
      tab.addEventListener("click", function () {
        switchTab(tab.dataset.tab);
      });
    })(tabs[i]);
  }

  if (sidebarBtn) {
    sidebarBtn.addEventListener("click", function () {
      if (visible) { hideMemory(); } else { showMemory(); }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", hideMemory);
  }
}

function switchTab(tabName) {
  if (tabSummary) tabSummary.classList.toggle("active", tabName === "summary");
  if (tabDigests) tabDigests.classList.toggle("active", tabName === "digests");
  if (tabBodySummary) tabBodySummary.classList.toggle("hidden", tabName !== "summary");
  if (tabBodyDigests) tabBodyDigests.classList.toggle("hidden", tabName !== "digests");

  // When switching to digests, hide detail and show list
  if (tabName === "digests") {
    if (digestDetailEl) digestDetailEl.classList.add("hidden");
    if (digestListEl) digestListEl.classList.remove("hidden");
  }
}

export function showMemory() {
  visible = true;
  if (sidebarBtn) sidebarBtn.classList.add("active");
  if (viewerEl) viewerEl.classList.remove("hidden");

  // Default to summary tab
  switchTab("summary");
  requestMemoryList();
}

export function hideMemory() {
  visible = false;
  if (sidebarBtn) sidebarBtn.classList.remove("active");
  if (viewerEl) viewerEl.classList.add("hidden");
  dismissConfirm();
  cachedEntries = [];
  cachedSummary = "";
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

export function renderMemoryList(entries, summary) {
  cachedEntries = entries || [];
  cachedSummary = summary || "";

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

  // Render summary tab
  renderSummary();

  // Render digest list
  renderDigestList();

  refreshIcons();
}

function renderSummary() {
  if (!summaryContentEl) return;

  if (!cachedSummary) {
    summaryContentEl.innerHTML =
      '<div class="mate-memory-empty">No memory summary yet. Memories will be created automatically as you chat.</div>';
    return;
  }

  // Render markdown summary (simple conversion)
  var html = escapeHtml(cachedSummary);
  // Convert markdown headers
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  // Convert bullet points
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, function (m) { return '<ul>' + m + '</ul>'; });
  // Convert bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p>\s*<(h[123]|ul)/g, '<$1');
  html = html.replace(/<\/(h[123]|ul)>\s*<\/p>/g, '</$1>');

  summaryContentEl.innerHTML = html;
}

function renderDigestList() {
  if (!digestListEl) return;
  digestListEl.innerHTML = "";

  if (cachedEntries.length === 0) {
    var empty = document.createElement("div");
    empty.className = "mate-memory-empty";
    empty.textContent = "No session logs yet";
    digestListEl.appendChild(empty);
    return;
  }

  for (var i = 0; i < cachedEntries.length; i++) {
    digestListEl.appendChild(renderDigestItem(cachedEntries[i], i));
  }
}

function renderDigestItem(entry, listIndex) {
  var item = document.createElement("div");
  item.className = "mate-memory-item";

  // Top row: date + type badge + delete
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

  if (entry.tags && entry.tags.length > 0) {
    for (var t = 0; t < entry.tags.length && t < 3; t++) {
      var tag = document.createElement("span");
      tag.className = "mate-memory-tag";
      tag.textContent = entry.tags[t];
      topRow.appendChild(tag);
    }
  }

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
    if (preview.length > 120) preview = preview.substring(0, 120) + "...";
    posEl.textContent = preview;
    item.appendChild(posEl);
  }

  item.addEventListener("click", function () {
    openDigestDetail(entry, listIndex);
  });

  return item;
}

function openDigestDetail(entry, listIndex) {
  if (!digestDetailEl || !digestListEl) return;

  // Hide list, show detail
  digestListEl.classList.add("hidden");
  digestDetailEl.classList.remove("hidden");

  // Build detail HTML
  var html = '';
  html += '<div class="mate-memory-detail-header">';
  html += '<button class="mate-memory-detail-back">' + iconHtml("arrow-left") + ' Back</button>';
  html += '<div class="mate-knowledge-toolbar-spacer"></div>';
  html += '<button class="mate-memory-detail-delete mate-memory-danger-btn" title="Delete">' + iconHtml("trash-2") + '</button>';
  html += '</div>';
  html += '<div class="mate-memory-detail-body">';
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
  if (entry.confidence) html += renderField("Confidence", entry.confidence);
  if (entry.tags && entry.tags.length > 0) html += renderField("Tags", entry.tags.join(", "));
  html += '</div>';

  digestDetailEl.innerHTML = html;
  refreshIcons();

  // Back button
  var backBtn = digestDetailEl.querySelector(".mate-memory-detail-back");
  if (backBtn) {
    backBtn.addEventListener("click", function () {
      digestDetailEl.classList.add("hidden");
      digestListEl.classList.remove("hidden");
    });
  }

  // Delete button
  var delBtn = digestDetailEl.querySelector(".mate-memory-detail-delete");
  if (delBtn) {
    delBtn.addEventListener("click", function () {
      confirmDelete(entry.index);
    });
  }
}

function renderField(label, value) {
  if (!value || value === "null") return "";
  return '<div class="mate-memory-detail">' +
    '<div class="mate-memory-detail-label">' + escapeHtml(label) + '</div>' +
    '<div class="mate-memory-detail-value">' + escapeHtml(String(value)) + '</div>' +
    '</div>';
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
