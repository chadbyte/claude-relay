# Clay Refactoring Roadmap

> Goal: Transform the codebase so humans can quickly understand structure, trace errors to their source, and maintain each part independently.
> All coding is done by AI. Each step below is one PR. Items are ordered by structural impact.

---

## Progress

| Status | Meaning |
|--------|---------|
| done | Merged to dev-2-23 |
| **next** | **The next PR to work on** |
| pending | Not started |

**Last completed**: PR-14 (2026-04-10)
**Next up**: PR-15

| PR | Status | Description | Date |
|----|--------|-------------|------|
| PR-01 | done | Extract `project-debate.js` from `project.js` | 2026-04-04 |
| PR-02 | done | Extract `project-memory.js` from `project.js` | 2026-04-10 |
| PR-03 | done | Extract `project-mate-interaction.js` from `project.js` | 2026-04-10 |
| PR-04 | done | Extract `project-loop.js` from `project.js` | 2026-04-10 |
| PR-05 | done | Extract `project-file-watch.js` from `project.js` | 2026-04-10 |
| PR-06 | done | Extract `project-http.js` from `project.js` | 2026-04-10 |
| PR-07 | done | Extract `project-image.js` from `project.js` | 2026-04-10 |
| PR-08 | done | Clean up dead code after Phase 1 extractions | 2026-04-10 |
| PR-09 | done | Extract `project-knowledge.js` from `project.js` | 2026-04-10 |
| PR-10 | done | Extract `project-filesystem.js` from `project.js` | 2026-04-10 |
| PR-11 | done | Extract `project-sessions.js` from `project.js` | 2026-04-10 |
| PR-12 | done | Extract `project-user-message.js` from `project.js` | 2026-04-10 |
| PR-13 | done | Extract `project-connection.js` from `project.js` | 2026-04-10 |
| PR-14 | done | Reduce `project.js` to thin coordinator (1,191 lines) | 2026-04-10 |
| PR-15 | **next** | Extract `server-auth.js` from `server.js` | |
| PR-16 | pending | Extract `server-admin.js` from `server.js` | |
| PR-17 | pending | Extract `server-skills.js` from `server.js` | |
| PR-18 | pending | Extract `server-settings.js` from `server.js` | |
| PR-19 | pending | Reduce `server.js` to thin router | |
| PR-20 | pending | Extract `app-connection.js` from `app.js` | |
| PR-21 | pending | Extract `app-messages.js` from `app.js` | |
| PR-22 | pending | Extract `app-dm.js` from `app.js` | |
| PR-23 | pending | Extract `app-home-hub.js` from `app.js` | |
| PR-24 | pending | Extract `app-rate-limit.js` from `app.js` | |
| PR-25 | pending | Extract `app-cursors.js` from `app.js` | |
| PR-26 | pending | Reduce `app.js` to bootstrap | |
| PR-27 | pending | Extract `sidebar-sessions.js` from `sidebar.js` | |
| PR-28 | pending | Extract `sidebar-projects.js` from `sidebar.js` | |
| PR-29 | pending | Extract `sidebar-mates.js` from `sidebar.js` | |
| PR-30 | pending | Extract `sidebar-mobile.js` from `sidebar.js` | |
| PR-31 | pending | Reduce `sidebar.js` to coordinator | |
| PR-32 | pending | Extract `scheduler-config.js` from `scheduler.js` | |
| PR-33 | pending | Extract `scheduler-history.js` from `scheduler.js` | |
| PR-34 | pending | Reduce `scheduler.js` to coordinator | |
| PR-35 | pending | Extract `sdk-skill-discovery.js` from `sdk-bridge.js` | |
| PR-36 | pending | Extract `sdk-message-queue.js` from `sdk-bridge.js` | |
| PR-37 | pending | Extract `sdk-message-processor.js` from `sdk-bridge.js` | |
| PR-38 | pending | Reduce `sdk-bridge.js` to connection manager | |
| PR-39 | pending | Extract `mates-prompts.js` from `mates.js` | |
| PR-40 | pending | Extract `mates-knowledge.js` from `mates.js` | |
| PR-41 | pending | Extract `mates-identity.js` from `mates.js` | |
| PR-42 | pending | Reduce `mates.js` to CRUD + builtins | |
| PR-43 | pending | Extract `users-auth.js` from `users.js` | |
| PR-44 | pending | Extract `users-permissions.js` from `users.js` | |
| PR-45 | pending | Extract `users-preferences.js` from `users.js` | |
| PR-46 | pending | Reduce `users.js` to CRUD + invites | |
| PR-47 | pending | Extract `daemon-projects.js` from `daemon.js` | |
| PR-48 | pending | Define `ws-schema.js` | |

### Current file sizes after completed PRs

| File | Original | Current | Target |
|------|----------|---------|--------|
| `lib/project.js` | 7,222 | 1,191 | ~800 |
| `lib/server.js` | 3,599 | 3,702 | ~500 |
| `lib/public/app.js` | 8,010 | 8,066 | ~1,500 |
| `lib/public/modules/sidebar.js` | 4,541 | 4,583 | ~400 |
| `lib/public/modules/scheduler.js` | 3,166 | 3,166 | ~1,200 |
| `lib/sdk-bridge.js` | 2,232 | 2,424 | ~800 |
| `lib/mates.js` | 1,318 | 1,318 | ~500 |
| `lib/users.js` | 791 | 829 | ~300 |
| `lib/daemon.js` | 1,490 | 1,503 | ~1,100 |

> Updated 2026-04-10. Files grew due to feature additions (OS user mode, chat layout, push notifications, sender attribution, worker lifecycle improvements). Refactoring scope increased accordingly.

---

## State Management

> All module extractions follow the [State Conventions](./STATE_CONVENTIONS.md). Read it before starting any PR.

---

## How to Read This Document

- Each numbered step (e.g. `PR-01`) is exactly **one pull request**.
- Every PR follows the same pattern: extract functions into a new file, then re-export from the original file so nothing else changes.
- Do NOT combine multiple PRs into one. One PR = one module extraction.
- After each PR, every existing `require()` and function call must work exactly as before.

---

## Execution Pattern (Apply to Every PR)

Every extraction PR follows these four stages:

### Stage 1: Create the new file

Create the new module file. It receives a **context object** with only the state and callbacks it needs. It never imports the parent file.

```js
// lib/project-debate.js (example)
var fs = require("fs")

function attachDebate(ctx) {
  // ctx contains: { cwd, slug, send, sendTo, sm, sdk, ... }
  // Only what debate actually needs.

  function handleDebateStart(ws, msg) { /* moved from project.js */ }
  function handleDebateStop(ws, msg) { /* moved from project.js */ }
  // ... all debate functions moved here

  return {
    handleDebateStart: handleDebateStart,
    handleDebateStop: handleDebateStop,
    // ... all public functions
  }
}

module.exports = { attachDebate }
```

