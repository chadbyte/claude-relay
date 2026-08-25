var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

var helpersPromise = null;
function loadHelpers() {
  if (!helpersPromise) {
    var file = path.join(__dirname, "../lib/public/modules/pane-links.js");
    var source = fs.readFileSync(file, "utf8");
    helpersPromise = import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  }
  return helpersPromise;
}

function fakeAnchor(href, rel) {
  var attributes = { rel: rel || "" };
  return {
    href: href,
    attributes: attributes,
    getAttribute: function (name) { return attributes[name] || null; },
    setAttribute: function (name, value) { attributes[name] = value; },
  };
}

test("pane links force external web destinations into a new tab", async function () {
  var helpers = await loadHelpers();
  var anchor = fakeAnchor("https://example.com/docs", "nofollow");

  assert.strictEqual(helpers.forceExternalLinkToNewTab(anchor, "https://clay.test/p/project"), true);
  assert.strictEqual(anchor.attributes.target, "_blank");
  assert.strictEqual(anchor.attributes.rel, "nofollow noopener noreferrer");
});

test("pane links preserve same-origin app navigation", async function () {
  var helpers = await loadHelpers();
  var anchor = fakeAnchor("https://clay.test/p/another-project");

  assert.strictEqual(helpers.forceExternalLinkToNewTab(anchor, "https://clay.test/p/project"), false);
  assert.strictEqual(anchor.attributes.target, undefined);
});

test("pane links ignore non-web protocols", async function () {
  var helpers = await loadHelpers();

  assert.strictEqual(helpers.isExternalWebLink("mailto:hello@example.com", "https://clay.test/p/project"), false);
  assert.strictEqual(helpers.isExternalWebLink("javascript:void(0)", "https://clay.test/p/project"), false);
});
