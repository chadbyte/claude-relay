// Import-keyed projection over the Clay-wide knowledge record backend.
//
// A migration and a live write-through bridge both copy legacy content in
// repeatedly: on every restart, after a partial run, after every mutation, and
// potentially from two daemons at once. This layer makes that safe by
// addressing every imported record with a stable import key derived from the
// source, so re-importing the same source is a no-op rather than a duplicate.
//
// Change rule, applied by the caller through the key it chooses:
//   - File-addressed sources use a key derived from the file name. Re-importing
//     changed content revises the existing record, keeping the prior revision
//     and its provenance.
//   - Line-addressed sources (append-only journals) fold the line's content
//     hash into the key. An edited line is therefore a new, deterministic
//     import rather than a revision, which matches how those journals are
//     actually written.
//
// Content is never truncated. A source larger than one record is stored as
// content-addressed chunks and reassembled exactly, with the whole-source hash
// verified on read. A caller that cannot read a source back completely is told
// so rather than handed a silently partial string.

var crypto = require("crypto");
var recordStore = require("./knowledge-record-store");

var IMPORT_VERSION = 2;
// Worst-case JSON/UTF-8 expansion of an 8000 character slice stays well inside
// the record store's 64KB single-record limit.
var CHUNK_CHARS = 8000;
var MAX_CONTENT_CHARS = CHUNK_CHARS;
var MAX_NAME_CHARS = 200;
var MAX_CHUNKS = 8192;
var NUL = String.fromCharCode(0);
var CONTROL_PATTERN = new RegExp("[\\u0000-\\u001f\\u007f]+", "g");

function contentHash(value) {
  return crypto.createHash("sha256").update(String(value == null ? "" : value), "utf8").digest("hex").substring(0, 32);
}

