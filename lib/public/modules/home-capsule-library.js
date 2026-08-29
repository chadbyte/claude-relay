// Native host surface for browsing the user's installed Capsules.

import { iconHtml } from './icons.js';

function installedCapsules(definitions) {
  return (definitions || []).filter(function (definition) {
    return !!definition && !!definition.manifest && !!definition.manifest.id;
  }).sort(function (a, b) {
    return String(a.manifest.name || a.manifest.id).localeCompare(String(b.manifest.name || b.manifest.id));
  });
}

export function renderHomeCapsuleLibrary(container, definitions, openCapsule) {
  var root = document.createElement("section");
  root.className = "home-capsule-library";
  root.setAttribute("aria-labelledby", "home-capsule-library-title");

  var intro = document.createElement("header");
  intro.className = "home-capsule-library-intro";
  var eyebrow = document.createElement("div");
  eyebrow.className = "home-capsule-library-eyebrow";
  eyebrow.textContent = "Capsule Library";
  intro.appendChild(eyebrow);
  var title = document.createElement("h2");
  title.id = "home-capsule-library-title";
  title.tabIndex = -1;
  title.textContent = "Installed in Clay";
  intro.appendChild(title);
  var description = document.createElement("p");
  description.textContent = "Choose a Capsule to open it in this Workbench.";
  intro.appendChild(description);
  root.appendChild(intro);

  var capsules = installedCapsules(definitions);
  if (!capsules.length) {
    var empty = document.createElement("div");
    empty.className = "home-capsule-library-empty";
    empty.textContent = "No Capsules are installed yet.";
    root.appendChild(empty);
    container.appendChild(root);
    return;
  }

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
  root.appendChild(list);
  container.appendChild(root);
}
