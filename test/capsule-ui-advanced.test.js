var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var pathToFileURL = require("url").pathToFileURL;
var spec = require("../lib/tool-ui-spec");

var root = path.join(__dirname, "..");
function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }

test("advanced condition AST, else, switch, and dynamic props validate safely", function () {
  var tree = {
    type: "stack",
    children: [
      { type: "callout", when: { all: [{ equals: { path: "status", value: "error" } }, { not: { in: { path: "code", values: [200, 201] } } }] }, props: { title: { $bind: "errorTitle", fallback: "Error" } }, else: { type: "text", props: { text: "Ready" } } },
      { type: "switch", bind: "mode", children: [
        { type: "case", props: { value: "list" }, children: [{ type: "text", props: { text: "List" } }] },
        { type: "case", props: { default: true }, children: [{ type: "text", props: { text: "Other" } }] },
      ] },
      { type: "button", action: "save", props: { label: { $bind: "saveLabel", fallback: "Save" }, variant: { $bind: "buttonVariant", $enum: ["primary", "secondary", "ghost", "danger"], fallback: "primary" }, disabled: { $bind: "busy", fallback: false } } },
    ],
  };
  assert.strictEqual(spec.validateUiNode(tree), true);
  assert.throws(function () { spec.validateUiNode({ type: "text", when: { eval: "state.secret" } }); }, /allowed condition operator/);
  assert.throws(function () { spec.validateUiNode({ type: "text", when: { gt: { path: "count", value: "many" } } }); }, /finite numeric/);
  assert.throws(function () { spec.validateUiNode({ type: "switch", bind: "mode", children: [{ type: "text" }] }); }, /case nodes/);
  assert.throws(function () { spec.validateUiNode({ type: "icon", props: { icon: { $bind: "icon" } } }); }, /does not allow a dynamic value/);
  assert.throws(function () { spec.validateUiNode({ type: "button", action: "save", props: { label: "Save", variant: { $bind: "variant", fallback: "primary" } } }); }, /allowed enum values/);
  assert.throws(function () { spec.validateUiNode({ type: "text", props: { text: { $bind: "__proto__.value" } } }); }, /safe \$bind/);
});

