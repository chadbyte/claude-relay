# Session Context (2026-04-18)

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

---

## Part 2: YOKE Merge (completed)

Merged the `yoke` branch (16 commits) into main. Resolved 13 file conflicts.

### Merge commit
```
49ebc2c feat(yoke): merge YOKE adapter abstraction layer
```

---

## Part 3: Codex Adapter Fixes (completed)

### Commits
```
60ec23d feat(yoke): add Codex adapter fixes, cross-vendor instruction injection, and vendor UI
```

### What was fixed
- **flattenEvent item.completed handling**: `codex exec --json` only emits `item.completed` (no `item.started`/`item.updated`). Fixed all item type handlers to emit start events on first encounter, using dedup state (`textBlocks`, `toolBlocks`, `thinkingBlocks`).
- **skipGitRepoCheck**: Added `skipGitRepoCheck: true` to thread options (Codex CLI rejects untrusted directories).
- **Cross-vendor instruction injection**: Created `lib/yoke/instructions.js` that scans for CLAUDE.md, AGENTS.md, .cursorrules, etc. and merges them. YOKE's `wrapCreateQuery` injects into `systemPrompt` for all adapters, excluding vendor-native files.
- **Codex systemPrompt**: Codex adapter receives systemPrompt and prepends to first message (no native system prompt concept in `codex exec`).

---

## Part 4: Multi-Vendor Architecture (completed)

### Commits
```
8b37ce2 feat(yoke): add multi-vendor adapter map, vendor toggle UI, and per-session vendor binding
72246c4 feat(yoke): add vendor-specific config panel, fix model switching, and polish UI
```

### Architecture
- **Auth detection**: `yoke.checkAuth()` runs `claude auth status` and `codex login status`. Result cached globally (singleton).
- **Adapter map**: `yoke.createAdapters()` creates adapters for all authenticated vendors. Shared across all projects (singleton).
- **Per-session vendor**: Sessions have a `vendor` field. `sdk-bridge.startQuery()` selects adapter via `adapters[session.vendor]`.
- **Lazy init**: `yoke.lazyCreateAdapter()` re-checks auth for vendors that weren't available at startup.

### Vendor toggle UI
- Split toggle (`[Claude | Codex]`) in input bottom bar
- Accent color highlight for active vendor
- Hides after first message, shows locked vendor icon instead
- Disabled vendors show login toast on click (feature discovery)
- `session_switched` carries `vendor` and `hasHistory` for proper toggle state

### Config panel (vendor-specific)
- **Claude**: MODEL, MODE, EFFORT (low~max), THINKING, BETA
- **Codex**: MODEL, EFFORT (minimal~xhigh), APPROVAL, SANDBOX, WEB SEARCH
- Sections show/hide based on `currentVendor`
- Model list supports both object array (Claude) and string array (Codex)

### Vendor model switching
- `get_vendor_models` WS message fetches vendor-specific model list from `sm.modelsByVendor`
- `startQuery` auto-selects vendor's default model if current model doesn't belong to session vendor

---

## Part 5: Mate Vendor Support (completed)

### Commits
```
108708a feat(mates): add per-mate vendor selection and vendor badge on strip
10907a6 feat(mates): persist vendor, vendor badges in mention menu, and UI polish
```

### Per-mate vendor
- Mate objects have `vendor` field, saved via `mate_update` (persisted in JSON)
- Mate sidebar header has split pill vendor toggle
- Vendor badge (bottom-right of avatar) on mate strip and mention menu
- Processing dot moved to top-left on mate strip
- `server-dm.js` includes `vendor` in `targetUser` for DM history (persists across refresh)
- New sessions in DM mode fall back to mate's default vendor

### UI polish
- Ask Mate button: icon-only teal `@`, removed rainbow gradient
- Mention menu: vendor badges on avatars, close button, sticky hint, lighter shadow
- Config chip: model name only (removed mode/effort from label)

---

## Known Limitations

### Codex MCP support
Codex adapter's `createToolServer` returns null. Codex runs as a separate process (`codex exec`), so it cannot access Clay's in-process MCP tools (email, browser, debate). Options to investigate:
1. Expose Clay MCP tools as standalone server for Codex CLI to connect
2. Pre-fetch MCP-dependent context as text injection (email context sources already do this)
3. Accept limitation and document which features are Claude-only

### Codex streaming
`codex exec --json` only emits `item.completed` events (no streaming deltas). Text appears all at once after the turn completes, not incrementally. This is a SDK/CLI limitation.

### Session cross-vendor resume
Cannot resume a Claude session with Codex or vice versa. Sessions are vendor-locked. Different session storage formats (`~/.claude/sessions` vs `~/.codex/sessions`).

---

## File Map

### New files
- `lib/yoke/instructions.js` - Cross-vendor instruction scanner/merger
- `lib/public/codex-avatar.png` - Codex vendor icon

### Key modified files
| File | Changes |
|------|---------|
| `lib/yoke/index.js` | checkAuth, createAdapters (singleton), lazyCreateAdapter, wrapCreateQuery |
| `lib/yoke/adapters/codex.js` | flattenEvent fixes, skipGitRepoCheck, systemPrompt, webSearchMode |
| `lib/project.js` | Multi-adapter map, defaultVendor, sm.availableVendors, get_vendor_models handler |
| `lib/sdk-bridge.js` | Per-session adapter selection, vendor-specific model fallback, warmup all adapters |
| `lib/sessions.js` | vendor field on sessions, vendor in session_switched and session_list |
| `lib/project-sessions.js` | Codex config handlers (approval, sandbox, webSearch), vendor on new_session |
| `lib/project-connection.js` | Active session vendor on connect |
| `lib/project-user-message.js` | Vendor binding on first message |
| `lib/server-dm.js` | vendor in dm_history targetUser |
| `lib/public/modules/app-panels.js` | Vendor toggle, vendor-specific config sections, EFFORT_LEVELS_BY_VENDOR |
| `lib/public/modules/app-rendering.js` | VENDOR_AVATARS/VENDOR_NAMES, vendor-aware avatar/name/placeholder |
| `lib/public/modules/app-messages.js` | availableVendors, currentVendor, vendor on session_switched |
| `lib/public/modules/input.js` | Vendor in message payload, hide toggle on send |
| `lib/public/modules/mate-sidebar.js` | Vendor toggle in mate header |
| `lib/public/modules/sidebar-mates.js` | Vendor badge on mate strip |
| `lib/public/modules/mention.js` | Vendor badge on mention avatars, close button |
| `lib/public/css/input.css` | Vendor toggle styles, Ask Mate teal icon |
| `lib/public/css/mates.css` | Mate header vendor toggle styles |
| `lib/public/css/icon-strip.css` | Vendor badge, processing dot top-left |
| `lib/public/css/mention.css` | Vendor badge, close button, hint sticky |
