var test = require("node:test");
var assert = require("node:assert");
var notesModule = require("../lib/project-session-notes");
var pairModule = require("../lib/project-session-pair");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

function createFixture(initialNotes) {
  var notes = (initialNotes || []).slice();
  var nextId = 1;
  var broadcasts = [];
  var written = [];
  var nm = {
    list: function () { return notes; },
    create: function (data) {
      var note = Object.assign({
        id: "new-" + nextId++,
        x: 100,
        y: 100,
        w: 240,
        h: 180,
        color: "yellow",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, data);
      notes.push(note);
      return note;
    },
    update: function (id, changes) {
      for (var i = 0; i < notes.length; i++) {
        if (notes[i].id === id) {
          Object.assign(notes[i], changes, { updatedAt: Date.now() });
          return notes[i];
        }
      }
      return null;
    },
    remove: function (id) {
      for (var i = 0; i < notes.length; i++) {
        if (notes[i].id === id) {
          notes.splice(i, 1);
          return true;
        }
      }
      return false;
    },
  };
  var attached = notesModule.attachSessionNotes({
    nm: nm,
    isMate: false,
    send: function (message) { broadcasts.push(message); },
    broadcastWritten: function (message) { written.push(message); },
  });
  return {
    attached: attached,
    broadcasts: broadcasts,
    written: written,
    nm: nm,
    notes: notes,
    session: { localId: 7, vendor: "kiro", title: "Planner" },
  };
}

function toolsFor(fixture) {
  var defs = fixture.attached.getToolDefs(fixture.session);
  var tools = {};
  for (var i = 0; i < defs.length; i++) tools[defs[i].name] = defs[i];
  return tools;
}

test("session note handlers list, create, and update shared notes", async function () {
  var f = createFixture([{
    id: "existing",
    text: "Existing fact",
    color: "blue",
    x: 40,
    y: 50,
    updatedAt: 1,
  }]);
  var tools = toolsFor(f);
  var listed = parseResult(await tools.list_notes.handler({}));
  assert.deepStrictEqual(listed, [{
    id: "existing",
    text: "Existing fact",
    color: "blue",
    updatedAt: 1,
    origin: null,
  }]);

  var created = parseResult(await tools.write_note.handler({ text: "Remember the API decision", color: "green" }));
  assert.strictEqual(created.text, "Remember the API decision");
  assert.deepStrictEqual(created.origin, { sessionId: 7, vendor: "kiro" });
  assert.notDeepStrictEqual({ x: f.notes[1].x, y: f.notes[1].y }, { x: 40, y: 50 });
  assert.strictEqual(f.broadcasts[0].type, "note_created");
  assert.deepStrictEqual(f.written[0], {
    type: "note_written",
    id: created.id,
    byTitle: "Planner",
    vendor: "kiro",
    preview: "Remember the API decision",
  });

  var updated = parseResult(await tools.write_note.handler({ id: created.id, text: "Remember the revised API decision" }));
  assert.strictEqual(updated.text, "Remember the revised API decision");
  assert.strictEqual(f.broadcasts[1].type, "note_updated");
  assert.deepStrictEqual(f.written[1], {
    type: "note_written",
    id: created.id,
    byTitle: "Planner",
    vendor: "kiro",
    preview: "Remember the revised API decision",
  });
});

test("note_written fires for creates and updates with a 60-character preview", async function () {
  var f = createFixture();
  var tools = toolsFor(f);
  var createText = "create " + "x".repeat(80);
  var updateText = "update " + "y".repeat(80);
  var created = parseResult(await tools.write_note.handler({ text: createText }));
  await tools.write_note.handler({ id: created.id, text: updateText });

  assert.strictEqual(f.written.length, 2);
  assert.strictEqual(f.written[0].preview, createText.slice(0, 60));
  assert.strictEqual(f.written[1].preview, updateText.slice(0, 60));
});

test("manual note-manager edits do not broadcast note_written", function () {
  var f = createFixture([{ id: "manual", text: "Before" }]);
  f.nm.update("manual", { text: "After" });
  assert.deepStrictEqual(f.written, []);
});

test("write_note allows detailed handoffs up to the generous abuse guard", async function () {
  var f = createFixture();
  var tools = toolsFor(f);
  var acceptedText = "Detailed handoff\n" + "x".repeat(notesModule.MAX_NOTE_TEXT_CHARS - 17);
  var accepted = await tools.write_note.handler({ text: acceptedText });
  assert.strictEqual(accepted.isError, undefined);

  var result = await tools.write_note.handler({ text: "x".repeat(notesModule.MAX_NOTE_TEXT_CHARS + 1) });
  assert.strictEqual(result.isError, true);
  assert.match(result.content[0].text, new RegExp("text exceeds " + notesModule.MAX_NOTE_TEXT_CHARS + " characters"));
  assert.strictEqual(f.notes.length, 1);
});

test("write_note contract treats the board as a scarce user-facing surface", function () {
  var tool = toolsFor(createFixture()).write_note;
  assert.match(tool.description, /title on the first line/i);
  assert.match(tool.description, /user-facing artifact/i);
  assert.match(tool.description, /Default to not writing/i);
  assert.match(tool.description, /glad to find it on the board a week later/i);
  assert.match(tool.description, /not already adequately recorded in the repository/i);
  assert.match(tool.description, /Never create a note merely because work is important/i);
  assert.match(tool.description, /completed work, implementation details, test results/i);
  assert.match(tool.description, /When uncertain, do not write/i);
  assert.match(tool.description, /Important exception for deferred defects/i);
  assert.match(tool.description, /outside the current session goal/i);
  assert.match(tool.description, /observable evidence, affected component, likely impact, and a clear next action/i);
  assert.match(tool.description, /Do not wait for the user to ask/i);
  assert.match(tool.description, /speculation, general cleanup ideas, or problems you fixed/i);
  assert.match(tool.description, /abuse guard, not a target/i);
});

test("write_note caps new active notes at twenty but still permits updates", async function () {
  var initial = [];
  for (var i = 0; i < 20; i++) {
    initial.push({ id: "note-" + i, text: "Fact " + i, color: "yellow", updatedAt: i });
  }
  var f = createFixture(initial);
  var tools = toolsFor(f);
  var createResult = await tools.write_note.handler({ text: "One too many" });
  assert.strictEqual(createResult.isError, true);
  assert.match(createResult.content[0].text, /20 active notes/);

  var updateResult = await tools.write_note.handler({ id: "note-0", text: "Consolidated fact" });
  assert.strictEqual(updateResult.isError, undefined);
  assert.strictEqual(f.notes[0].text, "Consolidated fact");
});

test("remove_note enforces calling-session ownership", async function () {
  var f = createFixture([
    { id: "own", text: "Own", origin: { sessionId: 7, vendor: "kiro" } },
    { id: "other", text: "Other", origin: { sessionId: 8, vendor: "claude" } },
    { id: "user", text: "User note" },
  ]);
  var tool = toolsFor(f).remove_note;
  var otherResult = await tool.handler({ id: "other" });
  var userResult = await tool.handler({ id: "user" });
  assert.strictEqual(otherResult.isError, true);
  assert.strictEqual(userResult.isError, true);
  assert.strictEqual(f.notes.length, 3);

  var ownResult = parseResult(await tool.handler({ id: "own" }));
  assert.deepStrictEqual(ownResult, { removed: true, id: "own" });
  assert.strictEqual(f.notes.length, 2);
  assert.deepStrictEqual(f.broadcasts[0], { type: "note_deleted", id: "own" });
});

test("sticky-note prompt announces an empty board and proactive policy", function () {
  var emptyPrompt = notesModule.buildNotesPrompt([]);
  assert.strictEqual(emptyPrompt, notesModule.NOTES_LABEL + "\n(board is empty)\n" + notesModule.PROACTIVE_POLICY);
  var prompt = notesModule.buildNotesPrompt([{ text: "Use port 2633", color: "yellow", updatedAt: 1 }]);
  assert.ok(prompt.startsWith(notesModule.NOTES_LABEL + "\n"));
  assert.match(prompt, /Use port 2633/);
  assert.match(prompt, /persists across sessions/);
  assert.match(prompt, /user-facing artifact/);
  assert.match(prompt, /Default to not writing/);
  assert.match(prompt, /glad to find it on the board a week later/);
  assert.match(prompt, /Important exception for deferred defects/);
  assert.match(prompt, /outside the current session goal/);
  assert.match(prompt, /Do not wait for the user to ask/);
  assert.ok(prompt.endsWith(notesModule.PROACTIVE_POLICY));
});

test("sticky-note prompt stays bounded with newest notes first", function () {
  var notes = [];
  for (var i = 0; i < 60; i++) {
    notes.push({ text: "note-" + i + " " + "x".repeat(100), color: "blue", updatedAt: i });
  }
  var prompt = notesModule.buildNotesPrompt(notes);
  var notesPortion = prompt.slice(0, prompt.length - notesModule.PROACTIVE_POLICY.length - 1);
  assert.ok(notesPortion.length <= notesModule.MAX_PROMPT_CHARS);
  assert.ok(prompt.indexOf("note-59") < prompt.indexOf("note-58"));
  assert.match(prompt, /call list_notes for the rest/);
  assert.ok(prompt.endsWith(notesModule.PROACTIVE_POLICY));
  assert.strictEqual(prompt.indexOf("note-0"), -1);
});

test("long notes use a bounded injection preview while list_notes returns full text", async function () {
  var longText = "Long durable context " + "x".repeat(900);
  var f = createFixture();
  var tools = toolsFor(f);
  await tools.write_note.handler({ text: longText, color: "purple" });

  var listed = parseResult(await tools.list_notes.handler({}));
  assert.strictEqual(listed[0].text, longText);

  var prompt = notesModule.buildNotesPrompt(f.notes);
  var noteLine = prompt.split("\n")[1];
  assert.ok(noteLine.length <= notesModule.MAX_NOTE_PROMPT_CHARS);
  assert.match(noteLine, /… \(list_notes for the full note\)$/);
  assert.strictEqual(prompt.indexOf(longText), -1);
});

test("pair and sticky-note prompts compose through appendSystemPrompt", function () {
  var driver = { localId: 1 };
  var group = { id: "pair", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var pair = pairModule.attachSessionPair({
    sm: { sessions: new Map() },
    splitStore: { groupForMember: function () { return group; } },
  });
  var appendSystemPrompt = notesModule.composeSystemPrompts([
    pair.getSystemPrompt(driver),
    notesModule.buildNotesPrompt([{ text: "Ship beta first", color: "pink", updatedAt: 1 }]),
  ]);
  assert.match(appendSystemPrompt, /You are the Driver/);
  assert.ok(appendSystemPrompt.indexOf(notesModule.NOTES_LABEL) !== -1);
  assert.match(appendSystemPrompt, /Ship beta first/);
});

test("notes are omitted from mate sessions", function () {
  var attached = notesModule.attachSessionNotes({
    nm: { list: function () { return [{ text: "Private mate note", updatedAt: 1 }]; } },
    isMate: true,
  });
  assert.deepStrictEqual(attached.getToolDefs({ localId: 1 }), []);
  assert.strictEqual(attached.getSystemPrompt({ localId: 1 }), "");
});

test("notes whitelist auto-allows list and write but not removal", function () {
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {},
    adapter: {},
    send: function () {},
  });
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-notes__list_notes", {}).behavior, "allow");
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-notes__write_note", {}).behavior, "allow");
  assert.strictEqual(bridge.checkToolWhitelist("mcp__clay-notes__remove_note", {}), null);
});
