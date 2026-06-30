# Claude Agent SDK Upgrade Tracker

Installed: `@anthropic-ai/claude-agent-sdk@0.3.196` (declared `^0.3.196`, bumped 2026-06-30)
Latest: `@anthropic-ai/claude-agent-sdk@0.3.196` (2026-06-30)
Updated: 2026-06-30

npm bump to 0.3.196 is **done** (clean lockfile reinstall; peers @anthropic-ai/sdk@0.107.0, @modelcontextprotocol/sdk@1.29.0, zod@4.4.3). Static + load verification passed and runtime smoke confirmed. The 0.2.133 -> 0.3.196 feature work (items #68-90) is still **pending implementation** — only the version bump and breaking-change verification landed.

Covers all unapplied changes from 0.2.80 through 0.3.196.
The 0.2.133 -> 0.3.196 delta (items #68+) was derived by diffing the published `.d.ts` surface (installed 0.2.132 vs npm 0.3.196), not a changelog, so the "since" version tags inside that range are approximate.
Codex multi-provider expansion planned. Items marked with Codex support are worth building as platform-common features.

**Deliberate parity divergences** (decisions that go beyond per-API skip judgments) are tracked at the bottom of this file under "Parity Divergences" so the rationale is preserved alongside the upgrade trail.


---


## Current Focus (2026-06-30)

**On 0.3.196.** The npm bump and breaking-change verification are done (see header). Active work is the 0.2.133 -> 0.3.196 feature backlog below. Older 0.2.x items (#6-63) stay open as lower-priority backlog; fully completed history lives in the **Archive** at the bottom of this file.

Next up, in order (detail under "New in 0.2.133-0.3.196"):

1. **#72** — host dialog / `onUserDialog`; lands long-standing **#14** (OAuth / interactive auth)
2. **#73-74** — model-refusal messages (fallback + no-fallback)
3. **#79 + #75** — `informational` + `permission_denied` system messages
4. **#76-78** — `reloadSkills` (supersedes #8), `setMcpPermissionModeOverride`, `thinking_tokens`
5. **#82-84** — `commands_changed`, `worker_shutting_down`, verify built-in tool surface (#84)

Done: npm bump + #68-79 (incl. #76/#77 client UI). Deferred: #80 toolAliases, #81 backgroundTasks (no driver in Clay), #85 (experimental usage API).


---


## Master Item Table

67 items total. Action: **Do** = implement, **Skip** = not needed. Codex: **x** = reusable for Codex (build as platform-common).

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
| 40 | ~~Assistant Worker module~~ | ~~Defer~~ | | **Retired** — `runAssistantWorker`/`AssistantWorker*` removed from SDK in 0.3.x (see #69) | -- |
| 41 | ~~`connectRemoteControl*` types~~ | ~~Defer~~ | | **Retired** — removed from SDK in 0.3.x (see #70) | -- |
| 42 | ~~Bridge enhancements~~ | ~~Defer~~ | | **Retired** — alpha bridge surface removed/reshaped in 0.3.x (see #70) | -- |
| 43 | `taskBudget` query option | Defer | | alpha, beta header required | -- |


### New in 0.2.113-0.2.123 (added 2026-04-30)

#### Breaking (verify before bumping)

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 44 | `settingSources` default change (0.2.119) | **Verify** | | `query()` now defaults to loading ALL sources when omitted (was empty). Pass `settingSources: []` explicitly to preserve isolation if needed | `sdk-bridge.js` query options |

#### P1 - High

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 45 | `Options.title` (0.2.113) | **Do** | | Set custom session title at creation, skip auto-generation | `sdk-bridge.js` query options |
| 46 | `Options.forwardSubagentText` (0.2.119) | **Do** | x | Forward subagent text/thinking blocks (not just tool use). Pairs with #9 | `sdk-bridge.js` query options |
| 47 | `Options.skills` (0.2.120) | **Do** | | Canonical skill enabler (`'all' \| string[]`). Replaces ad-hoc allowedTools `'Skill'` plumbing | `sdk-bridge.js` query options |

#### P2 - Medium

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 48 | `Options.planModeInstructions` (0.2.116) | **Do** | | Replace default plan-mode workflow body. Useful per-Mate customization | `sdk-bridge.js`, mate config |
| 49 | `SDKControlMcpCallRequest` (0.2.116) | **Do** | x | Silent MCP tool invocation via control channel (no model turn). Enables relay-side server queries | `sdk-bridge.js` |
| 50 | `SDKControlReadFileRequest` + `readFile()` (0.2.114, 0.2.121 added encoding) | **Do** | | Gated file reads (default 1MB, encoding utf-8/base64). Relay-controlled file viewer | `sdk-bridge.js`, client viewer |
| 51 | `SDKControlGetSessionCostRequest` (0.2.116) | **Do** | x | Formatted cost summary text. Useful for thin clients showing remote cost | `sdk-bridge.js` |
| 52 | Tool `duration_ms` (0.2.119) | **Do** | x | Feeds #30 toolStats. Per-tool wall time | `sdk-message-processor.js` |
| 53 | MCP `alwaysLoad?: boolean` (0.2.121) | **Do** | x | Bypass tool-search deferral for hot MCP servers | `project-mcp.js` UI |
| 54 | `UserPromptExpansion` hook (0.2.114) | Skip | | Hooks not adopted | -- |
| 55 | `PostToolBatch` hook (0.2.117) | Skip | | Hooks not adopted | -- |

#### P3 - Low

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 56 | `SDKControlFileSuggestionsRequest` (0.2.113) | Skip | | At-mention autocomplete, relay has its own | -- |
| 57 | Settings: `deniedDomains`, `voice`, `autoUpdatesChannel: 'rc'`, `wslInheritsWindowsSettings`, `disableBackgroundAgents` | Skip | | Niche or platform-specific (WSL/voice) or relay manages own auto-update | -- |

#### Defer

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 58 | `SessionStore` + `InMemorySessionStore` (0.2.113, alpha) | Defer | | Pluggable transcript mirror. Large surface, alpha API | -- |
| 59 | `foldSessionSummary()` (0.2.117, alpha) | Defer | | Sidecar summary index for SessionStore. Revisit when #58 lands | -- |


### New in 0.2.124-0.2.132 (added 2026-05-07)

Diff is small — mostly Remote Control toggles and SessionStore alpha extensions. No `Do` items beyond a single error string and an extension of #10 scope.

#### Verify (might affect us)

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 60 | `applyFlagSettings` accepts `null` per-key (0.2.132) | **Verify** | | API now lets callers clear a flag-layer key by passing `null`. Confirm we don't pass `null` accidentally in any call site (we currently don't use this API at all, so likely no-op) | `sdk-bridge.js` |

#### P3 - Low

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 61 | `oauth_org_not_allowed` error type (0.2.124) | **Do** | | New `SDKAssistantMessageError` value. Surface as a distinct error message rather than falling through the `unknown` bucket | `sdk-message-processor.js`, client error display |
| 62 | `origin` extended to replay messages (0.2.124) | **Do** | x | `SDKUserMessageReplay` / `SDKAssistantMessageReplay` gained `origin?`. Folds into #10 — propagate origin through replay path too | extends #10 |
| 63 | `alwaysLoad` startup-block side effect (0.2.128 doc) | **Do** | x | `alwaysLoad: true` blocks startup until the MCP server connects (capped at 5s). Document this in our MCP UI when the toggle is exposed | extends #53 |

#### Skip

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 64 | `Options.isolatePeerMachines` (0.2.124) | Skip | | Remote Control multi-machine peer isolation. Clay doesn't use Remote Control | -- |
| 65 | `Settings.disableRemoteControl` (0.2.128) | Skip | | Org-level Remote Control disable. Clay doesn't surface Remote Control | -- |
| 66 | `suppressOriginalPrompt` on permission decision (0.2.128) | Skip | | SDK-side prompt redaction in block messages. Relay handles its own permission UX | -- |

#### Defer

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 67 | `Options.sessionStoreFlush: 'batched' \| 'eager'` (0.2.128, alpha) | Defer | | Flush strategy for SessionStore mirroring. Relevant only if #58 lands | -- |


### New in 0.2.133-0.3.196 (added 2026-06-30)

Largest delta in the tracker: minor bump 0.2 -> 0.3 plus ~64 patches. Derived by diffing the published type surface, so version tags below are approximate. **Good news for the bump itself:** no `Options` key was removed, and Clay references none of the removed symbols, so installing `0.3.196` does not break existing call sites. The work is additive: new system-message subtypes to handle, the host-dialog (OAuth) callback that finally lands #14, and a few new query-handle methods.

#### Removed upstream (no Clay impact — confirm & retire tracker entries)

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 68 | `unstable_v2_*` session API + `SDKSession`/`SDKSessionOptions` removed | N/A | | Clay never adopted the v2 session API (grep clean). No action | -- |
| 69 | Assistant Worker removed (`runAssistantWorker`, `AssistantWorker*`, `WorkerState*`) | N/A | | Upstream dropped the module. **Retires #40.** Clay never imported it | -- |
| 70 | `connectRemoteControl*` + alpha bridge types removed | N/A | | Upstream dropped Remote Control client surface. **Retires #41-42.** Clay never used it | -- |
| 71 | Permission/prompt types reshaped (`CanUseToolContext`, `InboundPrompt`, `PromptRequest`/`PromptResponse` removed) | **Verify** | | Clay references none of these names, but confirm our `canUseTool` callback still matches the current signature after the bump | `sdk-bridge.js` |

#### P1 - High

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 72 | `Options.onUserDialog` + `supportedDialogKinds` (`OnUserDialog`/`UserDialogRequest`/`UserDialogResult`) | **Do** | x | **Lands #14.** Host-rendered dialog channel (the OAuth/interactive-auth flow path). Must answer unrecognized `dialogKind` with `{behavior:'cancelled'}`; providing the callback without `supportedDialogKinds` opts in to nothing | `sdk-bridge.js` query options, client dialog |
| 73 | `SDKModelRefusalFallbackMessage` (`subtype:'model_refusal_fallback'`) | **Do** | | Model refused and CLI fell back to another model (`direction: retry/revert/sticky`, `original_model`->`fallback_model`, `api_refusal_category`). Surface as a distinct notice instead of dropping silently | `sdk-message-processor.js`, client |
| 74 | `SDKModelRefusalNoFallbackMessage` (`subtype:'model_refusal_no_fallback'`) | **Do** | | Hard refusal, no fallback (`content`, `api_refusal_explanation`, `refused_user_message_uuid`). Pairs with #73; render as a clear error state | `sdk-message-processor.js`, client |

#### P2 - Medium

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 75 | `SDKPermissionDeniedMessage` (`subtype:'permission_denied'`) | **Do** | x | Tool call denied: `tool_name`, `tool_use_id`, `decision_reason_type`/`decision_reason`, `agent_id` for subagents. Surface why a tool was blocked (distinct from hook-config #27) | `sdk-message-processor.js`, client |
| 76 | `reloadSkills()` + `SDKControlReloadSkillsResponse` | **Do** | x | **Supersedes #8** (`reloadPlugins`). Hot-reload skills without a session restart | `sdk-bridge.js`, WS handler |
| 77 | `setMcpPermissionModeOverride(server, 'default'\|'auto'\|null)` | **Do** | x | Realizes the runtime half of #12 (per-server MCP permission mode). Returns `warning` on fuzzy server-name match | `sdk-bridge.js`, `project-mcp.js` UI |
| 78 | `SDKThinkingTokensMessage` (`subtype:'thinking_tokens'`) | **Do** | x | Live thinking-token estimate (`estimated_tokens`, `_delta`). Feeds #16/#17 (thinking display, ttft) | `sdk-message-processor.js`, client |
| 79 | `SDKInformationalMessage` (`subtype:'informational'`) | **Do** | x | Generalizes #4 notification: `level: info\|notice\|suggestion\|warning`, `tool_use_id` dedupe, `prevent_continuation`. Honor the render level and stop-on-`prevent_continuation` | `sdk-message-processor.js`, client |
| 80 | `Options.toolAliases: Record<string,string>` | Defer | x | No driver in Clay: aliasing exists to route built-ins to sandboxed equivalents, but sandbox is not adopted (#88). Revisit if/when a tool-alias config or sandbox lands | `sdk-bridge.js` query options |
| 81 | `backgroundTasks(toolUseId?)` + `BackgroundTaskSummary` | Defer | x | Polling API with no trigger/UI in Clay. Background-agent state is already pushed via `task_updated`/`task_notification` (incl. backgrounded). Revisit if an on-demand refresh is needed | `sdk-bridge.js`, client task UI |

#### P3 - Low

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 82 | `SDKCommandsChangedMessage` (`subtype:'commands_changed'`) | **Do** | x | Slash-command list changed mid-session (`commands: SlashCommand[]`). Refresh the command palette live | `sdk-message-processor.js`, client |
| 83 | `SDKWorkerShuttingDownMessage` (`subtype:'worker_shutting_down'`) | **Do** | x | Worker shutdown with `reason` (`host_exit`, `remote_control_disabled`, ...). Extends #7 TerminalReason for clean teardown messaging | `sdk-message-processor.js` |
| 84 | New built-in tool surface (`Cron*`, `Task*`, `Workflow`, `Monitor`, `Artifact`, `Projects`, `PushNotification`, `RemoteTrigger`, `ScheduleWakeup`, `EnterPlanMode`, `ReportFindings`, `ReadMcpResourceDir`) | **Verify** | x | SDK now ships many built-in tool I/O types. Confirm Clay's tool display/permission UI renders unknown tool names with a generic fallback rather than breaking | `tools.js`, client tool display |
| 85 | `usage_EXPERIMENTAL_MAY_CHANGE...()` + `SDKControlGetUsageResponse` | Defer | x | Richer usage than #51: `subscription_type` (pro/max/team/enterprise/null), per-model usage, rate-limit status. Method name explicitly warns "do not rely yet" — revisit when stabilized | `sdk-bridge.js` |

#### Skip

| # | Item | Action | Codex | Current status | Where |
|---|------|--------|:-----:|----------------|-------|
| 86 | `MessageDisplayHook*`, `StopHookSpecificOutput`, `SubagentStopHookSpecificOutput` | Skip | | Hooks not adopted | -- |
| 87 | Settings resolution API (`resolveSettings`, `ResolvedSettings`, `ResolvedSettingSource`, `PolicySettingsOrigin`) | Skip | | Programmatic/managed-settings resolution. SDK-internal; relay manages its own settings | -- |
| 88 | `SandboxCredentialsConfig` + sandbox settings | Skip | | Sandbox execution not adopted. Revisit if/when Clay pursues sandboxing | -- |
| 89 | `reinitialize()` query method | Skip | | Relay restarts/lazy-resumes sessions itself | -- |
| 90 | CLI/SDK internals (`extractFromBunfs`, `filterEscalatingDefaultMode`, `meta`, `SpawnOptions`, `REPL*`, `ShowOnboardingRolePicker*`, `ProvenanceEntry`, `SSEOptions`) | Skip | | Not part of the consumed query/message surface | -- |


### Delta Action Summary (0.2.133-0.3.196)

| | Count | Items |
|--|-------|-------|
| **Do** | 10 | #72-79, #82-83 |
| of which **Codex-reusable** | 8 | #72, #75-79, #82-83 |
| **Verify** | 2 | #71, #84 |
| Defer | 3 | #80, #81, #85 |
| Skip | 5 | #86-90 |
| N/A (removed upstream) | 3 | #68-70 (retires #40-42) |

Done so far: #68-79 (#72 host dialog, #73-74 refusal, #75 permission-denied, #76 reloadSkills, #77 MCP permission override, #78 thinking-tokens, #79 informational) plus #76/#77 client UI. Deferred #80/#81 (no driver in Clay). Remaining: #82-83 (messages) + #84 (verify).


---


## Action Summary

| | Count | Items |
|--|-------|-------|
| **Done** | 4 | ~~#1-4~~ |
| **Do** | 28 | #6-12, #14-18, #28, #30, #32-33, #45-53, #61-63 |
| of which **Codex-reusable** | 15 | #7, #8, #10, #12, #15-18, #30, #46, #49, #51-53, #62, #63 |
| **Verify** | 2 | #44, #60 |
| Skip | 26 | #5, #13, #19-27, #29, #31, #34-39, #54-57, #64-66 |
| Defer | 7 | #40-43, #58-59, #67 |


---


## Upgrade Steps

> Completed step lists (0.2.38 -> 0.2.112) are in the Archive at the bottom.

### 0.2.112 -> 0.2.132 (next)
1. **Verify** `query()` `settingSources` behavior (#44). Pass explicit `settingSources: ["user", "project", "local"]` already (relay does this) — confirm no regression.
2. **Verify** `applyFlagSettings` (#60). Currently unused by relay; confirm before bumping in case any future call passes `null`.
3. `npm install @anthropic-ai/claude-agent-sdk@0.2.132`
4. Implement P1 quick wins: `Options.title` (#45), `forwardSubagentText` (#46), `Options.skills` (#47).
5. Implement #6-12, #14-18 backlog as bandwidth allows.
6. Tool `duration_ms` (#52) feeds #30 toolStats — implement together.
7. Add `oauth_org_not_allowed` error path (#61) and extend origin propagation to replay messages (#62) when touching #10.

### 0.2.132 -> 0.3.196 (npm bump done 2026-06-30; feature work pending)
1. ~~Confirm Clay references none of the removed symbols (#68-70) — grep clean, retired #40-42~~
2. ~~**Verify** `canUseTool` callback still matches current signature (#71) — sdk-bridge loads clean after bump~~
3. ~~Clean lockfile reinstall to `^0.3.196`; peers resolved (@anthropic-ai/sdk@0.107.0, @modelcontextprotocol/sdk@1.29.0, zod@4.4.3)~~
4. ~~Verify: SDK loads + `query` export; client-import + server/client `node --check` pass; sdk-bridge/claude adapter/yoke load; all 7 called SDK members present; runtime smoke~~
5. Implement P1: host dialog / OAuth (#72, lands #14), then model-refusal messages (#73-74).
6. Implement P2: `informational` + `permission_denied` messages (#79, #75), `reloadSkills` (#76, supersedes #8), `setMcpPermissionModeOverride` (#77), `thinking_tokens` (#78), `toolAliases` (#80), `backgroundTasks` (#81).
7. Implement P3: `commands_changed` (#82), `worker_shutting_down` (#83). **Verify** built-in tool surface renders unknown tools gracefully (#84).


---


## Application Priority (2026-05-07)

The `Do` list has 28 open items. This is the order to apply them, ranked by **user-visible impact / implementation cost / risk**. Items in the same wave can share a PR; cross-wave items should land sequentially.

### Wave 0 — Pre-bump verification (gating, must finish before npm install)

| # | Item | Why first | Cost |
|---|------|-----------|------|
| 44 | `settingSources` default change verify (0.2.119) | Behavior change. Relay passes `settingSources` explicitly today, but every call site needs a one-line audit so the bump can't silently flip auto-title or any subagent path back to "load all sources". | XS |
| 60 | `applyFlagSettings` `null` semantics verify (0.2.132) | We don't call this API today, but future Claude Code conventions may; confirm and add a comment so the next person knows. | XS |

After these, run `npm install @anthropic-ai/claude-agent-sdk@0.2.132` and a full smoke test.

### Wave 1 — Quick visible wins (small diffs, immediate user benefit)

| # | Item | Why | Cost |
|---|------|-----|------|
| 45 | `Options.title` | Lets the host set the session title at creation. Bypasses the auto-title query entirely for cases where the title is known upfront (loops, scheduled, mate-seeded). Reduces "ghost Claude session" surface and saves a haiku call per session. | S |
| 52 + 30 | Tool `duration_ms` + Task `toolStats` | Pair. Per-tool wall time + per-task tool counts feed a single "what just happened" summary at task end. Claude provides #52; #30 we can polyfill at relay level so Codex works too. | M |
| 18 | Compact result/error + metadata | Currently we show "Compacting..." with no result. Adding `compact_result`, `compact_error`, `post_tokens`, `duration_ms` makes compaction visible and debuggable ("Compacted: 120k → 45k in 1.2s"). | S |
| 33 | Elicitation display fields | `title`, `display_name`, `description` on permission/elicitation. Users currently see raw tool names. Trivial render change with high readability gain. | XS |
| 61 | `oauth_org_not_allowed` error | One new error string, surface clearly so users with org-restricted OAuth see a useful message instead of "unknown error". | XS |

### Wave 2 — Foundational (enables later work, low-medium cost)

| # | Item | Why | Cost |
|---|------|-----|------|
| 10 + 62 | `SDKMessageOrigin` (incl. replay) | Relay already knows message source. Tagging it through the SDK enables future "from coordinator" / "from peer" UX without provider-specific code. Pair with #62 to cover replay too. | S |
| 47 | `Options.skills` (`'all' \| string[]`) | Replaces ad-hoc `allowedTools: ["Skill"]` plumbing with the canonical enabler. Cleans up a chunk of skill discovery code. | M |
| 7 | `TerminalReason` | Already partial. Forward `terminal_reason` cleanly so we can show "Stopped: prompt too long", "Max turns reached", etc. instead of generic abort. | S |

### Wave 3 — Capability extensions (medium cost, real new features)

| # | Item | Why | Cost |
|---|------|-----|------|
| 9 + 46 | `listSubagents()` / `getSubagentMessages()` + `forwardSubagentText` | Subagent transparency. Without #46 the host only sees subagent tool calls, not their text/thinking. With both, we can render subagent transcripts inline. | M |
| 11 | `systemPrompt` array + cache boundary | Direct cost/speed impact: split static prefix (mate identity, project rules) from dynamic suffix so the Anthropic prompt cache hits across sessions. ROI grows with mate count and session frequency. | M |
| 6 | `startup()` + `WarmQuery` | Pre-warms a subprocess so the first message has no cold-start latency. Visible only on cold sessions; user-perceived only when many short sessions are opened. | M |
| 8 | `reloadPlugins()` | Hot-reload MCP / skills / agents without session restart. UX improvement, not blocking. | S |

### Wave 4 — Polish and niche (low priority, do when bored)

| # | Item | Why later |
|---|------|-----------|
| 12 | `McpServerToolPolicy` | Per-tool MCP permission policies. Useful but low-frequency. |
| 14 | `SDKControlRequestUserDialogRequest` | OAuth/custom dialogs. Only matters when an MCP server actually requests one. |
| 15 | `SDKPluginInstallMessage` | "Loading plugin..." progress. Currently silent; users probably don't notice. |
| 16 | Thinking display modes (`summarized`/`omitted`) | Toggle for verbose thinking. Nice control, not blocking. |
| 17 | `ttft_ms` | Time-to-first-token. Mostly diagnostic. |
| 28 | Settings UI (5 fields) | New checkbox/numeric inputs. Mechanical. |
| 32 | `skip_transcript` | Filter housekeeping tasks from sub-agent list. Edge case. |
| 49 | `SDKControlMcpCallRequest` | Silent MCP invocation via control channel. Useful but no concrete need yet. |
| 50 | `SDKControlReadFileRequest` + `readFile()` | Gated file reads. Useful for relay-controlled file viewers, but our viewer doesn't need it. |
| 51 | `SDKControlGetSessionCostRequest` | Formatted cost summary text. We compute this client-side already. |
| 53 + 63 | MCP `alwaysLoad` + startup-block doc | Niche per-server toggle. |
| 48 | `Options.planModeInstructions` | Per-mate plan-mode customization. Useful for advanced mate authors only. |

### What this priority means concretely

- **Wave 0 today** (1 hour, gating).
- **Bump SDK to 0.2.132** (15 min + smoke test).
- **Wave 1 next session** (~half day total). Highest user-visible payoff.
- **Wave 2 within the same week.** Sets up Wave 3.
- **Wave 3 next week.** Real capability additions.
- **Wave 4 ad hoc** as bandwidth allows.


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


## Parity Divergences

Decisions where Clay deliberately deviates from the Claude Code reference, beyond the per-API "Skip" judgments above. Captured here because the reasoning is product-level, not SDK-version-bound, and easy to forget. Add new rows when divergences are made; don't delete entries even if they later converge.

| Area | Claude Code behavior | Clay behavior | Why |
|------|---------------------|---------------|-----|
| Session tagging | SDK supports 1 tag per session (`tagSession()`) | Multi-tag system (GitHub-style labels with colors), stored in relay metadata. SDK tag used as auxiliary sync only | Single tag is too restrictive for multi-axis organization (project + status + priority) |
| Session rename | `SDKControlRenameSessionRequest` | Clay's own rename system, syncs back to SDK via `renameSession()` | Predates SDK API. Already integrated into relay session model |
| AskUserQuestion preview | `ToolConfig` HTML mode option | Always monospace `<pre>` rendering | HTML mode adds XSS risk and Claude compliance is best-effort. Monospace is clean for ASCII diagrams/code |
| Permission UX | SDK permission classification (`user_temporary`/`user_permanent`) | Relay handles permission UX itself | Relay tracks permission lifecycle independently. SDK classification adds no actionable signal |
| Sub-agent type selection | `supportedAgents()` exposes list | Not surfaced in UI | Sub-agent type is chosen by Claude, not user. Listing it would be informational only |
| Native dialogs | `alert()`/`confirm()`/`prompt()` allowed in browser hosts | All dialogs are custom JS modals (CLAUDE.md rule) | Consistent styling, mobile-friendly, theme-aware |
| User settings storage | Per-browser via `localStorage` for client preferences | All user settings server-side via WebSocket/REST (CLAUDE.md rule) | Persists across devices and browsers |
| Session state messages | `SDKSessionStateChangedMessage` (idle/running/requires_action) | Not consumed | Relay tracks state more accurately via Socket.IO. SDK notification lags behind relay's own tracking |
| Context usage popover | SDK exposes `getContextUsage()` raw data | Custom hover popover over header bar | Hides "Free space"/"Autocompact buffer" categories (noise, not actionable). Disambiguates duplicate basenames (e.g. multiple `CLAUDE.md`) by parent dir. Grayscale emoji that color on hover for legibility |
| `defaultShell` setting | User-configurable shell | Not exposed | Clay targets macOS/Linux, bash always. Reduces config surface |
| Channel/teams settings | `channelsEnabled`, `allowedChannelPlugins`, `strictPluginOnlyCustomization` | Not exposed | Teams/Enterprise admin features. Out of scope for Clay |
| Hook events | Various HookEvent types (`TaskCreated`, `CwdChanged`, `FileChanged`, `PostToolBatch`, etc.) | Hooks not adopted | Relay does its own observability. Hook adoption is a larger architectural decision deferred until concrete need |


---
---


# Archive

## Upgrade Steps: 0.2.92 -> 0.2.112 (completed)

1. ~~Verify `SDKSessionInfo.systemPrompt` handling works with `string[]`~~
2. ~~Verify `EditFileOutput.originalFile` null handling~~
3. ~~Verify no references to removed `proactive` settings block~~
4. ~~`npm install @anthropic-ai/claude-agent-sdk@0.2.112`~~
5. ~~Add `'xhigh'` to effort selector UI~~
6. ~~Handle new message types: `task_updated`, `notification`, `plugin_install`~~


## 0.2.38 -> 0.2.76 (completed 2026-03-17)

### Priority 1 - High (Functional gaps, user-facing impact) -- DONE

### ~~1.1 `onElicitation` callback (since 0.2.39+)~~
- ~~**Status:** Implemented~~
- ~~**What:** MCP servers can request user input (OAuth login, form fields) via elicitation. Without this callback, all elicitation requests are auto-declined.~~
- ~~**Where:** `sdk-bridge.js` - add `onElicitation` to queryOptions in `startQuery()`.~~

### ~~1.2 `setEffort()` mid-query method (since 0.2.45+)~~
- ~~**Status:** Implemented~~
- ~~**What:** Change effort level on an active query without restarting it.~~

### ~~1.3 npm upgrade to 0.2.76~~
- ~~**Status:** Done~~


### Priority 2 - Medium -- DONE

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


### Priority 3 - Low -- DONE

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


### Already Implemented (0.2.38 -> 0.2.63 range)

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
