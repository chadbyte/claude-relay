# Codex App-Server Upgrade Tracker

Installed: `@openai/codex@0.142.4`
Latest: `@openai/codex@0.142.4` (npm)
Updated: 2026-07-01

Tracks Clay's integration against the OpenAI Codex CLI / `codex app-server` JSON-RPC protocol. Mirrors the structure of `SDK-UPGRADE.md` so the same review cadence applies.

The npm package itself is a thin launcher — the actual binary lives in the platform-specific `@openai/codex-{platform}-{arch}` packages, and protocol behavior is driven by the binary's compiled Rust. Diffs between npm versions do not reveal protocol changes; verification has to come from running each version against our adapter. See [Verification Procedure](#verification-procedure) below.

**Why we use `app-server` and not `@openai/codex-sdk`**: see [docs/guides/CODEX-INTEGRATION.md](../guides/CODEX-INTEGRATION.md). The SDK package runs `codex exec` with a closed stdin, which makes interactive approval impossible. `app-server` is the bidirectional JSON-RPC mode used by the VS Code extension and is the only protocol that supports tool/permission flows.


---


## Protocol Surface (current consumption)

What `lib/yoke/adapters/codex.js` currently translates from app-server notifications into YOKE events. When upstream renames, splits, or removes any of these, the adapter breaks silently — the symptom is "tool call vanishes" or "no progress event".

### Notifications consumed (item types and event types)

| App-server item / event | YOKE yokeType | Where |
|-------------------------|---------------|-------|
| `agent_message` (text content) | `text_start` / `text_delta` / `result` | adapter `convertItemToEvents` |
| `reasoning` (thinking blocks) | `thinking_start` / `thinking_delta` / `thinking_stop` | adapter |
| `command_execution` | `tool_start` / `tool_executing` / `tool_result` (Bash) | adapter |
| `file_change` | `tool_start` / `tool_executing` / `tool_result` (Edit/Write) | adapter |
| `mcp_tool_call` | `tool_start` / `tool_executing` / `tool_result` | adapter |
| `web_search` | `tool_start` / `tool_executing` / `tool_result` | adapter |
| `plan_update` | `plan_updated`, `plan_content` | adapter — surfaced via plan card |
| `prompt_suggestion` | `prompt_suggestion` (forwarded as-is) | adapter |
| `interrupted` | `interrupted` | adapter |
| `compaction` phase events | `status: compacting`/`status: processing` | adapter |
| `rate_limit_event` | `rate_limit` | adapter |
| `task_started` / `task_completed` | `turn_start` / `result` | adapter |

### Requests handled (app-server → host)

| Request | Handler | Notes |
|---------|---------|-------|
| `requestApproval` (command / file_change) | `canUseTool` flow | Response wrapped in `{ decision: 'accept' \| 'decline' }` |
| `requestUserInput` | `onElicitation` flow | Routes through Clay elicitation UI |

### Methods we call (host → app-server)

| Method | Where |
|--------|-------|
| `newThread` | session start |
| `sendMessage` | per user turn |
| `respond` (to approval/input) | inside canUseTool / onElicitation |
| `interrupt` | abort path |
| `rollbackThread` | rewind path |
| `generateTitle` (CLI subcommand) | adapter.generateTitle |


---


## Parity Divergences

Decisions where Clay deliberately differs from the Codex CLI or SDK. Same convention as `SDK-UPGRADE.md` — preserved so the rationale survives version bumps.

| Area | Codex / SDK behavior | Clay behavior | Why |
|------|----------------------|---------------|-----|
| Transport | `@openai/codex-sdk` runs `codex exec --experimental-json` with closed stdin | `codex app-server` JSON-RPC over stdin/stdout | SDK exec mode auto-cancels every approval (one-way pipe). app-server is the only mode that supports interactive tool/permission flows |
| Approval policy | Native terminal prompts | Always pass `approvalPolicy: "never"` and let Clay's `handleCanUseTool` drive the UI | Codex's terminal prompts cannot be relayed through the web UI — would hang forever |
| Plan rendering | Codex returns plan items as inline content | Clay renders as a dedicated plan card (`plan_updated` events) | Same UI lane as Claude's `EnterPlanMode` for vendor-uniform UX |
| Rewind | Codex `rollbackThread` (chat-only) | Clay's unified rewind (`rewindFiles` + chat) is Claude-only; Codex sessions take the chat-only path | Codex doesn't expose file checkpoints. Capability flag (`vendor_capabilities.rewind`) hides file-restore UI for Codex sessions |
| Title generation | Codex CLI `generateTitle` subcommand | Routed through `adapter.generateTitle` like Claude — currently uses CLI subcommand under the hood | Adapter abstraction lets future Codex sessions reuse `Options.title`-equivalent if Codex adds it |
| Compaction | Codex emits compaction phase events | Surfaced as `status: compacting` mirroring Claude's compact UX | Cross-vendor consistent activity indicator |
| Sandbox / web search | Per-turn config in app-server | Read from `getCodexConfig(sm)` and applied per-query, not per-session | Lets project-level toggles propagate without thread restart |


---


## Master Item Table

Codex doesn't publish per-version release notes the way the Claude Agent SDK does, so this list is grown reactively:

- **Reactive items** — added when a Clay user hits a regression or a Codex behavior changes. Each carries the version range observed.
- **Cross-vendor items** — shared with Claude SDK work; the canonical entry lives in `SDK-UPGRADE.md`, marked `Codex: x` there. This file lists those items here only when Codex needs adapter-side wiring beyond the platform-common layer.

