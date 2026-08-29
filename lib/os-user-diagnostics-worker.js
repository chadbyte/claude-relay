// Runs blocking OS-user diagnostics outside the daemon process.

var diagnostics = require("./os-user-diagnostics");
var input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", function(chunk) {
  input += chunk;
});
process.stdin.on("end", function() {
  try {
    var options = JSON.parse(input);
    var result = diagnostics.collectOsUserDiagnostics(options);
    process.stdout.write(JSON.stringify({ summary: diagnostics.summarizeDiagnostics(result) }));
  } catch (e) {
    process.exitCode = 1;
  }
});
