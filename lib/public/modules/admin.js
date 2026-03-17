// admin.js — Admin management for multi-user mode (renders into server settings sections)
import { iconHtml, refreshIcons } from './icons.js';
import { showToast, copyToClipboard, escapeHtml } from './utils.js';

function showConfirmDialog(message, onConfirm) {
  var modal = document.createElement("div");
  modal.className = "admin-modal-overlay";
  var html = '<div class="admin-modal">' +
    '<div class="admin-modal-body" style="padding:20px 16px 16px">' +
    '<p class="admin-modal-desc" style="margin:0;font-size:14px;color:var(--text)">' + escapeHtml(message) + '</p>' +
    '</div>' +
    '<div class="admin-modal-footer">' +
    '<button class="admin-modal-save admin-modal-confirm-danger">Revoke</button>' +
    '<button class="admin-modal-cancel">Cancel</button>' +
    '</div></div>';
  modal.innerHTML = html;
  document.body.appendChild(modal);
  refreshIcons(modal);
  modal.querySelector(".admin-modal-cancel").addEventListener("click", function () { modal.remove(); });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
  modal.querySelector(".admin-modal-confirm-danger").addEventListener("click", function () {
    modal.remove();
    onConfirm();
  });
}

var ctx = null;
var cachedUsers = [];
var cachedInvites = [];
var cachedProjects = [];
var meInfo = null;

// --- API helpers ---
function apiGet(url) {
  return fetch(url).then(function (r) { return r.json(); });
}

function apiPost(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  }).then(function (r) { return r.json(); });
}

function apiPut(url, body) {
  return fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(function (r) { return r.json(); });
}

function apiDelete(url) {
  return fetch(url, { method: "DELETE" }).then(function (r) { return r.json(); });
}

// --- Init ---
export function initAdmin(appCtx) {
  ctx = appCtx;
}

// Check if user is admin and multi-user mode is active
export function checkAdminAccess() {
  return apiGet("/api/me").then(function (data) {
    meInfo = data;
    return data.multiUser && data.user && data.user.role === "admin";
  }).catch(function () { return false; });
}

// --- Load admin section into a given body element ---
export function loadAdminSection(section, body) {
  body.innerHTML = '<div class="admin-loading">Loading...</div>';
  if (section === "admin-users") {
    loadUsersTab(body);
  } else if (section === "admin-invites") {
    loadInvitesTab(body);
  } else if (section === "admin-projects") {
    loadProjectsTab(body);
  } else if (section === "admin-smtp") {
    loadSmtpTab(body);
  }
}

// --- Users ---
function loadUsersTab(body) {
  apiGet("/api/admin/users").then(function (data) {
    cachedUsers = data.users || [];
    renderUsersTab(body);
  }).catch(function () {
    body.innerHTML = '<div class="admin-error">Failed to load users</div>';
  });
}

function renderUsersTab(body) {
  var html = '<div class="admin-user-list">';
  for (var i = 0; i < cachedUsers.length; i++) {
    var u = cachedUsers[i];
    var isMe = meInfo && meInfo.user && meInfo.user.id === u.id;
    var created = new Date(u.createdAt).toLocaleDateString();
    html += '<div class="admin-user-item">';
    html += '<div class="admin-user-info">';
    html += '<div class="admin-user-name">';
    html += '<strong>' + escapeHtml(u.displayName || u.username) + '</strong>';
    if (u.role === "admin") html += ' <span class="admin-badge">admin</span>';
    if (isMe) html += ' <span class="admin-you-badge">you</span>';
    html += '</div>';
    html += '<div class="admin-user-meta">' + escapeHtml(u.username) + ' · joined ' + created + '</div>';
    html += '</div>';
    if (!isMe && u.role !== "admin") {
      html += '<button class="admin-remove-btn" data-user-id="' + u.id + '" title="Remove user">' + iconHtml("trash-2") + '</button>';
    }
    html += '</div>';
  }
  html += '</div>';

  body.innerHTML = html;
  refreshIcons(body);

  // Bind remove buttons
  var removeBtns = body.querySelectorAll(".admin-remove-btn");
  for (var j = 0; j < removeBtns.length; j++) {
    removeBtns[j].addEventListener("click", function () {
      var userId = this.dataset.userId;
      var user = cachedUsers.find(function (u) { return u.id === userId; });
      var name = user ? (user.displayName || user.username) : "this user";
      if (confirm("Remove " + name + "? This cannot be undone.")) {
        removeUser(userId, body);
      }
    });
  }
}

