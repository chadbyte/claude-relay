# Phase 1: SDK Call Audit Results

> Comprehensive map of every SDK touch point in the Clay codebase.
> Generated 2026-04-11. Baseline for Phase 2 classification.

---

## 1. SDK Import/Require Sites

Every location where the Claude Agent SDK is imported or loaded.

| # | File | Line | Code | Context |
|---|------|------|------|---------|
| I-1 | `lib/project.js` | 84 | `if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");` | Lazy ESM loader. `getSDK()` factory, called by sdk-bridge and session modules. |
| I-2 | `lib/sdk-worker.js` | 80 | `if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");` | Separate `getSDK()` in worker process (OS-level user isolation). |
| I-3 | `lib/browser-mcp-server.js` | 37 | `try { sdk = require("@anthropic-ai/claude-agent-sdk"); } catch (e) {}` | **WARNING: `require()` direct call, not `getSDK()` factory.** Synchronous require inside `create()`. Extracts `createSdkMcpServer` and `tool`. |
| I-4 | `lib/debate-mcp-server.js` | 36 | `try { sdk = require("@anthropic-ai/claude-agent-sdk"); } catch (e) {}` | **WARNING: `require()` direct call, not `getSDK()` factory.** Same pattern as browser-mcp-server. |
| I-5 | `package.json` | 40 | `"@anthropic-ai/claude-agent-sdk": "^0.2.92"` | Top-level dependency declaration. |

> **Phase 3 action item**: I-3, I-4 are the only SDK import sites that bypass the `getSDK()` factory pattern. Phase 3 must decide how to unify these. Options: (a) inject SDK via opts like sdk-bridge does, (b) accept MCP server creation as an adapter-only concern and move these files into `lib/yoke/adapters/`.

---

## 2. SDK Method Calls

### 2.1 `sdk.query()` -- Create a new query stream

The primary SDK entry point. Creates an async iterable stream of SDK events.

| # | File | Line | Signature | Context |
|---|------|------|-----------|---------|
| Q-1 | `lib/sdk-bridge.js` | 1346 | `sdk.query({ prompt: mq, options: { cwd, settingSources, enableFileCheckpointing, resume } })` | `getOrCreateRewindQuery()`. Temp query for session rewind operations. |
| Q-2 | `lib/sdk-bridge.js` | 1474 | `sdk.query({ prompt: messageQueue, options: queryOptions })` | `startQuery()`. Primary query creation for user messages (in-process mode). Full queryOptions with model, effort, permissions, MCP, etc. |
| Q-3 | `lib/sdk-bridge.js` | 1593 | `sdk.query({ prompt: mq, options: warmupOptions })` | `warmup()`. SDK init probe to fetch slash_commands, model, available models. Aborted after `system/init` event. |
| Q-4 | `lib/sdk-bridge.js` | 1761 | `sdk.query({ prompt: mq, options: mentionQueryOptions })` | `createMentionSession()`. Read-only mention query for @mention flows. Uses `systemPrompt` (mate CLAUDE.md) and restricted `canUseTool`. |
| Q-5 | `lib/sdk-worker.js` | 300 | `sdk.query({ prompt: messageQueue, options: options })` | Worker-process query for OS-isolated sessions. Options assembled from daemon IPC message + local callbacks. |
| Q-6 | `lib/sdk-worker.js` | 453 | `sdk.query({ prompt: mq, options: warmupOptions })` | Worker-process warmup. Same pattern as Q-3. |

### 2.2 `stream.supportedModels()` -- Fetch available models

| # | File | Line | Context |
|---|------|------|---------|
| M-1 | `lib/sdk-bridge.js` | 1620 | `var models = await stream.supportedModels();` | During warmup, after `system/init` event. |
| M-2 | `lib/sdk-worker.js` | 469 | `var models = await stream.supportedModels();` | Worker-process warmup. |

### 2.3 `queryInstance.setPermissionMode()` -- Change permission mode on active query

| # | File | Line | Context |
|---|------|------|---------|
| P-1 | `lib/sdk-bridge.js` | 1685 | `await session.queryInstance.setPermissionMode(mode);` | `setPermissionMode()`. Called when user changes mode mid-session. |

### 2.4 `queryInstance.stopTask()` -- Stop a sub-agent task

