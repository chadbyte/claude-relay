self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data.json(); } catch (e) { return; }

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
      // Skip notification if app is focused (user is already looking at it)
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].focused || clientList[i].visibilityState === "visible") return;
      }
      return self.registration.showNotification(data.title || "Claude Relay", options);
    }).catch(function () {})
  );
});

self.addEventListener("notificationclick", function (event) {
  var data = event.notification.data || {};
  event.notification.close();

  // Default click: focus existing window or open new one
  // Use the service worker's scope as the base URL for this project
  var scopeUrl = self.registration.scope || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].visibilityState !== "hidden") {
          return clientList[i].focus();
        }
      }
      if (clientList.length > 0) return clientList[0].focus();
      return self.clients.openWindow(scopeUrl);
    })
  );
});
