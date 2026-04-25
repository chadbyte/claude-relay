# Phase 4a: Gemini Adapter

> Build the second adapter to prove the YOKE interface works across runtimes.
> Gemini before open-source release. "Claude + Gemini" is the Show HN headline.

---

## 0. Why Gemini, Why Now

Original Phase 4 was library extraction + open-source release. Revised because:

- Releasing with one adapter proves nothing. Two adapters prove the interface works.
- Gemini has practical value: generous token limits, strong model performance.
- Gemini CLI is open-source (100k+ stars), SDK is mature (`@google/genai` v1.49).
- "Claude + Gemini" is a stronger Show HN headline than "Claude + OpenCode".
- Building the second adapter reveals interface gaps before they're published.

### Revised Phase order

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 3 | Claude adapter (interface + implementation) | Complete |
| **Phase 4a** | **Gemini adapter (second runtime proof)** | **This document** |
| Phase 4b | Library extraction + open-source release | After 4a |

---

## 1. SDK Overview

**Package**: `@google/genai` (v1.49.0, npm)

**Core API surface**:

```js
var { GoogleGenAI } = require("@google/genai");
var ai = new GoogleGenAI({ apiKey: "..." });

// Chat (stateful, multi-turn)
var chat = ai.chats.create({ model: "gemini-2.5-flash", config: { ... } });
var response = await chat.sendMessageStream({ message: "hello" });
for await (var chunk of response) {
  // chunk.candidates[0].content.parts[]
  // chunk.usageMetadata
}

// Direct (stateless, single-turn)
var response = await ai.models.generateContentStream({
  model: "gemini-2.5-flash",
  contents: "hello",
  config: { ... },
});
```

**Key difference from Claude SDK**: Gemini SDK manages chat history internally via `Chat` class. Claude SDK uses a push-based message queue (`prompt: asyncIterable`). The adapter must bridge this gap.

---

## 2. Interface Mapping

### 2.1 Adapter Lifecycle

| YOKE Method | Gemini Implementation | Notes |
|-------------|----------------------|-------|
| `init(opts)` | `new GoogleGenAI({ apiKey })`. Model list via `ai.models.list()` or hardcoded. | API key from `GEMINI_API_KEY` env or `adapterOptions.GEMINI.apiKey`. |
| `supportedModels()` | Return cached model list. | `gemini-2.5-flash`, `gemini-2.5-pro`, etc. |
| `createToolServer(def)` | Convert YOKE tool defs to `FunctionDeclaration[]`. | Zod schema -> JSON schema conversion needed. |

### 2.2 Query Lifecycle

