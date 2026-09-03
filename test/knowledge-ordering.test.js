// Locale-independent ordering for opaque Knowledge ids and refs.
//
// Knowledge refs and ranked ids are base64url, so they contain both "-" (0x2D)
// and "_" (0x5F). ICU collation orders those two the other way round from UTF-16
// code units and varies with the runtime's locale data, so using localeCompare
// as the deterministic tie-break made otherwise-tied results reorder across
// machines. These tests pin the code-unit contract.
//
// Nothing here computes an expected order with localeCompare, and no test
// returns early: every assertion runs on every invocation.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

var knowledgeSearch = require("../lib/knowledge-search");
var attachService = require("../lib/mate-knowledge-service").attachMateKnowledgeService;
var mateSync = require("../lib/mate-knowledge-sync");

// The contract, written out independently of the implementation under test.
function codeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- the comparator itself ------------------------------------------------

test("compareIds is UTF-16 code-unit order and disagrees with localeCompare", function () {
  // The exact characters that make base64url identifiers collation-sensitive.
  assert.equal("-".charCodeAt(0), 45);
  assert.equal("_".charCodeAt(0), 95);

  var dash = "know:-AAAAAAAAAAAAAAAAAAAAAA";
  var under = "know:_AAAAAAAAAAAAAAAAAAAAAA";

  assert.equal(knowledgeSearch.compareIds(dash, under), -1, "\"-\" sorts before \"_\"");
  assert.equal(knowledgeSearch.compareIds(under, dash), 1);
  assert.equal(knowledgeSearch.compareIds(dash, dash), 0);

  // The defect, demonstrated rather than asserted from memory. If a future
  // runtime ever agreed with code units this assertion would fail loudly, which
  // is the correct signal that the regression tests below stopped discriminating.
  assert.equal(under.localeCompare(dash), -1, "localeCompare orders \"_\" first");
  assert.notEqual(
    Math.sign(under.localeCompare(dash)),
    Math.sign(knowledgeSearch.compareIds(under, dash)),
    "the two orderings genuinely disagree on this pair"
  );

  // Equivalent to plain Array#sort, which is the documented ordering.
  var mixed = [under, dash];
  assert.deepEqual(mixed.slice().sort(knowledgeSearch.compareIds), [dash, under]);
  assert.deepEqual(mixed.slice().sort(), [dash, under]);
  assert.deepEqual(mixed.slice().sort(knowledgeSearch.compareIds), mixed.slice().sort());
});

test("compareIds converts deterministically before comparing", function () {
  assert.equal(knowledgeSearch.compareIds(10, 9), -1, "numbers compare as their string forms");
  assert.equal(knowledgeSearch.compareIds("a", "a"), 0);
  assert.equal(knowledgeSearch.compareIds(null, "null"), 0);
  assert.equal(knowledgeSearch.compareIds(undefined, "undefined"), 0);
  // Total order: antisymmetric and transitive over a mixed alphabet.
  var ids = ["a-1", "a_1", "a01", "aA1", "b-0", "_x", "-x", "0x"];
  var sorted = ids.slice().sort(knowledgeSearch.compareIds);
  assert.deepEqual(sorted, ids.slice().sort(), "matches default lexical order");
  for (var i = 0; i < ids.length; i++) {
    for (var j = 0; j < ids.length; j++) {
      assert.equal(
        Math.sign(knowledgeSearch.compareIds(ids[i], ids[j])),
        Math.sign(-knowledgeSearch.compareIds(ids[j], ids[i])) || 0,
        "antisymmetric for " + ids[i] + " / " + ids[j]
      );
    }
  }
});

// --- knowledge-search collapsed segment ordering --------------------------

// rank() lets the caller choose ids outright, so the "-" versus "_" case is
// exercised directly here rather than left to whatever refs happen to be minted.
function rankWithIds(ids, text) {
  var items = ids.map(function (id) { return { id: id, text: text }; });
  return knowledgeSearch.rank(items, "shared", function (item) {
    return { id: item.id, fields: [{ text: item.text, weight: 1 }], meta: item };
  }, items.length);
}

