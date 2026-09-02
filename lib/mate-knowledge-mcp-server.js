// SDK-free `clay-knowledge` MCP tool definitions for Mate Knowledge.
//
// Two disjoint tool sets. An ordinary Mate gets tools with no mateId, owner, or
// scope argument at all, because the binding decides the scope and a tool
// argument must never be able to widen it or reveal that other Mates exist.
// Authoritative builtin Clay gets same-user cross-Mate read tools that may name
// a mateId for list and search, while read resolves an opaque reference inside
// the authorized user's Mate scopes only.

var buildShape = require("./session-spawn-mcp-server").buildShape;
var service = require("./mate-knowledge-service");

var MATE_CONTRACT =
  "Your Knowledge is the durable personal and expertise context you own: what you have learned, the material you keep, and your accumulated observations. " +
  "It is yours alone. There are no other Knowledge collections available to you here, and project Logs are a separate, unrelated surface. " +
  "Search it when recalling something specific would genuinely change your answer, and read only the records you actually need. " +
  "Do not enumerate or restate your Knowledge to the user unasked, and never reproduce whole records as filler.";

var CLAY_CONTRACT =
  "You may read the Knowledge of Mates belonging to the current user in order to coordinate between them, and only for that user. " +
  "Use it to find who holds relevant expertise or context, and to answer with that context attributed to the Mate that owns it. " +
  "Search first, read narrowly, and cite the owning Mate. Never reproduce a Mate's Knowledge wholesale, and never present it as your own.";

var REF_DESCRIPTION = "Opaque knowledge reference returned by a list or search tool.";
var PAGE_DESCRIPTION = "Page size, from 1 to " + service.MAX_PAGE + ".";
var CURSOR_DESCRIPTION = "Opaque pagination cursor from a previous response.";
var OFFSET_DESCRIPTION = "Character offset to start from. Omit for the beginning; pass the previous response's nextOffset to continue.";
var MAX_CHARS_DESCRIPTION = "Characters to return, from 1 to " + service.MAX_READ_CHARS + ". Defaults to " + service.DEFAULT_READ_CHARS + ".";
var READ_RESULT = " The whole record is reassembled and verified before any slice is returned. The response carries offset, totalChars, nextOffset, and complete; when nextOffset is not null, call again with it to continue.";

function textResult(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

function errorResult(error) {
  return Promise.resolve({
    content: [{ type: "text", text: "Error: " + (error && error.message ? error.message : String(error)) }],
    isError: true,
  });
}

// An unbound descriptor exists only so a tool list can be advertised before a
// session is known. Every call against it fails closed.
function handler(bound, method) {
  return function (args) {
    if (!bound || typeof bound[method] !== "function") {
      return errorResult(new Error("Knowledge tools require an exact session-bound Mate."));
    }
    try {
      return textResult(bound[method](args || {}));
    } catch (e) {
      return errorResult(e);
    }
  };
}

function mateTools(bound) {
  return [
    {
      name: "list_knowledge",
      description: MATE_CONTRACT + " List your own Knowledge records, most recently updated first. Returns summaries with a short preview, not full records.",
      inputSchema: buildShape({
        kind: { type: "string", description: "Optional record kind filter, such as knowledge-file, memory-summary, session-digest, or user-observation." },
        cursor: { type: "string", description: CURSOR_DESCRIPTION },
        limit: { type: "number", description: PAGE_DESCRIPTION },
      }),
      handler: handler(bound, "listKnowledge"),
    },
    {
      name: "search_knowledge",
      description: MATE_CONTRACT + " Search your own Knowledge by relevance. Returns ranked summaries with a matching snippet.",
      inputSchema: buildShape({
        query: { type: "string", description: "Search query." },
        kind: { type: "string", description: "Optional record kind filter." },
        cursor: { type: "string", description: CURSOR_DESCRIPTION },
        limit: { type: "number", description: PAGE_DESCRIPTION },
      }, ["query"]),
      handler: handler(bound, "searchKnowledge"),
    },
    {
      name: "read_knowledge",
      description: MATE_CONTRACT + " Read one of your own Knowledge records. Read only what you need." + READ_RESULT,
      inputSchema: buildShape({
        ref: { type: "string", description: REF_DESCRIPTION },
        offset: { type: "number", description: OFFSET_DESCRIPTION },
        maxChars: { type: "number", description: MAX_CHARS_DESCRIPTION },
      }, ["ref"]),
      handler: handler(bound, "readKnowledge"),
    },
  ];
}

function clayTools(bound) {
  return [
    {
      name: "list_mate_knowledge",
      description: CLAY_CONTRACT + " List Knowledge records across the current user's Mates, or one named Mate. Available only to authoritative builtin Clay.",
      inputSchema: buildShape({
        mateId: { type: "string", description: "Optional exact Mate id belonging to the current user. Omit to span all of them." },
        kind: { type: "string", description: "Optional record kind filter." },
        cursor: { type: "string", description: CURSOR_DESCRIPTION },
        limit: { type: "number", description: PAGE_DESCRIPTION },
      }),
      handler: handler(bound, "listMateKnowledge"),
    },
    {
      name: "search_mate_knowledge",
      description: CLAY_CONTRACT + " Search Knowledge across the current user's Mates, or one named Mate. Results identify the owning Mate. Available only to authoritative builtin Clay.",
      inputSchema: buildShape({
        query: { type: "string", description: "Search query." },
        mateId: { type: "string", description: "Optional exact Mate id belonging to the current user." },
        kind: { type: "string", description: "Optional record kind filter." },
        cursor: { type: "string", description: CURSOR_DESCRIPTION },
        limit: { type: "number", description: PAGE_DESCRIPTION },
      }, ["query"]),
      handler: handler(bound, "searchMateKnowledge"),
    },
    {
      name: "read_mate_knowledge",
      description: CLAY_CONTRACT + " Read one Knowledge record using the opaque reference returned by a list or search tool. The reference resolves only inside the current user's Mate Knowledge. Available only to authoritative builtin Clay." + READ_RESULT,
      inputSchema: buildShape({
        ref: { type: "string", description: REF_DESCRIPTION },
        offset: { type: "number", description: OFFSET_DESCRIPTION },
        maxChars: { type: "number", description: MAX_CHARS_DESCRIPTION },
      }, ["ref"]),
      handler: handler(bound, "readMateKnowledge"),
    },
  ];
}

// A binding is either one Mate's own scope or Clay's cross-Mate read view. The
// two sets are never advertised together, so no tool name is duplicated.
function getToolDefs(bound, includeClay) {
  return includeClay === true ? clayTools(bound) : mateTools(bound);
}

function createMcpServer(adapter, bound, includeClay) {
  if (!adapter || typeof adapter.createToolServer !== "function") return null;
  return adapter.createToolServer({
    name: "clay-knowledge",
    version: "1.0.0",
    tools: getToolDefs(bound, includeClay),
  });
}

module.exports = {
  MATE_CONTRACT: MATE_CONTRACT,
  CLAY_CONTRACT: CLAY_CONTRACT,
  getToolDefs: getToolDefs,
  createMcpServer: createMcpServer,
};