| # | File | Line | Context |
|---|------|------|---------|
| T-1 | `lib/sdk-bridge.js` | 1703 | `await session.queryInstance.stopTask(taskId);` | `stopTask()`. Followed by abort fallback because SDK `stopTask` is unreliable. |

### 2.5 `sdk.createSdkMcpServer()` -- Create MCP tool server

| # | File | Line | Context |
|---|------|------|---------|
| C-1 | `lib/browser-mcp-server.js` | 489 | `return createSdkMcpServer({ name: "clay-browser", version: "1.0.0", tools: [...] })` | Browser automation MCP server (screenshot, click, navigate, etc.). |
| C-2 | `lib/debate-mcp-server.js` | 87 | `return createSdkMcpServer({ name: "clay-debate", version: "1.0.0", tools: [...] })` | Debate engine MCP server (hand raise, floor request). |

### 2.6 `sdk.tool()` -- Define MCP tool schema

| # | File | Line | Context |
|---|------|------|---------|
| D-1 | `lib/browser-mcp-server.js` | 43 | `var tool = sdk.tool;` | Used throughout to define each browser tool (screenshot, click, navigate, type, etc.). |
| D-2 | `lib/debate-mcp-server.js` | 42 | `var tool = sdk.tool;` | Used to define debate tools. |

---

## 3. SDK Bridge Exported API

`createSDKBridge()` returns these methods. They form the current de facto interface between Clay and the SDK.

| Method | Lines | Purpose | SDK Methods Used |
|--------|-------|---------|-----------------|
| `startQuery(session, text, images, linuxUser)` | 1368-1504 | Start new query (in-process or via worker) | `sdk.query()` |
| `pushMessage(session, text, images)` | 1506-1530 | Push follow-up message to active query | `messageQueue.push()` |
| `warmup(linuxUser)` | 1576-1635 | SDK init probe | `sdk.query()`, `stream.supportedModels()` |
| `setModel(session, model)` | 1637-1651 | Change model | Stored for next query |
| `setEffort(session, effort)` | 1653-1671 | Change effort level | Stored for next query |
| `setPermissionMode(session, mode)` | 1673-1691 | Change permission mode | `queryInstance.setPermissionMode()` |
| `stopTask(taskId)` | 1693-1712 | Stop sub-agent task | `queryInstance.stopTask()` |
| `createMentionSession(opts)` | 1717-1918 | Create @mention read-only session | `sdk.query()` with `systemPrompt` |
| `processQueryStream(session)` | (internal) | Iterate SDK event stream, dispatch to message processor | `for await (msg of query)` |
| `getOrCreateRewindQuery(session)` | 1334-1366 | Temp query for rewind | `sdk.query()` |
| `checkToolWhitelist(toolName, input)` | 942-959 | Auto-approve read-only tools | None (pure logic) |
| `handleCanUseTool(session, toolName, input, toolOpts)` | (internal) | Permission request handler | None (IPC to client) |
| `handleElicitation(session, request, elicitOpts)` | (internal) | Elicitation request handler | None (IPC to client) |
| `isClaudeProcess(pid)` | (internal) | Check if PID is a Claude child process | None (process check) |
| `startIdleReaper()` / `stopIdleReaper()` | (internal) | Reap idle sessions | `abortController.abort()` |

---

## 4. SDK Query Options (full parameter surface)

Parameters passed to `sdk.query()` across all call sites.

