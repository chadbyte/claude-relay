import { copyToClipboard } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var ctx;
var basePath = "/";
var onboardingBanner, onboardingText, onboardingClose, onboardingDismissed;
var notifAlertEnabled, notifSoundEnabled, notifPermission;
var audioCtx = null;

export function isNotifAlertEnabled() { return notifAlertEnabled; }
export function isNotifSoundEnabled() { return notifSoundEnabled; }
export function getNotifPermission() { return notifPermission; }

export function showOnboarding(html) {
  onboardingText.innerHTML = html;
  onboardingBanner.classList.remove("hidden");
  refreshIcons();
}

export function hideOnboarding() {
  onboardingBanner.classList.add("hidden");
}

export function playDoneSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.stop(audioCtx.currentTime + 0.3);
  } catch(e) {}
}

export function showDoneNotification() {
  var lastAssistant = ctx.messagesEl.querySelector(".msg-assistant:last-of-type .md-content");
  var preview = lastAssistant ? lastAssistant.textContent.substring(0, 100) : "Response ready";

  var sessionTitle = "Claude";
  var activeItem = ctx.sessionListEl.querySelector(".session-item.active");
  if (activeItem) {
    var textEl = activeItem.querySelector(".session-item-text");
    if (textEl) sessionTitle = textEl.textContent || "Claude";
    else sessionTitle = activeItem.textContent || "Claude";
  }

  var n = new Notification(sessionTitle, {
    body: preview,
    tag: "claude-done",
  });

  n.onclick = function() {
    window.focus();
    n.close();
  };

  setTimeout(function() { n.close(); }, 5000);
}

