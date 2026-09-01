// Canonical safe declarative Capsule UI vocabulary and validation.

var advanced = require("./tool-ui-spec-advanced");

var UI_NODE_TYPES = [
  "stack", "row", "text", "heading", "list", "table", "card", "section", "callout", "icon",
  "input", "textarea", "select", "model-select", "checkbox", "button", "badge", "divider", "empty-state",
  "form", "tabs", "tab", "dialog", "menu", "menu-item", "pagination", "chart", "switch", "case",
];
var UI_ICONS = [
  "arrow-right", "book-open", "check", "circle-alert", "circle-check", "clock-3", "file-text",
  "history", "info", "languages", "lightbulb", "message-square", "notebook-pen", "plus", "sparkles",
  "trash-2", "triangle-alert", "wand-sparkles", "x", "chevron-left", "chevron-right", "chevron-down",
  "menu", "more-horizontal", "bar-chart-3", "line-chart", "pie-chart",
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
  list: { gap: ["none", "xs", "sm", "md", "lg"], variant: ["plain", "cards", "divided"], filter: "text", filterKey: "path", sortKey: "path", sortDirection: ["asc", "desc"], page: "number", pageSize: { integer: [1, 100] } },
  table: { columns: "columns", filter: "text", filterKey: "path", sortKey: "path", sortDirection: ["asc", "desc"], page: "number", pageSize: { integer: [1, 100] } },
  card: { variant: ["plain", "outlined", "raised", "callout", "output"], padding: ["none", "sm", "md", "lg"] },
  section: { label: "text", accessibleLabel: "text", variant: ["plain", "inset"], gap: ["xs", "sm", "md", "lg"] },
  callout: { title: "text", text: "text", icon: "icon", variant: ["soft", "outlined"] },
  icon: { icon: "icon", label: "text", decorative: "boolean" },
  input: { label: "text", hint: "text", placeholder: "text", error: "text", required: "bindingBoolean", disabled: "bindingBoolean", inputType: ["text", "search", "email", "url", "number", "range", "date", "time", "datetime-local", "tel"], validation: "validation" },
  textarea: { label: "text", hint: "text", placeholder: "text", error: "text", required: "bindingBoolean", disabled: "bindingBoolean", rows: { integer: [2, 16] }, validation: "validation" },
  select: { label: "text", hint: "text", error: "text", required: "bindingBoolean", disabled: "bindingBoolean", options: "options" },
  "model-select": { label: "text", hint: "text", required: "boolean", disabled: "bindingBoolean" },
  checkbox: { label: "text", hint: "text", error: "text", disabled: "bindingBoolean" },
  button: {
    label: "text", accessibleLabel: "text", variant: ["primary", "secondary", "ghost", "danger"],
    icon: "icon", iconPosition: ["start", "end"], disabled: "bindingBoolean", args: "args",
  },
  badge: { text: "text", icon: "icon" },
  divider: {},
  "empty-state": { title: "text", text: "text", icon: "icon" },
  form: { label: "text", submitLabel: "text" },
  tabs: { label: "text", options: "options" },
  tab: { label: "text", value: "scalar", disabled: "bindingBoolean" },
  dialog: { label: "text", description: "text", open: "bindingBoolean", closeAction: "action" },
  menu: { label: "text", triggerLabel: "text", options: "options" },
  "menu-item": { label: "text", disabled: "bindingBoolean", args: "args" },
  pagination: { label: "text", total: "number", pageSize: { integer: [1, 100] }, pageSizes: "numberOptions", pageAction: "action", pageSizeAction: "action" },
  chart: { label: "text", kind: ["bar", "line", "donut", "progress", "metric"], categoryKey: "path", valueKey: "path", max: "positiveNumber", maxItems: { integer: [1, 50] } },
  switch: {},
  case: { value: "scalar", default: "boolean" },
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
    if (!isPlainObject(option) || Object.keys(option).some(function (key) { return key !== "value" && key !== "label" && key !== "disabled"; })) {
      throw new Error(location + " options must be scalar values or {value,label,disabled?} objects.");
    }
    if ((typeof option.value !== "string" && typeof option.value !== "number") || typeof option.label !== "string") {
      throw new Error(location + " option value/label types are invalid.");
    }
    if (option.disabled !== undefined && typeof option.disabled !== "boolean") throw new Error(location + " option disabled must be boolean.");
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
  if (advanced.validateDynamic(value, rule, location, validateRule)) return;
  if (Array.isArray(rule)) {
    if (rule.indexOf(value) === -1) throw new Error(location + " must be one of: " + rule.join(", ") + ".");
  } else if (rule === "text") validateText(value, location);
  else if (rule === "boolean" && typeof value !== "boolean") throw new Error(location + " must be a boolean.");
  else if (rule === "bindingBoolean" && typeof value !== "boolean" && !isSafePath(value, true)) throw new Error(location + " must be a boolean or state binding.");
  else if (rule === "icon" && (typeof value !== "string" || UI_ICONS.indexOf(value) === -1)) throw new Error(location + " must be an allowed Lucide icon.");
  else if (rule === "options") validateOptions(value, location);
  else if (rule === "columns") validateColumns(value, location);
  else if (rule === "numberOptions") {
    if (!Array.isArray(value) || !value.length || value.length > 10 || value.some(function (entry) { return !Number.isInteger(entry) || entry < 1 || entry > 100; })) throw new Error(location + " must contain 1 to 10 page sizes from 1 to 100.");
  }
  else if (rule === "args") validateTemplateValue(value, location, 0);
  else if (rule === "validation") advanced.validateValidation(value, location);
  else if (rule === "scalar") {
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new Error(location + " must be a scalar value.");
  }
  else if (rule === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(location + " must be finite numeric data.");
  else if (rule === "positiveNumber" && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) throw new Error(location + " must be positive finite numeric data.");
  else if (rule === "action" && (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value))) throw new Error(location + " must be a safe action name.");
  else if (rule === "path" && !isSafePath(value, false)) throw new Error(location + " must be a safe state path.");
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
    if (["type", "id", "props", "children", "bind", "action", "when", "else"].indexOf(nodeKeys[nk]) === -1) throw new Error("Unknown UI node field '" + nodeKeys[nk] + "' at " + location + ".");
  }
  if (UI_NODE_TYPES.indexOf(node.type) === -1) throw new Error("Unknown UI node type '" + node.type + "' at " + location + ".");
  if (node.id !== undefined) {
    if (typeof node.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.id)) throw new Error("UI node ID at " + location + " must be a safe identifier.");
    if (context.ids[node.id]) throw new Error("Duplicate UI node ID '" + node.id + "'.");
    context.ids[node.id] = true;
  }
  if (node.bind !== undefined && !isSafePath(node.bind, false)) throw new Error("UI node bind at " + location + " must be a safe dot path.");
  if (node.when !== undefined) advanced.validateCondition(node.when, "UI node when at " + location);
  if (node.action !== undefined && (typeof node.action !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.action))) throw new Error("UI node action at " + location + " must be a safe action name.");
  validateProps(node, location);
  var props = node.props || {};
  if (["input", "textarea", "select", "model-select", "checkbox"].indexOf(node.type) !== -1 && (!node.bind || !node.action)) throw new Error("Interactive " + node.type + " at " + location + " requires bind and action.");
  if (["input", "textarea", "select", "model-select", "checkbox"].indexOf(node.type) !== -1 && !props.label && !node.id) throw new Error("Interactive " + node.type + " at " + location + " requires a label or ID.");
  if (node.type === "button" && !node.action) throw new Error("Button at " + location + " requires an action.");
  if (node.type === "button" && !props.label && !props.accessibleLabel) throw new Error("Button at " + location + " requires a label or accessibleLabel.");
  if (node.type === "menu-item" && (!node.action || !props.label)) throw new Error("Menu item at " + location + " requires an action and label.");
  if (node.type === "form" && !node.action) throw new Error("Form at " + location + " requires an action.");
  if (node.type === "tabs" && (!node.bind || !node.action || (!(props.options) && !(node.children || []).length))) throw new Error("Tabs at " + location + " requires bind, action, and tabs or options.");
  if (node.type === "tab" && props.value === undefined) throw new Error("Tab at " + location + " requires a value.");
  if (node.type === "pagination" && (!node.bind || !props.pageAction || props.total === undefined)) throw new Error("Pagination at " + location + " requires bind, total, and pageAction.");
  if (node.type === "chart") {
    if (!node.bind || !props.label || !props.kind || !props.valueKey) throw new Error("Chart at " + location + " requires bind, label, kind, and valueKey.");
    if (["bar", "line", "donut"].indexOf(props.kind) !== -1 && !props.categoryKey) throw new Error("Chart kind " + props.kind + " at " + location + " requires categoryKey.");
    if (props.kind === "progress" && props.max === undefined) throw new Error("Progress chart at " + location + " requires a positive max.");
  }
  if (node.type === "case" && props.value !== undefined && props.value !== null && typeof props.value === "object") throw new Error("Case at " + location + " requires a static scalar value.");
  if (node.type === "switch" && !node.bind) throw new Error("Switch at " + location + " requires a bind path.");
  if (node.type === "dialog" && (!props.label || props.open === undefined || !props.closeAction)) throw new Error("Dialog at " + location + " requires label, open, and closeAction.");
  if (node.type === "menu" && (!props.label || !props.triggerLabel || (!props.options && !(node.children || []).length) || (props.options && !node.action))) throw new Error("Menu at " + location + " requires label, triggerLabel, and menu items or options with an action.");
  if (node.type === "icon" && !props.icon) throw new Error("Icon at " + location + " requires an icon property.");
  if (node.type === "icon" && props.decorative !== true && !props.label) throw new Error("Non-decorative icon at " + location + " requires a label.");
  if (node.children !== undefined && !Array.isArray(node.children)) throw new Error("UI node children at " + location + " must be an array.");
  var children = node.children || [];
  if (node.type === "tabs" && children.some(function (child) { return child.type !== "tab"; })) throw new Error("Tabs at " + location + " may contain only tab nodes.");
  if (node.type === "menu" && children.some(function (child) { return child.type !== "menu-item"; })) throw new Error("Menu at " + location + " may contain only menu-item nodes.");
  if (node.type === "switch" && children.some(function (child) { return child.type !== "case"; })) throw new Error("Switch at " + location + " may contain only case nodes.");
  if (node.type === "switch") {
    var defaultCases = children.filter(function (child) { return child.props && child.props.default === true; }).length;
    if (defaultCases > 1) throw new Error("Switch at " + location + " has multiple default cases.");
  }
  if (children.length > MAX_CHILDREN) throw new Error("UI node at " + location + " has too many children.");
  for (var i = 0; i < children.length; i++) validateUiNode(children[i], location + ".children[" + i + "]", context, depth + 1);
  if (node.else !== undefined) validateUiNode(node.else, location + ".else", context, depth + 1);
  return true;
}

