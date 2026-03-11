// Whisper WASM Web Worker
// Loads whisper.cpp Emscripten build and runs inference off main thread
// Requires COOP/COEP headers for SharedArrayBuffer

var instance = null;
var printBuffer = [];

// Shared output function — Emscripten captures this once at load time,
// so we must always push to the SAME array reference
function captureOutput(text) {
  printBuffer.push(text);
}

// --- Message handler ---
self.onmessage = function(e) {
  var msg = e.data;

  if (msg.type === 'init') {
    initWhisper(msg.mainJsUrl, msg.modelData);
  } else if (msg.type === 'transcribe') {
    transcribe(msg.audio, msg.lang, msg.nthreads, msg.tailDuration);
  }
};

// --- Init: load WASM engine + model ---
function initWhisper(mainJsUrl, modelData) {
  try {
    // Set up Module before importScripts
    // BOTH print and printErr use same function (whisper sends timestamps to stderr)
    self.Module = {
      print: captureOutput,
      printErr: captureOutput,
      setStatus: function() {},
      monitorRunDependencies: function() {},
      mainScriptUrlOrBlob: mainJsUrl
    };

    self.postMessage({ type: 'status', text: 'Loading Whisper engine...' });
    importScripts(mainJsUrl);
  } catch (err) {
    self.postMessage({ type: 'error', error: 'Failed to load Whisper WASM: ' + err.message });
    return;
  }

  // Poll for Emscripten runtime to be ready (WASM compilation is async)
  var attempts = 0;
  var timer = setInterval(function() {
    attempts++;
    if (Module.init && typeof Module.init === 'function') {
      clearInterval(timer);
      loadModel(modelData);
    } else if (attempts > 200) {
      clearInterval(timer);
      self.postMessage({ type: 'error', error: 'Whisper WASM initialization timed out' });
    }
  }, 50);
}

// --- Store model in WASM FS and init ---
function loadModel(modelData) {
  try {
    self.postMessage({ type: 'status', text: 'Initializing model...' });

    var buf = new Uint8Array(modelData);
    try { Module.FS_unlink('whisper.bin'); } catch (e) { /* ignore */ }
    Module.FS_createDataFile('/', 'whisper.bin', buf, true, true);

    instance = Module.init('whisper.bin');
    if (!instance) {
      self.postMessage({ type: 'error', error: 'Failed to initialize Whisper model' });
      return;
    }

    // Clear init output
    printBuffer.length = 0;
    self.postMessage({ type: 'ready' });
  } catch (err) {
    self.postMessage({ type: 'error', error: 'Model init failed: ' + err.message });
  }
}

// --- Run inference ---
function transcribe(audio, lang, nthreads, tailDuration) {
  if (!instance) {
    self.postMessage({ type: 'error', error: 'Whisper not initialized' });
    return;
  }

  // Clear buffer (keep same array reference — Emscripten captured it)
  printBuffer.length = 0;

  try {
    Module.full_default(instance, audio, lang || 'en', nthreads || 1, false);
  } catch (err) {
    self.postMessage({ type: 'error', error: 'Transcription failed: ' + err.message });
    return;
  }

  var totalDur = audio.length / 16000;
  self.postMessage({
    type: 'result',
    lines: printBuffer.slice(),
    totalDuration: totalDur,
    tailDuration: tailDuration || 0
  });
}
