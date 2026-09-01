// Native host surface for browsing the user's installed Capsules.

import { iconHtml } from './icons.js';
import { requestHomeCapsuleCreation } from './home-capsule-creation-intent.js';

function installedCapsules(definitions) {
  return (definitions || []).filter(function (definition) {
    return !!definition && !!definition.manifest && !!definition.manifest.id;
  }).sort(function (a, b) {
    return String(a.manifest.name || a.manifest.id).localeCompare(String(b.manifest.name || b.manifest.id));
  });
}

function submitCreation(input, status) {
  var description = input.value.trim();
  if (!description) return;
  status.textContent = "";
  if (requestHomeCapsuleCreation(description)) return;
  status.textContent = "Your Mate is not ready yet. Try again in a moment.";
}

function createComposer() {
  var form = document.createElement("form");
  form.className = "home-capsule-library-create";
  var label = document.createElement("label");
  label.className = "home-capsule-library-create-label";
  label.htmlFor = "home-capsule-library-prompt";
  label.textContent = "Create with Mate";
  form.appendChild(label);
  var guidance = document.createElement("p");
  guidance.id = "home-capsule-library-create-guidance";
  guidance.className = "home-capsule-library-create-guidance";
  guidance.textContent = "Describe what should stay useful beyond this conversation. Your current Mate will open a new conversation and shape it with you.";
  form.appendChild(guidance);
  var frame = document.createElement("div");
  frame.className = "home-capsule-library-create-frame";
  var input = document.createElement("textarea");
  input.id = "home-capsule-library-prompt";
  input.className = "home-capsule-library-create-input";
  input.rows = 2;
  input.maxLength = 4000;
  input.placeholder = "Describe the interface you need";
  input.setAttribute("aria-describedby", "home-capsule-library-create-guidance home-capsule-library-create-status");
  frame.appendChild(input);
  var submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "home-capsule-library-create-submit";
  submit.setAttribute("aria-label", "Start a Capsule conversation with your Mate");
  submit.innerHTML = iconHtml("arrow-up");
  frame.appendChild(submit);
  form.appendChild(frame);
  var status = document.createElement("p");
  status.id = "home-capsule-library-create-status";
  status.className = "home-capsule-library-create-status";
  status.setAttribute("role", "status");
  form.appendChild(status);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    submitCreation(input, status);
  });
  input.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submitCreation(input, status);
  });
  return form;
}

export function renderHomeCapsuleLibrary(container, definitions, openCapsule) {
  var root = document.createElement("section");
  root.className = "home-capsule-library";
  root.setAttribute("aria-labelledby", "home-capsule-library-title");

  var intro = document.createElement("header");
  intro.className = "home-capsule-library-intro";
  var title = document.createElement("h2");
  title.id = "home-capsule-library-title";
  title.tabIndex = -1;
  title.textContent = "Capsule Home";
  intro.appendChild(title);
  var description = document.createElement("p");
  description.textContent = "Turn a recurring need into something you can open, use, and keep.";
  intro.appendChild(description);
  root.appendChild(intro);
  var definition = document.createElement("section");
  definition.className = "home-capsule-library-definition";
  definition.setAttribute("aria-labelledby", "home-capsule-library-definition-title");
  var definitionTitle = document.createElement("h3");
  definitionTitle.id = "home-capsule-library-definition-title";
  definitionTitle.textContent = "What is a Capsule?";
  definition.appendChild(definitionTitle);
  var definitionText = document.createElement("p");
  definitionText.textContent = "A Capsule is a small, persistent app that a Mate creates with you. It keeps its interface and data beyond the conversation, and every Mate can help you use or improve it.";
  definition.appendChild(definitionText);
  root.appendChild(definition);
  root.appendChild(createComposer());

  var capsules = installedCapsules(definitions);
  if (!capsules.length) { container.appendChild(root); return; }

  var inventory = document.createElement("section");
  inventory.className = "home-capsule-library-inventory";
  inventory.setAttribute("aria-labelledby", "home-capsule-library-installed-title");
  var inventoryTitle = document.createElement("h3");
  inventoryTitle.id = "home-capsule-library-installed-title";
  inventoryTitle.textContent = "Installed Capsules";
  inventory.appendChild(inventoryTitle);
  var list = document.createElement("ul");
  list.className = "home-capsule-library-list";
  for (var i = 0; i < capsules.length; i++) {
    (function (definition) {
      var manifest = definition.manifest;
      var item = document.createElement("li");
      item.className = "home-capsule-library-item";
      var row = document.createElement("button");
      row.type = "button";
      row.className = "home-capsule-library-row";
      row.setAttribute("aria-label", "Open " + (manifest.name || manifest.id) + " Capsule");
      var icon = document.createElement("span");
      icon.className = "home-capsule-library-icon";
      icon.innerHTML = iconHtml(manifest.lucideIcon || "box");
      row.appendChild(icon);
      var copy = document.createElement("span");
      copy.className = "home-capsule-library-copy";
      var name = document.createElement("span");
      name.className = "home-capsule-library-name";
      name.textContent = manifest.name || manifest.id;
      copy.appendChild(name);
      var hint = document.createElement("span");
      hint.className = "home-capsule-library-hint";
      hint.textContent = "Open Capsule";
      copy.appendChild(hint);
      row.appendChild(copy);
      var arrow = document.createElement("span");
      arrow.className = "home-capsule-library-arrow";
      arrow.innerHTML = iconHtml("arrow-up-right");
      row.appendChild(arrow);
      row.addEventListener("click", function () { openCapsule(manifest.id); });
      item.appendChild(row);
      list.appendChild(item);
    })(capsules[i]);
  }
  inventory.appendChild(list);
  root.appendChild(inventory);
  container.appendChild(root);
}
