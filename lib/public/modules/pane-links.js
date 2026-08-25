export function isExternalWebLink(href, currentHref) {
  if (!href) return false;
  try {
    var url = new URL(href, currentHref);
    var currentUrl = new URL(currentHref);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.origin !== currentUrl.origin;
  } catch (err) {
    return false;
  }
}

export function forceExternalLinkToNewTab(anchor, currentHref) {
  if (!anchor || !isExternalWebLink(anchor.href, currentHref)) return false;

  var rel = (anchor.getAttribute("rel") || "").split(/\s+/).filter(Boolean);
  if (rel.indexOf("noopener") === -1) rel.push("noopener");
  if (rel.indexOf("noreferrer") === -1) rel.push("noreferrer");

  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", rel.join(" "));
  return true;
}
