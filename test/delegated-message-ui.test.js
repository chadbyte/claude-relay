var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var messagesCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/messages.css"), "utf8");
var delegatedStart = messagesCss.indexOf("/* --- Delegated work-order card");
var delegatedEnd = messagesCss.indexOf("/* --- User message action bar", delegatedStart);
var delegatedCss = messagesCss.slice(delegatedStart, delegatedEnd);

test("delegated messages use restrained routing colors instead of the vivid accent", function () {
  assert.ok(delegatedStart >= 0, "delegated message styles should exist");
  assert.ok(delegatedEnd > delegatedStart, "delegated message styles should have a bounded section");
  assert.doesNotMatch(delegatedCss, /var\(--accent\)/);
  assert.match(delegatedCss, /border-top:\s*1px solid color-mix\(in srgb, var\(--link\) 55%, var\(--border\)\)/);
  assert.match(delegatedCss, /color-mix\(in srgb, var\(--link\) 3%, var\(--bg-alt\)\)/);
});
