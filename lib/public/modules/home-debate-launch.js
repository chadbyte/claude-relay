// Transient launch presentation for a new Home debate-planning conversation.

import { createHomeDebateActivityRow, resetHomeDebateActivityAnnouncement } from './home-debate-activity.js';

var pendingRequestId = null;

export function beginHomeDebateLaunch(requestId) {
  resetHomeDebateActivityAnnouncement("home-debate-activity-launch");
  pendingRequestId = requestId || null;
}

export function resetHomeDebateLaunch() {
  pendingRequestId = null;
  resetHomeDebateActivityAnnouncement("home-debate-activity-launch");
}

export function settleHomeDebateLaunch(msg) {
  if (!pendingRequestId || !msg || msg.requestId !== pendingRequestId) return false;
  pendingRequestId = null;
  resetHomeDebateActivityAnnouncement("home-debate-activity-launch");
  return true;
}

export function syncHomeDebateLaunchHistory(msg) {
  if (!msg) return false;
  var hasMessages = Array.isArray(msg.messages) && msg.messages.length > 0;
  if (msg.debatePlanning === true && !hasMessages) {
    if (!pendingRequestId) resetHomeDebateActivityAnnouncement("home-debate-activity-launch");
    pendingRequestId = msg.requestId || "restored-debate-planning";
    return true;
  }
  return settleHomeDebateLaunch(msg);
}

export function isHomeDebateLaunching() {
  return !!pendingRequestId;
}

export function createHomeDebateLaunchRow() {
  return createHomeDebateActivityRow("Preparing your debate", "Clay is preparing your debate", "home-debate-activity-launch");
}
