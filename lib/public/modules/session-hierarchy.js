// Pure projection shared by desktop, mobile and Home session lists.

export function buildSessionHierarchy(sessions) {
  var source = Array.isArray(sessions) ? sessions : [];
  var byId = new Map();
  var workersByParent = new Map();
  var roots = [];
  var orphans = [];
  for (var i = 0; i < source.length; i++) byId.set(nodeId(source[i]), source[i]);
  for (var j = 0; j < source.length; j++) {
    var session = source[j];
    if (session.sessionRole !== "worker") {
      roots.push({ driver: session, workers: [] });
      continue;
    }
    var parent = session.parentAvailable ? byId.get(parentNodeId(session)) : null;
    if (!parent || parent.sessionRole === "worker") {
      orphans.push(session);
      continue;
    }
    if (!workersByParent.has(nodeId(parent))) workersByParent.set(nodeId(parent), []);
    workersByParent.get(nodeId(parent)).push(session);
  }
  for (var k = 0; k < roots.length; k++) {
    roots[k].workers = workersByParent.get(nodeId(roots[k].driver)) || [];
    roots[k].workers.sort(compareWorkers);
    roots[k].lastActivity = latestActivity(roots[k]);
  }
  orphans.sort(compareWorkers);
  return { roots: roots, orphans: orphans };
}

function nodeId(session) {
  return session && session.hierarchyId != null ? session.hierarchyId : session.id;
}

function parentNodeId(session) {
  return session && session.parentHierarchyId != null ? session.parentHierarchyId : session.parentSessionId;
}

function compareWorkers(a, b) {
  var ag = typeof a.workerGeneration === "number" ? a.workerGeneration : 0;
  var bg = typeof b.workerGeneration === "number" ? b.workerGeneration : 0;
  if (ag !== bg) return bg - ag;
  return (b.lastActivity || 0) - (a.lastActivity || 0);
}

export function latestActivity(root) {
  var latest = root.driver.lastActivity || 0;
  for (var i = 0; i < root.workers.length; i++) {
    if ((root.workers[i].lastActivity || 0) > latest) latest = root.workers[i].lastActivity || 0;
  }
  return latest;
}
