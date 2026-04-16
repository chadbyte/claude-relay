# State Management Conventions

> These conventions apply to all module extractions in the [Refactoring Roadmap](./REFACTORING_ROADMAP.md) and to any new modules created afterward.

---

## Current State Diagnosis

Five different state patterns coexist in the codebase today:

| Pattern | Where | Problem |
|---------|-------|---------|
| **Closure variables** | project.js (`clients`, `fileWatcher`, `loopState`, etc.) | 50+ functions share one 6,000-line closure scope. Hard to trace who reads/writes what |
| **Session property bag** | sdk-bridge.js (`session._queryStartTs`, `session.blocks`, `session.pendingPermissions`, 15+ more) | No schema. Anyone can attach any property with an underscore prefix |
| **Module-level globals** | app.js (30+ variables), server.js (`multiUserTokens`, `pinAttempts`) | Client side is worst. 30 globals mutated freely by any event handler |
| **File-based load/save** | mates.js, users.js | Clean. No issues. Keep this pattern |
| **Context object passing** | `createProjectContext` return value | Right idea, but state and functions are mixed together in one bag |

---

## Three Principles

### 1. Extracted modules own their own state

When a module is extracted, any state it needs exclusively moves into its `attach*()` closure. Shared dependencies come in through the `ctx` parameter.

```js
// project-memory.js
function attachMemory(ctx) {
  // Module-private state: declared here, not in project.js
  var digestCache = null;
  var lastSummaryTs = 0;

  // Shared dependencies: received via ctx, never imported from parent
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var sm = ctx.sm;

  function gateMemory(ws, msg) {
    // uses digestCache (own state) and sm (shared dependency)
  }

  return { gateMemory: gateMemory, /* ... */ };
}
```

**Rule**: If a `var` in project.js is only used by functions moving to the new module, it moves with them. If it is shared, it stays in project.js and gets passed via ctx.

### 2. Session properties are namespaced by module

Instead of flat properties on the session object, group them by the module that owns them.

```js
// Before (flat, no schema)
session._queryStartTs = Date.now();
session.blocks = [];
session._mentionSessions = new Map();
session.pendingPermissions = null;

// After (namespaced by owning module)
session.sdk = { queryStartTs: null, blocks: [], firstTextLogged: false };
session.mentions = { sessions: new Map(), inProgress: false };
session.stream = { preview: "", text: false, inputTokens: 0 };
session.permissions = { pending: null };
```

**Rule**: Apply this incrementally. When extracting a module, namespace the session properties that module uses. Do not refactor session properties belonging to other modules.

### 3. Client-side state moves with its module

When app.js and sidebar.js are split (Phase 3, Phase 4), each extracted module takes its related globals.

```js
// Before: app.js top-level
var cachedDmConversations = null;
var cachedDmUnread = {};
var currentDmUserId = null;

// After: app-dm.js owns these
function initDm(ctx) {
  var conversations = null;
  var unread = {};
  var currentUserId = null;
  // ...
}
```

**Rule**: Do not touch app.js globals until Phase 3. When Phase 3 starts, each extracted module owns the globals it needs.

---

## Phase-by-Phase Application

| Phase | Files | State work |
|-------|-------|------------|
| Phase 1 (PR-02 to PR-08) | project.js | Move closure variables into extracted modules. By PR-08, project.js should only hold variables needed for coordination (clients, sm, send) |
| Phase 2 (PR-09 to PR-13) | server.js | Move `multiUserTokens` and `pinAttempts` into server-auth.js. Move `skillsCache` into server-skills.js |
| Phase 3 (PR-14 to PR-20) | app.js | Split 30+ globals into module-owned state. Each PR takes its related variables |
| Phase 4 (PR-21 to PR-25) | sidebar.js | Same pattern as Phase 3 |
| Phase 5 (PR-29 to PR-32) | sdk-bridge.js | Namespace all session properties. Define clear init/cleanup for each namespace |
| Phase 6 (PR-33 to PR-42) | mates, users, daemon | Already clean (file-based). Minor moves only |

---

## Session Property Registry

Track which module owns which session properties. Update this table as modules are extracted.

| Namespace | Owner module | Properties | Status |
|-----------|-------------|------------|--------|
| `session.sdk` | sdk-bridge (PR-43) | `queryStartTs`, `blocks`, `firstTextLogged`, `lastStreamInputTokens`, `responsePreview`, `sentToolResults`, `streamedText` | pending |
| `session.mentions` | sdk-bridge (PR-43) | `sessions` (Map), `inProgress` | pending |
| `session.permissions` | sdk-bridge (PR-43) | `pending` | pending |
| `session.worker` | sdk-bridge (PR-44) | `process`, `exitPromise`, `cliSessionId` | pending |
| `session.queue` | sdk-message-queue (PR-44) | `messages`, `abortController` | pending |
| `session.dm` | sdk-bridge | `responseText` | pending |
| `session.loop` | project-loop (PR-04) | (existing `session.loop` object) | pending |

> This table is provisional. Exact property names will be finalized during each PR.

---

## What NOT to do

- **Do not introduce a state management library or framework.** The closure + ctx pattern is sufficient for this codebase size.
- **Do not refactor state across module boundaries in one PR.** Each PR only touches state for the functions it extracts.
- **Do not rename existing session properties until the owning module is extracted.** Renaming before extraction creates unnecessary churn.
- **Do not add getter/setter wrappers around state.** Direct property access is fine. The goal is ownership clarity, not access control.
