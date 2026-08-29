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

test("file tree clicks preview files while double clicks pin them", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  assert.strictEqual((source.match(/previewFileViewerTab\(filePath\)/g) || []).length, 2);
  assert.strictEqual((source.match(/rowEl\.addEventListener\("dblclick"/g) || []).length, 2);
});

test("document viewer uses an editor tab strip with a separate breadcrumb row", function() {
  var html = fs.readFileSync(path.join(__dirname, "../lib/public/index.html"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/filebrowser.css"), "utf8");
  assert.match(html, /file-viewer-tabbar[\s\S]*file-viewer-breadcrumbs[\s\S]*file-viewer-path[\s\S]*file-viewer-toolbar/);
  assert.ok(html.indexOf('class="file-viewer-window-actions"') < html.indexOf('class="file-viewer-breadcrumbs"'));
  assert.ok(html.indexOf('id="file-viewer-fullscreen"') < html.indexOf('id="file-viewer-close"'));
  assert.ok(html.indexOf('class="file-viewer-tabbar"') < html.indexOf('id="file-viewer-close"'));
  assert.ok(html.indexOf('id="file-viewer-close"') < html.indexOf('class="file-viewer-breadcrumbs"'));
  assert.match(css, /\.file-viewer-tab\.active::before\s*\{[^}]*var\(--accent\)/s);
  assert.match(css, /\.file-viewer-breadcrumbs\s*\{/);
  assert.match(css, /\.file-viewer-toolbar\s*\{[^}]*margin-left:\s*auto/s);
});

test("document viewer renders SVG files safely with a source toggle", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/filebrowser.css"), "utf8");
  assert.match(source, /currentIsSvg = !lightweightPreview && ext === "svg"/);
  assert.match(source, /image\.src = "api\/file\?path=" \+ encodeURIComponent\(currentFilePath\)/);
  assert.doesNotMatch(source, /file-viewer-svg-preview[^\n]*currentContent/);
  assert.match(css, /\.file-viewer-svg-preview\s*\{/);
});

test("document and terminal viewers float above the workspace", function() {
  var browser = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/filebrowser.css"), "utf8");
  var init = browser.slice(browser.indexOf("export function initFileBrowser"), browser.indexOf("// Load material file icons"));
  assert.match(init, /mainPanels\.appendChild\(ctx\.fileViewerEl\)/);
  assert.doesNotMatch(init, /mainPanels\.insertBefore/);
  assert.match(css, /#file-viewer\s*\{[^}]*margin:\s*8px 8px 8px 10px[^}]*border-radius:\s*12px[^}]*box-shadow:/s);
  assert.match(css, /#terminal-container\s*\{[^}]*margin:\s*8px 8px 8px 10px[^}]*border-radius:\s*12px[^}]*box-shadow:/s);
  assert.match(css, /@keyframes workbench-panel-in/);
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
      setAttribute: function() {},
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
  root.children[0].children[2].handlers.click({ stopPropagation: function() {} });
  assert.strictEqual(root.children.length, 1);
  assert.strictEqual(tabs.focusedFileViewerTab(), "two.md");
  assert.strictEqual(focused[1], "two.md");
  tabs.closeFileViewerTab("two.md");
  assert.strictEqual(emptied, 1);
  delete global.document;
});

test("document viewer reuses one preview tab until the file is explicitly opened", async function() {
  function element() {
    var node = {
      children: [], handlers: {},
      appendChild: function(child) { this.children.push(child); },
      addEventListener: function(type, handler) { this.handlers[type] = handler; },
      setAttribute: function() {},
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
  var moduleUrl = "file://" + path.join(__dirname, "../lib/public/modules/filebrowser-tabs.js") + "?preview=" + Date.now();
  var tabs = await import(moduleUrl);
  tabs.initFileViewerTabs({});
  tabs.previewFileViewerTab("one.md");
  tabs.previewFileViewerTab("two.md");
  assert.strictEqual(root.children.length, 1);
  assert.strictEqual(tabs.focusedFileViewerTab(), "two.md");
  tabs.openFileViewerTab("two.md");
  tabs.previewFileViewerTab("three.md");
  assert.strictEqual(root.children.length, 2);
  tabs.previewFileViewerTab("four.md");
  assert.strictEqual(root.children.length, 2);
  assert.strictEqual(tabs.focusedFileViewerTab(), "four.md");
  tabs.updateFileViewerTab("four.md", { content: "updated" });
  assert.strictEqual(root.children.length, 2);
  assert.strictEqual(tabs.updateFileViewerTab("stale.md", { content: "late" }), false);
  assert.strictEqual(root.children.length, 2);
  delete global.document;
});
