# Kiro Integration Guide

How Clay integrates with the AWS **Kiro CLI** via the Agent Client Protocol
(ACP). Read this before changing anything in `lib/yoke/adapters/kiro.js` or
`lib/yoke/kiro-acp-server.js`.

---

## Architecture Overview

```
Clay session (vendor=kiro)
    |
    v
YOKE Kiro Adapter   (lib/yoke/adapters/kiro.js)
    |
    v
KiroAcpServer       (lib/yoke/kiro-acp-server.js)
    |
    v
Shared ACP Manager  (lib/yoke/acp-process-manager.js)
    |  spawn `kiro-cli acp --agent-engine v3`
    v  stdin/stdout JSON-RPC 2.0 (bidirectional)
kiro-cli binary     (~/.local/bin/kiro-cli)
    |
    +--> Kiro's built-in tools (fs, shell, search, ...)
    +--> MCP servers (from session/new mcpServers + ~/.kiro/settings/mcp.json)
```

Kiro CLI implements **ACP** — the same open, editor-agnostic agent protocol
used by Zed. This is structurally the same transport strategy as the Codex
`app-server` path: line-delimited JSON-RPC where the child both answers our
requests and initiates its own (streaming updates + permission requests).

> **Version status:** verified on 2026-08-15 against the latest CLI offered by
> the built-in updater, Kiro CLI 2.18.1, using its v3 engine (KAS 0.38.7).
> Kiro's public docs label the product generation "CLI 3.0", while the shipping
> binary still reports 2.18.1 and exposes v3 through `--agent-engine v3`.

---

## Why ACP, Not `chat --no-interactive`

`kiro-cli chat --no-interactive "<prompt>"` is a one-shot pipe: it takes a
single prompt, streams plain text, and exits. It cannot relay tool-approval
requests back to the client and has no multi-turn session. That is unusable for
Clay's interactive UI.

`kiro-cli acp` keeps stdin open, supports multi-turn prompts, streams
structured `session/update` events, and sends `session/request_permission`
requests we can route through Clay's `canUseTool`. Always use ACP mode.

---

## Key Files

| File | Purpose |
|------|---------|
| `lib/yoke/adapters/kiro.js` | YOKE adapter. Init, model catalog, createQuery, event flattening, permission routing, abort. |
| `lib/yoke/acp-process-manager.js` | Vendor-neutral stdio process manager. JSON-RPC request tracking and session-aware event routing. |
| `lib/yoke/kiro-acp-server.js` | Thin Kiro profile. Binary discovery, spawn arguments, and auth-error detection. |
| `lib/kiro-defaults.js` | **Single source of truth** for Kiro defaults (agent/mode). Do not duplicate elsewhere. |

---

## ACP Protocol (verified against kiro-cli 2.18.1, v3 engine)

### Handshake
```
initialize { protocolVersion: 1, clientCapabilities: { fs: {...} } }
  -> { protocolVersion, agentCapabilities, agentInfo }
```

The v3 engine sends `_kiro/auth/getAccessToken` requests before and during
session work. Clay answers them by running
`kiro-cli chat _ get-kas-token` and returning its `data` object. This request
is process-wide and is handled by the ACP transport even when no query handler
has been registered yet.

### Session lifecycle
```
session/new  { cwd, mcpServers: [] }   -> { sessionId, modes, models }
session/load { sessionId, cwd, mcpServers } -> replays history, then {}   (resume)
session/set_config_option { sessionId, configId:"model", value:modelId } -> {}
session/set_mode  { sessionId, modeId }     -> {}
session/set_config_option { sessionId, configId:"autopilot", value:"off" } -> {}
session/prompt { sessionId, prompt: [{ type:"text", text }] }
  ...streams session/update notifications...
  -> { stopReason: "end_turn" | "cancelled" | ... }   (request resolves at turn end)
session/cancel { sessionId }   (notification; in-flight prompt resolves "cancelled")
```

> The prompt content field is **`prompt`** (an array of content blocks), not
> `content`. Verified by driving the real binary.

### Streaming updates (`session/update`, discriminated by `update.sessionUpdate`)
| sessionUpdate | Meaning | yokeType emitted |
|---------------|---------|------------------|
| `agent_message_chunk` | assistant text delta | `text_start` / `text_delta` |
| `agent_thought_chunk` | reasoning delta | `thinking_start` / `thinking_delta` |
| `tool_call` | tool announced (has `kind`, `rawInput`) | `tool_start` + `tool_executing` |
| `tool_call_update` | tool progress/completion | `tool_result` |
| `plan` | plan entries | `plan_updated` |
| `usage_update` | token usage (`used`, `size`) | (tracked for context bar) |
| `session_info_update` | v3 context percentage under `_meta.kiro` | (converted to estimated tokens for context bar) |

