import { copyToClipboard } from './utils.js';
import { refreshIcons } from './icons.js';

// Initialize markdown parser
marked.use({ gfm: true, breaks: false });

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    darkMode: true,
    background: "#1E1D1A",
    primaryColor: "#DA7756",
    primaryTextColor: "#E8E5DE",
    primaryBorderColor: "#3E3C37",
    lineColor: "#908B81",
    secondaryColor: "#35332F",
    tertiaryColor: "#2F2E2B"
  }
});

var mermaidIdCounter = 0;

export function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text));
}

export function highlightCodeBlocks(el) {
  el.querySelectorAll("pre code:not(.hljs):not(.language-mermaid)").forEach(function (block) {
    hljs.highlightElement(block);
  });
  el.querySelectorAll("pre:not(.has-copy-btn):not([data-mermaid-processed])").forEach(function (pre) {
    // Skip non-content code blocks (tool details, diffs, etc.)
    if (!pre.querySelector("code")) return;
    pre.classList.add("has-copy-btn");
    pre.style.position = "relative";
    var btn = document.createElement("button");
    btn.className = "code-copy-btn";
    btn.title = "Copy";
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var code = pre.querySelector("code");
      var text = code ? code.textContent : pre.textContent;
      copyToClipboard(text).then(function () {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(function () {
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
      });
    });
    pre.appendChild(btn);
  });
}

export function renderMermaidBlocks(el) {
  var blocks = el.querySelectorAll("pre code.language-mermaid");
  blocks.forEach(function (codeEl) {
    var pre = codeEl.parentElement;
    if (!pre || pre.dataset.mermaidProcessed) return;
    pre.dataset.mermaidProcessed = "true";

    var source = codeEl.textContent;
    if (!source || !source.trim()) return;

    var id = "mermaid-" + (++mermaidIdCounter);
    var container = document.createElement("div");
    container.className = "mermaid-diagram";

    try {
      mermaid.render(id, source.trim()).then(function (result) {
        container.innerHTML = result.svg;
        container.addEventListener("click", function () {
          showMermaidModal(container.innerHTML);
        });
        if (pre.parentNode) pre.parentNode.replaceChild(container, pre);
      }).catch(function (err) {
        pre.classList.add("mermaid-error");
        var errHint = document.createElement("div");
        errHint.className = "mermaid-error-hint";
        errHint.textContent = "Diagram render failed";
        if (pre.parentNode) pre.parentNode.insertBefore(errHint, pre.nextSibling);
        var errDiv = document.getElementById("d" + id);
        if (errDiv) errDiv.remove();
      });
    } catch (err) {
      pre.classList.add("mermaid-error");
    }
  });
}

export function showMermaidModal(svgHtml) {
  var modal = document.getElementById("mermaid-modal");
  var body = document.getElementById("mermaid-modal-body");
  if (!modal || !body) return;
  body.innerHTML = svgHtml;
  modal.classList.remove("hidden");
  refreshIcons();

  var dlBtn = document.getElementById("mermaid-download-btn");
  dlBtn.onclick = function () {
    downloadMermaidPng(body.querySelector("svg"));
  };
}

export function closeMermaidModal() {
  var modal = document.getElementById("mermaid-modal");
  if (modal) modal.classList.add("hidden");
}

export function downloadMermaidPng(svgEl) {
  if (!svgEl) return;
  var svgClone = svgEl.cloneNode(true);
  // Ensure dimensions
  var bbox = svgEl.getBoundingClientRect();
  var scale = 2; // 2x for retina quality
  var w = bbox.width * scale;
  var h = bbox.height * scale;
  svgClone.setAttribute("width", w);
  svgClone.setAttribute("height", h);

  var serializer = new XMLSerializer();
  var svgStr = serializer.serializeToString(svgClone);
  var svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  var url = URL.createObjectURL(svgBlob);

  var img = new Image();
  img.onload = function () {
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    // Dark background
    ctx.fillStyle = "#1E1D1A";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);

    canvas.toBlob(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "diagram.png";
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };
  img.src = url;
}
