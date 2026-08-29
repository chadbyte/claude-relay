var toolsRegistry = require("./tools-registry");
var toolStorage = require("./tool-storage");
var crypto = require("crypto");
var capsulesServerLogic = require("./capsules-server-logic");
var toolLlm = require("./tool-llm");

function attachTools(deps) {
  var users = deps.users;
  var projects = deps.projects;
  var boardHandler = deps.boardHandler || null;
  var serverLogic = capsulesServerLogic.createServerLogicMap({ boardHandler: boardHandler });
  var controlTimeoutMs = deps.controlTimeoutMs || 15000;
  var llmControlTimeoutMs = deps.llmControlTimeoutMs || 90000;
  var pendingControl = Object.create(null);

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
      requestId: msg.requestId,
      message: error && error.message ? error.message : "Tool operation failed.",
    });
  }

  function run(ws, msg, operation) {
    Promise.resolve().then(operation).catch(function (error) { sendError(ws, msg, error); });
  }

  function fullToolList(ctx) {
    var manifests = toolsRegistry.listTools(ctx);
    var tools = [];
    for (var i = 0; i < manifests.length; i++) {
      if (manifests[i].error) {
        tools.push(manifests[i]);
        continue;
      }
      var tool = toolsRegistry.getTool(ctx, manifests[i].id);
      if (tool) tools.push(tool);
    }
    return tools;
  }

  function installedManifests(userId) {
    var ctx = contextFor(userId);
    return toolsRegistry.listTools(ctx).filter(function (manifest) { return !manifest.error; });
  }

  function socketUserId(ws) {
    if (!users.isMultiUser()) return "default";
    return ws._clayUser ? ws._clayUser.id : null;
  }

  function latestHomeSocket(userId) {
    var found = null;
    var foundAt = -1;
    var seen = new Set();
    projects.forEach(function (projectContext) {
      projectContext.forEachClient(function (ws) {
        if (seen.has(ws) || socketUserId(ws) !== userId || !ws._homeChatTap) return;
        seen.add(ws);
        if (ws.readyState !== undefined && ws.readyState !== 1) return;
        var openedAt = ws._homeChatTap.openedAt || 0;
        if (!found || openedAt >= foundAt) {
          found = ws;
          foundAt = openedAt;
        }
      });
    });
    return found;
  }

  function requestBrowserControl(userId, mateId, toolId, kind, payload, timeoutMs) {
    var ws = latestHomeSocket(userId);
    if (!ws) return Promise.reject(new Error("The user's home screen is not open."));
    var requestId = "toolctl_" + crypto.randomUUID();
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        delete pendingControl[requestId];
        reject(new Error("The tool control request timed out because the home screen did not respond."));
      }, timeoutMs || controlTimeoutMs);
      pendingControl[requestId] = {
        ws: ws,
        userId: userId,
        resolve: resolve,
        reject: reject,
        timer: timer,
      };
      send(ws, {
        type: "tool_control_request",
        requestId: requestId,
        toolId: toolId,
        kind: kind,
        payload: payload || {},
        callerId: mateId,
      });
    });
  }

  function controlForMate(userId, mateId, toolId, kind, payload) {
    payload = payload || {};
    var ctx = contextFor(userId);
    toolsRegistry.listTools(ctx);
    var installed = toolsRegistry.getTool(ctx, toolId);
    if (!installed) return Promise.reject(new Error("Tool is not installed."));
    if (installed.manifest.runtime === "server") {
      var adapter = serverLogic[toolId];
      if (!adapter) return Promise.reject(new Error("No trusted server runtime is registered for this capsule."));
      var context = { userId: userId, callerId: mateId };
      if (kind === "snapshot") return Promise.resolve(adapter.snapshot(context));
      if (kind === "act") return Promise.resolve(adapter.act(context, payload.actionId, payload.args || {}));
      if (kind === "set" && adapter.set) return Promise.resolve(adapter.set(context, payload.controlId, payload.value));
      return Promise.reject(new Error("The server-runtime capsule does not support '" + kind + "'."));
    }
    var permissions = installed.manifest.permissions || [];
    var timeoutMs = kind === "act" && permissions.indexOf("llm") !== -1 ? llmControlTimeoutMs : controlTimeoutMs;
    return requestBrowserControl(userId, mateId, toolId, kind, payload || {}, timeoutMs);
  }

  function handleControlResponse(ws, msg, userId) {
    var pending = pendingControl[msg.requestId];
    if (!pending || pending.ws !== ws || pending.userId !== userId) return;
    clearTimeout(pending.timer);
    delete pendingControl[msg.requestId];
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.data || {});
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

  function projectForSocket(ws) {
    var found = null;
    projects.forEach(function (projectContext) {
      if (!found && projectContext.clients && projectContext.clients.has(ws)) found = projectContext;
    });
    return found;
  }

  async function llmOperation(ws, ctx, userId, msg) {
    var tool = toolsRegistry.getTool(ctx, msg.toolId);
    if (!tool) throw new Error("Tool is not installed.");
    var permissions = tool.manifest.permissions || [];
    if (permissions.indexOf("llm") === -1) throw new Error("This capsule does not have the llm permission.");
    var args = toolLlm.validateArgs(msg.args);
    var projectContext = projectForSocket(ws);
    if (!projectContext || typeof projectContext.completeToolLlm !== "function") throw new Error("No project LLM runtime is available.");
    console.debug("[tool-llm] toolId=" + msg.toolId + " callerId=" + (msg.callerId || "user"));
    return projectContext.completeToolLlm(args);
  }

  function installForMate(userId, input) {
    var installed = toolsRegistry.installTool(contextFor(userId), input);
    broadcastToUser(userId, { type: "tool_installed", tool: installed });
    return installed;
  }

  function removeForMate(userId, toolId) {
    var removed = toolsRegistry.removeTool(contextFor(userId), toolId);
    if (!removed) throw new Error("Tool not found.");
    broadcastToUser(userId, { type: "tool_removed", toolId: toolId });
    return { removed: true, toolId: toolId };
  }

  function handleMessage(ws, msg) {
    var messageTypes = ["tools_list", "tool_get", "tool_install", "tool_remove", "tool_storage_op", "tool_llm_op", "tool_control_response"];
    if (!msg || messageTypes.indexOf(msg.type) === -1) return false;
    var userId;
    if (users.isMultiUser()) {
      if (!ws._clayUser) return false;
      userId = ws._clayUser.id;
    } else {
      userId = "default";
    }
    var ctx = contextFor(userId);

    if (msg.type === "tool_control_response") {
      handleControlResponse(ws, msg, userId);
      return true;
    }

    if (msg.type === "tools_list") {
      run(ws, msg, function () {
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
        installForMate(userId, {
          manifest: msg.manifest,
          logicSource: msg.logicSource,
          uiTree: msg.uiTree,
        });
      });
      return true;
    }
    if (msg.type === "tool_remove") {
      run(ws, msg, function () {
        removeForMate(userId, msg.toolId);
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
    if (msg.type === "tool_llm_op") {
      run(ws, msg, async function () {
        var data = await llmOperation(ws, ctx, userId, msg);
        send(ws, { type: "tool_llm_result", toolId: msg.toolId, requestId: msg.requestId, data: data });
      });
      return true;
    }
    return false;
  }

  return {
    handleMessage: handleMessage,
    installedManifests: installedManifests,
    controlForMate: controlForMate,
    installForMate: installForMate,
    removeForMate: removeForMate,
  };
}

module.exports = { attachTools: attachTools };
