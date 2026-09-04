export function workerProposalSelection(msg) {
  var hasSelection = typeof msg.selectedVendor === "string" ||
    typeof msg.selectedModel === "string" || typeof msg.selectedEffort === "string";
  return {
    selected: hasSelection,
    vendor: hasSelection ? (msg.selectedVendor || "") : (msg.recommendedVendor || ""),
    model: hasSelection ? (msg.selectedModel || "") : (msg.recommendedModel || ""),
    effort: hasSelection ? (msg.selectedEffort || "") : (msg.recommendedEffort || "medium"),
  };
}

export function syncWorkerProposalSelection(msg, sync) {
  var selection = workerProposalSelection(msg);
  if (selection.selected && typeof sync === "function") sync(selection);
  return selection;
}