function removeUser(userId, body) {
  apiDelete("/api/admin/users/" + userId).then(function (data) {
    if (data.ok) {
      showToast("User removed");
      loadUsersTab(body);
    } else {
      showToast(data.error || "Failed to remove user");
    }
  }).catch(function () {
    showToast("Failed to remove user");
  });
}

// --- Invites ---
function loadInvitesTab(body) {
  apiGet("/api/admin/invites").then(function (data) {
    cachedInvites = (data.invites || []).filter(function (inv) {
      return !inv.used && inv.expiresAt > Date.now();
    });
    renderInvitesTab(body);
  }).catch(function () {
    body.innerHTML = '<div class="admin-error">Failed to load invites</div>';
  });
}

function renderInvitesTab(body) {
  var smtpEnabled = meInfo && meInfo.smtpEnabled;
  var html = '<div class="admin-section-header">' +
    '<div class="admin-header-btns">';
  if (smtpEnabled) {
    html += '<button class="admin-action-btn" id="admin-email-invite">' + iconHtml("mail") + ' Email Invite</button>';
  }
  html += '<button class="admin-action-btn admin-action-btn-secondary" id="admin-create-invite">' + iconHtml("plus") + ' Generate Link</button>' +
    '</div></div>';

  if (cachedInvites.length === 0) {
    html += '<div class="admin-empty">No active invites. Generate one to add a new user.</div>';
  } else {
    html += '<div class="admin-invite-list">';
    for (var i = 0; i < cachedInvites.length; i++) {
      var inv = cachedInvites[i];
      var expiresIn = Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / (60 * 60 * 1000)));
      html += '<div class="admin-invite-item">';
      html += '<div class="admin-invite-info">';
      html += '<code class="admin-invite-code">' + escapeHtml(inv.code.substring(0, 8)) + '...</code>';
      if (inv.email) html += '<span class="admin-invite-email">' + escapeHtml(inv.email) + '</span>';
      html += '<span class="admin-invite-expiry">expires in ' + expiresIn + 'h</span>';
      html += '</div>';
      html += '<div class="admin-invite-actions">';
      html += '<button class="admin-copy-link-btn" data-code="' + escapeHtml(inv.code) + '" title="Copy link">' + iconHtml("copy") + '</button>';
      html += '<button class="admin-revoke-btn" data-code="' + escapeHtml(inv.code) + '" title="Revoke">' + iconHtml("x") + '</button>';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  body.innerHTML = html;
  refreshIcons(body);

  // Generate invite link
  var createBtn = body.querySelector("#admin-create-invite");
  if (createBtn) {
    createBtn.addEventListener("click", function () {
      createInvite(body);
    });
  }

  // Email invite
  var emailBtn = body.querySelector("#admin-email-invite");
  if (emailBtn) {
    emailBtn.addEventListener("click", function () {
      showEmailInvitePrompt(body);
    });
  }

  // Copy link buttons
  var copyBtns = body.querySelectorAll(".admin-copy-link-btn");
  for (var j = 0; j < copyBtns.length; j++) {
    copyBtns[j].addEventListener("click", function () {
      var code = this.dataset.code;
      var url = location.origin + "/invite/" + code;
      copyToClipboard(url).then(function () {
        showToast("Invite link copied");
      });
    });
  }

  // Revoke buttons
  var revokeBtns = body.querySelectorAll(".admin-revoke-btn");
  for (var k = 0; k < revokeBtns.length; k++) {
    revokeBtns[k].addEventListener("click", function () {
      var code = this.dataset.code;
      var btn = this;
      showConfirmDialog("Revoke this invite? The link will no longer work.", function () {
        btn.disabled = true;
        fetch("/api/admin/invites/" + encodeURIComponent(code), { method: "DELETE" })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.ok) {
              showToast("Invite revoked");
              loadInvitesTab(body);
            } else {
              showToast(d.error || "Failed to revoke");
              btn.disabled = false;
            }
          })
          .catch(function () {
            showToast("Failed to revoke invite");
            btn.disabled = false;
          });
      });
    });
  }
}

