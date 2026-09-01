// Home composer submission bindings and one-shot focus restoration.

export function focusHomeComposerAfterSubmit(input) {
  if (!input || input.disabled || input.isConnected === false) return false;
  var home = typeof input.closest === "function" ? input.closest("#home-hub") : null;
  if (!home || (home.classList && home.classList.contains("hidden"))) return false;
  var ownerDocument = input.ownerDocument || document;
  if (ownerDocument.hidden) return false;
  if (ownerDocument.activeElement === input) return true;
  input.focus({ preventScroll: true });
  return true;
}

export function bindHomeComposerSubmission(input, sendButton, submit) {
  function submitAndRestoreFocus() {
    if (submit() !== true) return false;
    return focusHomeComposerAfterSubmit(input);
  }
  input.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submitAndRestoreFocus();
  });
  sendButton.addEventListener("click", submitAndRestoreFocus);
}
