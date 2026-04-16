# MCP Bridge Design (Original)

> **Note**: This is the original design document from before implementation. For the current architecture and implementation details, see [MCP-IMPLEMENTATION.md](MCP-IMPLEMENTATION.md).

## Problem

Clay server runs remotely. Users have MCP servers running locally (Figma, Notion, Sentry, databases, etc.). These are mostly stdio-based processes that need to be spawned on the user's machine. Clay needs to bridge this gap without adding a local daemon or any extra installation beyond the existing Chrome extension.

## Architecture

```
[Remote Clay Server]          [User's Browser]              [User's Machine]
┌──────────────┐             ┌─────────────────┐           ┌───────────────┐
│  sdk-bridge  │─ WebSocket ─│  Clay Webapp     │           │               │
│              │             │    ↕              │           │  MCP Server A │
│  MCP proxy   │             │  Chrome Extension │─ Native ─│  MCP Server B │
│  layer       │             │    ↕              │  Messaging│  MCP Server C │
│              │             │  Extension Popup  │           │               │
└──────────────┘             │  (MCP settings)  │           └───────────────┘
                             └─────────────────┘
```

## Responsibilities

| Component | Role |
|-----------|------|
| Chrome Extension popup | User points to their MCP config file path. Displays discovered servers with ON/OFF toggles. |
| Chrome Extension + Native Messaging Host | Reads the config file. Spawns/kills MCP stdio processes. Relays JSON-RPC messages between webapp and MCP processes. For HTTP MCP servers, makes fetch calls directly. |
| Clay Webapp | Passthrough. Forwards MCP-related WebSocket messages between server and extension. Reports available MCP server list to server on connect. |
| Clay Server (project.js / sdk-bridge.js) | Receives the list of user's available MCP servers. Project settings determine which MCP servers are enabled per project. Proxies tool calls through the WebSocket relay. |
| Project Settings UI | Under project tools, MCP section above Skills. Checkboxes for each available MCP server. |

## User Flow

1. User installs Clay Chrome extension (already required for Clay).
2. In extension popup, user sets their MCP config file path (e.g. `~/.claude/claude_desktop_config.json`, `~/.cursor/mcp.json`, or any custom path).
3. Extension reads the file via Native Messaging host, displays server list.
4. User toggles servers ON/OFF in the extension popup.
5. In Clay project settings, user checks which of the ON servers this project can access.
6. Mate uses the checked MCP tools like any other tool.

## MCP Config File Format

Clay does not define its own format. It consumes the existing standard:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxxx" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/home/user/projects"]
    },
    "my-http-server": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

Clay reads this file as-is. The user owns the file. Clay never writes to it.

## Transport Handling

### stdio MCP servers (majority)

```
Server ──WebSocket──> Webapp ──Extension API──> Extension
    ──Native Messaging──> Native Host ──spawn──> MCP process (stdin/stdout)
```

1. Native Messaging host spawns the process with the configured `command`, `args`, and `env`.
2. MCP JSON-RPC messages flow over the process stdin/stdout.
3. Native host relays messages to/from the extension.
4. Extension relays to/from the webapp.
5. Webapp relays to/from the server via WebSocket.

### HTTP MCP servers (Streamable HTTP)

```
Server ──WebSocket──> Webapp ──fetch──> http://localhost:xxxx/mcp
```

Webapp calls the local HTTP endpoint directly via fetch. No Native Messaging needed. Extension is not involved.

## Native Messaging Host

A single lightweight native host binary/script registered once during extension install.

**Responsibilities:**
- Read MCP config file from a given path
- Spawn/manage stdio MCP server processes
- Relay JSON-RPC messages between extension and MCP processes
- Report process health (running/crashed/exited)

**Registration:** Standard Chrome Native Messaging manifest at:
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.clay.mcp_bridge.json`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.clay.mcp_bridge.json`
- Windows: Registry key pointing to manifest

```json
{
  "name": "com.clay.mcp_bridge",
  "description": "Clay MCP Bridge",
  "path": "/path/to/clay-mcp-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://EXTENSION_ID/"]
}
```

## WebSocket Protocol Additions

New message types between server and webapp:

### Webapp -> Server

