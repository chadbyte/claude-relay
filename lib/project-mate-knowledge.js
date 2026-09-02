// Session-bound `clay-knowledge` wiring for Mate projects.
//
// Mate Knowledge is available only inside a Mate project. A non-Mate Project
// Driver session gets nothing here and continues to use `clay-logs`. Which
// tool set a Mate receives is decided by the server Mate registry through the
// service binder, never by a project flag or a tool argument.

var knowledgeMcp = require("./mate-knowledge-mcp-server");

var SYSTEM_PROMPT_LABEL = "--- Your Knowledge (durable personal and expertise context; manage via clay-knowledge tools) ---";
var CLAY_PROMPT_LABEL = "--- Mate Knowledge coordination (via clay-knowledge tools) ---";

function attachProjectMateKnowledge(ctx) {
  var service = ctx.service;
  var sm = ctx.sm;
  var slug = ctx.projectSlug;
  var isMate = ctx.isMate === true;
  var mateId = ctx.mateId || null;
  var getProjectOwnerId = ctx.getProjectOwnerId || function () { return null; };

  function binding(session) {
    if (!service || !isMate || !mateId) return null;
    if (session && (!sm || !sm.sessions || sm.sessions.get(session.localId) !== session)) return null;
    return service.bind({
      projectSlug: slug,
      projectOwnerId: getProjectOwnerId(),
      isMate: true,
      mateId: mateId,
      session: session || null,
    });
  }

  // Decided once from the project-level binding so a static descriptor and a
  // session-bound server always advertise the same tool set.
  function includeClay() {
    var projectBound = binding(null);
    return !!(projectBound && projectBound.isClay === true);
  }

  function getToolDefs(session) {
    if (!service || !isMate) return [];
    var bound = session ? binding(session) : null;
    if (session && !bound) return [];
    return knowledgeMcp.getToolDefs(bound, includeClay());
  }

  function createMcpServer(adapter, session) {
    if (!service || !isMate) return null;
    if (!binding(null)) return null;
    var bound = session ? binding(session) : null;
    // A session that cannot bind still gets the fail-closed descriptor rather
    // than a silently missing server.
    return knowledgeMcp.createMcpServer(adapter, bound, includeClay());
  }

  function getDynamicToolDefs(session) {
    return getToolDefs(session).map(function (tool) {
      tool.permissionName = "mcp__clay-knowledge__" + tool.name;
      return tool;
    });
  }

  function getBridgeTools(session, normalizeSchema) {
    if (!session) return [];
    var defs = getToolDefs(session);
    var tools = [];
    for (var i = 0; i < defs.length; i++) {
      tools.push({
        server: "clay-knowledge",
        name: defs[i].name,
        description: defs[i].description || defs[i].name,
        inputSchema: normalizeSchema(defs[i].inputSchema),
      });
    }
    return tools;
  }

  function callBridgeTool(session, toolName, args) {
    if (!session) return Promise.reject(new Error("Knowledge tools require a valid Mate session."));
    var defs = getToolDefs(session);
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].name === toolName) return Promise.resolve(defs[i].handler(args || {}));
    }
    return Promise.reject(new Error("Knowledge tool not found: " + toolName));
  }

  function getSystemPrompt(session) {
    if (!service || !isMate) return "";
    var bound = session ? binding(session) : binding(null);
    if (!bound) return "";
    return bound.isClay
      ? CLAY_PROMPT_LABEL + "\n" + knowledgeMcp.CLAY_CONTRACT
      : SYSTEM_PROMPT_LABEL + "\n" + knowledgeMcp.MATE_CONTRACT;
  }

  return {
    createMcpServer: createMcpServer,
    getToolDefs: getToolDefs,
    getDynamicToolDefs: getDynamicToolDefs,
    getBridgeTools: getBridgeTools,
    callBridgeTool: callBridgeTool,
    getSystemPrompt: getSystemPrompt,
  };
}

module.exports = {
  SYSTEM_PROMPT_LABEL: SYSTEM_PROMPT_LABEL,
  CLAY_PROMPT_LABEL: CLAY_PROMPT_LABEL,
  attachProjectMateKnowledge: attachProjectMateKnowledge,
};
