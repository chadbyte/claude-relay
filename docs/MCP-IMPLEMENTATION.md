# MCP Implementation Guide

> How MCP servers connect to Clay. Read this before working on any MCP-related code.

---

## Architecture Overview

MCP servers let Mates (and Claude Code sessions) use external tools (GitHub, Notion, filesystem, etc.). There are two connection paths depending on whether the user is local or remote.

```
LOCAL USER (same machine as Clay server):
  Clay Server -> spawns MCP process directly -> stdin/stdout JSON-RPC

REMOTE USER (browser on different machine):
  Clay Server -> WebSocket -> Webapp -> Extension -> Native Host -> MCP process
```

---

## Repositories

| Repo | Purpose | URL |
|------|---------|-----|
| `clay` (this repo) | Server-side MCP: `lib/mcp-local.js`, `lib/project-mcp.js`, `native-host/` | github.com/chadbyte/clay |
| `clay-chrome` | Chrome Extension: popup UI, background.js relay, content.js bridge | github.com/chadbyte/clay-chrome |
| `clay-mcp-bridge` | npm package: Native Messaging Host for remote users | github.com/chadbyte/clay-mcp-bridge |

---

## Connection Path: Local

When `ws._clayLocal` is true (client IP is 127.0.0.1 / ::1), Clay server manages MCP processes directly via `lib/mcp-local.js`.

```
lib/mcp-local.js    reads ~/.clay/mcp.json, spawns processes, relays JSON-RPC
lib/project.js      creates _localMcp, initializes on local client connect
lib/project-mcp.js  builds SDK proxy servers from local tools (createLocalToolHandler)
```

**Flow:**
1. Local client connects -> `ws._clayLocal = true` (set in server.js upgrade handler)
2. `handleConnection` in project.js calls `_localMcp.initialize()`
3. `mcp-local.js` reads `~/.clay/mcp.json`, spawns all configured servers
4. Each server goes through MCP handshake (initialize -> notifications/initialized -> tools/list)
5. When ready, `_mcp.rebuildAndBroadcast()` builds SDK proxy servers
6. `createLocalToolHandler` returns a function that calls `localMcp.callTool()` directly

---

## Connection Path: Remote

When `ws._clayLocal` is false, MCP processes run on the user's machine via the Native Host bridge.

### Components

