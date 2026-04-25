# Email Integration Design

> Clay built-in email module. Two modes: server SMTP (admin-managed, auditable) and personal email accounts (user-managed, private). Mates read/send/search emails as a context source and via SDK tools.

**Created**: 2026-04-16
**Status**: Completed
**Completed**: 2026-04-17

---

## Vision

Email in Clay operates in two modes:

1. **Server SMTP** (admin-managed): Admin configures a shared SMTP server. All outbound emails are logged and auditable. For system notifications, reports, and compliance-sensitive communication.

2. **Personal Email** (user-managed): Users connect their own email accounts (Gmail, Outlook, etc.) via App Password. Mates read/send/search as context sources. Admin cannot access personal credentials or mail content.

Use cases:
- Morning news clipping: Mate reads newsletters, summarizes, sends digest
- Email triage: Mate reads inbox, flags important messages, drafts replies
- Outreach: Mate sends emails on behalf of user
- Monitoring: Mate watches for specific emails (invoices, alerts) and notifies

---

## Two Email Modes

### Server SMTP (Admin-managed)

| | |
|---|---|
| **Configured by** | Server admin (in daemon settings) |
| **Sender address** | Shared (e.g. `noreply@company-clay.com`) |
| **SMTP provider** | SendGrid, AWS SES, custom SMTP |
| **Audit logging** | All outbound emails logged with sender user, recipient, subject, timestamp |
| **Admin visibility** | Full. Admin can view all send logs |
| **IMAP (read)** | No. Send-only |
| **Use cases** | System alerts, scheduled reports, compliance-tracked communications |
| **SDK tool** | `clay_send_email` with `{ via: "server" }` |
| **Already exists** | Partially. `lib/smtp.js` handles OTP emails via nodemailer |

### Personal Email (User-managed)

| | |
|---|---|
| **Configured by** | Each user (in User Settings) |
| **Sender address** | User's own (e.g. `chad@gmail.com`) |
| **Auth method** | App Password (Gmail, Outlook, Yahoo, custom IMAP/SMTP) |
| **Audit logging** | None. Private to the user |
| **Admin visibility** | None. Cannot see credentials, content, or logs |
| **IMAP (read)** | Yes. Full inbox access |
| **Use cases** | Personal assistant, inbox triage, news clipping, drafting replies |
| **SDK tools** | `clay_send_email`, `clay_read_email`, `clay_search_email`, etc. |
| **Context Source** | Yes. Appears in Context Sources picker |

### Mate Tool Behavior

When a Mate calls `clay_send_email`, the `via` parameter determines the mode:

```
clay_send_email(to, subject, body, { via: "server" })   -> Server SMTP (logged, auditable)
clay_send_email(to, subject, body, { via: "personal" })  -> User's own account (private)
clay_send_email(to, subject, body)                        -> Default: personal if available, otherwise server
```

### Audit Log (Server SMTP only)

Stored at `~/.clay/email-audit.jsonl`. Append-only log.

```json
{"ts":1712700000,"userId":"067d...","to":["recipient@example.com"],"subject":"Weekly Report","mateId":"mate_abc","projectSlug":"clay","status":"sent"}
{"ts":1712700060,"userId":"067d...","to":["team@company.com"],"subject":"Alert: Build Failed","mateId":null,"projectSlug":"argo","status":"sent"}
```

Admin can view audit log via admin panel or CLI.

---

## Architecture

```
Server SMTP (admin)
  └── nodemailer transport (shared)
        └── Audit log (~/.clay/email-audit.jsonl)

User Profile (per user)
  └── Personal Email Accounts
        ├── chad@gmail.com     (IMAP + SMTP via App Password)
        ├── chad@company.com   (IMAP + SMTP via App Password)
        └── ...

Context Sources (per project)
  ├── Browser Tabs
  ├── Terminals
  └── Email Accounts        ← check/uncheck per account
        ☑ chad@gmail.com
        ☐ chad@company.com

Mate SDK Tools
  ├── clay_read_email       read messages from checked accounts
  ├── clay_search_email     search across checked accounts
  ├── clay_send_email       send from a specific account
  ├── clay_reply_email      reply to a message
  ├── clay_list_labels      list folders/labels
  └── clay_mark_read        mark messages as read
```

---

## Email Account Storage

Per-user email accounts stored in user data:

