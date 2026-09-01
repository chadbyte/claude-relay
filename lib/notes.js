var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var config = require("./config");
var utils = require("./utils");

function createNotesManager(opts) {
  var cwd = opts.cwd;

  // Storage path: ~/.clay/notes/{encodedCwd}.json
  var notesDir = path.join(config.CONFIG_DIR, "notes");
  var encodedCwd = utils.resolveEncodedFile(notesDir, cwd, ".json");
  var notesFile = path.join(notesDir, encodedCwd + ".json");

  // In-memory cache
  var notes = loadFromDisk();

  function generateId() {
    return "n_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
  }

  function loadFromDisk() {
    try {
      var data = fs.readFileSync(notesFile, "utf8");
      var parsed = JSON.parse(data);
      return parsed.notes || [];
    } catch (e) {
      return [];
    }
  }

  function saveToDisk() {
    try {
      fs.mkdirSync(notesDir, { recursive: true });
      var tmpPath = notesFile + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify({ notes: notes }, null, 2));
      fs.renameSync(tmpPath, notesFile);
    } catch (e) {
      console.error("[notes] Failed to save:", e.message);
    }
  }

  function list() {
    return notes;
  }

  function create(data) {
    var now = Date.now();
    var note = {
      id: generateId(),
      text: data.text || "",
      x: typeof data.x === "number" ? data.x : 100,
      y: typeof data.y === "number" ? data.y : 100,
      w: typeof data.w === "number" ? data.w : 240,
      h: typeof data.h === "number" ? data.h : 180,
      color: data.color || "purple",
      opacity: typeof data.opacity === "number" ? data.opacity : 0.64,
      minimized: false,
      zIndex: notes.length + 1,
      createdAt: now,
      updatedAt: now,
    };
    if (data.origin && data.origin.sessionId !== undefined) {
      note.origin = {
        sessionId: data.origin.sessionId,
        vendor: data.origin.vendor || "claude",
      };
    }
    notes.push(note);
    saveToDisk();
    return note;
  }

  function update(id, changes) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id === id) {
        var allowed = ["text", "x", "y", "w", "h", "color", "minimized", "hidden", "zIndex", "opacity"];
        for (var j = 0; j < allowed.length; j++) {
          var key = allowed[j];
          if (changes[key] !== undefined) {
            notes[i][key] = changes[key];
          }
        }
        notes[i].updatedAt = Date.now();
        saveToDisk();
        return notes[i];
      }
    }
    return null;
  }

  function remove(id) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id === id) {
        notes.splice(i, 1);
        saveToDisk();
        return true;
      }
    }
    return false;
  }

  function bringToFront(id) {
    var maxZ = 0;
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].zIndex > maxZ) maxZ = notes[i].zIndex;
    }
    // Normalize if z-index grows too large
    if (maxZ > 10000) {
      notes.sort(function (a, b) { return a.zIndex - b.zIndex; });
      for (var k = 0; k < notes.length; k++) {
        notes[k].zIndex = k + 1;
      }
      maxZ = notes.length;
    }
    return update(id, { zIndex: maxZ + 1 });
  }

  /**
   * Return formatted text of all active (non-hidden) notes.
   * Used to inject into mate CLAUDE.md so the mate can read them.
   */
  function getActiveNotesText() {
    var active = [];
    for (var i = 0; i < notes.length; i++) {
      if (!notes[i].hidden && notes[i].text) active.push(notes[i]);
    }
    if (active.length === 0) return "";
    var lines = [];
    for (var j = 0; j < active.length; j++) {
      var n = active[j];
      var label = n.color ? "[" + n.color + "]" : "";
      lines.push("- " + label + " " + n.text.trim());
    }
    return lines.join("\n");
  }

  return {
    list: list,
    create: create,
    update: update,
    remove: remove,
    bringToFront: bringToFront,
    getActiveNotesText: getActiveNotesText,
  };
}

module.exports = { createNotesManager: createNotesManager };