### Stage 2: Wire into the original file

In the original file, require the new module and call `attach*()` during initialization. Replace the moved functions with delegations.

```js
// lib/project.js
var projectDebate = require("./project-debate")

// Inside createProjectContext():
var debate = projectDebate.attachDebate({
  cwd: cwd,
  slug: slug,
  send: send,
  sendTo: sendTo,
  sm: sm,
  sdk: sdk
})
```

### Stage 3: Re-export from the original file

Any function that was called from outside (e.g. from `handleMessage`) must still work via the original object. Add thin delegations:

```js
// Inside the returned context object in createProjectContext():
handleDebateStart: debate.handleDebateStart,
handleDebateStop: debate.handleDebateStop,
```

### Stage 4: Verify

- `grep -r "handleDebateStart" lib/` confirms no call site changed.
- Start the server, open a project, trigger the feature, confirm it works.
- No other file was modified except the original and the new module.

### Stage 5: Update MODULE_MAP.md

- Add the new module to the appropriate table in [MODULE_MAP.md](./MODULE_MAP.md).
- List all message types the module handles.
- If message types moved between modules, update the old module's entry too.
- This keeps the map accurate so future contributors know where to add code.

---

## Current State

| File | Lines | Top Concerns |
|------|-------|-------------|
| `lib/public/app.js` | 8,066 | WS dispatch, connection, UI state, DM, loops, debate, cursors, config, sender attribution |
| `lib/project.js` | 6,031 | loop(18fn), mate-interaction(8fn), memory(6fn), file-watch(5fn), HTTP, image, OS user mode, presence, scheduled messages |
| `lib/public/modules/sidebar.js` | 4,583 | sessions, projects/icons, mates/users, mobile sheets (incl. mate tools) |
| `lib/server.js` | 3,702 | auth(10 routes), admin(17 routes), skills(3 routes), settings(9 routes), infra, push notifications |
| `lib/public/modules/scheduler.js` | 3,166 | config/create, history, calendar view, detail/sidebar, crafting |
| `lib/sdk-bridge.js` | 2,424 | skill discovery, message queue, message processing, mention context, worker lifecycle, perf logging |
| `lib/daemon.js` | 1,503 | worktree scanning, lifecycle, config, IPC, chat layout |
| `lib/mates.js` | 1,318 | prompts(6 enforcers), knowledge, identity, CRUD, builtins |
| `lib/users.js` | 829 | auth, CRUD, permissions, preferences, invites, chat layout |

---

## Phase 1: Decompose `project.js` (PR-01 through PR-08)

project.js is currently 6,031 lines (down from 7,222 after PR-01 debate extraction, then grew back due to feature additions). It has 90+ internal functions across 8+ concerns. A bug in loop logic requires reading the entire file. Phase 1 extracts each concern into its own file. After Phase 1, project.js becomes a thin coordinator under 800 lines.

---

### PR-01: Extract `lib/project-debate.js` [DONE 2026-04-04]

**Why first**: Debate is the largest concern in project.js (27 functions, ~1,500 lines). It is self-contained: start, stop, comment, conclude, panelist/moderator turns, state persistence.

**Create**: `lib/project-debate.js`

**Functions to move** (27):
- `handleDebateStart`, `handleDebateQuickStart`, `handleDebateSkillSetup`
- `handleDebateComment`, `handleDebateConfirmBrief`, `handleDebateStop`
- `handleDebateConcludeResponse`, `handleModeratorTurnDone`, `handlePanelistTurnDone`
- `buildDebateNameMap`, `buildModeratorContext`, `buildPanelistContext`
- `startDebateBriefWatcher`, `restoreDebateState`, `persistDebateState`
- `restoreDebateFromState`, `buildDebateToolHandler`, `checkForDmDebateBrief`
- `startDebateLive`, `rebuildDebateState`, `feedBackToModerator`
- `triggerPanelist`, `buildModeratorCallbacks`, `injectUserComment`
- `endDebate`, `digestDebateParticipant`
- `enqueueDigest`, `processDigestQueue` (used exclusively by debate)

**Context object needs**: `cwd`, `slug`, `send`, `sendTo`, `sendToSession`, `sm`, `sdk`, `getMateProfile`, `loadMateClaudeMd`, `clients`

**Re-export in project.js**: Wire debate handlers into `handleMessage` switch cases. The message types `debate_start`, `debate_quick_start`, `debate_skill_setup`, `debate_comment`, `debate_confirm_brief`, `debate_stop`, `debate_conclude_response` delegate to `debate.handleXxx()`.

**Verify**: Start a debate in any project. Confirm start, comment, panelist turns, conclude all work.

**Implementation notes** (completed):
- Merged via PR #265 to `dev-2-23`, squash merged
- `project.js`: 7,222 -> 5,685 lines. `project-debate.js`: 1,616 lines
- Used `attachDebate(ctx)` pattern. Context receives: `cwd`, `slug`, `send`, `sendTo`, `sendToSession`, `sm`, `sdk`, `getMateProfile`, `loadMateClaudeMd`, `loadMateDigests`, `hydrateImageRefs`, `onProcessingChanged`, `getLinuxUserForSession`, `getSessionForWs`, `updateMemorySummary`, `initMemorySummary`
- Shared helpers `escapeRegex`, `getMateProfile`, `loadMateClaudeMd` kept in project.js (used by non-debate code too)
- `enqueueDigest`/`processDigestQueue` kept in project.js (shared with DM digest). Debate uses its own inline digest in `digestDebateParticipant`
- 7 re-export vars in project.js: `handleDebateStart`, `handleDebateComment`, `handleDebateStop`, `handleDebateConcludeResponse`, `handleDebateConfirmBrief`, `restoreDebateState`, `checkForDmDebateBrief`

---

### PR-02: Extract `lib/project-memory.js`

**Create**: `lib/project-memory.js`

**Functions to move** (6):
- `gateMemory`, `updateMemorySummary`, `doIncrementalUpdate`
- `initMemorySummary`, `loadMateDigests`, `formatRawDigests`

**Context object needs**: `cwd`, `slug`, `sm`, `sdk`, `send`

**Re-export in project.js**: Wire memory handlers. Message types `memory_list`, `memory_search`, `memory_delete` delegate to memory module.

**Verify**: Open a project, trigger memory search, confirm results appear.

> **YOKE note**: `ctx.sdk.createMentionSession()` calls (3). During extraction, keep SDK access via `ctx` rather than direct import. Phase 6 will replace these with an intermediate abstraction layer.

---

### PR-03: Extract `lib/project-mate-interaction.js`

**Create**: `lib/project-mate-interaction.js`

