# Phase 3: Implementation (Claude Adapter)

> YOKE interface created. Claude adapter built. All SDK call sites rewired.
> Phase 3 complete (2026-04-11). All 5 sub-steps done.

---

## 0. Sub-steps

Phase 3 is split into 4 sub-steps after review identified gaps in the initial implementation.

| Step | Description | Status |
|------|-------------|--------|
| **3a** | Scaffold `lib/yoke/`, create adapter shell, rewire all `getSDK` call sites, isolate SDK imports | Complete |
| **3b** | Move worker management code (~530 lines) from sdk-bridge.js into claude.js adapter. `adapter.createQuery()` owns both in-process and worker paths. `linuxUser` becomes an adapter option. Clay never decides how to run the query. | Complete |
| **3c** | Make QueryHandle the real abstraction. Remove `_rawQuery`, `_messageQueue`, `_pushRaw`. `processQueryStream` iterates the QueryHandle. Worker QueryHandle yields events from IPC. Both paths produce the same event shape. | Complete |
| **3d** | Event flattening. Adapter flattens deeply nested Claude SDK events into `{ yokeType, ...fields }`. processSDKMessage if-conditions simplify from 3-level nesting to flat yokeType checks. Not a rewrite. Claude-specific logic stays in place for now. | Complete |
| **3e** | Claude assumption cleanup. Block index -> blockId (adapter assigns ID). fast_mode_state already generic. Auth detection stays (needs session context). | Complete |

### Why this order

- **3b before 3c**: QueryHandle cannot hide the worker path until the adapter owns the worker code. Otherwise Clay still has to route `linuxUser` queries to a separate code path in sdk-bridge.
- **3c before 3d**: The iterator must go through QueryHandle before we can flatten events. If processQueryStream still reads `session.queryInstance._rawQuery`, flattening events in the adapter has no effect.
- **3d before 3e**: Flatten first (no behavior change), then move Claude-specific logic (behavior change). If something breaks after 3d, it is the flattening. If something breaks after 3e, it is the Claude assumption removal. Blast radius is isolated.
- **3e before Phase 4**: YOKE must be runtime-neutral before open-source release. An adapter author hitting Claude assumptions on day one is a bad first impression.

### Dependency graph

```
3a (done)
  '-- 3b (done)
        '-- 3c (done)
              '-- 3d (done)
                    '-- 3e (done)
                          '-- Phase 4 (library extract + release)
```

---

## 1. Architecture (Step 3a, current state)

### New files

```
lib/yoke/
  package.json              # name: "yoke", version 0.1.0, ready for npm extract
  index.js                  # public entry: createAdapter(opts) factory
  interface.js              # contract: validateAdapter(), validateQueryHandle(), TOOL_POLICIES
  adapters/
    claude.js               # Claude SDK adapter (all SDK imports live here)
    claude-worker.js        # Worker process for OS-level user isolation (moved from lib/sdk-worker.js)
```

### Interface surface

`interface.js` defines two shapes:

**Adapter** (returned by `createAdapter`):

| Method | Signature | Purpose |
|--------|-----------|---------|
| `vendor` | `string` | Self-identification, e.g. `"claude"` |
| `init(opts)` | `Promise<InitResult>` | Warmup: discover models, skills, capabilities |
| `supportedModels()` | `Promise<string[]>` | Cached model list |
| `createToolServer(def)` | `ToolServer` | Create MCP tool server from agnostic definitions |
| `createQuery(opts)` | `Promise<QueryHandle>` | Start a new query |

