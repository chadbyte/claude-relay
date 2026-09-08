// Shared Driver/Worker hierarchy behavior for the project desktop and mobile lists.

import { iconHtml } from './icons.js';
import { store } from './store.js';
import { buildSessionHierarchy } from './session-hierarchy.js';

var expansionBySurface = {
  desktop: new Map(),
  mobile: new Map(),
};

export function prepareSidebarHierarchy(sessions) {
  var hierarchy = buildSessionHierarchy(sessions);
  var byDriver = new Map();
  var sessionIds = new Set();
  for (var i = 0; i < hierarchy.roots.length; i++) {
    var root = hierarchy.roots[i];
    if (!root.workers.length) continue;
    byDriver.set(root.driver.id, root);
    sessionIds.add(root.driver.id);
    for (var j = 0; j < root.workers.length; j++) sessionIds.add(root.workers[j].id);
  }
  for (var k = 0; k < hierarchy.orphans.length; k++) sessionIds.add(hierarchy.orphans[k].id);
  return {
    byDriver: byDriver,
    orphans: hierarchy.orphans,
    sessionIds: sessionIds,
  };
}

export function currentWorkerIds() {
  var result = new Set();
  var groups = store.get('splitGroups') || [];
  for (var i = 0; i < groups.length; i++) {
    if (groups[i].pair && Number.isInteger(groups[i].pair.workerId)) result.add(groups[i].pair.workerId);
  }
  return result;
}

export function hierarchyItemMatches(item, matchIds) {
  if (matchIds === null) return true;
  if (item.type === "driver-hierarchy") {
    if (matchIds.has(item.root.driver.id)) return true;
    for (var i = 0; i < item.root.workers.length; i++) {
      if (matchIds.has(item.root.workers[i].id)) return true;
    }
    return false;
  }
  if (item.type === "orphan-workers") {
    for (var j = 0; j < item.workers.length; j++) {
      if (matchIds.has(item.workers[j].id)) return true;
    }
    return false;
  }
  return true;
}

export function isDesktopHierarchyToggleEvent(event) {
  return !!(event && event.target && typeof event.target.closest === "function" && event.target.closest(".session-driver-toggle"));
}

function expanded(surface, key, workers, matchIds) {
  var state = expansionBySurface[surface];
  if (state.has(key)) return state.get(key);
  return defaultHierarchyExpanded(workers, matchIds, currentWorkerIds());
}

export function defaultHierarchyExpanded(workers, matchIds, current) {
  var currentIds = current || new Set();
  for (var i = 0; i < workers.length; i++) {
    if (workers[i].active || currentIds.has(workers[i].id) || (matchIds !== null && matchIds.has(workers[i].id))) return true;
  }
  return false;
}

function toggle(surface, key, wasExpanded, rerender) {
  expansionBySurface[surface].set(key, !wasExpanded);
  rerender();
}

function visibleWorker(worker, driver, matchIds) {
  return matchIds === null || matchIds.has(worker.id) || matchIds.has(driver.id);
}

export function renderDesktopDriverHierarchy(root, renderSession, rerender, matchIds) {
  var wrapper = document.createElement("div");
  wrapper.className = "session-driver-hierarchy";
  var key = "driver:" + root.driver.id;
  var isExpanded = expanded("desktop", key, root.workers, matchIds);
  var childrenId = "session-workers-" + root.driver.id;
  var row = renderSession(root.driver);
  row.classList.add("session-driver-item");
  var control = document.createElement("button");
  control.type = "button";
  control.className = "session-driver-toggle";
  control.setAttribute("aria-expanded", String(isExpanded));
  control.setAttribute("aria-controls", childrenId);
  control.setAttribute("aria-label", (isExpanded ? "Collapse" : "Expand") + " Workers for " + (root.driver.title || "New Session"));
  control.innerHTML = iconHtml("chevron-right");
  var children = document.createElement("div");
  children.id = childrenId;
  children.className = "session-worker-children";
  children.setAttribute("role", "group");
  children.setAttribute("aria-label", "Workers for " + (root.driver.title || "New Session"));
  children.hidden = !isExpanded;
  control.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    var nextExpanded = !isExpanded;
    expansionBySurface.desktop.set(key, nextExpanded);
    control.setAttribute("aria-expanded", String(nextExpanded));
    control.setAttribute("aria-label", (nextExpanded ? "Collapse" : "Expand") + " Workers for " + (root.driver.title || "New Session"));
    children.hidden = !nextExpanded;
    isExpanded = nextExpanded;
  });
  row.insertBefore(control, row.firstChild);
  wrapper.appendChild(row);

  var current = currentWorkerIds();
  for (var i = 0; i < root.workers.length; i++) {
    if (!visibleWorker(root.workers[i], root.driver, matchIds)) continue;
    children.appendChild(renderSession(root.workers[i], { worker: true, current: current.has(root.workers[i].id) }));
  }
  wrapper.appendChild(children);
  return wrapper;
}

