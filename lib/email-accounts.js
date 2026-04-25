// Email account storage and CRUD for per-user email accounts.
// Each user's accounts stored at ~/.clay/email/{userId}.json
// Provides provider presets, connection testing, and account management.

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var nodemailer = require("nodemailer");
var { CONFIG_DIR, chmodSafe } = require("./config");

var EMAIL_DIR = path.join(CONFIG_DIR, "email");

// --- Encryption key (derived from machine-specific secret) ---

var _encKey = null;
function getEncKey() {
  if (_encKey) return _encKey;
  // Derive a stable encryption key from CONFIG_DIR path + a salt file.
  // If the salt file does not exist, create one.
  var saltPath = path.join(CONFIG_DIR, ".email-salt");
  var salt;
  try {
    salt = fs.readFileSync(saltPath, "utf8").trim();
  } catch (e) {
    salt = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(saltPath, salt);
    chmodSafe(saltPath, 0o600);
  }
  _encKey = crypto.scryptSync(salt, "clay-email-accounts", 32);
  return _encKey;
}

function encrypt(text) {
  var iv = crypto.randomBytes(16);
  var cipher = crypto.createCipheriv("aes-256-gcm", getEncKey(), iv);
  var encrypted = cipher.update(text, "utf8", "hex") + cipher.final("hex");
  var tag = cipher.getAuthTag().toString("hex");
  return iv.toString("hex") + ":" + tag + ":" + encrypted;
}

function decrypt(data) {
  var parts = data.split(":");
  if (parts.length !== 3) return data; // not encrypted (legacy), return as-is
  var iv = Buffer.from(parts[0], "hex");
  var tag = Buffer.from(parts[1], "hex");
  var encrypted = parts[2];
  var decipher = crypto.createDecipheriv("aes-256-gcm", getEncKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
}

// --- Provider presets ---

var PROVIDER_PRESETS = {
  gmail: {
    label: "Gmail",
    imap: { host: "imap.gmail.com", port: 993, tls: true },
    smtp: { host: "smtp.gmail.com", port: 587 },
    helpUrl: "https://support.google.com/accounts/answer/185833",
  },
  outlook: {
    label: "Outlook",
    imap: { host: "outlook.office365.com", port: 993, tls: true },
    smtp: { host: "smtp.office365.com", port: 587 },
    helpUrl: "https://support.microsoft.com/en-us/account-billing/using-app-passwords-with-apps-that-don-t-support-two-step-verification-5896ed9b-4263-e681-128a-a6f2979a7944",
  },
  yahoo: {
    label: "Yahoo",
    imap: { host: "imap.mail.yahoo.com", port: 993, tls: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 587 },
    helpUrl: "https://help.yahoo.com/kb/generate-manage-third-party-passwords-sln15241.html",
  },
};

// --- Storage helpers ---

function ensureEmailDir() {
  fs.mkdirSync(EMAIL_DIR, { recursive: true });
  chmodSafe(EMAIL_DIR, 0o700);
}

function userFilePath(userId) {
  return path.join(EMAIL_DIR, userId + ".json");
}

function loadUserAccounts(userId) {
  try {
    var raw = fs.readFileSync(userFilePath(userId), "utf8");
    var data = JSON.parse(raw);
    return data.accounts || [];
  } catch (e) {
    return [];
  }
}

function saveUserAccounts(userId, accounts) {
  ensureEmailDir();
  var filePath = userFilePath(userId);
  var tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify({ accounts: accounts }, null, 2));
  chmodSafe(tmpPath, 0o600);
  fs.renameSync(tmpPath, filePath);
  chmodSafe(filePath, 0o600);
}

// --- Account CRUD ---

function generateAccountId() {
  return "acc_" + crypto.randomBytes(8).toString("hex");
}

function listAccounts(userId) {
  var accounts = loadUserAccounts(userId);
  // Return accounts without exposing app passwords
  return accounts.map(function (acc) {
    return {
      id: acc.id,
      email: acc.email,
      provider: acc.provider,
      label: acc.label || "",
      imap: acc.imap,
      smtp: acc.smtp,
      addedAt: acc.addedAt,
    };
  });
}

function getAccount(userId, accountId) {
  var accounts = loadUserAccounts(userId);
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].id === accountId) return accounts[i];
  }
  return null;
}

