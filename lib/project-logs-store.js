// Project Logs projection over the Clay-wide knowledge record backend.
//
// Project Logs are dry, factual project records: decisions, investigations,
// session notes, runbooks, references, incidents, and progress. They carry no
// persona and no autobiographical memory; that separation is a product rule,
// not a storage detail, so nothing here writes identity-shaped content.
//
// A worktree shares its parent project's Logs. The store root is resolved
// through Git's common directory, so a worktree session and a parent session
// read and write the same record file instead of forking project knowledge.

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var execFileSync = require("child_process").execFileSync;
var utils = require("./utils");
var recordStore = require("./knowledge-record-store");
var logsQuery = require("./project-logs-query");

var LOG_KINDS = ["decision", "investigation", "session-note", "runbook", "reference", "incident", "progress"];
var MAX_TITLE_CHARS = 200;
var MAX_BODY_CHARS = 20000;
var MAX_TAGS = 12;
var MAX_TAG_CHARS = 40;
var MAX_LINKS = 20;
var MAX_LINK_CHARS = 200;
var MAX_PAGE = logsQuery.MAX_PAGE;
var REF_PATTERN = /^log:[A-Za-z0-9_-]{24}$/;

var _rootCache = new Map();

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  var text = value.replace(/\u0000/g, "").trim();
  return text.length > max ? text.substring(0, max) : text;
}

