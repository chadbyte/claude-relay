# Mate Canvas

> The V in Mate MVC. Each Mate owns visual canvases that display data from its Datastore. A canvas is a single self-contained `.canvas` file with markup, style, logic, and data schema. Canvases live in the Mate, visible in DM. Users promote canvases to Home Hub.

**Created**: 2026-04-17
**Status**: Planning

---

## Architecture: ABCD Pattern

**AI Binding for Canvas and Datastore**

```
A  AI           Mate. Collects data, creates/updates Canvases.
B  Binding      Clay Protocol. postMessage bridge between Canvas and Datastore.
C  Canvas       Single-file visual components (.canvas files).
D  Datastore    Per-Mate SQLite DB. Structured data persistence.
```

Data flow follows ABCD:

```
A (Mate collects data)
  -> D (Datastore stores it)
  -> B (Binding detects change, delivers via protocol)
  -> C (Canvas renders)
```

Reverse flow (user interaction in Canvas):

```
C (user clicks filter in Canvas)
  -> B (clay:query protocol)
  -> D (Datastore query)
  -> B (clay:query-result)
  -> C (re-render)
```

The Mate is a self-contained unit: it owns its data (D), its views (C), and the intelligence to manage both (A). The Binding (B) is the glue. Home Hub is not a separate system. It is a curated collection of promoted canvases from across the user's Mates.

---

## Canvas File Format

A canvas is a single `.canvas` file (HTML-based) that contains everything needed to render, connect to data, and be shared:

```
~/.clay/mates/{userId}/{mateId}/canvases/monthly-expense.canvas
```

### Complete Example

```html
<clay-canvas>
  <!-- Metadata -->
  <meta name="title" content="Monthly Spending Trend">
  <meta name="size" content="medium">
  <meta name="description" content="Visualizes monthly expenses with trend chart and category breakdown">

  <!-- Data Schema: declares what data this canvas needs -->
  <!-- This is the contract between M (Datastore) and V (Canvas) -->
  <clay-schema collection="expenses">
    {
      "description": "Monthly expense records",
      "fields": {
        "date": { "type": "string", "description": "YYYY-MM format" },
        "total": { "type": "number", "description": "Total amount spent" },
        "currency": { "type": "string", "default": "KRW" },
        "categories": {
          "type": "array",
          "items": {
            "name": { "type": "string" },
            "amount": { "type": "number" }
          }
        }
      },
      "example": {
        "date": "2026-04",
        "total": 320000,
        "currency": "KRW",
        "categories": [{ "name": "Food", "amount": 150000 }]
      }
    }
  </clay-schema>

  <clay-schema collection="budgets">
    {
      "description": "Monthly budget targets",
      "fields": {
        "month": { "type": "string" },
        "limit": { "type": "number" }
      },
      "example": { "month": "2026-04", "limit": 500000 }
    }
  </clay-schema>

  <!-- Styles (scoped to this canvas) -->
  <style>
    .total { font-size: 32px; font-weight: 700; color: var(--text); }
    .label { font-size: 13px; color: var(--text-dimmer); margin-top: 4px; }
    .chart { width: 100%; height: 200px; margin-top: 16px; }
    .over-budget { color: var(--error); }
  </style>

  <!-- Markup -->
  <div class="total" id="total">--</div>
  <div class="label">Total spending this month</div>
  <canvas class="chart" id="chart"></canvas>

  <!-- Logic -->
  <script>
    // Clay runtime is auto-injected. Provides Clay.on(), Clay.query(), Clay.resize()

    Clay.on("data", function (bindings) {
      // Called on initial load and whenever bound data changes
      // bindings = { expenses: [...docs], budgets: [...docs] }
      var expenses = bindings.expenses || [];
      var budgets = bindings.budgets || [];

      var currentMonth = expenses.find(function (e) { return e.data.date === "2026-04"; });
      var budget = budgets.find(function (b) { return b.data.month === "2026-04"; });

      var totalEl = document.getElementById("total");
      if (currentMonth) {
        totalEl.textContent = currentMonth.data.total.toLocaleString() + " " + (currentMonth.data.currency || "KRW");
        if (budget && currentMonth.data.total > budget.data.limit) {
          totalEl.classList.add("over-budget");
        }
      }
    });

    Clay.on("theme", function (vars) {
      // vars = { "--bg": "#282a36", "--text": "#f0f1f4", "--accent": "#ffb86c", ... }
      // CSS variables are already injected into :root, but available here for JS use
    });

    Clay.resize(280);
  </script>
</clay-canvas>
```

