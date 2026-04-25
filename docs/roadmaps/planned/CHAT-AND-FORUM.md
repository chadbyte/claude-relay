# Chat and Forum

> Add "chat" and "forum" project types to Clay. Chat provides Slack/Discord-style real-time channels. Forum provides threaded discussion boards. Both allow external users via invite link. Long-term vision: Mates become aware of chat and forum content as context, enabling AI that understands community discussions.

**Created**: 2026-04-10
**Status**: Planning

---

## Concepts

### Chat Project vs Code Project

| | Code Project | Chat Project |
|---|---|---|
| Type | `"code"` (default) | `"chat"` |
| Sidebar content | Session list | Channel list |
| Claude Code | Yes | No |
| Terminal | Yes | No |
| File browser | Yes | No |
| Skills | Yes | No |
| Target users | Developers with Claude access | Anyone with invite link |
| Data unit | Session (JSONL) | Channel (JSONL) |

### Channel

A channel is a named group chat room inside a chat project. Analogous to Slack/Discord channels.

- Identified by slug (e.g. `general`, `bugs`, `feature-requests`)
- Displayed with `#` prefix in sidebar
- All users with project access can see all channels (no per-channel ACL)
- Messages stored as JSONL, one file per channel
- Supports real-time messaging via existing WebSocket infrastructure

### Guest User

A user role designed for external community members.

- `role: "guest"` in users.json
- All permissions set to `false` (terminal, fileBrowser, skills, createProject, deleteProject, sessionDelete, scheduledTasks, projectSettings)
- Can only: chat in channels, send DMs, update own profile
- Cannot see code projects at all

---

## Architecture (Post-Refactoring File Map)

After refactoring is complete, the relevant files and their responsibilities:

```
lib/
├── daemon.js              (~1,100 lines) thin coordinator
├── daemon-projects.js     project CRUD, config persistence
├── server.js              (~500 lines) thin router
├── server-auth.js         auth, invite, registration
├── server-admin.js        admin API endpoints
├── project.js             (~800 lines) thin coordinator
├── sessions.js            session CRUD, JSONL persistence
├── dm.js                  DM conversations
├── users.js               (~300 lines) user CRUD, invites
├── users-auth.js          auth tokens, PIN/OTP
├── users-permissions.js   role-based access control
├── channels.js            [NEW] channel CRUD, message persistence
├── chat-project.js        [NEW] chat project context (like project.js but for chat)
├── public/
│   ├── app.js             (~1,500 lines) bootstrap
│   ├── modules/
│   │   ├── sidebar-sessions.js    session list rendering
│   │   ├── sidebar-projects.js    project icon strip
│   │   ├── sidebar-channels.js    [NEW] channel list rendering
│   │   ├── app-connection.js      WebSocket connection
│   │   ├── app-messages.js        message router
│   │   ├── app-dm.js              DM UI
│   │   ├── app-chat.js            [NEW] channel chat UI
│   │   └── ...
```

---

## New Files

### 1. `lib/channels.js` (Backend channel storage)

Mirrors `dm.js` pattern. JSONL-based, append-only.

**Storage location**: `~/.clay/channels/{projectSlug}/`
**File naming**: `{channelSlug}.jsonl`

**Message format**:
```js
{
  type: "channel_message",
  id: "uuid",
  ts: 1712500000,
  from: "user-id",
  text: "message content",
  editedAt: null
}
```

**Channel metadata file**: `~/.clay/channels/{projectSlug}/_meta.json`
```js
{
  channels: [
    {
      slug: "general",
      name: "General",
      description: "General discussion",
      createdBy: "user-id",
      createdAt: 1712500000,
      order: 0
    },
    {
      slug: "bugs",
      name: "Bugs",
      description: "Bug reports and tracking",
      createdBy: "user-id",
      createdAt: 1712500001,
      order: 1
    }
  ]
}
```

**Exported functions**:
```js
createChannelManager({ projectSlug, send, sendTo, sendEach })

// Returns:
{
  // Channel CRUD
  createChannel(name, description, userId),
  deleteChannel(slug, userId),
  renameChannel(slug, newName, userId),
  reorderChannels(slugs),
  listChannels(),

  // Messages
  sendMessage(channelSlug, userId, text),
  loadHistory(channelSlug, limit, beforeTs),
  editMessage(channelSlug, messageId, userId, newText),
  deleteMessage(channelSlug, messageId, userId),

  // State
  getUnreadCounts(userId, lastReadTs),
}
```