### Cross-vendor items inherited from SDK-UPGRADE.md

These are the `Codex: x` rows in `SDK-UPGRADE.md`. When the platform-common feature lands, the Codex adapter side often needs nothing — it picks up the relay-level behavior. Any Codex-specific glue is captured below.

| SDK # | Item | Codex adapter touch | Status |
|-------|------|---------------------|--------|
| 7 | `TerminalReason` | Map Codex `finish_reason` (`stop`/`length`/`tool_calls`/`content_filter`) into the same enum the host renders | Pending |
| 8 | `reloadPlugins()` | Codex equivalent: thread restart with refreshed MCP config (no native hot-reload) | Pending |
| 10 | `SDKMessageOrigin` | Tag at relay; adapter passthrough | Pending |
| 12 | `McpServerToolPolicy` | Codex MCP config stored per-server in relay; adapter consumes existing config | Pending |
| 15 | `SDKPluginInstallMessage` | Map Codex MCP connection status → same plugin status UI | Pending |
| 16 | Thinking display modes | Codex thinking already uses our renderer; toggle via store | Pending |
| 17 | `ttft_ms` | Client-side timing (no SDK value) | Pending |
| 18 | Compact result/error | Codex compaction events already surfaced; need to add tokens-before/after + duration | Partial |
| 30 | Task `toolStats` | Polyfill at relay (count tool events per task) | Pending |
| 46 | `forwardSubagentText` | Codex doesn't expose subagents the same way; revisit when #9 lands | Deferred |
| 49 | `SDKControlMcpCallRequest` | Codex MCP calls already go through adapter | Equivalent exists |
| 51 | `SDKControlGetSessionCostRequest` | Codex emits cost on `task_completed`; expose at relay | Pending |
| 52 | Tool `duration_ms` | Codex emits its own per-tool duration; map at adapter | Pending |
| 53 | MCP `alwaysLoad` | Codex MCP loading semantics differ; revisit | Pending |
| 62 | `origin` on replay messages | Pairs with #10 | Pending |
| 63 | `alwaysLoad` startup-block doc | UI hint when toggle exposed | Pending |

### Codex-specific items (no SDK counterpart)

| Item | Version range | Status | Notes |
|------|---------------|--------|-------|
| Binary layout moved `vendor/<triple>/codex/` → `vendor/<triple>/bin/` | 0.124 → 0.142 | **Fixed** | `findCodexPath()` in `codex-app-server.js` would not find the binary after the bump (Codex fails to launch entirely). Resolver now probes both layouts (`bin/codex` then `codex/codex`) and returns the first that exists. |


---


## Verification Procedure

Run before bumping `@openai/codex` minor versions, since the Rust binary changes are opaque to npm-level diffs.

1. Pull the candidate version locally: `npm install @openai/codex@<version>`
2. Smoke matrix (all under `vendor: codex`):
   - **Plain message turn** — confirm `text_start` / `text_delta` / `result` arrive and render.
   - **Bash command requiring approval** — confirm `requestApproval` arrives, our `handleCanUseTool` returns `{ decision: 'accept' }`, command runs.
   - **File edit requiring approval** — same as above but file_change.
   - **Plan update** — give a planning-mode request, confirm plan card renders.
   - **MCP tool call** — call a clay-debate or clay-browser tool, confirm tool_start/result.
   - **Compaction** — drive a long session into compaction, confirm `status: compacting` surfaces and clears.
   - **Interrupt** — click stop mid-turn, confirm `interrupted` event arrives and UI clears.
   - **Rewind (chat-only)** — confirm rewind UI works and `rollbackThread` succeeds.
3. If any of the above regress: capture the raw JSON-RPC frames (set `_RAW_EVENT_DEBUG` in the adapter) and bisect against the prior version.
4. If smoke passes: bump `package.json` and let CI exercise the full path.

For protocol-level diagnosis, the codex app-server speaks JSON-RPC 2.0; you can drive it manually with `codex app-server` and stdin messages to confirm the protocol shape independent of our adapter.


---


## Upgrade Steps

### 0.124.0 -> 0.142.4 (done, npm bump + binary-path fix; UI matrix pending)

1. ~~`npm install @openai/codex@^0.142.4` (package.json caret bumped to `^0.142.4`).~~
2. ~~**Breaking:** binary moved to `vendor/<triple>/bin/codex`. Fixed `findCodexPath()` to probe both layouts (see Codex-specific items).~~
3. ~~Headless protocol smoke: spawn `app-server`, `initialize` handshake succeeds (response `userAgent` reports `0.142.4`). Core JSON-RPC protocol intact.~~
4. **Pending (needs runtime/UI):** the full verification matrix above — approval, file edit, plan, MCP tool, compaction, interrupt, rewind. The headless smoke only covers spawn + initialize.
5. If any matrix step regresses, update `lib/yoke/adapters/codex.js` `convertItemToEvents` and add a row here.

### Future bumps

Same procedure each time. The cadence Anthropic uses (multiple versions per week) is much faster than Codex; this file should not need monthly updates.


---


## See Also

- [docs/guides/CODEX-INTEGRATION.md](../guides/CODEX-INTEGRATION.md) — architecture, protocol primer, why app-server
- [docs/guides/codex-reference/llms.txt](../guides/codex-reference/llms.txt) — upstream LLM-readable Codex reference
- [docs/ongoing/SDK-UPGRADE.md](./SDK-UPGRADE.md) — Claude Agent SDK tracker (cross-references for platform-common items)
