// home-board.js - Home work board (kanban) rendering and interaction.
// Cards live server-side in the per-user board datastore; this module renders
// them into the home hub and sends board_* messages for every mutation.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml, showToast } from './utils.js';
import { showConfirm } from './app-misc.js';
import { markDockToolChanged } from './home-dock.js';

var COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "doing", label: "Doing" },
  { key: "done", label: "Done" },
];

var boardEl = null;
var composerColumn = null;
var dragCardId = null;
var focusCardTarget = null;

function escapeAttribute(value) {
  return escapeHtml(String(value || "")).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function columnLabel(columnKey) {
  for (var i = 0; i < COLUMNS.length; i++) {
    if (COLUMNS[i].key === columnKey) return COLUMNS[i].label;
  }
  return "Board";
}

function cardCountLabel(count) {
  return count + (count === 1 ? " card" : " cards");
}

function sendBoard(msg) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

export function requestBoard() {
  sendBoard({ type: "board_list" });
}

function getCards() {
  return store.get('boardCards') || [];
}

function cardsInColumn(column) {
  var cards = getCards().filter(function (card) {
    return card.column === column;
  });
  cards.sort(function (a, b) {
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt - b.createdAt;
  });
  return cards;
}

function upsertCard(card) {
  if (!card || !card._id) return;
  var cards = getCards().slice();
  var replaced = false;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i]._id === card._id) {
      cards[i] = card;
      replaced = true;
      break;
    }
  }
  if (!replaced) cards.push(card);
  store.set({ boardCards: cards });
}

function removeCard(cardId) {
  var cards = getCards().filter(function (card) {
    return card._id !== cardId;
  });
  store.set({ boardCards: cards });
}

// --- Incoming messages -----------------------------------------------------

export function handleBoardState(msg) {
  store.set({ boardCards: msg.cards || [] });
  renderBoard();
}

export function handleBoardCardChanged(msg) {
  upsertCard(msg.card);
  renderBoard();
  markDockToolChanged("board");
}

export function handleBoardCardDeleted(msg) {
  removeCard(msg.cardId);
  renderBoard();
  markDockToolChanged("board");
}

export function handleBoardError(msg) {
  focusCardTarget = null;
  showToast(msg.message || "Board operation failed", "error");
}

// --- Rendering -------------------------------------------------------------

function cardHtml(card) {
  var cardId = escapeAttribute(card._id);
  var cardTitle = escapeHtml(card.title || "Untitled card");
  var accessibleTitle = escapeAttribute((card.title || "Untitled card") + ", " + columnLabel(card.column)
    + (card.pendingDone ? ", completion awaiting confirmation" : ""));
  var pending = card.pendingDone
    ? '<div class="board-card-pending" id="board-card-pending-' + cardId + '">'
      + '<span class="board-card-pending-text">Mate says this is done</span>'
      + '<span class="board-card-pending-actions">'
      + '<button type="button" class="board-done-accept" data-id="' + cardId + '">Confirm</button>'
      + '<button type="button" class="board-done-reject" data-id="' + cardId + '">Not yet</button>'
      + '</span></div>'
    : '';
  var meta = [];
  if (card.assignee) meta.push('<span class="board-card-assignee">' + escapeHtml(card.assignee) + '</span>');
  if (card.projectId) meta.push('<span class="board-card-project">' + escapeHtml(card.projectId) + '</span>');
  var metaHtml = meta.length ? '<div class="board-card-meta">' + meta.join("") + '</div>' : '';
  var body = card.body
    ? '<div class="board-card-body">' + escapeHtml(card.body) + '</div>'
    : '';

  return '<article class="board-card' + (card.pendingDone ? ' is-pending' : '') + '"'
    + ' draggable="true" tabindex="0" role="listitem" data-id="' + cardId + '"'
    + ' aria-label="' + accessibleTitle + '" aria-describedby="home-board-keyboard-help"'
    + ' aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight">'
    + '<button type="button" class="board-card-delete" data-id="' + cardId + '" aria-label="Delete ' + escapeAttribute(card.title || "card") + '">'
    + '<span aria-hidden="true">&times;</span></button>'
    + '<div class="board-card-title">' + cardTitle + '</div>'
    + body + metaHtml + pending
    + '</article>';
}

function columnHtml(column) {
  var cards = cardsInColumn(column.key);
  var composer = composerColumn === column.key
    ? '<div class="board-composer">'
      + '<textarea class="board-composer-input" rows="2" aria-label="Card title" placeholder="Card title"></textarea>'
      + '<div class="board-composer-actions">'
      + '<button type="button" class="board-composer-add">Add</button>'
      + '<button type="button" class="board-composer-cancel">Cancel</button>'
      + '</div></div>'
    : '';
  var titleId = "board-column-title-" + column.key;
  var empty = cards.length ? '' : '<div class="board-column-empty">No cards</div>';

  return '<section class="board-column" data-column="' + column.key + '" aria-labelledby="' + titleId + '">'
    + '<div class="board-column-header">'
    + '<h3 class="board-column-title" id="' + titleId + '">' + column.label + '</h3>'
    + '<span class="board-column-count" aria-label="' + cardCountLabel(cards.length) + '">' + cards.length + '</span>'
    + '</div>'
    + '<div class="board-column-cards" role="list" aria-label="' + column.label + ' cards">' + cards.map(cardHtml).join("") + empty + '</div>'
    + composer
    + '<button type="button" class="board-add-btn" data-column="' + column.key + '" aria-label="Add card to ' + column.label + '">+ Add card</button>'
    + '</section>';
}