| Component | Location | Role |
|-----------|----------|------|
| `lib/project-mcp.js` | Clay server | Builds SDK proxy servers, relays tool calls via WebSocket |
| `lib/public/modules/app-misc.js` | Webapp (browser) | Forwards messages between server WS and Extension |
| `clay-chrome/content.js` | Extension content script | Port bridge between webapp and service worker |
| `clay-chrome/background.js` | Extension service worker | Connects to Native Host, relays messages |
| `clay-mcp-bridge/host.js` | Native Host (user's machine) | Spawns MCP processes, manages config |

### Message Flow: Server -> MCP Process

```
1. SDK needs a tool call
2. project-mcp.js createToolHandler() sends to extension WS:
   { type: "mcp_tool_call", callId, server, method, params }

3. Webapp app-misc.js handleMcpToolCallMessage() receives via WS
4. Calls forwardMcpToolCall() -> window.postMessage:
   { source: "clay-page", payload: { type: "clay_mcp_tool_call", ... } }

5. content.js receives, forwards via port.postMessage to background.js

6. background.js matches "clay_mcp_tool_call", calls mcpRelayToolCall()
7. mcpRelayToolCall() sends to Native Host via mcpSendNative():
   { type: "mcp_request", server, method, params, callId }

8. Native Host relayToolCall() sends JSON-RPC to MCP process stdin:
   { jsonrpc: "2.0", id: N, method: "tools/call", params: { name, arguments } }
```

### Message Flow: MCP Process -> Server (response)

```
1. MCP process writes JSON-RPC response to stdout

2. Native Host drainJsonRpc() parses, handleMcpResponse() matches rpcId
3. Sends back: { type: "mcp_response", callId, result/error }

4. background.js mcpHandleNativeMessage() matches callId to pending callback
5. Callback calls sendToClayTab():
   { type: "mcp_tool_result", callId, result, error }

6. content.js receives via port, forwards to page via window.postMessage

7. app-misc.js receives "mcp_tool_result", forwards to server via WS:
   { type: "mcp_tool_result" or "mcp_tool_error", callId, result/error }

8. project-mcp.js handleToolResult() resolves the pending Promise
```

### Message Flow: Server List (Extension -> Server)

```
1. Native Host auto-starts servers from ~/.clay/mcp.json on launch
2. When a server finishes MCP handshake, Native Host sends:
   { type: "server_ready", server, tools }

3. background.js receives, calls broadcastMcpServers()
4. broadcastMcpServers() calls get_servers on Native Host, gets full list
5. Broadcasts to Clay tabs:
   { type: "mcp_servers_available", servers: [...], hostConnected: true }

6. content.js forwards to page

7. app-misc.js receives "mcp_servers_available", forwards to server via WS

8. project-mcp.js handleServersAvailable() stores in _availableServers
9. rebuildProxyServers() creates SDK proxy servers with tools
10. broadcastMcpState() sends mcp_servers_state to all clients (for UI)
```

---

## Message Type Reference

### Webapp <-> Extension (window.postMessage)

| Direction | Type | Purpose |
|-----------|------|---------|
| Ext -> Page | `clay_ext_tab_list` | Browser tab list (includes extensionId) |
| Ext -> Page | `clay_ext_result` | Extension command result |
| Ext -> Page | `clay_ext_disconnected` | Extension context invalidated |
| Ext -> Page | `mcp_servers_available` | MCP server list from Native Host |
| Ext -> Page | `mcp_tool_result` | MCP tool call result |
| Page -> Ext | `clay_ext_command` | Browser automation command |
| Page -> Ext | `clay_mcp_tool_call` | MCP tool call to relay |

### Server <-> Webapp (WebSocket)

| Direction | Type | Purpose |
|-----------|------|---------|
| S -> W | `mcp_tool_call` | Tool call for Extension to relay |
| S -> W | `mcp_servers_state` | Full server state (for UI rendering) |
| W -> S | `browser_tab_list` | Tab list (sets _extensionWs, extensionId) |
| W -> S | `mcp_servers_available` | Server list from Extension |
| W -> S | `mcp_tool_result` | Tool result from Extension relay |
| W -> S | `mcp_tool_error` | Tool error from Extension relay |
| W -> S | `mcp_toggle_server` | Toggle server enabled for project |

### Extension <-> Native Host (Chrome Native Messaging)

| Direction | Type | Purpose |
|-----------|------|---------|
| Ext -> NH | `ping` | Health check |
| Ext -> NH | `get_servers` | Get all configured servers with status |
| Ext -> NH | `add_server` | Add server to ~/.clay/mcp.json |
| Ext -> NH | `remove_server` | Remove server from config |
| Ext -> NH | `import_config` | Add external config to include list |
| Ext -> NH | `get_imports` | Get include list |
| Ext -> NH | `remove_import` | Remove from include list |
| Ext -> NH | `mcp_request` | Relay tool call to MCP process |
| NH -> Ext | `pong` | Health check response |
| NH -> Ext | `server_ready` | Server finished MCP handshake |
| NH -> Ext | `server_status` | Server started/crashed/exited |
| NH -> Ext | `mcp_response` | Tool call result from MCP process |

---

## Key Files

| File | Purpose |
|------|---------|
| `lib/mcp-local.js` | Local MCP process manager (localhost clients) |
| `lib/project-mcp.js` | MCP bridge module, proxy server builder, toggle handler |
| `lib/project.js` | Creates _localMcp, wires to _mcp, detects local clients |
| `lib/project-user-message.js` | Handles browser_tab_list (sets _extensionWs) |
| `lib/server.js` | Sets ws._clayLocal, passes MCP callbacks to project context |
| `lib/daemon.js` | onGetProjectMcpServers / onSetProjectMcpServers (config persistence) |
| `lib/public/modules/app-misc.js` | Webapp MCP message forwarding |
| `lib/public/modules/mcp-ui.js` | MCP Servers modal (setup wizard + toggle list) |
| `native-host/clay-mcp-host.js` | Native Host source (also in clay-mcp-bridge npm package) |

## Config

### ~/.clay/mcp.json (managed by Native Host)

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/chad"],
      "env": {}
    }
  },
  "include": [
    "~/.claude/claude_desktop_config.json"
  ]
}
```

### daemon.json (per-project enabled list)

```json
{
  "projects": [
    {
      "slug": "my-project",
      "enabledMcpServers": ["filesystem", "github"]
    }
  ]
}
```

---

## Setup Wizard (MCP Servers Modal)

The modal shows a 3-step wizard when setup is incomplete:

1. **Install Chrome Extension** - connected via browser_tab_list detection
2. **Install MCP Bridge** - `npx clay-mcp-bridge install <extension-id>` (remote only, local auto-completes)
3. **Add MCP Servers** - via Extension popup (+) button or import existing config

When all steps are done, wizard hides and shows server toggle list.

State tracked by: `_extensionConnected`, `_nativeHostConnected` (from hostConnected in mcp_servers_state), server count.

---

## Common Issues

- **Extension not detected**: Clay page must be refreshed after extension install/reload
- **Native Host not found**: Browser must be restarted after `npx clay-mcp-bridge install`
- **npx not found by Native Host**: Chrome uses minimal PATH. The install script writes absolute node path in wrapper
- **Tool call timeout**: Check message type alignment (clay_mcp_tool_call vs mcp_tool_call)
- **Toggle not persisting**: Verify onSetProjectMcpServers is wired through server.js to project context
- **Service worker state lost**: MV3 SWs lose memory on sleep. Use URL pattern matching for tab detection, not in-memory Sets
- **Multi-server setup**: Each Clay tab needs its own port in background.js `clayPorts`. Check `Object.keys(clayPorts)` in SW console

---

## Installation (Remote Users)

```bash
npx clay-mcp-bridge install <extension-id>
```

Find extension ID at `chrome://extensions` (look for "Clay").

Installs to:
- `~/.clay/mcp-bridge/host.js` - permanent copy of Native Host
- `~/.clay/mcp-bridge/clay-mcp-host` - bash wrapper with absolute node path
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.clay.mcp_bridge.json` (macOS Chrome)
- `~/Library/Application Support/Arc/User Data/NativeMessagingHosts/com.clay.mcp_bridge.json` (macOS Arc)
- `~/Library/Application Support/Chromium/NativeMessagingHosts/com.clay.mcp_bridge.json` (macOS Chromium)
- `~/.config/google-chrome/NativeMessagingHosts/com.clay.mcp_bridge.json` (Linux Chrome)

**Requires browser restart** after install. No sudo needed.

Uninstall: `npx clay-mcp-bridge uninstall`
