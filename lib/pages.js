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
    '.then(function(r){return r.json()})' +
    '.then(function(d){' +
    'if(d.ok){location.reload();return}' +
    'if(d.locked){inp.disabled=true;err.textContent="Too many attempts. Try again in "+Math.ceil(d.retryAfter/60)+" min";' +
    'setTimeout(function(){inp.disabled=false;err.textContent="";inp.focus()},d.retryAfter*1000);return}' +
    'var msg="Wrong PIN";if(typeof d.attemptsLeft==="number"&&d.attemptsLeft<=3)msg+=" ("+d.attemptsLeft+" left)";' +
    'err.textContent=msg;inp.value="";inp.focus()})' +
    '.catch(function(){err.textContent="Connection error"})}});' +
    '</script></div></body></html>';
}

function setupPageHtml(httpsUrl, httpUrl, hasCert) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
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
  if (!isTailscale && !isLocal) steps.push("tailscale");
  if (hasCert && !isHttps) steps.push("cert");
  if (!isStandalone) steps.push("pwa");
  if ((isHttps || isLocal) && !hasPushSub) steps.push("push");
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
    location.replace(httpsUrl + "/setup");
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
      .then(function() { location.replace(info.httpsUrl + "/setup"); })
      .catch(function() { init(); });
  }).catch(function() { init(); });
} else {
  init();
}
</script>
</body></html>`;
}

function dashboardPageHtml(projects, version) {
  var cards = "";
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    var statusIcon = p.isProcessing ? "⚡" : (p.clients > 0 ? "🟢" : "⏸");
    var sessionLabel = p.sessions === 1 ? "1 session" : p.sessions + " sessions";
    var displayName = p.title || p.project;
    cards += '<a class="card" href="/p/' + p.slug + '/">' +
      '<div class="card-title">' + escapeHtml(displayName) + ' <span class="card-status">' + statusIcon + '</span></div>' +
      '<div class="card-path">' + escapeHtml(p.path) + '</div>' +
      '<div class="card-meta">' + sessionLabel + ' · ' + p.clients + ' client' + (p.clients !== 1 ? 's' : '') + '</div>' +
      '</a>';
  }
  if (projects.length === 0) {
    cards = '<div class="empty">No projects registered. Run <code>claude-relay</code> in a project directory to add one.</div>';
  }
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Claude Relay</title>' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{background:#2F2E2B;color:#E8E5DE;font-family:-apple-system,system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px}' +
    'h1{font-size:24px;font-weight:600;margin-bottom:8px;color:#E8E5DE}' +
    '.subtitle{font-size:13px;color:#8B887F;margin-bottom:32px}' +
    '.cards{display:flex;flex-direction:column;gap:12px;width:100%;max-width:480px}' +
    '.card{display:block;background:#3A3936;border:1px solid #4A4845;border-radius:12px;padding:16px 20px;text-decoration:none;color:#E8E5DE;transition:border-color .15s,background .15s}' +
    '.card:hover{border-color:#DA7756;background:#3F3D3A}' +
    '.card-title{font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px}' +
    '.card-status{font-size:14px}' +
    '.card-path{font-size:12px;color:#8B887F;margin-top:4px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.card-meta{font-size:12px;color:#6B6862;margin-top:8px}' +
    '.empty{text-align:center;color:#6B6862;font-size:14px;padding:40px 20px}' +
    '.empty code{background:#3A3936;padding:2px 6px;border-radius:4px;font-size:13px;color:#DA7756}' +
    '.footer{margin-top:40px;font-size:11px;color:#4A4845}' +
    '</style></head><body>' +
    '<h1>Claude Relay</h1>' +
    '<div class="subtitle">Select a project</div>' +
    '<div class="cards">' + cards + '</div>' +
    '<div class="footer">v' + escapeHtml(version || "") + '</div>' +
    '</body></html>';
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

module.exports = { pinPageHtml, setupPageHtml, dashboardPageHtml };