```
~/.clay/email/{userId}.json
```

```json
{
  "accounts": [
    {
      "id": "acc_abc123",
      "email": "chad@gmail.com",
      "provider": "gmail",
      "imap": {
        "host": "imap.gmail.com",
        "port": 993,
        "tls": true
      },
      "smtp": {
        "host": "smtp.gmail.com",
        "port": 587
      },
      "appPassword": "xxxx-xxxx-xxxx-xxxx",
      "addedAt": 1712700000,
      "label": "Personal"
    },
    {
      "id": "acc_def456",
      "email": "chad@company.com",
      "provider": "custom",
      "imap": {
        "host": "mail.company.com",
        "port": 993,
        "tls": true
      },
      "smtp": {
        "host": "mail.company.com",
        "port": 587
      },
      "appPassword": "secretpassword",
      "addedAt": 1712700000,
      "label": "Work"
    }
  ]
}
```

**Provider presets**: When user selects "Gmail", auto-fill IMAP/SMTP hosts. For custom providers, user enters manually.

| Provider | IMAP | SMTP |
|----------|------|------|
| Gmail | imap.gmail.com:993 | smtp.gmail.com:587 |
| Outlook | outlook.office365.com:993 | smtp.office365.com:587 |
| Yahoo | imap.mail.yahoo.com:993 | smtp.mail.yahoo.com:587 |
| Custom | user-specified | user-specified |

**Security**: App passwords stored encrypted at rest. Never sent to client. Server-side only.

---

## Server Module

New module: `lib/project-email.js` following `attachEmail(ctx)` pattern.

**Dependencies**:
- `nodemailer` (already in project for SMTP)
- `imapflow` (IMAP client, modern, Promise-based)

### IMAP Connection Management

One IMAP connection per active email account. Connections are lazy (opened on first use) and pooled.

```js
var connections = {}; // accountId -> ImapFlow instance

function getConnection(account) {
  if (connections[account.id] && connections[account.id].usable) {
    return connections[account.id];
  }
  var client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.tls,
    auth: { user: account.email, pass: account.appPassword },
  });
  connections[account.id] = client;
  return client;
}
```

Auto-disconnect after 5 minutes idle. Reconnect on next use.

### SMTP Sending

Reuse existing `nodemailer` pattern from `lib/smtp.js`:

```js
function createTransport(account) {
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: false,
    auth: { user: account.email, pass: account.appPassword },
  });
}
```

---

## SDK Tools

### clay_read_email

Read recent emails from inbox or specified folder.

```
Tool: clay_read_email
  account: "chad@gmail.com"      (optional, defaults to first checked account)
  folder: "INBOX"                 (optional, default INBOX)
  limit: 10                       (optional, default 10, max 50)
  unread_only: true               (optional, default false)
```

Returns:
```json
{
  "messages": [
    {
      "id": "msg_123",
      "from": "sender@example.com",
      "to": ["chad@gmail.com"],
      "subject": "Meeting tomorrow",
      "date": "2026-04-16T09:00:00Z",
      "snippet": "Hi Chad, just confirming our meeting...",
      "unread": true,
      "labels": ["INBOX", "IMPORTANT"]
    }
  ],
  "total": 342,
  "unread": 5
}
```

Snippet is first 200 chars of plain text body. Full body fetched separately to save context window.

### clay_read_email_body

Read full body of a specific email.

```
Tool: clay_read_email_body
  account: "chad@gmail.com"
  message_id: "msg_123"
```

Returns plain text body (HTML stripped). Truncated at 10,000 chars with notice.

### clay_search_email

Search emails using provider-specific query syntax.

```
Tool: clay_search_email
  account: "chad@gmail.com"
  query: "from:newsletter@example.com after:2026-04-15"
  limit: 20
```

For Gmail, supports Gmail search syntax. For other providers, basic IMAP SEARCH.

### clay_send_email

```
Tool: clay_send_email
  account: "chad@gmail.com"
  to: ["recipient@example.com"]
  subject: "Weekly Report"
  body: "Here is the weekly report..."
  cc: []                            (optional)
  bcc: []                           (optional)
```

### clay_reply_email

```
Tool: clay_reply_email
  account: "chad@gmail.com"
  message_id: "msg_123"
  body: "Thanks, I'll be there."
  reply_all: false                  (optional, default false)
```

