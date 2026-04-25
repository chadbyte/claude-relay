# Tool Permission Management

> Per-tool permission controls with three-level override: User Settings > Project Settings > Session. Each tool can be set to auto-approve, ask before running, or deny.

**Created**: 2026-04-17
**Status**: Planning

---

## Problem

Currently, tool permissions are a blanket setting (default / acceptEdits / bypassPermissions) with a hardcoded whitelist for read-only tools. Users cannot control permissions per individual tool. For example, a user might want `clay_send_email` to always ask, but `clay_mark_read` to auto-approve.

## Goals

- Per-tool permission settings: `auto` (auto-approve), `ask` (require user confirmation), `deny` (block)
- Three-level override hierarchy: User Settings (global default) > Project Settings (per-project override) > Session (per-session override, highest priority)
- UI for managing permissions at each level
- Sensible defaults based on tool risk level (read-only = auto, write = ask, destructive = ask)

## Scope

Applies to all tool types:
- Built-in SDK tools (Bash, Edit, Write, etc.)
- MCP tools (browser, email, debate, remote servers)
- Any future tool additions

## Design

### Permission Levels

| Level | Stored at | Overrides |
|-------|-----------|-----------|
| User Settings | `~/.clay/users.json` (per-user `toolPermissions`) | Base defaults |
| Project Settings | daemon config (per-project `toolPermissions`) | User Settings |
| Session | In-memory on session object | Project Settings |

### Resolution Order

```
session.toolPermissions[toolName]
  || projectConfig.toolPermissions[toolName]
  || user.toolPermissions[toolName]
  || defaultPermission(toolName)
```

### Default Permissions by Risk

| Risk | Default | Examples |
|------|---------|----------|
| Read-only | `auto` | Read, Glob, Grep, clay_read_email, clay_search_email |
| State change | `ask` | Edit, Write, clay_mark_read |
| External effect | `ask` | Bash, clay_send_email, clay_reply_email |
| Destructive | `ask` | git reset, rm, database mutations |

## Open Questions

1. Should denied tools be hidden from the model, or should the model see them but get a denial message?
2. How to handle new/unknown tools (default to `ask`)?
3. Should there be a "trusted tools" concept where the user pre-approves a set?