function hasNodeType(node, type) {
  if (!node || typeof node !== "object") return false;
  if (node.type === type) return true;
  var children = Array.isArray(node.children) ? node.children : [];
  for (var i = 0; i < children.length; i++) {
    if (hasNodeType(children[i], type)) return true;
  }
  if (node.else && hasNodeType(node.else, type)) return true;
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
  return "uiTree uses safe JSON nodes {type,id?,props?,children?,bind?,action?,when?,else?}. Types: " + UI_NODE_TYPES.join(", ") + ". Presentation is semantic only: tone neutral/accent/info/success/warning/danger, bounded size/emphasis/layout/card/button/text/list roles, and allowed Lucide icons. when conditionally renders a node and accepts a bounded AST: all/any/not/equals/notEquals/in/gt/gte/lt/lte; else is its validated fallback, and switch contains static case children. Dynamic safe props and options use {$bind:\"state.path\",fallback?:value}; dynamic enum props also require an allowed $enum subset, and no expression executes. Bounded integer props may bind dynamically and are clamped by the host. Forms provide bounded field validation and bound inline errors; inputs support text/search/email/url/number/range/date/time/datetime-local/tel. Tabs and menus accept static children or bounded dynamic options; dialogs use host accessibility and keyboard behavior. Lists/tables accept bounded filter/sort/page props, including capped dynamic columns; pagination emits named page and page-size actions. Charts are fixed host-rendered bar/line/donut/progress/metric views with at most 50 points; donut uses at most 12 segments, progress requires a declared positive max, and every chart includes textual data. model-select is only for worker Capsules with llm permission and exposes only fast/standard/deep capability aliases; vendor model IDs are rejected. Arbitrary class, style, HTML, JavaScript, authored SVG, event attributes, vendor model IDs, and unknown props are rejected. Runtime options and collections are defensively capped.";
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