### File Structure

| Element | Required | Purpose |
|---------|----------|---------|
| `<clay-canvas>` | Yes | Root wrapper |
| `<meta name="title">` | Yes | Display name |
| `<meta name="size">` | No | `small` / `medium` / `large` (default: medium) |
| `<meta name="description">` | No | Human-readable description |
| `<clay-schema>` | No | Data contract per collection (enables sharing) |
| `<style>` | No | Scoped CSS (can use Clay CSS variables) |
| HTML body | Yes | Markup |
| `<script>` | No | Logic (Clay runtime API available) |

A canvas without `<clay-schema>` and `<script>` is just static HTML. That is valid. Complexity is opt-in.

---

## Clay Runtime Protocol

Canvases run inside an `<iframe sandbox="allow-scripts">`. The Clay runtime (`clay-canvas-runtime.js`) is auto-injected and provides the communication bridge via postMessage.

### Parent -> Canvas Messages

| Type | Payload | When |
|------|---------|------|
| `clay:data` | `{ bindings: { collection: [...docs] } }` | Initial load + on Datastore change |
| `clay:theme` | `{ vars: { "--bg": "...", "--text": "...", ... } }` | Initial load + on theme change |

### Canvas -> Parent Messages

| Type | Payload | When |
|------|---------|------|
| `clay:ready` | `{}` | Canvas finished loading, ready for data |
| `clay:resize` | `{ height: 300 }` | Canvas requests container height change |
| `clay:query` | `{ requestId, collection, query }` | Canvas actively queries Datastore |
| `clay:navigate` | `{ collection }` | Request to open Data Inspector for this collection |

### Parent -> Canvas (Query Response)

| Type | Payload | When |
|------|---------|------|
| `clay:query-result` | `{ requestId, data: [...docs] }` | Response to `clay:query` |

### Clay Runtime API (available inside canvas `<script>`)

```js
// Receive data (push-based, automatic from bindings)
Clay.on("data", function (bindings) { ... });

// Receive theme updates
Clay.on("theme", function (vars) { ... });

// Request container resize
Clay.resize(heightInPx);

// Active query (pull-based, for interactive filtering)
Clay.query("expenses", { date: "2026-04" }).then(function (docs) { ... });

// Open data inspector for a collection
Clay.inspect("expenses");
```

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│ Push (automatic):                                       │
│                                                         │
│ Datastore change -> Clay checks canvas bindings         │
│                  -> clay:data sent to matching canvases  │
│                  -> Canvas re-renders                    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Pull (interactive):                                     │
│                                                         │
│ User clicks filter in Canvas                            │
│   -> Canvas sends clay:query                            │
│   -> Clay queries Datastore                             │
│   -> clay:query-result sent back                        │
│   -> Canvas re-renders with filtered data               │
└─────────────────────────────────────────────────────────┘
```

---

## iframe Sandbox

Each canvas renders in a sandboxed iframe:

```html
<iframe
  sandbox="allow-scripts"
  srcdoc="
    <html>
    <head>
      <style>:root { ${themeVarsAsCss} }</style>
      <script src='clay-canvas-runtime.js'></script>
    </head>
    <body>
      ${canvasBodyContent}
    </body>
    </html>
  "
></iframe>
```

**Sandboxed** (blocked by `sandbox="allow-scripts"` without other flags):
- No parent DOM access
- No cookies, localStorage
- No form submissions
- No popups, navigation
- No top-level navigation

**Allowed**:
- JavaScript execution (for charts, interactivity)
- Canvas 2D/WebGL (for Chart.js, D3, etc.)
- CSS animations
- postMessage communication (Clay protocol only)

---

## Data Schema as Contract

`<clay-schema>` serves three purposes:

### 1. Mate Instructions

When a Mate adopts a canvas (e.g., imported from someone else), it reads the schema to understand what data to produce:

```
Mate reads canvas file
  -> Finds <clay-schema collection="expenses">
  -> Understands: "I need to create an 'expenses' collection with date, total, currency, categories fields"
  -> Starts collecting and storing data in the right shape
