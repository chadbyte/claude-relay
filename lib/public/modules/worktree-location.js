export function isExternalWorktree(project) {
  return !!(project && project.isWorktree && project.worktreeExternal === true);
}

export function externalWorktreeTooltip(name) {
  return name + " — outside the main project folder";
}

export function appendExternalWorktreeBadge(container, className) {
  var badge = document.createElement("span");
  badge.className = className;
  badge.setAttribute("role", "img");
  badge.setAttribute("aria-label", "Outside the main project folder");
  badge.innerHTML = '<i data-lucide="external-link"></i>';
  container.appendChild(badge);
  return badge;
}
