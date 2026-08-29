# Background Task Indicator — Handoff

## Problem

When the agent starts a background task (background Bash, Monitor, background subagent) and ends its turn, the Clay UI shows nothing. The user cannot tell "the agent is genuinely waiting on X and will resume" from "the agent just said it is waiting and stopped." The only trace is text the agent chose to write.

The Claude Agent SDK already emits everything we need: a level signal `background_tasks_changed` carrying the full set of live background tasks. Clay currently drops it (falls into the system catch-all in the claude adapter and disappears).

## Verified SDK facts (re-derived from node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts, 2026-08-26)

- `SDKBackgroundTasksChangedMessage` (sdk.d.ts:3131): `{ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id, task_type, description }] }`.
  - REPLACE semantics: swap your set for each payload. Never pair start/finish edges.
  - Per-process level: nothing is emitted at process startup; consumers MUST reset to empty whenever the session's CLI process (re)starts.
  - On a repeated `initialize` (reconnect), the SDK sends a snapshot right behind the success response, even when empty.
  - Payload carries ids only; do not correlate with the edge stream (`task_started`/`task_notification`).
- `SDKTaskNotificationMessage` (sdk.d.ts:4830): `type: 'system', subtype: 'task_notification'`. The claude adapter matches `raw.type === "task_notification"` (lib/yoke/adapters/claude.js:316), so for the current SDK this is a DEAD PATH — the handler at lib/sdk-message-processor.js:625 never fires from the flattener.
- `SDKTaskUpdatedMessage` (sdk.d.ts:4904): `type: 'system', subtype: 'task_updated'`. Not flattened at all; lib/sdk-message-processor.js:596 is also a dead path.
- `stopTask(taskId)` exists on the SDK query object and Clay already plumbs it: `stop_task` WS message → lib/project-sessions.js:934 → lib/sdk-worker.js:123.

## Scope

Server: define `background_tasks_changed` as a vendor-neutral yoke adapter contract event, implement it in the claude adapter, keep it as per-session state, push it to clients, replay on reconnect. Client: render a persistent indicator with per-task stop buttons. Also repair the two dead task event paths in the claude adapter since this feature depends on the same event family.

Out of scope for this PR: codex/kiro adapter implementations (they simply do not emit the event yet and must degrade to "no indicator" with zero errors — the contract explicitly allows them to synthesize it later, see section 1), historical/completed task lists, task output viewing.

## Design principle: this is NOT a claude-only feature

Everything downstream of the yoke layer (processor, session state, WS message, reconnect replay, UI) must depend only on the vendor-neutral `yokeType: "background_tasks_changed"` event, never on claude SDK shapes or vocabulary. The claude adapter is merely the first producer. A future codex or kiro adapter that emits the same contract event must light up the whole feature without touching any downstream file.

## Implementation

### 1. Adapter contract + claude flattening

**Contract (vendor-neutral, applies to every yoke adapter):**

- Event: `yokeType: "background_tasks_changed"`, payload `tasks: [{ task_id, task_type, description }]`.
- REPLACE semantics: each payload is the full live set; downstream never pairs edges.
- Reset guarantee: consumers reset to empty on adapter/CLI process (re)start; adapters that can, should emit a snapshot after re-initialization.
- Emitting the event is OPTIONAL per adapter. An adapter without a native level signal MAY synthesize it from its own edge events (e.g. codex exec begin/end), as long as it upholds REPLACE + reset. Adapters that emit nothing → feature silently absent for that vendor.
- `task_type` uses a small normalized vocabulary: `shell | agent | monitor | other`. Adapters map their native type strings into it (claude: `local_bash` → `shell`, `local_agent` → `agent`, anything else → `other`). UI must treat `task_type` as a decorative badge only and rely on `description` for meaning.

Document this contract where the other yoke adapter contract expectations live (see test/yoke-adapter-contract.test.js and any adapter contract doc it references).

**Claude adapter implementation** — in `flattenEvent()` where system subtypes are handled (claude.js:172-263):

- Add: `raw.subtype === "background_tasks_changed"` → `base.yokeType = "background_tasks_changed"; base.tasks = raw.tasks;`
- Add: `raw.subtype === "task_updated"` → `base.yokeType = "task_updated"` (carry `task_id`, `patch`), making lib/sdk-message-processor.js:596 live again.
- Fix: `task_notification` must also match the system-subtype form. Keep the existing top-level `raw.type === "task_notification"` check (claude.js:316) for older CLIs and add the `raw.type === "system" && raw.subtype === "task_notification"` form. Both produce the same flattened shape.

### 2. Per-session state — lib/sdk-message-processor.js (+ lib/sessions.js)

- New branch for `background_tasks_changed`:
  - `session.activeBackgroundTasks = ev.tasks` (REPLACE, no merging).
  - Push to clients: `sendToSession(session, { type: "active_background_tasks", tasks: ev.tasks })`. Use the non-recording send path (like `doSendToSession`, lib/sessions.js:860) — this is level state, it must NOT be written into the transcript/history.
