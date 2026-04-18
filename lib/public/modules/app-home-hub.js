// app-home-hub.js - Home hub rendering, weather, tips
// Extracted from app.js (PR-25)

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './utils.js';
import { switchProject, getCachedProjects, renderProjectList } from './app-projects.js';
import { openSchedulerToTab } from './scheduler.js';
import { getPlaybooks, openPlaybook, getPlaybookForTip } from './playbook.js';
import { mateAvatarUrl } from './avatar.js';
import { openDm, exitDmMode } from './app-dm.js';

function $hub(id) { return document.getElementById(id); }

var homeHub = null;
var homeHubVisible = false;
var hubSchedules = [];

var hubTips = [
  "Sticky notes let you pin important info that persists across sessions.",
  "You can run terminal commands directly from the terminal tab — no need to switch windows.",
  "Rename your sessions to keep conversations organized and easy to find later.",
  "The file browser lets you explore and open any file in your project.",
  "Paste images from your clipboard into the chat to include them in your message.",
  "Use /commands (slash commands) for quick access to common actions.",
  "You can resize the sidebar by dragging its edge.",
  "Click the session info button in the header to see token usage and costs.",
  "You can switch between projects without losing your conversation history.",
  "The status dot on project icons shows whether Claude is currently processing.",
  "Right-click on a project icon for quick actions like rename or delete.",
  "Push notifications can alert you when Claude finishes a long task.",
  "You can search through your conversation history within a session.",
  "Session history is preserved — come back anytime to continue where you left off.",
  "Use the rewind feature to go back to an earlier point in your conversation.",
  "You can open multiple terminal tabs for parallel command execution.",
  "Clay works offline as a PWA — install it from your browser for quick access.",
  "Schedule recurring tasks with cron expressions to automate your workflow.",
  "Use Ralph Loops to run autonomous coding sessions while you're away.",
  "Right-click a project icon to set a custom emoji — make each project instantly recognizable.",
  "Multiple people can connect to the same project at once — great for pair programming.",
  "Drag and drop project icons to reorder them in the sidebar.",
  "Drag a project icon to the trash to delete it.",
  "Honey never spoils. 🍯",
  "The Earth is round. 🌍",
  "Computers use electricity. 🔌",
  "Christmas is in summer in some countries. 🎄",
];
// Fisher-Yates shuffle
for (var _si = hubTips.length - 1; _si > 0; _si--) {
  var _sj = Math.floor(Math.random() * (_si + 1));
  var _tmp = hubTips[_si];
  hubTips[_si] = hubTips[_sj];
  hubTips[_sj] = _tmp;
}
var hubTipIndex = 0;
var hubTipTimer = null;

