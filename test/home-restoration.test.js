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
  assert.match(surface, /homePreferredMateId = store\.get\('homePreferredMateId'\) \|\| preference\.activeMateId \|\| store\.get\('homeChatMateId'\)/);
  assert.match(connection, /requestHomeSurfacePreference\(\);[\s\S]*if \(store\.get\('homeSurfaceLoaded'\)\) resumeHomeChat\(\);/);
});

test("Home surface writes send only changed preference fields", function () {
  var surface = source("lib/public/modules/home-surface.js");
  assert.match(surface, /var outgoing = \{\};/);
  assert.match(surface, /preference: outgoing/);
  assert.doesNotMatch(surface, /home_surface_set", preference: next/);
});

test("restored exact conversations rerender and reveal the selected Mate locally", function () {
  var chat = source("lib/public/modules/home-mate-chat.js");
  var hub = source("lib/public/modules/app-home-hub.js");
  assert.match(chat, /export function openHomeConversation\(mateId, sessionId\)[\s\S]*resetHomeSessionModel\(sessionId\);[\s\S]*store\.set\(\{ homeChatMateId: mateId \}\)/);
  assert.match(hub, /state\.homeChatMateId !== prev\.homeChatMateId \|\| state\.cachedMatesList !== prev\.cachedMatesList\) renderHomeMateSwitcher\(\)/);
  assert.match(hub, /state\.homeSurfaceLoaded !== prev\.homeSurfaceLoaded[\s\S]*renderHomeMateSwitcher\(\)/);
  assert.match(hub, /selectionChanged \? activeRow : focusedRow \|\| activeRow/);
  assert.match(hub, /list\.scrollTop/);
  assert.doesNotMatch(hub, /document\.(?:body|documentElement)\.scroll|window\.scroll/);
});
