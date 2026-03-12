function pinPageHtml() {
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<title>Clay</title>' +
    '<style>' + authPageStyles + '</style></head><body><div class="c">' +
    '<img src="/clay-logo.png" class="logo" alt="Clay">' +
    '<div class="sub">Enter PIN to continue</div>' +
    pinBoxesHtml +
    '<div class="err" id="err"></div>' +
    '<script>' +
    pinBoxScript +
    'var err=document.getElementById("err");' +
    'function submitPin(){' +
    'var pin=document.getElementById("pin").value;' +
    'var boxes=document.querySelectorAll(".pin-digit");' +
    'fetch("/auth",{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({pin:pin})})' +
    '.then(function(r){return r.json()})' +
    '.then(function(d){' +
    'if(d.ok){location.reload();return}' +
    'if(d.locked){for(var i=0;i<boxes.length;i++)boxes[i].disabled=true;' +
    'err.textContent="Too many attempts. Try again in "+Math.ceil(d.retryAfter/60)+" min";' +
    'setTimeout(function(){for(var i=0;i<boxes.length;i++){boxes[i].disabled=false;boxes[i].value="";boxes[i].classList.remove("filled")}' +
    'document.getElementById("pin").value="";err.textContent="";boxes[0].focus()},d.retryAfter*1000);return}' +
    'var msg="Wrong PIN";if(typeof d.attemptsLeft==="number"&&d.attemptsLeft<=3)msg+=" ("+d.attemptsLeft+" left)";' +
    'err.textContent=msg;for(var i=0;i<boxes.length;i++){boxes[i].value="";boxes[i].classList.remove("filled")}' +
    'document.getElementById("pin").value="";boxes[0].focus()})' +
    '.catch(function(){err.textContent="Connection error"})}' +
    'initPinBoxes("pin-boxes","pin",submitPin);' +
    '</script></div></body></html>';
}

function setupPageHtml(httpsUrl, httpUrl, hasCert, lanMode) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>Setup - Clay</title>
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
<h1>Clay</h1>
<p class="subtitle">Setup your device for the best experience</p>

<div class="steps-bar" id="steps-bar"></div>

<!-- Step: Tailscale -->
<div class="step-card" id="step-tailscale">
  <div class="step-label">Step <span class="step-cur">1</span> of <span class="step-total">4</span></div>
  <div class="step-title">Connect via Tailscale</div>
  <div class="step-desc">Tailscale creates a private VPN so you can access Clay from anywhere. It needs to be installed on <b>both</b> the server (the machine running Clay) and this device.</div>

  <div class="instruction"><div class="inst-num">1</div>
    <div class="inst-text"><b>Server:</b> Install Tailscale on the machine running Clay.
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
  <div class="step-desc">Install Clay as an app for quick access and a full-screen experience.</div>

  <div class="platform-ios">
    <div class="check-status warn">On iOS, push notifications only work from the installed app. This step is required.</div>
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
        <div class="note">If there is no icon, go to <b>Menu > Install Clay</b> or <b>Menu > Save and Share > Install</b>.</div>
      </div>
    </div>
  </div>

  <div id="pwa-status" class="check-status pending">After installing, open Clay from your home screen to continue setup.</div>
  <button class="skip-link" id="pwa-skip" onclick="nextStep()" style="display:none">Skip for now</button>
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
    <a class="btn" id="done-link" href="${httpsUrl}">Open Clay</a>
  </div>
</div>
</div>

