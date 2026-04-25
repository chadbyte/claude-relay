# YOKE Developer Guide

> Practical guide for Clay developers working with multi-runtime support.
> Answers: "How do I handle this feature on a different runtime?"

---

## 1. Core Principle

YOKE is a runtime-neutral interface, but neutral does not mean minimal. **The goal is to make users unable to feel the difference between runtimes.**

When a runtime does not support a feature, there are 4 strategies:

| Strategy | Description | User impact |
|----------|-------------|-------------|
| **MAP** | Both runtimes have the feature but with different APIs. Adapter maps between them. | No difference |
| **POLYFILL** | Runtime lacks the feature, but Clay implements it at a higher level. | Slightly different (performance, quality) |
| **DEGRADE** | Partial support only. Reduced UX provided. | Fewer capabilities |
| **HIDE** | No equivalent possible. Hidden from UI. | Feature disappears |

**HIDE is the last resort.** Always consider POLYFILL or DEGRADE first.

---

## 2. Strategy Selection Flowchart

```
Feature X is missing in Runtime B
  |
  +-- Does Runtime B have a similar feature?
  |     |
  |     +-- Yes -> MAP (adapter maps the equivalent API)
  |     |
  |     +-- No
  |           |
  |           +-- Can Clay implement it without runtime support?
  |                 |
  |                 +-- Yes -> POLYFILL (Clay implements directly)
  |                 |
  |                 +-- No
  |                       |
  |                       +-- Is a reduced version possible?
  |                             |
  |                             +-- Yes -> DEGRADE (reduced UX)
  |                             |
  |                             +-- No -> HIDE (remove from UI)
```

---

## 3. Feature Strategy Table

Recommended strategy for each Claude-specific feature when running on other runtimes.

| Feature | Claude | Codex/OpenCode equivalent | Strategy | Implementation |
|---------|--------|--------------------------|----------|----------------|
| Extended Thinking | `thinking: { type, budgetTokens }` | Codex: `reasoning_effort`. OpenCode: varies by runtime. | **MAP** | Adapter maps `adapterOptions.CODEX.reasoning_effort` to its native API. UI can unify under `capabilities.reasoning`. |
| Session Rewind | `resumeSessionAt: uuid` + message UUIDs | Likely absent | **POLYFILL** | Clay stores conversation history. Replay messages up to the target point in a new query. Slower but functionally equivalent. |
| Session Resume | `resume: cliSessionId` | Varies by runtime | **MAP** or **POLYFILL** | If runtime supports session persistence, MAP. Otherwise, Clay replays history as POLYFILL. |
| Prompt Suggestions | `promptSuggestions: true` | Likely absent | **POLYFILL** | Clay generates suggestions from conversation context. Post-processing step that asks the LLM "suggest 3 follow-up questions." |
| Permission Modes | `setPermissionMode("acceptEdits")` | Likely absent | **POLYFILL** | `canUseTool` callback in Clay identifies edit tools and auto-approves them. No SDK optimization, but identical behavior. |
| File Checkpointing | `enableFileCheckpointing: true` | Likely absent | **POLYFILL** or **HIDE** | Clay creates its own file backups before edits, or uses git-based checkpoints. Cost-benefit analysis needed. |
| Beta Flags | `betas: [...]` | May exist in different form | **MAP** or **HIDE** | If runtime has experimental feature flags, MAP. Otherwise, HIDE. |
| Fast Mode | `fast_mode_state` | Codex: different tier/rate limit model | **DEGRADE** | Rate limit info already flows via `rate_limit` INTERFACE event. Fast mode toggle itself is Claude-specific, so hide it. Billing info is still shown. |
| Context Compacting | `status: "compacting"` | May have similar feature | **MAP** or **HIDE** | If runtime reports context compression status, MAP. Otherwise, HIDE. |
| Agent Progress Summaries | `agentProgressSummaries: true` | Likely absent | **POLYFILL** | Clay generates summaries from tool usage patterns. "Read 3 files, edited 2" style simple summaries. |
| Elicitation | `onElicitation` callback | Likely absent | **DEGRADE** | If adapter never calls `onElicitation`, the runtime proceeds with its own judgment. No user confirmation, so reduced UX. |

