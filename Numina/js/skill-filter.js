// Client-side filter for the All Skills table.
//
// The 189 rows are in the HTML; this only hides some of them. The form ships
// `hidden` and is revealed here, so a browser with JS off — and Pagefind, and a
// printed copy — gets the whole list rather than a control that does nothing.
(function () {
  var form = document.querySelector("[data-skill-filter]");
  var table = document.querySelector(".skill-index");
  if (!form || !table) return;

  var rows = Array.prototype.slice.call(table.querySelectorAll("tbody tr"));
  var count = form.querySelector("[data-skill-count]");
  var empty = document.querySelector("[data-skill-empty]");
  var search = form.querySelector("#skill-search");
  var group = form.querySelector("#skill-group");
  var total = rows.length;

  form.hidden = false;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
  });

  function apply() {
    var query = search.value.trim().toLowerCase();
    var wanted = group.value;
    var shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var match =
        (!wanted || row.getAttribute("data-group") === wanted) &&
        (!query || row.getAttribute("data-text").indexOf(query) !== -1);
      row.hidden = !match;
      if (match) shown++;
    }
    count.textContent =
      shown === total ? "All " + total + " skills" : shown + " of " + total + " skills";
    if (empty) empty.hidden = shown !== 0;
    table.hidden = shown === 0;
  }

  search.addEventListener("input", apply);
  group.addEventListener("change", apply);
  apply();
})();
