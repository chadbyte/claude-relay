// paste-modal.js - Shared read-only and composer-editable pasted-content dialog.

import { refreshIcons } from './icons.js';
import { copyToClipboard } from './utils.js';

var saveCallback = null;
var previousFocus = null;
var initialized = false;

function getElements() {
  return {
    modal: document.getElementById("paste-modal"),
    title: document.getElementById("paste-modal-title"),
    body: document.getElementById("paste-modal-body"),
    editor: document.getElementById("paste-modal-editor"),
    footer: document.getElementById("paste-modal-footer"),
    save: document.getElementById("paste-modal-save")
  };
}

function currentText(elements) {
  if (saveCallback && elements.editor) return elements.editor.value;
  return elements.body ? elements.body.textContent : "";
}

export function closePasteModal() {
  var elements = getElements();
  if (!elements.modal || elements.modal.classList.contains("hidden")) return;
  elements.modal.classList.add("hidden");
  elements.modal.classList.remove("paste-modal-editing");
  saveCallback = null;
  if (previousFocus && previousFocus.isConnected && previousFocus.focus) previousFocus.focus();
  previousFocus = null;
}

export function showPasteModal(text, onSave) {
  var elements = getElements();
  if (!elements.modal || !elements.body || !elements.editor) return;
  var editing = typeof onSave === "function";
  previousFocus = document.activeElement;
  saveCallback = editing ? onSave : null;
  elements.body.textContent = text || "";
  elements.editor.value = text || "";
  elements.title.textContent = editing ? "Edit pasted content" : "Pasted content";
  elements.modal.classList.toggle("paste-modal-editing", editing);
  elements.modal.classList.remove("hidden");
  refreshIcons(elements.modal);
  requestAnimationFrame(function () {
    if (editing) {
      elements.editor.focus();
      elements.editor.setSelectionRange(elements.editor.value.length, elements.editor.value.length);
    } else {
      var close = elements.modal.querySelector(".paste-modal-close");
      if (close) close.focus();
    }
  });
}

export function initPasteModal() {
  if (initialized) return;
  var elements = getElements();
  if (!elements.modal) return;
  initialized = true;

  elements.modal.querySelector(".confirm-backdrop").addEventListener("click", closePasteModal);
  elements.modal.querySelector(".paste-modal-close").addEventListener("click", closePasteModal);
  elements.modal.querySelector(".paste-modal-cancel").addEventListener("click", closePasteModal);
  elements.modal.querySelector(".paste-modal-copy").addEventListener("click", function () {
    copyToClipboard(currentText(elements), "Copied to clipboard");
  });
  elements.save.addEventListener("click", function () {
    if (!saveCallback) return;
    var callback = saveCallback;
    var value = elements.editor.value;
    closePasteModal();
    callback(value);
  });
  elements.modal.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePasteModal();
    }
  });
}
