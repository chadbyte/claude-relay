# Mate AskUserQuestion MCP Implementation

## Goal

Add a Codex-accessible in-app MCP tool that lets mate sessions trigger the existing Clay `AskUserQuestion` UX without inventing a new payload format or a second question UI.

This feature is **mate-only** for now. Do not expose it in normal non-mate project sessions.

## Core Requirements

1. Reuse the existing Claude `AskUserQuestion` input shape exactly.
2. Reuse the existing Clay `renderAskUserQuestion()` UI exactly.
3. Reuse the existing `ask_user_response` answer path exactly.
4. Do not use generic MCP elicitation UI for this feature.
5. Only expose the MCP tool when `isMate === true`.

## Non-Goals

1. Do not invent a new schema format for Codex.
2. Do not add a second question renderer.
3. Do not expose this tool globally to all Codex sessions.
4. Do not add inline logic to `project.js` message dispatch.

## Existing Flow To Reuse

### Claude path today

1. Claude calls `AskUserQuestion`.
2. Clay stores a pending entry in `session.pendingAskUser`.
3. Clay emits a `tool_executing` event with:
   - `name: "AskUserQuestion"`
   - `input.questions`
4. Client sees that event and calls `renderAskUserQuestion()`.
5. User answers.
6. Client sends `ask_user_response`.
7. Server resolves the pending entry and continues the tool flow.

### Files involved

- `lib/sdk-bridge.js`
- `lib/project-sessions.js`
- `lib/public/modules/app-messages.js`
- `lib/public/modules/tools.js`

## Desired Codex Flow

1. Codex calls an MCP tool:
   - server: `clay-ask-user`
   - tool: `ask_user_questions`
2. The MCP handler does **not** render generic MCP input UI.
3. The MCP handler looks up the active mate session.
4. The handler creates a pending `session.pendingAskUser[...]` entry.
5. The handler emits the same client-facing event shape used by Claude:
   - `type: "tool_executing"`
   - `name: "AskUserQuestion"`
   - `input: { questions: [...] }`
6. The client renders the existing ask-user card.
7. The user answers using the existing UI.
8. `ask_user_response` resolves the pending entry.
9. The server converts the answer into an MCP tool result and returns it to Codex.

## Payload Format

The MCP tool input must match the existing Claude-style payload shape:

```js
{
  questions: [
    {
      header: "Decision",
      question: "Which direction should I take?",
      multiSelect: false,
      options: [
        { label: "Option A", description: "Fastest path" },
        { label: "Option B", description: "Safest path" },
        { label: "Option C", description: "Most flexible path" }
      ]
    }
  ]
}
```

Support these fields:

- `questions`
- `questions[].header`
- `questions[].question`
- `questions[].multiSelect`
- `questions[].options`
- `questions[].options[].label`
- `questions[].options[].description`
- `questions[].options[].markdown`

Do not rename any of them.

## Implementation Plan

### 1. Add a mate-only in-app MCP server

Create a new server module:

- `lib/ask-user-mcp-server.js`

Pattern:

- Follow the same style as `lib/debate-mcp-server.js`
- Export `getToolDefs(onAsk)`
- Return a single tool definition:
  - `name: "ask_user_questions"`
  - `description`: explain that it uses the existing Clay AskUserQuestion UI
  - `inputSchema`: Zod schema matching the Claude payload shape
  - `handler(args)`: validate `args.questions` and call `onAsk(args)`

### 2. Register the server in `project.js`

File:

- `lib/project.js`

Inside the in-app MCP server setup block, add a new registration branch.

Important:

- Only register this server when `isMate` is true.
- Do not expose it in non-mate sessions.

Expected structure:

```js
if (isMate) {
  // require("./ask-user-mcp-server")
  // build tool defs
  // adapter.createToolServer(...)
  // add to servers map
}
```

Suggested names:

- MCP server name: `clay-ask-user`
- MCP tool name: `ask_user_questions`

### 3. Reuse `session.pendingAskUser`

Inside the MCP handler callback passed from `project.js`:

1. Get the active session from the session manager.
2. If no active session exists, return an MCP error result.
3. If the session is an autonomous loop session and not crafting mode, reject the tool.
4. Create a unique tool id.
5. Store a pending entry in `session.pendingAskUser[toolId]`.

