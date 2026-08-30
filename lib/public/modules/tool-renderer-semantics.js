// Fixed class mapping for the validated Capsule UI semantic grammar.

var TOKEN_KEYS = ["tone", "size", "emphasis", "gap", "variant", "align", "justify", "padding", "role"];
var SAFE_TOKENS = /^[a-z]+(?:-[a-z]+)*$/;

export function semanticClasses(base, props) {
  var classes = [base];
  props = props || {};
  for (var i = 0; i < TOKEN_KEYS.length; i++) {
    var key = TOKEN_KEYS[i];
    var value = props[key];
    if (typeof value === "string" && SAFE_TOKENS.test(value)) classes.push(base + "--" + key + "-" + value);
  }
  if (props.wrap === true) classes.push(base + "--wrap");
  return classes.join(" ");
}

export function appendToolIcon(element, name, label) {
  if (!name) return null;
  var icon = document.createElement("i");
  icon.className = "tool-icon";
  icon.setAttribute("data-lucide", name);
  if (label) icon.setAttribute("aria-label", label);
  else icon.setAttribute("aria-hidden", "true");
  element.appendChild(icon);
  return icon;
}