function createInvite(body) {
  apiPost("/api/admin/invites").then(function (data) {
    if (data.ok && data.url) {
      copyToClipboard(data.url).then(function () {
        showToast("Invite link created and copied!");
      }).catch(function () {
        showToast("Invite created: " + data.url);
      });
      loadInvitesTab(body);
    } else {
      showToast(data.error || "Failed to create invite");
    }
  }).catch(function () {
    showToast("Failed to create invite");
  });
}

function showEmailInvitePrompt(body) {
  var modal = document.createElement("div");
  modal.className = "admin-modal-overlay";
  var html = '<div class="admin-modal">' +
    '<div class="admin-modal-header">' +
    '<h3>Send Email Invite</h3>' +
    '<button class="admin-modal-close">' + iconHtml("x") + '</button>' +
    '</div>' +
    '<div class="admin-modal-body">' +
    '<p class="admin-modal-desc">Enter the email address to send an invitation to:</p>' +
    '<input type="email" class="admin-smtp-input" id="admin-invite-email" placeholder="user@example.com" autocomplete="off">' +
    '<div class="admin-smtp-error" id="admin-invite-error"></div>' +
    '</div>' +
    '<div class="admin-modal-footer">' +
    '<button class="admin-modal-save" id="admin-invite-send">Send Invite</button>' +
    '<button class="admin-modal-cancel">Cancel</button>' +
    '</div></div>';
  modal.innerHTML = html;
  document.body.appendChild(modal);
  refreshIcons(modal);

  var emailInput = modal.querySelector("#admin-invite-email");
  var sendBtn = modal.querySelector("#admin-invite-send");
  var errorEl = modal.querySelector("#admin-invite-error");

  modal.querySelector(".admin-modal-close").addEventListener("click", function () { modal.remove(); });
  modal.querySelector(".admin-modal-cancel").addEventListener("click", function () { modal.remove(); });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });

  emailInput.focus();
  emailInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") sendBtn.click();
  });

  sendBtn.addEventListener("click", function () {
    var email = emailInput.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = "Enter a valid email address";
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";
    errorEl.textContent = "";
    apiPost("/api/admin/invites/email", { email: email }).then(function (data) {
      if (data.ok) {
        showToast("Invite sent to " + email);
        modal.remove();
        loadInvitesTab(body);
      } else {
        errorEl.textContent = data.error || "Failed to send invite";
        sendBtn.disabled = false;
        sendBtn.textContent = "Send Invite";
      }
    }).catch(function () {
      errorEl.textContent = "Failed to send invite";
      sendBtn.disabled = false;
      sendBtn.textContent = "Send Invite";
    });
  });
}

// --- SMTP Configuration ---
function loadSmtpTab(body) {
  apiGet("/api/admin/smtp").then(function (data) {
    renderSmtpTab(body, data.smtp);
  }).catch(function () {
    body.innerHTML = '<div class="admin-error">Failed to load SMTP settings</div>';
  });
}

