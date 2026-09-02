// Query, ranking, and pagination for Project Logs.
//
// Extracted from project-logs-store.js so the store stays focused on records
// and stays inside the module size limit. Ranking uses the shared BM25 adapter,
// which wraps Clay's single ranking engine; the response shapes, filters,
// pagination, and tie-breaks are exactly what the store returned before.

var knowledgeSearch = require("./knowledge-search");

var MAX_PAGE = 50;
var DEFAULT_PAGE = 20;
var MAX_SNIPPET_CHARS = 320;

// Title and tags outrank body text, expressed as repetition for BM25.
var TITLE_WEIGHT = 3;
var TAG_WEIGHT = 2;
var BODY_WEIGHT = 1;

function parseLimit(value) {
  var limit = Number(value);
  if (!Number.isFinite(limit)) limit = DEFAULT_PAGE;
  return Math.max(1, Math.min(MAX_PAGE, Math.floor(limit)));
}

function encodeCursor(offset) {
  return offset > 0 ? Buffer.from(String(offset), "utf8").toString("base64url") : null;
}

function decodeCursor(value) {
  if (!value) return 0;
  try {
    var parsed = Number(Buffer.from(String(value), "base64url").toString("utf8"));
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch (e) {
    return 0;
  }
}

function page(items, args) {
  var offset = decodeCursor(args && args.cursor);
  var limit = parseLimit(args && args.limit);
  return {
    items: items.slice(offset, offset + limit),
    nextCursor: offset + limit < items.length ? encodeCursor(offset + limit) : null,
    total: items.length,
  };
}

function listEntries(entries, args, cleanLine, validateKind) {
  var options = args || {};
  var kind = options.kind ? validateKind(options.kind, null) : null;
  var tag = options.tag ? cleanLine(String(options.tag), 40).toLowerCase() : null;
  var filtered = entries.filter(function (entry) {
    if (kind && entry.kind !== kind) return false;
    if (tag && entry.tags.indexOf(tag) === -1) return false;
    return true;
  });
  var result = page(filtered, options);
  return { entries: result.items, nextCursor: result.nextCursor, total: result.total };
}

function projectEntry(entry) {
  return {
    id: entry.ref,
    fields: [
      { text: entry.title, weight: TITLE_WEIGHT },
      { text: (entry.tags || []).join(" "), weight: TAG_WEIGHT },
      { text: entry.body, weight: BODY_WEIGHT },
    ],
    meta: entry,
  };
}

function searchEntries(entries, args, cleanLine, validateKind) {
  var options = args || {};
  var query = cleanLine(options.query || "", 200);
  if (!query) throw new Error("A search query is required.");
  var kind = options.kind ? validateKind(options.kind, null) : null;
  var candidates = entries.filter(function (entry) {
    return !kind || entry.kind === kind;
  });

  var ranked = knowledgeSearch.rank(candidates, query, projectEntry, candidates.length);
  var hits = [];
  for (var i = 0; i < ranked.length; i++) {
    var entry = ranked[i].meta;
    hits.push({
      ref: entry.ref,
      kind: entry.kind,
      title: entry.title,
      tags: entry.tags,
      score: ranked[i].score,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
      snippet: cleanLine(knowledgeSearch.snippet(entry.body, query, MAX_SNIPPET_CHARS), MAX_SNIPPET_CHARS),
    });
  }
  // Deterministic ordering: score, then most recent, then a stable ref.
  hits.sort(function (a, b) {
    return b.score - a.score || b.updatedAt - a.updatedAt || a.ref.localeCompare(b.ref);
  });
  var result = page(hits, options);
  return { results: result.items, nextCursor: result.nextCursor, total: result.total };
}

module.exports = {
  MAX_PAGE: MAX_PAGE,
  DEFAULT_PAGE: DEFAULT_PAGE,
  MAX_SNIPPET_CHARS: MAX_SNIPPET_CHARS,
  TITLE_WEIGHT: TITLE_WEIGHT,
  TAG_WEIGHT: TAG_WEIGHT,
  BODY_WEIGHT: BODY_WEIGHT,
  parseLimit: parseLimit,
  encodeCursor: encodeCursor,
  decodeCursor: decodeCursor,
  page: page,
  listEntries: listEntries,
  searchEntries: searchEntries,
};