var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// --- Weather (hidden detail) ---
var weatherEmoji = null;   // null = not yet fetched, "" = failed
var weatherCondition = "";  // e.g. "Light rain, Auckland"
var weatherFetchedAt = 0;
var WEATHER_CACHE_MS = 60 * 60 * 1000; // 1 hour
// WMO weather code -> emoji + description
var WMO_MAP = {
  0: ["☀️", "Clear sky"], 1: ["🌤", "Mainly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
  45: ["🌫", "Fog"], 48: ["🌫", "Depositing rime fog"],
  51: ["🌦", "Light drizzle"], 53: ["🌦", "Moderate drizzle"], 55: ["🌧", "Dense drizzle"],
  56: ["🌧", "Light freezing drizzle"], 57: ["🌧", "Dense freezing drizzle"],
  61: ["🌧", "Slight rain"], 63: ["🌧", "Moderate rain"], 65: ["🌧", "Heavy rain"],
  66: ["🌧", "Light freezing rain"], 67: ["🌧", "Heavy freezing rain"],
  71: ["🌨", "Slight snow"], 73: ["🌨", "Moderate snow"], 75: ["❄️", "Heavy snow"],
  77: ["🌨", "Snow grains"],
  80: ["🌦", "Slight rain showers"], 81: ["🌧", "Moderate rain showers"], 82: ["🌧", "Violent rain showers"],
  85: ["🌨", "Slight snow showers"], 86: ["❄️", "Heavy snow showers"],
  95: ["⛈", "Thunderstorm"], 96: ["⛈", "Thunderstorm with slight hail"], 99: ["⛈", "Thunderstorm with heavy hail"],
};

var SLOT_EMOJIS = ["☀️", "🌤", "⛅", "☁️", "🌧", "🌦", "⛈", "🌨", "❄️", "🌫", "🌙", "✨"];
var weatherSlotPlayed = false;

var hubCloseBtn = null;

export function initHomeHub() {
  homeHub = document.getElementById("home-hub");
  hubCloseBtn = document.getElementById("home-hub-close");

  if (hubCloseBtn) {
    hubCloseBtn.addEventListener("click", function () {
      hideHomeHub();
      if (store.get('currentSlug')) {
        if (document.documentElement.classList.contains("pwa-standalone")) {
          history.replaceState(null, "", "/p/" + store.get('currentSlug') + "/");
        } else {
          history.pushState(null, "", "/p/" + store.get('currentSlug') + "/");
        }
        // Restore icon strip active state
        var homeIcon = document.querySelector(".icon-strip-home");
        if (homeIcon) homeIcon.classList.remove("active");
        renderProjectList();
      }
    });
  }
}

export function isHomeHubVisible() { return homeHubVisible; }

function fetchWeather() {
  // Use cache if we have a successful result within the last hour
  if (weatherEmoji && weatherFetchedAt && (Date.now() - weatherFetchedAt < WEATHER_CACHE_MS)) return;
  // Try localStorage cache
  if (!weatherEmoji) {
    try {
      var cached = JSON.parse(localStorage.getItem("clay-weather") || "null");
      if (cached && cached.emoji && (Date.now() - cached.ts < WEATHER_CACHE_MS)) {
        weatherEmoji = cached.emoji;
        weatherCondition = cached.condition || "";
        weatherFetchedAt = cached.ts;
        if (homeHubVisible) updateGreetingWeather();
        return;
      }
    } catch (e) {}
  }
  if (weatherFetchedAt && (Date.now() - weatherFetchedAt < 30000)) return; // don't retry within 30s
  weatherFetchedAt = Date.now();
  // Step 1: IP geolocation -> lat/lon + city
  fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(4000) })
    .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
    .then(function (geo) {
      var lat = geo.latitude;
      var lon = geo.longitude;
      var city = geo.city || geo.region || "";
      var country = geo.country_name || "";
      var locationStr = city + (country ? ", " + country : "");
      // Step 2: Open-Meteo -> current weather
      var meteoUrl = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon + "&current=weather_code&timezone=auto";
      return fetch(meteoUrl, { signal: AbortSignal.timeout(4000) })
        .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
        .then(function (data) {
          var code = data && data.current && data.current.weather_code;
          if (code === undefined || code === null) return;
          var mapped = WMO_MAP[code] || WMO_MAP[0];
          weatherEmoji = mapped[0];
          weatherCondition = mapped[1] + (locationStr ? " in " + locationStr : "");
          weatherFetchedAt = Date.now();
          try {
            localStorage.setItem("clay-weather", JSON.stringify({
              emoji: weatherEmoji, condition: weatherCondition, ts: weatherFetchedAt
            }));
          } catch (e) {}
          if (homeHubVisible) updateGreetingWeather();
        });
    })
    .catch(function () {
      if (!weatherEmoji) weatherEmoji = "";
    });
}

function updateGreetingWeather() {
  var greetEl = $hub("hub-greeting-text");
  if (!greetEl) return;
  // If we have real weather and haven't played the slot yet, do the reel
  if (weatherEmoji && !weatherSlotPlayed && homeHubVisible) {
    weatherSlotPlayed = true;
    playWeatherSlot(greetEl);
    return;
  }
  // Normal update (no animation)
  greetEl.textContent = getGreeting();

  applyWeatherTooltip(greetEl);
}

