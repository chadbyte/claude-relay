# Client-Side _ctx Elimination Roadmap

> Goal: Every client module imports dependencies directly (ES module imports + store). No more context object injection.

---

## What is done

| Commit | What |
|--------|------|
| `6bdae2a` | store.js created, 75 state properties migrated, _msgStateProps deleted |
| `e976687` | _msgCtx (273 lines) deleted from app.js, 30 getter/setter wrappers removed, ws-ref.js created, dmTargetUser/dmKey/basePath/wsPath moved to store |

app-messages.js is now fully independent: 46 direct imports, zero _ctx.

---

## What remains

20 modules still use `var _ctx = null` + `initXxx(ctx)` pattern. Total: ~733 `_ctx.` references.

### Tier 1: 100% convertible (0 unknowns)

These can be converted with zero design decisions. Pure mechanical replacement.

| Module | _ctx refs | What they use |
|--------|-----------|---------------|
| app-panels.js | 2 | ws |
| app-misc.js | 2 | ws |
| app-skills-install.js | 1 | basePath |
| app-loop-wizard.js | 3 | ws, store setter |
| app-debate-ui.js | 5 | ws, DOM, functions |
| app-notifications.js | 6 | ws, store getters |
| app-loop-ui.js | 7 | ws, basePath, functions |
| app-rate-limit.js | 10 | ws, store, functions |

**8 modules, ~36 refs total.** One PR.

### Tier 2: Nearly convertible (1-3 unknowns)

A few refs need minor moves: export a function, define a constant locally, add a property to store.

| Module | refs | unknowns | solution |
|--------|------|----------|----------|
| app-cursors.js | 4 | `registerTooltip` | import from tooltips.js |
| app-favicon.js | 12 | `getStatusDot` | define locally (3-line DOM query) |
| app-home-hub.js | 15 | `cachedProjects` | import getCachedProjects from app-projects.js |
| app-dm.js | 51 | `cachedProjects`, `dmMessageCache` | import getCachedProjects; move dmMessageCache to store or app-dm.js |
| app-header.js | 32 | `headerInfoBtn`, `loadingMore`, `onSessionSearchHistoryPrepended` | headerInfoBtn is DOM; loadingMore to store; callback stays as param |
| sidebar-sessions.js | 13 | `multiUser`, `permissions`, `dismissOverlayPanels` | multiUser/permissions to store; dismissOverlayPanels to shared module |
| sidebar-projects.js | 14 | `permissions`, `projectOwnerId`, `multiUser` | same as sidebar-sessions |
| sidebar-mobile.js | 11 | `onFilesTabOpen`, `projectList`, `dismissOverlayPanels` | projectList from app-projects; onFilesTabOpen/dismissOverlayPanels to shared |

**8 modules, ~152 refs total.** One or two PRs.

### Tier 3: Complex (4+ unknowns)

Need callback extraction or shared module creation.

| Module | refs | unknowns |
|--------|------|----------|
| app-connection.js | 19 | `getStatusDot`, `startVerbCycle`, `stopVerbCycle`, `onConnected` |
| app-projects.js | 83 | `getStatusDot`, `closeSearch`, `setLoadingMore`, `newMsgBtn` |
| sidebar-mates.js | 8 | `onDmRemoveUser`, `sendWs`, `projectList`, `availableBuiltins` |
| app-rendering.js | 29 | `newMsgBtn`, `newMsgBtnActivity`, `newMsgBtnDefault`, `CLAUDE_CODE_AVATAR`, `closeToolGroup` |

**4 modules, ~139 refs total.**

Key blockers:
- `onConnected` in app-connection.js is a large callback (~50 lines) that orchestrates many modules on WS connect. Needs to either move into app-connection.js or be split.
- `startVerbCycle` / `stopVerbCycle` are animation functions defined in app.js. Move to app-favicon.js or a new app-status-animation.js.
- `newMsgBtn` and variants are DOM elements created dynamically by app.js. Move creation to app-rendering.js.
- `closeToolGroup` is exported from tools.js but wasn't picked up by the scanner (re-export or naming issue).

---

## Shared infrastructure to create

These items unblock multiple Tier 2/3 modules:

| Item | Unblocks | Approach |
|------|----------|----------|
| `dismissOverlayPanels` | sidebar-mobile, sidebar-sessions | Export from sidebar.js or new overlay-utils.js |
| `permissions` / `multiUser` | sidebar-sessions, sidebar-projects | Add to store (server sends on connect) |
| `loadingMore` | app-header, app-projects | Add to store |
| `cachedProjects` / `getCachedProjects` | app-dm, app-home-hub, sidebar-mates, sidebar-mobile | Already exported from app-projects.js, just import |
| `getStatusDot` | app-connection, app-favicon, app-projects | Define locally (3-line DOM query) or export from app-favicon.js |

---

## Execution order

1. **Tier 1** (8 modules, ~36 refs) - pure mechanical, one sitting
2. **Shared infra** (store additions + small exports) - unlocks Tier 2
3. **Tier 2** (8 modules, ~152 refs) - mostly mechanical after infra
4. **Tier 3** (4 modules, ~139 refs) - needs callback extraction
5. **Cleanup** - remove dead wrapper functions from app.js, update STATE_CONVENTIONS.md

After all tiers: app.js shrinks by ~500+ lines, every module is self-contained, and the only remaining `initXxx(ctx)` calls are for the 2-3 modules with genuine orchestration callbacks that can't be decoupled without event buses.

---

## Verification per module

Before marking a module done:
1. `var _ctx = null` and `export function initXxx` are deleted (or initXxx takes 0-3 callback params instead of a ctx bag)
2. No `_ctx.` references remain
3. `node --check` passes
4. Feature works after hard refresh