export function renderBoard() {
  if (!boardEl) return;
  boardEl.innerHTML = '<p id="home-board-keyboard-help" class="board-keyboard-help">Use Alt plus Left or Right Arrow to move a focused card between columns.</p>'
    + COLUMNS.map(columnHtml).join("");
  bindBoardEvents();
  restoreCardFocus();
}

export function renderBoardNode(node) {
  var element = document.createElement("div");
  element.className = "home-board";
  element.setAttribute("role", "region");
  element.setAttribute("aria-label", "Work board");
  if (node && node.id) element.id = node.id;
  boardEl = element;
  renderBoard();
  return element;
}

export function renderBoardCardNode(node, state, item) {
  var card = item || (node && node.props && node.props.card) || null;
  if (!card) return document.createElement("div");
  var holder = document.createElement("div");
  holder.innerHTML = cardHtml(card);
  return holder.firstElementChild;
}

// --- Interaction -----------------------------------------------------------

function openComposer(column) {
  composerColumn = column;
  renderBoard();
  var input = boardEl.querySelector(".board-composer-input");
  if (input) input.focus();
}

function closeComposer(focusColumn) {
  composerColumn = null;
  renderBoard();
  var buttons = boardEl.querySelectorAll(".board-add-btn");
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].dataset.column === focusColumn) buttons[i].focus();
  }
}

function submitComposer() {
  var input = boardEl.querySelector(".board-composer-input");
  if (!input) return;
  var title = input.value.trim();
  if (!title) {
    input.focus();
    return;
  }
  var column = composerColumn;
  sendBoard({
    type: "board_card_create",
    fields: { title: title, column: column },
  });
  closeComposer(column);
}

function moveCard(cardId, targetColumn, restoreFocus) {
  var cards = getCards();
  for (var i = 0; i < cards.length; i++) {
    if (cards[i]._id !== cardId) continue;
    if (cards[i].column === targetColumn) return;
    if (sendBoard({ type: "board_card_move", cardId: cardId, column: targetColumn }) && restoreFocus) {
      focusCardTarget = { cardId: cardId, column: targetColumn };
    }
    return;
  }
}

function moveCardByKeyboard(cardId, direction) {
  var cards = getCards();
  for (var i = 0; i < cards.length; i++) {
    if (cards[i]._id !== cardId) continue;
    for (var j = 0; j < COLUMNS.length; j++) {
      if (COLUMNS[j].key !== cards[i].column) continue;
      var targetIndex = j + direction;
      if (targetIndex < 0 || targetIndex >= COLUMNS.length) return;
      moveCard(cardId, COLUMNS[targetIndex].key, true);
      return;
    }
  }
}

function restoreCardFocus() {
  if (!focusCardTarget) return;
  var cards = boardEl.querySelectorAll(".board-card");
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].dataset.id !== focusCardTarget.cardId) continue;
    var column = cards[i].closest(".board-column");
    if (!column || column.dataset.column !== focusCardTarget.column) return;
    focusCardTarget = null;
    cards[i].focus();
    return;
  }
}

function bindBoardEvents() {
  var addButtons = boardEl.querySelectorAll(".board-add-btn");
  addButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      openComposer(btn.dataset.column);
    });
  });

  var addBtn = boardEl.querySelector(".board-composer-add");
  if (addBtn) addBtn.addEventListener("click", submitComposer);

  var cancelBtn = boardEl.querySelector(".board-composer-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function () {
      closeComposer(composerColumn);
    });
  }

  var composerInput = boardEl.querySelector(".board-composer-input");
  if (composerInput) {
    composerInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitComposer();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeComposer(composerColumn);
      }
    });
  }

  boardEl.querySelectorAll(".board-card-delete").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var id = btn.dataset.id;
      showConfirm("Delete this card?", function () {
        sendBoard({ type: "board_card_delete", cardId: id });
      }, "Delete", true);
    });
  });

  boardEl.querySelectorAll(".board-done-accept").forEach(function (btn) {
    btn.addEventListener("click", function () {
      sendBoard({ type: "board_done_confirm", cardId: btn.dataset.id, accept: true });
    });
  });

  boardEl.querySelectorAll(".board-done-reject").forEach(function (btn) {
    btn.addEventListener("click", function () {
      sendBoard({ type: "board_done_confirm", cardId: btn.dataset.id, accept: false });
    });
  });

  boardEl.querySelectorAll(".board-card").forEach(function (cardEl) {
    cardEl.addEventListener("keydown", function (e) {
      if (e.target !== cardEl) return;
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      moveCardByKeyboard(cardEl.dataset.id, e.key === "ArrowLeft" ? -1 : 1);
    });
    cardEl.addEventListener("dragstart", function (e) {
      dragCardId = cardEl.dataset.id;
      cardEl.classList.add("is-dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragCardId);
      }
    });
    cardEl.addEventListener("dragend", function () {
      dragCardId = null;
      cardEl.classList.remove("is-dragging");
    });
  });

  boardEl.querySelectorAll(".board-column").forEach(function (columnEl) {
    columnEl.addEventListener("dragover", function (e) {
      e.preventDefault();
      columnEl.classList.add("is-drop-target");
    });
    columnEl.addEventListener("dragleave", function () {
      columnEl.classList.remove("is-drop-target");
    });
    columnEl.addEventListener("drop", function (e) {
      e.preventDefault();
      columnEl.classList.remove("is-drop-target");
      if (!dragCardId) return;
      var target = columnEl.dataset.column;
      moveCard(dragCardId, target, false);
    });
  });
}
