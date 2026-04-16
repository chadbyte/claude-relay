# Claude Agent SDK Upgrade Tracker

Installed: `@anthropic-ai/claude-agent-sdk@0.2.80` (Claude Code 2.1.80)
Latest: `@anthropic-ai/claude-agent-sdk@0.2.92` (Claude Code 2.1.92, 2026-04-07)
Updated: 2026-04-07

Covers all unapplied changes from 0.2.80 through 0.2.92.
Previous round (0.2.38 through 0.2.76) is archived at the bottom.


---

## New in 0.2.81-0.2.92

### Priority 1 - High (Functional gaps, user-facing impact)

#### 1.1 npm upgrade to 0.2.92
- **Status:** Not started
- **What:** `npm install @anthropic-ai/claude-agent-sdk@0.2.92`
- **Impact:** Required for all new APIs below. No peer dependency changes (still `zod ^4.0.0`). New runtime dependencies added: `@anthropic-ai/sdk` (^0.80.0), `@modelcontextprotocol/sdk` (^1.27.1).
- **Breaking (all verified safe, no code impact):**
  - `SubscribeMcpResource*` and `SubscribePolling*` tool types removed (0.2.85). No code references them.
  - Grep `head_limit` default changed from unlimited to 250 (0.2.83). No code uses `head_limit`.
  - `SDKStreamlinedTextMessage` and `SDKStreamlinedToolUseSummaryMessage` removed from `StdoutMessage` union (0.2.90). No code references them.
  - `SDKSystemMessage.session_id` changed from required to optional (0.2.86). Code already uses truthy checks.
  - `PreToolUseHookSpecificOutput.permissionDecision` type expanded with `'defer'` value (0.2.89). Hooks not used.

#### ~~1.2 `SDKSessionStateChangedMessage` (since 0.2.81+) -- SKIP~~
- ~~**Status:** Skipped~~
- ~~**What:** New message type: session state transitions (`idle`, `running`, `requires_action`).~~
- ~~**Why skipped:** Relay already tracks state more accurately via Socket.IO. Query start/end is directly controlled, `pendingPermissions`/`pendingElicitations` cover `requires_action`. SDK notification would lag behind relay's own tracking.~~


### Priority 2 - Medium (Improved reliability, better UX)

#### 2.1 `reloadPlugins()` query method (since 0.2.83+)
- **Status:** Not started
- **What:** Hot-reload MCP servers, skills, agents, and hooks without restarting the session. Returns `SDKControlReloadPluginsResponse` with updated lists and error count.
- **Impact:** Currently adding/removing MCP servers requires session restart. This enables live reconfiguration.
- **Where:** `sdk-bridge.js` - expose via WebSocket command. Call `session.queryInstance.reloadPlugins()`.

#### 2.2 `seedReadState()` query method (since 0.2.85+)
- **Status:** Not started
- **What:** Pre-seed file read cache with path and mtime. Tells the SDK that a file has already been read, avoiding redundant reads.
- **Impact:** Performance optimization for resumed sessions or when relay knows file state.
- **Where:** `sdk-bridge.js` - call during session resume if file state is cached.

#### 2.3 `listSubagents()` / `getSubagentMessages()` top-level functions (since 0.2.89+)
- **Status:** Not started
- **What:** `listSubagents(sessionId, options?)` lists subagent IDs for a session. `getSubagentMessages(sessionId, agentId, options?)` reads a subagent's conversation transcript.
- **Impact:** Enables viewing subagent conversation history in UI. Useful for debugging and transparency.
- **Where:** `project.js` - expose via WebSocket handlers, similar to existing `getSessionMessages()` pattern.
- **Options:** `ListSubagentsOptions: { dir?: string }`, `GetSubagentMessagesOptions: { dir?: string, limit?: number, offset?: number }`.

#### 2.4 `TerminalReason` on result messages (since 0.2.91+)
- **Status:** Not started
- **What:** `SDKResultMessage` gained `terminal_reason?: TerminalReason` field. Values: `'blocking_limit'`, `'rapid_refill_breaker'`, `'prompt_too_long'`, `'image_error'`, `'model_error'`, `'aborted_streaming'`, `'aborted_tools'`, `'stop_hook_prevented'`, `'hook_stopped'`, `'tool_deferred'`, `'max_turns'`, `'completed'`.
- **Impact:** UI can show why a query ended (e.g., "context too long", "max turns reached") instead of generic "done".
- **Where:** `sdk-bridge.js` - forward `terminal_reason` in query_done event. Client-side: display in status area.

