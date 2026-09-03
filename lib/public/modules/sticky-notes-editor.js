// Sticky-note text editing: the WYSIWYG format toolbar and the contenteditable
// surface behind it.
//
// Split out of sticky-notes.js to keep every module under the size limit. It
// owns the toolbar element and nothing else, and depends only on the leaf
// helpers, so it never has to reach back into the canvas.

import { refreshIcons, iconHtml } from './icons.js';
import { extractMarkdown, renderMiniMarkdown } from './sticky-note-markdown.js';
import { debouncedTextUpdate, syncTitle } from './sticky-notes-shared.js';

var formatToolbarEl = null;

// --- Text edit (contenteditable) ---

// --- Format toolbar (WYSIWYG) ---

var FORMAT_BUTTONS = [
  { label: "B", title: "Bold", cls: "sn-fmt-bold", command: "bold" },
  { label: "I", title: "Italic", cls: "sn-fmt-italic", command: "italic" },
  { label: "S", title: "Strikethrough", cls: "sn-fmt-strike", command: "strikethrough" },
  { label: "code-2", title: "Code", cls: "sn-fmt-code", command: "code", isIcon: true },
];

// The canvas asks this before deciding an outside click should dismiss the
// toolbar, so the element itself stays private to this module.
export function isFormatToolbarOpen() {
  return !!formatToolbarEl;
}
export function closeFormatToolbar() {
  if (formatToolbarEl) {
    formatToolbarEl.remove();
    formatToolbarEl = null;
  }
}

function applyFormat(command, rendered) {
  if (command === "code") {
    var sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    var ancestor = range.commonAncestorContainer;
    var codeParent = (ancestor.nodeType === 3 ? ancestor.parentElement : ancestor);
    if (codeParent && codeParent.closest && codeParent.closest("code")) {
      // Unwrap: replace <code> with its text content
      var codeEl = codeParent.closest("code");
      var textNode = document.createTextNode(codeEl.textContent);
      codeEl.parentNode.replaceChild(textNode, codeEl);
      var newRange = document.createRange();
      newRange.selectNodeContents(textNode);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      // Wrap selection in <code>
      var code = document.createElement("code");
      try { range.surroundContents(code); } catch (e) {
        var frag = range.extractContents();
        code.appendChild(frag);
        range.insertNode(code);
      }
    }
  } else {
    document.execCommand(command, false, null);
  }
  // Trigger sync
  rendered.dispatchEvent(new Event("input", { bubbles: true }));
}

function showFormatToolbar(rendered) {
  closeFormatToolbar();

  var sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return;
  if (!sel.toString().trim()) return;

  var range = sel.getRangeAt(0);
  // When dragging outside the note, commonAncestorContainer may be a parent
  // of rendered. Clamp the range to the rendered element so the toolbar shows.
  if (!rendered.contains(range.commonAncestorContainer)) {
    try {
      var clampedRange = range.cloneRange();
      if (range.startContainer === rendered || rendered.contains(range.startContainer)) {
        clampedRange.selectNodeContents(rendered);
        clampedRange.setStart(range.startContainer, range.startOffset);
      } else if (range.endContainer === rendered || rendered.contains(range.endContainer)) {
        clampedRange.selectNodeContents(rendered);
        clampedRange.setEnd(range.endContainer, range.endOffset);
      } else {
        return;
      }
      range = clampedRange;
    } catch (e) {
      return;
    }
  }

  var toolbar = document.createElement("div");
  toolbar.className = "sn-format-toolbar";

  for (var i = 0; i < FORMAT_BUTTONS.length; i++) {
    (function (cfg) {
      var btn = document.createElement("button");
      btn.className = "sn-fmt-btn " + cfg.cls;
      btn.title = cfg.title;
      btn.innerHTML = cfg.isIcon ? iconHtml(cfg.label) : cfg.label;
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();
        applyFormat(cfg.command, rendered);
        setTimeout(function () {
          var s = window.getSelection();
          if (s && !s.isCollapsed) {
            showFormatToolbar(rendered);
          } else {
            closeFormatToolbar();
          }
        }, 0);
      });
      toolbar.appendChild(btn);
    })(FORMAT_BUTTONS[i]);
  }

  refreshIcons();
  document.body.appendChild(toolbar);
  formatToolbarEl = toolbar;
  positionToolbarAtRange(toolbar, range);
}

