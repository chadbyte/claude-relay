var fs = require("fs");
var path = require("path");
var config = require("./config");

var sqlite;
var _availabilityError = null;
try {
  sqlite = require("node:sqlite");
} catch (e) {
  sqlite = null;
  _availabilityError = "Mate datastores require Node 22.13.0 or newer with node:sqlite available.";
}

function parseNodeVersion(version) {
  var parts = String(version || "").split(".");
  return {
    major: parseInt(parts[0] || "0", 10) || 0,
    minor: parseInt(parts[1] || "0", 10) || 0,
    patch: parseInt(parts[2] || "0", 10) || 0,
  };
}

function assertNodeVersion() {
  var v = parseNodeVersion(process.versions.node);
  if (v.major < 22 || (v.major === 22 && v.minor < 13)) {
    throw new Error("Mate datastores require Node 22.13.0 or newer.");
  }
}
try {
  assertNodeVersion();
} catch (e) {
  if (!_availabilityError) _availabilityError = e.message;
}

var DatabaseSync = sqlite ? sqlite.DatabaseSync : null;

var MAX_ROWS = 200;
var MAX_RESULT_BYTES = 1024 * 1024;
var DB_SIZE_WARNING_BYTES = 100 * 1024 * 1024;
var PRAGMA_BUSY_TIMEOUT = 5000;
var CLAY_META_VERSION = "1";

var _dbCache = {};

function isMateDatastoreAvailable() {
  return !!DatabaseSync && !_availabilityError;
}

function getMateDatastoreAvailabilityError() {
  return _availabilityError || null;
}

function assertAvailable() {
  if (!isMateDatastoreAvailable()) {
    throw new Error(getMateDatastoreAvailabilityError() || "Mate datastore is unavailable.");
  }
}

