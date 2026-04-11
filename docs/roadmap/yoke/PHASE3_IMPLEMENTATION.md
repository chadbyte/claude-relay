# Phase 3: Implementation (Claude Adapter)

> YOKE interface created. Claude adapter built. All SDK call sites rewired.
> Step 3a complete (2026-04-11). Steps 3b, 3c, 3d remaining.

---

## 0. Sub-steps

Phase 3 is split into 4 sub-steps after review identified gaps in the initial implementation.

| Step | Description | Status |
|------|-------------|--------|
| **3a** | Scaffold `lib/yoke/`, create adapter shell, rewire all `getSDK` call sites, isolate SDK imports | Complete |
| **3b** | Move worker management code (~530 lines) from sdk-bridge.js into claude.js adapter. `adapter.createQuery()` owns both in-process and worker paths. `linuxUser` becomes an adapter option. Clay never decides how to run the query. | Not started |
| **3c** | Make QueryHandle the real abstraction. Remove `_rawQuery`, `_messageQueue`, `_pushRaw`. `processQueryStream` iterates the QueryHandle. Worker QueryHandle yields events from IPC. Both paths produce the same event shape. | Not started |
| **3d** | Event normalization. Adapter translates raw SDK events to Phase 2's 20 normalized types. Gradual approach: adapter yields `{ yokeType, raw }` envelope. processSDKMessage reads from `raw` initially, migrates to normalized fields over time. | Not started |

### Why this order

- **3b before 3c**: QueryHandle cannot hide the worker path until the adapter owns the worker code. Otherwise Clay still has to route `linuxUser` queries to a separate code path in sdk-bridge.
- **3c before 3d**: The iterator must go through QueryHandle before we can normalize events. If processQueryStream still reads `session.queryInstance._rawQuery`, normalizing events in the adapter has no effect.
- **3d is gradual**: `{ yokeType, raw }` envelope lets processSDKMessage migrate one event type at a time without big-bang rewrite. Each event type is a small, testable change.

### Dependency graph

