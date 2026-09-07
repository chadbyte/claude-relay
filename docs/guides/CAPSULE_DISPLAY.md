# Capsule Display: the floor element and the rich element

A Capsule is Logic, Skills, and Display (LSD), and the three carry different
obligations. Logic is the deterministic source of truth: every state change
goes through a Logic function, and randomness, validation, and rule
enforcement live server-side over the Capsule's own datastore
(`lib/tool-storage.js`). Skills teach an AI to use Logic through the
clay-tools MCP surface. Display is the human's execution surface over the
same Logic; no agent ever reads it.

Three commitments bind the layers:

1. **One door.** A human button click and a Mate `clay_tool_act` call invoke
   the same Logic function through the same pipeline
   (`controlServerCapsule` in `lib/server-tools.js`). There is no agent-only
   path and no UI-only path.
2. **The Mate never sees Display.** Agents receive `snapshot`, a state
   projection, never a UI tree or a display bundle.
3. **The human never needs the Mate.** If the AI disappears, every Capsule
   remains fully operable by hand.

## Display is a set of elements

### The floor element (mandatory)

Every Capsule ships a declarative UI tree (`ui.json`) in the bounded
vocabulary of `lib/tool-ui-spec.js`. It renders wherever Clay renders, gets
host theming and validation-time accessibility, and is the surface the human
can always stand on.

Two gates enforce it (`lib/capsule-display-floor.js`), and both validate the
actual tree rather than any stored claim about it:

- **Registration refuses** a Capsule whose Display set lacks a valid floor
  (`installTool` / `updateTool` in `lib/tools-registry.js`).
- **Skills go dark when the floor does.** A Capsule whose floor is missing or
  invalid drops out of the Mate catalog
  (`lib/project-capsule-catalog.js`), out of `clay_tool_list`
  (`lib/project.js`), and out of `controlForMate`, at the same moment the
  human loses it. The gate fails closed.

### The rich element (opt-in, additive)

A Capsule opts in by shipping a `display.js` next to its floor, the same way
`logic.js` opts into the worker runtime. The rich element is free rendering
(canvas, WebGL) with zero authority: it can be swapped in or out without any
Mate-visible change, and the frame-server tests assert exactly that.

Isolation (`lib/capsule-frame-server.js` + client
`lib/public/modules/home-tool-frame.js`):

- Served by a dedicated listener on its own port, so the frame is a distinct
  origin from the app; embedded with `sandbox="allow-scripts"` and never
  `allow-same-origin`, so the frame's origin is opaque and the host DOM,
  cookies, and storage are unreachable.
- Frame URLs are short-lived one-time tokens minted over the authenticated
  WebSocket (`tool_frame_url`), which is what binds the anonymous frame
  origin to one user's tools root.
- The frame document's CSP is `default-src 'none'` with a per-response
  script nonce and no `connect-src` at all: the frame cannot fetch, beacon,
  or open sockets, so a rich element ships self-contained.
- The only channel is `postMessage`. The host validates every message and
  routes act requests into the same pipeline as floor buttons; the frame
  receives state projections and causal events, nothing else.
- The floor never depends on the frame. If the frame fails to load or go
  ready, the host falls back to the floor silently, and a toggle keeps the
  floor a click away while the frame is up.

Inside the frame, `display.js` talks to `window.ClayCapsule`:

```js
ClayCapsule.onState = function (state) { /* full projection */ };
ClayCapsule.onEvent = function (event) { /* {seq, actor, action, previous, next} */ };
ClayCapsule.act("roll", {});
```

## Live feedback: the event contract

Because both parties call identical Logic, a Display that reflects Logic
activity in real time reads as the Mate operating the interface. The
contract that makes this work:

- **Push, not poll.** Every successful act broadcasts a `tool_server_event`
  to all of the acting user's connected clients, whoever acted.
- **Causality in the payload.** The event is
  `{seq, actor, action, previous, next}` where `previous`/`next` are
  projections built inside the Logic lock, so a Display can animate and
  attribute the transition instead of teleporting state.
- **Ordered stream.** `eventSeq` is a persisted monotonic counter that
  increments by exactly one per act and never resets, including across a
  game reset. Clients ignore anything at or below the last rendered seq, so
  a slow snapshot response can never roll a Display back.
- **Display must not create meaning absent from state.** Attribution and
  animation restate fields the projection already publishes; anything a
  Display invents on its own is something the Mate is blind to.

## The engagement loop: making the Mate actually play

A two-seat Capsule needs the Mate to take its turns without the user leaving
the board. When the Mate should be engaged is a game rule, so the Capsule's
Logic declares it on the causal event: `event.engage = {kind: "turn"}` asks
the Mate to read the state and act, `{kind: "start"}` asks it to acknowledge
a fresh game without acting. The host bridge (`lib/capsule-mate-turn.js`)
knows no game: it delivers any declared engagement exactly once per event,
and only for human-caused events, so a Mate can never wake itself. The
opponent is the Mate that last acted on this Capsule for this user; before
any Mate has acted, the built-in host Mate takes the seat, so a fresh game is
playable with zero setup. An explicit "start" additionally pushes
`capsule_game_session` to the user's clients, and the home board navigates
into the Mate's game session, so starting a game visibly opens the table.

Delivery goes through `deliverCapsuleTurn` on the Mate's project context
(`lib/project-capsule-turn.js`): one persistent session hosts the whole game
(found again via `session.capsuleGame.toolId`), the turn prompt is recorded as
an internal user message, and the Mate then reads the game over
`clay_tool_snapshot` and plays through `clay_tool_act` like always. The nudge
carries words only; it grants no authority, and a lost nudge costs a reminder,
never the game. Mate acts push `tool_server_event` back to the user's Display,
so the user watches the Mate's moves land live.

## Writing a server-runtime Capsule

Use `lib/capsule-pig-logic.js` (push-your-luck dice) as the reference:

- Seats are resolved server-side (`seatFor`) from the actor the pipeline
  sets; never from caller-supplied text.
- `act(context, actionId, args)` returns `{state, event}`; `snapshot`
  returns the projection. Both run under a per-game `runExclusive` lock so
  concurrent acts across runtime instances serialize.
- Normalize stored state defensively on every read; a stored document is
  data, not a promise about shape.
- Register the runtime in `lib/capsule-server-runtimes.js`; only shipped
  Capsules under `lib/capsules/` may claim the server runtime.
- Tests: see `test/capsule-pig.test.js`,
  `test/capsule-display-floor.test.js`, `test/capsule-frame-server.test.js`.
