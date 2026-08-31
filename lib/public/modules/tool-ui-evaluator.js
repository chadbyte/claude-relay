// Pure bounded evaluation for safe declarative Capsule UI.

var MAX_COLLECTION_ITEMS = 500;

export function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).reduce(function (result, option) {
    if (typeof option === "string" || typeof option === "number") result.push({ value: option, label: String(option), disabled: false });
    else if (option && typeof option === "object" && (typeof option.value === "string" || typeof option.value === "number") && typeof option.label === "string") result.push({ value: option.value, label: option.label.slice(0, 500), disabled: option.disabled === true });
    return result;
  }, []);
}

export function normalizeColumns(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).filter(function (column) {
    return column && typeof column === "object" && typeof column.key === "string" && /^(?:\$(?:state|item)\.)?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(column.key) && !/(?:__proto__|constructor|prototype)/.test(column.key);
  }).map(function (column) { return { key: column.key, label: typeof column.label === "string" ? column.label.slice(0, 500) : column.key }; });
}

export function valueAtPath(state, path, item) {
  if (!path) return undefined;
  var source = state;
  var parts = path.split(".");
  if (parts[0] === "$item") { source = item; parts.shift(); }
  else if (parts[0] === "$state") parts.shift();
  for (var i = 0; i < parts.length; i++) {
    if (source === null || source === undefined) return undefined;
    source = source[parts[i]];
  }
  return source;
}

export function resolveValue(value, state, item) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.$bind) {
    var bound = valueAtPath(state, value.$bind, item);
    if (Array.isArray(value.$enum)) return value.$enum.indexOf(bound) !== -1 ? bound : value.fallback !== undefined ? value.fallback : value.$enum[0];
    return bound === undefined ? value.fallback : bound;
  }
  if (typeof value === "string" && (value.indexOf("$item") === 0 || value.indexOf("$state") === 0)) return valueAtPath(state, value, item);
  if (Array.isArray(value)) return value.map(function (entry) { return resolveValue(entry, state, item); });
  if (value && typeof value === "object") {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = resolveValue(value[key], state, item); });
    return result;
  }
  return value;
}

export function evaluateCondition(condition, state, item) {
  if (typeof condition === "string") return !!valueAtPath(state, condition, item);
  if (!condition || typeof condition !== "object") return false;
  if (condition.all) return condition.all.every(function (entry) { return evaluateCondition(entry, state, item); });
  if (condition.any) return condition.any.some(function (entry) { return evaluateCondition(entry, state, item); });
  if (condition.not) return !evaluateCondition(condition.not, state, item);
  var operators = ["equals", "notEquals", "in", "gt", "gte", "lt", "lte"];
  for (var i = 0; i < operators.length; i++) {
    var operator = operators[i];
    if (!condition[operator]) continue;
    var rule = condition[operator];
    var actual = valueAtPath(state, rule.path, item);
    if (operator === "equals") return actual === rule.value;
    if (operator === "notEquals") return actual !== rule.value;
    if (operator === "in") return rule.values.indexOf(actual) !== -1;
    if (typeof actual !== "number") return false;
    if (operator === "gt") return actual > rule.value;
    if (operator === "gte") return actual >= rule.value;
    if (operator === "lt") return actual < rule.value;
    if (operator === "lte") return actual <= rule.value;
  }
  return false;
}

export function resolveProps(props, state, item) {
  var result = {};
  Object.keys(props || {}).forEach(function (key) { result[key] = resolveValue(props[key], state, item); });
  return result;
}

export function collectionView(value, props) {
  var items = Array.isArray(value) ? value.slice(0, MAX_COLLECTION_ITEMS) : [];
  var filter = String(props.filter || "").trim().toLocaleLowerCase();
  if (filter) items = items.filter(function (item) {
    var candidate = props.filterKey ? valueAtPath(item, props.filterKey, null) : item;
    return String(candidate === undefined ? "" : candidate).toLocaleLowerCase().indexOf(filter) !== -1;
  });
  if (props.sortKey) items.sort(function (left, right) {
    var a = valueAtPath(left, props.sortKey, null);
    var b = valueAtPath(right, props.sortKey, null);
    if (a === b) return 0;
    var result = a === undefined || a === null ? 1 : b === undefined || b === null ? -1 : a < b ? -1 : 1;
    return props.sortDirection === "desc" ? -result : result;
  });
  var pageSize = Math.max(1, Math.min(100, Number(props.pageSize) || 100));
  var page = Math.max(1, Number(props.page) || 1);
  return items.slice((page - 1) * pageSize, page * pageSize);
}