**Functions to move** (9+):
- `handleMention`, `hasMateInWindow`, `getMateProfile`, `loadMateClaudeMd`
- `buildMiddleContext`, `buildMentionContext`, `digestMentionSession`, `digestDmTurn`
- `maybeSynthesizeUserProfile` (added post-roadmap, ~100 lines, synthesizes user profile for mate context)

> `detectMentions` was listed in the original roadmap but does not exist in project.js. Removed 2026-04-07.

**Context object needs**: `cwd`, `slug`, `send`, `sendTo`, `sm`, `sdk`, `clients`

**Re-export in project.js**: `handleMention` called from message handler. `getMateProfile` and `loadMateClaudeMd` also used by debate (PR-01), so update the debate module's context to receive these from the mate-interaction module.

**Verify**: @mention a mate in a project session. Confirm the mate responds. Confirm user profile synthesis works in multi-user mode.

> **YOKE note**: `ctx.sdk.createMentionSession()` (3) + `checkToolWhitelist` (1). Same principle: access SDK via ctx. Phase 6 will swap these to intermediate functions.

---

### PR-04: Extract `lib/project-loop.js`

**Create**: `lib/project-loop.js`

**Functions to move** (18):
- `startLoop`, `runNextIteration`, `finishLoop`, `resumeLoop`, `stopLoop`, `runJudge`
- `generateLoopId`, `saveLoopState`, `loadLoopState`, `clearLoopState`, `parseJudgeVerdict`
- `startClaudeDirWatch`, `stopClaudeDirWatch`, `broadcastLoopFilesStatus`
- `checkLoopFilesExist`, `loopDir`
- Plus loop-related message handlers from the `handleMessage` switch

**Context object needs**: `cwd`, `slug`, `send`, `sendTo`, `sm`, `sdk`, `clients`, `handleMention` (from mate-interaction)

**Depends on**: PR-03 (loops trigger mentions)

**Re-export in project.js**: Loop message types (`loop_start`, `loop_stop`, `loop_resume`, etc.) delegate to loop module. `getSchedules`, `importSchedule`, `removeSchedule` delegate too.

**Verify**: Create and run a loop. Confirm iterations execute, judge runs, loop stops.

---

### PR-05: Extract `lib/project-file-watch.js`

**Create**: `lib/project-file-watch.js`

**Functions to move** (5):
- `startFileWatch`, `stopFileWatch`
- `startDirWatch`, `stopDirWatch`, `stopAllDirWatches`

**Context object needs**: `cwd`, `send`, `sendTo`, `clients`

**Re-export in project.js**: File watch message handlers delegate. `destroy()` calls `fileWatch.stopAllDirWatches()`.

**Verify**: Enable file watch on a project file, edit it externally, confirm notification appears.

---

### PR-06: Extract `lib/project-http.js`

**Create**: `lib/project-http.js`

**Functions to move**:
- `handleHTTP` (the main HTTP handler with image serving and upload routes)
- `saveImageFile`

**Context object needs**: `cwd`, `slug`, `sm`

**Re-export in project.js**: The context's `handleHTTP` property delegates to `http.handleHTTP`.

**Verify**: Upload an image in a project session. Confirm it displays correctly.

---

### PR-07: Extract `lib/project-image.js`

**Create**: `lib/project-image.js`

**Functions to move**:
- `hydrateImageRefs`
- Any image-specific utility functions used by hydrateImageRefs

**Context object needs**: `cwd`, `slug`

**Re-export in project.js**: `hydrateImageRefs` called during history loading delegates to image module.

**Verify**: Open a session with images in history. Confirm images render correctly.

---

### PR-08: Reduce `project.js` to thin coordinator

**What remains in project.js** (~800 lines):
- `createProjectContext()` initialization
- Context object creation with all module wiring
- `handleConnection`, `handleDisconnection` (thin routers)
- `handleMessage` switch statement (each case is a one-line delegation)
- `send`, `sendTo`, `sendToSession`, `sendToSessionOthers`, `sendToAdmins`, `broadcastClientCount`, `broadcastPresence`
- `getStatus`, `setTitle`, `setIcon`, `setProjectOwner`, `getProjectOwner`
- `warmup`, `destroy`
- Helper utilities: `getLinuxUserForSession`, `getLinuxUserForWs`, `getRecentTurns`, `escapeRegex`, `scheduleMessage`, `cancelScheduledMessage`
- OS user mode: `getOsUserInfoForWs`, `getOsUserInfoForReq`, `getSessionForWs`
- Digest queue: `enqueueDigest`, `processDigestQueue` (shared by debate and DM)

**What to do**:
- Remove all re-export boilerplate. Direct the `handleMessage` switch to call module functions directly.
- Clean up any dead code left from extractions.
- Verify all `require("./project")` call sites still work.

**Verify**: Full integration test. Create project, send messages, run debate, run loop, mention mate, upload image, watch file. Everything works.

---

## Phase 2: Decompose `server.js` (PR-09 through PR-13)

server.js is 3,702 lines with manual route matching. Auth, admin, skills, and settings are completely independent concerns sharing one handler function. Push notification routes were added post-roadmap.

---

### PR-09: Extract `lib/server-auth.js`

**Create**: `lib/server-auth.js`

**Routes to move** (10):
- `POST /auth` (legacy PIN auth)
- `POST /auth/setup` (first-time admin setup)
- `POST /auth/login` (multi-user login)
- `POST /auth/request-otp`, `POST /auth/verify-otp` (OTP flow)
- `POST /auth/register` (SMTP registration)
- `POST /auth/logout`
- `GET /recover/{urlPath}`, `POST /recover/{urlPath}` (recovery)
- `GET /invite/{code}` (invite page)

**Helper functions to move**:
- `parseCookies`, `isAuthed`, `isMultiUserAuthed`
- `loadTokens`, `saveTokens`, `createMultiUserSession`, `getMultiUserFromReq`
- `checkPinRateLimit`, `recordPinFailure`, `clearPinFailures`
- `getAuthPage`, `recoveryPageHtml`

**Context object needs**: `opts` (pin, authToken, multiUser config), `usersModule`, `smtpModule`, `pagesModule`

**Re-export in server.js**: The main request handler calls `auth.handleRequest(req, res)` for auth-prefixed paths. Auth middleware functions (`isAuthed`, `getMultiUserFromReq`) are passed to other modules via context.

**Verify**: Login, logout, PIN auth, OTP flow, invite link, recovery page.

---

### PR-10: Extract `lib/server-admin.js`

**Create**: `lib/server-admin.js`

**Routes to move** (17):
- All `/api/admin/*` routes (users CRUD, permissions, invites, SMTP config, project visibility/owner/access)

**Context object needs**: `usersModule`, `projects`, `getMultiUserFromReq` (from auth), `matesModule`