#### 2.5 `PermissionMode: 'auto'` (since 0.2.91+)
- **Status:** Not started
- **What:** New `'auto'` value added to `PermissionMode`. Appears in `SDKControlSetPermissionModeRequest`, `SDKSessionStateChangedMessage`, and settings `defaultMode`.
- **Impact:** Enables autonomous permission handling mode. Evaluate if/how to expose in UI permission mode selector.

#### 2.6 Agent config: `effort` and `permissionMode` (since 0.2.92+)
- **Status:** Not started
- **What:** `AgentDefinition` gained `effort?: ('low' | 'medium' | 'high' | 'max') | number` and `permissionMode?: PermissionMode`.
- **Impact:** Per-agent effort and permission settings. Enables differentiated agent behavior (e.g., low-effort background agents).

#### 2.7 Agent config: `background` and `memory` (since 0.2.89+)
- **Status:** Not started
- **What:** `AgentDefinition` gained `background?: boolean` (fire-and-forget agent) and `memory?: 'user' | 'project' | 'local'` (auto-load memory scope).
- **Impact:** Background agents run without blocking the main thread. Memory scoping enables agent-specific context loading.

#### 2.8 New hook events: `TaskCreated`, `CwdChanged`, `FileChanged` (since 0.2.83+)
- **Status:** Not started (no code change needed unless hooks are adopted)
- **What:** Three new `HookEvent` values. `CwdChanged` fires on working directory change (provides `old_cwd`, `new_cwd`). `FileChanged` fires on file system changes (provides `file_path`, `event: 'change' | 'add' | 'unlink'`). `TaskCreated` fires when a task is created (provides `task_id`, `task_subject`, etc.).
- **Impact:** Enables reactive hooks (e.g., auto-lint on file save, notify on directory change). `FileChanged` and `CwdChanged` hooks can return `watchPaths` to control which paths are monitored.

#### 2.9 `PermissionDenied` hook event (since 0.2.89+)
- **Status:** Not started (no code change needed unless hooks are adopted)
- **What:** New hook event fired when a permission is denied. Input includes `tool_name`, `tool_input`, `tool_use_id`, `reason`. Hook output can set `retry?: boolean`.
- **Impact:** Enables automated recovery from permission denials (e.g., retry with different parameters).

#### 2.10 `AgentDefinition.initialPrompt` (since 0.2.83+)
- **Status:** Not started
- **What:** New optional field on `AgentDefinition`. Auto-submitted as the first user turn for main thread agents.
- **Impact:** Enables pre-configured agent workflows that start automatically without user input.

#### 2.11 `PermissionDecisionClassification` on `PermissionResult` (since 0.2.83+)
- **Status:** Not started
- **What:** New optional `decisionClassification` field on allow/deny permission results: `'user_temporary'`, `'user_permanent'`, `'user_reject'`.
- **Impact:** SDK can distinguish between one-time allows and permanent permission grants. Could improve permission UX.


### Priority 3 - Low (Nice-to-have, polish)

#### 3.1 `SDKTaskStartedMessage.workflow_name` (since 0.2.83+)
- **Status:** Not started
- **What:** New optional field on task started messages, set when `task_type` is `'local_workflow'`.
- **Impact:** Better labeling of workflow-originated sub-agents in UI.

#### 3.2 Hook config enhancements: `if`, `shell` fields (since 0.2.85+)
- **Status:** Not started (no code change needed unless hooks are adopted)
- **What:** Hooks can now have `if` (permission rule syntax filter) and `shell` (`'bash' | 'powershell'`) fields.
- **Impact:** More flexible hook configuration.

#### 3.3 New Settings fields for Settings UI (since 0.2.83-0.2.92)
- **Status:** Not started
- **What:** Expose new SDK settings in the existing project/server settings panels.
- **Fields to add:**
  - `advisorModel` (string) - model for the advisor tool. Add to model settings section alongside main model selector.
  - `autoDreamEnabled` (boolean) - background memory consolidation toggle. Add as on/off toggle in server settings.
  - `showClearContextOnPlanAccept` (boolean) - show "clear context" option when accepting plans. Add as toggle in project settings.
  - `autoCompactWindow` (number) - auto-compact window size (since 0.2.89+). Add as numeric input in server settings.
  - `disableSkillShellExecution` (boolean) - disables inline shell execution in skills (since 0.2.91+). Add as toggle in server settings.
