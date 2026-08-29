// Inline presentation for images produced by Codex ImageGen.

import { refreshIcons, iconHtml } from './icons.js';
import { showImageModal } from './app-misc.js';
import { addToMessages, scrollToBottom } from './app-rendering.js';
import { store } from './store.js';
import { copyToClipboard, showToast } from './utils.js';

var detailsModal = null;
var detailsEscapeHandler = null;

function fileNameFromImage(image) {
  if (image.fileName) return image.fileName;
  try {
    var url = new URL(image.url, window.location.href);
    return decodeURIComponent(url.pathname.split('/').pop()) || 'generated-image.png';
  } catch (e) {
    return 'generated-image.png';
  }
}

function actionButton(icon, label) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'generated-image-action';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = iconHtml(icon) + '<span>' + label + '</span>';
  return button;
}

function closeImageDetails() {
  if (detailsModal) detailsModal.remove();
  if (detailsEscapeHandler) document.removeEventListener('keydown', detailsEscapeHandler);
  detailsModal = null;
  detailsEscapeHandler = null;
}

function setActionState(button, icon, label) {
  if (!button) return;
  button.innerHTML = iconHtml(icon) + '<span>' + label + '</span>';
  button.title = label;
  button.setAttribute('aria-label', label);
  refreshIcons(button);
}

function saveGeneratedImage(image, targetPath, overwrite) {
  var basePath = store.get('basePath') || '';
  return fetch(basePath + 'api/generated-image/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      fileName: fileNameFromImage(image),
      path: targetPath,
      overwrite: !!overwrite,
    }),
  }).then(function (response) {
    return response.text().then(function (text) {
      var data = {};
      try { data = JSON.parse(text); } catch (e) { data.error = text || 'Could not save image'; }
      data.status = response.status;
      data.ok = response.ok && data.ok !== false;
      return data;
    });
  });
}