**Re-export in server.js**: Admin-prefixed paths delegate to `admin.handleRequest(req, res)`.

**Verify**: Open admin panel, manage users, change project visibility, send invite.

---

### PR-11: Extract `lib/server-skills.js`

**Create**: `lib/server-skills.js`

**Routes to move** (3):
- `GET /api/skills` (list with tabs: all, trending, hot)
- `GET /api/skills/search`
- `GET /api/skills/detail`

**Helper functions to move**:
- `httpGet`, `fetchSkillsPage`, `fetchSkillDetail`
- `scheduleRegistryRefresh` and skills cache state

**Context object needs**: minimal (skills are a standalone proxy/cache)

**Re-export in server.js**: Skills-prefixed paths delegate to `skills.handleRequest(req, res)`.

**Verify**: Open skills panel, search skills, view skill detail.

---

### PR-12: Extract `lib/server-settings.js`

**Create**: `lib/server-settings.js`

**Routes to move** (9):
- `GET/PUT /api/profile`
- `PUT /api/user/pin`
- `GET/PUT /api/user/auto-continue`
- `POST /api/avatar`, `GET /api/avatar/{id}`
- `POST /api/mate-avatar/{id}`, `GET /api/mate-avatar/{id}`

**Context object needs**: `usersModule`, `getMultiUserFromReq` (from auth)

**Re-export in server.js**: Settings/profile paths delegate to `settings.handleRequest(req, res)`.

**Verify**: Change avatar, update profile, change PIN, toggle auto-continue.

---

### PR-13: Reduce `server.js` to thin router

**What remains in server.js** (~500 lines):
- `createServer(opts)` initialization
- TLS/HTTP setup, WebSocket upgrade
- Middleware chain: security headers, CORS, static files
- Route table: auth paths -> server-auth, admin paths -> server-admin, skills paths -> server-skills, settings paths -> server-settings, project paths -> project context
- `addProject`, `removeProject`, `getProjects`, `reorderProjects`
- `broadcastAll`, `destroyAll`, graceful shutdown
- Infrastructure routes: `/api/me`, `/api/vapid-public-key`, `/api/push-subscribe`, `/ca/download`, `/setup`, `/pwa`, `/info`

**Verify**: Full server functionality. All routes respond correctly.

---

## Phase 3: Decompose `app.js` (PR-14 through PR-20)

app.js is 8,066 lines with 90+ WebSocket message types in a single `processMessage` function. Phase 3 extracts each UI concern into its own module.

---

### PR-14: Extract `lib/public/modules/app-connection.js`

**Create**: `lib/public/modules/app-connection.js`

**Functions to move**:
- `connect()` (WebSocket creation, onopen/onclose/onerror/onmessage setup)
- `scheduleReconnect()` (exponential backoff)
- `setStatus()` (connection status UI)
- Connection state: `ws`, `connected`, `wasConnected`, `reconnectTimer`, `reconnectDelay`, `connectTimeoutId`, `disconnectNotifTimer`, `disconnectNotifShown`

**Interface**: `initConnection(ctx)` returns `{ connect, getWs, isConnected, send }`. The `ctx` provides `onMessage` callback (which calls `processMessage`), DOM elements for status indicator, and project slug getter.

**Re-export in app.js**: `connect()` delegates to `connection.connect()`. All `ws.send()` calls go through `connection.send()`.

**Verify**: Load page, confirm WebSocket connects. Kill server, confirm reconnect with backoff.

---

### PR-15: Extract `lib/public/modules/app-messages.js`

**Create**: `lib/public/modules/app-messages.js`

**Functions to move**:
- `processMessage(msg)` (the 1,300-line switch statement)
- All message-type-specific handler helpers that live inside processMessage

**Interface**: `initMessages(ctx)` returns `{ processMessage }`. The `ctx` provides: all module handles (sidebar, debate, tools, input, etc.), DOM elements, state getters/setters.

**Note**: This is the largest single extraction. The processMessage function references many other modules. The key insight is that each `case` in the switch is a thin delegation to another module. After extraction, processMessage is a router: it reads `msg.type` and calls the right module's handler.

**Re-export in app.js**: `processMessage` delegates to `messages.processMessage`.

**Verify**: Send a message, confirm response streams. Switch sessions, confirm history loads. All message types still handled.

---

### PR-16: Extract `lib/public/modules/app-dm.js`

**Create**: `lib/public/modules/app-dm.js`

**Functions to move**:
- `openDm`, `enterDmMode`, `exitDmMode`, `appendDmMessage`
- `showDmTypingIndicator`, `handleDmSend`
- `handleMateCreatedInApp`, `renderAvailableBuiltins`, `buildMateInterviewPrompt`
- `updateMateIconStatus`, `connectMateProject`, `disconnectMateProject`
- DM state: `dmMode`, `dmKey`, `dmTargetUser`, `dmMessageCache`, `dmUnread`, `cachedAllUsers`, `cachedOnlineIds`, `cachedDmFavorites`, `cachedDmConversations`, `cachedMatesList`
- Mate project state: `mateProjectSlug`, `savedMainSlug`, `returningFromMateDm`

**Interface**: `initDm(ctx)` returns `{ openDm, exitDmMode, isDmMode, ... }`.

**Verify**: Open a DM conversation with a mate. Send messages. Return to main project.

---

### PR-17: Extract `lib/public/modules/app-home-hub.js`

**Create**: `lib/public/modules/app-home-hub.js`

**Functions to move**:
- `renderHomeHub`, `showHomeHub`, `hideHomeHub`
- `startTipRotation`, `stopTipRotation`, `handleHubSchedules`
- `fetchWeather`, `updateGreetingWeather`, `playWeatherSlot`
- Home hub state: `homeHub`, `homeHubVisible`, `hubSchedules`, `hubTips`

**Interface**: `initHomeHub(ctx)` returns `{ show, hide, isVisible, handleHubSchedules }`.

**Verify**: Load app with no active session. Confirm home hub renders with projects, tips, schedules.

---

### PR-18: Extract `lib/public/modules/app-rate-limit.js`

**Create**: `lib/public/modules/app-rate-limit.js`

**Functions to move**:
- `updateRateLimitIndicator`, `startRateLimitCountdown`, `updateRateLimitUsage`
- `handleRateLimitEvent`, `rateLimitTypeLabel`, `rateLimitTypeShortLabel`
- `formatResetTime`, `clearRateLimitIndicator`
- `addScheduledMessageBubble`, `removeScheduledMessageBubble`, `handleFastModeState`
- Rate limit state: `rateLimitResetsAt`, `rateLimitResetTimer`

**Interface**: `initRateLimit(ctx)` returns `{ handleRateLimitEvent, updateUsage, clear }`.

**Verify**: Trigger rate limit (or mock one). Confirm banner and countdown appear.

