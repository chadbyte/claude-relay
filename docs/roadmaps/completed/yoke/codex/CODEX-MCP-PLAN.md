# Codex MCP Implementation Plan

> Detailed plan for enabling MCP tool support in Codex sessions.

---

## Problem

Codex sessions cannot use any MCP tools:
- **In-app MCP** (clay-browser, clay-debate, email) - lives in Clay Node.js process, Codex runs as separate child process
- **External MCP** (GitHub, Notion, etc.) - managed by mcp-local.js (local) or clay-mcp-bridge (remote)

Claude adapter passes MCP servers as SDK objects via `queryOpts.toolServers`. Codex SDK has no equivalent parameter in `ThreadOptions`. Instead, Codex CLI connects to MCP servers natively via `CodexOptions.config.mcp_servers` (stdio command+args format).

---

## Solution: Two Tracks

### Track 1: Local External MCP (config passthrough)

Codex CLI can spawn and manage MCP processes itself. Just pass the server definitions from `$HOME/.clay/mcp.json` directly into `CodexOptions.config`.

### Track 2: In-app + Remote External MCP (stdio bridge)

Create a single stdio MCP bridge server that Codex connects to as a native MCP server. The bridge proxies tool calls back to Clay's existing handlers (in-app tools, extension relay).

---

## Track 1: Local External MCP

### What changes

**`lib/yoke/adapters/codex.js`** - Read mcp.json and inject into Codex config

In `init()` or at adapter creation, read the local MCP server definitions:

```js
var mcpConfig = readMcpJson(); // { "github": { command: "...", args: [...] }, ... }

_codex = new Codex({
  config: {
    mcp_servers: mcpConfig
  }
});
```

**`lib/sdk-bridge.js`** - Skip mcp-local.js for Codex sessions

When `sessionAdapter.vendor === "codex"`, don't pass `toolServers` from mcp-local.js (Codex manages its own). Still pass in-app servers via Track 2 bridge.

### Config format mapping

`$HOME/.clay/mcp.json`:
```json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "..." } }
  },
  "include": ["~/.claude/claude_desktop_config.json"]
}
```

Codex `config.mcp_servers` expects the same shape:
```js
{
  "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
}
```

Need to:
1. Read and merge `mcpServers` + `include` files (reuse mcp-local.js `readConfig()` logic)
2. Filter by project's `enabledMcpServers` list
3. Map to Codex config format (pass `env` if Codex supports it, otherwise inject into process.env)

### Files to modify

| File | Change |
|------|--------|
| `lib/yoke/adapters/codex.js` | Read mcp.json, filter by enabled list, inject into `CodexOptions.config.mcp_servers` |
| `lib/sdk-bridge.js` | For Codex sessions, don't include mcp-local.js servers in `toolServers` (avoid double-spawn) |
| `lib/mcp-local.js` | Export `readConfig()` or extract shared config reader |

---

## Track 2: In-app + Remote External MCP (stdio bridge)

### Architecture

```
Codex CLI (child process of Codex SDK)
  |
  | stdio (JSON-RPC)
  |
  v
mcp-bridge-server.js (child process, spawned by Codex via config)
  |
  | local TCP or Unix socket
  |
  v
Clay Server (sdk-bridge.js endpoint)
  |
  |--- in-app handler (clay-browser, clay-debate, email)
  |--- extension relay (project-mcp.js -> WS -> extension -> native host)
```

### New file: `lib/yoke/mcp-bridge-server.js`

Standalone Node.js script that Codex spawns as an MCP server. It:

1. **Reads stdio** - Codex sends JSON-RPC requests on stdin
2. **MCP handshake** - Responds to `initialize` and `tools/list` with tool definitions fetched from Clay
3. **Tool calls** - Receives `tools/call`, forwards to Clay via local socket, returns result on stdout
4. **Connects to Clay** - Uses a local TCP connection (localhost:PORT) or Unix domain socket

Lifecycle:
- Codex spawns this script via `config.mcp_servers["clay-tools"].command`
- On startup, connects to Clay server's MCP endpoint
- Fetches available tool list (in-app + remote extension tools)
- Serves as MCP server on stdio for Codex

### Communication: Bridge <-> Clay

**Option A: Unix domain socket** (preferred)
- Clay creates a socket at a known path (e.g., `$HOME/.clay/mcp-bridge.sock` or `/tmp/clay-mcp-{slug}.sock`)
- Bridge connects on startup
- Simple, no port conflicts, auto-cleanup

