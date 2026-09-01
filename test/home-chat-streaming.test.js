var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");

function loadStreamState() {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/home-chat-stream-state.js"), "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

test("Home stream promotes a fresh identity, renders notification-visible output, and clears pending once", async function () {
  var stream = await loadStreamState();
  var active = { mateId: "mate-a", requestId: "open-1", sessionId: "local:7" };
  var identity = { mateId: "mate-a", requestId: "open-1", previousSessionId: "local:7", sessionId: "durable-7" };
  active.sessionId = stream.resolveHomeSessionIdentity(active, identity);
  assert.equal(active.sessionId, "durable-7");

  var delta = { mateId: "mate-a", requestId: "open-1", sessionId: "durable-7", text: "Assistant output" };
  assert.equal(stream.isOwnedHomeSessionMessage(active, delta), true);
  var pending = true;
  var streamingText = stream.appendHomeStreamText("", delta.text);
  var notificationPreview = "Assistant output";
  var messages = [{ role: "user", text: "Hello", ts: 1 }];
  messages = stream.finalizeHomeAssistant(messages, streamingText, notificationPreview, 2);
  streamingText = "";
  pending = false;
  assert.equal(messages[1].text, notificationPreview);
  assert.equal(streamingText, "");
  assert.equal(pending, false);

  messages = stream.finalizeHomeAssistant(messages, "", notificationPreview, 3);
  assert.equal(messages.length, 2, "result and done must not duplicate the final assistant bubble");
});

test("Home stream rejects stale request/session identities and supports final-only output", async function () {
  var stream = await loadStreamState();
  var active = { mateId: "mate-a", requestId: "open-current", sessionId: "session-current" };
  assert.equal(stream.isOwnedHomeSessionMessage(active, { mateId: "mate-a", requestId: "open-stale", sessionId: "session-current" }), false);
  assert.equal(stream.isOwnedHomeSessionMessage(active, { mateId: "mate-a", requestId: "open-current", sessionId: "session-stale" }), false);
  assert.equal(stream.resolveHomeSessionIdentity(active, { mateId: "mate-a", requestId: "open-stale", previousSessionId: "session-current", sessionId: "other" }), null);
  assert.equal(stream.resolveHomeSessionIdentity(active, { mateId: "mate-a", requestId: "open-current", previousSessionId: "session-stale", sessionId: "other" }), null);
  var messages = stream.finalizeHomeAssistant([{ role: "user", text: "Question", ts: 1 }], "", "Final-only response", 2);
  assert.deepEqual(messages[1], { role: "assistant", text: "Final-only response", ts: 2 });
  var recovered = stream.finalizeHomeAssistant([{ role: "assistant", text: "Final-only", ts: 1 }], " response", "Final-only response", 2);
  assert.deepEqual(recovered, [{ role: "assistant", text: "Final-only response", ts: 2 }]);
});

test("Home session identity routes once through the narrow pre-router", function () {
  var router = fs.readFileSync(path.join(root, "lib/public/modules/app-message-router.js"), "utf8");
  var legacy = fs.readFileSync(path.join(root, "lib/public/modules/app-messages.js"), "utf8");
  assert.equal((router.match(/msg\.type === "home_mate_session_identity"/g) || []).length, 1);
  assert.equal((router.match(/handleHomeMateSessionIdentity\(msg\)/g) || []).length, 1);
  assert.match(router, /export function handleHomeProtocolMessage\(msg\)/);
  assert.doesNotMatch(router, /handleHomeModelMessage/);
  assert.doesNotMatch(legacy, /home_mate_session_identity|handleHomeMateSessionIdentity/);
});
