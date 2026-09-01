// Host-owned advanced controls for the safe Capsule UI vocabulary.

import { collectionView, normalizeOptions, resolveProps, resolveValue, valueAtPath } from './tool-ui-evaluator.js';
import { renderChartNode } from './tool-renderer-chart.js';

var dialogOpeners = new WeakMap();

function nextGroupToken(context, prefix, authoredId) {
  if (authoredId) return authoredId;
  if (!Number.isInteger(context.autoControlIndex) || context.autoControlIndex < 1) context.autoControlIndex = 1;
  return prefix + "-" + context.autoControlIndex++;
}

function emit(node, props, context, extra) {
  var args = Object.assign({}, resolveValue(props.args || {}, context.state, context.item), extra || {});
  if (node.id) args.controlId = node.id;
  context.emit(node.action, args);
}

function appendRenderedChildren(target, children, context, renderNode) {
  for (var i = 0; i < children.length; i++) {
    var rendered = renderNode(children[i], context);
    if (rendered) target.appendChild(rendered);
  }
}

function renderForm(node, props, context, renderNode) {
  var form = document.createElement("form");
  form.className = "tool-form";
  if (props.label) form.setAttribute("aria-label", String(props.label));
  appendRenderedChildren(form, node.children || [], context, renderNode);
  var error = document.createElement("div");
  error.className = "tool-form-error hidden";
  error.setAttribute("role", "alert");
  form.appendChild(error);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var invalid = form.querySelector(":invalid");
    if (invalid) {
      error.textContent = invalid.validationMessage || "Check the highlighted fields.";
      error.classList.remove("hidden");
      invalid.focus();
      return;
    }
    error.classList.add("hidden");
    emit(node, props, context, {});
  });
  var submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "tool-button tool-button--variant-primary";
  submit.dataset.toolControlId = node.id || "form-submit-" + context.autoControlIndex++;
  submit.textContent = String(props.submitLabel || "Submit");
  form.appendChild(submit);
  return form;
}

function renderTabs(node, props, context, renderNode) {
  var wrapper = document.createElement("div");
  wrapper.className = "tool-tabs";
  var list = document.createElement("div");
  list.className = "tool-tab-list";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", String(props.label || "Sections"));
  var panels = document.createElement("div");
  var selected = valueAtPath(context.state, node.bind, context.item);
  var groupToken = nextGroupToken(context, "tabs", node.id);
  var children = node.children || [];
  var dynamic = props.options ? normalizeOptions(props.options) : null;
  var tabs = dynamic ? dynamic.map(function (option) { return { props: option, children: [] }; }) : children;
  var buttons = [];
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    var tabProps = resolveProps(tab.props || {}, context.state, context.item);
    var active = selected === tabProps.value || (selected === undefined && i === 0);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "tool-tab";
    button.textContent = String(tabProps.label);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
    button.disabled = tabProps.disabled === true;
    var panelId = "tool-tab-panel-" + context.toolId + "-" + groupToken + "-" + i;
    var tabId = "tool-tab-" + context.toolId + "-" + groupToken + "-" + i;
    button.id = tabId;
    button.setAttribute("aria-controls", panelId);
    button.dataset.tabIndex = String(i);
    button.addEventListener("click", function (event) {
      var index = Number(event.currentTarget.dataset.tabIndex);
      emit(node, props, context, { value: resolveProps(tabs[index].props || {}, context.state, context.item).value });
    });
    buttons.push(button);
    list.appendChild(button);
    if (active) {
      var panel = document.createElement("div");
      panel.id = panelId;
      panel.className = "tool-tab-panel";
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabId);
      appendRenderedChildren(panel, tab.children || [], context, renderNode);
      panels.appendChild(panel);
    }
  }
  list.addEventListener("keydown", function (event) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(event.key) === -1) return;
    event.preventDefault();
    var enabled = buttons.filter(function (button) { return !button.disabled; });
    if (!enabled.length) return;
    var index = enabled.indexOf(document.activeElement);
    var next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
    enabled[next].focus();
  });
  wrapper.appendChild(list);
  wrapper.appendChild(panels);
  return wrapper;
}