---

## 4. Code Patterns

### 4.1 MAP: adapter maps equivalent APIs

When both runtimes have a similar feature with different interfaces.

```js
// Clay code -- does not know the vendor
adapter.createQuery({
  effort: "high",   // YOKE standard
  adapterOptions: {
    CLAUDE: { thinking: { type: "enabled", budgetTokens: 10000 } },
    CODEX: { reasoning_effort: "high" },
  }
});

// Inside Claude adapter
function createQuery(opts) {
  var queryOptions = { /* ... */ };
  var claudeOpts = opts.adapterOptions && opts.adapterOptions.CLAUDE;
  if (claudeOpts && claudeOpts.thinking) {
    queryOptions.thinking = claudeOpts.thinking;
  }
  return sdk.query({ prompt: mq, options: queryOptions });
}

// Inside Codex adapter
function createQuery(opts) {
  var queryOptions = { /* ... */ };
  var codexOpts = opts.adapterOptions && opts.adapterOptions.CODEX;
  if (codexOpts && codexOpts.reasoning_effort) {
    queryOptions.reasoning_effort = codexOpts.reasoning_effort;
  }
  return codexSdk.query(queryOptions);
}
```

### 4.2 POLYFILL: Clay implements directly

Runtime lacks the feature, but Clay provides it at a higher level.

```js
// Session Rewind POLYFILL
// Claude: native resumeSessionAt UUID
// Codex: history replay

function rewindToPoint(adapter, session, targetIndex) {
  if (capabilities.rewind) {
    // Claude: native rewind
    return adapter.createQuery({
      resumeSessionId: session.cliSessionId,
      adapterOptions: {
        CLAUDE: { resumeSessionAt: session.messageUUIDs[targetIndex].uuid }
      }
    });
  }

  // POLYFILL: replay history from scratch
  var newQuery = adapter.createQuery({
    model: session.model,
    systemPrompt: session.systemPrompt,
  });

  // Replay messages up to the target index
  for (var i = 0; i < targetIndex; i++) {
    newQuery.pushMessage(session.history[i].text, session.history[i].images);
    // Wait for response before sending next message
  }

  return newQuery;
}
```

### 4.3 DEGRADE: reduced UX

Only partial functionality available.

```js
// Elicitation DEGRADE
// Claude: runtime sends structured questions for user confirmation
// Codex: no equivalent, runtime proceeds on its own

// Clay UI code
if (capabilities.elicitation) {
  // Full UX: show selection modal to user
  showElicitationModal(request);
} else {
  // Info message only
  showSystemMessage(
    "This runtime does not support interactive confirmation. "
    + "The agent will proceed with its best judgment."
  );
}
```

### 4.4 HIDE: remove from UI

Feature has no viable replacement.

```js
// Settings panel
function renderSettings(capabilities) {
  // Common settings (always shown)
  renderModelSelector();
  renderEffortSlider();

  // Capability-based (shown only if available)
  if (capabilities.thinking) renderThinkingToggle();
  if (capabilities.betas) renderBetaFlags();
  if (capabilities.rewind) renderRewindButton();
  // If capabilities.fastMode is missing -> toggle is not shown at all
}
```

---

## 5. Capability Declaration

### adapter.init() return value

```js
{
  models: ["claude-sonnet-4-20250514", ...],
  defaultModel: "claude-sonnet-4-20250514",
  skills: [...],
  capabilities: {
    // Boolean: supported or not
    thinking: true,
    betas: true,
    rewind: true,
    sessionResume: true,
    promptSuggestions: true,
    elicitation: true,
    fileCheckpointing: true,
    contextCompacting: true,

    // Array: supported values
    toolPolicy: ["ask", "allow-all"],
  }
}
```

### Rules for adding capabilities

1. **When creating a new adapter**: Declare supported features in `capabilities`.
2. **When adding a new feature to Clay**: If the feature depends on an adapter capability, define the capability key first, then add `false` (or omit) in all existing adapters.
3. **Capability names must be runtime-neutral**: Use `thinking`, not `claudeThinking`. Use `reasoning`, not `codexReasoning`.

