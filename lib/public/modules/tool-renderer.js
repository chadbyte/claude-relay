// tool-renderer.js - Host-rendered declarative tool UI vocabulary.

var catalogs = Object.create(null);

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

function renderInput(node, props, context) {
  var wrapper = document.createElement("label");
  wrapper.className = "tool-field";
  if (props.label) {
    var label = document.createElement("span");
    label.className = "tool-field-label";
    label.textContent = String(props.label);
    wrapper.appendChild(label);
  }
  var input = document.createElement(node.type === "textarea" ? "textarea" : "input");
  input.className = "tool-input";
  if (node.type === "input") input.type = props.inputType || "text";
  if (props.placeholder) input.placeholder = String(props.placeholder);
  var value = valueAtPath(context.state, node.bind, context.item);
  input.value = value === undefined || value === null ? "" : String(value);
  if (node.id) input.dataset.toolControlId = node.id;
  input.addEventListener("input", function () { emitNodeAction(node, props, context, { value: input.value }); });
  wrapper.appendChild(input);
  registerControl(node, props, context);
  return wrapper;
}

function renderSelect(node, props, context) {
  var wrapper = document.createElement("label");
  wrapper.className = "tool-field";
  if (props.label) {
    var label = document.createElement("span");
    label.className = "tool-field-label";
    label.textContent = String(props.label);
    wrapper.appendChild(label);
  }
  var select = document.createElement("select");
  select.className = "tool-select";
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
  wrapper.appendChild(select);
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
  var props = node.props || {};
  var element;
  var value;
  if (node.type === "input" || node.type === "textarea") return renderInput(node, props, context);
  if (node.type === "select") return renderSelect(node, props, context);
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
    element.className = "tool-empty-state";
    element.textContent = String(props.text || "Nothing here yet.");
    return element;
  }
  if (node.type === "list") {
    element = document.createElement("ul");
    element.className = "tool-list";
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
    element.className = "tool-heading";
  } else if (node.type === "text") {
    element = document.createElement("span");
    element.className = "tool-text";
  } else if (node.type === "badge") {
    element = document.createElement("span");
    element.className = "tool-badge";
  } else if (node.type === "button") {
    element = document.createElement("button");
    element.type = "button";
    element.className = "tool-button" + (props.variant ? " tool-button-" + props.variant : "");
    element.addEventListener("click", function () { emitNodeAction(node, props, context, {}); });
    registerControl(node, props, context);
  } else if (node.type === "checkbox") {
    element = document.createElement("input");
    element.type = "checkbox";
    element.className = "tool-checkbox";
    element.checked = !!valueAtPath(context.state, node.bind, context.item);
    element.addEventListener("change", function () { emitNodeAction(node, props, context, { value: element.checked }); });
    registerControl(node, props, context);
  } else {
    element = document.createElement("div");
    element.className = node.type === "row" ? "tool-row" : node.type === "card" ? "tool-card" : "tool-stack";
  }
  if (node.id) element.dataset.toolControlId = node.id;
  value = node.bind ? valueAtPath(context.state, node.bind, context.item) : props.text || props.label;
  if (value !== undefined && value !== null && node.type !== "checkbox") element.textContent = String(value);
  appendChildren(element, node, context);
  return element;
}

export function renderToolUi(toolId, uiTree, state, emit, container) {
  var active = document.activeElement;
  var activeControlId = active && container.contains(active) ? active.dataset.toolControlId : null;
  var selectionStart = activeControlId && typeof active.selectionStart === "number" ? active.selectionStart : null;
  var selectionEnd = activeControlId && typeof active.selectionEnd === "number" ? active.selectionEnd : null;
  var catalog = Object.create(null);
  catalogs[toolId] = catalog;
  container.innerHTML = "";
  var node = renderNode(uiTree, { state: state || {}, item: null, emit: emit, catalog: catalog });
  if (node) container.appendChild(node);
  if (activeControlId) {
    var controls = container.querySelectorAll("[data-tool-control-id]");
    for (var i = 0; i < controls.length; i++) {
      if (controls[i].dataset.toolControlId !== activeControlId) continue;
      controls[i].focus();
      if (selectionStart !== null && typeof controls[i].setSelectionRange === "function") {
        controls[i].setSelectionRange(selectionStart, selectionEnd);
      }
      break;
    }
  }
}

export function getControlCatalog(toolId) {
  return Object.assign({}, catalogs[toolId] || {});
}
