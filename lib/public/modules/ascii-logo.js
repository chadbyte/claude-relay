// --- Animated ASCII Logo (Canvas particle system) ---
// Midjourney-style scatter-in / color-sweep / shatter / reassemble animation

var ASCII_LINES = [
  "________/\\\\\\\\\\\\\\\\\\__/\\\\\\_________________/\\\\\\\\\\\\\\\\\\_____/\\\\\\________/\\\\\\",
  " _____/\\\\\\////////__\\/\\\\\\_______________/\\\\\\\\\\\\\\\\\\\\\\\\\\__\\///\\\\\\____/\\\\\\/_",
  "  ___/\\\\\\/___________\\/\\\\\\______________/\\\\\\/////////\\\\\\___\\///\\\\\\/\\\\\\/___",
  "   __/\\\\\\_____________\\/\\\\\\_____________\\/\\\\\\_______\\/\\\\\\_____\\///\\\\\\/_____",
  "    _\\/\\\\\\_____________\\/\\\\\\_____________\\/\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\_______\\/\\\\\\______",
  "     _\\//\\\\\\____________\\/\\\\\\_____________\\/\\\\\\/////////\\\\\\_______\\/\\\\\\______",
  "      __\\///\\\\\\__________\\/\\\\\\_____________\\/\\\\\\_______\\/\\\\\\_______\\/\\\\\\______",
  "       ____\\////\\\\\\\\\\\\\\\\\\_\\/\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\_\\/\\\\\\_______\\/\\\\\\_______\\/\\\\\\______",
  "        _______\\/////////__\\///////////////__\\///________\\///________\\///_______",
];

// Tri-accent gradient stops: Green → Indigo → Terracotta
var GRADIENT_STOPS = [
  [9, 229, 163],
  [88, 87, 252],
  [254, 113, 80],
];

// Animation phase durations (seconds)
var PHASE_SCATTER_IN = 1.8;
var PHASE_COLOR_SWEEP = 0.9;
var PHASE_HOLD = 2.5;
var PHASE_SHATTER = 1.4;
var PHASE_REASSEMBLE = 1.8;

var canvas = null;
var ctx = null;
var particles = [];
var phase = "idle";
var phaseTime = 0;
var animId = null;
var lastTime = 0;
var charWidth = 0;
var lineHeight = 0;
var fontSize = 0;
var offsetX = 0;
var offsetY = 0;
var centerX = 0;
var centerY = 0;
var maxCol = 0;
var running = false;

function getGradientColor(row, totalRows) {
  var t = totalRows > 1 ? row / (totalRows - 1) : 0;
  var r, g, b;
  if (t <= 0.5) {
    var s = t * 2;
    r = Math.round(GRADIENT_STOPS[0][0] + (GRADIENT_STOPS[1][0] - GRADIENT_STOPS[0][0]) * s);
    g = Math.round(GRADIENT_STOPS[0][1] + (GRADIENT_STOPS[1][1] - GRADIENT_STOPS[0][1]) * s);
    b = Math.round(GRADIENT_STOPS[0][2] + (GRADIENT_STOPS[1][2] - GRADIENT_STOPS[0][2]) * s);
  } else {
    var s = (t - 0.5) * 2;
    r = Math.round(GRADIENT_STOPS[1][0] + (GRADIENT_STOPS[2][0] - GRADIENT_STOPS[1][0]) * s);
    g = Math.round(GRADIENT_STOPS[1][1] + (GRADIENT_STOPS[2][1] - GRADIENT_STOPS[1][1]) * s);
    b = Math.round(GRADIENT_STOPS[1][2] + (GRADIENT_STOPS[2][2] - GRADIENT_STOPS[1][2]) * s);
  }
  return [r, g, b];
}

function easeOutElastic(t) {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
}