**Implementation notes**:
- `sendMessage`: append one line to `{channelSlug}.jsonl`, broadcast to all connected clients in project
- `loadHistory`: read file from end, parse last N lines, return array. Use same tail-read pattern as sessions.js
- Unread tracking: per-user `lastReadTs` per channel, stored in user preferences or separate state file
- On project creation with type `"chat"`, auto-create `#general` channel

---

### 2. `lib/chat-project.js` (Chat project context)

Lightweight alternative to `project.js`. No Claude SDK, no sessions, no terminal. Just channels.

**Pattern**: Same `attach*` context pattern from refactoring roadmap.

```js
function createChatProjectContext({ slug, title, send, sendTo, sendEach, clients }) {
  var channelMgr = channels.createChannelManager({
    projectSlug: slug,
    send: send,
    sendTo: sendTo,
    sendEach: sendEach
  })

  function handleMessage(ws, msg) {
    switch (msg.type) {
      case "channel_list":
        return channelMgr.listChannels()
      case "channel_create":
        return channelMgr.createChannel(msg.name, msg.description, ws._clayUser.id)
      case "channel_delete":
        return channelMgr.deleteChannel(msg.slug, ws._clayUser.id)
      case "channel_rename":
        return channelMgr.renameChannel(msg.slug, msg.name, ws._clayUser.id)
      case "channel_send":
        return channelMgr.sendMessage(msg.channelSlug, ws._clayUser.id, msg.text)
      case "channel_history":
        return channelMgr.loadHistory(msg.channelSlug, msg.limit, msg.beforeTs)
      case "channel_typing":
        // Relay typing indicator to other clients in same channel
        break
      case "channel_switch":
        ws._clayActiveChannel = msg.channelSlug
        break
      case "channel_mark_read":
        // Update user's lastReadTs for this channel
        break
    }
  }

  function handleConnection(ws) {
    // Send channel list to newly connected client
    sendTo(ws, { type: "channel_list", channels: channelMgr.listChannels() })
  }

  function handleDisconnection(ws) {
    // Broadcast updated presence
  }

  return {
    type: "chat",
    slug: slug,
    title: title,
    handleMessage: handleMessage,
    handleConnection: handleConnection,
    handleDisconnection: handleDisconnection,
    channelMgr: channelMgr
  }
}
```

**Key difference from project.js**: No SDK bridge, no session manager, no terminal, no file watch, no loop, no debate, no mate interaction. Pure messaging.

---

### 3. `lib/public/modules/sidebar-channels.js` (Frontend channel list)

Renders channel list in sidebar when active project is a chat project.

**Structure**:
```
#general          (bold if unread)
#bugs             (3)  <-- unread count badge
#feature-requests
+ Add channel
```

**Exported functions**:
```js
initSidebarChannels(ctx)

// Returns:
{
  renderChannelList(channels, activeChannelSlug, unreadCounts),
  setActiveChannel(slug),
  updateUnread(slug, count),
}
```

**Behavior**:
- Click channel: send `{ type: "channel_switch", channelSlug }` via WebSocket, render channel messages
- Right-click channel: context menu (rename, delete) for admin/owner only
- "Add channel" button: inline input to create new channel
- Active channel highlighted with accent color
- Unread badge: number badge like current session unread

**Sidebar mode switching**:
- `sidebar-sessions.js` renders when project type is `"code"`
- `sidebar-channels.js` renders when project type is `"chat"`
- The sidebar coordinator (`sidebar.js`) checks `project.type` and delegates

---

### 4. `lib/public/modules/app-chat.js` (Frontend channel chat UI)

Handles message rendering and input for channel chat.

**Key differences from session chat**:
- No tool calls, no permission requests, no assistant messages
- All messages are from users (human to human)
- Simpler message bubble: avatar + name + text + timestamp
- No "continue" button, no suggestion chips
- Input box: plain text only, no slash commands, no file upload (initially)

