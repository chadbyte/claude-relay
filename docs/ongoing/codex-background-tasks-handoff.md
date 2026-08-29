# Codex background_tasks_changed Producer — Handoff

## Context and investigation verdict (2026-08-26)

Follow-up from the background-task indicator (PR #436). The yoke contract (lib/yoke/interface.js) allows adapters to synthesize `background_tasks_changed`. Investigation of the codex app-server protocol concluded:

- Codex emits NO push notification bookending background work. Deriving the event from `item/commandExecution` begin/end would label ordinary foreground shell calls as background tasks and thrash the indicator under REPLACE semantics. DO NOT do that.
- Codex's genuine background surface is **background terminals**: poll-only requests `thread/backgroundTerminals/list` / `clean` / `terminate` exist in the app-server binary's method table (plus `process/outputDelta` / `process/exited` notifications and the config key `background_terminal_max_timeout`). The interrupt prompt string in the binary confirms processes can outlive a turn.
- Spawned subagent child threads are a second background surface, but their notifications are dropped at lib/yoke/codex-app-server.js:257 (foreign threadId). Fixing that routing is OUT OF SCOPE here — it is an event-routing change with its own risks. This handoff covers terminals only.

## Design: polled level signal at turn boundaries

Implement `background_tasks_changed` in lib/yoke/adapters/codex.js as a polled signal:

1. **Poll points.** After `turn/completed` and `turn/failed` are flattened (codex.js:152, :208 are the edges), issue `thread/backgroundTerminals/list` for the current thread. The result maps to contract tasks: each live terminal → `{ task_id, task_type: "shell", description }` (use the command line or terminal name the protocol provides; empty string if none).
2. **Emit only on membership change.** Keep the last emitted set per query handle (state lives in `createEventState`, codex.js:654, instantiated per handle at :694). Compare task_id sets; emit a `background_tasks_changed` event via `pushEvent` (codex.js:715) only when membership changed. This matches the SDK's level-signal semantics and avoids per-turn event spam.
3. **Reset guarantee.** Emit an empty-set event from the app-server (re)start path (`_createAppServer`/`start()` at codex.js:1542-1549, NOT `adapter.init` entry, which is idempotent-cached at :1464). Consumers must never carry a stale set across a codex process restart.
4. **Graceful degrade.** If the `thread/backgroundTerminals/list` request errors (older binary, method missing), disable polling for that app-server instance after the first failure and never emit — feature silently absent, zero errors, zero retries per turn.
5. **task_type vocabulary.** Terminals are `shell`. Nothing else is produced by this implementation.

## Contract test

Add codex to the producer list in test/yoke-adapter-contract.test.js (:87-110). The current fixture shape assumes a pure raw→event normalize function; the codex producer is aggregated/polled, so add the fixture shape the harness needs (e.g. a producer entry that exercises the set-mapping function directly: terminals list in → contract tasks out, with membership-change gating tested separately in a codex-specific test). Do not weaken the claude producer's assertions.

Also add codex-focused tests:
1. Terminals list response maps to contract-conformant tasks (task_type "shell", ids preserved, description fallback "").
2. Same membership twice → one emission (level semantics).
3. Empty list after a non-empty one → empty-set emission (indicator clears).
4. App-server start emits empty set.
5. List request failure → no emission and no further polling attempts on that instance.

## Hard requirements

- No synthesis from `item/commandExecution` begin/end events.
- No new polling timers — poll only at the turn/completed and turn/failed edges plus process start.
- `var` only, no arrow functions, CommonJS; English strings; no commits.
- Keep every existing codex adapter behavior unchanged; keep modules under 500 lines (codex.js is large — if the addition pushes limits, extract a small codex-background-tasks.js helper module).
- Downstream (sdk-message-processor.js:626-633) needs no changes — verify, don't touch.

## Validation

`node --check` on touched files; full `npm test` green on Node 22 (`/Users/chad/.nvm/versions/node/v22.22.1/bin/node`; shell default Node 18 cannot run the suite or import SDK-adjacent modules).

## Acceptance criteria

1. A codex session with no background terminals never emits the event (no indicator, no churn).
2. The mapping function produces contract-conformant tasks and passes the shared contract assertions.
3. Membership-change gating and the process-restart empty-set are covered by tests.
4. A missing/erroring list method degrades silently and permanently for that instance.
5. Full suite green; claude producer tests unchanged.
