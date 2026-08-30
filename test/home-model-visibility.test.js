var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
function source(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }

var indexSource = source("lib/public/index.html");
var appSource = source("lib/public/app.js");
var hubSource = source("lib/public/modules/app-home-hub.js");
var chatSource = source("lib/public/modules/home-mate-chat.js");
var messagesSource = source("lib/public/modules/app-messages.js");
var propertiesSource = source("lib/public/modules/home-mate-properties.js");
var serverSource = source("lib/server-home-chat.js");
var serverModelsSource = source("lib/server-home-models.js");
var sidebarCss = source("lib/public/css/home-sidebar.css");
var hubCss = source("lib/public/css/home-hub.css");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="whats-new-article"'));

test("sidebar Model action continuously exposes the selected Mate default", function () {
  assert.match(homeMarkup, /id="home-sidebar-model"[^>]*home-sidebar-model-action[\s\S]*>Model<\/span>[\s\S]*id="home-sidebar-model-value"/);
  assert.match(hubSource, /var defaultModel = mate \? \(mate\.model \|\| "Choose model"\) : "Loading model…"/);
  assert.match(hubSource, /modelValue\.textContent = defaultModel/);
  assert.match(hubSource, /modelValue\.classList\.toggle\("hidden", !mate && !store\.get\('homeChatMateId'\)\)/);
  assert.match(hubSource, /Default for new conversations: " \+ defaultModel/);
  assert.match(messagesSource, /case "mate_updated":[\s\S]*store\.set\(\{ cachedMatesList: _cml \}\)/);
  assert.match(hubSource, /state\.homeChatMateId !== prev\.homeChatMateId \|\| state\.cachedMatesList !== prev\.cachedMatesList\) renderHomeMateSwitcher\(\)/);
  assert.match(sidebarCss, /\.home-sidebar-action-value \{[\s\S]*color: var\(--text-dimmer\);[\s\S]*text-overflow: ellipsis/);
});

test("composer presents concrete, loading, or accessible Choose model states", function () {
  assert.match(homeMarkup, /home-mate-chat-composer-frame[\s\S]*home-mate-chat-composer[\s\S]*id="home-mate-chat-input"[\s\S]*id="home-mate-chat-session-model"[^>]*role="status"[^>]*aria-live="polite"[^>]*title="Model for this conversation: Loading model…"/);
  assert.match(homeMarkup, />Conversation model<\/span>[\s\S]*id="home-mate-chat-session-model-value">Loading model…<\/span>[\s\S]*id="home-mate-chat-session-model-choose"[^>]*>Choose model<\/button>/);
  assert.match(hubCss, /#home-mate-chat-session-model-choose \{[\s\S]*cursor: pointer/);
  assert.match(chatSource, /sessionModelEl\.setAttribute\("aria-label", "Model for this conversation: " \+ label\)/);
  assert.match(chatSource, /sessionModelChooseEl\.setAttribute\("aria-label", "Choose a model for the current Mate\. Used for new conversations\."\)/);
  assert.match(chatSource, /sessionModelChooseEl\.addEventListener\("click", function \(\) \{ openHomeMateAction\("model"\); \}\)/);
  assert.match(propertiesSource, /clay:home-mate-model-confirmed", \{ detail: \{ mateId: msg\.mateId, model: msg\.model \|\| "" \} \}/);
  assert.match(chatSource, /clay:home-mate-model-confirmed[\s\S]*handleHomeMateModelConfirmed\(event\.detail \|\| \{\}\)/);
  assert.match(chatSource, /handleHomeMateModelConfirmed\(msg\)[\s\S]*msg\.mateId !== store\.get\('homeChatMateId'\)[\s\S]*if \(store\.get\('homeChatSessionModel'\)\) return;[\s\S]*resumeHomeChat\(\)/);
  assert.doesNotMatch(chatSource.slice(chatSource.indexOf("export function handleHomeMateModelConfirmed")), /msg\.ok/);
  assert.match(chatSource, /inputEl\.disabled = !mateId \|\| streaming \|\| !hasCommittedSessionModel\(\)/);
  assert.match(chatSource, /sendBtn\.disabled = !mateId \|\| streaming \|\| !hasCommittedSessionModel\(\)/);
});

test("Home session model state resets before every Mate, session, and new-conversation open", function () {
  assert.match(appSource, /homeChatSessionModel: null,[\s\S]*homeChatSessionVendor: null,[\s\S]*homeChatSessionModelLoading: false/);
  assert.match(chatSource, /function resetHomeSessionModel\(sessionId\)[\s\S]*homeChatSessionModel: null,[\s\S]*homeChatSessionVendor: null,[\s\S]*homeChatSessionModelLoading: true/);
  assert.match(chatSource, /export function openHomeChat\(mateId\)[\s\S]*resetHomeSessionModel\(preferredSession\)/);
  assert.match(chatSource, /export function openHomeConversation\(mateId, sessionId\)[\s\S]*resetHomeSessionModel\(sessionId\)/);
  assert.match(chatSource, /export function startNewHomeConversation\(\)[\s\S]*requestHomeSession\(\{ type: "home_mate_new_session", mateId: mateId \}, null\)/);
  assert.match(chatSource, /message\.requestId = requestId[\s\S]*homeChatSessionModelLoading: true/);
});

test("correlated history owns the displayed model and stale sessions cannot overwrite it", function () {
  assert.match(serverSource, /type: "home_mate_history",[\s\S]*requestId: requestId \|\| null,[\s\S]*model: session\.model \|\| null,[\s\S]*vendor: session\.vendor \|\| null/);
  assert.match(chatSource, /function isCurrentSessionMessage\(msg\)[\s\S]*msg\.requestId !== activeSessionRequestId[\s\S]*msg\.sessionId !== sessionId/);
  assert.match(chatSource, /handleHomeMateHistory\(msg\)[\s\S]*homeChatSessionModel: typeof msg\.model[\s\S]*homeChatSessionVendor: typeof msg\.vendor[\s\S]*homeChatSessionModelLoading: false/);
  assert.match(serverSource, /transformEvent\(event, mateId, session, requestId\)[\s\S]*model: session && session\.model \? session\.model : null,[\s\S]*vendor: session && session\.vendor \? session\.vendor : null/);
});

test("Home failures preserve request correlation while older uncorrelated errors remain compatible", function () {
  assert.match(serverSource, /function sendError\(ws, mateId, text, requestId, sessionId, code\)[\s\S]*sessionId: sessionId \|\| null,[\s\S]*requestId: requestId \|\| null/);
  assert.match(serverSource, /"Conversation not available\.", msg\.requestId \|\| null, msg\.sessionId \|\| null, "session_not_found"/);
  assert.match(serverSource, /var sendRequestId = msg\.requestId \|\| \(sendTap && sendTap\.requestId\) \|\| null/);
  assert.match(chatSource, /home_mate_send", mateId: mateId, sessionId: store\.get\('homeChatSessionId'\), requestId: activeSessionRequestId/);
  assert.match(chatSource, /handleHomeMateError\(msg\) \{\s*if \(!isCurrentSessionMessage\(msg\)\) return/);
  assert.match(chatSource, /if \(msg\.requestId && msg\.requestId !== activeSessionRequestId\) return false/);
});

test("missing committed models require an explicit choice without default inference", function () {
  assert.match(chatSource, /if \(model\) return model;[\s\S]*return "Choose model"/);
  assert.match(chatSource, /msg\.code === "model_unavailable"[\s\S]*homeChatSessionModel: null,[\s\S]*homeChatSessionModelLoading: false/);
  assert.doesNotMatch(hubSource + chatSource + homeMarkup, /Vendor default|[A-Z][A-Za-z ]+ default/);
  assert.doesNotMatch(chatSource, /currentModel|model-picker|mate\.model/);
  assert.doesNotMatch(serverSource.slice(serverSource.indexOf("function sendHistory"), serverSource.indexOf("function handleMessage")), /found\.mate\.model/);
  assert.match(serverModelsSource, /selected = catalogModel\(models, catalog\.defaultModel\)[\s\S]*for \(var i = 0; i < models\.length && !selected; i\+\+\) selected = modelEntryValue\(models\[i\]\)/);
});
