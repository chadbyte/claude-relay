const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { WebSocketServer } = require("ws");
const { fetchLatestVersion, isNewer } = require("./updater");

// SDK loaded dynamically (ESM module)
var sdkModule = null;
function getSDK() {
  if (!sdkModule) sdkModule = import("@anthropic-ai/claude-agent-sdk");
  return sdkModule;
}

// Async message queue for streaming input to SDK
function createMessageQueue() {
  var queue = [];
  var waiting = null;
  var ended = false;
  return {
    push: function(msg) {
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    end: function() {
      ended = true;
      if (waiting) {
        var resolve = waiting;
        waiting = null;
        resolve({ value: undefined, done: true });
      }
    },
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise(function(resolve) {
            waiting = resolve;
          });
        }
      };
    }
  };
}

const publicDir = path.join(__dirname, "public");

function generateAuthToken(pin) {
  return crypto.createHash("sha256").update("claude-relay:" + pin).digest("hex");
}

function parseCookies(req) {
  var cookies = {};
  var header = req.headers.cookie || "";
  header.split(";").forEach(function(part) {
    var pair = part.trim().split("=");
    if (pair.length === 2) cookies[pair[0]] = pair[1];
  });
  return cookies;
}

function isAuthed(req, authToken) {
  if (!authToken) return true;
  var cookies = parseCookies(req);
  return cookies["relay_auth"] === authToken;
}

function pinPageHtml() {
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<title>Claude Relay</title>' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{background:#2F2E2B;color:#E8E5DE;font-family:system-ui,-apple-system,sans-serif;' +
    'min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.c{max-width:320px;width:100%;text-align:center}' +
    'h1{color:#DA7756;font-size:22px;margin-bottom:8px}' +
    '.sub{color:#908B81;font-size:14px;margin-bottom:32px}' +
    'input{width:100%;background:#393733;border:1px solid #3E3C37;border-radius:12px;' +
    'color:#E8E5DE;font-size:24px;letter-spacing:12px;text-align:center;padding:14px;' +
    'outline:none;font-family:inherit;-webkit-text-security:disc}' +
    'input:focus{border-color:#DA7756}' +
    'input::placeholder{letter-spacing:0;font-size:15px;color:#6D6860}' +
    '.err{color:#E5534B;font-size:13px;margin-top:12px;min-height:1.3em}' +
    '</style></head><body><div class="c">' +
    '<h1>Claude Relay</h1>' +
    '<div class="sub">Enter PIN to continue</div>' +
    '<input id="pin" type="tel" maxlength="6" placeholder="6-digit PIN" autocomplete="off" inputmode="numeric">' +
    '<div class="err" id="err"></div>' +
    '<script>' +
    'var inp=document.getElementById("pin"),err=document.getElementById("err");' +
    'inp.focus();' +
    'inp.addEventListener("input",function(){' +
    'if(inp.value.length===6){' +
    'fetch("/auth",{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({pin:inp.value})})' +
    '.then(function(r){if(r.ok)location.reload();else{err.textContent="Wrong PIN";inp.value="";inp.focus()}})' +
    '.catch(function(){err.textContent="Connection error"})}});' +
    '</script></div></body></html>';
}

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  var urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";

  var filePath = path.join(publicDir, urlPath);

  // Prevent path traversal
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  try {
    var content = fs.readFileSync(filePath);
    var ext = path.extname(filePath);
    var mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime + "; charset=utf-8" });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function setupPageHtml(httpsUrl, httpUrl, hasCert) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="manifest" href="/manifest.json">
