// Safe native Home transcript presentation for a session-bound debate brief.

import { store } from './store.js';
import { refreshIcons } from './icons.js';
var pendingComposerOpener = null;

export function requestHomeDebateComposerFocus() {
  pendingComposerOpener = document.activeElement || document.body;
}

export function restoreHomeDebateComposerFocus(input) {
  if (!pendingComposerOpener) return;
  var opener = pendingComposerOpener;
  if (!document.body || !document.body.classList.contains("home-active")) { pendingComposerOpener = null; return; }
  if (!input || input.disabled) return;
  pendingComposerOpener = null;
  var active = document.activeElement;
  if (active && active !== document.body && active !== opener && active.id !== "home-sidebar-expand") return;
  input.focus({ preventScroll: true });
}

function mateName(mateId) {
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) {
    if (!mates[i] || mates[i].id !== mateId) continue;
    var profile = mates[i].profile || {};
    return profile.displayName || mates[i].displayName || mates[i].name || "Mate";
  }
  return "Mate";
}

function textElement(tag, className, text) {
  var element = document.createElement(tag);
  element.className = className;
  element.textContent = text || "";
  return element;
}

export function createHomeDebateProposalCard(message, respond) {
  var proposal = message.proposal || {};
  var card = document.createElement("section");
  card.className = "debate-brief-card home-debate-proposal";
  card.dataset.proposalId = proposal.proposalId || "";
  card.setAttribute("aria-label", "Debate proposal: " + (proposal.topic || "Untitled debate"));
  var header = textElement("div", "debate-brief-card-header", "Debate proposal");
  card.appendChild(header);
  var body = document.createElement("div");
  body.className = "debate-brief-card-body";
  body.appendChild(textElement("h3", "debate-brief-topic", proposal.topic || "Untitled debate"));
  if (proposal.context) body.appendChild(textElement("p", "debate-brief-context", proposal.context));
  var panelists = Array.isArray(proposal.panelists) ? proposal.panelists : [];
  if (panelists.length) {
    body.appendChild(textElement("div", "debate-brief-panelists-label", "Panel"));
    var list = document.createElement("div");
    list.className = "debate-brief-panelists";
    for (var i = 0; i < panelists.length; i++) {
      var name = mateName(panelists[i].mateId);
      var detail = panelists[i].role ? name + " — " + panelists[i].role : name;
      list.appendChild(textElement("div", "debate-brief-panelist", detail));
    }
    body.appendChild(list);
  }
  card.appendChild(body);
  if (message.error) {
    var error = textElement("p", "home-debate-proposal-error", message.error);
    error.setAttribute("role", "alert");
    card.appendChild(error);
  }
  var actions = document.createElement("div");
  actions.className = "debate-brief-actions";
  if (message.status === "started" || message.status === "cancelled") {
    var label = message.status === "started" ? "Debate started" : "Proposal cancelled";
    var resolved = textElement("span", "debate-brief-resolved-label", label);
    resolved.setAttribute("role", "status");
    actions.appendChild(resolved);
  } else {
    var start = textElement("button", "debate-brief-start-btn", message.status === "submitting" ? "Starting…" : "Start debate");
    start.type = "button";
    start.disabled = message.status === "submitting";
    start.setAttribute("aria-label", "Approve and start this debate");
    start.addEventListener("click", function () { respond(message, "start", start); });
    var cancel = textElement("button", "debate-brief-cancel-btn", "Cancel");
    cancel.type = "button";
    cancel.disabled = message.status === "submitting";
    cancel.setAttribute("aria-label", "Cancel this debate proposal");
    cancel.addEventListener("click", function () { respond(message, "cancel", cancel); });
    actions.appendChild(start);
    actions.appendChild(cancel);
  }
  card.appendChild(actions);
  refreshIcons();
  return card;
}