Session management (Claude SDK pass-through, not in Phase 2's 11 but needed for full SDK isolation):

| Method | Signature |
|--------|-----------|
| `getSessionInfo(id, opts)` | `Promise<object\|null>` |
| `listSessions(opts)` | `Promise<Array>` |
| `renameSession(id, title, opts)` | `Promise` |
| `forkSession(id, opts)` | `Promise<object>` |

**QueryHandle** (returned by `createQuery`):

| Method | Purpose |
|--------|---------|
| `[Symbol.asyncIterator]()` | Yields SDK events (raw in Phase 3) |
| `pushMessage(text, images)` | Push follow-up user message |
| `setModel(model)` | Change model on active query |
| `setEffort(effort)` | Change effort (stored for next query) |
| `setToolPolicy(policy)` | "ask" or "allow-all" |
| `setPermissionMode(mode)` | Claude-specific (backward compat) |
| `stopTask(taskId)` | Stop sub-agent task |
| `getContextUsage()` | `Promise<object\|null>` |
| `supportedModels()` | `Promise<string[]>` (on stream) |
| `abort()` | Abort via AbortController |
| `close()` | End message queue + close raw query |
| `endInput()` | End message queue only (single-turn) |

### Transition helpers (Phase 3 only)

These exist on QueryHandle for backward compatibility during incremental migration:

- `_rawQuery`: Direct access to the raw SDK query object. Used by `processQueryStream` which still iterates raw events.
- `_messageQueue`: Direct access to the internal message queue. Used by `startQuery` to store on session for idle reaper.
- `_pushRaw(msg)`: Push raw message object (for initial user message in SDK format).

These will be removed when event normalization is added (Phase 4/5).

---

## 2. Key Design Decisions

### Event normalization: Step 3d (remaining)

Phase 2 designed 20 normalized event types. Step 3a does NOT normalize events. The QueryHandle's async iterator yields raw SDK events unchanged. `processSDKMessage` in sdk-message-processor.js continues to consume them as before.

**Problem**: Without normalization, swapping to a second adapter is impossible. processSDKMessage is hardcoded to Claude's event format (content_block_start, content_block_delta, etc.). This MUST be fixed in Phase 3.

**Key insight (from processSDKMessage analysis)**: processSDKMessage is 568 lines, but 99% is Clay business logic (session state, UI messages, push notifications, rate limit handling). There is almost no "translation" code. The Claude-specific part is the **deeply nested if-conditions** that read the raw SDK event format:

```js
// Claude raw: 3-level nesting
if (parsed.type === "stream_event" && parsed.event) {
  if (parsed.event.type === "content_block_delta" && parsed.event.delta) {
    if (parsed.event.delta.type === "text_delta") {
      text = parsed.event.delta.text;
    }
  }
}
```

The adapter's job is to **flatten** this into:
```js
{ yokeType: "text_delta", text: "hello" }
```

Then processSDKMessage becomes:
```js
if (msg.yokeType === "text_delta") {
  text = msg.text;
}
```

This is NOT a rewrite. It is **if-condition simplification**. The business logic (what happens with `text`) stays identical.

**Plan (Step 3d)**: Adapter flattens raw SDK events into `{ yokeType, ...fields }`. processSDKMessage's if-conditions change from nested raw format checks to flat yokeType checks. Claude-specific logic (auth detection, fast_mode_state, block index) stays in processSDKMessage during 3d (zero behavior change), then moves to the adapter in Step 3e (~25 lines, bounded behavior change) before Phase 4 release.

### Worker process: Step 3b (complete)

Worker management code (~530 lines) moved from sdk-bridge.js into claude.js. `adapter.createQuery()` branches on `adapterOptions.CLAUDE.linuxUser` internally. Clay calls `createQuery()` and does not know whether in-process or worker runs. `createWorkerQueryHandle` wraps IPC into async iterable. Permission/elicitation IPC routed through canUseTool/onElicitation callbacks. Worker reuse via `_adapterState` pattern.

### QueryHandle abstraction: Step 3c (complete)

`_rawQuery`, `_messageQueue`, `_pushRaw` removed from both in-process and worker QueryHandle. `session.queryInstance` IS the QueryHandle. `processQueryStream` iterates it directly. `pushMessage()` routes through the handle for both paths. `rewindFiles()` added as pass-through for Claude SDK rewind support.

### MCP servers: tool definitions extracted (Step 3a, done)

browser-mcp-server.js and debate-mcp-server.js no longer import the SDK. They export `getToolDefs()` which returns an array of `{ name, description, inputSchema, handler }` objects. The adapter's `createToolServer()` wraps them with `sdk.tool()` + `sdk.createSdkMcpServer()`.

The `inputSchema` field is a Zod shape object (built by the existing `buildShape()` helper). The Claude adapter passes this directly to `sdk.tool()`. Future adapters may need a Zod-to-JSON-Schema converter.

### Session management: added to adapter

Phase 2's 11 interface methods did not include `getSessionInfo`, `listSessions`, `renameSession`, `forkSession`. These were discovered during implementation as additional `getSDK()` call sites in project-sessions.js, project-user-message.js, and sessions.js. Added to the adapter as pass-through methods to maintain the SDK isolation constraint.

### createQuery: async

`adapter.createQuery()` is async (returns Promise<QueryHandle>) because the SDK module is loaded via dynamic ESM import. The caller awaits the handle, then pushes the first message and iterates.

---

## 3. File Change Map

### New files

| File | Lines | Risk |
|------|-------|------|
| `lib/yoke/package.json` | 7 | None |
| `lib/yoke/index.js` | 33 | Low |
| `lib/yoke/interface.js` | 88 | Low |
| `lib/yoke/adapters/claude.js` | ~1222 (280 from 3a + ~820 worker code from 3b) | Medium |
| `lib/yoke/adapters/claude-worker.js` | 559 (copy) | None |

### Modified files

| File | Change summary |
|------|---------------|
| `lib/project.js` | Removed `getSDK()` function. Added `yoke.createAdapter()`. MCP servers created via `adapter.createToolServer()`. Passes `adapter` instead of `getSDK` to sdk-bridge, sessions, user-message modules. |
| `lib/sdk-bridge.js` | (3a) Replaced `getSDK` with `adapter`. `startQuery`/`warmup`/`createMentionSession`/`getOrCreateRewindQuery` use adapter. (3b) Worker code removed (~530 lines). `startQuery` unified, `setEffort`/`setPermissionMode`/`stopTask` route through QueryHandle, idle reaper updated, `_worker_meta` handling added to `processQueryStream`. |
| `lib/browser-mcp-server.js` | Removed SDK `require()`. Renamed `create()` to `getToolDefs()`. Returns tool definition array instead of MCP server. Added `def()` helper for positional-to-object conversion. |
| `lib/debate-mcp-server.js` | Same treatment as browser-mcp-server.js. |
| `lib/project-sessions.js` | `getSDK().then(sdk => sdk.method())` replaced with `adapter.method()` for getSessionInfo, listSessions, renameSession, forkSession. |
| `lib/project-user-message.js` | `getSDK().then(sdk => sdk.renameSession())` replaced with `adapter.renameSession()`. |
| `lib/sessions.js` | `migrateSessionTitles(getSDK, cwd)` signature changed to `migrateSessionTitles(adapter, cwd)`. Internal calls use `adapter.listSessions()` and `adapter.renameSession()`. |
| `lib/sdk-message-processor.js` | `getSDK` reference replaced with `adapter` (received but unused). |
| `lib/sdk-worker.js` | Deprecation notice added. File kept for backward compatibility with any running workers. |

---

## 4. SDK Isolation Verification

After Phase 3, SDK imports exist only in:

| File | Import type | Reason |
|------|------------|--------|
| `lib/yoke/adapters/claude.js` | `import()` (async) + `require()` (sync) | Adapter implementation |
| `lib/yoke/adapters/claude-worker.js` | `import()` (async) | Worker process |
| `lib/sdk-worker.js` | `import()` (async) | Deprecated copy, kept for running workers |
| `package.json` | dependency declaration | npm dependency |

No other file in `lib/` imports `@anthropic-ai/claude-agent-sdk` or calls `getSDK()`.

---

## 5. Remaining Work (Steps 3b, 3c, 3d)

### Step 3b: Worker management into adapter

**What moves from sdk-bridge.js to adapters/claude.js:**

| Code block | Lines (approx) | Purpose |
|------------|---------------|---------|
| `ensurePackageReadable()` | ~40 | Chmod package dirs for non-root workers |
| `resolveLinuxUser()` | ~3 | Delegate to os-users utility |
| `spawnWorker(linuxUser)` | ~120 | Spawn child process, Unix socket IPC |
| `cleanupWorker(worker)` | ~15 | Socket/process cleanup |
| `startQueryViaWorker()` | ~250 | Build options, IPC message handler, push to worker |
| `cleanupSessionWorker()` | ~25 | Session-level worker state cleanup |
| `killSessionWorker()` | ~8 | Force-kill worker |
| `warmupViaWorker(linuxUser)` | ~60 | Warmup via worker IPC |

**Changes to createQuery signature:**
```js
adapter.createQuery({
  // ... existing YOKE options ...
  adapterOptions: {
    CLAUDE: {
      linuxUser: "alice",     // triggers worker path inside adapter
      // ... existing Claude options ...
    }
  }
})
```

**IPC callback routing:** Worker sends permission_request, elicitation_request, ask_user_request via IPC. Adapter calls `canUseTool`/`onElicitation` callbacks (already passed to createQuery) and sends responses back to worker. Clay never sees the IPC.

**Worker meta events** (model_changed, effort_changed, permission_mode_changed, context_usage, worker_error): Adapter yields these through the QueryHandle async iterator as distinct event objects. processQueryStream must handle them (new code, but small).

### Step 3c: QueryHandle real abstraction (complete)

**Removed:** `_rawQuery`, `_messageQueue`, `_pushRaw` from both QueryHandle implementations.

**Changes applied in sdk-bridge.js:**
- `session.queryInstance = handle` (was `handle._rawQuery || handle`)
- `processQueryStream` iterates QueryHandle via `for await (var msg of myQueryInstance)`
- `startQuery` pushes first message via `handle.pushMessage(text, images)`
- `pushMessage()` routes through `session.queryInstance.pushMessage()`
- `createMentionSession` uses `handle.pushMessage()` for initial and follow-up messages
- `getOrCreateRewindQuery` returns handle directly (not `handle._rawQuery`)
- Idle reaper uses `queryInstance.close()`
- `processQueryStream` no longer tracks `myMessageQueue` separately

**Worker QueryHandle:** The async iterator yields events from IPC. `sdk_event` messages become SDK event objects. `query_done` ends the iterator. `query_error` makes the iterator throw.

### Step 3d: Event flattening

Not a rewrite. The adapter flattens raw SDK events; processSDKMessage if-conditions simplify.

**What the adapter does** (inside claude.js, in the QueryHandle's async iterator):

```js
// Raw SDK event:
// { type: "stream_event", event: { type: "content_block_delta", index: 0,
//   delta: { type: "text_delta", text: "hello" } } }
//
// Adapter yields:
// { yokeType: "text_delta", blockId: "block_0", text: "hello" }
```

**Full flattening map** (Claude raw -> YOKE normalized):

| Claude raw event path | yokeType | Extracted fields |
|-----------------------|----------|-----------------|
| `stream_event > content_block_start (text)` | `text_start` | `blockId` |
| `stream_event > content_block_delta (text_delta)` | `text_delta` | `blockId`, `text` |
| `stream_event > content_block_start (thinking)` | `thinking_start` | `blockId` |
| `stream_event > content_block_delta (thinking_delta)` | `thinking_delta` | `blockId`, `text` |
| `stream_event > content_block_stop` (thinking) | `thinking_stop` | `blockId` |
| `stream_event > content_block_start (tool_use)` | `tool_start` | `blockId`, `toolId`, `toolName` |
| `stream_event > content_block_delta (input_json_delta)` | `tool_input_delta` | `blockId`, `partialJson` |
| `stream_event > content_block_stop` (tool_use) | `tool_executing` | `blockId` |
| `stream_event > message_start` | `turn_start` | `inputTokens` (optional) |
| `user > tool_result` | `tool_result` | `toolId`, `content`, `isError`, `images` |
| `result` | `result` | `cost`, `duration`, `usage`, `sessionId`, `fastModeState` |
| `system (init)` | `init` | `model`, `skills`, `slashCommands`, `fastModeState` |
| `system (status)` | `status` | `status` |
| `system (task_started)` | `task_started` | `parentToolId`, `taskId`, `description` |
| `system (task_progress)` | `task_progress` | `parentToolId`, `taskId`, `usage`, `summary` |
| `task_notification` | `task_notification` | `parentToolId`, `status`, `summary`, `usage` |
| `tool_progress` | `subagent_activity` | `parentToolId`, `text` |
| `assistant/user` with `parent_tool_use_id` | `subagent_message` | `parentToolId`, `content` |
| `rate_limit_event` | `rate_limit` | `status`, `resetsAt`, `rateLimitType`, `utilization`, `isUsingOverage` |
| `prompt_suggestion` | `prompt_suggestion` | `suggestion` |
| any with `session_id` | (field on any event) | `sessionId` |
| any with `uuid` | (field on any event) | `uuid`, `messageType` |

**What changes in processSDKMessage**:
- if-conditions flatten: `if (parsed.type === "stream_event" && parsed.event.type === "content_block_delta" && ...)` becomes `if (msg.yokeType === "text_delta")`
- `session.blocks[idx]` changes to `session.blocks[msg.blockId]` (ID-based, not index-based)
- Business logic stays identical

### Step 3e: Claude assumption cleanup (complete)

| Item | Status | Result |
|------|--------|--------|
| Block index tracking | **Done** | `session.blocks[blockId]` (was `session.blocks[idx]`). Adapter assigns `blockId = "blk_" + index`. Other adapters can assign any string ID. |
| fast_mode_state | **Already generic** | processSDKMessage checks `parsed.fastModeState` field, forwards if present. Other adapters simply omit the field. No change needed. |
| Auth detection | **Stays** | Cannot move to adapter: needs `session.responsePreview` (accumulated during streaming). `flattenEvent` only sees individual events, not session state. See "Auth detection: accepted deferral" below. |

**Auth detection: accepted deferral.** The "not logged in" text pattern check reads session state that the adapter cannot access. When a second adapter exists, the recommended approach: the adapter sets `isAuthPrompt: true` on the result event using its own detection mechanism. processSDKMessage checks `parsed.isAuthPrompt` first, falls back to the existing text heuristic for Claude. The text heuristic is harmless for other adapters (only triggers on very specific zero-cost short responses matching `/not logged in/i` AND `/\/login/i`).

### Accepted deferrals (OK to leave for later)

| Item | Deferred to | Rationale |
|------|------------|-----------|
| Remove deprecated `lib/sdk-worker.js` | Post-release | Safety net for running workers. Worker code is fully in adapter. |
| `createToolServer` inputSchema as JSON Schema instead of Zod | Post-release | Only matters when a non-Claude adapter needs tool registration. Zod works for Claude. |
| Auth detection text heuristic | Post-release | Needs session context (responsePreview). Harmless for other adapters. Migration path documented: `isAuthPrompt` field on result event. |

---

## 6. Data Flow

### Current state (after 3b + 3c, before 3d)

```
startQuery(session, text, images, linuxUser)
  |-- adapter.createQuery({
  |     ..., adapterOptions: { CLAUDE: { linuxUser } }
  |   })
  |     |
  |     +-- (linuxUser) adapter spawns worker internally
  |     |     |-- IPC: permission/elicitation -> canUseTool/onElicitation callbacks
  |     |     '-- IPC: sdk_event -> normalize -> yield through iterator
  |     |
  |     +-- (no linuxUser) adapter calls sdk.query() in-process
  |           '-- raw SDK events -> yield through iterator
  |
  |-- returns QueryHandle (same interface, both paths)
  |
  |-- queryHandle.pushMessage(text, images)       // clean API
  |-- session.queryInstance = queryHandle          // IS the QueryHandle
  '-- processQueryStream(session)
        |-- for await (msg of session.queryInstance)  // iterates QueryHandle
        '-- processSDKMessage(session, msg)           // raw SDK events (3d will flatten)
```

### Target state (after 3d + 3e)

Same as above, but processSDKMessage receives flattened events:
```
        '-- processSDKMessage(session, msg)           // flattened events
              |-- msg.yokeType === "text_delta" -> ...
              |-- msg.yokeType === "tool_start" -> ...
              '-- msg.yokeType === "result" -> ...
```

### Warmup (current, after 3b)

```
warmup(linuxUser)
  '-- adapter.init({ cwd, dangerouslySkipPermissions, linuxUser })
        |-- (linuxUser) adapter spawns warmup worker internally
        '-- (no linuxUser) adapter does in-process warmup
```

---

## 7. processSDKMessage Analysis

568 lines analyzed. The code is 99% Clay business logic, not SDK format translation.

### What processSDKMessage actually does

| Line range | yokeType (after 3d) | What happens | Nature |
|------------|---------------------|-------------|--------|
| 76-93 | (all) | PERF timing logs | Clay infra |
| 96-102 | (sessionId field) | Extract session_id, save to session | Clay state |
| 104-113 | (uuid field) | Capture message UUIDs for rewind | Clay state |
| 116-140 | `init` | Cache slash_commands, model, skills, broadcast | Clay state |
| 142-148 | `turn_start` | Record input token count | Clay state |
| 150-163 | `text_start`, `thinking_start`, `tool_start` | Track content blocks, send to client | Clay state + UI |
| 165-183 | `text_delta`, `thinking_delta`, `tool_input_delta` | Stream text/input, accumulate preview | Clay state + UI |
| 186-217 | `tool_executing`, `thinking_stop` | Parse tool input, send to client, push notification | Clay business + UI |
| 219-303 | `tool_result`, `subagent_message` | Process tool results, sub-agent messages | Clay business + UI |
| 305-411 | `result` | Cleanup, context usage, auth check, done signal, push notification | Clay business + UI |
| 412-418 | `status` | Compacting indicator | Clay UI |
| 420-476 | `task_started`, `task_progress`, `task_notification`, `subagent_activity` | Sub-agent lifecycle | Clay UI |
| 478-533 | `rate_limit` | Rate limit handling, auto-continue scheduling | Clay business |
| 535-539 | `prompt_suggestion` | Forward suggestion to client | Clay UI |
| 541-556 | `error` (catch-all system) | Surface unhandled system errors | Clay UI |

### Claude-specific code that moves to the adapter (~25 lines)

**1. Auth detection heuristic (lines 348-389)**

```js
// CURRENT: Clay checks response text for "not logged in"
var isLoginPrompt = isZeroCost && previewTrimmed.length < 100
  && /not logged in/i.test(previewTrimmed) && /\/login/i.test(previewTrimmed);
```

Moves to adapter. When Claude adapter detects this pattern in the result event, it emits `{ yokeType: "auth_required", linuxUser: ... }` instead. processSDKMessage just handles `auth_required` as a generic event. Other adapters emit `auth_required` based on their own error patterns.

**2. fast_mode_state (lines 137-139, 370-372)**

```js
if (parsed.fast_mode_state) {
  sendAndRecord(session, { type: "fast_mode_state", state: parsed.fast_mode_state });
}
```

Anthropic billing specific. Adapter includes it as a field in `init` and `result` events. processSDKMessage checks for the field and forwards if present. Or use `runtime_specific` passthrough per Phase 2 design.

**3. Block index tracking (lines 150-217)**

```js
session.blocks[idx] = { type: "tool_use", id: block.id, ... };
// ...
var block = session.blocks[idx];
```

Claude SDK uses integer index for content blocks. The adapter maps these to stable `blockId` strings. processSDKMessage tracks `session.blocks[blockId]` instead of `session.blocks[idx]`. The mapping is trivial (adapter does `blockId = "block_" + evt.index`), but it removes the Claude-specific assumption that blocks are tracked by integer position.

---

## 8. Multi-runtime Compatibility Assessment

Analysis of whether the flattened event model supports OpenCode/Codex integration.

### Will work without changes (~90% of processSDKMessage)

| Business logic | Why it works |
|---------------|-------------|
| Text streaming (`text_delta`) | Every LLM runtime streams text. Adapter produces `{ yokeType: "text_delta", text }`. |
| Tool execution (`tool_start`, `tool_executing`, `tool_result`) | Tool use is universal. Adapters produce the same events. |
| Query completion (`result`) | Every runtime signals completion. Cost/duration fields are nullable for runtimes that lack them. |
| Rate limiting (`rate_limit`) | Most runtimes have rate limits. Fields like `resetsAt` are nullable. |
| Session state (blocks, streamedText, responsePreview) | Driven by normalized events, not raw format. |
| UI messages (sendAndRecord) | Consumes normalized fields only after Step 3d. |

### Needs adapter mapping but no Clay changes

| Feature | Claude | OpenCode/Codex | Adapter handles |
|---------|--------|---------------|-----------------|
| Thinking/reasoning | `thinking_start/delta/stop` | Different event name or absent | Adapter maps to same yokeType, or simply does not emit |
| Sub-agents | `task_started/progress`, `task_notification` | May not exist | processSDKMessage code does not trigger if events never arrive |
| Prompt suggestions | `prompt_suggestion` | Likely absent | Same: no event, no trigger |
| Context compacting | `status: "compacting"` | May have equivalent | Adapter maps or does not emit |

### Resolved in Step 3e (before Phase 4 release)

These Claude assumptions are moved from processSDKMessage into the Claude adapter in Step 3e, before YOKE is open-sourced.

| Item | Lines | Step 3e resolution |
|------|-------|--------------------|
| Auth detection | ~20 | Adapter emits `auth_required` event. processSDKMessage handles it generically. |
| fast_mode_state | ~5 | Adapter emits `runtime_specific`. processSDKMessage forwards if present. |
| Block index tracking | ~10 | Adapter assigns `blockId`. processSDKMessage tracks by ID. |

After 3e, processSDKMessage has zero Claude-specific format assumptions. A second adapter author will not hit any walls.

### Does NOT need changes

| Concern | Why |
|---------|-----|
| "processSDKMessage is 568 lines of battle-tested code" | 99% is Clay business logic that stays. Only if-conditions change (nested -> flat). Logic stays identical. |
| "Rewriting processSDKMessage is risky" | Not a rewrite. The adapter flattens events; processSDKMessage simplifies its conditions. Each yokeType change is a small, isolated diff. |
| "Second adapter will break processSDKMessage" | processSDKMessage reads yokeType + flat fields. Any adapter that produces the same yokeType events will work. Runtime-specific events use `runtime_specific` passthrough. |
