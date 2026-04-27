# Project Rules

> **PHASE A — AMoS deferred.** Sessions do code work directly in this project. **No AMoS dispatch. No intent-payload handoff.** The agentic-program end-state contract (PROGRAM.md §1, PATTERN.md §4–§10) describes the destination, not today's operational mode. If you're tempted to hand work to AMoS, stop and execute it in-session. Tracked: project-agents lr-3129.

- Use `var` instead of `const`/`let`. No arrow functions.
- Server-side: CommonJS (`require`). Client-side: ES modules (`import`).
- Never commit, create PRs, merge, or comment on issues automatically. Only do these when explicitly asked.
- All user-facing messages, code comments, and commit messages must be in English only.
- Commit messages must follow Angular Commit Convention (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `perf:`, `test:`, `style:`, `ci:`, `build:`). Use `!` or `BREAKING CHANGE:` footer for breaking changes. Always use the `angular-commit` skill when committing.
- Never use browser-native `alert()`, `confirm()`, or `prompt()`. Always use custom JS dialogs/modals instead.
- When rebuilding daemon config (e.g. `restartDaemonFromConfig()`), always use `Object.assign({}, lastConfig, overrides)` to preserve all existing settings. Never reconstruct config by manually listing fields.
- Before adding new code, read [docs/guides/MODULE_MAP.md](docs/guides/MODULE_MAP.md) to find the right file. Never add inline logic to `project.js` handleMessage. Keep modules under 500 lines.
- Never use `localStorage` for user settings or preferences. All settings must be stored server-side (via WebSocket messages or REST API) so they persist across devices and browsers.
- Client modules (`lib/public/modules/`): state goes in store.js (zustand-like), WS via ws-ref.js, functions via direct import. Never use `var _ctx = null` / `initXxx(ctx)`. See [docs/guides/CLIENT_MODULE_DEPS.md](docs/guides/CLIENT_MODULE_DEPS.md).
- **NEVER bring Clay down without an immediate restart in the same command.** The current Claude session is hosted by `clay.service` (`/usr/lib/node_modules/clay-server/lib/daemon.js`). Any command that stops, restarts, reinstalls, or replaces clay-server kills this session — and Andy can't always reach a workstation to bring it back. ALWAYS chain the restart into the same shell invocation so systemd or the script handles recovery without human intervention. Examples:
  - ✅ `npm install -g clay-server && systemctl restart clay`
  - ✅ `npm link && systemctl restart clay`
  - ✅ `systemctl restart clay` (single atomic op — `Restart=on-failure` covers crashes)
  - ❌ `npm install -g clay-server` alone (leaves daemon on stale code, may crash)
  - ❌ `systemctl stop clay` (no follow-up start)
  - ❌ `kill <clay-pid>` (no follow-up)
  Prefer `systemctl restart clay` over stop+start. If you must do multiple steps, use `&&` chaining so a failure aborts before the daemon is taken down. When in doubt, ask before running.
