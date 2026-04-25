var crypto = require("crypto");

function attachAuth(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;
  var findAdmin = deps.findAdmin;

  // --- Multi-user mode ---

  function isMultiUser() {
    var data = loadUsers();
    return !!data.multiUser;
  }

  function enableMultiUser() {
    var data = loadUsers();
    if (data.multiUser) {
      // Already enabled -- check if admin exists
      var admin = findAdmin(data);
      if (admin) {
        return { alreadyEnabled: true, hasAdmin: true, setupCode: null };
      }
      // Multi-user enabled but no admin -- regenerate setup code
      var code = generateSetupCode();
      data.setupCode = code;
      saveUsers(data);
      return { alreadyEnabled: true, hasAdmin: false, setupCode: code };
    }
    var code = generateSetupCode();
    data.multiUser = true;
    data.setupCode = code;
    saveUsers(data);
    return { alreadyEnabled: false, hasAdmin: false, setupCode: code };
  }

  function disableMultiUser() {
    var data = loadUsers();
    data.multiUser = false;
    data.setupCode = null;
    saveUsers(data);
  }

  // --- Setup code ---

  function generateSetupCode() {
    var chars = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous chars
    var code = "";
    var bytes = crypto.randomBytes(6);
    for (var i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  function getSetupCode() {
    var data = loadUsers();
    if (data.setupCode) return data.setupCode;
    // Defensive: if multi-user is on, no admin, and no code, auto-generate one
    if (data.multiUser && !findAdmin(data)) {
      var code = generateSetupCode();
      data.setupCode = code;
      saveUsers(data);
      return code;
    }
    return null;
  }

  function clearSetupCode() {
    var data = loadUsers();
    data.setupCode = null;
    saveUsers(data);
  }

  function validateSetupCode(code) {
    var data = loadUsers();
    if (!data.setupCode) return false;
    return data.setupCode === code;
  }

  // --- Pin hashing ---

  function hashPin(pin) {
    return crypto.createHash("sha256").update("clay-user:" + pin).digest("hex");
  }

  // Generate a random 6-digit PIN
  function generatePin() {
    var digits = "";
    var bytes = crypto.randomBytes(6);
    for (var i = 0; i < 6; i++) {
      digits += (bytes[i] % 10).toString();
    }
    return digits;
  }

  // --- Authentication ---

  function authenticateUser(username, pin) {
    var data = loadUsers();
    var user = null;
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].username.toLowerCase() === username.toLowerCase()) {
        user = data.users[i];
        break;
      }
    }
    if (!user) return null;
    var pinH = hashPin(pin);
    if (user.pinHash !== pinH) return null;
    return user;
  }

  // --- Auth tokens ---

  function generateUserAuthToken(userId) {
    var token = crypto.randomBytes(32).toString("hex");
    return userId + ":" + token;
  }

  function parseAuthCookie(cookieValue) {
    if (!cookieValue) return null;
    var idx = cookieValue.indexOf(":");
    if (idx < 0) return null;
    return {
      userId: cookieValue.substring(0, idx),
      token: cookieValue.substring(idx + 1),
    };
  }

  return {
    isMultiUser: isMultiUser,
    enableMultiUser: enableMultiUser,
    disableMultiUser: disableMultiUser,
    generateSetupCode: generateSetupCode,
    getSetupCode: getSetupCode,
    clearSetupCode: clearSetupCode,
    validateSetupCode: validateSetupCode,
    hashPin: hashPin,
    generatePin: generatePin,
    authenticateUser: authenticateUser,
    generateUserAuthToken: generateUserAuthToken,
    parseAuthCookie: parseAuthCookie,
  };
}

module.exports = { attachAuth: attachAuth };