Auto-sets In-Reply-To and References headers. Preserves thread.

### clay_list_labels

```
Tool: clay_list_labels
  account: "chad@gmail.com"
```

Returns folders/labels with unread counts.

### clay_mark_read

```
Tool: clay_mark_read
  account: "chad@gmail.com"
  message_ids: ["msg_123", "msg_456"]
```

---

## Context Sources Integration

### Email as Context Source

Email accounts appear in the Context Sources picker alongside Browser Tabs and Terminals.

```
+ Context Sources
├── TERMINALS
│   ...
├── BROWSER TABS
│   ...
└── EMAIL ACCOUNTS
    ☑ chad@gmail.com (5 unread)
    ☐ chad@company.com (12 unread)
    Manage in User Settings
```

Context Sources only controls check/uncheck (which accounts the Mate can access). Account management (add/remove/edit) lives in User Settings.

**Behavior when checked**:
- On each user message, Mate receives a summary of recent unread emails from checked accounts
- Summary format: sender, subject, date, snippet (first 200 chars)
- Max 10 most recent unread emails per account
- Mate can then use SDK tools to read full body, reply, etc.

**Context injection** (appended to user message context, similar to browser tab context):

```
--- Email Context: chad@gmail.com (5 unread) ---
1. From: boss@company.com | Subject: Q2 Planning | 2h ago
   "Let's discuss the roadmap for Q2. I've attached..."
2. From: newsletter@techcrunch.com | Subject: Daily Digest | 3h ago
   "Today's top stories: AI advances in..."
3. ...
```

### Account Management in User Settings

Email account CRUD lives in User Settings, not Context Sources.

```
User Settings
├── Profile
├── Theme
├── Email Accounts
│   ┌────────────────────────────────────────┐
│   │ chad@gmail.com              [Remove]   │
│   │ Gmail . Connected                      │
│   ├────────────────────────────────────────┤
│   │ chad@company.com            [Remove]   │
│   │ Custom . Connected                     │
│   └────────────────────────────────────────┘
│   [+ Add Account]
└── ...
```

**Add account flow** (in User Settings):

