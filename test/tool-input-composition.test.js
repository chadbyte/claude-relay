var test = require("node:test");
var assert = require("node:assert");
var path = require("path");
var pathToFileURL = require("url").pathToFileURL;

function FakeInput() {
  this.value = "";
  this.listeners = Object.create(null);
}

FakeInput.prototype.addEventListener = function (type, listener) {
  this.listeners[type] = this.listeners[type] || [];
  this.listeners[type].push(listener);
};

FakeInput.prototype.emit = function (type, detail) {
  var listeners = this.listeners[type] || [];
  for (var i = 0; i < listeners.length; i++) listeners[i](detail || {});
};

test("declarative text controls commit composed Korean once after compositionend", async function () {
  var moduleUrl = pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-input-composition.js")).href;
  var composition = await import(moduleUrl);
  var input = new FakeInput();
  var commits = [];
  composition.bindToolTextInput(input, function (value) { commits.push(value); });

  input.emit("compositionstart");
  input.value = "ㅇ";
  input.emit("input", { isComposing: true });
  input.value = "안";
  input.emit("input", { isComposing: true });
  input.value = "안녕";
  input.emit("compositionend");
  input.emit("beforeinput", { inputType: "insertCompositionText" });
  await new Promise(function (resolve) { setTimeout(resolve, 2); });
  input.emit("input", { isComposing: false });
  input.value = "안녕!";
  input.emit("input", { isComposing: false });

  assert.deepStrictEqual(commits, ["안녕", "안녕!"]);
});

test("ordinary declarative text input still commits each input event", async function () {
  var moduleUrl = pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-input-composition.js")).href;
  var composition = await import(moduleUrl);
  var input = new FakeInput();
  var commits = [];
  composition.bindToolTextInput(input, function (value) { commits.push(value); });
  input.value = "a";
  input.emit("input");
  input.value = "ab";
  input.emit("input");
  assert.deepStrictEqual(commits, ["a", "ab"]);
});

function FakeElement(tagName, ownerDocument) {
  this.tagName = String(tagName || "div").toUpperCase();
  this.ownerDocument = ownerDocument;
  this.children = [];
  this.parentNode = null;
  this.listeners = Object.create(null);
  this.dataset = Object.create(null);
  this.value = "";
  this.selectionStart = 0;
  this.selectionEnd = 0;
  this.focusOptions = null;
  this.className = "";
  this.textContent = "";
}

FakeElement.prototype.appendChild = function (child) {
  child.parentNode = this;
  this.children.push(child);
  return child;
};

FakeElement.prototype.addEventListener = FakeInput.prototype.addEventListener;
FakeElement.prototype.emit = FakeInput.prototype.emit;
FakeElement.prototype.setAttribute = function (name, value) { this[name] = String(value); };
FakeElement.prototype.contains = function (target) {
  if (this === target) return true;
  for (var i = 0; i < this.children.length; i++) {
    if (this.children[i].contains(target)) return true;
  }
  return false;
};
FakeElement.prototype.querySelectorAll = function (selector) {
  var result = [];
  function visit(node) {
    if (selector === "[data-tool-control-id]" && node.dataset.toolControlId) result.push(node);
    for (var i = 0; i < node.children.length; i++) visit(node.children[i]);
  }
  visit(this);
  return result;
};
FakeElement.prototype.focus = function (options) {
  this.ownerDocument.activeElement = this;
  this.focusOptions = options || null;
};
FakeElement.prototype.setSelectionRange = function (start, end) {
  this.selectionStart = start;
  this.selectionEnd = end;
};
Object.defineProperty(FakeElement.prototype, "innerHTML", {
  set: function () {
    for (var i = 0; i < this.children.length; i++) this.children[i].parentNode = null;
    this.children = [];
  },
  get: function () { return ""; },
});