<script>
var httpsUrl = ${JSON.stringify(httpsUrl)};
var httpUrl = ${JSON.stringify(httpUrl)};
var hasCert = ${hasCert ? 'true' : 'false'};
var lanMode = ${lanMode ? 'true' : 'false'};
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
    var safariSteps = document.getElementById("ios-safari-steps");
    if (warn) warn.style.display = "flex";
    if (safariSteps) safariSteps.style.display = "none";
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
  // If no SW is registered yet, don't wait for .ready (it never resolves)
  if (!navigator.serviceWorker.controller) return Promise.resolve(false);
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
  if (!isTailscale && !isLocal && !lanMode) steps.push("tailscale");
  if (hasCert && !isHttps) steps.push("cert");
  if (isAndroid) {
    // Android: push first (works in browser), then PWA as optional
    if ((isHttps || isLocal) && !hasPushSub) steps.push("push");
    if (!isStandalone) steps.push("pwa");
  } else {
    // iOS: PWA required for push, so install first
    if (!isStandalone) steps.push("pwa");
    if ((isHttps || isLocal) && !hasPushSub) steps.push("push");
  }
  steps.push("done");

  // Trigger HTTPS check now that steps are built
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

  // PWA: mark setup as pending so the app redirects here on first standalone launch
  if (steps.indexOf("pwa") !== -1) {
    var stepsBeforePwa = steps.indexOf("pwa");
    localStorage.setItem("setup-pending", String(stepsBeforePwa + 1));
  }

  // Android: PWA is optional, show skip button and update text
  if (isAndroid && steps.indexOf("pwa") !== -1) {
    var pwaSkip = document.getElementById("pwa-skip");
    var pwaStatus = document.getElementById("pwa-status");
    if (pwaSkip) pwaSkip.style.display = "block";
    if (pwaStatus) pwaStatus.textContent = "Optional: install for quick access and full-screen experience.";
  }

  // Push: show warning if not on HTTPS
  if (!isHttps && !isLocal) {
    pushBtn.style.display = "none";
    pushNeedsHttps.style.display = "flex";
    pushNext.style.display = "block";
    pushNext.textContent = "Finish anyway";
  }

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
  // After cert step on HTTP, redirect to HTTPS for remaining steps
  if (!isHttps && steps[currentStep] === "cert") {
    location.replace(httpsUrl + "/setup" + (lanMode ? "?mode=lan" : ""));
    return;
  }
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
  fetch(httpsUrl + "/info", { signal: ac.signal, mode: "no-cors" })
    .then(function() {
      // Any response (even opaque/401) means TLS handshake succeeded = cert is trusted
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

// cert check is now triggered inside buildSteps() after steps array is populated

// PWA setup-pending flag is now set inside buildSteps()

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
  navigator.serviceWorker.ready.then(function(reg) {
    reg.showNotification("\ud83c\udf89 Welcome to Clay!", {
      body: "\ud83d\udd14 You\u2019ll be notified when Claude responds.",
      tag: "claude-welcome",
    });
  }).catch(function() {});
  setTimeout(function() { nextStep(); }, 1200);
}

// Push HTTPS check is now done inside buildSteps()

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
      var prevEndpoint = localStorage.getItem("push-endpoint");
      localStorage.setItem("push-endpoint", sub.endpoint);
      var payload = { subscription: sub.toJSON() };
      if (prevEndpoint && prevEndpoint !== sub.endpoint) {
        payload.replaceEndpoint = prevEndpoint;
      }
      return fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
doneLink.onclick = function() {
  localStorage.removeItem("setup-pending");
  localStorage.setItem("setup-done", "1");
};
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
    fetch(info.httpsUrl + "/info", { signal: ac.signal, mode: "no-cors" })
      .then(function() { location.replace(info.httpsUrl + "/setup" + (lanMode ? "?mode=lan" : "")); })
      .catch(function() { init(); });
  }).catch(function() { init(); });
} else {
  init();
}
</script>
</body></html>`;
}


function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- Build auth page CSS variables from ayu-light theme (same logic as theme.js computeVars) ---
var path = require("path");
var _authTheme = require(path.join(__dirname, "themes", "ayu-light.json"));

function _hexToRgb(hex) {
  hex = hex.replace("#", "");
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16)
  };
}

function _hexToRgba(hex, alpha) {
  var c = _hexToRgb(hex);
  return "rgba(" + c.r + "," + c.g + "," + c.b + "," + alpha + ")";
}

function _mixColors(hex1, hex2, weight) {
  var c1 = _hexToRgb(hex1), c2 = _hexToRgb(hex2);
  var w = weight;
  var r = Math.round(c1.r * w + c2.r * (1 - w));
  var g = Math.round(c1.g * w + c2.g * (1 - w));
  var b = Math.round(c1.b * w + c2.b * (1 - w));
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

var _t = {};
var _keys = ["base00","base01","base02","base03","base04","base05","base06","base07",
             "base08","base09","base0A","base0B","base0C","base0D","base0E","base0F"];
for (var _ki = 0; _ki < _keys.length; _ki++) {
  _t[_keys[_ki]] = "#" + _authTheme[_keys[_ki]];
}

var _authVarsObj = {
  "--bg": _t.base00,
  "--bg-alt": _t.base01,
  "--text": _t.base06,
  "--text-muted": _t.base04,
  "--text-dimmer": _t.base03,
  "--accent": _t.base09,
  "--accent-15": _hexToRgba(_t.base09, 0.15),
  "--accent-20": _hexToRgba(_t.base09, 0.20),
  "--border": _t.base02,
  "--input-bg": _mixColors(_t.base01, _t.base02, 0.5),
  "--error": _t.base08,
};

var _authVarsStr = ":root{";
var _avKeys = Object.keys(_authVarsObj);
for (var _vi = 0; _vi < _avKeys.length; _vi++) {
  _authVarsStr += _avKeys[_vi] + ":" + _authVarsObj[_avKeys[_vi]] + ";";
}
_authVarsStr += "}";

// --- Shared CSS for auth pages (Clay Light theme via CSS variables) ---
var authPageStyles =
  _authVarsStr +
  // Reset & layout
  '*{margin:0;padding:0;box-sizing:border-box}' +
  'body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;' +
  'min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px}' +
  '.c{max-width:380px;width:100%;text-align:center}' +
  '.logo{width:240px;height:240px;margin-bottom:32px}' +
  'h1{color:var(--text);font-size:22px;margin-bottom:8px}' +
  '.sub{color:var(--text-muted);font-size:14px;margin-bottom:28px}' +
  '.field{margin-bottom:16px;text-align:left}' +
  '.field label{display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px}' +
  'input{width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:12px;' +
  'color:var(--text);font-size:16px;padding:12px 14px;outline:none;font-family:inherit}' +
  'input:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-15)}' +
  'input::placeholder{font-size:14px;color:var(--text-dimmer)}' +
  // PIN digit boxes
  '.pin-wrap{display:flex;gap:8px;justify-content:center}' +
  '.pin-digit{width:44px;height:56px;background:var(--input-bg);border:1.5px solid var(--border);border-radius:8px;' +
  'color:var(--accent);font-family:"Courier New",Courier,"Roboto Mono",monospace;font-size:28px;font-weight:700;' +
  'text-align:center;line-height:56px;outline:none;caret-color:transparent;' +
  '-webkit-text-security:disc;transition:border-color 0.15s,box-shadow 0.15s}' +
  '.pin-digit:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-20)}' +
  '.pin-digit.filled{color:var(--text)}' +
  // Legacy single-input fallback
  '.pin-input{font-size:24px;letter-spacing:12px;text-align:center;-webkit-text-security:disc;' +
  'font-family:"Courier New",Courier,"Roboto Mono",monospace}' +
  '.btn{width:100%;background:var(--accent);color:#fff;border:none;border-radius:12px;' +
  'padding:14px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;' +
  'transition:opacity 0.15s;margin-top:8px}' +
  '.btn:hover{opacity:0.9}' +
  '.btn:disabled{opacity:0.4;cursor:default}' +
  '.err{color:var(--error);font-size:13px;margin-top:12px;min-height:1.3em}' +
  '.info{color:var(--text-dimmer);font-size:12px;margin-top:16px}' +
  // Step wizard
  '.step{display:none}.step.active{display:block}' +
  '.steps-bar{display:flex;gap:6px;justify-content:center;margin-bottom:28px}' +
  '.steps-dot{width:8px;height:8px;border-radius:50%;background:var(--border);transition:background 0.2s}' +
  '.steps-dot.done{background:var(--accent)}.steps-dot.current{background:var(--accent)}';

// --- Shared JS for PIN digit boxes ---
// initPinBoxes(containerId, hiddenInputId, onComplete) — wires up 6 individual digit inputs
var pinBoxScript =
  'function initPinBoxes(cId,hId,onComplete){' +
  'var wrap=document.getElementById(cId),hidden=document.getElementById(hId);' +
  'var boxes=wrap.querySelectorAll(".pin-digit");' +
  'boxes[0].focus();' +
  'for(var i=0;i<boxes.length;i++){(function(idx){' +
  'boxes[idx].addEventListener("input",function(e){' +
  'var v=this.value.replace(/[^0-9]/g,"");' +
  'if(v.length>1)v=v.charAt(v.length-1);' +
  'this.value=v;' +
  'this.classList.toggle("filled",v.length>0);' +
  'syncHidden();' +
  'if(v&&idx<5)boxes[idx+1].focus();' +
  'if(hidden.value.length===6&&onComplete)onComplete()});' +
  'boxes[idx].addEventListener("keydown",function(e){' +
  'if(e.key==="Backspace"&&!this.value&&idx>0){boxes[idx-1].focus();boxes[idx-1].value="";boxes[idx-1].classList.remove("filled");syncHidden()}' +
  'if(e.key==="ArrowLeft"&&idx>0)boxes[idx-1].focus();' +
  'if(e.key==="ArrowRight"&&idx<5)boxes[idx+1].focus()});' +
  'boxes[idx].addEventListener("paste",function(e){' +
  'e.preventDefault();var d=(e.clipboardData||window.clipboardData).getData("text").replace(/[^0-9]/g,"").slice(0,6);' +
  'for(var j=0;j<d.length&&j<6;j++){boxes[j].value=d.charAt(j);boxes[j].classList.add("filled")}' +
  'syncHidden();if(d.length>=6){boxes[5].focus();if(onComplete)onComplete()}else if(d.length>0)boxes[d.length].focus()});' +
  'boxes[idx].addEventListener("focus",function(){this.select()});' +
  '})(i)}' +
  'function syncHidden(){var v="";for(var j=0;j<boxes.length;j++)v+=boxes[j].value;hidden.value=v}' +
  '}';

// HTML fragment for 6 PIN digit boxes + hidden input
var pinBoxesHtml =
  '<div class="pin-wrap" id="pin-boxes">' +
  '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
  '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
  '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
  '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
  '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
  '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
  '</div>' +
  '<input type="hidden" id="pin">';

// --- Admin Setup Page (3-step wizard: setup code → username → PIN) ---
function adminSetupPageHtml() {
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>Admin Setup - Clay</title>' +
    '<style>' + authPageStyles + '</style></head><body><div class="c">' +
    '<img src="/clay-logo.png" class="logo" alt="Clay">' +
    '<div class="steps-bar"><span class="steps-dot current" id="dot0"></span><span class="steps-dot" id="dot1"></span><span class="steps-dot" id="dot2"></span></div>' +

    // Step 1: Setup Code
    '<div class="step active" id="step0">' +
    '<div class="sub">Enter the setup code from your terminal</div>' +
    '<div class="field"><label>Setup Code</label>' +
    '<input id="code" type="text" maxlength="6" placeholder="6-character code" autocomplete="off" autofocus></div>' +
    '<button class="btn" id="btn0" disabled>Continue</button>' +
    '<div class="err" id="err0"></div>' +
    '</div>' +

    // Step 2: Username
    '<div class="step" id="step1">' +
    '<div class="sub">Choose your admin username</div>' +
    '<div class="field"><label>Username</label>' +
    '<input id="username" type="text" maxlength="30" placeholder="admin" autocomplete="username"></div>' +
    '<button class="btn" id="btn1" disabled>Continue</button>' +
    '<div class="err" id="err1"></div>' +
    '</div>' +

    // Step 3: PIN
    '<div class="step" id="step2">' +
    '<div class="sub">Set a 6-digit PIN</div>' +
    pinBoxesHtml +
    '<button class="btn" id="btn2" disabled style="margin-top:20px">Create Account</button>' +
    '<div class="err" id="err2"></div>' +
    '</div>' +

    '<script>' +
    pinBoxScript +
    'var step=0;' +
    'var codeEl=document.getElementById("code"),userEl=document.getElementById("username"),pinEl=document.getElementById("pin");' +
    'var steps=[document.getElementById("step0"),document.getElementById("step1"),document.getElementById("step2")];' +
    'var dots=[document.getElementById("dot0"),document.getElementById("dot1"),document.getElementById("dot2")];' +
    'var btns=[document.getElementById("btn0"),document.getElementById("btn1"),document.getElementById("btn2")];' +
    'var errs=[document.getElementById("err0"),document.getElementById("err1"),document.getElementById("err2")];' +
    'var usernameRe=/^[a-zA-Z0-9_\\-]+$/;' +

    'function goStep(n){' +
    'steps[step].classList.remove("active");dots[step].classList.remove("current");dots[step].classList.add("done");' +
    'step=n;steps[step].classList.add("active");dots[step].classList.add("current");' +
    'errs[step].textContent="";' +
    'if(step===1)userEl.focus();' +
    'if(step===2){initPinBoxes("pin-boxes","pin",function(){if(!btns[2].disabled)doSetup()});' +
    'var boxes=document.querySelectorAll(".pin-digit");' +
    'for(var i=0;i<boxes.length;i++)boxes[i].addEventListener("input",function(){btns[2].disabled=pinEl.value.length!==6})}' +
    '}' +

    // Step 1 validation
    'codeEl.addEventListener("input",function(){btns[0].disabled=codeEl.value.length<4});' +
    'btns[0].onclick=function(){goStep(1)};' +

    // Step 2 validation
    'userEl.addEventListener("input",function(){' +
    'var v=userEl.value;var valid=v.length>=1&&usernameRe.test(v);' +
    'btns[1].disabled=!valid;' +
    'if(v.length>0&&!valid)errs[1].textContent="Letters, numbers, hyphens and underscores only";' +
    'else errs[1].textContent=""});' +
    'btns[1].onclick=function(){goStep(2)};' +

    'function doSetup(){' +
    'btns[2].disabled=true;errs[2].textContent="";' +
    'fetch("/auth/setup",{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({setupCode:codeEl.value,username:userEl.value,displayName:userEl.value,pin:pinEl.value})})' +
    '.then(function(r){return r.json()})' +
    '.then(function(d){' +
    'if(d.ok){location.href="/";return}' +
    'errs[2].textContent=d.error||"Setup failed";btns[2].disabled=false})' +
    '.catch(function(){errs[2].textContent="Connection error";btns[2].disabled=false})}' +
    'btns[2].onclick=doSetup;' +
    '</script></div></body></html>';
}

// --- Multi-user Login Page ---
function multiUserLoginPageHtml() {
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>Login - Clay</title>' +
    '<style>' + authPageStyles + '</style></head><body><div class="c">' +
    '<img src="/clay-logo.png" class="logo" alt="Clay">' +
    '<div class="sub">Log in to continue</div>' +
    '<div class="field"><label>Username</label>' +
    '<input id="username" type="text" maxlength="30" placeholder="Username" autocomplete="username" autofocus></div>' +
    '<div class="field"><label>PIN</label>' +
    pinBoxesHtml + '</div>' +
    '<button class="btn" id="submit" onclick="doLogin()" disabled>Log In</button>' +
    '<div class="err" id="err"></div>' +
    '<script>' +
    pinBoxScript +
    'var userEl=document.getElementById("username"),pinEl=document.getElementById("pin"),' +
    'btn=document.getElementById("submit"),err=document.getElementById("err");' +
    'function check(){btn.disabled=!(userEl.value.length>=1&&pinEl.value.length===6)}' +
    'userEl.addEventListener("input",check);' +
    'initPinBoxes("pin-boxes","pin",function(){if(!btn.disabled)doLogin()});' +
    'var boxes=document.querySelectorAll(".pin-digit");' +
    'for(var i=0;i<boxes.length;i++)boxes[i].addEventListener("input",check);' +
    'function doLogin(){' +
    'btn.disabled=true;err.textContent="";' +
    'fetch("/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({username:userEl.value,pin:pinEl.value})})' +
    '.then(function(r){return r.json()})' +
    '.then(function(d){' +
    'if(d.ok){location.reload();return}' +
    'if(d.locked){for(var i=0;i<boxes.length;i++)boxes[i].disabled=true;userEl.disabled=true;' +
    'err.textContent="Too many attempts. Try again in "+Math.ceil(d.retryAfter/60)+" min";' +
    'setTimeout(function(){for(var i=0;i<boxes.length;i++){boxes[i].disabled=false;boxes[i].value="";boxes[i].classList.remove("filled")}' +
    'userEl.disabled=false;pinEl.value="";err.textContent="";userEl.focus()},d.retryAfter*1000);return}' +
    'var msg=d.error||"Invalid credentials";' +
    'if(typeof d.attemptsLeft==="number"&&d.attemptsLeft<=3)msg+=" ("+d.attemptsLeft+" left)";' +
    'err.textContent=msg;for(var i=0;i<boxes.length;i++){boxes[i].value="";boxes[i].classList.remove("filled")}' +
    'pinEl.value="";boxes[0].focus();btn.disabled=true})' +
    '.catch(function(){err.textContent="Connection error";btn.disabled=false})}' +
    '</script></div></body></html>';
}

// --- Invite Registration Page (2-step wizard: username → PIN) ---
function invitePageHtml(inviteCode) {
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>Join - Clay</title>' +
    '<style>' + authPageStyles + '</style></head><body><div class="c">' +
    '<img src="/clay-logo.png" class="logo" alt="Clay">' +
    '<div class="steps-bar"><span class="steps-dot current" id="dot0"></span><span class="steps-dot" id="dot1"></span></div>' +

    // Step 1: Username
    '<div class="step active" id="step0">' +
    '<div class="sub">You have been invited — Choose a username</div>' +
    '<div class="field"><label>Username</label>' +
    '<input id="username" type="text" maxlength="30" placeholder="Choose a username" autocomplete="username" autofocus></div>' +
    '<button class="btn" id="btn0" disabled>Continue</button>' +
    '<div class="err" id="err0"></div>' +
    '</div>' +

    // Step 2: PIN
    '<div class="step" id="step1">' +
    '<div class="sub">Set a 6-digit PIN</div>' +
    pinBoxesHtml +
    '<button class="btn" id="btn1" disabled style="margin-top:20px">Create Account</button>' +
    '<div class="err" id="err1"></div>' +
    '</div>' +

    '<script>' +
    pinBoxScript +
    'var inviteCode=' + JSON.stringify(inviteCode) + ';' +
    'var step=0;' +
    'var userEl=document.getElementById("username"),pinEl=document.getElementById("pin");' +
    'var steps=[document.getElementById("step0"),document.getElementById("step1")];' +
    'var dots=[document.getElementById("dot0"),document.getElementById("dot1")];' +
    'var btns=[document.getElementById("btn0"),document.getElementById("btn1")];' +
    'var errs=[document.getElementById("err0"),document.getElementById("err1")];' +
    'var usernameRe=/^[a-zA-Z0-9_\\-]+$/;' +

    'function goStep(n){' +
    'steps[step].classList.remove("active");dots[step].classList.remove("current");dots[step].classList.add("done");' +
    'step=n;steps[step].classList.add("active");dots[step].classList.add("current");' +
    'errs[step].textContent="";' +
    'if(step===1){initPinBoxes("pin-boxes","pin",function(){if(!btns[1].disabled)doRegister()});' +
    'var boxes=document.querySelectorAll(".pin-digit");' +
    'for(var i=0;i<boxes.length;i++)boxes[i].addEventListener("input",function(){btns[1].disabled=pinEl.value.length!==6})}' +
    '}' +

    // Step 1 validation
    'userEl.addEventListener("input",function(){' +
    'var v=userEl.value;var valid=v.length>=1&&usernameRe.test(v);' +
    'btns[0].disabled=!valid;' +
    'if(v.length>0&&!valid)errs[0].textContent="Letters, numbers, hyphens and underscores only";' +
    'else errs[0].textContent=""});' +
    'btns[0].onclick=function(){goStep(1)};' +

    'function doRegister(){' +
    'btns[1].disabled=true;errs[1].textContent="";' +
    'fetch("/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({inviteCode:inviteCode,username:userEl.value,displayName:userEl.value,pin:pinEl.value})})' +
    '.then(function(r){return r.json()})' +
    '.then(function(d){' +
    'if(d.ok){location.href="/";return}' +
    'errs[1].textContent=d.error||"Registration failed";btns[1].disabled=false})' +
    '.catch(function(){errs[1].textContent="Connection error";btns[1].disabled=false})}' +
    'btns[1].onclick=doRegister;' +
    '</script></div></body></html>';
}

// --- No Projects Assigned Page (multi-user: user has no accessible projects) ---
function noProjectsPageHtml() {
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>Clay</title>' +
    '<style>' + authPageStyles + '</style></head><body><div class="c">' +
    '<img src="/clay-logo.png" class="logo" alt="Clay">' +
    '<div class="sub">No projects have been assigned to your account yet.</div>' +
    '<div class="info">Ask an admin to grant you access to a project.</div>' +
    '</div></body></html>';
}

module.exports = { pinPageHtml: pinPageHtml, setupPageHtml: setupPageHtml, adminSetupPageHtml: adminSetupPageHtml, multiUserLoginPageHtml: multiUserLoginPageHtml, invitePageHtml: invitePageHtml, noProjectsPageHtml: noProjectsPageHtml };
