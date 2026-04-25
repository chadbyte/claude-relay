import { avatarUrl, userAvatarUrl, mateAvatarUrl } from './avatar.js';
import { escapeHtml } from './utils.js';
import { refreshIcons } from './icons.js';
import { openSearch as openSessionSearch } from './session-search.js';

function formatRelativeDate(ts) {
  if (!ts) return "";
  var now = Date.now();
  var diff = now - ts;
  if (diff < 0) diff = 0;
  var sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  var min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  var days = Math.floor(hr / 24);
  if (days < 7) return days + "d ago";
  if (days < 30) return Math.floor(days / 7) + "w ago";
  var d = new Date(ts);
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

var ctx;
var paletteEl = null;
var inputEl = null;
var resultsEl = null;
var footerEl = null;
var activeIndex = -1;
var items = [];
var debounceTimer = null;
var abortCtrl = null;
var pendingNav = null;
var cachedHomeData = null;
var cachedVersion = null;

// --- Commands registry ---
var commands = [
  { id: "create-mate", label: "Create Mate", desc: "Create a new AI teammate", icon: "user-plus", action: "createMate" },
  { id: "settings", label: "Server settings", desc: "Configure server", icon: "settings", action: "openSettings" },
];

export function initCommandPalette(_ctx) {
  ctx = _ctx;
  buildDOM();
  // Top bar search bar trigger
  var hintBtn = document.getElementById("cmd-palette-btn");
  if (hintBtn) {
    var isMac = navigator.platform.indexOf("Mac") !== -1;
    var kbdEl = hintBtn.querySelector(".cmd-palette-searchbar-kbd");
    if (kbdEl) kbdEl.textContent = isMac ? "\u2318K" : "Ctrl+K";
    hintBtn.addEventListener("click", function () {
      if (isCommandPaletteOpen()) {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
    });
  }
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      if (isCommandPaletteOpen()) {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
    }
  });
}

export function isCommandPaletteOpen() {
  return paletteEl && !paletteEl.classList.contains("hidden");
}

export function openCommandPalette() {
  if (!paletteEl) return;
  paletteEl.classList.remove("hidden");
  var searchbar = document.getElementById("cmd-palette-btn");
  if (searchbar) searchbar.style.visibility = "hidden";
  inputEl.value = "";
  inputEl.placeholder = "Type a command or search...";
  activeIndex = -1;
  items = [];
  resultsEl.innerHTML = '<div class="cmd-palette-loading">Loading...</div>';
  updateFooter();
  inputEl.focus();
  fetchHomeData();
}

export function closeCommandPalette() {
  if (!paletteEl) return;
  paletteEl.classList.add("hidden");
  var searchbar = document.getElementById("cmd-palette-btn");
  if (searchbar) searchbar.style.visibility = "";
  inputEl.value = "";
  resultsEl.innerHTML = "";
  items = [];
  activeIndex = -1;
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
}

export function setPaletteVersion(version) {
  cachedVersion = version;
}

export function handlePaletteSessionSwitch() {
  if (!pendingNav) return;
  var nav = pendingNav;
  pendingNav = null;
  if (ctx.currentSlug && ctx.currentSlug() === nav.slug) {
    ctx.selectSession(nav.sessionId);
    if (nav.query) {
      setTimeout(function () { openSessionSearch(nav.query); }, 400);
    }
  }
}

function buildDOM() {
  paletteEl = document.createElement("div");
  paletteEl.className = "cmd-palette hidden";
  paletteEl.innerHTML =
    '<div class="cmd-palette-backdrop"></div>' +
    '<div class="cmd-palette-dialog">' +
      '<div class="cmd-palette-input-row">' +
        '<i data-lucide="search"></i>' +
        '<input class="cmd-palette-input" type="text" placeholder="Type a command or search..." autocomplete="off" spellcheck="false" />' +
        '<span class="cmd-palette-kbd" id="cmd-palette-close"><i data-lucide="x"></i></span>' +
      '</div>' +
      '<div class="cmd-palette-results"></div>' +
      '<div class="cmd-palette-footer"></div>' +
    '</div>';

  document.body.appendChild(paletteEl);
  refreshIcons();

  inputEl = paletteEl.querySelector(".cmd-palette-input");
  resultsEl = paletteEl.querySelector(".cmd-palette-results");
  footerEl = paletteEl.querySelector(".cmd-palette-footer");

  paletteEl.querySelector(".cmd-palette-backdrop").addEventListener("click", function () {
    closeCommandPalette();
  });

  paletteEl.querySelector("#cmd-palette-close").addEventListener("click", function () {
    closeCommandPalette();
  });

  inputEl.addEventListener("input", function () {
    var q = inputEl.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    renderHome(q.trim());
    if (q.trim()) {
      debounceTimer = setTimeout(function () {
        fetchHomeSearchResults(q.trim());
      }, 300);
    }
  });

  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(activeIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIndex - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < items.length) {
        activateItem(items[activeIndex]);
      }
      return;
    }
  });

  paletteEl.querySelector(".cmd-palette-dialog").addEventListener("click", function (e) {
    e.stopPropagation();
  });
}

