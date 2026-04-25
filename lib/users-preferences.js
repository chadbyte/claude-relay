function attachPreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;

  // --- DM Favorites ---

  function getDmFavorites(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].dmFavorites || [];
      }
    }
    return [];
  }

  function addDmFavorite(userId, targetUserId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        if (!data.users[i].dmFavorites) data.users[i].dmFavorites = [];
        if (data.users[i].dmFavorites.indexOf(targetUserId) === -1) {
          data.users[i].dmFavorites.push(targetUserId);
          saveUsers(data);
        }
        return data.users[i].dmFavorites;
      }
    }
    return [];
  }

  function removeDmFavorite(userId, targetUserId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        if (!data.users[i].dmFavorites) data.users[i].dmFavorites = [];
        data.users[i].dmFavorites = data.users[i].dmFavorites.filter(function (id) {
          return id !== targetUserId;
        });
        saveUsers(data);
        return data.users[i].dmFavorites;
      }
    }
    return [];
  }

  // --- DM Hidden (dismissed from strip) ---

  function getDmHidden(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].dmHidden || [];
      }
    }
    return [];
  }

  function addDmHidden(userId, targetUserId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        if (!data.users[i].dmHidden) data.users[i].dmHidden = [];
        if (data.users[i].dmHidden.indexOf(targetUserId) === -1) {
          data.users[i].dmHidden.push(targetUserId);
          saveUsers(data);
        }
        return data.users[i].dmHidden;
      }
    }
    return [];
  }

  function removeDmHidden(userId, targetUserId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        if (!data.users[i].dmHidden) data.users[i].dmHidden = [];
        data.users[i].dmHidden = data.users[i].dmHidden.filter(function (id) {
          return id !== targetUserId;
        });
        saveUsers(data);
        return data.users[i].dmHidden;
      }
    }
    return [];
  }

  // --- Deleted built-in mate keys tracking ---
  //
  // In single-user mode there is no users.json, so the user row lookup
  // below returns nothing and the key is silently dropped. That made
  // "Remove mate" in the sidebar picker a no-op: the key was never
  // persisted, ensureBuiltinMates re-created the mate on next mate_list,
  // and the user could not actually get rid of built-in mates.
  //
  // Fallback: when the user record isn't found (single-user mode), read
  // and write deletedBuiltinKeys on daemon.json via lib/config.js. This
  // preserves multi-user behavior (users.json row still wins) while
  // giving single-user deploys a place to persist the setting.

  function loadSingleUserDeletedKeys() {
    try {
      var config = require("./config");
      var cfg = config.loadConfig() || {};
      return Array.isArray(cfg.deletedBuiltinKeys) ? cfg.deletedBuiltinKeys : [];
    } catch (e) {
      return [];
    }
  }

  function saveSingleUserDeletedKeys(keys) {
    try {
      var config = require("./config");
      var cfg = config.loadConfig() || {};
      cfg.deletedBuiltinKeys = keys;
      config.saveConfig(cfg);
    } catch (e) {}
  }

  function getDeletedBuiltinKeys(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].deletedBuiltinKeys || [];
      }
    }
    return loadSingleUserDeletedKeys();
  }

  function addDeletedBuiltinKey(userId, key) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        if (!data.users[i].deletedBuiltinKeys) data.users[i].deletedBuiltinKeys = [];
        if (data.users[i].deletedBuiltinKeys.indexOf(key) === -1) {
          data.users[i].deletedBuiltinKeys.push(key);
          saveUsers(data);
        }
        return;
      }
    }
    // Single-user fallback
    var keys = loadSingleUserDeletedKeys();
    if (keys.indexOf(key) === -1) {
      keys.push(key);
      saveSingleUserDeletedKeys(keys);
    }
  }

  function removeDeletedBuiltinKey(userId, key) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        if (!data.users[i].deletedBuiltinKeys) return;
        data.users[i].deletedBuiltinKeys = data.users[i].deletedBuiltinKeys.filter(function (k) {
          return k !== key;
        });
        saveUsers(data);
        return;
      }
    }
    // Single-user fallback
    var keys = loadSingleUserDeletedKeys();
    var filtered = keys.filter(function (k) { return k !== key; });
    if (filtered.length !== keys.length) {
      saveSingleUserDeletedKeys(filtered);
    }
  }

  // --- Per-user chat layout setting ---

  function getChatLayout(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].chatLayout || "channel";
      }
    }
    return "channel";
  }

  function setChatLayout(userId, layout) {
    var val = (layout === "bubble") ? "bubble" : "channel";
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].chatLayout = val;
        saveUsers(data);
        return { ok: true, chatLayout: val };
      }
    }
    return { error: "User not found" };
  }

  // --- Per-user auto-continue setting ---

  function getAutoContinue(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return !!data.users[i].autoContinueOnRateLimit;
      }
    }
    return false;
  }

  function setAutoContinue(userId, enabled) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].autoContinueOnRateLimit = !!enabled;
        saveUsers(data);
        return { ok: true, autoContinueOnRateLimit: !!enabled };
      }
    }
    return { error: "User not found" };
  }

  // --- Per-user Mates UI toggle ---
  //
  // When false, the entire Mates surface (sidebar avatars, DM "Create a
  // Mate" entry, home-hub mates strip) is hidden for this user. Default
  // is ON: Mates is opt-out, not opt-in. Stored as `matesEnabled`; we
  // treat any value other than the literal `false` as enabled so brand-
  // new users (no field set) get the default-on experience.

  function getMatesEnabled(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].matesEnabled !== false;
      }
    }
    return true;
  }

  function setMatesEnabled(userId, enabled) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].matesEnabled = !!enabled;
        saveUsers(data);
        return { ok: true, matesEnabled: !!enabled };
      }
    }
    return { error: "User not found" };
  }

  // --- Per-user tool palette preferences ---
  //
  // Each user can customize the sidebar tool grid by reordering or
  // hiding individual tools. Stored as an object keyed by palette name
  // ("session" or "mate"), each holding { order: [...ids], hidden: [...ids] }.
  // Missing ids are treated as "use registry default at the end", so new
  // tools added in future releases show up for existing users without a
  // migration.

  var VALID_PALETTES = { session: true, mate: true };

  function getToolPalettes(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].toolPalettes || {};
      }
    }
    return {};
  }

  function setToolPalette(userId, paletteName, order, hidden) {
    if (!VALID_PALETTES[paletteName]) {
      return { error: "Unknown palette" };
    }
    var safeOrder = Array.isArray(order)
      ? order.filter(function (s) { return typeof s === "string"; })
      : [];
    var safeHidden = Array.isArray(hidden)
      ? hidden.filter(function (s) { return typeof s === "string"; })
      : [];
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        if (!data.users[i].toolPalettes) data.users[i].toolPalettes = {};
        data.users[i].toolPalettes[paletteName] = {
          order: safeOrder,
          hidden: safeHidden,
        };
        saveUsers(data);
        return { ok: true, palette: paletteName, order: safeOrder, hidden: safeHidden };
      }
    }
    return { error: "User not found" };
  }

  // --- Mate onboarding ---

  function setMateOnboarded(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].mateOnboardingShown = true;
        saveUsers(data);
        return { ok: true };
      }
    }
    return { error: "User not found" };
  }

  return {
    getDmFavorites: getDmFavorites,
    addDmFavorite: addDmFavorite,
    removeDmFavorite: removeDmFavorite,
    getDmHidden: getDmHidden,
    addDmHidden: addDmHidden,
    removeDmHidden: removeDmHidden,
    getDeletedBuiltinKeys: getDeletedBuiltinKeys,
    addDeletedBuiltinKey: addDeletedBuiltinKey,
    removeDeletedBuiltinKey: removeDeletedBuiltinKey,
    getChatLayout: getChatLayout,
    setChatLayout: setChatLayout,
    getAutoContinue: getAutoContinue,
    setAutoContinue: setAutoContinue,
    getMatesEnabled: getMatesEnabled,
    setMatesEnabled: setMatesEnabled,
    getToolPalettes: getToolPalettes,
    setToolPalette: setToolPalette,
    setMateOnboarded: setMateOnboarded,
  };
}

module.exports = { attachPreferences: attachPreferences };
