# Client-Side _ctx Elimination Roadmap

> Goal: Every client module imports dependencies directly (ES module imports + store). No more context object injection.

---

## What is done

| Commit | What |
|--------|------|
| `6bdae2a` | store.js created, 75 state properties migrated, _msgStateProps deleted |
| `e976687` | _msgCtx (273 lines) deleted from app.js, 30 getter/setter wrappers removed, ws-ref.js created, dmTargetUser/dmKey/basePath/wsPath moved to store |
| Tier 1 batch | app-panels.js, app-misc.js, app-skills-install.js, app-loop-wizard.js, app-debate-ui.js, app-notifications.js, app-loop-ui.js, app-rate-limit.js (8 modules, ~36 refs eliminated) |

app-messages.js is now fully independent: 46 direct imports, zero _ctx.

---

## What remains (2026-04-17 rescan)

12 modules still use `var _ctx = null` + `initXxx(ctx)` pattern. Total: **~694 `_ctx.` references**.
Plus 1 stray ref in skills.js (uses `_ctx.basePath` without the full pattern).

> Note: ref counts grew significantly since the original roadmap because new features (DM enhancements, home hub, sidebar overhaul, mates, rendering) were built using the existing _ctx pattern.

### Tier 2: Nearly convertible (1-3 unknowns)

All refs are ws/store/DOM/existing exports, with a few needing minor moves.

| Module | refs | unknowns | solution |
|--------|------|----------|----------|
| skills.js | 1 | (none) | replace `_ctx.basePath` with store import; no init pattern to remove |
| app-cursors.js | 13 | `registerTooltip`, `isMultiUserMode` | import from tooltips.js; isMultiUserMode to store |
| app-favicon.js | 23 | `getStatusDot`, `getActivityEl` | define locally or export from shared; getActivityEl to store/DOM |
| app-home-hub.js | 44 | `cachedProjects`, `cachedMatesList` | import from app-projects.js / sidebar-mates.js |
| sidebar-sessions.js | 71 | `dismissOverlayPanels`, `permissions`, `multiUser`, `getUpcomingSchedules` | dismissOverlayPanels to shared; permissions/multiUser to store; getUpcomingSchedules import from scheduler |
| sidebar-projects.js | 76 | `permissions`, `projectOwnerId`, `multiUser`, `hideIconTooltip`, `showIconTooltip`, `getCurrentDmUserId` | permissions/multiUser/projectOwnerId to store; tooltip funcs import from tooltips; getCurrentDmUserId from app-dm.js |
| sidebar-mobile.js | 38 | `dismissOverlayPanels`, `onFilesTabOpen`, `switchProject`, `requestKnowledgeList` | dismissOverlayPanels to shared; others import from respective modules |

**7 modules, ~266 refs total.**

### Tier 3: Complex (4+ unknowns, callbacks, orchestration)

Need callback extraction, shared module creation, or significant refactoring.

| Module | refs | top properties (count) | unknowns |
|--------|------|----------------------|----------|
| app-connection.js | 28 | getWs(2), setProcessing(3), setSendBtnMode(2), setConnected(2), blinkIO(2), connectOverlay(2) | `onConnected` callback (~50 lines), `isNotifAlertEnabled`, `blinkIO`, `connectOverlay` |
| sidebar-mates.js | 36 | sendWs(16), openDm(6), spawnDustParticles(4), closeProjectCtxMenu(4) | `sendWs` (16 refs, needs ws-ref import), `spawnDustParticles`, `closeProjectCtxMenu`, `openMateWizard`, `availableBuiltins` |
| app-header.js | 67 | messagesEl(10), headerTitleEl(7), historyFrom(5), headerRenameBtn(5), loadingMore(4), cliSessionId(4), activeSessionId(4) | `setTurnCounter`, `setPrependAnchor`, `setCurrentMsgEl`, `setCurrentFullText`, `setActivityEl` (all setter callbacks from app.js) |
| app-rendering.js | 70 | iconHtml(7), suggestionChipsEl(6), messagesEl(6), refreshIcons(5), newMsgBtn(4), getWs(4), getDmTargetUser(4), escapeHtml(4) | `newMsgBtn` (dynamic DOM), `CLAUDE_CODE_AVATAR`, `setPendingTermCommand`, `copyToClipboard`, `closeToolGroup` |
| app-projects.js | 113 | getWs(31), currentSlug(9), showToast(5), myUserId(5), cachedAllUsers(5) | `showToast`, `renderUserStrip`, `getHeaderContextEl`, many callback setters; largest module |
| app-dm.js | 126 | ws(18), dmTargetUser(10), savedMainSlug(8), inputEl(8), myUserId(7), mateProjectSlug(6), dmMode(6) | `syncResizeHandles`, `savedMainSlug` management, complex callback chains between DM and main session |

