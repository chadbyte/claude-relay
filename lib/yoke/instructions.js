// YOKE Instruction Scanner
// ------------------------
// Scans a project directory for vendor-specific instruction files
// (CLAUDE.md, AGENTS.md, .cursorrules, etc.) and merges them into
// a single string that any adapter can inject as context.
//
// Each adapter declares which files its vendor reads natively so
// those are excluded from the merged output (no double-injection).

var fs = require("fs");
var path = require("path");

// Known instruction files in priority order.
// { file: relative path, label: human-readable label }
var KNOWN_FILES = [
  { file: "CLAUDE.md", label: "CLAUDE.md" },
  { file: "AGENTS.md", label: "AGENTS.md" },
  { file: ".cursorrules", label: ".cursorrules" },
  { file: ".github/copilot-instructions.md", label: ".github/copilot-instructions.md" },
  { file: "COPILOT.md", label: "COPILOT.md" },
];

// Files each vendor reads natively (skip these to avoid duplication).
var NATIVE_FILES = {
  claude: ["CLAUDE.md"],
  codex: ["AGENTS.md"],
};

// Scan projectDir for instruction files and return merged text.
// Excludes files the given vendor already reads natively.
//
// Returns "" if no files found (callers can skip injection).
function scanAndMerge(projectDir, vendor) {
  if (!projectDir) return "";

  var exclude = NATIVE_FILES[vendor] || [];
  var sections = [];

  for (var i = 0; i < KNOWN_FILES.length; i++) {
    var entry = KNOWN_FILES[i];
    if (exclude.indexOf(entry.file) !== -1) continue;

    var filePath = path.join(projectDir, entry.file);
    try {
      var content = fs.readFileSync(filePath, "utf8").trim();
      if (content) {
        sections.push("--- Instructions from " + entry.label + " ---\n" + content);
      }
    } catch (e) {
      // File doesn't exist or unreadable, skip.
    }
  }

  return sections.join("\n\n");
}

module.exports = {
  scanAndMerge: scanAndMerge,
  KNOWN_FILES: KNOWN_FILES,
  NATIVE_FILES: NATIVE_FILES,
};