- **Fields to skip:**
  - `defaultShell` - clay targets macOS/Linux, nearly always bash.
  - `channelsEnabled` / `allowedChannelPlugins` - Teams/Enterprise only.
  - `strictPluginOnlyCustomization` - Enterprise admin feature.
  - `forceRemoteSettingsRefresh` - managed/enterprise only (since 0.2.89+).
  - `proactive` - autonomous background operation, needs architectural evaluation (since 0.2.91+).
- **Where:** `project-settings.js`, `server-settings.js` for UI. `project.js` for WebSocket handlers. Need to read/write via SDK settings API or settings.json.

#### 3.4 `SdkMcpToolDefinition._meta` (since 0.2.83+)
- **Status:** Available (no code change needed)
- **What:** MCP tool definitions can now carry `_meta` metadata.

#### 3.5 `tool()` function `searchHint` (since 0.2.85+)
- **Status:** Available (no code change needed)
- **What:** Custom tools can provide `searchHint` for SDK tool search/discovery.

#### 3.6 Sandbox `failIfUnavailable` (since 0.2.85+)
- **Status:** Available (no code change needed)
- **What:** Sandbox config can set `failIfUnavailable: true` to exit with error if sandbox cannot start.

#### 3.7 Grep `head_limit` default change (since 0.2.83+)
- **Status:** Not started (behavioral change, no code needed)
- **What:** Grep tool `head_limit` now defaults to 250 instead of unlimited. Pass `head_limit: 0` explicitly for unlimited.
- **Impact:** May affect relay code that relies on grep returning unlimited results without specifying head_limit.

#### ~~3.8 `getContextUsage()` query method (since 0.2.86+) -- DONE~~
- ~~**Status:** Implemented~~
- ~~**What:** Returns `SDKControlGetContextUsageResponse` with detailed context window breakdown (tokens per category, model, memory files, MCP tools, agents, skills, auto-compact threshold, etc.).~~
- ~~**Impact:** Rich context usage popover on header context bar click. Shows stacked category bar, message breakdown, system prompt sections, memory files, and auto-compact threshold.~~
- ~~**Where:** `sdk-worker.js` calls `getContextUsage()` after query completes. `sdk-bridge.js` relays via `context_usage` message. `app.js` renders popover. `title-bar.css` styles popover.~~

#### 3.9 `tool()` function `alwaysLoad` (since 0.2.92+)
- **Status:** Available (no code change needed)
- **What:** Custom tools can set `alwaysLoad: true` to prevent being deferred.

#### 3.10 `'anthropicAws'` API provider (since 0.2.90+)
- **Status:** Available (no code change needed)
- **What:** New `apiProvider` value alongside `'firstParty'`, `'bedrock'`, `'vertex'`, `'foundry'`.

#### 3.11 `SDKDeferredToolUse` on `SDKResultMessage` (since 0.2.89+)
- **Status:** Available (no code change needed)
- **What:** `SDKResultMessage` gained `deferred_tool_use?: SDKDeferredToolUse` field with `id`, `name`, `input`.

#### 3.12 `includeHookEvents` query option (since 0.2.86+)
- **Status:** Not started
- **What:** When `true`, emits `hook_started`, `hook_progress`, and `hook_response` system messages for all hook event types.
- **Impact:** Visibility into hook execution. Only useful once hooks are adopted.

#### 3.13 `file_unchanged` tool output and `staleReadFileStateHint` (since 0.2.86+)
- **Status:** Available (no code change needed)
- **What:** New `file_unchanged` tool output type with `filePath`. `BashOutput` gained `staleReadFileStateHint` field listing read-file-state entries whose mtime changed during a command.


## Deferred (alpha/beta, revisit when stable)

#### `taskBudget` query option (since 0.2.83+, @alpha, beta header required)
- **What:** `QueryOptions.taskBudget: { total: number }` (output token unit). Sets API-side token budget per query. Claude paces tool use and wraps up before the limit. Requires `task-budgets-2026-03-13` beta header.
- **Impact:** Per-query cost limiting. Useful for Ralph Loop autonomous runs.
- **Why deferred:** @alpha, requires beta header. API may change.

#### Bridge module (`@anthropic-ai/claude-agent-sdk/bridge`) (since 0.2.83+, @alpha)
- **What:** Remote session management. External worker attaches to claude.ai sessions via JWT. Bidirectional message/permission relay over SSE/HTTP. Functions: `createCodeSession()`, `fetchRemoteCredentials()`, `attachBridgeSession()`.
- **Impact:** Could enable relay-as-a-service, multi-device, cloud-hosted sessions.
- **Why deferred:** @alpha with separate versioning (breaking changes without major bump). Needs architectural evaluation.
- **0.2.91 update:** `fetchRemoteCredentials()` signature changed (added `trustedDeviceToken` param, return type expanded with `CredentialsFailure`). Still @alpha.


