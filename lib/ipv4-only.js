// ipv4-only.js — Preload script that forces ALL network calls to IPv4.
// Works with both Node built-in https AND undici (used by CLI's Axios).
// Loaded via NODE_OPTIONS="--require /path/to/ipv4-only.js"

// 1. Patch dns.lookup to only return IPv4
var dns = require("dns");
var origLookup = dns.lookup;
dns.lookup = function(hostname, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  if (typeof options === "number") { options = { family: options }; }
  options = options || {};
  options.family = 4;
  return origLookup.call(dns, hostname, options, callback);
};
try { dns.setDefaultResultOrder("ipv4first"); } catch (e) {}

// 2. Disable autoSelectFamily at net level
try {
  var net = require("net");
  if (net.setDefaultAutoSelectFamily) net.setDefaultAutoSelectFamily(false);
} catch (e) {}

// 3. Patch net.connect/net.createConnection to force family:4
var origConnect = net.connect;
var origCreateConnection = net.createConnection;
function patchOpts(args) {
  if (args[0] && typeof args[0] === "object") {
    args[0].family = 4;
    args[0].autoSelectFamily = false;
  }
  return args;
}
net.connect = function() { return origConnect.apply(net, patchOpts(Array.from(arguments))); };
net.createConnection = function() { return origCreateConnection.apply(net, patchOpts(Array.from(arguments))); };

// 4. Patch tls.connect to force family:4 (undici uses tls.connect for HTTPS)
var tls = require("tls");
var origTlsConnect = tls.connect;
tls.connect = function() { return origTlsConnect.apply(tls, patchOpts(Array.from(arguments))); };
