// The Snooze control on the update banner: what it renders, what it sends,
// and what it refuses to do. The suite has no DOM harness, so the module is
// evaluated against a minimal element model with its imports stubbed.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

var source = read("lib/public/modules/update-snooze.js");
var bannerSource = read("lib/public/modules/app-notifications.js");
var messagesSource = read("lib/public/modules/app-messages.js");
var css = read("lib/public/css/notifications-center.css");

// --- Fake DOM -------------------------------------------------------------

function makeEl(tag) {
  var el = {
    tagName: String(tag || "div").toUpperCase(),
    type: "",
    className: "",
    innerHTML: "",
    textContent: "",
    children: [],
    parentNode: null,
    attributes: {},
    listeners: {},
    focused: false,
    setAttribute: function (name, value) { this.attributes[name] = String(value); },
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    removeAttribute: function (name) { delete this.attributes[name]; },
    appendChild: function (child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild: function (child) {
      this.children = this.children.filter(function (c) { return c !== child; });
      child.parentNode = null;
      return child;
    },
    addEventListener: function (name, fn) {
      if (!this.listeners[name]) this.listeners[name] = [];
      this.listeners[name].push(fn);
    },
    focus: function () { el.focused = true; },
    dispatch: function (name, event) {
      var fns = this.listeners[name] || [];
      var e = event || {};
      if (!e.stopPropagation) e.stopPropagation = function () {};
      if (!e.preventDefault) e.preventDefault = function () {};
      for (var i = 0; i < fns.length; i++) fns[i](e);
      return e;
    },
    querySelector: function (sel) {
      var found = this.querySelectorAll(sel);
      return found.length ? found[0] : null;
    },
    querySelectorAll: function (sel) {
      var want = sel.replace(/^\./, "");
      var out = [];
      function walk(node) {
        for (var i = 0; i < node.children.length; i++) {
          var c = node.children[i];
          if (String(c.className).split(/\s+/).indexOf(want) !== -1) out.push(c);
          walk(c);
        }
      }
      walk(this);
      return out;
    },
  };
  return el;
}

function load(options) {
  var opts = options || {};
  var sent = [];
  var docListeners = {};
  var banner = opts.banner || null;
  var fakeDocument = {
    activeElement: null,
    createElement: makeEl,
    addEventListener: function (name, fn) {
      if (!docListeners[name]) docListeners[name] = [];
      docListeners[name].push(fn);
    },
    querySelector: function () { return banner; },
  };
  var ws = { readyState: opts.readyState === undefined ? 1 : opts.readyState,
    send: function (data) { sent.push(JSON.parse(data)); } };
  var body = source
    .replace(/^import[\s\S]*?;$/gm, "")
    .replace(/^export function/gm, "function");
  var factory = new Function(
    "document", "window", "getWs", "iconHtml", "refreshIcons", "Date",
    body + "\nreturn { attachSnoozeControl: attachSnoozeControl, handleUpdateSnoozed: handleUpdateSnoozed," +
      " isSnoozeChoice: isSnoozeChoice, setSnoozeBannerRemover: setSnoozeBannerRemover };"
  );
  var FakeDate = function () { return new Date(0); };
  FakeDate.prototype = Date.prototype;
  FakeDate.now = Date.now;
  // A fixed non-zero offset so the hint is observable. -540 is what
  // getTimezoneOffset() reports for UTC+9.
  FakeDate.prototype.getTimezoneOffset = function () { return -540; };

  var api = factory(
    fakeDocument,
    { addEventListener: function () {} },
    function () { return opts.ws === null ? null : ws; },
    function (name) { return '<i data-lucide="' + name + '"></i>'; },
    function () {},
    FakeDate
  );
  api.sent = sent;
  api.document = fakeDocument;
  api.docListeners = docListeners;
  return api;
}

function openControl(api) {
  var actions = makeEl("div");
  actions.className = "notif-banner-actions";
  var wrap = api.attachSnoozeControl(actions);
  var trigger = wrap.querySelector(".notif-banner-snooze-btn");
  trigger.dispatch("click");
  return { actions: actions, wrap: wrap, trigger: trigger };
}

// --- Rendering and accessibility -----------------------------------------

test("the control is a compact menu button with correct ARIA wiring", function () {
  var api = load();
  var actions = makeEl("div");
  var wrap = api.attachSnoozeControl(actions);

  assert.equal(wrap.className, "notif-banner-snooze");
  assert.equal(actions.children.length, 1, "it joins the existing action row");

  var trigger = wrap.querySelector(".notif-banner-snooze-btn");
  assert.ok(trigger, "there is a trigger");
  assert.equal(trigger.tagName, "BUTTON", "a real button, so it is focusable and Enter works");
  assert.equal(trigger.type, "button");
  assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(trigger.getAttribute("aria-label"), "Snooze this update notification");
  assert.match(trigger.innerHTML, /<span>Snooze<\/span>/, "and a visible label, not icon-only");
});

test("the menu offers exactly the three practical choices, as menu items", function () {
  var api = load();
  var opened = openControl(api);

  assert.equal(opened.trigger.getAttribute("aria-expanded"), "true");
  var menu = opened.wrap.querySelector(".notif-banner-snooze-menu");
  assert.ok(menu);
  assert.equal(menu.getAttribute("role"), "menu");
  assert.equal(menu.getAttribute("aria-label"), "Snooze this update");

  var items = menu.querySelectorAll(".notif-banner-snooze-item");
  assert.equal(items.length, 3);
  var labels = items.map(function (i) { return i.textContent; });
  assert.deepEqual(labels, ["3 hours", "8 hours", "Tomorrow"]);
  for (var i = 0; i < items.length; i++) {
    assert.equal(items[i].tagName, "BUTTON");
    assert.equal(items[i].getAttribute("role"), "menuitem");
  }
  assert.ok(items[0].focused, "opening moves focus into the menu");
});

test("the menu is keyboard operable and Escape returns focus to the trigger", function () {
  var api = load();
  var opened = openControl(api);
  var menu = opened.wrap.querySelector(".notif-banner-snooze-menu");
  var items = menu.querySelectorAll(".notif-banner-snooze-item");

  var prevented = false;
  api.document.activeElement = items[0];
  menu.dispatch("keydown", { key: "ArrowDown", preventDefault: function () { prevented = true; } });
  assert.equal(prevented, true, "arrow keys are consumed rather than scrolling the page");
  assert.ok(items[1].focused, "ArrowDown advances");

  api.document.activeElement = items[0];
  menu.dispatch("keydown", { key: "ArrowUp" });
  assert.ok(items[2].focused, "ArrowUp wraps to the end");

  opened.trigger.focused = false;
  menu.dispatch("keydown", { key: "Escape" });
  assert.equal(opened.wrap.querySelector(".notif-banner-snooze-menu"), null, "Escape closes");
  assert.equal(opened.trigger.getAttribute("aria-expanded"), "false");
  assert.ok(opened.trigger.focused, "and focus goes back where it came from");
});

test("clicking the trigger again closes the menu rather than stacking menus", function () {
  var api = load();
  var opened = openControl(api);
  assert.ok(opened.wrap.querySelector(".notif-banner-snooze-menu"));
  opened.trigger.dispatch("click");
  assert.equal(opened.wrap.querySelector(".notif-banner-snooze-menu"), null);
  assert.equal(opened.trigger.getAttribute("aria-expanded"), "false");
});

// --- What it sends --------------------------------------------------------

test("choosing an option sends only a duration key and a timezone hint", function () {
  var api = load();
  var opened = openControl(api);
  var items = opened.wrap.querySelector(".notif-banner-snooze-menu")
    .querySelectorAll(".notif-banner-snooze-item");
  items[2].dispatch("click");

  assert.equal(api.sent.length, 1);
  var frame = api.sent[0];
  assert.equal(frame.type, "update_snooze");
  assert.equal(frame.duration, "tomorrow");
  assert.equal(frame.tzOffsetMinutes, 540, "minutes east of UTC, the negation of getTimezoneOffset");
  assert.deepEqual(Object.keys(frame).sort(), ["duration", "type", "tzOffsetMinutes"],
    "no version, deadline or user id is sent");
  assert.equal(opened.wrap.querySelector(".notif-banner-snooze-menu"), null, "the menu closes");
});

test("each choice maps to its own allowlisted key", function () {
  var expected = ["3h", "8h", "tomorrow"];
  for (var i = 0; i < expected.length; i++) {
    var api = load();
    var opened = openControl(api);
    var items = opened.wrap.querySelector(".notif-banner-snooze-menu")
      .querySelectorAll(".notif-banner-snooze-item");
    items[i].dispatch("click");
    assert.equal(api.sent[0].duration, expected[i]);
  }
});

test("an unknown key is refused client-side too, and a dead socket sends nothing", function () {
  var api = load();
  assert.equal(api.isSnoozeChoice("3h"), true);
  assert.equal(api.isSnoozeChoice("8h"), true);
  assert.equal(api.isSnoozeChoice("tomorrow"), true);
  assert.equal(api.isSnoozeChoice("1h"), false);
  assert.equal(api.isSnoozeChoice("forever"), false);
  assert.equal(api.isSnoozeChoice(""), false);
  assert.equal(api.isSnoozeChoice("__proto__"), false);

  var closed = load({ readyState: 3 });
  var opened = openControl(closed);
  opened.wrap.querySelector(".notif-banner-snooze-menu")
    .querySelectorAll(".notif-banner-snooze-item")[0].dispatch("click");
  assert.equal(closed.sent.length, 0, "a closed socket is not written to");

  var none = load({ ws: null });
  var openedNone = openControl(none);
  openedNone.wrap.querySelector(".notif-banner-snooze-menu")
    .querySelectorAll(".notif-banner-snooze-item")[0].dispatch("click");
  assert.equal(none.sent.length, 0);
});

// --- Server confirmation --------------------------------------------------

test("the server's confirmation clears the banner, including on a second device", function () {
  var banner = makeEl("div");
  banner.className = "notif-banner";
  banner.setAttribute("data-notif-id", "_update");
  banner.setAttribute("data-update-version", "4.1.0");
  var host = makeEl("div");
  host.appendChild(banner);

  var api = load({ banner: banner });
  var removed = [];
  api.setSnoozeBannerRemover(function (el) { removed.push(el); });

  api.handleUpdateSnoozed({ type: "update_snoozed", ok: true, version: "4.1.0", until: 123 });
  assert.deepEqual(removed, [banner], "the banner is torn down through the owner's remover");
});

test("a confirmation for another version or a refusal leaves the banner alone", function () {
  var banner = makeEl("div");
  banner.className = "notif-banner";
  banner.setAttribute("data-notif-id", "_update");
  banner.setAttribute("data-update-version", "4.2.0");

  var api = load({ banner: banner });
  var removed = [];
  api.setSnoozeBannerRemover(function (el) { removed.push(el); });

  api.handleUpdateSnoozed({ ok: true, version: "4.1.0" });
  assert.deepEqual(removed, [], "a stale confirmation never hides a newer version's banner");

  api.handleUpdateSnoozed({ ok: false, error: "invalid_duration" });
  assert.deepEqual(removed, [], "a refusal changes nothing");

  api.handleUpdateSnoozed(null);
  assert.deepEqual(removed, []);

  api.handleUpdateSnoozed({ ok: true });
  assert.deepEqual(removed, [banner], "a confirmation with no version still applies");
});

// --- Banner integration ---------------------------------------------------

test("the banner grows a Snooze control without changing what was there", function () {
  var fn = bannerSource.slice(bannerSource.indexOf("export function showUpdateBanner(msg)"));
  fn = fn.slice(0, fn.indexOf("\n// ========================================================\n// Helpers"));

  assert.match(fn, /attachSnoozeControl\(banner\.querySelector\("\.notif-banner-actions"\)\);/);
  assert.match(fn, /notif-banner-update-now/, "Update now still exists");
  assert.match(fn, /notif-banner-close/, "so does dismiss");

  // Headless installs cannot install in-app but can still snooze.
  assert.match(fn, /isHeadless \? '' : '<button class="notif-banner-update-now">/);
  assert.match(fn, /var actionsHtml = '<div class="notif-banner-actions">'/,
    "the action row is unconditional now, because Snooze applies either way");

  // Duplicate frames for the same version are still ignored.
  assert.match(fn, /if \(existingVersion === msg\.version\) return;/,
    "a repeated hourly push does not re-render or flash the banner");
});

test("dismissal stays local and the modules do not form a cycle", function () {
  assert.match(bannerSource, /setSnoozeBannerRemover\(removeBanner\);/,
    "teardown is lent to the snooze module rather than imported back");
  assert.equal(/from '\.\/app-notifications\.js'/.test(source), false, "no cycle");
  assert.match(bannerSource, /import \{ attachSnoozeControl, setSnoozeBannerRemover \} from '\.\/update-snooze\.js';/);
  assert.match(messagesSource, /case "update_snoozed":\s*\n\s*handleUpdateSnoozed\(msg\);/);
});

// --- Conventions ----------------------------------------------------------

test("importing the module is side-effect-safe against a partial stub", function () {
  // Several suites load the client graph with a bare `window` object. A
  // dismiss-on-blur convenience must not be what breaks them.
  assert.match(source, /function onGlobal\(target, name, fn\) \{\s*\n\s*if \(target && typeof target\.addEventListener === "function"\)/);
  var tail = source.slice(source.indexOf("function onGlobal"));
  assert.equal(/^\s*(document|window)\.addEventListener/m.test(tail), false,
    "every global listener goes through the guard");

  assert.doesNotThrow(function () {
    var body = source.replace(/^import[\s\S]*?;$/gm, "").replace(/^export function/gm, "function");
    new Function("document", "window", "getWs", "iconHtml", "refreshIcons", body)(
      undefined, {}, function () { return null; }, function () { return ""; }, function () {}
    );
  }, "no document and a bare window is survivable");
});

test("the client module follows the client conventions", function () {
  assert.equal(/=>/.test(source), false, "no arrow functions");
  assert.equal(/^\s*(const|let)\s/m.test(source), false, "var only");
  assert.equal(/localStorage|sessionStorage/.test(source), false,
    "the deadline is server state, never browser storage");
  assert.equal(/alert\(|confirm\(|prompt\(/.test(source), false, "no native dialogs");
  assert.equal(/_ctx|initUpdateSnooze\(ctx\)/.test(source), false, "no init context bag");
  assert.match(source, /^import \{ getWs \} from '\.\/ws-ref\.js';$/m, "WS through ws-ref");
  assert.match(source, /export function attachSnoozeControl/, "ESM export");
  assert.ok(source.split("\n").length < 500, "under the module size limit");
});

test("the control reuses the banner's own visual language", function () {
  assert.match(css, /\.notif-banner-snooze-btn \{[^}]*padding: 4px 10px/s,
    "same button metrics as Update now");
  assert.match(css, /\.notif-banner-snooze-btn \{[^}]*background: transparent/s,
    "quiet surface, so postponing never reads as the primary action");
  assert.match(css, /\.notif-banner-snooze-btn:focus-visible \{/);
  assert.match(css, /\.notif-banner-snooze-item:focus-visible \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.notif-banner-snooze-btn \{ transition: none; \}/s);

  // Tokens, not a new palette: every literal colour is a var() fallback, the
  // same shape the surrounding banner rules already use.
  var block = css.slice(css.indexOf(".notif-banner-snooze {"));
  block = block.slice(0, block.indexOf("@media (prefers-reduced-motion"));
  var literals = block.match(/#[0-9a-f]{3,8}\b/gi) || [];
  var fallbacks = block.match(/var\(--[a-z-]+,\s*#[0-9a-f]{3,8}\)/gi) || [];
  assert.equal(literals.length, fallbacks.length,
    "no bare colour literal; every one is a token fallback");
  assert.ok(literals.length > 0, "and the block does define colours");
  assert.match(block, /var\(--overlay-rgb/, "borders and hovers use the shared overlay token");
  assert.match(block, /var\(--accent, #6c5ce7\)/, "focus uses the same accent as the banner buttons");
});
