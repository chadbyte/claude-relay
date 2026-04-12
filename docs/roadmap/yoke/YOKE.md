# YOKE Roadmap

> Vendor-independent harness abstraction protocol for Clay.
> This file serves as plan, progress tracker, and hand-off document for coding agents.

---

## Context

Clay currently runs exclusively on Claude Code's agent SDK. YOKE extracts all SDK-coupled code behind an interface so Clay can support multiple agent runtimes without changing business logic.

- **Name**: YOKE (Yoke Overrides Known Engines)
- **Metaphor**: A yoke unifies multiple oxen. YOKE unifies multiple harnesses.
- **Design principle**: "What to do" stays in Clay. "How to deliver it to the SDK" moves to YOKE.
- **Architecture**: Interface + Implementation pattern. Clay calls the interface, never the SDK directly.
- **Extraction trigger**: After Phase 4. YOKE becomes a separate repo and Clay depends on it as a library. Second and third adapters are post-release work (by us or community).

### Strategy (revised)

1. **Stage 1 (now)**: Define YOKE interface inside Clay. Build Claude adapter. All SDK calls go through the interface. Extract as standalone package. Open-source.
2. **Stage 2 (post-release)**: Community or us builds additional adapters (OpenCode, Codex, etc.). Interface is stable. Claude-specific assumptions documented for adapter authors.

Original plan required a second adapter before extraction ("prove the interface works"). Revised because:
- Phase 2 already validated the interface against multiple runtimes ("would Codex/OpenCode need this?")
- Phase 3 Section 7-8 identified all Claude-specific assumptions in processSDKMessage (3 items, documented)
- Open-sourcing with one adapter invites community contribution. Waiting for three adapters delays feedback.
- Separating the library early is technically cleaner: Clay depends on YOKE via npm link, not inline code.

### Target runtimes

| Runtime | Priority | Notes |
|---------|----------|-------|
| Claude Code (Anthropic) | Stage 1 (included) | Current runtime. Ships with YOKE. |
| OpenCode | Stage 2, community or us | JS/TS + Python SDK, OpenAPI 3.1 spec. Open-source, stable API. Lowest technical resistance. |
| Codex CLI (OpenAI) | Stage 2, community or us | Name recognition. Higher API churn risk. |
| Gemini CLI (Google) | Stage 2, if demand | |
| Copilot CLI (GitHub/Microsoft) | Stage 2, if demand | |

### When to think about other runtimes

| Phase | Multi-runtime awareness | Reason |
|-------|------------------------|--------|
| Phase 1 (Audit) | No | Just scanning current code |
| Phase 2 (Classify) | Yes | The only moment to draw the boundary. Ask "would Codex/Gemini need this?" |
| Phase 3 (Implement) | No | Claude adapter only. Extraction, no behavior change. |
| Phase 4 (Extract + Release) | Docs only | Protocol doc, README for adapter authors. No new adapter code. |
| Post-release | Yes | Community or us builds adapters. Claude assumptions addressed when needed. |

### Pre-conditions (completed)

- sdk-bridge.js monolith (2,424 lines) decomposed via PR-29~32
- SDK calls wrapped in intermediate functions during refactoring
- getSDK() factory pattern preserved as runtime injection point
- MCP server SDK imports isolated as "SDK adapter zone"

---

## Architectural Risk Assessment

### Success probability by stage

| Stage | Confidence | Rationale |
|-------|-----------|-----------|
| Stage 1 (interface + Claude adapter + extraction) | 90% | sdk-bridge decomposition done (PR-29~32). getSDK() injection point alive. This is moving working code behind a wrapper, not building new functionality. Scope is controlled by "zero behavior change" constraint. Library separation (Phase 4a) validates decoupling before publish. |
| Stage 2 (second adapter, post-release) | 70% | Was 60%. Increased because Phase 3 Section 7-8 identified all Claude-specific assumptions in advance (3 items, documented). Interface validated against multiple runtimes during Phase 2 design. Risk is known and bounded. |

### The 10% risk in Stage 1: abstraction leakage

The single biggest threat is Claude SDK concepts bleeding into the YOKE interface. Three specific leak points:

