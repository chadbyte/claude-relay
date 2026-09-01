# Capsule Creation Entry Points (Handoff)

Status: phase 1 implemented; conversion actions and Capsule menu work remain
Date: 2026-09-02
Baseline: `0382fb7 feat(capsules)!: remove scratchpad and translator`

## Product correction

Capsule creation is a capability of every Mate, not a special capability of
the builtin Clay Mate. Product copy and routing must therefore use **Mate**,
or the selected Mate's display name, rather than hard-coding "with Clay".

The primary Workbench action should read **Create with Mate** when no specific
Mate is being named. When a selected Mate is visible and authoritative, it may
read **Create with <Mate name>**. The builtin Clay Mate follows exactly the
same path as every other Mate.

## Explicitly out of scope

- Do **not** implement Studio Pulse in this task.
- Do not add another sample, demo, or replacement built-in Capsule.
- Do not restore Scratchpad or Translator. They were removed in `0382fb7`.
- Do not restore Board. It was removed with the Capsule Home transition.
- Do not add deterministic keyword or language matching for user intent.
- Do not give Capsule ownership to a Mate. Capsules remain user-owned and are
  shared with all of that user's Mates.
- Do not bypass the existing install/update permission boundary.
- Do not use a global active session or silently switch the user's selected
  Mate or conversation.

## Goal

Make Capsule creation discoverable from the Workbench and from useful
conversation/search output, while preserving the current safe declarative
Capsule contract. Every Mate must be able to create, customize, and suggest a
Capsule through the same server-owned tools and permission policy.

## Required experience

### 1. Workbench library starts with creation

The Capsule Library is the Workbench's first screen when no valid last Capsule
is being resumed. Its strongest action is a creation composer:

- Label or heading: **Create with Mate**.
- Input placeholder: **Describe the interface you need**.
- Do not show example prompts in the empty state.
- Installed Capsules remain available below the creation control.
- When no Capsules are installed, the creation control is the empty state; do
  not add a separate "No Capsules are installed" dead end.
- Submitting must continue through a real Mate conversation so the user can
  inspect, refine, and approve the Capsule. It must not install from browser
  text alone.

The target is the currently selected Home Mate. If that exact Mate is absent,
archived, or stale, stop with inline feedback instead of switching to another
Mate. Resolve that identity from server-restored Mate state, not from the
entered language.

### 2. Convert useful output into a Capsule conversation

Add a quiet secondary action labeled **Turn this into a Capsule** to:

- completed Mate answers in Home;
- completed builtin Clay answers inside the global search chat drawer; and
- deterministic global-search conversation results where there is concrete
  result context to carry forward.

The action starts or continues an exact Mate conversation with bounded context
from the selected answer/result. It must not copy an entire source transcript,
leak another user's content, or directly install anything. The resulting
message should explain that the user wants a durable interface based on the
selected material and preserve the source session reference when one exists.

For a Home answer, use that conversation's Mate. For a deterministic search
result, use the currently selected Home Mate, with the normal builtin Clay
fallback only when selection is absent or invalid.

### 3. Capsule overflow actions

The Capsule action menu must contain, in this order:

1. **Customize with Mate**
2. **Duplicate**
3. **View source**

`Customize with Mate` opens an exact Mate conversation about the mounted
Capsule. A worker Capsule still requires the user's existing **Allow Mate
editing** permission before source or update tools can be used. The menu action
must not silently grant that permission. For a trusted server Capsule, the
conversation may propose a separate user-owned Capsule but cannot mutate or
clone trusted server code as a worker.

`Duplicate` is deterministic and user-initiated. It must create a distinct
user-owned worker Capsule with a collision-safe ID and copied manifest/UI/logic,
but no copied per-Capsule user data unless a later product decision explicitly
adds that choice. Trusted server Capsules cannot be duplicated by copying their
runtime; return a clear inline/toast error or route to customization as a new
worker Capsule. Do not use a native dialog.

`View source` retains the existing inspector behavior.

### 4. Every Mate may suggest creation

The system prompt attached by `project-capsule-catalog.js` must teach every
Mate that it may briefly suggest a Capsule when conversation reveals a truly
reusable interface or recurring workflow. This contract must be present even
when the user has no installed Capsules; the current implementation returns an
empty prompt in that case and therefore cannot teach creation.

Suggestion policy:

- Suggest only from semantic conversation context as judged by the Mate.
- Strong signals include an explicitly recurring workflow, a repeated
  transformation, accumulating structured state, or the user's desire to keep
  seeing/using the same view.
- Do not use deterministic keyword, regex, locale, or phrase matching.
- Do not interrupt an unrelated answer or suggest a Capsule for one-off work.
- Make at most one concise suggestion after providing the useful answer.
- Present it as optional and use the user-facing phrase **Turn this into a
  Capsule**.
- All custom Mates and the builtin Clay Mate receive the same capability.

Creation and update remain approval-based through the existing
`clay_tool_install` / `clay_tool_update` tools. A suggestion alone performs no
mutation.

## Existing architecture to preserve

- `lib/public/modules/home-dock.js` owns Workbench/library routing and restores
  a valid last active Capsule.