### Permission requests (server -> client, has an `id`)
```
session/request_permission {
  sessionId, toolCall: { toolCallId, title },
  options: [ {optionId,kind:"allow_once"}, {optionId,kind:"allow_always"}, {optionId,kind:"reject_once"} ]
}
```
Response: `{ outcome: { outcome: "selected", optionId } }` or
`{ outcome: { outcome: "cancelled" } }`.

---

## Critical Patterns

### 1. Permission payload lacks kind/rawInput — cache from `tool_call`
The `session/request_permission` payload only carries `{ toolCallId, title }`
(e.g. title `"Running: echo hi"`). Clay's permission whitelist keys on
canonical tool names (`Bash`, `Edit`, ...), so the adapter caches `kind` +
`rawInput` from the preceding `tool_call` notification in `state.toolMeta` and
uses it to build the `canUseTool(toolName, input)` call. Without this,
auto-approval matching breaks. See `state.toolMeta` in `kiro.js`.

### 2. Permission response is a nested `outcome` object
`{ outcome: { outcome: "selected", optionId } }` — the doubly-nested `outcome`
is intentional and matches the ACP spec. A bare string or single-level object
is treated as a rejection.

### 3. Turn ends via the `session/prompt` response, not an event
Unlike Codex (`turn/completed` notification), ACP resolves the original
`session/prompt` **request** with `{ stopReason }`. The adapter's query loop
awaits that resolution, then emits the YOKE `result` event.

### 4. Abort is a notification
`handle.abort()` sends `session/cancel` (a notification) and ends the iterator
immediately. sdk-bridge's post-loop code sends the "interrupted" message +
`done` when `session.taskStopRequested` is set — the adapter does not emit them
itself. This mirrors the Claude/Codex abort pattern.

### 5. Model catalog is dynamic (like Claude, unlike Codex)
`init()` runs `kiro-cli chat --list-models --format json` and filters out
`[Internal]` / `[Deprecated]` entries for a clean picker. The `auto` router
model is the default. If the CLI call fails, a minimal fallback set is used.

Kiro v3 removed `session/set_model`; model changes use
`session/set_config_option` with `configId: "model"`. The adapter keeps the v2
method only when `CLAY_KIRO_AGENT_ENGINE` explicitly selects an older engine.

### 6. No TUI adapter
Kiro sessions are always GUI mode (`project-sessions.js` forces `gui`), same as
Codex. There is no `kiro --session-id` TUI shell path.

### 7. Auth
`kiro-cli whoami` (exit 0 when logged in) drives install/auth detection in
`yoke/index.js` and `sdk-bridge.detectInstalledVendors`. The login command is
`kiro-cli login`. Auth failures on stderr (401 / expired token) are mapped to
the neutral `auth_required` yokeType.

### 8. MCP configuration

Kiro sessions currently use Kiro's native MCP configuration from
`~/.kiro/settings/mcp.json`. Clay-managed MCP servers are intentionally not
forwarded through `session/new` or `session/load` yet. Forwarding them requires
verifying the CLI 3.x ACP entry shape and preventing duplicate registration
with servers already loaded by Kiro.

### 9. OS-user isolation

Kiro is hidden and rejected when Clay runs a session under an isolated Linux
user. The ACP child currently spawns as the daemon user, so enabling it in that
mode would expose the daemon user's home directory and Kiro credentials. A
future per-user spawn path is required before this restriction can be removed.

### 10. Supervised tool execution is mandatory

New v3 sessions report `autopilot: "on"` by default, which would execute tools
without Clay's approval UI. Before selecting the model or prompting, the
adapter sets `autopilot` to `"off"`. Failure is fatal for the query; it is never
silently ignored. Permission requests then retain the existing nested outcome
shape and include allow/reject once/always options.

---

## Capabilities

```js
{
  thinking: true,          // agent_thought_chunk
  betas: false,
  rewind: false,
  sessionResume: true,     // session/load
  promptSuggestions: false,
  elicitation: false,
  fileCheckpointing: false,
  contextCompacting: true, // /compact exists
  toolPolicy: ["ask", "allow-all"],
}
```

---

## Testing Checklist

When changing the Kiro adapter:

- [ ] `init()` returns a filtered model list (no `[Internal]`/`[Deprecated]`)
- [ ] Text response streams in real time (`agent_message_chunk`)
- [ ] Model selection works (`session/set_config_option`, `configId: "model"`)
- [ ] Bash tool shows approval UI with canonical name `Bash` + `{command}`
- [ ] Approve/deny routes through `canUseTool` correctly
- [ ] Stop button interrupts the turn and clears the typing indicator
- [ ] Switching between Kiro and Claude/Codex sessions shows the right vendor UI
- [ ] `kiro-cli whoami` logged-out state surfaces the auth_required flow

---

## When Things Get Weird

1. Check server console for `[yoke/kiro]` and `[kiro-acp-server]` logs.
2. Drive the protocol directly: `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}' | kiro-cli acp` (keep stdin open with a trailing sleep).
3. `kiro-cli chat --list-models --format json` to inspect the model catalog.
4. `kiro-cli whoami` to check auth.
