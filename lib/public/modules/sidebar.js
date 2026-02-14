import { escapeHtml, copyToClipboard } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var ctx;

// --- Session context menu ---
var sessionCtxMenu = null;
var sessionCtxSessionId = null;

function closeSessionCtxMenu() {
  if (sessionCtxMenu) {
    sessionCtxMenu.remove();
    sessionCtxMenu = null;
    sessionCtxSessionId = null;
  }
}

function showSessionCtxMenu(anchorBtn, sessionId, title, cliSid) {
  closeSessionCtxMenu();
  sessionCtxSessionId = sessionId;

  var menu = document.createElement("div");
  menu.className = "session-ctx-menu";

  var renameItem = document.createElement("button");
  renameItem.className = "session-ctx-item";
  renameItem.innerHTML = iconHtml("pencil") + " <span>Rename</span>";
  renameItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    startInlineRename(sessionId, title);
  });
  menu.appendChild(renameItem);

  if (cliSid) {
    var copyResumeItem = document.createElement("button");
    copyResumeItem.className = "session-ctx-item";
    copyResumeItem.innerHTML = iconHtml("copy") + " <span>Copy resume command</span>";
    copyResumeItem.addEventListener("click", function (e) {
      e.stopPropagation();
      copyToClipboard("claude --resume " + cliSid).then(function () {
        copyResumeItem.innerHTML = iconHtml("check") + " <span>Copied!</span>";
        refreshIcons();
        setTimeout(function () { closeSessionCtxMenu(); }, 800);
      });
    });
    menu.appendChild(copyResumeItem);
  }

  var deleteItem = document.createElement("button");
  deleteItem.className = "session-ctx-item session-ctx-delete";
  deleteItem.innerHTML = iconHtml("trash-2") + " <span>Delete</span>";
  deleteItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    ctx.showConfirm('Delete "' + (title || "New Session") + '"? This session and its history will be permanently removed.', function () {
      var ws = ctx.ws;
      if (ws && ctx.connected) {
        ws.send(JSON.stringify({ type: "delete_session", id: sessionId }));
      }
    });
  });
  menu.appendChild(deleteItem);

  anchorBtn.parentElement.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  // Position: align to right edge of parent, below the button
  requestAnimationFrame(function () {
    var rect = menu.getBoundingClientRect();
    var parentRect = menu.parentElement.getBoundingClientRect();
    // If menu overflows below the sidebar, flip up
    var sidebarRect = ctx.sessionListEl.getBoundingClientRect();
    if (rect.bottom > sidebarRect.bottom) {
      menu.style.top = "auto";
      menu.style.bottom = "100%";
      menu.style.marginBottom = "2px";
    }
  });
}

function startInlineRename(sessionId, currentTitle) {
  var el = ctx.sessionListEl.querySelector('.session-item[data-session-id="' + sessionId + '"]');
  if (!el) return;
  var textSpan = el.querySelector(".session-item-text");
  if (!textSpan) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = currentTitle || "New Session";

  var originalHtml = textSpan.innerHTML;
  textSpan.innerHTML = "";
  textSpan.appendChild(input);
  input.focus();
  input.select();

  function commitRename() {
    var newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "rename_session", id: sessionId, title: newTitle }));
    }
    // Restore text (server will send updated session_list)
    textSpan.innerHTML = originalHtml;
    if (newTitle && newTitle !== currentTitle) {
      textSpan.textContent = newTitle;
    }
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); textSpan.innerHTML = originalHtml; }
  });
  input.addEventListener("blur", commitRename);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

export function renderSessionList(sessions) {
  ctx.sessionListEl.innerHTML = "";
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var el = document.createElement("div");
    el.className = "session-item" + (s.active ? " active" : "");
    el.dataset.sessionId = s.id;

    var textSpan = document.createElement("span");
    textSpan.className = "session-item-text";
    var textHtml = "";
    if (s.isProcessing) {
      textHtml += '<span class="session-processing"></span>';
    }
    textHtml += escapeHtml(s.title || "New Session");
    textSpan.innerHTML = textHtml;
    el.appendChild(textSpan);

    var moreBtn = document.createElement("button");
    moreBtn.className = "session-more-btn";
    moreBtn.innerHTML = iconHtml("ellipsis");
    moreBtn.title = "More options";
    moreBtn.addEventListener("click", (function(id, title, cliSid, btn) {
      return function(e) {
        e.stopPropagation();
        showSessionCtxMenu(btn, id, title, cliSid);
      };
    })(s.id, s.title, s.cliSessionId, moreBtn));
    el.appendChild(moreBtn);

    el.addEventListener("click", (function (id) {
      return function () {
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
          closeSidebar();
        }
      };
    })(s.id));

    ctx.sessionListEl.appendChild(el);
  }
  refreshIcons();
  updatePageTitle();
}

