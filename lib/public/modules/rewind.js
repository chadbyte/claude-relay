import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var ctx;
var rewindMode = false;
var pendingRewindUuid = null;
var rewindBannerEl = null;
var rewindScrollHandler = null;
var rewindModal, rewindSummary, rewindFilesList, rewindConfirmBtn, rewindCancelBtn;

export function setRewindMode(on) {
  rewindMode = on;
  var appEl = ctx.$("app");
  if (on) {
    appEl.classList.add("rewind-mode");
    if (!rewindBannerEl) {
      rewindBannerEl = document.createElement("div");
      rewindBannerEl.className = "rewind-mode-banner";
      rewindBannerEl.innerHTML =
        '<i data-lucide="rotate-ccw"></i>' +
        '<span class="rewind-banner-text">Select a message to rewind to</span>' +
        '<button class="rewind-exit-btn" title="Exit rewind mode"><i data-lucide="x"></i></button>';
      rewindBannerEl.querySelector(".rewind-exit-btn").addEventListener("click", function() {
        setRewindMode(false);
      });
      ctx.$("app").appendChild(rewindBannerEl);
      refreshIcons();
    }
    buildRewindTimeline();
  } else {
    appEl.classList.remove("rewind-mode");
    if (rewindBannerEl) {
      rewindBannerEl.remove();
      rewindBannerEl = null;
    }
    removeRewindTimeline();
  }
}

export function isRewindMode() {
  return rewindMode;
}

export function getPendingRewindUuid() {
  return pendingRewindUuid;
}

export function clearPendingRewindUuid() {
  pendingRewindUuid = null;
}

function initiateRewind(uuid) {
  if (ctx.processing) {
    ctx.addSystemMessage("Cannot rewind while processing. Stop the current operation first.", true);
    return;
  }
  if (!uuid) {
    ctx.addSystemMessage("No rewind point found for this turn.", true);
    return;
  }
  pendingRewindUuid = uuid;
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "rewind_preview", uuid: uuid }));
  }
}

export function showRewindModal(data) {
  var p = data.preview || data;
  var filePaths = p.filesChanged || p.filePaths || p.files || [];
  var fileCount = filePaths.length;
  var insertions = p.insertions || 0;
  var deletions = p.deletions || 0;
  if (fileCount > 0) {
    var summary = fileCount + " file" + (fileCount !== 1 ? "s" : "") + " will be restored.";
    if (insertions || deletions) summary += " (+" + insertions + " / -" + deletions + " lines)";
    rewindSummary.textContent = summary;
  } else {
    rewindSummary.textContent = "No file changes to restore. Conversation will be rewound.";
  }

  var diffs = data.diffs || {};
  rewindFilesList.innerHTML = "";
  if (filePaths.length > 0) {
    rewindFilesList.style.display = "";
    for (var i = 0; i < filePaths.length; i++) {
      var fp = filePaths[i];
      var section = document.createElement("div");
      section.className = "rewind-file-section expanded";

      var header = document.createElement("div");
      header.className = "rewind-file-header";
      header.innerHTML = '<span class="rewind-file-chevron"><i data-lucide="chevron-right"></i></span>';

      var pathSpan = document.createElement("span");
      pathSpan.className = "rewind-file-path";
      pathSpan.textContent = fp;
      pathSpan.title = fp;
      header.appendChild(pathSpan);

      header.addEventListener("click", function(sec) {
        return function() { sec.classList.toggle("expanded"); };
      }(section));

      section.appendChild(header);

      var diffContainer = document.createElement("div");
      diffContainer.className = "rewind-file-diff";
      var diffText = diffs[fp];
      if (diffText) {
        diffContainer.appendChild(renderDiffPre(diffText));
      } else {
        var noDiff = document.createElement("div");
        noDiff.className = "rewind-no-diff";
        noDiff.textContent = "No diff available (file may be untracked)";
        diffContainer.appendChild(noDiff);
      }
      section.appendChild(diffContainer);

      rewindFilesList.appendChild(section);
    }
    refreshIcons();
  } else {
    rewindFilesList.style.display = "none";
  }

  rewindModal.classList.remove("hidden");
}

export function hideRewindModal() {
  rewindModal.classList.add("hidden");
  pendingRewindUuid = null;
}

export function renderDiffPre(text) {
  var pre = document.createElement("pre");
  pre.className = "diff-content";
  var lines = text.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var span = document.createElement("span");
    if (line.startsWith("@@")) {
      span.className = "diff-hunk";
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      span.className = "diff-file-header";
    } else if (line.startsWith("+")) {
      span.className = "diff-add";
    } else if (line.startsWith("-")) {
      span.className = "diff-del";
    } else {
      span.className = "diff-ctx";
    }
    span.textContent = line;
    pre.appendChild(span);
    if (i < lines.length - 1) pre.appendChild(document.createTextNode("\n"));
  }
  return pre;
}

