// The offline kit's page side: register sw.js, and say something when there is
// something to say. Two banners and no third: "you are offline, this is the
// copy saved here", and "a newer build is ready, press this". Neither uses the
// words service worker, because a player in a field does not have to know what
// one is to press a button that says Update now.
//
// Loaded with `defer` from base.njk, so it runs on every page. The banner is
// built here rather than sitting in the markup: every page's first focusable
// element has to be the skip link (test/smoke.mjs pins that), and an element
// that only ever appears in two states is not worth 57 copies of in the built
// HTML. It is inserted after the skip link for the same reason.
//
// mechanics/packet.njk drives the same registration through window.numinaOffline.
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) {
    window.numinaOffline = { supported: false };
    return;
  }

  // The worker sits one level above /js/, at /Numina/sw.js, so its scope is the
  // whole Numina site and nothing else on greyversusblue.com. Derived from this
  // script's own URL rather than written down, so the path prefix lives in
  // exactly one place (eleventy.config.mjs) as it does everywhere else.
  var script = document.currentScript;
  var swUrl = new URL("../sw.js", script ? script.src : location.href).href;
  var scope = new URL("./", swUrl).pathname;

  var listeners = [];
  var state = { supported: true, saved: false, version: null, updateReady: false };
  var reloading = false;
  var banner = null;
  var bannerText = null;
  var bannerAction = null;
  // Whether anybody was in charge when this page loaded. The worker claims its
  // clients as soon as it activates, so controllerchange also fires on the very
  // first visit — reloading on that one would reload every first visit to the
  // site for nothing.
  var hadController = !!navigator.serviceWorker.controller;

  function announce() {
    for (var i = 0; i < listeners.length; i++) listeners[i](state);
    render();
  }

  function setState(patch) {
    var changed = false;
    for (var key in patch) {
      if (state[key] !== patch[key]) {
        state[key] = patch[key];
        changed = true;
      }
    }
    if (changed) announce();
  }

  // Ask the worker in charge what build it is. A MessageChannel rather than a
  // one-way post so two pages asking at once cannot read each other's answer.
  function askVersion() {
    var controller = navigator.serviceWorker.controller;
    if (!controller) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var channel = new MessageChannel();
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, 2000);
      channel.port1.onmessage = function (event) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(event.data && event.data.version ? event.data : null);
      };
      controller.postMessage({ type: "numina-version" }, [channel.port2]);
    });
  }

  function refreshVersion() {
    return askVersion().then(function (info) {
      setState({ saved: !!info, version: info ? info.version : null });
      return info;
    });
  }

  function watch(registration) {
    if (registration.waiting && navigator.serviceWorker.controller) setState({ updateReady: true });
    registration.addEventListener("updatefound", function () {
      var installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", function () {
        // A worker that reaches "installed" with nobody in charge is the first
        // visit: that is the kit being saved, not an update to announce.
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          setState({ updateReady: true });
        }
        if (installing.state === "activated") refreshVersion();
      });
    });
  }

  var ready = navigator.serviceWorker
    .register(swUrl, { scope: scope })
    .then(function (registration) {
      watch(registration);
      return registration;
    })
    .catch(function () {
      setState({ supported: false });
      return null;
    });

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!hadController) {
      hadController = true;
      refreshVersion();
      return;
    }
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  refreshVersion();
  navigator.serviceWorker.ready.then(refreshVersion);

  // --- the banner ----------------------------------------------------------

  function ensureBanner() {
    if (banner) return banner;
    banner = document.createElement("div");
    banner.className = "offline-banner";
    banner.setAttribute("role", "status");
    banner.hidden = true;
    bannerText = document.createElement("p");
    bannerText.className = "offline-banner__text";
    bannerAction = document.createElement("button");
    bannerAction.type = "button";
    bannerAction.className = "offline-banner__action";
    bannerAction.hidden = true;
    var dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "offline-banner__dismiss";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", function () {
      banner.hidden = true;
    });
    banner.appendChild(bannerText);
    banner.appendChild(bannerAction);
    banner.appendChild(dismiss);
    var skip = document.querySelector(".skip-link");
    if (skip && skip.parentNode) skip.parentNode.insertBefore(banner, skip.nextSibling);
    else document.body.insertBefore(banner, document.body.firstChild);
    return banner;
  }

  function render() {
    var offline = navigator.onLine === false;
    if (!offline && !state.updateReady) {
      if (banner) banner.hidden = true;
      return;
    }
    ensureBanner();
    banner.hidden = false;
    if (state.updateReady) {
      bannerText.textContent = state.version
        ? "A newer build of Numina is ready. This device has build " + state.version + "."
        : "A newer build of Numina is ready.";
      bannerAction.textContent = "Update now";
      bannerAction.hidden = false;
      bannerAction.onclick = function () {
        bannerAction.disabled = true;
        applyUpdate();
      };
      return;
    }
    bannerText.textContent = state.version
      ? "You are offline. This is the copy of Numina saved on this device, build " + state.version + "."
      : "You are offline, and this device has no copy of Numina saved yet.";
    bannerAction.hidden = true;
    bannerAction.onclick = null;
  }

  window.addEventListener("online", render);
  window.addEventListener("offline", render);

  // --- the update path -----------------------------------------------------

  function applyUpdate() {
    return ready.then(function (registration) {
      if (!registration) return;
      // controllerchange reloads the page, so nothing else is needed here.
      if (registration.waiting) registration.waiting.postMessage({ type: "numina-update" });
      else location.reload();
    });
  }

  function check() {
    return ready
      .then(function (registration) {
        return registration ? registration.update().then(function () { return registration; }) : null;
      })
      .then(function () {
        return refreshVersion();
      })
      .then(function () {
        return state;
      })
      .catch(function () {
        return state;
      });
  }

  window.numinaOffline = {
    supported: true,
    state: function () {
      return state;
    },
    subscribe: function (fn) {
      listeners.push(fn);
      fn(state);
    },
    check: check,
    update: applyUpdate,
  };
})();
