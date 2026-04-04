var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var config = require("./config");

var crisisSafety = require("./crisis-safety");

// --- Path resolution ---

function resolveMatesRoot(ctx) {
  // OS-users mode: per-linuxUser home directory
  if (ctx && ctx.linuxUser) {
    return path.join("/home", ctx.linuxUser, ".clay", "mates");
  }
  // Multi-user mode: per-userId subdirectory
  if (ctx && ctx.multiUser && ctx.userId) {
    return path.join(config.CONFIG_DIR, "mates", ctx.userId);
  }
  // Single-user mode: flat directory
  return path.join(config.CONFIG_DIR, "mates");
}

function buildMateCtx(userId) {
  if (!userId) return { userId: null, multiUser: false, linuxUser: null };
  // Lazy require to avoid circular dependency
  var users = require("./users");
  var multiUser = users.isMultiUser();
  var linuxUser = null;
  if (multiUser && userId) {
    var user = users.findUserById(userId);
    if (user && user.linuxUser) {
      linuxUser = user.linuxUser;
    }
  }
  return { userId: userId, multiUser: multiUser, linuxUser: linuxUser };
}

function isMateIdFormat(id) {
  if (!id) return false;
  return typeof id === "string" && id.indexOf("mate_") === 0;
}

// --- Default data ---

function defaultData() {
  return { mates: [] };
}

// --- Load / Save ---

function matesFilePath(ctx) {
  return path.join(resolveMatesRoot(ctx), "mates.json");
}

function loadMates(ctx) {
  try {
    var raw = fs.readFileSync(matesFilePath(ctx), "utf8");
    var data = JSON.parse(raw);
    if (!data.mates) data.mates = [];
    return data;
  } catch (e) {
    return defaultData();
  }
}

