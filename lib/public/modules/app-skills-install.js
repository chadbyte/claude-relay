// app-skills-install.js - Skill install dialog, requireSkills, requireClayMateInterview
// Extracted from app.js (PR-33)

import { refreshIcons, iconHtml } from './icons.js';
import { escapeHtml } from './utils.js';
import { store } from './store.js';

// --- Module-owned state (not in store) ---
var skillInstallModal = null;
var skillInstallTitle = null;
var skillInstallReason = null;
var skillInstallList = null;
var skillInstallOk = null;
var skillInstallCancel = null;
var skillInstallStatus = null;

var pendingSkillInstalls = [];
var skillInstallCallback = null;
var skillInstalling = false;
var skillInstallDone = false;

export function initSkillInstall() {
  skillInstallModal = document.getElementById("skill-install-modal");
  skillInstallTitle = document.getElementById("skill-install-title");
  skillInstallReason = document.getElementById("skill-install-reason");
  skillInstallList = document.getElementById("skill-install-list");
  skillInstallOk = document.getElementById("skill-install-ok");
  skillInstallCancel = document.getElementById("skill-install-cancel");
  skillInstallStatus = document.getElementById("skill-install-status");

  skillInstallCancel.addEventListener("click", hideSkillInstallModal);
  skillInstallModal.querySelector(".confirm-backdrop").addEventListener("click", hideSkillInstallModal);

  skillInstallOk.addEventListener("click", function () {
    if (skillInstallDone) {
      var proceedCb = skillInstallCallback;
      skillInstallCallback = null;
      hideSkillInstallModal();
      if (proceedCb) proceedCb();
      return;
    }
    if (skillInstalling) return;
    skillInstalling = true;
    skillInstallOk.disabled = true;
    skillInstallOk.textContent = "Installing...";

    var total = 0;
    for (var i = 0; i < pendingSkillInstalls.length; i++) {
      if (!pendingSkillInstalls[i].installed) total++;
    }
    skillInstallStatus.classList.remove("hidden");
    updateSkillInstallProgress(0, total);

    for (var j = 0; j < pendingSkillInstalls.length; j++) {
      var s = pendingSkillInstalls[j];
      if (s.installed) continue;
      fetch(store.get('basePath') + "api/install-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: s.url, skill: s.name, scope: s.scope || "global" }),
      }).catch(function () {});
    }
  });
}

// --- Functions ---

function renderSkillInstallDialog(opts, missing) {
  var hasOutdated = false;
  var hasMissing = false;
  for (var c = 0; c < missing.length; c++) {
    if (missing[c].status === "outdated") hasOutdated = true;
    else hasMissing = true;
  }
  var defaultTitle = hasMissing ? "Skill Installation Required" : "Skill Update Available";
  var defaultReason = hasMissing
    ? "This feature requires the following skill(s) to be installed."
    : "Newer versions of the following skill(s) are available.";
  if (hasMissing && hasOutdated) {
    defaultTitle = "Skill Installation / Update Required";
    defaultReason = "Some skills need to be installed or updated.";
  }
  skillInstallTitle.textContent = opts.title || defaultTitle;
  skillInstallReason.textContent = opts.reason || defaultReason;
  skillInstallList.innerHTML = "";
  for (var i = 0; i < missing.length; i++) {
    var s = missing[i];
    var badge = s.status === "outdated"
      ? '<span class="skill-badge skill-badge-update">Update ' + escapeHtml(s.installedVersion || "") + ' \u2192 ' + escapeHtml(s.remoteVersion || "") + '</span>'
      : '<span class="skill-badge skill-badge-new">New</span>';
    var item = document.createElement("div");
    item.className = "skill-install-item";
    item.setAttribute("data-skill", s.name);
    item.innerHTML = '<span class="skill-icon">&#x1f9e9;</span>' +
      '<div class="skill-info">' +
        '<span class="skill-name">' + escapeHtml(s.name) + '</span>' +
        badge +
      '</div>' +
      '<span class="skill-status"></span>';
    skillInstallList.appendChild(item);
  }
  skillInstallStatus.classList.add("hidden");
  skillInstallStatus.innerHTML = "";
  skillInstallOk.disabled = false;
  var btnLabel = hasMissing ? "Install" : "Update";
  if (hasMissing && hasOutdated) btnLabel = "Install / Update";
  skillInstallOk.textContent = btnLabel;
  skillInstallOk.className = "confirm-btn confirm-delete";
  skillInstallModal.classList.remove("hidden");
}

