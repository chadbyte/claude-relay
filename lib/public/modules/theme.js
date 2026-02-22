// --- Theme management ---

var THEME_KEY = "claude-relay-theme";
var COLOR_MODE_KEY = "claude-relay-color-mode";
var THEMES = ["default", "anthropic"];
var MODES = ["auto", "light", "dark"];
var currentTheme = "default";
var colorMode = "auto";
var darkMq = window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme() {
  return currentTheme;
}

export function getColorMode() {
  return colorMode;
}

export function getThemeLabel() {
  if (colorMode === "light") return "Light";
  if (colorMode === "dark") return "Dark";
  return "Auto";
}

export function setTheme(name) {
  if (THEMES.indexOf(name) === -1) name = "default";
  currentTheme = name;
  try { localStorage.setItem(THEME_KEY, name); } catch (e) {}
  applyTheme();
}

export function setColorMode(mode) {
  if (MODES.indexOf(mode) === -1) mode = "auto";
  colorMode = mode;
  try { localStorage.setItem(COLOR_MODE_KEY, mode); } catch (e) {}
  applyTheme();
}

export function cycleTheme() {
  var idx = THEMES.indexOf(currentTheme);
  setTheme(THEMES[(idx + 1) % THEMES.length]);
  return currentTheme;
}

function isEffectivelyDark() {
  if (colorMode === "dark") return true;
  if (colorMode === "light") return false;
  return darkMq.matches;
}

function applyTheme() {
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  var hljsLink = document.getElementById("hljs-theme");
  var dark = isEffectivelyDark();

  if (currentTheme === "anthropic") {
    html.dataset.theme = dark ? "anthropic-dark" : "anthropic";
    if (meta) meta.content = dark ? "#2B2A27" : "#F5F0E8";
    if (hljsLink) {
      hljsLink.href = dark
        ? "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark-dimmed.min.css"
        : "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github.min.css";
    }
  } else {
    // Default theme: warm dark (no data-theme), or warm cream in light mode
    if (dark) {
      delete html.dataset.theme;
      if (meta) meta.content = "#2F2E2B";
      if (hljsLink) hljsLink.href = "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark-dimmed.min.css";
    } else {
      html.dataset.theme = "anthropic";
      if (meta) meta.content = "#F5F0E8";
      if (hljsLink) hljsLink.href = "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github.min.css";
    }
  }
}

export function initTheme() {
  try {
    var savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme && THEMES.indexOf(savedTheme) !== -1) currentTheme = savedTheme;

    var savedMode = localStorage.getItem(COLOR_MODE_KEY);
    if (savedMode && MODES.indexOf(savedMode) !== -1) colorMode = savedMode;
  } catch (e) {}

  applyTheme();

  darkMq.addEventListener("change", function () {
    if (colorMode === "auto") applyTheme();
  });
}