test("worker rerenders cannot replace a live Korean IME node or drop rapid Hangul input", async function () {
  var originalDocument = global.document;
  var fakeDocument = {
    activeElement: null,
    createElement: function (tagName) { return new FakeElement(tagName, fakeDocument); },
  };
  global.document = fakeDocument;
  try {
    var rendererUrl = pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-renderer.js")).href;
    var renderer = await import(rendererUrl);
    var container = new FakeElement("div", fakeDocument);
    var tree = { type: "textarea", id: "source", bind: "source", action: "set_source", props: { label: "Source" } };
    var commits = [];
    function emit(action, args) { commits.push({ action: action, value: args.value }); }

    renderer.renderToolUi("translator", tree, { source: "" }, emit, container);
    var input = container.querySelectorAll("[data-tool-control-id]")[0];
    input.focus();
    input.emit("compositionstart");
    input.emit("beforeinput", { inputType: "insertCompositionText", isComposing: false });
    input.value = "ㅇ";
    input.selectionStart = 1;
    input.selectionEnd = 1;
    input.emit("input", { inputType: "insertCompositionText", isComposing: false });

    renderer.renderToolUi("translator", tree, { source: "" }, emit, container);
    assert.strictEqual(container.querySelectorAll("[data-tool-control-id]")[0], input);
    assert.strictEqual(input.value, "ㅇ");
    assert.strictEqual(fakeDocument.activeElement, input);

    input.value = "안";
    input.selectionStart = 1;
    input.selectionEnd = 1;
    input.emit("input", { inputType: "insertCompositionText" });
    input.emit("compositionend", { data: "안" });
    input.emit("beforeinput", { inputType: "insertCompositionText", isComposing: false });
    input.emit("input", { inputType: "insertCompositionText", isComposing: false });

    input.emit("compositionstart");
    input.emit("beforeinput", { inputType: "insertCompositionText" });
    input.value = "안ㄴ";
    input.selectionStart = 2;
    input.selectionEnd = 2;
    input.emit("input", {});
    renderer.renderToolUi("translator", tree, { source: "안" }, emit, container);
    assert.strictEqual(container.querySelectorAll("[data-tool-control-id]")[0], input);
    assert.strictEqual(input.value, "안ㄴ");

    input.emit("beforeinput", { inputType: "insertCompositionText", isComposing: false });
    input.value = "안녕";
    input.selectionStart = 2;
    input.selectionEnd = 2;
    input.emit("input", { isComposing: false });
    input.emit("compositionend", { data: "녕" });
    input.emit("beforeinput", { inputType: "insertFromComposition", isComposing: false });
    input.emit("input", { inputType: "insertFromComposition", isComposing: false });
    assert.deepStrictEqual(commits, [
      { action: "set_source", value: "안" },
      { action: "set_source", value: "안녕" },
    ]);

    renderer.renderToolUi("translator", tree, { source: "안녕" }, emit, container);
    var restored = container.querySelectorAll("[data-tool-control-id]")[0];
    assert.notStrictEqual(restored, input);
    assert.strictEqual(restored.value, "안녕");
    assert.strictEqual(fakeDocument.activeElement, restored);
    assert.deepStrictEqual(restored.focusOptions, { preventScroll: true });
    assert.strictEqual(restored.selectionStart, 2);
    assert.strictEqual(restored.selectionEnd, 2);
  } finally {
    global.document = originalDocument;
  }
});

test("detached composed controls do not dispatch stale actions", async function () {
  var moduleUrl = pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-input-composition.js")).href;
  var composition = await import(moduleUrl);
  var input = new FakeInput();
  var alive = true;
  var commits = [];
  composition.bindToolTextInput(input, function (value) { commits.push(value); }, {
    isAlive: function () { return alive; },
  });
  input.emit("compositionstart");
  input.value = "안";
  alive = false;
  input.emit("compositionend");
  input.value = "안녕";
  input.emit("input");
  assert.deepStrictEqual(commits, []);
});
