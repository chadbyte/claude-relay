// user-settings.js — Modal dialog for user settings
// Account management and logout

import { refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { toggleDarkMode, getCurrentTheme, getChatLayout, setChatLayout } from './theme.js';
import { showEmailSetupModal, getEmailAccountListCache } from './context-sources.js';
import { setSTTLang } from './stt.js';
import { userAvatarUrl } from './avatar.js';
import { store } from './store.js';

var ctx = null;
var settingsEl = null;
var openBtn = null;
var closeBtn = null;
var backdrop = null;
var navItems = null;
var sections = null;
var pinForm = null;
var pinSetBtn = null;
var pinCancelBtn = null;
var pinEnabled = false;
var currentProfile = null;


export function initUserSettings(appCtx) {
  ctx = appCtx;
  settingsEl = document.getElementById('user-settings');
  openBtn = document.getElementById('user-settings-btn');
  closeBtn = document.getElementById('user-settings-close');
  backdrop = document.getElementById('user-settings-backdrop');

  if (!settingsEl || !openBtn) return;

  navItems = settingsEl.querySelectorAll('.us-nav-item');
  sections = settingsEl.querySelectorAll('.us-section');
  pinForm = document.getElementById('us-pin-form');

  openBtn.addEventListener('click', function () {
    openUserSettings();
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      closeUserSettings();
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', function () {
      closeUserSettings();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isUserSettingsOpen()) {
      closeUserSettings();
    }
  });

  for (var i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener('click', function () {
      var section = this.dataset.section;
      switchSection(section);
    });
  }

  // Mobile nav dropdown
  var navDropdown = document.getElementById('user-settings-nav-dropdown');
  if (navDropdown) {
    navDropdown.addEventListener('change', function () {
      switchSection(this.value);
    });
  }

  // PIN save button
  var pinInput = document.getElementById('us-pin-input');
  var pinConfirmInput = document.getElementById('us-pin-confirm-input');
  var pinCurrentInput = document.getElementById('us-pin-current-input');
  var pinSave = document.getElementById('us-pin-save');
  pinSetBtn = document.getElementById('us-pin-set-btn');
  pinCancelBtn = document.getElementById('us-pin-cancel');
  if (pinInput && pinConfirmInput && pinSave) {
    function validatePin() {
      var validNew = /^\d{6}$/.test(pinInput.value);
      var validConfirm = /^\d{6}$/.test(pinConfirmInput.value);
      var validCurrent = !pinEnabled || (pinCurrentInput && /^\d{6}$/.test(pinCurrentInput.value));
      pinSave.disabled = !(validNew && validConfirm && validCurrent && pinInput.value === pinConfirmInput.value);
    }
    pinInput.addEventListener('input', validatePin);
    pinConfirmInput.addEventListener('input', validatePin);
    if (pinCurrentInput) pinCurrentInput.addEventListener('input', validatePin);
    pinInput.addEventListener('keyup', function (e) { e.stopPropagation(); validatePin(); });
    pinConfirmInput.addEventListener('keyup', function (e) { e.stopPropagation(); validatePin(); });
    if (pinCurrentInput) pinCurrentInput.addEventListener('keyup', function (e) { e.stopPropagation(); validatePin(); });
    pinInput.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        savePin(pinInput.value);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hidePinForm();
      }
    });
    pinConfirmInput.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        savePin(pinInput.value);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hidePinForm();
      }
    });
    if (pinCurrentInput) {
      pinCurrentInput.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          savePin(pinInput.value);
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          hidePinForm();
        }
      });
    }
    pinInput.addEventListener('keypress', stopProp);
    pinConfirmInput.addEventListener('keypress', stopProp);
    if (pinCurrentInput) pinCurrentInput.addEventListener('keypress', stopProp);
    pinSave.addEventListener('click', function () {
      savePin(pinInput.value);
    });
  }
  if (pinSetBtn) {
    pinSetBtn.addEventListener('click', function () {
      showPinForm();
    });
  }
  if (pinCancelBtn) {
    pinCancelBtn.addEventListener('click', function () {
      hidePinForm();
    });
  }

  var langSelect = document.getElementById('us-lang-select');
  if (langSelect) {
    langSelect.addEventListener('change', function () {
      saveProfileChange({ lang: this.value });
    });
  }

  // Auto-continue toggle
  var autoContinueToggle = document.getElementById('us-auto-continue');
  if (autoContinueToggle) {
    autoContinueToggle.addEventListener('change', function () {
      fetch('/api/user/auto-continue', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: this.checked }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.ok) showToast(data.autoContinueOnRateLimit ? 'Auto-continue on' : 'Auto-continue off');
      }).catch(function () {});
    });
  }

  // Mates UI toggle. Default-on, so flipping off hides every Mates
  // surface in the app (sidebar avatars, DM picker entry, home-hub strip)
  // via the body.mates-disabled CSS gate. Flipping back on restores the
  // surface; existing Mate data is never deleted.
  var matesEnabledToggle = document.getElementById('us-mates-enabled');
  if (matesEnabledToggle) {
    matesEnabledToggle.addEventListener('change', function () {
      var want = !!this.checked;
      applyMatesEnabledClass(want);
      store.set({ matesEnabled: want });
      fetch('/api/user/mates-enabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: want }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.ok) showToast(data.matesEnabled ? 'Mates on' : 'Mates off');
      }).catch(function () {});
    });
  }

  // Theme switcher (Light / Dark)
  var themeSwitcher = document.getElementById('us-theme-switcher');
  if (themeSwitcher) {
    var themeBtns = themeSwitcher.querySelectorAll('.layout-option');
    for (var ti = 0; ti < themeBtns.length; ti++) {
      themeBtns[ti].addEventListener('click', function () {
        var mode = this.dataset.theme;
        var current = getCurrentTheme();
        var currentMode = (current && current.variant) || 'dark';
        if (mode !== currentMode) toggleDarkMode();
        for (var tj = 0; tj < themeBtns.length; tj++) {
          themeBtns[tj].classList.toggle('selected', themeBtns[tj].dataset.theme === mode);
        }
      });
    }
  }

  // Layout switcher (Bubble / Channel)
  var layoutSwitcher = document.getElementById('us-layout-switcher');
  if (layoutSwitcher) {
    var layoutBtns = layoutSwitcher.querySelectorAll('.layout-option');
    for (var li = 0; li < layoutBtns.length; li++) {
      layoutBtns[li].addEventListener('click', function () {
        var layout = this.dataset.layout;
        setChatLayout(layout);
        for (var lj = 0; lj < layoutBtns.length; lj++) {
          layoutBtns[lj].classList.toggle('selected', layoutBtns[lj].dataset.layout === layout);
        }
        // Save to server
        fetch('/api/user/chat-layout', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout: layout }),
        }).catch(function () {});
      });
    }
  }

  // Logout button
  var logoutBtn = document.getElementById('us-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      fetch('/auth/logout', { method: 'POST' }).then(function () {
        window.location.reload();
      }).catch(function () {
        window.location.reload();
      });
    });
  }

  // Email: Add Account button
  var emailAddBtn = document.getElementById('us-email-add');
  if (emailAddBtn) {
    emailAddBtn.addEventListener('click', function () {
      showEmailSetupModal();
    });
  }
}