function renderSmtpTab(body, cfg) {
  var hasConfig = !!(cfg && cfg.host);
  var html = '<div class="admin-smtp-form">';

  var emailEnabled = !!(cfg && cfg.emailLoginEnabled);
  if (hasConfig) {
    html += '<div class="admin-smtp-status admin-smtp-status-ok">' + iconHtml("check-circle") + ' SMTP configured. Invite links and one-time login codes are sent via email.</div>';
  } else {
    html += '<div class="admin-smtp-status admin-smtp-status-off">' + iconHtml("mail-x") + ' SMTP not configured. Users log in with a PIN instead of email codes.</div>';
  }

  html += '<div class="admin-smtp-fields">';
  html += '<div class="admin-smtp-row">' +
    '<label>SMTP Host</label>' +
    '<input type="text" id="smtp-host" class="admin-smtp-input" placeholder="smtp.gmail.com" value="' + escapeHtml((cfg && cfg.host) || "") + '">' +
    '</div>';
  html += '<div class="admin-smtp-row-half">' +
    '<div class="admin-smtp-row">' +
    '<label>Port</label>' +
    '<input type="number" id="smtp-port" class="admin-smtp-input" placeholder="587" value="' + ((cfg && cfg.port) || 587) + '">' +
    '</div>' +
    '<div class="admin-smtp-row">' +
    '<label>Secure (TLS)</label>' +
    '<label class="admin-smtp-toggle"><input type="checkbox" id="smtp-secure"' + (cfg && cfg.secure ? " checked" : "") + '><span>Use TLS/SSL</span></label>' +
    '</div></div>';
  html += '<div class="admin-smtp-row">' +
    '<label>Username</label>' +
    '<input type="text" id="smtp-user" class="admin-smtp-input" placeholder="you@gmail.com" value="' + escapeHtml((cfg && cfg.user) || "") + '" autocomplete="off">' +
    '</div>';
  html += '<div class="admin-smtp-row">' +
    '<label>Password</label>' +
    '<input type="password" id="smtp-pass" class="admin-smtp-input" placeholder="App password" value="' + escapeHtml((cfg && cfg.pass) || "") + '" autocomplete="off">' +
    '</div>';
  html += '<div class="admin-smtp-row">' +
    '<label>From Address</label>' +
    '<input type="text" id="smtp-from" class="admin-smtp-input" placeholder="Clay <noreply@example.com>" value="' + escapeHtml((cfg && cfg.from) || "") + '">' +
    '</div>';
  html += '<div class="admin-smtp-row admin-smtp-row-otp">' +
    '<label>Email Login (OTP)</label>' +
    '<label class="admin-smtp-toggle"><input type="checkbox" id="smtp-email-login"' + (emailEnabled ? " checked" : "") + (hasConfig ? "" : " disabled") + '>' +
    '<span>' + (hasConfig ? "Require email for user registration and enable OTP login" : "Configure SMTP first to enable") + '</span></label>' +
    '</div>';
  html += '</div>';

  html += '<div class="admin-smtp-actions">';
  html += '<button class="admin-action-btn" id="smtp-save">' + iconHtml("save") + ' Save</button>';
  html += '<button class="admin-action-btn admin-action-btn-secondary" id="smtp-test">' + iconHtml("send") + ' Test Connection</button>';
  if (hasConfig) {
    html += '<button class="admin-action-btn admin-action-btn-danger" id="smtp-remove">' + iconHtml("trash-2") + ' Remove</button>';
  }
  html += '</div>';
  html += '<div class="admin-smtp-error" id="smtp-error"></div>';
  html += '<div class="admin-smtp-hint">For Gmail, use an <a href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener">App Password</a>. Port 587 with TLS off uses STARTTLS. Port 465 with TLS on uses direct SSL.</div>';
  html += '</div>';

  body.innerHTML = html;
  refreshIcons(body);

  var errorEl = body.querySelector("#smtp-error");

  function getFormData() {
    return {
      host: body.querySelector("#smtp-host").value.trim(),
      port: parseInt(body.querySelector("#smtp-port").value, 10) || 587,
      secure: body.querySelector("#smtp-secure").checked,
      user: body.querySelector("#smtp-user").value.trim(),
      pass: body.querySelector("#smtp-pass").value,
      from: body.querySelector("#smtp-from").value.trim(),
      emailLoginEnabled: body.querySelector("#smtp-email-login").checked,
    };
  }

  // Save
  body.querySelector("#smtp-save").addEventListener("click", function () {
    var formData = getFormData();
    if (!formData.host || !formData.user || !formData.pass || !formData.from) {
      errorEl.textContent = "All fields are required";
      errorEl.className = "admin-smtp-error admin-smtp-error-visible";
      return;
    }
    var btn = this;
    btn.disabled = true;
    errorEl.textContent = "";
    errorEl.className = "admin-smtp-error";
    apiPost("/api/admin/smtp", formData).then(function (data) {
      if (data.ok) {
        showToast("SMTP settings saved");
        loadSmtpTab(body);
      } else {
        errorEl.textContent = data.error || "Failed to save";
        errorEl.className = "admin-smtp-error admin-smtp-error-visible";
        btn.disabled = false;
      }
    }).catch(function () {
      errorEl.textContent = "Failed to save settings";
      errorEl.className = "admin-smtp-error admin-smtp-error-visible";
      btn.disabled = false;
    });
  });

  // Test
  body.querySelector("#smtp-test").addEventListener("click", function () {
    var formData = getFormData();
    if (!formData.host || !formData.user || !formData.pass || !formData.from) {
      errorEl.textContent = "Fill in all fields first";
      errorEl.className = "admin-smtp-error admin-smtp-error-visible";
      return;
    }
    var btn = this;
    btn.disabled = true;
    errorEl.textContent = "";
    errorEl.className = "admin-smtp-error";
    apiPost("/api/admin/smtp/test", formData).then(function (data) {
      if (data.ok) {
        showToast(data.message || "Test email sent!");
        errorEl.textContent = "";
        errorEl.className = "admin-smtp-error";
      } else {
        errorEl.textContent = data.error || "Test failed";
        errorEl.className = "admin-smtp-error admin-smtp-error-visible";
      }
      btn.disabled = false;
    }).catch(function () {
      errorEl.textContent = "Connection failed";
      errorEl.className = "admin-smtp-error admin-smtp-error-visible";
      btn.disabled = false;
    });
  });

  // Remove
  var removeBtn = body.querySelector("#smtp-remove");
  if (removeBtn) {
    removeBtn.addEventListener("click", function () {
      if (confirm("Remove SMTP configuration? Users will need to use PIN login.")) {
        apiPost("/api/admin/smtp", { host: "", user: "", pass: "", from: "" }).then(function () {
          showToast("SMTP configuration removed");
          loadSmtpTab(body);
        });
      }
    });
  }
}