```

### 2. Validation

Clay can validate Datastore writes against the schema:
- Warn (not block) if a document is missing required fields
- Auto-fill defaults from schema

### 3. Sharing

When a user shares a `.canvas` file:

```
Share monthly-expense.canvas
  -> Recipient's Mate reads <clay-schema>
  -> Mate knows exactly what data to produce
  -> Canvas works immediately once data flows in
```

No external documentation needed. The schema is inline.

---

## Usage Scenarios

### 1. Start without canvas, add later

```
Week 1: User asks Moneta to track expenses
  -> Moneta stores data in Datastore (no canvas yet)

Week 3: User asks "show me a chart of my spending"
  -> Moneta reads existing Datastore structure
  -> Creates a .canvas file with matching <clay-schema>
  -> Canvas renders with existing data immediately
```

### 2. Simple static canvas, then add data

```
User asks Mate to create a simple status display
  -> Mate creates .canvas with just HTML + CSS (no schema, no script)
  -> Static content displayed

Later, user wants live data
  -> Mate adds <clay-schema> + <script> with Clay.on("data")
  -> Canvas becomes data-driven
```

### 3. Import someone else's canvas

```
User downloads budget-tracker.canvas from a friend
  -> Drops it into Mate's canvases directory (or imports via UI)
  -> Mate reads <clay-schema>: needs "expenses" and "budgets" collections
  -> Mate starts collecting data in the declared shape
  -> Canvas renders as data comes in
  -> Example data from schema can be used for preview before real data exists
```

---

## SDK Tools

```
Tool: clay_canvas_create
  filename: "monthly-expense"
  content: "<clay-canvas>...</clay-canvas>"

Tool: clay_canvas_update
  filename: "monthly-expense"
  content: "<clay-canvas>...</clay-canvas>"

Tool: clay_canvas_delete
  filename: "monthly-expense"

Tool: clay_canvas_list
  (lists all .canvas files owned by this Mate)

Tool: clay_canvas_read
  filename: "monthly-expense"
  (returns full .canvas file content)
```

The Mate writes the entire `.canvas` file as a single unit. No partial updates. This keeps the file always self-consistent.

---

## Canvas Lifecycle

A canvas starts as an inline artifact in chat and can optionally be saved as a persistent Mate canvas.

### Flow

```
User asks for something visual
  -> Mate generates canvas HTML
  -> Canvas appears inline in chat (ephemeral)
  -> User can interact, ask for refinements
  -> Mate updates the canvas in-place
  -> If one-off: conversation ends, canvas stays in chat history only
  -> If useful: user clicks "Save to Canvases"
     -> Saved to ~/.clay/mates/{userId}/{mateId}/canvases/
     -> Appears in Mate's canvas registry
     -> Can be promoted to Home Hub
```

### Where Canvases Appear

| Location | What shows | How |
|----------|-----------|-----|
| Chat inline | Ephemeral canvas during conversation | Mate generates via `clay_canvas_render` |
| Side panel | Canvas viewer (like file preview) | Click to expand inline canvas |
| Mate Canvas Registry | All saved canvases | Sidebar panel in Mate DM |
| Home Hub | Promoted canvases | User pins from registry |

### Inline Canvas (Ephemeral)

During conversation, Mate renders a canvas directly in the chat stream. This is similar to how Claude Desktop's visualize feature works: the canvas appears between messages, not in a separate panel.

```
User: "Show me my spending this month"

Mate: "Here's your April spending breakdown:"

┌──────────────────────────────────┐
│  Monthly Spending   April 2026   │
│  ┌─────────────────────────┐     │
│  │ ████████████  320,000   │     │
│  │ ████████     210,000    │     │
│  │ █████        150,000    │     │
│  └─────────────────────────┘     │
│              [Open in Panel]     │
│              [Save to Canvases]  │
└──────────────────────────────────┘

Mate: "Food is the biggest category at 320K. Want me to break it down further?"

User: "Add a comparison with last month"

