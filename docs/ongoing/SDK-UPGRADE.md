# Claude Agent SDK Upgrade Tracker

Installed: `@anthropic-ai/claude-agent-sdk@0.2.92` (Claude Code 2.1.92)
Latest: `@anthropic-ai/claude-agent-sdk@0.2.112` (Claude Code 2.1.112, 2026-04-17)
Updated: 2026-04-17

Covers all unapplied changes from 0.2.80 through 0.2.112 (two rounds merged).
Codex multi-provider expansion planned. Items marked with Codex support are worth building as platform-common features.


---


## Master Item Table

43 items total. Action: **Do** = implement, **Skip** = not needed. Codex: **x** = reusable for Codex (build as platform-common).

### P1 - High (functional gaps, user-facing impact)

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 1 | ~~npm upgrade to 0.2.112~~ | ~~Done~~ | | ~~0.2.112 installed. All 4 breaking changes verified safe~~ | -- |
| 2 | ~~`'xhigh'` effort level~~ | ~~Done~~ | x | ~~Added to EFFORT_LEVELS, display name "X-High"~~ | `app-panels.js` |
| 3 | ~~`SDKTaskUpdatedMessage`~~ | ~~Done~~ | x | ~~task_updated handler + client updateSubagentTaskStatus~~ | `sdk-message-processor.js`, `tools.js`, `app-messages.js` |
| 4 | ~~`SDKNotificationMessage`~~ | ~~Done~~ | | ~~Forwarded as sdk_notification, displayed as system message~~ | `sdk-message-processor.js`, `app-messages.js` |
| 5 | `SDKMemoryRecallMessage` | Skip | | Claude-only memory system, low user interest | -- |

### P2 - Medium (reliability, UX improvement)

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 6 | `startup()` + `WarmQuery` | **Do** | | Codex is API-based (no cold start). Claude-only but high ROI | `sdk-bridge.js` |
| 7 | `TerminalReason` | **Do** | x | Partial (error message only) | `sdk-bridge.js`, `sdk-message-processor.js`, client |
| 8 | `reloadPlugins()` | **Do** | x | Not implemented (session restart required) | `sdk-bridge.js` |
| 9 | `listSubagents()`/`getSubagentMessages()` | **Do** | | Not implemented | `project.js` WS handlers |
| 10 | `SDKMessageOrigin` | **Do** | x | Not implemented. Relay already knows source | `sdk-bridge.js` message construction |
| 11 | `systemPrompt` array + cache boundary | **Do** | | Single string only. Direct cost/speed impact | `sdk-bridge.js` query options |
| 12 | `McpServerToolPolicy` | **Do** | x | Not implemented (server-level only) | `project-mcp.js` UI |
| 13 | `SDKControlRenameSessionRequest` | Skip | | Relay has its own rename | -- |
| 14 | `SDKControlRequestUserDialogRequest` | **Do** | | Not implemented. OAuth flows break without it | `sdk-bridge.js`, client dialog |
| 15 | `SDKPluginInstallMessage` | **Do** | x | Not implemented (silent load) | `sdk-message-processor.js`, client |
| 16 | Thinking display (`summarized`/`omitted`) | **Do** | x | Always full display, no control | `project-sessions.js`, client toggle |
| 17 | `ttft_ms` | **Do** | x | Not implemented. Client-side timing as fallback | Client timestamp measurement |
| 18 | Compact result/error + metadata | **Do** | x | compacting status only, no result/error | `sdk-message-processor.js`, client context bar |
| 19 | `Options` spawn (cwd/settingSources) | Skip | | SDK internal | -- |
| 20 | `PermissionMode: 'auto'` | Skip | | Claude-specific permission system | -- |
| 21 | `seedReadState()` | Skip | | SDK internal, no file state to seed | -- |
| 22 | Agent `effort`/`permissionMode` | Skip | | AgentDefinition-specific, redesign for multi-provider | -- |
| 23 | Agent `background`/`memory` | Skip | | AgentDefinition-specific | -- |
| 24 | `AgentDefinition.initialPrompt` | Skip | | Relay constructs its own | -- |
| 25 | `PermissionDecisionClassification` | Skip | | SDK internal, relay handles own permission UX | -- |
| 26 | Hook events (TaskCreated/CwdChanged/FileChanged) | Skip | | Hooks not adopted | -- |
| 27 | `PermissionDenied` hook | Skip | | Hooks not adopted | -- |