export function createHomeDebateQuestionCard(message, respond) {
  var question = Array.isArray(message.questions) && message.questions.length ? message.questions[0] : {};
  var card = document.createElement("section");
  card.className = "home-debate-question";
  card.dataset.toolId = message.toolId || "";
  card.setAttribute("aria-busy", message.status === "submitting" ? "true" : "false");
  card.setAttribute("aria-label", "Debate planning question: " + (question.question || "Question"));
  if (question.header) card.appendChild(textElement("div", "home-debate-question-header", question.header));
  card.appendChild(textElement("h3", "home-debate-question-text", question.question || "Clay has a question."));
  var form = document.createElement("div");
  form.className = "home-debate-question-form";
  var options = Array.isArray(question.options) ? question.options.slice(0, 3) : [];
  var selected = "";
  var buttons = [];
  for (var i = 0; i < options.length; i++) {
    (function (option) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "home-debate-question-option";
      button.setAttribute("aria-pressed", "false");
      button.appendChild(textElement("span", "home-debate-question-option-label", option.label || "Option"));
      if (option.description) button.appendChild(textElement("span", "home-debate-question-option-description", option.description));
      button.addEventListener("click", function () {
        if (message.status !== "pending") return;
        selected = option.label || "";
        other.value = "";
        for (var j = 0; j < buttons.length; j++) buttons[j].setAttribute("aria-pressed", buttons[j] === button ? "true" : "false");
        submit.disabled = !selected;
      });
      buttons.push(button);
      form.appendChild(button);
    })(options[i]);
  }
  var otherLabel = textElement("label", "home-debate-question-other-label", "Other");
  var other = document.createElement("input");
  other.type = "text";
  other.className = "home-debate-question-other";
  other.placeholder = "Type another answer";
  otherLabel.appendChild(other);
  form.appendChild(otherLabel);
  var submit = textElement("button", "home-debate-question-submit", message.status === "submitting" ? "Submitting…" : "Submit answer");
  submit.type = "button";
  submit.disabled = message.status !== "pending";
  function submitAnswer() {
    var answer = other.value.trim() || selected;
    if (!answer || message.status !== "pending") return;
    respond(message, "answer", submit, { 0: answer });
  }
  other.addEventListener("input", function () {
    selected = other.value.trim();
    for (var j = 0; j < buttons.length; j++) buttons[j].setAttribute("aria-pressed", "false");
    submit.disabled = !selected;
  });
  other.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitAnswer(); }
  });
  submit.addEventListener("click", submitAnswer);
  form.appendChild(submit);
  if (message.error && message.status !== "expired") {
    var retryError = textElement("p", "home-debate-question-error", message.error);
    retryError.setAttribute("role", "alert");
    retryError.tabIndex = -1;
    form.appendChild(retryError);
  }
  if (message.status === "answered") {
    form.textContent = "";
    var answer = message.answers && message.answers[0] ? String(message.answers[0]) : "Answered";
    var status = textElement("p", "home-debate-question-status", "Answered: " + answer);
    status.setAttribute("role", "status");
    status.tabIndex = -1;
    form.appendChild(status);
  } else if (message.status === "expired") {
    form.textContent = "";
    var expired = textElement("p", "home-debate-question-error", message.error || "This question expired. Ask Clay to repeat it.");
    expired.setAttribute("role", "alert");
    expired.tabIndex = -1;
    form.appendChild(expired);
  }
  card.appendChild(form);
  return card;
}

export function createHomeDebateTranscriptCard(message, respond) {
  return message.role === "question" ? createHomeDebateQuestionCard(message, respond) : createHomeDebateProposalCard(message, respond);
}

export function markHomeDebateProposalSubmitting(message, opener) {
  message.status = "submitting";
  var actions = opener && opener.parentNode;
  var controls = actions ? actions.children : [];
  for (var i = 0; i < controls.length; i++) controls[i].disabled = true;
  if (opener && opener.textContent === "Start debate") opener.textContent = "Starting…";
}

export function restoreHomeDebateProposalFocus(proposalId) {
  if (!proposalId || !document.querySelectorAll) return;
  var cards = document.querySelectorAll(".home-debate-proposal");
  for (var i = 0; i < cards.length; i++) {
    if (!cards[i].dataset || cards[i].dataset.proposalId !== proposalId) continue;
    var target = cards[i].querySelector('[role="status"]') || cards[i].querySelector(".debate-brief-start-btn");
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    return;
  }
}