function showGeneratedImageDetails(image, promptText, sourceSaveButton, focusPath) {
  closeImageDetails();
  var prompt = promptText || '';
  var fileName = fileNameFromImage(image);
  var overwrite = false;

  var backdrop = document.createElement('div');
  backdrop.className = 'generated-image-details-backdrop';
  var modal = document.createElement('section');
  modal.className = 'generated-image-details';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'generated-image-details-title');

  var header = document.createElement('header');
  header.className = 'generated-image-details-header';
  var heading = document.createElement('div');
  var eyebrow = document.createElement('span');
  eyebrow.className = 'generated-image-details-eyebrow';
  eyebrow.textContent = 'IMAGE GENERATION';
  var title = document.createElement('h2');
  title.id = 'generated-image-details-title';
  title.textContent = 'Image details';
  heading.appendChild(eyebrow);
  heading.appendChild(title);
  var closeButton = actionButton('x', 'Close');
  closeButton.classList.add('generated-image-details-close');
  closeButton.addEventListener('click', closeImageDetails);
  header.appendChild(heading);
  header.appendChild(closeButton);
  modal.appendChild(header);

  var body = document.createElement('div');
  body.className = 'generated-image-details-body';
  var preview = document.createElement('div');
  preview.className = 'generated-image-details-preview';
  var previewImage = document.createElement('img');
  previewImage.src = image.url;
  previewImage.alt = prompt ? 'Generated image: ' + prompt : 'Generated image';
  previewImage.addEventListener('click', function () { showImageModal(image.url); });
  preview.appendChild(previewImage);
  body.appendChild(preview);

  var promptSection = document.createElement('section');
  promptSection.className = 'generated-image-details-section';
  var promptHeader = document.createElement('div');
  promptHeader.className = 'generated-image-details-section-header';
  var promptLabel = document.createElement('h3');
  promptLabel.textContent = 'Prompt';
  promptHeader.appendChild(promptLabel);
  if (prompt) {
    var copyPrompt = actionButton('copy', 'Copy prompt');
    copyPrompt.addEventListener('click', function () { copyToClipboard(prompt); });
    promptHeader.appendChild(copyPrompt);
  }
  var promptBody = document.createElement('div');
  promptBody.className = 'generated-image-details-prompt';
  promptBody.textContent = prompt || 'Prompt details are not available for this image.';
  promptSection.appendChild(promptHeader);
  promptSection.appendChild(promptBody);
  body.appendChild(promptSection);

  var saveSection = document.createElement('section');
  saveSection.className = 'generated-image-details-section generated-image-save-section';
  var saveLabel = document.createElement('label');
  saveLabel.htmlFor = 'generated-image-project-path';
  saveLabel.textContent = 'Project path';
  var pathInput = document.createElement('input');
  pathInput.id = 'generated-image-project-path';
  pathInput.type = 'text';
  pathInput.value = 'assets/generated/' + fileName;
  pathInput.spellcheck = false;
  pathInput.autocomplete = 'off';
  var saveHint = document.createElement('p');
  saveHint.className = 'generated-image-save-hint';
  saveHint.textContent = 'The folder will be created inside this project if needed.';
  var saveError = document.createElement('p');
  saveError.className = 'generated-image-save-error hidden';
  saveSection.appendChild(saveLabel);
  saveSection.appendChild(pathInput);
  saveSection.appendChild(saveHint);
  saveSection.appendChild(saveError);
  body.appendChild(saveSection);
  modal.appendChild(body);

  var footer = document.createElement('footer');
  footer.className = 'generated-image-details-footer';
  var cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'generated-image-secondary-button';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', closeImageDetails);
  var saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'generated-image-primary-button';
  saveButton.innerHTML = iconHtml('save') + '<span>Save to project</span>';
  footer.appendChild(cancelButton);
  footer.appendChild(saveButton);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  detailsModal = backdrop;

  function resetOverwrite() {
    overwrite = false;
    saveError.classList.add('hidden');
    saveError.textContent = '';
    saveButton.classList.remove('generated-image-primary-button--replace');
    saveButton.innerHTML = iconHtml('save') + '<span>Save to project</span>';
    refreshIcons(saveButton);
  }

  pathInput.addEventListener('input', resetOverwrite);
  saveButton.addEventListener('click', function () {
    var targetPath = pathInput.value.trim();
    if (!targetPath) {
      saveError.textContent = 'Enter a project path.';
      saveError.classList.remove('hidden');
      pathInput.focus();
      return;
    }
    saveButton.disabled = true;
    saveError.classList.add('hidden');
    saveGeneratedImage(image, targetPath, overwrite).then(function (result) {
      saveButton.disabled = false;
      if (result.ok) {
        setActionState(sourceSaveButton, 'check', 'Saved');
        if (sourceSaveButton) sourceSaveButton.disabled = true;
        showToast('Saved to ' + result.path);
        closeImageDetails();
        return;
      }
      saveError.textContent = result.error || 'Could not save image.';
      saveError.classList.remove('hidden');
      if (result.status === 409) {
        overwrite = true;
        saveButton.classList.add('generated-image-primary-button--replace');
        saveButton.innerHTML = iconHtml('replace') + '<span>Replace file</span>';
        refreshIcons(saveButton);
      }
    }).catch(function () {
      saveButton.disabled = false;
      saveError.textContent = 'Could not save image.';
      saveError.classList.remove('hidden');
    });
  });

  backdrop.addEventListener('click', function (event) {
    if (event.target === backdrop) closeImageDetails();
  });
  detailsEscapeHandler = function (event) {
    if (event.key === 'Escape') closeImageDetails();
  };
  document.addEventListener('keydown', detailsEscapeHandler);
  refreshIcons(backdrop);
  if (focusPath) pathInput.focus();
  else closeButton.focus();
}

function findProgressRow(toolId) {
  var rows = document.querySelectorAll('.generated-image-row[data-image-tool-id]');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].dataset.imageToolId === String(toolId || '')) return rows[i];
  }
  return null;
}

