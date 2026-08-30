var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var METADATA_FILE = ".capsule-metadata.json";

function metadataPath(root) {
  return path.join(root, METADATA_FILE);
}

function readMetadata(root) {
  try {
    var parsed = JSON.parse(fs.readFileSync(metadataPath(root), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeFileAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var temporary = file + ".tmp-" + process.pid + "-" + crypto.randomBytes(6).toString("hex");
  try {
    fs.writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (cleanupError) {}
    throw error;
  }
}

function sanitizedMetadata(root, toolId) {
  var record = readMetadata(root)[toolId];
  return { mateEditingAllowed: !!(record && record.mateEditingAllowed === true) };
}

function setMateEditingAllowed(root, toolId, allowed) {
  var all = readMetadata(root);
  all[toolId] = { mateEditingAllowed: allowed === true };
  writeFileAtomic(metadataPath(root), JSON.stringify(all, null, 2) + "\n");
  return sanitizedMetadata(root, toolId);
}

function removeMetadata(root, toolId) {
  var all = readMetadata(root);
  if (!Object.prototype.hasOwnProperty.call(all, toolId)) return;
  delete all[toolId];
  writeFileAtomic(metadataPath(root), JSON.stringify(all, null, 2) + "\n");
}

function revisionForParts(manifestSource, uiSource, logicSource) {
  var hash = crypto.createHash("sha256");
  var parts = [manifestSource, uiSource, logicSource === null ? "" : logicSource];
  for (var i = 0; i < parts.length; i++) {
    var bytes = Buffer.from(parts[i], "utf8");
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function readSource(directory) {
  var manifestSource = fs.readFileSync(path.join(directory, "manifest.json"), "utf8");
  var uiSource = fs.readFileSync(path.join(directory, "ui.json"), "utf8");
  var manifest = JSON.parse(manifestSource);
  var uiTree = JSON.parse(uiSource);
  var runtime = manifest.runtime || "worker";
  var logicSource = runtime === "worker" ? fs.readFileSync(path.join(directory, "logic.js"), "utf8") : null;
  return {
    manifest: manifest,
    uiTree: uiTree,
    logicSource: logicSource,
    logicAvailable: runtime === "worker",
    revision: revisionForParts(manifestSource, uiSource, logicSource),
  };
}

function replaceSourceFiles(directory, sources) {
  var names = ["manifest.json", "ui.json", "logic.js"];
  var transaction = crypto.randomBytes(6).toString("hex");
  var staged = [];
  var backups = [];
  try {
    for (var i = 0; i < names.length; i++) {
      var target = path.join(directory, names[i]);
      var stage = target + ".next-" + transaction;
      staged.push({ target: target, stage: stage });
      fs.writeFileSync(stage, sources[names[i]], "utf8");
    }
    for (var j = 0; j < staged.length; j++) {
      var backup = staged[j].target + ".previous-" + transaction;
      fs.renameSync(staged[j].target, backup);
      backups.push({ target: staged[j].target, backup: backup });
      fs.renameSync(staged[j].stage, staged[j].target);
    }
  } catch (error) {
    for (var ri = backups.length - 1; ri >= 0; ri--) {
      try {
        fs.rmSync(backups[ri].target, { force: true });
        fs.renameSync(backups[ri].backup, backups[ri].target);
      } catch (rollbackError) {}
    }
    for (var si = 0; si < staged.length; si++) {
      try { fs.rmSync(staged[si].stage, { force: true }); } catch (cleanupError) {}
    }
    throw error;
  }
  for (var k = 0; k < backups.length; k++) {
    try { fs.rmSync(backups[k].backup, { force: true }); } catch (cleanupError) {}
  }
}

function updateSource(directory, input, validators) {
  var current = readSource(directory);
  if (!current.logicAvailable) throw new Error("Server-managed Capsules cannot be edited.");
  if (!input || typeof input !== "object") throw new Error("Complete Capsule source is required.");
  if (typeof input.baseRevision !== "string" || input.baseRevision !== current.revision) {
    throw new Error("Capsule source changed. Read the latest source and retry your update.");
  }
  validators.validateManifest(input.manifest, { allowServerRuntime: false });
  validators.validateUiNode(input.uiTree);
  if (input.manifest.id !== current.manifest.id) throw new Error("Capsule updates cannot change the Capsule ID.");
  if ((input.manifest.runtime || "worker") !== "worker") throw new Error("Capsule updates cannot change the runtime.");
  if (typeof input.logicSource !== "string" || !input.logicSource.trim()) throw new Error("Tool logic source is required.");
  var manifest = Object.assign({}, input.manifest, { name: input.manifest.name.trim(), runtime: "worker" });
  replaceSourceFiles(directory, {
    "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
    "ui.json": JSON.stringify(input.uiTree, null, 2) + "\n",
    "logic.js": input.logicSource,
  });
  return readSource(directory);
}

module.exports = {
  METADATA_FILE: METADATA_FILE,
  sanitizedMetadata: sanitizedMetadata,
  setMateEditingAllowed: setMateEditingAllowed,
  removeMetadata: removeMetadata,
  readSource: readSource,
  updateSource: updateSource,
};
