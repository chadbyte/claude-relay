// Pointer and keyboard resizing for the desktop home tool workbench.

var initialized = false;
var dragging = false;

export function clampHomeDockWidth(width) {
  var workspace = document.getElementById("home-workspace");
  var available = workspace ? workspace.getBoundingClientRect().width : window.innerWidth;
  var maximum = Math.max(420, Math.min(window.innerWidth * 0.58, available - 480));
  return Math.round(Math.max(420, Math.min(maximum, width)));
}

export function defaultHomeDockWidth() {
  return clampHomeDockWidth(Math.max(520, Math.min(window.innerWidth * 0.46, 760)));
}

export function applyHomeDockWidth(width) {
  var workspace = document.getElementById("home-workspace");
  if (!workspace) return null;
  var resolved = clampHomeDockWidth(typeof width === "number" ? width : defaultHomeDockWidth());
  workspace.style.setProperty("--home-dock-width", resolved + "px");
  return resolved;
}

function dispatchWidth(type, width) {
  window.dispatchEvent(new CustomEvent(type, { detail: { width: applyHomeDockWidth(width) } }));
}

function handlePointerMove(event) {
  if (!dragging) return;
  var workspace = document.getElementById("home-workspace");
  if (!workspace) return;
  var rect = workspace.getBoundingClientRect();
  dispatchWidth("clay:home-dock-width-preview", rect.right - event.clientX);
}

function finishPointerResize(event) {
  if (!dragging) return;
  handlePointerMove(event);
  dragging = false;
  document.body.classList.remove("home-dock-resizing");
  window.removeEventListener("pointermove", handlePointerMove);
  window.removeEventListener("pointerup", finishPointerResize);
  window.removeEventListener("pointercancel", finishPointerResize);
  var workbench = document.getElementById("home-tool-workbench");
  dispatchWidth("clay:home-dock-width-commit", workbench ? workbench.getBoundingClientRect().width : defaultHomeDockWidth());
}

export function initHomeDockResize() {
  if (initialized) return;
  initialized = true;
  var divider = document.getElementById("home-dock-divider");
  if (!divider) return;
  divider.addEventListener("pointerdown", function (event) {
    if (window.innerWidth < 1180 || event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    document.body.classList.add("home-dock-resizing");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishPointerResize);
    window.addEventListener("pointercancel", finishPointerResize);
  });
  divider.addEventListener("keydown", function (event) {
    if (window.innerWidth < 1180 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    var workbench = document.getElementById("home-tool-workbench");
    var current = workbench ? workbench.getBoundingClientRect().width : defaultHomeDockWidth();
    dispatchWidth("clay:home-dock-width-commit", current + (event.key === "ArrowLeft" ? 24 : -24));
  });
}
