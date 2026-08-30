var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var config = require("./config");
var toolUiSpec = require("./tool-ui-spec");

var CAPSULES_ROOT = path.join(__dirname, "capsules");
var SEED_MARKER = ".capsules-v3";
var PREVIOUS_SEED_MARKER = ".capsules-v2";
var LEGACY_SEED_MARKER = ".capsules-v1";
var UI_NODE_TYPES = toolUiSpec.UI_NODE_TYPES;
var LEGACY_UI_HASHES = {
  translator: "8beab99e78961c3409ddea031657b569c0dec3d95515132fa53d52b487e86220",
  scratchpad: "e8faef3682996d6adb70e44952a5042b61229b7d4457cab51cea4ed6d4084bb9",
};

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

function isTrustedServerRuntime(manifest) {
  if (!manifest || manifest.runtime !== "server") return false;
  var sourceManifest = path.join(CAPSULES_ROOT, manifest.id || "", "manifest.json");
  try {
    var shipped = JSON.parse(fs.readFileSync(sourceManifest, "utf8"));
    return shipped.id === manifest.id && shipped.runtime === "server";
  } catch (e) {
    return false;
  }
}

function filesMatch(first, second) {
  try {
    return fs.readFileSync(first).equals(fs.readFileSync(second));
  } catch (e) {
    return false;
  }
}

function fileHash(file) {
  try { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); } catch (e) { return null; }
}

function manifestsMatchForUiUpgrade(installed, shipped) {
  var first = Object.assign({}, installed);
  var second = Object.assign({}, shipped);
  if (first.modelAlias === undefined) delete second.modelAlias;
  return JSON.stringify(first) === JSON.stringify(second);
}

function upgradeUntouchedBuiltInUi(destination, name) {
  if (!LEGACY_UI_HASHES[name]) return false;
  var source = path.join(CAPSULES_ROOT, name);
  var installedManifestPath = path.join(destination, "manifest.json");
  var shippedManifestPath = path.join(source, "manifest.json");
  var installedUiPath = path.join(destination, "ui.json");
  try {
    var installedManifest = JSON.parse(fs.readFileSync(installedManifestPath, "utf8"));
    var shippedManifest = JSON.parse(fs.readFileSync(shippedManifestPath, "utf8"));
    if (!installedManifest.example || !manifestsMatchForUiUpgrade(installedManifest, shippedManifest)) return false;
    if (!filesMatch(path.join(destination, "logic.js"), path.join(source, "logic.js"))) return false;
    if (fileHash(installedUiPath) !== LEGACY_UI_HASHES[name]) return false;
    fs.copyFileSync(path.join(source, "ui.json"), installedUiPath);
    return true;
  } catch (e) {
    return false;
  }
}

function hydrateShippedManifestMetadata(directory, manifest) {
  if (!manifest || !manifest.example || manifest.modelAlias !== undefined) return manifest;
  var shippedDirectory = path.join(CAPSULES_ROOT, manifest.id || "");
  var shippedManifestPath = path.join(shippedDirectory, "manifest.json");
  try {
    var shipped = JSON.parse(fs.readFileSync(shippedManifestPath, "utf8"));
    if (!shipped.example || shipped.id !== manifest.id || shipped.modelAlias === undefined) return manifest;
    if (!filesMatch(path.join(directory, "ui.json"), path.join(shippedDirectory, "ui.json"))) return manifest;
    if (!filesMatch(path.join(directory, "logic.js"), path.join(shippedDirectory, "logic.js"))) return manifest;
    return Object.assign({}, manifest, { modelAlias: shipped.modelAlias });
  } catch (e) {
    return manifest;
  }
}

function validateManifest(manifest, opts) {
  opts = opts || {};
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
  if (manifest.skills !== undefined && typeof manifest.skills !== "string") {
    throw new Error("Tool skills must be markdown text.");
  }
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) throw new Error("Tool permissions must be an array.");
    for (var pi = 0; pi < manifest.permissions.length; pi++) {
      if (manifest.permissions[pi] !== "llm") throw new Error("Unknown tool permission '" + manifest.permissions[pi] + "'.");
    }
  }
  if (manifest.modelAlias !== undefined && ["fast", "standard", "deep"].indexOf(manifest.modelAlias) === -1) {
    throw new Error("Tool modelAlias must be fast, standard, or deep.");
  }
  var runtime = manifest.runtime || "worker";
  if (runtime !== "worker" && runtime !== "server") {
    throw new Error("Tool runtime must be 'worker' or 'server'.");
  }
  if (runtime === "server" && !opts.allowServerRuntime) {
    throw new Error("Server-runtime capsules cannot be installed over WebSocket.");
  }
  if (runtime === "server" && !isTrustedServerRuntime(manifest)) {
    throw new Error("Server runtime is reserved for shipped built-in capsules.");
  }
}