function positionToolbarAtRange(toolbar, range) {
  var rect = range.getBoundingClientRect();
  var toolbarX = rect.left + rect.width / 2;
  var toolbarY = rect.top - 4;

  toolbar.style.left = toolbarX + "px";
  toolbar.style.top = toolbarY + "px";

  requestAnimationFrame(function () {
    var tw = toolbar.offsetWidth;
    var th = toolbar.offsetHeight;
    var x = Math.max(8, Math.min(toolbarX - tw / 2, window.innerWidth - tw - 8));
    var y = Math.max(8, toolbarY - th);
    toolbar.style.left = x + "px";
    toolbar.style.top = y + "px";
  });
}

export function setupTextEdit(textarea, rendered, noteId, mdBtn) {
  var noteEl = textarea.closest(".sticky-note");
  var mdMode = false;

  function saveRenderedMarkdown() {
    var markdown = extractMarkdown(rendered);
    textarea.value = markdown;
    debouncedTextUpdate(noteId, markdown);
    syncTitle(noteEl, markdown);
    rendered.classList.toggle("is-empty", !markdown.trim());
  }

  function toggleChecklistItem(check) {
    var checked = !check.classList.contains("checked");
    check.classList.toggle("checked", checked);
    check.textContent = checked ? "✓" : "☐";
    check.setAttribute("aria-checked", checked ? "true" : "false");
    saveRenderedMarkdown();
  }

  // MD button: toggle between contenteditable rendered view and raw textarea
  mdBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    mdMode = !mdMode;
    if (mdMode) {
      // Switch to raw markdown editing
      var md = extractMarkdown(rendered);
      textarea.value = md;
      textarea.style.display = "";
      rendered.style.display = "none";
      mdBtn.classList.add("active");
      textarea.focus();
    } else {
      // Switch back to contenteditable rendered view
      var md = textarea.value;
      debouncedTextUpdate(noteId, md);
      syncTitle(noteEl, md);
      if (md.trim()) {
        rendered.innerHTML = renderMiniMarkdown(md);
        rendered.classList.remove("is-empty");
      } else {
        rendered.innerHTML = "";
        rendered.classList.add("is-empty");
      }
      textarea.style.display = "none";
      rendered.style.display = "";
      mdBtn.classList.remove("active");
      rendered.focus();
    }
  });

  // Sync contenteditable changes to textarea (data store) and save
  rendered.addEventListener("input", function () {
    saveRenderedMarkdown();
  });

  rendered.addEventListener("click", function (e) {
    var check = e.target.closest && e.target.closest(".sn-check");
    if (!check || !rendered.contains(check)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleChecklistItem(check);
  });

  // On blur, re-render to normalize HTML structure
  rendered.addEventListener("blur", function (e) {
    // Don't re-render if clicking format toolbar (it prevents default, but just in case)
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".sn-format-toolbar")) return;
    closeFormatToolbar();
    var md = extractMarkdown(rendered);
    textarea.value = md;
    if (md.trim()) {
      rendered.innerHTML = renderMiniMarkdown(md);
      rendered.classList.remove("is-empty");
    } else {
      rendered.innerHTML = "";
      rendered.classList.add("is-empty");
    }
  });

  // Show format toolbar when selecting text
  rendered.addEventListener("mouseup", function (e) {
    if (e.target.tagName === "A") return;
    setTimeout(function () {
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        showFormatToolbar(rendered);
      } else {
        closeFormatToolbar();
      }
    }, 10);
  });

  // Keyboard selection
  rendered.addEventListener("keyup", function (e) {
    if (e.shiftKey || e.key === "Shift") {
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        showFormatToolbar(rendered);
      } else {
        closeFormatToolbar();
      }
    }
  });

  // Insert <br> on Enter instead of <div>
  rendered.addEventListener("keydown", function (e) {
    if (e.target.classList && e.target.classList.contains("sn-check") &&
        (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      toggleChecklistItem(e.target);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.execCommand("insertLineBreak");
    }
  });

  // Paste as plain text to avoid importing HTML formatting
  rendered.addEventListener("paste", function (e) {
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, text);
  });

  // Prevent drag when clicking body
  rendered.addEventListener("mousedown", function (e) {
    e.stopPropagation();
  });

  // Sync textarea edits when in MD mode
  textarea.addEventListener("input", function () {
    if (!mdMode) return;
    debouncedTextUpdate(noteId, textarea.value);
    syncTitle(noteEl, textarea.value);
  });

  textarea.addEventListener("mousedown", function (e) {
    e.stopPropagation();
  });
}
