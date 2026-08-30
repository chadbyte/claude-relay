var test = require("node:test");
var assert = require("node:assert");

var yoke = require("../lib/yoke");
var claudeModule = require("../lib/yoke/adapters/claude");
var codexModule = require("../lib/yoke/adapters/codex");

function handleFor(events, capture) {
  return {
    pushMessage: function(prompt) {
      capture.prompts.push(prompt);
      return true;
    },
    setModel: function() {},
    setEffort: function() {},
    setToolPolicy: function() {},
    stopTask: function() {},
    getContextUsage: function() { return Promise.resolve(null); },
    endInput: function() { capture.inputEnded = true; },
    abort: function() { capture.aborted = true; },
    close: function() { capture.closed = (capture.closed || 0) + 1; },
    [Symbol.asyncIterator]: async function*() {
      for (var i = 0; i < events.length; i++) yield events[i];
    },
  };
}

function oneShotAdapter(events, capture) {
  return {
    vendor: "test",
    createQuery: function() { throw new Error("generic createQuery should not run"); },
    createOneShotQuery: function(opts) {
      capture.opts = opts;
      return Promise.resolve({ handle: handleFor(events, capture), backendPersistence: "ephemeral" });
    },
  };
}

test("completeOnce sends one prompt, closes input, and deduplicates streamed and final text", async function() {
  var capture = { prompts: [] };
  var adapter = oneShotAdapter([
    { yokeType: "text_delta", text: "Hello" },
    { yokeType: "message", messageRole: "assistant", content: [{ type: "text", text: "Hello world" }] },
    { yokeType: "result" },
  ], capture);
  var result = await yoke.completeOnce(adapter, { prompt: "one", model: "m" });
  assert.strictEqual(result.text, "Hello world");
  assert.strictEqual(result.backendPersistence, "ephemeral");
  assert.deepStrictEqual(capture.prompts, ["one"]);
  assert.strictEqual(capture.inputEnded, true);
  assert.strictEqual(capture.closed, 1);
});

test("completeOnce accepts a final-only assistant response", async function() {
  var capture = { prompts: [] };
  var result = await yoke.completeOnce(oneShotAdapter([
    { yokeType: "message", messageRole: "assistant", content: [{ type: "text", text: "Final only" }] },
    { yokeType: "result" },
  ], capture), { prompt: "one" });
  assert.strictEqual(result.text, "Final only");
});

test("completeOnce never registers a Clay session even when the backend reports an identity", async function() {
  var capture = { prompts: [] };
  var registrations = 0;
  var result = await yoke.completeOnce(oneShotAdapter([
    { yokeType: "session_started", sessionId: "backend-only" },
    { yokeType: "text_delta", text: "sessionless" },
    { yokeType: "result", sessionId: "backend-only" },
  ], capture), {
    prompt: "one",
    sessionManager: { createSession: function() { registrations++; } },
  });
  assert.strictEqual(result.text, "sessionless");
  assert.strictEqual(registrations, 0);
});

test("completeOnce requires an explicit opt-in for unknown backend persistence", async function() {
  var capture = { prompts: [] };
  var adapter = {
    vendor: "legacy",
    createQuery: function() { return Promise.resolve(handleFor([{ yokeType: "result" }], capture)); },
  };
  await assert.rejects(yoke.completeOnce(adapter, { prompt: "one" }), /does not guarantee ephemeral/);
  var result = await yoke.completeOnce(adapter, { prompt: "one", allowUnknownBackendPersistence: true });
  assert.strictEqual(result.backendPersistence, "unknown");
});

test("completeOnce validates native persistence claims in strict and unknown modes", async function() {
  var strictCapture = { prompts: [] };
  var strictAdapter = {
    vendor: "unverified",
    createQuery: function() { throw new Error("unused"); },
    createOneShotQuery: function() {
      return Promise.resolve({
        handle: handleFor([{ yokeType: "result" }], strictCapture),
        backendPersistence: "unknown",
      });
    },
  };
  await assert.rejects(yoke.completeOnce(strictAdapter, { prompt: "one" }), /did not confirm ephemeral/);
  assert.strictEqual(strictCapture.aborted, true);
  assert.strictEqual(strictCapture.closed, 1);

  var allowedCapture = { prompts: [] };
  var allowedAdapter = {
    vendor: "unverified",
    createQuery: function() { throw new Error("unused"); },
    createOneShotQuery: function() {
      return Promise.resolve({
        handle: handleFor([{ yokeType: "result" }], allowedCapture),
        backendPersistence: "persistent",
      });
    },
  };
  var result = await yoke.completeOnce(allowedAdapter, {
    prompt: "one",
    allowUnknownBackendPersistence: true,
  });
  assert.strictEqual(result.backendPersistence, "unknown");
});

test("completeOnce aborts and closes a timed-out query", async function() {
  var capture = { prompts: [] };
  var waitingResolve;
  var handle = handleFor([], capture);
  handle[Symbol.asyncIterator] = function() {
    return {
      next: function() {
        return new Promise(function(resolve) { waitingResolve = resolve; });
      },
    };
  };
  handle.abort = function() {
    capture.aborted = true;
    if (waitingResolve) waitingResolve({ done: true });
  };
  var adapter = {
    vendor: "test",
    createQuery: function() { throw new Error("unused"); },
    createOneShotQuery: function() { return Promise.resolve({ handle: handle, backendPersistence: "ephemeral" }); },
  };
  await assert.rejects(yoke.completeOnce(adapter, { prompt: "one", timeoutMs: 10 }), /timed out after 10 ms/);
  assert.strictEqual(capture.aborted, true);
  assert.strictEqual(capture.closed, 1);
});