var validateUiNode = toolUiSpec.validateUiNode;

function toolDirectory(ctx, id) {
  validateToolId(id);
  return path.join(resolveToolsRoot(ctx), id);
}

function seedBuiltInCapsules(ctx) {
  var root = resolveToolsRoot(ctx);
  var marker = path.join(root, SEED_MARKER);
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(root, { recursive: true });
  var upgradingV2 = fs.existsSync(path.join(root, PREVIOUS_SEED_MARKER));
  var upgradingV1 = !upgradingV2 && fs.existsSync(path.join(root, LEGACY_SEED_MARKER));
  var entries = fs.readdirSync(CAPSULES_ROOT, { withFileTypes: true });
  var seeded = [];
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory()) continue;
    if (upgradingV1 && entries[i].name !== "translator") continue;
    var destination = path.join(root, entries[i].name);
    if (upgradingV2) {
      if (fs.existsSync(destination) && upgradeUntouchedBuiltInUi(destination, entries[i].name)) seeded.push(entries[i].name + ":ui-v2");
      continue;
    }
    if (!fs.existsSync(destination)) {
      fs.cpSync(path.join(CAPSULES_ROOT, entries[i].name), destination, { recursive: true });
      seeded.push(entries[i].name);
    } else {
      var sourceFiles = fs.readdirSync(path.join(CAPSULES_ROOT, entries[i].name));
      for (var fi = 0; fi < sourceFiles.length; fi++) {
        var sourceFile = path.join(CAPSULES_ROOT, entries[i].name, sourceFiles[fi]);
        var destinationFile = path.join(destination, sourceFiles[fi]);
        if (!fs.existsSync(destinationFile)) fs.copyFileSync(sourceFile, destinationFile);
      }
    }
  }
  fs.writeFileSync(marker, seeded.join("\n") + "\n", "utf8");
}

function getTool(ctx, id) {
  var directory = toolDirectory(ctx, id);
  var manifestPath = path.join(directory, "manifest.json");
  var logicPath = path.join(directory, "logic.js");
  var uiPath = path.join(directory, "ui.json");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(uiPath)) return null;
  var manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  var uiTree = JSON.parse(fs.readFileSync(uiPath, "utf8"));
  validateManifest(manifest, { allowServerRuntime: true });
  if (manifest.id !== id) throw new Error("Capsule folder name must match manifest ID.");
  validateUiNode(uiTree);
  var runtime = manifest.runtime || "worker";
  if (runtime === "worker" && !fs.existsSync(logicPath)) throw new Error("Worker capsule logic.js is required.");
  manifest = hydrateShippedManifestMetadata(directory, manifest);
  return {
    manifest: Object.assign({}, manifest, { runtime: runtime }),
    logicSource: runtime === "worker" ? fs.readFileSync(logicPath, "utf8") : null,
    uiTree: uiTree,
  };
}

function listTools(ctx) {
  seedBuiltInCapsules(ctx);
  var root = resolveToolsRoot(ctx);
  var entries = fs.readdirSync(root, { withFileTypes: true });
  var manifests = [];
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory()) continue;
    try {
      var tool = getTool(ctx, entries[i].name);
      if (tool) manifests.push(tool.manifest);
      else manifests.push({ id: entries[i].name, error: "Capsule requires manifest.json and ui.json." });
    } catch (e) {
      manifests.push({ id: entries[i].name, error: e.message });
    }
  }
  manifests.sort(function (a, b) { return (a.name || a.id).localeCompare(b.name || b.id); });
  return manifests;
}

function installTool(ctx, input) {
  if (!input || typeof input !== "object") throw new Error("Tool installation payload is required.");
  validateManifest(input.manifest, { allowServerRuntime: false });
  if (typeof input.logicSource !== "string" || !input.logicSource.trim()) {
    throw new Error("Tool logic source is required.");
  }
  validateUiNode(input.uiTree);
  var manifest = Object.assign({}, input.manifest, { name: input.manifest.name.trim(), runtime: "worker" });
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
  CAPSULES_ROOT: CAPSULES_ROOT,
  UI_NODE_TYPES: UI_NODE_TYPES,
  resolveToolsRoot: resolveToolsRoot,
  validateToolId: validateToolId,
  validateManifest: validateManifest,
  validateUiNode: validateUiNode,
  seedBuiltInCapsules: seedBuiltInCapsules,
  listTools: listTools,
  getTool: getTool,
  installTool: installTool,
  removeTool: removeTool,
};