function applyWeatherTooltip(greetEl) {
  if (!weatherCondition) return;
  var emojis = greetEl.querySelectorAll("img.emoji");
  var lastEmoji = emojis.length > 0 ? emojis[emojis.length - 1] : null;
  if (lastEmoji) {
    lastEmoji.title = weatherCondition;
    lastEmoji.style.cursor = "default";
  }
}

function playWeatherSlot(greetEl) {
  var h = new Date().getHours();
  var prefix;
  if (h < 6) prefix = "Good night";
  else if (h < 12) prefix = "Good morning";
  else if (h < 18) prefix = "Good afternoon";
  else prefix = "Good evening";

  // Build schedule: fast ticks -> slow ticks -> land (~3s total)
  var intervals = [50, 50, 50, 60, 70, 80, 100, 120, 150, 190, 240, 300, 370, 450, 530, 640];
  var totalSteps = intervals.length;
  var step = 0;
  var startIdx = Math.floor(Math.random() * SLOT_EMOJIS.length);

  function tick() {
    if (step < totalSteps) {
      var idx = (startIdx + step) % SLOT_EMOJIS.length;
      greetEl.textContent = prefix + " " + SLOT_EMOJIS[idx];

      step++;
      setTimeout(tick, intervals[step - 1]);
    } else {
      // Final: land on actual weather
      greetEl.textContent = prefix + " " + weatherEmoji;

      applyWeatherTooltip(greetEl);
    }
  }
  tick();
}

function getGreeting() {
  var h = new Date().getHours();
  var emoji = weatherEmoji || "";
  // Fallback to time-based emoji if weather not available
  if (!emoji) {
    if (h < 6) emoji = "✨";
    else if (h < 12) emoji = "☀️";
    else if (h < 18) emoji = "🌤";
    else emoji = "🌙";
  }
  var prefix;
  if (h < 6) prefix = "Good night";
  else if (h < 12) prefix = "Good morning";
  else if (h < 18) prefix = "Good afternoon";
  else prefix = "Good evening";
  return prefix + " " + emoji;
}

