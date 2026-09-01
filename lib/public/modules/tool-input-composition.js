// Composition-safe action binding for declarative Capsule text controls.

var inputStates = new WeakMap();

export function isToolTextInputComposing(input) {
  var state = inputStates.get(input);
  return !!state && state.composing;
}

export function bindToolTextInput(input, commit, options) {
  options = options || {};
  var state = { composing: false, trailingValue: null };
  inputStates.set(input, state);

  function isAlive() {
    return typeof options.isAlive !== "function" || options.isAlive(input);
  }

  input.addEventListener("compositionstart", function () {
    state.composing = true;
    state.trailingValue = null;
  });

  input.addEventListener("beforeinput", function (event) {
    if (state.trailingValue === null && event && (event.isComposing || event.inputType === "insertCompositionText")) {
      state.composing = true;
    }
  });

  input.addEventListener("compositionend", function () {
    state.composing = false;
    state.trailingValue = input.value;
    if (!isAlive()) return;
    commit(input.value);
    if (typeof options.onCompositionEnd === "function") options.onCompositionEnd(input);
  });

  input.addEventListener("input", function (event) {
    if (state.composing || (event && event.isComposing)) return;
    if (state.trailingValue !== null && input.value === state.trailingValue) {
      state.trailingValue = null;
      return;
    }
    state.trailingValue = null;
    if (!isAlive()) return;
    commit(input.value);
  });
}