function cleanLine(value, max) {
  if (typeof value !== "string") return "";
  var text = value.replace(CONTROL_PATTERN, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.substring(0, max) : text;
}

// Content is stored verbatim. Every character survives a JSONL round trip,
// including NUL, which JSON.stringify escapes as a six-character sequence and JSON.parse restores
// exactly; it is not a newline, so it cannot split a record either. Removing
// any character here would break reassembly against the source hash.
function exactContent(value) {
  return typeof value === "string" ? value : "";
}

function splitChunks(content) {
  var chunks = [];
  for (var offset = 0; offset < content.length; offset += CHUNK_CHARS) {
    chunks.push(content.substring(offset, offset + CHUNK_CHARS));
  }
  return chunks;
}

function chunkKey(importKey, position) {
  return importKey + "#c" + position;
}

function createKnowledgeImporter(opts) {
  var options = opts || {};
  var scopeId = options.scopeId;
  var store = recordStore.createRecordStore({ scopeId: scopeId, baseDir: options.baseDir });

  function refFor(rootId) {
    var digest = crypto.createHash("sha256").update(scopeId + NUL + String(rootId)).digest("base64url");
    return "know:" + digest.substring(0, 24);
  }

  // Incrementally maintained so importing N sources stays O(N) rather than
  // re-folding the whole scope once per source. The bridge runs on every
  // mutation and the migration on every startup, so this must stay cheap.
  var indexed = null;

  function resetIndex() {
    indexed = { byKey: new Map(), byRoot: new Map(), duplicates: 0, consumed: 0 };
  }

  function foldRecord(record) {
    if (record.op === "create" && record.importKey) {
      // First create for an import key wins. A duplicate that slipped past the
      // run lock is folded away rather than double-counted, so the projection
      // stays correct even if the lock ever fails.
      if (indexed.byKey.has(record.importKey)) {
        indexed.duplicates++;
        return;
      }
      var state = {
        importKey: record.importKey,
        rootId: record.id,
        ref: refFor(record.id),
        sourceHash: record.sourceHash || null,
        contentHash: record.contentHash || record.sourceHash || null,
        kind: record.kind || null,
        name: record.name || null,
        chunked: record.chunked === true,
        chunkCount: record.chunkCount || 0,
        deleted: false,
        revisions: 1,
        importedAt: record.at || 0,
        updatedAt: record.at || 0,
      };
      indexed.byKey.set(record.importKey, state);
      indexed.byRoot.set(record.id, state);
      return;
    }
    if (!record.rootId) return;
    var target = indexed.byRoot.get(record.rootId);
    if (!target) return;
    if (record.op === "update") {
      if (record.sourceHash) target.sourceHash = record.sourceHash;
      if (record.contentHash) target.contentHash = record.contentHash;
      if (record.kind) target.kind = record.kind;
      if (record.name) target.name = record.name;
      target.chunked = record.chunked === true;
      target.chunkCount = record.chunkCount || 0;
      // An update always asserts that this content is current, so it revives a
      // record whose source came back after a tombstone.
      target.deleted = false;
    } else if (record.op === "delete") {
      target.deleted = true;
    } else {
      return;
    }
    target.revisions++;
    target.updatedAt = record.at || target.updatedAt;
  }

  function index() {
    var records = store.all();
    if (!indexed || records.length < indexed.consumed) resetIndex();
    for (var i = indexed.consumed; i < records.length; i++) foldRecord(records[i]);
    indexed.consumed = records.length;
    return { byKey: indexed.byKey, duplicates: indexed.duplicates };
  }

  // Folded content for every live import key. Used only for reassembling a
  // chunked source, which is rare, so it is computed on demand.
  function foldContents() {
    var records = store.all();
    var byRoot = new Map();
    var byKey = new Map();
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.op === "create" && record.importKey) {
        if (byKey.has(record.importKey)) continue;
        var state = { content: record.content || "", deleted: false };
        byKey.set(record.importKey, state);
        byRoot.set(record.id, state);
        continue;
      }
      if (!record.rootId) continue;
      var target = byRoot.get(record.rootId);
      if (!target) continue;
      if (record.op === "update") {
        if (typeof record.content === "string") target.content = record.content;
        target.deleted = false;
      } else if (record.op === "delete") {
        target.deleted = true;
      }
    }
    return byKey;
  }

  // Exact reassembly. Returns complete:false rather than a partial string when
  // a chunk is missing, tombstoned, or the whole-source hash does not verify.
  function readContent(entry) {
    if (!entry) return { complete: false, content: "", reason: "not-found" };
    if (!entry.chunked) {
      // Verified on the inline path too, so "complete" means the same thing
      // whether or not a source happened to need chunking.
      var inline = entry.content || "";
      if (entry.contentHash && contentHash(inline) !== entry.contentHash) {
        return { complete: false, content: "", reason: "hash-mismatch" };
      }
      return { complete: true, content: inline };
    }
    var contents = foldContents();
    var parts = [];
    for (var i = 0; i < entry.chunkCount; i++) {
      var part = contents.get(chunkKey(entry.importKey, i));
      if (!part || part.deleted) return { complete: false, content: "", reason: "missing-chunk", chunkIndex: i };
      parts.push(part.content);
    }
    var joined = parts.join("");
    if (entry.contentHash && contentHash(joined) !== entry.contentHash) {
      return { complete: false, content: "", reason: "hash-mismatch" };
    }
    return { complete: true, content: joined };
  }

  function append(payload) {
    return store.append(payload);
  }

  // Chunks are written before the parent record. A failure partway therefore
  // leaves orphan chunks and no parent, so the source is not reported as
  // imported and the next run retries it. Chunks are content-addressed, so the
  // retry re-uses whatever already landed.
  function writeChunks(importKey, chunks, entry, at) {
    var existingIndex = index().byKey;
    for (var i = 0; i < chunks.length; i++) {
      var key = chunkKey(importKey, i);
      var hash = contentHash(chunks[i]);
      var current = existingIndex.get(key);
      if (current && !current.deleted && current.sourceHash === hash) continue;
      var base = {
        op: current ? "update" : "create",
        scope: scopeId,
        importKey: key,
        sourceHash: hash,
        contentHash: hash,
        kind: "chunk",
        name: entry.name || "",
        chunkOf: importKey,
        chunkIndex: i,
        content: chunks[i],
        importVersion: IMPORT_VERSION,
        at: at,
      };
      if (current) {
        base.rootId = current.rootId;
      } else {
        var id = recordStore.newRecordId();
        base.id = id;
        base.rootId = id;
      }
      append(base);
    }
  }

  // Import one source unit. Returns what actually happened so a migration or a
  // bridge can report truthfully instead of assuming.
  function importRecord(input) {
    var entry = input || {};
    if (!entry.importKey || typeof entry.importKey !== "string") throw new Error("An import key is required.");
    var content = exactContent(entry.content);
    // Two distinct hashes, deliberately.
    //   sourceHash  - the caller's fingerprint of the legacy source, used for
    //                 change detection and for line-addressed import keys.
    //   storedHash  - always derived here from the exact bytes being written,
    //                 so reassembly verifies against what was actually stored
    //                 rather than against something the caller asserted.
    var storedHash = contentHash(content);
    var hash = entry.sourceHash || storedHash;
    var existing = index().byKey.get(entry.importKey) || null;

    if (existing && !existing.deleted && existing.sourceHash === hash) {
      return { action: "unchanged", ref: existing.ref, importKey: entry.importKey };
    }

    var at = Number.isFinite(entry.at) ? entry.at : Date.now();
    var chunks = content.length > MAX_CONTENT_CHARS ? splitChunks(content) : null;
    if (chunks) {
      if (chunks.length > MAX_CHUNKS) {
        throw new Error("Source exceeds the maximum representable size: " + entry.importKey);
      }
      writeChunks(entry.importKey, chunks, entry, at);
    }

    var payload = {
      op: existing ? "update" : "create",
      scope: scopeId,
      importKey: entry.importKey,
      sourceHash: hash,
      contentHash: storedHash,
      kind: entry.kind || "knowledge",
      name: cleanLine(entry.name || (existing && existing.name) || "", MAX_NAME_CHARS),
      chunked: !!chunks,
      chunkCount: chunks ? chunks.length : 0,
      content: chunks ? "" : content,
      source: entry.source || null,
      actor: entry.actor || null,
      importVersion: IMPORT_VERSION,
      at: at,
    };

    if (existing) {
      payload.rootId = existing.rootId;
      append(payload);
      return { action: existing.deleted ? "revived" : "revised", ref: existing.ref, importKey: entry.importKey };
    }
    var newId = recordStore.newRecordId();
    payload.id = newId;
    payload.rootId = newId;
    append(payload);
    return { action: "created", ref: refFor(newId), importKey: entry.importKey };
  }

  // Logical removal. The record and its history stay; the projection stops
  // returning it, so a memory deleted in the legacy store is not left active
  // in the new backend.
  function removeRecord(importKey, options2) {
    var settings = options2 || {};
    var existing = index().byKey.get(importKey) || null;
    if (!existing) return { action: "absent", importKey: importKey };
    if (existing.deleted) return { action: "already-deleted", ref: existing.ref, importKey: importKey };
    append({
      rootId: existing.rootId,
      op: "delete",
      scope: scopeId,
      importKey: importKey,
      kind: existing.kind,
      name: existing.name,
      source: settings.source || null,
      actor: settings.actor || null,
      importVersion: IMPORT_VERSION,
      at: Number.isFinite(settings.at) ? settings.at : Date.now(),
    });
    return { action: "deleted", ref: existing.ref, importKey: importKey };
  }

  // Read projection. Chunk records are internal and never surface here; use
  // readContent to reassemble a chunked entry.
  function entries(options2) {
    var settings = options2 || {};
    var records = store.all();
    var byRoot = new Map();
    var byKey = new Map();
    var order = [];
    var i;
    for (i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.op !== "create" || !record.importKey) continue;
      if (byKey.has(record.importKey)) continue;
      var entry = {
        ref: refFor(record.id),
        importKey: record.importKey,
        kind: record.kind || null,
        name: record.name || null,
        content: record.content || "",
        chunked: record.chunked === true,
        chunkCount: record.chunkCount || 0,
        contentHash: record.contentHash || record.sourceHash || null,
        source: record.source || null,
        actor: record.actor || null,
        deleted: false,
        deletedAt: null,
        deletedBy: null,
        importedAt: record.at || 0,
        updatedAt: record.at || 0,
        revisions: 1,
      };
      byKey.set(record.importKey, entry);
      byRoot.set(record.id, entry);
      order.push(entry);
    }
    for (i = 0; i < records.length; i++) {
      var revision = records[i];
      if (revision.op === "create" || !revision.rootId) continue;
      var target = byRoot.get(revision.rootId);
      if (!target) continue;
      if (revision.op === "delete") {
        // Original authorship is preserved on `actor`; who removed it is
        // recorded separately so a tombstone is traceable too.
        target.deleted = true;
        target.deletedAt = revision.at || 0;
        target.deletedBy = revision.actor || null;
      } else if (revision.op === "update") {
        if (typeof revision.content === "string") target.content = revision.content;
        if (revision.name) target.name = revision.name;
        if (revision.kind) target.kind = revision.kind;
        if (revision.source) target.source = revision.source;
        if (revision.actor) target.actor = revision.actor;
        if (revision.contentHash) target.contentHash = revision.contentHash;
        target.chunked = revision.chunked === true;
        target.chunkCount = revision.chunkCount || 0;
        target.deleted = false;
        target.deletedAt = null;
        target.deletedBy = null;
      } else {
        continue;
      }
      target.updatedAt = revision.at || target.updatedAt;
      target.revisions++;
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
      if (order[i].kind === "chunk" && settings.includeChunks !== true) continue;
      if (order[i].deleted && settings.includeDeleted !== true) continue;
      out.push(order[i]);
    }
    return out;
  }

  function stats() {
    var indexedNow = index();
    var base = store.stats();
    var live = 0;
    var deleted = 0;
    var chunks = 0;
    indexedNow.byKey.forEach(function (state) {
      if (state.kind === "chunk") { chunks++; return; }
      if (state.deleted) deleted++;
      else live++;
    });
    return {
      scopeId: scopeId,
      filePath: base.filePath,
      records: base.records,
      skippedRecords: base.skipped,
      imported: live,
      deleted: deleted,
      chunks: chunks,
      duplicates: indexedNow.duplicates,
    };
  }

  return {
    scopeId: scopeId,
    filePath: store.filePath,
    index: index,
    importRecord: importRecord,
    removeRecord: removeRecord,
    readContent: readContent,
    entries: entries,
    stats: stats,
  };
}

module.exports = {
  IMPORT_VERSION: IMPORT_VERSION,
  CHUNK_CHARS: CHUNK_CHARS,
  MAX_CONTENT_CHARS: MAX_CONTENT_CHARS,
  MAX_CHUNKS: MAX_CHUNKS,
  contentHash: contentHash,
  chunkKey: chunkKey,
  splitChunks: splitChunks,
  createKnowledgeImporter: createKnowledgeImporter,
};
