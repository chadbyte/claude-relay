var fs = require("fs");
var path = require("path");
var Datastore = require("@seald-io/nedb");
var config = require("./config");

var COLUMNS = ["todo", "doing", "done"];
var MUTABLE_FIELDS = ["title", "body", "projectId", "assignee", "order"];
var datastoresByRoot = {};

function resolveBoardRoot(ctx) {
  if (ctx && ctx.linuxUser) {
    return path.join("/home", ctx.linuxUser, ".clay", "board");
  }
  if (ctx && ctx.multiUser && ctx.userId) {
    return path.join(config.CONFIG_DIR, "board", ctx.userId);
  }
  return path.join(config.CONFIG_DIR, "board");
}

function validateActor(actor) {
  if (actor === "user") return;
  if (typeof actor === "string" && actor.indexOf("mate_") === 0) return;
  throw new Error("Actor must be 'user' or a mate ID.");
}

function validateColumn(column) {
  if (COLUMNS.indexOf(column) === -1) {
    throw new Error("Column must be one of: todo, doing, done.");
  }
}

function validateTitle(title) {
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("Card title must be a non-empty string.");
  }
}

function validateOptionalString(value, fieldName) {
  if (value !== null && value !== undefined && typeof value !== "string") {
    throw new Error(fieldName + " must be a string or null.");
  }
}

function validateAssignee(assignee) {
  if (assignee === null || assignee === undefined) return;
  if (typeof assignee === "string" && assignee.indexOf("mate_") === 0) return;
  throw new Error("Assignee must be null or a mate ID.");
}

function validateOrder(order) {
  if (typeof order !== "number" || !Number.isFinite(order)) {
    throw new Error("Order must be a finite number.");
  }
}