**Message rendering**:
```html
<div class="channel-message" data-msg-id="uuid">
  <div class="channel-message-avatar" style="background: #7c3aed">
    <!-- dicebear or custom avatar -->
  </div>
  <div class="channel-message-body">
    <span class="channel-message-author">Chad</span>
    <span class="channel-message-time">2:34 PM</span>
    <div class="channel-message-text">Hello everyone!</div>
  </div>
</div>
```

**Features**:
- Real-time message append (via WebSocket broadcast)
- Typing indicator ("Chad is typing...")
- Scroll to bottom on new message (if already at bottom)
- Load older messages on scroll up (pagination via `channel_history`)
- Markdown rendering for message text (reuse existing markdown renderer)
- @mention other users (reuse existing mention module)
- Link previews (later)

---

## Modified Files

### 5. `daemon.json` config changes

Project entry gets a `type` field:

```js
{
  projects: [
    {
      path: "/home/chad/my-app",
      slug: "my-app",
      type: "code",           // default, backward compatible
      title: "My App",
      // ... existing fields
    },
    {
      path: null,              // chat projects have no filesystem path
      slug: "clay-community",
      type: "chat",
      title: "Clay Community",
      icon: "message-circle",
      addedAt: 1712500000,
      visibility: "public",
      ownerId: "admin-user-id",
      defaultChannel: "general"
    }
  ]
}
```

**Note**: Chat projects have `path: null` because they are not tied to a filesystem directory. They exist purely as communication spaces.

---

### 6. `lib/daemon-projects.js` changes

Add `createChatProject(title, ownerId)`:
- Generate slug from title
- Create project entry with `type: "chat"`, `path: null`
- Initialize channel storage directory (`~/.clay/channels/{slug}/`)
- Auto-create `#general` channel
- Save config

Add `isChatProject(slug)`:
- Check `project.type === "chat"`

Modify `addProject()`:
- Existing function unchanged. Only code projects go through `addProject`
- Chat projects use new `createChatProject`

---

### 7. `lib/server.js` (thin router) changes

In the project routing section, branch on project type:

```js
var projectConfig = getProjectBySlug(slug)
if (projectConfig && projectConfig.type === "chat") {
  // Route to chat-project context
  chatCtx.handleMessage(ws, msg)
} else {
  // Route to code-project context (existing behavior)
  codeCtx.handleMessage(ws, msg)
}
```

In HTTP handler, serve the same SPA for chat projects. The frontend detects project type and renders accordingly.

---

### 8. `lib/server-auth.js` changes

**Public invite link** (new endpoint):

```
POST /api/admin/public-invite
  -> Creates a reusable, non-expiring invite code
  -> { code: "abc123", projectSlug: "clay-community", maxUses: null }

GET /join/{code}
  -> Public join page
  -> Shows project name, channel preview
  -> Registration form: username, display name, PIN
  -> On success: create user with role "guest", redirect to project
```

Modify existing invite system:
- Add `reusable: boolean` field to invite objects
- Add `projectSlug: string` to auto-add user to specific project on registration
- Add `role: "guest"` option for invite creation
- Reusable invites do not get marked as `used: true`

---

### 9. `lib/users-permissions.js` changes

Add `"guest"` role with all permissions false:

```js
var GUEST_PERMISSIONS = {
  terminal: false,
  fileBrowser: false,
  createProject: false,
  deleteProject: false,
  skills: false,
  sessionDelete: false,
  scheduledTasks: false,
  projectSettings: false
}
```

Add `canAccessProject` filter:
- Guest users can only see chat projects they were invited to
- Guest users cannot see any code projects

Add `canManageChannel(userId, projectSlug)`:
- Admin: always true
- Project owner: always true
- Guest: false (can only send messages, not create/delete channels)

---

### 10. `lib/public/app.js` changes

On project load, check type and branch UI:

```js
if (currentProject.type === "chat") {
  // Hide: terminal button, file browser, skills, session controls
  // Show: channel list in sidebar, channel chat in main area
  sidebarChannels.renderChannelList(channels)
  appChat.enterChatMode()
} else {
  // Existing code project behavior
  sidebarSessions.renderSessionList(sessions)
}
```