function updateFooter() {
  var shortcuts =
    '<span><kbd>&uarr;</kbd> <kbd>&darr;</kbd> navigate</span>' +
    '<span><kbd>Enter</kbd> select</span>';
  var versionText = cachedVersion ? "v" + cachedVersion : "";
  footerEl.innerHTML =
    '<a href="https://github.com/chadbyte/clay" target="_blank" rel="noopener" class="cmd-palette-brand"><img src="favicon-banded.png" width="13" height="13" alt="">Clay ' + versionText + '</a>' +
    '<span class="cmd-palette-footer-shortcuts">' + shortcuts + '</span>';
}

// ==========================================
// HOME MODE: commands + recent sessions + projects
// ==========================================

function fetchHomeData() {
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
  abortCtrl = new AbortController();
  fetch("/api/palette/search", { signal: abortCtrl.signal })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      abortCtrl = null;
      cachedHomeData = data.results || [];
      renderHome("");
    })
    .catch(function (err) {
      if (err.name === "AbortError") return;
      abortCtrl = null;
      cachedHomeData = [];
      renderHome("");
    });
}

function findMateById(mateId) {
  if (!mateId || !ctx.matesList) return null;
  var mates = ctx.matesList();
  for (var i = 0; i < mates.length; i++) {
    if (mates[i].id === mateId) return mates[i];
  }
  return null;
}