Suggested pending shape:

```js
session.pendingAskUser[toolId] = {
  resolve: resolve,
  input: input,
  mode: "mcp",
};
```

The `mode: "mcp"` marker is important so `project-sessions.js` can distinguish this from the Claude path.

### 4. Emit the existing AskUserQuestion UI event

Still inside the MCP handler callback, emit:

```js
sm.sendAndRecord(session, {
  type: "tool_executing",
  id: toolId,
  name: "AskUserQuestion",
  input: input,
});
```

This is the key compatibility step.

Do not emit:

- `elicitation_request`
- generic `ask_user`
- a new UI-specific event

The goal is for `lib/public/modules/app-messages.js` to take the same branch it already uses for Claude.

### 5. Reuse `ask_user_response`

File:

- `lib/project-sessions.js`

Update the existing `ask_user_response` handler.

Current behavior:

- resolves Claude requests with:

```js
{
  behavior: "allow",
  updatedInput: Object.assign({}, pending.input, { answers: answers }),
}
```

Required behavior:

- If `pending.mode !== "mcp"`, keep the current behavior unchanged.
- If `pending.mode === "mcp"`, resolve with an MCP-friendly result instead.

Suggested shape:

```js
{
  content: [
    {
      type: "text",
      text: JSON.stringify({ answers: answers }),
    }
  ],
  structuredContent: { answers: answers },
}
```

This lets Codex receive a proper MCP result while the UI still uses the old path.

### 6. Hide the underlying MCP tool row

File:

- `lib/public/modules/app-messages.js`

Problem:

- Codex will still produce a normal MCP tool item for `ask_user_questions`
- We do not want the user to see both:
  - the raw MCP tool row
  - the synthetic `AskUserQuestion` card

Fix:

- In the `tool_start` handling branch, special-case `msg.name === "ask_user_questions"`
- Mark it hidden the same way debate and plan helper tools are hidden

Suggested behavior:

```js
getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
```

This keeps the visible UI limited to the synthetic `AskUserQuestion` card.

## Files To Change

### New file

- `lib/ask-user-mcp-server.js`

### Existing files

- `lib/project.js`
- `lib/project-sessions.js`
- `lib/public/modules/app-messages.js`

## Files That Should Not Need New UX

- `lib/public/modules/tools.js`

Reason:

- It already renders `AskUserQuestion` correctly.
- The whole point is to keep using that existing renderer.

## Edge Cases

### No active session

If no active session is available, return an MCP error result such as:

- `"Error: no active session is available for AskUserQuestion."`

### Autonomous loop sessions

Match existing `AskUserQuestion` behavior:

- deny during loop execution unless the session is in crafting mode

### History replay

Because the synthetic event uses the existing `AskUserQuestion` event shape and `ask_user_answered` is still recorded, replay should continue to work using the current client logic.

### Multiple simultaneous Codex sessions

This first implementation may rely on the currently active session.
That is acceptable for now because the existing Codex MCP bridge already assumes a single active session/project context in practice.

Do not over-design session routing in this task.

## Test Checklist

### Mate Codex session

1. Confirm `ask_user_questions` appears in the tool list.
2. Call it with a valid Claude-style payload.
3. Confirm the raw MCP tool row is hidden.
4. Confirm the existing AskUserQuestion card appears.
5. Answer using buttons.
6. Confirm the Codex tool receives the answers as MCP result data.
7. Refresh or replay history and confirm the answered state restores correctly.

### Non-mate Codex session

1. Confirm `ask_user_questions` is not exposed.

### Claude session

1. Confirm normal Claude `AskUserQuestion` still works unchanged.

### Loop session

1. Confirm autonomous mode refuses the question.

## Done Criteria

This task is done only when all of the following are true:

1. Codex mate sessions can call an MCP tool with the Claude AskUserQuestion payload.
2. Clay renders the existing AskUserQuestion card, not a generic MCP form.
3. User answers flow through `ask_user_response`.
4. Codex receives an MCP result with the collected answers.
5. The tool is mate-only.
6. Claude behavior is unchanged.
