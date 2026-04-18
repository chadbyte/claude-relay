# Module Map

> Where to put new code. Read this before adding features or message handlers.

---

## Architecture

`project.js` is a thin coordinator. It wires modules together and dispatches messages. All logic lives in dedicated modules following the `attachXxx(ctx)` pattern.

### Rules

1. **Never add inline logic to project.js handleMessage.** Find the right module and add it there.
2. **500 line limit per module.** If a module grows past 500 lines, split it.
3. **All new modules use the `attachXxx(ctx)` pattern.** Accept dependencies via ctx, return a public API object.
4. **Mutable state uses getters/setters in ctx.** Never capture a primitive that might change later.

---

## Server-side Modules (lib/)

### project.js (thin coordinator, ~1,200 lines)

Wires all modules, sets up session manager and SDK bridge, dispatches messages.

### Message Handler Modules

| Module | Message types | Concern |
|--------|--------------|---------|
| `project-knowledge.js` | `knowledge_list`, `knowledge_read`, `knowledge_save`, `knowledge_delete`, `knowledge_promote`, `knowledge_depromote` | Knowledge file CRUD for mates and projects |
| `project-sessions.js` | `new_session`, `switch_session`, `delete_session`, `rename_session`, `resume_session`, `fork_session`, `rewind_*`, `permission_response`, `elicitation_response`, `set_model`, `set_effort`, `set_thinking`, `set_betas`, `set_*_mode`, `browse_dir`, `add_project`, `create_project`, `clone_project`, `create_worktree`, `remove_project*`, `schedule_move`, `reorder_projects`, `set_project_title`, `set_project_icon`, `get_daemon_config`, `set_pin`, `set_keep_awake`, `set_auto_continue`, `set_image_retention`, `shutdown_server`, `restart_server`, `process_stats`, `stop`, `stop_task`, `kill_process`, `set_update_channel`, `check_update`, `update_now`, `ask_user_response`, `input_sync`, `cursor_*`, `text_select`, `push_subscribe`, `load_more_history`, `search_sessions`, `search_session_content`, `list_cli_sessions`, `set_session_visibility`, `transfer_project_owner`, `set_mate_dm` | Session lifecycle, config, project management, daemon settings, permissions, updates |
| `project-filesystem.js` | `fs_list`, `fs_read`, `fs_write`, `fs_watch`, `fs_unwatch`, `fs_file_history`, `fs_git_diff`, `fs_file_at`, `get_project_env`, `set_project_env`, `read_global_claude_md`, `write_global_claude_md`, `get_shared_env`, `set_shared_env` | File browser, file history, project env/settings |
| `project-user-message.js` | `message`, `note_*`, `term_*`, `context_sources_save`, `browser_tab_list`, `extension_result`, `loop_*` (delegation), `schedule_*`, `send_scheduled_now`, `cancel_scheduled_message` | User message dispatch, sticky notes, terminals, context sources, browser extension |
| `project-loop.js` | `loop_start`, `loop_stop`, `ralph_wizard_complete`, `ralph_wizard_cancel`, `ralph_cancel_crafting`, `ralph_preview_files`, `loop_registry_*`, `schedule_create`, `hub_schedules_list`, `delete_loop_group` | Loop/Ralph engine, loop registry, scheduling |
| `project-notifications.js` | `notification_mark_read`, `notification_mark_all_read`, `notification_delete`, `notification_clear_all` | Notification center persistence and CRUD |
| `project-debate.js` | (called from project.js) `debate_start`, `debate_stop`, `debate_comment`, `debate_conclude_response`, `debate_confirm_brief`, `debate_hand_raise`, `debate_user_floor_response` | Multi-agent debate engine |
| `project-mate-interaction.js` | (called from project.js) `mention`, `mention_stop` | @mention handling, DM digests |
| `project-memory.js` | `memory_list`, `memory_search`, `memory_delete` | Session digest memory |
| `project-mcp.js` | `mcp_servers_available`, `mcp_tool_result`, `mcp_tool_error`, `mcp_toggle_server` | Remote MCP server bridge via Chrome Extension |

### Infrastructure Modules