| YOKE Method | Gemini Implementation | Notes |
|-------------|----------------------|-------|
| `createQuery(opts)` | `ai.chats.create({ model, config })`. Config includes `systemInstruction`, `tools`, `thinkingConfig`. | Returns QueryHandle wrapping the Chat instance. |
| `pushMessage(text, images)` | `chat.sendMessageStream({ message })`. | Chat manages history. Each call returns a new stream. |
| `setModel(model)` | Create new Chat with new model + existing history. | Gemini fixes model at Chat creation. Model swap = new Chat. |
| `setEffort(effort)` | Map to `thinkingConfig.thinkingBudget`. | "high" -> large budget, "low" -> small budget. |
| `setToolPolicy(policy)` | Map to `functionCallingConfig.mode`. | "ask" -> AUTO, "allow-all" -> ANY. |
| `stopTask(taskId)` | No-op. | Gemini has no sub-agent concept. |
| `getContextUsage()` | Return last `response.usageMetadata`. | `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `thoughtsTokenCount`. |
| `abort()` | `AbortController.abort()`. | Standard. |
| `close()` | Release Chat reference. | GC handles cleanup. |

### 2.3 Tool Server

| YOKE Method | Gemini Implementation | Notes |
|-------------|----------------------|-------|
| `createToolServer(def)` | Convert `{ name, description, inputSchema, handler }` to `{ functionDeclarations: [...] }` + handler registry. | Gemini SDK has `mcpToTool()` for MCP servers, but YOKE tools are not MCP. Direct FunctionDeclaration conversion is simpler. |

---

## 3. Event Mapping

### Gemini streaming chunk structure

```js
// Each chunk from sendMessageStream:
{
  candidates: [{
    content: {
      parts: [
        { text: "hello" },                    // text output
        { text: "reasoning...", thought: true }, // thinking
        { functionCall: { name: "Read", args: { file_path: "..." } } },
      ]
    },
    finishReason: "STOP"  // or "MAX_TOKENS", etc.
  }],
  usageMetadata: {
    promptTokenCount: 100,
    candidatesTokenCount: 50,
    totalTokenCount: 150,
    thoughtsTokenCount: 20,
  }
}
```

### yokeType mapping

| Gemini chunk data | yokeType | Extracted fields |
|-------------------|----------|-----------------|
| First chunk arrives | `turn_start` | (signal only) |
| `part.text` (thought=false) | `text_delta` | `text`, `blockId` |
| `part.text` (thought=true) | `thinking_delta` | `text`, `blockId` |
| `part.functionCall` | `tool_start` | `toolName`, `toolId`, `blockId` |
| (after functionCall parsed) | `tool_executing` | `toolId`, `input` |
| (after handler executed) | `tool_result` | `toolId`, `content`, `isError` |
| `finishReason` present | `result` | `cost` (null), `duration`, `usage`, `sessionId` (null) |
| `usageMetadata` | (field on result) | `promptTokenCount`, `candidatesTokenCount` |
| Error | `error` | `text` |
| Unknown/unmapped | `runtime_specific` | `vendor: "gemini"`, raw data |

### Events that will NOT be emitted by Gemini adapter

| yokeType | Why |
|----------|-----|
| `text_start` / `thinking_start` / `thinking_stop` | Gemini doesn't signal block boundaries. Parts arrive in chunks without explicit start/stop. Adapter can synthesize these by tracking state. |
| `tool_input_delta` | Gemini sends complete `functionCall.args` in one shot, not streamed. |
| `task_started` / `task_progress` / `task_notification` | No sub-agents. |
| `subagent_message` / `subagent_activity` | No sub-agents. |
| `prompt_suggestion` | Gemini SDK doesn't generate suggestion chips. POLYFILL candidate. |
| `status` (compacting) | No equivalent. |

---

## 4. Tool Calling Loop

This is the biggest architectural difference. Claude SDK handles tools internally. Gemini requires the adapter to run the loop.

### Claude (current)

```
Clay sends message -> SDK calls tools automatically -> SDK returns final response
```

### Gemini (adapter must implement)

```
1. Clay sends message
2. Adapter calls chat.sendMessageStream()
3. Chunk has functionCall -> adapter extracts it
4. Adapter calls tool handler (from createToolServer registry)
5. Adapter sends functionResponse back to chat
6. Repeat from step 2 until no more functionCalls
7. Final text response -> yield to Clay
```

### Implementation

```js
async function* runQueryLoop(chat, message, tools, abortSignal) {
  var currentMessage = message;

  while (true) {
    var response = await chat.sendMessageStream({
      message: currentMessage,
    });

    var functionCalls = [];

    for await (var chunk of response) {
      // Yield text/thinking deltas
      var parts = chunk.candidates[0].content.parts;
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].functionCall) {
          functionCalls.push(parts[i].functionCall);
          yield flattenEvent("tool_start", parts[i]);
        } else if (parts[i].thought) {
          yield flattenEvent("thinking_delta", parts[i]);
        } else if (parts[i].text) {
          yield flattenEvent("text_delta", parts[i]);
        }
      }
    }

    // No tool calls -> done
    if (functionCalls.length === 0) {
      yield flattenEvent("result", response);
      break;
    }

    // Execute tools and build response
    var toolResponses = [];
    for (var j = 0; j < functionCalls.length; j++) {
      var fc = functionCalls[j];
      yield flattenEvent("tool_executing", fc);

      var handler = tools.getHandler(fc.name);
      var result;
      try {
        result = await handler(fc.args);
        yield flattenEvent("tool_result", { name: fc.name, content: result, isError: false });
      } catch (e) {
        result = { error: e.message };
        yield flattenEvent("tool_result", { name: fc.name, content: result, isError: true });
      }

      toolResponses.push({
        functionResponse: { name: fc.name, response: result }
      });
    }

    // Send tool results back as next message
    currentMessage = toolResponses;
  }
}
```

---

## 5. adapterOptions.GEMINI

| Option | Type | Purpose |
|--------|------|---------|
| `apiKey` | string | Gemini API key. Falls back to `GEMINI_API_KEY` env. |
| `project` | string | Google Cloud project ID (Vertex AI). |
| `location` | string | Google Cloud location (Vertex AI). |
| `vertexai` | boolean | Use Vertex AI instead of Gemini API. |
| `thinkingConfig` | object | `{ includeThoughts, thinkingBudget }` |
| `temperature` | number | Generation temperature. |
| `maxOutputTokens` | number | Max tokens in response. |
| `topP` | number | Top-p sampling. |
| `topK` | number | Top-k sampling. |
| `safetySettings` | array | Content safety configuration. |

---

## 6. Capabilities

```js
{
  capabilities: {
    thinking: true,           // Gemini 2.5 supports thinking
    betas: false,             // No beta flags concept
    rewind: false,            // No session rewind
    sessionResume: false,     // Chat history is in-memory only
    promptSuggestions: false,  // No native suggestions (POLYFILL candidate)
    elicitation: false,       // No structured user input
    fileCheckpointing: false,  // No file checkpoints
    contextCompacting: false,  // No compacting signal
    toolPolicy: ["ask", "allow-all"],
  }
}
```

---

## 7. Key Challenges

### 7.1 Multi-turn QueryHandle

Claude: push-based. Clay pushes messages to a queue, SDK consumes.
Gemini: pull-based. Each `sendMessageStream()` is a separate call.

The QueryHandle must bridge this:

```
Clay calls pushMessage()
  -> adapter stores message
  -> adapter calls chat.sendMessageStream()
  -> adapter yields chunks through async iterator
  -> Clay consumes via for-await
