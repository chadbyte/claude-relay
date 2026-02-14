import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml, copyToClipboard } from './utils.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';
import { closeSidebar } from './sidebar.js';

var ctx;
var treeData = {};  // path -> { loaded, children }
var currentContent = null;  // last read file content for copy
var currentFilePath = null;  // path of the currently viewed file
var isRendered = false;      // markdown render toggle state
var currentIsMarkdown = false;

export function initFileBrowser(_ctx) {
  ctx = _ctx;

  // Close button
  document.getElementById("file-viewer-close").addEventListener("click", function () {
    ctx.fileViewerEl.classList.add("hidden");
  });

  // Copy button
  document.getElementById("file-viewer-copy").addEventListener("click", function () {
    if (currentContent) copyToClipboard(currentContent);
  });

  // Markdown render toggle
  document.getElementById("file-viewer-render").addEventListener("click", function () {
    if (!currentContent || !currentIsMarkdown) return;
    isRendered = !isRendered;
    renderBody();
  });

  // ESC to close
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !ctx.fileViewerEl.classList.contains("hidden")) {
      ctx.fileViewerEl.classList.add("hidden");
    }
  });
}

function renderBody() {
  var bodyEl = document.getElementById("file-viewer-body");
  var renderBtn = document.getElementById("file-viewer-render");

  if (isRendered) {
    bodyEl.innerHTML = '<div class="file-viewer-markdown">' + renderMarkdown(currentContent) + '</div>';
    // Rewrite relative image src to use /api/file endpoint
    var fileDir = currentFilePath ? currentFilePath.replace(/[^/]*$/, "") : "";
    var imgs = bodyEl.querySelectorAll(".file-viewer-markdown img");
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute("src");
      if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:") && !src.startsWith("api/file")) {
        var resolvedPath = fileDir + src;
        imgs[i].src = "api/file?path=" + encodeURIComponent(resolvedPath);
      }
    }
    highlightCodeBlocks(bodyEl);
    renderBtn.classList.add("active");
    renderBtn.title = "Show raw";
  } else {
    var pre = document.createElement("pre");
    var code = document.createElement("code");
    code.className = "language-markdown";
    code.textContent = currentContent;
    pre.appendChild(code);
    bodyEl.innerHTML = "";
    bodyEl.appendChild(pre);
    if (typeof hljs !== "undefined") {
      hljs.highlightElement(code);
    }
    renderBtn.classList.remove("active");
    renderBtn.title = "Render markdown";
  }
  refreshIcons();
}

export function loadRootDirectory() {
  if (treeData["."] && treeData["."].loaded) return;
  requestDirectory(".");
}

function requestDirectory(dirPath) {
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "fs_list", path: dirPath }));
  }
}

function requestFileContent(filePath) {
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "fs_read", path: filePath }));
  }
}

// --- WS handlers ---

export function handleFsList(msg) {
  var dirPath = msg.path || ".";
  treeData[dirPath] = { loaded: true, children: msg.entries || [] };

  if (msg.error) {
    var errEl = ctx.fileTreeEl.querySelector('.file-tree-children[data-parent-path="' + dirPath + '"]');
    if (errEl) {
      errEl.innerHTML = '<div class="file-tree-error">' + escapeHtml(msg.error) + '</div>';
    }
    return;
  }

  // Root level
  if (dirPath === ".") {
    renderTree();
    return;
  }

  // Sub-directory: re-render its child container
  var childEl = ctx.fileTreeEl.querySelector('.file-tree-children[data-parent-path="' + dirPath + '"]');
  if (childEl) {
    childEl.innerHTML = "";
    var depth = dirPath.split("/").length;
    renderEntries(childEl, treeData[dirPath].children, depth);
    refreshIcons();
  }
}

export function handleFsRead(msg) {
  showFileContent(msg);
}

// --- Tree rendering ---

function renderTree() {
  var root = treeData["."];
  if (!root || !root.children || root.children.length === 0) {
    ctx.fileTreeEl.innerHTML = '<div class="file-tree-empty">No files</div>';
    return;
  }
  ctx.fileTreeEl.innerHTML = "";
  renderEntries(ctx.fileTreeEl, root.children, 0);
  refreshIcons();
}