## Upgrade Steps (0.2.80 -> 0.2.92)

1. ~~Verify no references to removed `SubscribeMcpResource*` / `SubscribePolling*` types~~ -- verified, none found
2. ~~Check grep usage for implicit `head_limit` reliance~~ -- verified, no `head_limit` usage in relay code
3. ~~Verify no references to `SDKStreamlinedTextMessage` / `SDKStreamlinedToolUseSummaryMessage`~~ -- verified, none found
4. ~~Verify `session_id` usage handles optional~~ -- verified, already uses truthy checks
5. `npm install @anthropic-ai/claude-agent-sdk@0.2.92`
6. Implement Priority 2 items as needed
7. Priority 3 items can be done incrementally


---
---


# Archive: 0.2.38 -> 0.2.76 (completed 2026-03-17)

## Priority 1 - High (Functional gaps, user-facing impact) -- DONE

### ~~1.1 `onElicitation` callback (since 0.2.39+)~~
- ~~**Status:** Implemented~~
- ~~**What:** MCP servers can request user input (OAuth login, form fields) via elicitation. Without this callback, all elicitation requests are auto-declined.~~
- ~~**Impact:** Slack, GitHub, and other OAuth-based MCP servers cannot authenticate through the relay UI.~~
- ~~**Where:** `sdk-bridge.js` - add `onElicitation` to queryOptions in `startQuery()`. Forward elicitation requests to the client via WebSocket, collect user response, return result.~~
- ~~**Types:** `ElicitationRequest`, `ElicitationResult`, `OnElicitation`, `SDKElicitationCompleteMessage`~~
- ~~**Related messages:** `SDKElicitationCompleteMessage` (new message type to handle)~~

### ~~1.2 `setEffort()` mid-query method (since 0.2.45+)~~
- ~~**Status:** Implemented~~
- ~~**What:** Change effort level on an active query without restarting it.~~
- ~~**Impact:** UI already has effort selector. Currently changing effort mid-conversation requires a new query.~~
- ~~**Where:** `sdk-bridge.js` - add `setEffort(session, effort)` method similar to `setModel()`. Call `session.queryInstance.setEffort(effort)`.~~

### ~~1.3 npm upgrade to 0.2.76 (prerequisite for all below)~~
- ~~**Status:** Done~~
- ~~**What:** `npm install @anthropic-ai/claude-agent-sdk@0.2.76`~~
- ~~**Impact:** Required for all new APIs. Peer dependency changed to `zod ^4.0.0`.~~
- ~~**Breaking:** `PermissionMode` removed `'delegate'` option (was in 0.2.38, gone by 0.2.63). Verify no code references it.~~


## Priority 2 - Medium (Improved reliability, better UX)

### ~~2.1 `listSessions()` top-level function (since 0.2.51+)~~
- ~~**Status:** Implemented~~
- ~~**What:** SDK-level session listing with pagination support. Replaces manual file system reading of `~/.claude/projects/` directories.~~
- ~~**Impact:** More reliable session discovery, handles edge cases (worktrees, symlinks) that manual FS reading might miss.~~
- ~~**Where:** `project.js` `list_cli_sessions` handler now uses `sdk.listSessions()` with fallback to manual parsing.~~
- ~~**Options:** `{ dir?: string, limit?: number }`~~

### ~~2.2 `getSessionMessages()` top-level function (since 0.2.51+) -- SKIP~~
- ~~**Status:** Skipped~~
- ~~**What:** Read session conversation messages with pagination.~~
- ~~**Why skipped:** Relay already loads session history via `readCliSessionHistory()` which works well. SDK function adds no sync benefit (unlike renameSession/listSessions). Per-session API calls make it unsuitable for search. No current feature needs this.~~

### ~~2.3 `getSessionInfo()` top-level function (since 0.2.74+)~~
- ~~**Status:** Implemented~~
- ~~**What:** Lightweight single-session metadata lookup (vs listing all sessions).~~
- ~~**Impact:** Used in `resume_session` handler to get SDK-resolved title (customTitle > aiTitle > firstPrompt).~~

