// Named agents — Claude CLI catalog discovery and SDK AgentDefinition lookup.
//
// History: an earlier path (chadbyte/clay#332) registered each chat-enabled
// agent as its own Clay project rooted at ~/.clay/agents/<slug>/, with the
// agent body materialized as that project's CLAUDE.md so Claude CLI's
// project-context loader injected it as the system prompt. That path was
// retired in lr-ea32 once the per-session SDK-`agent`-option path (lr-7db0)
// proved out — sessions now carry an `agentName` and the SDK applies the
// agent identity itself.
//
// What's left here is the catalog + definition surface the picker and the
// SDK bridge need:
//   - listClaudeAgents()        — parse `claude agents` output
//   - resolveAgentSourcePath()  — locate the .md for a catalog entry
//   - discoverAllAgents()       — full non-builtin catalog for the picker
//   - getAgentDefinition(name)  — build the in-band SDK AgentDefinition
//
// This implementation lives only on our fork; we are not pushing it upstream.

var fs = require("fs");
var path = require("path");
var os = require("os");
var { execFileSync } = require("child_process");

var REAL_HOME = process.env.SUDO_USER
  ? path.join("/home", process.env.SUDO_USER)
  : os.homedir();

var AGENTS_SOURCE_DIR = path.join(REAL_HOME, ".claude", "agents");
var PLUGINS_CACHE_DIR = path.join(REAL_HOME, ".claude", "plugins", "cache");

