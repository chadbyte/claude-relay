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

## Home spatial model v3 (locked 2026-08-20, via design rounds with Codex)

Governing idea: home contains people and intentions; projects and tools
appear only when deliberately invited in. Home must feel like ChatGPT /
Claude — a calm place you live in, not a dashboard you visit.

1. Home is the app's ROOT, not a mode. `/` opens home; new users land
   on home with Clay selected. Project deep links (`/p/<slug>/`) keep
   working. The C button navigates to home; browser back returns.
2. On home, ALL project chrome disappears: icon strip, sidebar, title
   bar, centered search. A quiet home bar replaces it: Clay symbol
   (identity, not a button), a Projects button (calm chooser: resume
   last, recents as text rows, search, new), and search/notifications/
   account on the right. Cmd+K works everywhere. ESC never leaves home
   (it only closes modals/overlays); the X/ESC close affordance dies.
   **Correction (2026-08-20): the home bar is retired.** Home shows only
   conversation and the dock. Tools lives in the conversation-local header;
   The local minimize control returns to the current project without tearing
   down home; clicking Clay Home restores the exact suspended surface. Cmd+K,
   browser Back, and mobile tabs remain available.
3. Mate color is REMOVED from the design language entirely. No colored
   rings/badges/buttons/accents anywhere. Avatar color is contained
   identity only; long-term the generated-avatar palette itself goes
   muted at the source (no CSS saturation filters — they damage custom
   avatars).
4. The mate rail is replaced by a selected-mate control (avatar + name
   + presence + chevron) atop the conversation; clicking opens a
   switcher popover (rows: avatar, name, one-line bio, presence,
   unread; New mate at the bottom). One colorful avatar on the resting
   screen, not a launcher row.
5. Chat is the stage. Two-voice renderer (home only; human DMs keep
   dm-render.js): assistant = plain text on the canvas, no bubble/
   avatar/name; user = soft neutral right-aligned bubble; timestamps on
   hover. Centered transcript max ~720px; floating pill composer.
6. First-open gimmick: with an empty conversation, the greeting and a
   small composer sit CENTERED in the stage (name + short line derived
   from the bio + 2-3 muted suggestion chips); after the first message
   the composer docks to the column bottom and the suggestions vanish.
