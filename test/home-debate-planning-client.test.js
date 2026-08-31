var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function FakeElement(tag) {
  this.tagName = tag.toUpperCase();
  this.children = [];
  this.attributes = {};
  this.listeners = {};
  this.className = "";
  this.textContent = "";
  this.disabled = false;
  this.dataset = {};
  this.value = "";
  this.tabIndex = 0;
}
FakeElement.prototype.appendChild = function (child) { this.children.push(child); child.parentNode = this; return child; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.addEventListener = function (name, handler) { this.listeners[name] = handler; };
FakeElement.prototype.click = function () { if (this.listeners.click) this.listeners.click({ currentTarget: this }); };
FakeElement.prototype.focus = function (options) { this.focusOptions = options; };

function flatten(root) {
  var result = [root];
  for (var i = 0; i < root.children.length; i++) result = result.concat(flatten(root.children[i]));
  return result;
}

test("Home debate proposal card is safe, accessible, keyboard-native, and server-confirmed", async function () {
  var originals = { document: global.document, requestAnimationFrame: global.requestAnimationFrame, lucide: global.lucide };
  global.document = { createElement: function (tag) { return new FakeElement(tag); } };
  global.requestAnimationFrame = function () { return 1; };
  global.lucide = { createIcons: function () {} };
  try {
    var storeModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/store.js")).href);
    storeModule.createStore({ cachedMatesList: [{ id: "panel-1", name: "Analyst" }] });
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
    var calls = [];
    var message = { role: "proposal", status: "pending", proposal: { proposalId: "dp-1", topic: "<img src=x onerror=bad>", panelists: [{ mateId: "panel-1", role: "Skeptic" }] } };
    var card = module.createHomeDebateProposalCard(message, function (selected, action, opener) { calls.push([selected, action, opener]); });
    var nodes = flatten(card);
    var start = nodes.find(function (node) { return node.attributes["aria-label"] === "Approve and start this debate"; });
    var cancel = nodes.find(function (node) { return node.attributes["aria-label"] === "Cancel this debate proposal"; });
    assert.ok(start);
    assert.ok(cancel);
    assert.equal(card.attributes["aria-label"], "Debate proposal: <img src=x onerror=bad>");
    assert.equal(nodes.some(function (node) { return Object.prototype.hasOwnProperty.call(node, "innerHTML") && node.innerHTML; }), false);
    start.click();
    assert.deepEqual(calls[0], [message, "start", start]);
    module.markHomeDebateProposalSubmitting(message, start);
    assert.equal(message.status, "submitting");
    assert.equal(start.disabled, true);
    assert.equal(cancel.disabled, true);
    assert.equal(start.textContent, "Starting…");
    var resolved = module.resolveHomeDebateProposal([message], { proposalId: "dp-1", action: "start" });
    var resolvedCard = module.createHomeDebateProposalCard(resolved[0], function () {});
    var status = flatten(resolvedCard).find(function (node) { return node.attributes.role === "status"; });
    assert.equal(status.textContent, "Debate started");
  } finally {
    global.document = originals.document;
    global.requestAnimationFrame = originals.requestAnimationFrame;
    global.lucide = originals.lucide;
  }
});

test("Home transcript proposal state rejects duplicates and restores cancel status", async function () {
  var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
  var proposal = { proposalId: "dp-restore", topic: "Restored" };
  var messages = module.normalizeHomeTranscript([{ role: "assistant", text: "Ready" }, { role: "proposal", proposal: proposal, status: "cancelled" }]);
  messages = module.applyHomeDebateProposal(messages, { proposal: proposal });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].status, "cancelled");
});

