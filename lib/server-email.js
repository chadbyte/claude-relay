// Server-level WebSocket handlers for email account management.
// Handles add/remove/test/list of per-user email accounts.
// Follows the same pattern as server-mates.js.

var emailAccounts = require("./email-accounts");

function attachEmail(ctx) {
  var users = ctx.users;

  function getUserId(ws) {
    if (users.isMultiUser()) {
      if (!ws._clayUser) return null;
      return ws._clayUser.id;
    }
    return "default";
  }

  function sendTo(ws, obj) {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify(obj));
    } catch (e) {}
  }

  function handleMessage(ws, msg) {
    var userId = getUserId(ws);
    if (!userId) return false;

    if (msg.type === "email_accounts_list") {
      var accounts = emailAccounts.listAccounts(userId);
      sendTo(ws, {
        type: "email_accounts_list",
        accounts: accounts,
        providers: emailAccounts.PROVIDER_PRESETS,
      });
      return true;
    }

    if (msg.type === "email_account_add") {
      if (!msg.email || !msg.appPassword) {
        sendTo(ws, { type: "email_account_add_result", ok: false, error: "Email and app password are required" });
        return true;
      }

      var result = emailAccounts.addAccount(userId, {
        email: msg.email,
        provider: msg.provider || "custom",
        appPassword: msg.appPassword,
        label: msg.label || "",
        imap: msg.imap || undefined,
        smtp: msg.smtp || undefined,
      });

      if (result.error) {
        sendTo(ws, { type: "email_account_add_result", ok: false, error: result.error });
      } else {
        sendTo(ws, { type: "email_account_add_result", ok: true, account: result.account });
        // Also send updated list
        var accounts = emailAccounts.listAccounts(userId);
        sendTo(ws, { type: "email_accounts_list", accounts: accounts, providers: emailAccounts.PROVIDER_PRESETS });
      }
      return true;
    }

    if (msg.type === "email_account_remove") {
      if (!msg.accountId) {
        sendTo(ws, { type: "email_account_remove_result", ok: false, error: "Account ID is required" });
        return true;
      }

      var result2 = emailAccounts.removeAccount(userId, msg.accountId);
      if (result2.error) {
        sendTo(ws, { type: "email_account_remove_result", ok: false, error: result2.error });
      } else {
        sendTo(ws, { type: "email_account_remove_result", ok: true, accountId: msg.accountId });
        // Also send updated list
        var accounts2 = emailAccounts.listAccounts(userId);
        sendTo(ws, { type: "email_accounts_list", accounts: accounts2, providers: emailAccounts.PROVIDER_PRESETS });
      }
      return true;
    }

    if (msg.type === "email_account_test") {
      // Test connection for an account that may or may not be saved yet.
      // If accountId is provided, test existing account. Otherwise test with provided credentials.
      var testAccount;

      if (msg.accountId) {
        testAccount = emailAccounts.getAccountDecrypted(userId, msg.accountId);
        if (!testAccount) {
          sendTo(ws, { type: "email_account_test_result", ok: false, error: "Account not found" });
          return true;
        }
      } else {
        if (!msg.email || !msg.appPassword) {
          sendTo(ws, { type: "email_account_test_result", ok: false, error: "Email and app password are required" });
          return true;
        }
        var provider = msg.provider || "custom";
        var preset = emailAccounts.PROVIDER_PRESETS[provider];
        testAccount = {
          email: msg.email,
          appPassword: msg.appPassword,
          imap: msg.imap || (preset ? Object.assign({}, preset.imap) : { host: "", port: 993, tls: true }),
          smtp: msg.smtp || (preset ? Object.assign({}, preset.smtp) : { host: "", port: 587 }),
        };
      }

      emailAccounts.testConnection(testAccount).then(function (result3) {
        sendTo(ws, {
          type: "email_account_test_result",
          ok: result3.ok,
          imap: result3.imap,
          smtp: result3.smtp,
          accountId: msg.accountId || null,
        });
      }).catch(function (err) {
        sendTo(ws, {
          type: "email_account_test_result",
          ok: false,
          error: err.message || "Test failed",
          accountId: msg.accountId || null,
        });
      });
      return true;
    }

    return false;
  }

  // Send initial email accounts list when a client connects
  function sendInitialState(ws) {
    var userId = getUserId(ws);
    if (!userId) return;
    var accounts = emailAccounts.listAccounts(userId);
    sendTo(ws, {
      type: "email_accounts_list",
      accounts: accounts,
      providers: emailAccounts.PROVIDER_PRESETS,
    });
  }

  return {
    handleMessage: handleMessage,
    sendInitialState: sendInitialState,
  };
}

module.exports = { attachEmail: attachEmail };