function easeOutCubic(t) {
  var t1 = t - 1;
  return t1 * t1 * t1 + 1;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildParticles() {
  particles = [];
  maxCol = 0;
  for (var row = 0; row < ASCII_LINES.length; row++) {
    var line = ASCII_LINES[row];
    for (var col = 0; col < line.length; col++) {
      var ch = line[col];
      if (ch === " " || ch === "_") continue;
      if (col > maxCol) maxCol = col;
      var gc = getGradientColor(row, ASCII_LINES.length);
      particles.push({
        char: ch,
        row: row,
        col: col,
        targetX: 0,
        targetY: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        opacity: 0,
        rotation: 0,
        vr: 0,
        finalR: gc[0],
        finalG: gc[1],
        finalB: gc[2],
        r: 160,
        g: 160,
        b: 160,
        scatterX: 0,
        scatterY: 0,
      });
    }
  }
}

function computeLayout() {
  if (!canvas) return;
  var container = canvas.parentElement;
  var dpr = window.devicePixelRatio || 1;
  var w = container.clientWidth;
  var h = container.clientHeight;

  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // Find longest line
  var maxLen = 0;
  for (var i = 0; i < ASCII_LINES.length; i++) {
    if (ASCII_LINES[i].length > maxLen) maxLen = ASCII_LINES[i].length;
  }

  // Responsive font size
  fontSize = Math.floor(w / maxLen * 1.05);
  fontSize = Math.max(6, Math.min(fontSize, 20));

  ctx.font = fontSize + "px Menlo, Monaco, Consolas, 'Courier New', monospace";
  charWidth = ctx.measureText("M").width;
  lineHeight = fontSize * 1.5;

  var totalW = maxLen * charWidth;
  var totalH = ASCII_LINES.length * lineHeight;
  offsetX = (w - totalW) / 2;
  offsetY = (h - totalH) / 2;
  centerX = w / 2;
  centerY = h / 2;

  // Recompute target positions
  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    p.targetX = offsetX + p.col * charWidth;
    p.targetY = offsetY + p.row * lineHeight + lineHeight * 0.8;
  }
}

function randomScatter(p) {
  var canvasW = canvas.width / (window.devicePixelRatio || 1);
  var canvasH = canvas.height / (window.devicePixelRatio || 1);
  p.scatterX = (Math.random() - 0.5) * canvasW * 2;
  p.scatterY = (Math.random() - 0.5) * canvasH * 2;
  p.x = p.scatterX;
  p.y = p.scatterY;
  p.opacity = 0;
  p.rotation = (Math.random() - 0.5) * Math.PI * 4;
  p.vx = 0;
  p.vy = 0;
  p.vr = 0;
  p.r = 160;
  p.g = 160;
  p.b = 160;
}

function setPhase(newPhase) {
  phase = newPhase;
  phaseTime = 0;

  if (phase === "scatter-in") {
    for (var i = 0; i < particles.length; i++) {
      randomScatter(particles[i]);
    }
  } else if (phase === "shatter") {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var angle = Math.atan2(p.targetY - centerY, p.targetX - centerX);
      angle += (Math.random() - 0.5) * 0.6;
      var speed = 250 + Math.random() * 450;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.vr = (Math.random() - 0.5) * 8;
    }
  } else if (phase === "reassemble") {
    // particles keep their current positions from shatter
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.scatterX = p.x;
      p.scatterY = p.y;
      p.vx = 0;
      p.vy = 0;
    }
  }
}

