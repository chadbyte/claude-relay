# Per-Project Codex Adapter With Idle Reclaim

## Goal

Replace the daemon-wide singleton Codex adapter with per-project adapter
instances, and add idle-timeout reclamation so unused Codex app-servers
are shut down and their memory returned.

This eliminates an entire class of **cross-project tool-call leakage**
bugs that are structurally impossible to fully fix while the bridge
process is shared across projects.

## Context

### Why Claude doesn't have this problem

For Claude mates, `adapter.createToolServer` builds an in-process
`createSdkMcpServer`. When Claude calls a tool, the SDK invokes the
handler **in the same Node process**, and the handler closure captures
the project's `sm` (session manager). Concurrent Claude queries across
different mate projects run in parallel but each handler closure resolves
to its own project's session. No routing ambiguity, no leakage.

### Why Codex currently does

Codex is an external Rust binary spawned via a single
`CodexAppServer`. MCP tools for Codex must be external stdio processes.
Clay spawns `lib/yoke/mcp-bridge-server.js` as a child of the Codex
app-server to bridge Codex tool calls back into Clay via HTTP.

The current Codex adapter is stored at daemon-wide scope
(`_sharedAdapters` in `lib/yoke/index.js`) and initializes exactly one
`CodexAppServer` plus exactly one bridge. The bridge's `--slug` argument
is baked in at spawn time (based on whichever project initialized the
adapter first), and stays that way for the daemon's lifetime. Every
Codex-backed mate session in the daemon funnels its MCP tool calls
through that one shared bridge.

That means:

- Tool-call context (which project / which session originated the call)
  is lost the moment the call leaves Codex.
- The global `/api/mcp-bridge` endpoint can only guess which project to
  dispatch the call back to.
- Any guessing strategy (first match, isProcessing flag, last-focused
  mate, etc.) breaks as soon as two Codex-backed mate DMs run
  concurrently, which is a supported scenario in Clay.

### Why this is the fundamental fix, not another patch

The root cause is shared channel, not missing metadata. threadId
propagation would only work if Codex reliably forwarded a thread
identifier inside MCP `tools/call` params, and even then it would layer
a fragile disambiguation scheme on top of a shared pipe. Isolating the
pipe itself removes the need for disambiguation entirely. Per-project
adapters give Codex the same isolation model Claude already enjoys by
being in-process.

## Goals

1. Each project context owns its own Codex adapter instance.
2. Each Codex adapter spawns its own `CodexAppServer` and its own
   `mcp-bridge-server.js`, with that project's slug baked in.
3. Bridge HTTP requests go back to the project-scoped endpoint
   `/p/{slug}/api/mcp-bridge`, never to a global aggregator.
4. Idle adapters shut down cleanly after a configurable timeout and
   free all associated OS resources (Codex process + bridge process).
5. Shutdown is safe: no in-flight query is ever killed.
6. Re-spawn on next query is transparent to the caller.
7. Cross-project session leak becomes **structurally impossible**, not
   "best-effort mitigated".

## Non-Goals

1. Do not change the Claude adapter's lifecycle. It is in-process and
   does not benefit from the same treatment.
2. Do not preserve Codex thread state across a reclaim cycle. A reclaim
   ends the app-server; new work starts a fresh session.
3. Do not attempt to multiplex multiple projects onto a single shared
   Codex app-server via threadId routing. That is explicitly the wrong
   model and is what this change replaces.
4. Do not add cross-project tool visibility. Each project sees only its
   own tools, matching Claude's behavior.

## High-Level Design

### 1. Per-project Codex adapter instance

`createAdapters({ cwd, slug, ... })` becomes per-project. The returned
`{ adapters }` object contains fresh adapter instances owned by the
calling project. There is no `_sharedAdapters` cache for Codex.

Claude adapter may continue to be cached/shared because it is stateless
at the adapter level and expensive sync SDK loads should not be repeated
per project.

### 2. Lifecycle on the Codex adapter

Add to the Codex adapter closure:

```js
var _refCount = 0;
var _lastActiveAt = Date.now();
var _shuttingDown = false;
```

