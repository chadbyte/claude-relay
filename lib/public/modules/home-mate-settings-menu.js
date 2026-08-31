// Accessible row-local menu that opens the centered Mate settings dialog.

import { iconHtml, refreshIcons } from './icons.js';
import { openHomeMateSettings } from './home-mate-settings.js';

var menu = null;
var menuTrigger = null;

function getMateName(mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  return profile.displayName || (mate && (mate.displayName || mate.name)) || "Mate";
}

function positionMenu() {
  if (!menu || !menuTrigger || !menuTrigger.isConnected) return;
  var rect = menuTrigger.getBoundingClientRect();
  var menuRect = menu.getBoundingClientRect();
  var left = Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, rect.right - menuRect.width));
  var top = rect.bottom + 5;
  if (top + menuRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - menuRect.height - 5);
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function menuItems() {
  return menu ? menu.querySelectorAll('[role="menuitem"]') : [];
}

function closeMenu(returnFocus) {
  var trigger = menuTrigger;
  if (menu) menu.remove();
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  menu = null;
  menuTrigger = null;
  document.removeEventListener("pointerdown", handleMenuOutside, true);
  document.removeEventListener("keydown", handleMenuKeydown, true);
  window.removeEventListener("resize", closeMenuOnViewportChange);
  if (returnFocus && trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
}

function closeMenuOnViewportChange() {
  closeMenu(false);
}

function handleMenuOutside(event) {
  if (menu && !menu.contains(event.target) && event.target !== menuTrigger) closeMenu(false);
}

function handleMenuKeydown(event) {
  if (!menu) return;
  var items = menuItems();
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  var current = Array.prototype.indexOf.call(items, document.activeElement);
  var next = 0;
  if (event.key === "End") next = items.length - 1;
  else if (event.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
  else if (event.key === "ArrowDown") next = current < 0 || current === items.length - 1 ? 0 : current + 1;
  if (items[next]) items[next].focus();
}

function openMenu(trigger, mate) {
  closeMenu(false);
  menuTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  menu = document.createElement("div");
  menu.className = "home-mate-row-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Actions for " + getMateName(mate));
  var settings = document.createElement("button");
  settings.type = "button";
  settings.className = "home-mate-row-menu-item";
  settings.setAttribute("role", "menuitem");
  settings.innerHTML = iconHtml("settings-2") + "<span>Mate settings</span>";
  settings.addEventListener("click", function (event) {
    event.stopPropagation();
    var opener = trigger;
    closeMenu(false);
    openHomeMateSettings(mate.id, opener);
  });
  menu.appendChild(settings);
  document.body.appendChild(menu);
  refreshIcons();
  requestAnimationFrame(function () {
    positionMenu();
    settings.focus({ preventScroll: true });
  });
  document.addEventListener("pointerdown", handleMenuOutside, true);
  document.addEventListener("keydown", handleMenuKeydown, true);
  window.addEventListener("resize", closeMenuOnViewportChange);
}

export function createHomeMateSettingsTrigger(mate) {
  var trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "home-mate-list-overflow";
  trigger.dataset.homeMateId = mate.id;
  trigger.setAttribute("aria-label", "Actions for " + getMateName(mate));
  trigger.setAttribute("title", "Mate actions");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = '<span class="home-mate-list-overflow-mark" aria-hidden="true">•••</span>';
  trigger.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (menu && menuTrigger === trigger) closeMenu(false);
    else openMenu(trigger, mate);
  });
  trigger.addEventListener("keydown", function (event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(trigger, mate);
    requestAnimationFrame(function () {
      var items = menuItems();
      if (!items.length) return;
      items[event.key === "ArrowUp" || event.key === "End" ? items.length - 1 : 0].focus();
    });
  });
  return trigger;
}

export function disposeHomeMateSettingsMenu() {
  closeMenu(false);
}