function updateParticles(dt) {
  phaseTime += dt;

  if (phase === "scatter-in") {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      // Stagger by column — delay proportional to column position
      var delay = (p.col / (maxCol || 1)) * 0.6;
      var localT = Math.max(0, phaseTime - delay) / (PHASE_SCATTER_IN - 0.6);
      localT = Math.min(localT, 1);
      var ease = easeOutElastic(localT);

      p.x = lerp(p.scatterX, p.targetX, ease);
      p.y = lerp(p.scatterY, p.targetY, ease);
      p.opacity = Math.min(1, localT * 3);
      p.rotation = lerp(p.rotation, 0, localT);
    }
    if (phaseTime >= PHASE_SCATTER_IN) {
      // Snap to targets
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x = p.targetX;
        p.y = p.targetY;
        p.opacity = 1;
        p.rotation = 0;
      }
      setPhase("color-sweep");
    }
  } else if (phase === "color-sweep") {
    var sweepProgress = phaseTime / PHASE_COLOR_SWEEP;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var colNorm = p.col / (maxCol || 1);
      var localT = (sweepProgress - colNorm * 0.6) / 0.4;
      localT = Math.max(0, Math.min(1, localT));
      var ease = easeOutCubic(localT);
      p.r = Math.round(lerp(160, p.finalR, ease));
      p.g = Math.round(lerp(160, p.finalG, ease));
      p.b = Math.round(lerp(160, p.finalB, ease));
    }
    if (phaseTime >= PHASE_COLOR_SWEEP) {
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.r = p.finalR;
        p.g = p.finalG;
        p.b = p.finalB;
      }
      setPhase("hold");
    }
  } else if (phase === "hold") {
    var breath = Math.sin(phaseTime * Math.PI * 0.8) * 0.08;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.opacity = 0.92 + breath;
      // Subtle micro-jitter
      p.x = p.targetX + Math.sin(phaseTime * 2.3 + i * 0.7) * 0.4;
      p.y = p.targetY + Math.cos(phaseTime * 1.9 + i * 0.5) * 0.3;
    }
    if (phaseTime >= PHASE_HOLD) {
      // Reset to exact positions before shatter
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x = p.targetX;
        p.y = p.targetY;
        p.opacity = 1;
      }
      setPhase("shatter");
    }
  } else if (phase === "shatter") {
    var drag = 0.97;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.vr * dt;
      p.vr *= drag;

      // Fade out based on distance from center
      var dx = p.x - centerX;
      var dy = p.y - centerY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var maxDist = Math.max(centerX, centerY) * 0.8;
      p.opacity = Math.max(0, 1 - dist / maxDist);
    }
    if (phaseTime >= PHASE_SHATTER) {
      setPhase("reassemble");
    }
  } else if (phase === "reassemble") {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var delay = ((maxCol - p.col) / (maxCol || 1)) * 0.5;
      var localT = Math.max(0, phaseTime - delay) / (PHASE_REASSEMBLE - 0.5);
      localT = Math.min(localT, 1);
      var ease = easeOutElastic(localT);

      p.x = lerp(p.scatterX, p.targetX, ease);
      p.y = lerp(p.scatterY, p.targetY, ease);
      p.opacity = Math.min(1, localT * 2.5);
      p.rotation = lerp(p.rotation, 0, localT * localT);
    }
    if (phaseTime >= PHASE_REASSEMBLE) {
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x = p.targetX;
        p.y = p.targetY;
        p.opacity = 1;
        p.rotation = 0;
      }
      setPhase("hold");
    }
  }
}

function drawFrame() {
  if (!ctx) return;
  var w = canvas.width / (window.devicePixelRatio || 1);
  var h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);
  ctx.font = fontSize + "px Menlo, Monaco, Consolas, 'Courier New', monospace";
  ctx.textBaseline = "alphabetic";

  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    if (p.opacity <= 0.01) continue;

    ctx.save();
    ctx.globalAlpha = p.opacity;
    ctx.fillStyle = "rgb(" + p.r + "," + p.g + "," + p.b + ")";

    if (Math.abs(p.rotation) > 0.01) {
      ctx.translate(p.x + charWidth / 2, p.y - fontSize / 3);
      ctx.rotate(p.rotation);
      ctx.fillText(p.char, -charWidth / 2, fontSize / 3);
    } else {
      ctx.fillText(p.char, p.x, p.y);
    }
    ctx.restore();
  }
}

function tick(now) {
  if (!running) return;
  var dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  updateParticles(dt);
  drawFrame();
  animId = requestAnimationFrame(tick);
}

var resizeObserver = null;

export function initAsciiLogo(canvasEl) {
  canvas = canvasEl;
  buildParticles();
  computeLayout();

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(function () {
      computeLayout();
    });
    resizeObserver.observe(canvas.parentElement);
  }
}

export function startLogoAnimation() {
  if (running) {
    // Reset to beginning
    cancelAnimationFrame(animId);
  }
  running = true;
  computeLayout();
  setPhase("scatter-in");
  lastTime = performance.now();
  animId = requestAnimationFrame(tick);
}

export function stopLogoAnimation() {
  running = false;
  if (animId) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}