---

## 6. adapterOptions Usage Rules

### DO

```js
// Always include all vendors' options together
adapter.createQuery({
  adapterOptions: {
    CLAUDE: { thinking: settings.claude.thinking },
    CODEX: { reasoning_effort: settings.codex.reasoningEffort },
  }
});
```

```js
// Branch on capabilities, not vendor names
if (capabilities.thinking) {
  showThinkingControls();
}
```

```js
// Check capability before choosing native vs polyfill
if (capabilities.rewind) {
  nativeRewind();
} else {
  polyfillRewind();
}
```

### DO NOT

```js
// WRONG: do not branch on vendor name
if (adapter.vendor === "claude") {
  // Claude-specific logic
} else if (adapter.vendor === "codex") {
  // Codex-specific logic
}
```

```js
// WRONG: do not check vendor keys inside adapterOptions
if (adapterOptions.CLAUDE) {
  // This is the adapter's job, not Clay's
}
```

```js
// WRONG: do not hide features without capability check
// (hardcoded vendor list)
if (vendor !== "claude") {
  hideThinkingToggle();  // use capability-based, not vendor-based
}
```

### The only place where vendor branching is allowed

**Settings assembly code only.** Each vendor's adapterOptions structure is different, so assembling settings requires vendor-specific knowledge.

```js
// This is acceptable: settings assembly
function buildAdapterOptions(userSettings) {
  return {
    CLAUDE: {
      thinking: userSettings.thinking,
      betas: userSettings.betas,
    },
    CODEX: {
      reasoning_effort: userSettings.reasoningEffort,
    },
  };
}
```

This function exists in one place. The rest of Clay's codebase does not know vendor names.

---

## 7. New Adapter Checklist

1. Create `lib/yoke/adapters/{vendor}.js`
2. Implement all 11 interface methods
3. Define `capabilities` object (declare supported features)
4. Decide strategy per feature:
   - Runtime supports the feature -> MAP (adapter maps)
   - Runtime lacks the feature but Clay can substitute -> implement POLYFILL
   - Partial support -> implement DEGRADE
   - No replacement possible -> HIDE (set capability to `false`)
5. Define `runtime_specific` events (data unique to this runtime)
6. Document `adapterOptions.VENDOR` schema
7. Verify existing Clay UI does not break with the new capability set

---

## 8. User-Supplied Polyfills (Plugin Pattern)

Not just Clay developers, but **users and the community should be able to supply their own polyfills.** When a runtime lacks a feature, Clay provides default polyfills, but users can replace them with their own implementations.

### 8.1 Why this is needed

- Clay cannot build polyfills for every feature on every runtime
- The community may build better polyfills for specific runtimes
- Users differ on whether they want "a rough version is better than nothing" vs "I would rather have no feature than a bad one"

### 8.2 Polyfill Hook Structure

```js
// lib/yoke/polyfills.js

var defaultPolyfills = {
  rewind: require("./polyfills/rewind"),        // Clay default
  promptSuggestions: require("./polyfills/suggestions"),
};

function createPolyfillRegistry(userPolyfills) {
  // User polyfills take priority over defaults
  var merged = Object.assign({}, defaultPolyfills, userPolyfills);
  return {
    get: function(name) { return merged[name] || null; },
    has: function(name) { return !!merged[name]; },
    list: function() { return Object.keys(merged); },
  };
}

module.exports = { createPolyfillRegistry: createPolyfillRegistry };
```

### 8.3 How users register polyfills

```js
// Clay config (settings file or project config)
{
  "yoke": {
    "polyfills": {
      "rewind": "./my-polyfills/better-rewind.js",
      "promptSuggestions": "./my-polyfills/gpt-suggestions.js"
    }
  }
}
```

