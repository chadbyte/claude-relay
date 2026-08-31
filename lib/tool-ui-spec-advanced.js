var CONDITION_OPS = ["all", "any", "not", "equals", "notEquals", "in", "gt", "gte", "lt", "lte"];
var MAX_CONDITIONS = 40;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  var prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafePath(value) {
  if (typeof value !== "string" || !/^(?:\$(?:state|item)\.)?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value)) return false;
  var parts = value.replace(/^\$(?:state|item)\./, "").split(".");
  return !parts.some(function (part) { return part === "__proto__" || part === "constructor" || part === "prototype"; });
}

function safeScalar(value) {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function validateDynamic(value, rule, location, validateRule) {
  if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, "$bind")) return false;
  var dynamicAllowed = rule === "text" || rule === "bindingBoolean" || rule === "number" || rule === "positiveNumber" || rule === "options" || rule === "columns" || rule === "scalar" || !!(rule && rule.integer) || Array.isArray(rule);
  if (!dynamicAllowed) throw new Error(location + " does not allow a dynamic value.");
  var keys = Object.keys(value);
  if (keys.some(function (key) { return key !== "$bind" && key !== "fallback" && key !== "$enum"; }) || !isSafePath(value.$bind)) throw new Error(location + " dynamic value requires a safe $bind and optional fallback.");
  if (Array.isArray(rule)) {
    if (!Array.isArray(value.$enum) || !value.$enum.length || value.$enum.length > rule.length || value.$enum.some(function (entry) { return rule.indexOf(entry) === -1; })) throw new Error(location + ".$enum must contain only allowed enum values.");
  } else if (value.$enum !== undefined) throw new Error(location + ".$enum is only valid for enum properties.");
  if (value.fallback !== undefined) validateRule(value.fallback, rule, location + ".fallback");
  return true;
}

function validateCondition(condition, location, context) {
  context = context || { count: 0 };
  context.count++;
  if (context.count > MAX_CONDITIONS) throw new Error(location + " exceeds " + MAX_CONDITIONS + " condition terms.");
  if (typeof condition === "string") {
    if (!isSafePath(condition)) throw new Error(location + " must be a safe state path or condition object.");
    return;
  }
  if (!isPlainObject(condition)) throw new Error(location + " must be a safe state path or condition object.");
  var keys = Object.keys(condition);
  if (keys.length !== 1 || CONDITION_OPS.indexOf(keys[0]) === -1) throw new Error(location + " must contain exactly one allowed condition operator.");
  var op = keys[0];
  var value = condition[op];
  if (op === "all" || op === "any") {
    if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new Error(location + "." + op + " must contain 1 to 12 conditions.");
    for (var i = 0; i < value.length; i++) validateCondition(value[i], location + "." + op + "[" + i + "]", context);
    return;
  }
  if (op === "not") {
    validateCondition(value, location + ".not", context);
    return;
  }
  if (!isPlainObject(value) || !isSafePath(value.path)) throw new Error(location + "." + op + " requires a safe path.");
  var allowed = op === "in" ? ["path", "values"] : ["path", "value"];
  if (Object.keys(value).some(function (key) { return allowed.indexOf(key) === -1; })) throw new Error(location + "." + op + " contains an unknown property.");
  if (op === "in") {
    if (!Array.isArray(value.values) || value.values.length < 1 || value.values.length > 50 || value.values.some(function (entry) { return !safeScalar(entry); })) throw new Error(location + ".in values must be 1 to 50 safe scalars.");
  } else if ((op === "gt" || op === "gte" || op === "lt" || op === "lte") && (typeof value.value !== "number" || !Number.isFinite(value.value))) {
    throw new Error(location + "." + op + " value must be finite numeric data.");
  } else if (op !== "in" && !safeScalar(value.value)) {
    throw new Error(location + "." + op + " value must be scalar.");
  }
}

function validateValidation(value, location) {
  if (!isPlainObject(value)) throw new Error(location + " must be a validation object.");
  var allowed = ["minLength", "maxLength", "min", "max", "step", "pattern", "message"];
  var keys = Object.keys(value);
  for (var i = 0; i < keys.length; i++) if (allowed.indexOf(keys[i]) === -1) throw new Error(location + " contains unknown validation rule '" + keys[i] + "'.");
  if (value.minLength !== undefined && (!Number.isInteger(value.minLength) || value.minLength < 0 || value.minLength > 10000)) throw new Error(location + ".minLength is out of bounds.");
  if (value.maxLength !== undefined && (!Number.isInteger(value.maxLength) || value.maxLength < 1 || value.maxLength > 10000)) throw new Error(location + ".maxLength is out of bounds.");
  if (value.minLength !== undefined && value.maxLength !== undefined && value.minLength > value.maxLength) throw new Error(location + " minLength exceeds maxLength.");
  var numeric = ["min", "max", "step"];
  for (var ni = 0; ni < numeric.length; ni++) if (value[numeric[ni]] !== undefined && (typeof value[numeric[ni]] !== "number" || !Number.isFinite(value[numeric[ni]]))) throw new Error(location + "." + numeric[ni] + " must be finite numeric data.");
  if (value.step !== undefined && value.step <= 0) throw new Error(location + ".step must be positive.");
  if (value.pattern !== undefined && ["email", "url", "integer", "decimal"].indexOf(value.pattern) === -1) throw new Error(location + ".pattern is not allowed.");
  if (value.message !== undefined && (typeof value.message !== "string" || value.message.length > 300)) throw new Error(location + ".message must be short text.");
}

module.exports = { validateDynamic: validateDynamic, validateCondition: validateCondition, validateValidation: validateValidation };
