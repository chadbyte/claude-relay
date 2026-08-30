var MODEL_ALIASES = ["fast", "standard", "deep"];

function validateArgs(args) {
  args = args || {};
  if (typeof args.prompt !== "string" || !args.prompt.trim()) throw new Error("LLM prompt is required.");
  if (args.system !== undefined && typeof args.system !== "string") throw new Error("LLM system prompt must be a string.");
  var alias = args.model || "fast";
  if (MODEL_ALIASES.indexOf(alias) === -1) {
    throw new Error("LLM model must be a capability alias: fast, standard, or deep. Vendor model names are not allowed.");
  }
  return { system: args.system || "", prompt: args.prompt, model: alias };
}

function appendAssistantText(event, state) {
  if (event.yokeType === "text_delta" && event.text) {
    state.streamed = true;
    state.text += event.text;
    return;
  }
  if (event.yokeType !== "message" || event.messageRole !== "assistant" || state.streamed || !Array.isArray(event.content)) return;
  for (var i = 0; i < event.content.length; i++) {
    if (event.content[i].type === "text" && event.content[i].text) state.text += event.content[i].text;
  }
}

async function complete(opts) {
  var args = validateArgs(opts.args);
  var adapters = opts.adapters || {};
  var selection = opts.selection || {};
  var vendor = selection.vendor;
  var model = selection.model;
  if (!vendor || !model || typeof model !== "string") {
    throw new Error(selection.error || "No configured model is available. Configure a provider and retry.");
  }
  var adapter = adapters[vendor];
  if (!adapter) throw new Error("The configured " + vendor + " model provider is unavailable.");
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, opts.timeoutMs || 60000);
  var handle;
  var state = { text: "", streamed: false };
  try {
    handle = await adapter.createQuery({
      cwd: opts.cwd,
      linuxUser: opts.linuxUser || undefined,
      systemPrompt: args.system || undefined,
      model: model,
      persistSession: false,
      skipProjectInstructions: true,
      skipSkills: true,
      abortController: controller,
      canUseTool: function () { return Promise.resolve({ behavior: "deny", message: "Capsule LLM calls cannot use tools." }); },
      adapterOptions: { CLAUDE: { linuxUser: opts.linuxUser || undefined, settingSources: ["user"] } },
    });
    handle.pushMessage(args.prompt);
    for await (var event of handle) {
      appendAssistantText(event, state);
      if (event.yokeType === "result") break;
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error("LLM request timed out after 60 seconds.");
    throw error;
  } finally {
    clearTimeout(timer);
    if (handle) handle.close();
  }
  return state.text.trim();
}

module.exports = {
  MODEL_ALIASES: MODEL_ALIASES,
  validateArgs: validateArgs,
  complete: complete,
};