function renderHome(filter) {
  var f = (filter || "").toLowerCase();
  items = [];
  var html = "";
  var flatIndex = 0;

  // --- Commands ---
  var filteredCmds = commands.filter(function (c) {
    if (!f) return true;
    return c.label.toLowerCase().indexOf(f) !== -1 || c.desc.toLowerCase().indexOf(f) !== -1;
  });
  if (filteredCmds.length > 0) {
    html += '<div class="cmd-palette-group-label">Commands</div>';
    for (var i = 0; i < filteredCmds.length; i++) {
      var cmd = filteredCmds[i];
      items.push({ type: "command", data: cmd });
      html += renderItem(flatIndex, '<i data-lucide="' + cmd.icon + '"></i>', cmd.label, cmd.desc, null);
      flatIndex++;
    }
  }

  // --- Recent sessions ---
  var recentSessions = (cachedHomeData || []);
  if (f) {
    recentSessions = recentSessions.filter(function (s) {
      return (s.sessionTitle || "").toLowerCase().indexOf(f) !== -1 ||
        (s.projectTitle || "").toLowerCase().indexOf(f) !== -1;
    });
  }
  var maxRecent = f ? 10 : 5;
  if (recentSessions.length > maxRecent) recentSessions = recentSessions.slice(0, maxRecent);
  if (recentSessions.length > 0) {
    html += '<div class="cmd-palette-group-label">Recent</div>';
    for (var r = 0; r < recentSessions.length; r++) {
      var s = recentSessions[r];
      items.push({ type: s.isMate ? "mate-session" : "session", data: s });
      var iconHtml;
      if (s.isMate) {
        var mate = findMateById(s.mateId);
        if (mate) {
          var avUrl = mateAvatarUrl(mate, 28);
          iconHtml = '<img src="' + avUrl + '" width="28" height="28" style="border-radius:50%;" alt="">';
        } else {
          iconHtml = '<i data-lucide="bot"></i>';
        }
      } else {
        iconHtml = s.projectIcon || '<i data-lucide="message-square"></i>';
      }
      var projLabel = (s.projectIcon || "") + " " + escapeHtml(s.projectTitle || s.projectSlug);
      html += renderItem(flatIndex, iconHtml, escapeHtml(s.sessionTitle || "New Session"), projLabel.trim(), null, s.lastActivity);
      flatIndex++;
    }
  }

  // --- Users (DM) ---
  var allUsers = ctx.allUsers ? ctx.allUsers() : [];
  var dmConversations = ctx.dmConversations ? ctx.dmConversations() : [];
  var myId = ctx.myUserId ? ctx.myUserId() : null;
  // Show recent DM conversations first, then filter all users when searching
  var userList = [];
  if (f) {
    userList = allUsers.filter(function (u) {
      if (u.id === myId) return false;
      var name = (u.displayName || u.username || "").toLowerCase();
      return name.indexOf(f) !== -1;
    });
  } else {
    // Recent conversations only
    for (var di = 0; di < dmConversations.length && di < 5; di++) {
      var dmUserId = dmConversations[di];
      for (var ai = 0; ai < allUsers.length; ai++) {
        if (allUsers[ai].id === dmUserId && dmUserId !== myId) {
          userList.push(allUsers[ai]);
          break;
        }
      }
    }
  }
  if (userList.length > 0) {
    html += '<div class="cmd-palette-group-label">' + (f ? "Users" : "Recent conversations") + '</div>';
    for (var ui = 0; ui < userList.length; ui++) {
      var user = userList[ui];
      items.push({ type: "user", data: user });
      var userName = escapeHtml(user.displayName || user.username);
      var userSub = user.username ? "@" + escapeHtml(user.username) : "";
      var uAvatarUrl = userAvatarUrl(user, 28);
      var uAvatarHtml = '<img src="' + uAvatarUrl + '" width="28" height="28" style="border-radius:50%;" alt="">';
      html += renderItem(flatIndex, uAvatarHtml, userName, userSub, null);
      flatIndex++;
    }
  }

  // --- Mates ---
  var matesList = ctx.matesList ? ctx.matesList() : [];
  var filteredMates = matesList.filter(function (m) {
    if (!f) return true;
    var mp = m.profile || {};
    var name = (mp.displayName || m.name || "").toLowerCase();
    return name.indexOf(f) !== -1;
  });
  if (filteredMates.length > 0) {
    html += '<div class="cmd-palette-group-label">Mates</div>';
    for (var mi = 0; mi < filteredMates.length; mi++) {
      var mate = filteredMates[mi];
      var mp = mate.profile || {};
      items.push({ type: "mate", data: mate });
      var mateName = escapeHtml(mp.displayName || mate.name || "Mate");
      var mateAvUrl = mateAvatarUrl(mate, 28);
      var avatarHtml = '<img src="' + mateAvUrl + '" width="28" height="28" style="border-radius:50%;" alt="">';
      html += renderItem(flatIndex, avatarHtml, mateName, null, null);
      flatIndex++;
    }
  }

  // --- Projects ---
  var projectList = ctx.projectList ? ctx.projectList() : [];
  var filteredProjects = projectList.filter(function (p) {
    if (p.isMate) return false;
    if (p.isWorktree) return false;
    if (!f) return true;
    var name = (p.title || p.project || p.slug || "").toLowerCase();
    return name.indexOf(f) !== -1;
  });
  if (filteredProjects.length > 0) {
    html += '<div class="cmd-palette-group-label">Projects</div>';
    for (var j = 0; j < filteredProjects.length; j++) {
      var proj = filteredProjects[j];
      items.push({ type: "project", data: proj });
      var pName = escapeHtml(proj.title || proj.project || proj.slug);
      var sessLabel = proj.sessions ? proj.sessions + " sessions" : "";
      html += renderItem(flatIndex, proj.icon || '<i data-lucide="box"></i>', pName, sessLabel, null);
      flatIndex++;
    }
  }

  if (items.length === 0 && !f) {
    html = '<div class="cmd-palette-empty">No matching results</div>';
  }

  resultsEl.innerHTML = html;
  activeIndex = -1;
  refreshIcons();
  bindItemEvents();
}

// ==========================================
// HOME MODE: inline session search (server-side)
// ==========================================

var homeSearchQuery = "";

function fetchHomeSearchResults(query) {
  homeSearchQuery = query;
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
  abortCtrl = new AbortController();
  fetch("/api/palette/search?q=" + encodeURIComponent(query), { signal: abortCtrl.signal })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      abortCtrl = null;
      if (homeSearchQuery !== query) return;
      appendHomeSearchResults(data.results || [], query);
    })
    .catch(function (err) {
      if (err.name === "AbortError") return;
      abortCtrl = null;
    });
}

function appendHomeSearchResults(results, query) {
  if (results.length === 0) return;

  // Deduplicate: exclude sessions already shown in the Recent section
  var existingIds = {};
  for (var e = 0; e < items.length; e++) {
    if (items[e].type === "session" && items[e].data.sessionId) {
      existingIds[items[e].data.projectSlug + ":" + items[e].data.sessionId] = true;
    }
  }
  var newResults = results.filter(function (r) {
    return !existingIds[r.projectSlug + ":" + r.sessionId];
  });
  if (newResults.length === 0) return;

  // Remove "No matching results" if present
  var emptyEl = resultsEl.querySelector(".cmd-palette-empty");
  if (emptyEl) emptyEl.remove();

  // Build HTML and append
  var html = '<div class="cmd-palette-group-label cmd-palette-search-results-label">Session search results</div>';
  var flatIndex = items.length;
  for (var i = 0; i < newResults.length; i++) {
    var r = newResults[i];
    items.push({ type: r.isMate ? "mate-session" : "search-result", data: r, query: query });
    var srIconHtml;
    if (r.isMate) {
      var srMate = findMateById(r.mateId);
      if (srMate) {
        var srAvUrl = mateAvatarUrl(srMate, 28);
        srIconHtml = '<img src="' + srAvUrl + '" width="28" height="28" style="border-radius:50%;" alt="">';
      } else {
        srIconHtml = '<i data-lucide="bot"></i>';
      }
    } else {
      srIconHtml = r.projectIcon || '<i data-lucide="message-square"></i>';
    }
    var projLabel = (r.projectIcon || "") + " " + escapeHtml(r.projectTitle || r.projectSlug);
    var snippet = r.snippet ? escapeHtml(r.snippet) : "";
    html += renderItem(flatIndex, srIconHtml, escapeHtml(r.sessionTitle || "New Session"), projLabel.trim(), snippet, r.lastActivity);
    flatIndex++;
  }

  // Append to results
  var frag = document.createElement("div");
  frag.innerHTML = html;
  while (frag.firstChild) {
    resultsEl.appendChild(frag.firstChild);
  }
  refreshIcons();
  bindItemEvents();
}

