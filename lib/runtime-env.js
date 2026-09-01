var SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
var PROTECTED_KEYS = { HOME: true, USER: true, LOGNAME: true, SHELL: true, PATH: true, XDG_RUNTIME_DIR: true, NODE_OPTIONS: true, TERM: true, COLORFGBG: true };

function isProtectedKey(key) {
  return !!PROTECTED_KEYS[key] || key.indexOf("CLAY_") === 0 || key.indexOf("LD_") === 0 || key.indexOf("DYLD_") === 0;
}

function parseQuotedValue(value, lineNumber) {
  var trimmed = value.trim();
  if (!trimmed) return "";
  var quote = trimmed.charAt(0);
  if (quote !== "\"" && quote !== "'") {
    if (/[;`|]|\$\(|&&/.test(trimmed)) throw new Error("Unsupported executable syntax at line " + lineNumber);
    return trimmed;
  }
  if (trimmed.length < 2 || trimmed.charAt(trimmed.length - 1) !== quote) throw new Error("Invalid quoted value at line " + lineNumber);
  var content = trimmed.substring(1, trimmed.length - 1);
  if (quote === "'") return content;
  try {
    var parsed = JSON.parse(trimmed);
    if (typeof parsed !== "string" || parsed.indexOf("\0") !== -1) throw new Error("Invalid");
    return parsed;
  } catch (e) {
    throw new Error("Invalid quoted value at line " + lineNumber);
  }
}

function parseEnvrc(text) {
  var env = {};
  var source = typeof text === "string" ? text : "";
  if (source.indexOf("\0") !== -1) throw new Error("Environment values cannot contain NUL bytes");
  var lines = source.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) === "#") continue;
    if (line.indexOf("export ") === 0) line = line.substring(7).trim();
    var equals = line.indexOf("=");
    if (equals < 1) throw new Error("Unsupported syntax at line " + (i + 1) + ": use KEY=VALUE or export KEY=VALUE");
    var key = line.substring(0, equals).trim();
    if (!SAFE_KEY.test(key)) throw new Error("Invalid variable name at line " + (i + 1) + ": " + key);
    env[key] = parseQuotedValue(line.substring(equals + 1), i + 1);
  }
  return env;
}

function validateEnvString(text) {
  try { parseEnvrc(text); return null; }
  catch (e) { return e.message || String(e); }
}

function applyEnv(target, values) {
  var keys = Object.keys(values || {});
  for (var i = 0; i < keys.length; i++) if (!isProtectedKey(keys[i])) target[keys[i]] = values[keys[i]];
  return target;
}

function resolveRuntimeEnv(opts) {
  opts = opts || {};
  var result = Object.assign({}, opts.baseEnv || process.env);
  applyEnv(result, parseEnvrc(opts.sharedEnvrc || ""));
  applyEnv(result, parseEnvrc(opts.projectEnvrc || ""));
  return result;
}

module.exports = { parseEnvrc: parseEnvrc, validateEnvString: validateEnvString, resolveRuntimeEnv: resolveRuntimeEnv, isProtectedKey: isProtectedKey };
