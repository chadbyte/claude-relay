import { escapeHtml } from './utils.js';
import { refreshIcons } from './icons.js';
import { getWs } from './ws-ref.js';

var wsGetter = null;
var panelEl = null;
var tableListEl = null;
var tableNameEl = null;
var tableSchemaEl = null;
var queryInputEl = null;
var paramsInputEl = null;
var resultEl = null;
var statusEl = null;
var dataBtnEl = null;
var conversationsEl = null;
var memoryEl = null;
var knowledgeEl = null;
var currentTables = [];
var currentTable = null;
var panelOpen = false;

function sendWs(msg) {
  var ws = wsGetter ? wsGetter() : getWs();
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function setSectionVisibility(open) {
  panelOpen = open;
  if (panelEl) panelEl.classList.toggle("hidden", !open);
  if (conversationsEl) conversationsEl.classList.toggle("hidden", open);
  if (memoryEl) memoryEl.classList.toggle("hidden", true);
  if (knowledgeEl) knowledgeEl.classList.toggle("hidden", true);
  if (dataBtnEl) dataBtnEl.classList.toggle("active", open);
  refreshIcons();
}

function requestTables() {
  sendWs({ type: "mate_db_tables" });
}

function renderStatus(text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text || "";
  statusEl.dataset.kind = kind || "";
}

function renderResult(payload) {
  if (!resultEl) return;
  resultEl.textContent = JSON.stringify(payload, null, 2);
}

function renderTableList(objects) {
  currentTables = objects || [];
  if (!tableListEl) return;
  tableListEl.innerHTML = "";

  if (!currentTables.length) {
    var empty = document.createElement("div");
    empty.className = "mate-db-empty";
    empty.textContent = "No tables or views found.";
    tableListEl.appendChild(empty);
    return;
  }

  for (var i = 0; i < currentTables.length; i++) {
    (function (obj) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "mate-db-table-item" + (currentTable === obj.name ? " active" : "");
      var label = obj.type || "object";
      row.innerHTML = '<span class="mate-db-table-item-name">' + escapeHtml(obj.name) + '</span>' +
        '<span class="mate-db-table-item-type">' + escapeHtml(label) + '</span>';
      row.addEventListener("click", function () {
        selectTable(obj.name);
      });
      tableListEl.appendChild(row);
    })(currentTables[i]);
  }
}

function findFirstDescribableObject(objects) {
  var list = objects || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && (list[i].type === "table" || list[i].type === "view")) return list[i];
  }
  return null;
}

function findObjectByName(name) {
  for (var i = 0; i < currentTables.length; i++) {
    if (currentTables[i] && currentTables[i].name === name) return currentTables[i];
  }
  return null;
}