```
3a (done)
  '-- 3b (worker into adapter)
        '-- 3c (QueryHandle real abstraction)
              '-- 3d (event normalization, gradual)
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

**Plan (Step 3d)**: Gradual migration via `{ yokeType, raw }` envelope. Adapter yields `{ yokeType: "text_delta", raw: originalSdkEvent }`. processSDKMessage reads `msg.raw` initially (zero behavior change), then migrates to normalized fields one event type at a time. Each migration is a small, testable diff.

### Worker process: Step 3b (remaining)

The worker code (spawnWorker, startQueryViaWorker, IPC handling, ~530 lines) remains in sdk-bridge.js. Only the worker script file moved to `lib/yoke/adapters/claude-worker.js`. The WORKER_SCRIPT path is updated via `adapter.workerScriptPath`.

**Problem**: Clay still routes queries itself (`if (linuxUser) startQueryViaWorker()`). The adapter's `createQuery()` should own this decision. Worker management is ADAPTER-internal per Phase 2 classification.

**Plan (Step 3b)**: Move spawnWorker, cleanupWorker, startQueryViaWorker, warmupViaWorker, all IPC handling into `adapters/claude.js`. Pass `linuxUser` via `adapterOptions.CLAUDE.linuxUser`. Clay calls `adapter.createQuery()` and does not know whether in-process or worker runs.

### QueryHandle abstraction: Step 3c (remaining)

The current QueryHandle exposes `_rawQuery`, `_messageQueue`, `_pushRaw`. processQueryStream iterates `session.queryInstance` (the raw SDK query), not the QueryHandle.

**Problem**: The QueryHandle is a shell, not an abstraction. Replacing the adapter does nothing because Clay bypasses the handle and reads the raw query directly.

**Plan (Step 3c)**: Remove all underscore-prefixed escape hatches. processQueryStream iterates the QueryHandle. Worker path's IPC events flow through the same async iterator. `session.queryInstance` IS the QueryHandle.

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
| `lib/yoke/adapters/claude.js` | ~280 | Medium |
| `lib/yoke/adapters/claude-worker.js` | 559 (copy) | None |

### Modified files

| File | Change summary |
|------|---------------|
| `lib/project.js` | Removed `getSDK()` function. Added `yoke.createAdapter()`. MCP servers created via `adapter.createToolServer()`. Passes `adapter` instead of `getSDK` to sdk-bridge, sessions, user-message modules. |
| `lib/sdk-bridge.js` | Replaced `getSDK` with `adapter`. `startQuery` uses `adapter.createQuery()`. `warmup` uses `adapter.init()`. `createMentionSession` uses `adapter.createQuery()` with `systemPrompt`. `getOrCreateRewindQuery` uses `adapter.createQuery()`. WORKER_SCRIPT path updated to `adapter.workerScriptPath`. |
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

### Step 3c: QueryHandle real abstraction

**Remove:**
- `_rawQuery` property
- `_messageQueue` property
- `_pushRaw()` method

**Change in sdk-bridge.js:**
- `session.queryInstance = queryHandle` (not `handle._rawQuery`)
- `processQueryStream` does `for await (var msg of session.queryInstance)` (iterates QueryHandle)
- `startQuery` pushes first message via `queryHandle.pushMessage(text, images)` (not `_pushRaw`)
- `createMentionSession` pushes initial message via `queryHandle.pushMessage()`
- Idle reaper ends the QueryHandle, not the raw message queue

**Worker QueryHandle:** The async iterator yields events from IPC. `sdk_event` messages become SDK event objects. `query_done` ends the iterator. `query_error` makes the iterator throw.

### Step 3d: Event normalization (gradual)

**Phase 1: Envelope.** Adapter wraps every event:
```js
{ yokeType: "text_delta", raw: originalSdkEvent }
```
processSDKMessage reads `msg.yokeType` for routing, `msg.raw` for data. Zero behavior change.

**Phase 2: Migrate per event type.** One event at a time, processSDKMessage reads normalized fields instead of `msg.raw`:
```js
// Before
if (msg.raw.type === "stream_event" && msg.raw.event.delta.type === "text_delta") {
  text = msg.raw.event.delta.text;
}
// After
if (msg.yokeType === "text_delta") {
  text = msg.text;   // normalized field
}
```

**Phase 3: Remove `raw`.** When all event types are migrated, `raw` field is dropped. processSDKMessage consumes only normalized events. Second adapter can now plug in.

### Accepted deferrals (OK to leave for later)

| Item | Deferred to | Rationale |
|------|------------|-----------|
| Remove deprecated `lib/sdk-worker.js` | After testing | Safety net for running workers. No functional impact. |
| `createToolServer` inputSchema as JSON Schema instead of Zod | Phase 5 | Only matters when a non-Claude adapter needs tool registration. Zod works for now. |
| Remove `adapter._loadSDK()` | After 3b/3c/3d | May be needed during transition. |

---

## 6. Data Flow

### Current state (Step 3a)

```
startQuery(session, text, images, linuxUser)
  |
  +-- (linuxUser) startQueryViaWorker()          // STILL IN sdk-bridge.js
  |     |-- spawnWorker()                         // STILL IN sdk-bridge.js
  |     |-- worker IPC handler                    // STILL IN sdk-bridge.js
  |     '-- processSDKMessage(session, msg.event) // raw SDK events via IPC
  |
  +-- (no linuxUser)
        |-- adapter.createQuery(opts) -> QueryHandle
        |-- handle._pushRaw(initialMessage)         // HACK: raw message format
        |-- session.queryInstance = handle._rawQuery  // HACK: bypasses QueryHandle
        '-- processQueryStream(session)
              |-- for await (msg of session.queryInstance)  // iterates RAW query
              '-- processSDKMessage(session, msg)           // raw SDK events
```

### Target state (after 3b + 3c + 3d)

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
  |           '-- raw SDK events -> normalize -> yield through iterator
  |
  |-- returns QueryHandle (same interface, both paths)
  |
  |-- queryHandle.pushMessage(text, images)       // clean API
  |-- session.queryInstance = queryHandle          // IS the QueryHandle
  '-- processQueryStream(session)
        |-- for await (msg of session.queryInstance)  // iterates QueryHandle
        '-- processSDKMessage(session, msg)           // normalized events
              |-- msg.yokeType === "text_delta" -> ...
              |-- msg.yokeType === "tool_start" -> ...
              '-- msg.yokeType === "result" -> ...
```

### Warmup (current: 3a)

```
warmup(linuxUser)
  |-- (no linuxUser) adapter.init({ cwd, dangerouslySkipPermissions })  // done
  |-- (linuxUser) warmupViaWorker(linuxUser)   // STILL IN sdk-bridge.js
```

### Warmup (target: after 3b)

```
warmup(linuxUser)
  '-- adapter.init({ cwd, dangerouslySkipPermissions, adapterOptions: { CLAUDE: { linuxUser } } })
        |-- (linuxUser) adapter spawns warmup worker internally
        '-- (no linuxUser) adapter does in-process warmup
```
