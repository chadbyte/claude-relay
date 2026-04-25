var fs = require("fs");
var path = require("path");

/**
 * Attach knowledge file management to a project context.
 *
 * ctx fields:
 *   cwd, isMate, sendTo, matesModule, projectOwnerId
 */
function attachKnowledge(ctx) {
  var cwd = ctx.cwd;
  var isMate = ctx.isMate;
  var sendTo = ctx.sendTo;
  var matesModule = ctx.matesModule;
  var getProjectOwnerId = ctx.getProjectOwnerId;

  function listKnowledgeFiles() {
    var knowledgeDir = path.join(cwd, "knowledge");
    var files = [];
    try {
      var entries = fs.readdirSync(knowledgeDir);
      for (var ki = 0; ki < entries.length; ki++) {
        if (entries[ki] === "session-digests.jsonl") continue;
        if (entries[ki] === "sticky-notes.md") continue;
        if (entries[ki] === "memory-summary.md") continue;
        if (entries[ki].endsWith(".md") || entries[ki].endsWith(".jsonl")) {
          var stat = fs.statSync(path.join(knowledgeDir, entries[ki]));
          files.push({ name: entries[ki], size: stat.size, mtime: stat.mtimeMs, common: false });
        }
      }
    } catch (e) { /* dir may not exist */ }
    files.sort(function (a, b) { return b.mtime - a.mtime; });

    if (isMate) {
      var mateCtx = matesModule.buildMateCtx(getProjectOwnerId());
      var thisMateId = path.basename(cwd);
      for (var pi = 0; pi < files.length; pi++) {
        files[pi].promoted = matesModule.isPromoted(mateCtx, thisMateId, files[pi].name);
      }
      var commonFiles = matesModule.getCommonKnowledgeForMate(mateCtx, thisMateId);
      for (var ci = 0; ci < commonFiles.length; ci++) {
        if (commonFiles[ci].ownMateId !== thisMateId) {
          files.push(commonFiles[ci]);
        }
      }
    }
    return files;
  }

  function listKnowledgeFilesBasic() {
    var knowledgeDir = path.join(cwd, "knowledge");
    var files = [];
    try {
      var entries = fs.readdirSync(knowledgeDir);
      for (var ki = 0; ki < entries.length; ki++) {
        if (entries[ki].endsWith(".md") || entries[ki].endsWith(".jsonl")) {
          var stat = fs.statSync(path.join(knowledgeDir, entries[ki]));
          files.push({ name: entries[ki], size: stat.size, mtime: stat.mtimeMs });
        }
      }
    } catch (e) {}
    files.sort(function (a, b) { return b.mtime - a.mtime; });
    if (isMate) {
      var mateCtx = matesModule.buildMateCtx(getProjectOwnerId());
      var thisMateId = path.basename(cwd);
      for (var pi = 0; pi < files.length; pi++) {
        files[pi].common = false;
        files[pi].promoted = matesModule.isPromoted(mateCtx, thisMateId, files[pi].name);
      }
      var commonFiles = matesModule.getCommonKnowledgeForMate(mateCtx, thisMateId);
      for (var ci = 0; ci < commonFiles.length; ci++) {
        if (commonFiles[ci].ownMateId !== thisMateId) files.push(commonFiles[ci]);
      }
    }
    return files;
  }

  function handleKnowledgeMessage(ws, msg) {
    if (msg.type === "knowledge_list") {
      sendTo(ws, { type: "knowledge_list", files: listKnowledgeFiles() });
      return true;
    }

    if (msg.type === "knowledge_read") {
      if (!msg.name) return true;
      var safeName = path.basename(msg.name);
      if (msg.common && msg.ownMateId && isMate) {
        var mateCtx = matesModule.buildMateCtx(getProjectOwnerId());
        try {
          var content = matesModule.readCommonKnowledgeFile(mateCtx, msg.ownMateId, safeName);
          sendTo(ws, { type: "knowledge_content", name: safeName, content: content, common: true, ownMateId: msg.ownMateId });
        } catch (e) {
          sendTo(ws, { type: "knowledge_content", name: safeName, content: "", error: "File not found", common: true });
        }
      } else {
        var filePath = path.join(cwd, "knowledge", safeName);
        try {
          var content = fs.readFileSync(filePath, "utf8");
          sendTo(ws, { type: "knowledge_content", name: safeName, content: content });
        } catch (e) {
          sendTo(ws, { type: "knowledge_content", name: safeName, content: "", error: "File not found" });
        }
      }
      return true;
    }

    if (msg.type === "knowledge_save") {
      if (!msg.name || typeof msg.content !== "string") return true;
      var safeName = path.basename(msg.name);
      if (!safeName.endsWith(".md") && !safeName.endsWith(".jsonl")) safeName += ".md";
      var knowledgeDir = path.join(cwd, "knowledge");
      fs.mkdirSync(knowledgeDir, { recursive: true });
      fs.writeFileSync(path.join(knowledgeDir, safeName), msg.content);
      sendTo(ws, { type: "knowledge_saved", name: safeName });
      sendTo(ws, { type: "knowledge_list", files: listKnowledgeFilesBasic() });
      return true;
    }

    if (msg.type === "knowledge_delete") {
      if (!msg.name) return true;
      var safeName = path.basename(msg.name);
      var filePath = path.join(cwd, "knowledge", safeName);
      try { fs.unlinkSync(filePath); } catch (e) {}
      sendTo(ws, { type: "knowledge_deleted", name: safeName });
      sendTo(ws, { type: "knowledge_list", files: listKnowledgeFilesBasic() });
      return true;
    }

    if (msg.type === "knowledge_promote") {
      if (!isMate || !msg.name) return true;
      var safeName = path.basename(msg.name);
      var mateCtx = matesModule.buildMateCtx(getProjectOwnerId());
      var thisMateId = path.basename(cwd);
      var mate = matesModule.getMate(mateCtx, thisMateId);
      var mateName = (mate && mate.name) || null;
      matesModule.promoteKnowledge(mateCtx, thisMateId, mateName, safeName);
      sendTo(ws, { type: "knowledge_promoted", name: safeName });
      sendTo(ws, { type: "knowledge_list", files: listKnowledgeFiles() });
      return true;
    }

    if (msg.type === "knowledge_depromote") {
      if (!isMate || !msg.name) return true;
      var safeName = path.basename(msg.name);
      var mateCtx = matesModule.buildMateCtx(getProjectOwnerId());
      var thisMateId = path.basename(cwd);
      matesModule.depromoteKnowledge(mateCtx, thisMateId, safeName);
      sendTo(ws, { type: "knowledge_depromoted", name: safeName });
      sendTo(ws, { type: "knowledge_list", files: listKnowledgeFiles() });
      return true;
    }

    return false;
  }

  return {
    handleKnowledgeMessage: handleKnowledgeMessage,
  };
}

module.exports = { attachKnowledge: attachKnowledge };