---

### 11. `lib/public/modules/sidebar-projects.js` changes

In project icon strip, chat projects get a different icon:
- Code projects: folder icon or custom emoji
- Chat projects: `message-circle` icon (or custom emoji)

Chat projects render in the same icon strip. Clicking switches context just like code projects, but loads channels instead of sessions.

---

## Implementation Order

### Phase A: Backend foundation (3 PRs)

**PR-A1: Channel storage module**
- Create `lib/channels.js`
- JSONL storage for channel messages
- Channel metadata CRUD
- Unit testable in isolation

**PR-A2: Chat project context**
- Create `lib/chat-project.js`
- Wire channel manager
- WebSocket message handling for channel operations
- Integration with server.js routing

**PR-A3: Project type in config**
- Add `type` field to daemon.json project entries
- `createChatProject()` in daemon-projects.js
- Backward compatibility: projects without `type` default to `"code"`

### Phase B: Frontend foundation (3 PRs)

**PR-B1: Sidebar channel list**
- Create `lib/public/modules/sidebar-channels.js`
- Channel list rendering
- Active channel state
- Unread badges
- Sidebar mode switching (sessions vs channels based on project type)

**PR-B2: Channel chat UI**
- Create `lib/public/modules/app-chat.js`
- Message rendering (user bubbles with avatar, name, timestamp)
- Message input (plain text)
- Real-time message display
- Typing indicators
- History pagination (scroll up to load more)

**PR-B3: Project type UI integration**
- app.js branching for chat vs code projects
- Hide code-specific UI elements in chat projects
- Project icon differentiation in sidebar

### Phase C: Guest access (2 PRs)

**PR-C1: Guest user role**
- Add `role: "guest"` to users-permissions.js
- All permissions false
- Filter project list: guests see only chat projects
- Filter UI: hide all code-related controls for guests

**PR-C2: Public invite link**
- Reusable invite codes in server-auth.js
- `/join/{code}` page with registration form
- Auto-assign guest role
- Auto-add to target chat project
- Shareable link format: `https://clay.example.com/join/abc123`

### Phase D: Polish (2 PRs)

**PR-D1: Unread tracking and notifications**
- Per-user lastReadTs per channel
- Unread count in sidebar badges
- Browser push notification on new channel message (reuse existing push infra)
- Project-level unread badge in icon strip

**PR-D2: Channel management UI**
- Create channel modal/inline input
- Rename channel (admin/owner only)
- Delete channel with confirmation (admin/owner only)
- Channel description display
- Reorder channels (drag or manual order)

---

## Total: 10 PRs

| PR | Phase | Description | New files | Modified files |
|----|-------|-------------|-----------|----------------|
| A1 | Backend | Channel storage module | `channels.js` | none |
| A2 | Backend | Chat project context | `chat-project.js` | `server.js` |
| A3 | Backend | Project type in config | none | `daemon-projects.js`, `daemon.json` |
| B1 | Frontend | Sidebar channel list | `sidebar-channels.js` | `sidebar.js` |
| B2 | Frontend | Channel chat UI | `app-chat.js` | `app.js` |
| B3 | Frontend | Project type UI integration | none | `app.js`, `sidebar-projects.js` |
| C1 | Guest | Guest user role | none | `users-permissions.js`, `app.js` |
| C2 | Guest | Public invite link | none | `server-auth.js` |
| D1 | Polish | Unread tracking + notifications | none | `channels.js`, `sidebar-channels.js` |
| D2 | Polish | Channel management UI | none | `sidebar-channels.js`, `app-chat.js` |

---

## Forum Project Type

In addition to real-time chat, a "forum" project type for threaded, persistent discussions.

### Forum vs Chat

| | Chat | Forum |
|---|---|---|
| Type | `"chat"` | `"forum"` |
| Structure | Channels with flat messages | Categories with threaded posts |
| Pace | Real-time, ephemeral | Async, persistent |
| Sidebar | `#channel-list` | Category list |
| Data unit | Channel message (JSONL) | Thread (JSONL per thread) |
| Best for | Quick coordination, social | Knowledge sharing, Q&A, feedback |

### Forum Structure

