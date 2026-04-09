// Context Sources — attach terminal output and browser tabs as context for Claude

var ctx = null;
var activeSourceIds = new Set();
var terminalList = []; // synced from terminal module's term_list
var browserTabList = []; // synced from Chrome extension via postMessage

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

// Called when Chrome extension sends tab list via postMessage
export function updateBrowserTabList(tabs) {
  browserTabList = tabs || [];

  // Remove active tab sources that no longer exist
  var changed = false;
  for (var id of activeSourceIds) {
    if (id.startsWith("tab:")) {
      var tabId = parseInt(id.split(":")[1], 10);
      var found = false;
      for (var i = 0; i < browserTabList.length; i++) {
        if (browserTabList[i].id === tabId) { found = true; break; }
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
  // --- Terminals section ---
  var termSection = document.getElementById("context-picker-terminals");
  termSection.innerHTML = "";

  var termLabel = document.createElement("div");
  termLabel.className = "context-picker-section-label";
  termLabel.textContent = "Terminals";
  termSection.appendChild(termLabel);

  if (terminalList.length === 0) {
    var termEmpty = document.createElement("div");
    termEmpty.className = "context-picker-empty";
    termEmpty.textContent = "No terminals open";
    termSection.appendChild(termEmpty);
  } else {
    for (var i = 0; i < terminalList.length; i++) {
      var term = terminalList[i];
      var termSourceId = "term:" + term.id;
      var termActive = activeSourceIds.has(termSourceId);

      var termItem = document.createElement("div");
      termItem.className = "context-picker-item" + (termActive ? " active" : "");
      termItem.setAttribute("data-source-id", termSourceId);

      termItem.innerHTML =
        '<i data-lucide="square-terminal"></i>' +
        '<span>' + escapeHtml(term.title || ("Terminal " + term.id)) + '</span>' +
        '<i data-lucide="check" class="context-picker-check"></i>';

      termItem.addEventListener("click", function() {
        toggleSource(this.getAttribute("data-source-id"));
        if (typeof lucide !== "undefined") lucide.createIcons();
      });

      termSection.appendChild(termItem);
    }
  }

  // --- Browser Tabs section ---
  var tabSection = document.getElementById("context-picker-tabs");
  tabSection.innerHTML = "";

  var tabLabel = document.createElement("div");
  tabLabel.className = "context-picker-section-label";
  tabLabel.textContent = "Browser Tabs";
  tabSection.appendChild(tabLabel);

  if (browserTabList.length === 0) {
    // Extension not connected: show notice with setup button
    var notice = document.createElement("div");
    notice.className = "context-picker-ext-notice";
    notice.innerHTML =
      '<span class="context-picker-ext-notice-text">Chrome extension required to access browser tabs.</span>' +
      '<button class="context-picker-ext-btn" type="button"><i data-lucide="puzzle"></i> Setup Extension</button>';
    var setupBtn = notice.querySelector(".context-picker-ext-btn");
    setupBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closePicker();
      var extPill = document.getElementById("ext-pill");
      if (extPill) extPill.click();
    });
    tabSection.appendChild(notice);
  } else {
    for (var j = 0; j < browserTabList.length; j++) {
      var tab = browserTabList[j];
      var tabSourceId = "tab:" + tab.id;
      var tabActive = activeSourceIds.has(tabSourceId);

      var tabItem = document.createElement("div");
      tabItem.className = "context-picker-item" + (tabActive ? " active" : "");
      tabItem.setAttribute("data-source-id", tabSourceId);

      var tabTitle = tab.title || tab.url || "Tab";
      // Truncate long URLs for display
      var tabDisplay = tabTitle.length > 50 ? tabTitle.slice(0, 47) + "..." : tabTitle;

      var faviconHtml = "";
      if (tab.favIconUrl) {
        faviconHtml = '<img src="' + escapeHtml(tab.favIconUrl) + '" class="context-picker-favicon" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'\'">' +
          '<i data-lucide="globe" style="display:none"></i>';
      } else {
        faviconHtml = '<i data-lucide="globe"></i>';
      }

      tabItem.innerHTML =
        faviconHtml +
        '<span title="' + escapeHtml(tab.url || "") + '">' + escapeHtml(tabDisplay) + '</span>' +
        '<i data-lucide="check" class="context-picker-check"></i>';

      tabItem.addEventListener("click", function() {
        toggleSource(this.getAttribute("data-source-id"));
        if (typeof lucide !== "undefined") lucide.createIcons();
      });

      tabSection.appendChild(tabItem);
    }
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
  if (id.startsWith("tab:")) {
    var tabId = parseInt(id.split(":")[1], 10);
    for (var j = 0; j < browserTabList.length; j++) {
      if (browserTabList[j].id === tabId) {
        var title = browserTabList[j].title || browserTabList[j].url || "";
        return title.length > 30 ? title.slice(0, 27) + "..." : title;
      }
    }
    return "Tab " + tabId;
  }
  return id;
}

function getSourceIcon(id) {
  if (id.startsWith("term:")) return "square-terminal";
  if (id.startsWith("tab:")) return "globe";
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