// Optional `initialSection` lets callers deep-link directly into a specific
// settings tab (e.g. the disabled-Mates picker button passing 'us-mates').
// Falls back to Account so existing callers and the icon click are unchanged.
export function openUserSettings(initialSection) {
  settingsEl.classList.remove('hidden');
  openBtn.classList.add('active');
  refreshIcons(settingsEl);
  populateAccount();
  hidePinForm();
  switchSection(initialSection || 'us-account');
}

export function closeUserSettings() {
  settingsEl.classList.add('hidden');
  openBtn.classList.remove('active');
}

export function isUserSettingsOpen() {
  return settingsEl && !settingsEl.classList.contains('hidden');
}

function switchSection(sectionName) {
  for (var i = 0; i < navItems.length; i++) {
    navItems[i].classList.toggle('active', navItems[i].dataset.section === sectionName);
  }
  for (var j = 0; j < sections.length; j++) {
    sections[j].classList.toggle('active', sections[j].dataset.section === sectionName);
  }
  var navDropdown = document.getElementById('user-settings-nav-dropdown');
  if (navDropdown) navDropdown.value = sectionName;
  if (sectionName === 'us-email') renderEmailSettings();
}

function stopProp(e) {
  e.stopPropagation();
}

// Mates UI gate. When the toggle is off we add `mates-disabled` to the
// body so CSS can hide every Mates surface (sidebar avatars, DM picker
// "Create a Mate" entry, home-hub mates strip) without touching the
// underlying data. JS code paths that gate on `store.get('matesEnabled')`
// also short-circuit so we don't, for example, open the mate wizard if
// someone fires it programmatically.
function applyMatesEnabledClass(enabled) {
  if (!document.body) return;
  document.body.classList.toggle('mates-disabled', !enabled);
}

