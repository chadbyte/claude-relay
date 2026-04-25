# Phase 2: Interface Design + Classification

> Every SDK touch point classified as INTERFACE, ADAPTER, or CLAY.
> Generated 2026-04-11. Revised 2026-04-11 after Arch/아키 review.
> This document defines YOKE's contract.

---

## Classification Legend

| Label | Meaning | Where it lives |
|-------|---------|----------------|
| **INTERFACE** | Crosses the YOKE boundary. Clay calls it, adapter implements it. | `lib/yoke/interface.js` |
| **ADAPTER** | Runtime-specific implementation detail. Clay never sees it. | `lib/yoke/adapters/claude.js` |
| **CLAY** | Clay's own concern. Never touches YOKE. | Stays in current location |

**Design guardrail applied**: "Would Codex/OpenCode/Gemini need this method? If not, it does not belong in the interface."

**Practical guardrail applied**: "Does Clay currently use this via the Claude SDK? If yes, `adapterOptions` must provide a passthrough so Clay doesn't lose the capability."

---

## 1. SDK Methods Classification

| # | SDK Method | Classification | Rationale |
|---|-----------|---------------|-----------|
| Q-1~6 | `sdk.query({ prompt, options })` | **INTERFACE** | Every runtime has "start a conversation." YOKE wraps this as `createQuery()`. |
| M-1~2 | `stream.supportedModels()` | **INTERFACE** | Every runtime can list available models. Exposed as `adapter.supportedModels()` (adapter-level, not query-level). |
| P-1 | `queryInstance.setPermissionMode(mode)` | **ADAPTER** | Claude-specific shortcut. YOKE expresses permissions via `canUseTool` callback only. The Claude adapter may internally use `setPermissionMode` to optimize, but this is not exposed. See Section 5 for details. |
| T-1 | `queryInstance.stopTask(taskId)` | **INTERFACE** | Sub-agent stop. Runtimes without sub-agents return no-op. |
| -- | `queryInstance.getContextUsage()` | **INTERFACE** | Context window usage. Useful for any runtime. Runtimes without it return null. |
| C-1~2 | `sdk.createSdkMcpServer()` | **ADAPTER** | MCP server creation is Claude SDK's tool registration mechanism. Other runtimes register tools differently. YOKE wraps this as `createToolServer()`. |
| D-1~2 | `sdk.tool()` | **ADAPTER** | Tool schema definition helper. Part of `createSdkMcpServer` pipeline. |

---

## 2. Query Options Classification

These are parameters currently passed to `sdk.query()`. Each is classified by where it should live in YOKE.

### INTERFACE options (Clay passes these through YOKE)

| Parameter | YOKE name | Rationale |
|-----------|-----------|-----------|
| `cwd` | `cwd` | Universal. Every runtime needs a working directory. |
| `model` | `model` | Universal. Model selection. |
| `systemPrompt` | `systemPrompt` | Universal. Every runtime accepts a system prompt. Currently only used for mention sessions (Q-4). For main sessions, Claude SDK auto-reads CLAUDE.md. **Phase 3 decision**: Claude adapter continues to let SDK auto-read for main sessions, passes explicit systemPrompt for mentions. |
| `abortController` | `abortSignal` | Universal. Standard cancellation mechanism. YOKE takes AbortSignal (not AbortController) because the controller is Clay's, only the signal crosses the boundary. |
| `canUseTool` | `canUseTool` | Universal. "Should this tool be allowed?" callback. This is YOKE's permission model. Every runtime that supports tools needs this. |
| `onElicitation` | `onElicitation` | Universal concept: "runtime needs user input." Every runtime may need to solicit structured input from the user. |
| `mcpServers` | `toolServers` | Universal concept: "register these tools." Renamed because not all runtimes use MCP. The tool definitions themselves (what browser_screenshot does) are Clay's concern. How they're registered with the runtime is the adapter's concern. |
| `resume` | `resumeSessionId` | Universal concept: "continue a previous conversation." Claude uses CLI session ID. Other runtimes may use their own session persistence. |
| `effort` | `effort` | Optional. Not all runtimes have this. Adapter ignores if unsupported. |

### ADAPTER options (passed via `adapterOptions.CLAUDE`, not exposed in YOKE interface)

