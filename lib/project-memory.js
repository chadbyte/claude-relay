var fs = require("fs");
var path = require("path");

function attachMemory(ctx) {
  var cwd = ctx.cwd;
  var sm = ctx.sm;
  var sdk = ctx.sdk;
  var sendTo = ctx.sendTo;
  var matesModule = ctx.matesModule;
  var sessionSearch = ctx.sessionSearch;
  var getAllProjectSessions = ctx.getAllProjectSessions;
  var projectOwnerId = ctx.projectOwnerId;
  var handleMessage = ctx.handleMessage;

  function formatRawDigests(rawLines, headerLabel) {
    if (!rawLines || rawLines.length === 0) return "";
    var lines = ["\n\n" + (headerLabel || "Your recent session memories:")];
    for (var i = 0; i < rawLines.length; i++) {
      try {
        var d = JSON.parse(rawLines[i]);
        if (d.type === "debate" && d.my_role) {
          // Debate memories are role-played positions, not genuine opinions
          lines.push("- [" + (d.date || "?") + "] DEBATE (role: " + d.my_role + ") " + (d.topic || "unknown") +
            ": argued " + (d.my_position || "N/A") + " (assigned role, not my actual opinion)" +
            (d.outcome ? " | Outcome: " + d.outcome : "") +
            (d.open_items ? " | Open: " + d.open_items : ""));
        } else {
          lines.push("- [" + (d.date || "?") + "] " + (d.topic || "unknown") + ": " + (d.my_position || "") +
            (d.decisions ? " | Decisions: " + d.decisions : "") +
            (d.open_items ? " | Open: " + d.open_items : ""));
        }
      } catch (e) {}
    }
    return lines.join("\n");
  }

  function loadMateDigests(mateCtx, mateId, query) {
    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");
    var mate = matesModule.getMate(mateCtx, mateId);
    var hasGlobalSearch = mate && mate.globalSearch;

    // Load shared user profile (available to ALL mates)
    var userProfileResult = "";
    try {
      var matesRoot = matesModule.resolveMatesRoot(mateCtx);
      var userProfilePath = path.join(matesRoot, "user-profile.md");
      if (fs.existsSync(userProfilePath)) {
        var profileContent = fs.readFileSync(userProfilePath, "utf8").trim();
        if (profileContent && profileContent.length > 50) {
          userProfileResult = "\n\n" + profileContent;
        }
      }
    } catch (e) {}

    // Check for memory-summary.md first
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");
    var hasSummary = false;
    var summaryContent = "";
    try {
      if (fs.existsSync(summaryFile)) {
        summaryContent = fs.readFileSync(summaryFile, "utf8").trim();
        if (summaryContent) hasSummary = true;
      }
    } catch (e) {}

    // Load raw digests
    var allLines = [];
    var digestFile = path.join(knowledgeDir, "session-digests.jsonl");
    try {
      if (fs.existsSync(digestFile)) {
        allLines = fs.readFileSync(digestFile, "utf8").trim().split("\n").filter(function (l) { return l.trim(); });
      }
    } catch (e) {}

    var result = userProfileResult;

    if (hasSummary) {
      // Load summary + latest 5 raw digests for richer context
      var recent = allLines.slice(-5);
      result = "\n\nYour memory summary:\n" + summaryContent;
      if (recent.length > 0) {
        result += formatRawDigests(recent, "Latest raw session memories:");
      }
    } else {
      // Backward compatible: latest 8 raw digests
      var recent = allLines.slice(-8);
      result = formatRawDigests(recent, "Your recent session memories:");
    }

    // Global search: always load team memory summaries for globalSearch mates
    var otherDigests = [];
    if (hasGlobalSearch) {
      try {
        var allMates = matesModule.getAllMates(mateCtx);
        var teamSummaries = [];
        for (var mi = 0; mi < allMates.length; mi++) {
          if (allMates[mi].id === mateId) continue;
          var otherDir = matesModule.getMateDir(mateCtx, allMates[mi].id);
          var mateName = allMates[mi].name || allMates[mi].id;

          // Collect digest files for BM25 search
          var otherDigest = path.join(otherDir, "knowledge", "session-digests.jsonl");
          if (fs.existsSync(otherDigest)) {
            otherDigests.push({ path: otherDigest, mateName: mateName });
          }

          // Collect memory summaries for direct context injection
          var otherSummary = path.join(otherDir, "knowledge", "memory-summary.md");
          try {
            if (fs.existsSync(otherSummary)) {
              var summaryText = fs.readFileSync(otherSummary, "utf8").trim();
              if (summaryText && summaryText.length > 50) {
                teamSummaries.push({ mateName: mateName, summary: summaryText });
              }
            }
          } catch (e) {}
        }

        // Inject team memory summaries into context
        if (teamSummaries.length > 0) {
          result += "\n\nTeam memory summaries (other mates' accumulated context):";
          for (var tsi = 0; tsi < teamSummaries.length; tsi++) {
            var ts = teamSummaries[tsi];
            // Cap each summary to avoid context overflow
            var capped = ts.summary.length > 2000 ? ts.summary.substring(0, 2000) + "\n...(truncated)" : ts.summary;
            result += "\n\n--- @" + ts.mateName + " ---\n" + capped;
          }
        }
      } catch (e) {}

      // Inject recent user observations from all mates (newest first, max 15)
      try {
        var allObservations = [];
        var allMatesForObs = matesModule.getAllMates(mateCtx);
        for (var moi = 0; moi < allMatesForObs.length; moi++) {
          var moDir = matesModule.getMateDir(mateCtx, allMatesForObs[moi].id);
          var moFile = path.join(moDir, "knowledge", "user-observations.jsonl");
          try {
            if (fs.existsSync(moFile)) {
              var moLines = fs.readFileSync(moFile, "utf8").trim().split("\n").filter(function (l) { return l.trim(); });
              for (var mli = 0; mli < moLines.length; mli++) {
                try {
                  var moEntry = JSON.parse(moLines[mli]);
                  moEntry._mateName = moEntry.mateName || allMatesForObs[moi].name || allMatesForObs[moi].id;
                  allObservations.push(moEntry);
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
        if (allObservations.length > 0) {
          // Sort by date descending
          allObservations.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
          var recentObs = allObservations.slice(0, 15);
          result += "\n\nRecent user observations from all mates:";
          for (var roi = 0; roi < recentObs.length; roi++) {
            var ro = recentObs[roi];
            result += "\n- [" + (ro.date || "?") + "] [@" + ro._mateName + "] [" + (ro.category || "?") + "] " + (ro.observation || "") + (ro.evidence ? " (evidence: " + ro.evidence + ")" : "");
          }
        }
      } catch (e) {}

      // Inject recent activity timeline across all projects (chronological)
      try {
        var timelineEntries = [];

        // Own sessions
        sm.sessions.forEach(function (s) {
          if (s.hidden || !s.history || s.history.length === 0) return;
          timelineEntries.push({
            title: s.title || "New Session",
            project: null,
            ts: s.lastActivity || s.createdAt || 0
          });
        });

        // Cross-project sessions
        var crossForTimeline = getAllProjectSessions();
        for (var cti = 0; cti < crossForTimeline.length; cti++) {
          var cs = crossForTimeline[cti];
          timelineEntries.push({
            title: cs.title || "New Session",
            project: cs._projectTitle || null,
            ts: cs.lastActivity || cs.createdAt || 0
          });
        }

        // Sort by time descending, take latest 20
        timelineEntries.sort(function (a, b) { return b.ts - a.ts; });
        timelineEntries = timelineEntries.slice(0, 20);

        if (timelineEntries.length > 0) {
          result += "\n\nRecent activity timeline (newest first):";
          for (var ti = 0; ti < timelineEntries.length; ti++) {
            var te = timelineEntries[ti];
            var dateStr = te.ts ? new Date(te.ts).toISOString().replace("T", " ").substring(0, 16) : "?";
            var line = "- [" + dateStr + "] " + te.title;
            if (te.project) line += " (project: " + te.project + ")";
            result += "\n" + line;
          }
        }
      } catch (e) {}
    }

    // BM25 unified search: digests + session history for current topic
    // globalSearch mates always search (they see everything); others need enough digests
    if (query && (hasGlobalSearch || allLines.length > 5)) {
      try {
        // Collect mate's own sessions
        var mateSessions = [];
        sm.sessions.forEach(function (s) {
          if (!s.hidden && s.history && s.history.length > 0) {
            mateSessions.push(s);
          }
        });

        // globalSearch: also collect sessions from all other projects + knowledge files
        var knowledgeFiles = [];
        if (hasGlobalSearch) {
          var crossSessions = getAllProjectSessions();
          for (var cs = 0; cs < crossSessions.length; cs++) {
            mateSessions.push(crossSessions[cs]);
          }

          // Collect knowledge files from all mates
          try {
            var allMatesForKnowledge = matesModule.getAllMates(mateCtx);
            for (var mk = 0; mk < allMatesForKnowledge.length; mk++) {
              var mkDir = matesModule.getMateDir(mateCtx, allMatesForKnowledge[mk].id);
              var mkName = allMatesForKnowledge[mk].name || allMatesForKnowledge[mk].id;
              var mkKnowledgeDir = path.join(mkDir, "knowledge");
              try {
                var kFiles = fs.readdirSync(mkKnowledgeDir);
                for (var kfi = 0; kfi < kFiles.length; kfi++) {
                  var kfName = kFiles[kfi];
                  // Skip system files (digests, identity, base-template)
                  if (kfName === "session-digests.jsonl" || kfName === "memory-summary.md" ||
                      kfName === "identity-backup.md" || kfName === "identity-history.jsonl" ||
                      kfName === "base-template.md") continue;
                  knowledgeFiles.push({
                    filePath: path.join(mkKnowledgeDir, kfName),
                    name: kfName,
                    mateName: mkName
                  });
                }
              } catch (e) {}
            }
          } catch (e) {}
        }

        var searchResults = sessionSearch.searchMate({
          digestFilePath: digestFile,
          otherDigests: otherDigests,
          sessions: mateSessions,
          knowledgeFiles: knowledgeFiles,
          query: query,
          maxResults: hasGlobalSearch ? 12 : 5,
          minScore: 1.0
        });
        var contextStr = sessionSearch.formatForContext(searchResults);
        if (contextStr) result += contextStr;
      } catch (e) {
        console.error("[session-search] Mate search failed:", e.message);
      }
    }

    return result;
  }

  // Gate check: ask Haiku whether this conversation contains anything worth remembering
  function gateMemory(mateCtx, mateId, conversationContent, callback, opts) {
    opts = opts || {};
    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");

    // Load mate role/activities from mate.yaml (lightweight, no full CLAUDE.md)
    var mateRole = "";
    var mateActivities = "";
    try {
      var yamlRaw = fs.readFileSync(path.join(mateDir, "mate.yaml"), "utf8");
      var roleMatch = yamlRaw.match(/^relationship:\s*(.+)$/m);
      var actMatch = yamlRaw.match(/^activities:\s*(.+)$/m);
      if (roleMatch) mateRole = roleMatch[1].trim();
      if (actMatch) mateActivities = actMatch[1].trim();
    } catch (e) {}

    // Load existing memory summary if available
    var summaryContent = "";
    try {
      var summaryFile = path.join(knowledgeDir, "memory-summary.md");
      if (fs.existsSync(summaryFile)) {
        summaryContent = fs.readFileSync(summaryFile, "utf8").trim();
      }
    } catch (e) {}

    // Cap conversation content for gate
    var cappedContent = conversationContent;
    if (cappedContent.length > 3000) {
      cappedContent = cappedContent.substring(0, 3000) + "...";
    }

    var gateContext = [
      "[SYSTEM: Memory Gate]",
      "You are a memory filter for an AI Mate.",
      "",
      "Mate role: " + (mateRole || "assistant"),
      "Mate activities: " + (mateActivities || "general"),
      "",
      "Current memory summary:",
      summaryContent || "No memory summary yet.",
      "",
      "Conversation just ended:",
      cappedContent,
    ].join("\n");

    var gatePrompt = opts.gatePrompt || [
      'Should this conversation be saved to long-term memory?',
      'Answer "yes" if ANY of these apply:',
      "- A new decision, commitment, or direction",
      "- A change in position or strategy",
      "- New information relevant to this Mate's role",
      "- A user preference, opinion, or pattern not already in the summary",
      "- The user shared personal context, project details, or goals",
      "- The user expressed what they like, dislike, or care about",
      "- The user gave instructions on how they want things done",
      "- Anything the user would reasonably expect to be remembered next time",
      "",
      'Answer "no" ONLY if:',
      "- It exactly duplicates what is already in the memory summary",
      "- The entire conversation is a single trivial exchange (e.g. just 'hi' / 'hello')",
      "",
      "When in doubt, answer yes. It is better to remember too much than to forget something important.",
      "",
      'Answer with ONLY "yes" or "no". Nothing else.',
    ].join("\n");
    var defaultOnError = opts.defaultYes !== undefined ? !!opts.defaultYes : true;

    var gateText = "";
    var _gateSession = null;
    sdk.createMentionSession({
      claudeMd: "",
      model: "haiku",
      initialContext: gateContext,
      initialMessage: gatePrompt,
      onActivity: function () {},
      onDelta: function (delta) {
        gateText += delta;
      },
      onDone: function () {
        var answer = gateText.trim().toLowerCase();
        var shouldRemember = answer.indexOf("yes") !== -1;
        if (_gateSession) try { _gateSession.close(); } catch (e) {}
        callback(shouldRemember);
      },
      onError: function (err) {
        console.error("[memory-gate] Gate check failed for mate " + mateId + ":", err);
        if (_gateSession) try { _gateSession.close(); } catch (e) {}
        callback(defaultOnError);
      },
    }).then(function (gs) {
      _gateSession = gs;
      if (!gs) callback(defaultOnError);
    }).catch(function (err) {
      console.error("[memory-gate] Failed to create gate session for mate " + mateId + ":", err);
      callback(defaultOnError);
    });
  }

  // Update (or create) memory-summary.md based on a new digest
  function updateMemorySummary(mateCtx, mateId, digestObj) {
    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");

    // Check if summary exists; if not, try initial generation first
    var summaryExists = false;
    var summaryContent = "";
    try {
      if (fs.existsSync(summaryFile)) {
        summaryContent = fs.readFileSync(summaryFile, "utf8").trim();
        if (summaryContent) summaryExists = true;
      }
    } catch (e) {}

    if (!summaryExists) {
      // Try initial summary generation from existing digests (migration)
      initMemorySummary(mateCtx, mateId, function () {
        // After init, do incremental update with the new digest
        doIncrementalUpdate(mateCtx, mateId, knowledgeDir, summaryFile, digestObj);
      });
    } else {
      doIncrementalUpdate(mateCtx, mateId, knowledgeDir, summaryFile, digestObj);
    }
  }

  // Incremental update of memory-summary.md with a single new digest
  function doIncrementalUpdate(mateCtx, mateId, knowledgeDir, summaryFile, digestObj) {
    var existingSummary = "";
    try {
      if (fs.existsSync(summaryFile)) {
        existingSummary = fs.readFileSync(summaryFile, "utf8").trim();
      }
    } catch (e) {}

    var updateContext = [
      "[SYSTEM: Memory Summary Update]",
      "You are updating an AI Mate's long-term memory summary.",
      "",
      "Current summary:",
      existingSummary || "(empty, this is the first entry)",
      "",
      "New session digest to incorporate:",
      JSON.stringify(digestObj, null, 2),
    ].join("\n");

    var updatePrompt = [
      "Update the summary by:",
      "1. Adding new information from this session",
      "2. Updating existing entries if positions changed",
      "3. Moving resolved open threads out of \"Open Threads\"",
      "4. Adding to \"My Track Record\" if a past prediction/recommendation can now be evaluated",
      "5. Removing outdated or redundant information",
      "6. Preserving important user quotes and context from key_quotes and user_context fields",
      "",
      "Maintain this structure:",
      "",
      "# Memory Summary",
      "Last updated: YYYY-MM-DD (session count: N+1)",
      "",
      "## User Context",
      "(who they are, what they work on, project details, goals)",
      "## User Patterns",
      "(preferences, work style, communication style, likes/dislikes)",
      "## Key Decisions",
      "## Notable Quotes",
      "(important things the user said, verbatim when possible)",
      "## My Track Record",
      "## Open Threads",
      "## Recurring Topics",
      "",
      "Keep it concise. Each section should have at most 10 bullet points.",
      "Drop the oldest/least relevant if needed.",
      "The Notable Quotes section is valuable for preserving the user's voice and intent.",
      "Output ONLY the updated markdown. Nothing else.",
    ].join("\n");

    var updateText = "";
    var _updateSession = null;
    sdk.createMentionSession({
      claudeMd: "",
      model: "haiku",
      initialContext: updateContext,
      initialMessage: updatePrompt,
      onActivity: function () {},
      onDelta: function (delta) {
        updateText += delta;
      },
      onDone: function () {
        try {
          var cleaned = updateText.trim();
          if (cleaned.indexOf("```") === 0) {
            cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
          }
          fs.mkdirSync(knowledgeDir, { recursive: true });
          fs.writeFileSync(summaryFile, cleaned + "\n", "utf8");
          console.log("[memory-summary] Updated memory-summary.md for mate " + mateId);
        } catch (e) {
          console.error("[memory-summary] Failed to write memory-summary.md for mate " + mateId + ":", e.message);
        }
        if (_updateSession) try { _updateSession.close(); } catch (e) {}
      },
      onError: function (err) {
        console.error("[memory-summary] Summary update failed for mate " + mateId + ":", err);
        if (_updateSession) try { _updateSession.close(); } catch (e) {}
      },
    }).then(function (us) {
      _updateSession = us;
    }).catch(function (err) {
      console.error("[memory-summary] Failed to create summary update session for mate " + mateId + ":", err);
    });
  }

  // Initial summary generation (migration): read latest 20 digests and generate first summary
  function initMemorySummary(mateCtx, mateId, callback) {
    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");
    var digestFile = path.join(knowledgeDir, "session-digests.jsonl");

    // Check if digests exist
    var allLines = [];
    try {
      if (fs.existsSync(digestFile)) {
        allLines = fs.readFileSync(digestFile, "utf8").trim().split("\n").filter(function (l) { return l.trim(); });
      }
    } catch (e) {}

    if (allLines.length === 0) {
      // No digests to summarize, just callback
      callback();
      return;
    }

    var recent = allLines.slice(-20);
    var digestsText = [];
    for (var i = 0; i < recent.length; i++) {
      try {
        var d = JSON.parse(recent[i]);
        digestsText.push(JSON.stringify(d));
      } catch (e) {}
    }

    if (digestsText.length === 0) {
      callback();
      return;
    }

    var initContext = [
      "[SYSTEM: Initial Memory Summary]",
      "You are creating the first long-term memory summary for an AI Mate.",
      "",
      "Here are the most recent session digests (up to 20):",
      digestsText.join("\n"),
    ].join("\n");

    var initPrompt = [
      "Create a memory summary from these sessions.",
      "",
      "Structure:",
      "",
      "# Memory Summary",
      "Last updated: YYYY-MM-DD (session count: N)",
      "",
      "## User Context",
      "(who they are, what they work on, project details, goals)",
      "## User Patterns",
      "(preferences, work style, communication style, likes/dislikes)",
      "## Key Decisions",
      "## Notable Quotes",
      "(important things the user said, verbatim when possible)",
      "## My Track Record",
      "## Open Threads",
      "## Recurring Topics",
      "",
      "Keep it concise. Focus on patterns, decisions, and the user's own words.",
      "Each section should have at most 10 bullet points.",
      "Preserve key_quotes from digests in the Notable Quotes section.",
      "Set session count to " + digestsText.length + ".",
      "Output ONLY the markdown. Nothing else.",
    ].join("\n");

    var initText = "";
    var _initSession = null;
    sdk.createMentionSession({
      claudeMd: "",
      model: "haiku",
      initialContext: initContext,
      initialMessage: initPrompt,
      onActivity: function () {},
      onDelta: function (delta) {
        initText += delta;
      },
      onDone: function () {
        try {
          var cleaned = initText.trim();
          if (cleaned.indexOf("```") === 0) {
            cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
          }
          fs.mkdirSync(knowledgeDir, { recursive: true });
          fs.writeFileSync(summaryFile, cleaned + "\n", "utf8");
          console.log("[memory-summary] Generated initial memory-summary.md for mate " + mateId + " from " + digestsText.length + " digests");
        } catch (e) {
          console.error("[memory-summary] Failed to write initial memory-summary.md for mate " + mateId + ":", e.message);
        }
        if (_initSession) try { _initSession.close(); } catch (e) {}
        callback();
      },
      onError: function (err) {
        console.error("[memory-summary] Initial summary generation failed for mate " + mateId + ":", err);
        if (_initSession) try { _initSession.close(); } catch (e) {}
        callback();
      },
    }).then(function (is) {
      _initSession = is;
      if (!is) callback();
    }).catch(function (err) {
      console.error("[memory-summary] Failed to create init summary session for mate " + mateId + ":", err);
      callback();
    });
  }

  // --- Message handlers for memory management UI ---

  function handleMemoryList(ws) {
    var digestFile = path.join(cwd, "knowledge", "session-digests.jsonl");
    var summaryFile = path.join(cwd, "knowledge", "memory-summary.md");
    var entries = [];
    var summary = "";
    try {
      var raw = fs.readFileSync(digestFile, "utf8").trim();
      if (raw) {
        var lines = raw.split("\n");
        for (var mi = 0; mi < lines.length; mi++) {
          try {
            var obj = JSON.parse(lines[mi]);
            obj.index = mi;
            entries.push(obj);
          } catch (e) {}
        }
      }
    } catch (e) { /* file may not exist */ }
    try {
      if (fs.existsSync(summaryFile)) {
        summary = fs.readFileSync(summaryFile, "utf8").trim();
      }
    } catch (e) {}
    // Return newest first
    entries.reverse();
    sendTo(ws, { type: "memory_list", entries: entries, summary: summary });
  }

  function handleMemorySearch(ws, msg) {
    if (!msg.query || typeof msg.query !== "string") {
      sendTo(ws, { type: "memory_search_results", results: [], query: "" });
      return;
    }
    var digestFile = path.join(cwd, "knowledge", "session-digests.jsonl");
    try {
      var results = sessionSearch.searchDigests(digestFile, msg.query, {
        maxResults: msg.maxResults || 10,
        minScore: msg.minScore || 0.5,
        dateFrom: msg.dateFrom || null,
        dateTo: msg.dateTo || null
      });
      sendTo(ws, {
        type: "memory_search_results",
        results: sessionSearch.formatForMemoryUI(results),
        query: msg.query
      });
    } catch (e) {
      console.error("[session-search] Search failed:", e.message);
      sendTo(ws, { type: "memory_search_results", results: [], query: msg.query });
    }
  }

  function handleMemoryDelete(ws, msg) {
    if (typeof msg.index !== "number") return;
    var digestFile = path.join(cwd, "knowledge", "session-digests.jsonl");
    try {
      var raw = fs.readFileSync(digestFile, "utf8").trim();
      var lines = raw ? raw.split("\n") : [];
      if (msg.index >= 0 && msg.index < lines.length) {
        lines.splice(msg.index, 1);
        if (lines.length === 0) {
          fs.unlinkSync(digestFile);
        } else {
          fs.writeFileSync(digestFile, lines.join("\n") + "\n");
        }
      }
    } catch (e) {}
    sendTo(ws, { type: "memory_deleted", index: msg.index });
    handleMessage(ws, { type: "memory_list" });
  }

  return {
    loadMateDigests: loadMateDigests,
    gateMemory: gateMemory,
    updateMemorySummary: updateMemorySummary,
    initMemorySummary: initMemorySummary,
    handleMemoryList: handleMemoryList,
    handleMemorySearch: handleMemorySearch,
    handleMemoryDelete: handleMemoryDelete,
  };
}

module.exports = { attachMemory };
