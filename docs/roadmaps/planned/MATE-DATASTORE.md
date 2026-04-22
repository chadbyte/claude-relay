# Mate Datastore

> Per-Mate SQLite database backed by Node 22 native `node:sqlite`. Each Mate owns its own schema and persists structured data across sessions and projects. Powers Home Hub widgets and long-term Mate memory.

**Created**: 2026-04-17
**Status**: Planning

---

## Problem

Mates have no way to persist structured data. Session digests capture conversation summaries, but Mates cannot store and retrieve arbitrary data (expense records, task lists, stock prices, user preferences) across sessions. A finance Mate cannot remember last month's budget without re-reading old conversations.

## Key Insight

Mates are individual projects in Clay. Each Mate has its own working directory (`~/.clay/mates/{userId}/{mateId}/`). The datastore lives with the Mate, not with the calling project. When Moneta (finance Mate) is invoked from any project, it accesses the same database.

Regular projects do not need a datastore. They have no persistent state beyond files and sessions.

The important design choice is that Clay does **not** impose a fake NoSQL abstraction on top of SQLite. The Mate knows it is using SQLite and is free to design tables, indexes, and queries that fit its job.

## Design

### Storage

One SQLite file per Mate:

```
~/.clay/mates/{userId}/{mateId}/store.db
```

Clay creates and opens the database file. The Mate owns the application schema inside that file.

### Ownership Model

Clay is responsible for:

- Creating the DB file in the Mate directory
- Opening the DB with safe defaults
- Enforcing access boundaries so a Mate can only reach its own DB
- Providing safe SQL tools for reads, writes, and schema inspection
- Managing Clay-owned metadata and lightweight migrations when needed
- Supporting backup/export/import later

The Mate is responsible for:

- Creating tables
- Creating indexes
- Choosing normalized tables vs JSON columns
- Evolving its own schema over time
- Querying and updating its own data model

This is intentionally **not** a NoSQL document store API. It is a SQLite workspace with guardrails.

### Clay-Owned Metadata

Clay may create a small internal metadata surface for bookkeeping. For example:

```sql
CREATE TABLE IF NOT EXISTS clay_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Examples:

- schema version for Clay-managed metadata
- timestamps for creation / backup bookkeeping
- future DB-level settings

This does not define the Mate's application schema. It only supports Clay's runtime concerns.

### Migrations

We should not claim "DDL never" or "schema never changes." That is too rigid.

Instead:

- Clay-owned metadata may use small, explicit migrations
- Mate-owned tables are created and evolved by the Mate itself
- We keep Clay's own schema churn minimal

If Clay needs versioning for its own metadata, use `PRAGMA user_version` or a small version row in `clay_meta`.

### Module

New module: `lib/mate-datastore.js`

Wraps `node:sqlite` and exposes a safe per-Mate database handle plus helper methods for:

- opening / initializing the DB
- applying Clay-owned metadata migrations
- preparing and executing safe statements
- schema inspection
- read / write policy enforcement

This module should not force all Mate data into a single `docs` table.

### SDK Tools

Mates access their datastore via MCP tools. The DB is always scoped to the calling Mate automatically.

Recommended v1 tool surface:

```
Tool: clay_db_query
  sql: "SELECT id, total FROM expenses WHERE month = ? ORDER BY total DESC"
  params: ["2026-04"]

Tool: clay_db_exec
  sql: "CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, month TEXT NOT NULL, total INTEGER NOT NULL)"
  params: []

Tool: clay_db_tables
  (no args, lists tables/views/indexes in the Mate DB)

Tool: clay_db_describe
  table: "expenses"
```

Possible later tools:

- `clay_db_indexes`
- `clay_db_export`
- `clay_db_import`
- `clay_db_vacuum`

### SQL Guardrails

The tools should be SQLite-aware and mostly unrestricted inside the Mate's own DB.

Recommended policy:

- `clay_db_query`: arbitrary read SQL
- `clay_db_exec`: arbitrary schema and write SQL within the Mate DB
- Disallow `ATTACH DATABASE`
- Disallow extension loading
- Disallow direct access outside the Mate's DB file
- Restrict or ignore dangerous PRAGMAs that could break safety assumptions
- Add sensible runtime protections such as query timeout, lock timeout, and result-size limits

This gives the Mate broad control over its own schema and queries without turning the tool into a filesystem or process escape hatch.

### Runtime Policy

Clay should rely on SQLite's native locking and transaction semantics for concurrent access.

Recommended v1 policy:

- Concurrent writes are serialized by SQLite
- Application-level conflict handling is last-write-wins unless a Mate implements stricter constraints itself
- Clay may enable WAL mode for better read/write concurrency
- Clay should set a busy timeout
- Clay should enforce query timeout and result-size limits for operational safety

### Access Control

- A Mate can only access its own datastore
- Users can inspect/edit Mate data via UI (Mate Settings > Data)
- Other Mates cannot read another Mate's data (unless explicitly shared, future feature)
- The active Mate ID is derived from session context, never from client-supplied DB paths

### WebSocket Messages

| Message | Direction | Description |
|---------|-----------|-------------|
| `mate_db_tables` | client -> server | List tables/views/indexes in a Mate DB |
| `mate_db_describe` | client -> server | Describe a table or view |
| `mate_db_query` | client -> server | Run a read-only query for inspection |
| `mate_db_exec` | client -> server | Run a write/schema statement from UI |
| `mate_db_change` | server -> client | Push schema/data change to connected clients |

### Data Inspector UI

In Mate sidebar or Mate settings:

- List tables with row counts where cheap to compute
- Browse table rows
- Inspect schema (`CREATE TABLE`, columns, indexes)
- Run limited manual queries
- Edit or delete rows manually
- Search within a selected table

---

## ABCD Pattern

Mate Datastore is the **D** in the ABCD pattern (AI Binding for Canvas and Datastore):

```
A  AI           Mate. Collects data, creates/updates Canvases.
B  Binding      Clay Protocol. postMessage bridge between Canvas and Datastore.
C  Canvas       See MATE-CANVAS.md. Single-file visual components.
D  Datastore    This document. Per-Mate SQLite DB.
```

Canvases (C) read from the Datastore (D) via Bindings (B). Users promote canvases to Home Hub. Home Hub is just an aggregator of promoted canvases, not a separate widget system.

---

## Implementation Order

1. `lib/mate-datastore.js` - SQLite runtime / policy module
2. MCP tools registration (in Mate project context)
3. WebSocket handlers for DB inspection
4. Data inspector UI in Mate sidebar
5. Integration with Home Hub widgets (Phase 3 of HOME-HUB-ROADMAP)

---

## V1 Decisions

1. **Size limits**: Start with soft size warnings only. Do not add hard DB caps in v1.
2. **Concurrency**: Rely on SQLite native locking and transactions. Concurrent writes are serialized. Application-level conflict policy is last-write-wins unless a Mate chooses stricter rules.
3. **Backup/export**: Support raw DB file export first. Logical dump/import can come later if needed.
4. **Cross-Mate sharing**: Not supported in v1. No direct cross-Mate DB access. If sharing is needed later, add explicit share primitives.