test("Home AskUserQuestion card safely submits options or Other and restores persisted state", async function () {
  var originalDocument = global.document;
  global.document = { createElement: function (tag) { return new FakeElement(tag); } };
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
    var calls = [];
    var message = { role: "question", toolId: "tool-<unsafe>", status: "pending", questions: [{ header: "Direction", question: "Which outcome? <script>bad()</script>", options: [{ label: "Decision", description: "Choose one path" }, { label: "Trade-offs", description: "Compare costs" }] }] };
    var card = module.createHomeDebateQuestionCard(message, function (selected, action, opener, answers) { calls.push({ selected: selected, action: action, opener: opener, answers: answers }); });
    var nodes = flatten(card);
    var option = nodes.find(function (node) { return node.className === "home-debate-question-option"; });
    var submit = nodes.find(function (node) { return node.className === "home-debate-question-submit"; });
    assert.equal(card.dataset.toolId, "tool-<unsafe>");
    assert.equal(nodes.some(function (node) { return Object.prototype.hasOwnProperty.call(node, "innerHTML") && node.innerHTML; }), false);
    option.click();
    assert.equal(option.attributes["aria-pressed"], "true");
    submit.click();
    assert.deepEqual(calls[0].answers, { 0: "Decision" });
    var restored = module.normalizeHomeTranscript([{ role: "question", toolId: "tool-1", questions: message.questions, status: "pending" }]);
    assert.equal(module.hasPendingHomeDebateQuestion(restored), true);
    restored = module.resolveHomeDebateQuestion(restored, { toolId: "tool-1", status: "expired", error: "Expired" });
    assert.equal(restored[0].status, "expired");
    assert.equal(module.hasPendingHomeDebateQuestion(restored), false);
  } finally {
    global.document = originalDocument;
  }
});

test("Home debate responder sends exact session correlation once and locks the question", async function () {
  var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
  var sent = [];
  var message = { role: "question", toolId: "ask-1", status: "pending" };
  var opener = { textContent: "Submit answer", tagName: "BUTTON", disabled: false, parentNode: { children: [{ tagName: "BUTTON", disabled: false }, { tagName: "INPUT", disabled: false }] } };
  var respond = module.createHomeDebateResponder(function (payload) { sent.push(payload); return true; }, function () { return { mateId: "builtin:clay", sessionId: "cli-1", requestId: "req-1" }; });
  respond(message, "answer", opener, { 0: "Decision" });
  respond(message, "answer", opener, { 0: "Duplicate" });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { type: "home_debate_question_response", toolId: "ask-1", answers: { 0: "Decision" }, mateId: "builtin:clay", sessionId: "cli-1", requestId: "req-1" });
  assert.equal(message.status, "submitting");
  assert.equal(opener.parentNode.children[0].disabled, true);
});

test("Home debate question resolution restores focus without scrolling and errors remain retryable", async function () {
  var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
  var target = { focusOptions: null, focus: function (options) { this.focusOptions = options; } };
  var originalDocument = global.document;
  try {
    global.document = { querySelectorAll: function () { return [{ dataset: { toolId: "ask-focus" }, querySelector: function () { return target; } }]; } };
    module.restoreHomeDebateQuestionFocus("ask-focus");
    assert.deepEqual(target.focusOptions, { preventScroll: true });
    var messages = [{ role: "question", toolId: "ask-focus", status: "submitting", questions: [] }];
    messages = module.failHomeDebateQuestion(messages, { text: "Try again" });
    assert.equal(messages[0].status, "pending");
    assert.equal(messages[0].error, "Try again");
  } finally {
    global.document = originalDocument;
  }
});

test("debate planning restores the composer with preventScroll without stealing later intentional focus", async function () {
  var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
  var originalDocument = global.document;
  var opener = { id: "home-sidebar-debate" };
  var body = { classList: { contains: function (name) { return name === "home-active"; } } };
  var focusOptions = null;
  var input = { disabled: false, focus: function (options) { focusOptions = options; } };
  try {
    global.document = { activeElement: opener, body: body };
    module.requestHomeDebateComposerFocus();
    global.document.activeElement = { id: "home-sidebar-expand" };
    input.disabled = true;
    module.restoreHomeDebateComposerFocus(input);
    assert.equal(focusOptions, null);
    input.disabled = false;
    module.restoreHomeDebateComposerFocus(input);
    assert.deepEqual(focusOptions, { preventScroll: true });
    focusOptions = null;
    global.document.activeElement = opener;
    module.requestHomeDebateComposerFocus();
    global.document.activeElement = { id: "capsules-button" };
    module.restoreHomeDebateComposerFocus(input);
    assert.equal(focusOptions, null);
  } finally {
    global.document = originalDocument;
  }
});