**Option B: Local HTTP endpoint**
- Clay exposes `POST /mcp-bridge/call` on its existing HTTP server (localhost only)
- Bridge sends HTTP requests
- Simpler to implement, but requires knowing the port

Recommendation: **Option B** (local HTTP). Clay server already runs HTTP. Add a route. Bridge just needs to know the port (pass via env var or CLI arg).

### Protocol: Bridge <-> Clay

Request (bridge -> Clay):
```json
{ "action": "list_tools" }
{ "action": "call_tool", "server": "clay-browser", "tool": "browser_screenshot", "args": { "tabId": 1 } }
```

Response (Clay -> bridge):
```json
{ "tools": [{ "server": "clay-browser", "name": "browser_screenshot", "description": "...", "inputSchema": {...} }, ...] }
{ "result": { "content": [{ "type": "text", "text": "..." }] } }
{ "error": "tool not found" }
```

### Integration into Codex adapter

In `codex.js` `createQuery()`, inject the bridge as an MCP server:

```js
var bridgePath = require("path").join(__dirname, "mcp-bridge-server.js");
var mcpServers = Object.assign({}, localMcpConfig, {
  "clay-tools": {
    command: process.execPath,  // node binary
    args: [bridgePath, "--port", String(clayPort), "--slug", slug]
  }
});

// Pass to Codex
// Already set in init(): _codex = new Codex({ config: { mcp_servers: mcpServers } })
// Per-query: pass via threadOpts or re-init is needed?
```

**Problem**: `CodexOptions.config` is set at `new Codex()` time (adapter init), not per-query. MCP server list can change between queries (extension connects/disconnects, servers toggle on/off).

**Solution**: Re-create Codex instance when MCP config changes, or accept that MCP server list is fixed per-init. Acceptable for v1, since server list rarely changes mid-session.

### Clay-side endpoint

In `lib/sdk-bridge.js` or `lib/project.js`, add a local HTTP handler:

```js
// POST /api/mcp-bridge/:slug
app.post("/api/mcp-bridge/:slug", function(req, res) {
  var action = req.body.action;
  if (action === "list_tools") {
    // Collect tool descriptors from in-app + remote MCP servers
    var descriptors = extractMcpToolDescriptors(mcpServers);
    res.json({ tools: descriptors });
  } else if (action === "call_tool") {
    callMcpToolHandler(mcpServers, req.body.server, req.body.tool, req.body.args)
      .then(function(result) { res.json({ result: result }); })
      .catch(function(err) { res.json({ error: err.message }); });
  }
});
```

`extractMcpToolDescriptors()` and `callMcpToolHandler()` already exist in sdk-bridge.js. Just need to expose them via HTTP.

### Files to create/modify

| File | Change |
|------|--------|
| `lib/yoke/mcp-bridge-server.js` | **New**. Stdio MCP server that proxies to Clay via HTTP |
| `lib/yoke/adapters/codex.js` | Inject bridge into `CodexOptions.config.mcp_servers` |
| `lib/sdk-bridge.js` | Expose `extractMcpToolDescriptors` and `callMcpToolHandler` for HTTP route |
| `lib/server.js` or `lib/project.js` | Add `/api/mcp-bridge/:slug` HTTP endpoint (localhost only) |
| `lib/project-mcp.js` | Export tool definitions in vendor-neutral format (not Claude SDK objects) |

---

## Implementation Order

1. **Track 1 first** - local external MCP passthrough. Quickest win, covers most common MCP use case (GitHub, filesystem, etc.)
2. **Track 2 HTTP endpoint** - add the Clay-side route for tool listing and calling
3. **Track 2 bridge server** - create mcp-bridge-server.js with MCP handshake + HTTP proxy
4. **Track 2 integration** - wire bridge into Codex adapter config
5. **Test** - verify in-app tools (browser screenshot, debate) and remote tools work through Codex

---

## Edge Cases

- **Project-level enabled list**: Only pass servers in the project's `enabledMcpServers`. Both tracks need this filter.
- **Environment variables**: mcp.json servers can have `env` field. Codex config may or may not support env passthrough. If not, write a wrapper script.
- **Bridge server cleanup**: When Codex process exits, bridge server should exit too (stdin EOF detection).
- **Hot reload**: If extension connects/disconnects mid-session, bridge's tool list becomes stale. Acceptable for v1. Future: bridge can poll or use SSE from Clay.
- **Multi-project**: Bridge needs to know which project's MCP servers to expose. Pass `slug` as CLI arg.
- **Security**: HTTP endpoint must be localhost-only. Validate slug matches a real project.
