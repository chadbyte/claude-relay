// Canonical snapshots and revision reconstruction for Project Logs.
//
// Split from project-logs-store.js so the store stays inside the module size
// limit and so version control has one place to live.
//
// Every NEW canonical edit stores a complete immutable snapshot of the record:
// category, priority, title, summary, body, tags, links. That makes a revision
// self-contained, so reading revision N never depends on replaying everything
// before it.
//
// Records written before snapshots existed carry only the fields that changed.
// They are never rewritten. Instead, reconstruction folds forward: a record
// with a `snapshot` replaces the state outright, and a legacy partial record
// applies its deltas onto the state built so far. Both paths produce the same
// shape, so history is deterministic across the boundary.

var logsSchema = require("./project-logs-schema");

// Ops that advance the canonical record. `comment` and a non-incorporating
// `review` are participation, not revisions, and never appear here.
var CANONICAL_OPS = ["create", "update", "link", "revert"];

var SNAPSHOT_FIELDS = ["category", "priority", "title", "summary", "body", "tags", "links"];

function emptySnapshot() {
  return {
    category: "",
    priority: logsSchema.DEFAULT_PRIORITY,
    title: "",
    summary: "",
    body: "",
    tags: [],
    links: [],
  };
}

function cloneSnapshot(snapshot) {
  var source = snapshot || {};
  return {
    category: source.category || "",
    priority: logsSchema.normalizePriority(source.priority),
    title: typeof source.title === "string" ? source.title : "",
    summary: typeof source.summary === "string" ? source.summary : "",
    body: typeof source.body === "string" ? source.body : "",
    tags: Array.isArray(source.tags) ? source.tags.slice() : [],
    links: Array.isArray(source.links) ? source.links.slice() : [],
  };
}

// True when this record carries a complete canonical snapshot.
function hasSnapshot(record) {
  return !!(record && record.snapshot && typeof record.snapshot === "object");
}

// A canonical op, including an incorporating review. A review that clarifies or
// declines resolves a comment without changing the record.
function isCanonical(record) {
  if (!record) return false;
  if (record.op === "review") return record.action === "incorporate";
  return CANONICAL_OPS.indexOf(record.op) !== -1;
}

// Apply a legacy partial record onto the running state. Only used for records
// written before snapshots; a snapshot-bearing record never takes this path.
function applyPartial(state, record, maxLinks) {
  var next = cloneSnapshot(state);
  if (record.op === "create") {
    next.category = record.kind || "";
    next.priority = logsSchema.normalizePriority(record.priority);
    next.title = typeof record.title === "string" ? record.title : "";
    next.summary = typeof record.summary === "string" ? record.summary : "";
    next.body = typeof record.body === "string" ? record.body : "";
    next.tags = Array.isArray(record.tags) ? record.tags.slice() : [];
    next.links = Array.isArray(record.links) ? record.links.slice() : [];
    return next;
  }
  if (record.op === "link") {
    var added = Array.isArray(record.links) ? record.links : [];
    for (var i = 0; i < added.length && next.links.length < maxLinks; i++) {
      var exists = false;
      for (var j = 0; j < next.links.length; j++) {
        if (next.links[j].ref === added[i].ref) { exists = true; break; }
      }
      if (!exists) next.links.push(added[i]);
    }
    return next;
  }
  if (record.kind) next.category = record.kind;
  if (record.priority) next.priority = logsSchema.normalizePriority(record.priority);
  if (typeof record.title === "string") next.title = record.title;
  if (typeof record.summary === "string") next.summary = record.summary;
  if (typeof record.body === "string") next.body = record.body;
  if (Array.isArray(record.tags)) next.tags = record.tags.slice();
  if (Array.isArray(record.links)) next.links = record.links.slice();
  return next;
}

function sameSnapshot(a, b) {
  var left = cloneSnapshot(a);
  var right = cloneSnapshot(b);
  for (var i = 0; i < SNAPSHOT_FIELDS.length; i++) {
    var field = SNAPSHOT_FIELDS[i];
    if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) return false;
  }
  return true;
}

function changedFields(previous, next) {
  var changed = [];
  if (!previous) return SNAPSHOT_FIELDS.slice();
  for (var i = 0; i < SNAPSHOT_FIELDS.length; i++) {
    var field = SNAPSHOT_FIELDS[i];
    if (JSON.stringify(previous[field]) !== JSON.stringify(next[field])) changed.push(field);
  }
  return changed;
}

// Every canonical revision of one entry, in causal order, each with the exact
// snapshot as of that revision. Deleting is a tombstone rather than a
// revision, so it is reported separately.
function revisions(chain, maxLinks) {
  var out = [];
  var state = emptySnapshot();
  var deleted = null;
  var started = false;

  for (var i = 0; i < chain.length; i++) {
    var record = chain[i];
    if (record.op === "delete") {
      if (started && !deleted) deleted = { at: record.at || 0, author: record.author || null };
      continue;
    }
    if (deleted) continue;
    if (!isCanonical(record)) continue;
    if (record.op === "create") {
      if (started) continue;
      started = true;
    } else if (!started) {
      continue;
    }

    var previous = out.length ? out[out.length - 1].snapshot : null;
    state = hasSnapshot(record) ? cloneSnapshot(record.snapshot) : applyPartial(state, record, maxLinks);
    out.push({
      revision: out.length + 1,
      op: record.op === "review" ? "incorporate" : record.op,
      at: record.at || 0,
      author: record.author || null,
      snapshot: state,
      changed: record.op === "create" ? [] : changedFields(previous, state),
      // Present only on a revert, so a reader can see where it came from.
      revertedFrom: record.revertedFrom || null,
      reason: typeof record.reason === "string" ? record.reason : null,
      // Present only on an incorporation, linking the revision to the comment
      // that prompted it.
      commentId: record.op === "review" ? (record.commentId || null) : null,
      // Whether this revision was reconstructed from a legacy partial record.
      reconstructed: !hasSnapshot(record),
      // The record that produced this revision. Internal: it exists so a
      // review can be linked to its exact revision by identity rather than by
      // matching timestamps, and describeRevision deliberately drops it so no
      // internal record id reaches a public response.
      sourceRecordId: record.id,
    });
  }
  return { revisions: out, deleted: deleted, started: started };
}

// Revision metadata without any body, for history listings and for the bounded
// timeline the detail view shows. `sourceRecordId` is intentionally not copied:
// the only identifiers a caller ever sees are the opaque entry ref and comment
// id.
function describeRevision(entry) {
  return {
    revision: entry.revision,
    op: entry.op,
    at: entry.at,
    author: entry.author,
    changed: entry.changed,
    revertedFrom: entry.revertedFrom,
    reason: entry.reason,
    commentId: entry.commentId,
    reconstructed: entry.reconstructed,
    title: entry.snapshot.title,
    category: entry.snapshot.category,
    priority: entry.snapshot.priority,
  };
}

module.exports = {
  CANONICAL_OPS: CANONICAL_OPS,
  SNAPSHOT_FIELDS: SNAPSHOT_FIELDS,
  emptySnapshot: emptySnapshot,
  cloneSnapshot: cloneSnapshot,
  hasSnapshot: hasSnapshot,
  isCanonical: isCanonical,
  applyPartial: applyPartial,
  sameSnapshot: sameSnapshot,
  changedFields: changedFields,
  revisions: revisions,
  describeRevision: describeRevision,
};
