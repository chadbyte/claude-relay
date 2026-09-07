// home-chat-empty-state.js - The Home mate chat's empty conversation stage.

import { getHomeMateShortBio } from './home-mate-selection.js';

export function renderHomeChatEmptyState(messagesEl, suggestionsEl, mate, mateName, onSuggestion) {
  var empty = document.createElement("div");
  empty.className = "home-mate-chat-empty";
  var brand = document.createElement("div");
  brand.className = "home-mate-chat-brand";
  var symbol = document.createElement("img");
  symbol.src = "/clay-studio-symbol.png";
  symbol.alt = "";
  brand.appendChild(symbol);
  var wordmark = document.createElement("span");
  wordmark.className = "home-sidebar-brand-wordmark home-mate-chat-brand-wordmark";
  wordmark.textContent = "Clay Studio";
  brand.appendChild(wordmark);
  empty.appendChild(brand);
  var greeting = document.createElement("h2");
  greeting.textContent = mate ? "What should we work on, " + mateName + "?" : "Getting Home ready...";
  empty.appendChild(greeting);
  var detail = document.createElement("p");
  detail.textContent = mate ? getHomeMateShortBio(mate) : "Loading your Mate and recent conversation.";
  empty.appendChild(detail);
  messagesEl.appendChild(empty);
  suggestionsEl.innerHTML = "";
  if (!mate) return;
  var suggestions = ["Make me a small tool"];
  for (var i = 0; i < suggestions.length; i++) {
    (function (suggestion) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "home-mate-chat-suggestion";
      chip.textContent = suggestion;
      chip.addEventListener("click", function () { onSuggestion(suggestion); });
      suggestionsEl.appendChild(chip);
    })(suggestions[i]);
  }
}
