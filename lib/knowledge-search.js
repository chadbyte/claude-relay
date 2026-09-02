// Shared BM25 adapter for Clay Knowledge surfaces.
//
// There is exactly one ranking implementation in Clay: the generic
// buildIndex/searchIndex engine in session-search.js, including its tokenizer
// with CJK/Japanese/Thai bigram segmentation. This module is a thin adapter
// over it, not a second ranker.
//
// Field weighting is expressed by controlled repetition of a field's text
// before indexing, which is how session-search.js already weights digests.
// A title repeated three times contributes three times the term frequency of
// the body, so BM25 saturation and length normalisation still apply normally.
//
// Long records are segmented rather than truncated. A record whose body runs to
// tens of thousands of characters is indexed as several overlapping documents,
// so a term that appears only near the end is still found. Short fields (title,
// name, tags) are anchors and are repeated into every segment, so weighting is
// identical in each one. Segments are collapsed back to one result per original
// item by taking its best-scoring segment; the caller still applies its own
// score, recency, and reference tie-breaks on top.

var sessionSearch = require("./session-search");

var MAX_SNIPPET_CHARS = 320;
var SNIPPET_LEAD_CHARS = 80;
// A field at or under this length is an anchor, replicated into every segment.
// Anything longer is windowed.
var SEGMENT_CHARS = 8000;
// Overlap so a term straddling a window boundary is still indexed intact.
var SEGMENT_OVERLAP = 800;
// Memory bound. A record needing more windows than this is indexed up to the
// cap; the cap is high enough that no realistic Knowledge record reaches it.
var MAX_SEGMENTS_PER_ITEM = 64;

function repeat(text, weight) {
  var out = [];
  for (var i = 0; i < weight; i++) out.push(text);
  return out.join(" ");
}

function normalizeWeight(weight) {
  return Number.isFinite(weight) ? Math.max(1, Math.floor(weight)) : 1;
}

function usableFields(fields) {
  var out = [];
  for (var i = 0; i < (fields || []).length; i++) {
    var field = fields[i];
    if (!field || typeof field.text !== "string" || !field.text) continue;
    out.push({ text: field.text, weight: normalizeWeight(field.weight) });
  }
  return out;
}

// Kept for callers and tests that want the single-document form. Anchors and
// short bodies produce exactly this text.
function weightedText(fields) {
  var parts = [];
  var usable = usableFields(fields);
  for (var i = 0; i < usable.length; i++) parts.push(repeat(usable[i].text, usable[i].weight));
  return parts.join(" ");
}

var SEGMENT_STRIDE = SEGMENT_CHARS - SEGMENT_OVERLAP;
// The maximum searchable characters of one long field that can be indexed
// before the segment cap stops coverage. Reported to callers so an incomplete
// index is stated rather than implied.
var MAX_INDEXED_CHARS = SEGMENT_CHARS + (MAX_SEGMENTS_PER_ITEM - 1) * SEGMENT_STRIDE;

// One shared plan drives both the indexed documents and the coverage report,
// so what a caller is told was indexed is exactly what was indexed.
function planSegments(fields) {
  var usable = usableFields(fields);
  var anchors = [];
  var longs = [];
  for (var i = 0; i < usable.length; i++) {
    if (usable[i].text.length > SEGMENT_CHARS) longs.push(usable[i]);
    else anchors.push(usable[i]);
  }

  var windows = [];
  var totalChars = 0;
  var indexedChars = 0;
  for (var l = 0; l < longs.length; l++) {
    var text = longs[l].text;
    totalChars += text.length;
    var covered = 0;
    for (var offset = 0; offset < text.length && windows.length < MAX_SEGMENTS_PER_ITEM; offset += SEGMENT_STRIDE) {
      var end = Math.min(text.length, offset + SEGMENT_CHARS);
      windows.push({ field: longs[l], start: offset, end: end });
      covered = end;
      if (end >= text.length) break;
    }
    indexedChars += covered;
  }
  for (var a = 0; a < anchors.length; a++) {
    totalChars += anchors[a].text.length;
    indexedChars += anchors[a].text.length;
  }

  return {
    anchors: anchors,
    longs: longs,
    windows: windows,
    totalChars: totalChars,
    indexedChars: indexedChars,
    complete: indexedChars >= totalChars,
  };
}

// How much of an item's searchable text this adapter can index. `complete` is
// false when the segment cap stopped short, which means a term appearing only
// in the uncovered tail cannot be ranked.
function coverage(fields) {
  var plan = planSegments(fields);
  return { totalChars: plan.totalChars, indexedChars: plan.indexedChars, complete: plan.complete };
}