test("collapsed segment ranking breaks score ties by code-unit id order", function () {
  // Identical text means identical BM25 scores, so the id tie-break decides
  // the whole order.
  var ids = [
    "know:_zzzzzzzzzzzzzzzzzzzzzz",
    "know:-aaaaaaaaaaaaaaaaaaaaaa",
    "know:_aaaaaaaaaaaaaaaaaaaaaa",
    "know:-zzzzzzzzzzzzzzzzzzzzzz",
    "know:0aaaaaaaaaaaaaaaaaaaaaa",
  ];
  var ranked = rankWithIds(ids, "shared shared content");
  assert.equal(ranked.length, ids.length, "one result per item");

  var scores = ranked.map(function (hit) { return hit.score; });
  assert.equal(new Set(scores).size, 1, "the fixture really is fully tied on score");

  var got = ranked.map(function (hit) { return hit.id; });
  assert.deepEqual(got, ids.slice().sort(codeUnit), "ties resolve in code-unit order");
  assert.deepEqual(got, ids.slice().sort(), "which is default lexical order");
  assert.equal(got[0], "know:-aaaaaaaaaaaaaaaaaaaaaa", "\"-\" leads");
  assert.equal(got[got.length - 1], "know:_zzzzzzzzzzzzzzzzzzzzzz", "\"_\" trails");

  // Repeating the call is stable.
  assert.deepEqual(rankWithIds(ids, "shared shared content").map(function (h) { return h.id; }), got);
  // Input order must not leak into the result.
  assert.deepEqual(rankWithIds(ids.slice().reverse(), "shared shared content").map(function (h) { return h.id; }), got);
});

test("score still outranks the id tie-break", function () {
  var items = [
    { id: "know:_strong", text: "shared shared shared shared" },
    { id: "know:-weak", text: "shared unrelated filler words here" },
  ];
  var ranked = knowledgeSearch.rank(items, "shared", function (item) {
    return { id: item.id, fields: [{ text: item.text, weight: 1 }], meta: item };
  }, 10);
  assert.ok(ranked[0].score > ranked[1].score, "the fixture separates the scores");
  assert.equal(ranked[0].id, "know:_strong", "a better score wins despite losing the id order");
});

// --- Mate Knowledge list and search ordering ------------------------------

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clay-ko-" + label + "-"));
}

// One .jsonl line becomes one Knowledge record. The fixture freezes Date.now
// while importing so every record has the same updatedAt and the service-level
// ref tie-break is exercised deterministically, independent of machine load.
var RECORD_COUNT = 260;

function buildWorkspace() {
  var home = tmp("ws");
  var baseDir = path.join(home, "knowledge");
  var mateDir = path.join(home, "mates", "alice", "mate_ord");
  var lines = [];
  for (var i = 0; i < RECORD_COUNT; i++) {
    lines.push(JSON.stringify({
      date: "2026-05-01",
      topic: "topic " + i,
      summary: "shared marker text for ordering record " + i,
    }));
  }
  fs.mkdirSync(path.join(mateDir, "knowledge"), { recursive: true });
  fs.writeFileSync(path.join(mateDir, "knowledge", "digests.jsonl"), lines.join("\n") + "\n");
  var realNow = Date.now;
  Date.now = function () { return 1770000000000; };
  try {
    mateSync.reconcileMate({ mateDir: mateDir, baseDir: baseDir, actor: { type: "migration" } });
  } finally {
    Date.now = realNow;
  }

  var session = { localId: 1, cliSessionId: "cli-ord", ownerId: "alice" };
  var manager = { sessions: new Map([[1, session]]) };
  var status = { slug: "mate-ord", path: mateDir, projectOwnerId: "alice", isMate: true, mateId: "mate_ord" };
  var projects = new Map([["mate-ord", {
    getStatus: function () { return status; },
    getSessionManager: function () { return manager; },
  }]]);
  var mate = { id: "mate_ord", name: "Ord", createdBy: "alice", builtinKey: null, dir: mateDir };

  var service = attachService({
    baseDir: baseDir,
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    resolveMate: function (userId, mateId) {
      return mateId === "mate_ord" && userId === "alice" ? mate : null;
    },
    listMates: function (userId) { return userId === "alice" ? [mate] : []; },
  });

  function bindFor(boundSession) {
    return service.bind({
      projectSlug: "mate-ord",
      projectOwnerId: "alice",
      isMate: true,
      mateId: "mate_ord",
      session: boundSession,
    });
  }
  return { bound: bindFor(session), bindFor: bindFor, session: session, baseDir: baseDir, manager: manager };
}

