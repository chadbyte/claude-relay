var webpush = require("web-push");
var fs = require("fs");
var path = require("path");

function loadOrCreateVapidKeys(cwd) {
  var dir = path.join(cwd, ".claude-relay");
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

function initPush(cwd) {
  var keys = loadOrCreateVapidKeys(cwd);
  webpush.setVapidDetails("mailto:claude-relay@localhost", keys.publicKey, keys.privateKey);

  var subscriptions = new Map();

  function addSubscription(sub) {
    if (sub && sub.endpoint) subscriptions.set(sub.endpoint, sub);
  }

  function removeSubscription(endpoint) {
    subscriptions.delete(endpoint);
  }

  function sendPush(payload) {
    var json = JSON.stringify(payload);
    subscriptions.forEach(function (sub, endpoint) {
      webpush.sendNotification(sub, json).catch(function (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          subscriptions.delete(endpoint);
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
