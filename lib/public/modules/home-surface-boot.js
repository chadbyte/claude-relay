// One-shot boot routing after durable Home preferences become available.
import { store } from './store.js';
import { rememberHomePrimarySurface } from './home-surface.js';

var initialized = false;
var resolved = false;

function explicitProjectPath(pathname) {
  return /^\/p\/[a-z0-9_-]+(?:\/|$)/.test(pathname || "");
}

export function resolveHomeBootDestination(options) {
  if (!options || options.surfaceLoaded !== true) return "wait";
  if (options.paneMode || explicitProjectPath(options.pathname)) return "project";
  if (options.surface === "project" && options.currentSlug) return "project";
  if (options.dockLoaded !== true) return "wait";
  return "home";
}

function finishPendingShell() {
  document.body.classList.remove("home-surface-boot-pending");
  var overlay = document.getElementById("connect-overlay");
  if (overlay && store.get('connected')) overlay.classList.add("hidden");
}

function projectRoute(slug) {
  return slug ? "/p/" + slug + "/" : null;
}

function settleBoot(state) {
  if (resolved) return;
  var destination = resolveHomeBootDestination({
    surfaceLoaded: state.homeSurfaceLoaded,
    dockLoaded: state.homeDockPreferenceLoaded,
    surface: state.homePrimarySurface,
    currentSlug: state.currentSlug,
    pathname: location.pathname,
    paneMode: state.paneMode,
  });
  if (destination === "wait") return;
  resolved = true;
  if (destination === "project") {
    rememberHomePrimarySurface("project");
    if (!explicitProjectPath(location.pathname)) {
      var route = projectRoute(state.currentSlug);
      if (route) history.replaceState(null, "", route);
    }
    store.set({ homeSurfaceBootResolved: true });
    finishPendingShell();
    var input = document.getElementById("input");
    if (input && !input.disabled) input.focus({ preventScroll: true });
    return;
  }
  store.set({ homeSurfaceBootResolved: true, homeSurfaceRestoreRequested: true });
  finishPendingShell();
}

export function initHomeSurfaceBoot() {
  if (initialized) return;
  initialized = true;
  if (!explicitProjectPath(location.pathname) && !store.get('paneMode')) {
    document.body.classList.add("home-surface-boot-pending");
    var message = document.getElementById("connect-overlay-msg");
    if (message) message.textContent = "Restoring your workspace…";
  }
  store.subscribe(function (state) { settleBoot(state); });
  settleBoot(store.snap());
}
