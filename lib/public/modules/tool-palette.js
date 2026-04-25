// tool-palette.js — Customizable sidebar tool palette
//
// Renders the per-session and per-mate tool grids from a data registry,
// so users can reorder tools and hide ones they don't use. Preserves the
// original button IDs so existing click handlers (attached by sidebar.js,
// terminal.js, mcp-ui.js, etc.) keep working on the rendered nodes.
//
// Design notes (see issue #325 for the broader context):
// - Buttons are created once on init and never destroyed; hide/reorder
//   moves existing DOM nodes, so event listeners bound elsewhere survive.
// - Edit mode is a state on the palette container (class="edit-mode").
//   CSS shows the × remove affordance and enables drag reordering.
// - Preferences persist per-user via the /api/user/tool-palettes endpoint.
//   An in-flight save is debounced so rapid drag reorders don't spam.

import { refreshIcons } from './icons.js';

// Registry order = default order for users who haven't customized. Users
// with saved preferences keep their own order (applyPreferences uses
// saved order first, then appends any registry entries the user's saved
// list doesn't mention). So changes here only affect fresh palettes.
var SESSION_TOOLS = [
  { id: "file-browser-btn",        icon: "folder-tree",    label: "File browser" },
  { id: "terminal-sidebar-btn",    icon: "square-terminal", label: "Terminal",        countId: "terminal-sidebar-count" },
  { id: "sticky-notes-sidebar-btn", icon: "sticky-note",   label: "Sticky Notes",    countId: "sticky-notes-sidebar-count" },
  { id: "scheduler-btn",           icon: "calendar-clock", label: "Scheduled Tasks" },
  { id: "loop-tool-btn",           icon: "repeat",         label: "Loop" },
  { id: "email-sidebar-btn",       icon: "mail",           label: "Email" },
  { id: "mcp-btn",                 icon: "cable",          label: "MCP Servers",     countId: "mcp-sidebar-count" },
  { id: "skills-btn",              icon: "puzzle",         label: "Skills" },
];

var MATE_TOOLS = [
  { id: "mate-memory-btn",       icon: "brain",          label: "Memory",          countId: "mate-memory-count" },
  { id: "mate-knowledge-btn",    icon: "book-open",      label: "Knowledge",       countId: "mate-knowledge-count" },
  { id: "mate-sticky-notes-btn", icon: "sticky-note",    label: "Sticky Notes" },
  { id: "mate-scheduler-btn",    icon: "calendar-clock", label: "Scheduled Tasks" },
  { id: "mate-debate-btn",       icon: "mic",            label: "Debate" },
  { id: "mate-email-btn",        icon: "mail",           label: "Email" },
  { id: "mate-mcp-btn",          icon: "cable",          label: "MCP Servers",     countId: "mate-mcp-sidebar-count" },
  { id: "mate-skills-btn",       icon: "puzzle",         label: "Skills" },
];

var PALETTES = {
  session: {
    tools: SESSION_TOOLS,
    activeContainerId: "session-actions",
    hiddenSectionId: "session-actions-hidden",
  },
  mate: {
    tools: MATE_TOOLS,
    activeContainerId: "mate-sidebar-tools",
    hiddenSectionId: "mate-sidebar-tools-hidden",
  },
};

var _saveTimers = {};
var _draggingEl = null;
var _draggingPaletteName = null;

export function initToolPalettes() {
  for (var name in PALETTES) {
    buildPalette(name);
  }

  // Edit pills toggle edit mode on their associated palette.
  var editBtns = document.querySelectorAll('.tool-palette-edit-btn');
  for (var i = 0; i < editBtns.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        toggleEditMode(btn.dataset.palette);
      });
    })(editBtns[i]);
  }

  // Keyboard-hotkey hint pill. Matches the icon-strip shortcut pills
  // in shape — just the chord, no prose. Clicking the pill opens the
  // hotkey overlay, same as pressing the shortcut.
  var isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
  var hintLabel = isMac ? '\u2318O' : 'Ctrl+O';
  var hints = document.querySelectorAll('.sidebar-tools-hint');
  for (var h = 0; h < hints.length; h++) {
    hints[h].textContent = hintLabel;
    hints[h].title = 'Show keyboard hotkeys (' + hintLabel + ')';
    hints[h].addEventListener('click', function (e) {
      // Stop the click from bubbling to the document-level dismiss
      // handler below, which would immediately tear down the pick-mode
      // we just entered.
      e.stopPropagation();
      if (_pickActive) exitToolPickMode();
      else enterToolPickMode();
    });
  }

  // Load saved preferences and apply to both palettes once buttons exist.
  loadPreferences();

  refreshIcons();
}

