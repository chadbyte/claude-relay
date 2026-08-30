var fs = require("fs");
var os = require("os");
var path = require("path");

var fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-capsule-csp-"));
process.env.HOME = fixtureHome;
process.env.CLAY_HOME = fixtureHome;

var createServer = require("../../lib/server").createServer;
var relay = createServer({ port: 0, debug: true });
var closing = false;

function finish() {
  try { fs.rmSync(fixtureHome, { recursive: true, force: true }); } catch (error) {}
  process.exit(0);
}

function closeFixture() {
  if (closing) return;
  closing = true;
  relay.server.close(finish);
  setTimeout(finish, 1000).unref();
}

process.on("message", function (message) {
  if (message === "close") closeFixture();
});
process.on("SIGINT", closeFixture);
process.on("SIGTERM", closeFixture);

relay.server.listen(0, "127.0.0.1", function () {
  var address = relay.server.address();
  var ready = { port: address.port };
  if (process.send) process.send(ready);
  console.log("CAPSULE_CSP_URL=http://127.0.0.1:" + address.port);
});