// --- Projects ---
function loadProjectsTab(body) {
  var projectList = (ctx && ctx.projectList) || [];
  cachedProjects = projectList;

  if (projectList.length === 0) {
    body.innerHTML = '<div class="admin-empty">No projects registered.</div>';
    return;
  }

  var promises = projectList.map(function (p) {
    return apiGet("/api/admin/projects/" + p.slug + "/access").then(function (access) {
      return { slug: p.slug, title: p.title || p.project || p.slug, visibility: access.visibility || "public", allowedUsers: access.allowedUsers || [] };
    }).catch(function () {
      return { slug: p.slug, title: p.title || p.project || p.slug, visibility: "public", allowedUsers: [] };
    });
  });

  Promise.all(promises).then(function (projectAccessList) {
    renderProjectsTab(body, projectAccessList);
  });
}

function renderProjectsTab(body, projectAccessList) {
  var html = '<div class="admin-project-list">';
  for (var i = 0; i < projectAccessList.length; i++) {
    var p = projectAccessList[i];
    var visClass = p.visibility === "private" ? "admin-vis-private" : "admin-vis-public";
    html += '<div class="admin-project-item" data-slug="' + escapeHtml(p.slug) + '">';
    html += '<div class="admin-project-info">';
    html += '<div class="admin-project-name">' + escapeHtml(p.title) + '</div>';
    html += '<div class="admin-project-slug">' + escapeHtml(p.slug) + '</div>';
    html += '</div>';
    html += '<div class="admin-project-controls">';
    html += '<select class="admin-vis-select ' + visClass + '" data-slug="' + escapeHtml(p.slug) + '">';
    html += '<option value="public"' + (p.visibility === "public" ? " selected" : "") + '>Public</option>';
    html += '<option value="private"' + (p.visibility === "private" ? " selected" : "") + '>Private</option>';
    html += '</select>';
    if (p.visibility === "private") {
      html += '<button class="admin-manage-users-btn" data-slug="' + escapeHtml(p.slug) + '">' + iconHtml("users") + '</button>';
    }
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';

  body.innerHTML = html;
  refreshIcons(body);

  // Bind visibility selects
  var visSelects = body.querySelectorAll(".admin-vis-select");
  for (var j = 0; j < visSelects.length; j++) {
    visSelects[j].addEventListener("change", function () {
      var slug = this.dataset.slug;
      var visibility = this.value;
      setProjectVisibility(slug, visibility, body);
    });
  }

  // Bind manage users buttons
  var manageUserBtns = body.querySelectorAll(".admin-manage-users-btn");
  for (var k = 0; k < manageUserBtns.length; k++) {
    manageUserBtns[k].addEventListener("click", function () {
      var slug = this.dataset.slug;
      showProjectUsersModal(slug, body);
    });
  }
}

function setProjectVisibility(slug, visibility, body) {
  apiPut("/api/admin/projects/" + slug + "/visibility", { visibility: visibility }).then(function (data) {
    if (data.ok) {
      showToast("Visibility updated");
      loadProjectsTab(body);
    } else {
      showToast(data.error || "Failed to update visibility");
    }
  }).catch(function () {
    showToast("Failed to update visibility");
  });
}

function showProjectUsersModal(slug, parentBody) {
  Promise.all([
    apiGet("/api/admin/users"),
    apiGet("/api/admin/projects/" + slug + "/access"),
  ]).then(function (results) {
    var allUsers = results[0].users || [];
    var access = results[1];
    var allowed = access.allowedUsers || [];

    var modal = document.createElement("div");
    modal.className = "admin-modal-overlay";

    var html = '<div class="admin-modal">';
    html += '<div class="admin-modal-header">';
    html += '<h3>Manage Access: ' + escapeHtml(slug) + '</h3>';
    html += '<button class="admin-modal-close">' + iconHtml("x") + '</button>';
    html += '</div>';
    html += '<div class="admin-modal-body">';
    html += '<p class="admin-modal-desc">Select users who can access this private project:</p>';

    for (var i = 0; i < allUsers.length; i++) {
      var u = allUsers[i];
      if (u.role === "admin") continue;
      var checked = allowed.indexOf(u.id) >= 0 ? " checked" : "";
      html += '<label class="admin-user-check">';
      html += '<input type="checkbox" value="' + u.id + '"' + checked + '>';
      html += '<span>' + escapeHtml(u.displayName || u.username) + ' <small>' + escapeHtml(u.username) + '</small></span>';
      html += '</label>';
    }

    html += '</div>';
    html += '<div class="admin-modal-footer">';
    html += '<button class="admin-modal-save">Save</button>';
    html += '<button class="admin-modal-cancel">Cancel</button>';
    html += '</div>';
    html += '</div>';

    modal.innerHTML = html;
    document.body.appendChild(modal);
    refreshIcons(modal);

    modal.querySelector(".admin-modal-close").addEventListener("click", function () { modal.remove(); });
    modal.querySelector(".admin-modal-cancel").addEventListener("click", function () { modal.remove(); });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.remove();
    });

    modal.querySelector(".admin-modal-save").addEventListener("click", function () {
      var checkboxes = modal.querySelectorAll('input[type="checkbox"]');
      var selectedUsers = [];
      for (var ci = 0; ci < checkboxes.length; ci++) {
        if (checkboxes[ci].checked) selectedUsers.push(checkboxes[ci].value);
      }
      apiPut("/api/admin/projects/" + slug + "/users", { allowedUsers: selectedUsers }).then(function (data) {
        if (data.ok) {
          showToast("Project access updated");
          modal.remove();
          loadProjectsTab(parentBody);
        } else {
          showToast(data.error || "Failed to update access");
        }
      }).catch(function () {
        showToast("Failed to update access");
      });
    });
  }).catch(function () {
    showToast("Failed to load project access info");
  });
}
