// Background task start-time tracking.
//
// Vendors report background tasks as a full replacement list on every change
// and none of them carries a reliable start time today (see
// normalizeBackgroundTasks in yoke/adapters/claude.js and mapTerminals in
// yoke/codex-background-tasks.js). The session's previous list is the only
// place that knows when a task was first seen, so the merge belongs here,
// where that list is maintained, rather than in an adapter that rebuilds the
// array from scratch each time.
//
// A vendor-supplied timestamp always wins when present; otherwise a task is
// stamped the first time it appears and keeps that stamp for its whole life.

// Accepts epoch milliseconds, epoch seconds, or an ISO date string, since
// vendors are not consistent. Returns null for anything unusable so the
// caller falls back to first-seen stamping instead of rendering 1970.
function normalizeTimestamp(value) {
  if (typeof value === "number" && isFinite(value) && value > 0) {
    // Values this small are epoch seconds, not milliseconds.
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string" && value) {
    var parsed = Date.parse(value);
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

function vendorStartedAt(task) {
  if (!task) return null;
  return normalizeTimestamp(task.started_at)
    || normalizeTimestamp(task.startedAt)
    || normalizeTimestamp(task.createdAt)
    || normalizeTimestamp(task.created_at);
}

/**
 * Return `nextTasks` with a `started_at` (epoch ms) on every entry.
 * Tasks already present in `previousTasks` keep their original stamp so the
 * elapsed time does not reset every time the list is re-emitted.
 */
function mergeStartTimes(previousTasks, nextTasks, now) {
  if (!Array.isArray(nextTasks)) return [];
  var stampedAt = typeof now === "number" ? now : Date.now();
  // Stamps we wrote on a previous pass are already epoch milliseconds, so they
  // are read as-is. Only vendor-supplied values go through normalizeTimestamp,
  // whose seconds-vs-milliseconds heuristic would otherwise be re-applied to
  // our own output.
  var known = {};
  var previous = Array.isArray(previousTasks) ? previousTasks : [];
  for (var p = 0; p < previous.length; p++) {
    var seen = previous[p];
    if (!seen || !seen.task_id) continue;
    if (typeof seen.started_at === "number" && isFinite(seen.started_at) && seen.started_at > 0) {
      known[seen.task_id] = seen.started_at;
    }
  }

  var merged = [];
  for (var i = 0; i < nextTasks.length; i++) {
    var task = nextTasks[i];
    if (!task) continue;
    var startedAt = vendorStartedAt(task) || known[task.task_id] || stampedAt;
    merged.push(Object.assign({}, task, { started_at: startedAt }));
  }
  return merged;
}

module.exports = {
  mergeStartTimes: mergeStartTimes,
  normalizeTimestamp: normalizeTimestamp,
};
