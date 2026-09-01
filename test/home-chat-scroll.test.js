var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

test("Home follows only a bottom-pinned transcript and preserves deliberate reading position", async function () {
  var originalDocument = global.document;
  var originalRaf = global.requestAnimationFrame;
  var listeners = {};
  var messages = { scrollHeight: 1000, scrollTop: 700, clientHeight: 300, addEventListener: function (name, handler) { listeners[name] = handler; } };
  var button = { hidden: true, listeners: {}, addEventListener: function (name, handler) { this.listeners[name] = handler; } };
  global.document = { getElementById: function (id) { return id === "home-mate-chat-messages" ? messages : button; } };
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-chat-scroll.js")).href);
    var bottom = module.captureHomeChatScroll(false);
    messages.scrollHeight = 1200;
    module.restoreHomeChatScroll(bottom);
    assert.equal(messages.scrollTop, 1200);
    assert.equal(button.hidden, true);

    messages.scrollTop = 300;
    messages.scrollHeight = 1200;
    listeners.scroll();
    module.markHomeChatActivity();
    var reading = module.captureHomeChatScroll(false);
    messages.scrollHeight = 1500;
    module.restoreHomeChatScroll(reading);
    assert.equal(messages.scrollTop, 300);
    assert.equal(button.hidden, false);

    button.listeners.click();
    assert.equal(messages.scrollTop, 1500);
    assert.equal(button.hidden, true);
  } finally {
    global.document = originalDocument;
    global.requestAnimationFrame = originalRaf;
  }
});

test("Home scroll source exposes the same threshold and new-activity contract for ordinary and Debate events", function () {
  var fs = require("node:fs");
  var root = path.join(__dirname, "..");
  var chat = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
  var scroll = fs.readFileSync(path.join(root, "lib/public/modules/home-chat-scroll.js"), "utf8");
  var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  assert.match(chat, /handleHomeDebateTranscript\(msg\)[\s\S]*markHomeChatActivity\(\)/);
  assert.match(chat, /handleHomeMateDelta\(msg\)[\s\S]*markHomeChatActivity\(\)/);
  assert.match(scroll, /BOTTOM_THRESHOLD = 150/);
  assert.match(scroll, /snapshot\.follow[\s\S]*scrollTop = messagesEl\.scrollHeight/);
  assert.match(html, /id="home-chat-new-activity"[\s\S]*New activity/);
});
