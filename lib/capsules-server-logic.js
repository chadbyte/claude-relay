function createServerLogicMap(deps) {
  var boardHandler = deps.boardHandler;

  function boardManager(context) {
    if (!boardHandler) throw new Error("The board server runtime is unavailable.");
    return boardHandler.getBoardManager(context.userId);
  }

  async function boardSnapshot(context) {
    return { state: { cards: await boardManager(context).list() } };
  }

  async function boardAct(context, actionId, args) {
    var manager = boardManager(context);
    var card;
    var eventType;
    if (actionId === "create") {
      card = await manager.create(args.fields || args, context.callerId);
      eventType = "board_card_created";
    } else if (actionId === "update") {
      card = await manager.update(args.cardId || args.id, args.fields || args.updates, context.callerId);
      eventType = "board_card_updated";
    } else if (actionId === "move") {
      card = await manager.move(args.cardId || args.id, args.column, context.callerId);
      eventType = "board_card_moved";
    } else if (actionId === "propose_done") {
      card = await manager.proposeDone(args.cardId || args.id, context.callerId);
      eventType = "board_done_updated";
    } else {
      throw new Error("Unknown board action '" + actionId + "'.");
    }
    boardHandler.broadcastToUser(context.userId, {
      type: eventType,
      card: card,
      callerId: context.callerId,
    });
    return { state: { cards: await manager.list() }, result: card };
  }

  return {
    board: {
      snapshot: boardSnapshot,
      act: boardAct,
    },
  };
}

module.exports = { createServerLogicMap: createServerLogicMap };