export function initNotifications(_ctx) {
  ctx = _ctx;
  basePath = ctx.basePath || "/";
  var $ = ctx.$;

  // --- Mobile viewport (iOS keyboard handling) ---
  if (window.visualViewport) {
    var layout = $("layout");
    function onViewportChange() {
      layout.style.height = window.visualViewport.height + "px";
      document.documentElement.scrollTop = 0;
      ctx.scrollToBottom();
    }
    window.visualViewport.addEventListener("resize", onViewportChange);
    window.visualViewport.addEventListener("scroll", onViewportChange);
  }

  // --- Update banner ---
  (function () {
    var banner = $("update-banner");
    var closeBtn = $("update-banner-close");
    var howBtn = $("update-how");
    if (!banner) return;

    // Build popover
    var popover = document.createElement("div");
    popover.id = "update-popover";
    popover.innerHTML =
      '<div class="popover-label">Run in your terminal:</div>' +
      '<div class="popover-cmd">' +
      '<code>npx claude-relay@latest</code>' +
      '<button class="popover-copy" title="Copy">' + iconHtml("copy") + '</button>' +
      '</div>';
    banner.appendChild(popover);
    refreshIcons();

    var copyBtn = popover.querySelector(".popover-copy");
    copyBtn.addEventListener("click", function () {
      copyToClipboard("npx claude-relay@latest").then(function () {
        copyBtn.classList.add("copied");
        copyBtn.innerHTML = iconHtml("check");
        refreshIcons();
        setTimeout(function () {
          copyBtn.classList.remove("copied");
          copyBtn.innerHTML = iconHtml("copy");
          refreshIcons();
        }, 1500);
      });
    });

    howBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      popover.classList.toggle("visible");
    });

    document.addEventListener("click", function (e) {
      if (!popover.contains(e.target) && e.target !== howBtn) {
        popover.classList.remove("visible");
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        banner.classList.add("hidden");
        popover.classList.remove("visible");
      });
    }
  })();

  // --- Sidebar footer menu ---
  (function () {
    var footerBtn = $("sidebar-footer-btn");
    var footerMenu = $("sidebar-footer-menu");
    var footerUpdateCheck = $("footer-update-check");
    if (!footerBtn || !footerMenu) return;

    footerBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      footerMenu.classList.toggle("hidden");
    });

    document.addEventListener("click", function (e) {
      if (!footerMenu.contains(e.target) && e.target !== footerBtn) {
        footerMenu.classList.add("hidden");
      }
    });

    function setUpdateIcon(name, spin) {
      var el = footerUpdateCheck.querySelector(".lucide, [data-lucide]");
      if (!el) return;
      el.setAttribute("data-lucide", name);
      if (spin) el.classList.add("icon-spin-inline");
      else el.classList.remove("icon-spin-inline");
      refreshIcons();
      // refreshIcons replaces element, re-apply spin to the new one
      if (spin) {
        var newEl = footerUpdateCheck.querySelector(".lucide");
        if (newEl) newEl.classList.add("icon-spin-inline");
      }
    }

    if (footerUpdateCheck) {
      footerUpdateCheck.addEventListener("click", function (e) {
        e.stopPropagation();
        var labelSpan = footerUpdateCheck.querySelector("span");
        // If update banner already visible, scroll to it
        var updateBanner = $("update-banner");
        if (updateBanner && !updateBanner.classList.contains("hidden")) {
          footerMenu.classList.add("hidden");
          updateBanner.scrollIntoView({ behavior: "smooth" });
          return;
        }
        // Trigger check, keep menu open for feedback
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "check_update" }));
        }
        setUpdateIcon("loader", true);
        labelSpan.textContent = "Checking...";
        footerUpdateCheck.disabled = true;
        setTimeout(function () {
          if (labelSpan.textContent === "Checking...") {
            labelSpan.textContent = "Up to date";
            setUpdateIcon("check", false);
            setTimeout(function () {
              labelSpan.textContent = "Check for updates";
              footerUpdateCheck.disabled = false;
              setUpdateIcon("refresh-cw", false);
            }, 1500);
          }
        }, 2000);
      });
    }
  })();

  // --- Onboarding banner (HTTPS / Push) ---
  onboardingBanner = $("onboarding-banner");
  onboardingText = $("onboarding-banner-text");
  onboardingClose = $("onboarding-banner-close");
  onboardingDismissed = localStorage.getItem("onboarding-dismissed");

  if (onboardingClose) {
    onboardingClose.addEventListener("click", function () {
      hideOnboarding();
      localStorage.setItem("onboarding-dismissed", "1");
      onboardingDismissed = "1";
    });
  }

  // Suggest HTTPS setup for push notification support
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    if (!onboardingDismissed) {
      showOnboarding(
        iconHtml("bell-ring") +
        ' Get alerts on your phone when Claude is done. <a href="/setup">Set up HTTPS</a>'
      );
    }
  }

  // --- Tooltip ---
  var tooltipEl = document.createElement("div");
  tooltipEl.className = "tooltip";
  document.body.appendChild(tooltipEl);
  var tooltipTimer = null;

  document.addEventListener("click", function (e) {
    var target = e.target.closest("[data-tip]");
    if (target) {
      tooltipEl.textContent = target.dataset.tip;
      var rect = target.getBoundingClientRect();
      tooltipEl.style.top = (rect.bottom + 8) + "px";
      tooltipEl.style.left = (rect.left + rect.width / 2) + "px";
      tooltipEl.classList.add("visible");
      clearTimeout(tooltipTimer);
      tooltipTimer = setTimeout(function () {
        tooltipEl.classList.remove("visible");
      }, 2000);
    } else {
      tooltipEl.classList.remove("visible");
    }
  });

  // --- Browser notifications ---
  notifPermission = ("Notification" in window) ? Notification.permission : "denied";
  notifAlertEnabled = localStorage.getItem("notif-alert") !== "0";
  notifSoundEnabled = localStorage.getItem("notif-sound") !== "0";

  var notifBtn = $("notif-btn");
  var notifMenu = $("notif-menu");
  var notifToggleAlert = $("notif-toggle-alert");
  var notifToggleSound = $("notif-toggle-sound");

  if (notifAlertEnabled && "Notification" in window && Notification.permission === "denied") {
    notifAlertEnabled = false;
    localStorage.setItem("notif-alert", "0");
  }
  notifToggleAlert.checked = notifAlertEnabled;
  notifToggleSound.checked = notifSoundEnabled;

  notifBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var open = notifMenu.classList.toggle("hidden");
    notifBtn.classList.toggle("active", !open);
  });

  document.addEventListener("click", function (e) {
    if (!notifMenu.contains(e.target) && e.target !== notifBtn) {
      notifMenu.classList.add("hidden");
      notifBtn.classList.remove("active");
    }
  });

  var notifBlockedHint = $("notif-blocked-hint");

  notifToggleAlert.addEventListener("change", function () {
    notifAlertEnabled = notifToggleAlert.checked;
    localStorage.setItem("notif-alert", notifAlertEnabled ? "1" : "0");
    notifBlockedHint.classList.add("hidden");
    if (notifAlertEnabled && notifPermission !== "granted") {
      if ("Notification" in window && Notification.permission === "denied") {
        notifAlertEnabled = false;
        notifToggleAlert.checked = false;
        localStorage.setItem("notif-alert", "0");
        notifBlockedHint.classList.remove("hidden");
        refreshIcons();
        return;
      }
      Notification.requestPermission().then(function (p) {
        notifPermission = p;
        if (p !== "granted") {
          notifAlertEnabled = false;
          notifToggleAlert.checked = false;
          localStorage.setItem("notif-alert", "0");
          notifBlockedHint.classList.remove("hidden");
          refreshIcons();
        }
      });
    }
  });

  // --- Notification help modal ---
  var notifHelpModal = $("notif-help-modal");
  var notifHelpClose = $("notif-help-close");
  var notifLearnMore = $("notif-learn-more");
  var notifUrlCopy = $("notif-url-copy");
  var notifSettingsUrl = $("notif-settings-url");

  // Detect browser and set correct settings URL
  (function () {
    var url = "chrome://settings/content/notifications";
    var ua = navigator.userAgent;
    if (ua.indexOf("Firefox") !== -1) url = "about:preferences#privacy";
    else if (ua.indexOf("Edg/") !== -1) url = "edge://settings/content/notifications";
    else if (ua.indexOf("Arc") !== -1) url = "arc://settings/content/notifications";
    notifSettingsUrl.textContent = url;
  })();

  notifLearnMore.addEventListener("click", function (e) {
    e.preventDefault();
    notifHelpModal.classList.remove("hidden");
    refreshIcons();
  });

  notifHelpClose.addEventListener("click", function () {
    notifHelpModal.classList.add("hidden");
  });

  notifHelpModal.querySelector(".confirm-backdrop").addEventListener("click", function () {
    notifHelpModal.classList.add("hidden");
  });

  notifUrlCopy.addEventListener("click", function () {
    copyToClipboard(notifSettingsUrl.textContent).then(function () {
      notifUrlCopy.classList.add("copied");
      notifUrlCopy.innerHTML = iconHtml("check");
      refreshIcons();
      setTimeout(function () {
        notifUrlCopy.classList.remove("copied");
        notifUrlCopy.innerHTML = iconHtml("copy");
        refreshIcons();
      }, 1500);
    });
  });

  notifToggleSound.addEventListener("change", function () {
    notifSoundEnabled = notifToggleSound.checked;
    localStorage.setItem("notif-sound", notifSoundEnabled ? "1" : "0");
  });

  // --- Push notifications toggle ---
  var notifPushRow = $("notif-push-row");
  var notifTogglePush = $("notif-toggle-push");
  var pushAvailable = ("serviceWorker" in navigator) &&
    (location.protocol === "https:" || location.hostname === "localhost");

  if (pushAvailable) {
    notifPushRow.style.display = "flex";
  }

  function sendPushSubscription(sub) {
    window._pushSubscription = sub;
    var json = sub.toJSON();
    if (ctx.ws && ctx.ws.readyState === 1) {
      ctx.ws.send(JSON.stringify({ type: "push_subscribe", subscription: json }));
    } else {
      fetch(basePath + "api/push-subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify(json),
      });
    }
  }

  function subscribePush() {
    navigator.serviceWorker.ready.then(function (reg) {
      return fetch(basePath + "api/vapid-public-key", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.publicKey) throw new Error("No VAPID key");
          var raw = atob(data.publicKey.replace(/-/g, "+").replace(/_/g, "/"));
          var key = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        });
    }).then(function (sub) {
      sendPushSubscription(sub);
      localStorage.setItem("notif-push", "1");
    }).catch(function () {
      notifTogglePush.checked = false;
      localStorage.setItem("notif-push", "0");
    });
  }

  function unsubscribePush() {
    if (window._pushSubscription) {
      window._pushSubscription.unsubscribe().catch(function () {});
      window._pushSubscription = null;
    }
    localStorage.setItem("notif-push", "0");
  }

  notifTogglePush.addEventListener("change", function () {
    if (notifTogglePush.checked) {
      subscribePush();
    } else {
      unsubscribePush();
    }
  });

  // --- Service Worker registration & push state sync ---
  (function initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;

    navigator.serviceWorker.register(basePath + "sw.js", { scope: basePath })
      .then(function () { return navigator.serviceWorker.ready; })
      .then(function (reg) {
        // Fetch current VAPID key to detect key changes
        var vapidPromise = fetch(basePath + "api/vapid-public-key", { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (d) { return d.publicKey || null; })
          .catch(function () { return null; });

        return Promise.all([reg.pushManager.getSubscription(), vapidPromise]).then(function (results) {
          var sub = results[0];
          var serverKey = results[1];

          // If subscription exists but VAPID key changed, unsubscribe and re-subscribe
          if (sub && serverKey) {
            var savedKey = localStorage.getItem("vapid-key");
            if (savedKey && savedKey !== serverKey) {
              sub.unsubscribe().catch(function () {});
              sub = null;
            }
          }
          if (serverKey) localStorage.setItem("vapid-key", serverKey);

          if (sub) {
            window._pushSubscription = sub;
            notifTogglePush.checked = true;
            sendPushSubscription(sub);
          } else if (serverKey && localStorage.getItem("notif-push") === "1") {
            // Had push enabled but subscription is gone (VAPID key change), re-subscribe
            var raw = atob(serverKey.replace(/-/g, "+").replace(/_/g, "/"));
            var key = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
            reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
              .then(function (newSub) {
                sendPushSubscription(newSub);
                notifTogglePush.checked = true;
              }).catch(function () {
                notifTogglePush.checked = false;
                localStorage.setItem("notif-push", "0");
              });
          } else {
            notifTogglePush.checked = false;
            localStorage.setItem("notif-push", "0");
            // Standalone (PWA) without push: redirect to setup for push onboarding
            var isStandalone = window.matchMedia("(display-mode:standalone)").matches || navigator.standalone;
            if (isStandalone) {
              location.href = "/setup";
              return;
            }
            // Browser: show onboarding banner
            if (!onboardingDismissed) {
              showOnboarding(
                iconHtml("bell-ring") +
                ' Get notified when Claude responds. ' +
                '<button class="onboarding-cta" id="onboarding-enable-push">Enable push notifications</button>'
              );
              var enableBtn = $("onboarding-enable-push");
              if (enableBtn) {
                enableBtn.addEventListener("click", function () {
                  subscribePush();
                  notifTogglePush.checked = true;
                  hideOnboarding();
                  localStorage.setItem("onboarding-dismissed", "1");
                });
              }
            }
          }
        });
      })
      .catch(function () {});
  })();

  // --- Debug panel ---
  (function () {
    var debugBtn = $("debug-btn");
    var debugMenu = $("debug-menu");
    if (!debugBtn || !debugMenu) return;

    var debugToggleUpdate = $("debug-toggle-update");
    var debugToggleOnboarding = $("debug-toggle-onboarding");

    debugBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = debugMenu.classList.toggle("hidden");
      debugBtn.classList.toggle("active", !open);

      // Sync toggle states with current banner visibility
      var updateBanner = $("update-banner");
      if (debugToggleUpdate && updateBanner) {
        debugToggleUpdate.checked = !updateBanner.classList.contains("hidden");
      }
      if (debugToggleOnboarding && onboardingBanner) {
        debugToggleOnboarding.checked = !onboardingBanner.classList.contains("hidden");
      }
    });

    document.addEventListener("click", function (e) {
      if (!debugMenu.contains(e.target) && e.target !== debugBtn) {
        debugMenu.classList.add("hidden");
        debugBtn.classList.remove("active");
      }
    });

    if (debugToggleUpdate) {
      debugToggleUpdate.addEventListener("change", function () {
        var banner = $("update-banner");
        if (!banner) return;
        if (debugToggleUpdate.checked) {
          // Trigger real update check from server (debug mode uses v0.0.9)
          if (ctx.ws && ctx.connected) {
            ctx.ws.send(JSON.stringify({ type: "check_update" }));
          }
        } else {
          banner.classList.add("hidden");
        }
        refreshIcons();
      });
    }

    if (debugToggleOnboarding) {
      debugToggleOnboarding.addEventListener("change", function () {
        if (debugToggleOnboarding.checked) {
          if (!onboardingText.innerHTML.trim()) {
            showOnboarding(
              iconHtml("bell-ring") +
              ' Get alerts on your phone when Claude is done. <a href="/setup">Set up HTTPS</a>'
            );
          } else {
            onboardingBanner.classList.remove("hidden");
          }
        } else {
          hideOnboarding();
        }
      });
    }
  })();
}
