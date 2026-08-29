// Reversible project-chrome suppression for the home route.

export function showHomeShell() {
  document.body.classList.add("home-active");
}

export function hideHomeShell() {
  document.body.classList.remove("home-active");
}
