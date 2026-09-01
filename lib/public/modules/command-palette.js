import { mateAvatarUrl } from './avatar.js';
import { escapeHtml } from './utils.js';
import { refreshIcons } from './icons.js';
import { openSearch as openSessionSearch } from './session-search.js';
import { showHomeHub } from './app-home-hub.js';
import { openHomeConversation } from './home-mate-chat.js';
import { startSearchClayChat, attachSearchClayChat, detachSearchClayChat } from './search-clay-chat.js';

function formatRelativeDate(ts) {
  if (!ts) return "";
  var diff = Math.max(0, Date.now() - ts);
  var min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
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
var paletteEl = null, inputEl = null, resultsEl = null, footerEl = null;
var activeIndex = -1, items = [], debounceTimer = null, abortCtrl = null;
var pendingNav = null, cachedHomeData = [], cachedVersion = null;
var searchResults = [], searchQuery = "", searchPending = false, chatMode = false;

export function initCommandPalette(value) {
  ctx = value;
  buildDOM();
  var trigger = document.getElementById("cmd-palette-btn");
  if (trigger) {
    var isMac = navigator.platform.indexOf("Mac") !== -1;
    var kbd = trigger.querySelector(".cmd-palette-searchbar-kbd");
    if (kbd) kbd.textContent = isMac ? "\u2318K" : "Ctrl+K";
    trigger.addEventListener("click", function () { if (isCommandPaletteOpen()) closeCommandPalette(); else openCommandPalette(); });
  }
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      if (isCommandPaletteOpen()) closeCommandPalette(); else openCommandPalette();
    }
  });
}

export function isCommandPaletteOpen() { return paletteEl && !paletteEl.classList.contains("hidden"); }

export function openCommandPalette() {
  if (!paletteEl) return;
  paletteEl.classList.remove("hidden");
  var trigger = document.getElementById("cmd-palette-btn");
  if (trigger) trigger.style.visibility = "hidden";
  updateFooter();
  if (chatMode && attachSearchClayChat(resultsEl, showSearch, closeCommandPalette)) {
    paletteEl.classList.add("is-chatting");
    return;
  }
  showSearch();
  fetchHomeData();
}

export function closeCommandPalette() {
  if (!paletteEl) return;
  paletteEl.classList.add("hidden");
  var trigger = document.getElementById("cmd-palette-btn");
  if (trigger) trigger.style.visibility = "";
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
  detachSearchClayChat();
}

export function setPaletteVersion(version) { cachedVersion = version; }

export function handlePaletteSessionSwitch() {
  if (!pendingNav) return;
  var nav = pendingNav;
  pendingNav = null;
  if (ctx.currentSlug && ctx.currentSlug() === nav.slug) {
    ctx.selectSession(nav.sessionId);
    if (nav.query) setTimeout(function () { openSessionSearch(nav.query); }, 400);
  }
}

function buildDOM() {
  paletteEl = document.createElement("div");
  paletteEl.className = "cmd-palette hidden";
  paletteEl.innerHTML =
    '<div class="cmd-palette-backdrop"></div>' +
    '<div class="cmd-palette-dialog" role="dialog" aria-label="Search or ask Clay">' +
      '<div class="cmd-palette-input-row">' +
        '<img class="cmd-palette-input-brand" src="/clay-studio-symbol.png" width="22" height="22" alt="">' +
        '<i data-lucide="search" aria-hidden="true"></i>' +
        '<input class="cmd-palette-input" type="text" placeholder="Search conversations, or ask Clay…" autocomplete="off" spellcheck="false" />' +
        '<button type="button" class="cmd-palette-kbd" id="cmd-palette-close" aria-label="Close search"><i data-lucide="x"></i></button>' +
      '</div>' +
      '<div class="cmd-palette-results"></div>' +
      '<div class="cmd-palette-footer"></div>' +
    '</div>';
  document.body.appendChild(paletteEl);
  refreshIcons();
  inputEl = paletteEl.querySelector(".cmd-palette-input");
  resultsEl = paletteEl.querySelector(".cmd-palette-results");
  footerEl = paletteEl.querySelector(".cmd-palette-footer");
  paletteEl.querySelector(".cmd-palette-backdrop").addEventListener("click", closeCommandPalette);
  paletteEl.querySelector("#cmd-palette-close").addEventListener("click", closeCommandPalette);
  inputEl.addEventListener("input", function () {
    var query = inputEl.value.trim();
    searchQuery = query;
    searchResults = [];
    searchPending = !!query;
    renderSearch();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (query) debounceTimer = setTimeout(function () { fetchHomeSearchResults(query); }, 250);
  });
  inputEl.addEventListener("keydown", function (event) {
    if (event.key === "Escape") { event.preventDefault(); closeCommandPalette(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(activeIndex + 1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive(activeIndex - 1); return; }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < items.length) activateItem(items[activeIndex]);
      else if (inputEl.value.trim()) beginClayChat(inputEl.value.trim());
    }
  });
  paletteEl.querySelector(".cmd-palette-dialog").addEventListener("click", function (event) { event.stopPropagation(); });
}

