// Shared Mate profile and removal flows used by project and Home surfaces.

import { getWs } from './ws-ref.js';
import { showMateProfilePopover } from './profile.js';
import { showConfirm } from './app-misc.js';
import { iconHtml, refreshIcons } from './icons.js';

var mateMenu = null;

function send(message) {
  var ws = getWs();
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
}

export function editMateProfile(anchorEl, mate) {
  if (!anchorEl || !mate || mate.primary) return;
  showMateProfilePopover(anchorEl, mate, function (updates) {
    send({ type: "mate_update", mateId: mate.id, updates: updates });
  });
}

export function confirmMateRemoval(anchorEl, mate, onRemoved) {
  if (!anchorEl || !mate || mate.primary) return;
  showConfirm(
    mate.builtinKey ? "Remove this mate? You can restore it from the home switcher." : "Delete this mate permanently?",
    function () {
      if (onRemoved) onRemoved();
      send({ type: "mate_delete", mateId: mate.id });
    },
    mate.builtinKey ? "Remove" : "Delete",
    true
  );
}

export function closeMateManagementMenu() {
  if (mateMenu) mateMenu.remove();
  mateMenu = null;
  document.removeEventListener("click", handleMateMenuOutside, true);
}

function handleMateMenuOutside(event) {
  if (mateMenu && !mateMenu.contains(event.target)) closeMateManagementMenu();
}

export function showMateManagementMenu(anchorEl, mate, options) {
  if (!anchorEl || !mate || mate.primary) return;
  options = options || {};
  closeMateManagementMenu();
  if (options.beforeOpen) options.beforeOpen();
  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";
  var edit = document.createElement("button");
  edit.className = "project-ctx-item";
  edit.innerHTML = iconHtml("edit-2") + " <span>Edit Profile</span>";
  edit.addEventListener("click", function (event) {
    event.stopPropagation();
    closeMateManagementMenu();
    editMateProfile(anchorEl, mate);
  });
  var remove = document.createElement("button");
  remove.className = "project-ctx-item project-ctx-delete";
  remove.innerHTML = iconHtml(mate.builtinKey ? "minus-circle" : "trash-2")
    + " <span>" + (mate.builtinKey ? "Remove mate" : "Delete mate") + "</span>";
  remove.addEventListener("click", function (event) {
    event.stopPropagation();
    closeMateManagementMenu();
    confirmMateRemoval(anchorEl, mate, options.onRemoved);
  });
  menu.appendChild(edit);
  menu.appendChild(remove);
  document.body.appendChild(menu);
  mateMenu = menu;
  refreshIcons();
  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = (rect.right + 6) + "px";
    menu.style.top = rect.top + "px";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) menu.style.left = (rect.left - menuRect.width - 6) + "px";
    if (menuRect.bottom > window.innerHeight - 8) menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
  });
  setTimeout(function () {
    document.addEventListener("click", handleMateMenuOutside, true);
  }, 0);
}
