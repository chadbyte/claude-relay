# Single-user → multi-user absorption

Goal: remove the separate **single-user runtime**. Every deploy runs in the
(general) **multi-user** model; a solo user is just a one-user multi-user
deploy with an auto-provisioned default admin and no login wall. **OS-user
isolation (`config.osUsers`) is orthogonal** and untouched by this work.

Guiding principle: **migrate-then-flip** — safety nets and data migration land
before the default flips, so existing deploys upgrade with zero manual steps.

---

## Done (this branch)

| Phase | Commit | What |
|-------|--------|------|
| 1 | `3878977` | Solo auto-login safety net. `getMultiUserFromReq()` falls back to `users.getSoloNoPinUser()` (exactly one user, no PIN) so every HTTP/WS auth gate is satisfied with no login wall. Inert until multi-user. |
| 2 | `8fd50b8` | `lib/migrate-single-user.js` — boot migration of a legacy single-user deploy: carry PIN hash (same PIN still logs in), profile.json, settings (chatLayout, autoContinueOnRateLimit, matesEnabled, terminalFont, deletedBuiltinKeys, mateOnboardingShown), move flat mates → `mates/<userId>/`, backfill ownerId on legacy sessions, flip `multiUser=true`. Backups + idempotent (config marker) + best-effort per step; no-op on fresh/already-multi. |
| 3 | `58bdae0` | Drop the "Just me / Multiple users" setup prompt; every install is multi-user. Boot calls `ensureMultiUser()`: migrate legacy, or provision a default no-PIN admin on fresh installs. All `mode` fallbacks flipped `"single"` → `"multi"`. |

Net effect: `isMultiUser()` is effectively always `true` at runtime, and there
is always ≥1 user. Single-user code paths are now **dead** (present but never
executed).

### Verified (isolated `CLAY_HOME` harness — real `~/.clay` untouched)
- Legacy single-user **with PIN** → migrates; the original PIN authenticates, wrong PIN rejected; profile/settings/session-ownerId/mates all carried; backups + marker written; second run idempotent.
- Legacy single-user **no PIN** → migrates; `pinHash=null` → solo auto-login resolves.
- **Fresh** install → `ensureMultiUser()` provisions a default no-PIN admin; idempotent.

Repro:
```
CLAY_HOME=/tmp/clay-migtest/home node /tmp/clay-migtest/run.js   # (harness, recreate as needed)
```
Full E2E (still isolated): boot the daemon against a throwaway home/port:
```
CLAY_HOME=/tmp/clay-e2e CLAY_PORT=2699 node bin/cli.js
```

---

## Remaining — cleanup (dead-code removal; do incrementally WITH runtime testing)

These are safe to defer: the branches are already dead. Value is
maintainability, not behavior. **Do not sweep all 109 branches blindly** —
some single-user branches contain details the multi-user branch lacks (see the
avatar caveat). Remove per-file, runtime-testing each area.

### Phase 4 — collapse the settings dual path (`dc` daemon-config → user record)
Single-user stored settings in `daemon.json`; multi-user stores them per user.
Now that a user always exists, drop the daemon-config path.
- `lib/server-settings.js`:
  - GET `/api/profile` (~L16-75): remove the `else` single-user branch (L37-64) and the `if (users.isMultiUser())` wrapper; always use the `mu` (user-record) path. **Caveat:** the single-user branch has custom-avatar-file logic (L65-74) the `mu` branch lacks — preserve it in the unified path.
  - PUT `/api/profile` + the per-setting writes (~L392, L417, L442, L467, L492, L517): remove the `onGetDaemonConfig`/`onSetDaemonConfig` (`dc`) write paths; always write the user record.
- `lib/daemon.js`: `onGetDaemonConfig`/`onSetDaemonConfig` handlers (~L702-783) become unused for these keys once the daemon-config settings path is gone — remove the settings keys from the daemon-config surface.
- Migration keeps the old daemon-config keys on disk (harmless); a later step can strip them.

### Phase 5 — collapse `!isMultiUser` branches (server, then client)
~109 sites across 27 files (recon map). Categories:
- **AUTH** — `server-auth.js` `getAuthPage`/`isRequestAuthed`, `server.js` ws gate (~L924-974). `isRequestAuthed`/`getAuthPage` can drop the single-user (`pinPage`/daemon-token) branch.
- **SESSION/OWNERSHIP** — `sessions.js` (~L411-419 `getVisibleSessions`, L464 ownerId assign, L773 `_isMySession`), `server.js` notification targeting. Legacy `!s.ownerId` handling can stay as a compat read.
- **UI** — client `app.js` (~L820-839 `/api/me`), `sidebar-projects.js`, `sidebar-sessions.js`, `project-settings.js`, `app-cursors.js`, `app-messages.js` — remove `isMultiUserMode` gates (always on).
- **DM/MATES** — `server-dm.js` (userId `"default"` fallback), `mates.js` `buildMateCtx`/`resolveMatesRoot` (flat path branch).
- **ADMIN** — `server-admin.js` endpoints already require multi-user; no change needed.

### Phase 6 — remove the flag + dead code
- `users-auth.js` `enableMultiUser`/`disableMultiUser`, `data.multiUser` flag, `isMultiUser()` (make it a constant `true` or remove callers), `defaultData().multiUser`.
- CLI: `disableMultiUser` menu item, single-user status labels (`bin/cli.js` ~L2124), any remaining `mode === "single"` handling.
- Strip migrated settings keys from daemon config.

---

## Watch-outs
- **Solo → real multi-user transition:** the default admin has no PIN. If an operator adds a second user (settings), `getSoloNoPinUser()` stops matching and login is required — but the admin has no PIN and would be locked out. The add-user / enable-auth flow must force the admin to set a PIN first. (Follow-up; not handled yet.)
- **OS mode** stays orthogonal — don't fold it into these phases.
- Migration keeps backups (`*.pre-migrate-<ts>.bak`) and a config marker (`singleUserMigratedAt`); safe to re-run.