These parameters are Claude SDK-specific. Clay passes them through the `adapterOptions` vendor namespace so it retains full control over Claude-specific features without polluting the universal interface.

```js
adapterOptions: {
  CLAUDE: {
    thinking: { type: "enabled", budgetTokens: 10000 },
    betas: ["interleaved-thinking"],
    settingSources: ["user", "project", "local"],
    enableFileCheckpointing: true,
    promptSuggestions: true,
    agentProgressSummaries: true,
    resumeSessionAt: "uuid-xxx",
    permissionMode: "acceptEdits",
    extraArgs: { "replay-user-messages": null },
  }
}
```

| Parameter | Clay uses it? | Rationale |
|-----------|--------------|-----------|
| `thinking` | **Yes (UI toggle)** | Extended thinking config. Users control on/off and budget via UI. |
| `betas` | **Yes (UI toggle)** | Anthropic beta feature flags. Users toggle in settings. |
| `settingSources` | Yes (implicit) | Claude-specific config cascade (`["user", "project", "local"]`). |
| `enableFileCheckpointing` | Yes (implicit) | Claude SDK file checkpoint feature. |
| `promptSuggestions` | **Yes (UI feature)** | Suggestion chip generation. Clay shows these in the UI. |
| `agentProgressSummaries` | Yes (implicit) | Progress summary generation. |
| `permissionMode` | **Yes (UI toggle)** | Claude SDK permission shortcut. Adapter optimization for `setToolPolicy`. |
| `allowDangerouslySkipPermissions` | Yes (config) | Permission bypass flag from daemon config. |
| `resumeSessionAt` | **Yes (rewind)** | Resume at specific message UUID. Required for session rewind feature. |
| `extraArgs` | Yes (implicit) | Claude CLI passthrough. |
| `includePartialMessages` | Yes (implicit) | Claude SDK streaming mode flag. |
| `spawnClaudeCodeProcess` | Yes (worker) | Worker subprocess spawn override. |
| `debug` / `debugFile` | Yes (worker) | Debug logging for worker processes. |

**Why vendor namespace**: `adapterOptions.CLAUDE.{option}` is explicit and collision-free. When Clay switches adapters, other vendors' options remain intact. When reading the code, the vendor prefix makes it immediately clear which runtime a given option targets. Explicit is always better than implicit, for humans and AI alike.

---

## 3. SDK Event Stream Classification

Events received from `for await (msg of query)`. The key question: does YOKE normalize these into a runtime-agnostic format, or pass them through raw?

**Decision: YOKE normalizes.** The Claude SDK emits Anthropic-specific event shapes (content_block_start, content_block_delta, etc.). Other runtimes will have completely different event formats. YOKE's job is to translate runtime events into a stable, normalized format that Clay consumes.

### Normalized event types (what Clay receives from YOKE)

| YOKE Event | Source (Claude) | Classification | Purpose |
|------------|----------------|----------------|---------|
| `text_delta` | `stream_event > content_block_delta (text_delta)` | **INTERFACE** | Streaming text output |
| `thinking_start` | `stream_event > content_block_start (thinking)` | **INTERFACE** | Extended thinking began |
| `thinking_delta` | `stream_event > content_block_delta (thinking_delta)` | **INTERFACE** | Streaming thinking text |
| `thinking_stop` | `stream_event > content_block_stop` (for thinking blocks) | **INTERFACE** | Extended thinking ended |
| `tool_start` | `stream_event > content_block_start (tool_use)` | **INTERFACE** | Tool invocation began |
| `tool_input_delta` | `stream_event > content_block_delta (input_json_delta)` | **INTERFACE** | Streaming tool input JSON |
| `tool_executing` | `stream_event > content_block_stop` (for tool_use blocks) | **INTERFACE** | Tool input complete, executing |
| `tool_result` | `user > message.content[].tool_result` | **INTERFACE** | Tool execution result |
| `turn_start` | `stream_event > message_start` | **INTERFACE** | New assistant turn began. Signal only, no usage payload. (Renamed from `message_start` to clarify scope. Usage data flows through `getContextUsage()` pull method only.) |
| `result` | `result` | **INTERFACE** | Query turn complete. Cost, duration, usage, session ID. |
| `init` | `system (subtype: init)` | **INTERFACE** | Runtime initialized. Models, skills, capabilities. |
| `status` | `system (subtype: status)` | **INTERFACE** | Runtime status (e.g., compacting). |
| `task_started` | `system (subtype: task_started)` | **INTERFACE** | Sub-agent task began |
| `task_progress` | `system (subtype: task_progress)` | **INTERFACE** | Sub-agent progress update |
| `task_notification` | `task_notification` | **INTERFACE** | Sub-agent completed |
| `subagent_message` | `assistant/user` with `parent_tool_use_id` | **INTERFACE** | Sub-agent tool activity |
| `rate_limit` | `rate_limit_event` | **INTERFACE** | Rate limit warning/rejection |
| `prompt_suggestion` | `prompt_suggestion` | **INTERFACE** | Suggestion chips. Runtimes without this simply never emit it. |
| `error` | `system` (catch-all with error text) | **INTERFACE** | Runtime error |
| `runtime_specific` | (any unmapped event) | **INTERFACE** | Passthrough for events that don't map to a normalized type. Shape: `{ type: "runtime_specific", vendor: "claude", eventType: "fast_mode_state", raw: {...} }`. Clay can ignore or handle as needed. Prevents interface changes when new runtimes emit novel events. |

