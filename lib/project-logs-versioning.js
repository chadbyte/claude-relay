// Comment review and revision control for Project Logs.
//
// Split from project-logs-store.js so the store stays inside the module size
// limit. Everything here is Project Driver territory: reviewing a user comment
// and moving the canonical record between revisions. The authorization layer
// decides who may call these; this module only guarantees the record shape.

var logsSchema = require("./project-logs-schema");
var logsSnapshot = require("./project-logs-snapshot");
var logsComments = require("./project-logs-comments");
var recordStore = require("./knowledge-record-store");
var logContext = require("./project-log-context");

function attachVersioning(ctx) {
  var read = ctx.read;
  var requireLive = ctx.requireLive;
  var findChain = ctx.findChain;
  var appendRevision = ctx.appendRevision;
  var nextSnapshot = ctx.nextSnapshot;
  var cleanText = ctx.cleanText;
  var MAX_LINKS = ctx.maxLinks;
  var MAX_RESPONSE_CHARS = ctx.maxResponseChars;
  var scopeId = ctx.scopeId;
  var store = ctx.store;
  var normalizeAuthor = ctx.normalizeAuthor;

  // Review a user comment. `clarify` and `decline` resolve the comment and
  // create no canonical revision. `incorporate` appends exactly one record that
  // both resolves the comment and carries the new canonical snapshot, so the
  // two can never drift apart.
  function review(ref, input, author, context) {
    var located = requireLive(ref);
    var data = input || {};
    if (!logsComments.isAction(data.action)) {
      throw new Error("A review action is required: " + logsComments.ACTIONS.join(", "));
    }
    var entry = read(ref, false);
    var target = null;
    for (var i = 0; i < entry.comments.length; i++) {
      if (entry.comments[i].id === data.commentId) { target = entry.comments[i]; break; }
    }
    if (!target) throw new Error("Comment not found on this entry.");
    if (target.review) throw new Error("That comment has already been reviewed.");

    var response = cleanText(data.response || "", MAX_RESPONSE_CHARS);
    if (data.action !== "incorporate" && !response) {
      throw new Error("A " + data.action + " review requires a response explaining the decision.");
    }

    if (data.action !== "incorporate") {
      store.append({
        id: recordStore.newRecordId(),
        rootId: located.rootId,
        op: "review",
        scope: scopeId,
        action: data.action,
        commentId: data.commentId,
        response: response,
        author: normalizeAuthor(author),
        context: logContext.normalizeRecordContext(context),
        at: Date.now(),
      });
      return read(ref, false);
    }

    var validated = logsSchema.validateRevision(data);
    var current = logsSnapshot.cloneSnapshot(entry);
    var snapshot = nextSnapshot(current, validated, data);
    if (logsSnapshot.sameSnapshot(current, snapshot)) {
      throw new Error("Incorporating a comment requires an actual canonical change.");
    }
    appendRevision(located.rootId, "review", snapshot, author, {
      action: "incorporate",
      commentId: data.commentId,
      response: response,
      context: logContext.normalizeRecordContext(context),
    });
    return read(ref, false);
  }

  // Restore an earlier revision by appending a new one. Later history is never
  // erased: a revert is itself a revision, with the source recorded.
  function revert(ref, revision, reason, author, context) {
    var located = requireLive(ref);
    var target = Number(revision);
    if (!Number.isInteger(target) || target < 1) throw new Error("A revision number is required.");
    var trimmedReason = cleanText(reason || "", MAX_RESPONSE_CHARS);
    if (!trimmedReason) throw new Error("A revert requires a reason.");

    var history = logsSnapshot.revisions(located.chain, MAX_LINKS);
    if (target > history.revisions.length) {
      throw new Error("This entry has only " + history.revisions.length + " revisions.");
    }
    var source = history.revisions[target - 1];
    var current = history.revisions[history.revisions.length - 1];
    if (logsSnapshot.sameSnapshot(current.snapshot, source.snapshot)) {
      throw new Error("Revision " + target + " is identical to the current one.");
    }
    appendRevision(located.rootId, "revert", logsSnapshot.cloneSnapshot(source.snapshot), author, {
      revertedFrom: target,
      reason: trimmedReason,
      context: logContext.normalizeRecordContext(context),
    });
    return read(ref, false);
  }

  // The exact reconstructed snapshot as of one revision.
  function readRevision(ref, revision) {
    var located = findChain(ref);
    if (!located) throw new Error("Log entry not found.");
    var target = Number(revision);
    if (!Number.isInteger(target) || target < 1) throw new Error("A revision number is required.");
    var history = logsSnapshot.revisions(located.chain, MAX_LINKS);
    if (target > history.revisions.length) {
      throw new Error("This entry has only " + history.revisions.length + " revisions.");
    }
    var found = history.revisions[target - 1];
    var described = logsSnapshot.describeRevision(found);
    described.ref = ref;
    described.snapshot = found.snapshot;
    return described;
  }


  return {
    review: review,
    revert: revert,
    readRevision: readRevision,
  };
}

module.exports = { attachVersioning: attachVersioning };
