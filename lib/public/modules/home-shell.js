// home-shell.js - Reversible project-chrome replacement for the home route.

import { getCachedProjects, openAddProjectModal, switchProject } from './app-projects.js';
import { iconHtml, refreshIcons } from './icons.js';

var projectsButton = null;
var projectsMenu = null;
var homeActions = null;
var topbarActions = null;
var lastProjectSlug = null;

function projectName(project) {
  return project.title || project.project || project.slug || "Untitled project";
}

function closeProjectsMenu() {
  if (!projectsMenu) return;
  projectsMenu.remove();
  projectsMenu = null;
  projectsButton.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", closeOnOutside, true);
  document.removeEventListener("keydown", closeOnEscape, true);
}

function closeOnOutside(event) {
  if (projectsMenu && !projectsMenu.contains(event.target) && !projectsButton.contains(event.target)) closeProjectsMenu();
}

function closeOnEscape(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeProjectsMenu();
  projectsButton.focus();
}

function chooseProject(slug) {
  closeProjectsMenu();
  switchProject(slug);
}

function addProject() {
  closeProjectsMenu();
  openAddProjectModal();
}

function appendProjectRow(menu, project, resume) {
  var row = document.createElement("button");
  row.type = "button";
  row.className = "home-project-row" + (resume ? " home-project-resume" : "");
  row.dataset.slug = project.slug;
  var icon = document.createElement("span");
  icon.className = "home-project-row-icon";
  if (project.icon) icon.textContent = project.icon;
  else icon.innerHTML = iconHtml("folder");
  row.appendChild(icon);
  var label = document.createElement("span");
  label.className = "home-project-row-label";
  label.textContent = (resume ? "Resume " : "") + projectName(project);
  row.appendChild(label);
  if (project.isProcessing) {
    var dot = document.createElement("span");
    dot.className = "home-project-row-dot";
    dot.title = "Processing";
    row.appendChild(dot);
  }
  row.addEventListener("click", function () { chooseProject(project.slug); });
  menu.appendChild(row);
}

function replaceProjectsMenu(filter, focusInput, selectionStart, selectionEnd) {
  var left = projectsMenu.style.left;
  var top = projectsMenu.style.top;
  var replacement = renderProjects(filter);
  replacement.style.left = left;
  replacement.style.top = top;
  projectsMenu.replaceWith(replacement);
  projectsMenu = replacement;
  refreshIcons();
  if (focusInput) {
    var nextInput = replacement.querySelector("input");
    nextInput.focus();
    nextInput.setSelectionRange(selectionStart, selectionEnd);
  }
}

function renderProjects(filter) {
  var menu = document.createElement("div");
  menu.className = "home-projects-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Projects");
  var input = document.createElement("input");
  input.className = "home-projects-filter";
  input.type = "search";
  input.placeholder = "Filter projects";
  input.value = filter || "";
  input.setAttribute("aria-label", "Filter projects");
  input.addEventListener("input", function () {
    replaceProjectsMenu(input.value, true, input.selectionStart, input.selectionEnd);
  });
  menu.appendChild(input);

  var query = (filter || "").trim().toLowerCase();
  var projects = (getCachedProjects() || []).filter(function (project) {
    return !project.isMate && (!query || projectName(project).toLowerCase().indexOf(query) !== -1);
  });
  var resumed = null;
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].slug === lastProjectSlug) resumed = projects[i];
  }
  if (resumed) appendProjectRow(menu, resumed, true);
  for (var j = 0; j < projects.length; j++) {
    if (!resumed || projects[j].slug !== resumed.slug) appendProjectRow(menu, projects[j], false);
  }
  if (!projects.length) {
    var empty = document.createElement("div");
    empty.className = "home-projects-empty";
    empty.textContent = "No matching projects";
    menu.appendChild(empty);
  }
  var footer = document.createElement("button");
  footer.type = "button";
  footer.className = "home-project-new";
  footer.innerHTML = iconHtml("plus") + "<span>New project</span>";
  footer.addEventListener("click", addProject);
  menu.appendChild(footer);
  return menu;
}

function openProjectsMenu() {
  closeProjectsMenu();
  projectsMenu = renderProjects("");
  document.body.appendChild(projectsMenu);
  var rect = projectsButton.getBoundingClientRect();
  projectsMenu.style.left = Math.max(12, rect.left) + "px";
  projectsMenu.style.top = (rect.bottom + 8) + "px";
  projectsButton.setAttribute("aria-expanded", "true");
  refreshIcons();
  projectsMenu.querySelector("input").focus();
  setTimeout(function () {
    document.addEventListener("click", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
  }, 0);
}

function moveHomeActions(home) {
  var ids = ["notif-center-btn", "user-settings-btn"];
  for (var i = 0; i < ids.length; i++) {
    var control = document.getElementById(ids[i]);
    if (control) home.appendChild(control);
  }
}

function restoreTopbarActions() {
  var notification = document.getElementById("notif-center-btn");
  var account = document.getElementById("user-settings-btn");
  var accountActions = document.querySelector(".user-island-actions");
  if (notification && topbarActions) topbarActions.appendChild(notification);
  if (account && accountActions) accountActions.appendChild(account);
}

export function initHomeShell() {
  projectsButton = document.getElementById("home-projects-btn");
  homeActions = document.getElementById("home-bar-actions");
  topbarActions = document.querySelector(".top-bar-actions");
  projectsButton.addEventListener("click", function () {
    if (projectsMenu) closeProjectsMenu();
    else openProjectsMenu();
  });
  document.getElementById("home-search-btn").addEventListener("click", function () {
    var palette = document.getElementById("cmd-palette-btn");
    if (palette) palette.click();
  });
  window.addEventListener("clay:projects-updated", function () {
    if (!projectsMenu) return;
    var input = projectsMenu.querySelector("input");
    var focused = document.activeElement === input;
    replaceProjectsMenu(input.value, focused, input.selectionStart, input.selectionEnd);
  });
}

export function showHomeShell(slug) {
  if (slug) lastProjectSlug = slug;
  document.body.classList.add("home-active");
  moveHomeActions(homeActions);
}

export function hideHomeShell() {
  closeProjectsMenu();
  document.body.classList.remove("home-active");
  restoreTopbarActions();
}
