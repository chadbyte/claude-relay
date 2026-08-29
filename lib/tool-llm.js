var yoke = require("./yoke");

var MODEL_ALIASES = ["fast", "standard", "deep"];
var MODEL_HINTS = {
  claude: { fast: "haiku", standard: "sonnet", deep: "opus" },
  codex: { fast: "gpt-5.4-mini", standard: "gpt-5.6-terra", deep: "gpt-5.6-sol" },
  antigravity: { fast: "flash", standard: null, deep: "pro" },
};

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

function findModel(models, hint) {
  if (!hint || !models || models.length === 0) return hint || null;
  var lowered = String(hint).toLowerCase();
  for (var i = 0; i < models.length; i++) {
    if (String(models[i]).toLowerCase() === lowered) return models[i];
  }
  for (var j = 0; j < models.length; j++) {
    if (String(models[j]).toLowerCase().indexOf(lowered) !== -1) return models[j];
  }
  return null;
}

function resolveAliasModel(vendor, alias, models) {
  var hints = MODEL_HINTS[vendor] || {};
  var hinted = findModel(models, hints[alias]);
  if (hinted) return hinted;
  models = models || [];
  if (models.length === 0 || alias === "standard") return null;
  var fastWords = /mini|small|fast|flash|haiku|luna|lite/i;
  var deepWords = /opus|pro|max|deep|sol|large/i;
  var matcher = alias === "fast" ? fastWords : deepWords;
  for (var i = 0; i < models.length; i++) {
    if (matcher.test(String(models[i]))) return models[i];
  }
  return alias === "fast" ? models[models.length - 1] : models[0];
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
  var vendor = yoke.resolveDefaultVendor(adapters);
  var adapter = adapters[vendor];
  if (!adapter) throw new Error("No installed LLM vendor is available.");
  var models = [];
  try { models = await adapter.supportedModels(); } catch (e) {}
  var model = resolveAliasModel(vendor, args.model, models);
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, opts.timeoutMs || 60000);
  var handle;
  var state = { text: "", streamed: false };
  try {
    handle = await adapter.createQuery({
      cwd: opts.cwd,
      linuxUser: opts.linuxUser || undefined,
      systemPrompt: args.system || undefined,
      model: model || undefined,
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
  MODEL_HINTS: MODEL_HINTS,
  validateArgs: validateArgs,
  resolveAliasModel: resolveAliasModel,
  complete: complete,
};