export function isMatesEnabled() {
  // Default to true if the store hasn't received profile yet — populating
  // the false state happens after /api/profile resolves, so an undefined
  // value at boot should not hide Mates UI.
  return store.get('matesEnabled') !== false;
}

function showPinForm() {
  if (!pinForm) return;
  pinForm.classList.remove('hidden');
  var pinCurrentRow = document.getElementById('us-pin-current-row');
  var pinInput = document.getElementById('us-pin-input');
  var pinConfirmInput = document.getElementById('us-pin-confirm-input');
  var pinCurrentInput = document.getElementById('us-pin-current-input');
  var pinSave = document.getElementById('us-pin-save');
  var pinMsg = document.getElementById('us-pin-msg');
  var pinFormTitle = document.getElementById('us-pin-form-title');
  if (pinFormTitle) {
    pinFormTitle.textContent = pinEnabled ? 'Change PIN' : 'Set PIN';
  }
  if (pinCurrentRow) {
    pinCurrentRow.classList.toggle('hidden', !pinEnabled);
  }
  if (pinInput) {
    pinInput.value = '';
  }
  if (pinConfirmInput) pinConfirmInput.value = '';
  if (pinCurrentInput) pinCurrentInput.value = '';
  if (pinSave) pinSave.disabled = true;
  if (pinSave) pinSave.textContent = 'Save';
  if (pinMsg) {
    pinMsg.textContent = '';
    pinMsg.className = 'settings-hint settings-pin-error hidden';
  }
  if (pinEnabled && pinCurrentInput) {
    pinCurrentInput.focus();
  } else if (pinInput) {
    pinInput.focus();
  }
}

function hidePinForm() {
  if (!pinForm) return;
  pinForm.classList.add('hidden');
  var pinCurrentRow = document.getElementById('us-pin-current-row');
  var pinInput = document.getElementById('us-pin-input');
  var pinConfirmInput = document.getElementById('us-pin-confirm-input');
  var pinCurrentInput = document.getElementById('us-pin-current-input');
  var pinSave = document.getElementById('us-pin-save');
  var pinMsg = document.getElementById('us-pin-msg');
  if (pinCurrentRow) {
    pinCurrentRow.classList.remove('hidden');
  }
  if (pinInput) pinInput.value = '';
  if (pinConfirmInput) pinConfirmInput.value = '';
  if (pinCurrentInput) pinCurrentInput.value = '';
  if (pinSave) pinSave.disabled = true;
  if (pinSave) pinSave.textContent = 'Save';
  if (pinMsg) {
    pinMsg.textContent = '';
    pinMsg.className = 'settings-hint settings-pin-error hidden';
  }
}

// --- Account population ---

