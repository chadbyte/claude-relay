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
  claudeMd += TEAM_SECTION;
  claudeMd += SESSION_MEMORY_SECTION;
  claudeMd += crisisSafety.getSection();
  fs.writeFileSync(path.join(mateDir, "CLAUDE.md"), claudeMd);

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
    // Find the nearest following system marker (session memory or crisis safety)
    var nextMarkerIdx = -1;
    var memIdx = afterTeam.indexOf(SESSION_MEMORY_MARKER);
    var crisisIdx = afterTeam.indexOf(crisisSafety.MARKER);
    if (memIdx !== -1 && (crisisIdx === -1 || memIdx < crisisIdx)) {
      nextMarkerIdx = memIdx;
    } else if (crisisIdx !== -1) {
      nextMarkerIdx = crisisIdx;
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

  // Insert before session memory or crisis safety section if present, otherwise append
  var sessionMemPos = content.indexOf(SESSION_MEMORY_MARKER);
  var crisisPos = content.indexOf(crisisSafety.MARKER);
  var insertBefore = -1;
  if (sessionMemPos !== -1) {
    insertBefore = sessionMemPos;
  } else if (crisisPos !== -1) {
    insertBefore = crisisPos;
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
    var crisisIdx = afterMem.indexOf(crisisSafety.MARKER);
    var existing;
    if (crisisIdx !== -1) {
      existing = afterMem.substring(0, crisisIdx).trimEnd();
    } else {
      existing = afterMem.trimEnd();
    }
    if (existing === SESSION_MEMORY_SECTION.trimStart().trimEnd()) return false; // already correct

    // Strip the existing session memory section
    var endOfMem = crisisIdx !== -1 ? memIdx + crisisIdx : content.length;
    content = content.substring(0, memIdx).trimEnd() + content.substring(endOfMem);
  }

  // Insert before crisis safety section if present, otherwise append
  var crisisPos = content.indexOf(crisisSafety.MARKER);
  if (crisisPos !== -1) {
    content = content.substring(0, crisisPos).trimEnd() + SESSION_MEMORY_SECTION + "\n\n" + content.substring(crisisPos);
  } else {
    content = content.trimEnd() + SESSION_MEMORY_SECTION;
  }

  fs.writeFileSync(filePath, content, "utf8");
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
  enforceSessionMemory: enforceSessionMemory,
  SESSION_MEMORY_MARKER: SESSION_MEMORY_MARKER,
  loadCommonKnowledge: loadCommonKnowledge,
  promoteKnowledge: promoteKnowledge,
  depromoteKnowledge: depromoteKnowledge,
  getCommonKnowledgeForMate: getCommonKnowledgeForMate,
  readCommonKnowledgeFile: readCommonKnowledgeFile,
  isPromoted: isPromoted,
};