// ==========================================
// Shared rendering / interaction helpers
// ==========================================

function renderItem(index, iconContent, title, desc, snippet, timestamp) {
  var dateStr = formatRelativeDate(timestamp);
  return '<div class="cmd-palette-item" data-index="' + index + '">' +
    '<div class="cmd-palette-item-icon">' + iconContent + '</div>' +
    '<div class="cmd-palette-item-body">' +
      '<div class="cmd-palette-item-title-row">' +
        '<span class="cmd-palette-item-title">' + title + '</span>' +
        (dateStr ? '<span class="cmd-palette-item-date">' + dateStr + '</span>' : '') +
      '</div>' +
      (desc || snippet ?
        '<div class="cmd-palette-item-meta">' +
          (desc ? '<span class="cmd-palette-item-project">' + desc + '</span>' : '') +
          (snippet ? '<span class="cmd-palette-item-snippet">' + snippet + '</span>' : '') +
        '</div>'
      : '') +
    '</div>' +
    '<div class="cmd-palette-item-arrow"><i data-lucide="arrow-right"></i></div>' +
  '</div>';
}

function bindItemEvents() {
  var itemEls = resultsEl.querySelectorAll(".cmd-palette-item");
  for (var k = 0; k < itemEls.length; k++) {
    (function (el) {
      el.addEventListener("click", function () {
        var idx = parseInt(el.getAttribute("data-index"), 10);
        if (idx >= 0 && idx < items.length) activateItem(items[idx]);
      });
      el.addEventListener("mouseenter", function () {
        var idx = parseInt(el.getAttribute("data-index"), 10);
        setActive(idx, true);
      });
    })(itemEls[k]);
  }
}

function setActive(idx, skipScroll) {
  if (items.length === 0) return;
  if (idx < 0) idx = items.length - 1;
  if (idx >= items.length) idx = 0;
  activeIndex = idx;

  var els = resultsEl.querySelectorAll(".cmd-palette-item");
  for (var i = 0; i < els.length; i++) {
    els[i].classList.toggle("active", i === idx);
  }
  if (!skipScroll && els[idx]) {
    els[idx].scrollIntoView({ block: "nearest" });
  }
}

function activateItem(entry) {
  if (entry.type === "command") {
    executeCommand(entry.data);
  } else if (entry.type === "mate-session") {
    closeCommandPalette();
    // Open mate DM, then select the specific session after connection
    if (entry.data.mateId && ctx.openDm) {
      pendingNav = { slug: entry.data.projectSlug, sessionId: entry.data.sessionId, query: entry.query || null };
      ctx.openDm(entry.data.mateId);
    }
  } else if (entry.type === "session" || entry.type === "search-result") {
    navigateToSession(entry.data, entry.query || null);
  } else if (entry.type === "project") {
    closeCommandPalette();
    ctx.switchProject(entry.data.slug);
  } else if (entry.type === "mate" || entry.type === "user") {
    closeCommandPalette();
    ctx.openDm(entry.data.id);
  }
}

function executeCommand(cmd) {
  closeCommandPalette();
  switch (cmd.action) {
    case "createMate":
      ctx.runAction("createMate");
      break;
    case "openSettings":
      ctx.runAction("openSettings");
      break;
  }
}

function navigateToSession(item, query) {
  closeCommandPalette();
  var slug = item.projectSlug;
  var sessionId = item.sessionId;

  if (ctx.currentSlug && ctx.currentSlug() === slug) {
    ctx.selectSession(sessionId);
    if (query) {
      setTimeout(function () { openSessionSearch(query); }, 400);
    }
  } else {
    pendingNav = { slug: slug, sessionId: sessionId, query: query };
    ctx.switchProject(slug);
  }
}
