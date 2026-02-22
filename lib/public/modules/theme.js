// --- Theme management ---

var STORAGE_KEY = "claude-relay-theme";
var THEMES = ["default", "anthropic"];
var currentTheme = "default";
var darkMq = window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme() {
  return currentTheme;
}

export function getThemeLabel() {
  return currentTheme === "default" ? "Default" : "Anthropic";
}

export function setTheme(name) {
  if (THEMES.indexOf(name) === -1) name = "default";
  currentTheme = name;
  try { localStorage.setItem(STORAGE_KEY, name); } catch (e) {}
  applyTheme();
}

export function cycleTheme() {
  var idx = THEMES.indexOf(currentTheme);
  var next = THEMES[(idx + 1) % THEMES.length];
  setTheme(next);
  return next;
}

function applyTheme() {
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  var hljsLink = document.getElementById("hljs-theme");

  if (currentTheme === "default") {
    delete html.dataset.theme;
    if (meta) meta.content = "#2F2E2B";
    if (hljsLink) hljsLink.href = "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark-dimmed.min.css";
  } else if (currentTheme === "anthropic") {
    var prefersDark = darkMq.matches;
    html.dataset.theme = prefersDark ? "anthropic-dark" : "anthropic";
    if (meta) {
      meta.content = prefersDark ? "#2B2A27" : "#F5F0E8";
    }
    if (hljsLink) {
      hljsLink.href = prefersDark
        ? "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark-dimmed.min.css"
        : "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github.min.css";
    }
  }
}

export function initTheme() {
  // Read saved preference
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.indexOf(saved) !== -1) currentTheme = saved;
  } catch (e) {}

  // Apply immediately
  applyTheme();

  // Listen for OS dark/light changes (matters for anthropic theme)
  darkMq.addEventListener("change", function () {
    if (currentTheme === "anthropic") applyTheme();
  });
}