Mate: [updates the same canvas inline with comparison data]
```

**Inline canvas actions:**
- **Open in Panel**: Opens the canvas in a side panel viewer (larger view, better for complex charts)
- **Save to Canvases**: Persists to Mate's canvas directory, registers in Mate's canvas list
- **Refine**: User asks Mate to modify, Mate updates in-place

### Side Panel Viewer

Clicking "Open in Panel" shows the canvas in a right-side panel (same pattern as file preview). The panel provides:
- Full-size rendering
- Canvas title and metadata
- Save/Pin actions
- Close button

### Saved Canvas (Persistent)

Once saved, the canvas:
- Lives in `~/.clay/mates/{userId}/{mateId}/canvases/{filename}.canvas`
- Appears in the Mate's canvas registry (sidebar panel when in Mate DM)
- Can connect to Datastore via `<clay-schema>` bindings
- Auto-updates when Datastore data changes
- Can be promoted to Home Hub

### Promote to Home Hub

From the canvas registry or side panel:

```
Canvas actions: [Open] [Edit] [Pin to Home Hub] [Delete]
```

Home Hub layout stores references, not copies:

```json
{
  "canvases": [
    { "mateId": "mate_moneta", "filename": "monthly-expense", "position": { "col": 0, "row": 0 } },
    { "mateId": "mate_weather", "filename": "forecast", "position": { "col": 2, "row": 0 } }
  ]
}
```

---

## SDK Tools

### Ephemeral (inline chat)

```
Tool: clay_canvas_render
  html: "<clay-canvas>...</clay-canvas>"
```

Renders a canvas inline in the chat. Ephemeral (not saved). The user sees it immediately. Mate can call this multiple times to update/replace the inline canvas.

### Persistent (saved)

```
Tool: clay_canvas_save
  filename: "monthly-expense"
  content: "<clay-canvas>...</clay-canvas>"

Tool: clay_canvas_update
  filename: "monthly-expense"
  content: "<clay-canvas>...</clay-canvas>"

Tool: clay_canvas_delete
  filename: "monthly-expense"

Tool: clay_canvas_list
  (lists all saved .canvas files owned by this Mate)

Tool: clay_canvas_read
  filename: "monthly-expense"
  (returns full .canvas file content)
```

`clay_canvas_render` is for conversation flow (show something now). `clay_canvas_save` is for persistence (keep it forever). The user can also trigger save from the inline canvas UI without the Mate.

---

## Home Hub Simplification

```
Home Hub = Greeting + Notifications + Promoted Canvases
```

No widget system. No widget CRUD. Home Hub just:
- Reads the user's promoted canvas list
- Loads each `.canvas` file from the owning Mate
- Renders in iframe sandbox
- Pipes Datastore data through the protocol

---

## Implementation Order

1. `.canvas` file format parser (extract meta, schema, style, html, script)
2. `clay-canvas-runtime.js` (postMessage protocol, Clay API)
3. iframe sandbox renderer
4. SDK tools (create/update/delete/list/read)
5. Canvas display in Mate DM sidebar
6. Push data pipeline (Datastore change -> canvas re-render)
7. Pull query pipeline (clay:query / clay:query-result)
8. `clay-canvas.css` base class library
9. Promote/demote to Home Hub
10. Home Hub grid layout with promoted canvases
11. Canvas sharing (import/export `.canvas` files)

---

## Dependencies

```
Mate Datastore (M) ──> Mate Canvas (V) ──> Home Hub (aggregator)
```

Mate Datastore must exist first. Canvas reads from it. But a canvas without `<clay-schema>` (static HTML only) can work without Datastore.

---

## Open Questions

1. **Canvas size limits?** Max file size per canvas. Recommendation: 100KB.
2. **How many canvases per Mate?** Recommendation: No hard limit, but UI shows latest 20 in sidebar.
3. **Can a canvas reference another Mate's data?** Recommendation: No. Keep it scoped. One Mate, one Datastore, one set of canvases.
4. **Chart libraries?** Allow importing Chart.js/D3 inside canvas? Recommendation: Provide a bundled lightweight chart lib in `clay-canvas-runtime.js`.
5. **Canvas versioning?** Recommendation: No. Mate overwrites. Old versions not kept.
6. **Schema enforcement?** Recommendation: Warn on mismatch, do not block writes. Flexibility over strictness.
7. **Canvas marketplace?** Community-shared canvases. Defer to post-v1, but the file format is designed for it.
