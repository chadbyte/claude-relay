import { escapeHtml } from './utils.js';
import { refreshIcons } from './icons.js';
import { getWs } from './ws-ref.js';

var wsGetter = null;
var panelEl = null;
var tableListEl = null;
var tableNameEl = null;
var tableSchemaEl = null;
var resultEl = null;
var statusEl = null;
var dataBtnEl = null;
var mainColumnEl = null;
var currentTables = [];
var currentTable = null;
var panelOpen = false;
var routingToScheduler = false;

function sendWs(msg) {
  var ws = wsGetter ? wsGetter() : getWs();
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function quoteIdentifier(name) {
  return '"' + String(name || "").replace(/"/g, '""') + '"';
}

function ensurePanel() {
  if (panelEl) return;
  mainColumnEl = document.getElementById("main-column");
  if (!mainColumnEl) return;

  panelEl = document.createElement("div");
  panelEl.id = "mate-datastore-panel";
  panelEl.className = "hidden";

  panelEl.innerHTML =
    '<div class="scheduler-top-bar mate-datastore-top-bar">' +
      '<span class="scheduler-top-title mate-datastore-top-title"><i data-lucide="database"></i>Data</span>' +
      '<div class="mate-datastore-top-actions">' +
        '<button id="mate-db-refresh-btn" class="scheduler-close-btn" type="button" title="Refresh tables"><i data-lucide="refresh-cw"></i></button>' +
        '<button id="mate-db-back-btn" class="scheduler-close-btn" type="button" title="Close"><i data-lucide="x"></i></button>' +
      '</div>' +
    '</div>' +
    '<div class="mate-db-status" id="mate-db-status"></div>' +
    '<div class="mate-db-layout">' +
      '<div class="mate-db-table-column">' +
        '<div class="mate-db-section-title">Objects</div>' +
        '<div id="mate-db-table-list" class="mate-db-table-list"></div>' +
      '</div>' +
      '<div class="mate-db-detail">' +
        '<div class="mate-db-section-title" id="mate-db-table-name">No table selected</div>' +
        '<pre id="mate-db-table-schema" class="mate-db-table-schema"></pre>' +
        '<div class="mate-db-section-title">Rows</div>' +
        '<pre id="mate-db-result" class="mate-db-result"></pre>' +
      '</div>' +
    '</div>';

  mainColumnEl.appendChild(panelEl);
  tableListEl = document.getElementById("mate-db-table-list");
  tableNameEl = document.getElementById("mate-db-table-name");
  tableSchemaEl = document.getElementById("mate-db-table-schema");
  resultEl = document.getElementById("mate-db-result");
  statusEl = document.getElementById("mate-db-status");

  var refreshBtn = document.getElementById("mate-db-refresh-btn");
  var backBtn = document.getElementById("mate-db-back-btn");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      requestTables();
    });
  }

  if (backBtn) {
    backBtn.addEventListener("click", function () {
      setSectionVisibility(false);
    });
  }

  refreshIcons();
}

function setSectionVisibility(open) {
  ensurePanel();
  panelOpen = open;
  if (panelEl) panelEl.classList.toggle("hidden", !open);
  if (mainColumnEl) mainColumnEl.classList.toggle("mate-datastore-open", open);
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

function formatColumns(columns) {
  var list = Array.isArray(columns) ? columns : [];
  if (!list.length) return "No column information available.";
  var lines = [];
  for (var i = 0; i < list.length; i++) {
    var col = list[i] || {};
    var line = (col.name || "?") + " " + (col.type || "");
    if (col.pk) line += " PRIMARY KEY";
    if (col.notnull) line += " NOT NULL";
    if (typeof col.dflt_value !== "undefined" && col.dflt_value !== null) line += " DEFAULT " + col.dflt_value;
    lines.push(line.trim());
  }
  return lines.join("\n");
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
    if (tableSchemaEl) tableSchemaEl.textContent = (obj.type || "object") + ": " + tableName;
    renderResult(obj);
    return;
  }
  renderStatus("Loading " + tableName + "...", "info");
  sendWs({ type: "mate_db_describe", table: tableName });
  sendWs({ type: "mate_db_query", sql: "SELECT * FROM " + quoteIdentifier(tableName) + " LIMIT 100", params: [] });
}

export function initMateDatastoreUI(getWsFn) {
  wsGetter = getWsFn;
  dataBtnEl = document.getElementById("mate-data-btn");
  if (!dataBtnEl) return;

  dataBtnEl.addEventListener("click", function () {
    if (panelOpen) {
      setSectionVisibility(false);
    } else {
      setSectionVisibility(true);
      requestTables();
    }
  });

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("#scheduler-btn, #mate-scheduler-btn") : null;
    if (!btn || !panelOpen || routingToScheduler) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    routingToScheduler = true;
    setSectionVisibility(false);
    setTimeout(function () {
      var schedulerBtn = document.getElementById("scheduler-btn");
      if (schedulerBtn) schedulerBtn.click();
      routingToScheduler = false;
    }, 0);
  }, true);

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
  if (tableSchemaEl) tableSchemaEl.textContent = formatColumns(msg.columns);
}

export function handleMateDatastoreQueryResult(msg) {
  if (msg.ok === false) {
    renderStatus(msg.message || "Query failed.", "error");
    renderResult(msg);
    return;
  }
  var status = "Showing " + (msg.rows ? msg.rows.length : 0) + " row(s).";
  if (msg.truncated) status = status.replace(".", " (truncated).");
  renderStatus(msg.warning || status, msg.warning ? "warn" : "ok");
  renderResult(msg.rows || []);
}

export function handleMateDatastoreError(msg) {
  renderStatus(msg.message || "Mate datastore error.", "error");
  renderResult(msg);
}

export function handleMateDatastoreChange(msg) {
  renderStatus("Datastore changed.", "info");
  if (panelOpen) requestTables();
}
