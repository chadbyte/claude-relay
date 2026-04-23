# Mate Datastore Implementation Spec

> Concrete v1 implementation spec for per-Mate SQLite datastores. This document turns [MATE-DATASTORE.md](./MATE-DATASTORE.md) into a buildable server, MCP, and UI plan.

**Created**: 2026-04-22
**Status**: Draft
**Depends On**: [MATE-DATASTORE.md](./MATE-DATASTORE.md), [MATE-CANVAS.md](./MATE-CANVAS.md), [MODULE_MAP.md](../../guides/MODULE_MAP.md), [MCP-IMPLEMENTATION.md](../../guides/MCP-IMPLEMENTATION.md)

---

## Goals

- Give each Mate its own SQLite database at `~/.clay/mates/{userId}/{mateId}/store.db`
- Let the Mate create and evolve its own schema with broad SQL freedom inside that DB
- Expose safe MCP tools for SQL access during Mate sessions
- Expose WebSocket APIs and UI inspection for users
- Preserve isolation: a Mate may only access its own DB

## Non-Goals

- Cross-Mate database sharing
- Logical dump/import in v1
- Hard DB size quotas
- A NoSQL abstraction layer
- Query planner or ORM features

---

## Runtime Requirements

- Minimum runtime for this feature: Node `22.13.0+`
- Use built-in `node:sqlite`
- The feature should fail closed on older Node versions with a clear error message

Reason: `node:sqlite` was added in Node `22.5.0` and stopped requiring `--experimental-sqlite` in `22.13.0`, while remaining experimental.

---

## File Layout

### Database File

Per Mate:

```
~/.clay/mates/{userId}/{mateId}/store.db
```

### New Server Modules

- `lib/mate-datastore.js`
- `lib/project-mate-datastore.js`

### Expected Touch Points

- `lib/project.js`
- `lib/project-http.js`
- `lib/project-user-message.js` or `lib/project-mate-datastore.js` message wiring
- `lib/yoke/adapters/claude.js`
- `lib/yoke/adapters/codex.js`
- `lib/public/modules/app-messages.js`
- `lib/public/modules/sidebar-mates.js` or a new focused inspector module if needed
- `lib/ws-schema.js`

`project.js` must stay a thin coordinator. Datastore message handling belongs in a dedicated `attachMateDatastore(ctx)` module.

---

## Module Responsibilities

### `lib/mate-datastore.js`

Low-level SQLite runtime and policy module.

Responsibilities:

- Resolve DB path from Mate identity
- Ensure parent directory exists
- Open `DatabaseSync`
- Apply Clay-owned DB initialization
- Set runtime defaults
- Validate and execute SQL
- Introspect schema
- Return normalized errors

Suggested public API:

```js
function openMateDatastore(options) {}
function ensureMateDatastore(options) {}
function listSchemaObjects(db) {}
function describeTable(db, tableName) {}
function runQuery(db, sql, params, limits) {}
function runExec(db, sql, params, limits) {}
function closeMateDatastore(db) {}
```

CommonJS export:

```js
module.exports = {
  openMateDatastore: openMateDatastore,
  ensureMateDatastore: ensureMateDatastore,
  listSchemaObjects: listSchemaObjects,
  describeTable: describeTable,
  runQuery: runQuery,
  runExec: runExec,
  closeMateDatastore: closeMateDatastore,
};
```

### `lib/project-mate-datastore.js`

Project-scoped message/module integration.

Responsibilities:

- Resolve active Mate from session context
- Reject datastore access for non-Mate sessions
- Handle WebSocket messages
- Broadcast `mate_db_change`
- Provide tool handlers to adapters / SDK bridge
- Keep per-session access policy out of `project.js`

Suggested shape:

