// app-connection.js - WebSocket connection, reconnect, status
// Extracted from app.js (PR-22)

import { store } from './store.js';
import { getWs, setWs } from './ws-ref.js';
import { getStatusDot, getSendBtn } from './dom-refs.js';
import { setSendBtnMode, blinkIO, setActivity } from './app-favicon.js';
import { startLogoAnimation, stopLogoAnimation } from './ascii-logo.js';
import { hasSendableContent } from './input.js';
import { processMessage } from './app-messages.js';
import { flushPendingExtMessages } from './app-misc.js';
import { resetTerminals } from './terminal.js';
import { closeDmUserPicker } from './sidebar-mates.js';
import { openDm } from './app-dm.js';

var reconnectTimer = null;
var reconnectDelay = 1000;
var connectTimeoutId = null;
var connectOverlay = null;

export function initConnection() {
  connectOverlay = document.getElementById("connect-overlay");

  // --- Reactive UI sync for connected/processing state ---
  store.subscribe(function (state, prev) {
    // Status dot (depends on both connected and processing)
    if (state.connected !== prev.connected || state.processing !== prev.processing) {
      var dot = getStatusDot();
      if (dot) {
        dot.className = "icon-strip-status";
        if (state.connected) {
          dot.classList.add("connected");
          if (state.processing) dot.classList.add("processing");
        }
      }
    }

    // Connected state changed
    if (state.connected !== prev.connected) {
      var sendBtn = getSendBtn();
      if (state.connected) {
        if (sendBtn) sendBtn.disabled = false;
        if (connectOverlay) connectOverlay.classList.add("hidden");
        var updPill = document.getElementById("update-pill-wrap");
        if (updPill) updPill.classList.add("hidden");
        stopLogoAnimation();
      } else {
        if (sendBtn) sendBtn.disabled = true;
        if (connectOverlay) connectOverlay.classList.remove("hidden");
        startLogoAnimation();
      }
    }

    // Processing state changed
    if (state.processing !== prev.processing) {
      if (state.processing) {
        setSendBtnMode(hasSendableContent() ? "send" : "stop");
      } else if (state.connected) {
        setSendBtnMode("send");
      }
    }
  });
}

// setStatus: now just sets state. UI sync is handled by the subscriber above.
export function setStatus(status) {
  if (status === "connected") {
    store.set({ connected: true, processing: false });
  } else if (status === "processing") {
    store.set({ processing: true });
  } else {
    store.set({ connected: false, processing: false });
  }
}

function onConnected() {
  // Flush any extension messages that arrived before WS was ready
  flushPendingExtMessages();

  // Reset terminal xterm instances (server will send fresh term_list)
  resetTerminals();

  // Re-send push subscription on reconnect
  var ws = getWs();
  if (window._pushSubscription) {
    try {
      ws.send(JSON.stringify({
        type: "push_subscribe",
        subscription: window._pushSubscription.toJSON(),
      }));
    } catch(e) {}
  }

  // Request mates list
  try {
    ws.send(JSON.stringify({ type: "mate_list" }));
  } catch(e) {}

  // If connecting to a mate project, request knowledge list for badge
  if (store.get('mateProjectSlug')) {
    try { ws.send(JSON.stringify({ type: "knowledge_list" })); } catch(e) {}
  }

  // Session restore is now server-driven (user-presence.json).
  // Mate DM restore is also server-driven via "restore_mate_dm" message.
  // Previously there was a 2s localStorage fallback that auto-called
  // openDm(savedDm) on every reconnect. That fallback re-opened stale
  // mate DMs on every refresh / project switch and was the root cause
  // of the skill-install modal popping unprompted. Server-driven restore
  // is authoritative — drop the client-side fallback entirely.
  try { localStorage.removeItem("clay-active-dm"); } catch (e) {}
  // Safety: clear returningFromMateDm after initial messages settle
  if (store.get('returningFromMateDm')) {
    setTimeout(function () {
      if (store.get('returningFromMateDm')) {
        store.set({ returningFromMateDm: false });
      }
    }, 2000);
  }
}

export function connect() {
  var ws = getWs();
  if (ws) { ws.onclose = null; ws.close(); }
  if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }

  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var newWs = new WebSocket(protocol + "//" + location.host + store.get('wsPath'));
  setWs(newWs);

  // If not connected within 3s, force retry
  connectTimeoutId = setTimeout(function () {
    if (!store.get('connected')) {
      newWs.onclose = null;
      newWs.onerror = null;
      newWs.close();
      connect();
    }
  }, 3000);

  newWs.onopen = function () {
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
    setStatus("connected");
    reconnectDelay = 1000;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    // Wrap ws.send to blink LED on outgoing traffic
    var currentWs = getWs();
    var _origSend = currentWs.send.bind(currentWs);
    currentWs.send = function (data) {
      blinkIO();
      return _origSend(data);
    };

    onConnected();
  };

  newWs.onclose = function (e) {
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
    closeDmUserPicker();
    setStatus("disconnected");
    setActivity(null);
    scheduleReconnect();
  };

  newWs.onerror = function () {};

  newWs.onmessage = function (event) {
    // Backup: if we're receiving messages, we're connected
    if (!store.get('connected')) {
      setStatus("connected");
      reconnectDelay = 1000;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    }

    blinkIO();
    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    processMessage(msg);
  };
}

export function cancelReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

export function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    // Check if auth is still valid before reconnecting
    fetch("/info").then(function (res) {
      if (res.status === 401) {
        location.reload();
        return;
      }
      connect();
    }).catch(function () {
      // Server still down, try connecting anyway
      connect();
    });
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
}
