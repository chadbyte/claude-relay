# API Catalog

> User-managed registry of external APIs and webhooks. Mates call registered APIs as SDK tools without curl or MCP servers. Credentials stored encrypted, requests logged.

**Created**: 2026-04-17
**Status**: Planning

---

## Problem

Mates have no first-class way to call external APIs. Current workarounds:
- Bash + curl (requires permission each time, credentials in plain text in command)
- MCP servers (requires separate process, installation, configuration)
- Hardcoded in Mate instructions ("use this curl command to...")

Users repeatedly set up the same API calls across sessions. Credentials get scattered. There is no audit trail.

## Vision

Users register APIs once. Mates use them as tools.

```
User registers:
  Name: slack-deploy
  URL: https://hooks.slack.com/services/T.../B.../xxx
  Method: POST
  Body template: { "text": "{{message}}" }

Mate uses:
  clay_api_call("slack-deploy", { message: "v2.31 deployed!" })
  -> 200 OK
```

---

## API Entry Format

Each API entry stored per-user:

```
~/.clay/api-catalog/{userId}.json
```

```json
{
  "apis": [
    {
      "id": "api_abc123",
      "name": "slack-deploy",
      "description": "Post deployment notifications to #ops channel",
      "url": "https://hooks.slack.com/services/T.../B.../xxx",
      "method": "POST",
      "headers": {
        "Content-Type": "application/json"
      },
      "auth": {
        "type": "none"
      },
      "bodyTemplate": "{ \"text\": \"{{message}}\" }",
      "parameters": {
        "message": { "type": "string", "required": true, "description": "Notification text" }
      },
      "addedAt": 1712700000,
      "label": "Slack"
    },
    {
      "id": "api_def456",
      "name": "github-create-issue",
      "description": "Create an issue in a GitHub repository",
      "url": "https://api.github.com/repos/{{owner}}/{{repo}}/issues",
      "method": "POST",
      "headers": {
        "Accept": "application/vnd.github.v3+json"
      },
      "auth": {
        "type": "bearer",
        "token": "<encrypted>"
      },
      "bodyTemplate": "{ \"title\": \"{{title}}\", \"body\": \"{{body}}\" }",
      "parameters": {
        "owner": { "type": "string", "required": true, "description": "Repo owner" },
        "repo": { "type": "string", "required": true, "description": "Repo name" },
        "title": { "type": "string", "required": true, "description": "Issue title" },
        "body": { "type": "string", "required": false, "description": "Issue body" }
      },
      "addedAt": 1712700000,
      "label": "GitHub"
    }
  ]
}
```

### Auth Types

| Type | Fields | Example |
|------|--------|---------|
| `none` | (none) | Public webhooks |
| `bearer` | `token` | GitHub, OpenAI, most REST APIs |
| `api-key` | `key`, `headerName` | `X-API-Key: xxx` |
| `basic` | `username`, `password` | Legacy APIs |
| `header` | `headers` (key-value map) | Custom auth headers |

Credentials stored encrypted (same pattern as email app passwords).

### Template Syntax

URL and body use `{{paramName}}` mustache-style interpolation:

```
URL: https://api.github.com/repos/{{owner}}/{{repo}}/issues
Body: { "title": "{{title}}", "body": "{{body}}" }
```

Parameters declare what the Mate needs to provide. The SDK tool auto-validates required fields.

---

## SDK Tools

### clay_api_call

The primary tool. Mates call a registered API by name:

```
Tool: clay_api_call
  api: "slack-deploy"                    (name or id)
  params: { "message": "Deploy done!" }  (fills template parameters)
```

Returns:
```json
{
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": "{ \"ok\": true }"
}
```

### clay_api_list

List available APIs (for Mate to discover what is registered):

```
Tool: clay_api_list
```

Returns:
```json
{
  "apis": [
    { "name": "slack-deploy", "description": "Post deployment notifications...", "parameters": {...} },
    { "name": "github-create-issue", "description": "Create an issue...", "parameters": {...} }
  ]
}
```

Note: credentials are never exposed to the Mate. Only name, description, and parameter schema.

---

## Webhook Receiver

In addition to outbound API calls, users may want inbound webhooks (external services calling Clay):

```
External service -> Clay webhook endpoint -> Mate notification
```

Each registered webhook gets a unique URL:

```
https://clay-server:port/webhook/{webhookId}
```

When hit, Clay:
1. Validates the request (optional secret/signature)
2. Stores the payload
3. Notifies the designated Mate (via notification or DM)
4. Mate can process and respond

### Webhook Entry

