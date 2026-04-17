# Session Context (2026-04-17)

> Summary of the full session's work for handoff to a new session.

---

## Part 1: CTX Elimination (completed)

Eliminated the `var _ctx = null` / `initXxx(ctx)` context-bag pattern from ALL 20 client modules.

### Commits (in order)
```
afa754d docs(client): add store.js dependency guide and update ctx elimination roadmap
b246d75 refactor(client): eliminate _ctx from skills.js and prepare shared infra
ed501aa refactor(client): eliminate _ctx from all Tier 2 modules
7e6cddd refactor(client): eliminate _ctx from all Tier 3 modules
0c37fd7 refactor(store): add concise get/snap/set API and migrate all modules
51881ad refactor(client): add store.subscribe for connected/processing UI sync
568aa88 refactor(client): add store.subscribe for dmMode CSS class sync
f6c3657 refactor(client): add store.subscribe for loop button and config chip
b10f8df refactor(client): add subscribers for user strip, ralph bars, context
7ddac57 fix(ui): remove undefined dismissOnboarding call in sticky-notes
b4a56eb fix(ui): remove orphan closing brace in sidebar-mates mate context menu
dbdb567 docs: move CTX-ELIMINATION-ROADMAP to completed
61ebc28 docs: add NO-GOD-OBJECTS architectural guide
```

### Key artifacts created
- `docs/guides/CLIENT_MODULE_DEPS.md` - store.js pattern onboarding
- `docs/guides/NO-GOD-OBJECTS.md` - architectural rules
- `lib/public/modules/dom-refs.js` - shared DOM element access
- `lib/public/modules/store.js` - added `get()`, `snap()`, `set()` shorthand API

### Store subscribe conversions (7 subscribers, 43 manual calls removed)
| Subscriber | Location | Watches |
|-----------|----------|---------|
| status dot, sendBtn, overlay, logo | app-connection.js | connected, processing |
| dm-mode CSS classes | app-dm.js | dmMode |
| updateLoopButton | app-loop-ui.js | loopActive, ralphPhase, loopIteration, loopMaxIterations |
| updateRalphBars | app-loop-ui.js | ralphPhase, ralphCraftingSessionId, ralphCraftingSource, activeSessionId |
| updateConfigChip | app-panels.js | currentModel, currentMode, currentEffort, currentBetas, currentThinking |
| renderUserStrip | sidebar-mates.js | 8 cache keys (cachedMatesList, cachedAllUsers, etc.) |
| richContextUsage | app-panels.js | richContextUsage |

---

## Part 2: YOKE Merge (completed)

Merged the `yoke` branch (16 commits) into main. Resolved 13 file conflicts.

### Merge commit
```
49ebc2c feat(yoke): merge YOKE adapter abstraction layer
```

### What yoke adds
- `lib/yoke/` directory (6 files, 3,378 lines)
  - `index.js` - createAdapter(vendor) factory
  - `interface.js` - Adapter / QueryHandle contract
  - `adapters/claude.js` - Claude adapter (1,418 lines)
  - `adapters/claude-worker.js` - Claude worker process
  - `adapters/codex.js` - Codex adapter (602 lines)
  - `adapters/gemini.js` - Gemini adapter (668 lines)
- `sdk-bridge.js` delegates to adapter instead of calling Claude SDK directly
- `docs/roadmaps/in-progress/yoke/` - 6 roadmap documents

### Conflict resolution strategy
- Client-side: no conflicts (ctx elimination was client-only, yoke was server-only)
- Server-side: accepted yoke's adapter delegation, preserved main's feature additions (email, notifications, MCP bridge)
- Docs: kept main's directory structure, moved yoke docs to `docs/roadmaps/in-progress/yoke/`

---

## Part 3: Codex Testing (in progress)

### Current state
- `lib/project.js:163` set to `vendor: "codex"` (temporary, for testing)
- Model list updated to current Codex models (gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2)
- First test: `o4-mini` failed (not supported on ChatGPT Pro). Fixed to `gpt-5.4`.
- Second error: `Reading prompt from stdin...` - likely message format issue in `runStreamed()` call
- NOT YET COMMITTED (testing changes only)

### Files modified for testing (uncommitted)
- `lib/project.js` - vendor changed to "codex"
- `lib/yoke/adapters/codex.js` - model list updated

### Next: debug the stdin error
See CODEX-INTEGRATION.md for full details and investigation plan.

---

## Worktree

`/Users/chad/projects/clay-yoke` worktree exists on the `yoke` branch. Can be removed now that yoke is merged:
```bash
git worktree remove ../clay-yoke
```
