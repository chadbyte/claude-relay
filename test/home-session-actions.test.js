var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

var root = path.join(__dirname, "..");
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }

function ClassList(element) { this.element = element; }
ClassList.prototype.values = function () { return this.element.className ? this.element.className.split(/\s+/).filter(Boolean) : []; };
ClassList.prototype.add = function (value) { var values = this.values(); if (values.indexOf(value) === -1) values.push(value); this.element.className = values.join(" "); };
ClassList.prototype.remove = function (value) { this.element.className = this.values().filter(function (item) { return item !== value; }).join(" "); };
ClassList.prototype.contains = function (value) { return this.values().indexOf(value) !== -1; };

function matches(node, selector) {
  if (selector === '[role="menuitem"]') return node.getAttribute("role") === "menuitem";
  if (selector === '[data-home-session-copy]') return node.dataset.homeSessionCopy !== undefined;
  if (selector.indexOf("button:not") === 0) return node.tagName === "BUTTON" && !node.disabled;
  if (selector === ".home-session-details-body") return node.classList.contains("home-session-details-body");
  if (selector === ".home-session-details-summary") return node.classList.contains("home-session-details-summary");
  if (selector === "h3") return node.tagName === "H3";
  return false;
}

function FakeElement(tag, documentRef) {
  this.tagName = String(tag).toUpperCase();
  this.ownerDocument = documentRef;
  this.children = [];
  this.parentNode = null;
  this.listeners = Object.create(null);
  this.attributes = Object.create(null);
  this.dataset = Object.create(null);
  this.className = "";
  this.classList = new ClassList(this);
  this.style = {};
  this.disabled = false;
  this._textContent = "";
  this._innerHTML = "";
}
FakeElement.prototype.appendChild = function (child) { child.parentNode = this; this.children.push(child); return child; };
FakeElement.prototype.removeChild = function (child) { child.remove(); return child; };
FakeElement.prototype.remove = function () { if (!this.parentNode) return; var index = this.parentNode.children.indexOf(this); if (index !== -1) this.parentNode.children.splice(index, 1); this.parentNode = null; };
FakeElement.prototype.addEventListener = function (type, handler) { this.listeners[type] = this.listeners[type] || []; this.listeners[type].push(handler); };
FakeElement.prototype.emit = function (type, event) { var value = event || {}; value.target = value.target || this; value.currentTarget = this; value.preventDefault = value.preventDefault || function () { value.defaultPrevented = true; }; value.stopPropagation = value.stopPropagation || function () { value.propagationStopped = true; }; var handlers = (this.listeners[type] || []).slice(); for (var i = 0; i < handlers.length; i++) handlers[i](value); return value; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.getAttribute = function (name) { return this.attributes[name] === undefined ? null : this.attributes[name]; };
FakeElement.prototype.contains = function (target) { if (target === this) return true; for (var i = 0; i < this.children.length; i++) if (this.children[i].contains(target)) return true; return false; };
FakeElement.prototype.focus = function (options) { this.ownerDocument.activeElement = this; this.focusOptions = options || null; };
FakeElement.prototype.getBoundingClientRect = function () { return { left: 20, right: 48, top: 20, bottom: 48, width: 160, height: 36 }; };
FakeElement.prototype.querySelectorAll = function (selector) { var selectors = selector.split(",").map(function (item) { return item.trim(); }); var result = []; function visit(node) { if (selectors.some(function (item) { return matches(node, item); })) result.push(node); for (var i = 0; i < node.children.length; i++) visit(node.children[i]); } visit(this); return result; };
FakeElement.prototype.querySelector = function (selector) { return this.querySelectorAll(selector)[0] || null; };
Object.defineProperty(FakeElement.prototype, "isConnected", { get: function () { var node = this; while (node) { if (node === this.ownerDocument.body) return true; node = node.parentNode; } return false; } });
Object.defineProperty(FakeElement.prototype, "innerHTML", { set: function (value) { this.children = []; this._textContent = ""; this._innerHTML = String(value); }, get: function () { return this._innerHTML; } });
Object.defineProperty(FakeElement.prototype, "textContent", { set: function (value) { this._textContent = String(value); }, get: function () { return this._textContent; } });

test("conversation actions remain independent and expose text-safe copyable details", async function () {
  var originals = { document: global.document, window: global.window, navigator: Object.getOwnPropertyDescriptor(global, "navigator"), requestAnimationFrame: global.requestAnimationFrame, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  var documentListeners = Object.create(null);
  var fakeDocument = { activeElement: null };
  fakeDocument.body = new FakeElement("body", fakeDocument);
  fakeDocument.createElement = function (tag) { return new FakeElement(tag, fakeDocument); };
  fakeDocument.addEventListener = function (type, handler) { documentListeners[type] = documentListeners[type] || []; documentListeners[type].push(handler); };
  fakeDocument.removeEventListener = function (type, handler) { documentListeners[type] = (documentListeners[type] || []).filter(function (item) { return item !== handler; }); };
  fakeDocument.emit = function (type, event) { var handlers = (documentListeners[type] || []).slice(); for (var i = 0; i < handlers.length; i++) handlers[i](event || {}); };
  fakeDocument.querySelector = function (selector) { return fakeDocument.body.querySelector(selector); };
  fakeDocument.contains = function (node) { return fakeDocument.body.contains(node); };
  var windowListeners = Object.create(null);
  global.document = fakeDocument;
  global.window = { innerWidth: 1000, innerHeight: 800, addEventListener: function (type, handler) { windowListeners[type] = handler; }, removeEventListener: function (type) { delete windowListeners[type]; } };
  var copied = [];
  Object.defineProperty(global, "navigator", { configurable: true, writable: true, value: { userAgent: "test", platform: "test", maxTouchPoints: 0, clipboard: { writeText: function (value) { copied.push(value); return Promise.resolve(); } } } });
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  global.setTimeout = function (callback) { callback(); return 1; };
  global.clearTimeout = function () {};
  try {
    var base = path.join(root, "lib/public/modules/");
    var actions = await import(pathToFileURL(path.join(base, "home-session-actions.js")).href);
    var store = (await import(pathToFileURL(path.join(base, "store.js")).href)).store;
    store.set({
      homeChatMateId: "mate-active",
      homeChatSessionId: "active-session",
      cachedMatesList: [{ id: "mate-active", name: "Clay" }, { id: "mate-target", name: "Researcher" }],
      homeMateSessions: { "mate-target": [{ id: "runtime-77", cliSessionId: "runtime-77", localId: 77, title: "<img src=x onerror=bad>", vendor: "claude", model: "sonnet", createdAt: 10, lastActivity: 20, isProcessing: true }] },
    });
    var conversation = actions.getHomeSessionConversations()[0];
    var trigger = actions.createHomeSessionActionsTrigger(conversation);
    fakeDocument.body.appendChild(trigger);
    assert.match(trigger.innerHTML, /aria-hidden="true">•••<\/span>/);
    assert.doesNotMatch(trigger.innerHTML, /data-lucide/);
    trigger.emit("click");
    assert.strictEqual(store.get('homeChatMateId'), "mate-active");
    assert.strictEqual(store.get('homeChatSessionId'), "active-session");
    var menu = fakeDocument.body.children[fakeDocument.body.children.length - 1];
    assert.strictEqual(menu.getAttribute("role"), "menu");
    assert.strictEqual(menu.children[0].getAttribute("role"), "menuitem");
    assert.strictEqual(fakeDocument.activeElement, menu.children[0]);
    menu.children[0].emit("click");
    var overlay = fakeDocument.body.children[fakeDocument.body.children.length - 1];
    assert.strictEqual(overlay.children[0].getAttribute("role"), "dialog");
    assert.strictEqual(overlay.children[0].getAttribute("aria-modal"), "true");
    var summary = overlay.querySelector(".home-session-details-summary");
    assert.strictEqual(summary.querySelector("h3").textContent, "<img src=x onerror=bad>");
    var copies = overlay.querySelectorAll('[data-home-session-copy]');
    assert.deepStrictEqual(copies.map(function (copy) { return copy.dataset.homeSessionCopy; }), ["reference", "session-id", "local-id"]);
    copies[1].emit("click");
    await Promise.resolve();
    assert.deepStrictEqual(copied, ["runtime-77"]);
    var focusable = overlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    focusable[focusable.length - 1].focus();
    fakeDocument.emit("keydown", { key: "Tab", shiftKey: false, preventDefault: function () { this.defaultPrevented = true; } });
    assert.strictEqual(fakeDocument.activeElement, focusable[0]);
    fakeDocument.emit("keydown", { key: "Escape", preventDefault: function () {}, stopPropagation: function () {} });
    assert.strictEqual(fakeDocument.activeElement, trigger);
    assert.strictEqual(store.get('homeChatMateId'), "mate-active");

    trigger.emit("keydown", { key: "ArrowDown" });
    assert.strictEqual(trigger.getAttribute("aria-expanded"), "true");
    fakeDocument.emit("pointerdown", { target: fakeDocument.body });
    assert.strictEqual(trigger.getAttribute("aria-expanded"), "false");
    assert.strictEqual((documentListeners.pointerdown || []).length, 0);
    trigger.emit("click");
    actions.disposeHomeSessionActionsMenu();
    assert.strictEqual((documentListeners.pointerdown || []).length, 0);
  } finally {
    global.document = originals.document;
    global.window = originals.window;
    if (originals.navigator) Object.defineProperty(global, "navigator", originals.navigator);
    else delete global.navigator;
    global.requestAnimationFrame = originals.requestAnimationFrame;
    global.setTimeout = originals.setTimeout;
    global.clearTimeout = originals.clearTimeout;
  }
});

test("conversation action source preserves row, sheet, local-only, and responsive contracts", function () {
  var actions = read("lib/public/modules/home-session-actions.js");
  var sidebar = read("lib/public/modules/home-sidebar.js");
  var sheet = read("lib/public/modules/home-conversations-sheet.js");
  var css = read("lib/public/css/home-session-actions.css");
  assert.match(sidebar, /className = "home-sidebar-recent-item"[\s\S]*item\.appendChild\(row\);[\s\S]*createHomeSessionActionsTrigger\(conversation\)/);
  assert.match(sidebar, /disposeHomeSessionActionsMenu\(\);[\s\S]*list\.innerHTML = ""/);
  assert.match(actions, /textContent = "View details"/);
  assert.match(actions, /Session reference[\s\S]*Session ID[\s\S]*Not assigned yet — this conversation is still local\.[\s\S]*Local ID/);
  assert.match(actions, /copyToClipboard\(copyValue\)[\s\S]*copy\.textContent = "Copied"/);
  assert.doesNotMatch(actions, /localStorage|alert\(|confirm\(|prompt\(/);
  assert.match(sheet, /detailsOpener: detailsReturn,[\s\S]*closeSheet\(false\)/);
  assert.match(css, /\.home-session-actions-trigger \{[\s\S]*opacity: 0;/);
  assert.match(css, /:hover \.home-session-actions-trigger,[\s\S]*:focus-within \.home-session-actions-trigger,[\s\S]*aria-expanded="true"\] \{ opacity: 1; \}/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*opacity: 0\.68/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.home-session-details-dialog[\s\S]*width: 100%;[\s\S]*height: 100%/);
  assert.ok(actions.split("\n").length < 500);
});