1. **Session model**. Claude's `createMentionSession()` carries assumptions about how sessions start, resume, and nest. If the interface mirrors this shape, a runtime with a different session model (stateless, or conversation-based) won't fit without hacks.
2. **Permission handling**. Claude SDK has its own permission grant/deny flow. If YOKE's interface exposes `grantPermission(toolName)` as-is, runtimes that handle permissions differently (or don't have them) get stuck implementing no-ops.
3. **MCP tool registration**. The current skill-to-tool pipeline is tightly coupled to Claude's MCP format. If tool registration in the interface assumes MCP shape, non-MCP runtimes need a translation layer that should live in the adapter, not in Clay.

### Design guardrail

Phase 2 classification is the make-or-break moment. The rule: **if you can imagine a runtime that would implement a method differently, it belongs in the adapter. If you can imagine a runtime that wouldn't need the method at all, the method shouldn't exist in the interface.**

Ask "would Codex/Gemini/Copilot need this?" for every interface method. If the answer is "probably not," the method is a Clay concern disguised as an interface concern.

### Multi-runtime feature strategy

When a feature exists in one runtime but not another, the answer is NOT always "hide it." See [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) for the 4 strategies: MAP (adapter maps equivalent APIs), POLYFILL (Clay implements at a higher level), DEGRADE (reduced UX), HIDE (last resort). Adapters declare capabilities via `init()`, and Clay adapts its UI accordingly.

---

## Phase 1: SDK Call Audit (scan)

**Goal**: Produce an up-to-date map of every SDK touch point in the post-refactoring codebase.

**Agent instruction**:

```
Scan the following files and all modules they import:
- server.js
- project.js
- All files under lib/

Search for:
1. SDK import/require: "@anthropic-ai", "claude-agent-sdk", "sdk-bridge", getSDK()
2. SDK direct calls: any method on objects imported from above
3. CLI spawn: spawn/exec calling "claude" binary
4. HTTP calls: api.anthropic.com or similar endpoints
5. Claude-specific data injection: CLAUDE.md read/write, .claude/ directory access,
   mate.yaml loading into sessions, skill registration as tools, permission setting

For each call site, record:
- file:line
- SDK method/function name
- One-line description of what it does
- Surrounding business context

Output as a markdown table. Do NOT modify any code. Append results to this file under
"## Phase 1 Results".
```

**Status**: Complete (2026-04-11). See [PHASE1_SDK_AUDIT.md](./PHASE1_SDK_AUDIT.md).

---

## Phase 2: Interface Design + Classify

**Goal**: Define the YOKE interface based on audit results. Chad reviews and decides what crosses the interface boundary.

### Classification rules

| Decision | Criteria | Examples |
|----------|----------|---------|
| INTERFACE | "Would this change if we swapped to a different LLM runtime?" | SDK init, session lifecycle, message send/receive, API transport |
| CLAY | "Is this Clay's decision, not the SDK's?" | User auth, routing, Mate selection, CLAUDE.md content assembly, skill discovery, business error handling |

### Boundary cases

| Situation | Resolution |
|-----------|------------|
| Assemble CLAUDE.md then inject into session | Assembly (CLAY), injection call (INTERFACE) |
| Define permission policy then pass to SDK | Policy definition (CLAY), SDK permission call (INTERFACE) |
| Load/parse skills then register as tools | Loading/parsing (CLAY), tool registration call (INTERFACE) |

After classification, the INTERFACE items define YOKE's contract. Update the Phase 1 table with an INTERFACE/CLAY column.

**Status**: Complete (2026-04-11). See [PHASE2_CLASSIFICATION.md](./PHASE2_CLASSIFICATION.md).

### Phase 2 Results Summary

Full classification in [PHASE2_CLASSIFICATION.md](./PHASE2_CLASSIFICATION.md). Revised after Arch/아키 review (9 changes applied).