| Parameter | Used In | Claude-Specific? | Notes |
|-----------|---------|-------------------|-------|
| `cwd` | Q-1~6 | No | Working directory |
| `settingSources` | Q-1~6 | Yes | `["user", "project", "local"]` or `["user"]` for mentions |
| `includePartialMessages` | Q-2, Q-4 | Yes | Enable streaming partial messages |
| `enableFileCheckpointing` | Q-1, Q-2 | Yes | SDK file checkpoint feature |
| `extraArgs` | Q-2 | Yes | `{ "replay-user-messages": null }` |
| `promptSuggestions` | Q-2 | Yes | Enable suggestion chips |
| `agentProgressSummaries` | Q-2 | Yes | Enable progress summaries |
| `abortController` | Q-2~6 | No | Standard AbortController |
| `mcpServers` | Q-2, Q-4 | Partial | MCP is a standard, but registration format is SDK-specific |
| `model` | Q-2, Q-4 | No | Model name string |
| `effort` | Q-2 | Partial | May not exist in other runtimes |
| `betas` | Q-2 | Yes | Anthropic beta flags |
| `thinking` | Q-2 | Yes | `{ type: "disabled" }` or `{ type: "enabled", budgetTokens }` |
| `permissionMode` | Q-2, Q-3, Q-5 | Yes | `"acceptEdits"`, `"bypassPermissions"`, etc. |
| `allowDangerouslySkipPermissions` | Q-2, Q-3, Q-5 | Yes | Permission bypass flag |
| `resume` | Q-1, Q-2, Q-5 | Yes | Resume by CLI session ID |
| `resumeSessionAt` | Q-2 | Yes | Resume at specific message UUID |
| `systemPrompt` | Q-4 | No | System prompt string (mention sessions) |
| `canUseTool` | Q-2, Q-4, Q-5 | Yes | Callback: `(toolName, input, opts) => Promise<{behavior, message?}>` |
| `onElicitation` | Q-2, Q-5 | Yes | Callback: `(request, opts) => Promise<response>` |
| `spawnClaudeCodeProcess` | Q-5 | Yes | Worker-only. Override CLI subprocess spawn. |
| `debug` / `debugFile` | Q-5 | Yes | Worker-only debug logging. |

---

## 5. SDK Event Stream (consumed message types)

Events received from `for await (msg of query)` and processed in `sdk-message-processor.js` and `sdk-worker.js`.

| Event Type | Subtype | Handling Location | Purpose |
|------------|---------|-------------------|---------|
| `system` | `init` | sdk-bridge (warmup), sdk-worker (warmup) | SDK initialization: slash_commands, model, skills, fast_mode_state |
| `stream_event` | (Anthropic streaming API events) | sdk-message-processor.js | Raw API stream events (content_block_start, content_block_delta, content_block_stop, message_start, message_delta, message_stop) |
| `result` | -- | sdk-bridge, sdk-worker | Query completion with session ID, cost, duration |
| `permission_request` | -- | sdk-worker | Tool permission request (worker mode) |
| `elicitation` | -- | sdk-worker | Elicitation request (worker mode) |

---

## 6. CLI Spawn / Process Management

| # | File | Line | Description |
|---|------|------|-------------|
| S-1 | `lib/sdk-worker.js` | 244-271 | `spawnClaudeCodeProcess` callback. Intercepts SDK's CLI subprocess spawn to inject IPv4-first DNS options. Not a direct `claude` binary spawn by Clay. The SDK decides when and how to spawn the CLI. |
| S-2 | `lib/sdk-bridge.js` | 1145 | `isClaudeProcess(pid)`. Pattern match against known Claude binary paths to identify Claude child processes. |

---

## 7. Claude-Specific Data Injection

### 7.1 CLAUDE.md (system prompt assembly)

Each site is sub-classified for Phase 2:
- **ASSEMBLY**: Content composition (what prompt text to build). Clay concern.
- **I/O**: File read/write/watch. Clay concern.
- **INJECTION**: Passing assembled prompt into SDK session. Interface concern.