function selectTable(tableName) {
  currentTable = tableName;
  renderTableList(currentTables);
  var obj = findObjectByName(tableName);
  if (!obj) return;
  if (obj.type !== "table" && obj.type !== "view") {
    renderStatus("Selected " + (obj.type || "object") + " " + tableName + ".", "ok");
    if (tableNameEl) tableNameEl.textContent = tableName;
    if (tableSchemaEl) tableSchemaEl.textContent = obj.sql || "";
    renderResult(obj);
    return;
  }
  renderStatus("Loading " + tableName + "...", "info");
  sendWs({ type: "mate_db_describe", table: tableName });
  if (queryInputEl) queryInputEl.value = 'SELECT * FROM "' + tableName.replace(/"/g, '""') + '" LIMIT 50;';
}

function parseParams() {
  if (!paramsInputEl) return [];
  var text = paramsInputEl.value.trim();
  if (!text) return [];
  try {
    var parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    renderStatus("Parameters must be a JSON array.", "error");
  } catch (e) {
    renderStatus("Parameters must be valid JSON.", "error");
  }
  return null;
}

function sendQueryMessage(type) {
  var sql = queryInputEl ? queryInputEl.value : "";
  var params = parseParams();
  if (params === null) return;
  if (!sql || !sql.trim()) {
    renderStatus("Enter SQL before running it.", "error");
    return;
  }
  sendWs({ type: type, sql: sql, params: params });
}

export function initMateDatastoreUI(getWsFn) {
  wsGetter = getWsFn;
  panelEl = document.getElementById("mate-sidebar-datastore");
  tableListEl = document.getElementById("mate-db-table-list");
  tableNameEl = document.getElementById("mate-db-table-name");
  tableSchemaEl = document.getElementById("mate-db-table-schema");
  queryInputEl = document.getElementById("mate-db-query");
  paramsInputEl = document.getElementById("mate-db-params");
  resultEl = document.getElementById("mate-db-result");
  statusEl = document.getElementById("mate-db-status");
  dataBtnEl = document.getElementById("mate-data-btn");
  conversationsEl = document.getElementById("mate-sidebar-conversations");
  memoryEl = document.getElementById("mate-sidebar-memory");
  knowledgeEl = document.getElementById("mate-sidebar-knowledge");

  var refreshBtn = document.getElementById("mate-db-refresh-btn");
  var queryBtn = document.getElementById("mate-db-query-btn");
  var execBtn = document.getElementById("mate-db-exec-btn");
  var backBtn = document.getElementById("mate-db-back-btn");

  if (dataBtnEl) {
    dataBtnEl.addEventListener("click", function () {
      if (panelOpen) {
        setSectionVisibility(false);
      } else {
        setSectionVisibility(true);
        requestTables();
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      requestTables();
    });
  }

  if (queryBtn) {
    queryBtn.addEventListener("click", function () {
      sendQueryMessage("mate_db_query");
    });
  }

  if (execBtn) {
    execBtn.addEventListener("click", function () {
      sendQueryMessage("mate_db_exec");
    });
  }

  if (backBtn) {
    backBtn.addEventListener("click", function () {
      setSectionVisibility(false);
    });
  }

  setSectionVisibility(false);
}

export function showMateDatastorePanel() {
  setSectionVisibility(true);
  requestTables();
}

export function hideMateDatastorePanel() {
  setSectionVisibility(false);
}

export function handleMateDatastoreTablesResult(msg) {
  if (msg.ok === false) {
    renderStatus(msg.message || "Failed to load datastore tables.", "error");
    renderResult(msg);
    return;
  }
  renderStatus(msg.warning || "Datastore tables loaded.", msg.warning ? "warn" : "ok");
  renderTableList(msg.objects || []);
  if (msg.objects && msg.objects.length > 0) {
    var found = false;
    for (var i = 0; i < msg.objects.length; i++) {
      if (msg.objects[i].name === currentTable) {
        found = true;
        break;
      }
    }
    if (!found) {
      var firstObject = findFirstDescribableObject(msg.objects);
      if (firstObject) selectTable(firstObject.name);
    }
  }
  renderResult(msg.objects || []);
}

export function handleMateDatastoreDescribeResult(msg) {
  if (msg.ok === false) {
    renderStatus(msg.message || "Failed to describe table.", "error");
    renderResult(msg);
    return;
  }
  renderStatus(msg.warning || ("Described " + (msg.table || "table") + "."), msg.warning ? "warn" : "ok");
  if (tableNameEl) tableNameEl.textContent = msg.table || "Table";
  if (tableSchemaEl) tableSchemaEl.textContent = msg.createSql || "";
  renderResult(msg);
}

export function handleMateDatastoreQueryResult(msg) {
  if (msg.ok === false) {
    renderStatus(msg.message || "Query failed.", "error");
    renderResult(msg);
    return;
  }
  renderStatus(msg.warning || ("Returned " + (msg.rowCount || 0) + " row(s)."), msg.warning ? "warn" : "ok");
  renderResult(msg);
}

export function handleMateDatastoreExecResult(msg) {
  if (msg.ok === false) {
    renderStatus(msg.message || "Execution failed.", "error");
    renderResult(msg);
    return;
  }
  renderStatus(msg.warning || ("Applied " + (msg.changes || 0) + " change(s)."), msg.warning ? "warn" : "ok");
  renderResult(msg);
  requestTables();
}

export function handleMateDatastoreError(msg) {
  renderStatus(msg.message || "Mate datastore error.", "error");
  renderResult(msg);
}

export function handleMateDatastoreChange(msg) {
  renderStatus("Datastore changed.", "info");
  if (panelOpen) requestTables();
}