```
Forum Project
├── Category: Announcements
│   ├── Thread: "v2.31 Release Notes"  (12 replies, pinned)
│   └── Thread: "Maintenance Window April 20"  (3 replies)
├── Category: Feature Requests
│   ├── Thread: "Email integration for Mates"  (24 replies, closed)
│   └── Thread: "Calendar sync would be nice"  (8 replies)
└── Category: Bugs
    └── Thread: "Sidebar resize handle disappears"  (5 replies, resolved)
```

### Thread Format

Each thread is a JSONL file: `~/.clay/forums/{projectSlug}/{categorySlug}/{threadId}.jsonl`

```js
// First line is the opening post
{ type: "post", id: "uuid", ts: 1712500000, from: "user-id", title: "v2.31 Release Notes", text: "..." }
// Subsequent lines are replies
{ type: "reply", id: "uuid", ts: 1712500100, from: "user-id", text: "...", replyTo: "parent-id" }
```

### Forum-specific Features

- **Threaded replies**: Replies nest under posts (unlike flat chat)
- **Rich text**: Markdown with image embeds
- **Pinned threads**: Pin important threads to top of category
- **Thread status**: Open / Closed / Resolved
- **Voting**: Upvote threads and replies (useful for feature requests, Q&A)
- **Tags/labels**: Cross-category tagging

---

## Mate Awareness (Long-term Vision)

The strategic goal: Mates become aware of chat and forum content. This turns community discussions into AI-accessible context.

### How It Works

```
Community discusses in Chat/Forum
  -> Content indexed and summarized
  -> Mate can search and reference discussions
  -> Mate understands community sentiment, common issues, feature requests
```

### Use Cases

| Scenario | How Mate Uses It |
|----------|-----------------|
| User asks "what are people requesting?" | Mate searches forum Feature Requests category, summarizes top threads |
| User asks "any known issues with email?" | Mate searches forum Bugs + chat history for "email" |
| Mate drafts release notes | Mate reads resolved threads since last release |
| Mate triages a bug report | Mate checks if similar thread exists in forum |
| Mate responds to DM | Mate references relevant forum discussion for context |

### Implementation Approach

1. **Indexing**: Chat messages and forum threads indexed into searchable store (SQLite FTS or similar)
2. **Context Source**: Chat/Forum as a context source type (like email, terminal, browser tabs)
3. **SDK Tools**: `clay_search_discussions(query)`, `clay_read_thread(threadId)`
4. **Digest**: Periodic summaries of active discussions stored in Mate memory

### Privacy Considerations

- Mate only accesses projects it has been granted access to
- Guest messages in public channels are searchable by Mates with project access
- DMs are never indexed for Mate access (private)
- Users can opt-out specific channels/categories from Mate indexing

---

## Out of Scope (Initial)

- **File/image upload in channels**: Reuse later from code project image system
- **Reactions/emoji**: Nice to have, not MVP
- **Message pinning in chat**: Later (forum has it from start)
- **Voice/video**: Way later
- **Channel-level permissions**: Project access = all channel access
- **Message search**: Later (comes with Mate Awareness indexing)
- **Federation/external API**: Later

---

## Open Questions

1. **Should chat projects appear in the same icon strip as code projects?**
   Recommendation: Yes. Unified sidebar. Different icon distinguishes them.

2. **Can a code project also have channels?**
   Recommendation: Not initially. Keep types separate. Mixing adds complexity. Revisit after MVP.

3. **Should guests be able to DM each other?**
   Recommendation: Yes. DM system already exists and works for all users regardless of role.

4. **Forum and Chat in one project?**
   Recommendation: No. Keep them as separate project types. A community might have both a chat project and a forum project. Simpler than hybrid.

5. **Message edit/delete?**
   Recommendation: Include in MVP. Users expect this. Implementation: mark with `editedAt` or `deletedAt` timestamp.

6. **How does Mate Awareness affect performance?**
   Recommendation: Indexing is async and background. Search is on-demand. No impact on chat/forum performance.

7. **Should Mates be able to post in channels/forums?**
   Recommendation: Yes, eventually. A Mate could post daily summaries, answer questions, or moderate. But defer to post-MVP.