function getMateDbPath(opts) {
  if (opts && opts.dbPath) return String(opts.dbPath);
  if (opts && opts.mateDir) return path.join(String(opts.mateDir), "store.db");
  var userId = opts && opts.userId ? String(opts.userId) : "default";
  var mateId = opts && opts.mateId ? String(opts.mateId) : null;
  if (!mateId) throw new Error("Mate datastore requires a mateId.");
  return path.join(config.CONFIG_DIR, "mates", userId, mateId, "store.db");
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getDbSizeBytes(dbPath) {
  try {
    return fs.statSync(dbPath).size;
  } catch (e) {
    return 0;
  }
}

function openDatabase(dbPath) {
  var db = new DatabaseSync(dbPath);
  try { db.exec("PRAGMA journal_mode = WAL"); } catch (e) {}
  try { db.exec("PRAGMA foreign_keys = ON"); } catch (e2) {}
  try { db.exec("PRAGMA busy_timeout = " + PRAGMA_BUSY_TIMEOUT); } catch (e3) {}
  return db;
}

function initClayMeta(db) {
  var now = new Date().toISOString();
  db.exec("CREATE TABLE IF NOT EXISTS clay_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  var stmt = db.prepare("INSERT OR IGNORE INTO clay_meta (key, value) VALUES (?, ?)");
  stmt.run("clay_meta_version", CLAY_META_VERSION);
  stmt.run("created_at", now);
  stmt.run("last_opened_at", now);
  db.prepare("UPDATE clay_meta SET value = ? WHERE key = ?").run(now, "last_opened_at");
}

function ensureMateDatastore(opts) {
  assertAvailable();
  var dbPath = getMateDbPath(opts);
  if (_dbCache[dbPath] && _dbCache[dbPath].db) return _dbCache[dbPath];
  ensureParentDir(dbPath);
  var db = openDatabase(dbPath);
  initClayMeta(db);
  var wrapper = {
    db: db,
    dbPath: dbPath,
    sizeBytes: getDbSizeBytes(dbPath),
    warning: getDbSizeBytes(dbPath) > DB_SIZE_WARNING_BYTES ? "Mate datastore exceeds 100 MB soft warning threshold." : null,
  };
  _dbCache[dbPath] = wrapper;
  return wrapper;
}

function openMateDatastore(opts) {
  return ensureMateDatastore(opts);
}

function closeMateDatastore(handle) {
  var wrapper = unwrapHandle(handle);
  if (!wrapper || !wrapper.db) return;
  try {
    wrapper.db.close();
  } catch (e) {}
  if (wrapper.dbPath && _dbCache[wrapper.dbPath]) delete _dbCache[wrapper.dbPath];
}

function closeAllMateDatastores() {
  var keys = Object.keys(_dbCache);
  for (var i = 0; i < keys.length; i++) {
    closeMateDatastore(_dbCache[keys[i]]);
  }
}

function unwrapHandle(handle) {
  if (!handle) return null;
  if (handle.db && handle.dbPath) return handle;
  return { db: handle, dbPath: null, sizeBytes: 0, warning: null };
}

function normalizeSql(sql) {
  var text = String(sql || "");
  text = text.replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, "");
  return text.trim();
}

function getFirstKeyword(sql) {
  var text = normalizeSql(sql);
  var match = text.match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : "";
}

function hasMultipleStatements(sql) {
  var text = normalizeSql(sql);
  if (text.indexOf(";") === -1) return false;
  return !/;\s*$/.test(text) || text.slice(0, -1).indexOf(";") !== -1;
}

function isForbiddenSql(sql) {
  var text = normalizeSql(sql).toUpperCase();
  var banned = [
    "ATTACH DATABASE",
    "DETACH DATABASE",
    "LOAD_EXTENSION",
    "LOAD EXTENSION",
  ];
  for (var i = 0; i < banned.length; i++) {
    if (text.indexOf(banned[i]) !== -1) return banned[i];
  }
  if (/PRAGMA\s+(?!table_info|table_xinfo|index_list|index_info|foreign_key_list)/i.test(text)) {
    return "PRAGMA";
  }
  return "";
}

function isReadOnlyQuery(sql) {
  var kw = getFirstKeyword(sql);
  if (kw === "SELECT" || kw === "WITH") return true;
  return false;
}

function isAllowedExec(sql) {
  var kw = getFirstKeyword(sql);
  return kw === "CREATE" || kw === "ALTER" || kw === "DROP" || kw === "INSERT" || kw === "UPDATE" || kw === "DELETE";
}

function bindParams(stmt, params) {
  if (!params) return stmt;
  if (!Array.isArray(params)) return stmt;
  return stmt.run.apply(stmt, params);
}

function runQuery(handle, sql, params, limits) {
  var wrapper = unwrapHandle(handle);
  if (!wrapper || !wrapper.db) {
    return makeError("MATE_DATASTORE_UNAVAILABLE", "Mate datastore is not available.");
  }
  var text = normalizeSql(sql);
  if (!text) return makeError("SQLITE_QUERY_REJECTED", "Query SQL is required.");
  if (hasMultipleStatements(text)) return makeError("SQLITE_QUERY_REJECTED", "Multiple statements are not allowed in query mode.");
  var forbidden = isForbiddenSql(text);
  if (forbidden) return makeError("SQLITE_FORBIDDEN", forbidden + " is not allowed in Mate datastores.");
  if (!isReadOnlyQuery(text)) return makeError("SQLITE_QUERY_REJECTED", "Only SELECT and WITH queries are allowed.");

  try {
    var stmt = wrapper.db.prepare(text);
    var rows = Array.isArray(params) ? stmt.all.apply(stmt, params) : stmt.all();
    rows = sanitizeValue(rows);
    var rowCount = rows.length;
    var maxRows = limits && typeof limits.maxRows === "number" ? limits.maxRows : MAX_ROWS;
    var truncated = false;
    if (rows.length > maxRows) {
      rows = rows.slice(0, maxRows);
      truncated = true;
    }
    var result = {
      ok: true,
      rows: rows,
      rowCount: rowCount,
      truncated: truncated,
    };
    if (wrapper.warning) result.warning = wrapper.warning;
    if (limits && limits.includeSizeInfo) {
      result.sizeBytes = wrapper.sizeBytes;
    }
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > (limits && limits.maxBytes ? limits.maxBytes : MAX_RESULT_BYTES)) {
      return makeError("SQLITE_RESULT_TOO_LARGE", "Query result exceeds the 1 MB response limit.");
    }
    return result;
  } catch (e) {
    return normalizeSqliteError(e, "SQLITE_EXEC_FAILED", "Query failed.");
  }
}

