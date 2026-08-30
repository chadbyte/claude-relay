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
  input.emit("input", { isComposing: false });

  assert.deepStrictEqual(commits, ["안녕"]);
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
