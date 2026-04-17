# Mate Datastore

> Per-Mate key-value database backed by Node 22 native SQLite. Mates persist structured data across sessions and projects. Powers Home Hub widgets and long-term Mate memory.

**Created**: 2026-04-17
**Status**: Planning

---

## Problem

Mates have no way to persist structured data. Session digests capture conversation summaries, but Mates cannot store and retrieve arbitrary data (expense records, task lists, stock prices, user preferences) across sessions. A finance Mate cannot remember last month's budget without re-reading old conversations.

## Key Insight

Mates are individual projects in Clay. Each Mate has its own working directory (`~/.clay/mates/{userId}/{mateId}/`). The datastore lives with the Mate, not with the calling project. When Moneta (finance Mate) is invoked from any project, it accesses the same datastore.

Regular projects do not need a datastore. They have no persistent state beyond files and sessions.

## Design

### Storage

One SQLite file per Mate:

```
~/.clay/mates/{userId}/{mateId}/store.db
```

**Schema** (created once, never modified):
```sql
CREATE TABLE docs (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,          -- JSON string
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (collection, id)
);
CREATE INDEX idx_collection ON docs(collection);
```

Single table, no DDL changes ever. Collections are just string keys. Schema-free documents stored as JSON. SQLite's `json_extract` enables field-level queries without additional indexes.

### Module

New module: `lib/mate-datastore.js`

Wraps `node:sqlite` with a NoSQL-style document API:

```js
var ds = openDatastore(mateDir);

// Insert (auto-generates id if omitted)
ds.insert("expenses", { date: "2026-04", total: 320000, items: [...] });

// Find by field value (uses json_extract internally)
ds.find("expenses", { date: "2026-04" });

// Get all documents in a collection
ds.findAll("expenses");

// Get single document by id
ds.get("expenses", "doc_abc123");

// Update
ds.update("expenses", "doc_abc123", { total: 350000 });

// Remove
ds.remove("expenses", "doc_abc123");

// List collections
ds.collections();    // -> ["expenses", "budgets", ...]

// Drop entire collection
ds.drop("expenses");
```

No schema definitions, no migrations, no DDL. Mates just pick a collection name and start writing documents.

### SDK Tools

Mates access their datastore via MCP tools:

```
Tool: clay_data_insert
  collection: "expenses"
  data: { date: "2026-04", total: 320000, categories: [...] }

Tool: clay_data_find
  collection: "expenses"
  query: { date: "2026-04" }       (optional, omit for all)

Tool: clay_data_get
  collection: "expenses"
  id: "doc_abc123"

Tool: clay_data_update
  collection: "expenses"
  id: "doc_abc123"
  data: { total: 350000 }

Tool: clay_data_remove
  collection: "expenses"
  id: "doc_abc123"

Tool: clay_data_collections
  (no args, lists all collection names)
```

These tools are available only in Mate sessions. The datastore is scoped to the calling Mate automatically. No schema setup needed. Mates just use any collection name.

### Access Control

- A Mate can only access its own datastore
- Users can inspect/edit Mate data via UI (Mate Settings > Data)
- Other Mates cannot read another Mate's data (unless explicitly shared, future feature)

### WebSocket Messages

| Message | Direction | Description |
|---------|-----------|-------------|
| `mate_data_collections` | client -> server | List collections in a Mate's datastore |
| `mate_data_find` | client -> server | Query documents in a collection |
| `mate_data_get` | client -> server | Read a single document by id |
| `mate_data_insert` | client -> server | Insert a document (from UI) |
| `mate_data_update` | client -> server | Update a document |
| `mate_data_remove` | client -> server | Delete a document |
| `mate_data_change` | server -> client | Push data change to connected clients |

### Data Inspector UI

In Mate sidebar or Mate settings:

- List all collections with document count
- Click a collection to browse documents
- Click a document to see formatted JSON
- Edit or delete documents manually
- Search within collection

---

## Relation to Home Hub

Home Hub widgets read from Mate datastores:

```
Mate (writes data) -> Mate Datastore -> Widget (reads and displays)
```

The HOME-HUB-ROADMAP Phase 2 (Project Data Store) should be replaced with this Mate Datastore. Phase 3 (Widget System) reads from Mate datastores instead of project datastores. The widget `data-bind` attribute references `{mateId}:{key}` instead of just `{key}`.

---

## Implementation Order

1. `lib/mate-datastore.js` - SQLite CRUD module
2. MCP tools registration (in Mate project context)
3. WebSocket handlers for UI inspection
4. Data inspector UI in Mate sidebar
5. Integration with Home Hub widgets (Phase 3 of HOME-HUB-ROADMAP)

---

## Open Questions

1. **Size limits?** Max value size, max total DB size per Mate? Recommendation: 1MB per value, 100MB per Mate.
2. **TTL/expiry?** Should keys expire automatically? Recommendation: No, Mates manage their own cleanup.
3. **Backup/export?** Should users be able to export a Mate's datastore? Useful for Mate migration.
4. **Cross-Mate data sharing?** Defer. If needed later, add a `clay_data_get_from` tool with explicit Mate ID and user permission.
