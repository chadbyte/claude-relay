// User-intent-aware scroll following for the rebuilt Home transcript DOM.

var messagesEl = null;
var activityButton = null;
var bound = false;
var adjusting = false;
var userScrolledUp = false;
var activityVersion = 0;
var seenActivityVersion = 0;
var followNext = false;
var BOTTOM_THRESHOLD = 150;

function resolveDom() {
  if (!messagesEl) messagesEl = document.getElementById("home-mate-chat-messages");
  if (!activityButton) activityButton = document.getElementById("home-chat-new-activity");
  if (bound || !messagesEl || !activityButton) return;
  bound = true;
  messagesEl.addEventListener("scroll", function () {
    if (adjusting) return;
    var distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    userScrolledUp = distance > BOTTOM_THRESHOLD;
    if (!userScrolledUp) {
      seenActivityVersion = activityVersion;
      activityButton.hidden = true;
    }
  }, { passive: true });
  activityButton.addEventListener("click", function () {
    userScrolledUp = false;
    followNext = true;
    activityButton.hidden = true;
    adjusting = true;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    requestAnimationFrame(function () { adjusting = false; });
  });
}

export function markHomeChatActivity() {
  activityVersion += 1;
}

export function followHomeChatNextRender() {
  followNext = true;
  userScrolledUp = false;
}

export function captureHomeChatScroll(force) {
  resolveDom();
  if (!messagesEl) return null;
  var distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  var nearBottom = !isFinite(distance) || distance <= BOTTOM_THRESHOLD;
  return {
    follow: force === true || followNext || (!userScrolledUp && nearBottom),
    scrollTop: messagesEl.scrollTop || 0,
    hasActivity: activityVersion > seenActivityVersion,
  };
}

export function restoreHomeChatScroll(snapshot) {
  resolveDom();
  if (!messagesEl || !snapshot) return;
  followNext = false;
  adjusting = true;
  if (snapshot.follow) {
    userScrolledUp = false;
    seenActivityVersion = activityVersion;
    if (activityButton) activityButton.hidden = true;
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
      adjusting = false;
    });
    return;
  }
  messagesEl.scrollTop = snapshot.scrollTop;
  userScrolledUp = true;
  if (activityButton && snapshot.hasActivity) activityButton.hidden = false;
  requestAnimationFrame(function () { adjusting = false; });
}