// Equivalent to deepEqual for arrays of strings, but reports the first
// divergence instead of asking Node to render a diff of hundreds of refs, which
// takes minutes and is unreadable when it finally appears.
function assertSameOrder(actual, expected, label) {
  assert.equal(actual.length, expected.length, label + ": length differs");
  for (var i = 0; i < actual.length; i++) {
    if (actual[i] === expected[i]) continue;
    assert.fail(label + ": first divergence at index " + i
      + " (got " + actual[i] + ", expected " + expected[i] + ")");
  }
}

// Reads every page, so pagination boundaries are part of the order under test.
function drain(call, pageSize) {
  var out = [];
  var cursor = null;
  var guard = 0;
  do {
    var args = { limit: pageSize };
    if (cursor) args.cursor = cursor;
    var page = call(args);
    out.push(page);
    cursor = page.nextCursor;
    guard++;
    assert.ok(guard < 100, "pagination terminates");
  } while (cursor);
  return out;
}

test("Mate Knowledge list orders by updatedAt desc then code-unit ref", function () {
  var ws = buildWorkspace();
  var pages = drain(function (args) { return ws.bound.listKnowledge(args); }, 50);
  var entries = [];
  for (var p = 0; p < pages.length; p++) entries = entries.concat(pages[p].entries);
  assert.equal(entries.length, RECORD_COUNT, "every record is paged through exactly once");
  assert.equal(pages[0].total, RECORD_COUNT);

  var refs = entries.map(function (entry) { return entry.ref; });
  assert.equal(new Set(refs).size, RECORD_COUNT, "refs are unique");

  // The documented total order, computed here without localeCompare.
  var expected = entries.slice().sort(function (a, b) {
    return b.updatedAt - a.updatedAt || codeUnit(a.ref, b.ref);
  }).map(function (entry) { return entry.ref; });
  assertSameOrder(refs, expected, "the paged sequence matches the documented total order");

  // The frozen import clock makes the tie explicit rather than statistical.
  var byStamp = {};
  for (var i = 0; i < entries.length; i++) {
    var stamp = entries[i].updatedAt;
    if (!byStamp[stamp]) byStamp[stamp] = [];
    byStamp[stamp].push(entries[i].ref);
  }
  var tied = Object.keys(byStamp).filter(function (k) { return byStamp[k].length > 1; });
  assert.equal(tied.length, 1, "the fixture creates one exact timestamp tie group");
  assert.equal(byStamp[tied[0]].length, RECORD_COUNT, "every record participates in the tie-break");
  for (var g = 0; g < tied.length; g++) {
    assertSameOrder(byStamp[tied[g]], byStamp[tied[g]].slice().sort(codeUnit), "tied group in code-unit order");
    assertSameOrder(byStamp[tied[g]], byStamp[tied[g]].slice().sort(), "tied group in default lexical order");
  }

  // Repeating the whole traversal is stable.
  var again = [];
  var repeatPages = drain(function (args) { return ws.bound.listKnowledge(args); }, 50);
  for (var r = 0; r < repeatPages.length; r++) again = again.concat(repeatPages[r].entries);
  assertSameOrder(again.map(function (entry) { return entry.ref; }), refs, "repeated calls return the same order");

  // A different page size must not change the sequence, only where it splits.
  var small = [];
  var smallPages = drain(function (args) { return ws.bound.listKnowledge(args); }, 7);
  for (var s = 0; s < smallPages.length; s++) small = small.concat(smallPages[s].entries);
  assertSameOrder(small.map(function (entry) { return entry.ref; }), refs, "pagination boundaries do not perturb the order");
  assert.ok(smallPages.length > pages.length, "the smaller page size really did split more often");
});