export function renderDesktopOrphanHierarchy(workers, renderSession, rerender, matchIds) {
  var wrapper = document.createElement("div");
  wrapper.className = "session-driver-hierarchy session-orphan-hierarchy";
  var isExpanded = expanded("desktop", "orphan", workers, matchIds);
  var control = document.createElement("button");
  control.type = "button";
  control.className = "session-orphan-toggle";
  control.setAttribute("aria-expanded", String(isExpanded));
  control.setAttribute("aria-controls", "session-orphan-workers");
  control.innerHTML = iconHtml("chevron-right") + '<span class="session-orphan-title">Unavailable Driver</span><span class="session-worker-count">' + workers.length + "</span>";
  control.addEventListener("click", function () { toggle("desktop", "orphan", isExpanded, rerender); });
  wrapper.appendChild(control);

  var children = document.createElement("div");
  children.id = "session-orphan-workers";
  children.className = "session-worker-children";
  children.setAttribute("role", "group");
  children.setAttribute("aria-label", "Workers whose Driver is unavailable");
  children.hidden = !isExpanded;
  var current = currentWorkerIds();
  for (var i = 0; i < workers.length; i++) {
    if (matchIds !== null && !matchIds.has(workers[i].id)) continue;
    children.appendChild(renderSession(workers[i], { worker: true, current: current.has(workers[i].id) }));
  }
  wrapper.appendChild(children);
  return wrapper;
}

export function renderMobileDriverHierarchy(root, renderSession, rerender) {
  var wrapper = document.createElement("div");
  wrapper.className = "mobile-driver-hierarchy";
  var key = "driver:" + root.driver.id;
  var isExpanded = expanded("mobile", key, root.workers, null);
  var childrenId = "mobile-session-workers-" + root.driver.id;
  var header = document.createElement("div");
  header.className = "mobile-driver-header";
  var control = document.createElement("button");
  control.type = "button";
  control.className = "mobile-driver-toggle";
  control.setAttribute("aria-expanded", String(isExpanded));
  control.setAttribute("aria-controls", childrenId);
  control.setAttribute("aria-label", (isExpanded ? "Collapse" : "Expand") + " Workers for " + (root.driver.title || "New Session"));
  control.innerHTML = iconHtml("chevron-right");
  control.addEventListener("click", function () { toggle("mobile", key, isExpanded, rerender); });
  header.appendChild(control);
  header.appendChild(renderSession(root.driver));
  wrapper.appendChild(header);

  var children = document.createElement("div");
  children.id = childrenId;
  children.className = "mobile-worker-children";
  children.setAttribute("role", "group");
  children.setAttribute("aria-label", "Workers for " + (root.driver.title || "New Session"));
  children.hidden = !isExpanded;
  var current = currentWorkerIds();
  for (var i = 0; i < root.workers.length; i++) {
    children.appendChild(renderSession(root.workers[i], { worker: true, current: current.has(root.workers[i].id) }));
  }
  wrapper.appendChild(children);
  return wrapper;
}

export function renderMobileOrphanHierarchy(workers, renderSession, rerender) {
  var wrapper = document.createElement("div");
  wrapper.className = "mobile-driver-hierarchy mobile-orphan-hierarchy";
  var isExpanded = expanded("mobile", "orphan", workers, null);
  var control = document.createElement("button");
  control.type = "button";
  control.className = "mobile-orphan-toggle";
  control.setAttribute("aria-expanded", String(isExpanded));
  control.setAttribute("aria-controls", "mobile-orphan-workers");
  control.innerHTML = iconHtml("chevron-right") + "<span>Unavailable Driver</span><span>" + workers.length + "</span>";
  control.addEventListener("click", function () { toggle("mobile", "orphan", isExpanded, rerender); });
  wrapper.appendChild(control);

  var children = document.createElement("div");
  children.id = "mobile-orphan-workers";
  children.className = "mobile-worker-children";
  children.setAttribute("role", "group");
  children.setAttribute("aria-label", "Workers whose Driver is unavailable");
  children.hidden = !isExpanded;
  var current = currentWorkerIds();
  for (var i = 0; i < workers.length; i++) {
    children.appendChild(renderSession(workers[i], { worker: true, current: current.has(workers[i].id) }));
  }
  wrapper.appendChild(children);
  return wrapper;
}