function hideSkillInstallModal() {
  skillInstallModal.classList.add("hidden");
  skillInstallCallback = null;
  pendingSkillInstalls = [];
  skillInstalling = false;
  skillInstallDone = false;
}

function updateSkillInstallProgress(done, total) {
  var hasUpdates = false;
  for (var u = 0; u < pendingSkillInstalls.length; u++) {
    if (pendingSkillInstalls[u].status === "outdated") { hasUpdates = true; break; }
  }
  var label = hasUpdates ? "Updating" : "Installing";
  skillInstallStatus.innerHTML = '<div class="skills-spinner small"></div> ' + label + ' skills... (' + done + '/' + total + ')';
}

function updateSkillListItems() {
  var items = skillInstallList.querySelectorAll(".skill-install-item");
  for (var i = 0; i < items.length; i++) {
    var name = items[i].getAttribute("data-skill");
    for (var j = 0; j < pendingSkillInstalls.length; j++) {
      if (pendingSkillInstalls[j].name === name) {
        var statusEl = items[i].querySelector(".skill-status");
        if (pendingSkillInstalls[j].installed) {
          if (statusEl) {
            statusEl.innerHTML = '<span class="skill-status-ok">' + iconHtml("circle-check") + '</span>';
            refreshIcons();
          }
        }
        break;
      }
    }
  }
}

export function handleSkillInstallWs(msg) {
  if (!skillInstalling || pendingSkillInstalls.length === 0) return;
  for (var i = 0; i < pendingSkillInstalls.length; i++) {
    if (pendingSkillInstalls[i].name === msg.skill) {
      if (msg.success) {
        pendingSkillInstalls[i].installed = true;
        var _kis = Object.assign({}, store.get('knownInstalledSkills'));
        _kis[msg.skill] = true;
        store.set({ knownInstalledSkills: _kis });
      } else {
        skillInstalling = false;
        skillInstallOk.disabled = false;
        skillInstallOk.textContent = "Install";
        skillInstallStatus.innerHTML = "Failed to install " + escapeHtml(msg.skill) + ". Try again.";
        updateSkillListItems();
        return;
      }
    }
  }

  var doneCount = 0;
  var totalCount = pendingSkillInstalls.length;
  for (var k = 0; k < pendingSkillInstalls.length; k++) {
    if (pendingSkillInstalls[k].installed) doneCount++;
  }
  updateSkillListItems();
  updateSkillInstallProgress(doneCount, totalCount);

  if (doneCount === totalCount) {
    skillInstallDone = true;
    var hasUpdates = false;
    for (var u = 0; u < pendingSkillInstalls.length; u++) {
      if (pendingSkillInstalls[u].status === "outdated") { hasUpdates = true; break; }
    }
    var doneMsg = hasUpdates ? "All skills updated successfully." : "All skills installed successfully.";
    skillInstallStatus.innerHTML = '<span class="skill-status-ok">' + iconHtml("circle-check") + '</span> ' + doneMsg;
    refreshIcons();
    skillInstallOk.disabled = false;
    skillInstallOk.textContent = "Proceed";
    skillInstallOk.className = "confirm-btn confirm-proceed";
  }
}

export function requireSkills(opts, cb) {
  fetch(store.get('basePath') + "api/check-skill-updates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills: opts.skills }),
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var results = data.results || [];
      var actionable = [];
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (r.status === "missing" || r.status === "outdated") {
          var orig = null;
          for (var j = 0; j < opts.skills.length; j++) {
            if (opts.skills[j].name === r.name) { orig = opts.skills[j]; break; }
          }
          if (!orig) continue;
          actionable.push({
            name: r.name,
            url: orig.url,
            scope: orig.scope || "global",
            installed: false,
            status: r.status,
            installedVersion: r.installedVersion,
            remoteVersion: r.remoteVersion,
          });
        }
      }
      if (actionable.length === 0) { cb(); return; }
      pendingSkillInstalls = actionable;
      skillInstallCallback = cb;
      renderSkillInstallDialog(opts, actionable);
    })
    .catch(function () { cb(); });
}

export function requireClayMateInterview(cb) {
  requireSkills({
    title: "Skill Installation Required",
    reason: "The Mate Interview skill is required to create a new Mate.",
    skills: [{ name: "clay-mate-interview", url: "https://github.com/chadbyte/clay-mate-interview", scope: "global" }]
  }, cb);
}
