# Codex Adapter Integration Status

> Codex adapter for YOKE, enabling OpenAI Codex as an alternative harness provider in Clay.

---

## Current State (2026-04-18)

### What works
- Codex adapter at `lib/yoke/adapters/codex.js` - fully functional
- Basic prompt-response via `codex exec --json` (gpt-5.4)
- Event flattening handles `item.completed`-only events from CLI
- Per-session vendor selection via split toggle UI
- Vendor-specific config panel (APPROVAL, SANDBOX, WEB SEARCH)
- Cross-vendor instruction injection (reads CLAUDE.md for Codex sessions)
- Auth detection and singleton adapter creation
- Per-mate vendor selection with persist

### Known limitations
- **No streaming**: `codex exec --json` emits complete items only, no incremental text deltas
- **No Clay MCP tools**: Codex runs as separate process, cannot access in-process MCP (email, browser, debate)
- **No session resume across vendors**: Claude sessions cannot be continued with Codex and vice versa
- **Image support**: Text-only. Codex supports `local_image` with path, not base64

---

## Available Models (from developers.openai.com/codex)

| Model | Description | Capability | Speed | ChatGPT Pro |
|-------|-------------|-----------|-------|-------------|
| **gpt-5.4** | Flagship frontier model | 5/5 | 3/5 | Yes |
| **gpt-5.4-mini** | Fast mini model for subagents | 3/5 | 4/5 | Yes |
| **gpt-5.3-codex** | Industry-leading coding model | 5/5 | 3/5 | Yes (Cloud) |
| **gpt-5.3-codex-spark** | Near-instant real-time coding | 3/5 | 5/5 | Pro only |
| **gpt-5.2** | Previous gen coding model | 4/5 | 3/5 | Yes |

**Note:** `o4-mini`, `o3`, `codex-mini` are API-only models. ChatGPT Pro accounts cannot use them.

---

## Authentication

Two methods:
1. **ChatGPT sign-in** (for Pro/Plus/Enterprise users): `codex login` -> browser OAuth -> token saved to `~/.codex/auth.json`
2. **API key** (for pay-per-use): Set `OPENAI_API_KEY` env var or pass via `adapterOptions.CODEX.apiKey`

Auth check: `yoke.checkAuth()` runs CLI commands, cached globally.
- Claude: `claude auth status` -> JSON with `loggedIn: true`
- Codex: `codex login status` -> exit code 0

---

## SDK Details

### How it works internally
The `@openai/codex-sdk` TypeScript SDK:
1. Spawns `codex exec --experimental-json` as a child process
2. Writes prompt to stdin
3. Reads JSONL from stdout (one JSON object per line)
4. Each line is parsed and yielded as a `ThreadEvent`

### ThreadEvent types (from SDK)
```
thread.started   -> { thread_id }
turn.started     -> {}
turn.completed   -> { usage }
turn.failed      -> { error }
item.started     -> { item: ThreadItem }  // NOT emitted by codex exec --json
item.updated     -> { item: ThreadItem }  // NOT emitted by codex exec --json
item.completed   -> { item: ThreadItem }  // ONLY this one is emitted
error            -> { message }
```

### ThreadItem types
```
agent_message      -> { id, type, text }
reasoning          -> { id, type, text }
command_execution  -> { id, type, command, aggregated_output, exit_code, status }
file_change        -> { id, type, changes: [{path, kind}], status }
mcp_tool_call      -> { id, type, server, tool, arguments, result, error, status }
web_search         -> { id, type, query }
todo_list          -> { id, type, items: [{text, completed}] }
error              -> { id, type, message }
```

### ThreadOptions
```js
{
  model: string,                    // "gpt-5.4"
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access",
  workingDirectory: string,
  skipGitRepoCheck: boolean,        // always true for Clay
  modelReasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh",
  networkAccessEnabled: boolean,
  webSearchMode: "disabled" | "cached" | "live",
  webSearchEnabled: boolean,
  approvalPolicy: "never" | "on-request" | "on-failure" | "untrusted",
  additionalDirectories: string[],
}
```

---

## Architecture

```
lib/yoke/
  index.js              - createAdapters() singleton factory, checkAuth(), wrapCreateQuery()
  instructions.js       - Cross-vendor instruction scanner (CLAUDE.md, AGENTS.md, .cursorrules)
  interface.js          - Adapter / QueryHandle contract
  adapters/
    codex.js            - Codex adapter
    claude.js           - Claude adapter (reference implementation)
    gemini.js           - Gemini adapter

lib/project.js          - Multi-adapter map, defaultVendor, get_vendor_models
lib/sdk-bridge.js       - Per-session adapter selection via session.vendor
lib/sdk-message-processor.js - Processes yokeType events into Clay WS messages
lib/sessions.js         - vendor field on sessions
lib/project-sessions.js - Codex config handlers (approval, sandbox, webSearch)
lib/server-dm.js        - vendor in mate DM targetUser
```

### Event flow
```
Codex CLI (codex exec --json)
  -> JSONL stdout
    -> SDK parses to ThreadEvent
      -> codex.js flattenEvent() -> yokeType events
        -> sdk-bridge.js processQueryStream()
          -> sdk-message-processor.js -> Clay WebSocket messages
            -> browser
```

### Vendor selection flow
```
Client: vendor toggle -> store.currentVendor
  -> first message payload includes vendor
    -> server: session.vendor = msg.vendor
      -> startQuery: adapters[session.vendor].createQuery()
```

---

## Next Steps

### 1. MCP for Codex (stdio MCP server)

**Decision**: Expose Clay's in-process MCP tools as stdio MCP servers that Codex CLI can connect to natively.

**Why stdio MCP server (not in-process bridge)**:
- Clay's MCP tools already use `@modelcontextprotocol/sdk`. MCP is designed for inter-process communication.
- In-process bridge is impossible anyway. Codex runs as a child process (`codex exec`), so IPC is required regardless.
- stdio MCP server is the standard approach. No custom bridge protocol needed.
- Vendor-agnostic. Any future vendor that supports MCP (Gemini, etc.) can connect the same way.
- Codex CLI already supports MCP server connections natively via config.

**Implementation plan**:
1. Create `lib/yoke/mcp-bridge-server.js` that spawns as a child process and proxies tool calls back to Clay's in-process MCP tool handlers via IPC (parent<->child message passing).
2. In Codex adapter's `init()` or `createQuery()`, spawn the bridge server process.
3. Inject MCP server config into Codex via `CodexOptions.config`:
   ```js
   new Codex({
     config: {
       mcp_servers: {
         "clay-tools": {
           command: "node",
           args: ["/path/to/mcp-bridge-server.js"],
         }
       }
     }
   });
   ```
4. Bridge server receives MCP tool calls from Codex CLI via stdio, forwards to parent process (Clay) via IPC, returns results.
5. Existing Clay MCP tools (email, browser, debate, custom) work without modification.

**Flow**:
```
Codex CLI (child process)
  -> MCP tool call via stdio
    -> mcp-bridge-server.js (child of Clay)
      -> IPC to Clay parent process
        -> Clay in-process MCP tool handler
          -> result back via IPC
            -> stdio response to Codex CLI
```

### 2. Streaming
Investigate if Codex app-server protocol provides streaming deltas (vs CLI batch `item.completed` only).

### 3. Image support
Map base64 images to temp files for Codex `local_image` support.

### 4. Gemini vendor
Add auth check and toggle support for Gemini (currently `gemini: false`).

### 5. Vendor-specific mode mapping
Map Claude's MODE (Plan, Auto-accept) to Codex's approvalPolicy.