function sortEntries(entries) {
  return entries.slice().sort(function (a, b) {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    var aH = a.name.charAt(0) === ".";
    var bH = b.name.charAt(0) === ".";
    if (aH !== bH) return aH ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

function renderEntries(container, entries, depth) {
  var sorted = sortEntries(entries);

  for (var i = 0; i < sorted.length; i++) {
    var entry = sorted[i];
    var row = document.createElement("div");
    row.className = "file-tree-item";
    row.style.paddingLeft = (8 + depth * 16) + "px";

    if (entry.type === "dir") {
      row.innerHTML =
        '<span class="file-tree-chevron">' + iconHtml("chevron-right") + '</span>' +
        iconHtml("folder") +
        '<span class="file-tree-name">' + escapeHtml(entry.name) + '</span>';

      var childContainer = document.createElement("div");
      childContainer.className = "file-tree-children hidden";
      childContainer.dataset.parentPath = entry.path;

      (function (dirPath, childEl, rowEl) {
        rowEl.addEventListener("click", function (e) {
          e.stopPropagation();
          var isExpanded = rowEl.classList.contains("expanded");
          if (isExpanded) {
            rowEl.classList.remove("expanded");
            childEl.classList.add("hidden");
          } else {
            rowEl.classList.add("expanded");
            childEl.classList.remove("hidden");
            if (!treeData[dirPath] || !treeData[dirPath].loaded) {
              childEl.innerHTML = '<div class="file-tree-loading">Loading...</div>';
              requestDirectory(dirPath);
            } else {
              childEl.innerHTML = "";
              var d = dirPath.split("/").length;
              renderEntries(childEl, treeData[dirPath].children, d);
              refreshIcons();
            }
          }
        });
      })(entry.path, childContainer, row);

      container.appendChild(row);
      container.appendChild(childContainer);
    } else {
      var iconClass = getFileIconClass(entry.name);
      row.innerHTML =
        '<span class="file-tree-spacer"></span>' +
        '<span class="file-tree-icon ' + iconClass + '"></span>' +
        '<span class="file-tree-name">' + escapeHtml(entry.name) + '</span>';

      (function (filePath, rowEl) {
        rowEl.addEventListener("click", function (e) {
          e.stopPropagation();
          // Mark active
          var prev = ctx.fileTreeEl.querySelector(".file-tree-item.active");
          if (prev) prev.classList.remove("active");
          rowEl.classList.add("active");
          requestFileContent(filePath);
          // Mobile: close sidebar
          if (window.innerWidth <= 768) {
            closeSidebar();
          }
        });
      })(entry.path, row);

      container.appendChild(row);
    }
  }
}

function getFileIconClass(name) {
  if (typeof FileIcons !== "undefined") {
    return FileIcons.getClassWithColor(name) || "default-icon";
  }
  return "default-icon";
}

// --- File viewer ---

function showFileContent(msg) {
  var pathEl = document.getElementById("file-viewer-path");
  var bodyEl = document.getElementById("file-viewer-body");
  var renderBtn = document.getElementById("file-viewer-render");

  pathEl.textContent = msg.path;
  currentContent = null;
  currentFilePath = msg.path;
  currentIsMarkdown = false;
  isRendered = false;
  renderBtn.classList.add("hidden");
  renderBtn.classList.remove("active");

  if (msg.error) {
    bodyEl.innerHTML = '<div class="file-tree-error">' + escapeHtml(msg.error) + '</div>';
  } else if (msg.binary) {
    if (msg.imageUrl) {
      bodyEl.innerHTML = '<div class="file-viewer-image"><img src="' + escapeHtml(msg.imageUrl) + '" alt="' + escapeHtml(msg.path) + '"></div>';
    } else {
      bodyEl.innerHTML = '<div class="file-viewer-binary">Binary file (' + formatSize(msg.size) + ')</div>';
    }
  } else {
    currentContent = msg.content;
    var ext = msg.path.split(".").pop().toLowerCase();
    currentIsMarkdown = (ext === "md" || ext === "mdx");

    if (currentIsMarkdown) {
      renderBtn.classList.remove("hidden");
      renderBtn.title = "Render markdown";
    }

    // Show raw by default, use renderBody for markdown toggle
    if (currentIsMarkdown) {
      renderBody();
    } else {
      var pre = document.createElement("pre");
      var code = document.createElement("code");
      var lang = mapExtToLanguage(ext);
      if (lang) code.className = "language-" + lang;
      code.textContent = msg.content;
      pre.appendChild(code);
      bodyEl.innerHTML = "";
      bodyEl.appendChild(pre);
      if (typeof hljs !== "undefined") {
        hljs.highlightElement(code);
      }
    }
  }

  ctx.fileViewerEl.classList.remove("hidden");
  refreshIcons();
}

function mapExtToLanguage(ext) {
  var map = {
    js: "javascript", ts: "typescript", jsx: "javascript", tsx: "typescript",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
    css: "css", html: "xml", xml: "xml", json: "json", yaml: "yaml",
    yml: "yaml", md: "markdown", sh: "bash", bash: "bash", zsh: "bash",
    sql: "sql", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    cs: "csharp", swift: "swift", kt: "kotlin", vue: "xml", svelte: "xml"
  };
  return map[ext] || null;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}