test("advanced forms, options, overlays, collections, and charts enforce bounded contracts", function () {
  var tree = { type: "stack", children: [
    { type: "form", action: "submit", props: { label: "Settings", submitLabel: "Save" }, children: [
      { type: "input", id: "age", bind: "age", action: "setAge", props: { label: "Age", inputType: "number", error: { $bind: "errors.age", fallback: "" }, validation: { min: 0, max: 130, step: 1, pattern: "integer" } } },
      { type: "select", id: "role", bind: "role", action: "setRole", props: { label: "Role", options: { $bind: "roleOptions" } } },
    ] },
    { type: "tabs", bind: "tab", action: "setTab", props: { label: "Views" }, children: [{ type: "tab", props: { label: "Summary", value: "summary" } }] },
    { type: "tabs", bind: "dynamicTab", action: "setDynamicTab", props: { label: "Dynamic views", options: { $bind: "tabOptions", fallback: [] } } },
    { type: "dialog", props: { label: "Confirm deletion", description: "This cannot be undone.", open: { $bind: "confirming", fallback: false }, closeAction: "closeDialog" }, children: [{ type: "button", action: "remove", props: { label: "Delete", variant: "danger" } }] },
    { type: "menu", props: { label: "Record actions", triggerLabel: "Actions" }, children: [{ type: "menu-item", action: "archive", props: { label: "Archive" } }] },
    { type: "menu", action: "chooseAction", props: { label: "Dynamic actions", triggerLabel: "Choose", options: { $bind: "menuOptions", fallback: [] } } },
    { type: "table", bind: "rows", props: { columns: [{ key: "name", label: "Name" }], filter: { $bind: "query" }, filterKey: "name", sortKey: "score", sortDirection: "desc", page: { $bind: "page", fallback: 1 }, pageSize: 25 } },
    { type: "table", bind: "rows", props: { columns: { $bind: "columns", fallback: [{ key: "name", label: "Name" }] } } },
    { type: "pagination", bind: "page", props: { label: "Results pages", total: { $bind: "total", fallback: 0 }, pageSize: 25, pageAction: "setPage" } },
    { type: "chart", bind: "metrics", props: { label: "Weekly activity", kind: "bar", categoryKey: "day", valueKey: "count", maxItems: 50 } },
    { type: "chart", bind: "metrics", props: { label: "Completion", kind: "progress", valueKey: "count", max: { $bind: "goal", fallback: 100 }, maxItems: { $bind: "chartLimit", fallback: 10 } } },
    { type: "chart", bind: "metrics", props: { label: "Total", kind: "metric", valueKey: "count" } },
  ] };
  assert.strictEqual(spec.validateUiNode(tree), true);
  assert.throws(function () { spec.validateUiNode({ type: "input", id: "bad", bind: "x", action: "set", props: { label: "X", validation: { pattern: ".*" } } }); }, /pattern is not allowed/);
  assert.throws(function () { spec.validateUiNode({ type: "chart", bind: "rows", props: { label: "Too much", kind: "bar", categoryKey: "x", valueKey: "y", maxItems: 51 } }); }, /integer from 1 to 50/);
  assert.throws(function () { spec.validateUiNode({ type: "chart", bind: "rows", props: { label: "Progress", kind: "progress", valueKey: "value" } }); }, /requires a positive max/);
  assert.throws(function () { spec.validateUiNode({ type: "chart", bind: "rows", props: { label: "Progress", kind: "progress", valueKey: "value", max: -1 } }); }, /positive finite/);
  assert.throws(function () { spec.validateUiNode({ type: "chart", bind: "rows", props: { label: "Bars", kind: "bar", valueKey: "value" } }); }, /requires categoryKey/);
  assert.strictEqual(spec.validateUiNode({ type: "chart", bind: "rows", props: { label: "Metric", kind: "metric", valueKey: "value" } }), true);
  assert.strictEqual(spec.validateUiNode({ type: "list", bind: "rows", props: { page: { $bind: "page", fallback: 1 }, pageSize: { $bind: "pageSize", fallback: 20 } } }), true);
  assert.throws(function () { spec.validateUiNode({ type: "switch", bind: "mode", children: [{ type: "case", props: { value: { $bind: "dynamicCase" } } }] }); }, /static scalar/);
  assert.throws(function () { spec.validateUiNode({ type: "pagination", bind: "page", props: { pageAction: "setPage", pageSize: 20 } }); }, /requires bind, total, and pageAction/);
  assert.throws(function () { spec.validateUiNode({ type: "select", id: "bad-options", bind: "x", action: "set", props: { label: "X", options: [{ value: {}, label: "Bad" }] } }); }, /option value\/label types/);
});

test("chart geometry is bounded, truthful, and resilient to hostile numeric data", async function () {
  var chart = await import(pathToFileURL(path.join(root, "lib/public/modules/tool-renderer-chart.js")).href);
  var data = chart.chartData({ rows: [{ label: "Low", value: 2 }, { label: "High", value: 10 }, { label: "Bad", value: "Infinity" }, { label: "Negative", value: -8 }] }, "rows", { categoryKey: "label", valueKey: "value", maxItems: 3 }, null);
  assert.deepStrictEqual(data, [{ label: "Low", value: 2 }, { label: "High", value: 10 }, { label: "Bad", value: 0 }]);
  var line = chart.lineGeometry(data);
  assert.deepStrictEqual(line.map(function (point) { return point.y; }), [32.4, 2, 40]);
  assert.deepStrictEqual(line.map(function (point) { return point.x; }), [0, 50, 100]);
  var donut = chart.donutGeometry([{ label: "A", value: 1 }, { label: "B", value: 3 }]);
  assert.strictEqual(donut[0].percent, 25);
  assert.strictEqual(donut[1].percent, 75);
  assert.strictEqual(donut[1].offset, 25);
  assert.strictEqual(chart.donutGeometry(new Array(30).fill({ label: "x", value: 1 })).length, 12);
  assert.match(read("lib/public/modules/tool-renderer-chart.js"), /props\.kind === "donut"\) data = data\.slice\(0, 12\)/);
});

function MiniElement(tag) {
  this.tagName = tag;
  this.children = [];
  this.attributes = {};
  this.dataset = {};
  this.className = "";
  this.textContent = "";
  this.listeners = {};
}
MiniElement.prototype.appendChild = function (child) { this.children.push(child); return child; };
MiniElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
MiniElement.prototype.addEventListener = function (name, listener) { this.listeners[name] = listener; };
MiniElement.prototype.contains = function (target) { return this === target || this.children.some(function (child) { return child.contains && child.contains(target); }); };
MiniElement.prototype.querySelectorAll = function () { return []; };
MiniElement.prototype.focus = function () {};

