var fs = require("fs");

function attachDm(ctx) {
  var users = ctx.users;
  var dm = ctx.dm;
  var mates = ctx.mates;
  var projects = ctx.projects;
  var pushModule = ctx.pushModule;
  var addProject = ctx.addProject;

  function handleMessage(ws, msg) {
    if (!users.isMultiUser() || !ws._clayUser) return false;
    var userId = ws._clayUser.id;

    if (msg.type === "dm_list") {
      var dmList = dm.getDmList(userId);
      // Enrich with user info
      for (var i = 0; i < dmList.length; i++) {
        var otherUser = users.findUserById(dmList[i].otherUserId);
        if (otherUser) {
          var p = otherUser.profile || {};
          dmList[i].otherUser = {
            id: otherUser.id,
            displayName: p.name || otherUser.displayName || otherUser.username,
            username: otherUser.username,
            avatarStyle: p.avatarStyle || "thumbs",
            avatarSeed: p.avatarSeed || otherUser.username,
            avatarColor: p.avatarColor || "#7c3aed",
            avatarCustom: p.avatarCustom || "",
          };
        }
      }
      // Include mates in the list
      var mateCtx = mates.buildMateCtx(userId);
      var mateList = mates.getAllMates(mateCtx);
      ws.send(JSON.stringify({ type: "dm_list", dms: dmList, mates: mateList }));
      return true;
    }

    if (msg.type === "dm_open") {
      if (!msg.targetUserId) return true;

      // Check if target is a mate
      var mateCtx2 = mates.buildMateCtx(userId);
      if (mates.isMate(mateCtx2, msg.targetUserId)) {
        var mate = mates.getMate(mateCtx2, msg.targetUserId);
        if (!mate) return true;
        // Ensure mate project is registered (survives server restarts)
        var mateSlug2 = "mate-" + mate.id;
        if (!projects.has(mateSlug2)) {
          var mateDir2 = mates.getMateDir(mateCtx2, mate.id);
          fs.mkdirSync(mateDir2, { recursive: true });
          var mateName2 = (mate.profile && mate.profile.displayName) || mate.name || "New Mate";
          addProject(mateDir2, mateSlug2, mateName2, null, mate.createdBy || userId, null, { isMate: true, mateDisplayName: mateName2 });
        }
        var mp = mate.profile || {};
        ws.send(JSON.stringify({
          type: "dm_history",
          dmKey: "mate:" + mate.id,
          messages: dm.loadHistory("mate:" + mate.id),
          isMate: true,
          projectSlug: mateSlug2,
          targetUser: {
            id: mate.id,
            displayName: mp.displayName || mate.name || "New Mate",
            username: mate.id,
            avatarStyle: mp.avatarStyle || "bottts",
            avatarSeed: mp.avatarSeed || mate.id,
            avatarColor: mp.avatarColor || "#6c5ce7",
            avatarCustom: mp.avatarCustom || "",
            isMate: true,
            primary: !!mate.primary,
            mateStatus: mate.status,
            seedData: mate.seedData || {},
          },
        }));
        return true;
      }

      var result = dm.openDm(userId, msg.targetUserId);
      var targetUser = users.findUserById(msg.targetUserId);
      var tp = targetUser ? (targetUser.profile || {}) : {};
      ws.send(JSON.stringify({
        type: "dm_history",
        dmKey: result.dmKey,
        messages: result.messages,
        targetUser: targetUser ? {
          id: targetUser.id,
          displayName: tp.name || targetUser.displayName || targetUser.username,
          username: targetUser.username,
          avatarStyle: tp.avatarStyle || "thumbs",
          avatarSeed: tp.avatarSeed || targetUser.username,
          avatarColor: tp.avatarColor || "#7c3aed",
          avatarCustom: tp.avatarCustom || "",
        } : null,
      }));
      return true;
    }

    if (msg.type === "dm_typing") {
      // Relay typing indicator to DM partner
      var dmKey = msg.dmKey;
      if (!dmKey) return true;
      var parts = dmKey.split(":");
      if (parts.indexOf(userId) === -1) return true;
      var targetId = parts[0] === userId ? parts[1] : parts[0];
      projects.forEach(function (ctx) {
        ctx.forEachClient(function (otherWs) {
          if (otherWs === ws) return;
          if (!otherWs._clayUser || otherWs._clayUser.id !== targetId) return;
          if (otherWs.readyState !== 1) return;
          otherWs.send(JSON.stringify({ type: "dm_typing", dmKey: dmKey, userId: userId, typing: !!msg.typing }));
        });
      });
      return true;
    }

    if (msg.type === "dm_send") {
      if (!msg.dmKey || !msg.text) return true;
      var parts = msg.dmKey.split(":");

      // Handle mate DM: dmKey is "mate:mate_xxx"
      var mateCtx3 = mates.buildMateCtx(userId);
      if (parts[0] === "mate" && mates.isMate(mateCtx3, parts[1])) {
        var mate = mates.getMate(mateCtx3, parts[1]);
        if (!mate) return true;
        // Verify sender is the mate's creator
        if (mate.createdBy !== userId) return true;
        var message = dm.sendMessage(msg.dmKey, userId, msg.text);
        ws.send(JSON.stringify({ type: "dm_message", dmKey: msg.dmKey, message: message }));
        return true;
      }

      // Regular DM: verify sender is a participant
      if (parts.indexOf(userId) === -1) return true;
      var message = dm.sendMessage(msg.dmKey, userId, msg.text);
      // Send confirmation to sender
      ws.send(JSON.stringify({ type: "dm_message", dmKey: msg.dmKey, message: message }));
      // Broadcast to target user's connections across all projects
      var targetId = parts[0] === userId ? parts[1] : parts[0];
      projects.forEach(function (ctx) {
        ctx.forEachClient(function (otherWs) {
          if (otherWs === ws) return;
          if (!otherWs._clayUser || otherWs._clayUser.id !== targetId) return;
          if (otherWs.readyState !== 1) return;
          otherWs.send(JSON.stringify({ type: "dm_message", dmKey: msg.dmKey, message: message }));
        });
      });
      // Send push notification to target user
      if (pushModule && pushModule.sendPushToUser) {
        var senderName = ws._clayUser ? (ws._clayUser.displayName || ws._clayUser.username || "Someone") : "Someone";
        var preview = (msg.text || "").substring(0, 140);
        pushModule.sendPushToUser(targetId, {
          type: "dm",
          title: senderName,
          body: preview,
          tag: "dm-" + msg.dmKey,
          dmKey: msg.dmKey,
        });
      }
      return true;
    }

    if (msg.type === "dm_add_favorite") {
      if (!msg.targetUserId) return true;
      users.removeDmHidden(userId, msg.targetUserId);
      var updatedFavorites = users.addDmFavorite(userId, msg.targetUserId);
      var allUsersList = users.getAllUsers().map(function (u) {
        var p = u.profile || {};
        return {
          id: u.id,
          displayName: p.name || u.displayName || u.username,
          username: u.username,
          role: u.role,
          avatarStyle: p.avatarStyle || "thumbs",
          avatarSeed: p.avatarSeed || u.username,
          avatarColor: p.avatarColor || "#7c3aed",
          avatarCustom: p.avatarCustom || "",
        };
      });
      ws.send(JSON.stringify({
        type: "dm_favorites_updated",
        dmFavorites: updatedFavorites,
        allUsers: allUsersList,
      }));
      return true;
    }

    if (msg.type === "dm_remove_favorite") {
      if (!msg.targetUserId) return true;
      users.addDmHidden(userId, msg.targetUserId);
      var updatedFavorites = users.removeDmFavorite(userId, msg.targetUserId);
      ws.send(JSON.stringify({
        type: "dm_favorites_updated",
        dmFavorites: updatedFavorites,
      }));
      return true;
    }

    return false;
  }

  return {
    handleMessage: handleMessage,
  };
}

module.exports = { attachDm: attachDm };
