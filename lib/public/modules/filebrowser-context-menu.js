// File-tree context menu and shared file download action.

import { iconHtml, refreshIcons } from './icons.js';
import { insertTextAtCursor } from './input.js';
import { copyToClipboard, showToast } from './utils.js';

var MAX_COPY_CONTENT_BYTES = 1024 * 1024;

function closeFileContextMenu() {
  var menu = document.getElementById('file-tree-context-menu');
  if (menu) menu.remove();
  var activeRows = document.querySelectorAll('.file-tree-item.context-open');
  for (var i = 0; i < activeRows.length; i++) activeRows[i].classList.remove('context-open');
}

export function downloadProjectFile(filePath) {
  if (!filePath) return;
  var link = document.createElement('a');
  link.href = 'api/file/download?path=' + encodeURIComponent(filePath);
  link.download = filePath.split('/').pop() || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function copyProjectFileContents(filePath) {
  var url = 'api/file/download?path=' + encodeURIComponent(filePath);
  fetch(url, { credentials: 'same-origin', cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('Could not read file');
      var contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_COPY_CONTENT_BYTES) {
        if (response.body && response.body.cancel) response.body.cancel();
        throw new Error('File is too large to copy');
      }
      return response.arrayBuffer();
    })
    .then(function (buffer) {
      if (buffer.byteLength > MAX_COPY_CONTENT_BYTES) throw new Error('File is too large to copy');
      var bytes = new Uint8Array(buffer);
      for (var i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) throw new Error('Binary files cannot be copied as text');
      }
      var decoder = new TextDecoder('utf-8', { fatal: true });
      var text;
      try { text = decoder.decode(buffer); } catch (e) { throw new Error('Binary files cannot be copied as text'); }
      return copyToClipboard(text);
    })
    .catch(function (error) {
      var message = error && error.message ? error.message : 'Could not copy file contents';
      showToast(message, 'error');
    });
}

function menuItem(icon, label, handler) {
  var item = document.createElement('button');
  item.type = 'button';
  item.className = 'file-tree-context-item';
  item.setAttribute('role', 'menuitem');
  item.innerHTML = iconHtml(icon) + '<span>' + label + '</span>';
  item.addEventListener('click', handler);
  return item;
}

function positionMenu(menu, clientX, clientY) {
  var edge = 8;
  var rect = menu.getBoundingClientRect();
  var left = Math.max(edge, Math.min(clientX, window.innerWidth - rect.width - edge));
  var top = Math.max(edge, Math.min(clientY, window.innerHeight - rect.height - edge));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function showFileContextMenu(event, row) {
  closeFileContextMenu();
  row.classList.add('context-open');

  var menu = document.createElement('div');
  menu.id = 'file-tree-context-menu';
  menu.className = 'file-tree-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'File actions');

  var mention = menuItem('at-sign', 'Mention in chat', function (clickEvent) {
    clickEvent.stopPropagation();
    var filePath = row.dataset.path;
    closeFileContextMenu();
    insertTextAtCursor(filePath + ' ');
  });
  menu.appendChild(mention);

  var copyPath = menuItem('copy', 'Copy path', function (clickEvent) {
    clickEvent.stopPropagation();
    var filePath = row.dataset.path;
    closeFileContextMenu();
    copyToClipboard(filePath).catch(function () { showToast('Could not copy path', 'error'); });
  });
  menu.appendChild(copyPath);

  var copyContents = menuItem('clipboard-copy', 'Copy contents', function (clickEvent) {
    clickEvent.stopPropagation();
    var filePath = row.dataset.path;
    closeFileContextMenu();
    copyProjectFileContents(filePath);
  });
  menu.appendChild(copyContents);

  var separator = document.createElement('div');
  separator.className = 'file-tree-context-separator';
  separator.setAttribute('role', 'separator');
  menu.appendChild(separator);

  var download = menuItem('download', 'Download', function (clickEvent) {
    clickEvent.stopPropagation();
    var filePath = row.dataset.path;
    closeFileContextMenu();
    downloadProjectFile(filePath);
  });
  menu.appendChild(download);
  document.body.appendChild(menu);
  refreshIcons(menu);
  positionMenu(menu, event.clientX, event.clientY);
  try { mention.focus({ preventScroll: true }); } catch (e) { mention.focus(); }
}

export function initFileBrowserContextMenu(treeEl) {
  if (!treeEl || treeEl.dataset.contextMenuReady === 'true') return;
  treeEl.dataset.contextMenuReady = 'true';

  treeEl.addEventListener('contextmenu', function (event) {
    var row = event.target && event.target.closest ? event.target.closest('.file-tree-item') : null;
    if (!row || !treeEl.contains(row) || row.dataset.entryType !== 'file' || !row.dataset.path) return;
    event.preventDefault();
    event.stopPropagation();
    showFileContextMenu(event, row);
  });

  document.addEventListener('pointerdown', function (event) {
    var menu = document.getElementById('file-tree-context-menu');
    if (menu && !menu.contains(event.target)) closeFileContextMenu();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeFileContextMenu();
  });
  window.addEventListener('resize', closeFileContextMenu);
  window.addEventListener('blur', closeFileContextMenu);
  treeEl.addEventListener('scroll', closeFileContextMenu, { passive: true });
}