function buildPalette(name) {
  var palette = PALETTES[name];
  var active = document.getElementById(palette.activeContainerId);
  if (!active) return;

  // Create buttons with stable IDs and append in registry order (default).
  for (var i = 0; i < palette.tools.length; i++) {
    active.appendChild(buildToolButton(palette.tools[i], name));
  }

  // Scaffold the hidden section (its grid fills in when items are hidden).
  var hiddenSection = document.getElementById(palette.hiddenSectionId);
  if (hiddenSection) {
    hiddenSection.innerHTML = '';
    var labelEl = document.createElement('div');
    labelEl.className = 'tool-palette-hidden-label';
    labelEl.textContent = 'Add back';
    var gridEl = document.createElement('div');
    gridEl.className = 'tool-palette-hidden-grid';
    hiddenSection.appendChild(labelEl);
    hiddenSection.appendChild(gridEl);
  }

  // Drag-reorder within the active container. Works in both normal and
  // edit mode so users can rearrange without entering a separate mode
  // (matches the macOS dock pattern). HTML5 drag has a small movement
  // threshold, so quick clicks still activate the tool normally.
  active.addEventListener('dragover', function (e) {
    if (_draggingPaletteName !== name || !_draggingEl) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    var after = getDragAfterElement(active, e.clientX, e.clientY);
    if (after == null) {
      if (_draggingEl.parentNode !== active || _draggingEl.nextSibling) {
        active.appendChild(_draggingEl);
      }
    } else if (after !== _draggingEl) {
      active.insertBefore(_draggingEl, after);
    }
  });
  active.addEventListener('drop', function (e) {
    if (_draggingPaletteName !== name) return;
    e.preventDefault();
  });
}

