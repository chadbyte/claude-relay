# Claude Agent SDK Upgrade Tracker

Current: `@anthropic-ai/claude-agent-sdk@0.2.76` (Claude Code 2.1.76)
Updated: 2026-03-17

Covers all unapplied changes from 0.2.38 through 0.2.76.


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


## Upgrade Steps

1. Check `zod` peer dependency compatibility (needs `^4.0.0`)
2. `npm install @anthropic-ai/claude-agent-sdk@0.2.76`
3. Verify no references to removed `PermissionMode: 'delegate'`
4. Implement Priority 1 items
5. Implement Priority 2 items as needed
6. Priority 3 items can be done incrementally