// --- Rewind timeline ---
function buildRewindTimeline() {
  removeRewindTimeline();

  var userMsgs = ctx.messagesEl.querySelectorAll(".msg-user[data-uuid]");
  if (userMsgs.length === 0) return;

  var timeline = document.createElement("div");
  timeline.className = "rewind-timeline";
  timeline.id = "rewind-timeline";

  var track = document.createElement("div");
  track.className = "rewind-timeline-track";

  var viewport = document.createElement("div");
  viewport.className = "rewind-timeline-viewport";
  track.appendChild(viewport);

  for (var i = 0; i < userMsgs.length; i++) {
    var msg = userMsgs[i];
    var pct = userMsgs.length === 1 ? 50 : 6 + (i / (userMsgs.length - 1)) * 88;

    var bubble = msg.querySelector(".bubble");
    var msgText = bubble ? bubble.textContent.trim() : "";
    if (msgText.length > 18) msgText = msgText.substring(0, 18) + "\u2026";

    var marker = document.createElement("div");
    marker.className = "rewind-timeline-marker";
    marker.innerHTML = '<i data-lucide="message-square"></i><span class="marker-text">' + escapeHtml(msgText) + '</span>';
    marker.style.top = pct + "%";
    marker.dataset.uuid = msg.dataset.uuid;
    marker.dataset.offsetTop = msg.offsetTop;

    (function(targetMsg, markerEl) {
      markerEl.addEventListener("click", function() {
        targetMsg.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    })(msg, marker);

    track.appendChild(marker);
  }

  timeline.appendChild(track);

  // Position timeline to align with messages area
  var appEl = ctx.$("app");
  var headerEl = ctx.$("header");
  var inputAreaEl = ctx.$("input-area");
  var appRect = appEl.getBoundingClientRect();
  var headerRect = headerEl.getBoundingClientRect();
  var inputRect = inputAreaEl.getBoundingClientRect();

  timeline.style.top = (headerRect.bottom - appRect.top + 4) + "px";
  timeline.style.bottom = (appRect.bottom - inputRect.top + 4) + "px";

  appEl.appendChild(timeline);
  refreshIcons();

  rewindScrollHandler = function() { updateTimelineViewport(track, viewport); };
  ctx.messagesEl.addEventListener("scroll", rewindScrollHandler);
  updateTimelineViewport(track, viewport);
}

function updateTimelineViewport(track, viewport) {
  if (!track) return;
  var scrollH = ctx.messagesEl.scrollHeight;
  var viewH = ctx.messagesEl.clientHeight;
  if (scrollH <= viewH) {
    viewport.style.top = "0";
    viewport.style.height = "100%";
  } else {
    var viewTop = ctx.messagesEl.scrollTop / scrollH;
    var viewBot = (ctx.messagesEl.scrollTop + viewH) / scrollH;
    viewport.style.top = (viewTop * 100) + "%";
    viewport.style.height = ((viewBot - viewTop) * 100) + "%";
  }

  var markers = track.querySelectorAll(".rewind-timeline-marker");
  var vTop = ctx.messagesEl.scrollTop;
  var vBot = vTop + viewH;

  for (var i = 0; i < markers.length; i++) {
    var msgTop = parseInt(markers[i].dataset.offsetTop, 10);
    if (msgTop >= vTop && msgTop <= vBot) {
      markers[i].classList.add("in-view");
    } else {
      markers[i].classList.remove("in-view");
    }
  }
}

function removeRewindTimeline() {
  var existing = document.getElementById("rewind-timeline");
  if (existing) existing.remove();
  if (rewindScrollHandler) {
    ctx.messagesEl.removeEventListener("scroll", rewindScrollHandler);
    rewindScrollHandler = null;
  }
}

export function initRewind(_ctx) {
  ctx = _ctx;

  rewindModal = ctx.$("rewind-modal");
  rewindSummary = ctx.$("rewind-summary");
  rewindFilesList = ctx.$("rewind-files-list");
  rewindConfirmBtn = ctx.$("rewind-confirm");
  rewindCancelBtn = ctx.$("rewind-cancel");

  // Click on user message bubble to rewind
  ctx.messagesEl.addEventListener("click", function(e) {
    var bubble = e.target.closest(".msg-user[data-uuid] .bubble");
    if (!bubble) return;
    var msgEl = bubble.closest(".msg-user[data-uuid]");
    if (msgEl) initiateRewind(msgEl.dataset.uuid);
  });

  rewindConfirmBtn.addEventListener("click", function() {
    if (pendingRewindUuid && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "rewind_execute", uuid: pendingRewindUuid }));
    }
    hideRewindModal();
  });

  rewindCancelBtn.addEventListener("click", hideRewindModal);
  rewindModal.querySelector(".confirm-backdrop").addEventListener("click", hideRewindModal);
}
