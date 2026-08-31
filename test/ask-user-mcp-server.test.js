var test = require("node:test");
var assert = require("node:assert/strict");
var getToolDefs = require("../lib/ask-user-mcp-server").getToolDefs;

test("ask_user_questions accepts freeform zero options and structured choices", async function () {
  var accepted = [];
  var tool = getToolDefs(function (input) { accepted.push(input); return Promise.resolve({ content: [{ type: "text", text: "ok" }] }); })[0];
  var freeform = await tool.handler({ questions: [{ header: "Topic", question: "What would you like to debate?", options: [] }] });
  var structured = await tool.handler({ questions: [{ header: "Format", question: "Which format?", options: [{ label: "Round table", description: "Explore" }, { label: "Pro/con", description: "Choose sides" }] }] });
  assert.equal(freeform.isError, undefined);
  assert.equal(structured.isError, undefined);
  assert.equal(accepted.length, 2);
  assert.deepEqual(accepted[0].questions[0].options, []);
  assert.equal(accepted[1].questions[0].options.length, 2);
  if (tool.inputSchema.questions && typeof tool.inputSchema.questions.safeParse === "function") {
    assert.equal(tool.inputSchema.questions.safeParse([{ header: "Topic", question: "Topic?", options: [] }]).success, true);
    assert.equal(tool.inputSchema.questions.safeParse([{ header: "Topic", question: "Only?", options: [{ label: "One", description: "Ambiguous" }] }]).success, false);
    assert.equal(tool.inputSchema.questions.safeParse([{ header: "Format", question: "Format?", options: [{ label: "A", description: "First" }, { label: "B", description: "Second" }] }]).success, true);
  }
});

test("ask_user_questions rejects the ambiguous one-option shape", async function () {
  var called = false;
  var tool = getToolDefs(function () { called = true; })[0];
  var result = await tool.handler({ questions: [{ question: "Only this?", options: [{ label: "Only", description: "No choice" }] }] });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /zero options|2-6 options/);
  assert.equal(called, false);
});
