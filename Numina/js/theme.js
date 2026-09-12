// Light/dark toggle. The current theme is applied before paint by an inline
// script in <head>; this only wires up the header button.
//
// The button is a toggle, not a command, so it carries aria-pressed and the
// label stays put ("Dark theme") instead of naming the next action. It ships
// aria-pressed="false" and is corrected here: with no stored choice the theme
// in force is the OS's, which the build cannot know.
(function () {
  var btn = document.querySelector("[data-theme-toggle]");
  if (!btn) return;
  btn.hidden = false;
  function current() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set) return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function sync() {
    btn.setAttribute("aria-pressed", current() === "dark" ? "true" : "false");
  }
  sync();
  // A visitor who has never pressed the button follows the OS, so the state
  // has to follow it too when it changes under them.
  var dark = window.matchMedia("(prefers-color-scheme: dark)");
  if (dark.addEventListener) dark.addEventListener("change", sync);
  btn.addEventListener("click", function () {
    var next = current() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("numina.theme", next); } catch (e) {}
    sync();
  });
})();
