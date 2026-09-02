// Comment and review projection for Project Logs.
//
// Split from project-logs-store.js so the store stays inside the module size
// limit.
//
// A user comment is a revision proposal, never an automatic canonical
// mutation. It starts `pending` and stays that way until the project's own
// Driver session reviews it. Reviews are append-only records that reference a
// comment id; nothing is ever edited in place, and a comment written before
// reviews existed simply projects as `pending`.

var STATUS_PENDING = "pending";
var STATUS_CLARIFICATION = "clarification-needed";
var STATUS_INCORPORATED = "incorporated";
var STATUS_DECLINED = "declined";

var STATUSES = [STATUS_PENDING, STATUS_CLARIFICATION, STATUS_INCORPORATED, STATUS_DECLINED];

// Actions the Driver may take. `incorporate` is the only one that produces a
// canonical revision.
var ACTIONS = ["incorporate", "clarify", "decline"];

var ACTION_STATUS = {
  incorporate: STATUS_INCORPORATED,
  clarify: STATUS_CLARIFICATION,
  decline: STATUS_DECLINED,
};

// Waiting on the Driver. Only an unreviewed comment qualifies.
//
// A clarification is deliberately NOT Driver work: the Driver has already
// answered, and the ball is with the user. Because a comment is settled once
// and never re-reviewed, counting a clarification as pending would leave it in
// the queue forever with no way out. The user's reply is a new comment, which
// is pending in its own right and can be incorporated or declined.
function isPendingReview(status) {
  return status === STATUS_PENDING;
}

// Answered by the Driver and now waiting on the person who commented. Shown
// permanently on the original comment; never counted as Driver work.
function isAwaitingUser(status) {
  return status === STATUS_CLARIFICATION;
}

function isAction(value) {
  return ACTIONS.indexOf(value) !== -1;
}

// Project the comment thread of one entry, folding review records onto the
// comments they resolve. `revisionForRecordId` maps an incorporating review
// record id to the canonical revision number it produced, so an incorporated
// comment can point at its result.
function comments(chain, options) {
  var settings = options || {};
  var maxComments = settings.maxComments || 200;
  var revisionForRecordId = settings.revisionForRecordId || {};
  var byId = {};
  var order = [];

  var i;
  for (i = 0; i < chain.length; i++) {
    var record = chain[i];
    if (record.op !== "comment") continue;
    if (order.length >= maxComments) break;
    var comment = {
      id: record.id,
      body: record.body || "",
      at: record.at || 0,
      author: record.author || null,
      // A comment with no review yet is pending, which is also how every
      // comment written before reviews existed projects.
      status: STATUS_PENDING,
      review: null,
    };
    byId[record.id] = comment;
    order.push(comment);
  }

  for (i = 0; i < chain.length; i++) {
    var review = chain[i];
    if (review.op !== "review") continue;
    var target = byId[review.commentId];
    if (!target) continue;
    if (!isAction(review.action)) continue;
    // Append-only: the first review of a comment settles it. A later review of
    // the same comment is ignored rather than silently overwriting the record
    // of what was decided.
    if (target.review) continue;
    target.status = ACTION_STATUS[review.action];
    target.review = {
      action: review.action,
      response: typeof review.response === "string" ? review.response : "",
      at: review.at || 0,
      reviewer: review.author || null,
      revision: review.action === "incorporate"
        ? (revisionForRecordId[review.id] || null)
        : null,
    };
  }

  return order;
}

// How many comments are still waiting on the Driver. Used for the ledger row
// count and for the system-prompt signal, neither of which carries any body.
function pendingReviewCount(list) {
  var count = 0;
  for (var i = 0; i < (list || []).length; i++) {
    if (isPendingReview(list[i].status)) count++;
  }
  return count;
}

function pendingReviewComments(list) {
  var out = [];
  for (var i = 0; i < (list || []).length; i++) {
    if (isPendingReview(list[i].status)) out.push(list[i]);
  }
  return out;
}

module.exports = {
  STATUS_PENDING: STATUS_PENDING,
  STATUS_CLARIFICATION: STATUS_CLARIFICATION,
  STATUS_INCORPORATED: STATUS_INCORPORATED,
  STATUS_DECLINED: STATUS_DECLINED,
  STATUSES: STATUSES,
  ACTIONS: ACTIONS,
  ACTION_STATUS: ACTION_STATUS,
  isPendingReview: isPendingReview,
  isAwaitingUser: isAwaitingUser,
  isAction: isAction,
  comments: comments,
  pendingReviewCount: pendingReviewCount,
  pendingReviewComments: pendingReviewComments,
};
