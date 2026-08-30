var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function ClassList(element) { this.element = element; }
ClassList.prototype.values = function () { return this.element.className ? this.element.className.split(/\s+/).filter(Boolean) : []; };
ClassList.prototype.add = function (value) { var values = this.values(); if (values.indexOf(value) === -1) values.push(value); this.element.className = values.join(" "); };
ClassList.prototype.remove = function (value) { this.element.className = this.values().filter(function (item) { return item !== value; }).join(" "); };
ClassList.prototype.toggle = function (value, force) { if (force === true) this.add(value); else if (force === false) this.remove(value); else if (this.values().indexOf(value) === -1) this.add(value); else this.remove(value); };
ClassList.prototype.contains = function (value) { return this.values().indexOf(value) !== -1; };

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
  this._textContent = "";
  this._innerHTML = "";
  this.hidden = false;
  this.checked = false;
  this.disabled = false;
  this.focusOptions = null;
}
FakeElement.prototype.appendChild = function (child) { child.parentNode = this; this.children.push(child); return child; };
FakeElement.prototype.remove = function () {
  if (!this.parentNode) return;
  var index = this.parentNode.children.indexOf(this);
  if (index !== -1) this.parentNode.children.splice(index, 1);
  this.parentNode = null;
};
FakeElement.prototype.addEventListener = function (type, handler) { this.listeners[type] = this.listeners[type] || []; this.listeners[type].push(handler); };
FakeElement.prototype.emit = function (type, event) {
  var value = event || {};
  value.currentTarget = this;
  value.target = value.target || this;
  value.preventDefault = value.preventDefault || function () { value.defaultPrevented = true; };
  value.stopPropagation = value.stopPropagation || function () { value.propagationStopped = true; };
  var listeners = this.listeners[type] || [];
  for (var i = 0; i < listeners.length; i++) listeners[i](value);
  return value;
};
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.removeAttribute = function (name) { delete this.attributes[name]; };
FakeElement.prototype.getAttribute = function (name) { return this.attributes[name] === undefined ? null : this.attributes[name]; };
FakeElement.prototype.focus = function (options) { this.ownerDocument.activeElement = this; this.focusOptions = options || null; };
FakeElement.prototype.querySelectorAll = function (selector) {
  var matches = [];
  function visit(node) {
    if (selector === "[data-capsule-runtime-surface]" && node.dataset.capsuleRuntimeSurface !== undefined) matches.push(node);
    if (selector === '[role="tab"]' && node.getAttribute("role") === "tab") matches.push(node);
    for (var i = 0; i < node.children.length; i++) visit(node.children[i]);
  }
  visit(this);
  return matches;
};
Object.defineProperty(FakeElement.prototype, "firstElementChild", { get: function () { return this.children[0] || null; } });
Object.defineProperty(FakeElement.prototype, "isConnected", { get: function () { return this.parentNode !== null; } });
Object.defineProperty(FakeElement.prototype, "textContent", {
  set: function (value) { this._textContent = String(value); this._innerHTML = ""; },
  get: function () { return this._textContent; },
});
Object.defineProperty(FakeElement.prototype, "innerHTML", { set: function (value) { this._innerHTML = String(value); }, get: function () { return this._innerHTML; } });