### P3 - Low (nice-to-have, polish)

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 28 | Settings UI (advisorModel, autoDreamEnabled, showClearContextOnPlanAccept, autoCompactWindow, disableSkillShellExecution) | **Do** | | Not implemented | `project-sessions.js`, client settings panel |
| 29 | Skill settings (3 fields) | Skip | | Claude-specific skill system | -- |
| 30 | Task `toolStats` | **Do** | x | Not implemented. Track at relay level | `sdk-message-processor.js`, client task UI |
| 31 | `api_error_status` | Skip | | Developer debug, minimal user value | -- |
| 32 | `skip_transcript` | **Do** | | Not implemented. Simple flag forwarding | `sdk-message-processor.js` |
| 33 | Elicitation display fields (title, display_name, description) | **Do** | | Not implemented | Client permission dialog |
| 34 | `SDKStatus: 'requesting'` | Skip | | Zero user impact | -- |
| 35 | `bypassPermissions` mode | Skip | | Already used internally | -- |
| 36 | `workflow_name` on task started | Skip | | Just a label | -- |
| 37 | Hook `if`/`shell` config | Skip | | Hooks not adopted | -- |
| 38 | `head_limit` default change | Skip | | Verified no impact | -- |
| 39 | `includeHookEvents` | Skip | | Hooks not adopted | -- |

### Defer (alpha/beta, revisit when stable)

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 40 | Assistant Worker module | Defer | | alpha, new module | -- |
| 41 | `connectRemoteControl*` types | Defer | | alpha | -- |
| 42 | Bridge enhancements | Defer | | alpha | -- |
| 43 | `taskBudget` query option | Defer | | alpha, beta header required | -- |


---


## Action Summary

| | Count | Items |
|--|-------|-------|
| **Done** | 4 | ~~#1-4~~ |
| **Do** | 16 | #6-12, #14-18, #28, #30, #32-33 |
| of which **Codex-reusable** | 9 | #7, #8, #10, #12, #15-18, #30 |
| Skip | 19 | #5, #13, #19-27, #29, #31, #34-39 |
| Defer | 4 | #40-43 |


---


## Upgrade Steps

1. Verify `SDKSessionInfo.systemPrompt` handling works with `string[]` (was `string`)
2. Verify `EditFileOutput.originalFile` null handling
3. Verify no references to removed `proactive` settings block or `SDKControlSetProactiveRequest`
4. `npm install @anthropic-ai/claude-agent-sdk@0.2.112`
5. Add `'xhigh'` to effort selector UI
6. Handle new message types: `task_updated`, `notification`, `plugin_install`
7. Implement remaining items


---


## Detailed Specs (work items only)


### #1 npm upgrade to 0.2.112

`npm install @anthropic-ai/claude-agent-sdk@0.2.112`

Dependency bumps: `@anthropic-ai/sdk` ^0.80.0 -> ^0.81.0, `@modelcontextprotocol/sdk` ^1.27.1 -> ^1.29.0.

Breaking changes to verify:
- `SDKSessionInfo.systemPrompt` changed from `string` to `string[]`. Check all relay code accessing `systemPrompt`.
- `EditFileOutput.originalFile` changed from `string` to `string | null`. Check null handling.
- `proactive` settings block removed entirely. No relay code uses it (was deferred). Safe.
- `SDKControlSetProactiveRequest` removed from `SDKControlRequestInner`. No relay code uses it. Safe.
- `SubscribeMcpResource*` and `SubscribePolling*` tool types removed (0.2.85). Verified no references.
- `SDKStreamlinedTextMessage` / `SDKStreamlinedToolUseSummaryMessage` removed from `StdoutMessage` (0.2.90). Verified no references.
- `SDKSystemMessage.session_id` changed from required to optional (0.2.86). Already uses truthy checks.