1. Select provider: Gmail / Outlook / Yahoo / Custom
2. Enter email address
3. Enter App Password (with link to provider's app password guide)
4. Test connection (IMAP + SMTP)
5. Save

**Context Sources** only shows the accounts with check/uncheck toggles and a "Manage in User Settings" link for adding/removing.

---

## WebSocket Messages

| Message | Direction | Description |
|---------|-----------|-------------|
| `email_accounts_list` | server -> client | List of user's email accounts with unread counts |
| `email_account_add` | client -> server | Add new email account |
| `email_account_remove` | client -> server | Remove email account |
| `email_account_test` | client -> server | Test IMAP/SMTP connection |
| `email_account_test_result` | server -> client | Connection test result |
| `email_unread_update` | server -> client | Push updated unread counts |

---

## Unread Count Polling

Server polls IMAP for unread counts periodically:
- Every 2 minutes for accounts that are checked as context sources
- Every 10 minutes for accounts that are not checked
- Push `email_unread_update` to connected clients when counts change

---

## Client UI

### Context Sources Email Section

**New file**: `lib/public/modules/context-email.js`

Renders email accounts in the context sources picker. Shows unread badge. "Add email account" button opens setup form.

### Email Account Setup

**Location**: Inline in context sources picker, or separate modal.

**Fields**:
- Provider dropdown (Gmail, Outlook, Yahoo, Custom)
- Email address input
- App Password input (password field)
- IMAP host/port (auto-filled for known providers, editable for custom)
- SMTP host/port (auto-filled for known providers, editable for custom)
- Test Connection button
- Save / Cancel

### App Password Guide

Each provider preset shows a help link:
- Gmail: "How to create an App Password" -> links to Google support
- Outlook: "How to create an App Password" -> links to Microsoft support

---

## Implementation Order

### Phase 1: Account Management + Send (3 PRs)

**PR-E1: Email account storage**
- Create `lib/email-accounts.js` (CRUD for per-user email accounts)
- Encrypted storage at `~/.clay/email/{userId}.json`
- Provider presets (Gmail, Outlook, Yahoo)
- WebSocket handlers for add/remove/test
- Connection test (IMAP connect + SMTP verify)

**PR-E2: SMTP sending tool**
- Create `lib/project-email.js` following `attachEmail(ctx)` pattern
- SDK tool: `clay_send_email`
- Reuse existing nodemailer infrastructure
- Per-account SMTP transport management

**PR-E3: Account setup UI + Context Sources**
- Email Accounts section in User Settings (add/remove/test)
- Account setup form (provider, email, app password)
- Test connection button with status feedback
- Email section in Context Sources picker (check/uncheck only)
- "Manage in User Settings" link from Context Sources

### Phase 2: Read + Context (3 PRs)

**PR-E4: IMAP reading**
- Add `imapflow` dependency
- SDK tools: `clay_read_email`, `clay_read_email_body`, `clay_list_labels`
- IMAP connection pooling with idle timeout
- Message parsing (extract plain text from HTML)

**PR-E5: Search + Reply**
- SDK tools: `clay_search_email`, `clay_reply_email`, `clay_mark_read`
- Gmail search syntax support
- Thread-aware replies (In-Reply-To, References headers)

**PR-E6: Context source integration**
- Email as context source (check/uncheck per account)
- Unread email summary injection into Mate context
- Unread count polling + push updates
- Unread badge in context sources picker

### Phase 3: Polish (2 PRs)

**PR-E7: Notifications**
- Push notification on important emails (configurable rules)
- Integration with Home Hub notification center (when built)

**PR-E8: Attachment support**
- Download attachments from emails
- Attach files to outgoing emails
- Size limits and type restrictions

---

## Total: 8 PRs

| PR | Phase | Description | New files | Modified files |
|----|-------|-------------|-----------|----------------|
| E1 | Account | Email account storage + test | `email-accounts.js` | `server.js` |
| E2 | Account | SMTP sending tool | `project-email.js` | `project.js`, `sdk-bridge.js` |
| E3 | Account | Setup UI (User Settings + Context Sources) | `context-email.js` | `context-sources.js`, user settings UI |
| E4 | Read | IMAP reading tools | none | `project-email.js` |
| E5 | Read | Search + reply tools | none | `project-email.js` |
| E6 | Read | Context source integration | none | `context-sources.js`, `project-user-message.js` |
| E7 | Polish | Email notifications | none | `project-email.js`, `notifications.js` |
| E8 | Polish | Attachment support | none | `project-email.js` |

---

## Dependencies

```
Phase 1 (account + send) ──> Phase 2 (read + context) ──> Phase 3 (polish)
```

No external feature dependencies. Can start immediately.

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IMAP library | `imapflow` | Modern, Promise-based, well-maintained, supports IDLE |
| SMTP library | `nodemailer` | Already in project |
| Auth method | App Password | No OAuth server needed, works with all providers, simple setup |
| Storage | Per-user JSON file | Consistent with other per-user data patterns |
| Credential security | Encrypted at rest | App passwords are sensitive, encrypt with server key |
| Connection pooling | Per-account lazy connections | Avoid opening connections for unused accounts |
| Context injection | Unread summary per message | Keep context window small, Mate can fetch full body if needed |

---

## Security Considerations

- App passwords stored encrypted, never sent to client side
- IMAP/SMTP connections use TLS
- Mate can only access accounts checked by the user for that project
- Rate limiting on send operations (prevent spam)
- No email forwarding to external services (all processing server-side)
- **Server SMTP**: all sends logged to audit trail. Admin can review all outbound emails
- **Personal email**: credentials and mail content are private to the user. Admin cannot access. No server-side logging of personal email content
- Clear separation: server SMTP audit data and personal email data never mix

---

## Open Questions

1. **Should Mates auto-read emails on schedule?** Recommendation: Yes, via loop/Ralph. Mate can be configured to check email every N minutes and notify user of important messages.

2. **Email drafts?** Recommendation: Defer. Mate can compose and send directly. Draft management adds complexity.

3. **Calendar integration?** Recommendation: Separate module later. Email and calendar are different protocols (IMAP vs CalDAV). Calendar MCP servers already exist.

4. **Multi-user email sharing?** Recommendation: No. Each user's email accounts are private to that user. Shared inboxes could be a future feature.

5. **OAuth support?** Recommendation: Defer. App passwords work for Gmail, Outlook, Yahoo. OAuth adds significant complexity (token refresh, consent screens). Revisit if a major provider drops app password support.
