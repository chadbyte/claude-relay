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

## Phase 3: Widget System

**Goal**: Mates can create visual widgets using restricted HTML + Clay CSS classes. Widgets pull data from the project data store via a unified API.

### 3.1 Widget Definition Format

A widget is a JSON record stored per project:

```json
{
  "id": "widget_abc123",
  "project_slug": "moneta",
  "mate_id": "mate_xyz",
  "title": "Monthly Expense Summary",
  "size": "medium",
  "html": "<div class='clay-stat-card'>...</div>",
  "data_keys": ["monthly-expense", "budget-remaining"],
  "created_at": 1712700000,
  "updated_at": 1712700000
}
```

**Size options**: `small` (1x1), `medium` (2x1), `large` (2x2)

### 3.2 Restricted HTML Specification

**Allowed tags**:
```
div, span, p, h1, h2, h3, h4,
ul, ol, li,
table, thead, tbody, tr, th, td,
img, svg, canvas,
strong, em, code, pre, br, hr
```

**Blocked**:
- `<script>`, `<style>`, `<link>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`
- All event handler attributes (`onclick`, `onerror`, `onload`, ...)
- `javascript:` URLs
- External resource URLs (images must be data URIs or Clay-served)

**Allowed attributes**:
- `class` (only `clay-*` prefixed classes)
- `id` (only `widget-*` prefixed)
- `src` (only relative or data URI)
- `alt`, `title`, `colspan`, `rowspan`
- `data-*` attributes (for data binding)

**Sanitizer**: Server-side HTML sanitizer that strips everything not on the allowlist before storing. Double-sanitize on render.

### 3.3 Clay CSS Widget Classes

Clay provides a CSS class library that widgets use for consistent styling. All classes are prefixed with `clay-`.

**Layout**:
```css
.clay-row          /* flex row */
.clay-col          /* flex column */
.clay-grid-2       /* 2-column grid */
.clay-grid-3       /* 3-column grid */
.clay-gap-sm/md/lg /* gap sizes */
.clay-pad-sm/md/lg /* padding sizes */
```

**Components**:
```css
.clay-stat-card        /* big number + label */
.clay-stat-value       /* the number */
.clay-stat-label       /* the label */
.clay-stat-delta       /* change indicator (+/-) */

.clay-list             /* styled list */
.clay-list-item        /* list row */
.clay-list-label       /* left text */
.clay-list-value       /* right text */

.clay-table            /* styled table */
.clay-chart-container  /* wrapper for canvas charts */

.clay-badge            /* small tag/badge */
.clay-progress         /* progress bar */
.clay-progress-fill    /* inner fill */

.clay-text-sm/md/lg    /* font sizes */
.clay-text-muted       /* secondary text */
.clay-text-success     /* green */
.clay-text-warning     /* amber */
.clay-text-danger      /* red */
```

**Theming**: All `clay-*` classes respect the current Clay theme (light/dark) automatically via CSS variables. Widget authors do not handle theming.

**New file**: `lib/public/css/clay-widgets.css`

### 3.4 Data Binding in Widgets

Widgets reference data store keys via `data-*` attributes:

```html
<div class="clay-stat-card">
  <div class="clay-stat-value" data-bind="monthly-expense.total"></div>
  <div class="clay-stat-label">Total Spending</div>
</div>
```

The widget renderer:
1. Parses `data-bind` attributes
2. Fetches the referenced keys from data store API
3. Injects values into the DOM
4. Re-renders when `data_update` WebSocket messages arrive

This means the HTML is truly a template. Mates define the structure once; data flows in automatically.

### 3.5 Widget CRUD

**SDK tools for Mates**:
```
Tool: clay_widget_create
  title: "Monthly Expense Summary"
  size: "medium"
  html: "<div class='clay-stat-card'>..."
  data_keys: ["monthly-expense"]

Tool: clay_widget_update
  widget_id: "widget_abc123"
  html: "..."

Tool: clay_widget_delete
  widget_id: "widget_abc123"
```

**WebSocket messages**:
| Message | Direction | Description |
|---------|-----------|-------------|
| `widget_list` | client -> server | List widgets for a project |
| `widget_get` | client -> server | Get widget definition |
| `widget_create` | client -> server | Create widget (from UI builder) |
| `widget_update` | client -> server | Update widget |
| `widget_delete` | client -> server | Delete widget |

### 3.6 Widget Storage

Widgets stored in the same project SQLite database:

```sql
CREATE TABLE widgets (
  id TEXT PRIMARY KEY,
  mate_id TEXT,
  title TEXT NOT NULL,
  size TEXT DEFAULT 'medium',
  html TEXT NOT NULL,
  data_keys TEXT,              -- JSON array of key names
  created_at INTEGER,
  updated_at INTEGER
);
```

### 3.7 Deliverables

- [ ] HTML sanitizer (allowlist-based)
- [ ] `clay-widgets.css` class library
- [ ] Widget data binding renderer
- [ ] Widget CRUD module (`lib/project-widgets.js`)
- [ ] SDK tools for Mate widget creation
- [ ] Widget preview (in project view, before adding to Hub)

---

## Phase 4: Personalized Dashboard

**Goal**: Users select widgets from their projects and arrange them on Home Hub. The static hub becomes a fully personalized dashboard.

### 4.1 Hub Layout Data Model

Per-user layout stored in:

```
~/.clay/hub-layout/{userId}.json
```

