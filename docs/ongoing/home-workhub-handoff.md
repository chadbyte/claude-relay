# Home Work Hub: Mates + Kanban (Handoff)

Status: phase 1 steps 1-2-4 shipped on feat/home-board (PR #407);
principles v2 below locked 2026-08-19, tool platform not started
Date: 2026-08-19
Owner: Chad

## Principles v2 — the mate access surface (locked 2026-08-19)

This supersedes "home = mates + kanban". The home screen is the mate's
access surface, modeled on clayOS capsules (see ~/clayOS/README.md and
clay-kernel/docs/ARCHITECTURE.md — L+S+D, "augmentation not mediation").

Why capsules exist (2026-08-20): mates reach for a capsule when they
need what conversation cannot provide — deterministic computation
(same input, same result: invariants, transforms, atomic LLM calls
with fixed minimal context) and accumulating user-specific data
(today's entries are tomorrow's foundation). Each installed capsule
raises the capability of the human AND the mates at once (Display for
the human, Skills for the mate), so the workspace's capability grows
monotonically while conversations come and go. This is the test for
"should this be a capsule": does it make determinism or accumulation
available to both driver seats?

1. Mates live at home. Mate DM is abolished: no separate screen, no WS
   swap, no project-style chat session UI for mates. The only surface is
   the home conversation pane (the home_mate_* relay, already shipped).
2. Left pane = conversation with the mate. Right pane = the tools the
   mate controls. The kanban board is the built-in, first-class tool —
   the first resident of a tool dock, not the definition of the pane.
3. Every tool follows the capsule contract, translated to Clay:
   - Logic: headless state + actions. Built-ins may own server logic
     (board.js invariants); user/mate-created tools run their logic.js
     in a sandboxed Web Worker — no DOM, no arbitrary server code. The
     server provides generic scoped APIs only (per-tool nedb storage,
     event broadcast).
   - Skills: manifest-declared markdown + the universal MCP surface
     that teaches the mate when/how to drive the tool.
   - Display: a DECLARATIVE component tree (fixed vocabulary: list,
     card, table, input, button, select, ...), rendered by the host
     with native Clay DOM and CSS variables. Tools ship no HTML.
     Consistency is structural, not disciplinary. One escape hatch: an
     `embed` component rendered in a sandboxed iframe for custom
     visuals; embed internals are invisible to mate control.
4. Two driver seats, one steering wheel. Every input converges on an
   action; human clicks and mate tool-calls run the same action path.
   The universal MCP surface is small and fixed:
   tool_snapshot / tool_act / tool_set / tool_storage_*.
   Per-tool nuance comes from the tool's Skills markdown, not new tools.
5. Without Display, Skills go dark: a tool not mounted in the dock is
   removed from the mate's tool surface.
6. Every action is observable and attributed (caller = "user" | mateId),
   and human interactions stream to the mate as context.
7. Ruby/WASM (clayOS's boundary) is explicitly NOT adopted here: the
   declarative-UI + worker-sandboxed-logic split provides the isolation
   with a web-native stack that LLMs author reliably.
8. Built-ins are capsules too (added 2026-08-20). The board is
   first-class but must live INSIDE the capsule spec; when the spec is
   too small, the spec grows — built-ins never escape it. Two sanctioned
   extensions: (a) manifest `runtime: "server" | "worker"` — identical
   state/action contract, but trusted built-ins shipping with Clay may
   execute logic server-side (invariants a client must not be able to
   bypass, e.g. board completion rules); user/mate tools are always
   `worker`. (b) the UI vocabulary grows `board` (column container) and
   `board-card` (draggable card) nodes; home-board.js becomes the
   reference renderer for those nodes, and the board ships as
   manifest + ui.json + server logic like any capsule.
9. A capsule is literally a folder (added 2026-08-20). Install/remove =
   add/delete one directory; the filesystem is the source of truth and
   the registry is a directory scan. Everything the capsule is lives
   inside its folder: manifest.json, ui.json, logic.js, and its data
   (data.db) — deleting the folder removes code AND data; sharing a
   capsule is copying a folder. Built-ins follow the same rule: the
   board ships as a repo folder (lib/capsules/board/), not as source
   strings embedded in JS (the scratchpad also lives in
   lib/capsules/scratchpad/). WS tool_install is merely a
   convenience that writes the folder.
10. Capsules belong to the USER, never to a mate (added 2026-08-20). A
    tool is workspace property: every mate of that user sees the same
    installed set through clay_tool_list, and tool storage is scoped
    user x tool — mates share one tool's data and collaborate in it.
    Who did what is expressed by attribution (callerId), not by
    ownership. Contrast: a mate's Memory/Knowledge are mate properties,
    not capsules — that is the boundary between "belongs to the mate"
    and "belongs to the workspace".

## Vision

Clay is redefined from a coding agent (execution only) into a workspace that
owns the full loop of work: work is defined on a board, executed by mates and
sessions, and completed back on the board. In the positioning
"self-hosted agent workspace with task memory for team deployment",
the task memory is this board.

The loop:

```
Kanban (work defined) -> execution (mate / session) -> Kanban (completion recorded)
```

The home screen (C button) is where work starts and ends, and it is where
mates live. Mates are not chat partners; they take work from the board,
execute it, and put results back on the board.

## Home screen layout

The home screen splits into two panes:

- Left: mates. Every user has at least one mate because Clay itself becomes
  the default mate. The "no mates" state disappears. This supersedes the
  "Mates default off" policy: Clay is absorbed into the mate concept, and
  only additional mates remain opt-in.
- Right: kanban board. A shared workspace that humans and mates both read
  and write.

## Phase 1 scope (locked)

In scope:

- Native kanban items only. Cards are created and managed inside Clay.
- Home screen two-pane layout (mates left, board right).
- Clay as the default mate visible to every user.
- Mate entry point moves from the sidebar friend strip to the home screen.
- DM mode moves into the home screen.
- @mentions in project sessions are kept as-is (must not break).

Out of scope (deferred, do not build yet):

- GitHub issue sync (gh CLI based, assignee-driven board population).
  This is the planned main feed for the board later, but phase 1 ships
  without it.
- Mate long-term memory (nedb datastore). Direction is decided
  (@seald-io/nedb, purpose-built memory tools instead of a SQL surface,
  reuse the wiring patterns from removed commit 2658e2f) but it is not
  part of this phase.
- Tighter project/git/GitHub integration ("project as the unit of work
  context").

## UI changes

- Sidebar friend strip: mates are removed from it. Only real users remain.
  Relevant module: `lib/public/modules/sidebar-mates.js` (mate icon strip,
  DM picker, context menus, DM badges).
- DM mode (`lib/public/modules/app-dm.js`): entry moves to the home screen.
  The conversation surface itself relocates under the C button.
- Home hub (`lib/public/modules/app-home-hub.js`, `home-chat.js`): currently
  greeting/weather/tips/projects plus the Clay home chat. This is the base
  that becomes the two-pane work hub.
- Mentions (`lib/project-mate-interaction.js`): unchanged. Mentioning a mate
  from a project session keeps working regardless of where mates live.
- Mobile (`lib/public/modules/sidebar-mobile.js`): mate profile sheet and
  tab flows need to follow the new entry point.
- Notification surfaces: DM badges and mention indicators currently attach
  to the sidebar strip; they need a new home on/around the C button.

## V1 loop (adjusted for native-only phase 1)

```
card on board -> assign to mate (or user works it) -> mate instruction
  -> session (worktree where appropriate) -> completion check -> card moves
```

## Completion judgment (decided)

The mate proposes completion and the user confirms; the user can always move
a card manually. No automatic completion in phase 1. A card moved to done by
a mate without confirmation is not allowed.

## Board data model (decided: nedb)

Board state is stored server-side in a nedb datastore (@seald-io/nedb, pure
JS, append-only journal, no native build). Never localStorage.

Proposed initial shape (adjust during implementation):

- One datastore per user, resolved like `resolveMatesRoot` in `mates.js`
  (multi-user: `<CONFIG_DIR>/board/<userId>/board.db`, single-user:
  `<CONFIG_DIR>/board/board.db`, OS-user mode: `/home/<u>/.clay/board/`).
  The home board is user-centric ("my work across projects"), matching the
  later GitHub assignee model. Cards reference a project rather than living
  in one.
- Card schema:

```js
{
  _id,            // nedb id
  title,          // required
  body,           // optional details / instruction seed
  column,         // "todo" | "doing" | "done" (fixed columns in phase 1)
  projectId,      // optional link to a Clay project
  assignee,       // null (user) or mateId
  sessionId,      // set when execution starts
  source,         // "native" (later: "github")
  createdBy,      // "user" | mateId
  pendingDone,    // true while a mate's completion proposal awaits the user
  createdAt, updatedAt, completedAt,
  order           // manual sort within a column
}
```

- Access paths: WS messages for the client board UI, plus a narrow MCP tool
  surface for mates (list/create/update/move — not a generic query console),
  following the same wiring pattern as the removed clay-datastore
  (commit 2658e2f).

Note: this pulls the nedb dependency into phase 1 (for the board). Mate
long-term memory stays deferred but will reuse the same library.

## Known mate defects (pre-existing, not caused by this work)

Recorded here so the hub work does not paper over them; fixing them is not
phase-1 scope unless one blocks the loop. Each entry: Symptom, Cause/Status,
Fix direction, Where.

### 1. Session leak: mate helper queries appear in the project session list

- Symptom: mate background work leaks internal Claude helper queries into the
  project session list as shared TUI sessions the user never created.
  Observed: one digest worker and two incremental memory-summary workers from
  a single Mate interaction.
- Cause: `lib/project-mate-interaction.js` and `lib/project-memory.js` create
  short-lived helper queries via `sdk.createMentionSession()`;
  `lib/sdk-bridge.js` runs them with the project's `cwd`, so transcripts land
  in that project's `~/.claude/projects/<encoded-cwd>/`; the helpers do not
  request `persistSession: false`; on startup `lib/sessions.js` adopts the
  unrecognized transcripts as external Claude CLI sessions.
- Fix direction: run digest, memory-summary, title-generation, and similar
  internal queries with `persistSession: false`; carry an explicit
  ephemeral/persistence option through the yoke query contract and Claude
  adapter (do not filter transcripts by prompt text); keep persistence for
  real user-facing conversations; tombstone already-adopted helper records;
  add regression coverage (internal helpers never adopted, genuine external
  CLI sessions still are).
- Where: `lib/project-mate-interaction.js`, `lib/project-memory.js`,
  `lib/sdk-bridge.js`, `lib/sessions.js`, yoke query contract.

### 2. Mention chat-flow comprehension

- Symptom: a mentioned mate often misreads the flow of the conversation it
  was mentioned into.
- Cause/Status: still open. The 32KB mention context widening (78fb881) and
  delta-based DM digests (466b67d) landed but did not resolve comprehension
  itself.
- Fix direction: not yet designed. Mentions survive this redesign unchanged,
  so the defect carries over as-is.
- Where: `lib/project-mate-interaction.js`.

### 3. AskUserQuestion answer not delivered

- Symptom: the user picks an answer in the UI but the selection is not
  threaded into the model's next turn, so the mate claims it got no answer.
- Cause/Status: observed 2026-06-30, still unfixed, cause not yet diagnosed.
- Fix direction: not yet designed. Priority rises in phase 1 because the
  completion-confirmation flow will likely lean on this tool.
- Where: ask-user flow (`lib/ask-user-mcp-server.js`, answer round-trip).

### 4. AskUserQuestion missing on Codex

- Symptom: Codex-backed mates have no AskUserQuestion tool, so cross-vendor
  mates cannot ask structured questions.
- Cause/Status: tool is Claude-side only; pending task from the sticky board.
- Fix direction: polyfill the tool for Codex. Same phase-1 relevance as
  defect 3 (completion confirmation).
- Where: Codex adapter / yoke tool surface.

### 5. Mate session title generation

- Symptom: current title generation logic produces poor titles for mate
  sessions.
- Cause/Status: pending decision already made — switch to logic variant 2
  (sticky board).
- Fix direction: implement variant 2.
- Where: title generation path (see also SDK `Options.title` note in
  `docs/ongoing/SDK-UPGRADE.md`, which can bypass auto-titling for
  mate-seeded sessions).

## Implementation design (phase 1)

Grounded in a code survey (2026-08-19). Key facts the design builds on:

- The home hub already renders mates (`renderHomeHubMates()` in
  `app-home-hub.js`, fills `#home-hub-mates` from `store.cachedMatesList`,
  currently excludes Clay and archived mates; click already calls
  `openDm(mate.id)`). The left pane is an expansion, not a new build.
- `home-chat.js` (Clay FAB chat, `home_clay_*` WS protocol,
  `server-clay-home.js`) exists but is disabled (markup removed from
  index.html). It is the raw material for an embedded Clay chat later.
- Home hub and DM mode are mutually exclusive today (`showHomeHub()` calls
  `exitDmMode()` and vice versa), and a mate DM swaps the whole WS
  connection to `/p/mate-<id>/ws` (`connectMateProject`). Embedding the DM
  surface inside the home layout is therefore staged, not phase-1 step one.
- Per-user server state lives in `server-*.js` modules attached in
  `server.js` `handleDmMessage`, reached from any project WS via the forward
  list in `project.js` (~line 996). `server-mates.js` is the canonical shape
  (resolve userId from `ws._clayUser` in multi-user, else `"default"`).
- In-process MCP servers are SDK-free modules exporting
  `getToolDefs(handlers)`; mounted in the project.js MCP IIFE with gates
  like `if (isMate)`. Auto-approval must be added in TWO places:
  `checkToolWhitelist` in `sdk-bridge.js` and `CLAY_MANAGED_ALLOW` in
  `claude-hook-installer.js`.
- `ws-schema.js` is documentation only (no runtime validation); new message
  types must be recorded there. c2s = imperative (`board_card_create`),
  s2c = past tense (`board_card_created`).
- `@seald-io/nedb` is not yet a dependency. No kanban code exists anywhere.
- Path correction vs the earlier proposal: `<CONFIG_DIR>/users/<userId>/`
  exists nowhere today. Follow the mates pattern instead
  (`resolveMatesRoot` in `mates.js`: OS-user mode -> `/home/<u>/.clay/...`,
  multi-user -> `CONFIG_DIR/board/<userId>/`, single-user ->
  `CONFIG_DIR/board/`), file `board.db` under that root.

### New server modules

1. `lib/board.js` — storage manager. `createBoardManager(ctx)` resolves the
   per-user board root (mirroring `resolveMatesRoot` modes), opens the nedb
   datastore lazily, and exposes `list`, `create`, `update`, `move`,
   `remove`, `proposeDone`. Enforces invariants in one place: fixed columns
   (`todo`/`doing`/`done`), a move to `done` is only allowed when the actor
   is the user (mates get `pendingDone: true` via `proposeDone` instead),
   `order` maintenance, timestamps. CommonJS, `var`, no arrow functions.
2. `lib/server-board.js` — WS handler, `attachBoard(deps)` following
   `server-mates.js`. c2s: `board_list`, `board_card_create`,
   `board_card_update`, `board_card_move`, `board_card_delete`,
   `board_done_confirm` (accept/reject a pending-done proposal). s2c:
   `board_state` (full list on open), `board_card_created`,
   `board_card_updated`, `board_card_moved`, `board_card_deleted`,
   `board_done_updated` (confirm result; implemented), `board_error`, and
   `board_done_proposed` (pushed when a mate proposes — lands with the MCP
   step, reusing `getBoardManager`). Broadcast to all sockets of that user.
   Wire-up: register in `server.js` `handleDmMessage` chain; add the c2s
   types to the forward list in `project.js`; document all types in
   `ws-schema.js`.
3. `lib/board-mcp-server.js` — `getToolDefs(handlers)` with a narrow
   surface: `board_list_cards`, `board_create_card`, `board_update_card`,
   `board_move_card` (rejects `done`), `board_propose_done`. No delete tool.
   Mounted in the project.js MCP IIFE gated `if (isMate)` (covers Clay and
   all mates; their projects know their user). Auto-approve everything
   except nothing-destructive exists, in both sdk-bridge and
   claude-hook-installer (`mcp__clay-board__*`).
4. `package.json`: add `@seald-io/nedb`.

### Completion flow (implements the decided rule)

Mate calls `board_propose_done` -> card gets `pendingDone: true` ->
`board_done_proposed` pushed to the user -> card shows a confirm affordance
on the board -> user confirms (`board_done_confirm`) which performs the move
to `done` and stamps `completedAt`, or rejects (clears the flag). Server-side
enforcement lives in `board.js` so no client or tool path can bypass it.

### New client module

`lib/public/modules/home-board.js` — renders the kanban into the right pane,
three fixed columns, card create/edit inline, drag between columns (user
moves), pending-done confirm chip. State in `store` (`boardCards`), WS via
`ws-ref.js`, handlers dispatched from `app-messages.js`
(`board_state`, `board_card_*`, `board_done_proposed`). Sends `board_list`
when the hub opens. Under 500 lines; split a `home-board-card.js` renderer
if it grows.

Board WS note: the board talks over whatever project WS is open (messages
are forwarded server-level), so it keeps working when the user is inside a
mate DM connection too.

### Home hub layout rework

`#home-hub` gains a two-pane inner layout: left `.hub-pane-mates`, right
`.hub-pane-board`. Existing hub content (greeting/weather, upcoming, tips,
what's new, projects) compacts into the left pane above/below the mates
list; exact arrangement is an implementation-time call (open question 2).

Left pane changes in `app-home-hub.js`:

- `renderHomeHubMates()` stops excluding Clay: Clay renders first as the
  default mate (every user has it; `builtin-mates.js` already marks it
  `primary`/`hostAgent`). Click behavior stays `openDm(mate.id)`.
- Add the "create mate" entry (moves from the sidebar DM picker).
- Mention indicators (`setMentionActive`) render on the hub mate items and
  aggregate onto the C button (`.icon-strip-home`) as a badge, since the
  strip items disappear.

### DM relocation (staged)

- Stage A (phase 1): entry point only. Mates leave the sidebar strip
  (`renderUserStrip` renders humans only; mate sections drop out of the DM
  picker); all mate DM entry goes through the home left pane. The DM
  surface itself keeps today's mechanics (WS swap via
  `connectMateProject`, `enterDmMode` hiding the hub). C button stays
  `.active` while in a mate DM so the user reads DM as "inside home".
- Stage B (later, not phase 1): embed the conversation surface into the
  home layout (left pane becomes the chat, board stays visible on the
  right). Requires decoupling DM from the full-window mode and possibly
  reviving the `home_clay_*` embedded-chat protocol for all mates.

### Sidebar / mobile / badges

- `sidebar-mates.js`: `renderUserStrip` drops mates (multi-user keeps human
  users + presence). In single-user mode the strip section is empty ->
  hide `#icon-strip-mate-section`. DM badges for mates move to the C button
  aggregate + hub mate items (`updateDmBadge` grows a home-hub target).
- `sidebar-mobile.js`: mate chips in the chip rail stay (they are the
  mobile equivalent of quick access) but their source of truth is unchanged
  (`cachedMatesList`); the mate-profile sheet keeps working. Mobile home
  tab already routes to `showHomeHub()`.

### Build order (each step lands green on its own)

### Roadmap v2 (tool platform, follows principles v2)

A. Tool dock + DM demolition: the right pane becomes a dock hosting N
   tools (board first); remove remaining mate-DM entry points (mobile
   chip rail routing to openDm, DM picker mate section, set_mate_dm
   path for mates) so principle 1 is true in code, not just at home.
B. Tool contract skeleton: manifest format, declarative UI renderer
   (component vocabulary v1) with Clay-native rendering, worker-
   sandboxed logic runtime with state+actions, per-tool scoped nedb
   storage on the server.
C. Universal mate control: tool_snapshot / tool_act / tool_set /
   tool_storage_* MCP tools, Skills attachment from manifests,
   action attribution + human-interaction stream to the mate.
D. Board on the contract — REVISED per principles 8+9: the board becomes
   a real capsule folder (lib/capsules/board/ with manifest + ui.json +
   logic, runtime: "server"). Generalize phase C's board direct path
   into the server-runtime execution path any trusted built-in can use;
   add board/board-card nodes to the renderer vocabulary with
   home-board.js as their reference renderer. Also per principle 9:
   registry becomes a directory scan (drop-in install), scratchpad
   moves from embedded strings to lib/capsules/scratchpad/,
   and built-in capsule folders are seeded into the user's tools root
   on first run (copy, so user data stays in the user's folder).
   This absorbs the old "step 3: board MCP tools".
E. Tool LLM access + authoring flow: `api.llm.complete({system, prompt,
   model?})` in the logic api — host-mediated like storage RPC, gated by
   a manifest `permissions: ["llm"]` declaration, attributed/logged per
   tool. VENDOR-NEUTRAL by construction (2026-08-20): api.llm is a yoke
   consumer, never a vendor SDK consumer — a capsule cannot name a
   vendor. `model` is a capability alias ("fast" | "standard" |
   "deep"), resolved per user to whatever vendor/model their yoke
   adapters and (later) BYOK keys provide. Provider stage 1: one-shot
   queries through the installed yoke adapters (claude/codex/kiro, no
   new config). Stage 2 (later): per-user BYOK key store, server-side
   only, plugging additional providers into the same alias resolution
   so atomic tools get small cheap models without vendor lock. Then the authoring flow: a mate creates
   manifest+logic.js+ui tree in conversation and mounts it into the
   dock — reference demo: an atomic KO<->EN translator with minimal
   context and stored history.

Storage decision (2026-08-20): tool datastores are per-user AND
per-tool files (as shipped in phase B), never a global instance —
structural isolation, OS-user-mode compatibility, bounded nedb memory,
removal = directory delete. A future shared/team scope would be a
manifest-declared `scope: "shared"`, not a global DB.

### Phase C notes

Mate control uses a fixed `clay-tools` MCP surface: list, snapshot, act,
and set. Installed-tool availability and Skills text come directly from
the per-user registry. Snapshot, act, and set for worker-backed tools make
a correlated WebSocket round trip to the user's most recently opened live
home client; that client runs the same worker action used by human controls
and returns canonical state. Requests time out after 15 seconds.

This means worker-backed tools cannot be controlled while the user's home
screen is closed or disconnected. The MCP call returns a clear error in
that case; the server does not simulate browser state. An installed tool
can be started headlessly by the home client when its dock tab is not
mounted.

The native board is included in the same MCP surface but takes a direct
server path, so it remains available without a browser. Board actions call
the board manager with the mate ID as actor: create, update, and move retain
the board invariants, moving to done is rejected, and `proposeDone` is the
mate completion path. Board changes are broadcast with caller attribution.

### Phase D notes

Capsules are directory-scanned from each user's tools root. On the first
scan, Clay copies the repo capsules from `lib/capsules/` behind a versioned
marker; after that, deleting a copied folder remains an uninstall. A valid
folder contains `manifest.json` and `ui.json`, plus `logic.js` for the
default `runtime: "worker"`. Invalid folders stay visible in `tools_state`
as `{ id, error }` entries instead of disappearing silently.
Capsule storage also lives in that directory as `data.db`; the board moves
there with a read-through migration from its legacy board datastore path.

`runtime: "server"` is reserved for shipped built-ins and cannot be
installed through the WebSocket installer. Server capsules resolve through
the fixed adapter map in `capsules-server-logic.js`; no folder supplies
server JavaScript. The board adapter calls `board.js` with the mate ID as
actor and exposes `create`, `update`, `move`, and `propose_done`. Worker
capsules retain the Phase C browser round trip.

The board dock entry now comes from `lib/capsules/board/manifest.json` and
its `{ type: "board" }` UI tree. `tool-renderer.js` delegates the `board`
and `board-card` vocabulary nodes to `home-board.js`, which remains the
reference renderer and keeps the existing `board_*` live-update and drag
paths.

The home mate header exposes only read-only Memory and Knowledge viewers,
plus Debate. Debate closes Home and opens the existing debate wizard in the
current project session with the selected home mate as moderator; this keeps
the established setup/start flow and makes the resulting debate visible.
Sticky Notes, Scheduled Tasks, MCP Servers, and Skills have no home utility.

### Phase E notes

Worker capsules may declare `permissions: ["llm"]` and call
`api.llm.complete({ system?, prompt, model? })`. The model value is a
capability alias only (`fast`, `standard`, or `deep`, defaulting to `fast`);
the worker host and server both enforce the manifest permission, and the
server rejects every other model value. LLM actions have a 90-second worker
action budget, and mate control uses the same 90-second budget instead of
Phase C's normal 15-second browser-control limit. Each completion uses a
correlated 60-second RPC from worker to browser host to `server-tools.js`,
and server logs include the capsule ID and caller ID.

The server resolves the user's first installed YOKE adapter with
`resolveDefaultVendor` and performs a direct one-shot adapter query outside
the project session manager. It passes `skipProjectInstructions: true` and
`skipSkills: true`, so an atomic capsule sees only its fixed system prompt
and input. Claude maps
fast/standard/deep to haiku/sonnet/opus and receives
`persistSession: false` through both in-process and OS-user worker paths.
Codex maps to gpt-5.4-mini/gpt-5.6-terra/gpt-5.6-sol. Antigravity maps to
flash/default/pro. Other adapters select a matching small or strong model
from their advertised catalog, with the adapter default for standard.

Leak risk: Claude's no-session-persistence option prevents these calls from
writing `~/.claude/projects` transcripts, so they cannot become the helper
sessions described in Known mate defects §1. Non-Claude YOKE adapters do not
currently expose a common persistence-disable primitive. They still bypass
Clay's session manager and therefore do not enter Clay's project session
list, but their underlying CLI/provider may retain its own ephemeral thread
metadata. That residual provider-local retention is the remaining risk.

The `clay-tools` MCP server now also exposes `clay_tool_install` and
`clay_tool_uninstall`. Neither is auto-approved in the SDK whitelist or the
managed Claude hook list. The install description is self-contained: it
defines manifest fields and permissions, the complete UI vocabulary,
dot-path bindings and `$item.*` templates, the worker `var tool` action
contract, storage and LLM APIs, caller attribution, and the no-DOM/no-import
constraints. Installs still use the registry's validation and worker-only
runtime rule, then broadcast `tool_installed` so an open dock adds the tab
without reload.

`lib/capsules/translator/` is the reference LLM capsule. It declares the
LLM permission, translates Korean and English with a minimal fixed prompt,
and persists latest-first history through scoped capsule storage. Existing
Phase D users receive only this new built-in during the v2 seed migration,
so previously deleted board or scratchpad folders remain deleted.

### Build order phase 1 (original, superseded by roadmap v2 above)

1. Server storage + WS: nedb dep, `board.js`, `server-board.js`, forward
   list, ws-schema docs, unit tests for `board.js` invariants (columns,
   pendingDone rule, per-user isolation). — DONE 2026-08-19 (uncommitted;
   7 tests in test/board.test.js).
2. Client board: `home-board.js`, right pane inside `#home-hub`,
   app-messages routing, store keys.
3. MCP tools: `board-mcp-server.js`, project.js mount, both allow-lists,
   a short "your board tools" paragraph in the Clay template
   (`builtin-mates.js` prose pattern) and mate system sections
   (`mates-prompts.js`).
4. Home layout + mate relocation: two-pane hub, Clay in the mates list,
   strip removal, C-button badge aggregation, mobile follow-up.
   — DONE 2026-08-19. Deviation: the DM picker (behind the sidebar `+`)
   still lists mates, because it also owns delete-mate and re-add-builtin.
   Mates are out of the icon strip, which is the visible change; folding
   those two actions into the home pane is follow-up work.
5. Completion confirm UI + end-to-end pass of the loop: create card ->
   assign mate -> mate works -> propose done -> confirm -> done column.

Step 4 is the only user-visible breaking change; 1-3 can merge silently
behind it.

## Open questions

1. How a mate is given a card: explicit "assign" action on the card, or
   conversational ("do this one") from the left pane, or both. (Build order
   step 5 needs this answered; leaning both — an assign action that opens
   the DM with an instruction seed.)
2. What happens to the existing home hub content (weather, tips, what's new,
   project grid) in the two-pane layout. (Implementation-time call, left
   pane compaction proposed above.)

## Decisions log

- 2026-08-19: Mates move from the user list to the C button (home). Home
  becomes the work hub.
- 2026-08-19: Home screen splits: mates left, kanban right. Clay becomes the
  default mate for everyone.
- 2026-08-19: Phase 1 is native board items only; GitHub sync and long-term
  memory are explicitly deferred.
- 2026-08-19: Completion = mate proposes, user confirms (manual move always
  allowed). Board storage = nedb, user-centric datastore, fixed
  todo/doing/done columns in phase 1.
- Earlier (via 에코): positioning locked as "self-hosted agent workspace with
  task memory for team deployment"; external dependencies limited to GitHub
  only; bootstrap path (solo developer), avoid high-maintenance choices.
- Long-term memory direction (deferred but decided): @seald-io/nedb over
  sqlite/native builds; narrow memory tool surface (save/recall/update/
  forget) instead of a generic SQL console.
