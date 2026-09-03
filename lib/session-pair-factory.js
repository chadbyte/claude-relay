// Split-group pair creation.
//
// Extracted from project-session-pair.js, which operates a pair once it
// exists; this module is only about how one comes into being. Both the
// explicit "Add Split Worker" flow and the Driver-initiated
// send_to_partner-creates-a-pair flow land here, so vendor validation, owner
// derivation and the group record are written in exactly one place.
//
// Ownership always comes from the connection or the Driver session, never from
// the incoming message.

var yoke = require("./yoke");

function attachPairFactory(ctx) {
  var sm = ctx.sm;
  var store = ctx.splitStore;

  function validateVendor(vendor) {
    var installed = sm.installedVendors || [];
    if (!vendor || installed.indexOf(vendor) === -1) throw new Error("vendor is not installed: " + (vendor || "unknown"));
    return vendor;
  }

  function createPairRecord(ws, msg) {
    if (ctx.isMate) throw new Error("Pair sessions are only available in projects");
    var driverSpec = msg.driver || {};
    var workerSpec = msg.worker || {};
    var workerVendor = validateVendor(workerSpec.vendor || sm.lastVendor || "codex");
    var ownerId = ws._clayUser && ctx.usersModule.isMultiUser() ? ws._clayUser.id : null;
    var driver;
    var groupName;
    if (Number.isInteger(driverSpec.sessionId)) {
      // "Add Split Worker" on an existing session: the current session becomes
      // the Driver with its full conversation context intact.
      driver = sm.sessions.get(driverSpec.sessionId);
      if (!driver) throw new Error("driver session not found");
      if ((driver.ownerId || null) !== ownerId) throw new Error("driver session access denied");
      if (store.groupForMember(driver.localId)) throw new Error("this session is already in a split group");
      groupName = undefined; // auto name from member titles
    } else {
      var driverVendor = validateVendor(driverSpec.vendor || "claude");
      var driverEffort = yoke.clampEffort(driverVendor, driverSpec.effort || (sm.currentEffortByVendor && sm.currentEffortByVendor[driverVendor]) || sm.currentEffort || "medium") || null;
      driver = sm.createSessionRaw({ ownerId: ownerId, vendor: driverVendor, model: driverSpec.model || null, effort: driverEffort });
      driver.title = "Driver · " + ((yoke.getVendorInfo(driverVendor) || {}).displayName || driverVendor);
      if (driverSpec.effort) driver.loopSettings = { effort: driverSpec.effort };
      groupName = "Agent pair";
    }
    var workerEffort = yoke.clampEffort(workerVendor, workerSpec.effort || (sm.currentEffortByVendor && sm.currentEffortByVendor[workerVendor]) || sm.currentEffort || "medium") || null;
    var worker = sm.createSessionRaw({ ownerId: ownerId, vendor: workerVendor, model: workerSpec.model || null, effort: workerEffort });
    worker.title = "Split Worker · " + ((yoke.getVendorInfo(workerVendor) || {}).displayName || workerVendor);
    if (workerSpec.effort) worker.loopSettings = { effort: workerSpec.effort };
    var result = store.create(ws, {
      members: [driver.localId, worker.localId],
      pair: { driverId: driver.localId, workerId: worker.localId },
      name: groupName,
    });
    if (!result.ok) throw new Error(result.error);
    sm.broadcastSessionList();
    return { driver: driver, worker: worker, group: result.group };
  }

  function createWorkerForDriver(driver, args) {
    if (ctx.isMate) throw new Error("Pair sessions are only available in projects");
    var installed = sm.installedVendors || [];
    if (installed.length === 0) throw new Error("no coding agent is installed for a Split Worker session");
    var vendor = typeof args.workerVendor === "string" ? args.workerVendor.trim() : "";
    if (vendor) validateVendor(vendor);
    if (!vendor) {
      if (installed.indexOf("codex") !== -1 && driver.vendor !== "codex") vendor = "codex";
      else {
        vendor = installed[0];
        for (var i = 0; i < installed.length; i++) {
          if (installed[i] !== driver.vendor) { vendor = installed[i]; break; }
        }
      }
    }
    var ws = {
      _clayActiveSession: driver.localId,
      _clayUser: driver.ownerId ? { id: driver.ownerId } : null,
    };
    var created = createPairRecord(ws, {
      driver: { sessionId: driver.localId },
      worker: {
        vendor: vendor,
        model: typeof args.workerModel === "string" ? args.workerModel : "",
        effort: typeof args.workerEffort === "string" ? args.workerEffort : "",
      },
    });
    sm.sendToSession(driver, { type: "pair_session_created", ok: true, group: created.group });
    return created;
  }

  function createPair(ws, msg) {
    try {
      var created = createPairRecord(ws, msg);
      ctx.sendTo(ws, { type: "pair_session_created", ok: true, group: created.group });
    } catch (e) {
      ctx.sendTo(ws, { type: "pair_session_created", ok: false, error: e.message || String(e) });
    }
  }

  return {
    createPair: createPair,
    createPairRecord: createPairRecord,
    createWorkerForDriver: createWorkerForDriver,
    validateVendor: validateVendor,
  };
}

module.exports = { attachPairFactory: attachPairFactory };
