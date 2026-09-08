export function parseClayLogReferences(text) {
  var pattern = /\[clayos\/(log:[A-Za-z0-9_-]{24})(?:\s+[\u2014-]\s+([^\]\n]{1,80}))?\]|(^|[^A-Za-z0-9_/:])(log:[A-Za-z0-9_-]{24})(?![A-Za-z0-9_-])/g;
  var results = [];
  var match;
  while ((match = pattern.exec(text || ""))) {
    results.push({
      start: match.index,
      end: pattern.lastIndex,
      prefix: match[3] || "",
      ref: match[1] || match[4],
      label: match[2] ? match[2].trim() : "",
    });
  }
  return results;
}

export function enhanceClayLogLinks(root) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  var nodes = [];
  var node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement || node.parentElement.closest("code, pre, a, button")) continue;
    if (parseClayLogReferences(node.nodeValue).length) nodes.push(node);
  }
  for (var i = 0; i < nodes.length; i++) {
    var text = nodes[i].nodeValue || "";
    var matches = parseClayLogReferences(text);
    var fragment = document.createDocumentFragment();
    var offset = 0;
    for (var j = 0; j < matches.length; j++) {
      var match = matches[j];
      fragment.appendChild(document.createTextNode(text.slice(offset, match.start)));
      if (match.prefix) fragment.appendChild(document.createTextNode(match.prefix));
      var button = document.createElement("button");
      button.type = "button";
      button.className = "clayos-log-link";
      button.dataset.logRef = match.ref;
      button.setAttribute("aria-label", "Open Project Log" + (match.label ? " " + match.label : ""));
      var label = document.createElement("span");
      label.textContent = "Log";
      button.appendChild(label);
      if (match.label) {
        var meta = document.createElement("small");
        meta.textContent = match.label;
        button.appendChild(meta);
      }
      fragment.appendChild(button);
      offset = match.end;
    }
    fragment.appendChild(document.createTextNode(text.slice(offset)));
    nodes[i].parentNode.replaceChild(fragment, nodes[i]);
  }
}