test("Workbench source inspector is text-safe, focus-restoring, and keeps runtime mounted", async function () {
  var originalDocument = global.document;
  var originalRaf = global.requestAnimationFrame;
  var originalLucide = global.lucide;
  var originalWindow = global.window;
  var highlightCalls = [];
  var fakeDocument = { activeElement: null, createElement: function (tag) { return new FakeElement(tag, fakeDocument); } };
  global.document = fakeDocument;
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  global.lucide = { createIcons: function () {} };
  global.window = { hljs: {
    getLanguage: function (language) { return language === "json" || language === "javascript"; },
    highlightElement: function (element) {
      highlightCalls.push({
        language: element.className.indexOf("language-javascript") !== -1 ? "javascript" : "json",
        text: element.textContent,
        previouslyHighlighted: element.getAttribute("data-highlighted"),
      });
      element.setAttribute("data-highlighted", "yes");
      element.classList.add("hljs");
      element.innerHTML = '<span class="hljs-string">highlighted safely</span>';
    },
  } };
  try {
    var sourceModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-capsule-source.js")).href);
    var wsRef = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/ws-ref.js")).href);
    var sent = [];
    wsRef.setWs({ readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } });
    var root = new FakeElement("div", fakeDocument);
    var chrome = new FakeElement("div", fakeDocument);
    var runtime = new FakeElement("div", fakeDocument);
    runtime.dataset.capsuleRuntimeSurface = "true";
    var definition = { manifest: { id: "safe-source", name: "Safe Source", runtime: "worker" }, metadata: { mateEditingAllowed: false } };
    sourceModule.mountCapsuleHostControls("safe-source", definition, chrome, root);
    root.appendChild(runtime);
    assert.strictEqual(root.children.length, 1);
    assert.strictEqual(chrome.children[0].className, "home-capsule-chrome-controls");
    assert.strictEqual(root.children.indexOf(chrome.children[0]), -1);
    var sourceButton = chrome.children[0].children[0];
    assert.strictEqual(sourceButton.getAttribute("aria-label"), "View source for Safe Source");
    assert.strictEqual(sourceButton.title, "View Capsule source");
    sourceButton.emit("click");
    assert.strictEqual(sent[0].type, "tool_source_get");
    assert.strictEqual(runtime.hidden, true);
    assert.strictEqual(root.children.indexOf(runtime) !== -1, true);
    var requestId = sent[0].requestId;
    sourceModule.handleToolSourceState({
      type: "tool_source_state", toolId: "safe-source", requestId: requestId, ok: true,
      manifest: { id: "safe-source", name: "Safe Source" }, uiTree: { type: "text", props: { text: "<img onerror=alert(1)>" } },
      logicSource: "</pre><script>unsafe()</script>", logicAvailable: true, revision: "revision-a",
    });
    var inspector = root.children[root.children.length - 1];
    var tabs = inspector.querySelectorAll('[role="tab"]');
    assert.strictEqual(highlightCalls[0].language, "json");
    assert.match(highlightCalls[0].text, /"safe-source"/);
    assert.strictEqual(highlightCalls[0].previouslyHighlighted, null);
    var arrow = inspector.emit("keydown", { key: "ArrowRight", target: tabs[0] });
    assert.strictEqual(arrow.defaultPrevented, true);
    assert.strictEqual(fakeDocument.activeElement, tabs[1]);
    assert.deepStrictEqual(tabs[1].focusOptions, { preventScroll: true });
    tabs[2].emit("click");
    var code = inspector.children[inspector.children.length - 1];
    assert.strictEqual(code.textContent, "</pre><script>unsafe()</script>");
    assert.strictEqual(highlightCalls[highlightCalls.length - 1].language, "javascript");
    assert.strictEqual(highlightCalls[highlightCalls.length - 1].text, "</pre><script>unsafe()</script>");
    assert.strictEqual(highlightCalls[highlightCalls.length - 1].previouslyHighlighted, null);
    assert.strictEqual(code.innerHTML, '<span class="hljs-string">highlighted safely</span>');
    assert.doesNotMatch(code.innerHTML, /unsafe|script/);

    global.window.hljs = null;
    tabs[0].emit("click");
    assert.match(code.textContent, /"safe-source"/);
    assert.strictEqual(code.innerHTML, "");
    assert.strictEqual(code.className, "home-capsule-source-code language-json");

    var unavailableHighlightCalled = false;
    global.window.hljs = {
      getLanguage: function () { return false; },
      highlightElement: function () { unavailableHighlightCalled = true; },
    };
    assert.strictEqual(sourceModule.highlightCapsuleSource(code, "json", "plain fallback"), false);
    assert.strictEqual(unavailableHighlightCalled, false);
    assert.strictEqual(code.textContent, "plain fallback");
    global.window.hljs = {
      getLanguage: function () { return true; },
      highlightElement: function () { throw new Error("highlighter failed"); },
    };
    assert.strictEqual(sourceModule.highlightCapsuleSource(code, "javascript", "safeAfterFailure();"), false);
    assert.strictEqual(code.textContent, "safeAfterFailure();");
    assert.strictEqual(code.innerHTML, "");
    assert.strictEqual(code.className, "home-capsule-source-code language-javascript");
    var escape = inspector.emit("keydown", { key: "Escape", target: tabs[2] });
    assert.strictEqual(escape.defaultPrevented, true);
    assert.strictEqual(runtime.hidden, false);
    assert.strictEqual(root.children.indexOf(runtime) !== -1, true);
    assert.strictEqual(fakeDocument.activeElement, sourceButton);
    assert.deepStrictEqual(sourceButton.focusOptions, { preventScroll: true });

    var serverRoot = new FakeElement("div", fakeDocument);
    var serverChrome = new FakeElement("div", fakeDocument);
    var serverDisplay = new FakeElement("div", fakeDocument);
    serverDisplay.dataset.capsuleRuntimeSurface = "true";
    sourceModule.mountCapsuleHostControls("board", { manifest: { id: "board", name: "Board", runtime: "server" }, metadata: { mateEditingAllowed: false } }, serverChrome, serverRoot);
    serverRoot.appendChild(serverDisplay);
    assert.strictEqual(serverChrome.children[0].children.length, 1);
    serverChrome.children[0].children[0].emit("click");
    var serverRequest = sent[sent.length - 1];
    sourceModule.handleToolSourceState({ type: "tool_source_state", toolId: "board", requestId: serverRequest.requestId, ok: true, manifest: { id: "board", name: "Board", runtime: "server" }, uiTree: { type: "board" }, logicSource: null, logicAvailable: false, revision: "server-revision" });
    var serverInspector = serverRoot.children[serverRoot.children.length - 1];
    var serverTabs = serverInspector.querySelectorAll('[role="tab"]');
    serverTabs[2].emit("click");
    assert.strictEqual(serverInspector.children[serverInspector.children.length - 1].textContent, "Logic is server-managed and is not available as authored Capsule source.");
    assert.strictEqual(serverChrome.children[0].children.length, 1);
  } finally {
    global.document = originalDocument;
    global.requestAnimationFrame = originalRaf;
    global.lucide = originalLucide;
    global.window = originalWindow;
  }
});

