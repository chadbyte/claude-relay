var assert = require("node:assert/strict");
var childProcess = require("node:child_process");
var http = require("node:http");
var path = require("node:path");
var test = require("node:test");

function startFixture() {
  return new Promise(function (resolve, reject) {
    var child = childProcess.fork(path.join(__dirname, "fixtures/capsule-csp-server.js"), [], { silent: true });
    var settled = false;
    child.stdout.on("data", function () {});
    child.stderr.on("data", function () {});
    child.once("message", function (message) {
      settled = true;
      resolve({ child: child, port: message.port });
    });
    child.once("error", reject);
    child.once("exit", function (code) {
      if (!settled) reject(new Error("Capsule CSP fixture exited before listening with code " + code + "."));
    });
  });
}

function stopFixture(child) {
  return new Promise(function (resolve) {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", function () { resolve(); });
    child.send("close");
  });
}

function requestRoot(port) {
  return new Promise(function (resolve, reject) {
    http.get({ host: "127.0.0.1", port: port, path: "/" }, function (response) {
      response.resume();
      response.once("end", function () { resolve(response); });
    }).once("error", reject);
  });
}

function parseDirectives(value) {
  return value.split(";").map(function (directive) {
    return directive.trim().split(/\s+/).filter(Boolean);
  }).filter(function (directive) { return directive.length > 0; });
}

function findDirective(directives, name) {
  for (var i = 0; i < directives.length; i++) {
    if (directives[i][0] === name) return directives[i];
  }
  return null;
}

test("real Clay response permits only self and Blob Capsule workers", async function () {
  var fixture = await startFixture();
  try {
    var response = await requestRoot(fixture.port);
    assert.equal(response.statusCode, 200);
    var csp = response.headers["content-security-policy"];
    assert.equal(typeof csp, "string");
    var directives = parseDirectives(csp);
    assert.deepEqual(findDirective(directives, "worker-src"), ["worker-src", "'self'", "blob:"]);
    assert.equal(directives.filter(function (directive) { return directive[0] === "worker-src"; }).length, 1);
    assert.deepEqual(findDirective(directives, "script-src"), ["script-src", "'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://esm.sh"]);
    assert.equal(findDirective(directives, "script-src").indexOf("blob:"), -1);
    assert.deepEqual(findDirective(directives, "default-src"), ["default-src", "'self'"]);
  } finally {
    await stopFixture(fixture.child);
  }
});
