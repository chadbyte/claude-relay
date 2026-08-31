// tool-renderer.js - Host-rendered declarative tool UI vocabulary.

import { renderBoardNode, renderBoardCardNode } from './home-board.js';
import { bindToolTextInput, isToolTextInputComposing } from './tool-input-composition.js';
import { refreshIcons } from './icons.js';
import { semanticClasses, appendToolIcon } from './tool-renderer-semantics.js';
import { TOOL_LLM_ALIASES, getToolLlmConfiguration, requestAllToolLlmConfigurations, requestToolLlmConfiguration, subscribeToolLlmConfigurations } from './tool-llm-status.js';

var catalogs = Object.create(null);
var deferredRenders = new WeakMap();
var renderDisposers = new WeakMap();
var modelConfigurationRequested = new WeakSet();

function valueAtPath(state, path, item) {
  if (!path) return undefined;
  var source = state;
  var parts = path.split(".");
  if (parts[0] === "$item") {
    source = item;
    parts.shift();
  } else if (parts[0] === "$state") {
    parts.shift();
  }
  for (var i = 0; i < parts.length; i++) {
    if (source === null || source === undefined) return undefined;
    source = source[parts[i]];
  }
  return source;
}

function resolveTemplate(value, state, item) {
  if (typeof value === "string" && (value.indexOf("$item") === 0 || value.indexOf("$state") === 0)) {
    return valueAtPath(state, value, item);
  }
  if (Array.isArray(value)) {
    return value.map(function (entry) { return resolveTemplate(entry, state, item); });
  }
  if (value && typeof value === "object") {
    var result = {};
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) result[keys[i]] = resolveTemplate(value[keys[i]], state, item);
    return result;
  }
  return value;
}

function appendChildren(element, node, context) {
  var children = node.children || [];
  for (var i = 0; i < children.length; i++) {
    var child = renderNode(children[i], context);
    if (child) element.appendChild(child);
  }
}

function registerControl(node, props, context) {
  if (!node.id) return;
  context.catalog[node.id] = {
    type: node.type,
    label: props.label || props.text || node.id,
    bind: node.bind || null,
    action: node.action || null,
  };
}

function emitNodeAction(node, props, context, extra) {
  if (!node.action) return;
  var args = resolveTemplate(props.args || {}, context.state, context.item);
  var keys = Object.keys(extra || {});
  for (var i = 0; i < keys.length; i++) args[keys[i]] = extra[keys[i]];
  if (node.id) args.controlId = node.id;
  if (node.bind) args.bind = node.bind;
  context.emit(node.action, args);
}

function resolvedBoolean(value, context) {
  if (typeof value === "string") return !!resolveTemplate(value, context.state, context.item);
  return value === true;
}

function appendFieldHeading(wrapper, node, props, control, context) {
  if (props.label) {
    var label = document.createElement("span");
    label.className = "tool-field-label";
    label.textContent = String(props.label);
    wrapper.appendChild(label);
  } else if (node.id) control.setAttribute("aria-label", node.id);
  if (props.required) {
    control.required = true;
    control.setAttribute("aria-required", "true");
  }
  control.disabled = resolvedBoolean(props.disabled, context);
  if (props.hint) {
    var hint = document.createElement("span");
    hint.className = "tool-field-hint";
    hint.textContent = String(props.hint);
    var hintId = "tool-hint-" + context.toolId + "-" + context.hintIndex++;
    hint.id = hintId;
    control.setAttribute("aria-describedby", hintId);
    wrapper.appendChild(control);
    wrapper.appendChild(hint);
    return true;
  }
  return false;
}

function renderInput(node, props, context) {
  var wrapper = document.createElement("label");
  wrapper.className = semanticClasses("tool-field", props);
  var input = document.createElement(node.type === "textarea" ? "textarea" : "input");
  input.className = "tool-input";
  if (node.type === "input") input.type = props.inputType || "text";
  if (node.type === "textarea" && props.rows) input.rows = props.rows;
  if (props.placeholder) input.placeholder = String(props.placeholder);
  var value = valueAtPath(context.state, node.bind, context.item);
  input.value = value === undefined || value === null ? "" : String(value);
  if (node.id) input.dataset.toolControlId = node.id;
  bindToolTextInput(input, function (value) { emitNodeAction(node, props, context, { value: value }); }, {
    isAlive: function (boundInput) { return context.container.contains(boundInput); },
    onCompositionEnd: function (settledInput) {
      var pending = deferredRenders.get(context.container);
      deferredRenders.delete(context.container);
      if (!pending || !context.container.contains(settledInput) || node.action) return;
      renderToolUiNow(pending.toolId, pending.uiTree, pending.state, pending.emit, pending.container);
    },
  });
  if (!appendFieldHeading(wrapper, node, props, input, context)) wrapper.appendChild(input);
  registerControl(node, props, context);
  return wrapper;
}