// One item becomes one or more BM25 documents. Short fields anchor every
// segment so title and tag weighting is consistent wherever the body matched.
function segmentTexts(fields) {
  var plan = planSegments(fields);
  var anchorText = weightedText(plan.anchors);
  if (plan.windows.length === 0) return [anchorText];

  var texts = [];
  for (var w = 0; w < plan.windows.length; w++) {
    var window = plan.windows[w];
    var body = repeat(window.field.text.substring(window.start, window.end), window.field.weight);
    texts.push(anchorText ? anchorText + " " + body : body);
  }
  return texts;
}

// Build the generic {id, text, meta} documents the shared engine expects.
// project(item, position) must return { id, fields, meta }. One item may yield
// several documents; each carries the item's position so results collapse back.
function buildDocs(items, project) {
  var docs = [];
  for (var i = 0; i < (items || []).length; i++) {
    var projected = project(items[i], i);
    if (!projected) continue;
    var texts = segmentTexts(projected.fields);
    for (var s = 0; s < texts.length; s++) {
      docs.push({
        id: projected.id,
        text: texts[s],
        meta: { position: i, segment: s, id: projected.id, meta: projected.meta },
      });
    }
  }
  return docs;
}

// Rank with the shared engine. Returns [{ id, score, meta }] highest first, one
// entry per original item. A query that tokenizes to nothing scores nothing,
// rather than silently falling back to a different matching strategy.
//
// Aggregation across an item's segments is the maximum segment score: a record
// is as relevant as its best-matching part, so a long record is neither
// penalised for its unmatched bulk nor rewarded for repeating a term across
// windows that overlap.
function rank(items, query, project, maxResults) {
  var docs = buildDocs(items, project);
  if (docs.length === 0) return [];
  var index = sessionSearch.buildIndex(docs);
  var scored = sessionSearch.searchIndex(index, query, docs.length);

  var bestByPosition = new Map();
  for (var i = 0; i < scored.length; i++) {
    var envelope = scored[i].meta;
    if (!envelope) continue;
    var existing = bestByPosition.get(envelope.position);
    if (existing && existing.score >= scored[i].score) continue;
    bestByPosition.set(envelope.position, { id: envelope.id, score: scored[i].score, meta: envelope.meta });
  }

  var collapsed = [];
  bestByPosition.forEach(function (entry) { collapsed.push(entry); });
  // Stable, deterministic ordering before the caller applies its own
  // recency and reference tie-breaks.
  collapsed.sort(function (a, b) {
    return b.score - a.score || String(a.id).localeCompare(String(b.id));
  });
  var limit = maxResults || collapsed.length;
  return collapsed.slice(0, limit);
}

// A snippet centred on the first query term that appears in the text, so the
// excerpt shows why the document matched rather than just its opening. Works
// across the whole record, not only its first segment.
function snippet(text, query, maxChars) {
  if (typeof text !== "string" || !text) return "";
  var limit = maxChars || MAX_SNIPPET_CHARS;
  var haystack = text.toLowerCase();
  var tokens = sessionSearch.tokenize(query || "");
  var best = -1;
  for (var i = 0; i < tokens.length; i++) {
    var at = haystack.indexOf(tokens[i]);
    if (at !== -1 && (best === -1 || at < best)) best = at;
  }
  if (best === -1) {
    var raw = (query || "").trim().toLowerCase();
    if (raw) best = haystack.indexOf(raw);
  }
  var start = best === -1 ? 0 : Math.max(0, best - SNIPPET_LEAD_CHARS);
  return text.substring(start, start + limit);
}

module.exports = {
  MAX_SNIPPET_CHARS: MAX_SNIPPET_CHARS,
  SEGMENT_CHARS: SEGMENT_CHARS,
  SEGMENT_OVERLAP: SEGMENT_OVERLAP,
  SEGMENT_STRIDE: SEGMENT_STRIDE,
  MAX_SEGMENTS_PER_ITEM: MAX_SEGMENTS_PER_ITEM,
  MAX_INDEXED_CHARS: MAX_INDEXED_CHARS,
  tokenize: sessionSearch.tokenize,
  weightedText: weightedText,
  planSegments: planSegments,
  coverage: coverage,
  segmentTexts: segmentTexts,
  buildDocs: buildDocs,
  rank: rank,
  snippet: snippet,
};
