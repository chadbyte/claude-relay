# Project Pilot

> A Mate becomes the senior developer of a project. It reads all development history, opens and manages coding sessions across vendors (Claude, GPT, Codex, Gemini), writes sticky notes, approves permissions, creates handoff documents, and autonomously drives product development forward. The user acts as the product owner, giving direction. The Mate executes.

**Created**: 2026-04-17
**Status**: Draft

---

## Problem

Today, AI coding assistants are **session-scoped tools**. Every session starts fresh. The human does all the coordination: remembering context, deciding what to work on next, managing multiple sessions, reviewing output, re-explaining conventions. The AI is a pair of hands that forgets everything between sessions.

There is no persistent entity that understands the project as a whole, that can make architectural calls, that can spin up work and watch it complete, that can pick up where yesterday left off.

## Vision

A Mate becomes the **project pilot**, a persistent senior developer that uses Clay itself as its development environment.

```
Current:
  User (does everything) -> Clay -> AI (stateless tool)

With pilot:
  User (product owner)  -> Mate (senior dev, persistent) -> Clay (as a tool)
                                                              |
                                                              +-> Claude Code session
                                                              +-> Codex session
                                                              +-> Sticky notes
                                                              +-> Handoff docs
                                                              +-> Permission approvals
                                                              +-> ...
```

The user gives product direction ("we need email integration", "this approach feels wrong", "ship this by Friday"). The pilot takes it from there: breaks it into tasks, opens sessions, watches them, reviews output, writes notes, creates handoff documents when context gets large, and reports back.

The key insight: **the pilot uses Clay the same way a human developer does**. It is a meta-user of Clay.

## How It Works

### 1. Clay Actions (the pilot's hands)

Currently, all Clay operations are triggered by humans through the UI (WebSocket messages from the browser). For the pilot to operate Clay, these same operations must be exposed as **MCP tools** the Mate can invoke. See [PILOT-MCP-SERVER.md](./PILOT-MCP-SERVER.md) for the full tool specification.

### 2. Event Callback (not a persistent process)

The pilot is not a long-running process. It sleeps and wakes on events:

```
Coder session completes  ->  Wake pilot (pass agent chat output)  ->  Judge  ->  Next action  ->  Sleep
Permission request        ->  Wake pilot (pass request)            ->  Approve/deny             ->  Sleep
User message              ->  Wake pilot (pass instruction)        ->  Break into tasks -> Open session ->  Sleep
```

Same pattern as the existing @mention system. The only difference is the trigger: session events instead of @mentions. No polling.

### 3. Conversation Flow

```
User: "Add email integration"

Pilot (e.g. Claude Opus):
  - Recalls past architecture decisions, coding conventions
  - Reads relevant files to understand current state
  - Breaks the task into concrete steps
  - Writes detailed instructions for the coder

  -> Yoke.createQuery({ vendor, model }) spawns coder session (e.g. GPT-4o):
     "Create lib/email-accounts.js following the attachXxx pattern.
      Use var, CommonJS. Encrypt passwords with AES-256-GCM.
      See lib/project-knowledge.js for pattern reference..."

  <- Session completes, pilot wakes up
  - Receives agent chat output only (not code diffs)
  - Checks for consistency with project patterns
  - Requests fixes if needed (can retry with same or different model/vendor)
  - Reports back to user
```

### 4. One Session at a Time

The pilot manages one coder session at a time. No parallel sessions.
This eliminates merge conflicts, file contention, and coordination complexity.

```
Pilot -> Session 1 -> Wait -> Review -> Session 2 -> Wait -> Review -> ...
```

### 5. Role Architecture (via Yoke)

The pilot/coder split is **vendor-agnostic**. Yoke's adapter layer (`lib/yoke/`) abstracts the underlying provider, so any model can fill either role. The user configures both the pilot model and the coder model independently.

| Role | Responsibility | Example Models |
|------|---------------|----------------|
| Pilot (Mate) | Strategic thinking, memory, architecture, review | Claude Opus, GPT-4o, Gemini |
| Coder (via Yoke) | Implementation, file edits, tests | Claude Sonnet/Haiku, GPT-4o-mini, Gemini Flash |

Example configurations:

