// Composition-safe action binding for declarative Capsule text controls.

export function bindToolTextInput(input, commit) {
  var composing = false;
  var committedAtCompositionEnd = null;
  var clearTimer = null;

  function clearDuplicateGuard() {
    committedAtCompositionEnd = null;
    clearTimer = null;
  }

  input.addEventListener("compositionstart", function () {
    composing = true;
    if (clearTimer) clearTimeout(clearTimer);
    clearDuplicateGuard();
  });

  input.addEventListener("compositionend", function () {
    composing = false;
    committedAtCompositionEnd = input.value;
    commit(input.value);
    clearTimer = setTimeout(clearDuplicateGuard, 0);
  });

  input.addEventListener("input", function (event) {
    if (composing || (event && event.isComposing)) return;
    if (committedAtCompositionEnd !== null && input.value === committedAtCompositionEnd) {
      if (clearTimer) clearTimeout(clearTimer);
      clearDuplicateGuard();
      return;
    }
    if (clearTimer) clearTimeout(clearTimer);
    clearDuplicateGuard();
    commit(input.value);
  });
}