```json
{
  "type": "mcp_servers_available",
  "servers": [
    { "name": "github", "transport": "stdio", "enabled": true },
    { "name": "filesystem", "transport": "stdio", "enabled": true },
    { "name": "my-http-server", "transport": "http", "enabled": false }
  ]
}
```

Sent on connect and whenever the list changes (toggle, config reload).

### Server -> Webapp

```json
{
  "type": "mcp_tool_call",
  "callId": "tc_abc123",
  "server": "github",
  "method": "tools/call",
  "params": {
    "name": "list_pull_requests",
    "arguments": { "repo": "owner/repo", "state": "open" }
  }
}
```

### Webapp -> Server

```json
{
  "type": "mcp_tool_result",
  "callId": "tc_abc123",
  "result": { "content": [{ "type": "text", "text": "..." }] }
}
```

```json
{
  "type": "mcp_tool_error",
  "callId": "tc_abc123",
  "error": "Process exited with code 1"
}
```

## Server-Side Integration

### sdk-bridge.js changes

Currently mcpServers are passed directly as in-process SDK MCP servers (line 137, 1185, 2057). For remote MCP servers, the bridge needs to:

1. On WebSocket connect, receive `mcp_servers_available` message.
2. For each enabled remote MCP server, create a proxy MCP server object that implements the same `createSdkMcpServer` interface but forwards calls over WebSocket.
3. Merge remote MCP servers with existing in-process servers (clay-debate, clay-browser).
4. Pass the merged set to `queryOptions.mcpServers`.

### project.js changes

Add per-project MCP server selection to project config:

```json
{
  "enabledMcpServers": ["github", "notion"]
}
```

Only checked servers are included in queryOptions for that project.

## Project Settings UI

```
┌─ Project Tools ──────────────────────────┐
│                                          │
│  MCP Servers                             │
│  Connected via Chrome Extension          │
│                                          │
│  ☑ github         4 tools               │
│  ☑ notion         6 tools               │
│  ☐ filesystem     3 tools               │
│  ☐ sentry         5 tools               │
│                                          │
│  Skills                                  │
│  ☑ web-search                            │
│  ☑ browser                               │
│  ☐ debate                                │
│                                          │
└──────────────────────────────────────────┘
```

If no extension connected or no MCP servers configured, show:

```
│  MCP Servers                             │
│  No MCP servers detected.               │
│  Configure in Clay Chrome Extension.     │
```

## Initialization Sequence

```
1. User opens Clay webapp
2. Webapp connects to server via WebSocket
3. Webapp checks if extension is available (existing pattern)
4. If extension has MCP servers enabled:
   a. Extension sends server list to webapp
   b. For each stdio server marked ON, native host spawns the process
   c. Webapp sends tools/list to each running MCP server
   d. Webapp sends mcp_servers_available (with tool counts) to server
5. Server merges remote MCP servers into project mcpServers
6. On next SDK query, merged tools are available to the model
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Extension not installed | MCP section shows "not detected" message. In-process MCP servers (debate, browser) still work. |
| Native host not registered | Extension popup shows setup instructions. |
| MCP process crashes | Native host reports error. Server receives mcp_tool_error. Mate sees error and can retry or inform user. |
| Config file not found | Extension popup shows "file not found" with path. |
| Config file changes | Extension watches file. On change, re-parse and notify webapp of updated list. |
| WebSocket disconnects | MCP processes stay alive (managed by native host). Reconnect resumes. |
| Tool call timeout | 30 second default. Configurable per server. Returns timeout error to Mate. |

## Security Considerations

- API keys and env vars never leave the user's machine. They stay in the config file and are passed to local processes by the native host.
- The server never sees MCP credentials. It only sees tool names, arguments, and results.
- Native Messaging is scoped to the extension ID. No other extension can access the host.
- HTTP MCP calls from webapp are limited to localhost/LAN by browser same-origin policy (unless the MCP server sets CORS headers).

## Out of Scope (for now)

- Clay-hosted MCP config UI (users manage their own config file)
- MCP server discovery/installation (users install servers themselves)
- Remote (non-local) MCP servers over the internet
- MCP resources and prompts (tools only in v1)
- MCP sampling (letting MCP servers call the model)