| Module | Concern |
|--------|---------|
| `project-connection.js` | WebSocket connection setup, initial state sync, session restore, presence |
| `project-http.js` | All HTTP routes: image serving, file upload, push, skills, git status, info |
| `project-image.js` | `hydrateImageRefs`, `saveImageFile`, image directory setup |
| `project-file-watch.js` | File and directory fs.watch wrappers |
| `sdk-bridge.js` | SDK bridge coordinator: createSDKBridge factory, worker lifecycle, query stream, tool permissions, mention sessions |
| `sdk-skill-discovery.js` | Skill directory scanning, shell segment splitting, SDK/filesystem skill merging |
| `sdk-message-queue.js` | Async iterable message queue for streaming input to SDK |
| `sdk-message-processor.js` | SDK stream event processing (message_start, content_block_*), sub-agent message routing |
| `mates.js` | Mate CRUD, builtin mate management, atomic section enforcement, migration |
| `mates-prompts.js` | System section enforcers (team, session memory, sticky notes, project registry, debate), marker constants |
| `mates-knowledge.js` | Common knowledge registry (promote/depromote, cross-mate file sharing) |
| `mates-identity.js` | Identity extraction, backup/restore, change tracking, primary capabilities |
| `users.js` | User CRUD, invites, profile/PIN update, storage, Linux user integration |
| `users-auth.js` | Authentication, PIN hashing, auth tokens, multi-user mode, setup codes |
| `users-permissions.js` | RBAC permissions, project/session access control |
| `users-preferences.js` | DM favorites/hidden, auto-continue, chat layout, deleted builtin keys, mate onboarding |
| `daemon-projects.js` | Worktree tracking (scan, rescan, cleanup), removed project filtering |
| `ws-schema.js` | WebSocket message type registry (328 message types, informational) |

### Server Modules (lib/server-*.js)

server.js is a thin router. It wires all server modules, sets up HTTP/WS, and dispatches requests.

| Module | Routes | Concern |
|--------|--------|---------|
| `server-auth.js` | `/auth`, `/auth/setup`, `/auth/login`, `/auth/request-otp`, `/auth/verify-otp`, `/auth/register`, `/auth/logout`, `/invite/*`, `/recover/*` | PIN auth, multi-user login, OTP, invite registration, admin recovery, rate limiting |
| `server-admin.js` | `/api/admin/users*`, `/api/admin/invites*`, `/api/admin/smtp*`, `/api/admin/projects/*/visibility`, `/api/admin/projects/*/owner`, `/api/admin/projects/*/users`, `/api/admin/projects/*/access` | User CRUD, permissions, invites, SMTP config, project access control |
| `server-skills.js` | `/api/skills`, `/api/skills/search`, `/api/skills/detail` | Skills proxy cache, leaderboard, search, detail page scraping |
| `server-settings.js` | `/api/profile`, `/api/avatar/*`, `/api/mate-avatar/*`, `/api/user/pin`, `/api/user/auto-continue`, `/api/user/chat-layout`, `/api/user/mate-onboarded` | User profile, avatars, user preferences |
| `server-palette.js` | `/api/palette/search` | Cross-project session search (recent + BM25 ranked) |
| `server-dm.js` | WS: `dm_list`, `dm_open`, `dm_typing`, `dm_send`, `dm_add_favorite`, `dm_remove_favorite` | Cross-project DM messaging, typing indicators, push notifications |
| `server-mates.js` | WS: `mate_create`, `mate_list`, `mate_delete`, `mate_update`, `mate_readd_builtin`, `mate_list_available_builtins` | Mate CRUD, builtin mate management, team section enforcement |

### Where to add a new server HTTP endpoint

1. Identify which concern it belongs to (auth? admin? skills? settings?)
2. Add the handler in the matching module's `handleRequest` function
3. If no module fits, add it directly in `server.js` appHandler or create a new `server-*.js` module

### Where to add a new message type

1. Identify which concern it belongs to (session mgmt? filesystem? loop? etc.)
2. Add the handler in the matching module's `handleXxxMessage` function
3. If no module fits, create a new one following the `attachXxx(ctx)` pattern
4. Wire it in project.js with a single `if (module.handleXxxMessage(ws, msg)) return;` line

### Where to add a new HTTP endpoint

Add it in `project-http.js` inside the `handleHTTP` function.

---

## Client-side Modules (lib/public/modules/)

### app.js (bootstrap coordinator, ~1,100 lines)