Wrap `createQuery` so that every query increments `_refCount` on entry
and decrements it on completion (including error / abort paths). On
each decrement, stamp `_lastActiveAt`.

Expose two new methods:

- `shutdownIfIdle(idleMs)`: if `_refCount === 0` and
  `Date.now() - _lastActiveAt >= idleMs`, tear down the app-server and
  reset `_initPromise`. Returns `true` if reclaim occurred.
- `shutdown()`: unconditional teardown for daemon shutdown /
  project destroy. Waits for in-flight queries to finish with a hard
  timeout (e.g. 5s), then forces exit.

Add `_shuttingDown` guard: while true, reject new `createQuery` calls
with a distinguishable error so the caller can retry or surface a
graceful message. In practice this window should be sub-second.

### 3. Bridge path

Revert `lib/yoke/mcp-bridge-server.js` to use
`/p/{slug}/api/mcp-bridge` (project-scoped) when `--slug` is passed.

Delete the global `/api/mcp-bridge` aggregation logic from
`lib/server.js`. Keep the project-scoped handler in
`lib/project-http.js`.

### 4. Daemon reaper

Add a single interval in `lib/daemon.js` that every
`REAPER_INTERVAL_MS` walks every registered project context and calls
`ctx.adapters.codex.shutdownIfIdle(IDLE_TIMEOUT_MS)`. Projects without
a Codex adapter (Claude-only, or uninitialized) are skipped.

Defaults:

- `IDLE_TIMEOUT_MS = 5 * 60 * 1000` (5 min)
- `REAPER_INTERVAL_MS = 60 * 1000` (1 min)

Overridable via env vars `CLAY_CODEX_IDLE_MS` and
`CLAY_CODEX_REAPER_MS`.

### 5. Project destroy hook

When `server.destroyProject(slug)` runs, call
`ctx.adapters.codex.shutdown()` before removing the context. This
prevents orphan Codex / bridge processes when mates are deleted or the
daemon restarts.

## Files To Change

### `lib/yoke/index.js`

- Remove `_sharedAdapters` caching for Codex. (May keep it for Claude.)
- `createAdapters({ cwd, slug })` constructs a fresh Codex adapter each
  call, passing `slug` through.
- `lazyCreateAdapter` path: do not share Codex instances across
  projects. Each call gets a fresh instance.

### `lib/yoke/adapters/codex.js`

- Accept `slug` in `opts` for both `createAdapter` and `init`. Use
  `slug` for the bridge `--slug` argument (replacing whatever value is
  currently injected from `initOpts.slug`).
- Add `_refCount`, `_lastActiveAt`, `_shuttingDown` closure state.
- Wrap `createQuery`:
  - If `_shuttingDown`, reject with `"Codex adapter is shutting down"`.
  - If `_initPromise` is null, call `init()` (lazy warm).
  - Track the underlying query handle; on finish/abort/error, decrement
    `_refCount` and update `_lastActiveAt`.
- Implement `shutdownIfIdle(idleMs)`:
  - Noop if `_refCount > 0` or idle has not elapsed.
  - Set `_shuttingDown = true`.
  - Call `_appServer.close()` (or whatever the existing shutdown
    method is; see `CodexAppServer` API in the adapter).
  - Null out `_appServer`, `_initPromise`, `_cachedModels` as needed so
    next init rebuilds cleanly.
  - Clear `_shuttingDown` once teardown resolves.
  - Log: `[yoke/codex] Reclaimed idle adapter for project {slug}`.
- Implement `shutdown()`:
  - Same as above but with a hard timeout. Use for daemon / project
    destroy.
- Ensure bridge child is correctly a child of the Codex app-server
  process (already true: Codex spawns it via `mcp_servers` config).
  When app-server dies, bridge stdin closes and bridge self-exits. No
  extra cleanup needed, but verify in test.

### `lib/yoke/mcp-bridge-server.js`

Revert the earlier global-endpoint change:

```js
var CLAY_MCP_PATH = claySlug
  ? ("/p/" + claySlug + "/api/mcp-bridge")
  : "/api/mcp-bridge";
```

The `/api/mcp-bridge` fallback is only for safety / backwards compat;
with this refactor `claySlug` should always be present.