**6 modules, ~440 refs total.**

Key blockers (updated):
- `onConnected` in app-connection.js is a large callback (~50 lines) that orchestrates many modules on WS connect. Needs to either move into app-connection.js or be split.
- `sendWs` in sidebar-mates.js (16 refs) is just a ws wrapper. Replace with direct ws-ref.js import.
- `newMsgBtn` and variants are DOM elements created dynamically by app.js. Move creation to app-rendering.js or a shared DOM-refs module.
- app-dm.js (126 refs) is now the heaviest module. DM features grew significantly, adding _ctx refs for `syncResizeHandles`, `savedMainSlug`, `mateProjectSlug`.
- app-projects.js (113 refs) has the widest spread of _ctx properties (~49 unique). Many are callbacks injected from app.js that set UI state.
- app-header.js (67 refs) has many setter callbacks (`setTurnCounter`, `setPrependAnchor`, etc.) that couple it tightly to app.js state.

---

## Shared infrastructure to create

These items unblock multiple Tier 2/3 modules:

| Item | Unblocks | Approach |
|------|----------|----------|
| `dismissOverlayPanels` | sidebar-mobile, sidebar-sessions | Export from sidebar.js or new overlay-utils.js |
| `permissions` / `multiUser` / `projectOwnerId` | sidebar-sessions, sidebar-projects | Add to store (server sends on connect) |
| `loadingMore` / `historyFrom` / `activeSessionId` | app-header, app-projects | Add to store |
| `cachedProjects` / `getCachedProjects` | app-dm, app-home-hub, sidebar-mates, sidebar-mobile | Already exported from app-projects.js, just import |
| `getStatusDot` / `getActivityEl` | app-connection, app-favicon, app-projects | Define locally (DOM query) or export from app-favicon.js |
| `messagesEl` / `inputEl` / `sendBtn` | app-rendering, app-header, app-dm, app-favicon | DOM refs module or store; used by 4+ modules |
| `showToast` / `showConfirm` | app-projects, sidebar-sessions | Export from dialog/toast module |
| `escapeHtml` / `renderMarkdown` / `highlightCodeBlocks` | app-rendering, app-home-hub | Export from render-utils or existing util module |
| `showIconTooltip` / `hideIconTooltip` / `registerTooltip` | sidebar-projects, app-cursors | Export from tooltips.js |
| `cachedAllUsers` / `cachedOnlineIds` / `cachedMatesList` | app-projects, app-dm, app-rendering, app-home-hub | Export getters from respective cache-owning modules |
| Setter callbacks (`setTurnCounter`, `setPrependAnchor`, `setCurrentMsgEl`, etc.) | app-header, app-rendering | Move state to store with get/set, or create an app-state-bridge.js |

---

## Execution order

1. ~~**Tier 1** (8 modules, ~36 refs) - DONE~~
2. **Stray fix**: skills.js (1 ref, trivial)
3. **Shared infra** (store additions + small exports) - unlocks Tier 2
4. **Tier 2** (7 modules, ~266 refs) - mostly mechanical after infra
5. **Tier 3** (6 modules, ~440 refs) - needs callback extraction, start with sidebar-mates (smallest)
6. **Cleanup** - remove dead wrapper functions from app.js, update STATE_CONVENTIONS.md

Recommended Tier 3 attack order (smallest to largest, easiest blockers first):
1. sidebar-mates.js (36 refs) - `sendWs` is just ws-ref
2. app-connection.js (28 refs) - extract `onConnected`
3. app-header.js (67 refs) - setter callbacks to store
4. app-rendering.js (70 refs) - newMsgBtn + DOM refs
5. app-projects.js (113 refs) - widest spread, do after shared infra solidifies
6. app-dm.js (126 refs) - largest, most coupled, do last

---

## Verification per module

Before marking a module done:
1. `var _ctx = null` and `export function initXxx` are deleted (or initXxx takes 0-3 callback params instead of a ctx bag)
2. No `_ctx.` references remain
3. `node --check` passes
4. Feature works after hard refresh