### #2 `'xhigh'` effort level
New `EffortLevel` value between `'high'` and `'max'`. Added across `AgentDefinition.effort`, `ModelInfo.supportedEffortLevels`, `Options.effort`, and settings `effortLevel`.

**Codex:** Abstract effort levels as platform concept. Map Claude low/medium/high/xhigh/max and Codex equivalents to common enum.

**Where:** Client effort selector UI, `sdk-bridge.js` effort handling, `project-sessions.js` set_effort handler.


### #3 `SDKTaskUpdatedMessage`
Live task state patches: `{ task_id, patch: { status?, description?, end_time?, total_paused_ms?, error?, is_backgrounded? } }`.

Currently sub-agent task status only shows start/progress/done. This enables real-time updates (running, completed, failed, killed) and background task tracking.

**Codex:** Build unified task state model at relay level. Claude provides `task_updated`, Codex provides its own task events. Both feed the same client UI.

**Where:** `sdk-message-processor.js` - handle `subtype: 'task_updated'`. Update sub-agent tracking state and forward to client.


### #4 `SDKNotificationMessage`
`{ key, text, priority: 'low'|'medium'|'high'|'immediate', color?, timeout_ms? }`.

**Where:** `sdk-message-processor.js` - handle `subtype: 'notification'`. Forward to client. Render as toast (immediate/high) or notification center entry (medium/low).


### #6 `startup()` + `WarmQuery`

`startup({ options?, initializeTimeoutMs? })` returns a `WarmQuery` with `query(prompt)` and `close()`. Subprocess pre-warms with loaded plugins.

Eliminates cold-start latency on first query. Subprocess boots in background, ready when user sends first message.

**Where:** `sdk-bridge.js` - call `startup()` during session creation, use `WarmQuery.query()` for first query instead of `sdk.query()`.


### #7 `TerminalReason`
`SDKResultMessage` gained `terminal_reason?: TerminalReason`. Values: `'blocking_limit'`, `'rapid_refill_breaker'`, `'prompt_too_long'`, `'image_error'`, `'model_error'`, `'aborted_streaming'`, `'aborted_tools'`, `'stop_hook_prevented'`, `'hook_stopped'`, `'tool_deferred'`, `'max_turns'`, `'completed'`.

Currently partially implemented (appended to error messages only).

**Codex:** Common stop-reason enum. Claude: map terminal_reason values. Codex: map finish_reason (stop/length/tool_calls/content_filter). Display in status area: "Stopped: context too long", "Completed", "Max turns reached".

**Where:** `sdk-bridge.js` - forward `terminal_reason` in query_done. `sdk-message-processor.js` already has partial handling at line 334. Client: display in status area.


### #8 `reloadPlugins()`
Hot-reload MCP servers, skills, agents, and hooks without restarting the session. Returns `SDKControlReloadPluginsResponse` with updated lists and error count.

Currently adding/removing MCP servers requires session restart.

**Codex:** MCP is cross-provider. Build "reload MCP" command at relay level, calling Claude SDK's `reloadPlugins()` or Codex equivalent.

**Where:** `sdk-bridge.js` - expose via WebSocket command. Call `session.queryInstance.reloadPlugins()`.


### #9 `listSubagents()` / `getSubagentMessages()`

`listSubagents(sessionId, options?)` lists subagent IDs. `getSubagentMessages(sessionId, agentId, options?)` reads transcript.

Options: `ListSubagentsOptions: { dir?: string }`, `GetSubagentMessagesOptions: { dir?: string, limit?: number, offset?: number }`.

**Where:** `project.js` - expose via WebSocket handlers, similar to existing `getSessionMessages()` pattern.


### #10 `SDKMessageOrigin`
`SDKUserMessage` gained `origin?: SDKMessageOrigin` (`{ kind: 'human'|'channel'|'peer'|'task-notification'|'coordinator' }`) and `shouldQuery?: boolean`.