function showSearch() {
  chatMode = false;
  paletteEl.classList.remove("is-chatting");
  inputEl.value = searchQuery;
  inputEl.disabled = false;
  inputEl.focus({ preventScroll: true });
  renderSearch();
}

function updateFooter() {
  var version = cachedVersion ? " v" + cachedVersion : "";
  footerEl.innerHTML = '<a href="https://github.com/chadbyte/clay" target="_blank" rel="noopener" class="cmd-palette-brand"><img src="clay-studio-symbol.png" width="13" height="13" alt="">Clay Studio' + version + '</a><span class="cmd-palette-footer-shortcuts"><span><kbd>&uarr;</kbd> <kbd>&darr;</kbd> navigate</span><span><kbd>Enter</kbd> open or ask</span></span>';
}

function fetchHomeData() {
  if (cachedHomeData.length) { renderSearch(); return; }
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();
  fetch("/api/palette/search", { signal: abortCtrl.signal }).then(function (res) { return res.json(); }).then(function (data) {
    abortCtrl = null;
    cachedHomeData = data.results || [];
    renderSearch();
  }).catch(function (error) {
    if (error.name === "AbortError") return;
    abortCtrl = null;
    cachedHomeData = [];
    renderSearch();
  });
}

function fetchHomeSearchResults(query) {
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();
  fetch("/api/palette/search?q=" + encodeURIComponent(query), { signal: abortCtrl.signal }).then(function (res) { return res.json(); }).then(function (data) {
    abortCtrl = null;
    if (searchQuery !== query) return;
    searchResults = data.results || [];
    searchPending = false;
    renderSearch();
  }).catch(function (error) {
    if (error.name === "AbortError") return;
    abortCtrl = null;
    if (searchQuery !== query) return;
    searchPending = false;
    renderSearch();
  });
}

function findMate(mateId) {
  var mates = ctx.matesList ? ctx.matesList() : [];
  for (var i = 0; i < mates.length; i++) if (mates[i] && mates[i].id === mateId) return mates[i];
  return null;
}

function sessionKey(session) { return (session.projectSlug || "") + ":" + (session.sessionId || ""); }

function sessionIcon(session) {
  if (session.isMate) {
    var mate = findMate(session.mateId);
    if (mate) return '<img src="' + mateAvatarUrl(mate, 28) + '" width="28" height="28" alt="">';
    return '<i data-lucide="bot"></i>';
  }
  return session.projectIcon || '<i data-lucide="message-square"></i>';
}