function populateAccount() {
  fetch('/api/profile').then(function (r) {
    if (!r.ok) return null;
    return r.json();
  }).then(function (data) {
    if (!data) return;
    currentProfile = data;
    var displayName = data.name || data.displayName || data.username || 'Clay User';
    var avatarImg = document.getElementById('us-account-avatar-img');
    var avatarFallback = document.getElementById('us-account-avatar-fallback');
    var accountName = document.getElementById('us-account-name');
    var accountSubline = document.getElementById('us-account-subline');
    var langSelect = document.getElementById('us-lang-select');
    var pinSetBtnEl = document.getElementById('us-pin-set-btn');
    var pinFormTitle = document.getElementById('us-pin-form-title');
    if (accountName) {
      accountName.textContent = displayName;
    }
    if (accountSubline) {
      var parts = [];
      if (data.username) parts.push('@' + data.username);
      if (data.role) parts.push(data.role.charAt(0).toUpperCase() + data.role.slice(1));
      accountSubline.textContent = parts.length ? parts.join(' · ') : 'Local profile';
    }
    pinEnabled = !!data.pinEnabled;
    if (pinSetBtnEl) {
      pinSetBtnEl.textContent = pinEnabled ? 'Change PIN' : 'Set PIN';
    }
    if (pinFormTitle) {
      pinFormTitle.textContent = pinEnabled ? 'Change PIN' : 'Set PIN';
    }
    if (langSelect) {
      langSelect.value = data.lang || 'en-US';
    }
    if (data.lang) {
      setSTTLang(data.lang);
    }
    if (avatarImg && avatarFallback) {
      var avatarUrl = getCurrentUserAvatarSrc(data);
      avatarImg.alt = displayName;
      avatarImg.classList.remove('hidden');
      avatarFallback.classList.remove('hidden');
      avatarFallback.textContent = avatarInitials(displayName);
      avatarImg.onload = function () {
        avatarFallback.classList.add('hidden');
      };
      avatarImg.onerror = function () {
        avatarFallback.classList.remove('hidden');
      };
      avatarImg.src = avatarUrl;
      if (avatarImg.complete && avatarImg.naturalWidth > 0) {
        avatarFallback.classList.add('hidden');
      }
    }
    // Hide account section in single-user mode (no username)
    var accountNav = settingsEl.querySelector('[data-section="us-account"]');
    if (accountNav) accountNav.style.display = data.username ? '' : 'none';
    // Auto-continue toggle
    var acToggle = document.getElementById('us-auto-continue');
    if (acToggle) acToggle.checked = !!data.autoContinueOnRateLimit;
    // Theme switcher
    var tSwitcher = document.getElementById('us-theme-switcher');
    if (tSwitcher) {
      var currentMode = (getCurrentTheme() && getCurrentTheme().variant) || 'dark';
      var tBtns = tSwitcher.querySelectorAll('.layout-option');
      for (var ti = 0; ti < tBtns.length; ti++) {
        tBtns[ti].classList.toggle('selected', tBtns[ti].dataset.theme === currentMode);
      }
    }
    // Layout switcher: sync from server response
    // Sync mate onboarding state from server
    if (data.mateOnboardingShown) {
      try { localStorage.setItem("clay-mate-onboarding-shown", "1"); } catch (e) {}
    }
    // Mates UI toggle: default true; treat any missing/non-false value as on
    var matesOn = data.matesEnabled !== false;
    var matesToggle = document.getElementById('us-mates-enabled');
    if (matesToggle) matesToggle.checked = matesOn;
    store.set({ matesEnabled: matesOn });
    applyMatesEnabledClass(matesOn);
    if (data.chatLayout) {
      setChatLayout(data.chatLayout); // update local cache + CSS
    }
    var lSwitcher = document.getElementById('us-layout-switcher');
    if (lSwitcher) {
      var currentLayout = getChatLayout();
      var lBtns = lSwitcher.querySelectorAll('.layout-option');
      for (var li = 0; li < lBtns.length; li++) {
        lBtns[li].classList.toggle('selected', lBtns[li].dataset.layout === currentLayout);
      }
    }
  }).catch(function () {});
}

function saveProfileChange(updates) {
  if (!currentProfile) return;
  var nextProfile = {};
  var payload = {};
  var key;
  for (key in currentProfile) {
    if (Object.prototype.hasOwnProperty.call(currentProfile, key)) {
      nextProfile[key] = currentProfile[key];
    }
  }
  for (key in updates) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      nextProfile[key] = updates[key];
    }
  }
  currentProfile = nextProfile;
  if (updates.lang) {
    setSTTLang(updates.lang);
  }
  payload.name = nextProfile.name;
  payload.lang = nextProfile.lang;
  payload.avatarColor = nextProfile.avatarColor;
  payload.avatarStyle = nextProfile.avatarStyle;
  payload.avatarSeed = nextProfile.avatarSeed;
  payload.avatarCustom = nextProfile.avatarCustom;
  fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(function () {});
}

function avatarInitials(value) {
  var text = (value || '').trim();
  if (!text) return '?';
  var parts = text.split(/\s+/);
  var first = parts[0].charAt(0);
  var second = parts.length > 1 ? parts[1].charAt(0) : parts[0].charAt(1);
  var out = first + (second || '');
  return out.toUpperCase();
}

function getCurrentUserAvatarSrc(data) {
  var islandAvatar = document.querySelector('.user-island-avatar img');
  if (islandAvatar && islandAvatar.src) return islandAvatar.src;
  if (data && data.avatarCustom) return data.avatarCustom;
  return userAvatarUrl(data, 96);
}