function runExec(handle, sql, params, limits) {
  var wrapper = unwrapHandle(handle);
  if (!wrapper || !wrapper.db) {
    return makeError("MATE_DATASTORE_UNAVAILABLE", "Mate datastore is not available.");
  }
  var text = normalizeSql(sql);
  if (!text) return makeError("MATE_DATASTORE_BAD_INPUT", "SQL is required.");
  if (hasMultipleStatements(text)) return makeError("SQLITE_EXEC_FAILED", "Multiple statements are not allowed in exec mode.");
  var forbidden = isForbiddenSql(text);
  if (forbidden) return makeError("SQLITE_FORBIDDEN", forbidden + " is not allowed in Mate datastores.");
  if (!isAllowedExec(text)) return makeError("SQLITE_EXEC_FAILED", "Only CREATE, ALTER, DROP, INSERT, UPDATE, and DELETE are allowed in exec mode.");

  try {
    var stmt = wrapper.db.prepare(text);
    var runResult = Array.isArray(params) ? stmt.run.apply(stmt, params) : stmt.run();
    var result = {
      ok: true,
      changes: typeof runResult.changes === "number" ? runResult.changes : 0,
      lastInsertRowid: typeof runResult.lastInsertRowid !== "undefined" ? sanitizeValue(runResult.lastInsertRowid) : null,
    };
    if (wrapper.warning) result.warning = wrapper.warning;
    if (limits && limits.includeSizeInfo) {
      result.sizeBytes = getDbSizeBytes(wrapper.dbPath);
    }
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > (limits && limits.maxBytes ? limits.maxBytes : MAX_RESULT_BYTES)) {
      return makeError("SQLITE_RESULT_TOO_LARGE", "Execution result exceeds the 1 MB response limit.");
    }
    wrapper.sizeBytes = getDbSizeBytes(wrapper.dbPath);
    if (wrapper.sizeBytes > DB_SIZE_WARNING_BYTES) {
      wrapper.warning = "Mate datastore exceeds 100 MB soft warning threshold.";
      result.warning = wrapper.warning;
    }
    return result;
  } catch (e) {
    return normalizeSqliteError(e, "SQLITE_EXEC_FAILED", "Execution failed.");
  }
}

function listSchemaObjects(handle) {
  var wrapper = unwrapHandle(handle);
  if (!wrapper || !wrapper.db) {
    return makeError("MATE_DATASTORE_UNAVAILABLE", "Mate datastore is not available.");
  }
  try {
    var rows = wrapper.db.prepare(
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'view', 'index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'clay_%' ORDER BY type, name"
    ).all();
    return { ok: true, objects: rows };
  } catch (e) {
    return normalizeSqliteError(e, "SQLITE_EXEC_FAILED", "Failed to list schema objects.");
  }
}

function describeTable(handle, tableName) {
  var wrapper = unwrapHandle(handle);
  if (!wrapper || !wrapper.db) {
    return makeError("MATE_DATASTORE_UNAVAILABLE", "Mate datastore is not available.");
  }
  if (!isSafeIdentifier(tableName)) {
    return makeError("MATE_DATASTORE_BAD_INPUT", "Table name is invalid.");
  }
  try {
    var info = wrapper.db.prepare("SELECT name, type, sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')").get(tableName);
    if (!info) return makeError("SQLITE_TABLE_NOT_FOUND", "Table not found.");
    var columns = wrapper.db.prepare("PRAGMA table_info(" + quoteIdentifier(tableName) + ")").all();
    var indexes = wrapper.db.prepare("PRAGMA index_list(" + quoteIdentifier(tableName) + ")").all();
    return {
      ok: true,
      table: tableName,
      columns: columns,
      indexes: indexes,
      createSql: info.sql || null,
    };
  } catch (e) {
    return normalizeSqliteError(e, "SQLITE_EXEC_FAILED", "Failed to describe table.");
  }
}

function isSafeIdentifier(name) {
  return typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function quoteIdentifier(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function makeError(code, message) {
  return { ok: false, code: code, message: message };
}

function sanitizeValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    var out = {};
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      out[keys[i]] = sanitizeValue(value[keys[i]]);
    }
    return out;
  }
  return value;
}

function normalizeSqliteError(err, fallbackCode, fallbackMessage) {
  var message = err && err.message ? String(err.message) : fallbackMessage;
  var code = fallbackCode;
  if (message.indexOf("no such table") !== -1) code = "SQLITE_TABLE_NOT_FOUND";
  if (message.indexOf("no such column") !== -1) code = "SQLITE_QUERY_REJECTED";
  return { ok: false, code: code, message: message };
}

module.exports = {
  isMateDatastoreAvailable: isMateDatastoreAvailable,
  getMateDatastoreAvailabilityError: getMateDatastoreAvailabilityError,
  openMateDatastore: openMateDatastore,
  ensureMateDatastore: ensureMateDatastore,
  listSchemaObjects: listSchemaObjects,
  describeTable: describeTable,
  runQuery: runQuery,
  runExec: runExec,
  closeMateDatastore: closeMateDatastore,
  closeAllMateDatastores: closeAllMateDatastores,
  getMateDbPath: getMateDbPath,
};
