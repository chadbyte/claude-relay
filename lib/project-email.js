// Project-level email module.
// Handles email context injection and unread polling.
// Follows the attachXxx(ctx) pattern.

var fs = require("fs");
var path = require("path");
var emailAccounts = require("./email-accounts");
var smtp = require("./smtp");
var { CONFIG_DIR } = require("./config");

var AUDIT_LOG_PATH = path.join(CONFIG_DIR, "email-audit.jsonl");
var EMAIL_DEFAULTS_DIR = path.join(CONFIG_DIR, "email-defaults");

// --- Project-level email defaults ---
// Stores which email accounts should be auto-enabled for every new session.

function loadEmailDefaults(slug) {
  try {
    var filePath = path.join(EMAIL_DEFAULTS_DIR, slug + ".json");
    var data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return data.accounts || [];
  } catch (e) {
    return [];
  }
}

function saveEmailDefaults(slug, accountIds) {
  try {
    fs.mkdirSync(EMAIL_DEFAULTS_DIR, { recursive: true });
    var filePath = path.join(EMAIL_DEFAULTS_DIR, slug + ".json");
    fs.writeFileSync(filePath, JSON.stringify({ accounts: accountIds }), "utf8");
  } catch (e) {
    console.error("[email] Failed to save defaults:", e.message);
  }
}

// --- Audit log (Server SMTP only) ---

function appendAuditLog(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error("[email] Failed to write audit log:", e.message);
  }
}

// --- Unread count fetching ---

function fetchUnreadCount(account) {
  var ImapFlow;
  try { ImapFlow = require("imapflow").ImapFlow; } catch (e) {
    return Promise.resolve(0);
  }

  var client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port || 993,
    secure: account.imap.tls !== false,
    auth: { user: account.email, pass: account.appPassword },
    logger: false,
  });

  return client.connect().then(function () {
    return client.status("INBOX", { unseen: true });
  }).then(function (status) {
    var count = status.unseen || 0;
    return client.logout().then(function () {
      return count;
    });
  }).catch(function () {
    try { client.close(); } catch (e) {}
    return 0;
  });
}

// --- Email context builder (for injecting into user messages) ---

function buildEmailContext(accounts, limit) {
  if (!accounts || accounts.length === 0) return Promise.resolve("");

  var perAccount = Math.max(Math.floor((limit || 10) / accounts.length), 3);

  var ImapFlow;
  try { ImapFlow = require("imapflow").ImapFlow; } catch (e) {
    return Promise.resolve("");
  }

  var promises = accounts.map(function (account) {
    var client = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port || 993,
      secure: account.imap.tls !== false,
      auth: { user: account.email, pass: account.appPassword },
      logger: false,
    });

    return client.connect().then(function () {
      return client.getMailboxLock("INBOX");
    }).then(function (lock) {
      return client.search({ seen: false }, { uid: true }).then(function (uids) {
        if (!uids || uids.length === 0) {
          lock.release();
          return client.logout().then(function () {
            return { email: account.email, unread: 0, messages: [] };
          });
        }

        var recentUids = uids.slice(-perAccount).reverse();

        var fetchIter = client.fetch(recentUids, {
          uid: true,
          envelope: true,
          flags: true,
        }, { uid: true });
        var messages = [];

        function collect() {
          return fetchIter.next().then(function (result) {
            if (result.done) return;
            var msg = result.value;
            var env = msg.envelope || {};
            var fromAddr = env.from && env.from[0] ? (env.from[0].address || "") : "";
            var date = env.date || new Date();
            var ago = formatTimeAgo(date);
            messages.push({
              from: fromAddr,
              subject: env.subject || "(no subject)",
              ago: ago,
            });
            return collect();
          });
        }

        return collect().then(function () {
          lock.release();
          return client.logout().then(function () {
            return { email: account.email, unread: uids.length, messages: messages };
          });
        });
      });
    }).catch(function () {
      try { client.close(); } catch (e) {}
      return { email: account.email, unread: 0, messages: [], error: true };
    });
  });

  return Promise.all(promises).then(function (results) {
    var parts = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (r.messages.length === 0 && !r.error) continue;
      var header = "--- Email Context: " + r.email + " (" + r.unread + " unread) ---";
      var lines = [];
      for (var j = 0; j < r.messages.length; j++) {
        var m = r.messages[j];
        lines.push((j + 1) + ". From: " + m.from + " | Subject: " + m.subject + " | " + m.ago);
      }
      if (lines.length > 0) {
        parts.push(header + "\n" + lines.join("\n"));
      } else {
        parts.push(header + "\n(unable to fetch messages)");
      }
    }
    return parts.join("\n\n");
  });
}