export function normalizeHomeTranscript(raw) {
  return (raw || []).filter(function (message) {
    return message && ((message.role === "proposal" && message.proposal) || (message.role === "question" && message.toolId) || ((message.role === "user" || message.role === "assistant") && typeof message.text === "string"));
  }).map(function (message) {
    if (message.role === "proposal") return { role: "proposal", proposal: message.proposal, status: message.status || "pending", error: message.error || "" };
    if (message.role === "question") return { role: "question", toolId: message.toolId, questions: message.questions || [], status: message.status || "pending", answers: message.answers || null, error: message.error || "" };
    return { role: message.role, text: message.text, ts: message.ts || 0 };
  });
}

export function applyHomeDebateQuestion(messages, msg) {
  if (!msg || !msg.toolId) return messages;
  for (var i = 0; i < messages.length; i++) if (messages[i].role === "question" && messages[i].toolId === msg.toolId) return messages;
  return messages.concat([{ role: "question", toolId: msg.toolId, questions: msg.questions || [], status: "pending", error: "" }]);
}

export function resolveHomeDebateQuestion(messages, msg) {
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role !== "question" || messages[i].toolId !== msg.toolId) continue;
    messages[i] = Object.assign({}, messages[i], { status: msg.status === "answered" ? "answered" : "expired", answers: msg.answers || null, error: msg.error || "" });
  }
  return messages;
}

export function failHomeDebateQuestion(messages, msg) {
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "question" || (messages[i].status !== "pending" && messages[i].status !== "submitting")) continue;
    messages[i] = Object.assign({}, messages[i], { status: "pending", error: msg.text || "The answer could not be submitted. Try again." });
    break;
  }
  return messages;
}

export function hasPendingHomeDebateQuestion(messages) {
  for (var i = 0; i < messages.length; i++) if (messages[i].role === "question" && (messages[i].status === "pending" || messages[i].status === "submitting")) return true;
  return false;
}

export function markHomeDebateQuestionSubmitting(message, opener) {
  message.status = "submitting";
  var form = opener && opener.parentNode;
  function disableControls(node) {
    if (!node) return;
    if (node.tagName === "BUTTON" || node.tagName === "INPUT") node.disabled = true;
    var children = node.children || [];
    for (var i = 0; i < children.length; i++) disableControls(children[i]);
  }
  disableControls(form);
  if (opener) opener.textContent = "Submitting…";
}

export function createHomeDebateResponder(sendMessage, getContext) {
  return function respond(message, action, opener, answers) {
    if (!message || message.status === "submitting") return;
    var payload = message.role === "question" ? { type: "home_debate_question_response", toolId: message.toolId, answers: answers || {} } : { type: "home_debate_proposal_response", proposalId: message.proposal.proposalId, action: action };
    Object.assign(payload, getContext());
    if (!sendMessage(payload)) return;
    if (message.role === "question") markHomeDebateQuestionSubmitting(message, opener);
    else markHomeDebateProposalSubmitting(message, opener);
  };
}

export function restoreHomeDebateQuestionFocus(toolId) {
  if (!toolId || !document.querySelectorAll) return;
  var cards = document.querySelectorAll(".home-debate-question");
  for (var i = 0; i < cards.length; i++) {
    if (!cards[i].dataset || cards[i].dataset.toolId !== toolId) continue;
    var target = cards[i].querySelector('[role="status"]') || cards[i].querySelector('[role="alert"]');
    if (target) target.focus({ preventScroll: true });
    return;
  }
}

export function applyHomeDebateProposal(messages, msg) {
  var id = msg && msg.proposal && msg.proposal.proposalId;
  if (!id) return messages;
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role === "proposal" && messages[i].proposal.proposalId === id) return messages;
  }
  return messages.concat([{ role: "proposal", proposal: msg.proposal, status: "pending" }]);
}

export function resolveHomeDebateProposal(messages, msg) {
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role !== "proposal" || messages[i].proposal.proposalId !== msg.proposalId) continue;
    messages[i] = Object.assign({}, messages[i], { status: msg.action === "start" ? "started" : (msg.action === "cancel" ? "cancelled" : "pending"), error: msg.action === "error" ? (msg.error || "The debate could not be started.") : "" });
  }
  return messages;
}