function createBoardManager(ctx) {
  var root = resolveBoardRoot(ctx);

  function getDatastore() {
    if (!datastoresByRoot[root]) {
      fs.mkdirSync(root, { recursive: true });
      datastoresByRoot[root] = new Datastore({
        filename: path.join(root, "board.db"),
        autoload: true,
      });
    }
    return datastoresByRoot[root];
  }

  async function getReadyDatastore() {
    var datastore = getDatastore();
    await datastore.autoloadPromise;
    return datastore;
  }

  async function requireCard(id) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Card ID is required.");
    }
    var datastore = await getReadyDatastore();
    var card = await datastore.findOneAsync({ _id: id });
    if (!card) throw new Error("Card not found.");
    return card;
  }

  async function nextOrder(column) {
    var datastore = await getReadyDatastore();
    var lastCards = await datastore.findAsync({ column: column }).sort({ order: -1 }).limit(1);
    if (lastCards.length === 0) return 1;
    return (typeof lastCards[0].order === "number" ? lastCards[0].order : 0) + 1;
  }

  async function updateCard(id, changes) {
    var datastore = await getReadyDatastore();
    var result = await datastore.updateAsync(
      { _id: id },
      { $set: changes },
      { returnUpdatedDocs: true }
    );
    if (!result.numAffected) throw new Error("Card not found.");
    return result.affectedDocuments;
  }

  async function list() {
    var datastore = await getReadyDatastore();
    var cards = await datastore.findAsync({});
    cards.sort(function (a, b) {
      var columnDifference = COLUMNS.indexOf(a.column) - COLUMNS.indexOf(b.column);
      if (columnDifference !== 0) return columnDifference;
      if (a.order !== b.order) return a.order - b.order;
      return a.createdAt - b.createdAt;
    });
    return cards;
  }

  async function create(fields, actor) {
    validateActor(actor);
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new Error("Card fields are required.");
    }
    validateTitle(fields.title);
    var column = fields.column === undefined ? "todo" : fields.column;
    validateColumn(column);
    if (column === "done" && actor !== "user") {
      throw new Error("Only the user can create a card in done.");
    }
    validateOptionalString(fields.body, "Body");
    validateOptionalString(fields.projectId, "Project ID");
    validateOptionalString(fields.sessionId, "Session ID");
    validateAssignee(fields.assignee);

    var now = Date.now();
    var card = {
      title: fields.title.trim(),
      body: fields.body || "",
      column: column,
      projectId: fields.projectId || null,
      assignee: fields.assignee || null,
      sessionId: fields.sessionId || null,
      source: "native",
      createdBy: actor,
      pendingDone: false,
      createdAt: now,
      updatedAt: now,
      completedAt: column === "done" ? now : null,
      order: await nextOrder(column),
    };
    var datastore = await getReadyDatastore();
    return datastore.insertAsync(card);
  }

  async function update(id, fields, actor) {
    validateActor(actor);
    await requireCard(id);
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new Error("Update fields are required.");
    }
    var keys = Object.keys(fields);
    if (keys.length === 0) throw new Error("At least one update field is required.");
    for (var i = 0; i < keys.length; i++) {
      if (MUTABLE_FIELDS.indexOf(keys[i]) === -1) {
        throw new Error("Field '" + keys[i] + "' cannot be updated.");
      }
    }
    if (Object.prototype.hasOwnProperty.call(fields, "title")) validateTitle(fields.title);
    if (Object.prototype.hasOwnProperty.call(fields, "body")) validateOptionalString(fields.body, "Body");
    if (Object.prototype.hasOwnProperty.call(fields, "projectId")) validateOptionalString(fields.projectId, "Project ID");
    if (Object.prototype.hasOwnProperty.call(fields, "assignee")) validateAssignee(fields.assignee);
    if (Object.prototype.hasOwnProperty.call(fields, "order")) validateOrder(fields.order);

    var changes = {};
    for (var j = 0; j < keys.length; j++) changes[keys[j]] = fields[keys[j]];
    if (Object.prototype.hasOwnProperty.call(changes, "title")) changes.title = changes.title.trim();
    changes.updatedAt = Date.now();
    return updateCard(id, changes);
  }

  async function move(id, column, actor) {
    validateActor(actor);
    validateColumn(column);
    var card = await requireCard(id);
    if (column === "done" && actor !== "user") {
      throw new Error("Only the user can move a card to done. Mates must propose completion.");
    }
    var changes = {
      column: column,
      pendingDone: false,
      completedAt: column === "done" ? Date.now() : null,
      updatedAt: Date.now(),
    };
    if (column !== card.column) changes.order = await nextOrder(column);
    return updateCard(id, changes);
  }

  async function remove(id, actor) {
    validateActor(actor);
    if (actor !== "user") throw new Error("Only the user can delete a card.");
    await requireCard(id);
    var datastore = await getReadyDatastore();
    var removed = await datastore.removeAsync({ _id: id }, {});
    if (!removed) throw new Error("Card not found.");
    return { _id: id };
  }

  async function proposeDone(id, actor) {
    validateActor(actor);
    if (actor === "user") throw new Error("Only a mate can propose card completion.");
    var card = await requireCard(id);
    if (card.column === "done") throw new Error("A completed card cannot have completion proposed.");
    return updateCard(id, { pendingDone: true, updatedAt: Date.now() });
  }

  async function confirmDone(id, accept, actor) {
    validateActor(actor);
    if (actor !== "user") throw new Error("Only the user can confirm card completion.");
    if (typeof accept !== "boolean") throw new Error("Completion confirmation must be true or false.");
    await requireCard(id);
    var now = Date.now();
    var changes = { pendingDone: false, updatedAt: now };
    if (accept) {
      changes.column = "done";
      changes.completedAt = now;
      changes.order = await nextOrder("done");
    }
    return updateCard(id, changes);
  }

  return {
    list: list,
    create: create,
    update: update,
    move: move,
    remove: remove,
    proposeDone: proposeDone,
    confirmDone: confirmDone,
  };
}

module.exports = { createBoardManager: createBoardManager };