### `lib/server.js`

- Delete the entire global `/api/mcp-bridge` handler block (the one
  that aggregates across projects and does fallback dispatch).
- Leave the project-scoped handler in `lib/project-http.js`
  untouched.
- Remove the `_globalMcpRoutes` helper if still present.

### `lib/project.js`

- In the ask-user MCP registration block, the `isProcessing` safety
  check added as a workaround can now be relaxed back to
  `if (!session)` since the routing ambiguity no longer exists.
  However, keep the `reject()` on missing session (instead of
  resolving with isError) as a defensive measure; leave a short
  comment explaining why.
- When constructing `sdk`/adapter per project, ensure `slug` is passed
  into `yoke.createAdapters({ cwd, slug })`.

### `lib/daemon.js`

- Add reaper interval:

```js
var IDLE_MS = Number(process.env.CLAY_CODEX_IDLE_MS) || 5 * 60 * 1000;
var REAP_MS = Number(process.env.CLAY_CODEX_REAPER_MS) || 60 * 1000;
var reaperHandle = setInterval(function () {
  relay.forEachProject(function (ctx) {
    try {
      if (ctx && ctx.adapters && ctx.adapters.codex
          && typeof ctx.adapters.codex.shutdownIfIdle === "function") {
        ctx.adapters.codex.shutdownIfIdle(IDLE_MS);
      }
    } catch (e) { /* ignore per-project errors */ }
  });
}, REAP_MS);
```

- On daemon shutdown, `clearInterval(reaperHandle)` and then call
  `shutdown()` on every project's Codex adapter before closing
  sockets.

### `lib/relay.js` (or wherever `addProject` / `destroyProject` live)

- In `destroyProject(slug)`, before removing from the projects map,
  call `ctx.adapters && ctx.adapters.codex && ctx.adapters.codex.shutdown()`.
- Add `forEachProject(fn)` helper if one does not already exist.

## Reference Counting Contract

The adapter's `_refCount` must reflect real outstanding Codex work.

- Increment at the start of `createQuery` **after** a successful warm-up.
- Decrement exactly once per query, in a `finally` block that covers:
  - normal completion
  - exceptions thrown during the query stream
  - abort via `abortController`
  - connection drops / stream errors
- Never decrement below zero. Assertion helpful during development:

```js
if (_refCount < 0) {
  console.error("[yoke/codex] refCount negative, bug!");
  _refCount = 0;
}
```

The handle returned by `createQuery` should expose `.abort()` that
triggers the same finally path.

## Shutdown Sequence

### Idle reclaim

1. Reaper ticks, calls `shutdownIfIdle(idleMs)`.
2. Check `_refCount === 0` and idle threshold. If not, return false.
3. Set `_shuttingDown = true`.
4. Call `_appServer.close()`.
5. Await close. (Codex app-server should drain stdio and exit.)
6. Bridge child stdin closes, bridge exits on its own.
7. Null out `_appServer`, `_initPromise`, `_cachedModels`.
8. Clear `_shuttingDown`.
9. Log reclamation.

### Project destroy

Same as idle reclaim but:

- Do not gate on `_refCount`. Instead, signal abort to any in-flight
  queries (via their `abortController`) and wait up to 5s.
- If timeout elapses, force `_appServer.kill()`.
- Remove the project's context from the registry after shutdown
  resolves.

### Daemon shutdown

- Stop reaper.
- For each project, call `ctx.adapters.codex.shutdown()`. Await all in
  parallel with a global 10s cap, then proceed with socket close
  regardless.

## Edge Cases

### Concurrent spawn race

Two `createQuery` calls on the same adapter nearly simultaneously.
`_initPromise` serializes them: second caller awaits same promise,
both proceed after warm-up.

### createQuery during shutdown

`_shuttingDown === true` when a new query comes in. Reject with
`"Codex adapter is shutting down, retry shortly"`. Callers higher up
(project / sdk-bridge) can either bubble the error or re-call after
backoff. Empirically the shutdown window is sub-second so retry once
with a 500ms delay before failing user-visible.

### Reclaim while user opens a DM