```js
function attachMateDatastore(ctx) {
  function handleMateDatastoreMessage(ws, msg) {}
  function getMateToolDefinitions(session) {}
  function callMateTool(session, toolName, input) {}

  return {
    handleMateDatastoreMessage: handleMateDatastoreMessage,
    getMateToolDefinitions: getMateToolDefinitions,
    callMateTool: callMateTool,
  };
}
```

---

## DB Initialization

### On First Open

When a Mate datastore is first opened:

1. Ensure mate directory exists
2. Open `store.db`
3. Apply connection/runtime settings
4. Create Clay-owned metadata table if missing
5. Stamp Clay metadata version if needed

### Clay-Owned Metadata

Clay may create only the following internal table in v1:

```sql
CREATE TABLE IF NOT EXISTS clay_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Reserved keys:

- `clay_meta_version`
- `created_at`
- `last_opened_at`

Everything else belongs to the Mate.

### SQLite Runtime Defaults

Apply on open:

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`
- `PRAGMA busy_timeout = 5000`

Notes:

- WAL improves reader/writer concurrency
- `foreign_keys = ON` avoids subtle integrity bugs for Mates that use relational schemas
- Busy timeout should be configurable later, but fixed in v1

Do not expose unrestricted PRAGMA changes through tool APIs in v1.

---

## Session Eligibility

Datastore access is allowed only when all of the following are true:

- The active session belongs to a Mate
- Clay can resolve `{ userId, mateId, mateDir }` from server-owned session state
- The DB path is computed by Clay, not supplied by the client or the Mate

Datastore access is rejected for:

- Regular project sessions
- Sessions without a resolved Mate identity
- Requests that attempt to override DB file path

Failure response should be explicit: `Mate datastore is only available in Mate sessions.`

---

## MCP Tool Contract

These tools should appear only in Mate sessions.

### `clay_db_query`

Purpose:

- Execute read SQL against the current Mate DB

Input:

```json
{
  "sql": "SELECT id, total FROM expenses WHERE month = ? ORDER BY total DESC",
  "params": ["2026-04"]
}
```

Behavior:

- Accept only read statements
- Return rows plus lightweight metadata
- Enforce row/result limits

Output:

```json
{
  "ok": true,
  "rows": [
    { "id": "exp_1", "total": 1200 }
  ],
  "rowCount": 1,
  "truncated": false
}
```

### `clay_db_exec`

Purpose:

- Execute schema and write SQL against the current Mate DB

Input:

```json
{
  "sql": "CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, month TEXT NOT NULL, total INTEGER NOT NULL)",
  "params": []
}
```

Behavior:

- Allow arbitrary schema/write SQL inside the current Mate DB
- Reject SQL that breaks isolation/runtime policy
- Return execution summary

Output:

```json
{
  "ok": true,
  "changes": 0,
  "lastInsertRowid": null
}
```

### `clay_db_tables`

Purpose:

- List schema objects for UI and Mate self-discovery

Input:

```json
{}
```

Output:

```json
{
  "ok": true,
  "objects": [
    {
      "name": "expenses",
      "type": "table",
      "sql": "CREATE TABLE expenses (...)"
    }
  ]
}
```

### `clay_db_describe`

Purpose:

- Describe a single table or view

Input:

```json
{
  "table": "expenses"
}
```

Output:

```json
{
  "ok": true,
  "table": "expenses",
  "columns": [
    { "name": "id", "type": "TEXT", "notnull": 1, "pk": 1 }
  ],
  "indexes": [
    { "name": "idx_expenses_month", "unique": 0 }
  ],
  "createSql": "CREATE TABLE expenses (...)"
}
```

---

## SQL Policy

### Allowed in `clay_db_query`

- `SELECT`
- `WITH ... SELECT`
- `EXPLAIN QUERY PLAN SELECT ...` is optional in v1; simplest is to reject it

### Allowed in `clay_db_exec`

