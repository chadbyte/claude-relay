var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Home defers an early Mate selection until durable session preferences load", function () {
  var chat = source("lib/public/modules/home-mate-chat.js");
  var hub = source("lib/public/modules/app-home-hub.js");
  var surface = source("lib/public/modules/home-surface.js");
  var connection = source("lib/public/modules/app-connection.js");
  assert.match(chat, /if \(store\.get\('homeSurfaceLoaded'\)\) resumeHomeChat\(\);/);
  assert.match(hub, /state\.homeSurfaceLoaded !== prev\.homeSurfaceLoaded[\s\S]*if \(state\.homeChatMateId\) resumeHomeChat\(\);/);
  assert.match(surface, /homePreferredMateId = store\.get\('homeChatMateId'\) \|\| preference\.activeMateId/);
  assert.match(connection, /requestHomeSurfacePreference\(\);[\s\S]*if \(store\.get\('homeSurfaceLoaded'\)\) resumeHomeChat\(\);/);
});

test("Home surface writes send only changed preference fields", function () {
  var surface = source("lib/public/modules/home-surface.js");
  assert.match(surface, /var outgoing = \{\};/);
  assert.match(surface, /preference: outgoing/);
  assert.doesNotMatch(surface, /home_surface_set", preference: next/);
});
