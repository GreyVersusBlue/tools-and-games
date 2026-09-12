// The character builder page. Everything that touches the browser is here and
// nothing else is: build-rules.js prices, build-view.js renders strings,
// build-state.js packs, and this file reads the form, writes innerHTML, and
// keeps localStorage and the URL fragment in step with the form.
//
// The form is the state. A build is read back out of the form's controls on
// every input event, priced, and the result written to the page; a step's
// body is re-rendered only when what it offers has changed, so a box is never
// rebuilt under the pointer and a typed Excellency name keeps its focus.
//
// Load order: a build in the URL fragment wins over the saved one, because a
// pasted link is a deliberate act and the save is a habit. The fragment is
// rewritten on every change with history.replaceState, so the address bar is
// always the share link and the back button is never spent on a checkbox.
import { buildCatalog, priceBuild } from "./build-rules.js";
import { STORAGE_KEY, decodeBuild, deserialize, encodeBuild, isEmpty, repair, serialize } from "./build-state.js";
import { renderCard, renderStep, renderStepProblems, renderSummary, renderVerdict, stepSignature } from "./build-view.js";

const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function island(id) {
  return JSON.parse(document.getElementById(id).textContent);
}

function readBuild(form, catalog) {
  const raw = { attributes: {} };
  const push = (field, value) => {
    (raw[field] ??= []).push(value);
  };
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.name.startsWith("attr:")) {
      raw.attributes[el.name.slice(5)] = el.value;
    } else if (el.type === "radio") {
      if (el.checked) raw[el.name] = el.value || null;
    } else if (el.type === "checkbox") {
      if (el.checked) push(el.name, el.value);
    } else if (el.type === "text") {
      push(el.name, el.value);
    }
  }
  return repair(raw, catalog);
}

function main() {
  const root = document.querySelector("[data-builder]");
  if (!root) return;
  const data = island("numina-skills");
  const links = island("numina-skill-links");
  const catalog = buildCatalog(data);
  const form = root.querySelector("form");
  const bodies = Object.fromEntries(STEPS.map((n) => [n, root.querySelector(`[data-step-body="${n}"]`)]));
  const problems = Object.fromEntries(STEPS.map((n) => [n, root.querySelector(`[data-step-problems="${n}"]`)]));
  const summary = root.querySelector("[data-summary]");
  const verdictPanel = root.querySelector("[data-verdict]");
  const share = root.querySelector("[data-share]");
  const card = root.querySelector("[data-card]");
  const signatures = {};

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return deserialize(saved, catalog) ?? repair({}, catalog);
    } catch (e) {
      /* storage blocked: the page still works, it just forgets */
    }
    return repair({}, catalog);
  }

  function initial() {
    const hash = location.hash.slice(1);
    if (hash) {
      const fromUrl = decodeBuild(hash, catalog);
      if (!isEmpty(fromUrl, catalog)) return fromUrl;
    }
    return load();
  }

  function persist(build) {
    const fragment = encodeBuild(build, catalog);
    const empty = isEmpty(build, catalog);
    try {
      if (empty) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, serialize(build, catalog));
    } catch (e) {
      /* see load() */
    }
    const url = location.pathname + location.search + (empty ? "" : `#${fragment}`);
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, "", url);
    if (share) share.value = empty ? "" : location.origin + url;
  }

  // Renders whichever steps offer something different from last time. `force`
  // renders every step, which is how a loaded or reset build reaches the form.
  function paint(build, force) {
    for (const n of STEPS) {
      const sig = stepSignature(n, build, catalog);
      if (force || sig !== signatures[n]) {
        bodies[n].innerHTML = renderStep(n, build, catalog, links);
        signatures[n] = sig;
      }
    }
  }

  function update(build) {
    const verdict = priceBuild(build, catalog);
    for (const n of STEPS) problems[n].innerHTML = renderStepProblems(verdict, n);
    summary.innerHTML = renderSummary(verdict);
    verdictPanel.innerHTML = renderVerdict(verdict);
    persist(build);
    if (card) card.innerHTML = renderCard(build, verdict, catalog, { url: share ? share.value : "" });
    return verdict;
  }

  function show(build, force) {
    paint(build, force);
    update(build);
  }

  function onInput() {
    const build = readBuild(form, catalog);
    paint(build, false);
    update(build);
  }

  form.addEventListener("input", onInput);
  form.addEventListener("change", onInput);
  form.addEventListener("submit", (event) => event.preventDefault());

  root.querySelector("[data-reset]")?.addEventListener("click", () => {
    show(repair({}, catalog), true);
  });
  root.querySelector("[data-copy]")?.addEventListener("click", async (event) => {
    if (!share || !share.value) return;
    try {
      await navigator.clipboard.writeText(share.value);
      event.target.textContent = "Copied";
      setTimeout(() => (event.target.textContent = "Copy link"), 1500);
    } catch (e) {
      share.select();
    }
  });

  // A pasted link opened over this page: the new fragment is a new build.
  window.addEventListener("hashchange", () => {
    const hash = location.hash.slice(1);
    if (!hash) return;
    const fromUrl = decodeBuild(hash, catalog);
    if (!isEmpty(fromUrl, catalog)) show(fromUrl, true);
  });

  root.hidden = false;
  const noscript = document.querySelector("[data-builder-needs-js]");
  if (noscript) noscript.hidden = true;
  show(initial(), true);
}

main();
