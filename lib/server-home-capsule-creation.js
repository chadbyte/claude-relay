// Validation and bounded Mate context for a Capsule creation conversation.

function normalizeCapsuleDescription(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, 4000);
}

function readCapsuleCreationIntent(value) {
  if (!value || value.type !== "capsule_creation") return null;
  var description = normalizeCapsuleDescription(value.description);
  if (!description) {
    var error = new Error("Describe the interface you need.");
    error.code = "capsule_description_required";
    throw error;
  }
  return { type: "capsule_creation", description: description };
}

function buildCapsuleCreationPrompt(description) {
  return [
    "Help the user turn the following request into a durable Capsule interface.",
    "First inspect the need conversationally and help refine the behavior, state, and safe declarative UI.",
    "Do not install or update a Capsule until the user has inspected the proposal and explicitly approved it through the existing permission flow.",
    "The Capsule remains user-owned and available to all of the user's Mates.",
    "",
    "<capsule_request>",
    description,
    "</capsule_request>",
  ].join("\n");
}

module.exports = {
  normalizeCapsuleDescription: normalizeCapsuleDescription,
  readCapsuleCreationIntent: readCapsuleCreationIntent,
  buildCapsuleCreationPrompt: buildCapsuleCreationPrompt,
};