function renderSelect(node, props, context) {
  var wrapper = document.createElement("label");
  wrapper.className = semanticClasses("tool-field", props);
  var select = document.createElement("select");
  select.className = "tool-select";
  if (node.id) select.dataset.toolControlId = node.id;
  var options = props.options || [];
  for (var i = 0; i < options.length; i++) {
    var option = document.createElement("option");
    var optionValue = typeof options[i] === "object" ? options[i].value : options[i];
    var optionLabel = typeof options[i] === "object" ? options[i].label : options[i];
    option.value = String(optionValue);
    option.textContent = String(optionLabel);
    select.appendChild(option);
  }
  var value = valueAtPath(context.state, node.bind, context.item);
  if (value !== undefined && value !== null) select.value = String(value);
  select.addEventListener("change", function () { emitNodeAction(node, props, context, { value: select.value }); });
  if (!appendFieldHeading(wrapper, node, props, select, context)) wrapper.appendChild(select);
  registerControl(node, props, context);
  return wrapper;
}

function modelAliasLabel(alias) {
  return alias.charAt(0).toUpperCase() + alias.slice(1);
}

function modelOptionLabel(alias, state) {
  var prefix = modelAliasLabel(alias);
  if (state.status === "ready" && state.vendorName && state.modelName) return prefix + " · " + state.vendorName + " · " + state.modelName;
  if (state.status === "error") return prefix + " · Unavailable";
  return prefix + " · Checking model…";
}

function renderModelSelect(node, props, context) {
  var wrapper = document.createElement("div");
  wrapper.className = "tool-model-select";
  var field = document.createElement("label");
  field.className = semanticClasses("tool-field", props);
  var select = document.createElement("select");
  select.className = "tool-select tool-model-select-control";
  if (node.id) select.dataset.toolControlId = node.id;
  var options = Object.create(null);
  for (var i = 0; i < TOOL_LLM_ALIASES.length; i++) {
    var alias = TOOL_LLM_ALIASES[i];
    var option = document.createElement("option");
    option.value = alias;
    option.textContent = modelOptionLabel(alias, getToolLlmConfiguration(alias));
    options[alias] = option;
    select.appendChild(option);
  }
  var value = valueAtPath(context.state, node.bind, context.item);
  select.value = TOOL_LLM_ALIASES.indexOf(value) !== -1 ? value : "fast";
  select.addEventListener("change", function () {
    emitNodeAction(node, props, context, { value: select.value });
    updateAlias(select.value, getToolLlmConfiguration(select.value));
  });
  if (!appendFieldHeading(field, node, props, select, context)) field.appendChild(select);
  wrapper.appendChild(field);
  var feedback = document.createElement("span");
  feedback.className = "tool-model-select-feedback hidden";
  feedback.setAttribute("aria-live", "polite");
  var retry = document.createElement("button");
  retry.type = "button";
  retry.className = "tool-model-select-retry hidden";
  retry.textContent = "Retry";
  retry.addEventListener("click", function () { requestToolLlmConfiguration(select.value); });
  wrapper.appendChild(feedback);
  wrapper.appendChild(retry);
  function updateAlias(changedAlias, state) {
    if (options[changedAlias]) options[changedAlias].textContent = modelOptionLabel(changedAlias, state);
    var selectedState = getToolLlmConfiguration(select.value);
    var failed = selectedState.status === "error";
    feedback.textContent = failed ? selectedState.error || "This model is unavailable." : "";
    feedback.classList.toggle("hidden", !failed);
    retry.classList.toggle("hidden", !failed);
  }
  var unsubscribe = subscribeToolLlmConfigurations(updateAlias);
  context.disposers.push(unsubscribe);
  if (!modelConfigurationRequested.has(context.container)) {
    modelConfigurationRequested.add(context.container);
    requestAllToolLlmConfigurations();
  }
  registerControl(node, props, context);
  return wrapper;
}