```js
// my-polyfills/better-rewind.js
// User-created custom rewind polyfill
module.exports = {
  name: "rewind",
  description: "Replay-based rewind for runtimes without native support",

  // Capability check: what does this polyfill need to function?
  requires: ["sessionResume"],

  // Implementation
  execute: function(adapter, session, targetIndex) {
    // Create a new query and replay history
    var query = adapter.createQuery({
      model: session.model,
      systemPrompt: session.systemPrompt,
      resumeSessionId: null,  // new session
    });
    for (var i = 0; i < targetIndex; i++) {
      query.pushMessage(session.history[i].text, session.history[i].images);
    }
    return query;
  }
};
```

### 8.4 How Clay uses polyfills

```js
function handleRewind(adapter, session, targetIndex) {
  // 1. Check native support
  if (capabilities.rewind) {
    return nativeRewind(adapter, session, targetIndex);
  }

  // 2. Check polyfill
  var polyfill = polyfillRegistry.get("rewind");
  if (polyfill) {
    return polyfill.execute(adapter, session, targetIndex);
  }

  // 3. Neither available
  showSystemMessage("Rewind is not available for this runtime.");
}
```

### 8.5 Relationship between Capabilities and Polyfills

```
adapter.init()
  |
  +-- capabilities.rewind = true?
  |     +-- Yes -> Use native feature (adapter handles it)
  |     +-- No
  |           +-- polyfillRegistry.has("rewind")?
  |                 +-- Yes -> Use polyfill (Clay default or user-supplied)
  |                 +-- No -> HIDE (remove from UI)
```

`capabilities` represents **native support only**. When a polyfill exists, the feature is available even if the capability is `false`. The UI sees the final state:

```js
// Final feature availability = native OR polyfill
function isFeatureAvailable(name) {
  return capabilities[name] || polyfillRegistry.has(name);
}
```

### 8.6 Polyfill Registration Rules

1. **Name matches the capability key**: The `rewind` polyfill pairs with `capabilities.rewind`
2. **`requires` declaration is mandatory**: Declare what capabilities the polyfill needs to function
3. **Same interface**: Native implementation and polyfill must have the same input/output shape
4. **User polyfills take priority over defaults**: When a user supplies a replacement, the default is ignored
5. **Explicit disable is possible**: Setting a polyfill to `null` explicitly turns off that feature

```json
{
  "yoke": {
    "polyfills": {
      "promptSuggestions": null
    }
  }
}
```

---

## 9. adapterOptions Promotion Rule

`adapterOptions` is a **graduation waiting room**. Features start there and get promoted to YOKE standard options when a second adapter needs the same concept.

### Promotion lifecycle

```
1. Feature exists only in Claude
   -> adapterOptions[adapter.vendor].thinking

2. Codex adapter is built, needs a similar concept
   -> Signal to promote. Define YOKE standard option.
   -> adapter.createQuery({ reasoning: { enabled: true, budget: 10000 } })
   -> Claude adapter maps "reasoning" to SDK "thinking"
   -> Codex adapter maps "reasoning" to "reasoning_effort"

3. Truly vendor-unique features (no equivalent anywhere)
   -> Permanent resident of adapterOptions[adapter.vendor]
   -> Examples: betas, settingSources, extraArgs
```

### Promotion criteria

| Promote to YOKE standard when... | Keep in adapterOptions when... |
|----------------------------------|-------------------------------|
| A second adapter needs the same concept | Only one vendor has this concept |
| The config shape can be unified | Config shapes are fundamentally incompatible |
| Clay's UI treats them as the same feature | Clay's UI shows them as separate features |

### After promotion

- Old `adapterOptions` key is deprecated, not removed
- Adapter reads YOKE standard option first, falls back to adapterOptions for backward compatibility
- Clay code migrates from vendor-specific settings to YOKE standard option

---

## 10. Polyfill Quality Bar

Polyfills can produce results that "work but feel off." Quality criteria:

| Criterion | Acceptable | Not acceptable |
|-----------|-----------|---------------|
| Slower than native (2-3x) | OK | |
| Slightly different output (format, detail level) | OK | |
| Produces fundamentally different results | | NOT OK |
| Data loss occurs | | NOT OK |
| User sees errors | | NOT OK |

If a polyfill cannot meet the quality bar, downgrade to DEGRADE or HIDE. **A clean HIDE is better than a bad POLYFILL.**
