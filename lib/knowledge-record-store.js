// Clay-wide append-only knowledge record backend.
//
// One physical store per scope. Every Knowledge surface is a projection over
// this backend rather than its own store: Project Logs today, Mate Knowledge
// and Shared Knowledge later. Records are never rewritten in place, so
// revision chains, tombstones, and author/blame fall out of the storage format
// instead of being layered on top of it.
//
// Storage lives under config.CONFIG_DIR, never inside a user repository:
//   {CONFIG_DIR}/knowledge/{scope}/{name}/records.jsonl
//
// Loading is incremental and torn-write tolerant. Bytes are consumed only up to
// the last newline, so a partially written trailing line is held back until it
// completes, and a complete-but-unparseable line is skipped and counted rather
// than failing the load.

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var config = require("./config");

var RECORD_VERSION = 1;
var MAX_RECORD_BYTES = 64 * 1024;
var MAX_STORE_BYTES = 64 * 1024 * 1024;
var SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
var NEWLINE = 0x0a;

function knowledgeRoot() {
  return path.join(config.CONFIG_DIR, "knowledge");
}

function newRecordId() {
  return Date.now().toString(36) + "-" + crypto.randomBytes(6).toString("hex");
}

// A scope id is a slash-separated set of strict segments. Anything else is
// rejected outright so a caller-supplied value can never escape the root.
function scopeSegments(scopeId) {
  if (typeof scopeId !== "string" || !scopeId) throw new Error("A knowledge scope id is required.");
  var segments = scopeId.split("/");
  if (segments.length < 2 || segments.length > 4) throw new Error("Invalid knowledge scope id: " + scopeId);
  for (var i = 0; i < segments.length; i++) {
    if (!SEGMENT_PATTERN.test(segments[i])) throw new Error("Invalid knowledge scope id: " + scopeId);
  }
  return segments;
}

function createRecordStore(opts) {
  var options = opts || {};
  var scopeId = options.scopeId;
  var segments = scopeSegments(scopeId);
  var baseDir = options.baseDir || knowledgeRoot();
  var storeDir = path.join.apply(path, [baseDir].concat(segments));
  var filePath = path.join(storeDir, "records.jsonl");

  var records = [];
  var consumed = 0;
  var partial = Buffer.alloc(0);
  var skipped = 0;
  var loaded = false;

  function reset() {
    records = [];
    consumed = 0;
    partial = Buffer.alloc(0);
    skipped = 0;
  }

  function readRange(size) {
    var length = size - consumed;
    if (length <= 0) return Buffer.alloc(0);
    var buffer = Buffer.alloc(length);
    var fd = fs.openSync(filePath, "r");
    try {
      var read = fs.readSync(fd, buffer, 0, length, consumed);
      return read === length ? buffer : buffer.slice(0, read);
    } finally {
      fs.closeSync(fd);
    }
  }

  function ingest(chunk) {
    var pending = partial.length > 0 ? Buffer.concat([partial, chunk]) : chunk;
    var lastNewline = pending.lastIndexOf(NEWLINE);
    if (lastNewline === -1) {
      partial = pending;
      return;
    }
    partial = pending.slice(lastNewline + 1);
    var lines = pending.slice(0, lastNewline).toString("utf8").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        skipped++;
        continue;
      }
      if (!parsed || typeof parsed !== "object" || parsed.v !== RECORD_VERSION || !parsed.id) {
        skipped++;
        continue;
      }
      records.push(parsed);
    }
  }

  // Pick up appends made by this process and by any other process holding the
  // same file open. A shrunk file means it was truncated or replaced, so the
  // projection is rebuilt from the start.
  function refresh() {
    var stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      if (loaded && consumed === 0 && records.length === 0) return;
      reset();
      loaded = true;
      return;
    }
    if (stat.size > MAX_STORE_BYTES) throw new Error("Knowledge store is too large to load: " + scopeId);
    if (stat.size < consumed) reset();
    if (loaded && stat.size === consumed) return;
    var chunk = readRange(stat.size);
    consumed += chunk.length;
    loaded = true;
    if (chunk.length > 0) ingest(chunk);
  }

  // O_APPEND plus a single write syscall keeps a record from interleaving with
  // a concurrent writer's record. The refresh on either side keeps this
  // process's projection consistent with what actually landed on disk.
  function append(record) {
    if (!record || typeof record !== "object") throw new Error("A knowledge record object is required.");
    refresh();
    var stored = Object.assign({}, record, { v: RECORD_VERSION });
    if (!stored.id) stored.id = newRecordId();
    var buffer = Buffer.from(JSON.stringify(stored) + "\n", "utf8");
    if (buffer.indexOf(NEWLINE) !== buffer.length - 1) throw new Error("A knowledge record must serialize to a single line.");
    if (buffer.length > MAX_RECORD_BYTES) throw new Error("Knowledge record exceeds " + MAX_RECORD_BYTES + " bytes.");
    fs.mkdirSync(storeDir, { recursive: true });
    var fd = fs.openSync(filePath, "a");
    try {
      fs.writeSync(fd, buffer, 0, buffer.length);
    } finally {
      fs.closeSync(fd);
    }
    config.chmodSafe(filePath, 0o600);
    refresh();
    return stored;
  }

  // Returned for reading only. Callers project over it and must not mutate it.
  function all() {
    refresh();
    return records;
  }

  function stats() {
    refresh();
    return {
      scopeId: scopeId,
      filePath: filePath,
      records: records.length,
      skipped: skipped,
      pendingBytes: partial.length,
    };
  }

  return {
    scopeId: scopeId,
    filePath: filePath,
    append: append,
    all: all,
    stats: stats,
    refresh: refresh,
  };
}

module.exports = {
  RECORD_VERSION: RECORD_VERSION,
  MAX_RECORD_BYTES: MAX_RECORD_BYTES,
  knowledgeRoot: knowledgeRoot,
  newRecordId: newRecordId,
  scopeSegments: scopeSegments,
  createRecordStore: createRecordStore,
};
