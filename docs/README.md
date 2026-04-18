# Docs

```
docs/
├── guides/                             Maintenance & development guides
│   ├── architecture.md                 System overview, SDK, WebSocket protocol
│   ├── MODULE_MAP.md                   File-by-file module guide
│   ├── STATE_CONVENTIONS.md            State management patterns
│   ├── CLIENT_MODULE_DEPS.md           Client store/ws-ref/import patterns
│   ├── NO-GOD-OBJECTS.md               Architectural rules to prevent regression
│   └── MCP-IMPLEMENTATION.md           MCP connection architecture + debugging
├── roadmaps/
│   ├── completed/
│   │   ├── REFACTORING_ROADMAP.md      Codebase decomposition (PR-01~42)
│   │   ├── MCP-BRIDGE-DESIGN.md        Original MCP design (now implemented)
│   │   └── CTX-ELIMINATION-ROADMAP.md  Client-side _ctx removal (done, 0 refs)
│   ├── in-progress/
│   │   └── SDK-UPGRADE.md              Claude Agent SDK version tracking
│   └── planned/
│       ├── EMAIL-INTEGRATION.md        Built-in email (IMAP/SMTP, 8 PRs)
│       ├── HOME-HUB-ROADMAP.md         Notification center + widgets (4 phases)
│       └── CHAT_PROJECT_PLAN.md        Chat project type + channels (10 PRs)
└── README.md                           This file
```