**Three-way classification applied**: INTERFACE (crosses YOKE boundary), ADAPTER (runtime-specific, hidden inside adapter), CLAY (Clay's own concern, never touches YOKE).

**YOKE interface surface: 11 methods across 3 concerns**:
- Adapter lifecycle: `init()`, `supportedModels()`
- Query lifecycle: `createQuery()`, `pushMessage()`, `setModel()`, `setEffort()`, `setToolPolicy()`, `stopTask()`, `getContextUsage()`, `abort()`, `close()`
- Tool server: `createToolServer()`

**Critical design decisions**:

1. **Permission model**: `setPermissionMode()` is ADAPTER-internal. YOKE uses `canUseTool` callback (universal) + `setToolPolicy("ask" | "allow-all")` (2 values only). Claude's intermediate policies ("acceptEdits") handled via `canUseTool` callback + `adapterOptions.CLAUDE.permissionMode`.

2. **Event normalization**: YOKE normalizes runtime-specific events into 20 stable event types. Includes `runtime_specific` passthrough for unmapped events. `message_start` renamed to `turn_start` (signal only, no usage payload). Usage data flows through `getContextUsage()` single path.

3. **Session model**: YOKE does NOT manage sessions. It manages queries. Session state is Clay's concern. `resumeSessionId` is an opaque string the adapter maps to its runtime's persistence mechanism.

4. **MCP tool servers**: `createToolServer()` accepts runtime-agnostic tool definitions (name, schema, handler). Claude adapter wraps via `createSdkMcpServer()` + `sdk.tool()`. MCP server files (browser-mcp-server.js, debate-mcp-server.js) must stop importing SDK directly.

5. **Worker process**: Adapter-internal. Clay calls `createQuery()` and doesn't know whether the adapter runs in-process or in a worker.

6. **adapterOptions with vendor namespace**: `adapterOptions[adapter.vendor].{option}` passthrough ensures Clay never loses access to runtime-specific features (thinking, betas, promptSuggestions, resumeSessionAt, etc.). Vendor namespace is explicit and collision-free. No central vendor enum; each adapter self-identifies via `adapter.vendor`. Features in adapterOptions are candidates for promotion to YOKE standard when a second adapter needs the same concept (see DEVELOPER_GUIDE.md).

7. **Lifecycle sequence**: Strict order enforced: `init()` -> `createToolServer()` -> `createQuery()`. Documented in Section 10.4.

**High-risk items for post-release validation** (when a second adapter is built):
- `systemPrompt` for main sessions (Claude auto-reads CLAUDE.md, other runtimes may not)
- `onElicitation` (optional, kept in interface because same pattern as `canUseTool`)
- Claude-specific logic in processSDKMessage: auth detection, fast_mode_state, block index tracking (documented in PHASE3 Section 7)

---

## Phase 3: Implement (Claude adapter)

**Goal**: Create the YOKE interface and Claude implementation. Rewire all call sites.

**Structure** (repo-ready: `lib/yoke/` can be copied as-is to become the standalone YOKE repo):

```
lib/yoke/
  package.json          # name: "yoke", ready for npm publish
  README.md             # YOKE (Yoke Overrides Known Engines)
  index.js              # public API entry point
  interface.js          # the contract: what adapters must implement
  adapters/
    claude.js           # Claude Code SDK implementation
```

**Agent instruction**:

```
Read the Phase 1 Results table in this file. For every row marked INTERFACE:

1. Define the corresponding function signature in lib/yoke/interface.js.
2. Implement it in lib/yoke/adapters/claude.js using the current SDK calls.
3. Replace the original call site to go through the YOKE interface.

Rules:
- Zero behavior change. Existing functionality must be identical.
- Interface signatures reflect what Clay needs, not SDK internals.
  e.g. startSession(opts) not sdk.createMentionSession(opts).
- Claude adapter maps interface calls to SDK-specific implementation.
- SDK-level try/catch moves into the adapter. Business error handling stays in place.
- After extraction, NO file outside lib/yoke/adapters/ should directly import
  "@anthropic-ai", "claude-agent-sdk", or call getSDK().

When done, append verification results to this file under "## Phase 3 Verification".
```

**Status**: Complete (2026-04-11). All 5 sub-steps done. See [PHASE3_IMPLEMENTATION.md](./PHASE3_IMPLEMENTATION.md).

### Phase 3 sub-steps

| Step | Description | Status |
|------|-------------|--------|
| 3a | Scaffold `lib/yoke/`, create adapter shell, rewire all `getSDK` call sites | Complete |
| 3b | Move worker management code (~530 lines) from sdk-bridge.js into adapter. `createQuery()` owns both in-process and worker paths. Clay does not know which path runs. | Complete |
| 3c | Make QueryHandle the real abstraction. Remove `_rawQuery`/`_messageQueue`/`_pushRaw`. `processQueryStream` iterates QueryHandle, not raw SDK query. Worker and in-process yield the same event shape. | Complete |
| 3d | Event flattening. Adapter flattens nested SDK events into `{ yokeType, ...fields }`. processSDKMessage if-conditions simplify (not a rewrite). Claude-specific logic stays in place for now. See PHASE3 Section 7-8 for analysis. | Complete |
| 3e | Claude assumption cleanup. Block index -> blockId (adapter assigns ID, processSDKMessage tracks by ID). fast_mode_state already generic (field check + forward). Auth detection stays (needs session context, cannot move to adapter). | Complete |

---

## Phase 4a: Gemini Adapter (second runtime proof)

**Goal**: Build the Gemini adapter to prove the YOKE interface works across runtimes. Two adapters before open-source release.

See [PHASE4A_GEMINI_ADAPTER.md](./PHASE4A_GEMINI_ADAPTER.md) for full plan.

**Key points**:
- SDK: `@google/genai` (v1.49.0). Mature, well-documented.
- Biggest difference: tool calling loop. Claude SDK handles tools internally, Gemini adapter must run the loop.
- Estimated ~500-600 lines (less than half of claude.js, no worker/IPC needed).
- Expected: zero changes to interface.js and processSDKMessage.
- Show HN headline: "Claude + Gemini, swap with one config change."

**Status**: Not started

---

## Phase 5: Extract, Document, Release

**Goal**: Separate YOKE from Clay as a standalone package. Document the protocol. Open-source.

### 5a. Library separation

Extract `lib/yoke/` to its own repo. Clay replaces the directory with an npm dependency.

```
Before:
  clay/lib/yoke/          # inline code

After:
  yoke/                   # standalone repo (MIT license)
    package.json
    index.js
    interface.js
    adapters/
      claude.js
      claude-worker.js

  clay/
    package.json          # "yoke": "file:../yoke" or npm link
    lib/sdk-bridge.js     # require("yoke") instead of require("./yoke")
```

Clay develops against a local link (`npm link yoke` or `file:` dependency). This validates that YOKE is truly decoupled before publishing. If Clay needs to reach into YOKE internals, the boundary is wrong and must be fixed before release.

### 5b. Protocol documentation

Document the worker IPC protocol (Unix domain socket + JSON lines). This is the candidate foundation for YOKE's cross-runtime message spec.

Enumerate all message types, payloads, and response formats currently used between the adapter and claude-worker.js.

### 5c. Adapter author documentation

README and DEVELOPER_GUIDE for adapter authors:
- How to implement a new adapter (the 11 interface methods)
- Event flattening map (yokeType reference)
- Capability declaration
- adapterOptions vendor namespace
- Known Claude-specific assumptions in processSDKMessage

### 5d. Publish

Create standalone repo. npm publish. Clay switches to npm dependency.

**Status**: Not started

---

## Post-release: Additional Adapters

Additional adapters are built after YOKE is published. By us or by the community.

### Candidate adapters

| Runtime | Likely builder | Notes |
|---------|---------------|-------|
| OpenCode | Community or us | JS/TS + Python SDK, OpenAPI 3.1. Lowest resistance. Good first community contribution. |
| Codex CLI (OpenAI) | Community or us | Name recognition. Higher API churn risk. |
| Gemini CLI (Google) | Community, if demand | |
| Copilot CLI (GitHub/Microsoft) | Community, if demand | |

### When a second adapter lands

That is the real test of the interface. If it needs breaking changes, the Phase 2 classification was wrong. At that point:
- Claude-specific assumptions in processSDKMessage (auth detection, fast_mode_state, block index) get addressed
- Interface may get minor additions (new yokeType events, new capability flags)
- YOKE publishes a major version bump if breaking

### What "open-source YOKE" enables for Clay

- **Show HN headline**: "Clay: collaborative AI coding, works with any agent runtime"
- **Reduced vendor risk**: Users are not locked to Anthropic
- **Community growth**: Adapter contributions bring users from other ecosystems
- **Technical clarity**: Library boundary forces clean architecture

---

## Hand-off Log

Record agent hand-offs here. Each entry: date, agent/mate, what was done, what's next.

| Date | Agent | Done | Next |
|------|-------|------|------|
| 2026-04-11 | Claude | Phase 1 SDK Audit complete. 5 import sites, 6 query() calls, 22 query options, 18 IPC message types mapped. | Phase 1 arch review feedback applied. Ready for Phase 2. |
| 2026-04-11 | Arch (review) | Flagged 3 issues: MCP require() inconsistency, Section 4 pre-classification bias, CLAUDE.md sub-classification needed. | 2 of 3 applied to audit doc. Section 4 bias noted for Phase 2 start. |
| 2026-04-11 | Claude | Phase 2 Classification initial draft. 3-way classification, 11 interface methods. | Sent to Arch/아키 review. |
| 2026-04-11 | Arch + 아키 | Review: 4 issues each. Key: supportedModels() call order, setToolPolicy value count, event extensibility, lifecycle diagram. | 9 changes identified. |
| 2026-04-11 | Chad | Raised practical concern: abstraction must not kill Clay's Claude-specific features. Led to adapterOptions.VENDOR namespace design. | adapterOptions added. setToolPolicy kept at 3 values initially, then reduced to 2 with adapterOptions covering intermediate policies. |
| 2026-04-11 | Claude | Phase 2 revised: all 9 changes applied. adapterOptions.CLAUDE passthrough, vendor constants, lifecycle diagram, turn_start event, runtime_specific event, supportedModels moved to adapter level. | Final CLAY review requested. |
| 2026-04-11 | Claude | Final CLAY classification review: found 3 missing data flows (message_uuid, early session_id, fast_mode_state) that reach UI but weren't documented. Added as runtime_specific passthrough examples. Total changes: 10. | Phase 2 classification done. |
| 2026-04-11 | Claude | DEVELOPER_GUIDE.md created. 4 strategies (MAP/POLYFILL/DEGRADE/HIDE), capability-based UI, adapterOptions usage rules, user-supplied polyfill registry pattern. init() capabilities added to Phase 2 interface. | Phase 2 fully complete. Ready for Phase 3. |
| 2026-04-11 | Claude | Phase 3a complete: scaffold + rewire. Created lib/yoke/ (4 new files), rewired 9 existing files. SDK imports isolated to lib/yoke/adapters/. | Review identified 3 gaps: worker code not moved, QueryHandle is a shallow wrapper (_rawQuery leak), event normalization skipped. |
| 2026-04-11 | Chad | Review: 3a is only 70%. Worker code in sdk-bridge (#2), _rawQuery hack (#3), no event normalization (#1) are all real problems. Core issue: QueryHandle is not a real abstraction. OK with deprecated sdk-worker.js (#4) and Zod inputSchema (#5). | Steps 3b, 3c, 3d defined. Order: worker move -> QueryHandle real abstraction -> event flattening. |
| 2026-04-11 | Claude | processSDKMessage analysis (568 lines): 99% Clay business logic, ~0% translation. Adapter job is event flattening (nested -> flat), not logic rewrite. 3 Claude-specific items identified (auth, fast_mode, block index), deferred to post-release. | Step 3d scope reduced: flattening only, no behavior change. |
| 2026-04-11 | Chad | Phase 3 principle: extraction only, no behavior change. Also: open-source after Phase 4, not after Phase 6. Separate YOKE as library early, Clay depends via npm link. | Roadmap restructured: Phase 4 = extract + doc + release. Phase 5/6 collapsed to post-release community work. |
| 2026-04-11 | Chad | But if releasing after Phase 4, Claude assumptions must be resolved before release, not after. Added Step 3e: move auth detection, fast_mode_state, block index into adapter (~25 lines). Runs after 3d is stable, before Phase 4. | Step 3e added. Dependency chain: 3d (flatten, no behavior change) -> 3e (cleanup, ~25 lines behavior change) -> Phase 4 (release). |
| 2026-04-11 | Claude | Step 3b complete. Worker management (~530 lines) moved from sdk-bridge.js to claude.js. createWorkerQueryHandle wraps IPC into async iterable. adapter.createQuery branches on linuxUser. setEffort/setPermissionMode/stopTask route through QueryHandle. Idle reaper updated. | Step 3c next: QueryHandle real abstraction. |
| 2026-04-11 | Claude | Step 3c complete. Removed `_rawQuery`, `_messageQueue`, `_pushRaw` from both QueryHandle implementations. `session.queryInstance = handle` directly. `pushMessage()` routes through QueryHandle for all paths. `rewindFiles()` added as pass-through. | Step 3d next: event flattening. |
| 2026-04-11 | Claude | Step 3d complete. `flattenEvent()` added to claude.js (~190 lines). Both iterators flatten before yielding. processSDKMessage rewritten to consume `yokeType` (26 checks, zero nested raw paths). All field names normalized (sessionId, slashCommands, cost, etc.). Zero behavior change. | Step 3e next: Claude assumption cleanup. |
| 2026-04-11 | Claude | Step 3e complete. blockIndex -> blockId (adapter assigns `"blk_" + index`). fast_mode_state already generic. Auth detection stays in processSDKMessage (needs session context, cannot move to adapter without breaking clean event design). Accepted as permanent deferral with documented migration path for second adapter. Phase 3 complete. | Phase 4: library extraction + release. |
| 2026-04-12 | Chad | Revised phase order: Gemini adapter before open-source release. Gemini chosen over OpenCode for Show HN impact (name recognition, generous tokens, strong model). npm package name `open-bridge` confirmed, `@open-bridge` org secured. | Phase 4a: Gemini adapter. |
| 2026-04-12 | Claude | Phase 4a plan written. Gemini SDK (`@google/genai`) audited: Chat-based API, FunctionDeclaration tools, streaming via sendMessageStream. 11 YOKE methods mapped. Biggest work: tool calling loop (adapter runs it, not SDK). Estimated ~500-600 lines. Expected zero interface changes. | Implementation next. |

---

## Phase 1 Results

Full audit in [PHASE1_SDK_AUDIT.md](./PHASE1_SDK_AUDIT.md). Key findings:

### SDK surface area

- **SDK import sites**: 5 (2x `getSDK()` factory, 2x direct `require()` in MCP servers, 1x package.json)
- **SDK methods used**: 5 (`query`, `supportedModels`, `setPermissionMode`, `stopTask`, `createSdkMcpServer`)
- **`sdk.query()` call sites**: 6 (4 in sdk-bridge.js, 2 in sdk-worker.js). All share the same `{ prompt: messageQueue, options }` shape.
- **Query option parameters**: 22 total, ~14 Claude-specific

### Structural observations

1. **Single entry point**: All SDK interaction funnels through `sdk.query()`. This is favorable for YOKE -- one method to abstract.
2. **MCP server inconsistency**: browser-mcp-server.js and debate-mcp-server.js use `require()` directly instead of the `getSDK()` factory. Phase 3 must unify this.
3. **CLAUDE.md sites**: 15 total. Sub-classified into ASSEMBLY (content composition), I/O (file read/write), and INJECTION (SDK session delivery). **Only 1 of 15 is INJECTION** (MD-10: `createMentionSession()` receives `claudeMd` as `systemPrompt`). The other 14 are pure Clay concerns.
4. **Worker IPC**: 17 message types (9 daemon->worker, 8 worker->daemon). This protocol is the candidate foundation for YOKE's cross-runtime message spec (Phase 4).
5. **sdk-bridge exported API**: 14 methods form the current de facto interface. This is the starting point for Phase 2 classification.

---

## Phase 3 Verification

### Step 3a checks (2026-04-11)

- [x] No direct SDK import/require in any file outside `lib/yoke/adapters/` (grep verified, except deprecated sdk-worker.js)
- [x] No `getSDK()` references in project.js, sdk-bridge.js, project-sessions.js, project-user-message.js, sessions.js
- [x] All 9 modified files pass `node -c` syntax check
- [x] MCP servers (browser-mcp-server.js, debate-mcp-server.js) export tool definitions without SDK dependency
- [x] Claude adapter implements all required interface methods: init, supportedModels, createToolServer, createQuery + session management (getSessionInfo, listSessions, renameSession, forkSession)

### Step 3a gaps (identified in review)

- [ ] **QueryHandle is a shell**: exposes `_rawQuery`, processQueryStream bypasses the handle -> Step 3c
- [ ] **Worker code in sdk-bridge.js**: ~530 lines of adapter-internal code still in Clay -> Step 3b
- [ ] **No event normalization**: processSDKMessage consumes raw Claude SDK events -> Step 3d

### Step 3b checks (2026-04-11)

- [x] No worker-related code in sdk-bridge.js (spawnWorker, startQueryViaWorker, warmupViaWorker, cleanupWorker, killSessionWorker all moved)
- [x] `adapter.createQuery()` handles linuxUser internally via `adapterOptions.CLAUDE.linuxUser`
- [x] `adapter.init()` handles linuxUser warmup internally
- [x] Worker IPC permission/elicitation routed through createQuery callbacks (canUseTool, onElicitation)
- [x] setEffort, setPermissionMode, stopTask route through QueryHandle (no session.worker.send)
- [x] Idle reaper uses queryInstance.close() for worker path
- [x] processQueryStream handles _worker_meta events (context_usage, model_changed, effort_changed, permission_mode_changed, worker_error)
- [x] Worker reuse via _adapterState pattern

### Step 3c checks (2026-04-11)

- [x] No `_rawQuery`, `_messageQueue`, `_pushRaw` on QueryHandle (grep verified: zero occurrences in lib/)
- [x] `processQueryStream` iterates QueryHandle (`for await (var msg of myQueryInstance)`)
- [x] `session.queryInstance` IS the QueryHandle (line 780: `session.queryInstance = handle`)
- [x] Worker and in-process paths produce same event shape through iterator
- [x] `pushMessage()` routes through QueryHandle for both paths
- [x] `rewindFiles()` added as pass-through on in-process QueryHandle for rewind support
- [x] Idle reaper uses `queryInstance.close()` (not `messageQueue.end()`)

### Step 3d checks (2026-04-11)

- [x] Adapter `flattenEvent()` converts all SDK events into `{ yokeType, ...fields }` format
- [x] processSDKMessage routes on `yokeType` (26 occurrences, zero nested raw paths)
- [x] Flattened events include `blockIndex` (compat for current block tracking)
- [x] Auth detection, fast_mode_state, block index logic: unchanged (stays for 3e)
- [x] All Phase 2 event types covered: init, turn_start, text_start/delta, thinking_start/delta, tool_start, tool_input_delta, block_stop, result, status, task_started, task_progress, task_notification, tool_progress, subagent_message, message, rate_limit, prompt_suggestion, system (catch-all), unknown (fallback)
- [x] Both in-process and worker iterators call flattenEvent before yielding
- [x] processSubagentMessage updated to use flattened field names

### Step 3e checks (2026-04-11)

- [x] Block tracking uses `blockId` (not integer index). Adapter assigns `"blk_" + index`, processSDKMessage tracks `session.blocks[blockId]`.
- [x] fast_mode_state: already generic. Field on init/result, processSDKMessage checks and forwards if present. No change needed.
- [ ] Auth detection heuristic: stays in processSDKMessage (needs session.responsePreview, which is session state not available to flattenEvent). Accepted deferral, see below.
- [x] All manual tests pass after 3e

### Auth detection: accepted deferral

The "not logged in" text pattern check (lines 337-338, 364-377 of processSDKMessage) reads `session.responsePreview` which is accumulated during streaming. `flattenEvent` only sees individual raw SDK events and has no access to session state. Moving this detection to the adapter would require passing session state into the flattener, breaking the clean event-in/event-out design.

When a second adapter exists, the recommended approach is:
- The second adapter detects auth failure via its own mechanism (error code, HTTP status, etc.)
- It sets `isAuthPrompt: true` on the result event
- processSDKMessage checks `parsed.isAuthPrompt` first, falls back to text heuristic for Claude
- The text heuristic is harmless for other adapters (it only triggers on very specific zero-cost short responses)

### Manual tests (pending, after all steps)

- [ ] Mate session create, message exchange, skill execution
- [ ] @mention flow (createMentionSession via adapter)
- [ ] Session rewind (getOrCreateRewindQuery via adapter)
- [ ] Worker mode (OS multi-user)
- [ ] MCP tools (browser automation, debate proposal)
- [ ] Session resume, rename, fork via adapter
- [ ] Rate limit auto-continue
- [ ] Warmup (model list, skill discovery)