---

### PR-19: Extract `lib/public/modules/app-cursors.js`

**Create**: `lib/public/modules/app-cursors.js`

**Functions to move**:
- `initCursorToggle`, `getCursorColor`, `createCursorElement`
- `getCharOffset`, `getNodeAtCharOffset`, `findParentTurn`
- `clearRemoteSelection`, `handleRemoteSelection`
- `createOffscreenIndicator`, `updateCursorVisibility`
- `handleRemoteCursorMove`, `handleRemoteCursorLeave`
- `findClosestTurn`, `clearRemoteCursors`
- Cursor state: `remoteCursors`, `remoteSelections`, `lastSelectionKey`

**Interface**: `initCursors(ctx)` returns `{ handleCursorMove, handleCursorLeave, handleSelection, clearAll }`.

**Verify**: Open same session in two browser tabs. Move cursor in one, confirm it appears in the other.

---

### PR-20: Reduce `app.js` to bootstrap

**What remains in app.js** (~1,500 lines):
- Module imports and initialization sequence
- DOM element references and top-level state
- Theme initialization (initTheme, favicon, status indicators)
- Message rendering pipeline (addUserMessage, ensureAssistantBlock, appendDelta, drainStreamTick, flushStreamBuffer, finalizeAssistantBlock, addSystemMessage)
- Project management UI (switchProject, resetClientState, add/remove project modals)
- Config/usage/context panels (updateConfigChip, rebuildModelList, etc.)
- Scroll management (addToMessages, scrollToBottom)
- Suggestion chips (showSuggestionChips, hideSuggestionChips)
- Loop/Ralph wizard UI (this is tightly coupled to the app UI, keep here for now)
- Debate UI helpers (showDebateSticky, showDebateBottomBar, etc., thin UI wrappers)
- Final init: `lucide.createIcons()`, `connect()`, `showHomeHub()`

**Verify**: Full integration. Every feature accessible from the UI works.

---

## Phase 4: Decompose `sidebar.js` (PR-21 through PR-25)

sidebar.js is 4,583 lines rendering three completely independent UI sections: sessions, projects, and mates/users. Plus a full mobile sheet system (now includes mate tools in mobile sheets).

---

### PR-21: Extract `lib/public/modules/sidebar-sessions.js`

**Create**: `lib/public/modules/sidebar-sessions.js`

**Functions to move**:
- `renderSessionList`, `renderSessionItem`, `handleSearchResults`
- `updateSessionPresence`, `renderPresenceAvatars`, `presenceAvatarUrl`
- `renderLoopGroup`, `renderLoopChild`, `renderLoopRun`
- `startInlineRename`, `showSessionCtxMenu`, `closeSessionCtxMenu`
- `getDateGroup`, `highlightMatch`, `populateCliSessionList`
- `startCountdownTimer`, `updateCountdowns`, `relativeTime`
- Session state: `cachedSessions`, `searchQuery`, `searchMatchIds`, `expandedLoopGroups`, `expandedLoopRuns`, `sessionPresence`

**Interface**: `initSidebarSessions(ctx)` returns `{ renderSessionList, handleSearchResults, updatePresence, updateBadge }`.

**Verify**: Session list renders, search works, inline rename works, loop groups expand/collapse.

---

### PR-22: Extract `lib/public/modules/sidebar-projects.js`

**Create**: `lib/public/modules/sidebar-projects.js`

**Functions to move**:
- `renderIconStrip`, `renderProjectList`, `createIconItem`, `createMobileProjectItem`
- `groupProjects`, `getProjectAbbrev`, `setWtCollapsed`
- `showProjectCtxMenu`, `closeProjectCtxMenu`, `showIconCtxMenu`
- `showProjectAccessPopover`, `closeProjectAccessPopover`, `renderAccessPopover`
- `showEmojiPicker`, `closeEmojiPicker`, `getEmojiCategories`
- `showProjectRename`
- `showTrashZone`, `hideTrashZone`, `setupDragHandlers`, `clearDragIndicators`
- `showWorktreeModal`
- Project state: `cachedProjectList`, `cachedCurrentSlug`, `wtCollapsed`

**Interface**: `initSidebarProjects(ctx)` returns `{ renderIconStrip, renderProjectList, updateBadge, getEmojiCategories }`.

**Verify**: Project icon strip renders, drag reorder works, context menu works, emoji picker works, worktree modal works.

---

### PR-23: Extract `lib/public/modules/sidebar-mates.js`

**Create**: `lib/public/modules/sidebar-mates.js`

**Functions to move**:
- `renderUserStrip`, `closeDmUserPicker`, `setCurrentDmUser`
- `updateDmBadge`, `renderSidebarPresence`
- `showUserCtxMenu`, `closeUserCtxMenu`, `handleUserCtxOutsideClick`
- `showMateCtxMenu`, `toggleDmUserPicker`
- `showIconTooltip`, `showIconTooltipHtml`, `hideIconTooltip`
- User/mate state: `cachedMates`, `cachedAllUsers`, `cachedOnlineUserIds`, `cachedDmFavorites`, `cachedDmConversations`, `cachedDmUnread`, `cachedDmRemovedUsers`, `cachedMyUserId`, `currentDmUserId`, `dmPickerOpen`

**Interface**: `initSidebarMates(ctx)` returns `{ renderUserStrip, updateDmBadge, setCurrentDmUser, closeDmUserPicker }`.

**Verify**: User/mate strip renders, DM picker opens, context menus work, unread badges update.

---

### PR-24: Extract `lib/public/modules/sidebar-mobile.js`

**Create**: `lib/public/modules/sidebar-mobile.js`

**Functions to move**:
- `openMobileSheet`, `closeMobileSheet`, `setMobileSheetMateData`
- `refreshMobileChatSheet`, `renderMobileSessionsInto`
- `renderSheetProjects`, `renderSheetSessions`, `renderSheetMateProfile`
- `renderSheetSearch`, `renderSearchResults`, `renderSheetTools`, `renderSheetSettings`
- `createMobileSessionItem`, `createMobileLoopChild`, `createMobileLoopRun`, `createMobileLoopGroup`
- Mobile state: `mobileChatSheetOpen`, `mobileSheetMateData`, `expandedMobileLoopGroups`, `expandedMobileLoopRuns`

**Interface**: `initSidebarMobile(ctx)` returns `{ openSheet, closeSheet, setMateData, refresh }`.

**Verify**: On mobile viewport: open each sheet tab (projects, sessions, mates, search, tools, settings). Confirm rendering and navigation.

---

### PR-25: Reduce `sidebar.js` to coordinator