test("progress uses declared maximum and advanced groups allocate unique deterministic IDs", async function () {
  var originalDocument = global.document;
  var fakeDocument = {
    activeElement: null,
    createElement: function (tag) { return new MiniElement(tag); },
    createElementNS: function (namespace, tag) { return new MiniElement(tag); },
    addEventListener: function () {},
    removeEventListener: function () {},
  };
  global.document = fakeDocument;
  try {
    var chart = await import(pathToFileURL(path.join(root, "lib/public/modules/tool-renderer-chart.js")).href);
    var advanced = await import(pathToFileURL(path.join(root, "lib/public/modules/tool-renderer-advanced.js")).href);
    var context = { toolId: "demo", state: { rows: [{ value: 25 }] }, item: null, emit: function () {}, container: new MiniElement("div"), disposers: [], autoControlIndex: 1 };
    var progressFigure = chart.renderChartNode({ type: "chart", bind: "rows" }, { label: "Progress", kind: "progress", valueKey: "value", max: 100, maxItems: 1 }, context);
    var progress = progressFigure.children.filter(function (child) { return child.tagName === "progress"; })[0];
    assert.strictEqual(progress.max, 100);
    assert.strictEqual(progress.value, 25);

    var tabs = { type: "tabs", bind: "tab", action: "setTab", props: { label: "Views" }, children: [{ type: "tab", props: { label: "One", value: "one" } }] };
    var firstTabs = advanced.renderAdvancedNode(tabs, tabs.props, context, function () { return new MiniElement("span"); });
    var secondTabs = advanced.renderAdvancedNode(tabs, tabs.props, context, function () { return new MiniElement("span"); });
    var firstId = firstTabs.children[0].children[0].id;
    var secondId = secondTabs.children[0].children[0].id;
    assert.notStrictEqual(firstId, secondId);
    assert.match(firstId, /tabs-1/);
    assert.match(secondId, /tabs-2/);

    var dialog = { type: "dialog", props: { label: "Details", description: "Safe", open: true, closeAction: "close" }, children: [] };
    var firstDialog = advanced.renderAdvancedNode(dialog, dialog.props, context, function () { return new MiniElement("span"); });
    var secondDialog = advanced.renderAdvancedNode(dialog, dialog.props, context, function () { return new MiniElement("span"); });
    assert.notStrictEqual(firstDialog.children[0].children[0].id, secondDialog.children[0].children[0].id);
    for (var di = 0; di < context.disposers.length; di++) context.disposers[di]();
  } finally {
    global.document = originalDocument;
  }
});

test("disposed closed dialogs cannot steal focus through a delayed return", async function () {
  var originalDocument = global.document;
  var focusCount = 0;
  var fakeDocument = { activeElement: null, createElement: function (tag) { return new MiniElement(tag); }, addEventListener: function () {}, removeEventListener: function () {} };
  global.document = fakeDocument;
  try {
    var advanced = await import(pathToFileURL(path.join(root, "lib/public/modules/tool-renderer-advanced.js")).href);
    var container = new MiniElement("div");
    container.querySelectorAll = function () { return [{ dataset: { toolControlId: "opener" }, focus: function () { focusCount++; } }]; };
    var openContext = { toolId: "focus", state: {}, item: null, emit: function () {}, container: container, disposers: [], autoControlIndex: 1, activeControlId: "opener" };
    advanced.renderAdvancedNode({ type: "dialog", props: {} }, { label: "Dialog", open: true, closeAction: "close" }, openContext, function () { return new MiniElement("span"); });
    for (var oi = 0; oi < openContext.disposers.length; oi++) openContext.disposers[oi]();
    var closedContext = { toolId: "focus", state: {}, item: null, emit: function () {}, container: container, disposers: [], autoControlIndex: 1 };
    advanced.renderAdvancedNode({ type: "dialog", props: {} }, { label: "Dialog", open: false, closeAction: "close" }, closedContext, function () { return new MiniElement("span"); });
    for (var ci = 0; ci < closedContext.disposers.length; ci++) closedContext.disposers[ci]();
    await new Promise(function (resolve) { setTimeout(resolve, 2); });
    assert.strictEqual(focusCount, 0);
  } finally {
    global.document = originalDocument;
  }
});