test("Mate Knowledge search orders by score desc, updatedAt desc, then code-unit ref", function () {
  var ws = buildWorkspace();
  var pages = drain(function (args) {
    return ws.bound.searchKnowledge(Object.assign({ query: "shared marker" }, args));
  }, 50);
  var hits = [];
  for (var p = 0; p < pages.length; p++) hits = hits.concat(pages[p].results);
  assert.equal(hits.length, RECORD_COUNT, "every matching record is paged through");

  var refs = hits.map(function (hit) { return hit.ref; });
  assert.equal(new Set(refs).size, RECORD_COUNT);

  var expected = hits.slice().sort(function (a, b) {
    return b.score - a.score || b.updatedAt - a.updatedAt || codeUnit(a.ref, b.ref);
  }).map(function (hit) { return hit.ref; });
  assert.deepEqual(refs, expected, "the paged sequence matches the documented total order");

  // Score ties are what the ref tie-break exists for.
  var byScore = {};
  for (var i = 0; i < hits.length; i++) {
    var key = String(hits[i].score) + "|" + String(hits[i].updatedAt);
    if (!byScore[key]) byScore[key] = [];
    byScore[key].push(hits[i].ref);
  }
  var tiedKeys = Object.keys(byScore).filter(function (k) { return byScore[k].length > 1; });
  assert.ok(tiedKeys.length > 0, "identical text produces score ties");
  for (var g = 0; g < tiedKeys.length; g++) {
    assertSameOrder(byScore[tiedKeys[g]], byScore[tiedKeys[g]].slice().sort(codeUnit), "tied score group in code-unit order");
    assertSameOrder(byScore[tiedKeys[g]], byScore[tiedKeys[g]].slice().sort(), "tied score group in default lexical order");
  }

  var repeated = [];
  var repeatPages = drain(function (args) {
    return ws.bound.searchKnowledge(Object.assign({ query: "shared marker" }, args));
  }, 13);
  for (var r = 0; r < repeatPages.length; r++) repeated = repeated.concat(repeatPages[r].results);
  assertSameOrder(repeated.map(function (hit) { return hit.ref; }), refs, "stable across page sizes and calls");
});

// --- nothing else moved ---------------------------------------------------

test("ordering change preserves result shapes and coverage semantics", function () {
  var ws = buildWorkspace();
  var listed = ws.bound.listKnowledge({ limit: 5 });
  assert.deepEqual(Object.keys(listed).sort(), ["degraded", "degradedScopes", "entries", "nextCursor", "total"]);
  // Both are counts of what could not be read, not flags.
  assert.equal(listed.degraded, 0);
  assert.equal(listed.degradedScopes, 0);
  assert.equal(listed.entries.length, 5);
  assert.equal(listed.total, RECORD_COUNT);
  assert.ok(listed.nextCursor, "more pages remain");

  var searched = ws.bound.searchKnowledge({ query: "shared marker", limit: 5 });
  assert.deepEqual(Object.keys(searched).sort(), [
    "coveredCharsPerRecord", "degraded", "degradedScopes", "incompleteCoverage", "nextCursor", "results", "total",
  ]);
  assert.equal(searched.coveredCharsPerRecord, knowledgeSearch.MAX_INDEXED_CHARS);
  assert.equal(searched.incompleteCoverage, 0, "short records are fully covered");
  assert.equal(searched.degraded, 0);
  assert.equal(searched.degradedScopes, 0);
  for (var i = 0; i < searched.results.length; i++) {
    assert.equal(typeof searched.results[i].score, "number");
    assert.ok(searched.results[i].score > 0, "scores are unchanged real BM25 values");
    assert.equal(typeof searched.results[i].snippet, "string");
    assert.match(searched.results[i].ref, /^know:[A-Za-z0-9_-]{24}$/);
  }

  // A ref from the ordered listing still reads back through the same binding.
  var read = ws.bound.readKnowledge({ ref: listed.entries[0].ref });
  assert.equal(read.ref, listed.entries[0].ref);
  assert.equal(typeof read.content, "string");
  assert.ok(read.content.length > 0);
});

test("a session outside the Mate still binds to nothing", function () {
  var ws = buildWorkspace();
  // A session object that the Mate's own manager does not hold cannot bind, so
  // no ordering path is reachable from it at all.
  assert.equal(ws.bindFor({ localId: 99, cliSessionId: "cli-intruder", ownerId: "mallory" }), null);
  assert.equal(ws.bindFor({ localId: 1, cliSessionId: "cli-ord", ownerId: "alice" }), null,
    "a look-alike session object is not the exact bound session");
  // The genuine binding is unaffected and is scoped to this Mate alone.
  assert.equal(ws.bound.isClay, false);
  assert.equal(ws.bound.mateId, "mate_ord");
  assert.equal(typeof ws.bound.listMateKnowledge, "undefined", "no cross-Mate tool is exposed");
  assert.equal(typeof ws.bound.searchMateKnowledge, "undefined");
});