function buildToolButton(tool, paletteName) {
  var btn = document.createElement('button');
  btn.id = tool.id;
  btn.type = 'button';
  btn.className = 'palette-tile';
  btn.title = tool.label;
  btn.setAttribute('aria-label', tool.label);
  btn.dataset.toolId = tool.id;
  btn.dataset.palette = paletteName;
  // Draggable at all times so users can reorder without entering edit
  // mode. Drag is gated to the active grid in the handlers below; tiles
  // in the hidden grid get draggable=false set on move.
  btn.draggable = true;

  var icon = document.createElement('i');
  icon.setAttribute('data-lucide', tool.icon);
  btn.appendChild(icon);

  var labelEl = document.createElement('span');
  labelEl.className = 'tool-btn-label';
  labelEl.textContent = tool.label;
  btn.appendChild(labelEl);

  if (tool.countId) {
    var count = document.createElement('span');
    count.id = tool.countId;
    count.className = 'sidebar-badge hidden';
    btn.appendChild(count);
  }

  // × affordance — shown only in edit mode via CSS.
  var remove = document.createElement('span');
  remove.className = 'tool-palette-remove';
  remove.setAttribute('role', 'button');
  remove.setAttribute('aria-label', 'Remove ' + tool.label + ' from palette');
  remove.textContent = '\u00D7';
  btn.appendChild(remove);

  // Click interceptor, registered before any other module attaches to
  // the button by ID. stopImmediatePropagation prevents the tool's own
  // handler from running in three cases: clicking the × in edit mode,
  // clicking a tile in the hidden-grid (which should restore it), and
  // clicking any tile while edit mode is active (tiles are inert then).
  btn.addEventListener('click', function (e) {
    if (e.target.closest('.tool-palette-remove')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      moveToHidden(paletteName, tool.id);
      return;
    }
    var container = btn.parentNode;
    if (!container) return;
    if (container.classList.contains('tool-palette-hidden-grid')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      moveToActive(paletteName, tool.id);
      return;
    }
    if (container.classList.contains('edit-mode')) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });

  btn.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var container = btn.parentNode;
    var inHidden = container && container.classList.contains('tool-palette-hidden-grid');
    openPaletteContextMenu(e.clientX, e.clientY, inHidden ? [
      { label: 'Add back to palette', action: function () { moveToActive(paletteName, tool.id); } },
    ] : [
      { label: 'Remove from palette', action: function () { moveToHidden(paletteName, tool.id); } },
      { label: 'Edit palette\u2026', action: function () {
          if (!document.getElementById(PALETTES[paletteName].activeContainerId).classList.contains('edit-mode')) {
            toggleEditMode(paletteName);
          }
        } },
    ]);
  });

  btn.addEventListener('dragstart', function (e) {
    var container = btn.parentNode;
    // Only allow drag from the active grid; hidden tiles are added back
    // via click, not drag.
    if (!container || container.id !== PALETTES[paletteName].activeContainerId) {
      e.preventDefault();
      return;
    }
    _draggingEl = btn;
    _draggingPaletteName = paletteName;
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires data to be set for drag to start.
    try { e.dataTransfer.setData('text/plain', tool.id); } catch (err) { /* ignore */ }
    btn.classList.add('dragging');
  });
  btn.addEventListener('dragend', function () {
    btn.classList.remove('dragging');
    if (_draggingPaletteName) queueSave(_draggingPaletteName);
    _draggingEl = null;
    _draggingPaletteName = null;
  });

  return btn;
}

function toggleEditMode(name) {
  var palette = PALETTES[name];
  if (!palette) return;
  var active = document.getElementById(palette.activeContainerId);
  var hidden = document.getElementById(palette.hiddenSectionId);
  var editBtn = document.querySelector('.tool-palette-edit-btn[data-palette="' + name + '"]');
  if (!active || !editBtn) return;

  var entering = !active.classList.contains('edit-mode');
  active.classList.toggle('edit-mode', entering);
  if (hidden) {
    // Show hidden-section in edit mode if any items exist there (or to
    // allow adding back even when empty, keep visible so the state is
    // legible). We show whenever edit mode is on.
    hidden.classList.toggle('hidden', !entering);
  }
  // Pencil icon stays; the .active class provides visual feedback by
  // swapping to the accent background. No label text swap needed now.
  editBtn.classList.toggle('active', entering);

  if (!entering) queueSave(name);
}

function moveToHidden(name, toolId) {
  var palette = PALETTES[name];
  if (!palette) return;
  var btn = document.getElementById(toolId);
  var hiddenSection = document.getElementById(palette.hiddenSectionId);
  if (!btn || !hiddenSection) return;
  var grid = hiddenSection.querySelector('.tool-palette-hidden-grid');
  if (!grid) return;
  // Hidden tiles stay draggable=false so users don't drag them around
  // before adding them back. The active-grid dragstart gate also
  // enforces this.
  btn.draggable = false;
  grid.appendChild(btn);
  queueSave(name);
}

function moveToActive(name, toolId) {
  var palette = PALETTES[name];
  if (!palette) return;
  var btn = document.getElementById(toolId);
  var active = document.getElementById(palette.activeContainerId);
  if (!btn || !active) return;
  active.appendChild(btn);
  btn.draggable = true;
  queueSave(name);
}

// (Hidden-tile clicks are handled in each button's own click listener,
// attached in buildToolButton before any external module attaches
// handlers by ID. See the stopImmediatePropagation logic there.)

// --- Right-click context menu ---

var _openMenu = null;

