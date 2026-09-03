// git-placard.js — compact always-visible repository placard.
//
// Git is no longer a tool-palette tile. Instead, a real Git repository gets a
// quiet placard directly under the tool strip in the project sidebar: repo
// identity, current branch, and a bounded status glance. The placard is a
// projection, never a second source of truth — git-panel.js owns the fetch and
// hands data here, so there is exactly one Git request path in the client.
//
// The placard renders only server-derived, bounded fields. It never receives or
// renders a repository path, and it stays hidden entirely until a real
// repository is confirmed, so a non-Git project, an unavailable worktree, a
// Home/Mate surface, or a still-pending detection shows nothing at all rather
// than an empty placeholder.

import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var lastRenderedHtml = "";
var lastRenderedLabel = "";

function countChangedFiles(files) {
  var counts = { changed: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  var list = Array.isArray(files) ? files : [];
  counts.changed = list.length;
  for (var i = 0; i < list.length; i++) {
    var file = list[i];
    if (file.conflicted) counts.conflicted++;
    if (file.untracked) counts.untracked++;
    if (file.staged) counts.staged++;
    if (file.unstaged && !file.untracked) counts.unstaged++;
  }
  return counts;
}

// Fold a full panel status into the placard shape. The panel status is the
// fresher, more authoritative reading whenever it is available, so it wins for
// branch and counts. `remote` is kept from the last server summary because the
// label is derived server-side; the client never parses a remote URL itself.
export function mergeStatusIntoSummary(status, previous) {
  if (!status || !status.isRepository) return null;
  var base = previous || {};
  var counts = countChangedFiles(status.files);
  return {
    isRepository: true,
    name: status.name || base.name || null,
    branch: status.detached ? null : (status.branch || null),
    detached: !!status.detached,
    shortOid: status.oid ? String(status.oid).slice(0, 8) : (base.shortOid || null),
    isWorktree: !!status.isWorktree,
    hasUpstream: !!status.upstream,
    ahead: status.ahead || 0,
    behind: status.behind || 0,
    changed: counts.changed,
    staged: counts.staged,
    unstaged: counts.unstaged,
    untracked: counts.untracked,
    conflicted: counts.conflicted,
    remote: base.remote || null,
  };
}

function branchLabel(summary) {
  if (summary.detached) return summary.shortOid ? "Detached at " + summary.shortOid : "Detached HEAD";
  return summary.branch || "No commits yet";
}

function changeLabel(summary) {
  if (summary.conflicted > 0) {
    return summary.conflicted + " conflicted";
  }
  if (summary.changed > 0) {
    return summary.changed + " changed";
  }
  return "Clean";
}

// One plain-text sentence for assistive technology. The rendered rows are
// marked aria-hidden so the group is announced once, in full, rather than as a
// stream of bare numbers and glyphs.
export function accessibleLabel(summary) {
  if (!summary || !summary.isRepository) return "";
  var parts = ["Repository " + (summary.name || "unknown")];
  parts.push(summary.detached ? branchLabel(summary) : "branch " + branchLabel(summary));
  if (summary.isWorktree) parts.push("linked worktree");
  parts.push(summary.changed > 0 ? changeLabel(summary) + " files" : "working tree clean");
  if (summary.hasUpstream && summary.ahead > 0) parts.push(summary.ahead + " ahead");
  if (summary.hasUpstream && summary.behind > 0) parts.push(summary.behind + " behind");
  if (summary.remote) parts.push("remote " + summary.remote);
  return parts.join(", ");
}

function metaHtml(summary) {
  var html = "";
  if (summary.isWorktree) html += '<span class="git-placard-badge">Linked worktree</span>';
  if (summary.detached) html += '<span class="git-placard-badge git-placard-badge-warn">Detached</span>';

  var stateClass = "git-placard-stat";
  if (summary.conflicted > 0) stateClass += " git-placard-stat-warn";
  else if (summary.changed > 0) stateClass += " git-placard-stat-active";
  html += '<span class="' + stateClass + '">' + escapeHtml(changeLabel(summary)) + '</span>';

  if (summary.hasUpstream && summary.ahead > 0) {
    html += '<span class="git-placard-stat" title="' + summary.ahead + ' to push">' +
      iconHtml("arrow-up") + summary.ahead + '</span>';
  }
  if (summary.hasUpstream && summary.behind > 0) {
    html += '<span class="git-placard-stat" title="' + summary.behind + ' to pull">' +
      iconHtml("arrow-down") + summary.behind + '</span>';
  }
  return '<div class="git-placard-meta">' + html + '</div>';
}

function placardHtml(summary) {
  var html = '<div class="git-placard-identity">' +
    '<span class="git-placard-glyph">' + iconHtml("git-branch") + '</span>' +
    '<span class="git-placard-names">' +
      '<span class="git-placard-repo">' + escapeHtml(summary.name || "Repository") + '</span>' +
      '<span class="git-placard-branch">' + escapeHtml(branchLabel(summary)) + '</span>' +
    '</span>' +
  '</div>';
  html += metaHtml(summary);
  if (summary.remote) {
    html += '<div class="git-placard-remote">' + iconHtml("cloud") +
      '<span>' + escapeHtml(summary.remote) + '</span></div>';
  }
  return html;
}

export function hideGitPlacard() {
  var el = document.getElementById("git-placard");
  var body = document.getElementById("git-placard-body");
  lastRenderedHtml = "";
  lastRenderedLabel = "";
  if (body) body.innerHTML = "";
  if (el) {
    el.classList.add("hidden");
    el.removeAttribute("aria-label");
  }
}

export function renderGitPlacard(summary) {
  var el = document.getElementById("git-placard");
  var body = document.getElementById("git-placard-body");
  if (!el || !body) return;
  if (!summary || !summary.isRepository) {
    hideGitPlacard();
    return;
  }
  var html = placardHtml(summary);
  if (html !== lastRenderedHtml) {
    body.innerHTML = html;
    lastRenderedHtml = html;
    refreshIcons();
  }
  var label = accessibleLabel(summary);
  if (label !== lastRenderedLabel) {
    el.setAttribute("aria-label", label);
    lastRenderedLabel = label;
  }
  el.classList.remove("hidden");
}
