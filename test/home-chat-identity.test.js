var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function FakeElement(tag) {
  this.tagName = tag.toUpperCase();
  this.children = [];
  this.attributes = {};
  this.className = "";
  this.dataset = {};
  this.textContent = "";
  this.src = "";
  var element = this;
  this.classList = {
    add: function () {
      for (var i = 0; i < arguments.length; i++) {
        if ((" " + element.className + " ").indexOf(" " + arguments[i] + " ") === -1) element.className += (element.className ? " " : "") + arguments[i];
      }
    },
  };
}
FakeElement.prototype.appendChild = function (child) { this.children.push(child); child.parentNode = this; return child; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.querySelector = function (selector) {
  var className = selector.charAt(0) === "." ? selector.slice(1) : null;
  var nodes = flatten(this);
  for (var i = 1; i < nodes.length; i++) {
    if (className && (" " + nodes[i].className + " ").indexOf(" " + className + " ") !== -1) return nodes[i];
  }
  return null;
};

function flatten(root) {
  var result = [root];
  for (var i = 0; i < root.children.length; i++) result = result.concat(flatten(root.children[i]));
  return result;
}

test("ordinary Home bubbles use exact restored Mate and current user identity safely", async function () {
  var originalDocument = global.document;
  var originalWindow = global.window;
  var originalMarked = global.marked;
  var originalMermaid = global.mermaid;
  var originalPurify = global.DOMPurify;
  var originalLocalStorage = global.localStorage;
  global.document = {
    body: new FakeElement("body"),
    createElement: function (tag) { return new FakeElement(tag); },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
    removeEventListener: function () {},
  };
  global.document.body.dataset = {};
  global.window = { addEventListener: function () {}, removeEventListener: function () {}, matchMedia: function () { return { matches: false, addEventListener: function () {} }; } };
  global.marked = { use: function () {}, parse: function (value) { return value; } };
  global.mermaid = { initialize: function () {} };
  global.DOMPurify = { sanitize: function (value) { return value; } };
  global.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
  try {
    var root = path.join(__dirname, "..");
    var storeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/store.js")).href);
    storeModule.createStore({
      homeChatMateId: "restored-mate",
      myUserId: "user-a",
      cachedAllUsers: [{ id: "user-a", profile: { avatarCustom: "data:user-a" } }],
      cachedMatesList: [{ id: "focused-elsewhere", profile: { displayName: "Other", avatarCustom: "data:other" } }],
    });
    var identity = await import(pathToFileURL(path.join(root, "lib/public/modules/home-chat-identity.js")).href);
    var restoredMate = { id: "restored-mate", profile: { displayName: "<img src=x onerror=bad>", avatarCustom: "data:restored" } };
    var mate = identity.createHomeOrdinaryBubble({ role: "assistant", text: "Hello" }, restoredMate, restoredMate.profile.displayName, "09:41");
    var mateAvatar = mate.querySelector(".dm-bubble-avatar");
    var mateName = mate.querySelector(".dm-bubble-name");
    assert.equal(mateAvatar.src, "data:restored");
    assert.equal(mateAvatar.attributes.alt, undefined);
    assert.equal(mateAvatar.alt, "");
    assert.equal(mateName.textContent, "<img src=x onerror=bad>");
    assert.equal(mateName.children.length, 0);
    assert.equal(mate.attributes.role, "article");
    assert.equal(mate.attributes["aria-label"], "Message from <img src=x onerror=bad>");
    assert.match(mate.className, /home-chat-ordinary-mate/);

    var user = identity.createHomeOrdinaryBubble({ role: "user", text: "My answer" }, restoredMate, restoredMate.profile.displayName, "09:42");
    assert.equal(user.querySelector(".dm-bubble-avatar"), null);
    assert.equal(user.querySelector(".dm-bubble-name"), null);
    assert.equal(user.querySelector(".dm-bubble-header"), null);
    assert.equal(user.attributes["aria-label"], "Message from You");
    assert.equal(user.querySelector(".bubble").children[0].textContent, "My answer");
    assert.equal(user.children.length, 1);
    assert.equal(user.children[0].children[0], user.querySelector(".bubble"));
  } finally {
    global.document = originalDocument;
    global.window = originalWindow;
    global.marked = originalMarked;
    global.mermaid = originalMermaid;
    global.DOMPurify = originalPurify;
    global.localStorage = originalLocalStorage;
  }
});

test("ordinary pre-delta streaming keeps the Mate identity beside its activity", async function () {
  var originalDocument = global.document;
  global.document = { createElement: function (tag) { return new FakeElement(tag); } };
  try {
    var root = path.join(__dirname, "..");
    var identity = await import(pathToFileURL(path.join(root, "lib/public/modules/home-chat-identity.js")).href);
    var row = identity.createHomeOrdinaryTyping({ profile: { avatarCustom: "data:clay" } }, "Clay");
    assert.equal(row.querySelector(".dm-bubble-avatar").src, "data:clay");
    assert.equal(row.querySelector(".dm-bubble-name").textContent, "Clay");
    assert.equal(row.querySelector(".home-chat-typing").attributes["aria-label"], "Clay is responding");
    assert.equal(row.querySelector(".home-chat-typing").children.length, 3);
    assert.match(row.className, /home-chat-ordinary-typing/);
  } finally {
    global.document = originalDocument;
  }
});

test("ordinary identity styles expose shared headers without affecting Debate-owned cards", function () {
  var root = path.join(__dirname, "..");
  var css = fs.readFileSync(path.join(root, "lib/public/css/home-hub.css"), "utf8");
  var chat = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
  var identity = fs.readFileSync(path.join(root, "lib/public/modules/home-chat-identity.js"), "utf8");
  assert.match(identity, /mateAvatarUrl\(mate, 34\)/);
  assert.doesNotMatch(identity, /userAvatarUrl|currentUser/);
  assert.match(identity, /var row = isUser \? createUserBubble\(\{[\s\S]*text: message\.text \|\| "",[\s\S]*\}\) : createAssistantBubble/);
  assert.match(identity, /row\.setAttribute\("role", "article"\)/);
  assert.match(css, /\.home-chat-ordinary-message > \.dm-bubble-avatar \{[\s\S]*display: block;[\s\S]*width: 34px;[\s\S]*height: 34px;/);
  assert.match(css, /\.home-chat-ordinary-message \.dm-bubble-header \{[\s\S]*display: flex;/);
  assert.match(css, /\.home-chat-ordinary-message \{[\s\S]*grid-template-columns: 34px minmax\(0, 1fr\)/);
  assert.match(css, /\.home-chat-ordinary-user \{[\s\S]*display: flex;[\s\S]*justify-content: flex-end;/);
  assert.match(css, /\.home-chat-ordinary-user > \.dm-bubble-content \{[\s\S]*align-items: flex-end;/);
  assert.doesNotMatch(css, /home-chat-ordinary-user[^}]*grid-template|home-chat-ordinary-user > \.dm-bubble-avatar|home-chat-ordinary-user \.dm-bubble-header/);
  assert.doesNotMatch(css, /\.home-mate-chat-transcript\.home-chat-bubble-layout \.dm-bubble-avatar,\s*\.home-mate-chat-transcript\.home-chat-bubble-layout \.dm-bubble-header\s*\{\s*display:\s*none/);
  assert.match(chat, /if \(message\.role === "proposal" \|\| message\.role === "question"\) return createHomeDebateTranscriptCard/);
  assert.match(chat, /if \(\["debate_header", "debate_turn", "debate_user"\][\s\S]*return createHomeDebateLiveCard/);
  assert.match(chat, /createHomeOrdinaryBubble\(message, mate, mateName, timeText\)/);
});
