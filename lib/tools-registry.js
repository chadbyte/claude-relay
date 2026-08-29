var fs = require("fs");
var path = require("path");
var config = require("./config");

var UI_NODE_TYPES = [
  "stack", "row", "text", "heading", "list", "table", "card", "input",
  "textarea", "select", "checkbox", "button", "badge", "divider", "empty-state",
];

function resolveToolsRoot(ctx) {
  if (ctx && ctx.linuxUser) return path.join("/home", ctx.linuxUser, ".clay", "tools");
  if (ctx && ctx.multiUser && ctx.userId) return path.join(config.CONFIG_DIR, "tools", ctx.userId);
  return path.join(config.CONFIG_DIR, "tools");
}

function validateToolId(id) {
  if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("Tool ID must be a lowercase slug.");
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Tool manifest is required.");
  }
  validateToolId(manifest.id);
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    throw new Error("Tool name is required.");
  }
  if (manifest.lucideIcon !== undefined && (typeof manifest.lucideIcon !== "string" || !/^[a-z0-9-]+$/.test(manifest.lucideIcon))) {
    throw new Error("Tool icon must be a lowercase Lucide icon name.");
  }
}

function validateUiNode(node, location) {
  location = location || "root";
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("UI node at " + location + " must be an object.");
  }
  if (UI_NODE_TYPES.indexOf(node.type) === -1) {
    throw new Error("Unknown UI node type '" + node.type + "' at " + location + ".");
  }
  if (node.id !== undefined && (typeof node.id !== "string" || !node.id)) {
    throw new Error("UI node ID at " + location + " must be a non-empty string.");
  }
  if (node.props !== undefined && (!node.props || typeof node.props !== "object" || Array.isArray(node.props))) {
    throw new Error("UI node props at " + location + " must be an object.");
  }
  if (node.bind !== undefined && typeof node.bind !== "string") {
    throw new Error("UI node bind at " + location + " must be a string.");
  }
  if (node.action !== undefined && typeof node.action !== "string") {
    throw new Error("UI node action at " + location + " must be a string.");
  }
  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new Error("UI node children at " + location + " must be an array.");
  }
  var children = node.children || [];
  for (var i = 0; i < children.length; i++) validateUiNode(children[i], location + ".children[" + i + "]");
}

function toolDirectory(ctx, id) {
  validateToolId(id);
  return path.join(resolveToolsRoot(ctx), id);
}

function getTool(ctx, id) {
  var directory = toolDirectory(ctx, id);
  var manifestPath = path.join(directory, "manifest.json");
  var logicPath = path.join(directory, "logic.js");
  var uiPath = path.join(directory, "ui.json");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(logicPath) || !fs.existsSync(uiPath)) return null;
  var manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  var uiTree = JSON.parse(fs.readFileSync(uiPath, "utf8"));
  validateManifest(manifest);
  validateUiNode(uiTree);
  return {
    manifest: manifest,
    logicSource: fs.readFileSync(logicPath, "utf8"),
    uiTree: uiTree,
  };
}

function listTools(ctx) {
  var root = resolveToolsRoot(ctx);
  if (!fs.existsSync(root)) return [];
  var entries = fs.readdirSync(root, { withFileTypes: true });
  var manifests = [];
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory()) continue;
    try {
      var tool = getTool(ctx, entries[i].name);
      if (tool) manifests.push(tool.manifest);
    } catch (e) {}
  }
  manifests.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return manifests;
}

function installTool(ctx, input) {
  if (!input || typeof input !== "object") throw new Error("Tool installation payload is required.");
  validateManifest(input.manifest);
  if (typeof input.logicSource !== "string" || !input.logicSource.trim()) {
    throw new Error("Tool logic source is required.");
  }
  validateUiNode(input.uiTree);
  var manifest = Object.assign({}, input.manifest, { name: input.manifest.name.trim() });
  var directory = toolDirectory(ctx, manifest.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(directory, "logic.js"), input.logicSource, "utf8");
  fs.writeFileSync(path.join(directory, "ui.json"), JSON.stringify(input.uiTree, null, 2) + "\n", "utf8");
  return getTool(ctx, manifest.id);
}

function removeTool(ctx, id) {
  var directory = toolDirectory(ctx, id);
  if (!fs.existsSync(directory)) return false;
  fs.rmSync(directory, { recursive: true, force: true });
  return true;
}

module.exports = {
  UI_NODE_TYPES: UI_NODE_TYPES,
  resolveToolsRoot: resolveToolsRoot,
  validateToolId: validateToolId,
  validateUiNode: validateUiNode,
  listTools: listTools,
  getTool: getTool,
  installTool: installTool,
  removeTool: removeTool,
};