```

The adapter needs an internal message queue that `pushMessage()` writes to and the async iterator reads from, triggering `sendMessageStream()` for each message.

### 7.2 Model change mid-session

Gemini fixes model at Chat creation. Changing model requires creating a new Chat with the existing history transferred via `chat.getHistory()`.

### 7.3 Block boundary synthesis

Claude emits explicit `content_block_start` and `content_block_stop`. Gemini doesn't. The adapter must track which parts are new vs continuing and synthesize `text_start`, `thinking_start`, `thinking_stop` events by comparing consecutive chunks.

Alternatively, simplify: only emit `text_delta` and `thinking_delta` without explicit start/stop. processSDKMessage already handles the case where start events are missing (it creates blocks on first delta).

### 7.4 canUseTool integration

YOKE passes `canUseTool` callback in createQuery options. The Gemini adapter must call this before executing each tool in the tool loop:

```js
var approval = await canUseTool(fc.name, fc.args, {});
if (approval.behavior === "deny") {
  // Send denial as tool result
  toolResponses.push({
    functionResponse: { name: fc.name, response: { error: approval.message } }
  });
  continue;
}
// Execute tool...
```

---

## 8. File Structure

```
lib/yoke/adapters/
  claude.js           # existing (1,300+ lines)
  claude-worker.js    # existing
  gemini.js           # NEW (~400-600 lines estimated)
```

No worker needed for Gemini. No OS-level user isolation requirement (that's a Clay/Claude-specific concern).

---

## 9. Implementation Plan

| Step | Description | Estimated size |
|------|-------------|---------------|
| 1 | Scaffold `gemini.js` with adapter factory, init, supportedModels | ~50 lines |
| 2 | createQuery + sendMessageStream + basic text streaming | ~100 lines |
| 3 | Event flattening (chunk -> yokeType) | ~80 lines |
| 4 | Tool calling loop (functionCall -> handler -> functionResponse) | ~120 lines |
| 5 | canUseTool integration in tool loop | ~30 lines |
| 6 | pushMessage (multi-turn via internal queue) | ~60 lines |
| 7 | setModel (new Chat + history transfer) | ~30 lines |
| 8 | setEffort, setToolPolicy, getContextUsage, abort, close | ~40 lines |
| 9 | createToolServer (YOKE def -> FunctionDeclaration) | ~50 lines |
| 10 | Wire into index.js (vendor routing) | ~5 lines |
| 11 | Test with Clay | Manual |

**Total estimated: ~500-600 lines.** Less than half of claude.js because no worker, no IPC, no complex event normalization.

---

## 10. Interface Validation

This is the real test. If the interface needs breaking changes to accommodate Gemini, Phase 2 classification was wrong.

### Expected: no interface changes

| YOKE concept | Gemini fit | Verdict |
|-------------|-----------|---------|
| createQuery returns async iterable | Chat + sendMessageStream wraps into async generator | Fits |
| pushMessage for multi-turn | chat.sendMessageStream() per message | Fits |
| canUseTool callback | Called in adapter's tool loop | Fits |
| onElicitation callback | Never called (capability: false) | Fits (optional) |
| yokeType events | Subset emitted, rest simply absent | Fits |
| adapterOptions vendor namespace | adapterOptions.GEMINI.{...} | Fits |
| capabilities declaration | Subset declared true | Fits |
| runtime_specific passthrough | Available for Gemini-specific data | Fits |

### Possible interface additions (minor, non-breaking)

| Addition | Reason |
|----------|--------|
| New yokeType for Gemini-specific events (if any) | runtime_specific handles this, no interface change needed |
| New capability keys | Additive, non-breaking |

---

## 11. Success Criteria

- [ ] `adapter.init()` returns models and capabilities
- [ ] Text streaming works (yokeType: text_delta)
- [ ] Thinking works (yokeType: thinking_delta)
- [ ] Tool calling loop works (tool_start -> tool_executing -> tool_result -> text response)
- [ ] canUseTool approval/denial works
- [ ] Multi-turn conversation works (pushMessage)
- [ ] Model change works (setModel)
- [ ] getContextUsage returns token counts
- [ ] abort cancels in-flight request
- [ ] Clay can switch between Claude and Gemini by changing adapter config
- [ ] Zero changes to YOKE interface.js
- [ ] Zero changes to processSDKMessage