function renderSearch() {
  if (chatMode) return;
  var query = searchQuery.toLowerCase();
  var sessions = query ? cachedHomeData.filter(function (item) {
    return (item.sessionTitle || "").toLowerCase().indexOf(query) !== -1 || (item.projectTitle || "").toLowerCase().indexOf(query) !== -1;
  }) : cachedHomeData.slice(0, 5);
  var seen = {};
  for (var i = 0; i < sessions.length; i++) seen[sessionKey(sessions[i])] = true;
  for (var r = 0; r < searchResults.length; r++) if (!seen[sessionKey(searchResults[r])]) { sessions.push(searchResults[r]); seen[sessionKey(searchResults[r])] = true; }
  items = [];
  var html = "", index = 0;
  if (sessions.length) {
    html += '<div class="cmd-palette-group-label">' + (query ? "Conversations" : "Recent conversations") + '</div>';
    for (var s = 0; s < sessions.length; s++) {
      var session = sessions[s];
      items.push({ type: session.isMate ? "mate-session" : "session", data: session, query: query ? searchQuery : null });
      var project = escapeHtml(session.projectTitle || session.projectSlug || "");
      var snippet = session.snippet ? escapeHtml(session.snippet) : null;
      html += renderItem(index++, sessionIcon(session), escapeHtml(session.sessionTitle || "New Chat"), project, snippet, session.lastActivity, "");
    }
  }
  if (query) {
    items.push({ type: "ask-clay", query: searchQuery });
    if (!sessions.length && !searchPending) html += '<div class="cmd-palette-exact-empty">No exact matches. Clay can search by meaning.</div>';
    html += '<div class="cmd-palette-group-label">Ask Clay</div>';
    html += renderItem(index, '<img src="/clay-studio-symbol.png" width="22" height="22" alt="">', 'Ask Clay about “' + escapeHtml(searchQuery) + '”', "Search by meaning across your projects and conversations", null, null, " is-ask-clay");
  }
  if (!html) html = '<div class="cmd-palette-empty">No conversations yet.</div>';
  resultsEl.innerHTML = html;
  activeIndex = -1;
  refreshIcons();
  bindItemEvents();
}

function renderItem(index, icon, title, desc, snippet, timestamp, extraClass) {
  var date = formatRelativeDate(timestamp);
  return '<button type="button" class="cmd-palette-item' + extraClass + '" data-index="' + index + '"><span class="cmd-palette-item-icon">' + icon + '</span><span class="cmd-palette-item-body"><span class="cmd-palette-item-title-row"><span class="cmd-palette-item-title">' + title + '</span>' + (date ? '<span class="cmd-palette-item-date">' + date + '</span>' : '') + '</span>' + (desc || snippet ? '<span class="cmd-palette-item-meta">' + (desc ? '<span class="cmd-palette-item-project">' + desc + '</span>' : '') + (snippet ? '<span class="cmd-palette-item-snippet">' + snippet + '</span>' : '') + '</span>' : '') + '</span><span class="cmd-palette-item-arrow"><i data-lucide="arrow-right"></i></span></button>';
}

function bindItemEvents() {
  var elements = resultsEl.querySelectorAll(".cmd-palette-item");
  for (var i = 0; i < elements.length; i++) (function (element) {
    element.addEventListener("click", function () { var index = parseInt(element.dataset.index, 10); if (items[index]) activateItem(items[index]); });
    element.addEventListener("mouseenter", function () { setActive(parseInt(element.dataset.index, 10), true); });
  })(elements[i]);
}

function setActive(index, skipScroll) {
  if (!items.length) return;
  if (index < 0) index = items.length - 1;
  if (index >= items.length) index = 0;
  activeIndex = index;
  var elements = resultsEl.querySelectorAll(".cmd-palette-item");
  for (var i = 0; i < elements.length; i++) elements[i].classList.toggle("active", i === index);
  if (!skipScroll && elements[index]) elements[index].scrollIntoView({ block: "nearest" });
}

function beginClayChat(query) {
  if (chatMode) return;
  chatMode = true;
  paletteEl.classList.add("is-chatting");
  startSearchClayChat(query, resultsEl, showSearch, closeCommandPalette);
}

function activateItem(entry) {
  if (entry.type === "ask-clay") { beginClayChat(entry.query); return; }
  if (entry.type === "mate-session") {
    closeCommandPalette();
    showHomeHub();
    openHomeConversation(entry.data.mateId, entry.data.sessionId);
  } else if (entry.type === "session") navigateToSession(entry.data, entry.query);
}

function navigateToSession(item, query) {
  closeCommandPalette();
  if (ctx.currentSlug && ctx.currentSlug() === item.projectSlug) {
    ctx.selectSession(item.sessionId);
    if (query) setTimeout(function () { openSessionSearch(query); }, 400);
  } else {
    pendingNav = { slug: item.projectSlug, sessionId: item.sessionId, query: query };
    ctx.switchProject(item.projectSlug);
  }
}
