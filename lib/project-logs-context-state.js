// Append-only lifecycle projection for worktree-scoped Project Log entries.

var recordStore = require("./knowledge-record-store");
var logContext = require("./project-log-context");

function attachContextState(store, scopeId) {
  function states() {
    var out = {};
    var records = store.all();
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.op !== "context-state" || !record.changeSetId) continue;
      if (record.status !== "archived" && record.status !== "merged" && record.status !== "active") continue;
      out[record.changeSetId] = record.status;
    }
    return out;
  }

  function set(context, status) {
    var normalized = logContext.normalizeRecordContext(context);
    if (!normalized.changeSetId) return false;
    if (status !== "active" && status !== "archived" && status !== "merged") {
      throw new Error("Invalid Project Log change-set status.");
    }
    if (states()[normalized.changeSetId] === status) return false;
    store.append({
      id: recordStore.newRecordId(),
      rootId: "context-" + normalized.changeSetId,
      op: "context-state",
      scope: scopeId,
      changeSetId: normalized.changeSetId,
      status: status,
      context: normalized,
      at: Date.now(),
    });
    return true;
  }

  return { states: states, set: set };
}

module.exports = { attachContextState: attachContextState };
