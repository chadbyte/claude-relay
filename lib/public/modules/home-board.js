// home-board.js - Home work board (kanban) rendering and interaction.
// Cards live server-side in the per-user board datastore; this module renders
// them into the home hub and sends board_* messages for every mutation.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml, showToast } from './utils.js';
import { showConfirm } from './app-misc.js';

var COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "doing", label: "Doing" },
  { key: "done", label: "Done" },
];

var boardEl = null;
var composerColumn = null;
var dragCardId = null;

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
}

export function handleBoardCardDeleted(msg) {
  removeCard(msg.cardId);
  renderBoard();
}

export function handleBoardError(msg) {
  showToast(msg.message || "Board operation failed", "error");
}

// --- Rendering -------------------------------------------------------------

function cardHtml(card) {
  var pending = card.pendingDone
    ? '<div class="board-card-pending">'
      + '<span class="board-card-pending-text">Mate says this is done</span>'
      + '<span class="board-card-pending-actions">'
      + '<button class="board-done-accept" data-id="' + escapeHtml(card._id) + '">Confirm</button>'
      + '<button class="board-done-reject" data-id="' + escapeHtml(card._id) + '">Not yet</button>'
      + '</span></div>'
    : '';
  var meta = [];
  if (card.assignee) meta.push('<span class="board-card-assignee">' + escapeHtml(card.assignee) + '</span>');
  if (card.projectId) meta.push('<span class="board-card-project">' + escapeHtml(card.projectId) + '</span>');
  var metaHtml = meta.length ? '<div class="board-card-meta">' + meta.join("") + '</div>' : '';
  var body = card.body
    ? '<div class="board-card-body">' + escapeHtml(card.body) + '</div>'
    : '';

  return '<div class="board-card' + (card.pendingDone ? ' is-pending' : '') + '"'
    + ' draggable="true" data-id="' + escapeHtml(card._id) + '">'
    + '<button class="board-card-delete" data-id="' + escapeHtml(card._id) + '" title="Delete card">&times;</button>'
    + '<div class="board-card-title">' + escapeHtml(card.title) + '</div>'
    + body + metaHtml + pending
    + '</div>';
}

function columnHtml(column) {
  var cards = cardsInColumn(column.key);
  var composer = composerColumn === column.key
    ? '<div class="board-composer">'
      + '<textarea class="board-composer-input" rows="2" placeholder="Card title"></textarea>'
      + '<div class="board-composer-actions">'
      + '<button class="board-composer-add">Add</button>'
      + '<button class="board-composer-cancel">Cancel</button>'
      + '</div></div>'
    : '';

  return '<div class="board-column" data-column="' + column.key + '">'
    + '<div class="board-column-header">'
    + '<span class="board-column-title">' + column.label + '</span>'
    + '<span class="board-column-count">' + cards.length + '</span>'
    + '</div>'
    + '<div class="board-column-cards">' + cards.map(cardHtml).join("") + '</div>'
    + composer
    + '<button class="board-add-btn" data-column="' + column.key + '">+ Add card</button>'
    + '</div>';
}

export function renderBoard() {
  if (!boardEl) boardEl = document.getElementById("home-board");
  if (!boardEl) return;
  boardEl.innerHTML = COLUMNS.map(columnHtml).join("");
  bindBoardEvents();
}

// --- Interaction -----------------------------------------------------------

function openComposer(column) {
  composerColumn = column;
  renderBoard();
  var input = boardEl.querySelector(".board-composer-input");
  if (input) input.focus();
}

function submitComposer() {
  var input = boardEl.querySelector(".board-composer-input");
  if (!input) return;
  var title = input.value.trim();
  if (!title) {
    composerColumn = null;
    renderBoard();
    return;
  }
  sendBoard({
    type: "board_card_create",
    fields: { title: title, column: composerColumn },
  });
  composerColumn = null;
  renderBoard();
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
      composerColumn = null;
      renderBoard();
    });
  }

  var composerInput = boardEl.querySelector(".board-composer-input");
  if (composerInput) {
    composerInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitComposer();
      } else if (e.key === "Escape") {
        composerColumn = null;
        renderBoard();
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
    cardEl.addEventListener("dragstart", function () {
      dragCardId = cardEl.dataset.id;
      cardEl.classList.add("is-dragging");
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
      var cards = getCards();
      for (var i = 0; i < cards.length; i++) {
        if (cards[i]._id === dragCardId && cards[i].column === target) return;
      }
      sendBoard({ type: "board_card_move", cardId: dragCardId, column: target });
    });
  });
}