function cleanLine(value, max) {
  return cleanText(value, max).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

var page = logsQuery.page;

function defaultGit(cwd, args) {
  return execFileSync("git", args, {
    cwd: cwd,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// Symlinked paths must collapse to one identity. Git reports a worktree's
// common directory in real terms while a project path may arrive symlinked
// (/var vs /private/var on macOS), and two spellings of one root would fork
// the Logs, which is precisely what worktree sharing exists to prevent.
function canonicalPath(value) {
  var resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch (e) {
    return resolved;
  }
}

// A worktree's common directory points at the parent checkout's .git, so its
// parent working tree is that directory's parent. Anything that is not an
// ordinary .git directory (bare-backed worktrees, non-Git folders) falls back
// to the path itself rather than guessing.
function resolveProjectRoot(cwd, runGit) {
  var resolved = canonicalPath(cwd);
  if (!runGit && _rootCache.has(resolved)) return _rootCache.get(resolved);
  var root = resolved;
  try {
    var commonDir = (runGit || defaultGit)(resolved, ["rev-parse", "--git-common-dir"]);
    var absoluteCommon = path.resolve(resolved, String(commonDir || "").trim());
    if (path.basename(absoluteCommon) === ".git") {
      var parent = path.dirname(absoluteCommon);
      if (fs.statSync(parent).isDirectory()) root = canonicalPath(parent);
    }
  } catch (e) {
    root = resolved;
  }
  if (!runGit) _rootCache.set(resolved, root);
  return root;
}

function scopeIdForRoot(root) {
  return "project/" + utils.encodeCwd(root);
}

function normalizeAuthor(author) {
  var source = author || {};
  var type = source.type === "user" ? "user" : "session";
  return {
    type: type,
    userId: source.userId ? cleanLine(String(source.userId), 120) : null,
    displayName: cleanLine(source.displayName || "", 120) || null,
    sessionKey: source.sessionKey ? cleanLine(String(source.sessionKey), 200) : null,
    vendor: cleanLine(source.vendor || "", 40) || null,
  };
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  var out = [];
  for (var i = 0; i < tags.length && out.length < MAX_TAGS; i++) {
    var tag = cleanLine(String(tags[i] == null ? "" : tags[i]), MAX_TAG_CHARS).toLowerCase();
    if (tag && out.indexOf(tag) === -1) out.push(tag);
  }
  return out;
}

function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  var out = [];
  for (var i = 0; i < links.length && out.length < MAX_LINKS; i++) {
    var raw = links[i];
    var value = typeof raw === "string" ? { ref: raw } : (raw || {});
    var ref = cleanLine(String(value.ref || value.sessionRef || ""), MAX_LINK_CHARS);
    if (!ref) continue;
    var label = cleanLine(value.label || "", MAX_LINK_CHARS) || null;
    var duplicate = false;
    for (var j = 0; j < out.length; j++) {
      if (out[j].ref === ref) { duplicate = true; break; }
    }
    if (!duplicate) out.push({ ref: ref, label: label });
  }
  return out;
}

function validateKind(kind, fallback) {
  var value = cleanLine(kind || "", 40);
  if (!value) return fallback || null;
  if (LOG_KINDS.indexOf(value) === -1) throw new Error("Unknown log kind: " + value);
  return value;
}

function createProjectLogsStore(opts) {
  var options = opts || {};
  var root = options.root ? path.resolve(options.root) : resolveProjectRoot(options.cwd, options.runGit);
  var scopeId = scopeIdForRoot(root);
  var store = recordStore.createRecordStore({ scopeId: scopeId, baseDir: options.baseDir });

  // Stable across every revision of an entry: derived from the scope and the
  // chain root, never from a path or an internal record id.
  function refFor(rootId) {
    var digest = crypto.createHash("sha256").update(scopeId + "\u0000" + String(rootId)).digest("base64url");
    return "log:" + digest.substring(0, 24);
  }

  // File order is causal order. Wall-clock timestamps are recorded but never
  // used to order a chain, so a skewed clock cannot reorder a revision.
  function chains() {
    var records = store.all();
    var byRoot = new Map();
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      var rootId = record.rootId || record.id;
      if (!byRoot.has(rootId)) byRoot.set(rootId, []);
      byRoot.get(rootId).push(record);
    }
    return byRoot;
  }

  function fold(rootId, chain) {
    var entry = null;
    for (var i = 0; i < chain.length; i++) {
      var record = chain[i];
      if (record.op === "create") {
        if (entry) continue;
        // A create record that does not carry the minimum a log entry needs is
        // not a log entry. Hand-edited files and lines that were completed
        // after a torn write can look structurally valid without being usable.
        if (LOG_KINDS.indexOf(record.kind) === -1) continue;
        if (typeof record.title !== "string" || !record.title.trim()) continue;
        entry = {
          ref: refFor(rootId),
          kind: record.kind,
          title: record.title || "",
          body: record.body || "",
          tags: Array.isArray(record.tags) ? record.tags.slice() : [],
          links: Array.isArray(record.links) ? record.links.slice() : [],
          createdAt: record.at || 0,
          createdBy: record.author || null,
          updatedAt: record.at || 0,
          updatedBy: record.author || null,
          revisions: 1,
          deleted: false,
          deletedAt: null,
          deletedBy: null,
        };
        continue;
      }
      if (!entry || entry.deleted) continue;
      if (record.op === "update") {
        if (record.kind) entry.kind = record.kind;
        if (typeof record.title === "string") entry.title = record.title;
        if (typeof record.body === "string") entry.body = record.body;
        if (Array.isArray(record.tags)) entry.tags = record.tags.slice();
      } else if (record.op === "link") {
        var added = Array.isArray(record.links) ? record.links : [];
        for (var j = 0; j < added.length && entry.links.length < MAX_LINKS; j++) {
          var exists = false;
          for (var k = 0; k < entry.links.length; k++) {
            if (entry.links[k].ref === added[j].ref) { exists = true; break; }
          }
          if (!exists) entry.links.push(added[j]);
        }
      } else if (record.op === "delete") {
        entry.deleted = true;
        entry.deletedAt = record.at || 0;
        entry.deletedBy = record.author || null;
      } else {
        continue;
      }
      entry.revisions++;
      entry.updatedAt = record.at || entry.updatedAt;
      entry.updatedBy = record.author || entry.updatedBy;
    }
    return entry;
  }

  function entries(includeDeleted) {
    var out = [];
    chains().forEach(function (chain, rootId) {
      var entry = fold(rootId, chain);
      if (!entry) return;
      if (entry.deleted && !includeDeleted) return;
      out.push(entry);
    });
    out.sort(function (a, b) { return b.updatedAt - a.updatedAt || a.ref.localeCompare(b.ref); });
    return out;
  }

  function findChain(ref) {
    if (typeof ref !== "string" || !REF_PATTERN.test(ref)) return null;
    var found = null;
    chains().forEach(function (chain, rootId) {
      if (found) return;
      if (refFor(rootId) === ref) found = { rootId: rootId, chain: chain };
    });
    return found;
  }

  function read(ref, includeDeleted) {
    var located = findChain(ref);
    if (!located) return null;
    var entry = fold(located.rootId, located.chain);
    if (!entry) return null;
    if (entry.deleted && !includeDeleted) return null;
    return entry;
  }

  function requireLive(ref) {
    var located = findChain(ref);
    if (!located) throw new Error("Log entry not found.");
    var entry = fold(located.rootId, located.chain);
    if (!entry || entry.deleted) throw new Error("Log entry not found.");
    return located;
  }

  function create(input, author) {
    var data = input || {};
    var kind = validateKind(data.kind, null);
    if (!kind) throw new Error("A log kind is required: " + LOG_KINDS.join(", "));
    var title = cleanLine(data.title || "", MAX_TITLE_CHARS);
    if (!title) throw new Error("A log title is required.");
    var id = recordStore.newRecordId();
    store.append({
      id: id,
      rootId: id,
      op: "create",
      scope: scopeId,
      kind: kind,
      title: title,
      body: cleanText(data.body || "", MAX_BODY_CHARS),
      tags: normalizeTags(data.tags),
      links: normalizeLinks(data.links),
      author: normalizeAuthor(author),
      at: Date.now(),
    });
    return read(refFor(id), false);
  }

  function update(ref, changes, author) {
    var located = requireLive(ref);
    var data = changes || {};
    var record = {
      id: recordStore.newRecordId(),
      rootId: located.rootId,
      op: "update",
      scope: scopeId,
      author: normalizeAuthor(author),
      at: Date.now(),
    };
    var changed = false;
    if (data.kind !== undefined) { record.kind = validateKind(data.kind, null); changed = !!record.kind; }
    if (data.title !== undefined) {
      record.title = cleanLine(data.title || "", MAX_TITLE_CHARS);
      if (!record.title) throw new Error("A log title cannot be emptied.");
      changed = true;
    }
    if (data.body !== undefined) { record.body = cleanText(data.body || "", MAX_BODY_CHARS); changed = true; }
    if (data.tags !== undefined) { record.tags = normalizeTags(data.tags); changed = true; }
    if (!changed) throw new Error("An update requires at least one changed field.");
    store.append(record);
    return read(ref, false);
  }

  function link(ref, links, author) {
    var located = requireLive(ref);
    var normalized = normalizeLinks(links);
    if (normalized.length === 0) throw new Error("At least one link reference is required.");
    store.append({
      id: recordStore.newRecordId(),
      rootId: located.rootId,
      op: "link",
      scope: scopeId,
      links: normalized,
      author: normalizeAuthor(author),
      at: Date.now(),
    });
    return read(ref, false);
  }

  function remove(ref, author) {
    var located = requireLive(ref);
    store.append({
      id: recordStore.newRecordId(),
      rootId: located.rootId,
      op: "delete",
      scope: scopeId,
      author: normalizeAuthor(author),
      at: Date.now(),
    });
    return read(ref, true);
  }

  // Filtering, ranking, and pagination live in project-logs-query.js so this
  // module stays focused on records. Ranking is the shared BM25 engine.
  function list(args) {
    var options2 = args || {};
    return logsQuery.listEntries(entries(options2.includeDeleted === true), options2, cleanLine, validateKind);
  }

  function search(args) {
    return logsQuery.searchEntries(entries(false), args || {}, cleanLine, validateKind);
  }

  // The blame view: every revision in causal order with its author, without
  // exposing internal record ids.
  function history(ref, args) {
    var located = findChain(ref);
    if (!located) throw new Error("Log entry not found.");
    var revisions = [];
    for (var i = 0; i < located.chain.length; i++) {
      var record = located.chain[i];
      if (["create", "update", "link", "delete"].indexOf(record.op) === -1) continue;
      var changed = [];
      if (record.op === "update") {
        if (record.kind !== undefined) changed.push("kind");
        if (record.title !== undefined) changed.push("title");
        if (record.body !== undefined) changed.push("body");
        if (record.tags !== undefined) changed.push("tags");
      } else if (record.op === "link") {
        changed.push("links");
      }
      revisions.push({
        revision: revisions.length + 1,
        op: record.op,
        at: record.at || 0,
        author: record.author || null,
        changed: changed,
      });
    }
    var result = page(revisions, args || {});
    return { ref: ref, revisions: result.items, nextCursor: result.nextCursor, total: result.total };
  }

  function stats() {
    var base = store.stats();
    return {
      root: root,
      scopeId: scopeId,
      filePath: base.filePath,
      records: base.records,
      skippedRecords: base.skipped,
      entries: entries(false).length,
    };
  }

  return {
    root: root,
    scopeId: scopeId,
    filePath: store.filePath,
    create: create,
    update: update,
    link: link,
    remove: remove,
    read: read,
    list: list,
    search: search,
    history: history,
    stats: stats,
  };
}

module.exports = {
  LOG_KINDS: LOG_KINDS,
  MAX_TITLE_CHARS: MAX_TITLE_CHARS,
  MAX_BODY_CHARS: MAX_BODY_CHARS,
  MAX_PAGE: MAX_PAGE,
  REF_PATTERN: REF_PATTERN,
  resolveProjectRoot: resolveProjectRoot,
  scopeIdForRoot: scopeIdForRoot,
  createProjectLogsStore: createProjectLogsStore,
};