function getFormattedDate() {
  var now = new Date();
  return WEEKDAY_NAMES[now.getDay()] + ", " + MONTH_NAMES[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear();
}

function formatScheduleTime(ts) {
  var d = new Date(ts);
  var now = new Date();
  var todayStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  var schedStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  var h = d.getHours();
  var m = String(d.getMinutes()).padStart(2, "0");
  var ampm = h >= 12 ? "PM" : "AM";
  var h12 = h % 12 || 12;
  var timeStr = h12 + ":" + m + " " + ampm;
  if (schedStr === todayStr) return timeStr;
  // Tomorrow check
  var tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  var tomStr = tomorrow.getFullYear() + "-" + String(tomorrow.getMonth() + 1).padStart(2, "0") + "-" + String(tomorrow.getDate()).padStart(2, "0");
  if (schedStr === tomStr) return "Tomorrow";
  return DAY_NAMES[d.getDay()] + " " + timeStr;
}

export function renderHomeHub(projects) {
  // Greeting + weather tooltip
  updateGreetingWeather();

  // Date
  var dateEl = $hub("hub-greeting-date");
  if (dateEl) dateEl.textContent = getFormattedDate();

  // --- Upcoming tasks ---
  var upcomingList = $hub("hub-upcoming-list");
  var upcomingCount = $hub("hub-upcoming-count");
  if (upcomingList) {
    var now = Date.now();
    var upcoming = hubSchedules.filter(function (s) {
      return s.enabled && s.nextRunAt && s.nextRunAt > now;
    }).sort(function (a, b) {
      return a.nextRunAt - b.nextRunAt;
    });
    // Show up to next 48 hours
    var cutoff = now + 48 * 60 * 60 * 1000;
    var filtered = upcoming.filter(function (s) { return s.nextRunAt <= cutoff; });

    if (upcomingCount) {
      upcomingCount.textContent = filtered.length > 0 ? filtered.length : "";
    }

    upcomingList.innerHTML = "";
    if (filtered.length === 0) {
      // Empty state with CTA
      var emptyDiv = document.createElement("div");
      emptyDiv.className = "hub-upcoming-empty";
      emptyDiv.innerHTML = '<div class="hub-upcoming-empty-icon">📋</div>' +
        '<div class="hub-upcoming-empty-text">No upcoming tasks</div>' +
        '<button class="hub-upcoming-cta" id="hub-upcoming-cta">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
        'Create a schedule</button>';
      upcomingList.appendChild(emptyDiv);
      var ctaBtn = emptyDiv.querySelector("#hub-upcoming-cta");
      if (ctaBtn) {
        ctaBtn.addEventListener("click", function () {
          hideHomeHub();
          openSchedulerToTab("calendar");
        });
      }
    } else {
      var maxShow = 5;
      var shown = filtered.slice(0, maxShow);
      for (var i = 0; i < shown.length; i++) {
        (function (sched) {
          var item = document.createElement("div");
          item.className = "hub-upcoming-item";
          var dotColor = sched.color || "";
          item.innerHTML = '<span class="hub-upcoming-dot"' + (dotColor ? ' style="background:' + dotColor + '"' : '') + '></span>' +
            '<span class="hub-upcoming-time">' + formatScheduleTime(sched.nextRunAt) + '</span>' +
            '<span class="hub-upcoming-name">' + escapeHtml(sched.name || "Untitled") + '</span>' +
            '<span class="hub-upcoming-project">' + escapeHtml(sched.projectTitle || "") + '</span>';
          item.addEventListener("click", function () {
            if (sched.projectSlug) {
              switchProject(sched.projectSlug);
              setTimeout(function () {
                openSchedulerToTab("library");
              }, 300);
            }
          });
          upcomingList.appendChild(item);
        })(shown[i]);
      }
      if (filtered.length > maxShow) {
        var moreEl = document.createElement("div");
        moreEl.className = "hub-upcoming-more";
        moreEl.textContent = "+" + (filtered.length - maxShow) + " more";
        upcomingList.appendChild(moreEl);
      }
    }
  }

  // --- Projects summary (exclude mate projects) ---
  var projectsList = $hub("hub-projects-list");
  if (projectsList && projects) {
    projectsList.innerHTML = "";
    var hubProjects = projects.filter(function (p) { return !p.isMate; });
    for (var p = 0; p < hubProjects.length; p++) {
      (function (proj) {
        var item = document.createElement("div");
        item.className = "hub-project-item";
        var dotClass = "hub-project-dot" + (proj.isProcessing ? " processing" : "");
        var iconHtml = proj.icon ? '<span class="hub-project-icon">' + proj.icon + '</span>' : '';
        var sessionsLabel = typeof proj.sessions === "number" ? proj.sessions : "";
        item.innerHTML = '<span class="' + dotClass + '"></span>' +
          iconHtml +
          '<span class="hub-project-name">' + escapeHtml(proj.title || proj.project || proj.slug) + '</span>' +
          (sessionsLabel !== "" ? '<span class="hub-project-sessions">' + sessionsLabel + '</span>' : '');
        item.addEventListener("click", function () {
          switchProject(proj.slug);
        });
        projectsList.appendChild(item);
      })(hubProjects[p]);
    }
    // Render emoji icons

  }

  // --- Week strip ---
  var weekStrip = $hub("hub-week-strip");
  if (weekStrip) {
    weekStrip.innerHTML = "";
    var today = new Date();
    var todayDate = today.getDate();
    var todayMonth = today.getMonth();
    var todayYear = today.getFullYear();
    // Find Monday of current week
    var dayOfWeek = today.getDay();
    var mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    var monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);

    // Build set of dates that have events
    var eventDates = {};
    for (var si = 0; si < hubSchedules.length; si++) {
      var sched = hubSchedules[si];
      if (!sched.enabled) continue;
      if (sched.nextRunAt) {
        var sd = new Date(sched.nextRunAt);
        var key = sd.getFullYear() + "-" + sd.getMonth() + "-" + sd.getDate();
        eventDates[key] = (eventDates[key] || 0) + 1;
      }
      if (sched.date) {
        var parts = sched.date.split("-");
        var dateKey = parseInt(parts[0], 10) + "-" + (parseInt(parts[1], 10) - 1) + "-" + parseInt(parts[2], 10);
        eventDates[dateKey] = (eventDates[dateKey] || 0) + 1;
      }
    }

    for (var d = 0; d < 7; d++) {
      var dayDate = new Date(monday);
      dayDate.setDate(monday.getDate() + d);
      var isToday = dayDate.getDate() === todayDate && dayDate.getMonth() === todayMonth && dayDate.getFullYear() === todayYear;
      var dateKey = dayDate.getFullYear() + "-" + dayDate.getMonth() + "-" + dayDate.getDate();
      var eventCount = eventDates[dateKey] || 0;

      var cell = document.createElement("div");
      cell.className = "hub-week-day" + (isToday ? " today" : "");
      var dotsHtml = '<div class="hub-week-dots">';
      var dotCount = Math.min(eventCount, 3);
      for (var di = 0; di < dotCount; di++) {
        dotsHtml += '<span class="hub-week-dot"></span>';
      }
      dotsHtml += '</div>';
      cell.innerHTML = '<span class="hub-week-label">' + DAY_NAMES[(dayDate.getDay())] + '</span>' +
        '<span class="hub-week-num">' + dayDate.getDate() + '</span>' +
        dotsHtml;
      weekStrip.appendChild(cell);
    }
  }

  // --- Playbooks ---
  var pbGrid = $hub("hub-playbooks-grid");
  var pbSection = $hub("hub-playbooks");
  if (pbGrid) {
    var pbs = getPlaybooks();
    if (pbs.length === 0) {
      if (pbSection) pbSection.style.display = "none";
    } else {
      if (pbSection) pbSection.style.display = "";
      pbGrid.innerHTML = "";
      for (var pi = 0; pi < pbs.length; pi++) {
        (function (pb) {
          var card = document.createElement("div");
          card.className = "hub-playbook-card" + (pb.completed ? " completed" : "");
          card.innerHTML = '<span class="hub-playbook-card-icon">' + pb.icon + '</span>' +
            '<div class="hub-playbook-card-body">' +
            '<div class="hub-playbook-card-title">' + escapeHtml(pb.title) + '</div>' +
            '<div class="hub-playbook-card-desc">' + escapeHtml(pb.description) + '</div>' +
            '</div>' +
            (pb.completed ? '<span class="hub-playbook-card-check">✓</span>' : '');
          card.addEventListener("click", function () {
            openPlaybook(pb.id, function () {
              // Re-render hub after playbook closes to update completion state
              renderHomeHub(getCachedProjects());
            });
          });
          pbGrid.appendChild(card);
        })(pbs[pi]);
      }

    }
  }


  // --- Tip ---
  var currentTip = hubTips[hubTipIndex % hubTips.length];
  var tipEl = $hub("hub-tip-text");
  if (tipEl) tipEl.textContent = currentTip;

  // "Try it" button if tip has a linked playbook
  var existingTry = homeHub.querySelector(".hub-tip-try");
  if (existingTry) existingTry.remove();
  var linkedPb = getPlaybookForTip(currentTip);
  if (linkedPb && tipEl) {
    var tryBtn = document.createElement("button");
    tryBtn.className = "hub-tip-try";
    tryBtn.textContent = "Try it →";
    tryBtn.addEventListener("click", function () {
      openPlaybook(linkedPb, function () {
        renderHomeHub(getCachedProjects());
      });
    });
    tipEl.appendChild(tryBtn);
  }

  // Tip prev/next buttons
  var prevBtn = $hub("hub-tip-prev");
  if (prevBtn && !prevBtn._hubWired) {
    prevBtn._hubWired = true;
    prevBtn.addEventListener("click", function () {
      hubTipIndex = (hubTipIndex - 1 + hubTips.length) % hubTips.length;
      renderHomeHub(getCachedProjects());
      startTipRotation();
    });
  }
  var nextBtn = $hub("hub-tip-next");
  if (nextBtn && !nextBtn._hubWired) {
    nextBtn._hubWired = true;
    nextBtn.addEventListener("click", function () {
      hubTipIndex = (hubTipIndex + 1) % hubTips.length;
      renderHomeHub(getCachedProjects());
      startTipRotation();
    });
  }

  // Render twemoji for all emoji in the hub

}