- `CREATE TABLE`
- `CREATE INDEX`
- `CREATE VIEW`
- `ALTER TABLE`
- `DROP TABLE`
- `DROP INDEX`
- `DROP VIEW`
- `INSERT`
- `UPDATE`
- `DELETE`
- transaction statements such as `BEGIN`, `COMMIT`, `ROLLBACK` may be allowed, but v1 should reject them unless they are required by a concrete use case

### Explicitly Rejected

- `ATTACH DATABASE`
- `DETACH DATABASE`
- extension loading
- SQL that references a DB path outside the current Mate DB
- dangerous or unsupported PRAGMA mutations
- multiple statements in `clay_db_query`

Implementation note:

- Use conservative SQL classification. We do not need a perfect SQL parser in v1.
- For `query`, require the normalized first keyword to be `SELECT` or `WITH`.
- For `exec`, reject known-bad keywords before execution.

---

## Limits and Timeouts

### Result Limits

Initial defaults:

- Max returned rows: `200`
- Max serialized result bytes: `1 MB`

If a query exceeds row count, truncate returned rows and set `truncated: true`.

If serialized output would exceed the byte limit, fail with a clear message instead of returning a huge payload.

### Query Execution Time

SQLite does not provide the exact kind of statement timeout many server databases provide, so v1 policy is:

- use `busy_timeout`
- keep result size limited
- keep tool/UI reads conservative

If we later need hard statement interrupts, add them as a separate follow-up.

### DB Size Policy

v1 uses warnings only.

- Soft warning threshold: `100 MB`
- No hard cap in v1

When a DB exceeds the threshold:

- tool responses may include a warning
- UI should surface a non-blocking warning

---

## Concurrency Policy

We rely on SQLite's native locking and transaction semantics.

v1 behavior:

- Concurrent writes are serialized by SQLite
- Readers and writers coordinate through WAL
- Application-level conflict policy is last-write-wins
- Clay does not implement extra conflict resolution in v1

This is acceptable because each DB is scoped to one Mate and the primary goal is safe persistence, not collaborative row-level conflict tracking.

---

## Error Model

All APIs should return normalized errors.

Suggested shape:

```json
{
  "ok": false,
  "code": "SQLITE_FORBIDDEN",
  "message": "ATTACH DATABASE is not allowed in Mate datastores."
}
```

Recommended codes:

- `MATE_DATASTORE_UNAVAILABLE`
- `MATE_DATASTORE_NOT_ALLOWED`
- `MATE_DATASTORE_BAD_INPUT`
- `SQLITE_FORBIDDEN`
- `SQLITE_QUERY_REJECTED`
- `SQLITE_EXEC_FAILED`
- `SQLITE_RESULT_TOO_LARGE`
- `SQLITE_TABLE_NOT_FOUND`

Avoid leaking absolute filesystem paths in error messages.

---

## WebSocket Contract

These messages are for user-facing inspection and manual editing.

### Client -> Server

#### `mate_db_tables`

```json
{ "type": "mate_db_tables" }
```

#### `mate_db_describe`

```json
{ "type": "mate_db_describe", "table": "expenses" }
```

#### `mate_db_query`

```json
{
  "type": "mate_db_query",
  "requestId": "req_123",
  "sql": "SELECT * FROM expenses ORDER BY month DESC LIMIT 50",
  "params": []
}
```

#### `mate_db_exec`

```json
{
  "type": "mate_db_exec",
  "requestId": "req_124",
  "sql": "DELETE FROM expenses WHERE id = ?",
  "params": ["exp_1"]
}
```

### Server -> Client

#### `mate_db_tables_result`

```json
{
  "type": "mate_db_tables_result",
  "objects": []
}
```

#### `mate_db_describe_result`

```json
{
  "type": "mate_db_describe_result",
  "table": "expenses",
  "columns": [],
  "indexes": [],
  "createSql": "CREATE TABLE expenses (...)"
}
```

#### `mate_db_query_result`

```json
{
  "type": "mate_db_query_result",
  "requestId": "req_123",
  "ok": true,
  "rows": [],
  "rowCount": 0,
  "truncated": false
}
```

