var fs = require("fs");
var path = require("path");
var Datastore = require("@seald-io/nedb");
var toolsRegistry = require("./tools-registry");

var MAX_DOCUMENT_BYTES = 64 * 1024;
var datastoresByFile = {};

function createToolStorage(ctx, toolId) {
  toolsRegistry.validateToolId(toolId);
  var directory = path.join(toolsRegistry.resolveToolsRoot(ctx), toolId);
  var filename = path.join(directory, "data.db");

  function getDatastore() {
    if (!datastoresByFile[filename]) {
      fs.mkdirSync(directory, { recursive: true });
      datastoresByFile[filename] = new Datastore({ filename: filename, autoload: true });
    }
    return datastoresByFile[filename];
  }

  async function ready() {
    var datastore = getDatastore();
    await datastore.autoloadPromise;
    return datastore;
  }

  function validateDocument(doc) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("Storage document must be an object.");
    var bytes = Buffer.byteLength(JSON.stringify(doc), "utf8");
    if (bytes > MAX_DOCUMENT_BYTES) throw new Error("Storage document exceeds the 64KB limit.");
  }

  async function list() {
    var datastore = await ready();
    return datastore.findAsync({});
  }

  async function get(id) {
    if (typeof id !== "string" || !id) throw new Error("Storage document ID is required.");
    var datastore = await ready();
    return datastore.findOneAsync({ _id: id });
  }

  async function put(doc) {
    validateDocument(doc);
    var datastore = await ready();
    if (!doc._id) return datastore.insertAsync(doc);
    var changes = {};
    var keys = Object.keys(doc);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== "_id") changes[keys[i]] = doc[keys[i]];
    }
    var result = await datastore.updateAsync(
      { _id: doc._id },
      { $set: changes },
      { upsert: true, returnUpdatedDocs: true }
    );
    return result.affectedDocuments;
  }

  async function remove(id) {
    if (typeof id !== "string" || !id) throw new Error("Storage document ID is required.");
    var datastore = await ready();
    return datastore.removeAsync({ _id: id }, {});
  }

  async function query(selector) {
    if (!selector || typeof selector !== "object" || Array.isArray(selector)) throw new Error("Storage query must be an object.");
    var datastore = await ready();
    return datastore.findAsync(selector);
  }

  return { list: list, get: get, put: put, delete: remove, query: query };
}

module.exports = { MAX_DOCUMENT_BYTES: MAX_DOCUMENT_BYTES, createToolStorage: createToolStorage };
