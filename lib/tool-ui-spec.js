// Canonical safe declarative Capsule UI vocabulary and validation.

var UI_NODE_TYPES = [
  "stack", "row", "text", "heading", "list", "table", "card", "section", "callout", "icon",
  "input", "textarea", "select", "model-select", "checkbox", "button", "badge", "divider", "empty-state",
  "board", "board-card",
];
var UI_ICONS = [
  "arrow-right", "book-open", "check", "circle-alert", "circle-check", "clock-3", "file-text",
  "history", "info", "languages", "lightbulb", "message-square", "notebook-pen", "plus", "sparkles",
  "trash-2", "triangle-alert", "wand-sparkles", "x",
];
var MAX_DEPTH = 14;
var MAX_NODES = 300;
var MAX_CHILDREN = 80;

var COMMON = {
  tone: ["neutral", "accent", "info", "success", "warning", "danger"],
  size: ["xs", "sm", "md", "lg"],
  emphasis: ["subtle", "regular", "strong"],
};
var COMMON_TYPES = {
  tone: ["text", "heading", "card", "callout", "icon", "button", "badge", "empty-state"],
  size: ["text", "heading", "icon", "button", "badge", "input", "textarea", "select"],
  emphasis: ["text", "heading", "button", "badge"],
};
var PROPS = {
  stack: { gap: ["none", "xs", "sm", "md", "lg", "xl"], variant: ["plain", "inset"] },
  row: {
    gap: ["none", "xs", "sm", "md", "lg"], wrap: "boolean",
    align: ["start", "center", "end", "baseline", "stretch"],
    justify: ["start", "center", "end", "between"],
  },
  text: { text: "text", role: ["body", "muted", "caption", "strong", "output"] },
  heading: { text: "text", level: { integer: [1, 6] }, role: ["display", "section"] },
  list: { gap: ["none", "xs", "sm", "md", "lg"], variant: ["plain", "cards", "divided"] },
  table: { columns: "columns" },
  card: { variant: ["plain", "outlined", "raised", "callout", "output"], padding: ["none", "sm", "md", "lg"] },
  section: { label: "text", accessibleLabel: "text", variant: ["plain", "inset"], gap: ["xs", "sm", "md", "lg"] },
  callout: { title: "text", text: "text", icon: "icon", variant: ["soft", "outlined"] },
  icon: { icon: "icon", label: "text", decorative: "boolean" },
  input: { label: "text", hint: "text", placeholder: "text", required: "boolean", disabled: "bindingBoolean", inputType: ["text", "search", "email", "url"] },
  textarea: { label: "text", hint: "text", placeholder: "text", required: "boolean", disabled: "bindingBoolean", rows: { integer: [2, 16] } },
  select: { label: "text", hint: "text", required: "boolean", disabled: "bindingBoolean", options: "options" },
  "model-select": { label: "text", hint: "text", required: "boolean", disabled: "bindingBoolean" },
  checkbox: { label: "text", hint: "text", disabled: "bindingBoolean" },
  button: {
    label: "text", accessibleLabel: "text", variant: ["primary", "secondary", "ghost", "danger"],
    icon: "icon", iconPosition: ["start", "end"], disabled: "bindingBoolean", args: "args",
  },
  badge: { text: "text", icon: "icon" },
  divider: {},
  "empty-state": { title: "text", text: "text", icon: "icon" },
  board: {},
  "board-card": {},
};

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  var prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateText(value, location) {
  if (typeof value !== "string" || value.length > 2000) throw new Error(location + " must be text up to 2000 characters.");
}

function isSafePath(value, template) {
  var pattern = template ? /^\$(?:state|item)(?:\.[A-Za-z0-9_-]+)+$/ : /^(?:\$(?:state|item)\.)?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
  if (typeof value !== "string" || !pattern.test(value)) return false;
  var parts = value.replace(/^\$(?:state|item)\./, "").split(".");
  return !parts.some(function (part) { return part === "__proto__" || part === "constructor" || part === "prototype"; });
}