- `lib/public/modules/home-capsule-library.js` renders the current library and
  is the correct home for the create-first visual hierarchy.
- `lib/public/modules/home-mate-chat.js` owns exact Home Mate/session state and
  message submission. Creation entry points must reuse or deliberately extend
  this path rather than inventing a second Home session transport.
- `lib/public/modules/search-clay-chat.js` owns the compact global-search chat
  and expands into the exact Home conversation.
- `lib/public/modules/command-palette.js` owns deterministic global-search
  results and their session identities.
- `lib/public/modules/home-capsule-source.js` owns the mounted Capsule overflow
  and source inspector.
- `lib/project-capsule-catalog.js` is the bounded, server-generated discovery
  prompt for all Mate sessions.
- `lib/tool-control-mcp-server.js` exposes install/update/source controls to
  Mates. Do not add Mate-specific variants.
- `lib/server-tools.js` and `lib/tools-registry.js` own user-scoped Capsule
  mutation and filesystem validation.
- `lib/tool-ui-spec.js` remains the canonical declarative UI boundary. No
  arbitrary HTML, CSS, JavaScript, SVG, browser storage, or executable content
  may enter through creation or duplication.

Avoid a client dependency cycle between `home-dock.js` and
`home-mate-chat.js`. Prefer a small cohesive creation-intent module or a
callback injected at an existing composition point. Do not introduce the
forbidden `initXxx(ctx)` pattern or a hidden global active-session fallback.

## Server and identity requirements

- Resolve user ownership from the authenticated WebSocket/server context.
- Resolve the selected Mate from durable Home state; reject stale/foreign Mate
  IDs and use the established fallback behavior.
- Correlate asynchronous creation/customization requests so reconnects and
  stale responses cannot target another conversation.
- A UI proposal or suggestion causes zero Capsule mutation.
- Duplicate is idempotent per request ID and must not create two copies when a
  client retries after reconnect.
- Broadcast successful install/duplicate updates through the existing
  `tool_installed` path so every open surface and Mate catalog refreshes.
- Do not copy source transcript history into a new conversation. Pass only the
  bounded selected answer/result plus its durable source reference where
  available.

## Visual direction

Follow the existing Clay Studio Workbench language: restrained, native, and
conversation-led. The creation composer is the only dominant element on the
library screen. Installed Capsule rows are quieter inventory below it. Avoid
sample-card grids, colorful feature tiles, oversized marketing copy, gradients,
or a dashboard treatment.

The new answer/result affordance should be visible after completion without
competing with the message. It must have a clear focus state, work by keyboard,
and not disturb transcript scroll or IME composition.

## Likely implementation slices

1. Add a Mate-neutral Capsule creation-intent contract and exact Home
   conversation handoff.
2. Rework `home-capsule-library.js` and its CSS around the creation composer.
3. Add the conversion action to Home Mate answers, search-chat answers, and
   deterministic result rows.
4. Add overflow actions and a correlated duplicate operation.
5. Make the Mate Capsule prompt exist with or without installed Capsules and
   add the semantic suggestion policy.
6. Update module-map documentation and focused tests.

Keep cohesive client and server modules below 500 lines. In particular,
`home-mate-chat.js` is already 498 lines, so any meaningful new behavior must
be extracted rather than appended inline.

## Acceptance criteria

- Opening the Workbench with no resumable Capsule shows **Create with Mate**
  and an input whose placeholder is **Describe the interface you need**.
- Submitting the input opens the exact selected Mate conversation with the
  request intact and does not install a Capsule before approval.
- A custom Mate can create and suggest Capsules exactly as the builtin Clay
  Mate can.
- Completed Home Mate answers and completed search-chat answers expose **Turn
  this into a Capsule** once, without affecting streaming layout.
- Deterministic search results can be carried into a Capsule creation
  conversation without losing the exact source session reference.
- The mounted Capsule menu contains Customize with Mate, Duplicate, and View
  source in the required order.
- Worker duplication creates one distinct Capsule, copies no data, validates
  the full safe contract, survives reconnect retry without duplication, and
  refreshes all user surfaces.
- Trusted server runtime code is never converted into an untrusted worker by
  direct duplication.
- A Mate with zero installed Capsules still knows when and how to make a
  restrained creation suggestion.
- No deterministic natural-language intent matching is added.
- Studio Pulse, Scratchpad, and Translator are absent.

## Focused verification

Add or update executable tests for:

- Workbench create-first empty and populated states;
- exact selected custom Mate routing with no implicit fallback;
- zero mutation before approval;
- answer/search conversion action rendering and exact context/reference;
- duplicate ownership, validation, collision naming, request idempotency,
  reconnect retry, no data copy, and server-runtime rejection;
- overflow keyboard navigation and action order;
- prompt behavior with zero and multiple installed Capsules, including the
  all-Mate semantic suggestion policy;
- Home transcript scroll/focus and Korean IME stability;
- tool registry broadcasts and catalog refresh.

Run the focused Capsule/Home/search/registry/MCP tests, client import audit,
JavaScript syntax checks, module-size audit, forbidden `const`/`let`/arrow and
native-dialog checks, and `git diff --check`. Do not run the full suite,
restart daemons, touch live user state, or commit unless explicitly requested.
