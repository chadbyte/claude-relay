# Home Hub Evolution Roadmap

> Transforming Home Hub from a static landing page into a personalized, widget-driven dashboard powered by Mate data.

**Created**: 2026-04-10
**Status**: Planning

---

## Vision

Every user gets a personalized Home Hub composed of widgets that their Mates provide. Mates collect and update data; widgets visualize it; users choose what to see. The chat interface remains for conversation, while the dashboard becomes the "at a glance" layer.

---

## Current State

Home Hub today is a static page with:
- Greeting + date
- Mates list
- Upcoming schedules (from loop/Ralph)
- Projects summary
- Weekly activity strip
- Quick Start playbooks
- Rotating tips

No dynamic data from Mates. No user customization. No unified notification center.

**Relevant files**:
- `lib/public/index.html` (lines 116-176): Home Hub DOM
- `lib/public/css/home-hub.css`: Hub styles
- `lib/public/app.js`: Hub initialization logic
- `lib/public/modules/notifications.js`: Current push/notification system
- `lib/push.js`: Server-side push infrastructure

---

## Phase 1: Notification Center

**Goal**: Unify all notifications into a single inbox on Home Hub. Build the habit of users visiting Home Hub regularly. Lay groundwork for mobile push consolidation.

### 1.1 Notification Data Model

Create a per-user notification store.

```
~/.clay/notifications/{userId}.db   (SQLite via node:sqlite)
```

**Schema**:
```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,          -- nanoid
  project_slug TEXT NOT NULL,   -- which project it came from
  mate_id TEXT,                 -- which mate triggered it (nullable)
  type TEXT NOT NULL,           -- 'task_done' | 'ask_user' | 'error' | 'dm' | 'schedule' | 'mention'
  title TEXT NOT NULL,
  body TEXT,
  read INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER            -- optional TTL
);

CREATE INDEX idx_notif_user_read ON notifications(read, created_at);
CREATE INDEX idx_notif_project ON notifications(project_slug);
```

### 1.2 Server: Notification Module

New module: `lib/project-notifications.js` following `attachNotifications(ctx)` pattern.

**Responsibilities**:
- Write notifications when events occur (task done, ask_user, error, DM, schedule fire)
- Serve notification list via WebSocket messages
- Mark read/unread, delete, bulk clear
- Consolidate with existing `lib/push.js` for mobile push

**Message types**:
| Message | Direction | Description |
|---------|-----------|-------------|
| `notifications_list` | client -> server | Request notification list (with pagination) |
| `notifications_update` | server -> client | Push new/updated notifications |
| `notification_read` | client -> server | Mark one or all as read |
| `notification_delete` | client -> server | Delete notification(s) |
| `notification_clear` | client -> server | Clear all read notifications |

**Integration points** (existing code that should emit notifications):
- `project-loop.js`: When a scheduled task completes or fails
- `project-mate-interaction.js`: When a DM or @mention response arrives
- `project-user-message.js`: When ask_user fires
- `daemon.js`: When a background process errors out

### 1.3 Client: Notification Center UI

**Location**: Top area of Home Hub, always visible.

**Components**:
- Bell icon with unread badge (in title bar, visible from any view)
- Notification panel in Home Hub:
  - Grouped by project
  - Each item: icon + project name + title + relative time
  - Click to navigate to that project/session
  - Swipe or button to dismiss
- Filter: All / Unread / By project

**New files**:
- `lib/public/modules/notification-center.js`: UI logic
- `lib/public/css/notification-center.css`: Styles

### 1.4 Push Consolidation

Refactor `lib/push.js` and `lib/public/modules/notifications.js`:
- All push notifications flow through the notification store first
- Push payload references notification ID so clicking opens the right item
- Deduplicate: if user is viewing Home Hub, suppress push for that notification

### 1.5 Deliverables

- [ ] `node:sqlite` wrapper utility (`lib/store.js`)
- [ ] `lib/project-notifications.js` module
- [ ] Wire into `project.js` message dispatch
- [ ] Notification center UI on Home Hub
- [ ] Bell icon with badge in title bar
- [ ] Push consolidation refactor
- [ ] Mobile push opens notification center

---

## Phase 2: Mate Datastore

> **Moved to separate roadmap**: See [MATE-DATASTORE.md](./MATE-DATASTORE.md)

Datastores are per-Mate, not per-project. Mates persist structured data in their own SQLite database at `~/.clay/mates/{userId}/{mateId}/store.db`. Widgets in Phase 3 read from Mate datastores.

---

## Phase 3 & 4: Mate Canvas + Home Hub Dashboard

> **Replaced by Mate MVC architecture.** See:
> - [MATE-DATASTORE.md](./MATE-DATASTORE.md) -- the M (data persistence)
> - [MATE-CANVAS.md](./MATE-CANVAS.md) -- the V (visual canvases)

Each Mate owns its data (Datastore) and its views (Canvases). Home Hub becomes an aggregator of promoted canvases from across the user's Mates. No separate widget system needed.

```
Mate Datastore (M) -> Mate Canvas (V) -> promote -> Home Hub (aggregator)
                       Mate AI (C) manages both
```

Home Hub = Greeting + Notifications + Promoted Canvases + drag-and-drop layout.

---

## Phase Summary

| Phase | Scope | Key Outcome |
|-------|-------|-------------|
| **1. Notification Center** | Small-medium | Users come to Home Hub regularly |
| **2. Mate Datastore** | Medium | Mates persist structured data (see MATE-DATASTORE.md) |
| **3. Mate Canvas** | Medium | Mates create visual dashboards (see MATE-CANVAS.md) |
| **4. Home Hub Dashboard** | Small | Promote canvases to Home Hub grid layout |

### Dependencies

```
Phase 1 ──────────────────────────────> (independent, start first)

Mate Datastore ──> Mate Canvas ──> Home Hub Dashboard
    (M)                (V)           (aggregator)
```

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage engine | `node:sqlite` (Node 22 native) | Zero dependencies, file-based, native |
| Canvas markup | Restricted HTML + Clay CSS | LLM-friendly, flexible, safe with sanitizer |
| Data ownership | Per-Mate, not per-project | Mates are the entities that persist state |
| Home Hub role | Canvas aggregator | No separate widget system, just references to Mate canvases |
| Layout storage | JSON file per user | Simple, no DB overhead for layout config |
| Canvas styling | `clay-*` CSS class system | Theme-aware, consistent look, dark/light auto |
| Notification storage | SQLite per user | Separate from Mate data, user-scoped |

---

## Open Questions

1. **Shared canvases**: Can a user share their Hub layout with others? (Defer to post-v1)
2. **Canvas refresh**: Push-based via WebSocket (preferred) or polling?
3. **Chart support**: Allow `<canvas>` element for chart.js? Inject lightweight chart lib into sandbox?
4. **Offline behavior**: Should canvases show cached data when offline? (PWA consideration)