| # | File | Line | Operation | Sub-class | Context |
|---|------|------|-----------|-----------|---------|
| MD-1 | `lib/mates.js` | 164-180 | Write | I/O + ASSEMBLY | Initial CLAUDE.md for new mate (template + system sections) |
| MD-2 | `lib/mates.js` | 516-524 | Write | I/O + ASSEMBLY | CLAUDE.md for builtin mate reset/re-add |
| MD-3 | `lib/mates.js` | 331-345 | Read+Write | I/O + ASSEMBLY | `atomicEnforceSections()`: read CLAUDE.md, enforce system sections, write back |
| MD-4 | `lib/mates.js` | 624-637 | Read+Write | I/O + ASSEMBLY | Sync identity when builtin template version changes |
| MD-5 | `lib/mates-identity.js` | 55+ | Read | ASSEMBLY | `extractIdentity()`: parse identity from CLAUDE.md content |
| MD-6 | `lib/mates-prompts.js` | 23, 117 | Reference | ASSEMBLY | Team roster references mate CLAUDE.md paths |
| MD-7 | `lib/builtin-mates.js` | 130-497 | Template | ASSEMBLY | CLAUDE.md templates for all 6 builtin mates (ALLY, ARCH, RUSH, WARD, PIXEL, BUZZ) |
| MD-8 | `lib/crisis-safety.js` | 18-26 | Read+Write | I/O + ASSEMBLY | Enforce crisis safety section at end of CLAUDE.md |
| MD-9 | `lib/project.js` | 1106-1108 | Watch | I/O | fs.watch on mate CLAUDE.md for system section enforcement |
| MD-10 | `lib/project-mate-interaction.js` | 545-563 | Read | **INJECTION** | Load mate CLAUDE.md for mention sessions, passed as `claudeMd` to `createMentionSession()`. **This is the boundary**: file content crosses into SDK via `systemPrompt` option. |
| MD-11 | `lib/project-mate-interaction.js` | 635 | Read | ASSEMBLY | Load mate CLAUDE.md for DM digest context (used in prompt composition, not SDK injection) |
| MD-12 | `lib/project-debate.js` | 17-20 | Read+Write | I/O + ASSEMBLY | Enforce debate awareness prompt in mate CLAUDE.md |
| MD-13 | `lib/project-filesystem.js` | 221-233 | Read+Write | I/O | Global `~/.claude/CLAUDE.md` read/write via WebSocket messages |
| MD-14 | `lib/server-mates.js` | 32 | Path | I/O | Construct `CLAUDE.md` path for mate directory |
| MD-15 | `lib/notes.js` | 114 | Inject | ASSEMBLY | Sticky notes injected into mate CLAUDE.md content for mate to read |

> **Phase 2 key insight**: 15개 사이트 중 **INJECTION은 MD-10 단 1곳**이다. 나머지 14개는 전부 ASSEMBLY 또는 I/O로 Clay 내부 관심사다. YOKE 인터페이스는 "조립된 prompt string을 받아서 세션에 전달"하는 한 곳만 책임지면 된다.

### 7.2 .claude/ Directory Access

| # | File | Line | Path | Context |
|---|------|------|------|---------|
| DIR-1 | `lib/sdk-bridge.js` | 471-487 | `~/.claude/projects/{slug}/` | Ensure linux user's .claude project directory exists. Copy session files for OS-level isolation. |
| DIR-2 | `lib/sdk-skill-discovery.js` | 86-87 | `~/.claude/skills/`, `{cwd}/.claude/skills/` | Discover skill directories (global + project-local). |
| DIR-3 | `lib/project-http.js` | 413-522 | `{cwd}/.claude/skills/{skill}`, `~/.claude/skills/` | Skill file serving, skill listing for HTTP routes. |
| DIR-4 | `lib/project-loop.js` | 52-1094 | `{cwd}/.claude/loops/`, `{cwd}/.claude/PROMPT.md`, `{cwd}/.claude/JUDGE.md` | Ralph Loop: loop recording directory, PROMPT.md/JUDGE.md for loop config. |
| DIR-5 | `lib/project-filesystem.js` | 221-232 | `~/.claude/CLAUDE.md` | Global CLAUDE.md path. |
| DIR-6 | `lib/cli-sessions.js` | 111-180 | `~/.claude/projects/{encoded}/` | Read CLI session JSONL files for session import/display. |
| DIR-7 | `lib/project.js` | 161 | `.claude-local/settings.json` | Comment: avoid writing SDK settings to prevent duplicate spawns. |

### 7.3 mate.yaml Loading

| # | File | Line | Operation | Context |
|---|------|------|-----------|---------|
| Y-1 | `lib/mates.js` | 152-162 | Write | Create initial mate.yaml (name, role, status, etc.) |
| Y-2 | `lib/mates.js` | 502-514 | Write | Write mate.yaml during builtin mate setup |
| Y-3 | `lib/project-mate-interaction.js` | 133 | Read | Load mate.yaml for @mention metadata |
| Y-4 | `lib/project-memory.js` | 277-281 | Read | Load mate role/activities from mate.yaml for memory context |
| Y-5 | `lib/mates-prompts.js` | 24, 118 | Reference | Team roster references mate.yaml paths |

### 7.4 Skill Registration as MCP Tools

