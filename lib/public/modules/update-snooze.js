// Snooze control for the update-available banner.
//
// Lives outside app-notifications.js so the banner module does not grow
// further, and because this is a self-contained concern: one compact menu, one
// message out, one message in.
//
// The client decides nothing. It sends an allowlisted duration key and, as a
// hint only, the browser's UTC offset so "Tomorrow" lands on the user's
// morning rather than the server's. The deadline, the target version and the
// user identity are all resolved server-side, so a tampered payload can only
// ever produce a refusal or a shorter snooze.

import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';

// Must match SNOOZE_OPTIONS in lib/update-snooze.js. The server re-validates
// every key, so this list is presentation, not policy.
var SNOOZE_CHOICES = [
  { id: "3h", label: "3 hours" },
  { id: "8h", label: "8 hours" },
  { id: "tomorrow", label: "Tomorrow" },
];

var openMenu = null;
var bannerRemover = null;

// app-notifications.js owns banner teardown (it runs the exit animation and
// keeps the clear-all button in sync). Registering the remover here keeps the
// dependency one-way, so the two modules never form a cycle.
export function setSnoozeBannerRemover(fn) {
  bannerRemover = typeof fn === "function" ? fn : null;
}

export function isSnoozeChoice(id) {
  for (var i = 0; i < SNOOZE_CHOICES.length; i++) {
    if (SNOOZE_CHOICES[i].id === id) return true;
  }
  return false;
}

function closeMenu() {
  if (!openMenu) return;
  var trigger = openMenu.trigger;
  if (openMenu.menu && openMenu.menu.parentNode) {
    openMenu.menu.parentNode.removeChild(openMenu.menu);
  }
  openMenu = null;
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function sendSnooze(duration) {
  if (!isSnoozeChoice(duration)) return;
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  // A hint, not an instruction: the server validates the range, computes the
  // instant itself, and clamps the result to its own maximum.
  var offset = -new Date().getTimezoneOffset();
  ws.send(JSON.stringify({ type: "update_snooze", duration: duration, tzOffsetMinutes: offset }));
}

function buildMenu(trigger) {
  var menu = document.createElement("div");
  menu.className = "notif-banner-snooze-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Snooze this update");

  for (var i = 0; i < SNOOZE_CHOICES.length; i++) {
    (function (choice) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "notif-banner-snooze-item";
      item.setAttribute("role", "menuitem");
      item.textContent = choice.label;
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        closeMenu();
        sendSnooze(choice.id);
      });
      menu.appendChild(item);
    })(SNOOZE_CHOICES[i]);
  }

  // Roving focus with the arrow keys, Escape back to the trigger. Enough for a
  // three-item menu to be usable without a pointer.
  menu.addEventListener("keydown", function (e) {
    var items = menu.querySelectorAll(".notif-banner-snooze-item");
    var index = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i] === document.activeElement) { index = i; break; }
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      var next = e.key === "ArrowDown" ? index + 1 : index - 1;
      if (next < 0) next = items.length - 1;
      if (next >= items.length) next = 0;
      if (items[next]) items[next].focus();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      if (trigger) trigger.focus();
    }
  });

  return menu;
}

// Append a compact Snooze control to an existing update banner's action row.
// Reuses the banner's own button shape rather than introducing a new one.
export function attachSnoozeControl(actionsEl) {
  if (!actionsEl) return null;

  var wrap = document.createElement("div");
  wrap.className = "notif-banner-snooze";

  var trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "notif-banner-snooze-btn";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", "Snooze this update notification");
  trigger.innerHTML = iconHtml("clock") + "<span>Snooze</span>";

  trigger.addEventListener("click", function (e) {
    e.stopPropagation();
    if (openMenu && openMenu.trigger === trigger) {
      closeMenu();
      return;
    }
    closeMenu();
    var menu = buildMenu(trigger);
    wrap.appendChild(menu);
    openMenu = { menu: menu, trigger: trigger };
    trigger.setAttribute("aria-expanded", "true");
    var first = menu.querySelector(".notif-banner-snooze-item");
    if (first) first.focus();
  });

  wrap.appendChild(trigger);
  actionsEl.appendChild(wrap);
  refreshIcons();
  return wrap;
}

// The server confirms a snooze to every device of that user, so each one drops
// the banner rather than only the device the user acted on.
export function handleUpdateSnoozed(msg) {
  closeMenu();
  if (!msg || !msg.ok) return;
  var banner = document.querySelector('.notif-banner[data-notif-id="_update"]');
  if (!banner) return;
  if (msg.version && banner.getAttribute("data-update-version") !== msg.version) return;
  if (bannerRemover) bannerRemover(banner);
  else if (banner.parentNode) banner.parentNode.removeChild(banner);
}

// Dismiss on click-away, blur, or a viewport change so the menu never lingers
// invisibly. Registered defensively because importing this module must stay
// side-effect-safe: several suites load the client graph against a partial
// document/window stub, and a dismiss convenience must not be what breaks them.
function onGlobal(target, name, fn) {
  if (target && typeof target.addEventListener === "function") target.addEventListener(name, fn);
}

onGlobal(typeof document !== "undefined" ? document : null, "click", function () { closeMenu(); });
onGlobal(typeof window !== "undefined" ? window : null, "blur", function () { closeMenu(); });
onGlobal(typeof window !== "undefined" ? window : null, "resize", function () { closeMenu(); });
