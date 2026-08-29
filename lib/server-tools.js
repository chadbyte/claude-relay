var fs = require("fs");
var path = require("path");
var toolsRegistry = require("./tools-registry");
var toolStorage = require("./tool-storage");
var examples = require("./tool-examples");

function attachTools(deps) {
  var users = deps.users;
  var projects = deps.projects;

  function contextFor(userId) {
    var multiUser = users.isMultiUser();
    var linuxUser = null;
    if (multiUser) {
      var user = users.findUserById(userId);
      if (user && user.linuxUser) linuxUser = user.linuxUser;
    }
    return { userId: userId, multiUser: multiUser, linuxUser: linuxUser };
  }

  function send(ws, payload) {
    if (ws.readyState !== undefined && ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  }

  function broadcastToUser(userId, payload) {
    var sent = new Set();
    projects.forEach(function (projectContext) {
      projectContext.forEachClient(function (otherWs) {
        if (sent.has(otherWs)) return;
        if (users.isMultiUser() && (!otherWs._clayUser || otherWs._clayUser.id !== userId)) return;
        sent.add(otherWs);
        send(otherWs, payload);
      });
    });
  }

  function sendError(ws, msg, error) {
    send(ws, {
      type: "tools_error",
      requestType: msg.type,
      toolId: msg.toolId || (msg.manifest && msg.manifest.id) || null,
      seq: msg.seq,
      message: error && error.message ? error.message : "Tool operation failed.",
    });
  }

  function run(ws, msg, operation) {
    Promise.resolve().then(operation).catch(function (error) { sendError(ws, msg, error); });
  }

  function ensureScratchpad(ctx) {
    var root = toolsRegistry.resolveToolsRoot(ctx);
    var marker = path.join(root, ".examples-v1");
    if (fs.existsSync(marker)) return;
    fs.mkdirSync(root, { recursive: true });
    if (!toolsRegistry.getTool(ctx, examples.SCRATCHPAD.manifest.id)) {
      toolsRegistry.installTool(ctx, examples.SCRATCHPAD);
    }
    fs.writeFileSync(marker, "scratchpad\n", "utf8");
  }

  function fullToolList(ctx) {
    var manifests = toolsRegistry.listTools(ctx);
    var tools = [];
    for (var i = 0; i < manifests.length; i++) {
      var tool = toolsRegistry.getTool(ctx, manifests[i].id);
      if (tool) tools.push(tool);
    }
    return tools;
  }

  function storageOperation(ctx, msg) {
    if (!toolsRegistry.getTool(ctx, msg.toolId)) throw new Error("Tool is not installed.");
    var storage = toolStorage.createToolStorage(ctx, msg.toolId);
    var args = msg.args || {};
    if (msg.op === "list") return storage.list();
    if (msg.op === "get") return storage.get(args.id);
    if (msg.op === "put") return storage.put(args.doc);
    if (msg.op === "delete") return storage.delete(args.id);
    if (msg.op === "query") return storage.query(args.query || {});
    throw new Error("Unknown storage operation '" + msg.op + "'.");
  }

  function handleMessage(ws, msg) {
    var messageTypes = ["tools_list", "tool_get", "tool_install", "tool_remove", "tool_storage_op"];
    if (!msg || messageTypes.indexOf(msg.type) === -1) return false;
    var userId;
    if (users.isMultiUser()) {
      if (!ws._clayUser) return false;
      userId = ws._clayUser.id;
    } else {
      userId = "default";
    }
    var ctx = contextFor(userId);

    if (msg.type === "tools_list") {
      run(ws, msg, function () {
        ensureScratchpad(ctx);
        send(ws, { type: "tools_state", tools: fullToolList(ctx) });
      });
      return true;
    }
    if (msg.type === "tool_get") {
      run(ws, msg, function () {
        var tool = toolsRegistry.getTool(ctx, msg.toolId);
        if (!tool) throw new Error("Tool not found.");
        send(ws, { type: "tools_state", tools: [tool], requestedToolId: msg.toolId });
      });
      return true;
    }
    if (msg.type === "tool_install") {
      run(ws, msg, function () {
        var installed = toolsRegistry.installTool(ctx, {
          manifest: msg.manifest,
          logicSource: msg.logicSource,
          uiTree: msg.uiTree,
        });
        broadcastToUser(userId, { type: "tool_installed", tool: installed });
      });
      return true;
    }
    if (msg.type === "tool_remove") {
      run(ws, msg, function () {
        var removed = toolsRegistry.removeTool(ctx, msg.toolId);
        if (!removed) throw new Error("Tool not found.");
        broadcastToUser(userId, { type: "tool_removed", toolId: msg.toolId });
      });
      return true;
    }
    if (msg.type === "tool_storage_op") {
      run(ws, msg, async function () {
        var data = await storageOperation(ctx, msg);
        send(ws, { type: "tool_storage_result", toolId: msg.toolId, op: msg.op, seq: msg.seq, data: data });
      });
      return true;
    }
    return false;
  }

  return { handleMessage: handleMessage };
}

module.exports = { attachTools: attachTools };