test("Home Start debate source selects builtin Clay, uses the native protocol, and closes the mobile drawer toward chat", function () {
  var root = path.join(__dirname, "..");
  var chat = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
  var sidebar = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
  var router = fs.readFileSync(path.join(root, "lib/public/modules/app-message-router.js"), "utf8");
  var project = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  var schema = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");
  var debateEngine = fs.readFileSync(path.join(root, "lib/project-debate.js"), "utf8");
  var css = fs.readFileSync(path.join(root, "lib/public/css/home-debate-planning.css"), "utf8");
  assert.match(chat, /builtinKey === "clay"/);
  assert.match(chat, /type: "home_mate_debate_plan"/);
  assert.doesNotMatch(chat, /openDebateModal|clay:home-debate/);
  assert.match(sidebar, /closeNarrowDrawer\(kind === "debate"\)/);
  assert.match(router, /home_debate_question[\s\S]*handleHomeDebateTranscript/);
  assert.match(router, /home_debate_proposal_resolved[\s\S]*handleHomeDebateTranscript/);
  assert.match(project, /home_debate_question_response[\s\S]*opts\.onDmMessage\(ws, msg\)/);
  assert.match(project, /session && session\.debateSetupMode === true \? _askUser\.getToolDefs\(session\) : \[\]/);
  assert.match(schema, /"home_debate_question_response"[\s\S]*"home_debate_question"[\s\S]*"home_debate_question_resolved"/);
  assert.match(debateEngine, /function startDebateLive\(session, targetWs\)[\s\S]*createSession\(liveOpts, targetWs \|\| null\)/);
  assert.match(project, /_clayHomeDebateSlug[\s\S]*homeDebateCtx\.handleMessage\(ws, msg\)/);
  assert.match(project, /homeDebateClients[\s\S]*_clayHomeDebateSlug === slug[\s\S]*ws\.send\(data\)/);
  assert.match(debateEngine, /_homeChatTap\.mateSlug === ctx\.slug[\s\S]*registerHomeDebateClient\(homeWs\)[\s\S]*startDebateLive\(session, homeWs\)/);
  assert.match(css, /\.home-debate-proposal button:focus-visible/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.home-debate-proposal/);
  assert.match(css, /\.home-debate-question button:focus-visible/);
});

test("Home debate launch immediately renders a dedicated correlated loading transcript", async function () {
  var originalDocument = global.document;
  global.document = { createElement: function (tag) { return new FakeElement(tag); } };
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-launch.js")).href);
    module.resetHomeDebateLaunch();
    module.beginHomeDebateLaunch("plan-loading");
    assert.equal(module.isHomeDebateLaunching(), true);
    var row = module.createHomeDebateLaunchRow();
    assert.equal(row.attributes.role, "status");
    assert.equal(flatten(row).some(function (node) { return node.textContent === "Preparing debate…"; }), true);
    assert.equal(module.settleHomeDebateLaunch({ requestId: "stale" }), false);
    assert.equal(module.isHomeDebateLaunching(), true);
    module.syncHomeDebateLaunchHistory({ requestId: "plan-loading", debatePlanning: true, messages: [] });
    assert.equal(module.isHomeDebateLaunching(), true);
    assert.equal(module.settleHomeDebateLaunch({ requestId: "plan-loading", type: "home_debate_question" }), true);
    assert.equal(module.isHomeDebateLaunching(), false);
  } finally {
    global.document = originalDocument;
  }
  var chat = fs.readFileSync(path.join(__dirname, "../lib/public/modules/home-mate-chat.js"), "utf8");
  assert.match(chat, /var hasConversation = debateLaunching \|\| messages\.length/);
  assert.match(chat, /inputEl\.disabled = debateLaunching \|\|/);
  assert.match(chat, /debateLaunching \? "Preparing debate…"/);
  assert.match(chat, /if \(debateLaunching\) \{\s*transcript\.appendChild\(createHomeDebateLaunchRow\(\)\)/);
});
