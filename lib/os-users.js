// os-users.js — Shared utility for resolving Linux OS user information.
// Used by sdk-bridge.js (worker spawning), terminal-manager.js, and project.js (file ops).

var fs = require("fs");
var path = require("path");
var { execSync } = require("child_process");

/**
 * Resolve Linux user info from username via getent passwd.
 * Returns { uid, gid, home, user, shell } or throws on failure.
 */
function resolveOsUserInfo(username) {
  var output = execSync("getent passwd " + username, { encoding: "utf8", timeout: 5000 }).trim();
  // getent passwd format: username:x:uid:gid:gecos:home:shell
  var parts = output.split(":");
  if (parts.length < 7) throw new Error("Unexpected getent output for user " + username);
  return {
    uid: parseInt(parts[2], 10),
    gid: parseInt(parts[3], 10),
    home: parts[5],
    user: parts[0],
    shell: parts[6] || "/bin/bash",
  };
}

/**
 * Run a file system operation as a specific OS user via a helper subprocess.
 * op: "list", "read", "write", "stat"
 * args: operation-specific arguments
 * osUserInfo: { uid, gid } from resolveOsUserInfo
 * Returns the result object or throws.
 */
function fsAsUser(op, args, osUserInfo) {
  // Build a small inline Node script to run as the target user
  var script;
  if (op === "list") {
    script = [
      "var fs = require('fs');",
      "var p = require('path');",
      "var dir = " + JSON.stringify(args.dir) + ";",
      "var entries = fs.readdirSync(dir, { withFileTypes: true });",
      "var result = [];",
      "for (var i = 0; i < entries.length; i++) {",
      "  var e = entries[i];",
      "  var stat;",
      "  try { stat = fs.statSync(p.join(dir, e.name)); } catch(err) { continue; }",
      "  result.push({ name: e.name, isDir: e.isDirectory(), size: stat.size, mtime: stat.mtimeMs });",
      "}",
      "process.stdout.write(JSON.stringify(result));",
    ].join(" ");
  } else if (op === "read") {
    script = [
      "var fs = require('fs');",
      "var f = " + JSON.stringify(args.file) + ";",
      "var stat = fs.statSync(f);",
      "var result = { size: stat.size };",
      "if (" + JSON.stringify(!!args.readContent) + ") {",
      "  result.content = fs.readFileSync(f, 'utf8');",
      "}",
      "process.stdout.write(JSON.stringify(result));",
    ].join(" ");
  } else if (op === "stat") {
    script = [
      "var fs = require('fs');",
      "var f = " + JSON.stringify(args.file) + ";",
      "var stat = fs.statSync(f);",
      "process.stdout.write(JSON.stringify({ size: stat.size, isDir: stat.isDirectory(), mtime: stat.mtimeMs }));",
    ].join(" ");
  } else if (op === "read_binary") {
    // Read file as base64 for binary content (images, etc.)
    script = [
      "var fs = require('fs');",
      "var f = " + JSON.stringify(args.file) + ";",
      "var buf = fs.readFileSync(f);",
      "process.stdout.write(buf.toString('base64'));",
    ].join(" ");
    var binOutput = execSync(process.execPath + " -e " + JSON.stringify(script), {
      encoding: "utf8",
      timeout: 10000,
      uid: osUserInfo.uid,
      gid: osUserInfo.gid,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { buffer: Buffer.from(binOutput.trim(), "base64") };
  } else if (op === "write") {
    script = [
      "var fs = require('fs');",
      "var f = " + JSON.stringify(args.file) + ";",
      "var content = " + JSON.stringify(args.content || "") + ";",
      "fs.writeFileSync(f, content, 'utf8');",
      "process.stdout.write(JSON.stringify({ ok: true }));",
    ].join(" ");
  } else {
    throw new Error("Unknown fsAsUser operation: " + op);
  }

  var output = execSync(process.execPath + " -e " + JSON.stringify(script), {
    encoding: "utf8",
    timeout: 10000,
    uid: osUserInfo.uid,
    gid: osUserInfo.gid,
  });

  return JSON.parse(output.trim());
}

/**
 * Detect the Linux distribution family for package manager guidance.
 * Returns "debian", "rhel", "alpine", "suse", "arch", or "unknown".
 */
function detectDistroFamily() {
  try {
    var release = fs.readFileSync("/etc/os-release", "utf8");
    var idLike = "";
    var id = "";
    var lines = release.split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("ID_LIKE=") === 0) idLike = lines[i].substring(8).replace(/"/g, "").toLowerCase();
      if (lines[i].indexOf("ID=") === 0 && lines[i].indexOf("ID_LIKE=") !== 0) id = lines[i].substring(3).replace(/"/g, "").toLowerCase();
    }
    var all = id + " " + idLike;
    if (all.indexOf("debian") !== -1 || all.indexOf("ubuntu") !== -1) return "debian";
    if (all.indexOf("rhel") !== -1 || all.indexOf("centos") !== -1 || all.indexOf("fedora") !== -1 || all.indexOf("amzn") !== -1 || all.indexOf("amazon") !== -1) return "rhel";
    if (all.indexOf("alpine") !== -1) return "alpine";
    if (all.indexOf("suse") !== -1 || all.indexOf("opensuse") !== -1) return "suse";
    if (all.indexOf("arch") !== -1 || all.indexOf("manjaro") !== -1) return "arch";
    return "unknown";
  } catch (e) {
    return "unknown";
  }
}

/**
 * Build a user-friendly install command for the ACL package based on distro.
 */
function getAclInstallCommand() {
  var distro = detectDistroFamily();
  switch (distro) {
    case "debian": return "sudo apt install -y acl";
    case "rhel": return "sudo yum install -y acl";
    case "alpine": return "sudo apk add acl";
    case "suse": return "sudo zypper install -y acl";
    case "arch": return "sudo pacman -S --noconfirm acl";
    default: return "Install the 'acl' package using your distribution's package manager (apt, yum, apk, etc.)";
  }
}

/**
 * Check if setfacl is available on the system.
 * Returns { available: true } or { available: false, installCmd: "..." }.
 */
function checkAclSupport() {
  try {
    execSync("which setfacl", { encoding: "utf8", timeout: 5000, stdio: "pipe" });
    return { available: true };
  } catch (e) {
    return { available: false, installCmd: getAclInstallCommand() };
  }
}

/**
 * Check if a path is a user's home directory (e.g. /home/chad, /root).
 * Running recursive setfacl on a home dir is dangerous and slow.
 */
function isHomeDirectory(dirPath) {
  var resolved = path.resolve(dirPath);
  // /root
  if (resolved === "/root") return true;
  // /home/username (exactly two levels)
  var parts = resolved.split("/");
  if (parts.length === 3 && parts[0] === "" && parts[1] === "home" && parts[2]) return true;
  return false;
}

/**
 * Grant a Linux user ACL access (rwX) to a project directory.
 * Uses setfacl to add recursive + default ACL entries.
 * Skips home directories to avoid slow recursive ACL on large trees.
 */
function grantProjectAccess(projectPath, linuxUser) {
  if (isHomeDirectory(projectPath)) {
    console.log("[os-users] Skipping ACL for home directory: " + projectPath);
    return;
  }
  try {
    // Recursive ACL for existing files
    execSync("setfacl -R -m u:" + linuxUser + ":rwX " + JSON.stringify(projectPath), {
      encoding: "utf8",
      timeout: 30000,
    });
    // Default ACL so new files also inherit access
    execSync("setfacl -R -d -m u:" + linuxUser + ":rwX " + JSON.stringify(projectPath), {
      encoding: "utf8",
      timeout: 30000,
    });
    console.log("[os-users] Granted ACL access for " + linuxUser + " on " + projectPath);
  } catch (e) {
    var errMsg = (e.stderr || e.message || "").toString();
    if (errMsg.indexOf("not found") !== -1 || errMsg.indexOf("ENOENT") !== -1) {
      var cmd = getAclInstallCommand();
      console.error("[os-users] setfacl is not installed. ACL support is required for OS user isolation.");
      console.error("[os-users] Install it with: " + cmd);
    } else {
      console.error("[os-users] Failed to grant ACL access for " + linuxUser + " on " + projectPath + ": " + errMsg);
    }
  }
}

/**
 * Revoke a Linux user's ACL access from a project directory.
 */
function revokeProjectAccess(projectPath, linuxUser) {
  if (isHomeDirectory(projectPath)) {
    console.log("[os-users] Skipping ACL revoke for home directory: " + projectPath);
    return;
  }
  try {
    execSync("setfacl -R -x u:" + linuxUser + " " + JSON.stringify(projectPath), {
      encoding: "utf8",
      timeout: 30000,
    });
    execSync("setfacl -R -d -x u:" + linuxUser + " " + JSON.stringify(projectPath), {
      encoding: "utf8",
      timeout: 30000,
    });
    console.log("[os-users] Revoked ACL access for " + linuxUser + " on " + projectPath);
  } catch (e) {
    var errMsg = (e.stderr || e.message || "").toString();
    if (errMsg.indexOf("not found") !== -1 || errMsg.indexOf("ENOENT") !== -1) {
      var cmd = getAclInstallCommand();
      console.error("[os-users] setfacl is not installed. ACL support is required for OS user isolation.");
      console.error("[os-users] Install it with: " + cmd);
    } else {
      console.error("[os-users] Failed to revoke ACL access for " + linuxUser + " on " + projectPath + ": " + errMsg);
    }
  }
}

/**
 * Sanitize a Clay username into a valid Linux username.
 * Prefixes with "clay-", lowercases, replaces invalid chars with hyphens.
 * Linux usernames: start with [a-z_], then [a-z0-9_-], max 32 chars.
 */
function toLinuxUsername(clayUsername) {
  var sanitized = clayUsername.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  // Remove leading hyphens/digits after prefix
  sanitized = sanitized.replace(/^[-0-9]+/, "");
  if (!sanitized) sanitized = "user";
  var name = "clay-" + sanitized;
  // Truncate to 32 chars (Linux limit)
  if (name.length > 32) name = name.substring(0, 32);
  // Remove trailing hyphens
  name = name.replace(/-+$/, "");
  return name;
}

/**
 * Ensure linger is enabled for a Linux user so systemd creates /run/user/<uid>.
 * Required for CLI tools like gcloud and gh that need XDG_RUNTIME_DIR.
 */
function ensureLinger(username) {
  try {
    var uid = execSync("id -u " + username, { encoding: "utf8", timeout: 5000, stdio: "pipe" }).trim();
    var lingerFile = "/var/lib/systemd/linger/" + username;
    if (fs.existsSync(lingerFile)) return;
    execSync("loginctl enable-linger " + username, {
      encoding: "utf8",
      timeout: 10000,
      stdio: "pipe",
    });
    console.log("[os-users] Enabled linger for " + username + " (uid " + uid + ")");
  } catch (e) {
    console.warn("[os-users] Failed to enable linger for " + username + ": " + (e.stderr || e.message || "").trim());
  }
}

/**
 * Check if a Linux user already exists.
 */
function linuxUserExists(username) {
  try {
    execSync("id " + username, { encoding: "utf8", timeout: 5000, stdio: "pipe" });
    return true;
  } catch (e) {
    return false;
  }
}

function getLinuxUserHome(username) {
  try {
    var line = execSync("getent passwd " + username, { encoding: "utf8", timeout: 5000, stdio: "pipe" }).trim();
    var parts = line.split(":");
    return parts[5] || "/home/" + username;
  } catch (e) {
    return "/home/" + username;
  }
}

function getLinuxUserUid(username) {
  try {
    var uid = execSync("id -u " + username, { encoding: "utf8", timeout: 5000, stdio: "pipe" }).trim();
    return parseInt(uid, 10);
  } catch (e) {
    return null;
  }
}

/**
 * Install Claude CLI for a Linux user account.
 * Downloads and runs the install script, then ensures PATH is configured.
 * Non-fatal: logs errors but does not throw.
 */
function installClaudeCli(linuxName) {
  try {
    // Download and run the Claude CLI install script as the target user
    execSync(
      "su - " + linuxName + " -c \"curl -fsSL https://claude.ai/install.sh | bash\"",
      { encoding: "utf8", timeout: 60000, stdio: "pipe" }
    );
    console.log("[os-users] Claude CLI installed for " + linuxName);
  } catch (e) {
    var msg = (e.stderr || e.message || "").trim();
    console.error("[os-users] Failed to install Claude CLI for " + linuxName + ": " + msg);
    return;
  }

  // Append PATH export to the user's shell config if not already present
  try {
    var home = "/home/" + linuxName;
    var rcFile;
    if (fs.existsSync(home + "/.zshrc")) {
      rcFile = "~/.zshrc";
    } else {
      rcFile = "~/.bashrc";
    }

    // Check if PATH export is already present before appending
    var checkCmd = "su - " + linuxName + " -c \"grep -qF '/.local/bin' " + rcFile + "\"";
    try {
      execSync(checkCmd, { encoding: "utf8", timeout: 5000, stdio: "pipe" });
      console.log("[os-users] PATH already configured in " + rcFile + " for " + linuxName);
    } catch (grepErr) {
      // grep returned non-zero, meaning the line is not present; append it
      var appendCmd = "su - " + linuxName + " -c 'echo \"export PATH=\\\"\\$HOME/.local/bin:\\$PATH\\\"\" >> " + rcFile + "'";
      execSync(appendCmd, { encoding: "utf8", timeout: 5000, stdio: "pipe" });
      console.log("[os-users] PATH export appended to " + rcFile + " for " + linuxName);
    }
  } catch (e) {
    var rcMsg = (e.stderr || e.message || "").trim();
    console.error("[os-users] Failed to configure PATH for " + linuxName + ": " + rcMsg);
  }
}

/**
 * Provision a Linux user account for a Clay user.
 * Creates the account via useradd with a home directory.
 * Returns { ok: true, linuxUser: "clay-xxx" } or { error: "..." }.
 */
function provisionLinuxUser(clayUsername) {
  var linuxName = toLinuxUsername(clayUsername);

  // Handle name collisions by appending a number
  if (linuxUserExists(linuxName)) {
    // Check if this is a clay-managed user (reuse it)
    // Otherwise find an available name
    console.log("[os-users] Linux user " + linuxName + " already exists, reusing.");
    return { ok: true, linuxUser: linuxName };
  }

  try {
    execSync("useradd -m -s /bin/bash " + linuxName, {
      encoding: "utf8",
      timeout: 15000,
      stdio: "pipe",
    });
    ensureLinger(linuxName);
    console.log("[os-users] Provisioned Linux user: " + linuxName + " (Clay user: " + clayUsername + ")");
    installClaudeCli(linuxName);
    return { ok: true, linuxUser: linuxName };
  } catch (e) {
    var msg = (e.stderr || e.message || "").trim();
    console.error("[os-users] Failed to provision Linux user " + linuxName + ": " + msg);
    return { error: "Failed to create Linux user " + linuxName + ": " + msg };
  }
}

/**
 * Provision Linux accounts for all Clay users that don't have one yet.
 * usersModule: the users.js module (getAllUsers, updateLinuxUser, etc.)
 * Returns { provisioned: [...], skipped: [...], errors: [...] }.
 */
function provisionAllUsers(usersModule) {
  var users = usersModule.getAllUsers();
  var result = { provisioned: [], skipped: [], errors: [] };

  for (var i = 0; i < users.length; i++) {
    var user = users[i];
    if (user.linuxUser) {
      // Already mapped, verify the Linux user still exists
      if (linuxUserExists(user.linuxUser)) {
        // Ensure Claude CLI is installed for existing users
        var cliPath = "/home/" + user.linuxUser + "/.local/bin/claude";
        if (!fs.existsSync(cliPath)) {
          console.log("[os-users] Claude CLI missing for " + user.linuxUser + ", installing...");
          installClaudeCli(user.linuxUser);
        }
        // Ensure linger is enabled for existing users
        ensureLinger(user.linuxUser);
        result.skipped.push({ id: user.id, username: user.username, linuxUser: user.linuxUser });
        continue;
      }
      // Linux user was deleted externally, re-provision
      console.log("[os-users] Linux user " + user.linuxUser + " no longer exists, re-provisioning for " + user.username);
    }

    var provision = provisionLinuxUser(user.username);
    if (provision.ok) {
      // Update the Clay user record with the Linux username
      var data = usersModule.loadUsers();
      for (var j = 0; j < data.users.length; j++) {
        if (data.users[j].id === user.id) {
          data.users[j].linuxUser = provision.linuxUser;
          usersModule.saveUsers(data);
          break;
        }
      }
      result.provisioned.push({ id: user.id, username: user.username, linuxUser: provision.linuxUser });
    } else {
      result.errors.push({ id: user.id, username: user.username, error: provision.error });
    }
  }

  return result;
}

/**
 * Grant ACL access on a project directory to ALL Clay users with linuxUser mappings.
 * Used when a project becomes public.
 * usersModule: the users.js module (getAllUsers, etc.)
 */
function grantAllUsersAccess(projectPath, usersModule) {
  var allUsers = usersModule.getAllUsers();
  for (var i = 0; i < allUsers.length; i++) {
    if (allUsers[i].linuxUser) {
      grantProjectAccess(projectPath, allUsers[i].linuxUser);
    }
  }
}

/**
 * Deactivate (lock) a Linux user account.
 * The account and home directory are preserved, but login is disabled.
 */
function deactivateLinuxUser(linuxUsername) {
  try {
    execSync("usermod -L " + linuxUsername, { encoding: "utf8", timeout: 5000, stdio: "pipe" });
    console.log("[os-users] Deactivated Linux user: " + linuxUsername);
    return { ok: true };
  } catch (e) {
    var msg = (e.stderr || e.message || "").trim();
    console.error("[os-users] Failed to deactivate Linux user " + linuxUsername + ": " + msg);
    return { error: "Failed to deactivate Linux user " + linuxUsername + ": " + msg };
  }
}

/**
 * Ensure the shared projects directory exists.
 */
function ensureProjectsDir() {
  var dir = "/var/clay/projects";
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o711 });
  } else {
    // Tighten permissions if directory already exists (prevent listing by other users)
    try { fs.chmodSync(dir, 0o711); } catch (e) {}
  }
}

module.exports = {
  checkAclSupport: checkAclSupport,
  resolveOsUserInfo: resolveOsUserInfo,
  fsAsUser: fsAsUser,
  grantProjectAccess: grantProjectAccess,
  revokeProjectAccess: revokeProjectAccess,
  toLinuxUsername: toLinuxUsername,
  linuxUserExists: linuxUserExists,
  provisionLinuxUser: provisionLinuxUser,
  provisionAllUsers: provisionAllUsers,
  grantAllUsersAccess: grantAllUsersAccess,
  installClaudeCli: installClaudeCli,
  deactivateLinuxUser: deactivateLinuxUser,
  ensureProjectsDir: ensureProjectsDir,
  isHomeDirectory: isHomeDirectory,
  getLinuxUserHome: getLinuxUserHome,
  getLinuxUserUid: getLinuxUserUid,
};
