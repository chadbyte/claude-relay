// git-agent-sessions.js — agent handoffs launched from the Git surface.
//
// Extracted from git-panel.js so that module stays under the size limit while
// the Git data path (one status reading, one summary reading, one placard)
// remains in a single place. This module owns only the "hand this over to a
// focused agent session" concern, plus the small path/title helpers those
// prompts and the panel's own file rows share, so neither is defined twice.

import { store } from './store.js';
import { showToast } from './utils.js';
import { sendTextMessage } from './input.js';
import { resolveDefaultVendor, startNewSession } from './sidebar-sessions.js';
import { getWs } from './ws-ref.js';

export function splitFilePath(filePath) {
  var slash = filePath.lastIndexOf("/");
  if (slash === -1) return { name: filePath, dir: "" };
  return { name: filePath.slice(slash + 1), dir: filePath.slice(0, slash + 1) };
}

export function compactSessionTitle(title) {
  var value = String(title || "Agent session").replace(/\s+/g, " ").trim();
  if (/^Review the current uncommitted changes/i.test(value)) return "File review";
  if (/^Create a Git commit for the currently staged changes/i.test(value)) return "Commit session";
  return value;
}

// Close the Git surface through its own close control, which owns the panel's
// exit animation and the return to the sessions panel. Going through the
// existing control keeps one lifecycle rather than a second teardown path.
export function closeGitSurface() {
  var gitPanel = document.getElementById("sidebar-panel-git");
  var closeBtn = document.getElementById("git-panel-close");
  if (closeBtn && gitPanel && !gitPanel.classList.contains("hidden")) closeBtn.click();
}

function startFocusedAgentSession(prompt, successMessage, sessionTitle) {
  if (!store.get('connected')) {
    showToast("Not connected — agent session was not started.", "warn");
    return;
  }
  var previousSessionId = store.get('activeSessionId');
  var unsubscribe = null;
  var sessionReady = false;
  var timer = setTimeout(function () {
    if (unsubscribe) unsubscribe();
    showToast("Agent session could not be started", "warn");
  }, 10000);
  unsubscribe = store.subscribe(function (state) {
    if (sessionReady || !state.activeSessionId || state.activeSessionId === previousSessionId) return;
    sessionReady = true;
    clearTimeout(timer);
    setTimeout(function () {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      var newSessionId = store.get('activeSessionId');
      var ws = getWs();
      if (sessionTitle && ws && ws.readyState === WebSocket.OPEN && newSessionId) {
        ws.send(JSON.stringify({ type: "rename_session", id: newSessionId, title: sessionTitle }));
      }
      closeGitSurface();
      if (sendTextMessage(prompt)) showToast(successMessage || "Agent session started");
    }, 0);
  });
  startNewSession(resolveDefaultVendor(), { mode: "gui", forceNew: true });
}

export function startAgentCommitSession(stagedCount) {
  if (!stagedCount) return;
  var prompt = "Create a Git commit for the currently staged changes.\n\n" +
    "Inspect `git diff --cached` and the repository instructions before committing. " +
    "Commit exactly the staged changes; do not stage additional files. " +
    "Write a concise Angular Commit Convention message, use the angular-commit skill, " +
    "and do not add Co-Authored-By lines. If nothing is staged, explain that and stop.";
  startFocusedAgentSession(prompt, "Commit session started", "Commit staged changes");
}

export function startAgentFileReview(filePath) {
  var prompt = "Review the current uncommitted changes in `" + filePath + "`.\n\n" +
    "Inspect the Git diff and relevant repository context. Explain the intent of the change, " +
    "identify correctness or regression risks, and suggest specific improvements. " +
    "Do not edit files or run Git actions unless I ask in this session.";
  var parts = splitFilePath(filePath);
  startFocusedAgentSession(prompt, "File review session started", "Review · " + parts.name);
}
