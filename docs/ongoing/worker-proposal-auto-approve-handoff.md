# Auto-Approve Worker Proposals When Skip Permissions Is On — Handoff

## Goal

When the user has skip permissions toggled on for a session, a `propose_worker` call from the agent should not stop and wait for the user to click approve. The proposal should be auto-approved and the worker should start immediately, exactly as if the user had accepted it. The user has already opted out of per-action gating for that session; making them approve worker creation is friction with no safety benefit.

## What "skip permissions is on" means (verified)

Session-level state, set at session creation (lib/sessions.js:298-299):

- GUI sessions: `session.permissionMode === "bypassPermissions"`
- TUI sessions: `session.dangerouslySkipPermissions === true`

Treat either as ON. Both are already projected to clients (sessions.js:514, 711), so no new client state is needed for detection.

## Where to change (starting anchors, read the module fully first)

`lib/project-worker-proposal.js` (317 lines) owns the proposal lifecycle:

- Proposal creation around lines 166-184: builds the `worker_proposal` record, `sendAndRecord`s it into history, and waits for a user action message.
- User action handling around line 243 (`findProposal` + the accept path that calls `runWorker` at ~212).
- `updateProposal` (line 148) patches the record and broadcasts `worker_proposal_update`.

Implementation shape (adjust to what you find in the module):

1. In the propose flow, after recording the proposal, check the session's skip-permissions state. If ON, mark the proposal accepted with an auto-approval marker (e.g. `autoApproved: true` in the record/patch) and invoke the same code path the user-accept action takes. Do not duplicate the accept logic — call the existing function.
2. The proposal card must still be recorded and visible in the transcript, updated to its accepted/running state, so the user sees what happened. Add a small "auto-approved" indication to the update payload; client rendering lives in `lib/public/modules/worker-proposal.js` — show it (e.g. "Auto-approved · skip permissions") instead of the approve/reject buttons.
3. The MCP tool response to the proposing agent currently instructs it to end the turn and wait for the user's decision. When auto-approved, the response must say the worker was auto-approved and started (so the agent does not tell the user to go click a button). Check `lib/session-spawn-mcp-server.js` or wherever the propose_worker tool result text is built.
4. TUI sessions: if `propose_worker` is not reachable from TUI sessions, the `dangerouslySkipPermissions` check is dead code but harmless — include it anyway for symmetry, do not build anything TUI-specific.

## Hard requirements

- Reuse the existing accept path; no parallel approval logic.
- No change in behavior when skip permissions is OFF.
- The auto-approved proposal must remain visible in history with its final state (no silent worker spawns).
- English-only user-facing strings. `var` only, no arrow functions, CommonJS server / ESM client. No `localStorage`.
- Do not commit.

## Tests

- Extend the existing worker-proposal tests (find them; if none exist, add a focused test file) with:
  1. Skip permissions ON → propose call results in an accepted proposal without any action message, and the worker run path is invoked.
  2. Skip permissions OFF → behavior unchanged: proposal stays pending until an action message arrives.
  3. The auto-approved record carries the auto-approval marker.
- `node --check` on touched server files; full `npm test` green on Node 22 (`/Users/chad/.nvm/versions/node/v22.22.1/bin/node` — shell default Node 18 cannot run the suite).

## Acceptance criteria

1. With skip permissions on, an agent's propose_worker starts the worker with zero user interaction, and the transcript shows the proposal card in an auto-approved state.
2. With skip permissions off, the flow is byte-for-byte the old one.
3. The proposing agent's tool result tells it the worker already started (no "waiting for user decision" instruction).
4. Full suite green.
