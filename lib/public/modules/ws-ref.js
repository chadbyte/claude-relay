// ws-ref.js - Shared WebSocket reference
// Infrastructure singleton, not state. Lives outside the store.

var _ws = null;

export function getWs() { return _ws; }
export function setWs(v) { _ws = v; }
