var sessionNotesMcp = require("./session-notes-mcp-server");

var MAX_NOTE_TEXT_CHARS = 20000;
var MAX_ACTIVE_NOTES = 20;
var MAX_PROMPT_CHARS = 4000;
var MAX_NOTE_PROMPT_CHARS = 800;
var NOTES_LABEL = "--- Project sticky notes (cross-session work memory; manage via clay-notes tools) ---";
var NOTES_HINT = "- More notes are available; call list_notes for the rest.";
var PROACTIVE_POLICY = sessionNotesMcp.MEMORY_CONTRACT + " If an injected preview is relevant or truncated, call list_notes before acting or writing so you do not create a duplicate.";
var NOTE_COLORS = ["purple", "green", "yellow", "blue", "pink", "orange"];

function toolResult(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

function toolError(message) {
  return Promise.resolve({
    content: [{ type: "text", text: "Error: " + message }],
    isError: true,
  });
}

function activeNotes(notes) {
  return (notes || []).filter(function (note) {
    return note && !note.hidden;
  });
}

function memoryNotes(notes) {
  return activeNotes(notes).filter(function (note) {
    return typeof note.text === "string" && note.text.trim();
  });
}

function publicNote(note) {
  return {
    id: note.id,
    text: note.text,
    color: note.color,
    updatedAt: note.updatedAt,
    origin: note.origin || null,
  };
}

function findNote(notes, id) {
  for (var i = 0; i < notes.length; i++) {
    if (notes[i] && notes[i].id === id) return notes[i];
  }
  return null;
}

function autoPlacement(notes) {
  if (!notes || notes.length === 0) return { x: 100, y: 100 };
  var last = notes[notes.length - 1];
  var baseX = typeof last.x === "number" ? last.x : 100;
  var baseY = typeof last.y === "number" ? last.y : 100;
  var step = 1;
  while (step <= notes.length + 1) {
    var x = baseX + step * 30;
    var y = baseY + step * 30;
    var occupied = notes.some(function (note) {
      return note && note.x === x && note.y === y;
    });
    if (!occupied) return { x: x, y: y };
    step++;
  }
  return { x: baseX + (notes.length + 2) * 30, y: baseY + (notes.length + 2) * 30 };
}

function formatNoteLine(note) {
  var prefix = "- " + (note.color ? "[" + note.color + "] " : "");
  var text = note.text.trim();
  var marker = "… (list_notes for the full note)";
  if (prefix.length + text.length <= MAX_NOTE_PROMPT_CHARS) return prefix + text;
  var previewLength = Math.max(0, MAX_NOTE_PROMPT_CHARS - prefix.length - marker.length);
  return prefix + text.slice(0, previewLength).trimEnd() + marker;
}

function buildNotesPrompt(notes) {
  var newest = memoryNotes(notes).sort(function (a, b) {
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
  if (newest.length === 0) return NOTES_LABEL + "\n(board is empty)\n" + PROACTIVE_POLICY;
  var lines = newest.map(formatNoteLine);
  var full = NOTES_LABEL + "\n" + lines.join("\n");
  if (full.length <= MAX_PROMPT_CHARS) return full + "\n" + PROACTIVE_POLICY;

  var result = NOTES_LABEL;
  var available = MAX_PROMPT_CHARS - result.length - NOTES_HINT.length - 2;
  for (var i = 0; i < lines.length && available > 0; i++) {
    var prefix = "\n";
    if (prefix.length + lines[i].length <= available) {
      result += prefix + lines[i];
      available -= prefix.length + lines[i].length;
      continue;
    }
    var partialLength = Math.max(0, available - prefix.length - 1);
    if (partialLength > 0) result += prefix + lines[i].slice(0, partialLength) + "…";
    break;
  }
  return (result + "\n" + NOTES_HINT).slice(0, MAX_PROMPT_CHARS) + "\n" + PROACTIVE_POLICY;
}

function composeSystemPrompts(parts) {
  return (parts || []).filter(function (part) { return typeof part === "string" && part.trim(); }).join("\n\n");
}

function attachSessionNotes(ctx) {
  var nm = ctx.nm;
  var send = ctx.send || function () {};
  var broadcastWritten = ctx.broadcastWritten || function () {};

  function notifyWritten(note, caller) {
    broadcastWritten({
      type: "note_written",
      id: note.id,
      byTitle: caller.title || "Agent",
      vendor: caller.vendor || "claude",
      preview: (note.text || "").slice(0, 60),
    });
  }

  function listNotes(args, caller) {
    if (!caller) return toolError("list_notes requires a session-bound tool server");
    return toolResult(activeNotes(nm.list()).map(publicNote));
  }

  function writeNote(args, caller) {
    if (!caller) return toolError("write_note requires a session-bound tool server");
    var rawText = typeof args.text === "string" ? args.text : "";
    if (rawText.length > MAX_NOTE_TEXT_CHARS) return toolError("text exceeds " + MAX_NOTE_TEXT_CHARS + " characters");
    var text = rawText.trim();
    if (!text) return toolError("text is required");
    var notes = nm.list() || [];
    var color = NOTE_COLORS.indexOf(args.color) !== -1 ? args.color : undefined;
    if (args.id) {
      var existing = findNote(notes, args.id);
      if (!existing) return toolError("note not found: " + args.id);
      var changes = { text: text };
      if (color) changes.color = color;
      var updated = nm.update(args.id, changes);
      if (!updated) return toolError("note could not be updated: " + args.id);
      send({ type: "note_updated", note: updated });
      notifyWritten(updated, caller);
      return toolResult(publicNote(updated));
    }
    if (activeNotes(notes).length >= MAX_ACTIVE_NOTES) {
      return toolError("20 active notes already exist; consolidate or remove stale notes before creating another");
    }
    var placement = autoPlacement(notes);
    var created = nm.create({
      text: text,
      color: color || "purple",
      x: placement.x,
      y: placement.y,
      origin: { sessionId: caller.localId, vendor: caller.vendor || "claude" },
    });
    if (!created) return toolError("note could not be created");
    send({ type: "note_created", note: created });
    notifyWritten(created, caller);
    return toolResult(publicNote(created));
  }

  function removeNote(args, caller) {
    if (!caller) return toolError("remove_note requires a session-bound tool server");
    var note = findNote(nm.list() || [], args.id);
    if (!note) return toolError("note not found: " + (args.id || "unknown"));
    if (!note.origin || note.origin.sessionId !== caller.localId) {
      return toolError("this session can only remove notes it created");
    }
    if (!nm.remove(note.id)) return toolError("note could not be removed: " + note.id);
    send({ type: "note_deleted", id: note.id });
    return toolResult({ removed: true, id: note.id });
  }

  function getToolDefs(boundSession) {
    if (ctx.isMate) return [];
    return sessionNotesMcp.getToolDefs({
      list: function (args) { return listNotes(args, boundSession || null); },
      write: function (args) { return writeNote(args, boundSession || null); },
      remove: function (args) { return removeNote(args, boundSession || null); },
    });
  }

  function createMcpServer(adapter, boundSession) {
    if (ctx.isMate || !adapter || typeof adapter.createToolServer !== "function") return null;
    return adapter.createToolServer({
      name: "clay-notes",
      version: "1.0.0",
      tools: getToolDefs(boundSession || null),
    });
  }

  function getSystemPrompt() {
    if (ctx.isMate) return "";
    return buildNotesPrompt(nm.list());
  }

  return {
    createMcpServer: createMcpServer,
    getSystemPrompt: getSystemPrompt,
    getToolDefs: getToolDefs,
  };
}

module.exports = {
  MAX_NOTE_TEXT_CHARS: MAX_NOTE_TEXT_CHARS,
  MAX_ACTIVE_NOTES: MAX_ACTIVE_NOTES,
  MAX_NOTE_PROMPT_CHARS: MAX_NOTE_PROMPT_CHARS,
  MAX_PROMPT_CHARS: MAX_PROMPT_CHARS,
  NOTES_LABEL: NOTES_LABEL,
  PROACTIVE_POLICY: PROACTIVE_POLICY,
  attachSessionNotes: attachSessionNotes,
  autoPlacement: autoPlacement,
  buildNotesPrompt: buildNotesPrompt,
  composeSystemPrompts: composeSystemPrompts,
};