function openPaletteContextMenu(x, y, items) {
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

function closePaletteContextMenu() {
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

function enterToolPickMode() {
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

function exitToolPickMode() {
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

function getDragAfterElement(container, x, y) {
  var tiles = Array.prototype.slice.call(
    container.querySelectorAll('[data-tool-id]:not(.dragging)')
  );
  var closest = null;
  var closestDist = Number.POSITIVE_INFINITY;
  for (var i = 0; i < tiles.length; i++) {
    var rect = tiles[i].getBoundingClientRect();
    // Pointer is "before" the tile if it's left of the tile's horizontal
    // midpoint on the same row (or on a higher row).
    var rowDelta = y - (rect.top + rect.height / 2);
    var colDelta = x - (rect.left + rect.width / 2);
    // Weight row heavier than column so flowing between rows works.
    var dist = Math.abs(rowDelta) * 2 + Math.abs(colDelta);
    var before = rowDelta < -rect.height / 2
      || (Math.abs(rowDelta) <= rect.height / 2 && colDelta < 0);
    if (before && dist < closestDist) {
      closestDist = dist;
      closest = tiles[i];
    }
  }
  return closest;
}

// --- Persistence ---

function loadPreferences() {
  fetch('/api/user/tool-palettes', { credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data) return;
      applyPreferences('session', data.session || null);
      applyPreferences('mate', data.mate || null);
    })
    .catch(function () { /* first-time users have no saved prefs; ignore */ });
}

function applyPreferences(name, prefs) {
  if (!prefs) return;
  var palette = PALETTES[name];
  if (!palette) return;
  var active = document.getElementById(palette.activeContainerId);
  var hiddenSection = document.getElementById(palette.hiddenSectionId);
  var hiddenGrid = hiddenSection ? hiddenSection.querySelector('.tool-palette-hidden-grid') : null;
  if (!active || !hiddenGrid) return;

  var hiddenSet = {};
  var hiddenList = prefs.hidden || [];
  for (var i = 0; i < hiddenList.length; i++) hiddenSet[hiddenList[i]] = true;

  var orderList = prefs.order || [];
  // Any tools not in the stored order are appended in registry order so
  // newly-added tools surface automatically for existing users.
  var placed = {};
  for (var j = 0; j < orderList.length; j++) {
    var id = orderList[j];
    if (hiddenSet[id]) continue;
    var btn = document.getElementById(id);
    if (btn) {
      active.appendChild(btn);
      placed[id] = true;
    }
  }
  for (var k = 0; k < palette.tools.length; k++) {
    var tid = palette.tools[k].id;
    if (placed[tid] || hiddenSet[tid]) continue;
    var tbtn = document.getElementById(tid);
    if (tbtn) active.appendChild(tbtn);
  }
  for (var h = 0; h < hiddenList.length; h++) {
    var hbtn = document.getElementById(hiddenList[h]);
    if (hbtn) {
      hbtn.draggable = false;
      hiddenGrid.appendChild(hbtn);
    }
  }
}

function queueSave(name) {
  if (_saveTimers[name]) clearTimeout(_saveTimers[name]);
  _saveTimers[name] = setTimeout(function () {
    _saveTimers[name] = null;
    savePreferences(name);
  }, 250);
}

function savePreferences(name) {
  var palette = PALETTES[name];
  if (!palette) return;
  var active = document.getElementById(palette.activeContainerId);
  var hiddenSection = document.getElementById(palette.hiddenSectionId);
  var hiddenGrid = hiddenSection ? hiddenSection.querySelector('.tool-palette-hidden-grid') : null;
  if (!active) return;

  var order = [];
  var activeTiles = active.querySelectorAll('[data-tool-id]');
  for (var i = 0; i < activeTiles.length; i++) order.push(activeTiles[i].dataset.toolId);

  var hidden = [];
  if (hiddenGrid) {
    var hiddenTiles = hiddenGrid.querySelectorAll('[data-tool-id]');
    for (var j = 0; j < hiddenTiles.length; j++) hidden.push(hiddenTiles[j].dataset.toolId);
  }

  fetch('/api/user/tool-palettes', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ palette: name, order: order, hidden: hidden }),
  }).catch(function () { /* save best-effort */ });
}
