# Architecture

Clay is not a CLI wrapper.
It drives Claude Code directly via the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).
It is a local relay server that keeps the same execution model while streaming to the browser over WebSocket.

## System Overview

```mermaid
graph LR
    Browser["Browser<br/>(Phone / Desktop)"]
    WS["WebSocket"]
    Server["HTTP Server<br/>lib/server.js"]
    Project["Project Context<br/>lib/project.js"]
    SDK["Claude Agent SDK"]
    Claude["Claude Code<br/>Process"]
    Push["Push Service"]

    Browser <-->|Real time stream| WS
    WS <--> Server
    Server -->|slug routing| Project
    Project <-->|async iterable| SDK
    SDK <-->|Prompt / Response| Claude
    Project -->|Approval request| Push
    Push -->|Notification| Browser
```

## Request Flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant S as Server
    participant SDK as Agent SDK
    participant C as Claude

    B->>S: Send prompt (WebSocket)
    S->>SDK: messageQueue.push()
    SDK->>C: Forward prompt
    C-->>SDK: Stream response
    SDK-->>S: delta / tool_start / tool_result
    S-->>B: Real time broadcast

    Note over S,B: When approval is required
    SDK->>S: canUseTool() callback
    S-->>B: permission_request
    S-->>B: Send push notification
    B->>S: permission_response (allow/deny)
    S->>SDK: Promise resolve
    SDK->>C: Continue tool execution
```

## Daemon Structure

```mermaid
graph TB
    CLI1["npx clay-server<br/>(Terminal 1)"]
    CLI2["npx clay-server<br/>(Terminal 2)"]
    IPC["Unix Socket<br/>daemon.sock"]
    Daemon["Daemon Process<br/>lib/daemon.js"]
    HTTP["HTTP/WS Server<br/>:2633"]
    P1["Project A"]
    P2["Project B"]
    Sessions1["sessions/<br/>*.jsonl"]
    Sessions2["sessions/<br/>*.jsonl"]

    CLI1 <-->|IPC| IPC
    CLI2 <-->|IPC| IPC
    IPC <--> Daemon
    Daemon --- HTTP
    HTTP -->|/p/project-a/| P1
    HTTP -->|/p/project-b/| P2
    P1 --- Sessions1
    P2 --- Sessions2
```

The CLI spawns the daemon process with `detached: true`. The daemon keeps running in the background even after the CLI is closed. Multiple CLI instances connect to a single daemon via Unix Socket IPC.

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Unix Socket IPC | CLI–daemon communication without opening an additional TCP port |
| Background daemon | Server persists after CLI exits. Spawned with `detached: true` |
| JSONL session storage | Append-only for speed. Minimizes data loss on crashes |
| Slug-based routing | Multiple projects on a single port, separated by `/p/{slug}/` |
| Async Iterable | Connects the SDK message queue and response stream via async iterators |
| File path validation | Symlink resolution + blocks access outside the project directory |
| `0.0.0.0` binding + PIN | Allows LAN access with PIN authentication. VPN recommended for remote |

## Session Storage

Sessions are stored at `~/.clay/sessions/{encoded-cwd}/{cliSessionId}.jsonl`.

```
Line 1:  {"type":"meta","localId":1,"cliSessionId":"...","title":"...","createdAt":...}
Line 2+: {"type":"user_message","text":"..."}
         {"type":"delta","text":"..."}
         {"type":"tool_start","id":"...","name":"..."}
         ...
```

The append-only JSONL format means at most the last line is lost on a crash. On daemon restart, all session files are read and restored.

## Permission Flow

1. The SDK invokes the `canUseTool()` callback
2. The server creates a Promise and stores it in `pendingPermissions[requestId]`
3. A `permission_request` message is sent to all connected clients
4. A push notification is sent
5. When a client sends a `permission_response`, the Promise is resolved
6. The SDK continues tool execution

## Multi-Project Routing

```
/                    → Dashboard (redirects if only one project)
/p/{slug}/           → Project UI
/p/{slug}/ws         → WebSocket connection
/p/{slug}/api/...    → Project API (push subscription, permission response, file access)
```

Slugs are auto-generated from the project directory name. Duplicates get `-2`, `-3`, etc.

## IPC Protocol

Line-delimited JSON over a Unix Domain Socket.

```
CLI → Daemon: {"cmd":"add_project","path":"/home/user/myproject"}\n
Daemon → CLI: {"ok":true,"slug":"myproject"}\n
```

Supported commands: `add_project`, `remove_project`, `get_status`, `set_pin`, `set_project_title`, `set_keep_awake`, `shutdown`