function validateTemplateValue(value, location, depth) {
  if (depth > 6) throw new Error(location + " is nested too deeply.");
  if (typeof value === "string" && value.charAt(0) === "$" && !isSafePath(value, true)) throw new Error(location + " contains an unsafe state path.");
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (value.length > 50) throw new Error(location + " has too many values.");
    for (var i = 0; i < value.length; i++) validateTemplateValue(value[i], location + "[" + i + "]", depth + 1);
    return;
  }
  if (!isPlainObject(value)) throw new Error(location + " must contain only safe JSON values.");
  var keys = Object.keys(value);
  if (keys.length > 50) throw new Error(location + " has too many fields.");
  for (var ki = 0; ki < keys.length; ki++) {
    if (keys[ki] === "__proto__" || keys[ki] === "constructor" || keys[ki] === "prototype") throw new Error(location + " contains an unsafe field.");
    validateTemplateValue(value[keys[ki]], location + "." + keys[ki], depth + 1);
  }
}

function validateOptions(value, location) {
  if (!Array.isArray(value) || value.length > 100) throw new Error(location + " must be an array of up to 100 options.");
  for (var i = 0; i < value.length; i++) {
    var option = value[i];
    if (typeof option === "string" || typeof option === "number") continue;
    if (!isPlainObject(option) || Object.keys(option).some(function (key) { return key !== "value" && key !== "label"; })) {
      throw new Error(location + " options must be scalar values or {value,label} objects.");
    }
    if ((typeof option.value !== "string" && typeof option.value !== "number") || typeof option.label !== "string") {
      throw new Error(location + " option value/label types are invalid.");
    }
  }
}

function validateColumns(value, location) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error(location + " must contain 1 to 20 columns.");
  for (var i = 0; i < value.length; i++) {
    var column = value[i];
    if (!isPlainObject(column) || !isSafePath(column.key, false) || (column.label !== undefined && typeof column.label !== "string")) {
      throw new Error(location + " columns require a string key and optional label.");
    }
    if (Object.keys(column).some(function (key) { return key !== "key" && key !== "label"; })) throw new Error(location + " contains an unknown column property.");
  }
}

function validateRule(value, rule, location) {
  if (Array.isArray(rule)) {
    if (rule.indexOf(value) === -1) throw new Error(location + " must be one of: " + rule.join(", ") + ".");
  } else if (rule === "text") validateText(value, location);
  else if (rule === "boolean" && typeof value !== "boolean") throw new Error(location + " must be a boolean.");
  else if (rule === "bindingBoolean" && typeof value !== "boolean" && !isSafePath(value, true)) throw new Error(location + " must be a boolean or state binding.");
  else if (rule === "icon" && (typeof value !== "string" || UI_ICONS.indexOf(value) === -1)) throw new Error(location + " must be an allowed Lucide icon.");
  else if (rule === "options") validateOptions(value, location);
  else if (rule === "columns") validateColumns(value, location);
  else if (rule === "args") validateTemplateValue(value, location, 0);
  else if (rule && rule.integer && (!Number.isInteger(value) || value < rule.integer[0] || value > rule.integer[1])) throw new Error(location + " must be an integer from " + rule.integer[0] + " to " + rule.integer[1] + ".");
}

function validateProps(node, location) {
  var props = node.props || {};
  if (!isPlainObject(props)) throw new Error("UI node props at " + location + " must be an object.");
  var rules = Object.assign({}, PROPS[node.type]);
  var commonKeys = Object.keys(COMMON_TYPES);
  for (var ci = 0; ci < commonKeys.length; ci++) {
    if (COMMON_TYPES[commonKeys[ci]].indexOf(node.type) !== -1) rules[commonKeys[ci]] = COMMON[commonKeys[ci]];
  }
  var keys = Object.keys(props);
  for (var i = 0; i < keys.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(rules, keys[i])) throw new Error("Unknown UI property '" + keys[i] + "' at " + location + ".");
    validateRule(props[keys[i]], rules[keys[i]], location + ".props." + keys[i]);
  }
}