**Codex:** Relay already knows message source (user typed, scheduled, mention, loop). Tag at relay level regardless of provider. `shouldQuery: false` enables appending context without triggering response, useful for context injection.

**Where:** `sdk-bridge.js` - set `origin` when submitting messages. Apply to Codex adapter too.


### #11 `systemPrompt` array + cache boundary

`Options.systemPrompt` expanded to `string | string[]`. When array, elements joined with `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` for cross-session prompt caching. Also `excludeDynamicSections?: boolean`.

Better prompt cache hit rates across sessions sharing the same system prompt prefix. Direct cost/speed impact.

**Where:** `sdk-bridge.js` - split system prompt into static prefix (mate identity, project rules) and dynamic suffix (session-specific context). Pass as array.


### #12 `McpServerToolPolicy`
`McpHttpServerConfig` and `McpSseServerConfig` gained `tools?: McpServerToolPolicy[]`. Each: `{ name, permission_policy: 'always_allow'|'always_ask'|'always_deny' }`.

**Codex:** MCP is provider-neutral. Per-tool permissions config stored at relay level, applied to any provider's MCP connection.

**Where:** `project-mcp.js` - expose per-tool policy config in MCP server settings UI.


### #14 `SDKControlRequestUserDialogRequest`

New control request `{ subtype: 'request_user_dialog', dialog_kind, payload, tool_use_id? }`. SDK requests custom UI dialogs (OAuth popups, custom forms) beyond elicitation.

Without this, certain MCP server authentication flows break silently.

**Where:** `sdk-bridge.js` - forward to client, render appropriate dialog based on `dialog_kind`.


### #15 `SDKPluginInstallMessage`
`{ status: 'started'|'installed'|'failed'|'completed', name?, error? }`.

**Codex:** "Loading plugin..." progress is universal. Build common plugin status UI, fed by Claude SDK events or Codex MCP connection status.

**Where:** `sdk-message-processor.js` - handle `subtype: 'plugin_install'`. Show as progress indicator or system message.


### #16 Thinking display control
`ThinkingAdaptive` and `ThinkingEnabled` gained `display?: 'summarized'|'omitted'`.

Currently thinking is always shown in full. Users want control.

**Codex:** Codex reasoning also benefits from display modes. Build toggle at relay level: full/summarized/hidden. Apply to both providers.

**Where:** `project-sessions.js` thinking config, client thinking display toggle.


### #17 `ttft_ms`
Time-to-first-token in milliseconds on `SDKPartialAssistantMessage`.

**Codex:** Can measure client-side for any provider: timestamp(first_token) - timestamp(request_sent). SDK value is more accurate but client measurement works as fallback.

**Where:** Client-side timing. Optionally use SDK value when available. Display in status bar or info popover.


### #18 Compact result/error + metadata
`SDKStatusMessage` gained `compact_result?: 'success'|'failed'`, `compact_error?: string`. Compact events gained `post_tokens?: number`, `duration_ms?: number`.

Currently only shows "compacting..." status with no result.

**Codex:** Context compression is a common need for long conversations. Show: "Compacted: 120k -> 45k tokens (1.2s)" or "Compact failed: [error]".

**Where:** `sdk-message-processor.js` - forward fields. Client context bar - display result.


### #28 Settings UI (5 fields)

Fields to add:
- `advisorModel` (string) - model for the advisor tool. Add to model settings section.
- `autoDreamEnabled` (boolean) - background memory consolidation. On/off toggle.
- `showClearContextOnPlanAccept` (boolean) - clear context on plan accept. Toggle.
- `autoCompactWindow` (number) - auto-compact window size. Numeric input.
- `disableSkillShellExecution` (boolean) - disable skill shell execution. Toggle.

Fields to skip: `defaultShell`, `channelsEnabled`/`allowedChannelPlugins`, `strictPluginOnlyCustomization`, `forceRemoteSettingsRefresh`.

