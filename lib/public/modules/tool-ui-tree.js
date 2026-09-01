// Pure helpers for inspecting declarative Capsule UI trees.

export function hasToolUiNodeType(node, type) {
  if (!node || typeof node !== "object") return false;
  if (node.type === type) return true;
  var children = Array.isArray(node.children) ? node.children : [];
  for (var i = 0; i < children.length; i++) {
    if (hasToolUiNodeType(children[i], type)) return true;
  }
  return false;
}

export function isToolModelAlias(value) {
  return value === "fast" || value === "standard" || value === "deep";
}

export function shouldInjectToolLlmStatus(definition) {
  var permissions = definition && definition.manifest && Array.isArray(definition.manifest.permissions)
    ? definition.manifest.permissions : [];
  return permissions.indexOf("llm") !== -1 && !hasToolUiNodeType(definition.uiTree, "model-select");
}