### Events that stay in ADAPTER (not surfaced to Clay as distinct types)

| Source Event | Rationale |
|-------------|-----------|
| `stream_event > message_stop` | No business meaning for Clay. Adapter uses internally for state management. |
| Raw `content_block_start/delta/stop` envelope | Claude-specific streaming format. Adapter translates to normalized events above. |

### Claude-specific data that flows via `runtime_specific` passthrough

These are NOT normalized events (other runtimes won't have them), but Clay currently depends on them for UI features. The Claude adapter emits them as `runtime_specific` events. Clay listens for `vendor: "claude"` events and handles them.

| eventType | Source | Clay UI feature | Example |
|-----------|--------|----------------|---------|
| `message_uuid` | Every SDK message with `uuid` field | Rewind UI (user picks a point to rewind to). Pairs with `adapterOptions.CLAUDE.resumeSessionAt`. | `{ type: "runtime_specific", vendor: "claude", eventType: "message_uuid", raw: { uuid: "xxx", messageType: "user" } }` |
| `session_id` | Early in SDK stream (before `result`) | Crash recovery. Clay saves session ID immediately so it can resume after unexpected termination. `result` event also carries sessionId, but arrives too late for mid-stream crashes. | `{ type: "runtime_specific", vendor: "claude", eventType: "session_id", raw: { sessionId: "session-abc" } }` |
| `fast_mode_state` | `system/init` and `result` events | Fast mode indicator in UI. Shows whether the user is in fast/standard mode. | `{ type: "runtime_specific", vendor: "claude", eventType: "fast_mode_state", raw: { state: { ... } } }` |

**Why not normalized events?** These are Claude-specific concepts with no universal equivalent. Message UUIDs assume Claude's per-message UUID scheme. Fast mode is Anthropic's billing feature. Early session_id is Claude's CLI session model. Other runtimes will have their own runtime-specific data flowing through the same `runtime_specific` channel.

---

## 4. sdk-bridge Exported API Classification

The 14 methods currently exported by `createSDKBridge()`. This is the de facto interface that Phase 3 will formalize.

| # | Method | Classification | YOKE Interface Method | Notes |
|---|--------|---------------|----------------------|-------|
| 1 | `startQuery(session, text, images, linuxUser)` | **INTERFACE** | `query.start(opts)` | Core method. `session` is Clay's state object, not exposed. `linuxUser` is Clay infrastructure (worker delegation), adapter-internal. |
| 2 | `pushMessage(session, text, images)` | **INTERFACE** | `query.pushMessage(text, images)` | Multi-turn follow-up. |
| 3 | `warmup(linuxUser)` | **INTERFACE** | `adapter.init(opts)` | Capability discovery. Returns models, skills. `linuxUser` is adapter-internal. |
| 4 | `setModel(session, model)` | **INTERFACE** | `query.setModel(model)` | Model change. Applied on next query if no active query. |
| 5 | `setEffort(session, effort)` | **INTERFACE** | `query.setEffort(effort)` | Optional. Stored for next query. No-op if unsupported. |
| 6 | `setPermissionMode(session, mode)` | **ADAPTER** | (none) | See Section 5. Clay's tool approval policy is expressed via `canUseTool` callback. Claude adapter internally maps policy to `setPermissionMode()`. |
| 7 | `stopTask(taskId)` | **INTERFACE** | `query.stopTask(taskId)` | Sub-agent stop. May fall back to abort. |
| 8 | `createMentionSession(opts)` | **INTERFACE** | `adapter.createQuery(opts)` | Same as startQuery but with explicit `systemPrompt` and restricted `canUseTool`. Unified under `createQuery`. |
| 9 | `processQueryStream(session)` | **ADAPTER** | (internal) | Stream consumption loop. Adapter translates raw events to normalized format. |
| 10 | `getOrCreateRewindQuery(session)` | **ADAPTER** | (internal) | Temp query for rewind. Implementation detail of session resume. |
| 11 | `checkToolWhitelist(toolName, input)` | **CLAY** | (none) | Pure business logic: which tools are safe. No SDK dependency. |
| 12 | `handleCanUseTool(session, toolName, input, opts)` | **CLAY** | (none) | Bridges SDK callback to client WebSocket. Clay's permission orchestration. |
| 13 | `handleElicitation(session, request, opts)` | **CLAY** | (none) | Bridges SDK callback to client WebSocket. Clay's elicitation orchestration. |
| 14 | `isClaudeProcess(pid)` | **ADAPTER** | (none) | Process identification. Each adapter knows its own child processes. |
| 15 | `startIdleReaper() / stopIdleReaper()` | **CLAY** | (none) | Session lifecycle management. Uses abort (which goes through interface). |

---

## 5. Permission Model Deep Dive

This is the highest-risk classification decision. Getting it wrong means Phase 5 (second adapter) breaks.

### Current state (Claude SDK)

```
Clay                          Claude SDK
 |                               |
 |-- setPermissionMode("X") ---->|  (SDK-level shortcut)
 |                               |
 |<-- canUseTool(name, input) ---|  (SDK calls back)
 |-- { behavior: "allow" } ---->|
```

Two mechanisms, partially overlapping:
1. `permissionMode` tells SDK to batch-approve/deny categories of tools
2. `canUseTool` callback is called per-tool for individual decisions

### Problem

`setPermissionMode` is Claude-specific. OpenCode/Codex may not have permission modes. If YOKE exposes it, non-Claude adapters must implement no-ops or fake modes.

### Solution: single callback model + minimal policy signal

```
Clay                          YOKE                    Adapter
 |                              |                        |
 |-- setToolPolicy("ask") ---->|  (signal to adapter)    |
 |                              |                        |
 |                              |<-- canUseTool(name) ---|
 |<-- canUseTool(name) --------|                        |
 |-- { allow } --------------->|-- { allow } ---------->|
```

- **YOKE interface**: `canUseTool(toolName, input, opts) => Promise<{behavior, message?}>` callback, passed in query options.
- **Clay's responsibility**: Implement the callback. Check whitelist, check current policy, ask user if needed.
- **Claude adapter optimization**: When Clay sets policy to "allow-all", the Claude adapter can internally call `setPermissionMode("bypassPermissions")` for performance. This is invisible to YOKE.

### What about `setPermissionMode` mid-session?

Currently the user can toggle permission mode while a session is active. In the YOKE model:
1. Clay stores the new policy
2. On next `canUseTool` call, Clay's callback uses the new policy
3. Claude adapter can optionally call `queryInstance.setPermissionMode()` as an optimization

This means YOKE needs a way for Clay to signal policy changes to the adapter:

```js
query.setToolPolicy(policy)  // "ask" | "allow-all"
```

**Only 2 values.** The interface expresses the universal binary: "ask for every tool" or "approve everything." Intermediate policies (like Claude's "acceptEdits") are handled at two levels:

1. **Clay-level**: The `canUseTool` callback implements fine-grained logic (e.g., auto-approve edit tools, ask for others). This works across all runtimes.
2. **Adapter-level**: When Clay's UI sets "Accept Edits" mode, Clay passes `adapterOptions.CLAUDE.permissionMode: "acceptEdits"` for SDK-level optimization. The Claude adapter uses this to call `setPermissionMode("acceptEdits")` internally, which avoids unnecessary `canUseTool` round-trips. Other adapters simply rely on the `canUseTool` callback.

This way Clay retains full Claude-specific permission optimization via `adapterOptions`, while the interface stays universal.

**Decision**: `setToolPolicy(policy)` is **INTERFACE** with 2 values. Fine-grained policies use `canUseTool` callback (INTERFACE) + `adapterOptions.CLAUDE.permissionMode` (ADAPTER).

---

## 6. Session Model Deep Dive

Another high-risk area. Claude's session model is specific.

### Current state

- Clay manages sessions (localId, title, history, etc.)
- SDK manages CLI sessions (cliSessionId, message UUIDs)
- `sdk.query({ resume: cliSessionId })` reconnects to a previous CLI session
- `session.queryInstance` is the live query handle

### YOKE model

- Clay continues to own session state
- YOKE interface accepts `resumeSessionId` (opaque string)
- Claude adapter maps to `resume: cliSessionId`
- Other runtimes map to their own session persistence
- If a runtime has no session persistence, `resumeSessionId` is ignored (fresh conversation each time)

**Key insight**: YOKE does NOT manage sessions. It manages queries. A query is "start a conversation, stream events, push follow-ups, abort." Session persistence is an optional capability.

---

## 7. MCP Tool Server Deep Dive

### Current state

- `browser-mcp-server.js` and `debate-mcp-server.js` use `sdk.createSdkMcpServer()` + `sdk.tool()`
- These produce MCP server config objects passed to `sdk.query()` via `mcpServers` option
- I-3 and I-4 do `require("@anthropic-ai/claude-agent-sdk")` directly

### YOKE model

YOKE needs a tool registration interface:

```js
adapter.createToolServer({
  name: "clay-browser",
  version: "1.0.0",
  tools: [
    { name: "screenshot", description: "...", inputSchema: {...}, handler: fn },
    { name: "click", description: "...", inputSchema: {...}, handler: fn },
  ]
})
```

- **INTERFACE**: `createToolServer(definition) => opaqueToolServer`. Clay defines tools (name, schema, handler). Adapter wraps them in runtime-specific format.
- **ADAPTER**: Claude adapter uses `createSdkMcpServer()` + `sdk.tool()` internally.
- **Phase 3 action**: browser-mcp-server.js and debate-mcp-server.js must stop importing SDK directly. They define tools in a runtime-agnostic format. The Claude adapter wraps them.

### Tool definition format (YOKE-native)

```js
{
  name: "screenshot",
  description: "Take a screenshot of the browser",
  inputSchema: {
    type: "object",
    properties: { ... },
  },
  handler: async function(input) { return { content: "..." }; }
}
```

This is close to MCP's tool shape but without the SDK dependency. The Claude adapter translates to `sdk.tool()` calls.

---

## 8. Worker Process Classification

The sdk-worker.js subprocess model is for OS-level user isolation. It's orthogonal to YOKE.

| Component | Classification | Rationale |
|-----------|---------------|-----------|
| Worker spawn/lifecycle | **CLAY** | Infrastructure concern. Clay decides when to use a worker. |
| Worker IPC protocol | **ADAPTER** | The protocol between Clay and the worker carries serialized SDK calls. In the YOKE model, the adapter handles this internally. |
| Worker's `getSDK()` + `sdk.query()` | **ADAPTER** | Same SDK calls, just in a child process. The adapter manages worker delegation. |

**Phase 3 implication**: The Claude adapter owns both the in-process and worker-process paths. Clay calls `query.start()` and doesn't know whether the adapter runs it in-process or in a worker.

---

## 9. Claude-Specific Data Injection Classification

### Already classified in Phase 1 supplement

| Category | Classification | Notes |
|----------|---------------|-------|
| CLAUDE.md assembly (MD-1~9, 11~15) | **CLAY** | Content composition and file I/O. |
| CLAUDE.md injection (MD-10) | **INTERFACE** | Crosses boundary via `systemPrompt` query option. |
| .claude/ directory (DIR-1~7) | **CLAY** | File system structure is Clay's concern. |
| mate.yaml (Y-1~5) | **CLAY** | Mate metadata management. |
| Skill discovery (SK-1~3) | **CLAY** | Scanning filesystem for skills is Clay's job. |
| Skill registration (SK-4~5) | **INTERFACE** | Passing tool servers to the adapter via `toolServers` option. |
| Permission policy (PM-1~4, PM-7~8) | **CLAY** | Policy decisions live in Clay. |
| Permission SDK call (PM-5~6) | **ADAPTER** | `setPermissionMode()` is Claude-specific optimization. |
| Environment setup (E-1~3) | **CLAY** | Process environment is infrastructure. |

---

## 10. Proposed YOKE Interface

Based on the classification above, the YOKE interface has 3 concerns.

### 10.0 Vendor Identity

No central vendor enum. Each adapter self-identifies:

```js
adapter.vendor   // "claude", "opencode", "codex", etc.
```

The vendor string is used as the namespace key in `adapterOptions` and the `vendor` field in `runtime_specific` events. YOKE does not maintain a registry of known vendors. Adding a new adapter does not require changes to YOKE core.

### 10.1 Adapter Lifecycle

```js
// Initialize adapter, discover capabilities
adapter.init({ cwd }) => Promise<{
  models: string[],          // available model names
  defaultModel: string,      // default model
  skills: string[],          // SDK-reported skills
  capabilities: {            // what this adapter supports
    thinking: boolean,       // extended thinking / reasoning
    betas: boolean,          // beta feature flags
    rewind: boolean,         // session rewind to specific point
    sessionResume: boolean,  // resume previous conversation
    promptSuggestions: boolean, // suggestion chips
    elicitation: boolean,    // structured user input during tool execution
    fileCheckpointing: boolean, // file backup before edits
    contextCompacting: boolean, // context window compression
    toolPolicy: string[],   // supported setToolPolicy values
  },
}>

// Query available models (callable anytime, no active query needed)
adapter.supportedModels() => Promise<string[]>
```

`supportedModels()` is adapter-level, not query-level. Model list is needed before `createQuery()` to decide which model to use. Claude SDK exposes this on the query stream, but that's an implementation detail. The adapter caches the result from init/warmup.

`capabilities` drives Clay's UI and feature strategy. See [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) for how Clay uses capabilities to decide MAP/POLYFILL/DEGRADE/HIDE per feature.

### 10.2 Query Lifecycle

```js
// Create and start a query (returns a QueryHandle)
adapter.createQuery({
  // --- YOKE standard options (all adapters must understand) ---
  cwd: string,
  systemPrompt?: string,     // explicit system prompt (mentions)
  model?: string,
  effort?: string,           // optional, adapter ignores if unsupported
  toolServers?: ToolServer[], // registered tool servers
  canUseTool: (toolName, input, opts) => Promise<{ behavior, message? }>,
  onElicitation?: (request, opts) => Promise<response>,
  resumeSessionId?: string,  // opaque, adapter maps to its format
  abortSignal?: AbortSignal,

  // --- Adapter-specific options (vendor namespace) ---
  adapterOptions?: {
    CLAUDE?: {
      thinking?: { type: string, budgetTokens?: number },
      betas?: string[],
      settingSources?: string[],
      enableFileCheckpointing?: boolean,
      promptSuggestions?: boolean,
      agentProgressSummaries?: boolean,
      resumeSessionAt?: string,       // UUID for rewind
      permissionMode?: string,        // "acceptEdits", "bypassPermissions"
      allowDangerouslySkipPermissions?: boolean,
      extraArgs?: object,
    },
    OPENCODE?: { ... },
    CODEX?: { ... },
  },
}) => QueryHandle

// QueryHandle (async iterable of normalized events)
queryHandle[Symbol.asyncIterator]()  // yields normalized YOKE events
queryHandle.pushMessage(text, images)
queryHandle.setModel(model)
queryHandle.setEffort(effort)
queryHandle.setToolPolicy(policy)    // "ask" | "allow-all"
queryHandle.stopTask(taskId)
queryHandle.getContextUsage() => Promise<object|null>
queryHandle.abort()
queryHandle.close()                  // end the message stream
```

### 10.3 Tool Server Creation

```js
// Create a tool server from runtime-agnostic definitions
adapter.createToolServer({
  name: string,
  version: string,
  tools: [{
    name: string,
    description: string,
    inputSchema: object,
    handler: async (input) => { content: string },
  }],
}) => ToolServer  // opaque, passed to createQuery via toolServers
```

### 10.4 Lifecycle Sequence

Strict call order. Violating this sequence is a usage error.

```
1. adapter = createAdapter({ vendor: VENDORS.CLAUDE, ... })
2. await adapter.init({ cwd })
3. toolServer1 = adapter.createToolServer(browserToolDefs)
   toolServer2 = adapter.createToolServer(debateToolDefs)
4. models = await adapter.supportedModels()
5. query = adapter.createQuery({
     model: models[0],
     toolServers: [toolServer1, toolServer2],
     adapterOptions: { CLAUDE: { thinking: ... } },
     ...
   })
6. for await (event of query) { ... }     // consume events
7. query.pushMessage("follow-up", [])      // multi-turn
8. query.setModel("claude-sonnet-4-20250514")       // change for next turn
9. query.setToolPolicy("allow-all")        // change policy
10. query.abort()                           // cancel
11. query.close()                           // end message stream
```

Steps 1-4 happen once per adapter. Steps 5-11 repeat per query/session.

### Method count

| Concern | Methods |
|---------|---------|
| Adapter lifecycle | 2 (`init`, `supportedModels`) |
| Query lifecycle | 8 (`createQuery`, `pushMessage`, `setModel`, `setEffort`, `setToolPolicy`, `stopTask`, `getContextUsage`, `abort`, `close`) |
| Tool server | 1 (`createToolServer`) |
| **Total** | **11** |

---

## 11. What Does NOT Cross the Interface

Explicitly listing what stays out of YOKE's interface methods. These items were considered and rejected as interface methods. Items marked with (*) are still accessible via `adapterOptions.CLAUDE` passthrough.

| Item | Reason for exclusion |
|------|---------------------|
| `setPermissionMode(mode)` | Claude-specific. YOKE uses `canUseTool` + `setToolPolicy`. (*) Accessible via `adapterOptions.CLAUDE.permissionMode` for SDK optimization. |
| `processQueryStream()` | Adapter-internal event loop. YOKE exposes the normalized event stream. |
| `getOrCreateRewindQuery()` | Adapter-internal mechanism for session rewind. (*) `resumeSessionAt` accessible via `adapterOptions.CLAUDE.resumeSessionAt`. |
| `checkToolWhitelist()` | Pure Clay logic, no SDK dependency. |
| `handleCanUseTool()` / `handleElicitation()` | Clay's orchestration between SDK callbacks and WebSocket clients. |
| `isClaudeProcess()` | Adapter-internal process management. |
| `startIdleReaper()` | Clay session lifecycle, not YOKE's concern. |
| `settingSources`, `betas`, `thinking`, `enableFileCheckpointing` | Claude-specific query options. (*) All accessible via `adapterOptions.CLAUDE`. Clay retains full control. |
| `promptSuggestions`, `agentProgressSummaries` | Claude-specific features. (*) Accessible via `adapterOptions.CLAUDE`. |
| `spawnClaudeCodeProcess` | Worker-process spawn override. Adapter-internal. |
| Worker IPC protocol | Adapter-internal communication between main and worker process. |
| CLAUDE.md file I/O | Clay's file management. Only the assembled `systemPrompt` string crosses. |
| `.claude/` directory structure | Clay's file system convention. |

**Key distinction**: "Does not cross the interface" does NOT mean "Clay loses access." It means the option is not part of YOKE's universal contract. Clay passes vendor-specific options via `adapterOptions.VENDOR` and retains full control over every feature the runtime supports.

---

## 12. Risk Assessment

### Low risk (high confidence)

- `createQuery()` / `pushMessage` / `abort` / `close`: Direct mapping to `sdk.query()` / `messageQueue.push()` / `abortController.abort()` / `messageQueue.end()`. Every runtime has these concepts.
- `init()` / `supportedModels()`: Every runtime has initialization and model listing.
- `canUseTool` callback: Universal concept.
- `adapterOptions` passthrough: Zero-risk escape hatch. Adapter ignores keys it doesn't understand.

### Medium risk (may need adjustment in Phase 5)

- **Event normalization**: The 20 normalized event types in Section 3 are derived from Claude's event format. Mitigated by `runtime_specific` passthrough event -- new runtimes can emit unmapped events without breaking the interface.
- **`effort`**: Not a universal concept. Acceptable as optional parameter, but if multiple runtimes ignore it, consider removing from interface.
- **`stopTask(taskId)`**: Sub-agent task management varies widely. Some runtimes may not have sub-agents. No-op is acceptable.
- **`setToolPolicy("allow-all")`**: Sufficient for the universal case. Intermediate policies (accept edits only) handled via `canUseTool` callback + `adapterOptions.CLAUDE.permissionMode`.

### High risk (Phase 2 classification may be wrong)

- **`systemPrompt` for main sessions**: Currently the Claude SDK auto-reads CLAUDE.md from the project directory. YOKE's interface accepts an explicit `systemPrompt`. For main sessions, the Claude adapter lets the SDK auto-read (no `systemPrompt` passed). But this means the Claude adapter has implicit behavior that other adapters won't have. **Phase 5 test**: Does the second adapter need Clay to always pass `systemPrompt`? If yes, the interface is correct. If no (because the second adapter also has auto-read), the interface has unnecessary complexity.
- **`onElicitation`**: Elicitation is a Claude-specific feature (structured user input during tool execution). If no other runtime has this, the callback becomes dead code in other adapters. **Mitigation**: Optional in the interface. Adapters that don't support it simply never call it. Kept in interface (not deferred) because it follows the same pattern as `canUseTool` (runtime asks Clay for user input) and moving it to adapter-internal would create reverse coupling (adapter depends on Clay's WebSocket layer).

---

## 13. Review Log

Changes applied after Arch/아키 review on 2026-04-11:

| # | Change | Source | Rationale |
|---|--------|--------|-----------|
| 1 | `supportedModels()` moved from QueryHandle to `adapter.supportedModels()` | Arch + 아키 | Call order: model list needed before `createQuery()`. "Don't ask for the menu after ordering." |
| 2 | Lifecycle sequence diagram added (Section 10.4) | 아키 | Explicit init -> createToolServer -> createQuery order. Without this, Phase 3 implementer doesn't know the constraints. |
| 3 | `adapterOptions` with vendor namespace added | Chad | Prevents abstraction from killing Clay's Claude-specific features. `adapterOptions.CLAUDE.{option}` is explicit and collision-free. |
| 4 | ~~Vendor constants enum~~ replaced with adapter self-identification (`adapter.vendor`) | Revised after further review | No central enum. Adding a new adapter should not require YOKE core changes. |
| 5 | `setToolPolicy` values reduced to `"ask"` / `"allow-all"` | Arch | `"auto-edits"` was Claude's permissionMode leaking into interface. Intermediate policies handled via `canUseTool` callback + `adapterOptions.CLAUDE.permissionMode`. |
| 6 | `message_start` renamed to `turn_start`, usage payload removed | 아키 | Usage data flows through `getContextUsage()` pull method only. One piece of data, one path. `turn_start` is a pure signal. |
| 7 | `runtime_specific` event type added | Arch | Passthrough for unmapped runtime events. Prevents interface changes when new runtimes emit novel event types. |
| 8 | `onElicitation` kept as optional INTERFACE | (retained) | Same pattern as `canUseTool`. Deferring to Phase 5 would create reverse coupling. |
| 9 | ADAPTER options table updated with "Clay uses it?" column | Chad | Documents that every ADAPTER option remains accessible via `adapterOptions`. Nothing is lost to abstraction. |
| 10 | 3 missing data flows documented as `runtime_specific` examples: `message_uuid`, early `session_id`, `fast_mode_state` | Final CLAY review | These were classified as ADAPTER-internal but actually reach Clay's UI. `runtime_specific` passthrough covers them without polluting the normalized event set. |

---

## Next Step

Phase 3: Implement `lib/yoke/interface.js` and `lib/yoke/adapters/claude.js` based on this classification. The 11 interface methods defined in Section 10 become the contract. Zero behavior change.