function renderDialog(node, props, context, renderNode) {
  var placeholder = document.createElement("span");
  var dialogToken = nextGroupToken(context, "dialog", node.id);
  if (props.open !== true) {
    var openerId = dialogOpeners.get(context.container);
    dialogOpeners.delete(context.container);
    var returnTimer = openerId ? setTimeout(function () {
      var controls = context.container.querySelectorAll("[data-tool-control-id]");
      for (var i = 0; i < controls.length; i++) if (controls[i].dataset.toolControlId === openerId) controls[i].focus({ preventScroll: true });
    }, 0) : null;
    if (returnTimer) context.disposers.push(function () { clearTimeout(returnTimer); });
    return placeholder;
  }
  if (context.activeControlId) dialogOpeners.set(context.container, context.activeControlId);
  var overlay = document.createElement("div");
  overlay.className = "tool-dialog-overlay";
  var dialog = document.createElement("section");
  dialog.className = "tool-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  var title = document.createElement("h3");
  var titleId = "tool-dialog-title-" + context.toolId + "-" + dialogToken;
  title.id = titleId;
  title.className = "tool-dialog-title";
  title.textContent = String(props.label);
  dialog.appendChild(title);
  dialog.setAttribute("aria-labelledby", titleId);
  if (props.description) {
    var description = document.createElement("p");
    var descriptionId = "tool-dialog-description-" + context.toolId + "-" + dialogToken;
    description.id = descriptionId;
    description.className = "tool-dialog-description";
    description.textContent = String(props.description);
    dialog.appendChild(description);
    dialog.setAttribute("aria-describedby", descriptionId);
  }
  var close = document.createElement("button");
  close.type = "button";
  close.className = "tool-dialog-close";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close " + String(props.label));
  close.addEventListener("click", function () { context.emit(props.closeAction, {}); });
  dialog.appendChild(close);
  appendRenderedChildren(dialog, node.children || [], context, renderNode);
  overlay.appendChild(dialog);
  overlay.addEventListener("mousedown", function (event) { if (event.target === overlay) context.emit(props.closeAction, {}); });
  overlay.addEventListener("keydown", function (event) {
    if (event.key === "Escape") { event.preventDefault(); context.emit(props.closeAction, {}); return; }
    if (event.key !== "Tab") return;
    var focusable = dialog.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])");
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  var focusTimer = setTimeout(function () { if (context.container.contains(overlay)) close.focus(); }, 0);
  context.disposers.push(function () { clearTimeout(focusTimer); });
  return overlay;
}