- Reset rule: on `yokeType === "init"` (new CLI process, handled near lib/sdk-message-processor.js:569 area) set `session.activeBackgroundTasks = []` and push the empty state. This implements the "reset on process (re)start" requirement.
- Precedent for session-scoped task bookkeeping: `session.taskIdMap` (lib/sdk-message-processor.js:573).

### 3. WS schema — lib/ws-schema.js

Register the new server→client `active_background_tasks` message the same way sibling messages are registered (see `stop_task` at ws-schema.js:149 for the client→server direction; find the server→client registry in the same file).

### 4. Reconnect replay — lib/project-connection.js

At the state-resync point (project-connection.js:282-283, where `status: processing` is replayed for the active session), also send `active_background_tasks` with the current `session.activeBackgroundTasks` (send `[]` explicitly if empty so a stale client indicator clears).

### 5. Session list projection — lib/sessions.js

- `mapSessionForClient` (sessions.js:481): add `backgroundTaskCount: (session.activeBackgroundTasks || []).length`.
- Call `broadcastSessionList` (sessions.js:529) only when the count changes (0→n or n→0 or different n), not on every identical payload, to avoid list churn.

### 6. Client — new module lib/public/modules/background-tasks-ui.js

- Follow docs/guides/CLIENT_MODULE_DEPS.md: state in store.js, WS via ws-ref.js, direct imports. NO `var _ctx = null` / `initXxx(ctx)` pattern.
- `app-messages.js`: add `case "active_background_tasks"` → `store.set({ activeBackgroundTasks: msg.tasks })` (near the sibling cases at app-messages.js:1107-1131).
- The module subscribes to `activeBackgroundTasks` and renders a compact sticky bar above the input (style precedent: app-loop-ui.js / app-debate-ui.js bottom bars):
  - Collapsed: `⏳ 2 background tasks` (count chip).
  - Expanded (click): one row per task — `description` text, `task_type` badge, a Stop button that sends `{ type: "stop_task", taskId: task.task_id }` (send precedent: lib/public/modules/tools.js:2400).
  - Empty set → bar fully removed from DOM.
- `sidebar-sessions.js`: render a small count badge next to the existing `session-processing` spinner sites (sidebar-sessions.js:977, 1174, 1254, 1324) using the new `backgroundTaskCount` field.
- All UI strings in English. No `localStorage`. No browser-native dialogs.

### 7. Docs

Add the new module to docs/guides/MODULE_MAP.md.

## Hard requirements (safety rails)

1. REPLACE semantics everywhere. Never increment/decrement from `task_started`/`task_notification` edges — a missed edge must not wedge the indicator.
2. Reset to empty on CLI process (re)start (init event). A stale "waiting" indicator is worse than none.
3. `active_background_tasks` is level state: never recorded to transcript, never appears in history replays as a message.
4. Non-claude vendors: no event → no state → no UI. Zero errors, zero placeholder UI.
5. Code style: `var` only, no arrow functions; CommonJS on server, ES modules on client; modules under 500 lines; no inline logic in project.js handleMessage.
6. Do not break the existing subagent card flow in tools.js (task_started/task_progress/subagent_done still work as today).

## Tests

- Extend test/yoke-adapter-contract.test.js (or the closest adapter test): `flattenEvent` maps `{type:'system', subtype:'background_tasks_changed'}` → yokeType + tasks (with `task_type` normalized to the contract vocabulary); maps system-subtype `task_notification` and `task_updated`; top-level legacy `task_notification` still maps. Write the contract-shape assertions vendor-neutrally so a future codex/kiro producer can be added to the same test.
- Processor test: REPLACE semantics (second payload swaps, does not merge); init event clears state and emits empty push.
- `node --check` on every touched server file; `npm test` green.

## Acceptance criteria

1. Agent runs a background Bash (`run_in_background: true`) and ends its turn → bar appears with the task description within one WS push; no page reload needed.
2. Task completes → bar disappears without user action (driven by the next `background_tasks_changed`, not by edge pairing).
3. Browser refresh while a task is running → bar reappears from the reconnect replay.
4. Daemon-side CLI process restart while the bar shows → bar clears on the next init.
5. Stop button ends the task (verifiable by the task's `task_notification` status `stopped` arriving as the usual notification).
6. Sessions with zero background tasks look exactly as they do today, on all vendors.

## Follow-up (separate PR, not this one)

Codex adapter synthesis: maintain the live set inside lib/yoke/adapters/codex.js from the app-server's exec/task lifecycle events and emit contract-conformant `background_tasks_changed` payloads. Requires a survey of which codex events reliably bookend backgrounded work. Kiro likewise if/when its event stream supports it.
