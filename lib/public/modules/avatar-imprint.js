// Clay Imprints: deterministic SVG identities derived from a stable seed.

var PAPER = "#f1efe8";
var INK = "#1b1b1a";
var LIGHT_BASE = "#e7e5de";
var LIGHT_FIELD = "#333330";
var REGISTRATION_INDIGO = "#5857fc";
var BRAND_GREEN = "#07e5a3";

function hashString(value) {
  var text = String(value || "anonymous");
  var hash = 2166136261;
  for (var index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seed) {
  var state = seed >>> 0;
  return function nextRandom() {
    state += 0x6d2b79f5;
    var value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random, min, max) {
  return min + random() * (max - min);
}

function number(value) {
  return Math.round(value * 100) / 100;
}

function xmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function legacyIdentity(style, seed) {
  var sourceStyle = String(style || "imprint").toLowerCase();
  var sourceSeed = String(seed || "anonymous");
  if (sourceStyle === "imprint") return sourceSeed;
  return "legacy:" + sourceStyle + ":" + sourceSeed;
}

function curvePath(y, bow, endOffset) {
  return "M -28 " + number(y) +
    " C 17 " + number(y + bow) +
    ", 71 " + number(y - bow) +
    ", 124 " + number(y + endOffset);
}

function cutPath(random) {
  var start = between(random, 37, 52);
  var first = between(random, 14, 84);
  var second = between(random, 12, 86);
  var end = between(random, 40, 64);
  return "M -22 " + number(start) + " C 21 " + number(first) + ", 73 " + number(second) + ", 118 " + number(end);
}

export function imprintSvg(options) {
  var settings = options || {};
  var size = Math.max(12, Math.min(256, Number(settings.size) || 64));
  var identity = legacyIdentity(settings.style, settings.seed);
  var hash = hashString(identity);
  var random = makeRandom(hash);
  var darkBase = random() > 0.52;
  var base = darkBase ? INK : LIGHT_BASE;
  var field = darkBase ? PAPER : LIGHT_FIELD;
  var accent = REGISTRATION_INDIGO;
  var rotation = Math.floor(random() * 4) * 90;
  var bandWidth = between(random, 37, 56);
  var secondaryWidth = between(random, 14, 24);
  var cutWidth = between(random, 15, 25);
  var firstY = between(random, 24, 42);
  var secondY = between(random, 58, 78);
  var firstBow = between(random, -34, 34);
  var secondBow = between(random, -32, 32);
  var firstPath = curvePath(firstY, firstBow, 6);
  var secondPath = curvePath(secondY, -secondBow, -5);
  var contours = "";

  if (size >= 40) {
    for (var contour = -1; contour <= 1; contour++) {
      var offset = contour * 5.2;
      contours += '<path d="' + curvePath(firstY + offset, firstBow, 0) + '" fill="none" stroke="' +
        (darkBase ? PAPER : INK) + '" stroke-opacity="0.2" stroke-width="0.8"/>';
    }
  }

  var clipId = "imprint-" + hash.toString(16);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 96 96"><defs><clipPath id="' + clipId +
    '"><rect width="96" height="96" rx="24"/></clipPath></defs><g clip-path="url(#' + clipId +
    ')"><rect width="96" height="96" fill="' + base + '"/><g transform="rotate(' + rotation +
    ' 48 48)"><path d="' + firstPath + '" fill="none" stroke="' + field + '" stroke-width="' +
    number(bandWidth) + '" stroke-linecap="square"/><path d="' + secondPath + '" fill="none" stroke="' +
    accent + '" stroke-width="' + number(secondaryWidth) + '" stroke-linecap="square"/><path d="' +
    cutPath(random) + '" fill="none" stroke="' + base + '" stroke-width="' + number(cutWidth) +
    '" stroke-linecap="square"/>' + contours + '</g></g><rect x="0.5" y="0.5" width="95" height="95" rx="23.5" fill="none" stroke="' +
    (darkBase ? "#000000" : INK) + '" stroke-opacity="0.16"/></svg>';
}

export function imprintDataUrl(options) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(imprintSvg(options));
}

export function mateMarkSvg(options) {
  var settings = options || {};
  var size = Math.max(12, Math.min(256, Number(settings.size) || 64));
  var identity = String(settings.seed || "M").trim();
  var initial = Array.from(identity || "M")[0].toUpperCase();
  var palette = [
    { background: REGISTRATION_INDIGO, foreground: PAPER },
    { background: BRAND_GREEN, foreground: INK },
    { background: PAPER, foreground: REGISTRATION_INDIGO },
  ][initial.codePointAt(0) % 3];
  var clipId = "mate-mark";

  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 96 96"><defs><clipPath id="' + clipId +
    '"><rect width="96" height="96" rx="24"/></clipPath></defs><g clip-path="url(#' + clipId +
    ')"><rect width="96" height="96" fill="' + palette.background + '"/><text x="48" y="50" fill="' + palette.foreground +
    '" font-family="Arial, Helvetica, sans-serif" font-size="43" font-weight="600" text-anchor="middle" dominant-baseline="middle">' +
    xmlText(initial) + '</text></g><rect x="0.5" y="0.5" width="95" height="95" rx="23.5" fill="none" stroke="#000000" stroke-opacity="0.18"/></svg>';
}

export function mateMarkDataUrl(options) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(mateMarkSvg(options));
}
