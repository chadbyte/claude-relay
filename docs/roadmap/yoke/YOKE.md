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
- **Extraction trigger**: When the Codex implementation is added, YOKE becomes a separate open-source repo.

### Strategy (two stages)

1. **Stage 1 (now)**: Define YOKE interface inside this project. Build Claude adapter. All SDK calls go through the interface. Claude-only, no multi-runtime concerns. No separate repo yet.
2. **Stage 2 (multi-runtime)**: Add second adapter. At this point, extract YOKE as a standalone open-source package. Clay depends on it as a library.

### Target runtimes

| Runtime | Priority | Notes |
|---------|----------|-------|
| Claude Code (Anthropic) | Stage 1 | Current runtime. First adapter. |
| OpenCode | Stage 2, first | JS/TS + Python SDK, OpenAPI 3.1 spec. Open-source, stable API. Lowest technical resistance for first multi-runtime proof. |
| Codex CLI (OpenAI) | Stage 2, second | Name recognition for Show HN impact. Higher API churn risk. |
| Gemini CLI (Google) | Stage 2, later | |
| Copilot CLI (GitHub/Microsoft) | Stage 2, later | |

### Adapter sequencing rationale

1. **OpenCode first**: First adapter's job is proving YOKE works, not marketing. OpenCode has the richest SDK surface (JS/TS, Python, OpenAPI 3.1) and lowest integration risk. Open-source aligns with Clay's MIT license. Success here de-risks everything after.
2. **Codex second**: OpenAI name value makes "3 runtimes supported" the Show HN headline. But API stability risk is higher, and solo maintainer burden matters.
3. **Others as needed**: Gemini, Copilot follow if community demand exists.

"3 runtimes" is stronger than "2 runtimes." OpenCode first makes that number reachable.

### When to think about other runtimes

| Phase | Multi-runtime awareness | Reason |
|-------|------------------------|--------|
| Phase 1 (Audit) | No | Just scanning current code |
| Phase 2 (Classify) | Yes | The only moment to draw the boundary. Ask "would Codex/Gemini need this?" |
| Phase 3 (Implement) | No | Claude adapter only |
| Phase 4 (Protocol Doc) | No | Documenting existing protocol |
| Phase 5 (Second adapter) | Yes | Actually building it |

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
| Stage 1 (interface + Claude adapter) | 90% | sdk-bridge decomposition done (PR-29~32). getSDK() injection point alive. This is moving working code behind a wrapper, not building new functionality. Scope is controlled by "zero behavior change" constraint. |
| Stage 2 (Codex adapter + extraction) | 60% | Second adapter is the real test. Any Claude-specific assumption baked into the interface during Stage 1 will surface here as friction. Success depends entirely on how clean Phase 2 classification was. |

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

**High-risk items for Phase 5 validation**:
- `systemPrompt` for main sessions (Claude auto-reads CLAUDE.md, other runtimes may not)
- `onElicitation` (optional, kept in interface because same pattern as `canUseTool`)
- Event normalization (mitigated by `runtime_specific` passthrough)

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

**Status**: In progress. Step 3a (scaffold + rewire) complete. Steps 3b/3c/3d remaining. See [PHASE3_IMPLEMENTATION.md](./PHASE3_IMPLEMENTATION.md).

### Phase 3 sub-steps

| Step | Description | Status |
|------|-------------|--------|
| 3a | Scaffold `lib/yoke/`, create adapter shell, rewire all `getSDK` call sites | Complete |
| 3b | Move worker management code (~530 lines) from sdk-bridge.js into adapter. `createQuery()` owns both in-process and worker paths. Clay does not know which path runs. | Not started |
| 3c | Make QueryHandle the real abstraction. Remove `_rawQuery`/`_messageQueue`/`_pushRaw`. `processQueryStream` iterates QueryHandle, not raw SDK query. Worker and in-process yield the same event shape. | Not started |
| 3d | Event normalization. Adapter translates raw SDK events to Phase 2's 20 normalized event types. `processSDKMessage` rewritten to consume normalized events. Gradual approach: `{ yokeType, raw }` envelope first, then migrate field by field. | Not started |

---

## Phase 4: Protocol Documentation

**Goal**: Document the message protocol between sdk-bridge modules and sdk-worker.js.

This Unix domain socket + JSON-line protocol is the candidate foundation for YOKE's
cross-runtime message spec. Enumerate all message types, payloads, and response formats.

**Status**: Not started

---

## Phase 5: OpenCode Adapter (second runtime proof)

**Goal**: Build the OpenCode adapter to prove YOKE's multi-runtime abstraction works.

```
lib/yoke/
  adapters/
    claude.js           # existing
    opencode.js         # new
```

This is the real test of the interface designed in Phase 2. If the interface needs breaking changes to accommodate OpenCode, the Phase 2 classification was wrong.

**Status**: Deferred

---

## Phase 6: Codex Adapter + Open-source Extraction

**Goal**: Add Codex adapter. Extract YOKE as a standalone open-source package. "3 runtimes" becomes the headline.

```
lib/yoke/                   -->  yoke (standalone repo)
  package.json
  README.md
  index.js
  interface.js
  adapters/
    claude.js
    opencode.js
    codex.js              # new
```

At this point, copy lib/yoke/ to its own repo and publish. Clay replaces the directory with an npm dependency.

**Status**: Deferred

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
| 2026-04-11 | Chad | Review: 3a is only 70%. Worker code in sdk-bridge (#2), _rawQuery hack (#3), no event normalization (#1) are all real problems. Core issue: QueryHandle is not a real abstraction. OK with deprecated sdk-worker.js (#4) and Zod inputSchema (#5). | Steps 3b, 3c, 3d defined. Order: worker move -> QueryHandle real abstraction -> event normalization (gradual). |

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

### Step 3b checks (pending)

- [ ] No worker-related code in sdk-bridge.js (spawnWorker, startQueryViaWorker, warmupViaWorker, cleanupWorker, killSessionWorker all moved)
- [ ] `adapter.createQuery()` handles linuxUser internally
- [ ] `adapter.init()` handles linuxUser warmup internally
- [ ] Worker IPC permission/elicitation routed through createQuery callbacks

### Step 3c checks (pending)

- [ ] No `_rawQuery`, `_messageQueue`, `_pushRaw` on QueryHandle
- [ ] `processQueryStream` iterates QueryHandle (not raw SDK query)
- [ ] `session.queryInstance` IS the QueryHandle
- [ ] Worker and in-process paths produce same event shape through iterator

### Step 3d checks (pending)

- [ ] Adapter yields `{ yokeType, raw }` envelope for every event
- [ ] processSDKMessage routes on `yokeType` (not raw SDK event type)
- [ ] All 20 Phase 2 normalized event types mapped
- [ ] `raw` field removed after all event types migrated

### Manual tests (pending, after all steps)

- [ ] Mate session create, message exchange, skill execution
- [ ] @mention flow (createMentionSession via adapter)
- [ ] Session rewind (getOrCreateRewindQuery via adapter)
- [ ] Worker mode (OS multi-user)
- [ ] MCP tools (browser automation, debate proposal)
- [ ] Session resume, rename, fork via adapter
- [ ] Rate limit auto-continue
- [ ] Warmup (model list, skill discovery)
