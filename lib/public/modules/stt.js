// Speech-to-Text module using Web Speech API
// Uses browser's built-in speech recognition (Chrome/Edge → Google servers)
// Whisper WASM code remains in workers/ as dead code for potential future use

import { iconHtml, refreshIcons } from './icons.js';
import { autoResize } from './input.js';

var ctx;

// --- State ---
var recording = false;
var recognition = null;
var selectedLang = null;
var textBeforeSTT = '';
var interimText = '';

// DOM refs
var sttBtn = null;
var langPopover = null;

// --- Language options ---
// Web Speech API uses BCP-47 language tags
var LANGUAGES = [
  { code: 'en-US', name: 'English' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'zh-CN', name: 'Chinese' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
];

// --- Persist language choice ---
function saveLang(code) {
  try { localStorage.setItem('stt-lang', code); } catch (e) { /* ignore */ }
}

function loadLang() {
  try { return localStorage.getItem('stt-lang'); } catch (e) { return null; }
}

// --- Check browser support ---
function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// --- Init ---
export function initSTT(_ctx) {
  ctx = _ctx;

  sttBtn = document.getElementById('stt-btn');
  if (!sttBtn) return;

  if (!getSpeechRecognition()) {
    sttBtn.style.display = 'none';
    console.warn('[STT] Web Speech API not supported in this browser');
    return;
  }

  // Restore saved language
  selectedLang = loadLang();

  sttBtn.addEventListener('click', function(e) {
    e.stopPropagation();

    if (recording) {
      stopRecording();
      return;
    }

    if (!selectedLang) {
      showLangPopover();
    } else {
      startRecording();
    }
  });

  // Right-click to change language
  sttBtn.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (recording) stopRecording();
    showLangPopover();
  });
}

// --- Language popover ---
function showLangPopover() {
  if (langPopover) {
    hideLangPopover();
    return;
  }

  langPopover = document.createElement('div');
  langPopover.className = 'stt-lang-popover';

  var html = '<div class="stt-lang-title">Voice Input Language</div>';
  for (var i = 0; i < LANGUAGES.length; i++) {
    var l = LANGUAGES[i];
    var activeClass = (selectedLang === l.code) ? ' stt-lang-active' : '';
    html += '<button class="stt-lang-option' + activeClass + '" data-lang="' + l.code + '">' +
      '<span class="stt-lang-name">' + l.name + '</span>' +
      '</button>';
  }
  langPopover.innerHTML = html;

  langPopover.querySelectorAll('.stt-lang-option').forEach(function(btn) {
    btn.addEventListener('click', function() {
      onLangSelected(btn.dataset.lang);
    });
  });

  var wrapper = document.getElementById('input-wrapper');
  wrapper.appendChild(langPopover);

  setTimeout(function() {
    document.addEventListener('click', closeLangOnOutside);
  }, 0);
}

function closeLangOnOutside(e) {
  if (langPopover && !langPopover.contains(e.target) && e.target !== sttBtn && !sttBtn.contains(e.target)) {
    hideLangPopover();
  }
}

function hideLangPopover() {
  if (langPopover) {
    langPopover.remove();
    langPopover = null;
  }
  document.removeEventListener('click', closeLangOnOutside);
}

function onLangSelected(code) {
  selectedLang = code;
  saveLang(code);
  hideLangPopover();
  startRecording();
}

// --- Recording ---
function startRecording() {
  if (recording) return;

  var SpeechRecognition = getSpeechRecognition();
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.lang = selectedLang || 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  textBeforeSTT = ctx.inputEl.value;
  interimText = '';

  recognition.onresult = function(e) {
    var final = '';
    var interim = '';

    for (var i = 0; i < e.results.length; i++) {
      var result = e.results[i];
      if (result.isFinal) {
        final += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }

    var text = textBeforeSTT;
    if (final) {
      if (text && text.length > 0 && text[text.length - 1] !== ' ' && text[text.length - 1] !== '\n') {
        text += ' ';
      }
      text += final;
    }
    if (interim) {
      if (text && text.length > 0 && text[text.length - 1] !== ' ' && text[text.length - 1] !== '\n') {
        text += ' ';
      }
      text += interim;
    }

    ctx.inputEl.value = text;
    autoResize();
  };

  recognition.onerror = function(e) {
    console.error('[STT] Recognition error:', e.error);
    if (e.error === 'not-allowed') {
      if (ctx.addSystemMessage) {
        ctx.addSystemMessage('Microphone access denied.\n\nTo fix: click the lock icon in the address bar → Site settings → Microphone → Allow, then reload.', true);
      }
      stopRecording();
    } else if (e.error === 'no-speech') {
      // Silence — just keep listening
    } else if (e.error === 'network') {
      if (ctx.addSystemMessage) {
        ctx.addSystemMessage('Speech recognition unavailable.\n\nWeb Speech API sends audio to Google servers for recognition. Some Chromium forks (Arc, Brave) block this connection.\n\nSupported: Chrome, Edge, Safari 14.1+, Samsung Internet\nNot supported: Arc, Brave, Firefox', true);
      }
      stopRecording();
    }
  };

  recognition.onend = function() {
    // Auto-restart if still recording (browser may stop after silence)
    if (recording) {
      // Save confirmed text so far
      textBeforeSTT = ctx.inputEl.value;
      try {
        recognition.start();
      } catch (e) {
        // Already started or other error
        stopRecording();
      }
    }
  };

  try {
    recognition.start();
    recording = true;
    sttBtn.classList.add('stt-active');
    sttBtn.innerHTML = iconHtml('mic-off');
    refreshIcons();
    ctx.inputEl.setAttribute('placeholder', 'Listening...');
  } catch (err) {
    console.error('[STT] Failed to start:', err);
    if (ctx.addSystemMessage) {
      ctx.addSystemMessage('Failed to start voice input: ' + err.message, true);
    }
  }
}

function stopRecording() {
  if (!recording) return;
  recording = false;

  if (recognition) {
    try { recognition.stop(); } catch (e) { /* ignore */ }
    recognition = null;
  }

  sttBtn.classList.remove('stt-active');
  sttBtn.innerHTML = iconHtml('mic');
  refreshIcons();
  ctx.inputEl.setAttribute('placeholder', 'Message Claude Code...');
}

// --- Exports ---
export function isSTTRecording() {
  return recording;
}

export function isSTTInitializing() {
  return false;
}