export function renderImageGenerationProgress(msg) {
  if (!msg.id || findProgressRow(msg.id)) return;

  var row = document.createElement('div');
  row.className = 'generated-image-row generated-image-row--pending';
  row.dataset.imageToolId = msg.id;

  var status = document.createElement('div');
  status.className = 'generated-image-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.innerHTML = iconHtml('sparkles') + '<span>Creating image</span><span class="generated-image-status-dots" aria-hidden="true"></span>';
  row.appendChild(status);

  var card = document.createElement('div');
  card.className = 'generated-image-card generated-image-card--pending';
  card.setAttribute('aria-hidden', 'true');
  var field = document.createElement('div');
  field.className = 'generated-image-particle-field';
  card.appendChild(field);
  row.appendChild(card);

  addToMessages(row);
  refreshIcons(row);
  scrollToBottom();
}

export function clearImageGenerationProgress(toolId) {
  var row = findProgressRow(toolId);
  if (row && row.classList.contains('generated-image-row--pending')) row.remove();
}

export function clearAllImageGenerationProgress() {
  var rows = document.querySelectorAll('.generated-image-row--pending');
  for (var i = 0; i < rows.length; i++) rows[i].remove();
}

export function renderGeneratedImage(msg) {
  var image = msg.images && msg.images[0];
  if (!image || !image.url) return;

  var row = document.createElement('div');
  row.className = 'generated-image-row';
  row.dataset.imageToolId = msg.id || '';
  var card = document.createElement('figure');
  card.className = 'generated-image-card';
  card.dataset.toolId = msg.id || '';

  var imageWrap = document.createElement('div');
  imageWrap.className = 'generated-image-preview';
  var img = document.createElement('img');
  img.src = image.url;
  img.alt = msg.prompt ? 'Generated image: ' + msg.prompt : 'Generated image';
  img.loading = 'lazy';
  img.addEventListener('click', function () { showImageModal(image.url); });
  imageWrap.appendChild(img);
  card.appendChild(imageWrap);

  var footer = document.createElement('figcaption');
  footer.className = 'generated-image-footer';
  var meta = document.createElement('div');
  meta.className = 'generated-image-meta';
  var label = document.createElement('span');
  label.className = 'generated-image-label';
  label.innerHTML = iconHtml('sparkles') + '<span>Generated image</span>';
  meta.appendChild(label);
  if (msg.prompt) {
    var prompt = document.createElement('button');
    prompt.type = 'button';
    prompt.className = 'generated-image-prompt';
    prompt.textContent = msg.prompt;
    prompt.title = 'View full prompt';
    prompt.addEventListener('click', function () { showGeneratedImageDetails(image, msg.prompt, null, false); });
    meta.appendChild(prompt);
  }
  footer.appendChild(meta);

  var actions = document.createElement('div');
  actions.className = 'generated-image-actions';
  var openButton = actionButton('maximize-2', 'Open');
  openButton.addEventListener('click', function () { showImageModal(image.url); });
  actions.appendChild(openButton);
  var saveButton = actionButton('save', 'Save');
  saveButton.addEventListener('click', function () { showGeneratedImageDetails(image, msg.prompt, saveButton, true); });
  var detailsButton = actionButton('info', 'Details');
  detailsButton.addEventListener('click', function () { showGeneratedImageDetails(image, msg.prompt, saveButton, false); });
  actions.appendChild(detailsButton);
  actions.appendChild(saveButton);
  var downloadLink = document.createElement('a');
  downloadLink.className = 'generated-image-action';
  downloadLink.href = image.url;
  downloadLink.download = fileNameFromImage(image);
  downloadLink.title = 'Download';
  downloadLink.setAttribute('aria-label', 'Download');
  downloadLink.innerHTML = iconHtml('download') + '<span>Download</span>';
  actions.appendChild(downloadLink);
  footer.appendChild(actions);
  card.appendChild(footer);
  row.appendChild(card);

  var progressRow = findProgressRow(msg.id);
  if (progressRow) progressRow.replaceWith(row);
  else addToMessages(row);
  refreshIcons(row);
  scrollToBottom();
}
