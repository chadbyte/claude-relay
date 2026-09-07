// Pig rich Display element. Runs inside the sandboxed Capsule frame.
//
// This element is pure rendering over the same projection the floor renders
// and a Mate reads: it invents no meaning of its own, and its only outward
// capability is ClayCapsule.act, which lands in the same Logic pipeline as a
// floor button. Swapping this file in or out changes nothing a Mate sees.

(function () {
  "use strict";

  var api = window.ClayCapsule;
  var state = null;
  var caption = "";
  var animating = null;

  document.body.style.margin = "0";
  document.body.style.background = "#141414";
  document.body.style.fontFamily = "system-ui, sans-serif";

  var root = document.createElement("div");
  root.style.padding = "12px";
  document.body.appendChild(root);

  var captionEl = document.createElement("div");
  captionEl.style.color = "#b8b8b8";
  captionEl.style.fontSize = "12px";
  captionEl.style.minHeight = "16px";
  captionEl.style.marginBottom = "8px";
  root.appendChild(captionEl);

  var canvas = document.createElement("canvas");
  canvas.width = 560;
  canvas.height = 190;
  canvas.style.width = "100%";
  canvas.style.display = "block";
  root.appendChild(canvas);
  var ctx = canvas.getContext("2d");

  var controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "8px";
  controls.style.marginTop = "10px";
  root.appendChild(controls);

  var rulesEl = document.createElement("p");
  rulesEl.textContent = "Pig is a push-your-luck dice game: roll to build this turn's total, but a 1 loses it. Hold to bank your points; the first player to 100 wins.";
  rulesEl.style.margin = "12px 0 0";
  rulesEl.style.color = "#b8b8b8";
  rulesEl.style.fontSize = "12px";
  rulesEl.style.lineHeight = "1.45";
  root.appendChild(rulesEl);

  function makeButton(label, action, accent) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.flex = "1";
    button.style.padding = "8px 0";
    button.style.border = "0";
    button.style.borderRadius = "8px";
    button.style.fontSize = "13px";
    button.style.cursor = "pointer";
    button.style.background = accent ? "#c96f4a" : "#2c2c2c";
    button.style.color = accent ? "#141414" : "#d8d8d8";
    button.addEventListener("click", function () { api.act(action, {}); });
    controls.appendChild(button);
    return button;
  }

  var rollButton = makeButton("Roll", "roll", true);
  var holdButton = makeButton("Hold", "hold", false);
  var resetButton = makeButton("Reset", "reset", false);

  function drawBar(y, label, value, target, color) {
    ctx.fillStyle = "#b8b8b8";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(label + "  " + value + " / " + target, 12, y - 6);
    ctx.fillStyle = "#2c2c2c";
    ctx.fillRect(12, y, 380, 14);
    ctx.fillStyle = color;
    var width = Math.max(0, Math.min(1, value / target)) * 380;
    ctx.fillRect(12, y, width, 14);
  }

  function drawDie(face, highlight) {
    var x = 430;
    var y = 40;
    var size = 96;
    ctx.fillStyle = highlight ? "#f0e5d8" : "#d8d8d8";
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 14);
    ctx.fill();
    if (!face) return;
    ctx.fillStyle = face === 1 ? "#c9564a" : "#141414";
    var spots = {
      1: [[0.5, 0.5]],
      2: [[0.28, 0.28], [0.72, 0.72]],
      3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
      4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
      5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
      6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
    };
    var pips = spots[face] || [];
    for (var i = 0; i < pips.length; i++) {
      ctx.beginPath();
      ctx.arc(x + pips[i][0] * size, y + pips[i][1] * size, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw(faceOverride, highlight) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state) {
      ctx.fillStyle = "#b8b8b8";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Waiting for the game state...", 12, 30);
      return;
    }
    var target = state.target || 100;
    var scores = state.scores || {};
    drawBar(36, "You", scores.user || 0, target, "#5a9e6f");
    drawBar(78, "Your Mate", scores.mate || 0, target, "#6f7fc9");
    ctx.fillStyle = "#d8d8d8";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(state.turnTotalText || "", 12, 122);
    if (state.complete && state.winner) {
      ctx.fillStyle = "#f0c96f";
      ctx.font = "600 15px system-ui, sans-serif";
      ctx.fillText((state.winner === "user" ? "You win!" : "Your Mate wins!"), 12, 152);
    }
    drawDie(faceOverride !== undefined ? faceOverride : state.lastRoll, !!highlight);
  }

  function syncButtons() {
    var userTurn = !!(state && state.userTurn);
    rollButton.disabled = !userTurn;
    holdButton.disabled = !userTurn;
    rollButton.style.opacity = userTurn ? "1" : "0.4";
    holdButton.style.opacity = userTurn ? "1" : "0.4";
  }

  // Animates a decided roll: a brief pip shuffle that settles on the face the
  // server already rolled. Pure presentation of a fact already in state.
  function animateRoll(finalFace, next) {
    if (animating) clearInterval(animating.timer);
    var frames = 8;
    var animation = { timer: null };
    animating = animation;
    animation.timer = setInterval(function () {
      frames--;
      if (frames <= 0) {
        clearInterval(animation.timer);
        if (animating === animation) animating = null;
        state = next;
        draw(finalFace, finalFace === 1);
        syncButtons();
        return;
      }
      draw((frames % 6) + 1, true);
    }, 55);
  }

  api.onState = function (nextState) {
    state = nextState || {};
    if (!animating) {
      draw();
      syncButtons();
    }
    captionEl.textContent = caption;
  };

  api.onEvent = function (event) {
    if (!event || !event.next) return;
    var who = event.actor === "mate" ? "Your Mate" : "You";
    var next = event.next;
    if (event.action === "roll") {
      caption = next.lastRoll === 1
        ? who + " rolled a 1 and lost the turn total."
        : who + " rolled a " + next.lastRoll + ".";
      captionEl.textContent = caption;
      animateRoll(next.lastRoll, next);
      return;
    }
    if (event.action === "hold") {
      var banked = (event.previous && event.previous.turnTotal) || 0;
      caption = who + " held and banked " + banked + " point(s).";
    } else if (event.action === "reset") {
      caption = who + " started a new game.";
    }
    state = next;
    captionEl.textContent = caption;
    draw();
    syncButtons();
  };

  draw();
  syncButtons();
})();