function savePin(pin) {
  var pinInput = document.getElementById('us-pin-input');
  var pinConfirmInput = document.getElementById('us-pin-confirm-input');
  var pinCurrentInput = document.getElementById('us-pin-current-input');
  var pinSave = document.getElementById('us-pin-save');
  var pinMsg = document.getElementById('us-pin-msg');
  var currentPin = pinCurrentInput ? pinCurrentInput.value.trim() : '';
  var confirmPin = pinConfirmInput ? pinConfirmInput.value.trim() : '';
  var newPin = pinInput ? pinInput.value.trim() : '';

  if (!/^\d{6}$/.test(newPin)) {
    if (pinMsg) {
      pinMsg.textContent = 'PIN must be exactly 6 digits.';
      pinMsg.className = 'settings-hint settings-pin-error us-pin-msg-err';
      pinMsg.classList.remove('hidden');
    }
    return;
  }
  if (confirmPin !== newPin) {
    if (pinMsg) {
      pinMsg.textContent = 'PINs do not match.';
      pinMsg.className = 'settings-hint settings-pin-error us-pin-msg-err';
      pinMsg.classList.remove('hidden');
    }
    return;
  }
  if (pinEnabled && !/^\d{6}$/.test(currentPin)) {
    if (pinMsg) {
      pinMsg.textContent = 'Current PIN is required.';
      pinMsg.className = 'settings-hint settings-pin-error us-pin-msg-err';
      pinMsg.classList.remove('hidden');
    }
    return;
  }

  pinSave.disabled = true;
  pinSave.textContent = 'Saving\u2026';

  fetch('/api/user/pin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPin: currentPin, newPin: newPin }),
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (data.ok) {
      showToast('PIN changed');
      hidePinForm();
    } else {
      pinSave.disabled = false;
      pinSave.textContent = 'Save';
      if (pinMsg) {
        pinMsg.textContent = data.error || 'Could not change your PIN. Please try again.';
        pinMsg.className = 'settings-hint settings-pin-error us-pin-msg-err';
        pinMsg.classList.remove('hidden');
      }
    }
  }).catch(function () {
    pinSave.disabled = false;
    pinSave.textContent = 'Save';
    if (pinMsg) {
      pinMsg.textContent = 'Connection lost. Check your network and try again.';
      pinMsg.className = 'settings-hint settings-pin-error us-pin-msg-err';
      pinMsg.classList.remove('hidden');
    }
  });
}

// --- Email settings ---

function renderEmailSettings() {
  var listEl = document.getElementById('us-email-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  var accounts = getEmailAccountListCache();
  if (!accounts || accounts.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'settings-field';
    empty.innerHTML = '<div class="us-email-empty">No email accounts connected yet.</div>';
    listEl.appendChild(empty);
    return;
  }

  for (var i = 0; i < accounts.length; i++) {
    var acc = accounts[i];
    var row = document.createElement('div');
    row.className = 'us-email-row';
    row.innerHTML =
      '<div class="us-email-icon">' + providerIcon(acc.provider) + '</div>' +
      '<div class="us-email-info">' +
        '<div class="us-email-addr">' + escHtml(acc.email) + '</div>' +
        '<div class="us-email-provider">' + escHtml(acc.label || acc.provider || 'Custom') + '</div>' +
      '</div>' +
      '<button class="us-email-remove-btn" data-account-id="' + escHtml(acc.id) + '">Remove</button>';

    var removeBtn = row.querySelector('button');
    removeBtn.addEventListener('click', function () {
      var accountId = this.getAttribute('data-account-id');
      if (ctx && ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: 'email_account_remove', accountId: accountId }));
      }
    });

    listEl.appendChild(row);
  }
}

export function refreshEmailSettings() {
  if (isUserSettingsOpen()) renderEmailSettings();
}

var PROVIDER_ICON_PATHS = {
  gmail: '/icons/email/gmail.svg',
  outlook: '/icons/email/outlook.svg',
  yahoo: '/icons/email/yahoo.svg',
};

function providerIcon(provider) {
  var src = PROVIDER_ICON_PATHS[provider];
  if (src) {
    return '<img src="' + src + '" class="us-email-provider-icon" alt="' + provider + '">';
  }
  return '<i data-lucide="mail" class="us-email-provider-icon-fallback"></i>';
}

function escHtml(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