**What remains in sidebar.js** (~400 lines):
- `initSidebar(_ctx)` calling all sub-module inits
- `initIconStrip(_ctx)` calling sub-module inits
- `openSidebar`, `closeSidebar` (mobile overlay toggle)
- `updatePageTitle`
- `dismissOverlayPanels`
- `updateSessionBadge`, `updateProjectBadge` (thin delegations)
- `spawnDustParticles` (visual effect utility)
- Exports object aggregating all sub-module exports

**Verify**: Full sidebar functionality on both desktop and mobile.

---

## Phase 5: Decompose `scheduler.js` (PR-26 through PR-28)

---

### PR-26: Extract `lib/public/modules/scheduler-config.js`

**Create**: `lib/public/modules/scheduler-config.js`

**Functions to move**:
- `setupCreateModal`, `openCreateModal`, `openCreateModalWithRecord`
- `positionCreatePopover`, `buildCreateCron`, `buildCustomCron`, `submitCreateSchedule`
- `updateRecurrenceLabels`, `updateRecurrenceBtn`, `enforceMinTime`, `updateIntervalBtn`
- `removePreview`, `showPreviewOnCell`, `showPreviewOnSlot`, `showPreviewForCreate`
- `buildOffsetList`, `updateEndDateLabel`, `renderEndCalendar`
- `parseCronSimple`, `parseField`

**Verify**: Open scheduler, create a new schedule, edit existing schedule.

---

### PR-27: Extract `lib/public/modules/scheduler-history.js`

**Create**: `lib/public/modules/scheduler-history.js`

**Functions to move**:
- `renderHistory`, `handleScheduleRunStarted`, `handleScheduleRunFinished`
- `handleLoopScheduled`, `handleLoopRegistryUpdated`, `handleLoopRegistryFiles`

**Verify**: View schedule execution history, confirm live updates during execution.

---

### PR-28: Reduce `scheduler.js` to coordinator

**What remains** (~1,200 lines):
- `initScheduler`, `openScheduler`, `closeScheduler`, `resetScheduler`, `isSchedulerOpen`
- Calendar view rendering (renderMonthView, renderWeekView, navigate, now-line)
- Detail view (renderSidebar, renderDetail, renderDetailBody, filterByProject)
- Crafting mode (enterCraftingMode, exitCraftingMode, reparentChat)
- Utilities (cronToHuman, pad, esc, formatDateTime)
- Event click/hover attachment

**Verify**: Full scheduler functionality: month/week views, create/edit/delete schedules, history tab.

---

## Phase 6: Decompose smaller modules (PR-29 through PR-37)

---

### PR-29: Extract `lib/sdk-skill-discovery.js`

**From**: `lib/sdk-bridge.js`

**Functions to move**: `discoverSkillDirs`, `mergeSkills`, `splitShellSegments`

**Verify**: Skills discovered and available in project sessions.

> **YOKE prep**: `discoverSkillDirs` and `mergeSkills` are filesystem-based, likely runtime-independent. When extracting, confirm they have no Claude Code SDK dependencies. If clean, they become part of the portable core.

---

### PR-30: Extract `lib/sdk-message-queue.js`

**From**: `lib/sdk-bridge.js`

**Functions to move**: `createMessageQueue` (the async iterable queue with `.push()`, `.end()`, `[Symbol.asyncIterator]`)

**Verify**: Messages stream correctly during SDK interaction.

> **YOKE prep**: The message queue is runtime-independent by nature. However, verify whether the message format entering the queue is Claude Code SDK-specific. If so, note where a normalization layer should sit.

---

### PR-31: Extract `lib/sdk-message-processor.js`

**From**: `lib/sdk-bridge.js`