function validateUiNode(node, location, context, depth) {
  location = location || "root";
  context = context || { count: 0, ids: Object.create(null) };
  depth = depth || 0;
  if (!isPlainObject(node)) throw new Error("UI node at " + location + " must be an object.");
  context.count++;
  if (context.count > MAX_NODES) throw new Error("UI tree exceeds " + MAX_NODES + " nodes.");
  if (depth > MAX_DEPTH) throw new Error("UI tree exceeds depth " + MAX_DEPTH + ".");
  var nodeKeys = Object.keys(node);
  for (var nk = 0; nk < nodeKeys.length; nk++) {
    if (["type", "id", "props", "children", "bind", "action", "when"].indexOf(nodeKeys[nk]) === -1) throw new Error("Unknown UI node field '" + nodeKeys[nk] + "' at " + location + ".");
  }
  if (UI_NODE_TYPES.indexOf(node.type) === -1) throw new Error("Unknown UI node type '" + node.type + "' at " + location + ".");
  if (node.id !== undefined) {
    if (typeof node.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.id)) throw new Error("UI node ID at " + location + " must be a safe identifier.");
    if (context.ids[node.id]) throw new Error("Duplicate UI node ID '" + node.id + "'.");
    context.ids[node.id] = true;
  }
  if (node.bind !== undefined && !isSafePath(node.bind, false)) throw new Error("UI node bind at " + location + " must be a safe dot path.");
  if (node.when !== undefined && !isSafePath(node.when, false)) throw new Error("UI node when at " + location + " must be a safe state path.");
  if (node.action !== undefined && (typeof node.action !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.action))) throw new Error("UI node action at " + location + " must be a safe action name.");
  validateProps(node, location);
  var props = node.props || {};
  if (["input", "textarea", "select", "model-select", "checkbox"].indexOf(node.type) !== -1 && (!node.bind || !node.action)) throw new Error("Interactive " + node.type + " at " + location + " requires bind and action.");
  if (["input", "textarea", "select", "model-select", "checkbox"].indexOf(node.type) !== -1 && !props.label && !node.id) throw new Error("Interactive " + node.type + " at " + location + " requires a label or ID.");
  if (node.type === "button" && !node.action) throw new Error("Button at " + location + " requires an action.");
  if (node.type === "button" && !props.label && !props.accessibleLabel) throw new Error("Button at " + location + " requires a label or accessibleLabel.");
  if (node.type === "icon" && !props.icon) throw new Error("Icon at " + location + " requires an icon property.");
  if (node.type === "icon" && props.decorative !== true && !props.label) throw new Error("Non-decorative icon at " + location + " requires a label.");
  if (node.children !== undefined && !Array.isArray(node.children)) throw new Error("UI node children at " + location + " must be an array.");
  var children = node.children || [];
  if (children.length > MAX_CHILDREN) throw new Error("UI node at " + location + " has too many children.");
  for (var i = 0; i < children.length; i++) validateUiNode(children[i], location + ".children[" + i + "]", context, depth + 1);
  return true;
}

function hasNodeType(node, type) {
  if (!node || typeof node !== "object") return false;
  if (node.type === type) return true;
  var children = Array.isArray(node.children) ? node.children : [];
  for (var i = 0; i < children.length; i++) {
    if (hasNodeType(children[i], type)) return true;
  }
  return false;
}

function validateUiTreeForManifest(uiTree, manifest) {
  validateUiNode(uiTree);
  if (!hasNodeType(uiTree, "model-select")) return true;
  var runtime = manifest && manifest.runtime ? manifest.runtime : "worker";
  if (runtime !== "worker") throw new Error("model-select is available only to worker Capsules.");
  var permissions = manifest && Array.isArray(manifest.permissions) ? manifest.permissions : [];
  if (permissions.indexOf("llm") === -1) throw new Error("model-select requires the Capsule manifest llm permission.");
  return true;
}

function authoringDescription() {
  return "uiTree uses safe JSON nodes {type,id?,props?,children?,bind?,action?,when?}. Types: " + UI_NODE_TYPES.join(", ") + ". Presentation is semantic only: tone neutral/accent/info/success/warning/danger; size/emphasis; stack gap/variant; row gap/wrap/align/justify; card variant/tone/padding; button primary/secondary/ghost/danger with an allowed Lucide icon; text role body/muted/caption/strong/output; heading display/section; list plain/cards/divided; field label/hint/required/rows; section, callout, icon, and empty-state composition. model-select is only for worker Capsules with manifest permissions including llm; it requires bind/action, exposes only fast/standard/deep capability aliases, and accepts label/hint/required/disabled rather than authored options. Arbitrary class, style, HTML, event attributes, vendor model IDs, and unknown props are rejected. bind reads a safe state or $item dot path for control values and rendered text/list/table data. when conditionally renders a node when its safe state or $item path is truthy. Interactive controls require an action; list templates may use $item.field in bind, when, and props.args.";
}

module.exports = {
  UI_NODE_TYPES: UI_NODE_TYPES,
  UI_ICONS: UI_ICONS,
  MAX_DEPTH: MAX_DEPTH,
  MAX_NODES: MAX_NODES,
  validateUiNode: validateUiNode,
  validateUiTreeForManifest: validateUiTreeForManifest,
  authoringDescription: authoringDescription,
};