function renderMenu(node, props, context) {
  var wrapper = document.createElement("div");
  wrapper.className = "tool-menu";
  var trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "tool-button tool-button--variant-ghost";
  trigger.dataset.toolControlId = node.id || "menu-trigger-" + context.autoControlIndex++;
  trigger.textContent = String(props.triggerLabel || props.label);
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  var menu = document.createElement("div");
  menu.className = "tool-menu-popup hidden";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", String(props.label));
  var dynamic = props.options ? normalizeOptions(props.options) : null;
  var items = dynamic ? dynamic.map(function (option) { return { action: node.action, props: { label: option.label, disabled: option.disabled, args: { value: option.value } } }; }) : node.children || [];
  for (var i = 0; i < items.length; i++) {
    var item = document.createElement("button");
    item.type = "button";
    item.className = "tool-menu-item";
    item.setAttribute("role", "menuitem");
    var itemProps = resolveProps(items[i].props || {}, context.state, context.item);
    item.textContent = String(itemProps.label);
    item.disabled = itemProps.disabled === true;
    item.dataset.menuIndex = String(i);
    item.addEventListener("click", function (event) {
      var selected = items[Number(event.currentTarget.dataset.menuIndex)];
      closeMenu(true);
      emit(selected, resolveProps(selected.props || {}, context.state, context.item), context, {});
    });
    menu.appendChild(item);
  }
  function closeMenu(focus) { menu.classList.add("hidden"); trigger.setAttribute("aria-expanded", "false"); if (focus) trigger.focus(); }
  function openMenu() { menu.classList.remove("hidden"); trigger.setAttribute("aria-expanded", "true"); var first = menu.querySelector("[role='menuitem']:not(:disabled)"); if (first) first.focus(); }
  trigger.addEventListener("click", function () { if (menu.classList.contains("hidden")) openMenu(); else closeMenu(false); });
  trigger.addEventListener("keydown", function (event) { if (event.key === "ArrowDown") { event.preventDefault(); openMenu(); } });
  menu.addEventListener("keydown", function (event) {
    var controls = Array.prototype.slice.call(menu.querySelectorAll("[role='menuitem']:not(:disabled)"));
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].indexOf(event.key) === -1) return;
    event.preventDefault();
    if (!controls.length) return;
    var current = controls.indexOf(document.activeElement);
    var next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
    controls[next].focus();
  });
  var outside = function (event) { if (!wrapper.contains(event.target)) closeMenu(false); };
  document.addEventListener("mousedown", outside);
  context.disposers.push(function () { document.removeEventListener("mousedown", outside); });
  wrapper.appendChild(trigger);
  wrapper.appendChild(menu);
  return wrapper;
}

function renderPagination(node, props, context) {
  var nav = document.createElement("nav");
  nav.className = "tool-pagination";
  nav.setAttribute("aria-label", String(props.label || "Pagination"));
  var page = Math.max(1, Number(valueAtPath(context.state, node.bind, context.item)) || 1);
  var total = Math.max(0, Number(props.total) || 0);
  var pageSize = Math.max(1, Math.min(100, Number(props.pageSize) || 20));
  var pages = Math.max(1, Math.ceil(total / pageSize));
  function appendPageButton(target, label, current) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "tool-button tool-button--variant-ghost";
    button.textContent = label;
    button.disabled = target < 1 || target > pages;
    if (current) button.setAttribute("aria-current", "page");
    button.addEventListener("click", function () { context.emit(props.pageAction, { value: target, pageSize: pageSize }); });
    nav.appendChild(button);
  }
  appendPageButton(page - 1, "Previous", false);
  var first = Math.max(1, Math.min(pages - 4, page - 2));
  var last = Math.min(pages, first + 4);
  for (var pi = first; pi <= last; pi++) appendPageButton(pi, String(pi), pi === page);
  var status = document.createElement("span");
  status.textContent = "Page " + Math.min(page, pages) + " of " + pages;
  status.setAttribute("aria-live", "polite");
  nav.appendChild(status);
  appendPageButton(page + 1, "Next", false);
  if (Array.isArray(props.pageSizes) && props.pageSizeAction) {
    var size = document.createElement("select");
    size.className = "tool-select tool-pagination-size";
    size.setAttribute("aria-label", "Items per page");
    props.pageSizes.slice(0, 10).forEach(function (value) {
      var option = document.createElement("option");
      option.value = String(value);
      option.textContent = String(value) + " per page";
      option.selected = value === pageSize;
      size.appendChild(option);
    });
    size.addEventListener("change", function () { context.emit(props.pageSizeAction, { value: Number(size.value) }); });
    nav.appendChild(size);
  }
  return nav;
}

export function renderAdvancedNode(node, props, context, renderNode) {
  if (node.type === "form") return renderForm(node, props, context, renderNode);
  if (node.type === "tabs") return renderTabs(node, props, context, renderNode);
  if (node.type === "dialog") return renderDialog(node, props, context, renderNode);
  if (node.type === "menu") return renderMenu(node, props, context);
  if (node.type === "pagination") return renderPagination(node, props, context);
  if (node.type === "chart") return renderChartNode(node, props, context);
  return null;
}
