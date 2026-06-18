// Runtime fetch of the *.d.clay.studio wildcard certificate.
//
// Clay serves browser-trusted HTTPS for local instances via a Let's Encrypt
// wildcard cert for *.d.clay.studio. Historically that cert was baked into the
// npm package (lib/certs/), so every ~90 days the shipped copy expired and all
// installed clients silently dropped to HTTP until a new release. This module
// fetches the CURRENT cert from a small endpoint (served off the same VM that
// auto-renews it) and caches it under ~/.clay/certs, decoupling cert freshness
// from npm releases. The baked cert remains a fallback for offline starts.
//
// The wildcard private key is public by design: every client needs it to
// terminate TLS for its own <dashed-ip>.d.clay.studio hostname. This is the
// same trade-off sslip.io-style zero-config HTTPS already accepts, so fetching
// it at runtime exposes nothing that the npm tarball did not already.

var fs = require("fs");
var path = require("path");
var https = require("https");
var { execFileSync } = require("child_process");
var { REAL_HOME } = require("./config");

var DEFAULT_URL = "https://cert.d.clay.studio/clay-cert.json";
var EXPIRY_SKEW_MS = 7 * 24 * 60 * 60 * 1000;

function certUrl() {
  return process.env.CLAY_CERT_URL || DEFAULT_URL;
}

function cacheDir() {
  var home = process.env.CLAY_HOME || process.env.CLAUDE_RELAY_HOME || path.join(REAL_HOME, ".clay");
  return path.join(home, "certs");
}

function fullchainPath() { return path.join(cacheDir(), "clay-studio-fullchain.pem"); }
function privkeyPath() { return path.join(cacheDir(), "clay-studio-privkey.pem"); }

// notAfter (ms) of a PEM file, or 0 if it can't be read.
function certExpiryMs(certPath) {
  try {
    var out = execFileSync("openssl", ["x509", "-in", certPath, "-noout", "-enddate"], { encoding: "utf8" });
    var m = out.match(/notAfter=(.+)/);
    if (m) return new Date(m[1]).getTime();
  } catch (e) {}
  return 0;
}

// Returns { key, cert } cached file paths if a previously-fetched cert exists
// and is not expiring within 7 days; otherwise null. Synchronous.
function cachedCertFiles() {
  var cert = fullchainPath();
  var key = privkeyPath();
  if (!fs.existsSync(cert) || !fs.existsSync(key)) return null;
  var expiry = certExpiryMs(cert);
  if (expiry && expiry - Date.now() < EXPIRY_SKEW_MS) return null;
  return { key: key, cert: cert };
}

function isPem(s) {
  return typeof s === "string" && s.indexOf("-----BEGIN") !== -1;
}

// Best-effort fetch of the current cert from the endpoint, written atomically
// to the cache. Resolves true on success, false on any failure. Never rejects,
// so callers can `await` it unconditionally on startup.
function refreshCache(timeoutMs) {
  return new Promise(function (resolve) {
    var done = false;
    function finish(ok) { if (!done) { done = true; resolve(ok); } }
    var req;
    try {
      req = https.get(certUrl(), { timeout: timeoutMs || 5000 }, function (res) {
        if (res.statusCode !== 200) { res.resume(); return finish(false); }
        var body = "";
        res.setEncoding("utf8");
        res.on("data", function (c) {
          body += c;
          if (body.length > 1024 * 1024) { req.destroy(); finish(false); }
        });
        res.on("end", function () {
          try {
            var obj = JSON.parse(body);
            if (!isPem(obj.fullchain) || !isPem(obj.privkey)) return finish(false);
            var dir = cacheDir();
            fs.mkdirSync(dir, { recursive: true });
            var ctmp = fullchainPath() + ".tmp";
            var ktmp = privkeyPath() + ".tmp";
            fs.writeFileSync(ctmp, obj.fullchain);
            fs.writeFileSync(ktmp, obj.privkey);
            try { fs.chmodSync(ktmp, 0o600); } catch (e) {}
            // Don't overwrite a good cache with a near-expired cert.
            var expiry = certExpiryMs(ctmp);
            if (expiry && expiry - Date.now() < EXPIRY_SKEW_MS) {
              try { fs.unlinkSync(ctmp); fs.unlinkSync(ktmp); } catch (e) {}
              return finish(false);
            }
            fs.renameSync(ctmp, fullchainPath());
            fs.renameSync(ktmp, privkeyPath());
            finish(true);
          } catch (e) { finish(false); }
        });
      });
      req.on("timeout", function () { req.destroy(); finish(false); });
      req.on("error", function () { finish(false); });
    } catch (e) { finish(false); }
  });
}

module.exports = {
  certUrl: certUrl,
  cachedCertFiles: cachedCertFiles,
  refreshCache: refreshCache,
};
