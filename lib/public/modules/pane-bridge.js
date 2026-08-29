// Pane-side postMessage bridge for the split-view shell. A chrome-less pane
// iframe reports its context usage up to the parent (which renders a chip in
// the pane header) and honors panel-toggle requests coming back down.
// Same-origin messages only, both directions.

import { store } from './store.js';
import { applyContextView, getContextView } from './app-panels.js';
import { forceExternalLinkToNewTab } from './pane-links.js';

var panelOpen = false;

export function reportPaneContext(data) {
  if (!store.get('paneMode') || window.parent === window) return;
  window.parent.postMessage({
    type: "clay-pane-context",
    sessionId: store.get('activeSessionId'),
    pct: data.pct,
    used: data.used,
    win: data.win,
    cls: data.cls,
    model: data.model,
    cost: data.cost,
  }, window.location.origin);
}

export function forwardPaneMarkdownPresentation(message) {
  if (!store.get('paneMode') || window.parent === window) return false;
  window.parent.postMessage({ type: "clay-pane-present-markdown", message: message }, window.location.origin);
  return true;
}

// Toggle without setContextView: panes share localStorage with the main app,
// so persisting here would silently rewrite the user's main-view preference.
function togglePaneContextPanel() {
  panelOpen = !panelOpen;
  applyContextView(panelOpen ? "panel" : "off");
}

function preparePaneLink(event) {
  var target = event.target;
  if (!target || typeof target.closest !== "function") return;
  var anchor = target.closest("a[href]");
  if (!anchor || anchor.hasAttribute("download")) return;
  forceExternalLinkToNewTab(anchor, window.location.href);
}

export function initPaneBridge() {
  if (!store.get('paneMode')) return;
  panelOpen = getContextView() === "panel";
  document.addEventListener("click", preparePaneLink, true);
  document.addEventListener("auxclick", preparePaneLink, true);
  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin) return;
    var msg = event.data;
    if (!msg || msg.type !== "clay-pane-toggle-context") return;
    togglePaneContextPanel();
  });
}
