// Correlate a confirmed draft-model update with the exact active Home session.

export function confirmedHomeSessionModel(active, message) {
  if (!active || !message || message.sessionApplied !== true) return null;
  if (!active.mateId || message.mateId !== active.mateId) return null;
  if (!active.sessionId || (message.sessionId !== active.sessionId && message.requestedSessionId !== active.sessionId)) return null;
  if (!message.sessionId || !message.sessionModel || !message.sessionVendor) return null;
  return {
    sessionId: message.sessionId,
    vendor: message.sessionVendor,
    model: message.sessionModel,
  };
}
