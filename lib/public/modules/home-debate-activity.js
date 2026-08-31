// Shared ephemeral activity row for Home debate planning.

var announced = {};

export function resetHomeDebateActivityAnnouncement(modifier) {
  if (modifier) delete announced[modifier];
}

function textElement(tag, className, text) {
  var element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function createHomeDebateActivityRow(statusText, accessibleText, modifier) {
  var announcementKey = modifier || "home-debate-activity";
  var row = document.createElement("div");
  row.className = "home-debate-activity " + announcementKey;
  row.setAttribute("role", "status");
  row.setAttribute("aria-live", announced[announcementKey] ? "off" : "polite");
  row.setAttribute("aria-atomic", "true");
  row.setAttribute("aria-label", accessibleText);
  announced[announcementKey] = true;

  var avatar = document.createElement("img");
  avatar.className = "home-debate-activity-avatar";
  avatar.src = "/clay-studio-symbol.png";
  avatar.alt = "";
  avatar.width = 28;
  avatar.height = 28;
  row.appendChild(avatar);

  var content = document.createElement("div");
  content.className = "home-debate-activity-content";
  content.appendChild(textElement("span", "home-debate-activity-name", "Clay"));
  var status = document.createElement("div");
  status.className = "home-debate-activity-status";
  status.appendChild(textElement("span", "home-debate-activity-label", statusText));
  var dots = document.createElement("span");
  dots.className = "home-debate-activity-dots";
  dots.setAttribute("aria-hidden", "true");
  for (var i = 0; i < 3; i++) dots.appendChild(document.createElement("i"));
  status.appendChild(dots);
  content.appendChild(status);
  row.appendChild(content);
  return row;
}
