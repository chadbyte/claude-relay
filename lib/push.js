var webpush = require("web-push");
var fs = require("fs");
var path = require("path");

function loadOrCreateVapidKeys() {
  var os = require("os");
  var dir = path.join(os.homedir(), ".claude-relay");
  var keyFile = path.join(dir, "vapid.json");

  try {
    var data = fs.readFileSync(keyFile, "utf8");
    return JSON.parse(data);
  } catch (e) {
    // Generate new keys
  }

  var keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2));
  return keys;
}

function initPush() {
  var os = require("os");
  var keys = loadOrCreateVapidKeys();

  var vapidDetails = {
    subject: "mailto:push@claude-relay.dev",
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };

  var dir = path.join(os.homedir(), ".claude-relay");
  var subFile = path.join(dir, "push-subs.json");
  var subscriptions = new Map();

  // Load persisted subscriptions, but clear if VAPID key changed
  try {
    var saved = JSON.parse(fs.readFileSync(subFile, "utf8"));
    if (saved.vapidKey && saved.vapidKey !== keys.publicKey) {
      saved.subs = [];
    }
    var subs = saved.subs || saved;
    if (Array.isArray(subs)) {
      for (var i = 0; i < subs.length; i++) {
        if (subs[i] && subs[i].endpoint) subscriptions.set(subs[i].endpoint, subs[i]);
      }
    }
  } catch (e) {}

  function save() {
    try {
      fs.writeFileSync(subFile, JSON.stringify({
        vapidKey: keys.publicKey,
        subs: [...subscriptions.values()],
      }));
    } catch (e) {}
  }

  save();

  // Purge stale subscriptions on startup
  var startupEndpoints = Array.from(subscriptions.keys());
  for (var si = 0; si < startupEndpoints.length; si++) {
    (function (ep) {
      var sub = subscriptions.get(ep);
      webpush.sendNotification(sub, JSON.stringify({ type: "test" }), { TTL: 0, vapidDetails: vapidDetails })
        .then(function () {})
        .catch(function (err) {
          if (err.statusCode === 403 || err.statusCode === 410 || err.statusCode === 404) {
            subscriptions.delete(ep);
            save();
          }
        });
    })(startupEndpoints[si]);
  }

  function addSubscription(sub) {
    if (!sub || !sub.endpoint) return;
    // Store immediately, then validate async. Invalid subs get cleaned on first sendPush.
    subscriptions.set(sub.endpoint, sub);
    save();
    // Validate with a silent push (TTL 0 = don't actually deliver if device offline)
    webpush.sendNotification(sub, JSON.stringify({ type: "test" }), { TTL: 0, vapidDetails: vapidDetails })
      .then(function () {})
      .catch(function (err) {
        if (err.statusCode === 403 || err.statusCode === 410 || err.statusCode === 404) {
          subscriptions.delete(sub.endpoint);
          save();
        }
      });
  }

  function removeSubscription(endpoint) {
    subscriptions.delete(endpoint);
    save();
  }

  function sendPush(payload) {
    var json = JSON.stringify(payload);
    subscriptions.forEach(function (sub, endpoint) {
      webpush.sendNotification(sub, json, { vapidDetails: vapidDetails })
        .then(function () {})
        .catch(function (err) {
          if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
            subscriptions.delete(endpoint);
            save();
          }
        });
    });
  }

  return {
    publicKey: keys.publicKey,
    addSubscription: addSubscription,
    removeSubscription: removeSubscription,
    sendPush: sendPush,
  };
}

module.exports = { initPush };
