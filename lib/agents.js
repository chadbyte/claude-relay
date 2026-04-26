// Named agents — surfaces ~/.claude/agents/*.md as first-class Clay sessions.
// Opt-in via `chat: true` frontmatter. Identity is injected by writing the
// agent's body as ~/.clay/agents/<slug>/CLAUDE.md, which Claude CLI loads
// automatically as project context — no SDK fight needed.
//
// See chadbyte/clay#332 for the design. This implementation lives only on
// our fork; we are not pushing the feature upstream.

var fs = require("fs");
var path = require("path");
var os = require("os");
var { execFileSync } = require("child_process");

var REAL_HOME = process.env.SUDO_USER
  ? path.join("/home", process.env.SUDO_USER)
  : os.homedir();

var AGENTS_SOURCE_DIR = path.join(REAL_HOME, ".claude", "agents");
var AGENTS_CLAY_DIR = path.join(REAL_HOME, ".clay", "agents");
var PLUGINS_CACHE_DIR = path.join(REAL_HOME, ".claude", "plugins", "cache");

// Minimal frontmatter parser. Reads YAML-ish key/value pairs between leading
// '---' fences. No nesting, no lists — agent frontmatter is flat.
// Returns { meta: {...}, body: "..." } or null if no frontmatter fence.
function parseFrontmatter(raw) {
  if (typeof raw !== "string") return null;
  // Allow optional UTF-8 BOM and leading whitespace before the fence.
  var stripped = raw.replace(/^\uFEFF/, "");
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

// Discover all chat-enabled agents from the Claude CLI catalog. We delegate
// catalog discovery to `claude agents` so user agents, plugin agents, and
// any future marketplace-installed agents all surface automatically. Each
// entry must opt in via `chat: true` in its frontmatter.
//
// Returns an array of { name, slug, description, model, body, sourcePath, kind }.
// Built-in agents are never chattable in our model and are skipped.
function discoverChatAgents() {
  var found = [];
  var catalog = listClaudeAgents();
  for (var i = 0; i < catalog.length; i++) {
    var entry = catalog[i];
    if (entry.kind === "builtin") continue;
    var sourcePath = resolveAgentSourcePath(entry);
    if (!sourcePath) {
      console.log("[agents] No source .md found for " + entry.kind + " agent: " + entry.label);
      continue;
    }
    var raw;
    try { raw = fs.readFileSync(sourcePath, "utf8"); }
    catch (e) {
      console.error("[agents] Skipping unreadable " + sourcePath + ":", e.message);
      continue;
    }
    var parsed = parseFrontmatter(raw);
    if (!parsed) continue;
    if (parsed.meta.chat !== true) continue;
    var name = parsed.meta.name || entry.name;
    // Plugin slugs include the plugin name to avoid collisions across
    // marketplaces (e.g. two plugins each shipping an "amos" agent).
    var slugBase = entry.kind === "plugin" && entry.pluginName
      ? entry.pluginName + "-" + name
      : name;
    var slug = slugifyAgentName(slugBase);
    if (!slug) {
      console.error("[agents] Skipping " + sourcePath + ": empty slug after normalization");
      continue;
    }
    var homeProject = resolveAgentHomeProject(parsed.meta);
    if ((parsed.meta.home_project || parsed.meta.homeProject || parsed.meta.project || parsed.meta.cwd) && !homeProject) {
      console.warn("[agents] " + entry.label + " declared home_project but it does not resolve to a directory; falling back to default cwd");
    }
    found.push({
      name: name,
      slug: slug,
      description: parsed.meta.description || "",
      model: parsed.meta.model || "",
      body: parsed.body || "",
      sourcePath: sourcePath,
      kind: entry.kind,
      pluginName: entry.pluginName || null,
      homeProject: homeProject,
    });
  }
  return found;
}

// Per-agent working directory. Same pattern as ~/.clay/mates/<id>/.
// This is where the materialized identity CLAUDE.md lives. It is NOT
// necessarily the session cwd — see resolveAgentHomeProject().
function getAgentDir(slug) {
  return path.join(AGENTS_CLAY_DIR, slug);
}

// Resolve an agent's home project directory from its frontmatter. The
// `home_project` field declares which workspace project this agent's
// sessions should run in (so Sentinel can attribute the engram). The
// path may be absolute or relative to REAL_HOME / "/workspace". Returns
// the resolved absolute path if the directory exists, or null otherwise
// (callers fall back to the agent's working dir).
function resolveAgentHomeProject(meta) {
  if (!meta) return null;
  var raw = meta.home_project || meta.homeProject || meta.project || meta.cwd;
  if (!raw || typeof raw !== "string") return null;
  var trimmed = raw.trim();
  if (!trimmed) return null;
  var candidates = [];
  if (path.isAbsolute(trimmed)) {
    candidates.push(trimmed);
  } else {
    candidates.push(path.join("/workspace", trimmed));
    candidates.push(path.join(REAL_HOME, trimmed));
    candidates.push(path.resolve(trimmed));
  }
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    try {
      var st = fs.statSync(c);
      if (st.isDirectory()) return c;
    } catch (e) { /* skip */ }
  }
  return null;
}

// Materialize the agent's body as CLAUDE.md inside its working dir so that
// the Claude CLI's normal project-context loading injects it as the system
// prompt. Idempotent: only rewrites if content changed.
function materializeAgentClaudeMd(agent) {
  var dir = getAgentDir(agent.slug);
  fs.mkdirSync(dir, { recursive: true });
  var target = path.join(dir, "CLAUDE.md");
  var header = "<!-- Auto-generated from " + agent.sourcePath + " -->\n" +
               "<!-- Edits here will be overwritten on Clay restart. -->\n\n";
  var desired = header + (agent.body || "").trim() + "\n";
  var current = null;
  try { current = fs.readFileSync(target, "utf8"); } catch (e) { /* not present */ }
  if (current === desired) return target;
  fs.writeFileSync(target, desired);
  return target;
}

// Slug used for the Clay project entry. Prefixed so it's recognizable
// alongside `mate-<id>` slugs.
function projectSlugFor(agent) {
  return "agent-" + agent.slug;
}

module.exports = {
  AGENTS_SOURCE_DIR: AGENTS_SOURCE_DIR,
  AGENTS_CLAY_DIR: AGENTS_CLAY_DIR,
  PLUGINS_CACHE_DIR: PLUGINS_CACHE_DIR,
  parseFrontmatter: parseFrontmatter,
  slugifyAgentName: slugifyAgentName,
  listClaudeAgents: listClaudeAgents,
  resolveAgentSourcePath: resolveAgentSourcePath,
  discoverChatAgents: discoverChatAgents,
  getAgentDir: getAgentDir,
  resolveAgentHomeProject: resolveAgentHomeProject,
  materializeAgentClaudeMd: materializeAgentClaudeMd,
  projectSlugFor: projectSlugFor,
};