```json
{
  "id": "wh_abc123",
  "name": "github-push",
  "description": "Triggered on git push to main",
  "secret": "<encrypted>",
  "mateId": "mate_xyz",
  "action": "notify",
  "createdAt": 1712700000
}
```

### Actions on Webhook Receive

| Action | Behavior |
|--------|----------|
| `notify` | Create a notification for the user |
| `dm` | Send payload as a DM to the designated Mate |
| `store` | Save payload to Mate Datastore |

---

## Permission & Security

### Outbound API Calls

| Risk | Default | Rationale |
|------|---------|-----------|
| `clay_api_list` | auto-approve | Read-only, no credentials exposed |
| `clay_api_call` | ask | External side effect, costs, rate limits |

Users can override per-API (e.g., "always allow Slack webhook, always ask for GitHub").

### Credential Safety

- Tokens/passwords encrypted at rest (same as email app passwords)
- Never sent to Mate/LLM (Mate sees parameter schema, not auth details)
- Server-side injection: Clay fills auth headers before sending the request
- Audit log: all API calls logged with timestamp, API name, parameters, response status

---

## UI

### User Settings > APIs

```
User Settings
├── Account
├── Appearance
├── Chat
├── Email
├── APIs
│   ┌────────────────────────────────────────────┐
│   │ slack-deploy                     [Remove]  │
│   │ Slack . POST                               │
│   ├────────────────────────────────────────────┤
│   │ github-create-issue              [Remove]  │
│   │ GitHub . POST                              │
│   └────────────────────────────────────────────┘
│   [+ Add API]
└── ...
```

### Add API Flow

1. Name and description
2. URL (with `{{param}}` placeholders highlighted)
3. Method (GET / POST / PUT / PATCH / DELETE)
4. Auth type + credentials
5. Body template (for POST/PUT/PATCH)
6. Parameter definitions (auto-detected from `{{}}` in URL and body)
7. Test request
8. Save

### Sidebar: API Catalog

Like the Email button in the sidebar, an "APIs" button opens a modal showing registered APIs with toggles for which ones are available in the current project.

---

## Presets

Common API patterns as one-click setup:

| Preset | What it creates |
|--------|----------------|
| Slack Webhook | POST webhook with `{ "text": "{{message}}" }` |
| Discord Webhook | POST webhook with Discord embed format |
| Telegram Bot | POST with `chat_id` + `text` params |
| GitHub Issue | POST to repos API with bearer auth |
| Linear Issue | POST to Linear GraphQL API |
| Custom REST | Blank template, user fills everything |
| Custom Webhook | Inbound webhook with secret |

---

## Relation to Email Integration

Email and API Catalog are both "external connections" managed the same way:

| | Email | API Catalog |
|---|---|---|
| Storage | `~/.clay/email/{userId}.json` | `~/.clay/api-catalog/{userId}.json` |
| Auth | App Password (encrypted) | Token/Key (encrypted) |
| SDK Tools | `clay_send_email`, `clay_read_email`, etc. | `clay_api_call`, `clay_api_list` |
| Sidebar | Email button | APIs button |
| User Settings | Email tab | APIs tab |
| Permission | Read=auto, Write=ask | List=auto, Call=ask |

Both follow the same pattern: user registers credentials once, Mate uses as tools, credentials never exposed to LLM.

---

## Implementation Order

1. `lib/api-catalog.js` - Storage, CRUD, encrypted credentials
2. `lib/api-mcp-server.js` - MCP tools (clay_api_call, clay_api_list)
3. Template engine ({{param}} interpolation, validation)
4. Server-side HTTP client (make requests with injected auth)
5. Audit logging
6. User Settings > APIs tab
7. Sidebar APIs button + project defaults modal
8. Webhook receiver endpoint
9. Presets (Slack, Discord, Telegram, GitHub, etc.)

---

## Open Questions

1. **Rate limiting?** Should Clay enforce rate limits per API? Recommendation: Optional per-API config, default none.
2. **Response size limits?** Truncate large responses before passing to Mate? Recommendation: 50KB max, truncate with notice.
3. **Retry on failure?** Recommendation: No auto-retry. Mate decides whether to retry.
4. **Webhook authentication?** Support HMAC signature verification for inbound webhooks? Recommendation: Yes, optional.
5. **API sharing?** Can users export/import API definitions (without credentials)? Recommendation: Yes, same as canvas sharing.
6. **GraphQL support?** Recommendation: Defer. REST + webhook covers 90% of use cases. GraphQL can be done via custom REST entry with query in body.
