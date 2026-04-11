/**
 * Mates knowledge module -- Common knowledge registry for cross-mate sharing.
 *
 * Manages the common-knowledge.json file that tracks which knowledge files
 * are promoted (shared) across all mates in a workspace.
 * Extracted from mates.js to keep module sizes manageable.
 */

var fs = require("fs");
var path = require("path");

/**
 * @param {function} resolveMatesRoot - function(ctx) returning mates root directory
 */
function attachKnowledge(resolveMatesRoot) {

  function commonKnowledgePath(ctx) {
    return path.join(resolveMatesRoot(ctx), "common-knowledge.json");
  }

  function loadCommonKnowledge(ctx) {
    try {
      var raw = fs.readFileSync(commonKnowledgePath(ctx), "utf8");
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }

  function saveCommonKnowledge(ctx, entries) {
    var filePath = commonKnowledgePath(ctx);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    var tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2));
    fs.renameSync(tmpPath, filePath);
  }

  function promoteKnowledge(ctx, mateId, mateName, fileName) {
    var entries = loadCommonKnowledge(ctx);
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].mateId === mateId && entries[i].name === fileName) {
        return entries; // already promoted
      }
    }
    entries.push({
      name: fileName,
      mateId: mateId,
      mateName: mateName || null,
      promotedAt: Date.now()
    });
    saveCommonKnowledge(ctx, entries);
    return entries;
  }

  function depromoteKnowledge(ctx, mateId, fileName) {
    var entries = loadCommonKnowledge(ctx);
    entries = entries.filter(function (e) {
      return !(e.mateId === mateId && e.name === fileName);
    });
    saveCommonKnowledge(ctx, entries);
    return entries;
  }

  function getCommonKnowledgeForMate(ctx, mateId) {
    var entries = loadCommonKnowledge(ctx);
    var root = resolveMatesRoot(ctx);
    var result = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var filePath = path.join(root, e.mateId, "knowledge", e.name);
      try {
        var stat = fs.statSync(filePath);
        result.push({
          name: e.name,
          size: stat.size,
          mtime: stat.mtimeMs,
          common: true,
          ownMateId: e.mateId,
          ownerName: e.mateName
        });
      } catch (err) {
        // Source file deleted, skip
      }
    }
    return result;
  }

  function readCommonKnowledgeFile(ctx, mateId, fileName) {
    var root = resolveMatesRoot(ctx);
    var filePath = path.join(root, mateId, "knowledge", path.basename(fileName));
    return fs.readFileSync(filePath, "utf8");
  }

  function isPromoted(ctx, mateId, fileName) {
    var entries = loadCommonKnowledge(ctx);
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].mateId === mateId && entries[i].name === fileName) return true;
    }
    return false;
  }

  return {
    loadCommonKnowledge: loadCommonKnowledge,
    saveCommonKnowledge: saveCommonKnowledge,
    promoteKnowledge: promoteKnowledge,
    depromoteKnowledge: depromoteKnowledge,
    getCommonKnowledgeForMate: getCommonKnowledgeForMate,
    readCommonKnowledgeFile: readCommonKnowledgeFile,
    isPromoted: isPromoted,
  };
}

module.exports = { attachKnowledge: attachKnowledge };