Bootstraps UI, initializes store, wires remaining Tier 3 modules. All business logic lives in modules. See [NO-GOD-OBJECTS.md](./NO-GOD-OBJECTS.md) for architectural principles.

| Module | Concern |
|--------|---------|
| `app-connection.js` | WebSocket creation, reconnect with exponential backoff, connection status UI, disconnect/restore notifications |
| `app-messages.js` | WebSocket message router (`processMessage`). Dispatches all incoming message types to appropriate handlers |
| `app-dm.js` | DM mode (open/enter/exit), mate project switching, mate onboarding, DM message rendering, typing indicators |
| `app-home-hub.js` | Home hub rendering, weather, tip rotation, upcoming schedules, project summary |
| `app-rate-limit.js` | Rate limit UI, countdown timers, scheduled message bubbles, fast mode indicator |
| `app-cursors.js` | Remote cursor presence, text selection sharing, cursor toggle UI |
| `app-rendering.js` | Message rendering, streaming, scroll management, pre-thinking dots, suggestion chips, system messages |
| `app-projects.js` | Project list, switching, add/remove project modals, update available pill, topbar presence |
| `app-panels.js` | Config chip (model/mode/effort/thinking/beta), usage panel, status panel, context panel, context popover |
| `app-loop-ui.js` | Ralph Loop UI: bars, banners, preview modal, execution modal |
| `app-loop-wizard.js` | Ralph Loop wizard: step navigation, mode/authorship selection, data collection |
| `app-notifications.js` | Notification center panel, badge, rendering, click-to-navigate |
| `app-debate-ui.js` | Debate sticky banner, floor/conclude/ended modes, bottom bar, hand raise |
| `app-skills-install.js` | Skill install dialog, requireSkills, requireClayMateInterview |
| `app-favicon.js` | Dynamic favicon, IO blink, urgent blink, send button mode, activity indicator |
| `app-header.js` | Session rename, session info popover, progressive history loading |
| `app-misc.js` | Image/paste/confirm modals, force PIN overlay, PWA install, Chrome extension bridge |
| `sidebar.js` | Sidebar coordinator: init, open/close, page title, panel switching, collapse/expand, resize handle, dust particles |
| `sidebar-sessions.js` | Session list rendering, search/filter, loop groups, inline rename, context menus, presence avatars, countdown timers, CLI session picker, unread badges |
| `sidebar-projects.js` | Project icon strip, context menus, emoji picker, drag-and-drop reorder, worktree modal, project access popover, project rename, project badges |
| `sidebar-mates.js` | User/mate icon strip, DM picker, user/mate context menus, icon strip tooltips, sidebar presence, DM badges, DM user state |
| `sidebar-mobile.js` | Mobile sheet overlays (projects, sessions, mate profile, search, tools, settings), mobile tab bar, drag-to-dismiss, mobile loop groups, mobile session rendering |
| `scheduler.js` | Scheduler coordinator: init, open/close, calendar views (month/week), detail view, crafting mode, sidebar task list, cron utilities |
| `scheduler-config.js` | Schedule create/edit modal, delete dialog, cron builder, recurrence/interval UI, calendar date picker, preview events |
| `scheduler-history.js` | Run history rendering, schedule event message handlers (registry updates, run started/finished, loop scheduled) |

---

## Extraction Pattern Reference

```js
// lib/project-example.js
var fs = require("fs");

function attachExample(ctx) {
  var cwd = ctx.cwd;
  var send = ctx.send;

  // Module-private state
  var counter = 0;

  function handleExampleMessage(ws, msg) {
    if (msg.type === "example_increment") {
      counter++;
      send({ type: "example_count", count: counter });
      return true;
    }
    return false; // not handled
  }

  return {
    handleExampleMessage: handleExampleMessage,
  };
}

module.exports = { attachExample: attachExample };
```

---

## See Also

- [STATE_CONVENTIONS.md](./STATE_CONVENTIONS.md) for state management rules
- [CLIENT_MODULE_DEPS.md](./CLIENT_MODULE_DEPS.md) for client-side dependency rules (store.js, ws-ref.js, direct imports)
- [NO-GOD-OBJECTS.md](./NO-GOD-OBJECTS.md) for architectural principles (why and how we keep modules small)
- [REFACTORING_ROADMAP.md](../roadmaps/completed/REFACTORING_ROADMAP.md) for decomposition history