function formatTimeAgo(date) {
  var now = Date.now();
  var d = date instanceof Date ? date : new Date(date);
  var diff = now - d.getTime();
  if (diff < 0) diff = 0;
  var minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  var days = Math.floor(hours / 24);
  return days + "d ago";
}

// --- Module attachment ---

function attachEmail(ctx) {
  var slug = ctx.slug;
  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var clients = ctx.clients;
  var loadContextSources = ctx.loadContextSources;
  var getUserIdForWs = ctx.getUserIdForWs;

  // Unread count cache: { accountId: { count, fetchedAt } }
  var unreadCache = {};
  var POLL_INTERVAL_ACTIVE = 2 * 60 * 1000;  // 2 minutes for checked accounts
  var POLL_INTERVAL_IDLE = 10 * 60 * 1000;    // 10 minutes for unchecked
  var pollTimer = null;

  function getCheckedEmailAccounts(userId, sessionId) {
    var sources = loadContextSources(slug, sessionId);
    var accounts = [];
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].startsWith("email:")) {
        var accountId = sources[i].split(":")[1];
        var acc = emailAccounts.getAccountDecrypted(userId, accountId);
        if (acc) accounts.push(acc);
      }
    }
    return accounts;
  }

  function getCheckedEmailAccountsByEmail(userId, sessionId) {
    var sources = loadContextSources(slug, sessionId);
    var emailIds = [];
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].startsWith("email:")) {
        emailIds.push(sources[i].split(":")[1]);
      }
    }
    if (emailIds.length === 0) return [];
    var allAccounts = emailAccounts.listAccounts(userId);
    var checked = [];
    for (var j = 0; j < allAccounts.length; j++) {
      if (emailIds.indexOf(allAccounts[j].id) !== -1) {
        var dec = emailAccounts.getAccountDecrypted(userId, allAccounts[j].id);
        if (dec) checked.push(dec);
      }
    }
    return checked;
  }

  // Poll unread counts and push updates
  function pollUnreadCounts() {
    // Find first connected client to get userId
    var userId = null;
    for (var ws of clients) {
      if (ws.readyState === 1) {
        userId = (ws._clayUser && ws._clayUser.id) || "default";
        break;
      }
    }
    if (!userId) return;

    var allAccounts = emailAccounts.listAccounts(userId);
    if (allAccounts.length === 0) return;

    // Collect checked email IDs across all connected clients' sessions
    var checkedIds = {};
    for (var ws2 of clients) {
      if (ws2.readyState !== 1) continue;
      var sid = ws2._clayActiveSession || null;
      var sources = loadContextSources(slug, sid);
      for (var i = 0; i < sources.length; i++) {
        if (sources[i].startsWith("email:")) {
          checkedIds[sources[i].split(":")[1]] = true;
        }
      }
    }

    var toFetch = [];
    for (var j = 0; j < allAccounts.length; j++) {
      var acc = allAccounts[j];
      var isChecked = !!checkedIds[acc.id];
      var interval = isChecked ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE;
      var cached = unreadCache[acc.id];
      if (!cached || (Date.now() - cached.fetchedAt) > interval) {
        toFetch.push(acc);
      }
    }

    if (toFetch.length === 0) return;

    var fetchPromises = toFetch.map(function (acc) {
      var decrypted = emailAccounts.getAccountDecrypted(userId, acc.id);
      if (!decrypted) return Promise.resolve(null);
      return fetchUnreadCount(decrypted).then(function (count) {
        return { id: acc.id, count: count };
      });
    });

    Promise.all(fetchPromises).then(function (results) {
      var changed = false;
      for (var k = 0; k < results.length; k++) {
        if (!results[k]) continue;
        var prev = unreadCache[results[k].id];
        unreadCache[results[k].id] = { count: results[k].count, fetchedAt: Date.now() };
        if (!prev || prev.count !== results[k].count) changed = true;
      }
      if (changed) {
        var updates = {};
        var ukeys = Object.keys(unreadCache);
        for (var m = 0; m < ukeys.length; m++) {
          updates[ukeys[m]] = unreadCache[ukeys[m]].count;
        }
        var msg = JSON.stringify({ type: "email_unread_update", unread: updates });
        for (var ws of clients) {
          if (ws.readyState === 1) ws.send(msg);
        }
      }
    }).catch(function () {});
  }

  // Start polling
  pollTimer = setInterval(pollUnreadCounts, 60000); // Check every minute
  // Initial poll after 5 seconds
  setTimeout(pollUnreadCounts, 5000);

  // Get email context for message injection
  function getEmailContext(userId, sessionId) {
    var checked = getCheckedEmailAccountsByEmail(userId, sessionId);
    if (checked.length === 0) return Promise.resolve("");
    return buildEmailContext(checked, 10);
  }

  // Collect checked email accounts across all connected clients' active sessions
  function getAllCheckedAccounts(userId) {
    var seen = {};
    var result = [];
    for (var ws of clients) {
      if (ws.readyState !== 1) continue;
      var sid = ws._clayActiveSession || null;
      var checked = getCheckedEmailAccountsByEmail(userId, sid);
      for (var ci = 0; ci < checked.length; ci++) {
        if (!seen[checked[ci].id]) {
          seen[checked[ci].id] = true;
          result.push(checked[ci]);
        }
      }
    }
    // Fallback: if no session-level sources found, check project email defaults
    if (result.length === 0) {
      var defaults = loadEmailDefaults(slug);
      for (var di = 0; di < defaults.length; di++) {
        var dec = emailAccounts.getAccountDecrypted(userId, defaults[di]);
        if (dec && !seen[dec.id]) {
          seen[dec.id] = true;
          result.push(dec);
        }
      }
    }
    return result;
  }

  // Resolve the active userId from connected clients at call time
  function getActiveUserId() {
    for (var ws of clients) {
      if (ws.readyState === 1 && ws._clayUser && ws._clayUser.id) {
        return ws._clayUser.id;
      }
    }
    return "default";
  }

  // Create MCP server dependencies (userId resolved dynamically per call)
  function createMcpDeps() {
    return {
      getAccountForTool: function (email) {
        return emailAccounts.getAccountByEmailDecrypted(getActiveUserId(), email);
      },
      getCheckedAccounts: function () {
        return getAllCheckedAccounts(getActiveUserId());
      },
      getServerSmtp: function () {
        if (!smtp.isSmtpConfigured()) return null;
        return {
          sendMail: function (to, subject, body) {
            return smtp.sendMail(to, subject, '<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">' + body.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</pre>');
          },
        };
      },
      appendAuditLog: function (entry) {
        entry.userId = getActiveUserId();
        entry.projectSlug = slug;
        appendAuditLog(entry);
      },
    };
  }

  function handleEmailMessage(ws, msg) {
    if (msg.type === "email_defaults_get") {
      var defaults = loadEmailDefaults(slug);
      sendTo(ws, { type: "email_defaults", accounts: defaults });
      return true;
    }
    if (msg.type === "email_defaults_save") {
      var accountIds = msg.accounts || [];
      saveEmailDefaults(slug, accountIds);
      // Broadcast to all clients on this project
      var _defMsg = JSON.stringify({ type: "email_defaults", accounts: accountIds });
      for (var c of clients) { if (c.readyState === 1) c.send(_defMsg); }
      return true;
    }
    return false;
  }

  // Get default email account IDs for new sessions
  function getEmailDefaults() {
    return loadEmailDefaults(slug);
  }

  function destroy() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return {
    handleEmailMessage: handleEmailMessage,
    getEmailContext: getEmailContext,
    getCheckedEmailAccounts: getCheckedEmailAccounts,
    getEmailDefaults: getEmailDefaults,
    createMcpDeps: createMcpDeps,
    destroy: destroy,
  };
}

module.exports = { attachEmail: attachEmail, appendAuditLog: appendAuditLog };