| # | File | Line | Description |
|---|------|------|-------------|
| SK-1 | `lib/sdk-skill-discovery.js` | 80-114 | `attachSkillDiscovery()`: scan `~/.claude/skills/` and `{cwd}/.claude/skills/` for skill directories. |
| SK-2 | `lib/sdk-skill-discovery.js` | 114 | `mergeSkills(sdkSkills, fsSkills)`: merge SDK-reported skills with filesystem-discovered skills. |
| SK-3 | `lib/sdk-bridge.js` | 76-79 | Wire skill discovery into bridge. `discoverSkillDirs()` and `mergeSkills()` used during warmup. |
| SK-4 | `lib/sdk-bridge.js` | 554, 1426 | `queryOptions.mcpServers = mcpServers`: pass MCP server configs to `sdk.query()`. |
| SK-5 | `lib/project.js` | 418-478 | Build `mcpServers` config object: create browser-mcp and debate-mcp servers, pass to sdk-bridge. |

### 7.5 Permission Handling

| # | File | Line | Description |
|---|------|------|-------------|
| PM-1 | `lib/sdk-bridge.js` | 564-571, 1453-1461 | `queryOptions.permissionMode` and `allowDangerouslySkipPermissions` in query options. |
| PM-2 | `lib/sdk-bridge.js` | 929-932 | Warmup: set `bypassPermissions` mode when `dangerouslySkipPermissions` is true. |
| PM-3 | `lib/sdk-bridge.js` | 942-959 | `checkToolWhitelist()`: auto-approve read-only tools (Read, Glob, Grep, WebFetch, WebSearch). |
| PM-4 | `lib/sdk-bridge.js` | 1054-1091 | `handleCanUseTool()`: tool whitelist check, mate-specific allowed tools, then forward to client for manual approval. |
| PM-5 | `lib/sdk-bridge.js` | 1673-1691 | `setPermissionMode()`: call `queryInstance.setPermissionMode(mode)` on active query. |
| PM-6 | `lib/project-sessions.js` | 426-430 | `set_permission_mode` message handler: store mode + call `sdk.setPermissionMode()`. |
| PM-7 | `lib/sdk-worker.js` | 272-293 | Worker `canUseTool` callback: special AskUserQuestion handling + whitelist check. |
| PM-8 | `lib/daemon.js` | 132 | `dangerouslySkipPermissions` config option passed from daemon to server to sdk-bridge. |

### 7.6 Environment Variables

| # | File | Line | Variable | Context |
|---|------|------|----------|---------|
| E-1 | `lib/daemon.js` | 38 | `CLAY_CONFIG`, `CLAUDE_RELAY_CONFIG` | Config file path (legacy name preserved). |
| E-2 | `lib/daemon.js` | 77 | `CLAY_HOME`, `CLAUDE_RELAY_HOME` | Certificate directory base (legacy name preserved). |
| E-3 | `lib/build-user-env.js` | 13+ | (various) | Build minimal env for user subprocesses. No direct Anthropic env vars, but controls what the SDK process inherits. |

---

## 8. Worker IPC Protocol (sdk-bridge <-> sdk-worker)

Communication between the daemon (sdk-bridge.js) and worker (sdk-worker.js) over Unix domain socket using JSON lines.

### 8.1 Daemon -> Worker Messages

| Message Type | Payload | Purpose |
|--------------|---------|---------|
| `query_start` | `{ prompt, options, singleTurn }` | Start a new SDK query |
| `push_message` | `{ prompt }` | Push follow-up user message |
| `warmup` | `{ options }` | SDK init probe |
| `abort` | `{}` | Abort current query |
| `permission_response` | `{ requestId, result }` | Respond to tool permission request |
| `elicitation_response` | `{ requestId, result }` | Respond to elicitation request |
| `set_permission_mode` | `{ mode }` | Change permission mode |
| `stop_task` | `{ taskId }` | Stop sub-agent task |
| `ask_user_response` | `{ toolUseId, result }` | Respond to AskUserQuestion |

### 8.2 Worker -> Daemon Messages