function saveMates(ctx, data) {
  var filePath = matesFilePath(ctx);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  var tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

// --- CRUD ---

function generateMateId() {
  return "mate_" + crypto.randomUUID();
}

function createMate(ctx, seedData) {
  var data = loadMates(ctx);
  var id = generateMateId();
  var userId = ctx ? ctx.userId : null;

  // Pick a random avatar color from a pleasant palette
  var colors = ["#6c5ce7", "#00b894", "#e17055", "#0984e3", "#fdcb6e", "#e84393", "#00cec9", "#ff7675"];
  var colorIdx = crypto.randomBytes(1)[0] % colors.length;

  var mate = {
    id: id,
    name: null,
    createdBy: userId,
    createdAt: Date.now(),
    seedData: seedData || {},
    profile: {
      displayName: null,
      avatarColor: colors[colorIdx],
      avatarStyle: "bottts",
      avatarSeed: crypto.randomBytes(4).toString("hex"),
    },
    bio: null,
    status: "interviewing",
    interviewProjectPath: null,
  };

  data.mates.push(mate);
  saveMates(ctx, data);

  // Create the mate's identity directory
  var mateDir = getMateDir(ctx, id);
  fs.mkdirSync(mateDir, { recursive: true });

  // Write initial mate.yaml
  var yaml = "# Mate metadata\n";
  yaml += "id: " + id + "\n";
  yaml += "name: null\n";
  yaml += "status: interviewing\n";
  yaml += "createdBy: " + userId + "\n";
  yaml += "createdAt: " + mate.createdAt + "\n";
  yaml += "relationship: " + (seedData.relationship || "assistant") + "\n";
  yaml += "activities: " + JSON.stringify(seedData.activity || []) + "\n";
  yaml += "autonomy: " + (seedData.autonomy || "always_ask") + "\n";
  fs.writeFileSync(path.join(mateDir, "mate.yaml"), yaml);

  // Write initial CLAUDE.md (will be replaced by interview)
  var claudeMd = "# Mate Identity\n\n";
  claudeMd += "This mate is currently being interviewed. Identity will be generated after the interview.\n\n";
  claudeMd += "## Seed Data\n\n";
  claudeMd += "- Relationship: " + (seedData.relationship || "assistant") + "\n";
  if (seedData.activity && seedData.activity.length > 0) {
    claudeMd += "- Activities: " + seedData.activity.join(", ") + "\n";
  }
  if (seedData.communicationStyle && seedData.communicationStyle.length > 0) {
    claudeMd += "- Communication: " + seedData.communicationStyle.join(", ") + "\n";
  }
  claudeMd += "- Autonomy: " + (seedData.autonomy || "always_ask") + "\n";
  var initialIdentity = claudeMd.trimEnd();
  claudeMd += TEAM_SECTION;
  claudeMd += SESSION_MEMORY_SECTION;
  claudeMd += crisisSafety.getSection();
  fs.writeFileSync(path.join(mateDir, "CLAUDE.md"), claudeMd);

  // Log creation (identity is placeholder, will be replaced by interview)
  logIdentityChange(mateDir, "create_custom", initialIdentity, "");

  return mate;
}

function getMate(ctx, id) {
  var data = loadMates(ctx);
  for (var i = 0; i < data.mates.length; i++) {
    if (data.mates[i].id === id) return data.mates[i];
  }
  return null;
}

function updateMate(ctx, id, updates) {
  var data = loadMates(ctx);
  for (var i = 0; i < data.mates.length; i++) {
    if (data.mates[i].id === id) {
      var keys = Object.keys(updates);
      for (var j = 0; j < keys.length; j++) {
        data.mates[i][keys[j]] = updates[keys[j]];
      }
      saveMates(ctx, data);
      return data.mates[i];
    }
  }
  return null;
}

function deleteMate(ctx, id) {
  var data = loadMates(ctx);
  var before = data.mates.length;
  data.mates = data.mates.filter(function (m) {
    return m.id !== id;
  });
  if (data.mates.length === before) return { error: "Mate not found" };
  saveMates(ctx, data);

  // Remove mate directory
  var mateDir = getMateDir(ctx, id);
  try {
    fs.rmSync(mateDir, { recursive: true, force: true });
  } catch (e) {
    // Directory may not exist
  }

  return { ok: true };
}

function getAllMates(ctx) {
  var data = loadMates(ctx);
  return data.mates;
}

function isMate(ctx, id) {
  if (!id) return false;
  if (typeof id === "string" && id.indexOf("mate_") === 0) {
    // Double check it exists in registry
    return !!getMate(ctx, id);
  }
  return false;
}

function getMateDir(ctx, id) {
  return path.join(resolveMatesRoot(ctx), id);
}

// --- Migration ---

function migrateLegacyMates() {
  var legacyFile = path.join(config.CONFIG_DIR, "mates.json");
  if (!fs.existsSync(legacyFile)) return;

  // Check if already migrated
  var migratedMarker = legacyFile + ".migrated";
  if (fs.existsSync(migratedMarker)) return;

  try {
    var raw = fs.readFileSync(legacyFile, "utf8");
    var data = JSON.parse(raw);
    if (!data.mates || data.mates.length === 0) {
      // Nothing to migrate, just mark as done
      fs.renameSync(legacyFile, migratedMarker);
      return;
    }

    // Group mates by createdBy
    var byUser = {};
    for (var i = 0; i < data.mates.length; i++) {
      var m = data.mates[i];
      var key = m.createdBy || "__null__";
      if (!byUser[key]) byUser[key] = [];
      byUser[key].push(m);
    }

    // Write each user's mates to their own storage path
    var keys = Object.keys(byUser);
    for (var k = 0; k < keys.length; k++) {
      var userId = keys[k] === "__null__" ? null : keys[k];
      var ctx = buildMateCtx(userId);
      var userData = { mates: byUser[keys[k]] };
      saveMates(ctx, userData);

      // Move mate identity directories to new location
      var legacyMatesDir = path.join(config.CONFIG_DIR, "mates");
      var newRoot = resolveMatesRoot(ctx);
      for (var mi = 0; mi < byUser[keys[k]].length; mi++) {
        var mateId = byUser[keys[k]][mi].id;
        var oldDir = path.join(legacyMatesDir, mateId);
        var newDir = path.join(newRoot, mateId);
        if (fs.existsSync(oldDir) && oldDir !== newDir) {
          fs.mkdirSync(path.dirname(newDir), { recursive: true });
          try {
            fs.renameSync(oldDir, newDir);
          } catch (e) {
            // Cross-device or other issue, copy instead
            fs.cpSync(oldDir, newDir, { recursive: true });
            fs.rmSync(oldDir, { recursive: true, force: true });
          }
        }
      }
    }

    // Mark legacy file as migrated
    fs.renameSync(legacyFile, migratedMarker);
    console.log("[mates] Migrated legacy mates.json to per-user storage");
  } catch (e) {
    console.error("[mates] Legacy migration failed:", e.message);
  }
}

// --- Team awareness ---

var TEAM_MARKER = "<!-- TEAM_AWARENESS_MANAGED_BY_SYSTEM -->";

// Static fallback when ctx is unavailable
var TEAM_SECTION =
  "\n\n" + TEAM_MARKER + "\n" +
  "## Your Team\n\n" +
  "**This section is managed by the system and cannot be removed.**\n\n" +
  "You are one of several AI Mates in this workspace. Your teammates and their profiles are listed in `../mates.json`. " +
  "Each teammate's identity and working style is described in their own directory:\n\n" +
  "- `../{mate_id}/CLAUDE.md` — their identity, personality, and working style\n" +
  "- `../{mate_id}/mate.yaml` — their metadata (name, role, status, activities)\n" +
  "- `../common-knowledge.json` — shared knowledge registry; files listed here are readable by all mates\n\n" +
  "Check the team registry when it would be relevant to know who else is available or what they do. " +
  "You cannot message other Mates directly yet, but knowing your team helps you work with the user more effectively.\n";

/**
 * Build a dynamic team section with current mate roster.
 * Lists each teammate by stable ID with their current display name, role, and bio.
 * @param {object} ctx - user context for loading mates
 * @param {string} currentMateId - this mate's ID (excluded from the roster)
 * @returns {string} Team section string, or static TEAM_SECTION as fallback
 */
function buildTeamSection(ctx, currentMateId) {
  var data;
  try { data = loadMates(ctx); } catch (e) { return TEAM_SECTION; }
  if (!data || !data.mates || data.mates.length < 2) return TEAM_SECTION;

  var mates = data.mates.filter(function (m) {
    return m.id !== currentMateId && m.status === "ready";
  });
  if (mates.length === 0) return TEAM_SECTION;

  var section = "\n\n" + TEAM_MARKER + "\n" +
    "## Your Team\n\n" +
    "**This section is managed by the system and updated automatically.**\n\n" +
    "You are one of " + (mates.length + 1) + " AI Mates in this workspace. " +
    "Here is your current team roster:\n\n" +
    "| Name | ID | Bio |\n" +
    "|------|-----|-----|\n";

  for (var i = 0; i < mates.length; i++) {
    var m = mates[i];
    var name = (m.profile && m.profile.displayName) || m.name || "Unnamed";
    var bio = (m.bio || "").replace(/\|/g, "/").replace(/\n/g, " ");
    if (bio.length > 120) bio = bio.substring(0, 117) + "...";
    section += "| " + name + " | `" + m.id + "` | " + bio + " |\n";
  }

  section += "\n" +
    "Each teammate's full identity is in their own directory:\n\n" +
    "- `../{mate_id}/CLAUDE.md` -- identity, personality, working style\n" +
    "- `../{mate_id}/mate.yaml` -- metadata (name, role, status, activities)\n" +
    "- `../common-knowledge.json` -- shared knowledge readable by all mates\n\n" +
    "Use the **ID** (not the name) when referencing teammates in structured data. " +
    "Names can change, IDs are permanent.\n";

  return section;
}

// --- Project registry ---

var PROJECT_REGISTRY_MARKER = "<!-- PROJECT_REGISTRY_MANAGED_BY_SYSTEM -->";

function buildProjectRegistrySection(projects) {
  if (!projects || projects.length === 0) return "";
  var section = "\n\n" + PROJECT_REGISTRY_MARKER + "\n" +
    "## Available Projects\n\n" +
    "**This section is managed by the system and cannot be removed.**\n\n" +
    "The following projects are registered in this workspace. " +
    "Use this information when the user references a project by name, " +
    "so you do not need to ask for the path.\n\n" +
    "| Project | Path |\n" +
    "|---------|------|\n";
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    var name = (p.icon ? p.icon + " " : "") + (p.title || p.slug || path.basename(p.path));
    section += "| " + name + " | `" + p.path + "` |\n";
  }
  return section;
}

