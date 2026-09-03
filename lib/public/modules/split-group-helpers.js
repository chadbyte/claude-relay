export function groupedSessionIds(groups) {
  var ids = new Set();
  var list = groups || [];
  for (var i = 0; i < list.length; i++) {
    var members = list[i].members || [];
    for (var j = 0; j < members.length; j++) ids.add(members[j]);
  }
  return ids;
}

export function findSplitGroup(groups, memberIds) {
  var list = groups || [];
  for (var i = 0; i < list.length; i++) {
    var members = list[i].members || [];
    if (members.length === 2 && members[0] === memberIds[0] && members[1] === memberIds[1]) return list[i];
  }
  return null;
}

export function isConfiguredWorker(groups, sessionId) {
  var list = groups || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].pair && list[i].pair.workerId === sessionId) return true;
  }
  return false;
}
