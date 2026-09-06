// home-tool-frame.js - host side of the sandboxed rich Display frame.
//
// A rich element is additive Display: it renders in an iframe on a separate
// anonymous origin with sandbox="allow-scripts" and a frame CSP that allows
// no network at all. Its only channel is postMessage, and the only thing it
// can request is an act, which the host routes through the exact callback the
// floor buttons use. The floor never depends on the frame: if the frame fails
// to load or go ready, the host falls back to the floor automatically.

import { getWs } from './ws-ref.js';

var READY_TIMEOUT_MS = 6000;
var MAX_ACTION_LENGTH = 64;
var MAX_FRAME_HEIGHT = 4096;

var frames = Object.create(null);

// One listener for every frame. Messages are matched to a frame by the
// window they came from, never by origin text: a sandboxed frame without
// allow-same-origin reports the opaque origin "null", so identity comes from
// the contentWindow reference the host itself created.
var listenerAttached = false;

function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener("message", function (event) {
    var toolIds = Object.keys(frames);
    var entry = null;
    for (var i = 0; i < toolIds.length; i++) {
      var candidate = frames[toolIds[i]];
      if (candidate.iframe && candidate.iframe.contentWindow === event.source) {
        entry = candidate;
        break;
      }
    }
    if (!entry) return;
    var data = event.data;
    if (!data || data.clayCapsuleFrame !== 1 || typeof data.type !== "string") return;
    if (data.type === "ready") {
      markReady(entry);
      return;
    }
    if (data.type === "size") {
      resizeFrame(entry, data.height);
      return;
    }
    if (data.type === "act") {
      // The frame asks; the host decides. Bounded validation here, then the
      // same pipeline as a floor button click. Nothing else is accepted.
      if (typeof data.actionId !== "string" || !data.actionId || data.actionId.length > MAX_ACTION_LENGTH) return;
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(data.actionId)) return;
      var args = data.args && typeof data.args === "object" && !Array.isArray(data.args) ? data.args : {};
      entry.onAct(data.actionId, args);
    }
  });
}

// The separate-origin frame cannot resize its own iframe. It reports the
// content height after its layout changes and the host applies that bounded
// value, allowing wrapping content to grow naturally as the capsule narrows.
function resizeFrame(entry, height) {
  if (!Number.isFinite(height) || height <= 0 || height > MAX_FRAME_HEIGHT) return;
  if (!entry.iframe) return;
  entry.iframe.style.height = Math.ceil(height) + "px";
}

function markReady(entry) {
  if (entry.ready) return;
  entry.ready = true;
  if (entry.readyTimer) {
    clearTimeout(entry.readyTimer);
    entry.readyTimer = null;
  }
  for (var i = 0; i < entry.queue.length; i++) {
    postToFrame(entry, entry.queue[i]);
  }
  entry.queue.length = 0;
  if (entry.onReady) entry.onReady();
}

function postToFrame(entry, payload) {
  if (!entry.iframe || !entry.iframe.contentWindow) return;
  // targetOrigin must be "*": a sandboxed frame without allow-same-origin has
  // an opaque origin no origin string can name. Delivery is still exact,
  // because the message goes to the one contentWindow this host created, and
  // the payload is only the projection already chosen for this element.
  entry.iframe.contentWindow.postMessage(payload, "*");
}

function failFrame(toolId, message) {
  var entry = frames[toolId];
  if (!entry) return;
  disposeFrame(toolId);
  if (entry.onUnavailable) entry.onUnavailable(message);
}

// Mounts the rich element for one Capsule. The frame URL is requested over
// the authenticated WebSocket and answered by handleToolFrameUrlState below.
export function mountRichDisplay(options) {
  var toolId = options.toolId;
  disposeFrame(toolId);
  ensureListener();
  frames[toolId] = {
    toolId: toolId,
    container: options.container,
    onAct: options.onAct,
    onReady: options.onReady || null,
    onUnavailable: options.onUnavailable || null,
    iframe: null,
    ready: false,
    queue: [],
    readyTimer: null,
  };
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    failFrame(toolId, "The connection to the server is not available.");
    return;
  }
  ws.send(JSON.stringify({ type: "tool_frame_url", toolId: toolId }));
}

export function handleToolFrameUrlState(msg) {
  if (!msg || !msg.toolId) return;
  var entry = frames[msg.toolId];
  if (!entry || entry.iframe) return;
  if (msg.ok === false || !msg.frame || !msg.frame.port) {
    failFrame(msg.toolId, msg.error || "The rich Display is unavailable.");
    return;
  }
  var scheme = msg.frame.secure ? "https" : "http";
  var url = scheme + "://" + window.location.hostname + ":" + msg.frame.port + msg.frame.path;
  var iframe = document.createElement("iframe");
  iframe.className = "home-tool-frame";
  // allow-scripts only. No allow-same-origin, so the frame's origin is opaque
  // and nothing of the host origin (DOM, cookies, storage) is reachable.
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("title", "Capsule rich display");
  // Start collapsed so the frame can measure its content rather than merely
  // echoing a fixed viewport height back to the host.
  iframe.style.height = "1px";
  iframe.src = url;
  entry.iframe = iframe;
  entry.container.appendChild(iframe);
  entry.readyTimer = setTimeout(function () {
    failFrame(msg.toolId, "The rich Display did not become ready.");
  }, READY_TIMEOUT_MS);
}

export function pushFrameState(toolId, state) {
  var entry = frames[toolId];
  if (!entry) return;
  var payload = { clayCapsuleFrame: 1, type: "state", state: state || {} };
  if (!entry.ready) {
    entry.queue.push(payload);
    return;
  }
  postToFrame(entry, payload);
}

export function pushFrameEvent(toolId, event) {
  var entry = frames[toolId];
  if (!entry || !event) return;
  var payload = { clayCapsuleFrame: 1, type: "event", event: event };
  if (!entry.ready) {
    entry.queue.push(payload);
    return;
  }
  postToFrame(entry, payload);
}

export function hasFrame(toolId) {
  return !!frames[toolId];
}

export function disposeFrame(toolId) {
  var entry = frames[toolId];
  if (!entry) return;
  if (entry.readyTimer) clearTimeout(entry.readyTimer);
  if (entry.iframe && entry.iframe.parentNode) entry.iframe.parentNode.removeChild(entry.iframe);
  delete frames[toolId];
}
