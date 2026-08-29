var board = require("./board");

function attachBoard(deps) {
  var users = deps.users;
  var projects = deps.projects;
  var managers = {};

  function getBoardManager(userId) {
    if (!managers[userId]) {
      var multiUser = users.isMultiUser();
      var linuxUser = null;
      if (multiUser) {
        var user = users.findUserById(userId);
        if (user && user.linuxUser) linuxUser = user.linuxUser;
      }
      managers[userId] = board.createBoardManager({
        userId: userId,
        multiUser: multiUser,
        linuxUser: linuxUser,
      });
    }
    return managers[userId];
  }

  function send(ws, payload) {
    if (ws.readyState !== undefined && ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  }

  function broadcastToUser(userId, payload) {
    var sent = new Set();
    projects.forEach(function (projectContext) {
      projectContext.forEachClient(function (otherWs) {
        if (sent.has(otherWs)) return;
        if (users.isMultiUser()) {
          if (!otherWs._clayUser || otherWs._clayUser.id !== userId) return;
        }
        sent.add(otherWs);
        send(otherWs, payload);
      });
    });
  }

  function sendError(ws, requestType, error) {
    send(ws, {
      type: "board_error",
      requestType: requestType,
      message: error && error.message ? error.message : "Board operation failed.",
    });
  }

  function run(ws, msg, userId, operation) {
    Promise.resolve().then(operation).catch(function (error) {
      sendError(ws, msg.type, error);
    });
  }

  function handleMessage(ws, msg) {
    var boardTypes = [
      "board_list",
      "board_card_create",
      "board_card_update",
      "board_card_move",
      "board_card_delete",
      "board_done_confirm",
    ];
    if (!msg || boardTypes.indexOf(msg.type) === -1) return false;

    var userId;
    if (users.isMultiUser()) {
      if (!ws._clayUser) return false;
      userId = ws._clayUser.id;
    } else {
      userId = "default";
    }
    var manager = getBoardManager(userId);

    if (msg.type === "board_list") {
      run(ws, msg, userId, async function () {
        var cards = await manager.list();
        send(ws, { type: "board_state", cards: cards });
      });
      return true;
    }

    if (msg.type === "board_card_create") {
      run(ws, msg, userId, async function () {
        var card = await manager.create(msg.fields || msg.card, "user");
        broadcastToUser(userId, { type: "board_card_created", card: card });
      });
      return true;
    }

    if (msg.type === "board_card_update") {
      run(ws, msg, userId, async function () {
        var card = await manager.update(msg.cardId || msg.id, msg.fields || msg.updates, "user");
        broadcastToUser(userId, { type: "board_card_updated", card: card });
      });
      return true;
    }

    if (msg.type === "board_card_move") {
      run(ws, msg, userId, async function () {
        var card = await manager.move(msg.cardId || msg.id, msg.column, "user");
        broadcastToUser(userId, { type: "board_card_moved", card: card });
      });
      return true;
    }

    if (msg.type === "board_card_delete") {
      run(ws, msg, userId, async function () {
        var removed = await manager.remove(msg.cardId || msg.id, "user");
        broadcastToUser(userId, { type: "board_card_deleted", cardId: removed._id });
      });
      return true;
    }

    if (msg.type === "board_done_confirm") {
      run(ws, msg, userId, async function () {
        var card = await manager.confirmDone(msg.cardId || msg.id, msg.accept, "user");
        broadcastToUser(userId, { type: "board_done_updated", card: card, accepted: msg.accept });
      });
      return true;
    }

    return false;
  }

  return {
    handleMessage: handleMessage,
    getBoardManager: getBoardManager,
    broadcastToUser: broadcastToUser,
  };
}

module.exports = { attachBoard: attachBoard };