### ~~2.4 `agentProgressSummaries` query option (since 0.2.72+)~~
- ~~**Status:** Implemented~~
- ~~**What:** AI-generated periodic progress summaries for running sub-agents. Piggybacks on prompt cache, so nearly free.~~
- ~~**Impact:** Better sub-agent progress visibility in UI. Currently only tool names/descriptions are shown.~~
- ~~**Where:** `sdk-bridge.js` - add `agentProgressSummaries: true` to queryOptions. Handle new summary messages in `processSDKMessage()`.~~

### ~~2.5 `forkSession()` top-level function (since 0.2.76+)~~
- ~~**Status:** Implemented~~
- ~~**What:** Branch a conversation from a specific message point. Creates a new session with transcript sliced at `upToMessageId`.~~
- ~~**Impact:** Enables "branch conversation" UI feature. Reuses prompt cache, so cost is minimal.~~
- ~~**Options:** `{ upToMessageId?: string, title?: string, dir?: string }`~~
- ~~**Returns:** `{ sessionId: string }`~~


## Priority 3 - Low (Nice-to-have, polish)

### ~~3.1 `renameSession()` top-level function (since 0.2.74+)~~
- ~~**Status:** Implemented~~
- ~~**What:** Rename a session title via SDK.~~
- ~~**Impact:** Session titles now sync to SDK on rename, auto-title, and via one-time migration of existing relay titles.~~

### ~~3.2 `tagSession()` top-level function (since 0.2.76+) -- SKIP~~
- ~~**Status:** Skipped~~
- ~~**What:** Attach/detach a tag string to a session (single tag per session).~~
- ~~**Why skipped:** SDK only supports 1 tag per session. Relay will implement its own multi-tag system (GitHub issue-style labels with colors) stored in relay metadata. SDK tagSession may be used as auxiliary sync for the primary tag.~~

### ~~3.3 `supportedAgents()` query method (since 0.2.51+) -- SKIP~~
- ~~**Status:** Skipped~~
- ~~**What:** Get list of available sub-agent types with names, descriptions, and models.~~
- ~~**Why skipped:** Sub-agent type is chosen by Claude, not by the user. Displaying the list in UI would be informational only with no actionable value.~~

### ~~3.4 `ThinkingConfig` types (since 0.2.51+)~~
- ~~**Status:** Implemented~~
- ~~**What:** `ThinkingAdaptive | ThinkingEnabled | ThinkingDisabled` config for controlling extended thinking.~~
- ~~**Impact:** Fine-grained thinking control. Current code doesn't expose thinking settings.~~

### ~~3.5 `ToolConfig` type (since 0.2.76+) -- SKIP~~
- ~~**Status:** Skipped~~
- ~~**What:** Configure AskUserQuestion preview format (`'markdown'` vs `'html'`).~~
- ~~**Why skipped:** Current monospace `<pre>` rendering is clean and appropriate for ASCII diagrams/code previews. HTML mode adds XSS risk and Claude compliance is not guaranteed.~~

### ~~3.6 New hook events (since 0.2.51+, 0.2.76+) -- N/A~~
- ~~**Status:** Available (no code change needed, hooks not used)~~

### ~~3.7 `AgentDefinition.model` expanded type (since 0.2.76+) -- N/A~~
- ~~**Status:** Available (no code change needed)~~

### ~~3.8 `Settings` interface export (since 0.2.76+) -- N/A~~
- ~~**Status:** Available (TypeScript not used)~~


## Already Implemented (0.2.38 -> 0.2.63 range)

These were added between 0.2.38 and 0.2.63 and are already integrated:

- [x] `promptSuggestions` query option + `SDKPromptSuggestionMessage` handling
- [x] `SDKRateLimitEvent` / `rate_limit_event` with UI display
- [x] `SDKTaskStartedMessage` / `SDKTaskProgressMessage` with sub-agent tracking
- [x] `FastModeState` with UI indicator (zap icon)
- [x] `stopTask()` method with fallback abort
- [x] `supportedModels()` in warmup
- [x] `forkSession` option on QueryOptions (boolean flag, not the top-level function)
- [x] `betas` query option support
- [x] `effort` query option at creation time


## Upgrade Steps (0.2.38 -> 0.2.76, completed)

1. ~~Check `zod` peer dependency compatibility (needs `^4.0.0`)~~
2. ~~`npm install @anthropic-ai/claude-agent-sdk@0.2.76`~~
3. ~~Verify no references to removed `PermissionMode: 'delegate'`~~
4. ~~Implement Priority 1 items~~
5. ~~Implement Priority 2 items as needed~~
6. ~~Priority 3 items can be done incrementally~~