```json
{
  "version": 1,
  "widgets": [
    {
      "widget_id": "widget_abc123",
      "project_slug": "moneta",
      "position": { "col": 0, "row": 0 },
      "size": "medium"
    },
    {
      "widget_id": "widget_def456",
      "project_slug": "weather",
      "position": { "col": 2, "row": 0 },
      "size": "small"
    }
  ]
}
```

### 4.2 Home Hub Redesign

**New layout structure**:

```
+--------------------------------------------------+
|  Greeting + Date                    [Bell] [Edit] |
+--------------------------------------------------+
|  Notification Center (collapsible)                |
|  [3 unread]  Task done in Moneta | DM from Rex   |
+--------------------------------------------------+
|  Widget Grid                                      |
|  +------------+ +------------+ +------+           |
|  | Moneta     | | Weather    | | Stock|           |
|  | Expense    | | Today      | | Port |           |
|  | Summary    | |            | |      |           |
|  +------------+ +------------+ +------+           |
|  +---------------------------+ +------+           |
|  | Moneta                    | | Quick|           |
|  | Weekly Trend Chart        | | Note |           |
|  +---------------------------+ +------+           |
+--------------------------------------------------+
```

**Edit mode**:
- Toggle via edit button
- Drag and drop to reorder
- Resize handles (small/medium/large)
- "Add widget" button opens widget picker
- Remove widget (X button)

### 4.3 Widget Picker

Modal that shows all available widgets across all projects:

```
+--------------------------------------------+
|  Add Widget                          [Close]|
+--------------------------------------------+
|  [Search...]                                |
|                                             |
|  Moneta                                     |
|    [+] Monthly Expense Summary    (medium)  |
|    [+] Category Breakdown         (medium)  |
|    [+] Budget Remaining           (small)   |
|                                             |
|  Weather                                    |
|    [+] Today's Forecast           (small)   |
|    [+] Weekly Outlook             (large)   |
+--------------------------------------------+
```

Grouped by project. Shows preview thumbnail. Click to add to Hub at next available position.

### 4.4 Real-time Updates

When a Mate updates data in any project:
1. `data_update` WebSocket message fires
2. Hub checks if any visible widget references that key
3. Widget re-renders with new data
4. Optional: subtle animation to indicate fresh data

### 4.5 Responsive Layout

- **Desktop**: 4-column grid
- **Tablet**: 2-column grid
- **Mobile**: 1-column stack, widgets reflow vertically
- Widget `size` maps to grid spans, not fixed pixel sizes

### 4.6 Backward Compatibility

Existing Hub content (Upcoming, Projects, This Week) becomes built-in system widgets that users can keep, move, or remove just like Mate widgets.

| Current Section | Becomes |
|----------------|---------|
| Upcoming | `system:upcoming` widget |
| Projects Summary | `system:projects` widget |
| This Week | `system:weekly-activity` widget |
| Quick Start | Removed after onboarding complete |
| Did you know? | Removed after onboarding complete |

### 4.7 Deliverables

- [ ] Hub layout storage and API
- [ ] Home Hub grid renderer
- [ ] Edit mode (drag, drop, resize, remove)
- [ ] Widget picker modal
- [ ] Real-time data update pipeline
- [ ] Responsive layout
- [ ] Migrate existing sections to system widgets
- [ ] Onboarding: default layout for new users

---

## Phase Summary

| Phase | Scope | Key Outcome |
|-------|-------|-------------|
| **1. Notification Center** | Small-medium | Users come to Home Hub regularly |
| **2. Project Data Store** | Medium | Mates have a place to put structured data |
| **3. Widget System** | Medium-large | Mates can create visual dashboards |
| **4. Personalized Dashboard** | Large | Users own their Home Hub layout |

### Dependencies

```
Phase 1 ─────────────────────────────> (independent, start first)

Phase 2 ──────> Phase 3 ──────> Phase 4
(data store)    (widgets)       (dashboard)
```

Phase 1 and Phase 2 can run in parallel. Phase 3 requires Phase 2. Phase 4 requires Phase 3.

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage engine | `node:sqlite` (Node 22 native) | Zero dependencies, file-based, native |
| Widget markup | Restricted HTML + Clay CSS | LLM-friendly, flexible, safe with sanitizer |
| Data access from widgets | HTTP API (`/api/data/:key`) | Widgets are sandboxed HTML, need fetch-based access |
| Data access from Mates | SDK tools (`clay_data_set/get`) | Mates operate through tool calls |
| Layout storage | JSON file per user | Simple, no DB overhead for layout config |
| Widget styling | `clay-*` CSS class system | Theme-aware, consistent look, dark/light auto |
| Notification storage | SQLite per user | Separate from project data, user-scoped |

---

## Open Questions

1. **Widget versioning**: When a Mate updates a widget's HTML, should old versions be kept? Or always overwrite?
2. **Shared widgets**: Can a user share their Hub layout with others? (Defer to post-v1)
3. **Widget refresh interval**: Should widgets poll for data, or purely push-based via WebSocket?
4. **Canvas/chart support**: Allow `<canvas>` for charts? If so, need a lightweight chart lib injected into widget sandbox.
5. **Widget permissions**: Can a widget in project A read data from project B? (Current answer: No. Keep project-scoped.)
6. **Offline behavior**: Should widgets show cached data when offline? (PWA consideration)