<title>Setup - Claude Relay</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#2F2E2B;color:#E8E5DE;font-family:system-ui,-apple-system,sans-serif;min-height:100dvh;display:flex;justify-content:center;padding:env(safe-area-inset-top,0) 20px 40px}
.c{max-width:480px;width:100%;padding-top:40px}
h1{color:#DA7756;font-size:22px;margin:0 0 4px;text-align:center}
.subtitle{text-align:center;color:#908B81;font-size:13px;margin-bottom:28px}

/* Steps indicator */
.steps-bar{display:flex;gap:6px;margin-bottom:32px}
.steps-bar .pip{flex:1;height:3px;border-radius:2px;background:#3E3C37;transition:background 0.3s}
.steps-bar .pip.done{background:#57AB5A}
.steps-bar .pip.active{background:#DA7756}

/* Step card */
.step-card{display:none;animation:fadeIn 0.25s ease}
.step-card.active{display:block}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

.step-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#DA7756;font-weight:600;margin-bottom:8px}
.step-title{font-size:18px;font-weight:600;margin-bottom:6px}
.step-desc{font-size:14px;line-height:1.6;color:#908B81;margin-bottom:20px}

.instruction{display:flex;gap:12px;margin-bottom:16px}
.inst-num{width:24px;height:24px;border-radius:50%;background:rgba(218,119,86,0.15);color:#DA7756;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0;margin-top:1px}
.inst-text{font-size:14px;line-height:1.6}
.inst-text .note{font-size:12px;color:#6D6860;margin-top:4px}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#DA7756;color:#fff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:600;font-size:14px;margin:4px 0;border:none;cursor:pointer;font-family:inherit;transition:opacity 0.15s}
.btn:hover{opacity:0.9}
.btn.outline{background:transparent;border:1.5px solid #3E3C37;color:#E8E5DE}
.btn.outline:hover{border-color:#6D6860}
.btn.success{background:#57AB5A}
.btn:disabled{opacity:0.4;cursor:default}

.btn-row{display:flex;gap:8px;margin-top:20px}
.btn-row .btn{flex:1}

.check-status{display:flex;align-items:center;gap:8px;padding:12px 16px;border-radius:10px;font-size:13px;margin:16px 0}
.check-status.ok{background:rgba(87,171,90,0.1);color:#57AB5A;border:1px solid rgba(87,171,90,0.15)}
.check-status.warn{background:rgba(218,119,86,0.06);border:1px solid rgba(218,119,86,0.15);color:#DA7756}
.check-status.pending{background:rgba(144,139,129,0.06);border:1px solid rgba(144,139,129,0.15);color:#908B81}

.platform-ios,.platform-android,.platform-desktop{display:none}

.done-card{text-align:center;padding:40px 0}
.done-icon{font-size:48px;margin-bottom:16px}
.done-title{font-size:20px;font-weight:600;margin-bottom:8px}
.done-desc{font-size:14px;color:#908B81;margin-bottom:24px}

.skip-link{display:block;text-align:center;color:#6D6860;font-size:13px;text-decoration:none;margin-top:12px;cursor:pointer;border:none;background:none;font-family:inherit}
.skip-link:hover{color:#908B81}
</style></head><body>
<div class="c">
<h1>Claude Relay</h1>
<p class="subtitle">Setup your device for the best experience</p>

<div class="steps-bar" id="steps-bar"></div>

<!-- Step: Tailscale -->
<div class="step-card" id="step-tailscale">
  <div class="step-label">Step <span class="step-cur">1</span> of <span class="step-total">4</span></div>
  <div class="step-title">Connect via Tailscale</div>
  <div class="step-desc">Tailscale creates a private VPN so you can access Claude Relay from anywhere. It needs to be installed on <b>both</b> the server (the machine running Claude Relay) and this device.</div>

  <div class="instruction"><div class="inst-num">1</div>
    <div class="inst-text"><b>Server:</b> Install Tailscale on the machine running Claude Relay.
      <div class="note">If you are viewing this page, the server likely already has Tailscale. You can verify by checking its 100.x.x.x IP.</div>
    </div>
  </div>

  <div class="instruction"><div class="inst-num">2</div>
    <div class="inst-text"><b>This device:</b> Install Tailscale here and sign in with the same account.
      <div class="platform-ios" style="margin-top:8px">
        <a class="btn" href="https://apps.apple.com/app/tailscale/id1470499037" target="_blank" rel="noopener">App Store</a>
      </div>
      <div class="platform-android" style="margin-top:8px">
        <a class="btn" href="https://play.google.com/store/apps/details?id=com.tailscale.ipn" target="_blank" rel="noopener">Google Play</a>
      </div>
      <div class="platform-desktop" style="margin-top:8px">
        <a class="btn" href="https://tailscale.com/download" target="_blank" rel="noopener">Download Tailscale</a>
      </div>
    </div>
  </div>

  <div class="instruction"><div class="inst-num">3</div>
    <div class="inst-text">Once both devices are on Tailscale, open the relay using the server's Tailscale IP.
      <div class="note" id="tailscale-url-hint"></div>
    </div>
  </div>

  <div id="ts-status" class="check-status pending">Checking connection...</div>
  <div class="btn-row">
    <button class="btn" id="ts-next" onclick="nextStep()" disabled>Verifying...</button>
  </div>
</div>

<!-- Step: Certificate -->
<div class="step-card" id="step-cert">
  <div class="step-label">Step <span class="step-cur">1</span> of <span class="step-total">3</span></div>
  <div class="step-title">Install certificate</div>
  <div class="step-desc">Encrypt all traffic between this device and the relay. The certificate is generated locally and does not grant any additional access.</div>

  <div class="instruction"><div class="inst-num">1</div>
    <div class="inst-text">Download the certificate.<br>
      <a class="btn" href="/ca/download" style="margin-top:8px">Download Certificate</a>
    </div>
  </div>

  <div class="platform-ios">
    <div class="instruction"><div class="inst-num">2</div>
      <div class="inst-text">Open <b>Settings</b> and tap the <b>Profile Downloaded</b> banner to install.
        <div class="note">If the banner is gone: Settings > General > VPN & Device Management</div>
      </div>
    </div>
    <div class="instruction"><div class="inst-num">3</div>
      <div class="inst-text">Go to <b>Settings > General > About > Certificate Trust Settings</b> and enable full trust.</div>
    </div>
  </div>

  <div class="platform-android">
    <div class="instruction"><div class="inst-num">2</div>
      <div class="inst-text">Open the downloaded file, or go to <b>Settings > Security > Install a certificate > CA certificate</b>.
        <div class="note">Path may vary by device. Search "certificate" in Settings if needed.</div>
      </div>
    </div>
  </div>

  <div class="platform-desktop">
    <div class="instruction"><div class="inst-num">2</div>
      <div class="inst-text">The certificate should be trusted automatically via mkcert. If your browser still shows a warning, run <code>mkcert -install</code> on the host machine.</div>
    </div>
  </div>

  <div id="cert-status" class="check-status pending">Checking HTTPS connection...</div>
  <div class="btn-row">
    <button class="btn" id="cert-retry" onclick="checkHttps()" style="display:none">Retry</button>
    <button class="btn" id="cert-next" onclick="nextStep()" disabled>Verifying...</button>
  </div>
</div>

<!-- Step: Install PWA -->
<div class="step-card" id="step-pwa">
  <div class="step-label">Step <span class="step-cur">2</span> of <span class="step-total">3</span></div>
  <div class="step-title">Add to Home Screen</div>
  <div class="step-desc">Install Claude Relay as an app for quick access and a full-screen experience.</div>

  <div class="platform-ios">
    <div id="ios-not-safari" class="check-status warn" style="display:none">You must use <b>Safari</b> to install. Open this page in Safari first.</div>
    <div id="ios-safari-steps">
      <div class="instruction"><div class="inst-num">1</div>
        <div class="inst-text">Tap the <b>Share</b> button <svg width="18" height="18" viewBox="0 0 17.695 26.475" style="vertical-align:middle;margin:0 2px"><g fill="currentColor"><path d="M17.334 10.762v9.746c0 2.012-1.025 3.027-3.066 3.027H3.066C1.026 23.535 0 22.52 0 20.508v-9.746C0 8.75 1.025 7.734 3.066 7.734h2.94v1.573h-2.92c-.977 0-1.514.527-1.514 1.543v9.57c0 1.015.537 1.543 1.514 1.543h11.152c.967 0 1.524-.527 1.524-1.543v-9.57c0-1.016-.557-1.543-1.524-1.543h-2.91V7.734h2.94c2.04 0 3.066 1.016 3.066 3.028Z"/><path d="M8.662 15.889c.42 0 .781-.352.781-.762V5.097l-.058-1.464.654.693 1.484 1.582a.698.698 0 0 0 .528.235c.4 0 .713-.293.713-.694 0-.205-.088-.361-.235-.508l-3.3-3.183c-.196-.196-.362-.264-.567-.264-.195 0-.361.069-.566.264L4.795 4.94a.681.681 0 0 0-.225.508c0 .4.293.694.703.694.186 0 .4-.079.538-.235l1.474-1.582.664-.693-.058 1.465v10.029c0 .41.351.762.771.762Z"/></g></svg> at the bottom of the Safari toolbar.
          <div class="note" id="ios-ipad-hint" style="display:none">On iPad, the Share button is in the top toolbar.</div>
        </div>
      </div>
      <div class="instruction"><div class="inst-num">2</div>
        <div class="inst-text">Scroll down in the share sheet and tap <b>Add to Home Screen</b> <svg width="18" height="18" viewBox="0 0 25 25" style="vertical-align:middle;margin:0 2px"><g fill="currentColor"><path d="m23.40492,1.60784c-1.32504,-1.32504 -3.19052,-1.56912 -5.59644,-1.56912l-10.65243,0c-2.33622,0 -4.2017,0.24408 -5.5267,1.56912c-1.32504,1.34243 -1.56911,3.17306 -1.56911,5.50924l0,10.5827c0,2.40596 0.22665,4.254 1.55165,5.57902c1.34246,1.32501 3.19052,1.5691 5.59647,1.5691l10.60013,0c2.40592,0 4.2714,-0.24408 5.59644,-1.5691c1.325,-1.34245 1.55166,-3.17306 1.55166,-5.57902l0,-10.51293c0,-2.40596 -0.22666,-4.25401 -1.55166,-5.57901zm-0.38355,5.21289l0,11.24518c0,1.51681 -0.20924,2.94643 -1.02865,3.78327c-0.83683,0.83685 -2.30134,1.0635 -3.81815,1.0635l-11.33234,0c-1.51681,0 -2.96386,-0.22665 -3.80073,-1.0635c-0.83683,-0.83684 -1.04607,-2.26646 -1.04607,-3.78327l0,-11.19288c0,-1.5517 0.20924,-3.01617 1.02865,-3.85304c0.83687,-0.83683 2.31876,-1.04607 3.87042,-1.04607l11.28007,0c1.51681,0 2.98132,0.22666 3.81815,1.06353c0.81941,0.81941 1.02865,2.26645 1.02865,3.78327zm-10.53039,12.08205c0.64506,0 1.02861,-0.43586 1.02861,-1.13326l0,-4.34117l4.53294,0c0.66252,0 1.13326,-0.36613 1.13326,-0.99376c0,-0.64506 -0.43586,-1.02861 -1.13326,-1.02861l-4.53294,0l0,-4.53294c0,-0.6974 -0.38355,-1.13326 -1.02861,-1.13326c-0.62763,0 -0.99376,0.45332 -0.99376,1.13326l0,4.53294l-4.51552,0c-0.69737,0 -1.15069,0.38355 -1.15069,1.02861c0,0.62763 0.48817,0.99376 1.15069,0.99376l4.51552,0l0,4.34117c0,0.66252 0.36613,1.13326 0.99376,1.13326z"/></g></svg></div>
      </div>
      <div class="instruction"><div class="inst-num">3</div>
        <div class="inst-text">Tap <b>Add</b> in the top right corner to confirm.</div>
      </div>
    </div>
  </div>

  <div class="platform-android">
    <div class="instruction"><div class="inst-num">1</div>
      <div class="inst-text">Tap the <b>three dots menu</b> <svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:middle;margin:0 2px"><circle cx="12" cy="4" r="2.5" fill="currentColor"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><circle cx="12" cy="20" r="2.5" fill="currentColor"/></svg> in the top right corner of Chrome.</div>
    </div>
    <div class="instruction"><div class="inst-num">2</div>
      <div class="inst-text">Tap <b>Install app</b> or <b>Add to Home screen</b>.
        <div class="note">If you don't see it, try <b>Open in Chrome</b> first if using another browser.</div>
      </div>
    </div>
    <div class="instruction"><div class="inst-num">3</div>
      <div class="inst-text">Tap <b>Install</b> in the confirmation dialog.</div>
    </div>
  </div>

  <div class="platform-desktop">
    <div class="instruction"><div class="inst-num">1</div>
      <div class="inst-text">Look for the <b>install icon</b> in the address bar (a monitor with a down arrow).</div>
    </div>
    <div class="instruction"><div class="inst-num">2</div>
      <div class="inst-text">Click it and then click <b>Install</b> to confirm.
        <div class="note">If there is no icon, go to <b>Menu > Install Claude Relay</b> or <b>Menu > Save and Share > Install</b>.</div>
      </div>
    </div>
  </div>

  <div id="pwa-status" class="check-status pending">After installing, open Claude Relay from your home screen to continue setup.</div>
</div>

<!-- Step 3: Push Notifications -->
<div class="step-card" id="step-push">
  <div class="step-label">Step <span class="step-cur">3</span> of <span class="step-total">3</span></div>
  <div class="step-title">Enable notifications</div>
  <div class="step-desc">Get alerted on your phone when Claude finishes a response, even when the app is in the background.</div>

  <div id="push-needs-https" class="check-status warn" style="display:none">Push notifications require HTTPS. Complete the certificate step first.</div>

  <button class="btn" id="push-enable-btn" onclick="enablePush()" style="width:100%">Enable Push Notifications</button>
  <div id="push-status" class="check-status pending" style="display:none"></div>

  <div class="btn-row">
    <button class="btn" id="push-next" onclick="nextStep()" style="display:none;width:100%">Finish</button>
  </div>
</div>

<!-- Done -->
<div class="step-card" id="step-done">
  <div class="done-card">
    <div class="done-icon">&#10003;</div>
    <div class="done-title">All set!</div>
    <div class="done-desc">Your device is configured. You can change these settings anytime from the app.</div>
    <a class="btn" id="done-link" href="${httpsUrl}">Open Claude Relay</a>
  </div>
</div>
</div>

<script>
var httpsUrl = ${JSON.stringify(httpsUrl)};
var httpUrl = ${JSON.stringify(httpUrl)};
var hasCert = ${hasCert ? 'true' : 'false'};
var isHttps = location.protocol === "https:";
var ua = navigator.userAgent;
var isIOS = /iPhone|iPad|iPod/.test(ua);
var isAndroid = /Android/i.test(ua);
var isStandalone = window.matchMedia("(display-mode:standalone)").matches || navigator.standalone;
var isIPad = /iPad/.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
var isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);

// Platform visibility
var platformClass = isIOS ? "platform-ios" : isAndroid ? "platform-android" : "platform-desktop";
var els = document.querySelectorAll("." + platformClass);
for (var i = 0; i < els.length; i++) els[i].style.display = "block";

// iOS: Safari check and iPad hint
if (isIOS) {
  if (!isSafari) {
    var warn = document.getElementById("ios-not-safari");
    var steps = document.getElementById("ios-safari-steps");
    if (warn) warn.style.display = "flex";
    if (steps) steps.style.display = "none";
  }
  if (isIPad) {
    var hint = document.getElementById("ios-ipad-hint");
    if (hint) hint.style.display = "block";
  }
}

// Tailscale detection
var isTailscale = /^100\./.test(location.hostname);
var isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

// Detect push subscription, then build steps
function detectPush() {
  if (!("serviceWorker" in navigator) || (!isHttps && !isLocal)) return Promise.resolve(false);
  return navigator.serviceWorker.ready
    .then(function(reg) { return reg.pushManager.getSubscription(); })
    .then(function(sub) { return !!sub; })
    .catch(function() { return false; });
}

var steps = [];
var currentStep = 0;
var bar = document.getElementById("steps-bar");
var curEls = document.querySelectorAll(".step-cur");
var totalEls = document.querySelectorAll(".step-total");

// Step offset: when continuing from browser setup (PWA was installed), carry over step count
var stepOffset = 0;
if (isStandalone && localStorage.getItem("setup-pending")) {
  stepOffset = parseInt(localStorage.getItem("setup-pending"), 10) || 0;
}

function buildSteps(hasPushSub) {
  steps = [];
  if (!isTailscale && !isLocal) steps.push("tailscale");
  if (hasCert && !isHttps) steps.push("cert");
  if (!isStandalone) steps.push("pwa");
  if ((isHttps || isLocal) && !hasPushSub) steps.push("push");
  steps.push("done");

  bar.innerHTML = "";
  var stepCount = steps.length - 1;
  var displayTotal = stepCount + stepOffset;
  if (displayTotal <= 1) {
    bar.style.display = "none";
    var labels = document.querySelectorAll(".step-label");
    for (var i = 0; i < labels.length; i++) labels[i].style.display = "none";
  } else {
    for (var i = 0; i < displayTotal; i++) {
      var pip = document.createElement("div");
      pip.className = "pip" + (i < stepOffset ? " done" : "");
      bar.appendChild(pip);
    }
    for (var i = 0; i < totalEls.length; i++) totalEls[i].textContent = displayTotal;
  }
}

function showStep(idx) {
  currentStep = idx;
  var cards = document.querySelectorAll(".step-card");
  for (var i = 0; i < cards.length; i++) cards[i].classList.remove("active");
  document.getElementById("step-" + steps[idx]).classList.add("active");

  var pips = bar.querySelectorAll(".pip");
  var displayIdx = idx + stepOffset;
  for (var i = 0; i < pips.length; i++) {
    pips[i].className = "pip" + (i < displayIdx ? " done" : i === displayIdx ? " active" : "");
  }

  for (var i = 0; i < curEls.length; i++) curEls[i].textContent = displayIdx + 1;
}

function nextStep() {
  if (currentStep < steps.length - 1) showStep(currentStep + 1);
}

// --- Step: Tailscale ---
var tsStatus = document.getElementById("ts-status");
var tsNext = document.getElementById("ts-next");
var tsUrlHint = document.getElementById("tailscale-url-hint");

if (isTailscale) {
  tsStatus.className = "check-status ok";
  tsStatus.textContent = "Connected via Tailscale (" + location.hostname + ")";
  tsNext.disabled = false;
  tsNext.textContent = "Next";
} else if (isLocal) {
  tsStatus.className = "check-status ok";
  tsStatus.textContent = "Running locally. Tailscale is optional.";
  tsNext.disabled = false;
  tsNext.textContent = "Next";
} else {
  tsStatus.className = "check-status warn";
  tsStatus.textContent = "You are not on a Tailscale network. Install Tailscale and access the relay via your 100.x.x.x IP.";
  tsNext.disabled = false;
  tsNext.textContent = "Next";
}

// Show the Tailscale URL hint
if (httpsUrl.indexOf("100.") !== -1) {
  tsUrlHint.textContent = "Your relay: " + httpsUrl;
} else if (httpUrl.indexOf("100.") !== -1) {
  tsUrlHint.textContent = "Your relay: " + httpUrl;
}

// --- Step: Certificate ---
// Same pattern as main page HTTP->HTTPS check: fetch httpsUrl/info (has CORS headers).
// If cert is trusted, fetch succeeds -> enable Next. Otherwise show retry.
var certStatus = document.getElementById("cert-status");
var certNext = document.getElementById("cert-next");
var certRetry = document.getElementById("cert-retry");

function checkHttps() {
  certStatus.className = "check-status pending";
  certStatus.textContent = "Checking HTTPS connection...";
  certRetry.style.display = "none";
  certNext.disabled = true;
  certNext.textContent = "Verifying...";

  var ac = new AbortController();
  setTimeout(function() { ac.abort(); }, 3000);
  fetch(httpsUrl + "/info", { signal: ac.signal })
    .then(function() {
      certStatus.className = "check-status ok";
      certStatus.textContent = "HTTPS connection verified. Certificate is trusted.";
      certNext.disabled = false;
      certNext.textContent = "Next";
      certRetry.style.display = "none";
    })
    .catch(function() {
      certStatus.className = "check-status warn";
      certStatus.textContent = "Certificate not trusted yet. Install it above, then retry.";
      certRetry.style.display = "block";
      certNext.disabled = true;
      certNext.textContent = "Waiting for HTTPS...";
    });
}

if (steps.indexOf("cert") !== -1) {
  if (isHttps) {
    certStatus.className = "check-status ok";
    certStatus.textContent = "HTTPS connection verified";
    certNext.disabled = false;
    certNext.textContent = "Next";
  } else {
    checkHttps();
  }
}

// --- Step: PWA ---
// When PWA step is shown, mark setup as pending so the app redirects here on first standalone launch.
if (steps.indexOf("pwa") !== -1) {
  var stepsBeforePwa = steps.indexOf("pwa");
  localStorage.setItem("setup-pending", String(stepsBeforePwa + 1));
}

// --- Confetti ---
function fireConfetti() {
  var canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  var particles = [];
  var colors = ["#DA7756","#57AB5A","#6CB6FF","#E8D44D","#DB61A2","#F0883E"];
  for (var i = 0; i < 100; i++) {
    var angle = Math.random() * Math.PI * 2;
    var speed = Math.random() * 8 + 4;
    particles.push({
      x: canvas.width / 2,
      y: canvas.height * 0.45,
      vx: Math.cos(angle) * speed * (0.6 + Math.random()),
      vy: Math.sin(angle) * speed * (0.6 + Math.random()) - 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      w: Math.random() * 8 + 4,
      h: Math.random() * 4 + 2,
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 12,
      alpha: 1
    });
  }
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var alive = false;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (p.alpha <= 0) continue;
      alive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35;
      p.vx *= 0.99;
      p.rot += p.rotV;
      p.alpha -= 0.008;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(tick);
    else canvas.parentNode && canvas.parentNode.removeChild(canvas);
  }
  requestAnimationFrame(tick);
}

// --- Step: Push ---
var pushBtn = document.getElementById("push-enable-btn");
var pushStatus = document.getElementById("push-status");
var pushNeedsHttps = document.getElementById("push-needs-https");
var pushNext = document.getElementById("push-next");

function pushDone() {
  pushBtn.style.display = "none";
  pushStatus.style.display = "flex";
  pushStatus.className = "check-status ok";
  pushStatus.textContent = "Push notifications enabled!";
  fireConfetti();
  setTimeout(function() { nextStep(); }, 1200);
}

if (!isHttps && !isLocal) {
  pushBtn.style.display = "none";
  pushNeedsHttps.style.display = "flex";
  pushNext.style.display = "block";
  pushNext.textContent = "Finish anyway";
}

function enablePush() {
  pushBtn.disabled = true;
  pushBtn.textContent = "Requesting permission...";

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    pushStatus.style.display = "flex";
    pushStatus.className = "check-status warn";
    pushStatus.textContent = "Push notifications are not supported in this browser.";
    pushBtn.style.display = "none";
    pushNext.style.display = "block";
    pushNext.textContent = "Finish anyway";
    return;
  }

  navigator.serviceWorker.register("/sw.js")
    .then(function() { return navigator.serviceWorker.ready; })
    .then(function(reg) {
      return fetch("/api/vapid-public-key", { cache: "no-store" })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.publicKey) throw new Error("No VAPID key");
          var raw = atob(data.publicKey.replace(/-/g, "+").replace(/_/g, "/"));
          var key = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        });
    })
    .then(function(sub) {
      return fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
    })
    .then(pushDone)
    .catch(function(err) {
      pushBtn.disabled = false;
      pushBtn.textContent = "Enable Push Notifications";
      pushStatus.style.display = "flex";
      pushNext.style.display = "block";
      pushNext.textContent = "Finish anyway";
      if (Notification.permission === "denied") {
        pushStatus.className = "check-status warn";
        pushStatus.textContent = "Notification permission was denied. Enable it in browser settings.";
      } else {
        pushStatus.className = "check-status warn";
        pushStatus.textContent = "Could not enable push: " + (err.message || "unknown error");
      }
    });
}

// Done: clear setup-pending flag and link to app
var doneLink = document.getElementById("done-link");
doneLink.onclick = function() { localStorage.removeItem("setup-pending"); };
if (isStandalone) {
  doneLink.href = "/";
} else if (isHttps) {
  doneLink.href = "/";
} else {
  doneLink.href = httpsUrl;
}

// Init: try HTTPS redirect first (same as main page), then build steps
function init() {
  detectPush().then(function(hasPushSub) {
    buildSteps(hasPushSub);
    showStep(0);
  });
}

if (!isHttps && !isLocal) {
  // Try redirecting to HTTPS like the main page does
  fetch("/https-info").then(function(r) { return r.json(); }).then(function(info) {
    if (!info.httpsUrl) { init(); return; }
    var ac = new AbortController();
    setTimeout(function() { ac.abort(); }, 3000);
    fetch(info.httpsUrl + "/info", { signal: ac.signal })
      .then(function() { location.replace(info.httpsUrl + "/setup"); })
      .catch(function() { init(); });
  }).catch(function() { init(); });
} else {
  init();
}
</script>
</body></html>`;
}

function createServer(cwd, tlsOptions, caPath, pin, mainPort, debug) {
  var authToken = pin ? generateAuthToken(pin) : null;
  const project = path.basename(cwd);
  const currentVersion = require("../package.json").version;
  let latestVersion = null;

  // Check for updates in background
  fetchLatestVersion().then(function(v) {
    if (v && isNewer(v, currentVersion)) {
      latestVersion = v;
      // Notify already-connected clients
      send({ type: "update_available", version: v });
    }
  });

  // --- Push notifications ---
  var pushModule = null;
  try {
    var { initPush } = require("./push");
    pushModule = initPush(cwd);
  } catch(e) {}

  // --- Multi-session state ---
  let nextLocalId = 1;
  let sessions = new Map();     // localId -> session object
  let activeSessionId = null;   // currently active local ID
  let slashCommands = null;     // shared across sessions
  let skillNames = null;        // Claude-only skills to filter from slash menu
  let clients = new Set();

  // --- Session persistence ---
  var sessionsDir = path.join(cwd, ".claude-relay", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });

  function sessionFilePath(cliSessionId) {
    return path.join(sessionsDir, cliSessionId + ".jsonl");
  }

  function saveSessionFile(session) {
    if (!session.cliSessionId) return;
    var meta = JSON.stringify({
      type: "meta",
      localId: session.localId,
      cliSessionId: session.cliSessionId,
      title: session.title,
      createdAt: session.createdAt,
    });
    var lines = [meta];
    for (var i = 0; i < session.history.length; i++) {
      lines.push(JSON.stringify(session.history[i]));
    }
    fs.writeFileSync(sessionFilePath(session.cliSessionId), lines.join("\n") + "\n");
  }

  function appendToSessionFile(session, obj) {
    if (!session.cliSessionId) return;
    fs.appendFileSync(sessionFilePath(session.cliSessionId), JSON.stringify(obj) + "\n");
  }

  function loadSessions() {
    var files;
    try { files = fs.readdirSync(sessionsDir); } catch { return; }

    var loaded = [];
    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith(".jsonl")) continue;
      var content;
      try { content = fs.readFileSync(path.join(sessionsDir, files[i]), "utf8"); } catch { continue; }
      var lines = content.trim().split("\n");
      if (lines.length === 0) continue;

      var meta;
      try { meta = JSON.parse(lines[0]); } catch { continue; }
      if (meta.type !== "meta" || !meta.cliSessionId) continue;

      var history = [];
      for (var j = 1; j < lines.length; j++) {
        try { history.push(JSON.parse(lines[j])); } catch {}
      }

      loaded.push({ meta: meta, history: history });
    }

    loaded.sort(function(a, b) { return a.meta.createdAt - b.meta.createdAt; });

    for (var i = 0; i < loaded.length; i++) {
      var m = loaded[i].meta;
      var localId = nextLocalId++;
      // Reconstruct messageUUIDs from history
      var messageUUIDs = [];
      for (var k = 0; k < loaded[i].history.length; k++) {
        if (loaded[i].history[k].type === "message_uuid") {
          messageUUIDs.push({ uuid: loaded[i].history[k].uuid, type: loaded[i].history[k].messageType, historyIndex: k });
        }
      }
      var session = {
        localId: localId,
        queryInstance: null,
        messageQueue: null,
        cliSessionId: m.cliSessionId,
        blocks: {},
        sentToolResults: {},
        pendingPermissions: {},
        pendingAskUser: {},
        isProcessing: false,
        title: m.title || "",
        createdAt: m.createdAt || Date.now(),
        history: loaded[i].history,
        messageUUIDs: messageUUIDs,
      };
      sessions.set(localId, session);
    }
  }

  // Load persisted sessions from disk
  loadSessions();

  function send(obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  function sendTo(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function broadcastClientCount() {
    send({ type: "client_count", count: clients.size });
  }

  function sendToOthers(sender, obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws !== sender && ws.readyState === 1) ws.send(data);
    }
  }

  // Send a message and record it in session history for replay on reconnect
  function sendAndRecord(session, obj) {
    session.history.push(obj);
    appendToSessionFile(session, obj);
    if (session.localId === activeSessionId) {
      send(obj);
    }
  }

  function getActiveSession() {
    return sessions.get(activeSessionId) || null;
  }

  function broadcastSessionList() {
    send({
      type: "session_list",
      sessions: [...sessions.values()].map(function(s) {
        return {
          id: s.localId,
          title: s.title || "New Session",
          active: s.localId === activeSessionId,
          isProcessing: s.isProcessing,
        };
      }),
    });
  }

  function createSession() {
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      queryInstance: null,
      messageQueue: null,
      cliSessionId: null,
      blocks: {},
      sentToolResults: {},
      pendingPermissions: {},
      pendingAskUser: {},
      allowedTools: {},
      isProcessing: false,
      title: "",
      createdAt: Date.now(),
      history: [],
      messageUUIDs: [],
    };
    sessions.set(localId, session);
    switchSession(localId);
    return session;
  }

  var HISTORY_PAGE_SIZE = 200;

  function findTurnBoundary(history, targetIndex) {
    for (var i = targetIndex; i >= 0; i--) {
      if (history[i].type === "user_message") return i;
    }
    return 0;
  }

  function replayHistory(session, fromIndex) {
    var total = session.history.length;
    if (typeof fromIndex !== "number") {
      if (total <= HISTORY_PAGE_SIZE) {
        fromIndex = 0;
      } else {
        fromIndex = findTurnBoundary(session.history, Math.max(0, total - HISTORY_PAGE_SIZE));
      }
    }

    send({ type: "history_meta", total: total, from: fromIndex });

    for (var i = fromIndex; i < total; i++) {
      send(session.history[i]);
    }
  }

  function switchSession(localId) {
    var session = sessions.get(localId);
    if (!session) return;

    activeSessionId = localId;
    send({ type: "session_switched", id: localId, cliSessionId: session.cliSessionId || null });
    broadcastSessionList();
    replayHistory(session);

    if (session.isProcessing) {
      send({ type: "status", status: "processing" });
    }

    // Re-send any pending permission requests
    var pendingIds = Object.keys(session.pendingPermissions);
    for (var i = 0; i < pendingIds.length; i++) {
      var p = session.pendingPermissions[pendingIds[i]];
      send({
        type: "permission_request_pending",
        requestId: p.requestId,
        toolName: p.toolName,
        toolInput: p.toolInput,
        toolUseId: p.toolUseId,
        decisionReason: p.decisionReason,
      });
    }
  }

  function deleteSession(localId) {
    var session = sessions.get(localId);
    if (!session) return;

    if (session.abortController) {
      try { session.abortController.abort(); } catch(e) {}
    }
    if (session.messageQueue) {
      try { session.messageQueue.end(); } catch(e) {}
    }

    if (session.cliSessionId) {
      try { fs.unlinkSync(sessionFilePath(session.cliSessionId)); } catch(e) {}
    }

    sessions.delete(localId);

    if (activeSessionId === localId) {
      var remaining = [...sessions.keys()];
      if (remaining.length > 0) {
        switchSession(remaining[remaining.length - 1]);
      } else {
        createSession();
      }
    } else {
      broadcastSessionList();
    }
  }

  // --- SDK message processing ---

  function processSDKMessage(session, parsed) {
    // Extract session_id from any message that carries it
    if (parsed.session_id && !session.cliSessionId) {
      session.cliSessionId = parsed.session_id;
      saveSessionFile(session);
      if (session.localId === activeSessionId) {
        send({ type: "session_id", cliSessionId: session.cliSessionId });
      }
    } else if (parsed.session_id) {
      session.cliSessionId = parsed.session_id;
    }

    // Capture message UUIDs for rewind support
    if (parsed.uuid) {
      if (parsed.type === "user" && !parsed.parent_tool_use_id) {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "user", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "user" });
      } else if (parsed.type === "assistant") {
        session.messageUUIDs.push({ uuid: parsed.uuid, type: "assistant", historyIndex: session.history.length });
        sendAndRecord(session, { type: "message_uuid", uuid: parsed.uuid, messageType: "assistant" });
      }
    }

    // Cache slash_commands from CLI init message
    if (parsed.type === "system" && parsed.subtype === "init") {
      if (parsed.skills) {
        skillNames = new Set(parsed.skills);
      }
      if (parsed.slash_commands) {
        slashCommands = parsed.slash_commands.filter(function(name) {
          return !skillNames || !skillNames.has(name);
        });
        send({ type: "slash_commands", commands: slashCommands });
      }
    }

    if (parsed.type === "stream_event" && parsed.event) {
      var evt = parsed.event;

      if (evt.type === "content_block_start") {
        var block = evt.content_block;
        var idx = evt.index;

        if (block.type === "tool_use") {
          session.blocks[idx] = { type: "tool_use", id: block.id, name: block.name, inputJson: "" };
          sendAndRecord(session, { type: "tool_start", id: block.id, name: block.name });
        } else if (block.type === "thinking") {
          session.blocks[idx] = { type: "thinking", thinkingText: "" };
          sendAndRecord(session, { type: "thinking_start" });
        } else if (block.type === "text") {
          session.blocks[idx] = { type: "text" };
        }
      }

      if (evt.type === "content_block_delta" && evt.delta) {
        var idx = evt.index;

        if (evt.delta.type === "text_delta" && typeof evt.delta.text === "string") {
          session.streamedText = true;
          if (session.responsePreview.length < 200) {
            session.responsePreview += evt.delta.text;
          }
          sendAndRecord(session, { type: "delta", text: evt.delta.text });
        } else if (evt.delta.type === "input_json_delta" && session.blocks[idx]) {
          session.blocks[idx].inputJson += evt.delta.partial_json;
        } else if (evt.delta.type === "thinking_delta" && session.blocks[idx]) {
          session.blocks[idx].thinkingText += evt.delta.thinking;
          sendAndRecord(session, { type: "thinking_delta", text: evt.delta.thinking });
        }
      }

      if (evt.type === "content_block_stop") {
        var idx = evt.index;
        var block = session.blocks[idx];

        if (block && block.type === "tool_use") {
          var input = {};
          try { input = JSON.parse(block.inputJson); } catch {}
          sendAndRecord(session, { type: "tool_executing", id: block.id, name: block.name, input: input });
          if (pushModule && block.name === "AskUserQuestion" && input.questions) {
            var q = input.questions[0];
            pushModule.sendPush({
              type: "ask_user",
              title: "Claude has a question",
              body: q ? q.question : "Waiting for your response",
              tag: "claude-ask",
            });
          }
        } else if (block && block.type === "thinking") {
          sendAndRecord(session, { type: "thinking_stop" });
        }

        delete session.blocks[idx];
      }

    } else if ((parsed.type === "assistant" || parsed.type === "user") && parsed.message && parsed.message.content) {
      var content = parsed.message.content;

      // Fallback: if assistant text wasn't streamed via deltas, send it now
      if (parsed.type === "assistant" && !session.streamedText && Array.isArray(content)) {
        var assistantText = content
          .filter(function(c) { return c.type === "text"; })
          .map(function(c) { return c.text; })
          .join("");
        if (assistantText) {
          sendAndRecord(session, { type: "delta", text: assistantText });
        }
      }

      // Check for local slash command output in user messages
      if (parsed.type === "user") {
        var fullText = "";
        if (typeof content === "string") {
          fullText = content;
        } else if (Array.isArray(content)) {
          fullText = content
            .filter(function(c) { return c.type === "text"; })
            .map(function(c) { return c.text; })
            .join("\n");
        }
        if (fullText.indexOf("local-command-stdout") !== -1) {
          var m = fullText.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
          if (m) {
            sendAndRecord(session, { type: "slash_command_result", text: m[1].trim() });
          }
        }
      }

      if (Array.isArray(content)) {
        for (var i = 0; i < content.length; i++) {
          var block = content[i];
          if (block.type === "tool_result" && !session.sentToolResults[block.tool_use_id]) {
            var resultText = "";
            if (typeof block.content === "string") {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = block.content
                .filter(function(c) { return c.type === "text"; })
                .map(function(c) { return c.text; })
                .join("\n");
            }
            session.sentToolResults[block.tool_use_id] = true;
            sendAndRecord(session, {
              type: "tool_result",
              id: block.tool_use_id,
              content: resultText,
              is_error: block.is_error || false,
            });
          }
        }
      }

    } else if (parsed.type === "result") {
      session.blocks = {};
      session.sentToolResults = {};
      session.pendingPermissions = {};
      session.pendingAskUser = {};
      session.isProcessing = false;
      sendAndRecord(session, {
        type: "result",
        cost: parsed.total_cost_usd,
        duration: parsed.duration_ms,
        sessionId: parsed.session_id,
      });
      sendAndRecord(session, { type: "done", code: 0 });
      if (pushModule) {
        var preview = (session.responsePreview || "").replace(/\s+/g, " ").trim();
        if (preview.length > 140) preview = preview.substring(0, 140) + "...";
        pushModule.sendPush({
          type: "done",
          title: session.title || "Claude",
          body: preview || "Response ready",
          tag: "claude-done",
        });
      }
      // Reset for next turn in the same query
      session.responsePreview = "";
      session.streamedText = false;
      broadcastSessionList();

    } else if (parsed.type && parsed.type !== "system" && parsed.type !== "user") {
    }
  }

  // --- SDK query lifecycle ---

  function handleCanUseTool(session, toolName, input, opts) {
    // AskUserQuestion: wait for user answers via WebSocket
    if (toolName === "AskUserQuestion") {
      return new Promise(function(resolve) {
        session.pendingAskUser[opts.toolUseID] = {
          resolve: resolve,
          input: input,
        };
        if (opts.signal) {
          opts.signal.addEventListener("abort", function() {
            delete session.pendingAskUser[opts.toolUseID];
            resolve({ behavior: "deny", message: "Cancelled" });
          });
        }
      });
    }

    // Auto-approve if tool was previously allowed for session
    if (session.allowedTools && session.allowedTools[toolName]) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // Regular tool permission request: send to client and wait
    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      session.pendingPermissions[requestId] = {
        resolve: resolve,
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
      };

      var permMsg = {
        type: "permission_request",
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
      };
      sendAndRecord(session, permMsg);

      if (pushModule) {
        pushModule.sendPush({
          type: "permission_request",
          requestId: requestId,
          title: toolName,
          body: permissionPushSummary(toolName, input),
        });
      }

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          delete session.pendingPermissions[requestId];
          sendAndRecord(session, { type: "permission_cancel", requestId: requestId });
          resolve({ behavior: "deny", message: "Request cancelled" });
        });
      }
    });
  }

  async function processQueryStream(session) {
    try {
      for await (var msg of session.queryInstance) {
        processSDKMessage(session, msg);
      }
    } catch (err) {
      if (session.isProcessing) {
        session.isProcessing = false;
        if (err.name === "AbortError" || (session.abortController && session.abortController.signal.aborted)) {
          sendAndRecord(session, { type: "info", text: "Interrupted \u00b7 What should Claude do instead?" });
          sendAndRecord(session, { type: "done", code: 0 });
        } else {
          sendAndRecord(session, { type: "error", text: "Claude process error: " + err.message });
          sendAndRecord(session, { type: "done", code: 1 });
          if (pushModule) {
            pushModule.sendPush({
              type: "error",
              title: "Connection Lost",
              body: "Claude process disconnected: " + (err.message || "unknown error"),
              tag: "claude-error",
            });
          }
        }
        broadcastSessionList();
      }
    } finally {
      session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
    }
  }

  async function getOrCreateRewindQuery(session) {
    if (session.queryInstance) return { query: session.queryInstance, isTemp: false, cleanup: function() {} };

    var sdk = await getSDK();
    var mq = createMessageQueue();

    var tempQuery = sdk.query({
      prompt: mq,
      options: {
        cwd: cwd,
        enableFileCheckpointing: true,
        resume: session.cliSessionId,
      },
    });

    // Drain messages in background (stream stays alive until mq.end())
    (async function() {
      try { for await (var msg of tempQuery) {} } catch(e) {}
    })();

    return {
      query: tempQuery,
      isTemp: true,
      cleanup: function() { try { mq.end(); } catch(e) {} },
    };
  }

  async function startQuery(session, text, images) {
    var sdk = await getSDK();

    session.messageQueue = createMessageQueue();
    session.blocks = {};
    session.sentToolResults = {};
    session.streamedText = false;
    session.responsePreview = "";

    // Build initial user message
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }

    session.messageQueue.push({
      type: "user",
      message: { role: "user", content: content },
    });

    session.abortController = new AbortController();

    var queryOptions = {
      cwd: cwd,
      includePartialMessages: true,
      enableFileCheckpointing: true,
      extraArgs: { "replay-user-messages": null },
      abortController: session.abortController,
      canUseTool: function(toolName, input, opts) {
        return handleCanUseTool(session, toolName, input, opts);
      },
    };

    if (session.cliSessionId) {
      queryOptions.resume = session.cliSessionId;
      if (session.lastRewindUuid) {
        queryOptions.resumeSessionAt = session.lastRewindUuid;
        delete session.lastRewindUuid;
      }
    }

    session.queryInstance = sdk.query({
      prompt: session.messageQueue,
      options: queryOptions,
    });

    processQueryStream(session).catch(function(err) {
    });
  }

  function pushMessage(session, text, images) {
    var content = [];
    if (images && images.length > 0) {
      for (var i = 0; i < images.length; i++) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: images[i].mediaType, data: images[i].data },
        });
      }
    }
    if (text) {
      content.push({ type: "text", text: text });
    }
    session.messageQueue.push({
      type: "user",
      message: { role: "user", content: content },
    });
  }

  // --- Spawn initial session only if no persisted sessions ---
  if (sessions.size === 0) {
    createSession();
  } else {
    // Activate the most recent session
    var lastSession = [...sessions.values()].pop();
    activeSessionId = lastSession.localId;
  }

  // --- Push notification helpers ---
  function permissionPushSummary(toolName, input) {
    if (!input) return toolName;
    var text = "";
    if (toolName === "Bash" && input.command) {
      text = input.command;
    } else if (toolName === "Edit" && input.file_path) {
      var file = input.file_path.split("/").pop();
      text = file + ": " + (input.old_string || "").substring(0, 40) + " \u2192 " + (input.new_string || "").substring(0, 40);
    } else if (toolName === "Write" && input.file_path) {
      text = "Write " + input.file_path.split("/").pop();
    } else if (toolName === "Read" && input.file_path) {
      text = input.file_path;
    } else if (input.file_path) {
      text = input.file_path;
    } else if (input.command) {
      text = input.command;
    } else if (input.pattern) {
      text = input.pattern;
    }
    if (text.length > 120) text = text.substring(0, 120) + "...";
    return text || toolName;
  }

  function parseJsonBody(req) {
    return new Promise(function(resolve, reject) {
      var body = "";
      req.on("data", function(chunk) { body += chunk; });
      req.on("end", function() {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(e); }
      });
    });
  }

  // --- App HTTP handler ---
  var caContent = caPath ? fs.readFileSync(caPath) : null;
  var pinPage = pinPageHtml();

  var appHandler = function(req, res) {
    // PIN auth endpoint
    if (req.method === "POST" && req.url === "/auth") {
      var body = "";
      req.on("data", function(chunk) { body += chunk; });
      req.on("end", function() {
        try {
          var data = JSON.parse(body);
          if (authToken && generateAuthToken(data.pin) === authToken) {
            res.writeHead(200, {
              "Set-Cookie": "relay_auth=" + authToken + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000",
              "Content-Type": "application/json",
            });
            res.end('{"ok":true}');
          } else {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end('{"ok":false}');
          }
        } catch (e) {
          res.writeHead(400);
          res.end("Bad request");
        }
      });
      return;
    }

    // Allow /info without auth (used by setup page HTTPS check)
    if (req.method === "GET" && req.url === "/info") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ cwd: cwd, project: project }));
      return;
    }

    // VAPID public key (no auth needed, just returns a key)
    if (req.method === "GET" && req.url === "/api/vapid-public-key") {
      if (pushModule) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store",
        });
        res.end(JSON.stringify({ publicKey: pushModule.publicKey }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"push not available"}');
      }
      return;
    }

    // Check auth for everything else
    if (!isAuthed(req, authToken)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pinPage);
      return;
    }

    // Push subscribe endpoint
    if (req.method === "POST" && req.url === "/api/push-subscribe") {
      parseJsonBody(req).then(function(sub) {
        if (pushModule) pushModule.addSubscription(sub);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function() {
        res.writeHead(400);
        res.end("Bad request");
      });
      return;
    }

    // Permission response from push notification (service worker)
    if (req.method === "POST" && req.url === "/api/permission-response") {
      parseJsonBody(req).then(function(data) {
        var requestId = data.requestId;
        var decision = data.decision;
        if (!requestId || !decision) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing requestId or decision"}');
          return;
        }

        // Search all sessions for the pending permission
        var found = false;
        sessions.forEach(function(session) {
          var pending = session.pendingPermissions[requestId];
          if (!pending) return;
          found = true;

          delete session.pendingPermissions[requestId];

          if (decision === "allow") {
            pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
          } else {
            pending.resolve({ behavior: "deny", message: "Denied via push notification" });
          }

          sendAndRecord(session, {
            type: "permission_resolved",
            requestId: requestId,
            decision: decision,
          });
        });

        if (found) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"permission request not found"}');
        }
      }).catch(function() {
        res.writeHead(400);
        res.end("Bad request");
      });
      return;
    }

    // CA certificate download (available on both HTTP and HTTPS)
    if (req.url === "/ca/download" && req.method === "GET" && caContent) {
      res.writeHead(200, {
        "Content-Type": "application/x-pem-file",
        "Content-Disposition": 'attachment; filename="claude-relay-ca.pem"',
      });
      res.end(caContent);
      return;
    }

    // Setup page (available on both HTTP and HTTPS)
    if (req.url === "/setup" && req.method === "GET") {
      var host = req.headers.host || "localhost";
      var hostname = host.split(":")[0];
      var setupHttpsUrl = tlsOptions
        ? "https://" + hostname + ":" + (mainPort + 1)
        : "http://" + hostname + ":" + mainPort;
      var httpEntryUrl = "http://" + hostname + ":" + mainPort;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(setupPageHtml(setupHttpsUrl, httpEntryUrl, !!caContent));
      return;
    }

    if (req.method === "GET") {
      if (serveStatic(req, res)) return;
    }

    res.writeHead(404);
    res.end("Not found");
  };

  // --- Server setup ---
  // Entry server (HTTP) always listens on the main branded port.
  // When TLS is available, HTTPS runs on port+1 and the entry server
  // auto-redirects (via setup page) once the CA is trusted.
  var entryServer;
  var httpsServer = null;
  var wssTargets;

  if (tlsOptions) {
    var httpsPort = mainPort + 1;
    httpsServer = require("https").createServer(tlsOptions, appHandler);

    entryServer = http.createServer(function(req, res) {
      // HTTPS info endpoint for client banner
      if (req.url === "/https-info") {
        var host = req.headers.host || "localhost";
        var hostname = host.split(":")[0];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          httpsPort: httpsPort,
          httpsUrl: "https://" + hostname + ":" + httpsPort,
          setupUrl: "/setup",
        }));
        return;
      }
      // Serve app directly over HTTP
      appHandler(req, res);
    });

    wssTargets = [httpsServer, entryServer];
  } else {
    entryServer = http.createServer(appHandler);
    wssTargets = [entryServer];
  }

  // --- WebSocket ---
  var wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(req, socket, head) {
    if (!isAuthed(req, authToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, function(ws) {
      wss.emit("connection", ws, req);
    });
  }

  for (var i = 0; i < wssTargets.length; i++) {
    wssTargets[i].on("upgrade", handleUpgrade);
  }

  wss.on("connection", function(ws) {
    clients.add(ws);
    broadcastClientCount();

    // Send cached state to this client only
    sendTo(ws, { type: "info", cwd: cwd, project: project, version: currentVersion, debug: !!debug });
    if (latestVersion) {
      sendTo(ws, { type: "update_available", version: latestVersion });
    }
    if (slashCommands) {
      sendTo(ws, { type: "slash_commands", commands: slashCommands });
    }

    // Session list to this client
    sendTo(ws, {
      type: "session_list",
      sessions: [...sessions.values()].map(function(s) {
        return {
          id: s.localId,
          title: s.title || "New Session",
          active: s.localId === activeSessionId,
          isProcessing: s.isProcessing,
        };
      }),
    });

    // Restore active session for this client
    var active = getActiveSession();
    if (active) {
      sendTo(ws, { type: "session_switched", id: active.localId, cliSessionId: active.cliSessionId || null });

      var total = active.history.length;
      var fromIndex = 0;
      if (total > HISTORY_PAGE_SIZE) {
        fromIndex = findTurnBoundary(active.history, Math.max(0, total - HISTORY_PAGE_SIZE));
      }
      sendTo(ws, { type: "history_meta", total: total, from: fromIndex });
      for (var i = fromIndex; i < total; i++) {
        sendTo(ws, active.history[i]);
      }

      if (active.isProcessing) {
        sendTo(ws, { type: "status", status: "processing" });
      }
      var pendingIds = Object.keys(active.pendingPermissions);
      for (var i = 0; i < pendingIds.length; i++) {
        var p = active.pendingPermissions[pendingIds[i]];
        sendTo(ws, {
          type: "permission_request_pending",
          requestId: p.requestId,
          toolName: p.toolName,
          toolInput: p.toolInput,
          toolUseId: p.toolUseId,
          decisionReason: p.decisionReason,
        });
      }
    }

    ws.on("message", function(raw) {
      var msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "push_subscribe") {
        if (pushModule && msg.subscription) pushModule.addSubscription(msg.subscription);
        return;
      }

      if (msg.type === "load_more_history") {
        var session = getActiveSession();
        if (!session || typeof msg.before !== "number") return;
        var before = msg.before;
        var from = findTurnBoundary(session.history, Math.max(0, before - HISTORY_PAGE_SIZE));
        var to = before;
        var items = session.history.slice(from, to);
        sendTo(ws, {
          type: "history_prepend",
          items: items,
          meta: { from: from, to: to, hasMore: from > 0 },
        });
        return;
      }

      if (msg.type === "new_session") {
        createSession();
        return;
      }

      if (msg.type === "resume_session") {
        if (!msg.cliSessionId) return;
        var localId = nextLocalId++;
        var session = {
          localId: localId,
          queryInstance: null,
          messageQueue: null,
          cliSessionId: msg.cliSessionId,
          blocks: {},
          sentToolResults: {},
          pendingPermissions: {},
          pendingAskUser: {},
          allowedTools: {},
          isProcessing: false,
          title: "Resumed session",
          createdAt: Date.now(),
          history: [],
          messageUUIDs: [],
        };
        sessions.set(localId, session);
        saveSessionFile(session);
        switchSession(localId);
        return;
      }

      if (msg.type === "switch_session") {
        if (msg.id && sessions.has(msg.id)) {
          switchSession(msg.id);
        }
        return;
      }

      if (msg.type === "delete_session") {
        if (msg.id && sessions.has(msg.id)) {
          deleteSession(msg.id);
        }
        return;
      }

      if (msg.type === "rename_session") {
        if (msg.id && sessions.has(msg.id) && msg.title) {
          var s = sessions.get(msg.id);
          s.title = String(msg.title).substring(0, 100);
          broadcastSessionList();
        }
        return;
      }

      if (msg.type === "check_update") {
        fetchLatestVersion().then(function(v) {
          if (v && isNewer(v, currentVersion)) {
            latestVersion = v;
            sendTo(ws, { type: "update_available", version: v });
          }
        }).catch(function() {});
        return;
      }

      if (msg.type === "stop") {
        var session = getActiveSession();
        if (session && session.abortController && session.isProcessing) {
          session.abortController.abort();
        }
        return;
      }

      if (msg.type === "rewind_preview") {
        var session = getActiveSession();
        if (!session || !session.cliSessionId || !msg.uuid) return;

        (async function() {
          var result;
          try {
            result = await getOrCreateRewindQuery(session);
            var preview = await result.query.rewindFiles(msg.uuid, { dryRun: true });
            var diffs = {};
            var changedFiles = preview.filesChanged || [];
            for (var f = 0; f < changedFiles.length; f++) {
              try {
                diffs[changedFiles[f]] = execSync(
                  "git diff HEAD -- " + JSON.stringify(changedFiles[f]),
                  { cwd: cwd, encoding: "utf8", timeout: 5000 }
                ) || "";
              } catch(e) { diffs[changedFiles[f]] = ""; }
            }
            sendTo(ws, { type: "rewind_preview_result", preview: preview, diffs: diffs, uuid: msg.uuid });
          } catch(err) {
            sendTo(ws, { type: "rewind_error", text: "Failed to preview rewind: " + err.message });
          } finally {
            if (result && result.isTemp) result.cleanup();
          }
        })();
        return;
      }

      if (msg.type === "rewind_execute") {
        var session = getActiveSession();
        if (!session || !session.cliSessionId || !msg.uuid) return;

        (async function() {
          var result;
          try {
            result = await getOrCreateRewindQuery(session);
            await result.query.rewindFiles(msg.uuid, { dryRun: false });

            // Find the target UUID in messageUUIDs and trim history
            var targetIdx = -1;
            for (var i = 0; i < session.messageUUIDs.length; i++) {
              if (session.messageUUIDs[i].uuid === msg.uuid) {
                targetIdx = i;
                break;
              }
            }

            if (targetIdx >= 0) {
              var trimTo = session.messageUUIDs[targetIdx].historyIndex;
              // Walk back to also remove the user_message before the message_uuid
              for (var k = trimTo - 1; k >= 0; k--) {
                if (session.history[k].type === "user_message") {
                  trimTo = k;
                  break;
                }
              }
              session.history = session.history.slice(0, trimTo);
              session.messageUUIDs = session.messageUUIDs.slice(0, targetIdx);
            }

            session.lastRewindUuid = msg.uuid;

            // Clean up query state
            if (session.abortController) {
              try { session.abortController.abort(); } catch(e) {}
            }
            if (session.messageQueue) {
              try { session.messageQueue.end(); } catch(e) {}
            }
            session.queryInstance = null;
            session.messageQueue = null;
            session.abortController = null;
            session.blocks = {};
            session.sentToolResults = {};
            session.pendingPermissions = {};
            session.pendingAskUser = {};
            session.isProcessing = false;

            saveSessionFile(session);

            // Replay trimmed history then show rewind complete
            switchSession(session.localId);
            sendAndRecord(session, { type: "rewind_complete" });
            broadcastSessionList();
          } catch(err) {
            send({ type: "rewind_error", text: "Rewind failed: " + err.message });
          } finally {
            if (result && result.isTemp) result.cleanup();
          }
        })();
        return;
      }

      if (msg.type === "ask_user_response") {
        var session = getActiveSession();
        if (!session) return;

        var toolId = msg.toolId;
        var answers = msg.answers || {};
        var pending = session.pendingAskUser[toolId];
        if (!pending) return;

        delete session.pendingAskUser[toolId];
        pending.resolve({
          behavior: "allow",
          updatedInput: Object.assign({}, pending.input, { answers: answers }),
        });
        return;
      }

      if (msg.type === "input_sync") {
        sendToOthers(ws, msg);
        return;
      }

      if (msg.type === "permission_response") {
        var session = getActiveSession();
        if (!session) return;

        var requestId = msg.requestId;
        var decision = msg.decision; // "allow" | "deny" | "allow_always"
        var pending = session.pendingPermissions[requestId];
        if (!pending) return;

        delete session.pendingPermissions[requestId];

        if (decision === "allow" || decision === "allow_always") {
          if (decision === "allow_always") {
            if (!session.allowedTools) session.allowedTools = {};
            session.allowedTools[pending.toolName] = true;
          }
          pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
        } else {
          pending.resolve({ behavior: "deny", message: "User denied permission" });
        }

        sendAndRecord(session, {
          type: "permission_resolved",
          requestId: requestId,
          decision: decision,
        });
        return;
      }

      if (msg.type !== "message") return;
      if (!msg.text && (!msg.images || msg.images.length === 0)) return;

      var session = getActiveSession();
      if (!session) return;

      if (session.isProcessing) {
        send({ type: "error", text: "Still processing previous message. Please wait." });
        return;
      }

      session.isProcessing = true;
      session.sentToolResults = {};

      // Record user message in history for replay (without base64 data to save space)
      var userMsg = { type: "user_message", text: msg.text || "" };
      if (msg.images && msg.images.length > 0) {
        userMsg.imageCount = msg.images.length;
      }
      session.history.push(userMsg);
      appendToSessionFile(session, userMsg);
      sendToOthers(ws, userMsg);
      send({ type: "status", status: "processing" });

      // Set title from first user message
      if (!session.title) {
        session.title = (msg.text || "Image").substring(0, 50);
        saveSessionFile(session);
        broadcastSessionList();
      }

      // Start new query or push to existing one
      if (!session.queryInstance) {
        startQuery(session, msg.text || "", msg.images);
      } else {
        pushMessage(session, msg.text || "", msg.images);
      }
      broadcastSessionList();
    });

    ws.on("close", function() {
      clients.delete(ws);
      broadcastClientCount();
    });
  });

  // Warm up: grab slash_commands from SDK init message, then abort
  (async function warmup() {
    try {
      var sdk = await getSDK();
      var ac = new AbortController();
      var mq = createMessageQueue();
      mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
      mq.end();
      var stream = sdk.query({
        prompt: mq,
        options: { cwd: cwd, abortController: ac },
      });
      for await (var msg of stream) {
        if (msg.type === "system" && msg.subtype === "init") {
          if (msg.skills) {
            skillNames = new Set(msg.skills);
          }
          if (msg.slash_commands) {
            slashCommands = msg.slash_commands.filter(function(name) {
              return !skillNames || !skillNames.has(name);
            });
            if (clients.size > 0) {
              send({ type: "slash_commands", commands: slashCommands });
            }
          }
          ac.abort();
          break;
        }
      }
    } catch (e) {
      // Expected: AbortError after we abort
    }
  })();

  return { entryServer: entryServer, httpsServer: httpsServer };
}

module.exports = { createServer };
