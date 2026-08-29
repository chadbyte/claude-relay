var yoke = require("./yoke");

function modelEntryValue(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return entry.value || entry.id || "";
}

function modelEntryMatches(entry, value) {
  if (!entry || !value) return false;
  if (typeof entry === "string") return entry === value;
  return entry.value === value || entry.id === value || entry.resolvedModel === value;
}

function attachModels(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var sm = ctx.sm;
  var sdk = ctx.sdk;
  var adapters = ctx.adapters;
  var sendTo = ctx.sendTo;
  var getSessionForWs = ctx.getSessionForWs;
  var getLinuxUserForWs = ctx.getLinuxUserForWs;
  var serverPort = ctx.serverPort;
  var serverTls = ctx.serverTls;
  var serverAuthToken = ctx.serverAuthToken;

  async function loadVendorModels(ws, msg) {
    var vendor = msg.vendor || "";
    var requestId = msg.requestId || null;
    var loadError = null;
    var vendorAdapter = null;
    var session = getSessionForWs(ws);

    if (!vendor) {
      sendTo(ws, {
        type: "model_info",
        vendor: vendor,
        requestId: requestId,
        modelStatus: "error",
        error: "No vendor was selected.",
        model: "",
        models: [],
        sessionId: session ? session.localId : null,
      });
      return;
    }

    try {
      var modelLinuxUser = getLinuxUserForWs(ws);
      vendorAdapter = adapters[vendor] || null;
      if (!vendorAdapter) {
        vendorAdapter = await yoke.lazyCreateAdapter(adapters, vendor, {
          cwd: cwd,
          linuxUser: modelLinuxUser || undefined,
          clayPort: serverPort,
          clayTls: serverTls,
          clayAuthToken: serverAuthToken,
          slug: slug,
        });
      }

      var cachedModels = (sm.modelsByVendor && sm.modelsByVendor[vendor]) || [];
      var cachedCapabilities = sm.capabilitiesByVendor && sm.capabilitiesByVendor[vendor];
      var needsReadyMetadata = !cachedCapabilities || cachedModels.length === 0;
      if (vendorAdapter && needsReadyMetadata && typeof vendorAdapter.init === "function") {
        try {
          var readyResult = await vendorAdapter.init({
            cwd: cwd,
            linuxUser: modelLinuxUser || undefined,
            clayPort: serverPort,
            clayTls: serverTls,
            clayAuthToken: serverAuthToken,
            slug: slug,
          });
          sm.capabilitiesByVendor = sm.capabilitiesByVendor || {};
          sm.capabilitiesByVendor[vendor] = readyResult.capabilities || {};
          sm.modelsByVendor = sm.modelsByVendor || {};
          if (Array.isArray(readyResult.models) && readyResult.models.length > 0) {
            sm.modelsByVendor[vendor] = readyResult.models;
          }
        } catch (e) {
          loadError = e;
          console.error("[project-models] " + vendor + " init failed:", e.message || e);
        }
      }

      if (vendorAdapter) {
        sm.availableVendors = Object.keys(adapters);
        sm.modelsByVendor = sm.modelsByVendor || {};
        var currentModels = sm.modelsByVendor[vendor] || [];
        if (currentModels.length === 0 && typeof vendorAdapter.supportedModels === "function") {
          try {
            var supported = await vendorAdapter.supportedModels();
            if (Array.isArray(supported) && supported.length > 0) {
              sm.modelsByVendor[vendor] = supported;
              loadError = null;
            }
          } catch (e) {
            if (!loadError) loadError = e;
            console.error("[project-models] " + vendor + " model listing failed:", e.message || e);
          }
        }
      } else {
        loadError = new Error("The vendor adapter is unavailable.");
      }
    } catch (e) {
      loadError = e;
      console.error("[project-models] model loading failed for " + vendor + ":", e.message || e);
    }

    var vendorModels = (sm.modelsByVendor && sm.modelsByVendor[vendor]) || [];
    var modelToSend = modelEntryValue(vendorModels[0]);
    var preferredModel = (session && session.vendor === vendor && session.model) || (sm.defaultModelByVendor && sm.defaultModelByVendor[vendor]) || "";
    if (preferredModel) {
      for (var i = 0; i < vendorModels.length; i++) {
        if (modelEntryMatches(vendorModels[i], preferredModel)) {
          modelToSend = modelEntryValue(vendorModels[i]);
          break;
        }
      }
    }
    var vendorInfo = yoke.getVendorInfo(vendor);
    var displayName = vendorInfo ? vendorInfo.displayName : vendor;
    var status = vendorModels.length > 0 ? "ready" : (loadError ? "error" : "empty");
    var errorText = "";
    if (status === "error") {
      errorText = "Could not load " + displayName + " models: " + (loadError.message || loadError);
    } else if (status === "empty") {
      errorText = displayName + " returned no models. Check CLI authentication and retry.";
    }
    sendTo(ws, {
      type: "model_info",
      model: modelToSend,
      models: vendorModels,
      vendor: vendor,
      sessionId: session ? session.localId : null,
      capabilities: (sm.capabilitiesByVendor && sm.capabilitiesByVendor[vendor]) || {},
      availableVendors: sm.availableVendors || [],
      installedVendors: sm.installedVendors || [],
      requestId: requestId,
      modelStatus: status,
      error: errorText,
    });
  }

  async function selectModel(ws, msg) {
    var session = getSessionForWs(ws);
    if (!session) {
      sendTo(ws, { type: "model_selection_result", requestId: msg.requestId || null, ok: false, error: "No active session." });
      return;
    }
    var sessionVendor = session.vendor || sm.defaultVendor || "claude";
    if (msg.vendor && msg.vendor !== sessionVendor) {
      sendTo(ws, {
        type: "model_selection_result",
        requestId: msg.requestId || null,
        ok: false,
        error: "The session vendor changed before the model selection completed.",
      });
      return;
    }
    var knownModels = (sm.modelsByVendor && sm.modelsByVendor[sessionVendor]) || [];
    if (knownModels.length > 0) {
      var known = false;
      for (var i = 0; i < knownModels.length; i++) {
        if (modelEntryMatches(knownModels[i], msg.model)) {
          known = true;
          break;
        }
      }
      if (!known) {
        sendTo(ws, {
          type: "model_selection_result",
          requestId: msg.requestId || null,
          ok: false,
          error: "That model is not available for the selected vendor.",
        });
        return;
      }
    }
    var result = await sdk.setModel(session, msg.model);
    sendTo(ws, {
      type: "model_selection_result",
      requestId: msg.requestId || null,
      ok: !!(result && result.ok),
      model: result && result.model ? result.model : msg.model,
      vendor: sessionVendor,
      error: result && result.error ? result.error : "",
    });
  }

  function handleMessage(ws, msg) {
    if (msg.type === "get_vendor_models") {
      loadVendorModels(ws, msg).catch(function(e) {
        console.error("[project-models] Unexpected model loading failure:", e.message || e);
      });
      return true;
    }
    if (msg.type === "set_model" && msg.model) {
      selectModel(ws, msg).catch(function(e) {
        sendTo(ws, { type: "model_selection_result", requestId: msg.requestId || null, ok: false, error: e.message || String(e) });
      });
      return true;
    }
    return false;
  }

  return {
    handleMessage: handleMessage,
    loadVendorModels: loadVendorModels,
    selectModel: selectModel,
  };
}

module.exports = {
  attachModels: attachModels,
  modelEntryMatches: modelEntryMatches,
  modelEntryValue: modelEntryValue,
};