export function handleHubSchedules(msg) {
  if (msg.schedules) {
    hubSchedules = msg.schedules;
    if (homeHubVisible) renderHomeHub(getCachedProjects());
  }
}

function startTipRotation() {
  stopTipRotation();
  hubTipTimer = setInterval(function () {
    hubTipIndex = (hubTipIndex + 1) % hubTips.length;
    renderHomeHub(getCachedProjects());
  }, 15000);
}

function stopTipRotation() {
  if (hubTipTimer) {
    clearInterval(hubTipTimer);
    hubTipTimer = null;
  }
}

function renderHomeHubMates() {
  var container = document.getElementById("home-hub-mates");
  if (!container) return;
  container.innerHTML = "";
  if (!store.get('cachedMatesList') || store.get('cachedMatesList').length === 0) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  for (var i = 0; i < store.get('cachedMatesList').length; i++) {
    (function (mate) {
      var item = document.createElement("div");
      item.className = "home-hub-mate-item" + (mate.primary ? " home-hub-mate-primary" : "");

      var avatarWrap = document.createElement("div");
      avatarWrap.className = "home-hub-mate-avatar-wrap";

      var mp = mate.profile || {};
      var mateAvUrl = mateAvatarUrl(mate, 48);
      var avatar = document.createElement("img");
      avatar.className = "home-hub-mate-avatar";
      avatar.src = mateAvUrl;
      avatar.alt = mp.displayName || mate.displayName || mate.name || "";
      avatarWrap.appendChild(avatar);

      var dot = document.createElement("span");
      dot.className = "home-hub-mate-dot";
      avatarWrap.appendChild(dot);

      item.appendChild(avatarWrap);

      var nameEl = document.createElement("span");
      nameEl.className = "home-hub-mate-name";
      nameEl.textContent = mp.displayName || mate.displayName || mate.name || "";
      if (mate.primary) {
        var starEl = document.createElement("span");
        starEl.className = "home-hub-mate-primary-star";
        starEl.title = "System Agent: code-managed, auto-updated, sees across all mates";
        starEl.textContent = "\u2605";
        nameEl.appendChild(starEl);
      }
      item.appendChild(nameEl);

      item.addEventListener("click", function () {
        openDm(mate.id);
      });

      container.appendChild(item);
    })(store.get('cachedMatesList')[i]);
  }
}

