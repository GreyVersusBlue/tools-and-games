// The site-wide search modal, and Ctrl+K (Cmd+K on a Mac) from any page.
//
// Pagefind's Component UI is 175 KB of JS and 42 KB of CSS. Putting that on all
// 58 pages to serve a keyboard shortcut would more than double what a reference
// page costs to load, so it is fetched the first time somebody actually opens
// the modal and never otherwise. The offline kit precaches both files by name
// (tools/service-worker.mjs), so on a second visit that fetch is local.
//
// Nothing here implements a dialog. pagefind-modal renders a real <dialog> and
// opens it with showModal(), which is what traps focus and handles Escape; the
// component registers the same shortcut itself once it is loaded, so this file's
// own key handler exists only to cover the gap before the first open.
//
// On /search/ there is a pagefind-input on the page already. The shortcut moves
// focus there instead of stacking a modal on top of the same search, and the
// header keeps its form.
(function () {
  var trigger = document.querySelector("[data-search-open]");
  if (!trigger) return;
  var onSearchPage = !!document.querySelector("pagefind-input");

  // mod+k: meta on Apple platforms, control everywhere else. Same split
  // Pagefind's own "mod+k" binding makes, and the label has to agree with it or
  // it is telling a Mac the wrong key.
  var apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  function isShortcut(e) {
    return e.key && e.key.toLowerCase() === "k" && (apple ? e.metaKey : e.ctrlKey) && !e.altKey;
  }

  if (onSearchPage) {
    document.addEventListener("keydown", function (e) {
      if (!isShortcut(e)) return;
      var input = document.querySelector("pagefind-input input");
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    });
    return;
  }

  var base = trigger.getAttribute("data-pagefind");
  var form = document.querySelector(".header-search");
  var key = trigger.querySelector(".search-trigger__key");
  if (key && apple) key.textContent = "⌘ K";
  trigger.hidden = false;
  if (form) form.hidden = true;

  var bundle = null;
  function load() {
    if (bundle) return bundle;
    bundle = new Promise(function (resolve, reject) {
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = base + "pagefind-component-ui.css";
      document.head.appendChild(css);
      var js = document.createElement("script");
      js.src = base + "pagefind-component-ui.js";
      js.addEventListener("load", resolve);
      js.addEventListener("error", function () {
        reject(new Error("search bundle did not load"));
      });
      document.head.appendChild(js);
    });
    return bundle;
  }

  var modal = null;
  function build() {
    if (modal) return modal;
    // Appended after the bundle has run, so both elements upgrade on append and
    // in this order: the config registers the bundle path on the default
    // instance before the modal's own input connects and asks for it.
    var config = document.createElement("pagefind-config");
    config.setAttribute("bundle-path", base);
    modal = document.createElement("pagefind-modal");
    modal.setAttribute("reset-on-close", "");
    document.body.appendChild(config);
    document.body.appendChild(modal);
    // aria-expanded on the button is the component's job only for a
    // pagefind-modal-trigger it rendered itself. This button is ours — it has to
    // exist before the bundle does — so the state is ours to follow. The dialog
    // fires close for Escape and for a backdrop click alike.
    var dialog = modal.querySelector("dialog");
    if (dialog) {
      dialog.addEventListener("close", function () {
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
      });
    }
    return modal;
  }

  var opening = false;
  function open() {
    if (opening) return;
    opening = true;
    load().then(
      function () {
        opening = false;
        var el = build();
        if (typeof el.open === "function") el.open();
        trigger.setAttribute("aria-expanded", "true");
      },
      function () {
        // The bundle is the whole feature. With it gone, hand the visitor back
        // the form that does not need it rather than leaving a dead button.
        opening = false;
        trigger.hidden = true;
        if (form) form.hidden = false;
        var input = form && form.querySelector("input");
        if (input) input.focus();
      }
    );
  }

  trigger.addEventListener("click", open);
  document.addEventListener("keydown", function (e) {
    if (!isShortcut(e)) return;
    // Nothing in the bundle claims mod+k on its own: the component registers
    // that shortcut from a pagefind-modal-trigger element, and this modal is
    // built without one. So this handler stays live for every open, and
    // pagefind-modal.open() is what ignores a second press while it is already
    // up.
    e.preventDefault();
    open();
  });
})();
