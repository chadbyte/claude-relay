# Stranded Bouncing Dots After Turn Completion — Handoff

## Symptom

After an assistant message finishes rendering (result + done received, cost line shown), the inline bouncing dots reappear below it and never stop. No turn is actually running. Once it starts, it happens after every completed message in that session. Screenshot evidence from session 453 on 2026-08-26 (turn ending at daemon.log line 279988, cost 6.2485).

## Root cause (verified, not speculation)

Introduced by commit fa28379 ("fix(sessions): keep stop active for queued turns", 2026-08-20). That commit tracks user turns queued behind an active response:

- `lib/sdk-bridge.js:1698-1702` — `pushMessage` during an active turn (`session._awaitingTurnResult === true`) increments `session._queuedTurnCount` instead of treating the message as a fresh turn.
- `lib/sdk-message-processor.js:468-477` — the result handler decrements the count and keeps `_awaitingTurnResult = true` when a queued turn exists.
- `lib/sdk-message-processor.js:511-516` — when a queued turn exists, right after `done` the server sends `{ type: "status", status: "processing" }` so the client keeps the Stop button.
- Client: `lib/public/modules/app-messages.js:899-911` — `status: processing` calls `setActivity("thinking")`, which renders the bouncing dots.

The bug: every turn-end path that finishes WITHOUT a result never resets the two flags. All of these reset `session.isProcessing` but leave `_awaitingTurnResult` and `_queuedTurnCount` stale:

1. `lib/sdk-bridge.js:879-889` — stream ended after a task stop (user interrupt), explicitly documented as "no result message was sent".
2. `lib/sdk-bridge.js:890-905` — result-less stream end (adapter reported an error and closed its iterator).
3. `lib/sdk-bridge.js:906-918` — catch path for AbortError / taskStopRequested.

Failure sequence:

1. User interrupts a turn → no result → `_awaitingTurnResult` stays true.
2. Next user message → `pushMessage` miscounts it as a queued turn (`_queuedTurnCount` = 1).
3. That turn completes normally → result handler sees `hasQueuedTurn`, sends `done` then `status: processing` → dots bounce forever (nothing follows).
4. `_awaitingTurnResult` stays true, so steps 2-3 repeat for every subsequent message until a brand-new query starts (`lib/sdk-bridge.js:1634-1635` is the only reset).

## Fix

In `lib/sdk-bridge.js`, in each of the three result-less end paths listed above, reset the queued-turn state alongside `session.isProcessing = false`:

```js
session._awaitingTurnResult = false;
session._queuedTurnCount = 0;
```

Zeroing the count is correct even if messages really were queued: when the stream dies, the SDK-side input queue dies with it, so those messages have no consumer anymore (see the delivery comments at lib/sdk-bridge.js:1665-1670).

Audit for completeness: grep every place `session.isProcessing = false` is assigned while a query is being torn down without a result (e.g. the initial-message-rejected path at lib/sdk-bridge.js:1621-1633) and apply the same reset where the same staleness can occur. Do NOT touch the result handler path — its decrement logic is correct for genuinely queued turns.

## Regression tests (the point of this exercise)

Add to `test/sdk-bridge-delivery.test.js`, which already harnesses this exact machinery (see existing tests "accepted pushes track turns queued behind the active turn" and "a result keeps processing active while a queued turn continues"):

1. **Interrupt resets queued-turn state**: simulate a turn that ends via the task-stop path (no result). Assert `_awaitingTurnResult === false` and `_queuedTurnCount === 0` afterwards.
2. **Post-interrupt turn is fresh, not queued**: after an interrupted turn, push a new message, complete it with a result, and assert that NO `{ type: "status", status: "processing" }` is sent after its `done` (this is the exact user-visible regression).
3. **Result-less error end resets state**: same assertions through the adapter-error stream-end path.
4. **Genuine queued turn still keeps stop active**: the existing behavior from fa28379 must keep passing — queued turn present → `status: processing` IS sent after `done`. Do not weaken the existing tests; extend them.

If a path is unreachable from the existing test harness, restructure minimally or add a focused unit around the smallest extractable function — but prefer exercising the real stream-end code.

## Optional client hardening (do only if trivial after the server fix)

A targeted self-clear: when the client shows dots due to `status: processing` received after a `done`, arm a ~20s timer cleared by any subsequent turn event (init/turn_start/thinking/delta/tool). If nothing follows, clear the activity. Do NOT add a blanket timeout to setActivity — long silent foreground tools (multi-minute Bash) legitimately show activity with no events.

## Hard requirements

- `var` only, no arrow functions; CommonJS on server.
- Do not change the wire protocol or client behavior for the legitimate queued-turn case.
- Do not commit; leave changes in the working tree.
- `node --check` on touched files; full `npm test` green on Node 22 (use `/Users/chad/.nvm/versions/node/v22.22.1/bin/node`; the shell default Node 18 cannot run the suite).

## Acceptance criteria

1. Interrupt a turn, send a new message, let it complete: no dots after done (test 2 above proves it at the unit level).
2. Queued-turn flow unchanged: send a second message mid-turn; Stop stays active between the turns.
3. All pre-existing tests in test/sdk-bridge-delivery.test.js still pass unmodified in their assertions.
4. Full suite green.