test("source inspector styling remains responsive and protocol routing stays narrow", function () {
  var fs = require("node:fs");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/home-capsule-source.css"), "utf8");
  var router = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-message-router.js"), "utf8");
  var legacy = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");
  var project = fs.readFileSync(path.join(__dirname, "../lib/project.js"), "utf8");
  assert.match(css, /@media \(max-width: 600px\)/);
  var sourceModule = fs.readFileSync(path.join(__dirname, "../lib/public/modules/home-capsule-source.js"), "utf8");
  var hubCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/home-hub.css"), "utf8");
  var index = fs.readFileSync(path.join(__dirname, "../lib/public/index.html"), "utf8");
  var dock = fs.readFileSync(path.join(__dirname, "../lib/public/modules/home-dock.js"), "utf8");
  var tools = fs.readFileSync(path.join(__dirname, "../lib/public/modules/home-tools.js"), "utf8");
  assert.match(css, /font-family: inherit/);
  assert.match(css, /background: var\(--code-bg\)/);
  assert.match(css, /\.home-capsule-chrome-controls/);
  assert.doesNotMatch(css, /\.home-capsule-host-controls/);
  assert.match(index, /id="home-dock-switcher"[\s\S]*id="home-dock-context"[\s\S]*class="home-dock-actions"/);
  assert.match(hubCss, /\.home-dock-context\[hidden\] \{ display: none; \}/);
  assert.match(hubCss, /@media \(max-width: 768px\)[\s\S]*\.home-dock-return span \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*\.home-capsule-source-label,[\s\S]*display: none/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.home-capsule-access-copy/);
  assert.match(dock, /function clearDockContext\(contextEl\)[\s\S]*onChromeHide\(\)[\s\S]*contextEl\.innerHTML = "";[\s\S]*contextEl\.hidden = true/);
  assert.match(dock, /contextEl\.hidden = false;[\s\S]*selected\.render\(contentEl, contextEl\)/);
  assert.match(tools, /mountCapsuleHostControls\(toolId, definition, chromeEl, root\)/);
  assert.match(tools, /onChromeHide: function \(\) \{ disposeCapsuleHostControls\(toolId\); \}/);
  assert.doesNotMatch(tools, /mountCapsuleHostControls\(toolId, definition, root\)/);
  assert.doesNotMatch(css, /Source Serif|Georgia|#[0-9a-f]{3,8}/i);
  assert.match(sourceModule, /language = index === 2 \? "javascript" : "json"/);
  assert.match(sourceModule, /code\.textContent = text[\s\S]*highlighter\.highlightElement\(code\)/);
  assert.match(sourceModule, /removeAttribute\("data-highlighted"\)/);
  assert.doesNotMatch(sourceModule, /code\.innerHTML\s*=/);
  assert.match(router, /tool_source_state[\s\S]*handleToolSourceState/);
  assert.match(router, /tool_mate_access_state[\s\S]*handleToolMateAccessState/);
  assert.doesNotMatch(legacy, /tool_source_state|tool_mate_access_state/);
  var delegation = project.slice(project.indexOf("// --- DM messages"), project.indexOf("// --- @Mention"));
  assert.match(delegation, /tool_source_get/);
  assert.match(delegation, /tool_mate_access_set[\s\S]*opts\.onDmMessage/);
});

test("Mate access switch waits for server confirmation and reports errors", async function () {
  var originalDocument = global.document;
  var originalRaf = global.requestAnimationFrame;
  var originalLucide = global.lucide;
  var fakeDocument = { activeElement: null, createElement: function (tag) { return new FakeElement(tag, fakeDocument); } };
  global.document = fakeDocument;
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  global.lucide = { createIcons: function () {} };
  try {
    var sourceModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-capsule-source.js")).href);
    var wsRef = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/ws-ref.js")).href);
    var sent = [];
    wsRef.setWs({ readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } });
    var root = new FakeElement("div", fakeDocument);
    var chrome = new FakeElement("div", fakeDocument);
    var definition = { manifest: { id: "permission", name: "Permission", runtime: "worker" }, metadata: { mateEditingAllowed: false } };
    sourceModule.mountCapsuleHostControls("permission", definition, chrome, root);
    assert.strictEqual(root.children.length, 0);
    var access = chrome.children[0].children[1].children[0];
    assert.strictEqual(access.getAttribute("aria-label"), "Allow Mate editing for Permission");
    assert.strictEqual(access.getAttribute("aria-describedby"), "home-capsule-access-help-permission");
    assert.strictEqual(chrome.children[0].children[1].children[2].textContent, "Allows Mates to inspect and propose edits to this Capsule source.");
    access.checked = true;
    access.emit("change");
    assert.strictEqual(access.checked, false);
    assert.strictEqual(access.disabled, true);
    assert.strictEqual(sent[0].type, "tool_mate_access_set");
    sourceModule.handleToolMateAccessState({ type: "tool_mate_access_state", toolId: "permission", ok: true, metadata: { mateEditingAllowed: true } });
    assert.strictEqual(access.checked, true);
    assert.strictEqual(access.disabled, false);
    assert.strictEqual(access.getAttribute("aria-checked"), "true");
    assert.strictEqual(chrome.children[0].children[1].children[1].children[1].textContent, "On");
    access.checked = false;
    access.emit("change");
    sourceModule.handleToolMateAccessState({ type: "tool_mate_access_state", toolId: "permission", ok: false, error: "Save failed" });
    assert.strictEqual(access.checked, true);
    assert.strictEqual(chrome.children[0].children[1].children[1].children[1].textContent, "Save failed");
  } finally {
    global.document = originalDocument;
    global.requestAnimationFrame = originalRaf;
    global.lucide = originalLucide;
  }
});
