# Codex Adapter Integration Status

> Codex adapter for YOKE, enabling OpenAI Codex as an alternative harness provider in Clay.

---

## Current State (2026-04-17)

### What's done
- Codex adapter exists at `lib/yoke/adapters/codex.js` (602 lines)
- Uses `@openai/codex-sdk` package (already in package.json)
- Implements full YOKE interface: Adapter + QueryHandle
- Event flattening: Codex ThreadEvent -> yokeType normalized events
- Multi-turn conversation loop via `thread.runStreamed()`
- Model list updated to current Codex models

### What's broken
- **First test failed** with `o4-mini` model (not supported on ChatGPT Pro accounts)
- Fixed default model to `gpt-5.4`, but untested
- `Reading prompt from stdin...` error suggests possible issue with how messages are passed to `thread.runStreamed()`
- Need to verify `runStreamed` API signature matches installed SDK version

### How to test
1. Ensure `codex login` is done (auth token at `~/.codex/auth.json`)
2. In `lib/project.js` line 163, change vendor:
   ```js
   var adapter = yoke.createAdapter({ vendor: "codex", cwd: cwd });
   ```
3. Restart server, open new session, send a message
4. Watch server console for `[yoke/codex]` logs

### Current vendor switch (temporary)
`lib/project.js:163` is currently set to `vendor: "codex"` for testing. Change back to `"claude"` when done.

---

## Available Models (from developers.openai.com/codex)

| Model | Description | Capability | Speed | ChatGPT Pro |
|-------|-------------|-----------|-------|-------------|
| **gpt-5.4** | Flagship frontier model | 5/5 | 3/5 | Yes |
| **gpt-5.4-mini** | Fast mini model for subagents | 3/5 | 4/5 | Yes |
| **gpt-5.3-codex** | Industry-leading coding model | 5/5 | 3/5 | Yes (Cloud) |
| **gpt-5.3-codex-spark** | Near-instant real-time coding | 3/5 | 5/5 | Pro only |
| **gpt-5.2** | Previous gen coding model | 4/5 | 3/5 | Yes |

**Note:** `o4-mini`, `o3`, `codex-mini` are API-only models. ChatGPT Pro accounts cannot use them.

---

## Authentication

Two methods:
1. **ChatGPT sign-in** (for Pro/Plus/Enterprise users): `codex login` -> browser OAuth -> token saved to `~/.codex/auth.json`
2. **API key** (for pay-per-use): Set `OPENAI_API_KEY` env var or pass via `adapterOptions.CODEX.apiKey`

ChatGPT sign-in gives access to "fast mode" and ChatGPT credit features. API key uses standard API pricing.

---

## SDK API Reference (from docs + source)

```js
// Create instance
var Codex = require("@openai/codex-sdk").Codex;
var codex = new Codex();

// Start thread
var thread = codex.startThread({ model: "gpt-5.4", workingDirectory: "/path" });

// Resume thread
var thread2 = codex.resumeThread(threadId, opts);

// Run (blocking)
var result = await thread.run("prompt text");

// Run streamed (returns async iterable of events)
var streamResult = await thread.runStreamed("prompt text", { signal: abortController.signal });
for await (var evt of streamResult.events) {
  // evt.type: thread.started, turn.started, turn.completed, turn.failed,
  //           item.started, item.updated, item.completed, error
  // evt.item.type: agent_message, reasoning, command_execution, file_change,
  //               mcp_tool_call, web_search, todo_list, error
}
```

---

## Known Issues to Investigate

1. **stdin prompt error**: `Codex Exec exited with code 1: Reading prompt from stdin...`
   - Might be that `runStreamed` first arg needs to be a string, not an object
   - Check what `pushMessage` passes as `initialMessage` to `runQueryLoop`
   - The adapter's `pushMessage` sends either a string or array of objects depending on images

2. **Thread options**: SDK docs show `startThread()` with no args in TS, but `thread_start(model="gpt-5.4")` in Python. Verify which options `startThread` actually accepts in the JS SDK.

3. **Approval flow**: Codex uses `approvalPolicy` ("never", "on-failure", "always") instead of Claude's tool permission model. The adapter maps `toolPolicy: "allow-all"` -> `approvalPolicy: "never"`. Need to verify "on-failure" is correct default.

4. **Image support**: Currently text-only. Comment in code: `// Codex supports local_image with path, not base64`

5. **Session management**: `getSessionInfo`, `listSessions` return null/empty. Codex stores sessions in `~/.codex/sessions` but no programmatic API to query.

---

## Architecture

```
lib/yoke/
  index.js              - createAdapter({ vendor: "codex" })
  interface.js          - Adapter / QueryHandle contract
  adapters/
    codex.js            - Codex adapter (this file)
    claude.js           - Claude adapter (1,418 lines, reference implementation)
    gemini.js           - Gemini adapter (668 lines)

lib/sdk-bridge.js       - Uses adapter.createQuery(), iterates yokeType events
lib/sdk-message-processor.js - Processes yokeType events into Clay WS messages
lib/project.js:163      - vendor selection (hardcoded for now)
```

### Event flow
```
Codex SDK ThreadEvent
  -> codex.js flattenEvent() -> yokeType events
    -> sdk-bridge.js processQueryStream()
      -> sdk-message-processor.js -> Clay WebSocket messages
        -> browser
```

---

## Next Steps

1. Fix the `Reading prompt from stdin` error (likely message format issue)
2. Get a basic prompt-response working
3. Test tool use (file edits, bash commands)
4. Test multi-turn conversation
5. Add vendor selection to UI (currently hardcoded in project.js)
6. Handle Codex-specific capabilities (sandbox mode, approval policy)