// Minimal frontmatter parser. Reads YAML-ish key/value pairs between leading
// '---' fences. No nesting, no lists — agent frontmatter is flat.
// Returns { meta: {...}, body: "..." } or null if no frontmatter fence.
function parseFrontmatter(raw) {
  if (typeof raw !== "string") return null;
  // Allow optional UTF-8 BOM and leading whitespace before the fence.
  var stripped = raw.replace(/^﻿/, "");
  if (stripped.indexOf("---") !== 0) return { meta: {}, body: stripped };
  var rest = stripped.slice(3);
  // The fence terminator must start a line.
  var endIdx = rest.indexOf("\n---");
  if (endIdx === -1) return { meta: {}, body: stripped };
  var fmText = rest.slice(0, endIdx);
  var afterFence = rest.slice(endIdx + 4); // skip "\n---"
  // Trim a single leading newline after the closing fence.
  if (afterFence.charAt(0) === "\n") afterFence = afterFence.slice(1);
  var meta = {};
  var lines = fmText.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line || /^\s*#/.test(line)) continue;
    var colon = line.indexOf(":");
    if (colon === -1) continue;
    var key = line.slice(0, colon).trim();
    var val = line.slice(colon + 1).trim();
    if (!key) continue;
    // Strip matching surrounding quotes.
    if ((val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
        (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")) {
      val = val.slice(1, -1);
    }
    // Coerce booleans.
    if (val === "true") val = true;
    else if (val === "false") val = false;
    meta[key] = val;
  }
  return { meta: meta, body: afterFence };
}

// Normalize an agent name to a filesystem-safe slug. Keeps lowercase letters,
// numbers, and dashes; collapses everything else.
function slugifyAgentName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// Ask Claude CLI for the canonical agent catalog (user + plugin + built-in
// agents). Output is human-readable text, sectioned. Returns array of
// { name, kind, modelLabel } where kind is "user" | "plugin" | "builtin".
// Plugin agents arrive prefixed like "amos:amos" — we keep both the raw
// label and a parsed agent name.
function listClaudeAgents() {
  var out;
  try {
    out = execFileSync("claude", ["agents", "--setting-sources", "user,project,local"], {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    console.error("[agents] claude agents command failed:", e.message);
    return [];
  }
  var lines = out.split("\n");
  var agents = [];
  var section = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^User agents:/i.test(line)) { section = "user"; continue; }
    if (/^Plugin agents:/i.test(line)) { section = "plugin"; continue; }
    if (/^Built-?in agents:/i.test(line)) { section = "builtin"; continue; }
    if (!section) continue;
    var m = line.match(/^\s+(\S.*?)\s+·\s+(\S+)\s*$/);
    if (!m) continue;
    var label = m[1].trim();
    var modelLabel = m[2].trim();
    // Plugin entries are "<plugin>:<agent>"; user/builtin are bare names.
    var name = label;
    var pluginName = null;
    if (section === "plugin") {
      var parts = label.split(":");
      if (parts.length === 2) { pluginName = parts[0]; name = parts[1]; }
    }
    agents.push({ label: label, name: name, kind: section, modelLabel: modelLabel, pluginName: pluginName });
  }
  return agents;
}

// Resolve an agent entry from `claude agents` to its source .md file.
// Returns the absolute path or null if not found. Built-ins have no .md and
// always return null (we don't surface them as chat sessions).
function resolveAgentSourcePath(agent) {
  if (agent.kind === "user") {
    var p = path.join(AGENTS_SOURCE_DIR, agent.name + ".md");
    if (fs.existsSync(p)) return p;
    return null;
  }
  if (agent.kind === "plugin") {
    // Walk ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/agents/<name>.md
    if (!fs.existsSync(PLUGINS_CACHE_DIR)) return null;
    var marketplaces;
    try { marketplaces = fs.readdirSync(PLUGINS_CACHE_DIR); }
    catch (e) { return null; }
    for (var mi = 0; mi < marketplaces.length; mi++) {
      var marketplaceDir = path.join(PLUGINS_CACHE_DIR, marketplaces[mi]);
      var pluginCandidate = agent.pluginName ? path.join(marketplaceDir, agent.pluginName) : null;
      var pluginDirs = [];
      if (pluginCandidate && fs.existsSync(pluginCandidate)) {
        pluginDirs.push(pluginCandidate);
      } else {
        // Fallback: scan all plugins under this marketplace.
        try {
          var pls = fs.readdirSync(marketplaceDir);
          for (var pi = 0; pi < pls.length; pi++) {
            pluginDirs.push(path.join(marketplaceDir, pls[pi]));
          }
        } catch (e) { /* skip */ }
      }
      for (var pd = 0; pd < pluginDirs.length; pd++) {
        // Each plugin has versioned subdirs.
        var versions;
        try { versions = fs.readdirSync(pluginDirs[pd]); } catch (e) { continue; }
        for (var vi = 0; vi < versions.length; vi++) {
          var candidate = path.join(pluginDirs[pd], versions[vi], "agents", agent.name + ".md");
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    }
    return null;
  }
  // Built-ins: no source file.
  return null;
}

// Discover all non-builtin agents from the Claude CLI catalog. This is the
// catalog surface for the SDK-agent path (lr-7db0): we hand the full list to
// the UI and let the user decide which to favorite (chattable.json), then
// pass the chosen agent name through the SDK `agent` option per session.
//
// Builtins are excluded because they have no source .md (resolved by name
// inside the Claude CLI itself) and the SDK still recognizes them by name —
// callers that want builtins should pass the name through directly.
//
// Returns an array of { name, slug, description, model, sourcePath, kind, pluginName }.
// Body is intentionally NOT loaded here — the SDK applies the agent's system
// prompt itself; we only need metadata for display.
function discoverAllAgents() {
  var found = [];
  var catalog = listClaudeAgents();
  for (var i = 0; i < catalog.length; i++) {
    var entry = catalog[i];
    if (entry.kind === "builtin") continue;
    var sourcePath = resolveAgentSourcePath(entry);
    var description = "";
    var model = entry.modelLabel || "";
    if (sourcePath) {
      try {
        var raw = fs.readFileSync(sourcePath, "utf8");
        var parsed = parseFrontmatter(raw);
        if (parsed) {
          if (parsed.meta.description) description = parsed.meta.description;
          if (parsed.meta.model) model = parsed.meta.model;
        }
      } catch (e) { /* metadata best-effort */ }
    }
    var name = entry.name;
    var slugBase = entry.kind === "plugin" && entry.pluginName
      ? entry.pluginName + "-" + name
      : name;
    var slug = slugifyAgentName(slugBase);
    if (!slug) continue;
    found.push({
      name: name,
      slug: slug,
      description: description,
      model: model,
      sourcePath: sourcePath,
      kind: entry.kind,
      pluginName: entry.pluginName || null,
    });
  }
  return found;
}

// Build an SDK-shaped AgentDefinition from a discovered agent's source .md.
// The Claude SDK's `agent` option only resolves names against the in-band
// `agents` map (or settings.json) — file/plugin discovery via `claude agents`
// is a CLI-side convenience that the SDK does not honor at query time. So
// when we cast a session as a named agent, we must also hand the SDK the
// definition it needs to apply the system prompt, tool restrictions, and
// model.
//
// Returns null if the name can't be resolved (no source file, parse failure)
// — the caller treats null as "agent unknown, fall back to default identity".
function getAgentDefinition(name) {
  if (!name) return null;
  // Re-walk the catalog to find the entry for this name. Cheap; the catalog
  // is short and `claude agents` runs in well under 100ms.
  var catalog = listClaudeAgents();
  var entry = null;
  for (var i = 0; i < catalog.length; i++) {
    if (catalog[i].kind === "builtin") continue;
    if (catalog[i].name === name) { entry = catalog[i]; break; }
  }
  if (!entry) return null;
  var sourcePath = resolveAgentSourcePath(entry);
  if (!sourcePath) return null;
  var raw;
  try { raw = fs.readFileSync(sourcePath, "utf8"); }
  catch (e) {
    console.error("[agents] getAgentDefinition: failed to read " + sourcePath + ":", e.message);
    return null;
  }
  var parsed = parseFrontmatter(raw);
  if (!parsed) return null;
  var meta = parsed.meta || {};
  var def = {
    description: meta.description || "",
    prompt: (parsed.body || "").trim(),
  };
  if (meta.model && meta.model !== "inherit") def.model = meta.model;
  // Frontmatter `tools` is a comma-separated string; SDK wants a string array.
  if (typeof meta.tools === "string" && meta.tools.trim()) {
    var toolsArr = meta.tools.split(",")
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 0; });
    if (toolsArr.length > 0) def.tools = toolsArr;
  }
  if (typeof meta.disallowedTools === "string" && meta.disallowedTools.trim()) {
    var disArr = meta.disallowedTools.split(",")
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 0; });
    if (disArr.length > 0) def.disallowedTools = disArr;
  }
  return def;
}

module.exports = {
  AGENTS_SOURCE_DIR: AGENTS_SOURCE_DIR,
  PLUGINS_CACHE_DIR: PLUGINS_CACHE_DIR,
  parseFrontmatter: parseFrontmatter,
  slugifyAgentName: slugifyAgentName,
  listClaudeAgents: listClaudeAgents,
  resolveAgentSourcePath: resolveAgentSourcePath,
  discoverAllAgents: discoverAllAgents,
  getAgentDefinition: getAgentDefinition,
};
