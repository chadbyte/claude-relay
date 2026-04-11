var fs = require("fs");
var path = require("path");

// Split shell command on operators (&&, ||, ;, |) while respecting quotes
// and parentheses. Returns array of command segments.
function splitShellSegments(cmd) {
  var segments = [];
  var current = "";
  var inSingle = false;
  var inDouble = false;
  var parenDepth = 0;
  var i = 0;
  while (i < cmd.length) {
    var ch = cmd[i];

    // Handle escape
    if (ch === "\\" && i + 1 < cmd.length && !inSingle) {
      current += ch + cmd[i + 1];
      i += 2;
      continue;
    }

    // Quote tracking
    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; i++; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; i++; continue; }

    // Inside quotes: no splitting
    if (inSingle || inDouble) { current += ch; i++; continue; }

    // Parentheses/subshell tracking
    if (ch === "(" || ch === "$" && i + 1 < cmd.length && cmd[i + 1] === "(") {
      parenDepth++;
      current += ch;
      i++;
      continue;
    }
    if (ch === ")" && parenDepth > 0) {
      parenDepth--;
      current += ch;
      i++;
      continue;
    }

    // Inside subshell: no splitting
    if (parenDepth > 0) { current += ch; i++; continue; }

    // Check for operators: &&, ||, ;, |
    if (ch === "&" && i + 1 < cmd.length && cmd[i + 1] === "&") {
      segments.push(current);
      current = "";
      i += 2;
      continue;
    }
    if (ch === "|" && i + 1 < cmd.length && cmd[i + 1] === "|") {
      segments.push(current);
      current = "";
      i += 2;
      continue;
    }
    if (ch === "|") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (ch === ";") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }
  if (current) segments.push(current);
  return segments;
}

function attachSkillDiscovery(ctx) {
  var cwd = ctx.cwd;

  function discoverSkillDirs() {
    var skills = {};
    var dirs = [
      path.join(require("./config").REAL_HOME, ".claude", "skills"),
      path.join(cwd, ".claude", "skills"),
    ];
    for (var d = 0; d < dirs.length; d++) {
      var base = dirs[d];
      var entries;
      try {
        entries = fs.readdirSync(base, { withFileTypes: true });
      } catch (e) {
        continue; // directory doesn't exist
      }
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        var skillDir = path.join(base, entry.name);
        var skillMd = path.join(skillDir, "SKILL.md");
        try {
          fs.accessSync(skillMd, fs.constants.R_OK);
          // project skills override global skills with same name
          skills[entry.name] = skillDir;
        } catch (e) {
          // no SKILL.md, skip
        }
      }
    }
    return skills;
  }

  function mergeSkills(sdkSkills, fsSkills) {
    var merged = new Set();
    if (Array.isArray(sdkSkills)) {
      for (var i = 0; i < sdkSkills.length; i++) {
        merged.add(sdkSkills[i]);
      }
    }
    var fsNames = Object.keys(fsSkills);
    for (var i = 0; i < fsNames.length; i++) {
      merged.add(fsNames[i]);
    }
    return merged;
  }

  return { discoverSkillDirs: discoverSkillDirs, mergeSkills: mergeSkills };
}

module.exports = { splitShellSegments: splitShellSegments, attachSkillDiscovery: attachSkillDiscovery };
