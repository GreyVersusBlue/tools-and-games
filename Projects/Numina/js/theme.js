// Light/dark toggle. The current theme is applied before paint by an inline
// script in <head>; this only wires up the header button.
(function () {
  var btn = document.querySelector("[data-theme-toggle]");
  if (!btn) return;
  btn.hidden = false;
  function current() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set) return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  btn.addEventListener("click", function () {
    var next = current() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("numina.theme", next); } catch (e) {}
  });
})();