**Where:** `project-sessions.js` for WS handlers, client settings panel for UI.


### #30 Task `toolStats`
`{ readCount, searchCount, bashCount, editFileCount, linesAdded, linesRemoved, otherToolCount }` on task completion.

**Codex:** Track tool invocation counts at relay level (already routes all tool calls). "3 files edited, 5 commands run, +120/-45 lines" summary works for any provider.

**Where:** `sdk-message-processor.js` for Claude data, relay-level counting as polyfill. Client task completion UI.


### #32 `skip_transcript`
`SDKTaskStartedMessage` and `SDKTaskProgressMessage` gained `skip_transcript?: boolean` for ambient/housekeeping tasks.

**Where:** `sdk-message-processor.js` - forward flag. Client filters these from sub-agent task list.


### #33 Elicitation display fields

Permission/elicitation gained `title?`, `display_name?`/`displayName?`, `description?`.

Better permission dialog UX with human-readable labels instead of raw tool names.

**Where:** Client permission dialog rendering. Extract and display these fields.


---
---


# Archive: 0.2.38 -> 0.2.76 (completed 2026-03-17)

## Priority 1 - High (Functional gaps, user-facing impact) -- DONE

### ~~1.1 `onElicitation` callback (since 0.2.39+)~~
- ~~**Status:** Implemented~~
- ~~**What:** MCP servers can request user input (OAuth login, form fields) via elicitation. Without this callback, all elicitation requests are auto-declined.~~
- ~~**Where:** `sdk-bridge.js` - add `onElicitation` to queryOptions in `startQuery()`.~~

### ~~1.2 `setEffort()` mid-query method (since 0.2.45+)~~
- ~~**Status:** Implemented~~
- ~~**What:** Change effort level on an active query without restarting it.~~

### ~~1.3 npm upgrade to 0.2.76~~
- ~~**Status:** Done~~


## Priority 2 - Medium -- DONE

### ~~2.1 `listSessions()` (since 0.2.51+)~~
- ~~**Status:** Implemented~~

### ~~2.2 `getSessionMessages()` (since 0.2.51+) -- SKIP~~
- ~~Relay already loads history via `readCliSessionHistory()`.~~

### ~~2.3 `getSessionInfo()` (since 0.2.74+)~~
- ~~**Status:** Implemented~~

### ~~2.4 `agentProgressSummaries` (since 0.2.72+)~~
- ~~**Status:** Implemented~~

### ~~2.5 `forkSession()` (since 0.2.76+)~~
- ~~**Status:** Implemented~~


## Priority 3 - Low -- DONE

### ~~3.1 `renameSession()` (since 0.2.74+)~~
- ~~**Status:** Implemented~~

### ~~3.2 `tagSession()` (since 0.2.76+) -- SKIP~~
- ~~SDK only supports 1 tag. Relay will implement own multi-tag system.~~

### ~~3.3 `supportedAgents()` (since 0.2.51+) -- SKIP~~
- ~~Informational only, no actionable value.~~

### ~~3.4 `ThinkingConfig` types (since 0.2.51+)~~
- ~~**Status:** Implemented~~

### ~~3.5 `ToolConfig` (since 0.2.76+) -- SKIP~~
- ~~HTML mode adds XSS risk.~~

### ~~3.6-3.8 Hook events, AgentDefinition.model, Settings export -- N/A~~


## Already Implemented (0.2.38 -> 0.2.63 range)

- [x] `promptSuggestions` query option + `SDKPromptSuggestionMessage` handling
- [x] `SDKRateLimitEvent` / `rate_limit_event` with UI display
- [x] `SDKTaskStartedMessage` / `SDKTaskProgressMessage` with sub-agent tracking
- [x] `FastModeState` with UI indicator (zap icon)
- [x] `stopTask()` method with fallback abort
- [x] `supportedModels()` in warmup
- [x] `forkSession` option on QueryOptions (boolean flag)
- [x] `betas` query option support
- [x] `effort` query option at creation time
- [x] `getContextUsage()` query method with context usage popover