export function updatePageTitle() {
  var sessionTitle = "";
  var activeItem = ctx.sessionListEl.querySelector(".session-item.active .session-item-text");
  if (activeItem) sessionTitle = activeItem.textContent;
  if (ctx.projectName && sessionTitle) {
    document.title = ctx.projectName + " - " + sessionTitle;
  } else if (ctx.projectName) {
    document.title = ctx.projectName;
  } else {
    document.title = "Claude Relay";
  }
}

export function openSidebar() {
  ctx.sidebar.classList.add("open");
  ctx.sidebarOverlay.classList.add("visible");
}

export function closeSidebar() {
  ctx.sidebar.classList.remove("open");
  ctx.sidebarOverlay.classList.remove("visible");
}

export function initSidebar(_ctx) {
  ctx = _ctx;

  document.addEventListener("click", function () { closeSessionCtxMenu(); });

  ctx.hamburgerBtn.addEventListener("click", function () {
    ctx.sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });

  ctx.sidebarOverlay.addEventListener("click", closeSidebar);

  // --- Desktop sidebar collapse/expand ---
  function toggleSidebarCollapse() {
    var layout = ctx.$("layout");
    var collapsed = layout.classList.toggle("sidebar-collapsed");
    try { localStorage.setItem("sidebar-collapsed", collapsed ? "1" : ""); } catch (e) {}
  }

  ctx.sidebarToggleBtn.addEventListener("click", toggleSidebarCollapse);
  ctx.sidebarExpandBtn.addEventListener("click", toggleSidebarCollapse);

  // Restore collapsed state from localStorage
  try {
    if (localStorage.getItem("sidebar-collapsed") === "1") {
      ctx.$("layout").classList.add("sidebar-collapsed");
    }
  } catch (e) {}

  ctx.newSessionBtn.addEventListener("click", function () {
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
      closeSidebar();
    }
  });

  // --- Resume session modal ---
  var resumeModal = ctx.$("resume-modal");
  var resumeInput = ctx.$("resume-session-input");
  var resumeOk = ctx.$("resume-ok");
  var resumeCancel = ctx.$("resume-cancel");

  function openResumeModal() {
    resumeModal.classList.remove("hidden");
    resumeInput.value = "";
    setTimeout(function () { resumeInput.focus(); }, 50);
  }

  function closeResumeModal() {
    resumeModal.classList.add("hidden");
    resumeInput.value = "";
  }

  function submitResume() {
    var val = resumeInput.value.trim();
    if (!val) return;
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "resume_session", cliSessionId: val }));
    }
    closeResumeModal();
    closeSidebar();
  }

  ctx.resumeSessionBtn.addEventListener("click", openResumeModal);
  resumeOk.addEventListener("click", submitResume);
  resumeCancel.addEventListener("click", closeResumeModal);
  resumeModal.querySelector(".confirm-backdrop").addEventListener("click", closeResumeModal);

  resumeInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitResume();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeResumeModal();
    }
  });

  // --- Sidebar tabs ---
  var tabs = document.querySelectorAll(".sidebar-tab");
  var panels = document.querySelectorAll(".sidebar-panel");

  function switchTab(tabName) {
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("active", tabs[i].dataset.tab === tabName);
    }
    for (var j = 0; j < panels.length; j++) {
      var panelTab = panels[j].id.replace("sidebar-panel-", "");
      panels[j].classList.toggle("hidden", panelTab !== tabName);
    }
    if (tabName === "files" && ctx.onFilesTabOpen) {
      ctx.onFilesTabOpen();
    }
  }

  for (var t = 0; t < tabs.length; t++) {
    (function (tab) {
      tab.addEventListener("click", function () {
        switchTab(tab.dataset.tab);
      });
    })(tabs[t]);
  }
}
