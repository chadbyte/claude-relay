// Compact online-user presence renderer for the project sidebar.

import { userAvatarUrl } from './avatar.js';

var lastSidebarPresenceIds = [];

export function renderSidebarPresence(onlineUsers) {
  var container = document.getElementById("sidebar-presence");
  if (!container) return;
  if (!onlineUsers || onlineUsers.length < 2) {
    if (lastSidebarPresenceIds.length > 0) {
      lastSidebarPresenceIds = [];
      container.innerHTML = "";
    }
    return;
  }
  var newIds = onlineUsers.map(function (user) { return user.id; }).sort();
  if (newIds.length === lastSidebarPresenceIds.length && newIds.every(function (id, index) { return id === lastSidebarPresenceIds[index]; })) return;
  lastSidebarPresenceIds = newIds;
  container.innerHTML = "";
  var maxShow = 4;
  for (var i = 0; i < Math.min(onlineUsers.length, maxShow); i++) {
    var user = onlineUsers[i];
    var image = document.createElement("img");
    image.className = "sidebar-presence-avatar";
    image.src = userAvatarUrl(user, 24);
    image.alt = user.displayName;
    image.dataset.tip = user.displayName + " (@" + user.username + ")";
    container.appendChild(image);
  }
  if (onlineUsers.length > maxShow) {
    var more = document.createElement("span");
    more.className = "sidebar-presence-more";
    more.textContent = "+" + (onlineUsers.length - maxShow);
    container.appendChild(more);
  }
}