| Pilot | Coder | Use Case |
|-------|-------|----------|
| Claude Opus | Claude Sonnet | Same ecosystem, stable baseline |
| Claude Opus | GPT-4o | Leverage GPT strengths for specific languages |
| GPT-4o | Claude Haiku | Cost optimization with fast coder |
| Gemini | Claude Sonnet | Leverage Gemini's large context window for pilot |

Since Yoke handles capability detection (`capabilities` object per adapter), the pilot can adapt its delegation strategy based on what the coder runtime actually supports (thinking, session resume, tool use, etc.).

### 6. Pilot Memory

The pilot's advantage over a fresh session is **persistent project knowledge**. All of these already exist:

- **Session digests** (`session-digests.jsonl`) - auto-summarized history, no pruning, unlimited accumulation
- **Memory summary** (`memory-summary.md`) - Haiku-compressed long-term memory, incrementally updated
- **User observations** (`user-observations.jsonl`) - learned preferences and patterns
- **Architecture notes** (via sticky notes, synced to `knowledge/sticky-notes.md`)
- **Handoff documents** (new, stored in `knowledge/handoffs/`) - auto-loaded by existing knowledge system
- **Cross-mate memory** (`globalSearch: true`) - access to other Mates' knowledge
- **BM25 search** - full-text search across all digests, sessions, knowledge files

Context continuity: when the pilot's context fills up, it uses the existing session-splitting logic (same as mentions). memory-summary.md + latest handoff restores context.

### 7. Permission Model

The pilot needs a clear permission scope. Not everything should be autonomous:

| Action | Default | Configurable |
|--------|---------|-------------|
| Open coding sessions | Autonomous | Yes |
| Approve file writes in coder sessions | Autonomous | Yes, can require user approval |
| Approve command execution | Ask user | Yes |
| Write sticky notes | Autonomous | Yes |
| Create handoff documents | Autonomous | Yes |
| Push to git / create PRs | Ask user | Yes |
| Deploy / destructive operations | Always ask user | No |

The user sets the pilot's autonomy level. "Full autonomy" means the pilot only reports results. "Supervised" means it asks before major actions.

## User's Role

The user becomes the **product owner**:

- Sets direction: "Build this feature", "Fix this bug class", "Refactor this module"
- Gives feedback: "This approach is wrong", "I prefer this pattern", "Ship it"
- Adjusts autonomy: "Don't push without asking me", "You can approve file writes"
- Reviews when needed: The pilot flags things that need human judgment

The user can be asleep, at lunch, or working on something else. The pilot keeps going.

## Key Differences from Current Flow

| | Current | With Pilot |
|---|---|---|
| Who coordinates | Human | Mate |
| Session lifecycle | Human opens/closes | Pilot manages |
| Context | Lost between sessions | Persistent in pilot memory |
| Vendor selection | Human chooses | Pilot chooses per task |
| Permission handling | Human clicks approve | Pilot approves (within scope) |
| Progress tracking | Human remembers | Pilot writes notes and handoffs |
| Cost optimization | Human guesses | Pilot routes to cheapest capable model |

## What Needs to Be Built

### Exists Today
- Yoke model abstraction (`lib/yoke/`)
- Yoke adapters (claude, codex)
- Session management (`lib/project-sessions.js`)
- Sticky notes (`lib/notes.js`)
- Permission system (`lib/users-permissions.js`)
- Mate memory system (digests, observations, summaries, BM25 search)
- Mate knowledge files (auto-loaded from `knowledge/` directory)
- Mention system with session-splitting logic
- MCP server pattern (email, browser, debate)

### Needs to Be Built
1. **Pilot MCP Server** - Clay internal operations exposed as MCP tools for the Mate. See [PILOT-MCP-SERVER.md](./PILOT-MCP-SERVER.md)
2. **Session event callbacks** - Route coder session events (completion, permission requests) to pilot Mate as triggers (extend existing mention system)
3. **Agent chat output extraction** - Filter coder session output to text-only (no code diffs) for pilot context
4. **Handoff document storage** - Write to `knowledge/handoffs/`, auto-loaded by existing knowledge system
5. **Pilot assignment UI** - Assign a Mate as pilot, configure autonomy level and model preferences

## Open Questions

1. **Error recovery judgment**: When a coder session is struggling, how does the pilot decide "keep going vs. start over vs. switch model"? Prompt tuning + experimentation.
2. **Cost controls**: Budget limits? Session caps per hour/day?
3. **UI representation**: How to show pilot-managed sessions in the UI? Pilot dashboard?
