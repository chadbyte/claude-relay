// WebSocket bridge for user-scoped home surface preferences.

function attachHomePreferences(deps) {
  var users = deps.users;
  var projects = deps.projects;

  function socketUserId(ws) {
    if (!users.isMultiUser()) return "default";
    return ws._clayUser ? ws._clayUser.id : null;
  }

  function send(ws, payload) {
    if (ws.readyState !== undefined && ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  }

  function broadcast(userId, preference) {
    var sent = new Set();
    projects.forEach(function (projectContext) {
      projectContext.forEachClient(function (otherWs) {
        if (sent.has(otherWs) || socketUserId(otherWs) !== userId) return;
        sent.add(otherWs);
        send(otherWs, { type: "home_dock_state", preference: preference });
      });
    });
  }

  function handleMessage(ws, msg) {
    if (msg.type !== "home_dock_get" && msg.type !== "home_dock_set" && msg.type !== "home_surface_get" && msg.type !== "home_surface_set") return false;
    var userId = socketUserId(ws);
    if (!userId) return true;
    if (msg.type === "home_surface_get") {
      send(ws, { type: "home_surface_state", preference: users.getHomeSurfacePreference(userId) });
      return true;
    }
    if (msg.type === "home_surface_set") {
      var surfaceResult = users.setHomeSurfacePreference(userId, msg.preference || {});
      send(ws, {
        type: "home_surface_state",
        preference: surfaceResult.preference || users.getHomeSurfacePreference(userId),
        error: surfaceResult.error || null,
      });
      return true;
    }
    if (msg.type === "home_dock_get") {
      send(ws, { type: "home_dock_state", preference: users.getHomeDockPreference(userId) });
      return true;
    }
    var result = users.setHomeDockPreference(userId, msg.preference || {});
    if (result.error) {
      send(ws, { type: "home_dock_state", error: result.error });
      return true;
    }
    broadcast(userId, result.preference);
    return true;
  }

  return { handleMessage: handleMessage };
}

module.exports = { attachHomePreferences: attachHomePreferences };
