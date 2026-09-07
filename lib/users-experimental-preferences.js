function attachExperimentalPreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;

  function getCapsulesEnabled(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) return data.users[i].capsulesEnabled === true;
    }
    return false;
  }

  function setCapsulesEnabled(userId, enabled) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id !== userId) continue;
      data.users[i].capsulesEnabled = enabled === true;
      saveUsers(data);
      return { ok: true, capsulesEnabled: data.users[i].capsulesEnabled };
    }
    return { error: "User not found" };
  }

  return {
    getCapsulesEnabled: getCapsulesEnabled,
    setCapsulesEnabled: setCapsulesEnabled,
  };
}

module.exports = { attachExperimentalPreferences: attachExperimentalPreferences };
