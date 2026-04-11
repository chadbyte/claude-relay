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

  function getDeletedBuiltinKeys(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].deletedBuiltinKeys || [];
      }
    }
    return [];
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
    setMateOnboarded: setMateOnboarded,
  };
}

module.exports = { attachPreferences: attachPreferences };
