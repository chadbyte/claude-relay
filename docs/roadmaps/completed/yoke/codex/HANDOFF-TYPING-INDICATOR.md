# Handoff: Codex Typing Indicator Not Clearing on Abort

## Problem

When user clicks the stop button during Codex message generation, the abort works correctly (turn/interrupt sent, iterator ended, "Interrupted" message shown, send button restored). But the **typing indicator (three dots under "Codex" name)** persists.

## What We Know

### Server side (working correctly)
- `handle.abort()` is called, sends `turn/interrupt` to app-server
- `endIterator()` closes the async iterator
- `processQueryStream` loop exits
- Post-loop code fires: `isProcessing=true taskStopRequested=true`
- Sends these messages to client in order:
  1. `{ type: "status", processing: false }` (via `send()`)
  2. `{ type: "thinking_stop" }` (via `sendAndRecord()`)
  3. `{ type: "info", text: "Conversation interrupted..." }` (via `sendAndRecord()`)
  4. `{ type: "done", code: 0 }` (via `sendAndRecord()`)

### Client side (the bug)
- `done` handler in `app-messages.js` line 852 calls `stopThinking()`, `finalizeAssistantBlock()`, `setStatus("connected")`, etc.
- `stopThinking()` in `tools.js` line 1515 adds `"done"` class to the thinking element
- But the typing indicator (dots animation under vendor name) does NOT clear

### The typing indicator is created by
- `thinking_start` message -> `startThinking()` in `tools.js` line 1437
- `startThinking()` calls `ctx.setActivity("thinking")` which may control the dots
- The dots animation is CSS-based, likely on a `.thinking` or `.typing` class

### What hasn't been checked
1. Whether the `done` message actually arrives at the client (add `console.log` in client's `done` handler)
2. Whether `stopThinking()` is actually called on the client
3. Whether the typing dots are from `startThinking()` or from something else (e.g. the assistant message block placeholder created during `turn_start`)
4. Whether `setActivity(null)` in the `done` handler clears the dots
5. CSS: what class controls the dots animation and what removes it

### Key files to check
- `lib/public/modules/app-messages.js` line 852: `case "done"` handler
- `lib/public/modules/tools.js` line 1437: `startThinking()` - creates thinking dots
- `lib/public/modules/tools.js` line 1515: `stopThinking()` - adds "done" class
- `lib/public/modules/app-favicon.js` line 87-95: `setSendBtnMode()` - controls send/stop button
- `lib/public/modules/app-rendering.js`: `setActivity()` - may control typing indicator
- CSS files for `.thinking`, `.typing`, `.activity-dots` or similar classes

### How Claude handles it
Claude abort works because the SDK stream throws `AbortError`, which is caught by `processQueryStream`'s catch block. The catch block sends `info` + `done`, and the `done` handler on the client clears everything. The exact same `done` handler runs for Codex too, so the question is why it doesn't clear the dots for Codex.

### Likely root cause
The typing dots might be a **separate UI element** from the thinking indicator. There could be:
1. **Thinking dots** (from `startThinking()`) - cleared by `stopThinking()`
2. **Typing/activity dots** (from `setActivity("thinking")` or the assistant message block) - cleared by `setActivity(null)` or `finalizeAssistantBlock()`

If the dots are from source #2 and `setActivity(null)` or `finalizeAssistantBlock()` doesn't work for Codex-specific rendering, that's the bug.

### Quick debug steps
1. Add `console.log("[done] handler fired")` in client's `case "done"` in `app-messages.js`
2. Add `console.log("[stopThinking] called")` in `stopThinking()` in `tools.js`
3. Check browser DevTools: inspect the dots element, find its class, search for what adds/removes that class
4. Compare with Claude: does Claude show the same dots? If yes, what clears them?

## Related context
- Branch: `yoke-mcp`
- Codex adapter uses `codex app-server` protocol (not SDK exec mode)
- `lib/yoke/adapters/codex.js` - the adapter
- `lib/yoke/codex-app-server.js` - app-server process manager
- `lib/sdk-bridge.js` - processes query stream, handles abort post-loop
- `lib/sdk-message-processor.js` - processes individual yokeType events
- `lib/project-sessions.js` line 377 - `type: "stop"` handler sets `taskStopRequested`