| Message Type | Payload | Purpose |
|--------------|---------|---------|
| `ready` | `{}` | Worker connected and ready |
| `sdk_event` | `{ event }` | Raw SDK stream event (forwarded from `for await`) |
| `query_done` | `{ sessionId, cost, duration, exitCode, inputTokens, outputTokens }` | Query completed |
| `query_error` | `{ error, exitCode, stderr }` | Query failed |
| `permission_request` | `{ requestId, toolName, input }` | Tool permission request |
| `elicitation` | `{ requestId, request }` | Elicitation request |
| `warmup_done` | `{ result: { slashCommands, model, skills, models, fastModeState } }` | Warmup completed |
| `warmup_error` | `{ error }` | Warmup failed |
| `ask_user_request` | `{ toolUseId, input }` | AskUserQuestion forwarded |

---

## 9. Files with NO Direct SDK Dependency

These files in the sdk-* family do NOT directly import the SDK, but participate in the SDK pipeline:

| File | Role | Why No Direct Import |
|------|------|---------------------|
| `lib/sdk-skill-discovery.js` | Scan filesystem for skill directories | Pure filesystem logic. Receives results from SDK via `mergeSkills()`. |
| `lib/sdk-message-queue.js` | Async iterable message queue | Generic data structure. Used by sdk-bridge and sdk-worker. |
| `lib/sdk-message-processor.js` | Process SDK stream events | Receives `getSDK` via context but primarily processes event objects. |

---

## 10. Summary Statistics

| Category | Count | Files Involved |
|----------|-------|----------------|
| SDK import sites | 5 | project.js, sdk-worker.js, browser-mcp-server.js, debate-mcp-server.js, package.json |
| `sdk.query()` calls | 6 | sdk-bridge.js (4), sdk-worker.js (2) |
| `stream.supportedModels()` | 2 | sdk-bridge.js, sdk-worker.js |
| `queryInstance.setPermissionMode()` | 1 | sdk-bridge.js |
| `queryInstance.stopTask()` | 1 | sdk-bridge.js |
| `createSdkMcpServer()` | 2 | browser-mcp-server.js, debate-mcp-server.js |
| `sdk.tool()` | 2 | browser-mcp-server.js, debate-mcp-server.js |
| CLAUDE.md operations | 15 | 10 files |
| .claude/ directory access | 7 | 6 files |
| mate.yaml operations | 5 | 4 files |
| Skill registration points | 5 | 3 files |
| Permission handling points | 8 | 4 files |
| Worker IPC message types | 18 | sdk-bridge.js, sdk-worker.js |
| SDK query option parameters | 22 | sdk-bridge.js, sdk-worker.js |

---

## 11. Dependency Graph

```
project.js
  |-- getSDK()                    [I-1] SDK loader
  |-- mcpServers config           [SK-5] Browser + Debate MCP
  |-- createSDKBridge(opts)
  |     |-- sdk-bridge.js
  |     |     |-- getSDK (via opts)
  |     |     |-- sdk.query()           [Q-1~4]
  |     |     |-- stream.supportedModels() [M-1]
  |     |     |-- queryInstance.setPermissionMode() [P-1]
  |     |     |-- queryInstance.stopTask() [T-1]
  |     |     |-- sdk-message-processor.js (process stream events)
  |     |     |-- sdk-message-queue.js (async iterable)
  |     |     |-- sdk-skill-discovery.js (filesystem skill scan)
  |     |     '-- Worker subprocess (OS isolation)
  |     |           '-- sdk-worker.js
  |     |                 |-- getSDK()          [I-2]
  |     |                 |-- sdk.query()        [Q-5, Q-6]
  |     |                 |-- stream.supportedModels() [M-2]
  |     |                 |-- spawnClaudeCodeProcess [S-1]
  |     |                 '-- sdk-message-queue.js
  |-- browser-mcp-server.js
  |     |-- require("@anthropic-ai/claude-agent-sdk") [I-3]
  |     |-- sdk.createSdkMcpServer()  [C-1]
  |     '-- sdk.tool()                [D-1]
  '-- debate-mcp-server.js
        |-- require("@anthropic-ai/claude-agent-sdk") [I-4]
        |-- sdk.createSdkMcpServer()  [C-2]
        '-- sdk.tool()                [D-2]
```

---

## Next Step

Phase 2: Add an `INTERFACE / CLAY` column to each table above. Apply the classification rule: "Would this change if we swapped to a different LLM runtime?" Use the design guardrail: "Would Codex/Gemini/Copilot need this method? If not, it is a Clay concern disguised as an interface concern."
