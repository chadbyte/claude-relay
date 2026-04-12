// app-connection.js - WebSocket connection, reconnect, status
// Extracted from app.js (PR-22)

var _ctx = null;
var wasConnected = false;
var reconnectTimer = null;
var reconnectDelay = 1000;
var connectTimeoutId = null;
var disconnectNotifTimer = null;
var disconnectNotifShown = false;

export function initConnection(ctx) {
  _ctx = ctx;
}

export function setStatus(status) {
  var dot = _ctx.getStatusDot();
  if (dot) dot.className = "icon-strip-status";
  if (status === "connected") {
    if (dot) dot.classList.add("connected");
    _ctx.setConnected(true);
    _ctx.setProcessing(false);
    _ctx.sendBtn.disabled = false;
    _ctx.setSendBtnMode("send");
    _ctx.connectOverlay.classList.add("hidden");
    // Hide update banner on reconnect; server will re-send update_available if still needed
    var updPill = document.getElementById("update-pill-wrap");
    if (updPill) updPill.classList.add("hidden");
    _ctx.stopVerbCycle();
  } else if (status === "processing") {
    if (dot) { dot.classList.add("connected"); dot.classList.add("processing"); }
    _ctx.setProcessing(true);
    _ctx.setSendBtnMode(_ctx.hasSendableContent() ? "send" : "stop");
  } else {
    _ctx.setConnected(false);
    _ctx.sendBtn.disabled = true;
    _ctx.connectOverlay.classList.remove("hidden");
    _ctx.startVerbCycle();
  }
}

export function connect() {
  var ws = _ctx.getWs();
  if (ws) { ws.onclose = null; ws.close(); }
  if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }

  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var newWs = new WebSocket(protocol + "//" + location.host + _ctx.getWsPath());
  _ctx.setWs(newWs);

  // If not connected within 3s, force retry
  connectTimeoutId = setTimeout(function () {
    if (!_ctx.isConnected()) {
      newWs.onclose = null;
      newWs.onerror = null;
      newWs.close();
      connect();
    }
  }, 3000);

  newWs.onopen = function () {
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
    // Cancel pending "connection lost" notification if reconnected quickly
    if (disconnectNotifTimer) {
      clearTimeout(disconnectNotifTimer);
      disconnectNotifTimer = null;
    }
    // Only show "restored" notification if "lost" was actually shown
    var isMobileDevice = /Mobi|Android|iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (wasConnected && disconnectNotifShown && !isMobileDevice && _ctx.isNotifAlertEnabled() && !document.hasFocus() && "serviceWorker" in navigator && Notification.permission === "granted") {
      navigator.serviceWorker.ready.then(function (reg) {
        return reg.showNotification("Clay", {
          body: "Server connection restored",
          tag: "claude-disconnect",
        });
      }).catch(function () {});
    }
    disconnectNotifShown = false;
    wasConnected = true;
    setStatus("connected");
    reconnectDelay = 1000;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    // Wrap ws.send to blink LED on outgoing traffic
    var currentWs = _ctx.getWs();
    var _origSend = currentWs.send.bind(currentWs);
    currentWs.send = function (data) {
      _ctx.blinkIO();
      return _origSend(data);
    };

    _ctx.onConnected();
  };

  newWs.onclose = function (e) {
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
    _ctx.closeDmUserPicker();
    setStatus("disconnected");
    _ctx.setProcessing(false);
    _ctx.setActivity(null);
    // Delay "connection lost" notification by 5s to suppress brief disconnects
    if (!disconnectNotifTimer) {
      disconnectNotifTimer = setTimeout(function () {
        disconnectNotifTimer = null;
        disconnectNotifShown = true;
        var isMobileDevice = /Mobi|Android|iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        if (!isMobileDevice && _ctx.isNotifAlertEnabled() && !document.hasFocus() && "serviceWorker" in navigator && Notification.permission === "granted") {
          navigator.serviceWorker.ready.then(function (reg) {
            return reg.showNotification("Clay", {
              body: "Server connection lost",
              tag: "claude-disconnect",
            });
          }).catch(function () {});
        }
      }, 5000);
    }
    scheduleReconnect();
  };

  newWs.onerror = function () {};

  newWs.onmessage = function (event) {
    // Backup: if we're receiving messages, we're connected
    if (!_ctx.isConnected()) {
      setStatus("connected");
      reconnectDelay = 1000;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    }

    _ctx.blinkIO();
    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    _ctx.processMessage(msg);
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
