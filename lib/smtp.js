var nodemailer = require("nodemailer");
var crypto = require("crypto");

// --- OTP configuration ---
var OTP_EXPIRY_MS = 10 * 60 * 1000;   // 10 minutes
var OTP_MAX_ATTEMPTS = 3;
var OTP_COOLDOWN_MS = 60 * 1000;       // 1 request per minute per email

// --- In-memory OTP store ---
var otpStore = {}; // email → { code, expiresAt, attempts, createdAt }

// --- Transporter cache ---
var transporter = null;

// --- Users module (lazy-loaded to avoid circular deps) ---
var _users = null;
function getUsers() {
  if (!_users) _users = require("./users");
  return _users;
}

// --- SMTP config helpers ---

function getSmtpConfig() {
  var data = getUsers().loadUsers();
  return data.smtp || null;
}

function saveSmtpConfig(config) {
  var data = getUsers().loadUsers();
  data.smtp = config;
  getUsers().saveUsers(data);
  resetTransporter();
}

function isSmtpConfigured() {
  var cfg = getSmtpConfig();
  return !!(cfg && cfg.host && cfg.user && cfg.pass && cfg.from);
}

// --- Transporter management ---

function createTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port || 587,
    secure: !!cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });
}

function getTransporter() {
  if (transporter) return transporter;
  var cfg = getSmtpConfig();
  if (!cfg) return null;
  transporter = createTransporter(cfg);
  return transporter;
}

function resetTransporter() {
  if (transporter) {
    try { transporter.close(); } catch (e) {}
  }
  transporter = null;
}

// --- Test connection ---

function testConnection(cfg) {
  var t = createTransporter(cfg);
  return t.verify().then(function () {
    try { t.close(); } catch (e) {}
    return { ok: true };
  }).catch(function (err) {
    try { t.close(); } catch (e) {}
    return { ok: false, error: err.message || "Connection failed" };
  });
}

function sendTestEmail(cfg, toEmail) {
  var t = createTransporter(cfg);
  return t.sendMail({
    from: cfg.from,
    to: toEmail,
    subject: "Clay SMTP Test",
    html: '<div style="font-family:system-ui,sans-serif;max-width:400px;margin:0 auto;padding:24px">' +
      '<h2 style="color:#DA7756;margin:0 0 16px">Clay</h2>' +
      '<p style="color:#333;margin:0">SMTP is configured correctly. You will receive login codes and invite emails at this address.</p>' +
      '</div>',
  }).then(function (info) {
    try { t.close(); } catch (e) {}
    return { ok: true, messageId: info.messageId };
  }).catch(function (err) {
    try { t.close(); } catch (e) {}
    throw err;
  });
}

// --- Send email ---

function sendMail(to, subject, html) {
  var t = getTransporter();
  if (!t) return Promise.reject(new Error("SMTP not configured"));
  var cfg = getSmtpConfig();
  return t.sendMail({
    from: cfg.from,
    to: to,
    subject: subject,
    html: html,
  });
}

// --- OTP generation and verification ---

function generateOtp() {
  var bytes = crypto.randomBytes(3);
  var num = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1000000;
  return String(num).padStart(6, "0");
}

function requestOtp(email) {
  var key = email.toLowerCase();
  var existing = otpStore[key];
  if (existing && (Date.now() - existing.createdAt) < OTP_COOLDOWN_MS) {
    var wait = Math.ceil((OTP_COOLDOWN_MS - (Date.now() - existing.createdAt)) / 1000);
    return { error: "Please wait " + wait + " seconds before requesting a new code", retryAfter: wait };
  }
  var code = generateOtp();
  otpStore[key] = {
    code: code,
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
    createdAt: Date.now(),
  };
  return { ok: true, code: code };
}

function verifyOtp(email, code) {
  var key = email.toLowerCase();
  var entry = otpStore[key];
  if (!entry) return { valid: false, error: "No code requested" };
  if (Date.now() > entry.expiresAt) {
    delete otpStore[key];
    return { valid: false, error: "Code expired" };
  }
  entry.attempts++;
  if (entry.attempts > OTP_MAX_ATTEMPTS) {
    delete otpStore[key];
    return { valid: false, error: "Too many attempts" };
  }
  // Timing-safe comparison
  var a = Buffer.from(entry.code);
  var b = Buffer.from(String(code).padStart(6, "0"));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    var left = OTP_MAX_ATTEMPTS - entry.attempts;
    return { valid: false, error: "Invalid code", attemptsLeft: left };
  }
  delete otpStore[key];
  return { valid: true };
}

// --- Email templates ---

function sendOtpEmail(email, code) {
  var subject = "Your Clay login code: " + code;
  var html = '<div style="font-family:system-ui,sans-serif;max-width:400px;margin:0 auto;padding:24px">' +
    '<h2 style="color:#DA7756;margin:0 0 16px">Clay</h2>' +
    '<p style="color:#333;margin:0 0 16px">Your verification code is:</p>' +
    '<div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0;text-align:center;' +
    'background:#f5f5f5;border-radius:8px;color:#333;font-family:monospace">' + code + '</div>' +
    '<p style="color:#999;font-size:13px;margin:16px 0 0">This code expires in 10 minutes. If you didn\'t request this, you can ignore this email.</p>' +
    '</div>';
  return sendMail(email, subject, html);
}

function sendInviteEmail(email, inviteUrl, inviterName) {
  var subject = "You've been invited to Clay";
  var html = '<div style="font-family:system-ui,sans-serif;max-width:400px;margin:0 auto;padding:24px">' +
    '<h2 style="color:#DA7756;margin:0 0 16px">Clay</h2>' +
    '<p style="color:#333;margin:0 0 16px">' + (inviterName || "An admin") + ' has invited you to join Clay.</p>' +
    '<p style="margin:0 0 16px"><a href="' + inviteUrl + '" style="display:inline-block;padding:12px 24px;' +
    'background:#DA7756;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Accept Invite</a></p>' +
    '<p style="color:#999;font-size:13px;margin:0">This invite link expires in 24 hours.</p>' +
    '</div>';
  return sendMail(email, subject, html);
}

// --- Cleanup expired OTPs ---

setInterval(function () {
  var now = Date.now();
  var keys = Object.keys(otpStore);
  for (var i = 0; i < keys.length; i++) {
    if (now > otpStore[keys[i]].expiresAt) {
      delete otpStore[keys[i]];
    }
  }
}, 60000);

module.exports = {
  getSmtpConfig: getSmtpConfig,
  saveSmtpConfig: saveSmtpConfig,
  isSmtpConfigured: isSmtpConfigured,
  testConnection: testConnection,
  sendTestEmail: sendTestEmail,
  sendMail: sendMail,
  resetTransporter: resetTransporter,
  generateOtp: generateOtp,
  requestOtp: requestOtp,
  verifyOtp: verifyOtp,
  sendOtpEmail: sendOtpEmail,
  sendInviteEmail: sendInviteEmail,
};
