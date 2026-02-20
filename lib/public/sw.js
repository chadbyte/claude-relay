self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data.json(); } catch (e) { return; }

  // Silent validation push, do not show notification
  if (data.type === "test") return;

  var options = {
    body: data.body || "",
    tag: data.tag || "claude-relay",
    data: data,
  };

  if (data.type === "permission_request") {
    options.requireInteraction = true;
    options.tag = "perm-" + data.requestId;
  } else if (data.type === "done") {
    options.tag = data.tag || "claude-done";
  } else if (data.type === "ask_user") {
    options.requireInteraction = true;
    options.tag = "claude-ask";
  } else if (data.type === "error") {
    options.requireInteraction = true;
    options.tag = "claude-error";
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      // Always show permission requests, questions, and errors
      // Only suppress "done" notifications when app is in foreground
      if (data.type !== "permission_request" && data.type !== "ask_user" && data.type !== "error") {
        for (var i = 0; i < clientList.length; i++) {
          if (clientList[i].focused || clientList[i].visibilityState === "visible") return;
        }
      }
      return self.registration.showNotification(data.title || "Claude Relay", options);
    }).catch(function () {})
  );
});

self.addEventListener("notificationclick", function (event) {
  var data = event.notification.data || {};
  event.notification.close();

  // Build target URL from slug so we open the correct project
  var baseUrl = self.registration.scope || "/";
  var targetUrl = data.slug ? baseUrl + "p/" + data.slug + "/" : baseUrl;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      // Prefer a client already on the correct project
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url.indexOf(targetUrl) !== -1) {
          return clientList[i].focus();
        }
      }
      // Fall back to any visible client
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].visibilityState !== "hidden") {
          return clientList[i].focus();
        }
      }
      if (clientList.length > 0) return clientList[0].focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