function renderCheckbox(node, props, context) {
  var wrapper = document.createElement("label");
  wrapper.className = semanticClasses("tool-checkbox-field", props);
  var input = document.createElement("input");
  input.type = "checkbox";
  input.className = "tool-checkbox";
  input.checked = !!valueAtPath(context.state, node.bind, context.item);
  input.disabled = resolvedBoolean(props.disabled, context);
  if (node.id) input.dataset.toolControlId = node.id;
  input.addEventListener("change", function () { emitNodeAction(node, props, context, { value: input.checked }); });
  wrapper.appendChild(input);
  var copy = document.createElement("span");
  copy.className = "tool-checkbox-copy";
  var label = document.createElement("span");
  label.className = "tool-field-label";
  label.textContent = String(props.label || node.id || "Option");
  copy.appendChild(label);
  if (props.hint) {
    var hint = document.createElement("span");
    hint.className = "tool-field-hint";
    hint.textContent = String(props.hint);
    var hintId = "tool-hint-" + context.toolId + "-" + context.hintIndex++;
    hint.id = hintId;
    input.setAttribute("aria-describedby", hintId);
    copy.appendChild(hint);
  }
  wrapper.appendChild(copy);
  registerControl(node, props, context);
  return wrapper;
}

function renderTable(node, props, context) {
  var table = document.createElement("table");
  table.className = "tool-table";
  var columns = props.columns || [];
  var head = document.createElement("thead");
  var headRow = document.createElement("tr");
  for (var i = 0; i < columns.length; i++) {
    var th = document.createElement("th");
    th.textContent = String(columns[i].label || columns[i].key || "");
    headRow.appendChild(th);
  }
  head.appendChild(headRow);
  table.appendChild(head);
  var body = document.createElement("tbody");
  var rows = valueAtPath(context.state, node.bind, context.item) || [];
  for (var ri = 0; ri < rows.length; ri++) {
    var tr = document.createElement("tr");
    for (var ci = 0; ci < columns.length; ci++) {
      var td = document.createElement("td");
      var cell = valueAtPath(rows[ri], columns[ci].key, null);
      td.textContent = cell === undefined || cell === null ? "" : String(cell);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  return table;
}

function renderNode(node, context) {
  if (node.when && !valueAtPath(context.state, node.when, context.item)) return null;
  var props = node.props || {};
  var element;
  var value;
  if (node.type === "board") {
    registerControl(node, props, context);
    return renderBoardNode(node, context.state);
  }
  if (node.type === "board-card") {
    registerControl(node, props, context);
    return renderBoardCardNode(node, context.state, context.item);
  }
  if (node.type === "input" || node.type === "textarea") return renderInput(node, props, context);
  if (node.type === "select") return renderSelect(node, props, context);
  if (node.type === "model-select") return renderModelSelect(node, props, context);
  if (node.type === "checkbox") return renderCheckbox(node, props, context);
  if (node.type === "table") return renderTable(node, props, context);
  if (node.type === "divider") {
    element = document.createElement("hr");
    element.className = "tool-divider";
    return element;
  }
  if (node.type === "empty-state") {
    value = valueAtPath(context.state, node.bind, context.item);
    if (Array.isArray(value) && value.length > 0) return null;
    element = document.createElement("div");
    element.className = semanticClasses("tool-empty-state", props);
    appendToolIcon(element, props.icon, null);
    if (props.title) {
      var emptyTitle = document.createElement("strong");
      emptyTitle.className = "tool-empty-state-title";
      emptyTitle.textContent = String(props.title);
      element.appendChild(emptyTitle);
    }
    var emptyText = document.createElement("span");
    emptyText.textContent = String(props.text || "Nothing here yet.");
    element.appendChild(emptyText);
    return element;
  }
  if (node.type === "list") {
    element = document.createElement("ul");
    element.className = semanticClasses("tool-list", props);
    var items = valueAtPath(context.state, node.bind, context.item) || [];
    for (var li = 0; li < items.length; li++) {
      var listItem = document.createElement("li");
      var itemContext = Object.assign({}, context, { item: items[li] });
      if ((node.children || []).length) appendChildren(listItem, node, itemContext);
      else listItem.textContent = String(items[li]);
      element.appendChild(listItem);
    }
    return element;
  }
  if (node.type === "heading") {
    var level = Math.max(1, Math.min(6, Number(props.level) || 2));
    element = document.createElement("h" + level);
    element.className = semanticClasses("tool-heading", props);
  } else if (node.type === "text") {
    element = document.createElement("span");
    element.className = semanticClasses("tool-text", props);
  } else if (node.type === "badge") {
    element = document.createElement("span");
    element.className = semanticClasses("tool-badge", props);
  } else if (node.type === "button") {
    element = document.createElement("button");
    element.type = "button";
    element.className = semanticClasses("tool-button", props);
    element.disabled = resolvedBoolean(props.disabled, context);
    if (props.accessibleLabel) element.setAttribute("aria-label", String(props.accessibleLabel));
    element.addEventListener("click", function () { emitNodeAction(node, props, context, {}); });
    registerControl(node, props, context);
  } else if (node.type === "icon") {
    element = document.createElement("span");
    element.className = semanticClasses("tool-icon-node", props);
    appendToolIcon(element, props.icon, props.decorative ? null : props.label);
  } else if (node.type === "callout") {
    element = document.createElement("aside");
    element.className = semanticClasses("tool-callout", props);
    appendToolIcon(element, props.icon, null);
    var calloutCopy = document.createElement("span");
    calloutCopy.className = "tool-callout-copy";
    if (props.title) {
      var calloutTitle = document.createElement("strong");
      calloutTitle.textContent = String(props.title);
      calloutCopy.appendChild(calloutTitle);
    }
    if (props.text) {
      var calloutText = document.createElement("span");
      calloutText.textContent = String(props.text);
      calloutCopy.appendChild(calloutText);
    }
    element.appendChild(calloutCopy);
  } else {
    element = document.createElement(node.type === "section" ? "section" : "div");
    var base = node.type === "row" ? "tool-row" : node.type === "card" ? "tool-card" : node.type === "section" ? "tool-section" : "tool-stack";
    element.className = semanticClasses(base, props);
    if (node.type === "section" && props.accessibleLabel) element.setAttribute("aria-label", String(props.accessibleLabel));
    if (node.type === "section" && props.label) {
      var sectionLabel = document.createElement("span");
      sectionLabel.className = "tool-section-label";
      sectionLabel.textContent = String(props.label);
      element.appendChild(sectionLabel);
    }
  }
  if (node.id) element.dataset.toolControlId = node.id;
  value = node.bind ? valueAtPath(context.state, node.bind, context.item) : props.text || props.label;
  if (node.type === "button") {
    if (props.icon && props.iconPosition !== "end") appendToolIcon(element, props.icon, null);
    var buttonLabel = document.createElement("span");
    buttonLabel.textContent = String(props.label || props.accessibleLabel || "Action");
    element.appendChild(buttonLabel);
    if (props.icon && props.iconPosition === "end") appendToolIcon(element, props.icon, null);
  } else if (node.type === "badge") {
    appendToolIcon(element, props.icon, null);
    var badgeText = document.createElement("span");
    badgeText.textContent = String(value === undefined || value === null ? "" : value);
    element.appendChild(badgeText);
  } else if (value !== undefined && value !== null && node.type !== "icon" && node.type !== "callout" && node.type !== "section") {
    element.textContent = String(value);
  }
  appendChildren(element, node, context);
  return element;
}

function renderToolUiNow(toolId, uiTree, state, emit, container) {
  var active = document.activeElement;
  var activeControlId = active && container.contains(active) ? active.dataset.toolControlId : null;
  var selectionStart = activeControlId && typeof active.selectionStart === "number" ? active.selectionStart : null;
  var selectionEnd = activeControlId && typeof active.selectionEnd === "number" ? active.selectionEnd : null;
  var catalog = Object.create(null);
  var previousDisposers = renderDisposers.get(container) || [];
  for (var di = 0; di < previousDisposers.length; di++) previousDisposers[di]();
  var disposers = [];
  catalogs[toolId] = catalog;
  container.innerHTML = "";
  var node = renderNode(uiTree, { toolId: toolId, state: state || {}, item: null, emit: emit, catalog: catalog, container: container, hintIndex: 1, disposers: disposers });
  renderDisposers.set(container, disposers);
  if (node) container.appendChild(node);
  if (typeof requestAnimationFrame === "function" && typeof lucide !== "undefined") refreshIcons();
  if (activeControlId) {
    var controls = container.querySelectorAll("[data-tool-control-id]");
    for (var i = 0; i < controls.length; i++) {
      if (controls[i].dataset.toolControlId !== activeControlId) continue;
      controls[i].focus({ preventScroll: true });
      if (selectionStart !== null && typeof controls[i].setSelectionRange === "function") {
        controls[i].setSelectionRange(selectionStart, selectionEnd);
      }
      break;
    }
  }
}

export function renderToolUi(toolId, uiTree, state, emit, container) {
  var active = document.activeElement;
  if (active && container.contains(active) && isToolTextInputComposing(active)) {
    deferredRenders.set(container, { toolId: toolId, uiTree: uiTree, state: state, emit: emit, container: container });
    return;
  }
  deferredRenders.delete(container);
  renderToolUiNow(toolId, uiTree, state, emit, container);
}

export function disposeToolUi(container) {
  var disposers = renderDisposers.get(container) || [];
  for (var i = 0; i < disposers.length; i++) disposers[i]();
  renderDisposers.delete(container);
  modelConfigurationRequested.delete(container);
  deferredRenders.delete(container);
}

export function getControlCatalog(toolId) {
  return Object.assign({}, catalogs[toolId] || {});
}
