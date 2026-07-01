// What's New service: joins the static content registry with per-user
// "seen" state. The client viewer is content-agnostic; this is where the
// two halves meet on the server.

var content = require("./whats-new-content");
var users = require("./users");

function listEntries() {
  return content.ENTRIES.slice();
}

function getUnseenForUser(userId) {
  if (!userId) return [];
  var seen = (typeof users.getWhatsNewSeenIds === "function") ? users.getWhatsNewSeenIds(userId) : [];
  return content.ENTRIES.filter(function (e) {
    return e && e.id && seen.indexOf(e.id) === -1;
  });
}

// Combined state for the client: the full entries list (so the home
// feed can render previously-dismissed items) plus the subset of ids
// the user has not yet dismissed (so the carousel only auto-pops the
// unseen ones).
function getStateForUser(userId) {
  var entries = content.ENTRIES.slice();
  var seen = (typeof users.getWhatsNewSeenIds === "function" && userId) ? users.getWhatsNewSeenIds(userId) : [];
  var unseenIds = [];
  for (var i = 0; i < entries.length; i++) {
    // popup:false entries stay in the home feed (entries) as history but never
    // auto-pop in the carousel, so superseded announcements don't resurface.
    if (entries[i] && entries[i].popup === false) continue;
    if (entries[i] && entries[i].id && seen.indexOf(entries[i].id) === -1) {
      unseenIds.push(entries[i].id);
    }
  }
  return { entries: entries, unseenIds: unseenIds };
}

function markSeen(userId, entryId) {
  if (!userId || !entryId) return { error: "missing" };
  if (typeof users.markWhatsNewSeen !== "function") return { error: "unsupported" };
  // Reject ids the server doesn't know about so a malformed client can't
  // pollute the seen-list with arbitrary strings.
  var known = false;
  for (var i = 0; i < content.ENTRIES.length; i++) {
    if (content.ENTRIES[i] && content.ENTRIES[i].id === entryId) { known = true; break; }
  }
  if (!known) return { error: "unknown_entry" };
  return users.markWhatsNewSeen(userId, entryId);
}

module.exports = {
  listEntries: listEntries,
  getUnseenForUser: getUnseenForUser,
  getStateForUser: getStateForUser,
  markSeen: markSeen,
};
