# Email Integration Design

> Clay built-in email module. Users connect their email accounts, Mates read/send/search emails as a context source and via SDK tools.

**Created**: 2026-04-16
**Status**: Planning

---

## Vision

Every user can connect one or more email accounts (Gmail, Outlook, etc.) to Clay. Mates access these accounts through context sources and SDK tools. Users control which accounts are available to which projects/Mates.

Use cases:
- Morning news clipping: Mate reads newsletters, summarizes, sends digest
- Email triage: Mate reads inbox, flags important messages, drafts replies
- Outreach: Mate sends emails on behalf of user
- Monitoring: Mate watches for specific emails (invoices, alerts) and notifies

---

## Architecture

```
User Profile
  └── Email Accounts
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
    + Add email account
```

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

### "Add email account" flow

Clicking "+ Add email account" in Context Sources opens an inline form or modal:

1. Select provider: Gmail / Outlook / Yahoo / Custom
2. Enter email address
3. Enter App Password (with link to provider's app password guide)
4. Test connection (IMAP + SMTP)
5. Save

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

**PR-E3: Send UI + Account setup**
- Email section in Context Sources picker
- Account setup form (provider, email, app password)
- Test connection button with status feedback

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
| E3 | Account | Setup UI | `context-email.js` | `context-sources.js` |
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

---

## Open Questions

1. **Should Mates auto-read emails on schedule?** Recommendation: Yes, via loop/Ralph. Mate can be configured to check email every N minutes and notify user of important messages.

2. **Email drafts?** Recommendation: Defer. Mate can compose and send directly. Draft management adds complexity.

3. **Calendar integration?** Recommendation: Separate module later. Email and calendar are different protocols (IMAP vs CalDAV). Calendar MCP servers already exist.

4. **Multi-user email sharing?** Recommendation: No. Each user's email accounts are private to that user. Shared inboxes could be a future feature.

5. **OAuth support?** Recommendation: Defer. App passwords work for Gmail, Outlook, Yahoo. OAuth adds significant complexity (token refresh, consent screens). Revisit if a major provider drops app password support.
