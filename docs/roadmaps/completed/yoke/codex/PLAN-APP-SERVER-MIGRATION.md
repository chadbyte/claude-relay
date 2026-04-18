# Codex Adapter: SDK exec -> app-server Migration Plan

## Problem

The current Codex adapter uses `@openai/codex-sdk` which internally runs `codex exec --experimental-json`. This mode closes stdin immediately after writing the prompt, making **all interactive approval impossible**:

- Command execution approval -> auto-cancelled
- File change approval -> auto-cancelled  
- MCP tool call approval -> auto-cancelled (Issue #15824)
- `tool/requestUserInput` -> auto-cancelled

The only workaround is `approval_policy = "never"` + `sandbox = danger-full-access`, which removes all safety guardrails.

## Solution

Replace the SDK's `exec` mode with `codex app-server` protocol. This is the same protocol used by VS Code Codex extension. It supports full bidirectional JSON-RPC communication over stdin/stdout.

## Architecture Comparison

```
CURRENT (SDK exec mode):
  Codex adapter -> @openai/codex-sdk -> Thread.runStreamed()
    -> spawn("codex", ["exec", "--experimental-json"])
    -> stdin.write(prompt); stdin.end()  // ONE-WAY
    -> for await (line of stdout) yield JSON.parse(line)

TARGET (app-server mode):
  Codex adapter -> spawn("codex", ["app-server"])
    -> stdin/stdout JSON-RPC bidirectional  // TWO-WAY
    -> send: initialize, thread/start, turn/start
    -> receive: item/*, turn/*, thread/*
    -> receive: requestApproval -> show in Clay UI -> send response via stdin
```

## app-server Protocol Summary

Reference: `docs/roadmaps/in-progress/yoke/codex/llms-full.txt` section "Codex App Server"

### Lifecycle

1. Spawn: `spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "inherit"] })`
2. Initialize: send `initialize` request, then `initialized` notification
3. Start thread: send `thread/start` -> get threadId
4. Start turn: send `turn/start` with threadId + user input
5. Stream events: read stdout for notifications
6. Handle approvals: respond via stdin
7. Multi-turn: send another `turn/start` when user sends next message

### Key Message Types

**Client -> Server (stdin):**
| Method | Purpose |
|--------|---------|
| `initialize` | Handshake with clientInfo |
| `initialized` | Notification after init |
| `thread/start` | Create new thread (returns threadId) |
| `thread/resume` | Resume existing thread |
| `turn/start` | Send user message, start agent turn |
| `turn/interrupt` | Stop current turn |
| Response to `requestApproval` | Approve/decline command or file change |
| Response to `requestUserInput` | Answer MCP elicitation |

**Server -> Client (stdout):**
| Event | Purpose |
|-------|---------|
| `thread/started` | Thread created with threadId |
| `turn/started` | Turn began |
| `turn/completed` | Turn finished (with usage stats) |
| `turn/failed` | Turn failed with error |
| `item/started` | Item began (text, command, file change, MCP call) |
| `item/updated` | Item progress update |
| `item/completed` | Item finished |
| `item/agentMessage/delta` | Streaming text delta |
| `item/commandExecution/requestApproval` | Approval request for command |
| `item/fileChange/requestApproval` | Approval request for file change |
| `item/tool/requestUserInput` | MCP tool approval/elicitation |
| `serverRequest/resolved` | Confirms approval was processed |

### Approval Flow

```
1. Server emits: item/commandExecution/requestApproval
   { id: N, method: "item/commandExecution/requestApproval",
     params: { itemId, threadId, turnId, command, ... } }

2. Client responds via stdin:
   { id: N, result: "accept" }
   // or "acceptForSession", "decline", "cancel"

3. Server emits: serverRequest/resolved
4. Server emits: item/completed with status
```

Same pattern for file changes and MCP tool calls.

### Item Types (from stdout events)

| item.type | Maps to YOKE | Description |
|-----------|-------------|-------------|
| `agent_message` | text_delta | Agent text response |
| `reasoning` | thinking_delta | Chain of thought |
| `command_execution` | tool (Bash) | Shell command |
| `file_change` | tool (Edit) | File modification |
| `mcp_tool_call` | tool (MCP) | MCP server tool call |
| `web_search` | tool (WebSearch) | Web search |
| `error` | error | Error message |

## Implementation Steps

### Step 1: Create CodexAppServer class

File: `lib/yoke/codex-app-server.js` (new file)

A reusable class that manages the codex app-server child process:

```javascript
// Responsibilities:
// - Spawn codex app-server process
// - JSON-RPC message send/receive over stdin/stdout
// - Request ID tracking
// - Pending request callbacks (for responses)
// - Process lifecycle (start, restart, kill)
// - Event emitter or async iterator for notifications

var { spawn } = require("child_process");
var readline = require("readline");

function CodexAppServer(executablePath, opts) {
  this.proc = null;
  this.rl = null;
  this.nextId = 1;
  this.pendingRequests = {};  // id -> { resolve, reject }
  this.eventHandler = null;   // function(notification) for server-initiated events
  this.executablePath = executablePath;
  this.opts = opts || {};
}

CodexAppServer.prototype.start = function() { ... };
CodexAppServer.prototype.send = function(method, params) { ... };  // returns Promise
CodexAppServer.prototype.notify = function(method, params) { ... }; // no response expected
CodexAppServer.prototype.respond = function(id, result) { ... };   // respond to server request
CodexAppServer.prototype.stop = function() { ... };
```

### Step 2: Modify Codex adapter init

File: `lib/yoke/adapters/codex.js`

Replace SDK-based init with app-server:

```javascript
// BEFORE:
var codexModule = await loadSDK();
var Codex = codexModule.Codex;
_codex = new Codex(codexOpts);

// AFTER:
var codexPath = findCodexPath(); // reuse SDK's path finder
_appServer = new CodexAppServer(codexPath, {
  config: codexOpts.config,
  env: codexOpts.env,
});
await _appServer.start();
await _appServer.send("initialize", {
  clientInfo: { name: "clay", title: "Clay", version: "1.0.0" },
  capabilities: { experimentalApi: true },
});
_appServer.notify("initialized", {});
```

### Step 3: Rewrite createQuery

Replace Thread-based query with app-server turn:

```javascript
// BEFORE:
var thread = _codex.startThread(threadOpts);
var streamResult = await thread.runStreamed(message, { signal });
for await (var evt of streamResult.events) { ... }

// AFTER:
var threadResult = await _appServer.send("thread/start", {
  model: model,
  sandboxMode: threadOpts.sandboxMode,
  approvalPolicy: threadOpts.approvalPolicy,
  // ... other thread options
});
var threadId = threadResult.thread.id;

// Start turn
await _appServer.send("turn/start", {
  threadId: threadId,
  input: [{ type: "text", text: message }],
});

// Stream events via _appServer.eventHandler
// Each event gets flattenEvent'd and pushed to the async iterator
```

### Step 4: Handle approval events

The key improvement. When an approval event arrives:

```javascript
_appServer.eventHandler = function(notification) {
  // Command approval
  if (notification.method === "item/commandExecution/requestApproval") {
    var params = notification.params;
    // Forward to Clay UI via canUseTool callback
    queryOpts.canUseTool("Bash", { command: params.command }, {}).then(function(decision) {
      if (decision === true) {
        _appServer.respond(notification.id, "accept");
      } else {
        _appServer.respond(notification.id, "decline");
      }
    });
    return; // don't push to event stream yet
  }

  // File change approval
  if (notification.method === "item/fileChange/requestApproval") {
    // Similar: forward to Clay permission UI
  }

  // MCP tool approval
  if (notification.method === "item/tool/requestUserInput") {
    // Auto-approve MCP tools (user already enabled in Clay MCP UI)
    _appServer.respond(notification.id, { accepted: true });
    return;
  }

  // Regular event: flatten and push to iterator
  var yokeEvents = flattenEvent(notification, state);
  for (var i = 0; i < yokeEvents.length; i++) {
    pushEvent(yokeEvents[i]);
  }
};
```

### Step 5: Adapt flattenEvent

The app-server event format differs from `exec --experimental-json`:

- `exec` emits: `{ type: "item.started", item: { type: "agent_message", ... } }`
- `app-server` emits: `{ method: "item/started", params: { item: { type: "agentMessage", ... } } }`

Key differences:
- Dot notation -> slash notation (`item.started` -> `item/started`)
- camelCase item types (`agent_message` -> `agentMessage`)
- Wrapped in `{ method, params }` JSON-RPC format

The `flattenEvent` function needs to be updated to handle this format.

### Step 6: Multi-turn support

```javascript
handle.pushMessage = function(text) {
  _appServer.send("turn/start", {
    threadId: threadId,
    input: [{ type: "text", text: text }],
  });
};
```

### Step 7: Session resume

```javascript
// Resume existing thread
var threadResult = await _appServer.send("thread/resume", {
  threadId: existingThreadId,
  model: model,
});
```

### Step 8: MCP servers

MCP servers are configured via thread options or config, same as before:

```javascript
await _appServer.send("thread/start", {
  model: model,
  config: {
    mcp_servers: mcpServerConfig,  // clay-tools bridge
  },
});
```

The bridge server (`mcp-bridge-server.js`) and global HTTP endpoint (`/api/mcp-bridge`) remain unchanged.

## Files to Modify

| File | Change |
|------|--------|
| `lib/yoke/codex-app-server.js` | **NEW** - CodexAppServer class |
| `lib/yoke/adapters/codex.js` | Replace SDK with app-server, rewrite init/createQuery/flattenEvent |
| `package.json` | Can remove `@openai/codex-sdk` dependency (keep `@openai/codex` for the binary) |

## Files NOT Changed

| File | Reason |
|------|--------|
| `lib/sdk-bridge.js` | YOKE interface stays the same |
| `lib/yoke/mcp-bridge-server.js` | HTTP bridge unchanged |
| `lib/server.js` | Global endpoint unchanged |
| `lib/project.js` | MCP handler unchanged |

## Testing Checklist

- [ ] Basic text response (agent_message)
- [ ] Thinking/reasoning display
- [ ] Command execution (Bash) with approval prompt in Clay UI
- [ ] File change with approval prompt in Clay UI
- [ ] MCP tool call (filesystem via bridge)
- [ ] MCP tool call approval (tool/requestUserInput)
- [ ] Multi-turn conversation
- [ ] Session resume
- [ ] Model switching
- [ ] Abort/interrupt turn
- [ ] Error handling (turn/failed)
- [ ] Process crash recovery

## Risk Assessment

- **Low risk**: app-server protocol is stable (VS Code extension uses it)
- **Medium risk**: event format differences may require careful mapping
- **Low risk**: MCP bridge is unchanged, only the adapter layer changes
- **Note**: `@openai/codex-sdk` becomes unused but `@openai/codex` (CLI binary) is still needed

## Reference

- Protocol docs: `docs/roadmaps/in-progress/yoke/codex/llms-full.txt` section "Codex App Server"
- VS Code extension uses the same protocol
- Generate TypeScript schema: `codex app-server generate-ts --out ./schemas`
- Generate JSON schema: `codex app-server generate-json-schema --out ./schemas`