/**
 * Enforce the project registry section on a mate's CLAUDE.md.
 * Inserts after team awareness section and before session memory section.
 * Pass the current project list; if empty, removes the section.
 * Returns true if the file was modified.
 */
function enforceProjectRegistry(filePath, projects) {
  if (!fs.existsSync(filePath)) return false;

  var content = fs.readFileSync(filePath, "utf8");
  var newSection = buildProjectRegistrySection(projects);

  // Strip existing section if present
  var markerIdx = content.indexOf(PROJECT_REGISTRY_MARKER);
  if (markerIdx !== -1) {
    var afterMarker = content.substring(markerIdx);
    // Find next system marker
    var nextIdx = -1;
    var candidates = [SESSION_MEMORY_MARKER, STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
    for (var c = 0; c < candidates.length; c++) {
      var ci = afterMarker.indexOf(candidates[c]);
      if (ci !== -1 && (nextIdx === -1 || ci < nextIdx)) nextIdx = ci;
    }

    if (nextIdx !== -1) {
      var existing = afterMarker.substring(0, nextIdx).trimEnd();
      if (existing === newSection.trimStart().trimEnd()) return false; // already correct
      content = content.substring(0, markerIdx).trimEnd() + content.substring(markerIdx + nextIdx);
    } else {
      var existing = afterMarker.trimEnd();
      if (existing === newSection.trimStart().trimEnd()) return false;
      content = content.substring(0, markerIdx).trimEnd();
    }
  }

  // If no projects, just remove the section (already done above)
  if (!newSection) {
    if (markerIdx !== -1) {
      fs.writeFileSync(filePath, content, "utf8");
      return true;
    }
    return false;
  }

  // Insert before session memory, sticky notes, debate, or crisis safety
  var insertBefore = -1;
  var insertCandidates = [SESSION_MEMORY_MARKER, STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
  for (var ic = 0; ic < insertCandidates.length; ic++) {
    var pos = content.indexOf(insertCandidates[ic]);
    if (pos !== -1) { insertBefore = pos; break; }
  }
  if (insertBefore !== -1) {
    content = content.substring(0, insertBefore).trimEnd() + newSection + "\n\n" + content.substring(insertBefore);
  } else {
    content = content.trimEnd() + newSection;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

function hasTeamSection(content) {
  return content.indexOf(TEAM_MARKER) !== -1;
}

/**
 * Enforce the team awareness section on a mate's CLAUDE.md.
 * Inserts before the crisis safety section (if present), or appends at the end.
 * Returns true if the file was modified.
 */
function enforceTeamAwareness(filePath) {
  if (!fs.existsSync(filePath)) return false;

  var content = fs.readFileSync(filePath, "utf8");

  // Check if already present and correct
  var teamIdx = content.indexOf(TEAM_MARKER);
  if (teamIdx !== -1) {
    // Extract existing team section (up to next system marker or end)
    var afterTeam = content.substring(teamIdx);
    // Find the nearest following system marker (project registry, session memory, or crisis safety)
    var nextMarkerIdx = -1;
    var projIdx = afterTeam.indexOf(PROJECT_REGISTRY_MARKER);
    var memIdx = afterTeam.indexOf(SESSION_MEMORY_MARKER);
    var crisisIdx = afterTeam.indexOf(crisisSafety.MARKER);
    var teamNextCandidates = [projIdx, memIdx, crisisIdx];
    for (var tn = 0; tn < teamNextCandidates.length; tn++) {
      if (teamNextCandidates[tn] !== -1 && (nextMarkerIdx === -1 || teamNextCandidates[tn] < nextMarkerIdx)) {
        nextMarkerIdx = teamNextCandidates[tn];
      }
    }
    var existing;
    if (nextMarkerIdx !== -1) {
      existing = afterTeam.substring(0, nextMarkerIdx).trimEnd();
    } else {
      existing = afterTeam.trimEnd();
    }
    if (existing === TEAM_SECTION.trimStart().trimEnd()) return false; // already correct

    // Strip the existing team section
    var endOfTeam = nextMarkerIdx !== -1 ? teamIdx + nextMarkerIdx : content.length;
    content = content.substring(0, teamIdx).trimEnd() + content.substring(endOfTeam);
  }

  // Insert before the first subsequent system section (in order)
  var insertBefore = -1;
  var teamInsertCandidates = [PROJECT_REGISTRY_MARKER, SESSION_MEMORY_MARKER, STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
  for (var ti = 0; ti < teamInsertCandidates.length; ti++) {
    var tip = content.indexOf(teamInsertCandidates[ti]);
    if (tip !== -1) { insertBefore = tip; break; }
  }
  if (insertBefore !== -1) {
    content = content.substring(0, insertBefore).trimEnd() + TEAM_SECTION + "\n\n" + content.substring(insertBefore);
  } else {
    content = content.trimEnd() + TEAM_SECTION;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

// --- Session memory ---

var SESSION_MEMORY_MARKER = "<!-- SESSION_MEMORY_MANAGED_BY_SYSTEM -->";

var SESSION_MEMORY_SECTION =
  "\n\n" + SESSION_MEMORY_MARKER + "\n" +
  "## Session Memory\n\n" +
  "**This section is managed by the system and cannot be removed.**\n\n" +
  "Your `knowledge/memory-summary.md` file contains your compressed long-term memory, " +
  "automatically maintained across sessions. Refer to it for context about past " +
  "interactions, decisions, and patterns.\n\n" +
  "Your `knowledge/session-digests.jsonl` file contains raw session logs as an archive. " +
  "You do not need to read it routinely. Only access it when you need to look up " +
  "specific details from a past session that are not in the summary.\n";

function hasSessionMemory(content) {
  return content.indexOf(SESSION_MEMORY_MARKER) !== -1;
}

/**
 * Enforce the session memory section on a mate's CLAUDE.md.
 * Inserts after team awareness section and before crisis safety section.
 * Returns true if the file was modified.
 */
function enforceSessionMemory(filePath) {
  if (!fs.existsSync(filePath)) return false;

  var content = fs.readFileSync(filePath, "utf8");

  // Check if already present and correct
  var memIdx = content.indexOf(SESSION_MEMORY_MARKER);
  if (memIdx !== -1) {
    // Extract existing section (up to next system marker or end)
    var afterMem = content.substring(memIdx);
    var nextMemIdx = -1;
    var memNextCandidates = [STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
    for (var mn = 0; mn < memNextCandidates.length; mn++) {
      var mni = afterMem.indexOf(memNextCandidates[mn]);
      if (mni !== -1 && (nextMemIdx === -1 || mni < nextMemIdx)) nextMemIdx = mni;
    }
    var existing;
    if (nextMemIdx !== -1) {
      existing = afterMem.substring(0, nextMemIdx).trimEnd();
    } else {
      existing = afterMem.trimEnd();
    }
    if (existing === SESSION_MEMORY_SECTION.trimStart().trimEnd()) return false; // already correct

    // Strip the existing session memory section
    var endOfMem = nextMemIdx !== -1 ? memIdx + nextMemIdx : content.length;
    content = content.substring(0, memIdx).trimEnd() + content.substring(endOfMem);
  }

  // Insert before sticky notes, debate, or crisis safety section if present, otherwise append
  var memInsertBefore = -1;
  var memInsertCandidates = [STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
  for (var mi = 0; mi < memInsertCandidates.length; mi++) {
    var mip = content.indexOf(memInsertCandidates[mi]);
    if (mip !== -1) { memInsertBefore = mip; break; }
  }
  if (memInsertBefore !== -1) {
    content = content.substring(0, memInsertBefore).trimEnd() + SESSION_MEMORY_SECTION + "\n\n" + content.substring(memInsertBefore);
  } else {
    content = content.trimEnd() + SESSION_MEMORY_SECTION;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

// --- Sticky notes pointer in CLAUDE.md ---

var STICKY_NOTES_MARKER = "<!-- STICKY_NOTES_MANAGED_BY_SYSTEM -->";

var STICKY_NOTES_SECTION =
  "\n\n" + STICKY_NOTES_MARKER + "\n" +
  "## Sticky Notes\n\n" +
  "**This section is managed by the system and cannot be removed.**\n\n" +
  "Your `knowledge/sticky-notes.md` file contains sticky notes left by the user. " +
  "Read this file when starting a conversation for important context. " +
  "These notes are read-only. You cannot create, update, or delete them.\n";

function hasStickyNotesSection(content) {
  return content.indexOf(STICKY_NOTES_MARKER) !== -1;
}

/**
 * Enforce the sticky notes pointer section in a mate's CLAUDE.md.
 * Inserts after session memory and before crisis safety.
 * Returns true if the file was modified.
 */
function enforceStickyNotes(filePath) {
  if (!fs.existsSync(filePath)) return false;

  var content = fs.readFileSync(filePath, "utf8");

  var markerIdx = content.indexOf(STICKY_NOTES_MARKER);
  if (markerIdx !== -1) {
    var afterMarker = content.substring(markerIdx);
    var stickyNextIdx = -1;
    var stickyNextCandidates = [DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
    for (var sn = 0; sn < stickyNextCandidates.length; sn++) {
      var sni = afterMarker.indexOf(stickyNextCandidates[sn]);
      if (sni !== -1 && (stickyNextIdx === -1 || sni < stickyNextIdx)) stickyNextIdx = sni;
    }
    var existing;
    if (stickyNextIdx !== -1) {
      existing = afterMarker.substring(0, stickyNextIdx).trimEnd();
    } else {
      existing = afterMarker.trimEnd();
    }
    if (existing === STICKY_NOTES_SECTION.trimStart().trimEnd()) return false;

    var endOfSection = stickyNextIdx !== -1 ? markerIdx + stickyNextIdx : content.length;
    content = content.substring(0, markerIdx).trimEnd() + content.substring(endOfSection);
  }

  var stickyInsertBefore = -1;
  var stickyInsertCandidates = [DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];
  for (var si = 0; si < stickyInsertCandidates.length; si++) {
    var sip = content.indexOf(stickyInsertCandidates[si]);
    if (sip !== -1) { stickyInsertBefore = sip; break; }
  }
  if (stickyInsertBefore !== -1) {
    content = content.substring(0, stickyInsertBefore).trimEnd() + STICKY_NOTES_SECTION + "\n\n" + content.substring(stickyInsertBefore);
  } else {
    content = content.trimEnd() + STICKY_NOTES_SECTION;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

// --- Debate awareness ---

var DEBATE_AWARENESS_MARKER = "<!-- DEBATE_AWARENESS_MANAGED_BY_SYSTEM -->";

var DEBATE_AWARENESS_SECTION =
  "\n\n" + DEBATE_AWARENESS_MARKER + "\n" +
  "## Proposing Debates\n\n" +
  "**This section is managed by the system and cannot be removed.**\n\n" +
  "When the user suggests that a topic would benefit from a multi-perspective debate " +
  "(e.g., \"let's debate this\", \"I want to hear different viewpoints\"), you can propose " +
  "a structured debate by writing a brief file.\n\n" +
  "**How to propose a debate:**\n" +
  "1. Generate a unique ID: `debate_` followed by the current timestamp in milliseconds\n" +
  "2. Write the brief as JSON to: `.clay/debates/<debate_id>/brief.json` (relative to the project root)\n" +
  "3. The system will detect the file and show the user an inline card with your proposal\n" +
  "4. The user can then approve or cancel the debate\n\n" +
  "**Brief JSON schema:**\n" +
  "```json\n" +
  "{\n" +
  "  \"topic\": \"The refined debate topic\",\n" +
  "  \"format\": \"free_discussion\",\n" +
  "  \"context\": \"Key context from the conversation that panelists should know\",\n" +
  "  \"specialRequests\": \"Any special instructions, or null\",\n" +
  "  \"panelists\": [\n" +
  "    {\n" +
  "      \"mateId\": \"<mate UUID from the team roster above>\",\n" +
  "      \"role\": \"The perspective or stance this panelist should take\",\n" +
  "      \"brief\": \"Specific guidance for this panelist\"\n" +
  "    }\n" +
  "  ]\n" +
  "}\n" +
  "```\n\n" +
  "**Rules:**\n" +
  "- Choose 2-4 panelists from the team roster. Pick mates whose expertise fits the topic.\n" +
  "- Do NOT include yourself as a panelist. You will moderate the debate.\n" +
  "- Only propose a debate when the user explicitly asks for one.\n" +
  "- Make sure the directory exists before writing (use mkdir -p or equivalent).\n";

function enforceDebateAwareness(filePath) {
  if (!fs.existsSync(filePath)) return false;

  var content = fs.readFileSync(filePath, "utf8");

  var markerIdx = content.indexOf(DEBATE_AWARENESS_MARKER);
  if (markerIdx !== -1) {
    var afterMarker = content.substring(markerIdx);
    var crisisIdx = afterMarker.indexOf(crisisSafety.MARKER);
    var existing;
    if (crisisIdx !== -1) {
      existing = afterMarker.substring(0, crisisIdx).trimEnd();
    } else {
      existing = afterMarker.trimEnd();
    }
    if (existing === DEBATE_AWARENESS_SECTION.trimStart().trimEnd()) return false;

    var endOfSection = crisisIdx !== -1 ? markerIdx + crisisIdx : content.length;
    content = content.substring(0, markerIdx).trimEnd() + content.substring(endOfSection);
  }

  var crisisPos = content.indexOf(crisisSafety.MARKER);
  if (crisisPos !== -1) {
    content = content.substring(0, crisisPos).trimEnd() + DEBATE_AWARENESS_SECTION + "\n\n" + content.substring(crisisPos);
  } else {
    content = content.trimEnd() + DEBATE_AWARENESS_SECTION;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

// --- Atomic enforce: single read/write for all system sections ---

var ALL_SYSTEM_MARKERS = [TEAM_MARKER, PROJECT_REGISTRY_MARKER, SESSION_MEMORY_MARKER, STICKY_NOTES_MARKER, DEBATE_AWARENESS_MARKER, crisisSafety.MARKER];

// Minimum identity length (chars) to consider it "real" content
var IDENTITY_MIN_LENGTH = 50;

/**
 * Extract identity content from a CLAUDE.md string.
 * Identity is everything before the first system marker.
 */
function extractIdentity(content) {
  var earliest = -1;
  for (var i = 0; i < ALL_SYSTEM_MARKERS.length; i++) {
    var idx = content.indexOf(ALL_SYSTEM_MARKERS[i]);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
    }
  }
  // Also check for bare "## Crisis Safety" heading as fallback
  var crisisHeading = content.indexOf("\n## Crisis Safety");
  if (crisisHeading !== -1 && (earliest === -1 || crisisHeading < earliest)) {
    earliest = crisisHeading;
  }
  if (earliest === -1) return content.trimEnd();
  return content.substring(0, earliest).trimEnd();
}

/**
 * Strip all system sections from CLAUDE.md content, returning only identity.
 */
function stripAllSystemSections(content) {
  return extractIdentity(content);
}

/**
 * Save an identity backup to knowledge/identity-backup.md.
 * Only overwrites if the new identity is substantive.
 */
function backupIdentity(mateDir, identity) {
  if (!identity || identity.length < IDENTITY_MIN_LENGTH) return false;
  var knDir = path.join(mateDir, "knowledge");
  try { fs.mkdirSync(knDir, { recursive: true }); } catch (e) {}
  var backupPath = path.join(knDir, "identity-backup.md");
  fs.writeFileSync(backupPath, identity, "utf8");
  return true;
}

/**
 * Load identity backup from knowledge/identity-backup.md.
 * Returns null if no backup exists or backup is empty.
 */
function loadIdentityBackup(mateDir) {
  var backupPath = path.join(mateDir, "knowledge", "identity-backup.md");
  try {
    var content = fs.readFileSync(backupPath, "utf8");
    if (content && content.length >= IDENTITY_MIN_LENGTH) return content;
  } catch (e) {}
  return null;
}

/**
 * Log an identity change to knowledge/identity-history.jsonl.
 */
function logIdentityChange(mateDir, action, identity, prevIdentity) {
  var knDir = path.join(mateDir, "knowledge");
  try { fs.mkdirSync(knDir, { recursive: true }); } catch (e) {}
  var historyPath = path.join(knDir, "identity-history.jsonl");
  var entry = {
    ts: Date.now(),
    date: new Date().toISOString(),
    action: action,
    lengthChars: identity ? identity.length : 0,
    prevLengthChars: prevIdentity ? prevIdentity.length : 0,
    hash: crypto.createHash("sha256").update(identity || "").digest("hex").substring(0, 16),
    preview: (identity || "").substring(0, 200)
  };
  try {
    fs.appendFileSync(historyPath, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {}
}

// Tracks paths we've already warned about missing identity (avoids log spam)
var _warnedPaths = {};

/**
 * Atomic enforce: read CLAUDE.md once, enforce all system sections, write once.
 * Includes identity backup, validation, and change tracking.
 * Returns true if the file was modified, false if already correct.
 * @param {string} filePath - path to CLAUDE.md
 * @param {object} opts - optional { ctx, mateId } for dynamic team section
 */
function enforceAllSections(filePath, opts) {
  if (!fs.existsSync(filePath)) return false;
  opts = opts || {};

  var content = fs.readFileSync(filePath, "utf8");
  var mateDir = path.dirname(filePath);

  // 1. Extract current identity (everything before system markers)
  var identity = extractIdentity(content);
  var identityMissing = !identity || identity.length < IDENTITY_MIN_LENGTH;

  // 2. If identity is empty or suspiciously short, try to restore from backup
  if (identityMissing) {
    var backup = loadIdentityBackup(mateDir);
    if (backup) {
      console.log("[mates] Restoring identity from backup: " + filePath + " (" + backup.length + " chars)");
      identity = backup;
      logIdentityChange(mateDir, "restore_from_backup", identity, "");
      identityMissing = false;
    }
  }

  // 3. Backup identity if it's substantive
  backupIdentity(mateDir, identity);

  // 4. Rebuild the full file: identity + all system sections in order
  //    Use dynamic team section when ctx is available, static fallback otherwise
  var teamSection = (opts.ctx && opts.mateId) ? buildTeamSection(opts.ctx, opts.mateId) : TEAM_SECTION;
  var rebuilt = (identity || "").trimEnd();
  rebuilt += teamSection;
  rebuilt += SESSION_MEMORY_SECTION;
  rebuilt += STICKY_NOTES_SECTION;
  rebuilt += DEBATE_AWARENESS_SECTION;
  rebuilt += crisisSafety.getSection();

  // 5. Only write if content actually changed
  if (rebuilt === content) return false;

  // 6. Warn about missing identity only once per path, and only when actually writing
  if (identityMissing && !_warnedPaths[filePath]) {
    _warnedPaths[filePath] = true;
    console.log("[mates] WARNING: Identity missing in " + filePath + " and no backup available");
  }

  // 7. Track identity changes (compare stripped versions)
  var prevIdentity = stripAllSystemSections(content);
  if (identity !== prevIdentity) {
    logIdentityChange(mateDir, "enforce", identity, prevIdentity);
  }

  fs.writeFileSync(filePath, rebuilt, "utf8");
  return true;
}

// --- Common knowledge registry ---

function commonKnowledgePath(ctx) {
  return path.join(resolveMatesRoot(ctx), "common-knowledge.json");
}

function loadCommonKnowledge(ctx) {
  try {
    var raw = fs.readFileSync(commonKnowledgePath(ctx), "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveCommonKnowledge(ctx, entries) {
  var filePath = commonKnowledgePath(ctx);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  var tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function promoteKnowledge(ctx, mateId, mateName, fileName) {
  var entries = loadCommonKnowledge(ctx);
  // Check if already promoted (same mateId + name)
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].mateId === mateId && entries[i].name === fileName) {
      return entries; // already promoted
    }
  }
  entries.push({
    name: fileName,
    mateId: mateId,
    mateName: mateName || null,
    promotedAt: Date.now()
  });
  saveCommonKnowledge(ctx, entries);
  return entries;
}

function depromoteKnowledge(ctx, mateId, fileName) {
  var entries = loadCommonKnowledge(ctx);
  entries = entries.filter(function (e) {
    return !(e.mateId === mateId && e.name === fileName);
  });
  saveCommonKnowledge(ctx, entries);
  return entries;
}

function getCommonKnowledgeForMate(ctx, mateId) {
  var entries = loadCommonKnowledge(ctx);
  var root = resolveMatesRoot(ctx);
  var result = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var filePath = path.join(root, e.mateId, "knowledge", e.name);
    try {
      var stat = fs.statSync(filePath);
      result.push({
        name: e.name,
        size: stat.size,
        mtime: stat.mtimeMs,
        common: true,
        ownMateId: e.mateId,
        ownerName: e.mateName
      });
    } catch (err) {
      // Source file deleted, skip (could clean up registry but not critical)
    }
  }
  return result;
}

function readCommonKnowledgeFile(ctx, mateId, fileName) {
  var root = resolveMatesRoot(ctx);
  var filePath = path.join(root, mateId, "knowledge", path.basename(fileName));
  return fs.readFileSync(filePath, "utf8");
}

function isPromoted(ctx, mateId, fileName) {
  var entries = loadCommonKnowledge(ctx);
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].mateId === mateId && entries[i].name === fileName) return true;
  }
  return false;
}

// Format seed data as a human-readable context string
function formatSeedContext(seedData) {
  if (!seedData) return "";
  var parts = [];

  if (seedData.relationship) {
    parts.push("The user wants a " + seedData.relationship + " relationship.");
  }

  if (seedData.activity && seedData.activity.length > 0) {
    parts.push("Primary activities: " + seedData.activity.join(", ") + ".");
  }

  if (seedData.communicationStyle && seedData.communicationStyle.length > 0) {
    var styleLabels = {
      direct_concise: "direct and concise",
      soft_detailed: "soft and detailed",
      witty: "witty",
      encouraging: "encouraging",
      formal: "formal",
      no_nonsense: "no-nonsense",
    };
    var styles = seedData.communicationStyle.map(function (s) { return styleLabels[s] || s.replace(/_/g, " "); });
    parts.push("Communication style: " + styles.join(", ") + ".");
  }

  if (seedData.autonomy) {
    var autonomyLabels = {
      always_ask: "Always ask before acting",
      minor_stuff_ok: "Handle minor stuff without asking",
      mostly_autonomous: "Mostly autonomous, ask for big decisions",
      fully_autonomous: "Fully autonomous",
    };
    parts.push("Autonomy: " + (autonomyLabels[seedData.autonomy] || seedData.autonomy) + ".");
  }

  return parts.join(" ");
}

// --- Built-in mates ---

function createBuiltinMate(ctx, builtinKey) {
  var builtinMates = require("./builtin-mates");
  var def = builtinMates.getBuiltinByKey(builtinKey);
  if (!def) throw new Error("Unknown built-in mate key: " + builtinKey);

  var data = loadMates(ctx);
  var id = generateMateId();
  var userId = ctx ? ctx.userId : null;

  var mate = {
    id: id,
    builtinKey: builtinKey,
    name: def.displayName,
    createdBy: userId,
    createdAt: Date.now(),
    seedData: def.seedData,
    profile: {
      displayName: def.displayName,
      avatarColor: def.avatarColor,
      avatarStyle: def.avatarStyle,
      avatarSeed: def.avatarCustom ? crypto.randomBytes(4).toString("hex") : def.displayName,
      avatarCustom: def.avatarCustom || "",
      avatarLocked: !!def.avatarLocked,
    },
    bio: def.bio,
    status: "ready",
    globalSearch: !!def.globalSearch,
    interviewProjectPath: null,
  };

  data.mates.push(mate);
  saveMates(ctx, data);

  // Create the mate's identity directory
  var mateDir = getMateDir(ctx, id);
  fs.mkdirSync(mateDir, { recursive: true });

  // Create knowledge directory
  fs.mkdirSync(path.join(mateDir, "knowledge"), { recursive: true });

  // Write mate.yaml
  var seedData = def.seedData;
  var yaml = "# Mate metadata\n";
  yaml += "id: " + id + "\n";
  yaml += "name: " + def.displayName + "\n";
  yaml += "status: ready\n";
  yaml += "builtinKey: " + builtinKey + "\n";
  yaml += "createdBy: " + userId + "\n";
  yaml += "createdAt: " + mate.createdAt + "\n";
  yaml += "relationship: " + (seedData.relationship || "assistant") + "\n";
  yaml += "activities: " + JSON.stringify(seedData.activity || []) + "\n";
  yaml += "autonomy: " + (seedData.autonomy || "always_ask") + "\n";
  fs.writeFileSync(path.join(mateDir, "mate.yaml"), yaml);

  // Write CLAUDE.md with full template + system sections
  var claudeMd = def.getClaudeMd();
  var builtinIdentity = claudeMd.trimEnd();
  claudeMd += TEAM_SECTION;
  claudeMd += SESSION_MEMORY_SECTION;
  claudeMd += STICKY_NOTES_SECTION;
  claudeMd += DEBATE_AWARENESS_SECTION;
  claudeMd += crisisSafety.getSection();
  fs.writeFileSync(path.join(mateDir, "CLAUDE.md"), claudeMd);

  // Backup identity and log creation
  backupIdentity(mateDir, builtinIdentity);
  logIdentityChange(mateDir, "create_builtin", builtinIdentity, "");

  return mate;
}

function getInstalledBuiltinKeys(ctx) {
  var data = loadMates(ctx);
  var keys = [];
  for (var i = 0; i < data.mates.length; i++) {
    if (data.mates[i].builtinKey) {
      keys.push(data.mates[i].builtinKey);
    }
  }
  return keys;
}

function getMissingBuiltinKeys(ctx) {
  var builtinMates = require("./builtin-mates");
  var allKeys = builtinMates.getBuiltinKeys();
  var installed = getInstalledBuiltinKeys(ctx);
  var missing = [];
  for (var i = 0; i < allKeys.length; i++) {
    if (installed.indexOf(allKeys[i]) === -1) {
      missing.push(allKeys[i]);
    }
  }
  return missing;
}

function ensureBuiltinMates(ctx, deletedKeys) {
  var missing = getMissingBuiltinKeys(ctx);
  var excluded = deletedKeys || [];
  var created = [];
  for (var i = 0; i < missing.length; i++) {
    if (excluded.indexOf(missing[i]) === -1) {
      created.push(createBuiltinMate(ctx, missing[i]));
    }
  }
  return created;
}

/**
 * Sync primary mates (globalSearch: true, e.g. Ally) with their latest definition.
 * Updates metadata (bio, globalSearch, profile) and CLAUDE.md identity on every startup.
 * Other builtin mates are NOT touched (users may have customized them).
 * Returns array of synced mate IDs.
 */
function syncPrimaryMates(ctx) {
  var builtinMates = require("./builtin-mates");
  var data = loadMates(ctx);
  var synced = [];

  for (var i = 0; i < data.mates.length; i++) {
    var mate = data.mates[i];
    if (!mate.builtinKey) continue;

    var def = builtinMates.getBuiltinByKey(mate.builtinKey);
    if (!def || !def.globalSearch) continue; // only primary mates

    var changed = false;

    // Sync metadata fields from definition
    if (mate.bio !== def.bio) { mate.bio = def.bio; changed = true; }
    if (mate.globalSearch !== true) { mate.globalSearch = true; changed = true; }
    if (mate.name !== def.displayName) { mate.name = def.displayName; changed = true; }
    if (mate.profile) {
      if (mate.profile.displayName !== def.displayName) { mate.profile.displayName = def.displayName; changed = true; }
      if (def.avatarCustom && mate.profile.avatarCustom !== def.avatarCustom && !mate.profile.avatarLocked) {
        mate.profile.avatarCustom = def.avatarCustom; changed = true;
      }
    }

    // Sync CLAUDE.md identity from template
    var mateDir = getMateDir(ctx, mate.id);
    var claudePath = path.join(mateDir, "CLAUDE.md");
    var latestIdentity = def.getClaudeMd();

    try {
      if (fs.existsSync(claudePath)) {
        var currentContent = fs.readFileSync(claudePath, "utf8");
        var currentIdentity = extractIdentity(currentContent);

        if (currentIdentity !== latestIdentity.trimEnd()) {
          // Identity template changed, update it
          var rebuilt = latestIdentity.trimEnd();
          // Preserve system sections by re-running enforceAllSections after write
          rebuilt += TEAM_SECTION; // placeholder, enforceAllSections will rebuild
          rebuilt += SESSION_MEMORY_SECTION;
          rebuilt += STICKY_NOTES_SECTION;
          rebuilt += DEBATE_AWARENESS_SECTION;
          rebuilt += crisisSafety.getSection();
          fs.writeFileSync(claudePath, rebuilt, "utf8");
          backupIdentity(mateDir, latestIdentity.trimEnd());
          logIdentityChange(mateDir, "sync_primary", latestIdentity.trimEnd(), currentIdentity);
          console.log("[mates] Synced primary mate identity: " + mate.name + " (" + mate.id + ")");
          changed = true;
        }
      }
    } catch (e) {
      console.error("[mates] Failed to sync CLAUDE.md for " + mate.id + ":", e.message);
    }

    if (changed) {
      synced.push(mate.id);
    }
  }

  if (synced.length > 0) {
    saveMates(ctx, data);
  }

  return synced;
}

module.exports = {
  resolveMatesRoot: resolveMatesRoot,
  buildMateCtx: buildMateCtx,
  isMateIdFormat: isMateIdFormat,
  loadMates: loadMates,
  saveMates: saveMates,
  createMate: createMate,
  getMate: getMate,
  updateMate: updateMate,
  deleteMate: deleteMate,
  getAllMates: getAllMates,
  isMate: isMate,
  getMateDir: getMateDir,
  migrateLegacyMates: migrateLegacyMates,
  formatSeedContext: formatSeedContext,
  enforceTeamAwareness: enforceTeamAwareness,
  TEAM_MARKER: TEAM_MARKER,
  TEAM_SECTION: TEAM_SECTION,
  enforceSessionMemory: enforceSessionMemory,
  SESSION_MEMORY_MARKER: SESSION_MEMORY_MARKER,
  SESSION_MEMORY_SECTION: SESSION_MEMORY_SECTION,
  loadCommonKnowledge: loadCommonKnowledge,
  promoteKnowledge: promoteKnowledge,
  depromoteKnowledge: depromoteKnowledge,
  getCommonKnowledgeForMate: getCommonKnowledgeForMate,
  readCommonKnowledgeFile: readCommonKnowledgeFile,
  isPromoted: isPromoted,
  enforceStickyNotes: enforceStickyNotes,
  STICKY_NOTES_MARKER: STICKY_NOTES_MARKER,
  STICKY_NOTES_SECTION: STICKY_NOTES_SECTION,
  enforceProjectRegistry: enforceProjectRegistry,
  buildProjectRegistrySection: buildProjectRegistrySection,
  PROJECT_REGISTRY_MARKER: PROJECT_REGISTRY_MARKER,
  enforceDebateAwareness: enforceDebateAwareness,
  DEBATE_AWARENESS_MARKER: DEBATE_AWARENESS_MARKER,
  DEBATE_AWARENESS_SECTION: DEBATE_AWARENESS_SECTION,
  enforceAllSections: enforceAllSections,
  buildTeamSection: buildTeamSection,
  extractIdentity: extractIdentity,
  backupIdentity: backupIdentity,
  loadIdentityBackup: loadIdentityBackup,
  logIdentityChange: logIdentityChange,
  createBuiltinMate: createBuiltinMate,
  getInstalledBuiltinKeys: getInstalledBuiltinKeys,
  getMissingBuiltinKeys: getMissingBuiltinKeys,
  ensureBuiltinMates: ensureBuiltinMates,
  syncPrimaryMates: syncPrimaryMates,
};
