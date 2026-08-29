# Worker Interruption Reported as Normal Completion — Handoff

## Symptom (observed live, 2026-08-26)

The user interrupted a Worker mid-implementation. The Driver session then received "[Worker execution completed] ... Review and verify the Worker's result" with no indication of interruption, so the Driver treated partial, unverified work as finished. `read_partner` and `check_spawned_sessions` have the same blind spot.

## Root cause (verified with file:line)

Both pair pollers infer the Worker's outcome from `partner.isProcessing` + `errorSince()`:

- Wait path: lib/project-session-pair.js:153-183 — resolves `{ status: failure ? "error" : "complete" }` at :167-172.
- Detached path: lib/project-session-pair.js:185-194 → `handleTurnDone` :136-151 sets `token.response` / `token.failure`; push text built at :99-104.
- `errorSince()` (lib/project-session-pair.js:27-32) matches only `history[i].type === "error"`.

A user interrupt produces NO error record: the result-less stream end paths (lib/sdk-bridge.js:883-899 task-stop, :918-932 AbortError) record `thinking_stop`, an `{type:"info", text:"Interrupted · ..."}` message, and `{type:"done", code:0}`, then clear `isProcessing`. The poller sees an idle worker with output and no error → `"complete"`.

Additional traps:
- `session.taskStopRequested` is reset in the query `finally` (lib/sdk-bridge.js:1028-1029) before the next 500ms poll tick, so it cannot be read from the poller. A durable flag is required.
- The interrupt path never fires `onTurnDone` (normal completion routes via lib/sdk-message-processor.js:568-570 → lib/project.js:859-862); detached delivery relies purely on the poll, so the signal must live on the session object.
- Same bug class in the spawn tool: lib/project-session-spawn.js:316-325 reports `done` for interrupted sessions because `hasSessionError()` (:125-131) only checks `type === "error"` or `done` with code 1, and interrupts emit `done` with code 0.

## Fix

1. **Capture a durable flag.** In lib/sdk-bridge.js set `session._lastTurnInterrupted = true` in both result-less interrupt paths (:887-899 alongside the existing interrupt feedback, :918-932 in the AbortError branch — only when the cause is taskStopRequested/abort, not adapter errors). Clear it when a new query/turn starts (where `taskStopRequested` resets at :1028-1029 is NOT the right place to clear — that runs at the end of the same stream; clear at query/turn START so the flag survives until the next turn begins).
2. **Detect in the pair pollers.** lib/project-session-pair.js: add the interrupted check next to `errorSince()` usage in both paths.
   - Wait path :164-173: resolve `status: "interrupted"` (still include the partial `response` text) when the flag is set and no error record exists.
   - Detached path :147-148: set `token.interrupted = true`; `resumeDriverWithResult` :99-104 gets a distinct text for the interrupted case, e.g. "[Worker execution interrupted] The user interrupted the Worker mid-turn. Its work is PARTIAL and unverified — do not treat it as finished. Review what was done and decide next steps with the user." Keep the completed/failed texts unchanged.
3. **Thread through the proposal flow.** lib/project-worker-proposal.js: `parsePartnerResult` (:232-238) passes the new status through; `runWorker` (:240-257) gets an `interrupted` branch before the failure `else` — proposal record status "interrupted", driver resume text as above, and the proposal card should not read "Completed". Client: lib/public/modules/worker-proposal.js statusLabel gets an "Interrupted" label.
4. **Status surfaces.** lib/project-session-pair.js:263 `read_partner` reports `status: "interrupted"`; lib/project-session-spawn.js:322 `check_spawned_sessions` likewise (treat a trailing interrupted turn as `interrupted`, not `done`).
5. **Driver guidance.** The pair system prompt (lib/project-session-pair.js:386 area) mentions the interrupted outcome so Drivers know it exists.

## Tests

Extend test/session-pair.test.js (fixture at :29-48 currently fakes turns with error/delta + `handleTurnDone`):
1. Teach the fixture to emulate an interrupted turn: `info` ("Interrupted ...") + `done` code 0 + the durable `_lastTurnInterrupted` flag + `isProcessing = false`, WITHOUT `handleTurnDone` (interrupts never fire it — the detached monitor poll must catch it).
2. Wait path returns `status: "interrupted"` with the partial response.
3. Detached push text contains "interrupted" and "PARTIAL", not "completed".
4. A normal completion after an interrupted turn (flag cleared at next query start) still reports "complete" — the flag must not stick across turns.
5. worker-proposal: an interrupted worker run produces the interrupted resume text and proposal status (mirror test/worker-proposal.test.js:197-218 which asserts /Worker execution completed/).
6. spawn tool: an interrupted spawned session reports `interrupted`, not `done`.

Existing assertions must remain unweakened.

## Hard requirements

- `var` only, no arrow functions; CommonJS server / ESM client; English strings; no commits.
- Do not change the completed/failed flows or their texts.
- The durable flag must be interrupt-specific: adapter errors keep reporting `error`, normal ends keep reporting `complete`.

## Validation

`node --check` on touched files; full `npm test` green on Node 22 (`/Users/chad/.nvm/versions/node/v22.22.1/bin/node`; shell default Node 18 cannot run the suite).

## Acceptance criteria

1. Interrupting a Worker mid-turn → Driver push says interrupted/partial, never "completed".
2. `read_partner` on an interrupted Worker returns `interrupted`, not `idle`.
3. `check_spawned_sessions` on an interrupted spawned session returns `interrupted`, not `done`.
4. Normal completion, failure, and still-running flows unchanged; full suite green.
