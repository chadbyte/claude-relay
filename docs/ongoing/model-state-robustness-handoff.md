# Model/Vendor State Machine Robustness — Handoff

## Symptom and root cause

A Claude session's model chip sometimes shows a Codex model (screenshot evidence 2026-08-26: "gpt-5.6-terra" in a Claude session). This area has needed repeated fixes (bc01d84, e40b3cb, 2f7baad, 1f62af8) because the underlying design invites leaks:

`sm.currentModel` is a PROJECT-scoped mutable (any session of any vendor writes it) that is (a) used as the fallback for per-session reads and (b) emitted in project-wide broadcasts, while the client applies `config_state.model` with no vendor, session, or membership guard (lib/public/modules/app-messages.js:471-489).

Verified leak paths, ranked (all confirmed by direct code reading):

1. Broadcast `config_state` carrying `sm.currentModel` — lib/project-sessions.js:1011, 1047, 1108, 1121, 1147, 1156, 1162, 1169, 1451, 1480. Any set_mode/set_betas/set_thinking/effort-default toggle by anyone broadcasts the project-global model to every client; the client applies it unconditionally.
2. `model_info` from the SDK init handler — lib/sdk-message-processor.js:199-208 pairs `model: sm.currentModel` (possibly a Codex id) with `vendor: session.vendor` (claude) and broadcasts. Vendor label matches the viewer's guard, id is not in the Claude list, so the raw leaked id renders (model-picker.js:23-32 falls back to raw id).
3. Reconnect/restore — lib/project-connection.js:180-184: `restoredActive.model || sm.currentModel` sent as both model_info and config_state labeled with the restored session's vendor.
4. Client `session_switched` stale fallback — app-messages.js:684 `model: msg.model || store.get('currentModel')` keeps the previous session's model when the new session has none.
5. Weak clear on switch — lib/project-sessions.js:676-689 only clears cross-vendor `sm.currentModel` when the target vendor's catalog is already loaded, and uses a bidirectional substring match (false positives).
6. `sendModelInfoForVendor` broadcast on setModel — lib/sdk-bridge.js:248-259 via 1946/1956 pushes one session's model into every same-vendor viewer's chip.
7. `lib/project-worker-proposal.js:43, 115` classifies "is Fable session" from `sm.currentModel` when `session.model` is unset — same shared-state defect, different symptom.

## Design (the robustness contract)

R1. **Session is the single source of truth.** Any payload describing a session's config is built from that session's own fields (`session.model`, `session.vendor`, `session.effort`, `session.permissionMode`). `sm.currentModel` must not appear in any client-bound payload.

R2. **Kill the project-global model.** Replace `sm.currentModel` with `sm.defaultModelByVendor[vendor]` (precedent: `sm.currentEffortByVendor`, lib/sdk-bridge.js:1972). The per-vendor default is used ONLY to seed a new/model-less session of that same vendor, and is written ONLY by same-vendor events (setModel, model_changed, init, saved project default). Grep every read/write of `sm.currentModel` and migrate each to (a) the session field, (b) the per-vendor default, or (c) deletion. `lib/project.js:478` (`_savedDefaultModel`) feeds the map, namespaced by vendor.

R3. **Self-describing wire payloads.** Every `config_state` and `model_info` includes `vendor` and `sessionId`. Broadcast `config_state` for genuinely project-global settings may remain broadcast but must NOT carry a `model` field at all; model values travel only in session-scoped messages (`sm.sendToSession`).

R4. **Client defense in depth** (keep even though the server is fixed — this is the "never again" layer):
- Reject `config_state`/`model_info` whose `sessionId` is present and ≠ `activeSessionId`, or whose `vendor` is present and ≠ `currentVendor`.
- When an incoming model id is verifiably NOT in the known list for the current vendor (list non-empty, respecting `resolvedModel` matching from bc01d84), do not adopt it: keep the current valid selection, else snap to the vendor default (2f7baad behavior), and log a console warning so leaks are visible in debugging instead of silent.
- `session_switched`: drop the `msg.model || currentModel` fallback. If the switched session brings no model, clear `currentModel` and request the vendor's models (`requestVendorModels`) even when the vendor did not change.

R5. **Preserve prior fixes** (regression constraints): requestId correlation and modelStatus retry/timeout UI (bc01d84), `set_model` → `model_selection_result` ack with rollback, `resolvedModel` matching (Fable resolves to a different id), per-turn model overrides with no history-based picker lock (e40b3cb).

## Implementation notes per path

- Path 1: change the ten project-sessions.js sites to send session-scoped `config_state` (per R1/R3) and remove `model` from any remaining broadcast form.
- Path 2: in sdk-message-processor init, send `model_info` via `sendToSession` with `session.model` if set, else the per-vendor default validated against `getModelsForVendor(initVendor)` (the pattern at lib/sdk-bridge.js:1235 is the good example).
- Path 3: project-connection restore uses `restoredActive.model`, else the restored vendor's default validated against that vendor's list; `buildInitialModelInfo` (project-connection.js:25-34) gains the same validation.
- Path 5: with R2 the cross-vendor clear juggling at project-sessions.js:662-689 becomes unnecessary; delete it rather than patching the substring match.
- Path 6: `sendModelInfoForVendor` from setModel becomes session-scoped.
- Path 7: worker-proposal Fable classification falls back to `sm.defaultModelByVendor[session.vendor]`.
- sdk-bridge `session.model || sm.currentModel` fallbacks (854, 860, 864, 1948, 1958, 1991, 1998) and project-sessions.js:1137: replace with `session.model || defaultModelByVendor[session.vendor]`.

## Tests (regression suite for this whole class)

Server (extend existing model/session tests or add test/model-state.test.js):
1. A Codex session's `setModel("gpt-x")` followed by any `set_mode`/`set_thinking` in the project never delivers a message containing "gpt-x" to a Claude session's client channel.
2. SDK init on a Claude session while the Codex per-vendor default is set emits model_info whose model is a Claude id (or empty), never the Codex id, and includes vendor + sessionId.
3. Reconnect restore of a model-less Claude session never emits a Codex id.
4. Broadcast config_state payloads contain no `model` field.
5. Per-vendor default map: setModel on vendor A does not change the default for vendor B.

Client (DOM/unit harness like test/worker-proposal-ui.test.js if feasible):
6. config_state with mismatched vendor or sessionId is ignored.
7. model_info carrying an id not in the current vendor's non-empty list does not change the chip.
8. session_switched without a model clears the chip and triggers a model request instead of showing the previous session's model.

Validation: `node --check` on touched server files; full `npm test` green on Node 22 (`/Users/chad/.nvm/versions/node/v22.22.1/bin/node`; shell default Node 18 cannot run the suite).

## Hard requirements

- `var` only, no arrow functions; CommonJS server / ESM client; modules under 500 lines; no inline logic in project.js handleMessage; English-only strings; no localStorage.
- Do not regress the R5 list.
- Do not commit.

## Acceptance criteria

1. The reproduction from path 1 (pick a Codex model in one session, switch to a Claude session, toggle thinking/permission mode) leaves the Claude chip showing a Claude model.
2. The reproduction from path 2 (any Claude session init while the project's last-touched model was Codex) never shows a Codex id.
3. Page reload on a model-less Claude session shows a Claude model or a loading state, never a Codex id.
4. All 8 tests above pass; full suite green; R5 behaviors verified unchanged (existing model tests keep passing unmodified).