test("completeOnce enforces timeout while an adapter is still creating resources", async function() {
  var capture = { aborted: false, closed: false };
  var resolveCreation;
  var adapter = {
    vendor: "slow",
    createQuery: function() { throw new Error("unused"); },
    createOneShotQuery: function() {
      return new Promise(function(resolve) { resolveCreation = resolve; });
    },
  };
  await assert.rejects(yoke.completeOnce(adapter, { prompt: "one", timeoutMs: 10 }), /timed out after 10 ms/);
  resolveCreation({
    backendPersistence: "ephemeral",
    handle: {
      abort: function() { capture.aborted = true; },
      close: function() { capture.closed = true; },
    },
  });
  await new Promise(function(resolve) { setImmediate(resolve); });
  assert.strictEqual(capture.aborted, true);
  assert.strictEqual(capture.closed, true);
});

test("completeOnce propagates caller abort and closes the query", async function() {
  var capture = { prompts: [] };
  var waitingResolve;
  var handle = handleFor([], capture);
  handle[Symbol.asyncIterator] = function() {
    return { next: function() { return new Promise(function(resolve) { waitingResolve = resolve; }); } };
  };
  handle.abort = function() {
    capture.aborted = true;
    if (waitingResolve) waitingResolve({ done: true });
  };
  var adapter = {
    vendor: "test",
    createQuery: function() { throw new Error("unused"); },
    createOneShotQuery: function() { return Promise.resolve({ handle: handle, backendPersistence: "ephemeral" }); },
  };
  var controller = new AbortController();
  var completion = yoke.completeOnce(adapter, { prompt: "one", signal: controller.signal });
  setImmediate(function() { controller.abort(); });
  await assert.rejects(completion, /was aborted/);
  assert.strictEqual(capture.aborted, true);
  assert.strictEqual(capture.closed, 1);
});

test("Claude one-shot passes true non-persistence and scoped settings to the SDK", async function() {
  var captured = {};
  var fakeSdk = {
    query: function(input) {
      captured.options = input.options;
      var raw = {
        [Symbol.asyncIterator]: function() {
          return (async function*() {
            captured.prompt = await input.prompt[Symbol.asyncIterator]().next();
            yield { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Claude" } } };
            yield { type: "result" };
          })();
        },
        setModel: function() {},
        setPermissionMode: function() {},
        stopTask: function() {},
        getContextUsage: function() { return Promise.resolve(null); },
        close: function() {},
      };
      return raw;
    },
  };
  var adapter = claudeModule.createClaudeAdapter({ cwd: "/workspace", loadSDK: function() { return Promise.resolve(fakeSdk); } });
  var result = await yoke.completeOnce(adapter, {
    cwd: "/workspace",
    model: "claude-test",
    prompt: "one prompt",
    query: { adapterOptions: { CLAUDE: { settingSources: ["user"] } } },
  });
  assert.strictEqual(result.text, "Claude");
  assert.strictEqual(result.backendPersistence, "ephemeral");
  assert.strictEqual(captured.options.persistSession, false);
  assert.deepStrictEqual(captured.options.settingSources, ["user"]);
  assert.strictEqual(captured.options.model, "claude-test");
  assert.strictEqual(captured.prompt.value.message.content[0].text, "one prompt");
});

function fakeCodexServer(calls, confirmsEphemeral) {
  var handlers = [];
  return {
    started: false,
    start: function() { this.started = true; return Promise.resolve(); },
    notify: function() {},
    respond: function() {},
    addHandler: function(fn) {
      var entry = { threadId: null, fn: fn };
      handlers.push(entry);
      return entry;
    },
    removeHandler: function(entry) {
      var index = handlers.indexOf(entry);
      if (index !== -1) handlers.splice(index, 1);
    },
    send: function(method, params) {
      calls.push({ method: method, params: params });
      if (method === "initialize") return Promise.resolve({});
      if (method === "skills/list") return Promise.resolve({ data: [] });
      if (method === "thread/start") {
        return Promise.resolve({ thread: { id: "thread-once", ephemeral: confirmsEphemeral } });
      }
      if (method === "turn/start") {
        setImmediate(function() {
          var active = handlers.slice();
          for (var i = 0; i < active.length; i++) {
            active[i].fn({ method: "item/agentMessage/delta", params: { threadId: "thread-once", itemId: "answer", delta: "Codex" } });
            active[i].fn({ method: "turn/completed", params: { threadId: "thread-once" } });
          }
        });
        return Promise.resolve({});
      }
      return Promise.resolve({});
    },
  };
}

test("Codex one-shot sends and verifies the real thread/start ephemeral protocol field", async function() {
  var calls = [];
  var server = fakeCodexServer(calls, true);
  var adapter = codexModule.createCodexAdapter({ cwd: "/workspace", createAppServer: function() { return server; } });
  var result = await yoke.completeOnce(adapter, { cwd: "/workspace", model: "gpt-test", prompt: "one" });
  var start = calls.find(function(call) { return call.method === "thread/start"; });
  var turns = calls.filter(function(call) { return call.method === "turn/start"; });
  assert.strictEqual(start.params.ephemeral, true);
  assert.strictEqual(turns.length, 1);
  assert.strictEqual(turns[0].params.input[0].text, "one");
  assert.strictEqual(result.text, "Codex");
  assert.strictEqual(result.backendPersistence, "ephemeral");
});

test("Codex one-shot fails when app-server does not confirm ephemeral persistence", async function() {
  var calls = [];
  var server = fakeCodexServer(calls, false);
  var adapter = codexModule.createCodexAdapter({ cwd: "/workspace", createAppServer: function() { return server; } });
  await assert.rejects(yoke.completeOnce(adapter, { cwd: "/workspace", prompt: "one" }), /did not confirm an ephemeral/);
});
