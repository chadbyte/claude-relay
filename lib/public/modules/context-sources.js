// Context Sources — attach terminal output (and future browser tabs) as context for Claude

var ctx = null;
var activeSourceIds = new Set();
var terminalList = []; // synced from terminal module's term_list

export function initContextSources(_ctx) {
  ctx = _ctx;

  var addBtn = document.getElementById("context-sources-add");
  var picker = document.getElementById("context-sources-picker");

  addBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    if (picker.classList.contains("hidden")) {
      renderPicker();
      picker.classList.remove("hidden");
      document.addEventListener("click", closePicker, true);
    } else {
      closePicker();
    }
  });

  picker.addEventListener("click", function(e) {
    e.stopPropagation();
  });
}

function closePicker() {
  var picker = document.getElementById("context-sources-picker");
  picker.classList.add("hidden");
  document.removeEventListener("click", closePicker, true);
}

// Restore state from server
export function handleContextSourcesState(msg) {
  var saved = msg.active || [];
  activeSourceIds = new Set(saved);
  renderChips();
}

// Save active sources to server
function saveToServer() {
  if (ctx && ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({
      type: "context_sources_save",
      active: Array.from(activeSourceIds)
    }));
  }
}

// Called when term_list arrives from server
export function updateTerminalList(terminals) {
  terminalList = terminals || [];

  // Remove active sources that no longer exist
  var changed = false;
  for (var id of activeSourceIds) {
    if (id.startsWith("term:")) {
      var termId = parseInt(id.split(":")[1], 10);
      var found = false;
      for (var i = 0; i < terminalList.length; i++) {
        if (terminalList[i].id === termId) { found = true; break; }
      }
      if (!found) {
        activeSourceIds.delete(id);
        changed = true;
      }
    }
  }

  if (changed) saveToServer();
  renderChips();

  // If picker is open, re-render it
  var picker = document.getElementById("context-sources-picker");
  if (!picker.classList.contains("hidden")) {
    renderPicker();
  }
}

function toggleSource(sourceId) {
  if (activeSourceIds.has(sourceId)) {
    activeSourceIds.delete(sourceId);
  } else {
    activeSourceIds.add(sourceId);
  }
  saveToServer();
  renderChips();
  renderPicker();
}

function removeSource(sourceId) {
  activeSourceIds.delete(sourceId);
  saveToServer();
  renderChips();

  var picker = document.getElementById("context-sources-picker");
  if (!picker.classList.contains("hidden")) {
    renderPicker();
  }
}

function renderChips() {
  var container = document.getElementById("context-sources-chips");
  container.innerHTML = "";

  for (var id of activeSourceIds) {
    var chip = document.createElement("div");
    chip.className = "context-chip";

    var label = getSourceLabel(id);
    var iconName = getSourceIcon(id);

    var labelEl = document.createElement("span");
    labelEl.className = "context-chip-label";
    labelEl.innerHTML =
      '<i data-lucide="' + iconName + '"></i>' +
      '<span>' + escapeHtml(label) + '</span>';
    chip.appendChild(labelEl);

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "context-chip-remove";
    removeBtn.title = "Remove";
    removeBtn.innerHTML = '<i data-lucide="minus"></i>';
    removeBtn.setAttribute("data-source-id", id);
    removeBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      removeSource(this.getAttribute("data-source-id"));
      if (typeof lucide !== "undefined") lucide.createIcons();
    });

    chip.appendChild(removeBtn);
    container.appendChild(chip);
  }

  // Update add button label
  var addBtn = document.getElementById("context-sources-add");
  var labelSpan = addBtn.querySelector("span");
  if (activeSourceIds.size > 0) {
    labelSpan.textContent = "";
    labelSpan.style.display = "none";
  } else {
    labelSpan.textContent = "Context Sources";
    labelSpan.style.display = "";
  }

  if (typeof lucide !== "undefined") lucide.createIcons();
}

function renderPicker() {
  var section = document.getElementById("context-picker-terminals");
  section.innerHTML = "";

  var sectionLabel = document.createElement("div");
  sectionLabel.className = "context-picker-section-label";
  sectionLabel.textContent = "Terminals";
  section.appendChild(sectionLabel);

  if (terminalList.length === 0) {
    var empty = document.createElement("div");
    empty.className = "context-picker-empty";
    empty.textContent = "No terminals open";
    section.appendChild(empty);
    return;
  }

  for (var i = 0; i < terminalList.length; i++) {
    var term = terminalList[i];
    var sourceId = "term:" + term.id;
    var isActive = activeSourceIds.has(sourceId);

    var item = document.createElement("div");
    item.className = "context-picker-item" + (isActive ? " active" : "");
    item.setAttribute("data-source-id", sourceId);

    item.innerHTML =
      '<i data-lucide="square-terminal"></i>' +
      '<span>' + escapeHtml(term.title || ("Terminal " + term.id)) + '</span>' +
      '<i data-lucide="check" class="context-picker-check"></i>';

    item.addEventListener("click", function() {
      toggleSource(this.getAttribute("data-source-id"));
      if (typeof lucide !== "undefined") lucide.createIcons();
    });

    section.appendChild(item);
  }

  if (typeof lucide !== "undefined") lucide.createIcons();
}

function getSourceLabel(id) {
  if (id.startsWith("term:")) {
    var termId = parseInt(id.split(":")[1], 10);
    for (var i = 0; i < terminalList.length; i++) {
      if (terminalList[i].id === termId) {
        return terminalList[i].title || ("Terminal " + termId);
      }
    }
    return "Terminal " + termId;
  }
  return id;
}

function getSourceIcon(id) {
  if (id.startsWith("term:")) return "square-terminal";
  return "circle";
}

// Get active source IDs (for use when sending messages)
export function getActiveSources() {
  return Array.from(activeSourceIds);
}

// Check if any sources are active
export function hasActiveSources() {
  return activeSourceIds.size > 0;
}

function escapeHtml(str) {
  var div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