test("pure renderer evaluator executes conditions and bounded filter sort pagination", async function () {
  var evaluator = await import(pathToFileURL(path.join(root, "lib/public/modules/tool-ui-evaluator.js")).href);
  var state = { ready: true, status: "active", count: 7, query: "a", page: 2, variant: "primary" };
  assert.strictEqual(evaluator.evaluateCondition({ all: [{ equals: { path: "status", value: "active" } }, { gte: { path: "count", value: 7 } }] }, state), true);
  assert.strictEqual(evaluator.evaluateCondition({ any: [{ notEquals: { path: "status", value: "active" } }, { in: { path: "count", values: [6, 7] } }] }, state), true);
  assert.strictEqual(evaluator.evaluateCondition({ not: "ready" }, state), false);
  assert.deepStrictEqual(evaluator.resolveProps({ variant: { $bind: "variant", $enum: ["primary", "ghost"], fallback: "ghost" }, missing: { $bind: "missing", fallback: "Fallback" } }, state), { variant: "primary", missing: "Fallback" });
  var items = [];
  for (var i = 0; i < 650; i++) items.push({ name: i % 2 ? "alpha" + i : "beta" + i, score: i });
  var view = evaluator.collectionView(items, { filter: "alpha", filterKey: "name", sortKey: "score", sortDirection: "desc", page: 2, pageSize: 10 });
  assert.strictEqual(view.length, 10);
  assert.strictEqual(view[0].score, 479);
  assert.ok(view.every(function (item) { return item.name.indexOf("alpha") !== -1; }));
  var options = evaluator.normalizeOptions([{ value: "safe", label: "Safe" }, { value: {}, label: "Unsafe" }].concat(new Array(120).fill("x")));
  assert.strictEqual(options.length, 99);
  var columns = evaluator.normalizeColumns([{ key: "name", label: "Name" }, { key: "__proto__.secret", label: "No" }]);
  assert.deepStrictEqual(columns, [{ key: "name", label: "Name" }]);
});

test("advanced renderer remains host-owned, text-safe, accessible, and free of authored escape hatches", function () {
  var advanced = read("lib/public/modules/tool-renderer-advanced.js");
  var renderer = read("lib/public/modules/tool-renderer.js");
  var chartRenderer = read("lib/public/modules/tool-renderer-chart.js");
  var semantics = read("lib/public/modules/tool-renderer-semantics.js");
  var css = read("lib/public/css/capsule-ui.css");
  assert.match(advanced, /role", "dialog"/);
  assert.match(advanced, /aria-modal/);
  assert.match(advanced, /role", "tablist"/);
  assert.match(advanced, /aria-selected/);
  assert.match(advanced, /role", "menu"/);
  assert.match(advanced, /event\.key === "Escape"/);
  assert.match(advanced, /event\.key !== "Tab"/);
  assert.match(advanced, /dialogOpeners/);
  assert.match(advanced, /returnTimer[\s\S]*context\.disposers\.push/);
  assert.match(advanced, /closeMenu\(true\)[\s\S]*emit\(selected/);
  assert.match(renderer, /action-" \+ node\.action/);
  assert.match(renderer, /props\.error/);
  assert.match(renderer, /Math\.max\(2, Math\.min\(16/);
  assert.match(renderer, /aria-invalid/);
  assert.match(renderer, /normalizeOptions/);
  assert.match(read("lib/public/modules/tool-ui-evaluator.js"), /slice\(0, 100\)/);
  assert.match(semantics, /TOKEN_VALUES/);
  assert.doesNotMatch(renderer + advanced + chartRenderer, /insertAdjacentHTML|outerHTML|props\.(?:class|style|html)|createElement\(["']script/);
  assert.match(chartRenderer, /createElementNS/);
  assert.match(chartRenderer, /tool-chart-data/);
  assert.match(css, /\.tool-dialog-overlay/);
  assert.match(css, /\.tool-chart/);
  assert.match(css, /@media \(max-width: 600px\)/);
});

test("authoring contract describes the advanced safe grammar without executable markup", function () {
  var description = spec.authoringDescription();
  assert.match(description, /all\/any\/not\/equals\/notEquals\/in\/gt\/gte\/lt\/lte/);
  assert.match(description, /Forms provide bounded field validation/);
  assert.match(description, /Tabs and menus/);
  assert.match(description, /bar\/line\/donut\/progress\/metric/);
  assert.match(description, /at most 50 points/);
  assert.match(description, /Arbitrary class, style, HTML, JavaScript, authored SVG/);
});
