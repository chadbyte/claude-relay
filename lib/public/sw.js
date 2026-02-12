self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data.json(); } catch (e) { return; }

  var options = {
    body: data.body || "",
    tag: data.tag || "claude-relay",
    data: data,
  };

  if (data.type === "permission_request") {
    options.actions = [
      { action: "allow", title: "Allow" },
      { action: "deny", title: "Deny" },
    ];
    options.requireInteraction = true;
    options.tag = "perm-" + data.requestId;
  } else if (data.type === "done") {
    options.tag = data.tag || "claude-done";
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Claude Relay", options)
  );
});

self.addEventListener("notificationclick", function (event) {
  var data = event.notification.data || {};
  event.notification.close();

  if (event.action === "allow" || event.action === "deny") {
    event.waitUntil(
      fetch("/api/permission-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: data.requestId,
          decision: event.action,
        }),
      })
    );
    return;
  }

  // Default click: focus existing window or open new one
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].visibilityState !== "hidden") {
          return clientList[i].focus();
        }
      }
      if (clientList.length > 0) return clientList[0].focus();
      return self.clients.openWindow("/");
    })
  );
});
