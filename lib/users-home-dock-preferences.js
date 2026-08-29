// Per-user persistence for the home tool dock.

function attachHomeDockPreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;

  function defaults() {
    return { dockOpen: false, dockWidth: null, activeToolId: null };
  }

  function normalize(value) {
    var source = value && typeof value === "object" ? value : {};
    var width = typeof source.dockWidth === "number" && Number.isFinite(source.dockWidth)
      ? Math.max(420, Math.min(1600, Math.round(source.dockWidth)))
      : null;
    var toolId = typeof source.activeToolId === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(source.activeToolId)
      ? source.activeToolId
      : null;
    return {
      dockOpen: source.dockOpen === true,
      dockWidth: width,
      activeToolId: toolId,
    };
  }

  function loadSingleUserPreference() {
    try {
      var config = require("./config");
      var current = config.loadConfig() || {};
      return normalize(current.homeDockPreference);
    } catch (e) {
      return defaults();
    }
  }

  function saveSingleUserPreference(preference) {
    try {
      var config = require("./config");
      var current = config.loadConfig() || {};
      config.saveConfig(Object.assign({}, current, { homeDockPreference: preference }));
      return { ok: true, preference: preference };
    } catch (e) {
      return { error: "Unable to save home dock preference" };
    }
  }

  function getHomeDockPreference(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) return normalize(data.users[i].homeDockPreference);
    }
    if (userId === "default") return loadSingleUserPreference();
    return defaults();
  }

  function setHomeDockPreference(userId, patch) {
    var current = getHomeDockPreference(userId);
    var next = normalize(Object.assign({}, current, patch || {}));
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id !== userId) continue;
      data.users[i].homeDockPreference = next;
      saveUsers(data);
      return { ok: true, preference: next };
    }
    if (userId === "default") return saveSingleUserPreference(next);
    return { error: "User not found" };
  }

  return {
    getHomeDockPreference: getHomeDockPreference,
    setHomeDockPreference: setHomeDockPreference,
  };
}

module.exports = { attachHomeDockPreferences: attachHomeDockPreferences };
