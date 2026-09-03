// tool-palette-overlays.js — transient overlays that sit on top of the palette.
//
// Two independent, self-contained pieces extracted from tool-palette.js so
// that module stays under the size limit: the right-click context menu, and
// the Cmd/Ctrl+O hotkey pick mode. Neither owns palette state; the menu takes
// its items (and their actions) from the caller, and pick mode works purely
// off the rendered tiles. Behavior is unchanged by the move.

import { PALETTES } from './tool-palette-order.js';

// --- Right-click context menu ---

var _openMenu = null;

export function openPaletteContextMenu(x, y, items) {
  closePaletteContextMenu();
  var menu = document.createElement('div');
  menu.className = 'tool-palette-ctx-menu';
  for (var i = 0; i < items.length; i++) {
    (function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-palette-ctx-item';
      btn.textContent = item.label;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        closePaletteContextMenu();
        item.action();
      });
      menu.appendChild(btn);
    })(items[i]);
  }
  document.body.appendChild(menu);
  // Clamp to viewport.
  var rect = menu.getBoundingClientRect();
  var px = x, py = y;
  if (px + rect.width > window.innerWidth - 4) px = window.innerWidth - rect.width - 4;
  if (py + rect.height > window.innerHeight - 4) py = window.innerHeight - rect.height - 4;
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
  _openMenu = menu;
}

export function closePaletteContextMenu() {
  if (_openMenu && _openMenu.parentNode) _openMenu.parentNode.removeChild(_openMenu);
  _openMenu = null;
}

document.addEventListener('click', function () { closePaletteContextMenu(); });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closePaletteContextMenu();
});
window.addEventListener('blur', function () { closePaletteContextMenu(); });
window.addEventListener('resize', function () { closePaletteContextMenu(); });

// --- Hotkey overlay (Cmd/Ctrl + O) ---
//
// Press Cmd/Ctrl + O to reveal a hotkey badge on each visible palette
// tile. Then press the shown digit (1..9, 0) or letter (a..z) to
// activate that tool. Escape or clicking away dismisses. Inspired by
// Vimium / Superhuman-style "pick a tile with one keystroke" flows.

var _pickActive = false;
var HOTKEYS = (function () {
  var k = [];
  for (var i = 1; i <= 9; i++) k.push(String(i));
  k.push('0');
  for (var c = 97; c <= 122; c++) k.push(String.fromCharCode(c));
  return k;
})();

function getVisiblePaletteName() {
  // offsetParent is null when the element (or an ancestor) is hidden.
  var mateActive = document.getElementById('mate-sidebar-tools');
  if (mateActive && mateActive.offsetParent !== null) return 'mate';
  var sessionActive = document.getElementById('session-actions');
  if (sessionActive && sessionActive.offsetParent !== null) return 'session';
  return null;
}

export function enterToolPickMode() {
  if (_pickActive) return;
  var name = getVisiblePaletteName();
  if (!name) return;
  var active = document.getElementById(PALETTES[name].activeContainerId);
  if (!active) return;
  var tiles = active.querySelectorAll('[data-tool-id]');
  if (tiles.length === 0) return;
  for (var i = 0; i < tiles.length && i < HOTKEYS.length; i++) {
    var key = HOTKEYS[i];
    tiles[i].dataset.hotkey = key;
    var badge = document.createElement('span');
    badge.className = 'tool-palette-hotkey-badge';
    badge.textContent = key.toUpperCase();
    tiles[i].appendChild(badge);
  }
  _pickActive = true;
}

export function exitToolPickMode() {
  if (!_pickActive) return;
  _pickActive = false;
  var badges = document.querySelectorAll('.tool-palette-hotkey-badge');
  for (var i = 0; i < badges.length; i++) {
    if (badges[i].parentNode) badges[i].parentNode.removeChild(badges[i]);
  }
  var marked = document.querySelectorAll('[data-hotkey]');
  for (var j = 0; j < marked.length; j++) {
    delete marked[j].dataset.hotkey;
  }
}

// Capture phase so we reliably preempt typing and browser shortcuts
// when focus is in an input.
document.addEventListener('keydown', function (e) {
  // Pick mode: consume the next printable key.
  if (_pickActive) {
    if (e.key === 'Escape') {
      e.preventDefault();
      exitToolPickMode();
      return;
    }
    // Ignore modifier-only keys; react to single-character keys.
    if (e.key.length !== 1) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var key = e.key.toLowerCase();
    var tile = document.querySelector('[data-hotkey="' + key + '"]');
    if (tile) {
      e.preventDefault();
      exitToolPickMode();
      tile.click();
    } else {
      // Unknown key exits pick mode without triggering a tile.
      exitToolPickMode();
    }
    return;
  }

  // Enter pick mode on Cmd/Ctrl + O (letter O). Intercepted globally
  // including inside text inputs — the browser's native Cmd+O is a
  // file-picker dialog Clay never wants, so taking it over costs the
  // user nothing and is especially useful when jumping to a tool from
  // the session search box.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key && e.key.toLowerCase() === 'o') {
    if (!getVisiblePaletteName()) return;
    e.preventDefault();
    enterToolPickMode();
  }
}, true);

// Dismiss the overlay on click-away, blur, or viewport changes so it
// never lingers invisibly.
document.addEventListener('click', function () { if (_pickActive) exitToolPickMode(); });
window.addEventListener('blur', function () { if (_pickActive) exitToolPickMode(); });
window.addEventListener('resize', function () { if (_pickActive) exitToolPickMode(); });

export function isToolPickActive() {
  return _pickActive;
}