User opens mate DM A; no message sent yet; 5 min pass; reaper reclaims.
Next time user types, `createQuery` triggers re-init. Init cost (~1-3s)
is absorbed into the first turn's latency. Acceptable.

### Bridge process orphan detection

If bridge survives longer than its Codex app-server (should not happen
but belt-and-suspenders), add a periodic stdin check in
`mcp-bridge-server.js`: if stdin is closed and no activity for 30s,
`process.exit(0)`. This code may already exist; verify.

### Claude / Codex mix in same project

A project's `adapters` can contain both `claude` and `codex`. Only the
Codex entry needs lifecycle management. Claude is untouched.

### Lazy adapters

If a project never uses Codex, `_initPromise` stays null,
`_appServer` stays null, reaper noop. Zero cost.

## Testing

### Correctness (no leak)

1. Spawn two Codex-backed mates, open DMs for both.
2. Send a message to mate A that triggers the interview skill → ask
   question card.
3. Without answering, send a message to mate B that also triggers an
   interview.
4. Confirm mate A's question card shows in mate A's DM only. Mate B's
   question card shows in mate B's DM only. Never cross-pollinates.
5. Answer mate A's card. Confirm mate A's Codex query proceeds and
   mate B's pending card is untouched.

### Lifecycle

1. Send one message to mate A. Confirm one Codex app-server spawned
   via `ps aux | grep codex`.
2. Wait `IDLE_TIMEOUT_MS + REAPER_INTERVAL_MS` (e.g. 6 min).
3. Confirm the app-server is gone.
4. Send another message to mate A. Confirm a fresh app-server is
   spawned and the message is answered.
5. Confirm no orphan bridge processes exist at any point
   (`ps aux | grep mcp-bridge-server`).

### Project destroy

1. With a running Codex app-server for mate X, remove mate X from the
   registry (via UI or `mate_remove`).
2. Confirm the app-server and bridge processes terminate promptly.

### Daemon shutdown

1. Ctrl+C the daemon while a mate's Codex query is in flight.
2. Confirm daemon exits cleanly within 10s and no orphan processes
   remain.

### Stress / concurrency

1. Scripted: fire 5 concurrent Codex-backed mate DMs with interview
   skills. Each asks its question. Confirm all 5 question cards appear
   in the correct DMs, no mix-ups.
2. Resolve them in arbitrary order. Confirm each Codex query completes
   and the adapter's `_refCount` returns to 0.

## Rollout Plan

1. Implement refCount + idle shutdown methods on Codex adapter. Unit
   test with mock app-server.
2. Flip `yoke/index.js` to per-project instantiation. Keep a feature
   flag `CLAY_CODEX_PER_PROJECT=1` initially for safety; default true
   after one dev day of smoke testing.
3. Revert bridge URL to project-scoped.
4. Delete global `/api/mcp-bridge` aggregator.
5. Add reaper + destroy hook.
6. Remove the temporary `isProcessing` guard (or downgrade it to a
   defensive log-only check).
7. Run the correctness and lifecycle tests above.
8. Ship.

## Done Criteria

The refactor is complete only when all of these hold:

1. Every project context with a Codex adapter has its own
   `CodexAppServer` and its own bridge process.
2. The bridge process for project X only ever talks to
   `/p/X/api/mcp-bridge`. Enforced by `--slug` being per-project.
3. Two concurrent Codex mate DMs cannot route tool calls to each
   other. This is structurally impossible after the refactor, not a
   best-effort guard.
4. An idle Codex adapter is reclaimed within
   `IDLE_TIMEOUT_MS + REAPER_INTERVAL_MS` of last use, freeing its
   app-server and bridge processes.
5. First query after reclamation succeeds transparently, with only
   the init latency hit on the first turn.
6. Destroying a project terminates its Codex app-server and bridge
   within 5s.
7. Daemon shutdown leaves no orphan Codex / bridge processes.
8. Global `/api/mcp-bridge` aggregator is removed from `server.js`.
9. The temporary `isProcessing` workaround in `project.js` is either
   removed or clearly marked as defensive only.
10. Claude adapter behavior is unchanged.