7. The dock is a collapsible work surface with three states, remembered
   server-side (open/closed, width, active tool): conversation (chat
   fills the stage; a quiet Tools control in its local header), split
   (right workbench, draggable divider, tool-sized width ~clamp(520px,
   46vw, 760px)), and tool focus (tool takes the stage, "return to
   conversation" restores). First run = conversation state. Suggestion
   chips like "add a card" open the dock to the right tool.
8. Flattening rule: one visible edge per level. No outer dock card —
   a single divider separates conversation and workbench; board columns
   are whitespace-separated with cards as the only raised surfaces;
   dock tabs are icon+text with one understated active indicator.
9. Collapsed dock shows one neutral Tools/last-tool button with a
   subtle activity dot on hidden changes; mate actions never force the
   dock open (a quiet "updated Board · View" notice is acceptable).

**Spatial correction (2026-08-30): the flat split is retired.** The
conversation remains Home's underlying stage. When invited, the dock is an
inset, raised Workbench window using the same spatial language as Clay's
terminal and document viewer: a quiet border, restrained radius, layered
shadow, its own header, and an invisible left-edge resize target. On wide
screens the conversation may reserve enough right inset to remain readable,
but Home must never look like a rigid two-column grid. Intermediate screens
use an inset overlay; mobile uses a full-screen capsule subview. Tool focus
keeps the window identity and a clear return to conversation. This correction
supersedes item 8's no-outer-card rule for the Workbench only; the board itself
still follows the flat-column, raised-card rule.

## Home experience masterplan v4 (locked 2026-08-30)

Home is Clay Studio's end-user experience, not a launcher for the coding
client. Project mode hosts coding agents such as Claude Code and Codex; Home
is where a user maintains relationships with Mates, continues conversations,
and invites Capsules into the conversation when work needs a tangible surface.

### Product model and ownership

- **Mate**: a persistent identity and relationship with its own Knowledge and
  Memory boundary. A Mate is closer to a durable collaborator than a folder.
- **Conversation**: one resumable thread with a Mate. Conversations belong to
  their Mate and form the temporal history shown in Home.
- **Capsule**: a deterministic or accumulating capability shared by the user
  and every Mate. Capsules and their data belong to the user, never to one
  Mate.
- **Workbench**: the floating window in which a Capsule becomes visible and
  operable. Conversation is the source; the Workbench is invited from it.
- **Project mode**: a separate developer surface. Leaving Home for a project
  hides rather than tears down the mounted Home surface whenever possible.

The governing sentence is: **Conversation is the home. The sidebar remembers
where the user has been. The Workbench appears only when conversation needs a
place for work to become tangible.**

### Spatial responsibilities

Home has three intentionally unequal regions:

1. **Sidebar — navigation through relationships and time.** A flat,
   approximately 240px frame contains New conversation, one Capsules entry,
   the current Mate, four to six recent conversations, All conversations, and
   a collapse control. It does not display session metadata, capsule lists,
   counts, or multiple nested groups. Collapsing removes the frame completely
   so the conversation recenters; it does not leave an icon rail.
2. **Conversation — the primary stage.** The two-voice transcript and composer
   remain the visual center. Mate switching and New conversation move to the
   sidebar, leaving only genuinely local conversation actions in the stage.
3. **Workbench — an invited floating window.** Capsules open in a raised,
   inset window above the conversation canvas. Its tabs, focus, close, size,
   active capsule, and internal capsule state resume independently of the
   conversation.

Knowledge and Memory are deliberately absent from the sidebar's permanent
navigation. They are Mate-owned backstage concepts available from the current
Mate's overflow/settings. When a management surface is needed it may open in
the Workbench, but neither concept is promoted to a first-class Home destination.

### Sidebar information architecture

The resting order is deliberately short:

```
Clay                                      Collapse

New conversation
Capsules                                  Activity when hidden

MATE
Current Mate                              Overflow

RECENT
Conversation
Conversation
Conversation
Conversation

All conversations
```

Recent rows show only a title and, when genuinely processing, a small activity
dot. All conversations opens a calm searchable sheet rather than expanding the
sidebar. Selecting a row restores that exact Mate and session. The current Mate
row opens the existing Mate switcher; its overflow owns Knowledge, Memory, and
Mate settings.

### Workbench states and responsive behavior

1. **Conversation:** the Workbench is closed and the transcript is centered in
   the available stage.
2. **Workbench open:** the last Capsule resumes, or Capsule Library appears
   when none has been active. On desktop the window floats at the right and the
   conversation shifts only enough to preserve reading width. It remains
   resizable through an invisible, accessible left-edge target.
3. **Capsule focus:** the Workbench occupies most of the stage while retaining
   an inset window silhouette and an explicit Return to conversation action.

At intermediate widths the Workbench becomes an inset overlay with a backdrop.
On mobile it becomes a full-screen subview instead of stacking beneath chat.
The existing mobile tab bar remains global navigation. A hidden Capsule change
marks the sidebar Capsules row but never forces the Workbench open.

### Persistence contract

The existing server-side dock preference remains responsible for
`{ dockOpen, dockWidth, activeToolId }`. A separate user-scoped Home surface
preference will remember `{ activeMateId, activeSessionByMate,
sidebarCollapsed }`. Same-tab minimize/resume continues to preserve the
mounted DOM, draft, scroll, stream, and current Capsule exactly. Reload and
cross-device restoration recover durable selections and Capsule data from the
server; no Home preference may use localStorage.

### Home experience — execution stages and status

Stage 1 — conversation experience (spec items 3, 4, 5, 6 + header
simplification): mate-color purge on home, avatar rail -> selected-mate
switcher popover, two-voice renderer (dm-render.js stays human-DM only),
cohesive pill composer, centered empty-state greeting + composer that
docks after the first message, utilities under one labeled overflow
menu, chat panel box removed. — DONE 2026-08-20, commit 3407ef8,
tests 454/454. Visual QA by Chad pending.

Stage 2 — home shell + root (spec items 1, 2): `/` opens home, project
chrome (icon strip, sidebar, title bar, centered search) hidden on
home, quiet home bar (Clay identity, Projects chooser, search/
notifications/account), ESC semantics, C button navigates home,
deep links unchanged. — DONE 2026-08-29. Added reversible `body.home-active`
chrome suppression, a Projects chooser (resume, filtering, activity state,
and New project), and root/popstate restoration between `/` and project routes.
The root shell keeps the last accessible project connected in the background,
the home bar reuses the live notification and user-account controls, and search
opens the existing command palette. The mobile tab bar remains available.

Stage 3 — dock three states (spec items 7, 9): conversation / split
(draggable divider, tool-sized width) / tool focus; state remembered
server-side; collapsed dock = one Tools button with activity dot;
suggestion chips open the dock to the right tool. — DONE 2026-08-29.
The conversation now owns the full stage by default. Opening Tools reveals a
flat right workbench with icon-and-text tabs, one divider, constrained pointer
and keyboard resizing, and a full-stage focus state with an explicit return.
The server stores `{ dockOpen, dockWidth, activeToolId }` per user over the
project WebSocket preference path. Hidden board/tool changes mark the Tools
control without opening it. Wide screens split, intermediate screens use a
dismissible 65vw overlay, and mobile stacks the tool below the conversation.
The board suggestion opens Board before preserving its existing message send.

Stage 3.5 — home-local order: the replacement home bar and its Projects
chooser were removed. Home now contains only the full-height conversation and
the optional dock; Tools moved to the far right of the conversation's local
header with its last-tool label and hidden-activity dot intact. Cmd+K remains a
global shortcut and lists projects through the root page's accessible-project
background connection; Back and mobile tabs remain the other project-return
paths. A later refinement added a quiet local minimize button: it returns to
the current project while leaving the conversation DOM, draft, scroll, stream,
and dock state mounted, and Clay Home resumes that suspended point. — DONE
2026-08-20.

Stage 4 — floating Workbench: replace the Stage 3 flat dock/divider appearance
with the inset terminal/document-viewer window language while preserving the
three-state controller and server-side dock preference. Desktop gets a floating
resizable window and readable conversation re-centering; intermediate screens
get an inset overlay; mobile gets a full-screen capsule subview. Remove dead
flat-split styling and retain accessible resize/focus/return behavior. — DONE
2026-08-30. The Workbench now shares Clay's 12px inset-window silhouette,
border, layered shadow, and restrained entrance motion. Its left-edge resize
target is invisible at rest and reveals only a subtle interaction cue. Tablet
uses an inset overlay and mobile replaces the former stacked layout with a
full-stage Capsule surface above the persistent tab bar.

Stage 5 — conversation foundation: add user-filtered Mate session list and
explicit session-open protocol paths; add the user-scoped Home surface
preference; restore the last Mate and exact active session per Mate after a
reload without regressing same-tab mounted resume. The session protocol must
ship before recent conversations become visible. — DONE 2026-08-30. Added
`home_mate_sessions_list` / `home_mate_sessions_state` and explicit
`home_mate_session_open` paths with strict per-user ownership filtering. Home
now stores `{ activeMateId, activeSessionByMate, sidebarCollapsed }` separately
from the dock preference, using durable CLI session IDs when available and a
temporary local reference only for unsent blank conversations. Reload restores
the preferred Mate and that Mate's exact conversation; a stale reference falls
back safely to the most recent owned conversation. Minimize/project return
still resumes the already-mounted Home DOM without reopening or resetting its
draft, scroll, stream, or Workbench. Focused Stage 5 protocol, preference, and
restoration tests pass; client import resolution and changed-file syntax audits
also pass.

Stage 6 — minimal Home sidebar: add the flat 232–248px frame with New
conversation, Capsules, current Mate/switcher, four to six recent conversations,
All conversations, and complete collapse. Move duplicate Mate/New chat actions
out of the conversation header. Knowledge and Memory remain under Mate
overflow/settings. — DONE 2026-08-30. Added a flat 240px sidebar (232px at
compact desktop widths), five title-only recent conversations from the Stage 5
session protocol, and a calm searchable custom All conversations sheet. Recent
and sheet selections restore the exact Mate and session. Full collapse removes
the frame and persists `sidebarCollapsed` through the server-side Home surface
preference; narrow layouts use an overlay drawer. Capsules remains a Stage 7
placeholder/activity target. Focused Home tests pass (34/34); all 115 client
module imports resolve, targeted syntax audits pass, and touched JavaScript
modules remain under 500 lines. No full suite was run.

Stage 7 — Capsule Library and navigation: make the sidebar Capsules entry resume
the last active Capsule or open a native Capsule Library in the Workbench; move
the hidden-activity signal to that entry; preserve tool tabs, suggestion-driven
opening, shared installed-tool state, and user-owned Capsule storage. — DONE
2026-08-30. The enabled sidebar entry resumes the last installed active Capsule
or opens an ephemeral native Library host view when no Capsule is active. The
Library reads the shared `installedTools` state, keeps the Workbench's Capsule
tabs and controls intact, and activates real registered Capsules without
inventing a persisted Library tool ID. Hidden Capsule activity now appears only
on the sidebar entry. Existing responsive Workbench states, suggestion-driven
opening, runtime and user-scoped storage paths, and the server preference
`{ dockOpen, dockWidth, activeToolId }` remain unchanged. Focused Stage 7 tests
pass (51/51); all 116 client module imports resolve and targeted syntax audits
pass. No full suite was run.

Stage 8 — Mate backstage: make Knowledge, Memory, and Mate management coherent
secondary surfaces reached from the current Mate overflow and rendered in the
Workbench when appropriate. They must not become permanent sidebar destinations.
— DONE 2026-08-30. Memory, Knowledge, and Mate settings now open as ephemeral
backstage views inside the existing Workbench. Memory and Knowledge retain the
owned, read-only Home protocols; settings reuses the existing profile edit and
custom-confirmed remove/delete flows. The Capsule tabs and mounted runtime remain
available behind the backstage view, while its lifecycle state never becomes an
`activeToolId` or changes the saved Capsule preference. Returning restores focus
to an immediately captured underlying Library or active Capsule target, without
waiting for a dock-preference echo. Escape returns from a topmost backstage view
without consuming dialog/menu Escape or changing focused-Workbench behavior;
closing the Workbench restores a visible Home control. Late responses update
only the backstage body so they neither cross Mate/section boundaries nor
discard keyboard focus. Debate keeps its existing Home-to-debate transition.
Narrow layouts use the full-screen Workbench and persistently close the sidebar
drawer. Focused Stage 8 and adjacent Home tests pass (61/61); all 118 client
module imports resolve, targeted syntax audits pass, and the Stage 8 surface and
extracted client modules remain under 500 lines. No full suite was run.

Stage 9 — visual QA and remaining polish: finish board card/column polish,
generate the muted avatar palette at the source, and verify keyboard/focus/ESC,
popstate, suspend/resume, tablet/mobile layouts, import resolution, and full
test coverage. — DONE 2026-08-30. Board columns are flat drafting lanes with
raised, keyboard-focusable cards, accessible list/region semantics, explicit
control labels, reduced-motion handling, and server-confirmed Alt+Arrow focus
restoration. Narrow board hosts use container-driven 190px lanes with
horizontal scrolling and proximity snapping; mobile retains 280px peek lanes.
Generated Mate marks use a muted six-color palette in their SVG source;
matching built-in definitions carry those colors, while custom avatar images
remain unfiltered and unchanged. Browser QA used the real Home client and
modules with mock Home state because the live daemon required authentication.
Desktop 1440x1000 verified expanded and collapsed navigation plus the floating
board. Intermediate 1024x820 exposed the compressed-lane defect and then
verified the fixed container-driven 190px scroll/snap lanes. Mobile 390x844
verified the hidden sidebar, full-screen Workbench, 280px peek lanes, sidebar
overlay, and conversation layout. Interaction checks verified composer Escape
focus restoration, server-confirmed Alt+Arrow card focus restoration with a
mock connected WebSocket, All conversations open/Escape, and exact draft DOM
and value preservation across same-tab hide/show. Focused Stage 9, adjacent
Home, avatar, and board protocol tests pass (79/79); all 118 client module
imports resolve, targeted syntax audits pass, and changed client modules remain
under 500 lines. The required final Node v22.22.1 `npm test` passed 516/516 with
zero failures.

Working agreement: the dev server serves this worktree live, so during
a stage the UI can look half-built; judge visuals only at stage-commit
checkpoints (hard refresh).

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

`lib/public/modules/home-board.js` — renders the kanban in the tool workbench,
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

This early fixed-pane proposal was superseded by spatial model v3: conversation
owns the stage by default, while tools open in the collapsible right workbench.
The older greeting/weather/project-dashboard composition is no longer planned.

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
