var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

test("document viewer tabs route click focus through the exported tab function", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser-tabs.js"), "utf8");
  assert.match(source, /focusFileViewerTab\(path\)/);
  assert.doesNotMatch(source, /function\(\) \{ focus\(path\); \}/);
});

test("document viewer tab close control routes through the exported close function", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser-tabs.js"), "utf8");
  assert.match(source, /closeFileViewerTab\(path\)/);
  assert.doesNotMatch(source, /closeTab\(path\)/);
});

test("document viewer reset clears every tab before full teardown", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var reset = source.slice(source.indexOf("export function resetFileBrowser"), source.indexOf("var pendingOpenMode"));
  assert.match(reset, /clearFileViewerTabs\(\);/);
  assert.match(reset, /teardownFileViewer\(\);/);
});

test("document viewer docks on the right side of the workspace", function() {
  var browser = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/filebrowser.css"), "utf8");
  var init = browser.slice(browser.indexOf("export function initFileBrowser"), browser.indexOf("// Load material file icons"));
  assert.match(init, /mainPanels\.appendChild\(ctx\.fileViewerEl\)/);
  assert.doesNotMatch(init, /mainPanels\.insertBefore/);
  assert.match(css, /#file-viewer\s*\{[^}]*border-left:\s*1px solid var\(--border\)/s);
});

test("split and pane markdown presents use the parent-owned viewer path", function() {
  var messages = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");
  var bridge = fs.readFileSync(path.join(__dirname, "../lib/public/modules/pane-bridge.js"), "utf8");
  assert.match(messages, /store\.get\('paneMode'\).*forwardPaneMarkdownPresentation/);
  assert.match(messages, /else if \(!store\.get\('splitPanes'\)\) presentMarkdownEdit/);
  assert.match(bridge, /type: "clay-pane-present-markdown"/);
});

test("document viewer tabs execute focus and close click handlers", async function() {
  function element() {
    var node = {
      children: [],
      handlers: {},
      classList: { add: function() {}, remove: function() {}, toggle: function() {} },
      appendChild: function(child) { this.children.push(child); },
      addEventListener: function(type, handler) { this.handlers[type] = handler; },
    };
    Object.defineProperty(node, "innerHTML", {
      get: function() { return ""; },
      set: function() { node.children = []; },
    });
    return node;
  }
  var root = element();
  global.document = {
    getElementById: function(id) { return id === "file-viewer-tabs" ? root : null; },
    createElement: element,
  };
  var moduleUrl = "file://" + path.join(__dirname, "../lib/public/modules/filebrowser-tabs.js") + "?behavior=" + Date.now();
  var tabs = await import(moduleUrl);
  var focused = [];
  var emptied = 0;
  tabs.initFileViewerTabs({ onFocus: function(tabPath) { focused.push(tabPath); }, onEmpty: function() { emptied++; } });
  tabs.openFileViewerTab("one.md");
  tabs.openFileViewerTab("two.md");
  assert.strictEqual(root.children.length, 2);
  assert.strictEqual(tabs.focusedFileViewerTab(), "two.md");
  tabs.openFileViewerTab("one.md");
  assert.strictEqual(root.children.length, 2);
  assert.strictEqual(tabs.focusedFileViewerTab(), "one.md");
  root.children[0].handlers.click({ stopPropagation: function() {} });
  assert.strictEqual(focused[0], "one.md");
  root.children[0].children[0].handlers.click({ stopPropagation: function() {} });
  assert.strictEqual(root.children.length, 1);
  assert.strictEqual(tabs.focusedFileViewerTab(), "two.md");
  assert.strictEqual(focused[1], "two.md");
  tabs.closeFileViewerTab("two.md");
  assert.strictEqual(emptied, 1);
  delete global.document;
});
