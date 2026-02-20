import { copyToClipboard } from './utils.js';

function getShareUrl() {
  var url = window.location.href;
  var h = window.location.hostname;
  if ((h === "localhost" || h === "127.0.0.1") && window.__lanHost) {
    url = url.replace(h + ":" + window.location.port, window.__lanHost);
  }
  return url;
}

export function initQrCode() {
  var $ = function (id) { return document.getElementById(id); };
  var qrBtn = $("qr-btn");
  var qrOverlay = $("qr-overlay");
  var qrCanvas = $("qr-canvas");
  var qrUrl = $("qr-url");

  qrBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var url = getShareUrl();

    // Use Web Share API if available
    if (navigator.share) {
      navigator.share({ title: document.title || "Claude Relay", url: url }).catch(function () {});
      return;
    }

    // Fallback: show QR overlay
    var qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    qrCanvas.innerHTML = qr.createSvgTag(5, 0);
    qrUrl.innerHTML = url + '<span class="qr-hint">click to copy</span>';

    qrOverlay.classList.remove("hidden");
    qrBtn.classList.add("active");
  });

  // click URL to copy
  qrUrl.addEventListener("click", function () {
    var url = getShareUrl();
    copyToClipboard(url).then(function () {
      qrUrl.innerHTML = "Copied!";
      qrUrl.classList.add("copied");
      setTimeout(function () {
        qrUrl.innerHTML = url + '<span class="qr-hint">click to copy</span>';
        qrUrl.classList.remove("copied");
      }, 1500);
    });
  });

  qrOverlay.addEventListener("click", function () {
    qrOverlay.classList.add("hidden");
    qrBtn.classList.remove("active");
  });

  // prevent closing when clicking the inner card
  $("qr-overlay-inner").addEventListener("click", function (e) {
    e.stopPropagation();
  });

  // ESC to close
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !qrOverlay.classList.contains("hidden")) {
      qrOverlay.classList.add("hidden");
      qrBtn.classList.remove("active");
    }
  });
}
