// Terminal-safe Clay Studio wordmarks. The wide form uses a Roman serif
// construction; the compact form preserves the mixed-case silhouette.

var WIDE_WORDMARK = [
  "              ,,                                                         ,,    ,,",
  "  .g8\"\"\"bgd `7MM                         .M\"\"\"bgd mm                   `7MM    db",
  ".dP'     `M   MM                        ,MI    \"Y MM                     MM",
  "dM'       `   MM   ,6\"Yb.`7M'   `MF'    `MMb.   mmMMmm `7MM  `7MM   ,M\"\"bMM  `7MM  ,pW\"Wq.",
  "MM            MM  8)   MM  VA   ,V        `YMMNq. MM     MM    MM ,AP    MM    MM 6W'   `Wb",
  "MM.           MM   ,pm9MM   VA ,V       .     `MM MM     MM    MM 8MI    MM    MM 8M     M8",
  "`Mb.     ,'   MM  8M   MM    VVV        Mb     dM MM     MM    MM `Mb    MM    MM YA.   ,A9",
  "  `\"bmmmd'  .JMML.`Moo9^Yo.  ,V         P\"Ybmmd\"  `Mbmo  `Mbod\"YML.`Wbmd\"MML..JMML.`Ybmd9'",
  "                            ,V",
  "                         OOb\"",
];

var COMPACT_WORDMARK = [
  ",---.|                  ,---.|             |o",
  "|    |    ,---.,   .    `---.|--- .   .,---|.,---.",
  "|    |    ,---||   |        ||    |   ||   |||   |",
  "`---'`---'`---^`---|    `---'`---'`---'`---'``---'",
  "               `---'",
];

function getWordmarkLines(columns) {
  var width = Number(columns) || 80;
  if (width >= 92) return WIDE_WORDMARK.slice();
  if (width >= 50) return COMPACT_WORDMARK.slice();
  return ["Clay Studio"];
}

module.exports = { getWordmarkLines: getWordmarkLines };