#### `mate_db_exec_result`

```json
{
  "type": "mate_db_exec_result",
  "requestId": "req_124",
  "ok": true,
  "changes": 1,
  "lastInsertRowid": null
}
```

#### `mate_db_error`

```json
{
  "type": "mate_db_error",
  "requestId": "req_124",
  "ok": false,
  "code": "SQLITE_EXEC_FAILED",
  "message": "no such table: expenses"
}
```

#### `mate_db_change`

Broadcast after successful `exec`:

```json
{
  "type": "mate_db_change",
  "scope": "schema_or_data"
}
```

v1 does not need fine-grained row diffs. A broad invalidation event is enough.

---

## HTTP Contract

No required HTTP endpoints in v1.

If export is added in the same phase, prefer a dedicated route in `project-http.js`:

- `GET /api/mate-datastore/export`

That route should:

- require a Mate session context
- stream the current `store.db` file
- avoid exposing arbitrary filesystem paths

If export is not implemented in the first coding pass, omit the route entirely.

---

## UI Scope

### Initial UI Surface

Start in Mate settings or the Mate sidebar detail panel. Do not build a large standalone database UI in v1.

Minimum UI features:

- list tables/views/indexes
- inspect columns and `CREATE TABLE` SQL
- run a read query
- run a manual exec statement
- browse rows for a selected table

### Client Module Strategy

Prefer a new focused module rather than expanding an already large sidebar file.

Suggested module:

- `lib/public/modules/mate-datastore.js`

Responsibilities:

- send datastore WebSocket messages
- render object list
- render describe/query results
- show errors and warnings
- refresh on `mate_db_change`

`app-messages.js` should only route incoming messages to the new module.

---

## Adapter Integration

The datastore tools must be injected only for Mate sessions.

Implementation direction:

- session context determines whether current query is a Mate session
- adapter/tool builder asks `project-mate-datastore.js` for extra tools
- tool handlers execute on the server side against the resolved Mate DB

This avoids exposing DB paths or SQL execution to the browser extension bridge as a fake remote MCP server.

---

## Security Notes

- Never accept a DB path from client input
- Never expose filesystem paths in tool descriptions
- Never allow cross-Mate DB access in v1
- Never allow `ATTACH DATABASE`
- Never allow extension loading
- Reject oversized results before sending them to the model or UI
- Treat SQL text as user/model input and validate before execution

This feature is intentionally powerful. Safety comes from strict DB scoping and a small set of blocked escape hatches, not from pretending the Mate is using a different storage model.

---

## Testing Plan

### Unit Tests

Add tests for `lib/mate-datastore.js`:

- opens and initializes a fresh DB
- creates `clay_meta`
- applies runtime PRAGMAs
- allows `SELECT` in query path
- rejects `ATTACH DATABASE`
- rejects forbidden PRAGMAs
- truncates large rowsets
- normalizes errors

### Integration Tests

Add tests for project/session integration:

- Mate session gets datastore tools
- regular project session does not
- WebSocket `mate_db_query` works for Mate session
- WebSocket request fails for non-Mate session
- successful `mate_db_exec` emits `mate_db_change`

### Manual Checks

- create a Mate, create a table, insert rows, query rows
- switch projects and confirm the same Mate sees the same DB
- verify a regular project cannot access datastore tools
- verify large result warning / truncation behavior

---

## Implementation Order

1. Build `lib/mate-datastore.js`
2. Build `lib/project-mate-datastore.js`
3. Wire the module into `project.js`
4. Register WebSocket message types in `ws-schema.js`
5. Inject Mate-only MCP tools into adapters / SDK bridge
6. Add minimal UI inspector module
7. Add tests
8. Add optional DB export route later if still wanted

---

## Deferred Work

- logical dump/import
- fine-grained schema diff events
- cross-Mate sharing
- hard DB quotas
- query history
- statement interruption / cancellation
- saved views / saved queries