export function showHomeHub() {
  if (store.get('dmMode')) exitDmMode();
  homeHubVisible = true;
  homeHub.classList.remove("hidden");
  // Show close button only if there's a project to return to
  if (hubCloseBtn) {
    if (store.get('currentSlug')) hubCloseBtn.classList.remove("hidden");
    else hubCloseBtn.classList.add("hidden");
  }
  // Fetch weather silently (once)
  fetchWeather();
  // Request cross-project schedules
  if (getWs() && getWs().readyState === 1) {
    getWs().send(JSON.stringify({ type: "hub_schedules_list" }));
  }
  renderHomeHub(getCachedProjects());
  renderHomeHubMates();
  startTipRotation();
  if (document.documentElement.classList.contains("pwa-standalone")) {
    history.replaceState(null, "", "/");
  } else {
    history.pushState(null, "", "/");
  }
  // Update icon strip active state
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) homeIcon.classList.add("active");
  var activeProj = document.querySelector("#icon-strip-projects .icon-strip-item.active");
  if (activeProj) activeProj.classList.remove("active");
  // Mobile home button active
  var mobileHome = document.getElementById("mobile-home-btn");
  if (mobileHome) mobileHome.classList.add("active");
}

export function hideHomeHub() {
  if (!homeHubVisible) return;
  homeHubVisible = false;
  homeHub.classList.add("hidden");
  stopTipRotation();
  var mobileHome = document.getElementById("mobile-home-btn");
  if (mobileHome) mobileHome.classList.remove("active");
}
