// Canonical single-turn completion lifecycle for YOKE adapters.

function assistantMessageText(event) {
  if (!event || event.yokeType !== "message" || event.messageRole !== "assistant") return "";
  if (!Array.isArray(event.content)) return "";
  var text = "";
  for (var i = 0; i < event.content.length; i++) {
    if (event.content[i] && event.content[i].type === "text" && event.content[i].text) {
      text += event.content[i].text;
    }
  }
  return text;
}

function normalizedText(streamedText, finalText) {
  if (!streamedText) return finalText;
  if (!finalText) return streamedText;
  if (finalText.indexOf(streamedText) === 0) return finalText;
  if (streamedText.indexOf(finalText) === 0) return streamedText;
  return streamedText;
}

function oneShotError(event) {
  if (!event) return null;
  if (event.yokeType === "error") return new Error(event.text || "One-shot completion failed.");
  if (event.yokeType === "auth_required") {
    return new Error("The " + (event.vendor || "selected") + " provider requires sign-in.");
  }
  return null;
}

async function createOneShot(adapter, queryOpts, allowUnknownPersistence) {
  if (typeof adapter.createOneShotQuery === "function") {
    var created = await adapter.createOneShotQuery(queryOpts);
    if (!created || !created.handle) throw new Error("YOKE adapter returned an invalid one-shot query.");
    if (created.backendPersistence !== "ephemeral") {
      if (!allowUnknownPersistence) {
        if (typeof created.handle.abort === "function") created.handle.abort();
        if (typeof created.handle.close === "function") created.handle.close();
        throw new Error("The " + adapter.vendor + " adapter did not confirm ephemeral one-shot execution.");
      }
      created.backendPersistence = "unknown";
    }
    return created;
  }
  if (!allowUnknownPersistence) {
    throw new Error("The " + adapter.vendor + " adapter does not guarantee ephemeral one-shot execution.");
  }
  return {
    handle: await adapter.createQuery(Object.assign({}, queryOpts, { persistSession: false })),
    backendPersistence: "unknown",
  };
}

async function completeOnce(adapter, opts) {
  opts = opts || {};
  if (!adapter || typeof adapter.createQuery !== "function") throw new Error("A YOKE adapter is required.");
  if (typeof opts.prompt !== "string" || !opts.prompt.trim()) throw new Error("A one-shot prompt is required.");

  var timeoutMs = opts.timeoutMs || 60000;
  var controller = new AbortController();
  var handle = null;
  var timedOut = false;
  var externallyAborted = false;
  var timer = null;
  var externalSignal = opts.signal || null;
  var abortHandle = function() {
    controller.abort();
    if (handle && typeof handle.abort === "function") handle.abort();
  };
  var onExternalAbort = function() {
    externallyAborted = true;
    abortHandle();
  };

  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  timer = setTimeout(function() {
    timedOut = true;
    abortHandle();
  }, timeoutMs);

  var streamedText = "";
  var finalText = "";
  var resultEvent = null;
  var created;
  try {
    var queryOpts = Object.assign({}, opts.query || {}, {
      cwd: opts.cwd,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      abortController: controller,
    });
    var creationFinished = false;
    var rejectCreation;
    var creationAbort = new Promise(function(resolve, reject) { rejectCreation = reject; });
    var onCreationAbort = function() { rejectCreation(new Error("One-shot completion aborted.")); };
    controller.signal.addEventListener("abort", onCreationAbort, { once: true });
    var creation = createOneShot(adapter, queryOpts, !!opts.allowUnknownBackendPersistence);
    creation.then(function(lateCreated) {
      if (!creationFinished && controller.signal.aborted && lateCreated && lateCreated.handle) {
        if (typeof lateCreated.handle.abort === "function") lateCreated.handle.abort();
        if (typeof lateCreated.handle.close === "function") lateCreated.handle.close();
      }
    }).catch(function() {});
    try {
      created = await Promise.race([creation, creationAbort]);
      creationFinished = true;
    } finally {
      controller.signal.removeEventListener("abort", onCreationAbort);
    }
    handle = created.handle;
    if (controller.signal.aborted) {
      if (typeof handle.abort === "function") handle.abort();
      throw new Error("One-shot completion aborted.");
    }
    if (handle.pushMessage(opts.prompt) !== true) {
      throw new Error("YOKE one-shot query rejected its prompt.");
    }
    handle.endInput();

    for await (var event of handle) {
      var eventError = oneShotError(event);
      if (eventError) throw eventError;
      if (event.yokeType === "text_delta" && event.text) streamedText += event.text;
      var messageText = assistantMessageText(event);
      if (messageText) finalText = messageText;
      if (event.yokeType === "result") {
        resultEvent = event;
        break;
      }
    }
    if (timedOut) throw new Error("YOKE one-shot timed out after " + timeoutMs + " ms.");
    if (externallyAborted) throw new Error("YOKE one-shot was aborted.");
    return {
      text: normalizedText(streamedText, finalText).trim(),
      backendPersistence: created.backendPersistence || "unknown",
      vendor: adapter.vendor,
      model: opts.model || null,
      result: resultEvent,
    };
  } catch (error) {
    if (timedOut) throw new Error("YOKE one-shot timed out after " + timeoutMs + " ms.");
    if (externallyAborted) throw new Error("YOKE one-shot was aborted.");
    throw error;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    if (handle && typeof handle.close === "function") handle.close();
  }
}

module.exports = {
  completeOnce: completeOnce,
  normalizedText: normalizedText,
};