function getAccountByEmail(userId, email) {
  var accounts = loadUserAccounts(userId);
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].email === email) return accounts[i];
  }
  return null;
}

function getAccountDecrypted(userId, accountId) {
  var acc = getAccount(userId, accountId);
  if (!acc) return null;
  return Object.assign({}, acc, { appPassword: decrypt(acc.appPassword) });
}

function getAccountByEmailDecrypted(userId, email) {
  var acc = getAccountByEmail(userId, email);
  if (!acc) return null;
  return Object.assign({}, acc, { appPassword: decrypt(acc.appPassword) });
}

function addAccount(userId, opts) {
  var accounts = loadUserAccounts(userId);

  // Check for duplicate email
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].email === opts.email) {
      return { error: "Account with this email already exists" };
    }
  }

  var provider = opts.provider || "custom";
  var preset = PROVIDER_PRESETS[provider];

  var account = {
    id: generateAccountId(),
    email: opts.email,
    provider: provider,
    imap: opts.imap || (preset ? Object.assign({}, preset.imap) : { host: "", port: 993, tls: true }),
    smtp: opts.smtp || (preset ? Object.assign({}, preset.smtp) : { host: "", port: 587 }),
    appPassword: encrypt(opts.appPassword),
    addedAt: Date.now(),
    label: opts.label || (preset ? preset.label : "Custom"),
  };

  accounts.push(account);
  saveUserAccounts(userId, accounts);

  return {
    ok: true,
    account: {
      id: account.id,
      email: account.email,
      provider: account.provider,
      label: account.label,
      imap: account.imap,
      smtp: account.smtp,
      addedAt: account.addedAt,
    },
  };
}

function removeAccount(userId, accountId) {
  var accounts = loadUserAccounts(userId);
  var filtered = accounts.filter(function (acc) {
    return acc.id !== accountId;
  });
  if (filtered.length === accounts.length) {
    return { error: "Account not found" };
  }
  saveUserAccounts(userId, filtered);
  return { ok: true };
}

// --- Connection testing ---

function testSmtpConnection(account) {
  var password = account.appPassword;
  // If encrypted, decrypt
  if (password.indexOf(":") !== -1 && password.length > 50) {
    try { password = decrypt(password); } catch (e) {}
  }

  var transport = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port || 587,
    secure: false,
    auth: { user: account.email, pass: password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  return transport.verify().then(function () {
    try { transport.close(); } catch (e) {}
    return { ok: true };
  }).catch(function (err) {
    try { transport.close(); } catch (e) {}
    return { ok: false, error: err.message || "SMTP connection failed" };
  });
}

function testImapConnection(account) {
  var password = account.appPassword;
  if (password.indexOf(":") !== -1 && password.length > 50) {
    try { password = decrypt(password); } catch (e) {}
  }

  var ImapFlow;
  try {
    ImapFlow = require("imapflow").ImapFlow;
  } catch (e) {
    return Promise.resolve({ ok: false, error: "imapflow module not installed" });
  }

  var client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port || 993,
    secure: account.imap.tls !== false,
    auth: { user: account.email, pass: password },
    logger: false,
  });

  return client.connect().then(function () {
    return client.logout().then(function () {
      return { ok: true };
    });
  }).catch(function (err) {
    try { client.close(); } catch (e) {}
    return { ok: false, error: err.message || "IMAP connection failed" };
  });
}

function testConnection(account) {
  return Promise.all([
    testImapConnection(account),
    testSmtpConnection(account),
  ]).then(function (results) {
    var imap = results[0];
    var smtp = results[1];
    return {
      imap: imap,
      smtp: smtp,
      ok: imap.ok && smtp.ok,
    };
  });
}

// --- Exports ---

module.exports = {
  PROVIDER_PRESETS: PROVIDER_PRESETS,
  listAccounts: listAccounts,
  getAccount: getAccount,
  getAccountByEmail: getAccountByEmail,
  getAccountDecrypted: getAccountDecrypted,
  getAccountByEmailDecrypted: getAccountByEmailDecrypted,
  addAccount: addAccount,
  removeAccount: removeAccount,
  testConnection: testConnection,
  testImapConnection: testImapConnection,
  testSmtpConnection: testSmtpConnection,
  encrypt: encrypt,
  decrypt: decrypt,
};