**Functions to move**: `processSDKMessage`, `sendAndRecord`, all stream event handlers (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`), mention context handling, tool use block handling, task tool ID tracking. Also includes performance logging added post-roadmap.

**Verify**: Send a message in a session, confirm streaming response with tool use works.

> **YOKE prep**: This is the critical PR for SDK extraction readiness. `processSDKMessage` event handlers directly depend on Claude Code SDK stream event formats. While extracting, document all event types handled (message_start, content_block_start, content_block_delta, content_block_stop, etc.). This becomes the event spec that YOKE will need to normalize across runtimes. Also: wrap `createMentionSession` calls from project-debate, project-mate-interaction, and project-memory into meaningful intermediate functions (e.g. `startMentionTurn`) so external modules never call SDK methods directly.

---

### PR-32: Reduce `sdk-bridge.js` to connection manager (~800 lines)

**What remains**: `createSDKBridge(opts)` factory, connection state, module wiring, worker lifecycle management (`spawnWorker`, `killSessionWorker`, `startQueryViaWorker`, worker reuse logic). `sendPush` for AskUserQuestion.

> sdk-bridge.js grew from 2,232 to 2,424 lines post-roadmap due to worker lifecycle improvements and perf logging. The extraction targets remain the same but PR-31 scope is larger.

**Verify**: Full SDK interaction works end-to-end.

> **YOKE prep**: Two additional tasks when reducing to connection manager. (1) Document the Unix domain socket + JSON-line protocol message types used by sdk-worker.js, as constants or comments. This protocol may become the basis for YOKE's message spec. (2) Consolidate SDK access through `getSDK()` factory in this file. Migrate direct `require("@anthropic-ai/claude-agent-sdk")` calls in browser-mcp-server.js and debate-mcp-server.js to use this factory where possible.

---

### PR-33: Extract `lib/mates-prompts.js`

**From**: `lib/mates.js`

**Functions to move**: All 6 section enforcers and their helpers:
- `enforceTeamAwareness`, `buildTeamSection`, `hasTeamSection`
- `enforceSessionMemory`, `hasSessionMemory`
- `enforceStickyNotes`, `hasStickyNotesSection`
- `enforceProjectRegistry`, `buildProjectRegistrySection`
- `enforceDebateAwareness`
- `enforceAllSections`, `stripAllSystemSections`
- All marker constants (`TEAM_MARKER`, `SESSION_MEMORY_MARKER`, `STICKY_NOTES_MARKER`, `PROJECT_REGISTRY_MARKER`, `DEBATE_AWARENESS_MARKER`, `ALL_SYSTEM_MARKERS`)

**Verify**: Create a mate, confirm all system sections appear in its claude.md. Edit mate, confirm sections survive.

---

### PR-34: Extract `lib/mates-knowledge.js`

**From**: `lib/mates.js`

**Functions to move**:
- `loadCommonKnowledge`, `saveCommonKnowledge`
- `promoteKnowledge`, `depromoteKnowledge`, `getCommonKnowledgeForMate`
- `readCommonKnowledgeFile`, `isPromoted`, `commonKnowledgePath`

**Verify**: Promote a knowledge file, confirm it appears in shared knowledge. Depromote, confirm removal.

---

### PR-35: Extract `lib/mates-identity.js`

**From**: `lib/mates.js`

**Functions to move**:
- `extractIdentity`, `backupIdentity`, `loadIdentityBackup`
- `logIdentityChange`, `buildPrimaryCapabilitiesSection`
- `PRIMARY_CAPABILITIES_MARKER`

**Verify**: Edit a mate's identity. Confirm backup created. Confirm identity extraction works.

---

### PR-36: Reduce `mates.js` to CRUD + builtins (~500 lines)

**What remains**: `createMate`, `getMate`, `updateMate`, `deleteMate`, `getAllMates`, `isMate`, storage functions, builtin mate functions, migration.

**Verify**: Full mate CRUD works. Built-in mates sync correctly.

---

### PR-37: Extract `lib/users-auth.js`

**From**: `lib/users.js`

**Functions to move**:
- `authenticateUser`, `generateUserAuthToken`, `parseAuthCookie`
- `hashPin`, `generatePin`
- `isMultiUser`, `enableMultiUser`, `disableMultiUser`
- `generateSetupCode`, `getSetupCode`, `clearSetupCode`, `validateSetupCode`

**Verify**: Login, logout, PIN change all work.

---

### PR-38: Extract `lib/users-permissions.js`

**From**: `lib/users.js`

**Functions to move**:
- `DEFAULT_PERMISSIONS`, `ALL_PERMISSIONS`
- `getEffectivePermissions`, `updateUserPermissions`
- `canAccessProject`, `getAccessibleProjects`, `canAccessSession`

**Verify**: Permission checks work. Admin sees all projects. Limited user sees only permitted.

---

### PR-39: Extract `lib/users-preferences.js`

**From**: `lib/users.js`

**Functions to move**:
- `getDmFavorites`, `addDmFavorite`, `removeDmFavorite`
- `getDmHidden`, `addDmHidden`, `removeDmHidden`
- `getAutoContinue`, `setAutoContinue`
- `getDeletedBuiltinKeys`, `addDeletedBuiltinKey`, `removeDeletedBuiltinKey`
- `getChatLayout`, `setChatLayout` (added post-roadmap, chat layout preference)
- `setMateOnboarded` (added post-roadmap, mate onboarding state)

**Verify**: Favorite a DM user, toggle auto-continue, delete a builtin mate, switch chat layout. Confirm persistence.

---

### PR-40: Reduce `users.js` to CRUD + invites (~300 lines)

**What remains**: User CRUD (`createUser`, `findUserById`, `getAllUsers`, `removeUser`, etc.), invite functions, profile/PIN update, storage, Linux user integration.

**Verify**: Full user management works.

---

### PR-41: Extract `lib/daemon-projects.js`

**From**: `lib/daemon.js`

**Functions to move**:
- `scanAndRegisterWorktrees`, `rescanWorktrees`, `cleanupWorktreesForParent`, `isWorktreeSlug`
- `getFilteredRemovedProjects`
- `onSetChatLayout`, `onSetMateOnboarded` (added post-roadmap, daemon config handlers)
- Worktree state: `worktreeRegistry`, `worktreeTimers`, `worktreeScanning`

**Verify**: Start daemon with projects that have worktrees. Confirm all detected and registered. Confirm chat layout and mate onboarding config propagation works.

---

### PR-42: Define `lib/ws-schema.js`

**Create**: `lib/ws-schema.js`

This is NOT an extraction. This is a new file that documents every WebSocket message type flowing between client and server.

**Structure**:
```js
// lib/ws-schema.js
// WebSocket message type registry.
// Each entry: { direction, handler, payload }
//   direction: "c2s" (client to server), "s2c" (server to client), "both"
//   handler: file path where this message type is processed
//   payload: object shape description

var schema = {
  // Session
  "switch_session":   { direction: "c2s", handler: "lib/project.js", payload: { sessionId: "string" } },
  "session_list":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", payload: { sessions: "array" } },
  // Debate
  "debate_start":     { direction: "c2s", handler: "lib/project-debate.js", payload: { brief: "string", panelists: "array" } },
  "debate_started":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", payload: { debateId: "string" } },
  // ... every message type
}

module.exports = { schema }
```

**How to build**: Grep all `msg.type ===` and `case "..."` in both `lib/project.js` (handleMessage) and `lib/public/app.js` (processMessage). Cross-reference to build the complete registry.

**Depends on**: Best done after PR-08 and PR-20 when handlers are in focused modules.

**Verify**: Every message type in the schema has a matching handler. No handler exists without a schema entry.

---

## Execution Order Summary

| PR | Status | File Created | Extracted From | Approx Lines Moved |
|----|--------|-------------|----------------|-------------------|
| **Phase 1: project.js** | | | | |
| PR-01 | done | `lib/project-debate.js` | project.js | ~1,500 |
| PR-02 | **next** | `lib/project-memory.js` | project.js | ~400 |
| PR-03 | pending | `lib/project-mate-interaction.js` | project.js | ~700 |
| PR-04 | pending | `lib/project-loop.js` | project.js | ~1,200 |
| PR-05 | pending | `lib/project-file-watch.js` | project.js | ~300 |
| PR-06 | pending | `lib/project-http.js` | project.js | ~200 |
| PR-07 | pending | `lib/project-image.js` | project.js | ~150 |
| PR-08 | pending | (cleanup) | project.js | 0 (reduce to ~800) |
| **Phase 2: server.js** | | | | |
| PR-09 | pending | `lib/server-auth.js` | server.js | ~800 |
| PR-10 | pending | `lib/server-admin.js` | server.js | ~900 |
| PR-11 | pending | `lib/server-skills.js` | server.js | ~300 |
| PR-12 | pending | `lib/server-settings.js` | server.js | ~400 |
| PR-13 | pending | (cleanup) | server.js | 0 (reduce to ~500) |
| **Phase 3: app.js** | | | | |
| PR-14 | pending | `lib/public/modules/app-connection.js` | app.js | ~400 |
| PR-15 | pending | `lib/public/modules/app-messages.js` | app.js | ~1,300 |
| PR-16 | pending | `lib/public/modules/app-dm.js` | app.js | ~800 |
| PR-17 | pending | `lib/public/modules/app-home-hub.js` | app.js | ~500 |
| PR-18 | pending | `lib/public/modules/app-rate-limit.js` | app.js | ~400 |
| PR-19 | pending | `lib/public/modules/app-cursors.js` | app.js | ~500 |
| PR-20 | pending | (cleanup) | app.js | 0 (reduce to ~1,500) |
| **Phase 4: sidebar.js** | | | | |
| PR-21 | pending | `lib/public/modules/sidebar-sessions.js` | sidebar.js | ~1,200 |
| PR-22 | pending | `lib/public/modules/sidebar-projects.js` | sidebar.js | ~1,200 |
| PR-23 | pending | `lib/public/modules/sidebar-mates.js` | sidebar.js | ~700 |
| PR-24 | pending | `lib/public/modules/sidebar-mobile.js` | sidebar.js | ~800 |
| PR-25 | pending | (cleanup) | sidebar.js | 0 (reduce to ~400) |
| **Phase 5: scheduler.js** | | | | |
| PR-26 | pending | `lib/public/modules/scheduler-config.js` | scheduler.js | ~600 |
| PR-27 | pending | `lib/public/modules/scheduler-history.js` | scheduler.js | ~200 |
| PR-28 | pending | (cleanup) | scheduler.js | 0 (reduce to ~1,200) |
| **Phase 6: smaller modules** | | | | |
| PR-29 | pending | `lib/sdk-skill-discovery.js` | sdk-bridge.js | ~200 |
| PR-30 | pending | `lib/sdk-message-queue.js` | sdk-bridge.js | ~100 |
| PR-31 | pending | `lib/sdk-message-processor.js` | sdk-bridge.js | ~1,000 |
| PR-32 | pending | (cleanup) | sdk-bridge.js | 0 (reduce to ~900) |
| PR-33 | pending | `lib/mates-prompts.js` | mates.js | ~400 |
| PR-34 | pending | `lib/mates-knowledge.js` | mates.js | ~200 |
| PR-35 | pending | `lib/mates-identity.js` | mates.js | ~150 |
| PR-36 | pending | (cleanup) | mates.js | 0 (reduce to ~500) |
| PR-37 | pending | `lib/users-auth.js` | users.js | ~200 |
| PR-38 | pending | `lib/users-permissions.js` | users.js | ~100 |
| PR-39 | pending | `lib/users-preferences.js` | users.js | ~150 |
| PR-40 | pending | (cleanup) | users.js | 0 (reduce to ~300) |
| PR-41 | pending | `lib/daemon-projects.js` | daemon.js | ~200 |
| PR-42 | pending | `lib/ws-schema.js` | (new) | ~300 |

**Total: 42 PRs, ~30 new files created.**

---

## Design Principles

1. **Context object pattern**: Extracted modules receive a plain context object with the state and callbacks they need. They never import the parent coordinator. This prevents circular dependencies and makes each module independently comprehensible.

2. **No architecture redesign**: This is pure structural decomposition. No event bus, no dependency injection, no new abstractions. The code does exactly what it did before, but in files whose names describe their contents.

3. **One PR = one extraction**: Each PR is independently mergeable and revertable. If something breaks after PR-04, you know it was the loop extraction, not something from PR-01.

4. **Re-export until cleanup**: During extraction PRs, the original file re-exports moved functions. External call sites never change. The cleanup PR (PR-08, PR-13, PR-20, etc.) removes the boilerplate and makes the coordinator thin.

5. **File names are documentation**: After this work, `ls lib/` tells you the entire backend architecture. `ls lib/public/modules/` tells you the entire frontend architecture.

6. **Dependencies are shallow**: Do not block high-impact decomposition on low-impact prerequisites. project.js can be split while mates.js and users.js remain monolithic.

7. **Use `var`, not `const`/`let`**: Per project convention.

8. **Server-side: CommonJS (`require`). Client-side: ES modules (`import`)**: Per project convention.

---

## YOKE Preparation (SDK Extraction Readiness)

> Goal: During refactoring, establish boundaries that enable future extraction of a vendor-independent harness abstraction protocol (internally codenamed YOKE). The actual extraction to a separate repo happens when the second runtime adapter is added. For now, the goal is to make the codebase structurally ready.

### Background

SDK-dependent code spans 8 files with 54+ direct calls. The sdk-bridge.js monolith (2,424 lines) mixes connection management, message processing, skill discovery, and queue logic. Drawing abstraction interfaces over this tangled state would produce a bad public API. PR-29~32 decomposes sdk-bridge first, making the correct abstraction boundaries visible.

### Phases

| Phase | Action | When |
|-------|--------|------|
| 1 | Decompose sdk-bridge.js (PR-29~32) | Phase 6 of this roadmap |
| 2 | Wrap direct SDK calls in intermediate functions | During PR-29~32 |
| 3 | Document sdk-worker.js message protocol | PR-32 |
| 4 | Define interfaces + extract to separate repo | When adding second runtime (outside this roadmap) |

### Rules During Refactoring

**Rule 1: Wrap direct SDK calls in intermediate functions**

project-debate.js, project-mate-interaction.js, and project-memory.js call `ctx.sdk.createMentionSession()` directly. During refactoring, wrap these in semantically meaningful functions exposed by sdk-bridge. External modules should never call SDK methods directly. These intermediate functions become the future YOKE interface.

```js
// Before: modules call SDK directly
ctx.sdk.createMentionSession({ cwd, sessionId, model, ... })

// After: sdk-bridge exposes a meaningful function
ctx.sdk.startMentionTurn({ cwd, sessionId, model, ... })
// Internally calls createMentionSession, but callers don't know that
```

**Rule 2: Document sdk-worker.js message protocol**

The Unix domain socket + JSON-line protocol between sdk-bridge and sdk-worker carries structured messages. During PR-32, enumerate all message types as constants or a schema comment. This protocol may become the foundation for YOKE's cross-runtime message spec.

**Rule 3: Preserve the getSDK() factory pattern**

project.js dynamically imports the SDK via `getSDK()`. This is a natural runtime injection point. Maintain this pattern during refactoring. Where possible, migrate direct `require("@anthropic-ai/claude-agent-sdk")` in browser-mcp-server.js and debate-mcp-server.js to use this factory.

**Rule 4: Isolate MCP server SDK imports**

browser-mcp-server.js and debate-mcp-server.js directly require SDK-specific APIs (createSdkMcpServer, tool). These are inherently vendor-specific. Mark these files as "SDK adapter zone." They will be the first files to get runtime-specific variants when YOKE ships.

### SDK Dependency Map (for tracking)

| File | Dependency Type | Call Count | Wrap Target | Notes |
|------|----------------|------------|-------------|-------|
| project.js | ctx.sdk.* | ~25 | PR-04, PR-08 | startQuery, setModel, setPermissionMode, etc. |
| project-debate.js | ctx.sdk.* | 5 | PR-01 done, update in PR-31 | createMentionSession |
| project-mate-interaction.js | ctx.sdk.* | 4 | PR-03 | createMentionSession, checkToolWhitelist |
| project-memory.js | ctx.sdk.* | 3 | PR-02 | createMentionSession |
| browser-mcp-server.js | require direct | 3 | Isolate | SDK adapter zone |
| debate-mcp-server.js | require direct | 3 | Isolate | SDK adapter zone |
| server.js | pushModule | 4 | PR-09~13 | Push notifications |
| sessions.js | getSDK() | 1 | Keep pattern | renameSession |
