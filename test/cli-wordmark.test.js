var test = require("node:test");
var assert = require("node:assert");
var wordmark = require("../lib/cli-wordmark");

test("CLI wordmark uses the full serif form in wide terminals", function() {
  var lines = wordmark.getWordmarkLines(120);
  assert.equal(lines.length, 10);
  assert.match(lines.join("\n"), /7MM/);
  assert.ok(lines.every(function(line) { return line.length <= 92; }));
});

test("CLI wordmark uses a compact form in standard terminals", function() {
  var lines = wordmark.getWordmarkLines(80);
  assert.equal(lines.length, 5);
  assert.ok(lines.every(function(line) { return line.length <= 50; }));
});

test("CLI wordmark remains readable in narrow or piped output", function() {
  assert.deepEqual(wordmark.getWordmarkLines(40), ["Clay Studio"]);
});
