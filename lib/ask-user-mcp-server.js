// Backward-compatible export for callers migrating to YOKE user input.
var userInput = require("./yoke/user-input");

module.exports = {
  getToolDefs: userInput.fallbackToolDefs,
};
